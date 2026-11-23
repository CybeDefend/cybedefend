import Redis from 'ioredis';
import { Observable } from 'rxjs';
import { ProjectScoreSyncService } from './project-score-sync.service';

/**
 * LIVE spec for the CybeRisk score sync backfill lock against a
 * REAL Redis: workers booting together run the backfill once, through the real
 * SET NX PX and the real compare-and-delete script.
 *
 * It is skipped unless `SCORE_SYNC_LOCK_REDIS_LIVE=1`, so `pnpm run test`
 * stays hermetic.
 *
 * How to run, against a throwaway Redis that persists nothing:
 *   redis-server --port 16379 --save '' --appendonly no --daemonize yes
 *   SCORE_SYNC_LOCK_REDIS_LIVE=1 pnpm exec jest --testPathPatterns=score-sync.lock.live --runInBand
 *   redis-cli -p 16379 shutdown nosave
 * `REDIS_LIVE_URL` overrides the default `redis://127.0.0.1:16379` (pick an
 * unused database index on a shared Redis: the lock key is the real one).
 */
const LIVE = process.env.SCORE_SYNC_LOCK_REDIS_LIVE === '1';
const describeLive = LIVE ? describe : describe.skip;
const REDIS_URL = process.env.REDIS_LIVE_URL ?? 'redis://127.0.0.1:16379';
const KEY = ProjectScoreSyncService.BACKFILL_LOCK_KEY;

describeLive('ProjectScoreSyncService backfill lock on a real Redis', () => {
  jest.setTimeout(30_000);

  let redis: Redis;
  let pushes: number;

  /** One booting worker: its own Redis connection, a GM push taking 200 ms. */
  const worker = () => {
    const connection = new Redis(REDIS_URL);
    const gm = {
      getService: () => ({
        setProjectCyberRiskScores: () =>
          new Observable((subscriber) => {
            pushes += 1;
            setTimeout(() => {
              subscriber.next({ updated: 1 });
              subscriber.complete();
            }, 200);
          }),
      }),
    };
    const dataSource = {
      query: async () => [{ projectId: 'p1', score: 3 }],
    };
    const service = new ProjectScoreSyncService(
      gm as never,
      dataSource as never,
      { client: Promise.resolve(connection) } as never,
    );
    service.onModuleInit();
    return { service, connection };
  };

  beforeAll(() => {
    redis = new Redis(REDIS_URL);
  });

  beforeEach(async () => {
    pushes = 0;
    await redis.del(KEY);
  });

  afterAll(async () => {
    await redis.del(KEY);
    await redis.quit();
  });

  it('three workers booting together run the backfill once, and free the lock', async () => {
    const workers = [worker(), worker(), worker()];
    try {
      await Promise.all(workers.map((w) => w.service.onApplicationBootstrap()));

      expect(pushes).toBe(1);
      expect(await redis.exists(KEY)).toBe(0);

      // Released: the next boot runs it again.
      await workers[0].service.onApplicationBootstrap();
      expect(pushes).toBe(2);
    } finally {
      for (const w of workers) await w.connection.quit();
    }
  });

  it('a lock left by a dead worker is skipped, never deleted, and expires', async () => {
    await redis.set(KEY, 'dead-worker', 'PX', 300);
    const { service, connection } = worker();
    try {
      await service.onApplicationBootstrap();
      expect(pushes).toBe(0);
      expect(await redis.get(KEY)).toBe('dead-worker');

      await new Promise((resolve) => setTimeout(resolve, 400));
      await service.onApplicationBootstrap();
      expect(pushes).toBe(1);
      expect(await redis.exists(KEY)).toBe(0);
    } finally {
      await connection.quit();
    }
  });

  it('the lock carries the TTL of a crashed holder', async () => {
    const { service, connection } = worker();
    try {
      const run = service.onApplicationBootstrap();
      // While the push runs, the lock is held with its TTL.
      await new Promise((resolve) => setTimeout(resolve, 50));
      const ttl = await redis.pttl(KEY);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(
        ProjectScoreSyncService.BACKFILL_LOCK_TTL_MS,
      );
      await run;
    } finally {
      await connection.quit();
    }
  });
});
