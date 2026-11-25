import {
  createParamDecorator,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { PermissionsGuard } from 'src/core/guards/permissions/permissions.guard';

/** One permission an open stream keeps needing: what PermissionsGuard checked. */
export interface StreamPermissionCheck {
  subjectType: string;
  subjectId: string;
  permission: string;
}

const PARAM_OF_SUBJECT: Readonly<Record<string, string>> = {
  organization: 'organizationId',
  team: 'teamId',
  project: 'projectId',
};

const asArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === 'string')
    : typeof value === 'string'
      ? [value]
      : [];

/**
 * The checks of a stream route, read from the same `@SubjectType` and
 * `@Permission` metadata, and the same path parameters, as PermissionsGuard.
 * A route the guard could not have let through yields no check.
 */
export function streamPermissionChecks(
  handler: object,
  params: Record<string, string | undefined> | undefined,
): StreamPermissionCheck[] {
  const subjectTypes = asArray(Reflect.getMetadata('subjectTypes', handler));
  const permissions = asArray(Reflect.getMetadata('permissions', handler));
  if (subjectTypes.length !== permissions.length) return [];
  const checks: StreamPermissionCheck[] = [];
  for (let i = 0; i < permissions.length; i++) {
    const param = PARAM_OF_SUBJECT[subjectTypes[i]];
    const subjectId = param ? params?.[param] : undefined;
    if (!subjectId) return [];
    checks.push({
      subjectType: subjectTypes[i],
      subjectId,
      permission: permissions[i],
    });
  }
  return checks;
}

/**
 * The permission checks of the stream route being served, for the stream
 * factory to repeat while the stream is open.
 */
export const StreamAuthorization = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): StreamPermissionCheck[] =>
    streamPermissionChecks(
      ctx.getHandler(),
      ctx.switchToHttp().getRequest()?.params,
    ),
);

/**
 * Repeats a stream's permission checks for its user, through the same
 * Permify call as PermissionsGuard.
 */
@Injectable()
export class StreamAuthorizer {
  constructor(private readonly permissions: PermissionsGuard) {}

  /** True when every check still holds; a failed call rejects. */
  async isAllowed(
    userId: string,
    checks: readonly StreamPermissionCheck[],
  ): Promise<boolean> {
    if (!userId || checks.length === 0) return false;
    for (const check of checks) {
      const allowed = await this.permissions.checkPermission(
        check.subjectId,
        check.subjectType,
        check.permission,
        userId,
        'user',
      );
      if (!allowed) return false;
    }
    return true;
  }
}
