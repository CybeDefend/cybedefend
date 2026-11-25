import { randomUUID } from 'node:crypto';
import { parseDialect } from '@cybedefend/db-dialect';
import { createLiveDatabase, type LiveDatabase } from '../../db/live-database';
import { ImportedAdvisory } from '../../../entities/imported-advisory.entity';
import { CreateImportedAdvisory1846450000000 } from '../1846450000000-CreateImportedAdvisory';

/**
 * LIVE spec of the common migration 1846450000000, on the engine
 * LIVE_DB_TYPE selects:
 *
 *   AR_IMPORTED_ADVISORY_LIVE=1 LIVE_DB_TYPE=mysql \
 *     AR_IMPORTED_ADVISORY_MYSQL_URL=mysql://root:password@127.0.0.1:3308 \
 *     pnpm exec jest --ci --runInBand src/core/migrations-common/__tests__/create-imported-advisory.live.spec.ts
 *   AR_IMPORTED_ADVISORY_LIVE=1 LIVE_DB_TYPE=postgres \
 *     AR_IMPORTED_ADVISORY_PG_URL=postgres://postgres:postgres@127.0.0.1:5432 \
 *     pnpm exec jest --ci --runInBand src/core/migrations-common/__tests__/create-imported-advisory.live.spec.ts
 *
 * The schema is built by the dialect's tracks (the migration runs there).
 * The spec checks the table, its key and index, that the entity reads back
 * what it wrote (JSON arrays and long text), that an upsert on the key
 * replaces a row, and that `down` then `up` are idempotent.
 */
const LIVE = process.env.AR_IMPORTED_ADVISORY_LIVE === '1';
const describeLive = LIVE ? describe : describe.skip;

describeLive('CreateImportedAdvisory on a real database', () => {
  jest.setTimeout(240_000);
  const HOOK_TIMEOUT = 240_000;
  const dialect = parseDialect(process.env.LIVE_DB_TYPE);
  let live: LiveDatabase;

  beforeAll(async () => {
    live = await createLiveDatabase({
      prefix: 'ar_imported_advisory',
      envPrefix: 'AR_IMPORTED_ADVISORY',
      dialect,
      migrations: 'track',
    });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await live?.drop();
  }, HOOK_TIMEOUT);

  const tableOf = async () => {
    const runner = live.dataSource.createQueryRunner();
    try {
      return await runner.getTable('imported_advisory');
    } finally {
      await runner.release();
    }
  };

  it('creates the table keyed by (projectId, advisoryId) with the organization index', async () => {
    const table = await tableOf();
    expect(table).toBeDefined();
    expect(table.primaryColumns.map((c) => c.name).sort()).toEqual([
      'advisoryId',
      'projectId',
    ]);
    expect(
      table.indices.find((i) => i.name === 'IDX_imported_advisory_org')
        ?.columnNames,
    ).toEqual(['organizationId']);
    expect(Number(table.findColumnByName('advisoryId').length)).toBe(255);
  });

  it('keeps what the entity writes and replaces a row on its key', async () => {
    const repo = live.dataSource.getRepository(ImportedAdvisory);
    const projectId = randomUUID();
    const details = 'd'.repeat(20_000);
    const base = {
      projectId,
      advisoryId: 'GHSA-' + 'x'.repeat(250),
      organizationId: randomUUID(),
      scanId: randomUUID(),
      toolName: 'trivy',
      summary: 'first',
      details,
      severity: 'high',
      cvssV3Vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
      cweIds: ['CWE-79'],
      aliases: ['CVE-2024-0001'],
      referenceUrls: ['https://example.com/a'],
      fixes: [{ ecosystem: 'npm', packageName: 'lodash', fixed: '4.17.21' }],
    };
    const upsert = (row: typeof base) =>
      repo
        .createQueryBuilder()
        .insert()
        .into(ImportedAdvisory)
        .values({ ...row, updatedAt: new Date() })
        .orUpdate(
          ['summary', 'severity', 'aliases', 'updatedAt'],
          ['projectId', 'advisoryId'],
        )
        .updateEntity(false)
        .execute();

    await upsert(base);
    const first = await repo.findOneByOrFail({
      projectId,
      advisoryId: base.advisoryId,
    });
    expect(first.details).toBe(details);
    expect(first.fixes).toEqual(base.fixes);
    expect(first.referenceUrls).toEqual(base.referenceUrls);
    expect(first.cweIds).toEqual(['CWE-79']);

    await upsert({
      ...base,
      summary: 'second',
      severity: 'low',
      aliases: ['CVE-2024-0002'],
    });
    expect(await repo.count({ where: { projectId } })).toBe(1);
    const second = await repo.findOneByOrFail({
      projectId,
      advisoryId: base.advisoryId,
    });
    expect(second.summary).toBe('second');
    expect(second.severity).toBe('low');
    expect(second.aliases).toEqual(['CVE-2024-0002']);
  });

  it('down removes the table and up is idempotent', async () => {
    const migration = new CreateImportedAdvisory1846450000000();
    const runner = live.dataSource.createQueryRunner();
    try {
      await migration.down(runner);
      await migration.down(runner);
      expect(await runner.hasTable('imported_advisory')).toBe(false);
      await migration.up(runner);
      await migration.up(runner);
      expect(await runner.hasTable('imported_advisory')).toBe(true);
    } finally {
      await runner.release();
    }
  });
});
