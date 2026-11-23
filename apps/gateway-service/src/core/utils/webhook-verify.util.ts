import * as crypto from 'node:crypto';

/**
 * Webhook signature verification helpers.
 *
 * Designed for the external webhook flows the gateway relays (Logto, Stripe,
 * etc.). Hashes are always computed over the **raw** request body bytes —
 * never re-serialized JSON — so a malicious payload that re-orders keys or
 * adds whitespace cannot bypass verification.
 *
 * All comparisons use {@link crypto.timingSafeEqual} after a length-equal
 * precondition (length is publicly known and timing-safe to leak).
 *
 * NOTE: this is intentionally duplicated from
 *   external-integrations-service/src/core/utils/webhook-verify.util.ts
 * because the monorepo has no shared TypeScript lib for cross-service
 * utilities. Keep both copies in sync when fixing security bugs.
 */

/**
 * Compute the HMAC of `body` using `secret` and return it as a hex string.
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
 * Constant-time equality check for two short ASCII strings.
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
