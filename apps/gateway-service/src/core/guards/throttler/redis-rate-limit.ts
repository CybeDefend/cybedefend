import { HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import { hitRateLimitBucket } from './rate-limit-bucket';
import { GATEWAY_REDIS_COMMAND_TIMEOUT_MS } from '../../redis/gateway-redis-client';

/**
 * Fixed-window rate limit shared by RateLimitGuard and ChatThrottlerGuard.
 *
 * Redis holds the counters. When it does not answer (a restart, for example:
 * a guard awaiting it with no bound hangs behind ioredis' offline queue, then
 * fails with a 500 MaxRetriesPerRequestError), the round-trip (one script,
 * rate-limit-bucket.ts) gives up after
 * RATE_LIMIT_REDIS_TIMEOUT_MS, below the shared client's 1 s command timeout,
 * and the request is counted in-process instead, with the same limit, window
 * and escalating block. It never falls back to "no limit": the protection
 * must hold server-side. While degraded the limit is per pod, and a block
 * Redis decided holds on the pods that saw it.
 * While ioredis already reports the connection down, Redis is not asked at
 * all: waiting out the timeout would only slow every request of the outage.
 */

export const RATE_LIMIT_REDIS_TIMEOUT_MS_DEFAULT = 500;
/** At most one "Redis is down" warning per interval, for the whole process. */
export const DEGRADED_WARN_INTERVAL_MS = 30_000;
/** Bound on each in-process map (counters, blocks), so an outage cannot grow
 * memory forever. */
export const FALLBACK_MAX_BUCKETS = 20_000;

/**
 * ioredis states in which a command is only queued (or rejected) until the
 * connection comes back. 'wait' is not one: under lazyConnect the first
 * command is what connects the client.
 */
const REDIS_DOWN_STATUSES: ReadonlySet<string> = new Set([
  'connecting',
  'connect',
  'reconnecting',
  'disconnecting',
  'close',
  'end',
]);

/** True while ioredis reports the connection down: asking it would only wait. */
export function isRedisConnectionDown(redis: Pick<Redis, 'status'>): boolean {
  return REDIS_DOWN_STATUSES.has(redis.status);
}

const BLOCK_BASE_SECONDS = 60;
const BLOCK_MAX_SECONDS = 900;
const BLOCKS_TTL_SECONDS = 3600;

/** Length of the block earned by the n-th violation within BLOCKS_TTL_SECONDS. */
function blockSeconds(violations: number): number {
  return Math.min(
    BLOCK_BASE_SECONDS * 2 ** (violations - 1),
    BLOCK_MAX_SECONDS,
  );
}

export type SetHeader = (name: string, value: number) => unknown;

export interface RateLimitCheck {
  redis: Redis;
  /** Bucket id, already namespaced (`gateway:user:<sub>`, `chat:msg:ip:<ip>`...). */
  tracker: string;
  limit: number;
  windowSeconds: number;
  /** `message` of the 429 body. */
  errorMessage: string;
  timeoutMs: number;
  setHeader?: SetHeader;
}

/** 0, a negative number and NaN all restore the default: a typo in the
 * environment must not remove the bound. A value above the shared client's
 * command timeout is lowered to it: waiting longer changes nothing, and above
 * 2^31 - 1 ms Node would fire the timer at once. Unregistered in Joi, like the
 * other tuning variables. */
export function rateLimitRedisTimeoutMs(config: ConfigService): number {
  const value = Number(
    config.get<string | number>(
      'RATE_LIMIT_REDIS_TIMEOUT_MS',
      RATE_LIMIT_REDIS_TIMEOUT_MS_DEFAULT,
    ),
  );
  return Number.isFinite(value) && value > 0
    ? Math.min(value, GATEWAY_REDIS_COMMAND_TIMEOUT_MS)
    : RATE_LIMIT_REDIS_TIMEOUT_MS_DEFAULT;
}

/**
 * Fixed windows kept in memory, one per key. Both guards use a 60 s window,
 * so the Map (insertion order) is also expiry order: expired buckets are
 * dropped from its head, and when the bound is still reached the oldest live
 * bucket goes. Were the windows ever to differ, the head scan would only stop
 * early — the bound itself always holds.
 */
export class InProcessFixedWindow {
  private readonly buckets = new Map<
    string,
    { count: number; resetAt: number }
  >();

  constructor(private readonly maxBuckets: number) {}

  get size(): number {
    return this.buckets.size;
  }

  hit(
    key: string,
    windowSeconds: number,
    now: number,
  ): { count: number; resetInSeconds: number } {
    let bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      this.buckets.delete(key);
      makeRoom(this.buckets, this.maxBuckets, (b) => b.resetAt > now);
      bucket = { count: 0, resetAt: now + windowSeconds * 1000 };
      this.buckets.set(key, bucket);
    }
    bucket.count += 1;
    return {
      count: bucket.count,
      resetInSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }

  clear(): void {
    this.buckets.clear();
  }
}

interface BlockEntry {
  violations: number;
  escalationEndsAt: number;
  blockedUntil: number;
}

/**
 * Escalating blocks kept in memory, one per key, with the rules of the Redis
 * path (rl:block, rl:blocks): the n-th violation within BLOCKS_TTL_SECONDS of
 * the first one blocks the key for BLOCK_BASE_SECONDS * 2^(n-1), capped at
 * BLOCK_MAX_SECONDS. An entry lives while its escalation or its block runs.
 * Bounded like InProcessFixedWindow: insertion order is first-violation
 * order, close to expiry order, and the bound always holds.
 */
export class InProcessBlocks {
  private readonly entries = new Map<string, BlockEntry>();

  constructor(private readonly maxEntries: number) {}

  get size(): number {
    return this.entries.size;
  }

  /** Seconds left on the key's block, 0 when it is not blocked. */
  remainingSeconds(key: string, now: number): number {
    const entry = this.entries.get(key);
    if (!entry || entry.blockedUntil <= now) return 0;
    return Math.ceil((entry.blockedUntil - now) / 1000);
  }

  /** Records a violation; returns the length of the block it earns, in s. */
  block(key: string, now: number): number {
    const entry = this.escalation(key, now);
    entry.violations += 1;
    const seconds = blockSeconds(entry.violations);
    entry.blockedUntil = now + seconds * 1000;
    return seconds;
  }

  /**
   * Mirrors a block Redis decided, so that it outlasts a Redis outage.
   * `violations`: the rl:blocks count, when Redis gave it.
   */
  hold(key: string, seconds: number, now: number, violations = 1): void {
    const entry = this.escalation(key, now);
    entry.violations = Math.max(entry.violations, violations);
    entry.blockedUntil = Math.max(entry.blockedUntil, now + seconds * 1000);
  }

  clear(): void {
    this.entries.clear();
  }

  /** The key's entry, a fresh one when its escalation hour is over. */
  private escalation(key: string, now: number): BlockEntry {
    const entry = this.entries.get(key);
    if (entry && entry.escalationEndsAt > now) return entry;
    this.entries.delete(key);
    makeRoom(
      this.entries,
      this.maxEntries,
      (e) => Math.max(e.escalationEndsAt, e.blockedUntil) > now,
    );
    const fresh: BlockEntry = {
      violations: 0,
      escalationEndsAt: now + BLOCKS_TTL_SECONDS * 1000,
      blockedUntil: Math.max(now, entry?.blockedUntil ?? now),
    };
    this.entries.set(key, fresh);
    return fresh;
  }
}

/**
 * Frees a slot in a bounded Map before an insertion: drops the dead entries
 * at its head, then, if the bound is still reached, the oldest live ones.
 */
function makeRoom<V>(
  map: Map<string, V>,
  maxSize: number,
  isLive: (value: V) => boolean,
): void {
  if (map.size < maxSize) return;
  for (const [key, value] of map) {
    if (isLive(value)) break;
    map.delete(key);
  }
  for (const key of map.keys()) {
    if (map.size < maxSize) break;
    map.delete(key);
  }
}

// Process-wide on purpose: Nest builds one guard instance per module that
// declares it, and a per-instance fallback would multiply the limit.
const fallbackWindows = new InProcessFixedWindow(FALLBACK_MAX_BUCKETS);
const fallbackBlocks = new InProcessBlocks(FALLBACK_MAX_BUCKETS);
let lastDegradedWarnAt = Number.NEGATIVE_INFINITY;
/** When this process last started counting in-process, null while Redis answers. */
let degradedSince: number | null = null;
const logger = new Logger('RateLimit');

/** Forget the fallback counters, blocks and warning clock (unit tests). */
export function resetRateLimitFallback(): void {
  fallbackWindows.clear();
  fallbackBlocks.clear();
  lastDegradedWarnAt = Number.NEGATIVE_INFINITY;
  degradedSince = null;
}

/**
 * Throws the 429 (HttpException) when the caller is over the limit, resolves
 * `true` otherwise. Never rejects with anything else.
 */
export async function enforceRateLimit(check: RateLimitCheck): Promise<true> {
  const status = check.redis.status;
  if (REDIS_DOWN_STATUSES.has(status)) {
    noteRedisUnavailable(`connection ${status}`);
    return enforceInProcess(check);
  }
  try {
    const allowed = await enforceWithRedis(check);
    noteRedisAnswered();
    return allowed;
  } catch (err) {
    if (err instanceof HttpException) {
      noteRedisAnswered();
      throw err;
    }
    noteRedisUnavailable(err);
    return enforceInProcess(check);
  }
}

async function enforceWithRedis(check: RateLimitCheck): Promise<true> {
  const { redis, tracker, limit, windowSeconds, setHeader } = check;

  // One round-trip: the bucket script of rate-limit-bucket.ts,
  // which also puts the window back on a counter that lost it. Bounded here.
  const hit = await withTimeout(
    hitRateLimitBucket(redis, tracker, limit, windowSeconds),
    check.timeoutMs,
  );

  if (hit.state === 'blocked') {
    // Mirrored in-process, like the block below: an outage must not hand a
    // blocked client a fresh quota.
    fallbackBlocks.hold(tracker, hit.retryAfter, Date.now());
    throw tooManyRequests(check, hit.retryAfter);
  }

  setHeader?.('X-RateLimit-Limit', limit);
  setHeader?.('X-RateLimit-Remaining', Math.max(0, limit - hit.count));
  setHeader?.('X-RateLimit-Reset', hit.reset);

  if (hit.state === 'exceeded') {
    fallbackBlocks.hold(
      tracker,
      hit.retryAfter,
      Date.now(),
      violationsFor(hit.retryAfter),
    );
    throw tooManyRequests(check, hit.retryAfter);
  }

  return true;
}

/**
 * The violation count behind a block of `seconds` (the inverse of
 * blockSeconds), so the in-process escalation carries on from where Redis
 * stopped. A capped block (900 s) reads as the first capped violation: every
 * later one is capped too, so the outcome is the same.
 */
export function violationsFor(seconds: number): number {
  const steps = Math.round(Math.log2(seconds / BLOCK_BASE_SECONDS));
  return Number.isFinite(steps) ? Math.max(1, steps + 1) : 1;
}

function enforceInProcess(check: RateLimitCheck): true {
  const { tracker, limit, setHeader } = check;
  const now = Date.now();
  // Checked before counting, as rl:block is: a block outlasts the window.
  const blockedFor = fallbackBlocks.remainingSeconds(tracker, now);
  if (blockedFor > 0) {
    throw tooManyRequests(check, blockedFor);
  }
  const { count, resetInSeconds } = fallbackWindows.hit(
    tracker,
    check.windowSeconds,
    now,
  );
  setHeader?.('X-RateLimit-Limit', limit);
  setHeader?.('X-RateLimit-Remaining', Math.max(0, limit - count));
  setHeader?.('X-RateLimit-Reset', resetInSeconds);
  if (count > limit) {
    throw tooManyRequests(check, fallbackBlocks.block(tracker, now));
  }
  return true;
}

function tooManyRequests(
  check: RateLimitCheck,
  retryAfter: number,
): HttpException {
  check.setHeader?.('Retry-After', retryAfter);
  return new HttpException(
    { message: check.errorMessage, retryAfter },
    HttpStatus.TOO_MANY_REQUESTS,
  );
}

/** `cause`: the Redis error, or a description when Redis was not asked. */
function noteRedisUnavailable(cause: unknown): void {
  const now = Date.now();
  degradedSince ??= now;
  if (now - lastDegradedWarnAt < DEGRADED_WARN_INTERVAL_MS) return;
  lastDegradedWarnAt = now;
  const reason = cause instanceof Error ? cause.message : String(cause);
  logger.warn(
    `Redis unavailable for rate limiting (${reason}): enforcing the in-process limit, per pod, until it answers again`,
  );
}

/** Ends the degraded period, with one line naming how long it lasted. */
function noteRedisAnswered(): void {
  if (degradedSince === null) return;
  const seconds = Math.round((Date.now() - degradedSince) / 1000);
  degradedSince = null;
  logger.log(
    `Redis answers again for rate limiting after ${seconds} s: the in-process limit is off`,
  );
}

/**
 * Races a Redis reply against the timeout. A reply landing afterwards is
 * dropped — `Promise.race` keeps its own handler on it, so a late rejection is
 * not unhandled either. The script still ran in Redis, though: a request whose
 * reply came between the timeout and the client's own 1 s timeout is counted
 * twice, in-process and in Redis. That errs on the strict side, never open.
 */
function withTimeout<T>(reply: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Redis did not answer within ${ms} ms`)),
      ms,
    );
  });
  return Promise.race([reply, expired]).finally(() => clearTimeout(timer));
}
