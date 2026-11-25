import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { ScanQueueService } from '../scan-queue/scan-queue.service';
import {
  OverviewBlock,
  overviewBlockKey,
  overviewGenerationKey,
  OVERVIEW_BLOCK_CACHE_TTL_SECONDS,
  OVERVIEW_GENERATION_TTL_SECONDS,
} from 'src/core/cache/overview-cache.keys';

/**
 * Short-TTL Redis cache for the 3 dedicated org-overview blocks
 * (severity / state / over-time). Keyed by org + userId + a digest of the
 * caller's readable project ids (the Permify scope — a security boundary,
 * NOT just an optimisation) + a per-org generation counter + a hash of the
 * applied filters. Reuses the BullMQ-backed ioredis
 * client exposed by ScanQueueService.getRedisClient(). Best-effort: any Redis
 * error falls back to computing the value directly.
 */
@Injectable()
export class OverviewCacheService {
  private readonly logger = new Logger(OverviewCacheService.name);
  private readonly ttl = Number(
    process.env.OVERVIEW_BLOCK_CACHE_TTL_SECONDS ??
      OVERVIEW_BLOCK_CACHE_TTL_SECONDS,
  );

  constructor(private readonly scanQueue: ScanQueueService) {}

  /** Order-independent digest of the caller's readable project ids. */
  private digestScope(projectIds: readonly string[]): string {
    return createHash('sha256')
      .update(JSON.stringify([...projectIds].sort()))
      .digest('hex')
      .slice(0, 32);
  }

  private hashFilter(filter: unknown): string {
    return createHash('sha1')
      .update(JSON.stringify(filter ?? {}))
      .digest('hex')
      .slice(0, 16);
  }

  private async readGeneration(orgId: string): Promise<number> {
    try {
      const redis = await this.scanQueue.getRedisClient();
      const raw = await redis.get(overviewGenerationKey(orgId));
      return raw ? Number(raw) : 0;
    } catch {
      return 0;
    }
  }

  /** INCR the org generation so all previously-cached blocks become unreachable. */
  async bumpGeneration(orgId: string): Promise<void> {
    try {
      const redis = await this.scanQueue.getRedisClient();
      // INCR + EXPIRE in a single atomic round-trip: a fresh generation key can
      // never be left without a TTL (a separate EXPIRE failing after a successful
      // INCR previously left the counter persistent).
      await redis.eval(
        "local v = redis.call('INCR', KEYS[1]); redis.call('EXPIRE', KEYS[1], ARGV[1]); return v",
        1,
        overviewGenerationKey(orgId),
        String(OVERVIEW_GENERATION_TTL_SECONDS),
      );
    } catch (err) {
      this.logger.warn(
        `bumpGeneration(${orgId}) failed: ${(err as Error).message}`,
      );
    }
  }

  /**
   * `readableProjectIds` are the projects the caller may read on this call
   * (already resolved by the caller): the entry is keyed by them, so a
   * member who lost a project is never served counts that include it.
   */
  async getOrSet<T>(
    block: OverviewBlock,
    orgId: string,
    userId: string,
    readableProjectIds: readonly string[],
    filter: unknown,
    producer: () => Promise<T>,
  ): Promise<T> {
    const generation = await this.readGeneration(orgId);
    const key = overviewBlockKey(
      block,
      orgId,
      userId,
      this.digestScope(readableProjectIds),
      generation,
      this.hashFilter(filter),
    );

    try {
      const redis = await this.scanQueue.getRedisClient();
      const cached = await redis.get(key);
      if (cached) {
        return JSON.parse(cached) as T;
      }
      const value = await producer();
      await redis.set(key, JSON.stringify(value), 'EX', this.ttl);
      return value;
    } catch (err) {
      this.logger.warn(
        `getOrSet(${block}, ${orgId}) cache bypass: ${(err as Error).message}`,
      );
      return producer();
    }
  }
}
