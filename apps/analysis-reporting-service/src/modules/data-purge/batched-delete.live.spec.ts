import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import {
  createLiveDatabase,
  liveEnabled,
  type LiveDatabase,
} from '../../core/db/live-database';
import { SastVulnerabilityDetections } from '../../entities/sast-vulnerability-detections.entity';
import { AggregatedReport } from '../../entities/aggregated-report.entity';
import { deleteInBatches, PURGE_BATCH_SIZE } from './batched-delete';
import { PROJECT_PURGE_TABLES } from './purge-tables';

/**
 * LIVE spec: the purge's bounded DELETE (`deleteBatch`: `DELETE …
 * LIMIT n` on MySQL, `ctid IN (SELECT ctid … LIMIT n)` on PostgreSQL) and its
 * comma-separated match (`inCsv`: FIND_IN_SET on MySQL, `= ANY
 * (string_to_array())` on PostgreSQL) delete exactly the purged project's
 * rows, a batch at a time, with the deleted count read back from the
 * statement on both engines.
 *
 *   AR_PURGE_LIVE=1 LIVE_DB_TYPE=mysql AR_PURGE_MYSQL_URL=mysql://root:password@127.0.0.1:3308 \
 *     pnpm exec jest --ci --runInBand --testPathPatterns=batched-delete.live
 *   AR_PURGE_LIVE=1 LIVE_DB_TYPE=postgres AR_PURGE_PG_URL=postgres://postgres:postgres@127.0.0.1:5432 \
 *     pnpm exec jest --ci --runInBand --testPathPatterns=batched-delete.live
 *
 * The schema is built by the dialect's migration tracks in a throwaway
 * database, dropped at the end.
 */
const LIVE = liveEnabled('AR_PURGE');
const describeLive = LIVE ? describe : describe.skip;

const P = '0d0d0d0d-0000-4000-8000-00000000000a';
const Q = '0d0d0d0d-0000-4000-8000-00000000000b';
const R = '0d0d0d0d-0000-4000-8000-00000000000c';

describeLive('the batched purge DELETE on both engines', () => {
  jest.setTimeout(120_000);
  const HOOK_TIMEOUT = 240_000;
  let live: LiveDatabase;
  let ds: DataSource;

  beforeAll(async () => {
    live = await createLiveDatabase({
      prefix: 'ar_purge',
      envPrefix: 'AR_PURGE',
      migrations: 'track',
    });
    ds = live.dataSource;
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await live?.drop();
  }, HOOK_TIMEOUT);

  const sastRows = (projectId: string, count: number) =>
    Array.from({ length: count }, (_, i) => ({
      id: randomUUID(),
      projectId,
      branch: 'main',
      currentState: 'to_verify',
      currentPriority: 'normal',
      currentSeverity: 'high',
      language: 'typescript',
      path: `src/f-${i}.ts`,
      vulnerableStartLine: i,
      vulnerableEndLine: i,
      scannerType: 'sast',
    }));

  const countOf = (projectId: string) =>
    ds.getRepository(SastVulnerabilityDetections).countBy({ projectId });

  it('deletes 2,500 detections of one project in batches of 1000, 1000, 500, then 0, and nothing of another project', async () => {
    const repo = ds.getRepository(SastVulnerabilityDetections);
    for (const [projectId, count] of [
      [P, 2500],
      [Q, 300],
    ] as const) {
      const rows = sastRows(projectId, count);
      for (let i = 0; i < rows.length; i += 500) {
        await repo.insert(rows.slice(i, i + 500));
      }
    }
    expect(PURGE_BATCH_SIZE).toBe(1000);

    // A deadline already passed: each call runs exactly one statement.
    const batches: Array<{ deleted: number; complete: boolean }> = [];
    for (let call = 0; call < 4; call += 1) {
      batches.push(
        await deleteInBatches(
          ds,
          'vulnerability_detections_sast',
          'projectId',
          P,
          0,
        ),
      );
    }

    expect(batches).toEqual([
      { deleted: 1000, complete: false },
      { deleted: 1000, complete: false },
      { deleted: 500, complete: true },
      { deleted: 0, complete: true },
    ]);
    expect(await countOf(P)).toBe(0);
    expect(await countOf(Q)).toBe(300);
  });

  it('within the call budget, deletes every batch in one call', async () => {
    const repo = ds.getRepository(SastVulnerabilityDetections);
    await repo.insert(sastRows(R, 450));

    await expect(
      deleteInBatches(
        ds,
        'vulnerability_detections_sast',
        'projectId',
        R,
        Date.now() + 60_000,
        200,
      ),
    ).resolves.toEqual({ deleted: 450, complete: true });
    expect(await countOf(R)).toBe(0);
    expect(await countOf(Q)).toBe(300);
  });

  it('matches the project as one item of a comma-separated scope, under the purge list condition, in batches', async () => {
    const entry = PROJECT_PURGE_TABLES.find(
      (t) => t.table === 'aggregated_reports',
    );
    expect(entry).toMatchObject({ column: 'scope_id', match: 'find_in_set' });

    const report = (
      scopeId: string,
      over: Partial<AggregatedReport> = {},
    ): Partial<AggregatedReport> => ({
      id: randomUUID(),
      scopeType: 'batch',
      scopeId,
      organizationId: null,
      reportType: 'owasp',
      ...over,
    });
    const purged = [
      report(P),
      report(`${Q},${P}`),
      report(`${P},${Q},${R}`),
      report(`${R},${P}`),
      report(`${Q},${P},${R}`),
    ];
    const kept = [
      // P as a prefix of another item, never as an item.
      report(`${P}x,${Q}`),
      report(Q),
      // Another scope type, or a batch an organization owns: not this purge.
      report(P, { scopeType: 'organization' }),
      report(P, { organizationId: 'org-1' }),
    ];
    const scopeOf = (r: Partial<AggregatedReport>) =>
      JSON.stringify([r.scopeType, r.scopeId, r.organizationId]);
    const keptScopes = kept.map(scopeOf).sort();
    // A multi-row insert on MySQL may hand each entity another row's id
    // (TypeORM re-selects without ORDER BY): the rows are compared by their
    // scope, never by id.
    await ds
      .createQueryBuilder()
      .insert()
      .into(AggregatedReport)
      .values([...purged, ...kept])
      .updateEntity(false)
      .execute();

    const batches: Array<{ deleted: number; complete: boolean }> = [];
    for (let call = 0; call < 4; call += 1) {
      batches.push(
        await deleteInBatches(
          ds,
          entry.table,
          entry.column,
          P,
          0,
          2,
          entry.where,
          entry.match,
        ),
      );
    }

    expect(batches).toEqual([
      { deleted: 2, complete: false },
      { deleted: 2, complete: false },
      { deleted: 1, complete: true },
      { deleted: 0, complete: true },
    ]);
    const left = await ds.getRepository(AggregatedReport).find();
    expect(left.map(scopeOf).sort()).toEqual(keptScopes);
  });
});
