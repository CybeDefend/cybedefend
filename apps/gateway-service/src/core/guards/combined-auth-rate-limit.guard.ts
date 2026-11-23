import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from './auth/auth.guard';
import { RateLimitGuard } from './throttler/throttler.guard';

@Injectable()
export class CombinedAuthRateLimitGuard implements CanActivate {
  constructor(
    private readonly authGuard: AuthGuard,
    private readonly rateLimitGuard: RateLimitGuard,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isAuthValid = await this.authGuard.canActivate(context);
    if (!isAuthValid) return false;

    return this.rateLimitGuard.canActivate(context);
  }
}
