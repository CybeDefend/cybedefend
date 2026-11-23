import * as crypto from 'node:crypto';

/**
 * Webhook signature verification helpers.
 *
 * Designed for the three external webhook flows we receive (GitHub HMAC,
 * GitLab plain shared-secret token, Logto HMAC). Hashes are always computed
 * over the **raw** request body bytes — never re-serialized JSON — so a
 * malicious payload that re-orders keys or adds whitespace cannot bypass
 * verification.
 *
 * All comparisons use {@link crypto.timingSafeEqual} after a length-equal
 * precondition (length is publicly known and timing-safe to leak).
 */

/**
 * Compute the HMAC of `body` using `secret` and return it as a hex string.
 *
 * @param body Raw bytes (or UTF-8 string) of the webhook payload — MUST be
 *             the exact bytes the sender signed; do not JSON-parse and
 *             re-stringify.
 * @param secret Shared signing secret.
 * @param algo Hash algorithm. Defaults to 'sha256'.
 */
export function computeHmacHex(
  body: Buffer | string,
  secret: string,
  algo: string = 'sha256',
): string {
  return crypto.createHmac(algo, secret).update(body).digest('hex');
}

/**
 * Verify an HMAC signature in constant time.
 *
 * Strips an optional `<algo>=` prefix (e.g. `sha256=...` for GitHub) before
 * comparing. Length-mismatch fast-fails before {@link crypto.timingSafeEqual}
 * to avoid the synchronous throw that function performs on unequal lengths.
 *
 * Returns `false` (never throws) for any malformed/empty input — callers
 * decide the appropriate HTTP / gRPC error.
 */
export function verifyHmacSignature(
  body: Buffer | string,
  candidateSignatureHex: string | undefined | null,
  secret: string,
  algo: string = 'sha256',
): boolean {
  if (!candidateSignatureHex || typeof candidateSignatureHex !== 'string') {
    return false;
  }

  // Some senders prefix the signature with the algorithm name (e.g.
  // GitHub's `sha256=<hex>`). Strip it before length-checking the hex.
  const prefix = `${algo}=`;
  const candidate = candidateSignatureHex.startsWith(prefix)
    ? candidateSignatureHex.slice(prefix.length)
    : candidateSignatureHex;

  const expected = computeHmacHex(body, secret, algo);

  if (candidate.length !== expected.length) {
    return false;
  }

  return crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(expected));
}

/**
 * Constant-time equality check for two short ASCII strings (e.g. GitLab's
 * plain shared-secret webhook token).
 *
 * Returns `false` for empty / nullish inputs and for length mismatches; both
 * cases short-circuit before {@link crypto.timingSafeEqual} (which throws on
 * unequal lengths).
 */
export function constantTimeStringEquals(
  a: string | undefined | null,
  b: string | undefined | null,
): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }
  if (a.length === 0 || b.length === 0 || a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
