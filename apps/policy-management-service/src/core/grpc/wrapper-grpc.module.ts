import { RpcException } from "@nestjs/microservices";
import { lastValueFrom, Observable } from "rxjs";
import { status } from "@grpc/grpc-js";

/**
 * Propagate gRPC errors as RpcException
 * Handles common gRPC error shapes from @grpc/grpc-js and Nest
 */
export function propagateGrpcError(error: unknown): RpcException {
  if (typeof error === "object" && error !== null && "code" in error) {
    const anyErr = error as any;
    const code = typeof anyErr.code === "number" ? anyErr.code : status.UNKNOWN;
    const message =
      (typeof anyErr.details === "string" && anyErr.details) ||
      (typeof anyErr.message === "string" && anyErr.message) ||
      "Internal server error";
    return new RpcException({ code, message });
  }
  return new RpcException({
    code: status.INTERNAL,
    message: "Unexpected internal error",
  });
}

/**
 * Safely execute a gRPC call and propagate errors properly
 * @param observable - The gRPC observable to execute
 * @returns Promise resolving to the response
 * @throws RpcException on failure
 */
export async function safeGrpcCall<T>(observable: Observable<T>): Promise<T> {
  try {
    return await lastValueFrom(observable);
  } catch (error) {
    throw propagateGrpcError(error);
  }
}
