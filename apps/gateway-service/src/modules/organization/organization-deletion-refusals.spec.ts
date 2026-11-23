import { HttpException } from '@nestjs/common';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { of, throwError } from 'rxjs';

import {
  ORGANIZATION_DELETION_REFUSAL_CODES,
  callWithOrganizationDeletionRefusals,
} from './organization-deletion-refusals';

const refusal = (code: number, details: string) =>
  throwError(() =>
    Object.assign(new Error(`${code} X: ${details}`), { code, details }),
  );

async function thrown(promise: Promise<unknown>): Promise<HttpException> {
  const e = await promise.then(
    () => undefined,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(HttpException);
  return e as HttpException;
}

describe('organization deletion refusals', () => {
  it('is the closed list global-management throws', () => {
    expect([...ORGANIZATION_DELETION_REFUSAL_CODES]).toEqual([
      'NOT_ORGANIZATION_CREATOR',
      'DELETION_CODE_INVALID',
      'DELETION_CODE_ATTEMPTS_EXCEEDED',
      'DELETION_CODE_RATE_LIMITED',
      'DELETION_LOCKED',
    ]);
  });

  it.each([
    ['NOT_ORGANIZATION_CREATOR', GrpcStatus.PERMISSION_DENIED, 403],
    ['DELETION_CODE_INVALID', GrpcStatus.INVALID_ARGUMENT, 400],
    ['DELETION_CODE_ATTEMPTS_EXCEEDED', GrpcStatus.FAILED_PRECONDITION, 400],
    ['DELETION_CODE_RATE_LIMITED', GrpcStatus.RESOURCE_EXHAUSTED, 429],
    ['DELETION_LOCKED', GrpcStatus.RESOURCE_EXHAUSTED, 429],
  ])('%s (gRPC %i) answers %i with the code', async (code, grpc, http) => {
    const e = await thrown(
      callWithOrganizationDeletionRefusals(refusal(grpc, code)),
    );
    expect(e.getStatus()).toBe(http);
    expect(e.getResponse()).toMatchObject({ code, message: code });
  });

  it('DELETION_CODE_RATE_LIMITED carries retryAfter 60, the other refusals none', async () => {
    const limited = await thrown(
      callWithOrganizationDeletionRefusals(
        refusal(GrpcStatus.RESOURCE_EXHAUSTED, 'DELETION_CODE_RATE_LIMITED'),
      ),
    );
    expect(limited.getResponse()).toEqual({
      code: 'DELETION_CODE_RATE_LIMITED',
      message: 'DELETION_CODE_RATE_LIMITED',
      retryAfter: 60,
    });
  });

  it('UNIMPLEMENTED (an older global-management) is an error, 501', async () => {
    const e = await thrown(
      callWithOrganizationDeletionRefusals(
        refusal(GrpcStatus.UNIMPLEMENTED, 'not implemented'),
      ),
    );
    expect(e.getStatus()).toBe(501);
  });

  it('any other failure keeps the mapping of every other route, with no code', async () => {
    const e = await thrown(
      callWithOrganizationDeletionRefusals(
        refusal(GrpcStatus.NOT_FOUND, 'Organization not found'),
      ),
    );
    expect(e.getStatus()).toBe(404);
    expect((e.getResponse() as { code?: string }).code).toBeUndefined();
  });

  it('a code inside a sentence is not the code', async () => {
    const e = await thrown(
      callWithOrganizationDeletionRefusals(
        refusal(GrpcStatus.INVALID_ARGUMENT, 'DELETION_CODE_INVALID for o1'),
      ),
    );
    expect(e.getStatus()).toBe(400);
    expect((e.getResponse() as { code?: string }).code).toBeUndefined();
  });

  it('answers the value on success', async () => {
    await expect(
      callWithOrganizationDeletionRefusals(of({ expiresAt: 'x' })),
    ).resolves.toEqual({ expiresAt: 'x' });
  });
});
