import { status } from '@grpc/grpc-js';
import { RpcException } from '@nestjs/microservices';
import { grpcCodeOf } from './grpc-status.util';

describe('grpcCodeOf', () => {
  it('reads the code of a grpc-js ServiceError', () => {
    expect(
      grpcCodeOf({ code: status.UNIMPLEMENTED, details: 'unknown method' }),
    ).toBe(status.UNIMPLEMENTED);
  });

  it('reads the code of the RpcException safeGrpcCall rethrows', () => {
    expect(
      grpcCodeOf(
        new RpcException({ code: status.UNAVAILABLE, message: 'down' }),
      ),
    ).toBe(status.UNAVAILABLE);
  });

  it('has none for anything else', () => {
    expect(grpcCodeOf(new Error('ECONNRESET'))).toBeUndefined();
    expect(grpcCodeOf(new RpcException('no code'))).toBeUndefined();
    expect(grpcCodeOf(undefined)).toBeUndefined();
  });
});
