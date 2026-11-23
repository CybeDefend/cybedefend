import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import type Redis from 'ioredis';
import { isRedisConnectionDown } from 'src/core/guards/throttler/redis-rate-limit';

/**
 * Logins one address (an IPv6 /64) may run at once. The password verifier
 * of global-management runs 4 argon2 verifications at a time and queues 64,
 * refusing the overflow with a 503: without this bound, one address firing
 * its whole per-address budget at once could fill that queue and turn every
 * other user's login into a 503.
 */
export const LOGIN_IN_FLIGHT_PER_ADDRESS = 4;
/** A slot a crashed request never released ends with this TTL. */
export const LOGIN_IN_FLIGHT_TTL_SECONDS = 30;

interface ReplyLike {
  header?: (name: string, value: string) => unknown;
  raw?: { setHeader?: (name: string, value: string) => unknown };
}

/** Decrements the counter only while it exists: never a key without a TTL. */
const RELEASE_SCRIPT = `if redis.call('exists', KEYS[1]) == 1 then
  return redis.call('decr', KEYS[1])
end
return 0`;

/** In-process slots, used while Redis does not answer (per pod). */
const fallback = new Map<string, number>();

/** Forget the in-process slots (unit tests). */
export function resetLoginInFlightFallback(): void {
  fallback.clear();
}

function setHeader(reply: ReplyLike | undefined, name: string, value: string) {
  if (typeof reply?.header === 'function') {
    reply.header(name, value);
  } else {
    reply?.raw?.setHeader?.(name, value);
  }
}

function refused(reply: ReplyLike | undefined): HttpException {
  setHeader(reply, 'Retry-After', '1');
  return new HttpException(
    { message: 'RATE_LIMITED', code: 'RATE_LIMITED', retryAfter: 1 },
    HttpStatus.TOO_MANY_REQUESTS,
  );
}

/**
 * Bounds the logins one address runs at once. `acquire` takes a slot or
 * answers 429 `RATE_LIMITED` with `Retry-After: 1`; the login route calls
 * the returned release when the login ends, whatever its outcome. The key is
 * the rate-limit address (`clientRateLimitAddressOf`). When Redis does not
 * answer, slots are counted in-process: never an open door.
 */
@Injectable()
export class LoginInFlightLimiter {
  private readonly logger = new Logger(LoginInFlightLimiter.name);

  constructor(@Inject('REDIS_CLIENT') private readonly redis: Redis) {}

  async acquire(
    address: string,
    reply?: ReplyLike,
  ): Promise<() => Promise<void>> {
    const key = `rl:auth:login:inflight:${address || 'unknown'}`;
    if (!isRedisConnectionDown(this.redis)) {
      let count: number | undefined;
      try {
        count = await this.take(key);
      } catch (err) {
        this.logger.warn(
          `[local-auth] login concurrency counted in-process (${
            (err as Error)?.name ?? 'Error'
          })`,
        );
      }
      if (count !== undefined) {
        const release = () => this.release(key);
        if (count > LOGIN_IN_FLIGHT_PER_ADDRESS) {
          await release();
          throw refused(reply);
        }
        return release;
      }
    }
    return this.takeInProcess(key, reply);
  }

  /** INCR + EXPIRE in one MULTI: every counter has its TTL. */
  private async take(key: string): Promise<number> {
    const replies = await this.redis
      .multi()
      .incr(key)
      .expire(key, LOGIN_IN_FLIGHT_TTL_SECONDS)
      .exec();
    const [incrReply, expireReply] = replies ?? [];
    if (!incrReply || !expireReply) {
      throw new Error('redis returned an incomplete concurrency reply');
    }
    if (incrReply[0]) throw incrReply[0];
    if (expireReply[0]) throw expireReply[0];
    if (typeof incrReply[1] !== 'number') {
      throw new Error('redis returned a non-numeric concurrency count');
    }
    return incrReply[1];
  }

  private async release(key: string): Promise<void> {
    try {
      await this.redis.eval(RELEASE_SCRIPT, 1, key);
    } catch (err) {
      // The slot then ends with its TTL.
      this.logger.warn(
        `[local-auth] login concurrency slot not released (${
          (err as Error)?.name ?? 'Error'
        })`,
      );
    }
  }

  private takeInProcess(
    key: string,
    reply: ReplyLike | undefined,
  ): () => Promise<void> {
    const count = fallback.get(key) ?? 0;
    if (count >= LOGIN_IN_FLIGHT_PER_ADDRESS) throw refused(reply);
    fallback.set(key, count + 1);
    let released = false;
    return async () => {
      if (released) return;
      released = true;
      const left = (fallback.get(key) ?? 1) - 1;
      if (left > 0) fallback.set(key, left);
      else fallback.delete(key);
    };
  }
}
