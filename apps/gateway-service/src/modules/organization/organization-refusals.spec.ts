import { status } from '@grpc/grpc-js';
import { HttpException } from '@nestjs/common';
import { throwError } from 'rxjs';

import {
  callWithOrganizationRefusals,
  registerOrganizationRefusalCodes,
  resetOrganizationRefusalCodesForTests,
} from './organization-refusals';

/** A grpc-js client error: the code, the message in `details`. */
const grpcError = (code: number, details: string) =>
  Object.assign(new Error(`${code} ${details}`), { code, details });

const httpErrorOf = async (promise: Promise<unknown>) => {
  const thrown = await promise.then(
    () => {
      throw new Error('expected a rejection, the call resolved');
    },
    (e: unknown) => e,
  );
  expect(thrown).toBeInstanceOf(HttpException);
  const error = thrown as HttpException;
  return { status: error.getStatus(), body: error.getResponse() };
};

describe('callWithOrganizationRefusals', () => {
  /**
   * The Community Edition gives nobody the billing manager role:
   * global-management refuses an invitation, an acceptance or a
   * role change to it FAILED_PRECONDITION `ROLE_NOT_AVAILABLE`, which the
   * dashboard reads from `body.code`.
   */
  it('answers ROLE_NOT_AVAILABLE as a 400 with its code', async () => {
    const answer = await httpErrorOf(
      callWithOrganizationRefusals(
        throwError(() =>
          grpcError(status.FAILED_PRECONDITION, 'ROLE_NOT_AVAILABLE'),
        ),
      ),
    );
    expect(answer).toEqual({
      status: 400,
      body: { code: 'ROLE_NOT_AVAILABLE', message: 'ROLE_NOT_AVAILABLE' },
    });
  });

  afterEach(() => resetOrganizationRefusalCodesForTests());

  it('keeps the usual mapping for a code no closed extension registered', async () => {
    const answer = await httpErrorOf(
      callWithOrganizationRefusals(
        throwError(() =>
          grpcError(status.FAILED_PRECONDITION, 'SOME_CLOSED_CODE'),
        ),
      ),
    );
    // safeGrpcCall's mapping: the message as the body, no `code` field.
    expect(answer.body).toBe('SOME_CLOSED_CODE');
  });

  it('answers a code a closed extension registered as a 400 with its code', async () => {
    registerOrganizationRefusalCodes(['SOME_CLOSED_CODE']);
    const answer = await httpErrorOf(
      callWithOrganizationRefusals(
        throwError(() =>
          grpcError(status.FAILED_PRECONDITION, 'SOME_CLOSED_CODE'),
        ),
      ),
    );
    expect(answer).toEqual({
      status: 400,
      body: { code: 'SOME_CLOSED_CODE', message: 'SOME_CLOSED_CODE' },
    });
  });

  it('keeps the usual mapping for a message outside the list', async () => {
    const answer = await httpErrorOf(
      callWithOrganizationRefusals(
        throwError(() =>
          grpcError(
            status.PERMISSION_DENIED,
            'User not allowed to give this role',
          ),
        ),
      ),
    );
    expect(answer.status).toBe(403);
  });
});
