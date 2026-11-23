import {
  Injectable,
  ExecutionContext,
  Inject,
  CanActivate,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type Redis from 'ioredis';
import { clientRateLimitAddressOf } from '../../http/client-ip';
import { enforceRateLimit, rateLimitRedisTimeoutMs } from './redis-rate-limit';

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly namespace = 'gateway';

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

  private getRateLimitTracker(req: any): string {
    if (req.user?.sub) {
      return `${this.namespace}:user:${req.user.sub}`;
    }

    const clientIp = this.getClientIp(req);
    return `${this.namespace}:ip:${clientIp}`;
  }

  private getRateLimitValue(req: any): number {
    const cfg = this.configService;

    if (req.user?.sub) {
      return cfg.get<number>('USER_RATE_LIMIT', 300);
    }

    return cfg.get<number>('IP_RATE_LIMIT', 100);
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
      tracker: this.getRateLimitTracker(req),
      limit: this.getRateLimitValue(req),
      windowSeconds: 60,
      errorMessage: 'Too many requests',
      timeoutMs: rateLimitRedisTimeoutMs(this.configService),
      setHeader: setHeaderFn,
    });
  }
}
