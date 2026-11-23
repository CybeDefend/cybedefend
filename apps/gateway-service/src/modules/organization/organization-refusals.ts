import { HttpException, HttpStatus } from '@nestjs/common';
import { lastValueFrom, Observable, throwError } from 'rxjs';

import { safeGrpcCall } from '@grpc/wrapper-grpc';

/**
 * The reasons global-management refuses a member write with, the code as
 * the gRPC message. A closed list: the dashboard shows a fixed translated
 * sentence per code, never the server's text. The core's own: a role the
 * edition does not give (`billing_manager` in the Community Edition), refused
 * for an invitation, an acceptance or a role change. A closed extension
 * registers its own codes at instantiation time.
 */
const CORE_REFUSAL_CODES: readonly string[] = ['ROLE_NOT_AVAILABLE'];

const registeredCodes = new Set<string>();

/** Idempotent: a code is registered once. */
export function registerOrganizationRefusalCodes(
  codes: readonly string[],
): void {
  for (const code of codes) registeredCodes.add(code);
}

/** Back to the core codes alone (tests). */
export function resetOrganizationRefusalCodesForTests(): void {
  registeredCodes.clear();
}

/**
 * The refusal code a gRPC client error carries as its message (grpc-js puts
 * it in `details`), or null. Only the exact code counts: a code inside a
 * sentence is not one.
 */
function refusalCodeOf(error: unknown): string | null {
  const details = (error as { details?: unknown } | null)?.details;
  const reason = typeof details === 'string' ? details.trim() : '';
  return CORE_REFUSAL_CODES.includes(reason) || registeredCodes.has(reason)
    ? reason
    : null;
}

/**
 * Awaits a member write that can be refused with one of the codes above (the
 * invitation, the role change). A refusal of the list answers 400 with that
 * code as `code` and `message`, which the dashboard switches on; any other
 * failure keeps the mapping of every other route (`safeGrpcCall`).
 */
export async function callWithOrganizationRefusals<T>(
  observable: Observable<T>,
): Promise<T> {
  try {
    return await lastValueFrom(observable);
  } catch (error) {
    const reason = refusalCodeOf(error);
    if (reason !== null) {
      throw new HttpException(
        { code: reason, message: reason },
        HttpStatus.BAD_REQUEST,
      );
    }
    return safeGrpcCall(throwError(() => error));
  }
}
