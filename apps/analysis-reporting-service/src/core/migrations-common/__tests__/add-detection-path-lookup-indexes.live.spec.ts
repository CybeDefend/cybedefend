import { randomUUID } from 'node:crypto';
import type { ObjectLiteral, Repository } from 'typeorm';
import { parseDialect } from '@cybedefend/db-dialect';
import { createLiveDatabase, type LiveDatabase } from '../../db/live-database';
import { SastVulnerabilityDetections } from '../../../entities/sast-vulnerability-detections.entity';
import { IacVulnerabilityDetections } from '../../../entities/iac-vulnerability-detections.entity';
import { CicdVulnerabilityDetections } from '../../../entities/cicd-vulnerability-detections.entity';
import { SecretVulnerabilityDetections } from '../../../entities/secret-vulnerability-detections.entity';
import { AddDetectionPathLookupIndexes1846100000000 } from '../1846100000000-AddDetectionPathLookupIndexes';

/**
 * LIVE spec of the common migration 1846100000000, on the engine
 * LIVE_DB_TYPE selects:
 *
 *   AR_PATH_LOOKUP_INDEX_LIVE=1 LIVE_DB_TYPE=mysql \
 *     AR_PATH_LOOKUP_INDEX_MYSQL_URL=mysql://root:password@127.0.0.1:13308 \
 *     pnpm exec jest --ci --runInBand src/core/migrations-common/__tests__/add-detection-path-lookup-indexes.live.spec.ts
 *   AR_PATH_LOOKUP_INDEX_LIVE=1 LIVE_DB_TYPE=postgres \
 *     AR_PATH_LOOKUP_INDEX_PG_URL=postgres://postgres:postgres@127.0.0.1:15432 \
 *     pnpm exec jest --ci --runInBand src/core/migrations-common/__tests__/add-detection-path-lookup-indexes.live.spec.ts
 *
 * The schema is built by the dialect's tracks (the migration runs there), then
 * the spec checks: each of the four tables has the index on
 * (projectId, branch, path); the duplicate lookup of
 * `lookupThenCreateDetection` (project, scanner, path, language, lines,
 * branch) is planned on it once a branch holds thousands of rows; `down`
 * removes the four indexes; `up` is idempotent.
 */
const LIVE = process.env.AR_PATH_LOOKUP_INDEX_LIVE === '1';
const describeLive = LIVE ? describe : describe.skip;

const TABLES = [
  ['vulnerability_detections_sast', 'IDX_vd_sast_proj_branch_path'],
  ['vulnerability_detections_iac', 'IDX_vd_iac_proj_branch_path'],
  ['vulnerability_detections_cicd', 'IDX_vd_cicd_proj_branch_path'],
  ['vulnerability_detections_secret', 'IDX_vd_secret_proj_branch_path'],
] as const;

const ENTITIES = {
  vulnerability_detections_sast: SastVulnerabilityDetections,
  vulnerability_detections_iac: IacVulnerabilityDetections,
  vulnerability_detections_cicd: CicdVulnerabilityDetections,
  vulnerability_detections_secret: SecretVulnerabilityDetections,
} as const;

/** Rows on one (project, branch), the shape of a large import. */
const ROWS = 3_000;

