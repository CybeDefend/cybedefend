import { randomUUID } from 'crypto';
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import Redis from 'ioredis';
import { ScanQueueService } from './scan-queue.service';
import { QUEUE_NAMES } from './queue-names';

/**
 * LIVE spec for the detection creation lock against a REAL Redis.
 * `scan-queue.service.spec.ts` emulates the release script in its Redis mock;
 * this spec runs the script itself, and the SET NX PX the acquisition relies
 * on, from two service instances as two worker pods would.
 *
 * It is skipped unless `DETECTION_LOCK_REDIS_LIVE=1`, so `pnpm run test`
 * stays hermetic.
 *
 * How to run, against a throwaway Redis that persists nothing:
 *   redis-server --port 16379 --save '' --appendonly no --daemonize yes
 *   DETECTION_LOCK_REDIS_LIVE=1 pnpm exec jest --testPathPatterns=detection-lock.live --runInBand
 *   redis-cli -p 16379 shutdown nosave
 * `REDIS_LIVE_URL` overrides the default `redis://127.0.0.1:16379`. Every key
 * is random, under `sast-iac:detection-lock:live-`.
 */
const LIVE = process.env.DETECTION_LOCK_REDIS_LIVE === '1';
const describeLive = LIVE ? describe : describe.skip;
const REDIS_URL = process.env.REDIS_LIVE_URL ?? 'redis://127.0.0.1:16379';

describeLive(
  'ScanQueueService – detection creation lock on a real Redis',
  () => {
    jest.setTimeout(30_000);

    let redis: Redis;
    let pods: ScanQueueService[];

    /** A ScanQueueService with its own Redis connection, like one worker pod. */
    const pod = async (): Promise<ScanQueueService> => {
      const moduleRef = await Test.createTestingModule({
        providers: [
          ScanQueueService,
          ...Object.values(QUEUE_NAMES).map((name) => ({
            provide: getQueueToken(name),
            useValue: { client: Promise.resolve(redis) },
          })),
        ],
      }).compile();
      const service = moduleRef.get(ScanQueueService);
      await service.onModuleInit();
      return service;
    };

    const newKey = () => `sast-iac:detection-lock:live-${randomUUID()}`;

    beforeAll(async () => {
      redis = new Redis(REDIS_URL);
      pods = [await pod(), await pod()];
    });

    afterAll(async () => {
      for (const service of pods) await (await service.getRedisClient()).quit();
      await redis.quit();
    });

    it('holds the key with the TTL, and releases it only for the holder token', async () => {
      const key = newKey();
      const token = await pods[0].acquireDetectionCreationLock(key);

      expect(await redis.get(key)).toBe(token);
      const ttl = await redis.pttl(key);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(
        ScanQueueService.DETECTION_CREATION_LOCK_TTL_MS,
      );

      await expect(
        pods[1].releaseDetectionCreationLock(key, 'someone-else'),
      ).resolves.toBe(false);
      expect(await redis.get(key)).toBe(token);

      await expect(
        pods[1].releaseDetectionCreationLock(key, token as string),
      ).resolves.toBe(true);
      expect(await redis.exists(key)).toBe(0);
    });

    it('never lets two pods hold one key at the same time', async () => {
      const key = newKey();
      let inside = 0;
      let maxInside = 0;

      await Promise.all(
        Array.from({ length: 10 }, async (_, i) => {
          const service = pods[i % pods.length];
          const token = await service.acquireDetectionCreationLock(key);
          expect(token).not.toBeNull();
          inside++;
          maxInside = Math.max(maxInside, inside);
          await new Promise((resolve) => setTimeout(resolve, 5));
          inside--;
          await service.releaseDetectionCreationLock(key, token as string);
        }),
      );

      expect(maxInside).toBe(1);
      expect(await redis.exists(key)).toBe(0);
    });
  },
);
