import { randomUUID } from 'node:crypto';
import { Logger } from 'nestjs-pino';
import { parseDialect } from '@cybedefend/db-dialect';
import type { QueryDeepPartialEntity } from 'typeorm';
import {
  createLiveDatabase,
  liveEnabled,
  type LiveDatabase,
} from '../../core/db/live-database';
import {
  AdvisoryFallbackService,
  AdvisoryInput,
  AdvisoryScope,
} from './advisory-fallback.service';
import { ImportedAdvisory } from '../../entities/imported-advisory.entity';
import { VulnerabilityOsv } from '../../entities/osv/vulnerability-osv.entity';
import { VulnerabilityOsvAlias } from '../../entities/osv/vulnerability-osv-alias.entity';
import { VulnerabilityOsvSeverity } from '../../entities/osv/vulnerability-osv-severity.entity';
import { VulnerabilityOsvReference } from '../../entities/osv/vulnerability-osv-reference.entity';
import { VulnerabilityOsvAffected } from '../../entities/osv/vulnerability-osv-affected.entity';
import { IMPORTED_ADVISORY_LIMITS } from './imported-advisory.view';

/**
 * LIVE spec for the advisory fallback, on the engine LIVE_DB_TYPE selects
 * (default mysql):
 *
 *   RESULTS_IMPORT_LIVE=1 LIVE_DB_TYPE=mysql \
 *     RESULTS_IMPORT_MYSQL_URL=mysql://root:password@127.0.0.1:3308 \
 *     pnpm exec jest --ci --runInBand src/modules/results-import/advisory-fallback.live.spec.ts
 *   RESULTS_IMPORT_LIVE=1 LIVE_DB_TYPE=postgres \
 *     RESULTS_IMPORT_PG_URL=postgres://postgres:postgres@127.0.0.1:5432 \
 *     pnpm exec jest --ci --runInBand src/modules/results-import/advisory-fallback.live.spec.ts
 *
 * (`RESULTS_IMPORT_MYSQL_LIVE=1` is accepted in place of the first flag.)
 * The database comes from createLiveDatabase({ dialect }) and is migrated with
 * the dialect's tracks. The project's lock is the database's advisory lock.
 */
const LIVE = liveEnabled('RESULTS_IMPORT');
const describeLive = LIVE ? describe : describe.skip;

const CVSS_CRITICAL = 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H'; // 9.8

const item = (over: Partial<AdvisoryInput> = {}): AdvisoryInput => ({
  id: 'GHSA-live-0001',
  toolName: 'trivy-live',
  summary: 'Live advisory summary',
  details: 'Live advisory details',
  cweIds: ['CWE-79'],
  severity: 'high',
  cvssV3Vector: CVSS_CRITICAL,
  helpUri: 'https://example.com/live-advisory',
  aliases: ['CVE-2024-0001'],
  fixes: [{ ecosystem: 'npm', packageName: 'lodash', fixed: '4.17.21' }],
  ...over,
});

const scope = (over: Partial<AdvisoryScope> = {}): AdvisoryScope => ({
  projectId: randomUUID(),
  organizationId: randomUUID(),
  scanId: randomUUID(),
  ...over,
});

