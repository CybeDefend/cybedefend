import { Logger } from '@nestjs/common';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { lastValueFrom, Observable, throwError } from 'rxjs';
import { safeGrpcCall } from '@grpc/wrapper-grpc';

/**
 * Wait before the single retry of a provider webhook relay.
 * Long enough to outlast an envoy "no healthy upstream" while a pod is
 * replaced, short enough for GitHub's and GitLab's 10 s delivery timeout.
 */
export const WEBHOOK_RELAY_RETRY_DELAY_MS = 1_000;

const logger = new Logger('WebhookRelay');

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** The shape of GitHub's `x-hub-signature-256` header (HMAC in EI). */
export const GITHUB_SIGNATURE_PATTERN = /^sha256=[0-9a-f]{64}$/;

/**
 * Relays a GitHub or GitLab webhook to external-integrations, retrying ONCE
 * when the call fails with UNAVAILABLE.
 *
 * GitHub does not redeliver a failed webhook by itself, so a 503 answered
 * while external-integrations (or its envoy) is being replaced lost the push,
 * branch or installation event for good (US: 8 × "no healthy upstream" and
 * 5 × "Connection refused" in a week).
 *
 * UNAVAILABLE has two sources. The transport: envoy has no healthy upstream
 * or the connection is refused, and external-integrations never saw the
 * call. Or a service external-integrations called itself: its handlers pass
 * a downstream status through unchanged (`propagateGrpcError`), so EI may
 * have done part of the work before answering UNAVAILABLE. Sending the event
 * again is safe in both cases, because EI handles a replayed delivery: the
 * installation, repository and branch events are idempotent, and a replayed
 * push meets ALREADY_EXISTS, whose rescan is skipped for the commit whose
 * scan already started. Every other status is an answer (a refused signature,
 * an internal error) and is returned as before, never retried.
 *
 * Errors keep the mapping of `safeGrpcCall`, so the HTTP answer is unchanged
 * apart from the retry.
 *
 * @param call issues the gRPC call; called again for the retry.
 * @param options.retryOnUnavailable false for a request that cannot be the
 *   provider's (no or malformed credential): it gets one call only, so a
 *   forged request costs neither a second call nor a second of connection.
 *   Its credential is still checked, and refused, by external-integrations.
 */
export async function relayWebhook<T>(
  call: () => Observable<T>,
  options: { retryOnUnavailable: boolean } = { retryOnUnavailable: true },
): Promise<T> {
  try {
    return await lastValueFrom(call());
  } catch (error: unknown) {
    if (
      !options.retryOnUnavailable ||
      (error as { code?: unknown } | null)?.code !== GrpcStatus.UNAVAILABLE
    ) {
      return safeGrpcCall<T>(throwError(() => error));
    }
    logger.warn(
      `Webhook relay to external-integrations UNAVAILABLE, retrying once in ${WEBHOOK_RELAY_RETRY_DELAY_MS} ms`,
    );
  }
  await wait(WEBHOOK_RELAY_RETRY_DELAY_MS);
  return safeGrpcCall(call());
}