describeLive('AddDetectionPathLookupIndexes on a real database', () => {
  jest.setTimeout(240_000);
  const HOOK_TIMEOUT = 240_000;
  const dialect = parseDialect(process.env.LIVE_DB_TYPE);
  let live: LiveDatabase;

  beforeAll(async () => {
    live = await createLiveDatabase({
      prefix: 'ar_path_idx',
      envPrefix: 'AR_PATH_LOOKUP_INDEX',
      dialect,
      migrations: 'track',
    });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await live?.drop();
  }, HOOK_TIMEOUT);

  /**
   * The index names of `table` and their columns in KEY order, read from
   * the catalogs (TypeORM's getTable lists them in table order on
   * PostgreSQL).
   */
  const indexesOf = async (table: string) => {
    const rows: Array<{ name: string; col: string }> =
      dialect === 'postgres'
        ? await live.dataSource.query(
            `SELECT c.relname AS name, a.attname AS col
                 FROM pg_index i
                 JOIN pg_class c ON c.oid = i.indexrelid
                 JOIN pg_class t ON t.oid = i.indrelid
                 JOIN unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
                 JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
                WHERE t.relname = $1
                ORDER BY c.relname, k.ord`,
            [table],
          )
        : await live.dataSource.query(
            `SELECT INDEX_NAME AS name, COLUMN_NAME AS col
                 FROM INFORMATION_SCHEMA.STATISTICS
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
                ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
            [table],
          );
    const indexes = new Map<string, string[]>();
    for (const { name, col } of rows) {
      indexes.set(name, [...(indexes.get(name) ?? []), col]);
    }
    return indexes;
  };

  it.each(TABLES)(
    '%s has %s on (projectId, branch, path) after the tracks ran',
    async (table, index) => {
      const indexes = await indexesOf(table);
      expect(indexes.get(index)).toEqual(['projectId', 'branch', 'path']);
    },
  );

  it.each(TABLES)(
    'the duplicate lookup on %s is planned on %s',
    async (table, index) => {
      const repo = live.dataSource.getRepository(
        ENTITIES[table],
      ) as unknown as Repository<ObjectLiteral>;
      const projectId = randomUUID();
      const rows = Array.from({ length: ROWS }, (_, n) => ({
        id: randomUUID(),
        projectId,
        branch: 'main',
        path: `src/f${n}.js`,
        language: 'generic',
        vulnerableStartLine: 1,
        vulnerableEndLine: 1,
        scannerType: 'gentool',
        currentState: 'to_verify',
        currentSeverity: 'high',
        currentPriority: 'high',
        fingerprint: randomUUID().replace(/-/g, ''),
      }));
      for (let i = 0; i < rows.length; i += 500) {
        await repo
          .createQueryBuilder()
          .insert()
          .values(rows.slice(i, i + 500))
          .updateEntity(false)
          .execute();
      }
      // Fresh statistics, so the plan is the one a large branch gets.
      await live.dataSource.query(
        dialect === 'postgres'
          ? `ANALYZE "${table}"`
          : `ANALYZE TABLE ${table}`,
      );

      // The WHERE clause lookupThenCreateDetection's find() builds.
      const [query, parameters] = repo
        .createQueryBuilder('d')
        .select('d.id')
        .where({
          projectId,
          scannerType: 'gentool',
          path: 'src/f1234.js',
          language: 'generic',
          vulnerableStartLine: 1,
          vulnerableEndLine: 1,
          branch: 'main',
        })
        .getQueryAndParameters();
      const plan = JSON.stringify(
        await live.dataSource.query(`EXPLAIN ${query}`, parameters),
      );
      expect(plan).toContain(index);
    },
  );

  it('on MySQL, path is indexed on 255 characters only where the column is longer', async () => {
    if (dialect !== 'mysql') return;
    const rows: Array<{ t: string; sub: number | null; len: number }> =
      await live.dataSource.query(
        `SELECT s.TABLE_NAME AS t, s.SUB_PART AS sub, c.CHARACTER_MAXIMUM_LENGTH AS len
             FROM INFORMATION_SCHEMA.STATISTICS s
             JOIN INFORMATION_SCHEMA.COLUMNS c
               ON c.TABLE_SCHEMA = s.TABLE_SCHEMA AND c.TABLE_NAME = s.TABLE_NAME
              AND c.COLUMN_NAME = s.COLUMN_NAME
            WHERE s.TABLE_SCHEMA = DATABASE() AND s.COLUMN_NAME = 'path'
              AND s.INDEX_NAME LIKE 'IDX_vd_%_proj_branch_path'
            ORDER BY s.TABLE_NAME`,
      );
    expect(
      rows.map((r) => [
        r.t,
        Number(r.len),
        r.sub === null ? null : Number(r.sub),
      ]),
    ).toEqual([
      ['vulnerability_detections_cicd', 1024, 255],
      ['vulnerability_detections_iac', 255, null],
      ['vulnerability_detections_sast', 255, null],
      ['vulnerability_detections_secret', 1024, 255],
    ]);
  });

  it.each([
    'vulnerability_detections_cicd',
    'vulnerability_detections_secret',
  ] as const)(
    'a 1,024-character path is still accepted on %s',
    async (table) => {
      const repo = live.dataSource.getRepository(
        ENTITIES[table],
      ) as unknown as Repository<ObjectLiteral>;
      const projectId = randomUUID();
      await repo
        .createQueryBuilder()
        .insert()
        .values({
          id: randomUUID(),
          projectId,
          branch: 'b'.repeat(255),
          path: `src/${'p'.repeat(1020)}`,
          language: 'generic',
          vulnerableStartLine: 1,
          vulnerableEndLine: 1,
          scannerType: 'gentool',
          currentState: 'to_verify',
          currentSeverity: 'high',
          currentPriority: 'high',
        })
        .updateEntity(false)
        .execute();
      expect(await repo.count({ where: { projectId } })).toBe(1);
    },
  );

  it('down removes the four indexes, up is idempotent and puts them back', async () => {
    const migration = new AddDetectionPathLookupIndexes1846100000000();
    const runner = live.dataSource.createQueryRunner();
    try {
      await migration.down(runner);
      for (const [table, index] of TABLES) {
        expect((await indexesOf(table)).has(index)).toBe(false);
      }
      // down again: nothing to drop, no error.
      await migration.down(runner);

      await migration.up(runner);
      await migration.up(runner);
      for (const [table, index] of TABLES) {
        expect((await indexesOf(table)).get(index)).toEqual([
          'projectId',
          'branch',
          'path',
        ]);
      }
    } finally {
      await runner.release();
    }
  });
});
