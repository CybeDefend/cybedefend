import { createHash } from 'node:crypto';
import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import type Redis from 'ioredis';
import {
  FALLBACK_MAX_BUCKETS,
  isRedisConnectionDown,
} from 'src/core/guards/throttler/redis-rate-limit';

/**
 * Login, per account: 20 failed attempts per 15 min, whatever the address.
 * The address buckets of LocalAuthRateLimitGuard (10 per address and e-mail,
 * 100 per address) do not stop a password spray from many addresses on one
 * account, and every attempt costs one argon2id verification.
 */
export const LOGIN_ACCOUNT_FAILURE_LIMIT = 20;
export const LOGIN_ACCOUNT_WINDOW_SECONDS = 900;
/** How long a device that signed in to an account stays trusted for it. */
export const LOGIN_TRUST_TTL_SECONDS = 30 * 86_400;

/**
 * Who is signing in: the login device token of the `cd_login_device` cookie.
 * Never the address: another browser behind the same NAT or IPv6 /64 is not
 * the user, so an address earns no trust.
 */
export interface LoginClient {
  deviceToken: string;
}

/** The outcome of a reserved login attempt, reported by the login route. */
export interface LoginAttempt {
  /**
   * The login succeeded: the account's counter starts again from zero, and
   * the client's device is trusted for the account.
   */
  succeeded(): Promise<void>;
  /** The attempt did not fail on the credentials (an outage): not counted. */
  refund(): Promise<void>;
}

interface ReplyLike {
  header?: (name: string, value: string) => unknown;
  raw?: { setHeader?: (name: string, value: string) => unknown };
}

/** Decrements the counter only while it exists: never a key without a TTL. */
const REFUND_SCRIPT = `if redis.call('exists', KEYS[1]) == 1 then
  return redis.call('decr', KEYS[1])
end
return 0`;

const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');

/** The account's key: a digest of the trimmed, lower-cased e-mail. */
const accountDigest = (email: string) =>
  sha256((typeof email === 'string' ? email : '').trim().toLowerCase());

/**
 * In-process windows, used while Redis does not answer, bounded like the
 * fallback of redis-rate-limit.ts. Process-wide: one limit per pod, whatever
 * the number of instances Nest builds.
 */
const fallback = new Map<string, { count: number; resetAt: number }>();

/** Forget the in-process counters (unit tests). */
export function resetLoginAccountFallback(): void {
  fallback.clear();
}

function fallbackHit(key: string, now: number) {
  let bucket = fallback.get(key);
  if (!bucket || bucket.resetAt <= now) {
    fallback.delete(key);
    if (fallback.size >= FALLBACK_MAX_BUCKETS) {
      for (const [k, b] of fallback) {
        if (fallback.size < FALLBACK_MAX_BUCKETS && b.resetAt > now) break;
        fallback.delete(k);
      }
    }
    bucket = { count: 0, resetAt: now + LOGIN_ACCOUNT_WINDOW_SECONDS * 1000 };
    fallback.set(key, bucket);
  }
  bucket.count += 1;
  return {
    count: bucket.count,
    ttl: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
  };
}

function setHeader(reply: ReplyLike | undefined, name: string, value: string) {
  if (typeof reply?.header === 'function') {
    reply.header(name, value);
  } else {
    reply?.raw?.setHeader?.(name, value);
  }
}

/**
 * The per-account bucket of the Community login. The login route reserves an
 * attempt before calling global-management (`reserve`), so concurrent
 * attempts are counted before any of them is verified; it then reports the
 * outcome: a success deletes the counter, an attempt that did not fail on the
 * credentials (outage, busy verifier) is given back, a wrong password stays
 * counted. Past the limit the route answers the guard's 429 `RATE_LIMITED`
 * with `Retry-After` and global-management is not called.
 *
 * The lock must not lock the real user out: anyone can fail 21 logins on a
 * known e-mail from a few addresses. So the device that signed in to that
 * account before is let through a locked account (still counted, still
 * bounded by the guard's per-address buckets): a random token in the HttpOnly
 * `cd_login_device` cookie, recorded server-side (Redis) for the account on
 * every successful login and password reset, for 30 days. Only that device:
 * an address that signed in before earns nothing, since an attacker can share
 * it (the same NAT, the same IPv6 /64). Everyone else is refused.
 * A password reset also clears the counter and trusts the browser that reset
 * it (`trust`).
 *
 * - Every key is a SHA-256 digest: no e-mail, token or address in Redis or
 *   in the logs.
 * - The limiter does not know which accounts exist: an unknown e-mail is
 *   counted and locked exactly like a known one, so the 429 reveals nothing.
 * - The lock is bounded: the window gets its TTL when it is created (`SET NX
 *   EX`) and a refused attempt never extends it.
 * - When Redis does not answer, the attempt is counted in-process (per pod),
 *   as RateLimitGuard does, and nobody is trusted: never an open door.
 */
@Injectable()
export class LoginAccountLimiter {
  private readonly logger = new Logger(LoginAccountLimiter.name);

