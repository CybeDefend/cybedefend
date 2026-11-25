import { createHash } from 'node:crypto';
import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type Redis from 'ioredis';
import { isEmail } from 'class-validator';
import { clientRateLimitAddressOf } from 'src/core/http/client-ip';

/** Login: 10 per (address, e-mail) and 100 per address per 15 min. */
export const LOGIN_IP_EMAIL_LIMIT = 10;
export const LOGIN_IP_LIMIT = 100;
export const LOGIN_WINDOW_SECONDS = 900;
/**
 * Password reset request, per hour: 3 per (address, e-mail), 30 per e-mail
 * from any address, 100 per address. The strict budget is keyed on the
 * address too, so a caller who knows someone's e-mail cannot spend the
 * owner's. The wider one per e-mail bounds the mail one inbox receives (at
 * most 30 reset mails an hour); a request counts there only once the
 * stricter buckets admitted it, so filling it takes 10 addresses or more.
 */
export const RESET_IP_EMAIL_LIMIT = 3;
export const RESET_EMAIL_LIMIT = 30;
export const RESET_IP_LIMIT = 100;
export const RESET_WINDOW_SECONDS = 3600;
/** Setup, reset confirmation, invitation acceptance. */
export const AUTH_IP_LIMIT = 10;
export const AUTH_IP_WINDOW_SECONDS = 900;
/** Open sign-up. */
export const SIGNUP_IP_LIMIT = 10;
export const SIGNUP_WINDOW_SECONDS = 3600;
/** Password change, per signed-in user. */
export const PASSWORD_CHANGE_USER_LIMIT = 10;
export const PASSWORD_CHANGE_WINDOW_SECONDS = 900;

export const AUTH_RATE_LIMIT_KIND = 'authRateLimitKind';
export type AuthRateLimitKind =
  | 'login'
  | 'reset'
  | 'ip'
  | 'signup'
  | 'password-change';

/** Names the buckets a route counts. A route without it counts nothing. */
export const AuthRateLimit = (kind: AuthRateLimitKind) =>
  SetMetadata(AUTH_RATE_LIMIT_KIND, kind);

interface Bucket {
  key: string;
  limit: number;
  windowSeconds: number;
}

interface GuardedRequest {
  ip?: unknown;
  headers?: Record<string, unknown>;
  body?: unknown;
  user?: { sub?: unknown };
}

interface ReplyLike {
  header?: (name: string, value: string) => unknown;
  raw?: { setHeader?: (name: string, value: string) => unknown };
}

const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');

