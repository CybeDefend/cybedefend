import { HttpException, HttpStatus } from '@nestjs/common';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { TimeoutError } from 'rxjs';
import { LOCAL_AUTH_REFUSALS, toLocalAuthHttpError } from './local-auth-errors';

const grpcError = (code: number, details: string) =>
  Object.assign(new Error(`${code} X: ${details}`), { code, details });

describe('local auth refusals', () => {
  it('is the closed list of local auth refusals', () => {
    expect(LOCAL_AUTH_REFUSALS).toEqual({
      INVALID_CREDENTIALS: 401,
      REFRESH_RACE: 409,
      REFRESH_INVALID: 401,
      SETUP_TOKEN_INVALID: 403,
      SETUP_CLOSED: 409,
      SETUP_REQUIRED: 409,
      SIGNUP_DISABLED: 403,
      ACCOUNT_EXISTS: 409,
      PASSWORD_POLICY: 400,
      CURRENT_PASSWORD_INVALID: 400,
      RESET_TOKEN_INVALID: 400,
      INVITATION_INVALID: 400,
      PAT_NOT_FOUND: 404,
      PAT_NAME_INVALID: 400,
      PAT_EXPIRY_INVALID: 400,
      PAT_NAME_TAKEN: 409,
      PAT_LIMIT_REACHED: 409,
    });
  });

  it.each(Object.entries(LOCAL_AUTH_REFUSALS))(
    'maps %s to its HTTP status and body code',
    (code, httpStatus) => {
      const err = toLocalAuthHttpError(grpcError(GrpcStatus.UNKNOWN, code));
      expect(err).toBeInstanceOf(HttpException);
      expect(err.getStatus()).toBe(httpStatus);
      expect(err.getResponse()).toEqual({ message: code, code });
    },
  );

  it('maps ACCOUNT_EXISTS to 409 and SIGNUP_DISABLED to 403', () => {
    expect(
      toLocalAuthHttpError(
        grpcError(GrpcStatus.ALREADY_EXISTS, 'ACCOUNT_EXISTS'),
      ).getStatus(),
    ).toBe(HttpStatus.CONFLICT);
    expect(
      toLocalAuthHttpError(
        grpcError(GrpcStatus.FAILED_PRECONDITION, 'SIGNUP_DISABLED'),
      ).getStatus(),
    ).toBe(HttpStatus.FORBIDDEN);
  });

  it('hides an unknown server text', () => {
    const err = toLocalAuthHttpError(
      grpcError(GrpcStatus.INTERNAL, 'SQL boom'),
    );
    expect(err.getStatus()).toBe(500);
    expect(err.getResponse()).toEqual({
      message: 'AUTH_ERROR',
      code: 'AUTH_ERROR',
    });
    expect(JSON.stringify(err.getResponse())).not.toContain('SQL');
    expect(err.message).not.toContain('SQL');
  });

  it('does not read a code from the prototype chain', () => {
    expect(
      toLocalAuthHttpError(
        grpcError(GrpcStatus.UNKNOWN, 'constructor'),
      ).getStatus(),
    ).toBe(500);
  });

  it('has no REFRESH_REUSED', () => {
    expect(Object.keys(LOCAL_AUTH_REFUSALS)).not.toContain('REFRESH_REUSED');
  });

  it.each([
    ['UNAVAILABLE', grpcError(GrpcStatus.UNAVAILABLE, 'No connection')],
    ['DEADLINE_EXCEEDED', grpcError(GrpcStatus.DEADLINE_EXCEEDED, 'late')],
    ['an rxjs timeout', new TimeoutError()],
  ])('maps %s to 503 AUTH_UNAVAILABLE', (_name, error) => {
    const err = toLocalAuthHttpError(error);
    expect(err.getStatus()).toBe(503);
    expect(err.getResponse()).toEqual({
      message: 'AUTH_UNAVAILABLE',
      code: 'AUTH_UNAVAILABLE',
    });
  });

  it('answers 500 AUTH_ERROR for anything that is not a gRPC error', () => {
    expect(toLocalAuthHttpError('boom').getStatus()).toBe(500);
    expect(toLocalAuthHttpError(undefined).getStatus()).toBe(500);
  });
});
