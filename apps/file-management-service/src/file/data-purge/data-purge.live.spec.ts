import { ident, run, sql } from '@cybedefend/db-dialect';
import { FileScan, FileStatus } from '../../entities/file.entity';
import {
  createLiveDatabase,
  liveEnabled,
  LiveDatabase,
} from '../../core/db/live-database';
import { DataPurgeService } from './data-purge.service';
import { StoragePurge } from './storage-purge';

/**
 * LIVE spec: only a real database proves that the bounded
 * `DELETE … LIMIT 1000` batches work on both engines (`deleteBatch` renders
 * `ctid IN (SELECT … LIMIT n)` on PostgreSQL) and that `run(...).affected`
 * reports the matched rows on both.
 *
 * Skipped unless FM_PURGE_LIVE=1 (or the legacy FM_PURGE_MYSQL_LIVE=1, which
 * means LIVE_DB_TYPE=mysql). Runs once per engine:
 *   FM_PURGE_LIVE=1 LIVE_DB_TYPE=postgres FM_PURGE_PG_URL=postgres://… \
 *     pnpm exec jest data-purge.live --runInBand
 * It creates, then drops, its own throwaway database.
 */
const describeLive = liveEnabled('FM_PURGE') ? describe : describe.skip;

const PROJECT = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const ORG = '33333333-3333-4333-8333-333333333333';
const FAR = () => Date.now() + 60_000;

describeLive('FM data purge on a live database', () => {
  jest.setTimeout(300_000);

  let db: LiveDatabase;
  let service: DataPurgeService;

  beforeAll(async () => {
    db = await createLiveDatabase({
      prefix: 'fm_purge',
      envPrefix: 'FM_PURGE',
    });
    const storage = {
      purgePrefix: async () => ({ deleted: 0, complete: true }),
    } as unknown as StoragePurge;
    const logger = {
      error: jest.fn(),
      warn: jest.fn(),
      log: jest.fn(),
    } as never;
    service = new DataPurgeService(db.dataSource, storage, logger);
  });

  afterAll(async () => {
    await db?.drop();
  });

  async function seed(projectId: string, n: number): Promise<void> {
    const repo = db.dataSource.getRepository(FileScan);
    for (let start = 0; start < n; start += 500) {
      const rows = Array.from({ length: Math.min(500, n - start) }, (_, i) => ({
        scanId: `scan-${start + i}`,
        fileName: `f-${start + i}.sarif`,
        typeScan: 'sast',
        projectId,
        status: FileStatus.PROCESSED,
      }));
      await repo.insert(rows);
    }
  }

  async function count(projectId: string): Promise<number> {
    const { rows } = await run(
      db.dataSource,
      sql`SELECT COUNT(*) AS cnt FROM ${ident('file_scan')} WHERE ${ident('projectId')} = ${projectId}`,
    );
    return Number(rows[0].cnt);
  }

  const deleteStatements = () =>
    db.statements.filter((s) => /^\s*DELETE FROM/i.test(s));

  it('purges in batches of 1000 and reports the count (2 500 rows: 1000, 1000, 500, then 0)', async () => {
    await seed(PROJECT, 2_500);
    expect(await count(PROJECT)).toBe(2_500);

    db.statements.length = 0;
    const res = await service.purgeProject(PROJECT, ORG, FAR());

    expect(res.complete).toBe(true);
    expect(res.deleted.file_scan).toBe(2_500);
    // 1000 + 1000 + 500: the short third batch ends the loop.
    expect(deleteStatements()).toHaveLength(3);
    expect(await count(PROJECT)).toBe(0);

    // Idempotent: a second call finds nothing left and issues one empty batch.
    db.statements.length = 0;
    const again = await service.purgeProject(PROJECT, ORG, FAR());
    expect(again.complete).toBe(true);
    expect(again.deleted.file_scan).toBe(0);
    expect(deleteStatements()).toHaveLength(1);
  });

  it('leaves other projects untouched', async () => {
    await seed(OTHER, 5);
    const res = await service.purgeProject(PROJECT, ORG, FAR());
    expect(res.complete).toBe(true);
    expect(await count(OTHER)).toBe(5);
    expect(await count(PROJECT)).toBe(0);
  });
});