/** The body's e-mail, trimmed and lower-cased, or '' when there is none. */
function emailOf(req: GuardedRequest): string {
  const email = (req.body as { email?: unknown } | null | undefined)?.email;
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

/** The longest e-mail the reset route accepts (its body DTO). */
const RESET_EMAIL_MAX_LENGTH = 254;

/**
 * The reset body's e-mail, lower-cased, only when the route's body DTO would
 * accept it (`@IsEmail()`, `@MaxLength(254)`, the value as sent): a request
 * the route refuses counts against the address alone.
 */
function validResetEmailOf(req: GuardedRequest): string {
  const email = (req.body as { email?: unknown } | null | undefined)?.email;
  if (typeof email !== 'string' || email.length > RESET_EMAIL_MAX_LENGTH) {
    return '';
  }
  return isEmail(email) ? email.toLowerCase() : '';
}

function setHeader(reply: ReplyLike | undefined, name: string, value: string) {
  if (typeof reply?.header === 'function') {
    reply.header(name, value);
  } else {
    reply?.raw?.setHeader?.(name, value);
  }
}

/**
 * Rate limits of the Community auth routes, in
 * the gateway's Redis. Each route names its kind with `@AuthRateLimit`; the
 * guard counts the buckets of that kind one after the other, the strictest
 * first (each in one MULTI: `SET key 0 EX w NX` + `INCR`, so a window is
 * created with its TTL and never extended, the shape of
 * SsoConnectorsRateLimitGuard), and refuses the request at the first bucket
 * over its limit: 429 `RATE_LIMITED` with `Retry-After`. A refused request is
 * not counted in the wider buckets after it, so it never spends a budget
 * other callers share. A Redis failure
 * is a 503 `rate_limit_unavailable`, never an open door.
 *
 * The address is `clientIpOf` (`cf-connecting-ip` is never read in the
 * Community Edition). An e-mail is stored only as a SHA-256 digest. On a
 * `password-change` route the bucket is the user, so the guard is listed
 * after the authentication guard.
 *
 * It also marks every answer of the routes it guards `Cache-Control:
 * no-store`, a refusal included.
 */
@Injectable()
export class LocalAuthRateLimitGuard implements CanActivate {
  private readonly logger = new Logger(LocalAuthRateLimitGuard.name);

  constructor(
    private readonly config: ConfigService,
    private readonly reflector: Reflector,
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const req = http.getRequest<GuardedRequest>();
    const reply = http.getResponse<ReplyLike>();
    setHeader(reply, 'Cache-Control', 'no-store');

    const kind = this.reflector.getAllAndOverride<AuthRateLimitKind>(
      AUTH_RATE_LIMIT_KIND,
      [context.getHandler(), context.getClass()],
    );
    if (!kind) return true;

    const buckets = this.bucketsOf(kind, req);
    let over: Bucket | undefined;
    try {
      for (const bucket of buckets) {
        const [count] = await this.hit([bucket]);
        if (count > bucket.limit) {
          over = bucket;
          break;
        }
      }
      if (over) {
        const ttl = await this.redis.ttl(over.key);
        const retryAfter = ttl > 0 ? ttl : over.windowSeconds;
        setHeader(reply, 'Retry-After', String(retryAfter));
        throw new HttpException(
          { message: 'RATE_LIMITED', code: 'RATE_LIMITED', retryAfter },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    } catch (err) {
      if (err instanceof HttpException) throw err;
      // The error's class only: a driver message may quote a key.
      this.logger.warn(
        `[local-auth] rate limit backend unavailable (${
          (err as Error)?.name ?? 'Error'
        })`,
      );
      throw new ServiceUnavailableException('rate_limit_unavailable');
    }
    return true;
  }

  private bucketsOf(kind: AuthRateLimitKind, req: GuardedRequest): Bucket[] {
    if (kind === 'password-change') {
      const sub = req.user?.sub;
      if (typeof sub !== 'string' || !sub) {
        throw new UnauthorizedException();
      }
      return [
        {
          key: `rl:auth:password-change:user:${sub}`,
          limit: PASSWORD_CHANGE_USER_LIMIT,
          windowSeconds: PASSWORD_CHANGE_WINDOW_SECONDS,
        },
      ];
    }

    const ip =
      clientRateLimitAddressOf(req, this.config.get<string>('NODE_ENV')) ||
      'unknown';
    switch (kind) {
      case 'login': {
        const email = emailOf(req);
        const byIp: Bucket = {
          key: `rl:auth:login:ip:${ip}`,
          limit: LOGIN_IP_LIMIT,
          windowSeconds: LOGIN_WINDOW_SECONDS,
        };
        return email
          ? [
              {
                key: `rl:auth:login:ipmail:${sha256(`${ip}\n${email}`)}`,
                limit: LOGIN_IP_EMAIL_LIMIT,
                windowSeconds: LOGIN_WINDOW_SECONDS,
              },
              byIp,
            ]
          : [byIp];
      }
      case 'reset': {
        const email = validResetEmailOf(req);
        const byIp: Bucket = {
          key: `rl:auth:reset:ip:${ip}`,
          limit: RESET_IP_LIMIT,
          windowSeconds: RESET_WINDOW_SECONDS,
        };
        // Strictest first: a request refused by one is not counted after it.
        return email
          ? [
              {
                key: `rl:auth:reset:ipmail:${sha256(`${ip}\n${email}`)}`,
                limit: RESET_IP_EMAIL_LIMIT,
                windowSeconds: RESET_WINDOW_SECONDS,
              },
              byIp,
              {
                key: `rl:auth:reset:mail:${sha256(email)}`,
                limit: RESET_EMAIL_LIMIT,
                windowSeconds: RESET_WINDOW_SECONDS,
              },
            ]
          : [byIp];
      }
      case 'signup':
        return [
          {
            key: `rl:auth:signup:ip:${ip}`,
            limit: SIGNUP_IP_LIMIT,
            windowSeconds: SIGNUP_WINDOW_SECONDS,
          },
        ];
      case 'ip':
      default:
        return [
          {
            key: `rl:auth:ip:${ip}`,
            limit: AUTH_IP_LIMIT,
            windowSeconds: AUTH_IP_WINDOW_SECONDS,
          },
        ];
    }
  }

  /** Counts one hit in every bucket given, in a single round-trip. */
  private async hit(buckets: Bucket[]): Promise<number[]> {
    let multi = this.redis.multi();
    for (const bucket of buckets) {
      multi = multi
        .set(bucket.key, 0, 'EX', bucket.windowSeconds, 'NX')
        .incr(bucket.key);
    }
    const replies = await multi.exec();
    return buckets.map((_bucket, i) => {
      // The SET gives the key its TTL: without it the counter counts forever.
      const setError = replies?.[2 * i]?.[0];
      if (setError) throw setError;
      const incrReply = replies?.[2 * i + 1];
      if (!incrReply) {
        throw new Error('redis returned no INCR reply for a rate-limit bucket');
      }
      const [error, count] = incrReply;
      if (error) throw error;
      if (typeof count !== 'number') {
        throw new Error('redis returned a non-numeric rate-limit count');
      }
      return count;
    });
  }
}
