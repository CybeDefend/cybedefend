/**
 * The gRPC status of a failed client call: a grpc-js ServiceError carries
 * `code`, the RpcException rethrown by `safeGrpcCall` carries it in
 * `getError()`.
 */
export function grpcCodeOf(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const { getError, code } = err as {
    getError?: () => unknown;
    code?: unknown;
  };
  if (typeof getError === 'function') {
    const inner = getError.call(err) as { code?: unknown } | null;
    return typeof inner?.code === 'number' ? inner.code : undefined;
  }
  return typeof code === 'number' ? code : undefined;
}
