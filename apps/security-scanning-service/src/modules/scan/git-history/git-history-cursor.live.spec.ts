import { Repository } from 'typeorm';
import type { GitHistoryPass } from '@grpc/security-scanning/scan';
import { GitHistoryCursor } from 'src/entities/git-history-cursor.entity';
import {
  createLiveDatabase,
  liveEnabled,
  LiveDatabase,
} from 'src/core/db/live-database';
import { GitHistoryCursorService } from './git-history-cursor.service';

/**
 * LIVE proof, on BOTH engines (`LIVE_DB_TYPE=mysql|postgres`, default mysql),
 * that the history cursor keeps one row per (project, branch): the schema
 * comes from the real migrations and `advance` upserts through TypeORM.
 *
 *   SS_GIT_HISTORY_CURSOR_LIVE=1 LIVE_DB_TYPE=postgres \
 *     SS_GIT_HISTORY_CURSOR_PG_URL=postgres://policyuser:policypassword@127.0.0.1:5433 \
 *     pnpm exec jest --testPathPatterns=git-history-cursor.live --runInBand
 */
const describeLive = liveEnabled('SS_GIT_HISTORY_CURSOR')
  ? describe
  : describe.skip;

const PROJECT = '11111111-1111-4111-8111-111111111111';
const KEY = 'github:o/r';

const pass = (over: Partial<GitHistoryPass>): GitHistoryPass => ({
  mode: 'full',
  tipSha: 'tip1',
  excludeShas: [],
  bytes: '1',
  firstPass: true,
  repositoryKey: KEY,
  oldestCommitAt: '2020-01-02T03:04:05Z',
  ...over,
});

describeLive('GitHistoryCursorService on a real database', () => {
  jest.setTimeout(180_000);
  let db: LiveDatabase;
  let repo: Repository<GitHistoryCursor>;
  let service: GitHistoryCursorService;

  beforeAll(async () => {
    db = await createLiveDatabase({
      prefix: 'git_history_cursor',
      envPrefix: 'SS_GIT_HISTORY_CURSOR',
    });
    repo = db.dataSource.getRepository(GitHistoryCursor);
    service = new GitHistoryCursorService(repo, null as never, {
      mode: () => 'incremental_artifact',
    });
  });

  afterAll(async () => {
    await db?.drop();
  });

  it('upserts one row per project and branch on both engines', async () => {
    expect(await service.advance(PROJECT, 'main', pass({}), 'ok')).toBe(true);
    expect(
      await service.advance(
        PROJECT,
        'main',
        pass({
          mode: 'incremental_with_gap',
          tipSha: 'tip2',
          baseTipSha: 'tip1',
          firstPass: false,
          gap: { fromSha: 'tip1', toSha: 'tip2' },
        }),
        'ok',
      ),
    ).toBe(true);
    // A stale base tip leaves the row alone.
    expect(
      await service.advance(
        PROJECT,
        'main',
        pass({ tipSha: 'tip3', baseTipSha: 'tip1', firstPass: false }),
        'ok',
      ),
    ).toBe(false);
    await service.advance(PROJECT, 'dev', pass({ tipSha: 'd1' }), 'ok');

    const rows = await repo.find({ where: { projectId: PROJECT } });
    expect(rows).toHaveLength(2);
    const main = rows.find((r) => r.branch === 'main')!;
    expect(main.tipSha).toBe('tip2');
    expect(main.complete).toBe(true);
    expect(main.gaps).toEqual([{ fromSha: 'tip1', toSha: 'tip2' }]);
    expect(main.coveredSince?.toISOString()).toBe('2020-01-02T03:04:05.000Z');

    const cursor = await service.getCursor(PROJECT, 'main', KEY);
    expect(cursor).toMatchObject({
      mode: 'incremental_artifact',
      tipSha: 'tip2',
      coverage: { complete: true, lastPassOutcome: 'ok' },
    });
  });

  it('two concurrent first passes: exactly one tip is stored', async () => {
    const results = await Promise.all([
      service.advance(PROJECT, 'race', pass({ tipSha: 'tipA' }), 'ok'),
      service.advance(PROJECT, 'race', pass({ tipSha: 'tipB' }), 'ok'),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const rows = await repo.find({
      where: { projectId: PROJECT, branch: 'race' },
    });
    expect(rows).toHaveLength(1);
    expect(['tipA', 'tipB']).toContain(rows[0].tipSha);
    const winner = results[0] ? 'tipA' : 'tipB';
    expect(rows[0].tipSha).toBe(winner);
  });
});
