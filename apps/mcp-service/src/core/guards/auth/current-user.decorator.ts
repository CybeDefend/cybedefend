import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Shape of the request-scoped user context attached by `AuthGuard`
 * after successful Logto JWT verification.
 */
export interface UserContext {
  userId: string;
  accessToken: string;
}

/**
 * Parameter decorator that extracts the authenticated user set by `AuthGuard`.
 *
 * Usage: `foo(@CurrentUser() user: UserContext) { ... }`
 */
export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): UserContext => {
    return ctx.switchToHttp().getRequest().user as UserContext;
  },
);
