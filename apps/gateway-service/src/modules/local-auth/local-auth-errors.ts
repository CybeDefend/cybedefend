import { HttpException, HttpStatus } from '@nestjs/common';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { TimeoutError } from 'rxjs';

/**
 * The local auth refusals: every refusal
 * global-management's LocalAuthService sends as its gRPC message, and the
 * HTTP status the gateway answers it with. A closed list: a message that is
 * not in it is never shown (500 AUTH_ERROR). There is no REFRESH_REUSED: a
 * reused refresh token is answered REFRESH_INVALID.
 */
export const LOCAL_AUTH_REFUSALS: Readonly<Record<string, HttpStatus>> =
  Object.freeze({
    INVALID_CREDENTIALS: HttpStatus.UNAUTHORIZED,
    REFRESH_RACE: HttpStatus.CONFLICT,
    REFRESH_INVALID: HttpStatus.UNAUTHORIZED,
    SETUP_TOKEN_INVALID: HttpStatus.FORBIDDEN,
    SETUP_CLOSED: HttpStatus.CONFLICT,
    SETUP_REQUIRED: HttpStatus.CONFLICT,
    SIGNUP_DISABLED: HttpStatus.FORBIDDEN,
    ACCOUNT_EXISTS: HttpStatus.CONFLICT,
    PASSWORD_POLICY: HttpStatus.BAD_REQUEST,
    CURRENT_PASSWORD_INVALID: HttpStatus.BAD_REQUEST,
    RESET_TOKEN_INVALID: HttpStatus.BAD_REQUEST,
    INVITATION_INVALID: HttpStatus.BAD_REQUEST,
    PAT_NOT_FOUND: HttpStatus.NOT_FOUND,
    PAT_NAME_INVALID: HttpStatus.BAD_REQUEST,
    PAT_EXPIRY_INVALID: HttpStatus.BAD_REQUEST,
    PAT_NAME_TAKEN: HttpStatus.CONFLICT,
    PAT_LIMIT_REACHED: HttpStatus.CONFLICT,
  });

/**
 * The refusals the gateway decides on its own, before any call: never read
 * from a gRPC message, so global-management cannot answer one of them.
 * AUTH_ORIGIN_FORBIDDEN: a cookie-authenticated route (refresh, logout) sent
 * from an origin other than the instance's own (Community edition).
 */
export const AUTH_ORIGIN_FORBIDDEN = 'AUTH_ORIGIN_FORBIDDEN';

export const LOCAL_AUTH_GATEWAY_REFUSALS: Readonly<Record<string, HttpStatus>> =
  Object.freeze({
    [AUTH_ORIGIN_FORBIDDEN]: HttpStatus.FORBIDDEN,
  });

export const AUTH_UNAVAILABLE = 'AUTH_UNAVAILABLE';
export const AUTH_ERROR = 'AUTH_ERROR';

/** A refusal body: the code as the message and as `code`, nothing else. */
export function localAuthRefusal(
  code: string,
  status: HttpStatus,
): HttpException {
  return new HttpException({ message: code, code }, status);
}

const UNAVAILABLE_STATUSES: ReadonlySet<number> = new Set([
  GrpcStatus.UNAVAILABLE,
  GrpcStatus.DEADLINE_EXCEEDED,
]);

/** The gRPC status of a grpc-js ServiceError, if it is one. */
export function grpcCodeOf(err: unknown): number | undefined {
  const code = (err as { code?: unknown } | null | undefined)?.code;
  return typeof code === 'number' ? code : undefined;
}

/**
 * The HTTP answer to a failed LocalAuthService call. A known code keeps its
 * status; an unreachable or late global-management is 503 AUTH_UNAVAILABLE;
 * anything else is 500 AUTH_ERROR, never the server's text.
 */
export function toLocalAuthHttpError(err: unknown): HttpException {
  if (err instanceof TimeoutError) {
    return localAuthRefusal(AUTH_UNAVAILABLE, HttpStatus.SERVICE_UNAVAILABLE);
  }
  const details = (err as { details?: unknown } | null | undefined)?.details;
  const code = typeof details === 'string' ? details.trim() : '';
  if (code && Object.prototype.hasOwnProperty.call(LOCAL_AUTH_REFUSALS, code)) {
    return localAuthRefusal(code, LOCAL_AUTH_REFUSALS[code]);
  }
  const grpc = grpcCodeOf(err);
  if (grpc !== undefined && UNAVAILABLE_STATUSES.has(grpc)) {
    return localAuthRefusal(AUTH_UNAVAILABLE, HttpStatus.SERVICE_UNAVAILABLE);
  }
  return localAuthRefusal(AUTH_ERROR, HttpStatus.INTERNAL_SERVER_ERROR);
}

/** The code of a refusal built by this file, or undefined. */
export function refusalCodeOf(err: unknown): string | undefined {
  if (!(err instanceof HttpException)) return undefined;
  const body = err.getResponse();
  const code = (body as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}
