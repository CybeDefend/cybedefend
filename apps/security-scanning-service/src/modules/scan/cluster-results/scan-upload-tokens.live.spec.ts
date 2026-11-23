import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { Container } from 'src/entities/container.entity';
import { Scan } from 'src/entities/scan.entity';
import { ScanUploadToken } from 'src/entities/scan-upload-token.entity';
import {
  createLiveDatabase,
  liveEnabled,
  LiveDatabase,
} from 'src/core/db/live-database';
import { hashScanToken, ScanUploadTokens } from './scan-upload-tokens';

/**
 * LIVE proof of the per-container upload token on BOTH engines
 * (`LIVE_DB_TYPE=mysql|postgres`): the table exists after the dialect's
 * migrations, a token is spent exactly once under concurrency (one
 * conditional UPDATE decided on `affected`), an expired token cannot be
 * claimed, and deleting the scan deletes its tokens (FK ON DELETE CASCADE).
 *
 * Skipped unless `SS_CLUSTER_SCAN_LIVE=1`. The server is
 * `SS_CLUSTER_SCAN_MYSQL_URL` / `SS_CLUSTER_SCAN_PG_URL`, else the import
 * spec's `SS_IMPORT_SCAN_MYSQL_URL` / `SS_IMPORT_SCAN_PG_URL`.
 *
 *   SS_CLUSTER_SCAN_LIVE=1 LIVE_DB_TYPE=mysql SS_IMPORT_SCAN_MYSQL_URL=mysql://root:password@127.0.0.1:13308 \
 *     pnpm exec jest --ci --runInBand src/modules/scan/cluster-results/scan-upload-tokens.live.spec.ts
 *   SS_CLUSTER_SCAN_LIVE=1 LIVE_DB_TYPE=postgres SS_IMPORT_SCAN_PG_URL=postgres://postgres:postgres@127.0.0.1:15432 \
 *     pnpm exec jest --ci --runInBand src/modules/scan/cluster-results/scan-upload-tokens.live.spec.ts
 */
const describeLive = liveEnabled('SS_CLUSTER_SCAN') ? describe : describe.skip;