describeLive('AdvisoryFallbackService on a real database', () => {
  jest.setTimeout(120_000);
  const HOOK_TIMEOUT = 240_000;

  const dialect = parseDialect(process.env.LIVE_DB_TYPE);

  let live: LiveDatabase;
  let service: AdvisoryFallbackService;
  let serviceB: AdvisoryFallbackService;

  const logger = {
    warn: jest.fn(),
    log: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;

  const repo = <T extends object>(entity: new () => T) =>
    live.dataSource.getRepository(entity);
  const importedOf = (projectId: string, advisoryId: string) =>
    repo(ImportedAdvisory).findOneByOrFail({ projectId, advisoryId });
  /** Every child row the shared catalogue has for `id`. */
  const catalogueChildren = async (id: string) => ({
    aliases: await repo(VulnerabilityOsvAlias).count({
      where: { vulnerability: { id } },
    }),
    severities: await repo(VulnerabilityOsvSeverity).count({
      where: { vulnerability: { id } },
    }),
    references: await repo(VulnerabilityOsvReference).count({
      where: { vulnerability: { id } },
    }),
    affected: await repo(VulnerabilityOsvAffected).count({
      where: { vulnerability: { id } },
    }),
  });
  const NO_CHILD = { aliases: 0, severities: 0, references: 0, affected: 0 };

  beforeAll(async () => {
    live = await createLiveDatabase({
      prefix: 'results_import_adv',
      envPrefix: 'RESULTS_IMPORT',
      dialect,
      migrations: 'track',
    });
    service = new AdvisoryFallbackService(live.dataSource, logger);
    serviceB = new AdvisoryFallbackService(live.dataSource, logger);
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await live?.drop();
  }, HOOK_TIMEOUT);

  it('two organizations importing one advisory id each keep their own content, and the catalogue gets an id-only root', async () => {
    const id = 'GHSA-cross-org-1';
    const a = scope();
    const b = scope();
    await service.ensureAdvisories(a, [
      item({
        id,
        summary: 'A summary',
        details: 'A details',
        severity: 'critical',
        cvssV3Vector: CVSS_CRITICAL,
        helpUri: 'https://a.example/advisory',
        aliases: ['CVE-2024-1111'],
        fixes: [{ ecosystem: 'npm', packageName: 'lodash', fixed: '9.9.9' }],
      }),
    ]);
    await service.ensureAdvisories(b, [
      item({
        id,
        summary: 'B summary',
        details: 'B details',
        severity: 'low',
        cvssV3Vector: null,
        helpUri: 'https://b.example/advisory',
        aliases: ['CVE-2024-2222'],
        fixes: [{ ecosystem: 'npm', packageName: 'lodash', fixed: '4.17.21' }],
      }),
    ]);

    const rowA = await importedOf(a.projectId, id);
    expect(rowA).toMatchObject({
      organizationId: a.organizationId,
      scanId: a.scanId,
      summary: 'A summary',
      severity: 'critical',
      cvssV3Vector: CVSS_CRITICAL,
      aliases: ['CVE-2024-1111'],
      referenceUrls: ['https://a.example/advisory'],
      fixes: [{ ecosystem: 'npm', packageName: 'lodash', fixed: '9.9.9' }],
    });
    const rowB = await importedOf(b.projectId, id);
    expect(rowB).toMatchObject({
      summary: 'B summary',
      severity: 'low',
      cvssV3Vector: null,
      aliases: ['CVE-2024-2222'],
      referenceUrls: ['https://b.example/advisory'],
      fixes: [{ ecosystem: 'npm', packageName: 'lodash', fixed: '4.17.21' }],
    });

    const root = await repo(VulnerabilityOsv).findOneByOrFail({ id });
    expect(root.summary).toBeNull();
    expect(root.details).toBeNull();
    expect(root.databaseSpecific).toBeNull();
    expect(await catalogueChildren(id)).toEqual(NO_CHILD);
  });

  it('adds nothing to an advisory the catalogue already has', async () => {
    const id = 'GHSA-catalogue-1';
    const past = new Date(Date.now() - 3_600_000);
    await live.dataSource
      .createQueryBuilder()
      .insert()
      .into(VulnerabilityOsv)
      .values({
        id,
        summary: 'catalogue',
        details: 'catalogue details',
        createdAt: past,
        updatedAt: past,
      } as unknown as QueryDeepPartialEntity<VulnerabilityOsv>)
      .updateEntity(false)
      .execute();
    const before = await repo(VulnerabilityOsv).findOneByOrFail({ id });

    const s = scope();
    await service.ensureAdvisories(s, [
      item({ id, summary: 'imported', aliases: ['CVE-2099-0001'] }),
    ]);

    const after = await repo(VulnerabilityOsv).findOneByOrFail({ id });
    expect(after.summary).toBe('catalogue');
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
    expect(await catalogueChildren(id)).toEqual(NO_CHILD);
    expect((await importedOf(s.projectId, id)).summary).toBe('imported');
  });

  it("the batches of one import add up, and the project's next import replaces them", async () => {
    const id = 'GHSA-batches-1';
    const first = scope();
    await service.ensureAdvisories(first, [
      item({
        id,
        aliases: ['CVE-2024-0001'],
        fixes: [{ ecosystem: 'npm', packageName: 'a', fixed: '1.0.1' }],
      }),
    ]);
    await service.ensureAdvisories(first, [
      item({
        id,
        summary: 'second batch text',
        aliases: ['GHSA-zzzz'],
        fixes: [{ ecosystem: 'npm', packageName: 'b', fixed: '2.0.1' }],
      }),
    ]);
    const merged = await importedOf(first.projectId, id);
    expect(merged.summary).toBe('Live advisory summary');
    expect([...merged.aliases].sort()).toEqual(['CVE-2024-0001', 'GHSA-zzzz']);
    expect(merged.fixes.map((f) => f.packageName).sort()).toEqual(['a', 'b']);

    const next = { ...first, scanId: randomUUID() };
    await service.ensureAdvisories(next, [
      item({
        id,
        summary: 'next import',
        severity: 'medium',
        aliases: [],
        fixes: [{ ecosystem: 'npm', packageName: 'b', fixed: '2.0.2' }],
      }),
    ]);
    const replaced = await importedOf(first.projectId, id);
    expect(replaced).toMatchObject({
      scanId: next.scanId,
      summary: 'next import',
      severity: 'medium',
      aliases: [],
      fixes: [{ ecosystem: 'npm', packageName: 'b', fixed: '2.0.2' }],
    });
    expect(
      await repo(ImportedAdvisory).count({ where: { advisoryId: id } }),
    ).toBe(1);
  });

  it('keeps at most the bounded number of aliases, references, fixes and CWE ids per advisory', async () => {
    const id = 'GHSA-bounded-1';
    const s = scope();
    const many = <T>(n: number, f: (i: number) => T): T[] =>
      Array.from({ length: n }, (_, i) => f(i));
    await service.ensureAdvisories(
      s,
      many(30, (i) => String(i)).map((i) =>
        item({
          id,
          helpUri: `https://example.com/ref-${i}`,
          aliases: many(10, (j) => `CVE-2024-${i}-${j}`),
          cweIds: many(5, (j) => `CWE-${i}${j}`),
          fixes: many(10, (j) => ({
            ecosystem: 'npm',
            packageName: `p${i}`,
            fixed: `1.${j}`,
          })),
        }),
      ),
    );
    const row = await importedOf(s.projectId, id);
    expect(row.aliases).toHaveLength(IMPORTED_ADVISORY_LIMITS.aliases);
    expect(row.referenceUrls).toHaveLength(
      IMPORTED_ADVISORY_LIMITS.referenceUrls,
    );
    expect(row.fixes).toHaveLength(IMPORTED_ADVISORY_LIMITS.fixes);
    expect(row.cweIds.length).toBeLessThanOrEqual(
      IMPORTED_ADVISORY_LIMITS.cweIds,
    );
    expect(await catalogueChildren(id)).toEqual(NO_CHILD);
  });

  it('two concurrent batches of one import into one project keep the union, and one catalogue root', async () => {
    for (let round = 0; round < 8; round += 1) {
      const id = `GHSA-race-${round}`;
      const s = scope();
      await Promise.all([
        service.ensureAdvisories(s, [
          item({
            id,
            aliases: ['CVE-RACE-A'],
            fixes: [{ ecosystem: 'npm', packageName: 'a', fixed: '1.0.0' }],
          }),
        ]),
        serviceB.ensureAdvisories(s, [
          item({
            id,
            aliases: ['CVE-RACE-B'],
            fixes: [{ ecosystem: 'npm', packageName: 'b', fixed: '1.0.0' }],
          }),
        ]),
      ]);
      expect(await repo(VulnerabilityOsv).count({ where: { id } })).toBe(1);
      const row = await importedOf(s.projectId, id);
      expect([...row.aliases].sort()).toEqual(['CVE-RACE-A', 'CVE-RACE-B']);
      expect(row.fixes.map((f) => f.packageName).sort()).toEqual(['a', 'b']);
    }
  });

  it('keeps the union of two concurrent batches of one import, 16 times', async () => {
    const one = new AdvisoryFallbackService(live.dataSource, logger);
    const two = new AdvisoryFallbackService(live.dataSource, logger);
    for (let round = 0; round < 16; round += 1) {
      const id = `GHSA-nolock-${round}`;
      const s = scope();
      const batch = (letter: string) =>
        item({
          id,
          aliases: [`CVE-NOLOCK-${letter}`],
          fixes: [{ ecosystem: 'npm', packageName: letter, fixed: '1.0.0' }],
        });
      await Promise.all([
        one.ensureAdvisories(s, [batch('a')]),
        two.ensureAdvisories(s, [batch('b')]),
      ]);
      const row = await importedOf(s.projectId, id);
      expect(row.fixes.map((f) => f.packageName).sort()).toEqual(['a', 'b']);
    }
  });
});
