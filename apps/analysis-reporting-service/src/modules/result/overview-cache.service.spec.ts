import { Test, TestingModule } from '@nestjs/testing';
import { OverviewCacheService } from './overview-cache.service';
import { ScanQueueService } from '../scan-queue/scan-queue.service';

describe('OverviewCacheService', () => {
  let service: OverviewCacheService;
  let store: Map<string, string>;
  let redis: {
    get: jest.Mock;
    set: jest.Mock;
    incr: jest.Mock;
    expire: jest.Mock;
    eval: jest.Mock;
  };

  beforeEach(async () => {
    store = new Map();
    redis = {
      get: jest.fn((k: string) => Promise.resolve(store.get(k) ?? null)),
      set: jest.fn((k: string, v: string) => {
        store.set(k, v);
        return Promise.resolve('OK');
      }),
      incr: jest.fn((k: string) => {
        const next = Number(store.get(k) ?? '0') + 1;
        store.set(k, String(next));
        return Promise.resolve(next);
      }),
      expire: jest.fn().mockResolvedValue(1),
      // Emulates the INCR+EXPIRE Lua script: bumps the generation key in one shot.
      eval: jest.fn((_script: string, _numKeys: number, key: string) => {
        const next = Number(store.get(key) ?? '0') + 1;
        store.set(key, String(next));
        return Promise.resolve(next);
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OverviewCacheService,
        {
          provide: ScanQueueService,
          useValue: { getRedisClient: jest.fn().mockResolvedValue(redis) },
        },
      ],
    }).compile();

    service = module.get(OverviewCacheService);
  });

  it('computes the producer on a miss, then serves from cache on a hit', async () => {
    const producer = jest
      .fn()
      .mockResolvedValue([{ severity: 'CRITICAL', count: 3 }]);

    const first = await service.getOrSet(
      'sev',
      'org-1',
      'user-1',
      { branches: ['main'] },
      producer,
    );
    const second = await service.getOrSet(
      'sev',
      'org-1',
      'user-1',
      { branches: ['main'] },
      producer,
    );

    expect(first).toEqual([{ severity: 'CRITICAL', count: 3 }]);
    expect(second).toEqual([{ severity: 'CRITICAL', count: 3 }]);
    expect(producer).toHaveBeenCalledTimes(1); // second call hit the cache
  });

  it('different users never share a cache entry', async () => {
    const p1 = jest.fn().mockResolvedValue([{ severity: 'HIGH', count: 1 }]);
    const p2 = jest.fn().mockResolvedValue([{ severity: 'HIGH', count: 9 }]);

    await service.getOrSet('sev', 'org-1', 'user-A', {}, p1);
    const forB = await service.getOrSet('sev', 'org-1', 'user-B', {}, p2);

    expect(p2).toHaveBeenCalledTimes(1);
    expect(forB).toEqual([{ severity: 'HIGH', count: 9 }]);
  });

  it('bumpGeneration invalidates: a subsequent call recomputes', async () => {
    const producer = jest
      .fn()
      .mockResolvedValueOnce([{ severity: 'LOW', count: 1 }])
      .mockResolvedValueOnce([{ severity: 'LOW', count: 2 }]);

    await service.getOrSet('sev', 'org-1', 'user-1', {}, producer);
    await service.bumpGeneration('org-1');
    const after = await service.getOrSet(
      'sev',
      'org-1',
      'user-1',
      {},
      producer,
    );

    expect(producer).toHaveBeenCalledTimes(2);
    expect(after).toEqual([{ severity: 'LOW', count: 2 }]);
  });

  it('bumps the generation atomically (single eval, no separate INCR+EXPIRE)', async () => {
    await service.bumpGeneration('org-1');

    // One atomic round-trip carrying both the key and the TTL — never a
    // standalone INCR that could be left without an EXPIRE.
    expect(redis.eval).toHaveBeenCalledTimes(1);
    const [, numKeys, key, ttl] = redis.eval.mock.calls[0];
    expect(numKeys).toBe(1);
    expect(key).toBe('ovw:gen:org-1');
    expect(Number(ttl)).toBeGreaterThan(0);
    expect(redis.incr).not.toHaveBeenCalled();
    expect(redis.expire).not.toHaveBeenCalled();
  });
});