describeLive('scan upload tokens on a real database', () => {
  jest.setTimeout(300_000);

  let db: LiveDatabase;
  let dataSource: DataSource;
  let tokens: ScanUploadTokens;

  beforeAll(async () => {
    process.env.SS_CLUSTER_SCAN_MYSQL_URL ??=
      process.env.SS_IMPORT_SCAN_MYSQL_URL;
    process.env.SS_CLUSTER_SCAN_PG_URL ??= process.env.SS_IMPORT_SCAN_PG_URL;
    db = await createLiveDatabase({
      prefix: 'ss_cluster_token',
      envPrefix: 'SS_CLUSTER_SCAN',
      // a pool wide enough for the concurrent claims to really overlap
      extra: { connectionLimit: 10, max: 10 },
    });
    dataSource = db.dataSource;
    tokens = new ScanUploadTokens(dataSource.getRepository(ScanUploadToken));
  });

  afterAll(async () => {
    await db?.drop();
  });

  const seedContainer = async (): Promise<{
    scan: Scan;
    container: Container;
  }> => {
    const scan = await dataSource.getRepository(Scan).save({
      name: `cluster-${randomUUID().slice(0, 8)}`,
      state: 'running',
      language: ['python'],
      projectId: 'p-cluster-live',
      organizationId: 'org-cluster-live',
      scanType: 'sast',
      branch: 'main',
      startTime: new Date(),
    });
    const container = await dataSource.getRepository(Container).save({
      scanId: scan.id,
      podName: `cd-scan-opengrep-${randomUUID()}`,
      image: 'cybedefend-scanners/opengrep:1.0.0',
      status: 'running',
    });
    return { scan, container };
  };

  const mintFor = (
    scan: Scan,
    container: Container,
    expiresAt = new Date(Date.now() + 3_600_000),
  ) =>
    tokens.mint({
      scanId: scan.id,
      containerId: container.id,
      category: 'sast',
      severities: 'critical,high',
      expiresAt,
    });

  it('stores the hash, never the token', async () => {
    const { scan, container } = await seedContainer();
    const token = await mintFor(scan, container);

    const stored = await dataSource
      .getRepository(ScanUploadToken)
      .findOneByOrFail({ containerId: container.id });

    expect(stored.tokenHash).toBe(hashScanToken(token));
    expect(JSON.stringify(stored)).not.toContain(token.slice(5));
    await expect(
      tokens.authorize(scan.id, hashScanToken(token), new Date()),
    ).resolves.toMatchObject({ row: { containerId: container.id } });
  });

  it("claim: two concurrent claims ⇒ one 'claimed', one 'used'", async () => {
    const { scan, container } = await seedContainer();
    const hash = hashScanToken(await mintFor(scan, container));
    const now = new Date();

    const outcomes = await Promise.all([
      tokens.claim(scan.id, hash, now),
      tokens.claim(scan.id, hash, now),
    ]);

    expect(outcomes.sort()).toEqual(['claimed', 'used']);
    await expect(tokens.authorize(scan.id, hash, now)).resolves.toEqual({
      refused: 'used',
    });
    await expect(tokens.spentContainers([container.id])).resolves.toEqual(
      new Set([container.id]),
    );
  });

  it('claim after expiresAt ⇒ invalid', async () => {
    const { scan, container } = await seedContainer();
    const expiresAt = new Date(Date.now() + 60_000);
    const hash = hashScanToken(await mintFor(scan, container, expiresAt));

    await expect(
      tokens.claim(scan.id, hash, new Date(expiresAt.getTime() + 5_000)),
    ).resolves.toBe('invalid');
    await expect(tokens.spentContainers([container.id])).resolves.toEqual(
      new Set(),
    );
  });

  it('claim for another scan ⇒ invalid, and the token stays unspent', async () => {
    const { scan, container } = await seedContainer();
    const other = await seedContainer();
    const hash = hashScanToken(await mintFor(scan, container));

    await expect(tokens.claim(other.scan.id, hash, new Date())).resolves.toBe(
      'invalid',
    );
    await expect(tokens.claim(scan.id, hash, new Date())).resolves.toBe(
      'claimed',
    );
  });

  it('spentContainers reads only spent tokens, in one query', async () => {
    const a = await seedContainer();
    const b = await seedContainer();
    const hashA = hashScanToken(await mintFor(a.scan, a.container));
    await mintFor(b.scan, b.container);
    await tokens.claim(a.scan.id, hashA, new Date());

    db.statements.length = 0;
    const spent = await tokens.spentContainers([
      a.container.id,
      b.container.id,
      randomUUID(),
    ]);

    expect(spent).toEqual(new Set([a.container.id]));
    expect(db.statements.filter((s) => /^\s*SELECT/i.test(s))).toHaveLength(1);
  });

  it('release gives back only the claim it names: affected decides, and the token can be claimed again', async () => {
    const { scan, container } = await seedContainer();
    const hash = hashScanToken(await mintFor(scan, container));
    const claimedAt = new Date();
    await expect(tokens.claim(scan.id, hash, claimedAt)).resolves.toBe(
      'claimed',
    );

    // a stale claim time names another claim: nothing is given back
    await expect(
      tokens.release(hash, new Date(claimedAt.getTime() - 1)),
    ).resolves.toBe(false);
    await expect(tokens.spentContainers([container.id])).resolves.toEqual(
      new Set([container.id]),
    );

    await expect(tokens.release(hash, claimedAt)).resolves.toBe(true);
    // a second give-back of the same claim finds nothing to give back
    await expect(tokens.release(hash, claimedAt)).resolves.toBe(false);
    await expect(tokens.spentContainers([container.id])).resolves.toEqual(
      new Set(),
    );

    const retriedAt = new Date(claimedAt.getTime() + 1_000);
    await expect(tokens.claim(scan.id, hash, retriedAt)).resolves.toBe(
      'claimed',
    );
    // spentAt reads the claim time back to the millisecond
    const spent = await tokens.spentAt([container.id, randomUUID()]);
    expect([...spent.keys()]).toEqual([container.id]);
    expect(spent.get(container.id)?.getTime()).toBe(retriedAt.getTime());
  });

  it('one token per container', async () => {
    const { scan, container } = await seedContainer();
    await mintFor(scan, container);

    await expect(mintFor(scan, container)).rejects.toThrow();
  });

  it('deleting the scan deletes its tokens', async () => {
    const { scan, container } = await seedContainer();
    await mintFor(scan, container);
    const repo = dataSource.getRepository(ScanUploadToken);
    expect(await repo.countBy({ scanId: scan.id })).toBe(1);

    await dataSource.getRepository(Scan).delete({ id: scan.id });

    expect(await repo.countBy({ scanId: scan.id })).toBe(0);
    expect(await repo.countBy({ containerId: container.id })).toBe(0);
  });
});
