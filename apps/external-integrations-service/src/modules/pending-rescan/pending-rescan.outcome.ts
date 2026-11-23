import { status } from '@grpc/grpc-js';
import { RpcException } from '@nestjs/microservices';
import { PendingRescanOutcome } from './pending-rescan.store';

/**
 * The gRPC status of an error: an RpcException (what `safeGrpcCall` and this
 * service throw) or a raw grpc-js ServiceError (`{ code }`).
 */
function grpcCodeOf(error: unknown): number | undefined {
  if (error instanceof RpcException) {
    const payload = error.getError();
    const code =
      typeof payload === 'object' && payload !== null
        ? (payload as { code?: unknown }).code
        : undefined;
    return typeof code === 'number' ? code : undefined;
  }
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'number' ? code : undefined;
}

/**
 * Whether a scan start was refused because a scan of the same project and
 * branch is still running (security-scanning `CheckExistingScan`, also run by
 * `CreateScan`).
 */
export function isScanAlreadyInProgress(error: unknown): boolean {
  return grpcCodeOf(error) === status.ALREADY_EXISTS;
}

/**
 * The message of a gRPC error: the RpcException's (what `safeGrpcCall`
 * builds from a ServiceError's `details`) or a raw ServiceError's `details`.
 */
function grpcMessageOf(error: unknown): string | undefined {
  if (error instanceof RpcException) {
    const payload = error.getError();
    const message =
      typeof payload === 'object' && payload !== null
        ? (payload as { message?: unknown }).message
        : payload;
    return typeof message === 'string' ? message : undefined;
  }
  const details = (error as { details?: unknown } | null)?.details;
  return typeof details === 'string' ? details : undefined;
}

/**
 * The codes security-scanning answers, as the gRPC message of a
 * RESOURCE_EXHAUSTED, when CreateScan refuses a graph-only scan
 * (`scan.service.ts`, `saveGraphOnlyScanWithinLimits`; the gateway's
 * `wrapper-grpc.ts` reads the same two).
 */
const GRAPH_ONLY_LIMIT_CODES: ReadonlySet<string> = new Set([
  'GRAPH_ONLY_PROJECT_BUSY',
  'GRAPH_ONLY_ORG_LIMIT',
]);

/**
 * Whether a graph-only scan was refused by security-scanning's graph-only
 * limits: RESOURCE_EXHAUSTED with `GRAPH_ONLY_PROJECT_BUSY` (one in flight per
 * project) or `GRAPH_ONLY_ORG_LIMIT` (three per organisation) as its message.
 * Any other RESOURCE_EXHAUSTED is not a limit. The
 * project or the organisation is busy: the push is deferred, and a deferred
 * rescan stays pending.
 */
export function isGraphOnlyLimitReached(error: unknown): boolean {
  if (grpcCodeOf(error) !== status.RESOURCE_EXHAUSTED) return false;
  const message = grpcMessageOf(error);
  return message !== undefined && GRAPH_ONLY_LIMIT_CODES.has(message);
}

/**
 * Refusals that would come back identical on the next check: the project, the
 * repository or the access is gone, the request is invalid, or a quota said
 * no. Only these drop a rescan.
 */
const FINAL_REFUSALS: ReadonlySet<number> = new Set([
  status.INVALID_ARGUMENT,
  status.UNAUTHENTICATED,
  status.PERMISSION_DENIED,
  status.NOT_FOUND,
  status.FAILED_PRECONDITION,
  status.RESOURCE_EXHAUSTED,
]);

/**
 * What a failed pending rescan check means. A scan still running, a service
 * not answering, and any unexpected failure (INTERNAL, a MySQL or BullMQ
 * error, a bug) are worth another check later: the entry's TTL already
 * bounds the retries. Only a final refusal drops the rescan. A graph-only
 * limit is no final refusal: the project or the organisation is busy until
 * its graph-only scans end.
 */
export function pendingRescanOutcomeOf(
  error: unknown,
): Exclude<PendingRescanOutcome, 'started'> {
  if (isGraphOnlyLimitReached(error)) return 'busy';
  const code = grpcCodeOf(error);
  return code !== undefined && FINAL_REFUSALS.has(code) ? 'dropped' : 'busy';
}

/**
 * What a failed read of the branch head at GitHub/GitLab means: the branch
 * or the repository is gone (HTTP 404), access was revoked (HTTP 401), the
 * integration is gone (gRPC NOT_FOUND / UNAUTHENTICATED / PERMISSION_DENIED
 * raised by our own client), or the provider answered nothing usable (a
 * TypeError raised by our own parsing): drop the rescan. Anything else (5xx,
 * rate limit, network) is worth a check later.
 */
export function branchHeadOutcomeOf(
  error: unknown,
): Exclude<PendingRescanOutcome, 'started'> {
  if (error instanceof TypeError) {
    return 'dropped';
  }
  const code = grpcCodeOf(error);
  if (
    code === status.NOT_FOUND ||
    code === status.UNAUTHENTICATED ||
    code === status.PERMISSION_DENIED
  ) {
    return 'dropped';
  }
  const httpStatus =
    (error as { status?: unknown } | null)?.status ??
    (error as { response?: { status?: unknown } } | null)?.response?.status;
  return httpStatus === 404 || httpStatus === 401 ? 'dropped' : 'busy';
}
