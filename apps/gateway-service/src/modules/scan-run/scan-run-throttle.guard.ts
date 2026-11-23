import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type Redis from 'ioredis';
import { clientRateLimitAddressOf } from 'src/core/http/client-ip';

/** The Redis client of this route alone (scan-run.module.ts). */
export const SCAN_RUN_REDIS_CLIENT = 'SCAN_RUN_REDIS_CLIENT';

/**
 * About sixty uploads a minute per address. A scan's pods upload once
 * each (five adapters), and a runner retries a few times: far below this.
 * A large instance whose pods all leave through one NAT could meet it; the
 * runner then waits for `Retry-After`.
 */
export const SCAN_RUN_IP_LIMIT = 60;
export const SCAN_RUN_IP_WINDOW_SECONDS = 60;

interface ReplyLike {
  header?: (name: string, value: string) => unknown;
  raw?: { setHeader?: (name: string, value: string) => unknown };
}

function setHeader(reply: ReplyLike | undefined, name: string, value: string) {
  if (typeof reply?.header === 'function') {
    reply.header(name, value);
  } else {
    reply?.raw?.setHeader?.(name, value);
  }
}

/**
 * The per-IP throttle of the public, unauthenticated scanner results route:
 * every well-formed token costs a gRPC call to security-scanning and a
 * database read, so the guard runs before the token guard. One window per address (`SET key 0 EX w NX` + `INCR` in one MULTI,
 * the shape of LocalAuthRateLimitGuard), on the route's own Redis client,
 * like the other public routes: a flood here queues on this connection,
 * not on the one every authenticated route shares.
 *
 * Over the limit: 429 `RATE_LIMITED` with `Retry-After`. A Redis failure is
 * 503 `rate_limit_unavailable`, never an open door. The address is
 * `clientIpOf` (never `cf-connecting-ip` in the Community Edition).
 */
@Injectable()
export class ScanRunThrottleGuard implements CanActivate {
  private readonly logger = new Logger(ScanRunThrottleGuard.name);

  constructor(@Inject(SCAN_RUN_REDIS_CLIENT) private readonly redis: Redis) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const req = http.getRequest<{
      ip?: unknown;
      headers?: Record<string, unknown>;
    }>();
    const reply = http.getResponse<ReplyLike>();
    const ip = clientRateLimitAddressOf(req, process.env.NODE_ENV) || 'unknown';
    const key = `rl:scan-run:ip:${ip}`;

    try {
      const replies = await this.redis
        .multi()
        .set(key, 0, 'EX', SCAN_RUN_IP_WINDOW_SECONDS, 'NX')
        .incr(key)
        .exec();
      // The SET gives the key its TTL: without it the counter counts forever.
      const setError = replies?.[0]?.[0];
      if (setError) throw setError;
      const [incrError, count] = replies?.[1] ?? [
        new Error('redis returned no INCR reply'),
        undefined,
      ];
      if (incrError) throw incrError;
      if (typeof count !== 'number') {
        throw new Error('redis returned a non-numeric rate-limit count');
      }
      if (count > SCAN_RUN_IP_LIMIT) {
        const ttl = await this.redis.ttl(key);
        const retryAfter = ttl > 0 ? ttl : SCAN_RUN_IP_WINDOW_SECONDS;
        setHeader(reply, 'Retry-After', String(retryAfter));
        throw new HttpException(
          { message: 'RATE_LIMITED', code: 'RATE_LIMITED', retryAfter },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    } catch (err) {
      if (err instanceof HttpException) throw err;
      // The error's class only: a driver message may quote a connection string.
      this.logger.warn(
        `[scan-run] rate limit backend unavailable (${
          (err as Error)?.name ?? 'Error'
        })`,
      );
      throw new ServiceUnavailableException('rate_limit_unavailable');
    }
    return true;
  }
}