  constructor(@Inject('REDIS_CLIENT') private readonly redis: Redis) {}

  async reserve(
    email: string,
    reply?: ReplyLike,
    client?: LoginClient,
  ): Promise<LoginAttempt> {
    const digest = accountDigest(email);
    const key = `rl:auth:login:acct:${digest}`;

    let counted: { count: number; ttl: number } | undefined;
    let inRedis = false;
    if (!isRedisConnectionDown(this.redis)) {
      try {
        counted = await this.hitRedis(key);
        inRedis = true;
      } catch (err) {
        this.logger.warn(
          `[local-auth] per-account login limit counted in-process (${
            (err as Error)?.name ?? 'Error'
          })`,
        );
      }
    }
    counted ??= fallbackHit(key, Date.now());

    if (
      counted.count > LOGIN_ACCOUNT_FAILURE_LIMIT &&
      !(inRedis && (await this.isTrusted(digest, client)))
    ) {
      if (counted.count === LOGIN_ACCOUNT_FAILURE_LIMIT + 1) {
        // A digest prefix only, never the e-mail.
        this.logger.warn(
          `LOGIN_ACCOUNT_LOCKED acct=${digest.slice(0, 12)} for ${counted.ttl} s`,
        );
      }
      const retryAfter = counted.ttl;
      setHeader(reply, 'Retry-After', String(retryAfter));
      throw new HttpException(
        { message: 'RATE_LIMITED', code: 'RATE_LIMITED', retryAfter },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return inRedis
      ? this.redisAttempt(key, digest, client)
      : this.fallbackAttempt(key);
  }

  /**
   * After a successful password reset: the account's counter starts again
   * and the browser that reset it is trusted, so it can sign in at once even
   * while someone keeps failing on the account. Best-effort.
   */
  async trust(email: string, client: LoginClient): Promise<void> {
    const digest = accountDigest(email);
    const key = `rl:auth:login:acct:${digest}`;
    fallback.delete(key);
    await this.quietly(async () => {
      await this.redis.del(key);
      await this.recordTrust(digest, client);
    });
  }

  /** The trust record of a (device, account) pair, or none without a device. */
  private trustKey(
    digest: string,
    client: LoginClient | undefined,
  ): string | undefined {
    if (!client?.deviceToken) return undefined;
    return `rl:auth:login:trust:dev:${sha256(`${client.deviceToken}\n${digest}`)}`;
  }

  /** Whether the client's device signed in to (or reset) this account before. */
  private async isTrusted(
    digest: string,
    client: LoginClient | undefined,
  ): Promise<boolean> {
    const key = this.trustKey(digest, client);
    if (!key) return false;
    try {
      return (await this.redis.exists(key)) > 0;
    } catch {
      return false; // the strict side
    }
  }

  private async recordTrust(
    digest: string,
    client: LoginClient | undefined,
  ): Promise<void> {
    const key = this.trustKey(digest, client);
    if (key) await this.redis.set(key, 1, 'EX', LOGIN_TRUST_TTL_SECONDS);
  }

  /** Best-effort: a Redis error leaves the strict side (counted, untrusted). */
  private async quietly(op: () => Promise<unknown>): Promise<void> {
    try {
      await op();
    } catch (err) {
      this.logger.warn(
        `[local-auth] per-account login counter not updated (${
          (err as Error)?.name ?? 'Error'
        })`,
      );
    }
  }

  /** SET key 0 EX w NX + INCR + TTL, in one MULTI. */
  private async hitRedis(key: string): Promise<{ count: number; ttl: number }> {
    const replies = await this.redis
      .multi()
      .set(key, 0, 'EX', LOGIN_ACCOUNT_WINDOW_SECONDS, 'NX')
      .incr(key)
      .ttl(key)
      .exec();
    const [setReply, incrReply, ttlReply] = replies ?? [];
    if (!setReply || !incrReply || !ttlReply) {
      throw new Error('redis returned an incomplete rate-limit reply');
    }
    for (const [error] of [setReply, incrReply, ttlReply]) {
      if (error) throw error;
    }
    const count = incrReply[1];
    const ttl = ttlReply[1];
    if (typeof count !== 'number') {
      throw new Error('redis returned a non-numeric rate-limit count');
    }
    return {
      count,
      ttl:
        typeof ttl === 'number' && ttl > 0 ? ttl : LOGIN_ACCOUNT_WINDOW_SECONDS,
    };
  }

  private redisAttempt(
    key: string,
    digest: string,
    client: LoginClient | undefined,
  ): LoginAttempt {
    return {
      succeeded: () =>
        this.quietly(async () => {
          await this.redis.del(key);
          await this.recordTrust(digest, client);
        }),
      refund: () => this.quietly(() => this.redis.eval(REFUND_SCRIPT, 1, key)),
    };
  }

  private fallbackAttempt(key: string): LoginAttempt {
    return {
      succeeded: async () => {
        fallback.delete(key);
      },
      refund: async () => {
        const bucket = fallback.get(key);
        if (bucket && bucket.count > 0) bucket.count -= 1;
      },
    };
  }
}
