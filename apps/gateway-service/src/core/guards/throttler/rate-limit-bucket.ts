import type Redis from 'ioredis';

/**
 * One hit on a rate-limit bucket, run by Redis as a single script. The guards used to send TTL, INCR, EXPIRE and TTL one after the other
 * (4 round-trips, 6 over the limit), and set the window only when INCR
 * returned 1: a counter whose EXPIRE never ran (connection dropped between
 * the two, EXPIRE timed out) counted forever, and its caller was blocked
 * again after every block. The script puts the TTL back on any counter that
 * has none, so such a key heals on its next hit.
 *
 * KEYS: rl:count:<tracker>, rl:block:<tracker>, rl:blocks:<tracker>
 * ARGV: limit, window (s)
 * Reply: {0, retryAfter}               already blocked, the hit is not counted
 *        {1, count, reset}             counted, under the limit
 *        {2, count, reset, retryAfter} counted, over the limit: now blocked
 *
 * The block lasts 60 s, doubled on each block within the hour, 15 min at most.
 */
const RATE_LIMIT_HIT_SCRIPT = `
local blocked = redis.call('TTL', KEYS[2])
if blocked > 0 then
  return {0, blocked}
end
local count = redis.call('INCR', KEYS[1])
local reset = redis.call('TTL', KEYS[1])
if reset < 0 then
  redis.call('EXPIRE', KEYS[1], ARGV[2])
  reset = tonumber(ARGV[2])
end
if count <= tonumber(ARGV[1]) then
  return {1, count, reset}
end
local blocks = redis.call('INCR', KEYS[3])
if redis.call('TTL', KEYS[3]) < 0 then
  redis.call('EXPIRE', KEYS[3], 3600)
end
local seconds = math.floor(math.min(60 * 2 ^ (blocks - 1), 900))
redis.call('SET', KEYS[2], '1', 'EX', seconds)
return {2, count, reset, seconds}
`;

export type RateLimitHit =
  /** An earlier block still runs: refused, and not counted. */
  | { state: 'blocked'; retryAfter: number }
  /** Counted, within the limit. `reset`: seconds left in the window. */
  | { state: 'counted'; count: number; reset: number }
  /** Counted, over the limit: refused, and blocked for `retryAfter` s. */
  | { state: 'exceeded'; count: number; reset: number; retryAfter: number };

/**
 * The name the script is registered under on a client (defineCommand). It
 * then goes by its SHA (EVALSHA): ioredis sends the full script once per
 * connection, and again only after a NOSCRIPT (server restarted or flushed).
 * A plain EVAL carried its ~800 bytes on every guarded request, and the
 * ioredis instrumentation copied them into every span's db.statement.
 */
export const RATE_LIMIT_HIT_COMMAND = 'cybeRateLimitHit';

type RateLimitHitCommand = (
  countKey: string,
  blockKey: string,
  blocksKey: string,
  limit: number,
  windowSeconds: number,
) => Promise<unknown>;

/** The client's registered script, registered on first use. */
function rateLimitHitCommand(redis: Redis): RateLimitHitCommand {
  const client = redis as unknown as Record<string, RateLimitHitCommand>;
  if (typeof client[RATE_LIMIT_HIT_COMMAND] !== 'function') {
    redis.defineCommand(RATE_LIMIT_HIT_COMMAND, {
      numberOfKeys: 3,
      lua: RATE_LIMIT_HIT_SCRIPT,
    });
  }
  return client[RATE_LIMIT_HIT_COMMAND].bind(redis);
}

/**
 * Counts one hit on the `tracker` bucket in one round-trip. A Redis error
 * rejects; the guards then count the request in-process
 * (redis-rate-limit.ts).
 */
export async function hitRateLimitBucket(
  redis: Redis,
  tracker: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitHit> {
  const reply = (await rateLimitHitCommand(redis)(
    `rl:count:${tracker}`,
    `rl:block:${tracker}`,
    `rl:blocks:${tracker}`,
    limit,
    windowSeconds,
  )) as number[];
  const [state, a, b, c] = reply.map(Number);
  if (state === 0) return { state: 'blocked', retryAfter: a };
  if (state === 1) return { state: 'counted', count: a, reset: b };
  return { state: 'exceeded', count: a, reset: b, retryAfter: c };
}
