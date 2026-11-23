import { status } from '@grpc/grpc-js';
import type { ClientGrpc } from '@nestjs/microservices';
import { Logger } from '@nestjs/common';
import { NEVER, Observable, of, throwError } from 'rxjs';
import { CLUSTER_SCAN_SERVICE_NAME } from '@grpc/security-scanning/security_scanning';
import type { GetScanCapabilitiesResponse } from '@grpc/security-scanning/scan';
import {
  SCAN_CAPABILITY_DEADLINE_MS,
  SCAN_CAPABILITY_REFRESH_MS,
  SCAN_CAPABILITY_STALE_MS,
  ScanCapabilityCache,
} from './scan-capability.cache';

type Answer = () => Observable<GetScanCapabilitiesResponse>;

function cacheAnswering(answers: Answer[]): {
  cache: ScanCapabilityCache;
  calls: () => number;
  services: string[];
} {
  let count = 0;
  const services: string[] = [];
  const client = {
    getService: (name: string) => {
      services.push(name);
      return {
        getScanCapabilities: () => {
          const answer = answers[Math.min(count, answers.length - 1)];
          count += 1;
          return answer();
        },
      };
    },
  } as unknown as ClientGrpc;
  const cache = new ScanCapabilityCache(client);
  cache.onModuleInit();
  return { cache, calls: () => count, services };
}

const yes: Answer = () => of({ clusterScans: true });
const no: Answer = () => of({ clusterScans: false });
const down: Answer = () =>
  throwError(() =>
    Object.assign(new Error('14 UNAVAILABLE: no connection'), {
      code: status.UNAVAILABLE,
    }),
  );
const unimplemented: Answer = () =>
  throwError(() =>
    Object.assign(new Error('12 UNIMPLEMENTED'), {
      code: status.UNIMPLEMENTED,
    }),
  );
const silent: Answer = () => NEVER;

