import { RpcException } from '@nestjs/microservices';
import { lastValueFrom, Observable } from 'rxjs';
import { status } from '@grpc/grpc-js';

export function propagateGrpcError(error: unknown): RpcException {
  // Accept common gRPC error shapes from @grpc/grpc-js and Nest
  // - ServiceError: { code: number, details: string }
  // - Alternate: { code: number, message: string }
  // - Fallback: unknown -> INTERNAL
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const anyErr = error as any;
    const code = typeof anyErr.code === 'number' ? anyErr.code : status.UNKNOWN;
    const message =
      (typeof anyErr.details === 'string' && anyErr.details) ||
      (typeof anyErr.message === 'string' && anyErr.message) ||
      'Internal server error';
    return new RpcException({ code, message });
  }
  return new RpcException({
    code: status.INTERNAL,
    message: 'Unexpected internal error',
  });
}

export async function safeGrpcCall<T>(observable: Observable<T>): Promise<T> {
  try {
    return await lastValueFrom(observable);
  } catch (error) {
    throw propagateGrpcError(error);
  }
}
