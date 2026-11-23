import Redis, { RedisOptions } from 'ioredis';

/**
 * How long one command of the gateway's shared Redis client may wait.
 *
 * ioredis has no command timeout by default: on a connection that never
 * answers (a half-open socket to a Redis pod that went away, a connection
 * stuck before `ready`) a command waits forever. Every guarded route runs
 * RateLimitGuard on this client, so the request then never returns and logs
 * nothing, and the caller's own timeout (an edge proxy's) fires first.
 * With this bound a command fails in about a second and its error reaches
 * the GlobalExceptionFilter, which logs it and answers 500.
 * The two rate-limit guards wait less (RATE_LIMIT_REDIS_TIMEOUT_MS, 500 ms)
 * and then count the request in-process instead (redis-rate-limit.ts).
 *
 * A second is generous: the guards run one short script, the other users
 * (OAuth state, async-task ownership, the closed extensions' caches)
 * a GET, a SET or a small pipeline, which a healthy Redis answers in a few
 * milliseconds.
 */
export const GATEWAY_REDIS_COMMAND_TIMEOUT_MS = 1_000;

export const GATEWAY_REDIS_OPTIONS: RedisOptions = {
  commandTimeout: GATEWAY_REDIS_COMMAND_TIMEOUT_MS,
  // A guard answers now or not at all: one reconnection attempt per queued
  // command, not ioredis' default twenty.
  maxRetriesPerRequest: 1,
};

/** The Redis client every gateway module shares (GatewayRedisModule). */
export function createGatewayRedisClient(url: string): Redis {
  return new Redis(url, GATEWAY_REDIS_OPTIONS);
}
