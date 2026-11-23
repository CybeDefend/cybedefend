import { status } from '@grpc/grpc-js';
import { RpcException } from '@nestjs/microservices';
import { isGrpcClientError } from './wrapper-grpc.module';

describe('isGrpcClientError', () => {
  it.each([
    status.INVALID_ARGUMENT,
    status.UNAUTHENTICATED,
    status.PERMISSION_DENIED,
    status.NOT_FOUND,
    status.ALREADY_EXISTS,
    status.FAILED_PRECONDITION,
    status.RESOURCE_EXHAUSTED,
  ])('classifies gRPC code %i as a client error', (code) => {
    expect(
      isGrpcClientError(new RpcException({ code, message: 'client error' })),
    ).toBe(true);
  });

  it.each([
    status.UNKNOWN,
    status.INTERNAL,
    status.UNAVAILABLE,
    status.DEADLINE_EXCEEDED,
  ])('does not classify gRPC code %i as a client error', (code) => {
    expect(
      isGrpcClientError(new RpcException({ code, message: 'server error' })),
    ).toBe(false);
  });

  it('does not classify unstructured errors as client errors', () => {
    expect(isGrpcClientError(new Error('boom'))).toBe(false);
    expect(isGrpcClientError(new RpcException('boom'))).toBe(false);
  });
});
