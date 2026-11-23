import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import {
  LOCAL_AUTH_REFUSAL_STATUS,
  localAuthRefusal,
  type LocalAuthRefusalCode,
} from './local-auth-refusals';

/**
 * The closed list of local-auth refusals (minus the
 * gateway-only codes): the gRPC message is always the code, and each code
 * has a fixed gRPC status.
 */
describe('local-auth refusals', () => {
  it('maps every code to the status of the closed list', () => {
    expect(LOCAL_AUTH_REFUSAL_STATUS).toEqual({
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
    });
  });

  it('has no REFRESH_REUSED key: a reuse answers REFRESH_INVALID', () => {
    expect('REFRESH_REUSED' in LOCAL_AUTH_REFUSAL_STATUS).toBe(false);
    expect(Object.keys(LOCAL_AUTH_REFUSAL_STATUS)).toHaveLength(18);
  });

  it('localAuthRefusal throws an RpcException whose message is the code', () => {
    const codes = Object.keys(
      LOCAL_AUTH_REFUSAL_STATUS,
    ) as LocalAuthRefusalCode[];
    for (const code of codes) {
      const err = localAuthRefusal(code);
      expect(err).toBeInstanceOf(RpcException);
      expect(err.getError()).toEqual({
        code: LOCAL_AUTH_REFUSAL_STATUS[code],
        message: code,
      });
    }
  });
});
