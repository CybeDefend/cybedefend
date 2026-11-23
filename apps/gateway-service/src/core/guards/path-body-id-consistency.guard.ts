import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';

/**
 * Defence-in-depth guard: a body id must match the path id.
 *
 * When a route declares a path-param identifier (`:projectId`,
 * `:organizationId`, `:teamId`) AND the request body contains a same-named
 * field, this guard asserts that both values are equal. A mismatch returns
 * HTTP 400: the path id is the one the Permify check authorised, so a
 * different body id must never be forwarded to the downstream service.
 *
 * Background:
 *   - Permify guard checks `request.params.<idName>` only.
 *   - Some legacy DTOs duplicate the same identifier inside the request body.
 *   - Without this guard, the body value may be forwarded to backend
 *     microservices without any tenancy check.
 *
 * Usage:
 *   @UseGuards(PathBodyIdConsistencyGuard)
 *   @Controller(...)
 *
 * Apply at controller level so every method is covered. The preferred fix is
 * to drop the body field entirely; this guard is a safety net that catches
 * accidental regressions in DTO surfaces.
 */
@Injectable()
export class PathBodyIdConsistencyGuard implements CanActivate {
  private static readonly ID_KEYS = [
    'projectId',
    'organizationId',
    'teamId',
  ] as const;

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      params?: Record<string, unknown>;
      body?: Record<string, unknown>;
    }>();
    if (!request) return true;

    const params = request.params || {};
    const body = request.body;
    if (!body || typeof body !== 'object') return true;

    for (const key of PathBodyIdConsistencyGuard.ID_KEYS) {
      const pathValue = params[key];
      // Only check when the path actually declares this id — routes that
      // don't bind, e.g., /project/:projectId, are out of scope.
      if (pathValue === undefined || pathValue === null) continue;

      // Use Object.prototype.hasOwnProperty so we treat empty-string body
      // values as a present-but-mismatched id (still a security signal).
      if (!Object.prototype.hasOwnProperty.call(body, key)) continue;

      const bodyValue = (body as Record<string, unknown>)[key];
      if (bodyValue !== pathValue) {
        throw new BadRequestException('path/body id mismatch');
      }
    }

    return true;
  }
}
