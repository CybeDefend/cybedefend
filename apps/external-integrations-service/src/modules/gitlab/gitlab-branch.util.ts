/**
 * Pure helpers for interpreting GitLab push-webhook payloads with respect to
 * branch lifecycle.
 *
 * GitLab does not emit dedicated `create` / `delete` webhook events for
 * branches — both are signalled inside the regular `push` event using the
 * 40-zero "null SHA" sentinel as `before` (creation) or `after` (deletion).
 */

/**
 * The 40-character all-zero SHA sentinel GitLab uses on `before` (branch
 * creation) and `after` (branch deletion).
 */
export const SHA_ZERO = '0'.repeat(40);

/**
 * Type-safe guard: only treat the ref as a branch ref when it is a string
 * starting with `refs/heads/`. Non-string inputs (undefined, null, numbers)
 * return `false` without throwing.
 */
export function isBranchRef(ref: unknown): boolean {
  return typeof ref === 'string' && ref.startsWith('refs/heads/');
}

/**
 * Branch creation: `before` is the SHA_ZERO sentinel and `after` is a real
 * SHA. Both-zeros is a no-op push (not a creation), so we reject it.
 */
export function isBranchCreation(payload: {
  before?: string;
  after?: string;
}): boolean {
  return (
    !!payload &&
    payload.before === SHA_ZERO &&
    payload.after !== SHA_ZERO &&
    typeof payload.after === 'string'
  );
}

/**
 * Branch deletion: `after` is the SHA_ZERO sentinel — regardless of the
 * `before` value (which carries the SHA of the deleted tip).
 */
export function isBranchDeletion(payload: {
  before?: string;
  after?: string;
}): boolean {
  return !!payload && payload.after === SHA_ZERO;
}

/**
 * Strip the `refs/heads/` prefix to obtain the bare branch name. Nested
 * branches such as `feature/foo` are preserved verbatim.
 */
export function extractBranchName(ref: string): string {
  const prefix = 'refs/heads/';
  return ref.startsWith(prefix) ? ref.slice(prefix.length) : ref;
}
