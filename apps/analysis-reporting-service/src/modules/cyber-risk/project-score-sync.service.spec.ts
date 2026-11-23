import { of, throwError } from 'rxjs';
import { ProjectScoreSyncService } from './project-score-sync.service';

describe('ProjectScoreSyncService', () => {
  const makeClient = (impl?: any) => ({
    setProjectCyberRiskScores: jest.fn(impl ?? (() => of({ updated: 1 }))),
  });

  const build = (projectClient: any, query?: jest.Mock) => {
    const gm = { getService: jest.fn(() => projectClient) } as any;
    const dataSource = { query: query ?? jest.fn() } as any;
    const svc = new ProjectScoreSyncService(gm, dataSource);
    svc.onModuleInit();
    return { svc, gm, dataSource };
  };

  it('pushes a single score to global-management', async () => {
    const client = makeClient();
    const { svc } = build(client);

    await svc.pushScore('p1', 42);

    expect(client.setProjectCyberRiskScores).toHaveBeenCalledWith({
      items: [{ projectId: 'p1', score: 42 }],
    });
  });

  it('ignores an empty projectId without calling gRPC', async () => {
    const client = makeClient();
    const { svc } = build(client);

    await svc.pushScore('', 10);

    expect(client.setProjectCyberRiskScores).not.toHaveBeenCalled();
  });

  it('never throws when the gRPC push fails (best-effort)', async () => {
    const client = makeClient(() => throwError(() => new Error('gm down')));
    const { svc } = build(client);

    await expect(svc.pushScore('p1', 5)).resolves.toBeUndefined();
  });

  it('is a no-op when the ProjectService client cannot be resolved', async () => {
    const gm = {
      getService: jest.fn(() => {
        throw new Error('no service');
      }),
    } as any;
    const svc = new ProjectScoreSyncService(gm, { query: jest.fn() } as any);

    svc.onModuleInit(); // must swallow the resolution error

    await expect(svc.pushScore('p1', 1)).resolves.toBeUndefined();
  });

  describe('onApplicationBootstrap backfill', () => {
    it('pushes every persisted score read from project_cyber_risk', async () => {
      const client = makeClient();
      const query = jest.fn().mockResolvedValue([
        { projectId: 'p1', score: 10 },
        { projectId: 'p2', score: 20 },
      ]);
      const { svc } = build(client, query);

      await svc.onApplicationBootstrap();

      expect(query).toHaveBeenCalled();
      expect(client.setProjectCyberRiskScores).toHaveBeenCalledWith({
        items: [
          { projectId: 'p1', score: 10 },
          { projectId: 'p2', score: 20 },
        ],
      });
    });

    it('reads the camelCase alias quoted, so PostgreSQL does not fold it', async () => {
      const client = makeClient();
      const query = jest.fn().mockResolvedValue([]);
      const { svc } = build(client, query);

      await svc.onApplicationBootstrap();

      expect(query.mock.calls[0][0]).toBe(
        'SELECT project_id AS `projectId`, score FROM project_cyber_risk',
      );
    });

    it('does nothing when the table is empty', async () => {
      const client = makeClient();
      const query = jest.fn().mockResolvedValue([]);
      const { svc } = build(client, query);

      await svc.onApplicationBootstrap();

      expect(client.setProjectCyberRiskScores).not.toHaveBeenCalled();
    });

    it('never throws if the backfill query fails', async () => {
      const client = makeClient();
      const query = jest.fn().mockRejectedValue(new Error('db down'));
      const { svc } = build(client, query);

      await expect(svc.onApplicationBootstrap()).resolves.toBeUndefined();
    });
  });

  // Every worker that boots ran the backfill, several at
  // once on a rollout or a scale-up. One of them runs it, under a Redis lock
  // taken with SET NX PX and released with its own token.
  describe('onApplicationBootstrap backfill lock', () => {
    /** A Redis double with SET NX PX and the compare-and-delete script. */
    const fakeRedis = (held?: string) => {
      const keys = new Map<string, string>(held ? [[LOCK_KEY, held]] : []);
      return {
        keys,
        set: jest.fn(async (key: string, value: string, ...args: unknown[]) => {
          if (args.includes('NX') && keys.has(key)) return null;
          keys.set(key, value);
          return 'OK';
        }),
        eval: jest.fn(
          async (_script: string, _n: number, key: string, token: string) => {
            if (keys.get(key) !== token) return 0;
            keys.delete(key);
            return 1;
          },
        ),
      };
    };
    const LOCK_KEY = ProjectScoreSyncService.BACKFILL_LOCK_KEY;
    const withLock = (redis: unknown, query: jest.Mock) => {
      const client = makeClient();
      const gm = { getService: jest.fn(() => client) } as any;
      const queue = { client: Promise.resolve(redis) } as any;
      const svc = new ProjectScoreSyncService(gm, { query } as any, queue);
      svc.onModuleInit();
      return { svc, client };
    };
    const rows = () =>
      jest.fn().mockResolvedValue([{ projectId: 'p1', score: 10 }]);

    it('takes the lock with SET NX PX, pushes, then releases it with its token', async () => {
      const redis = fakeRedis();
      const { svc, client } = withLock(redis, rows());

      await svc.onApplicationBootstrap();

      expect(redis.set).toHaveBeenCalledWith(
        LOCK_KEY,
        expect.any(String),
        'PX',
        ProjectScoreSyncService.BACKFILL_LOCK_TTL_MS,
        'NX',
      );
      const token = redis.set.mock.calls[0][1];
      expect(client.setProjectCyberRiskScores).toHaveBeenCalledTimes(1);
      expect(redis.eval).toHaveBeenCalledWith(
        expect.stringContaining("redis.call('DEL', KEYS[1])"),
        1,
        LOCK_KEY,
        token,
      );
      expect(redis.keys.has(LOCK_KEY)).toBe(false);
    });

    it('skips the backfill while another worker holds the lock, and leaves its lock alone', async () => {
      const redis = fakeRedis('another-worker');
      const query = rows();
      const { svc, client } = withLock(redis, query);

      await svc.onApplicationBootstrap();

      expect(query).not.toHaveBeenCalled();
      expect(client.setProjectCyberRiskScores).not.toHaveBeenCalled();
      expect(redis.eval).not.toHaveBeenCalled();
      expect(redis.keys.get(LOCK_KEY)).toBe('another-worker');
    });

    it('releases the lock when the backfill fails', async () => {
      const redis = fakeRedis();
      const { svc } = withLock(
        redis,
        jest.fn().mockRejectedValue(new Error('db down')),
      );

      await expect(svc.onApplicationBootstrap()).resolves.toBeUndefined();

      expect(redis.eval).toHaveBeenCalledTimes(1);
      expect(redis.keys.has(LOCK_KEY)).toBe(false);
    });

    // An unreachable Redis makes the BullMQ connection wait, it does not
    // reject: only an error answered by Redis gets here.
    it('still runs the backfill when the lock command fails, as before the lock', async () => {
      const redis = {
        set: jest
          .fn()
          .mockRejectedValue(
            new Error("READONLY You can't write against a read only replica."),
          ),
        eval: jest.fn(),
      };
      const { svc, client } = withLock(redis, rows());

      await svc.onApplicationBootstrap();

      expect(client.setProjectCyberRiskScores).toHaveBeenCalledTimes(1);
      expect(redis.eval).not.toHaveBeenCalled();
    });
  });
});
