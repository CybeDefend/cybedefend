import { status } from '@grpc/grpc-js';

/**
 * Per-call deadline for every Permify RPC.
 *
 * A Permify check carries no deadline of its own. When Permify's database pool
 * is exhausted, a guarded request would sit on a check for many seconds and
 * then surface as a 500 — the caller has already given up, but the Fastify
 * request (and its socket) is still held. 2s is well
 * past the p99 of a healthy check, including the `depth: 100` ones.
 *
 * Tuning var with a safe code default, read directly — deliberately NOT
 * registered in the Joi validation schema, per the existing convention for
 * per-feature tuning vars (`*_CONCURRENCY`, `ASYNC_TASK_TTL_MS`, …).
 */
export const DEFAULT_PERMIFY_RPC_DEADLINE_MS = 2_000;

/**
 * The rejection a timed-out Permify call produces.
 *
 * It carries a grpc-js `code` so callers classify it exactly like any other
 * gRPC client error (`error.code === status.X`) — see the repo rule that an
 * error from a gRPC CLIENT is a `ServiceError`-shaped object, never an
 * `RpcException`.
 */
export class PermifyDeadlineExceededError extends Error {
  readonly code = status.DEADLINE_EXCEEDED;

  constructor(deadlineMs: number) {
    super(`Permify call exceeded its ${deadlineMs}ms deadline`);
    this.name = 'PermifyDeadlineExceededError';
  }
}

/**
 * The call options accepted by the Permify client.
 *
 * IMPORTANT: `@permify/permify-node` talks through `nice-grpc`, whose client
 * methods are `(request, options)` and whose `CallOptions` is
 * `{ metadata, signal, onHeader, onTrailer }` — there is NO `deadline` field.
 * `createUnaryMethod` never passes a grpc-js CallOptions object to
 * `makeUnaryRequest`, so a `{ deadline }` option is silently ignored and the
 * call still hangs. `signal` is the only mechanism that actually bounds a call.
 */
export interface PermifyCallOptions {
  /**
   * Honoured by a plain grpc-js client. nice-grpc IGNORES it entirely — it is
   * carried so the shape is right if a call site ever moves to grpc-js, and so
   * that reading a call site does not suggest the deadline is unset.
   */
  deadline: number;
  /** The bound that actually applies today. */
  signal: AbortSignal;
}

export function resolvePermifyDeadlineMs(raw?: string | number | null): number {
  const parsed = typeof raw === 'number' ? raw : Number.parseInt(`${raw}`, 10);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_PERMIFY_RPC_DEADLINE_MS;
}

function createPermifyDeadline(deadlineMs: number): {
  options: PermifyCallOptions;
  dispose: () => void;
} {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new PermifyDeadlineExceededError(deadlineMs)),
    deadlineMs,
  );
  // Never hold the process open for a deadline that no longer matters.
  timer.unref?.();
  return {
    options: { deadline: Date.now() + deadlineMs, signal: controller.signal },
    dispose: () => clearTimeout(timer),
  };
}

/**
 * Build the options for one Permify RPC, bounded by `deadlineMs`.
 *
 * Prefer `withPermifyDeadline` on a hot path: the timer this creates lives for
 * the full deadline even when the call came back in 5 ms, because nothing here
 * knows when the call settled.
 */
export function permifyCallOptions(
  deadlineMs: number = DEFAULT_PERMIFY_RPC_DEADLINE_MS,
): PermifyCallOptions {
  return createPermifyDeadline(deadlineMs).options;
}

/**
 * Run one Permify RPC under a deadline, and cancel the deadline as soon as the
 * call settles.
 *
 * This is what the per-request paths use. `permifyCallOptions` alone would leave
 * one armed timer per check for the full 2 s: on the gateway guard — which runs
 * on every guarded request — that is up to 2s × RPS live timers for deadlines
 * that have already been met.
 */
export async function withPermifyDeadline<T>(
  deadlineMs: number,
  call: (options: PermifyCallOptions) => Promise<T>,
): Promise<T> {
  const { options, dispose } = createPermifyDeadline(deadlineMs);
  try {
    return await call(options);
  } finally {
    dispose();
  }
}

/**
 * True when Permify was too slow or unreachable — i.e. the caller should see a
 * 503, not a 500. Never means "allowed": every caller stays fail-closed.
 */
export function isPermifyUnavailable(error: unknown): boolean {
  const err = error as { code?: unknown; name?: unknown } | null | undefined;
  if (
    err?.code === status.DEADLINE_EXCEEDED ||
    err?.code === status.UNAVAILABLE
  ) {
    return true;
  }
  // A bare abort carries no gRPC status: `AbortSignal.timeout()` rejects with a
  // DOMException named TimeoutError (whose `code` is 23 — DOMException.
  // TIMEOUT_ERR, NOT a gRPC code), and `controller.abort()` with no reason
  // gives an AbortError. Both mean the same thing here: we stopped waiting on
  // Permify. Recognised so the 503 mapping holds however the signal was built.
  return err?.name === 'TimeoutError' || err?.name === 'AbortError';
}
