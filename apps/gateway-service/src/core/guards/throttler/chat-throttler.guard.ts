import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type Redis from 'ioredis';
import { clientRateLimitAddressOf } from '../../http/client-ip';
import { enforceRateLimit, rateLimitRedisTimeoutMs } from './redis-rate-limit';

/**
 * Dedicated rate-limit guard for the global chat endpoints.
 *
 * Bucket key namespace is `chat:msg:<userId>` (or `chat:msg:ip:<ip>` for
 * unauthenticated calls) to avoid collisions with the gateway-wide
 * `RateLimitGuard` (`gateway:user:*`) and billing/auth buckets.
 *
 * Default: 15 requests / 60 seconds, configurable via `CHAT_RATE_LIMIT`.
 *
 * Wired onto `POST /me/chat/conversations/:id/messages`
 * and `GET /me/chat/conversations/:id/stream`.
 */
@Injectable()
export class ChatThrottlerGuard implements CanActivate {
  private readonly namespace = 'chat:msg';
  private readonly windowSeconds = 60;
  private readonly defaultLimit = 15;
  private readonly errorMessage = 'chat_rate_limit_exceeded';

  constructor(
    protected readonly reflector: Reflector,
    private readonly configService: ConfigService,
    @Inject('REDIS_CLIENT') private readonly redisClient: Redis,
  ) {}

  /**
   * One rule with every other caller-naming route: `clientIpOf` —
   * `cf-connecting-ip` only where the edition trusts it, never in the
   * Community Edition.
   */
  private getClientIp(req: any): string {
    return clientRateLimitAddressOf(
      req,
      this.configService.get<string>('NODE_ENV'),
    );
  }

  private getTracker(req: any): string {
    if (req.user?.sub) {
      return `${this.namespace}:${req.user.sub}`;
    }
    return `${this.namespace}:ip:${this.getClientIp(req)}`;
  }

  /**
   * CHAT_RATE_LIMIT is not in the Joi schema: it arrives as the raw
   * environment string. Anything that is not a positive number (a typo, 0)
   * restores the default, so a bad value can neither turn every chat message
   * into a 500 (the bucket script needs a number) nor close the chat.
   */
  private getLimit(): number {
    const value = Number(
      this.configService.get<string | number>(
        'CHAT_RATE_LIMIT',
        this.defaultLimit,
      ),
    );
    return Number.isFinite(value) && value > 0 ? value : this.defaultLimit;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const req = http.getRequest();
    const res = http.getResponse() as any;

    const raw = res.raw ?? res;
    const setHeaderFn =
      raw.setHeader?.bind(raw) ??
      res.header?.bind(res) ??
      raw.header?.bind(raw);

    // Bounded Redis round-trips, in-process fallback: see redis-rate-limit.ts.
    return enforceRateLimit({
      redis: this.redisClient,
      tracker: this.getTracker(req),
      limit: this.getLimit(),
      windowSeconds: this.windowSeconds,
      errorMessage: this.errorMessage,
      timeoutMs: rateLimitRedisTimeoutMs(this.configService),
      setHeader: setHeaderFn,
    });
  }
}
