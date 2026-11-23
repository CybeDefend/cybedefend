import { SetMetadata } from '@nestjs/common';

/**
 * Metadata key consumed by `AuthGuard` to skip Bearer-JWT verification
 * on endpoints marked `@Public()`.
 */
export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marks a controller or route handler as publicly accessible, bypassing
 * the global `AuthGuard`. Use sparingly — health, well-known, and internal
 * rotation webhooks only.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
