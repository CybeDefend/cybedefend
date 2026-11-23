import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';

/**
 * The closed list of local-auth refusals (minus the
 * gateway-only RATE_LIMITED, PAT_NOT_ALLOWED, AUTH_UNAVAILABLE and AUTH_ERROR):
 * the gRPC message is always the code, never free text. A reused refresh token
 * answers REFRESH_INVALID like an unknown one; only the log line says
 * AUTH_REFRESH_REUSE, so there is no REFRESH_REUSED code.
 */
export type LocalAuthRefusalCode =
  | 'INVALID_CREDENTIALS'
  | 'REFRESH_INVALID'
  | 'REFRESH_RACE'
  | 'PASSWORD_POLICY'
  | 'CURRENT_PASSWORD_INVALID'
  | 'RESET_TOKEN_INVALID'
  | 'INVITATION_INVALID'
  | 'SETUP_TOKEN_INVALID'
  | 'SETUP_CLOSED'
  | 'SETUP_REQUIRED'
  | 'SIGNUP_DISABLED'
  | 'ACCOUNT_EXISTS'
  | 'PAT_INVALID'
  | 'PAT_NAME_INVALID'
  | 'PAT_EXPIRY_INVALID'
  | 'PAT_LIMIT_REACHED'
  | 'PAT_NAME_TAKEN'
  | 'PAT_NOT_FOUND';

/** The gRPC status of every refusal. */
export const LOCAL_AUTH_REFUSAL_STATUS: Readonly<
  Record<LocalAuthRefusalCode, status>
> = {
  INVALID_CREDENTIALS: status.UNAUTHENTICATED,
  REFRESH_INVALID: status.UNAUTHENTICATED,
  REFRESH_RACE: status.ABORTED,
  PASSWORD_POLICY: status.INVALID_ARGUMENT,
  CURRENT_PASSWORD_INVALID: status.INVALID_ARGUMENT,
  RESET_TOKEN_INVALID: status.INVALID_ARGUMENT,
  INVITATION_INVALID: status.INVALID_ARGUMENT,
  SETUP_TOKEN_INVALID: status.PERMISSION_DENIED,
  SETUP_CLOSED: status.FAILED_PRECONDITION,
  SETUP_REQUIRED: status.FAILED_PRECONDITION,
  SIGNUP_DISABLED: status.FAILED_PRECONDITION,
  ACCOUNT_EXISTS: status.ALREADY_EXISTS,
  PAT_INVALID: status.UNAUTHENTICATED,
  PAT_NAME_INVALID: status.INVALID_ARGUMENT,
  PAT_EXPIRY_INVALID: status.INVALID_ARGUMENT,
  PAT_LIMIT_REACHED: status.RESOURCE_EXHAUSTED,
  PAT_NAME_TAKEN: status.ALREADY_EXISTS,
  PAT_NOT_FOUND: status.NOT_FOUND,
};

/** The refusal as an RpcException: the status of the table, the message = the code. */
export function localAuthRefusal(code: LocalAuthRefusalCode): RpcException {
  return new RpcException({
    code: LOCAL_AUTH_REFUSAL_STATUS[code],
    message: code,
  });
}