/** Lets the pending promise callbacks of a refresh run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve();
  }
}

describe('ScanCapabilityCache', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-04T10:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('asks ClusterScanService, not ScanService', () => {
    const { services } = cacheAnswering([yes]);
    expect(services).toEqual([CLUSTER_SCAN_SERVICE_NAME]);
    expect(CLUSTER_SCAN_SERVICE_NAME).toBe('ClusterScanService');
  });

  it('knows nothing before its first answer', () => {
    const { cache, calls } = cacheAnswering([yes]);
    expect(cache.current()).toBeNull();
    expect(calls()).toBe(0);
  });

  it('reads the answer at bootstrap', async () => {
    const yesCache = cacheAnswering([yes]);
    await yesCache.cache.onApplicationBootstrap();
    expect(yesCache.cache.current()).toBe(true);
    yesCache.cache.onModuleDestroy();

    const noCache = cacheAnswering([no]);
    await noCache.cache.onApplicationBootstrap();
    expect(noCache.cache.current()).toBe(false);
    noCache.cache.onModuleDestroy();
  });

  it('refreshes every 60 s', async () => {
    const { cache, calls } = cacheAnswering([no, yes]);
    await cache.onApplicationBootstrap();
    expect(SCAN_CAPABILITY_REFRESH_MS).toBe(60_000);
    expect(calls()).toBe(1);
    expect(cache.current()).toBe(false);

    await jest.advanceTimersByTimeAsync(59_999);
    expect(calls()).toBe(1);
    await jest.advanceTimersByTimeAsync(1);
    await settle();
    expect(calls()).toBe(2);
    expect(cache.current()).toBe(true);

    await jest.advanceTimersByTimeAsync(60_000);
    await settle();
    expect(calls()).toBe(3);
    cache.onModuleDestroy();
  });

  it('stops refreshing once the module is destroyed', async () => {
    const { cache, calls } = cacheAnswering([yes]);
    await cache.onApplicationBootstrap();
    cache.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(5 * 60_000);
    expect(calls()).toBe(1);
  });

  it('keeps the last answer 5 min on failure, then null', async () => {
    const { cache, calls } = cacheAnswering([yes, down]);
    await cache.onApplicationBootstrap();
    expect(cache.current()).toBe(true);
    expect(SCAN_CAPABILITY_STALE_MS).toBe(5 * 60_000);

    // Four failed refreshes (at 1, 2, 3 and 4 min): still the last answer.
    await jest.advanceTimersByTimeAsync(4 * 60_000);
    await settle();
    expect(calls()).toBe(5);
    expect(cache.current()).toBe(true);

    // 5 min after the last answer: no longer trusted.
    await jest.advanceTimersByTimeAsync(60_000);
    await settle();
    expect(cache.current()).toBeNull();
    cache.onModuleDestroy();
  });

  it('a failure before any answer stays null', async () => {
    const { cache } = cacheAnswering([down]);
    await expect(cache.onApplicationBootstrap()).resolves.toBeUndefined();
    expect(cache.current()).toBeNull();
    cache.onModuleDestroy();
  });

  it('a new answer after failures is trusted again', async () => {
    const { cache } = cacheAnswering([
      yes,
      down,
      down,
      down,
      down,
      down,
      down,
      no,
    ]);
    await cache.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(6 * 60_000);
    await settle();
    expect(cache.current()).toBeNull();
    await jest.advanceTimersByTimeAsync(60_000);
    await settle();
    expect(cache.current()).toBe(false);
    cache.onModuleDestroy();
  });

  it('an UNIMPLEMENTED answer means no cluster, never a failure', async () => {
    const { cache } = cacheAnswering([yes, unimplemented]);
    await cache.onApplicationBootstrap();
    expect(cache.current()).toBe(true);
    await jest.advanceTimersByTimeAsync(60_000);
    await settle();
    expect(cache.current()).toBe(false);
    // Still an answer 10 min later, not a stale one.
    await jest.advanceTimersByTimeAsync(10 * 60_000);
    await settle();
    expect(cache.current()).toBe(false);
    cache.onModuleDestroy();
  });

  it('gives up on a call after 2 s and keeps the last answer', async () => {
    const { cache } = cacheAnswering([yes, silent]);
    await cache.onApplicationBootstrap();
    expect(SCAN_CAPABILITY_DEADLINE_MS).toBe(2_000);

    await jest.advanceTimersByTimeAsync(60_000);
    let done = false;
    const refresh = cache.refresh().then(() => {
      done = true;
    });
    await jest.advanceTimersByTimeAsync(1_999);
    expect(done).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    await refresh;
    expect(done).toBe(true);
    expect(cache.current()).toBe(true);
    cache.onModuleDestroy();
  });

  it('a bootstrap whose call never answers still boots within 2 s', async () => {
    const { cache } = cacheAnswering([silent]);
    let booted = false;
    const boot = cache.onApplicationBootstrap().then(() => {
      booted = true;
    });
    await jest.advanceTimersByTimeAsync(2_000);
    await boot;
    expect(booted).toBe(true);
    expect(cache.current()).toBeNull();
    cache.onModuleDestroy();
  });

  describe('the failure log', () => {
    let warn: jest.SpyInstance;

    beforeEach(() => {
      warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
      warn.mockRestore();
    });

    it('names the gRPC code of a failed call', async () => {
      const { cache } = cacheAnswering([down]);
      await cache.onApplicationBootstrap();
      cache.onModuleDestroy();
      expect(warn.mock.calls.map((c) => c[0])).toEqual([
        `SCAN_CAPABILITY_UNREADABLE code=${status.UNAVAILABLE}`,
      ]);
    });

    it('says deadline only for a call past its 2 s', async () => {
      const { cache } = cacheAnswering([silent]);
      const boot = cache.onApplicationBootstrap();
      await jest.advanceTimersByTimeAsync(2_000);
      await boot;
      cache.onModuleDestroy();
      expect(warn.mock.calls.map((c) => c[0])).toEqual([
        'SCAN_CAPABILITY_UNREADABLE code=deadline',
      ]);
    });

    it('says unknown for any other error without a code', async () => {
      const { cache } = cacheAnswering([
        () => throwError(() => new Error('socket hang up')),
      ]);
      await cache.onApplicationBootstrap();
      cache.onModuleDestroy();
      expect(warn.mock.calls.map((c) => c[0])).toEqual([
        'SCAN_CAPABILITY_UNREADABLE code=unknown',
      ]);
    });
  });
});
