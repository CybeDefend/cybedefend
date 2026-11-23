import { HttpException, HttpStatus } from '@nestjs/common';
import { lastValueFrom, Observable, throwError } from 'rxjs';

import { safeGrpcCall } from '@grpc/wrapper-grpc';

/**
 * The reasons global-management refuses an organization deletion or its
 * confirmation code with (creator only, a 6-digit code e-mailed
 * to the creator), the code as the gRPC message
 * (`global-management-service/src/modules/organization/organization-deletion-code.ts`).
 * A closed list: a client switches on `body.code`, never on the text.
 */
export const ORGANIZATION_DELETION_REFUSAL_CODES = [
  // The caller is not the organization's creator.
  'NOT_ORGANIZATION_CREATOR',
  // Wrong, expired, already used, missing or malformed: never distinguished.
  'DELETION_CODE_INVALID',
  // The current code's 5 attempts are used: ask for a new code.
  'DELETION_CODE_ATTEMPTS_EXCEEDED',
  // 60 s between two codes, 3 an hour.
  'DELETION_CODE_RATE_LIMITED',
  // 10 failed codes within 24 h locked the deletion for 24 h.
  'DELETION_LOCKED',
] as const;

export type OrganizationDeletionRefusalCode =
  (typeof ORGANIZATION_DELETION_REFUSAL_CODES)[number];

const HTTP_STATUS: Record<OrganizationDeletionRefusalCode, HttpStatus> = {
  NOT_ORGANIZATION_CREATOR: HttpStatus.FORBIDDEN,
  DELETION_CODE_INVALID: HttpStatus.BAD_REQUEST,
  DELETION_CODE_ATTEMPTS_EXCEEDED: HttpStatus.BAD_REQUEST,
  DELETION_CODE_RATE_LIMITED: HttpStatus.TOO_MANY_REQUESTS,
  DELETION_LOCKED: HttpStatus.TOO_MANY_REQUESTS,
};

/**
 * Seconds a client waits after `DELETION_CODE_RATE_LIMITED`: the 60 s between
 * two codes, sent as `Retry-After` by the global exception filter. The hourly
 * cap may last longer; a retry then answers the same refusal. `DELETION_LOCKED`
 * gets none: its 24 h are not a wait worth retrying.
 */
const RATE_LIMITED_RETRY_AFTER_SECONDS = 60;

const REFUSALS: ReadonlySet<string> = new Set(
  ORGANIZATION_DELETION_REFUSAL_CODES,
);

/**
 * The refusal code a gRPC client error carries as its message (grpc-js puts
 * it in `details`), or null. Only the exact code counts.
 */
function refusalCodeOf(error: unknown): OrganizationDeletionRefusalCode | null {
  const details = (error as { details?: unknown } | null)?.details;
  const reason = typeof details === 'string' ? details.trim() : '';
  return REFUSALS.has(reason)
    ? (reason as OrganizationDeletionRefusalCode)
    : null;
}

/**
 * Awaits a deletion or a code request. A refusal of the closed list answers
 * its status with the code as `code` and `message`; any other failure keeps
 * the mapping of every other route (`safeGrpcCall`).
 */
export async function callWithOrganizationDeletionRefusals<T>(
  observable: Observable<T>,
): Promise<T> {
  try {
    return await lastValueFrom(observable);
  } catch (error) {
    const reason = refusalCodeOf(error);
    if (reason !== null) {
      throw new HttpException(
        reason === 'DELETION_CODE_RATE_LIMITED'
          ? {
              code: reason,
              message: reason,
              retryAfter: RATE_LIMITED_RETRY_AFTER_SECONDS,
            }
          : { code: reason, message: reason },
        HTTP_STATUS[reason],
      );
    }
    return safeGrpcCall(throwError(() => error));
  }
}
