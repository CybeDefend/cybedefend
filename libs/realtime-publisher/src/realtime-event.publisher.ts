import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { context, propagation } from '@opentelemetry/api';
import { resolveChannels } from './channel-router';
import { TokenBucket } from './token-bucket';
import { RealtimePublisherOptions } from './realtime-publisher.module';

const channelToStream = (ch: string) => ch.replace(/^cybe:event:/, 'cybe:stream:');

@Injectable()
export class RealtimeEventPublisher {
  private readonly logger = new Logger(RealtimeEventPublisher.name);
  private readonly bucket: TokenBucket;
  private readonly drops = new Map<string, number>();
  private readonly streamMaxLen: number;

  constructor(
    @Inject('REALTIME_REDIS_PUB') private readonly redis: Redis,
    @Inject('REALTIME_OPTIONS') private readonly options: RealtimePublisherOptions,
  ) {
    this.bucket = new TokenBucket(options.burst ?? 50, options.refillPerSecond ?? 50);
    this.streamMaxLen = options.streamMaxLen ?? 1000;
  }

  dropsCount(key: string): number { return this.drops.get(key) ?? 0; }

  async publish(
    envelope: any,
    opts?: { dedupeKey?: string; dedupeTtlSec?: number },
  ): Promise<void> {
    try {
      const sourceId = envelope?.scope?.scanId ?? envelope?.scope?.projectId ?? envelope?.scope?.organizationId;
      if (!sourceId || !envelope?.type) {
        this.logger.warn('publish: missing required fields (organizationId or type)');
        return;
      }

      // Optional cross-process dedupe — callers that emit a "logical"
      // transition under racy conditions (e.g. ScanStateManager being hit
      // by parallel container updates that all see the same stale
      // previousState) can pass a stable dedupeKey to guarantee at-most-
      // once delivery within the TTL. Must run BEFORE the token bucket
      // consume so duplicate transitions don't drain it.
      if (opts?.dedupeKey) {
        const key = `cybe:event:dedupe:${opts.dedupeKey}`;
        const ttl = opts.dedupeTtlSec ?? 30;
        try {
          // ioredis accepts SET ... NX EX ttl — keep that argument order
          // because ioredis-mock parses positional args strictly.
          const ok = await (this.redis as any).set(key, '1', 'NX', 'EX', ttl);
          if (ok !== 'OK') return;
        } catch (err) {
          // Dedupe Redis call failed — fall through and publish anyway.
          // Better a duplicate event than a missed one on Redis hiccup.
          this.logger.warn(`dedupe SETNX failed (publishing anyway): ${(err as Error).message}`);
        }
      }

      const sourceKey = `${envelope.type}:${sourceId}`;
      if (!this.bucket.tryConsume(sourceKey)) {
        this.drops.set(sourceKey, (this.drops.get(sourceKey) ?? 0) + 1);
        return;
      }
      const carrier: Record<string, string> = {};
      try { propagation.inject(context.active(), carrier); } catch { /* OTEL may not be setup */ }
      envelope.traceparent = carrier['traceparent'] ?? envelope.traceparent ?? '';
      envelope.timestamp = envelope.timestamp ?? new Date().toISOString();

      const channels = resolveChannels(envelope);
      if (channels.length === 0) return;
      const json = JSON.stringify(envelope);

      await Promise.allSettled(
        channels.flatMap((ch) => [
          this.redis.publish(ch, json),
          (this.redis as any).xadd(channelToStream(ch), 'MAXLEN', '~', this.streamMaxLen, '*', 'env', json),
        ]),
      );
    } catch (err) {
      this.logger.error(`publish failed: ${(err as Error).message}`);
    }
  }
}
