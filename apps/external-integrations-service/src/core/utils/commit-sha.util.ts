/** A full commit id: SHA-1 (40 hex) or SHA-256 (64 hex) repositories. */
const COMMIT_SHA_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;

/** The null id (all zeros) providers send for a created or deleted branch. */
const NULL_SHA_PATTERN = /^0+$/;

/**
 * Whether a value from a webhook payload is a well-formed full commit id.
 * Anything else (absent, null, a branch name, a shortened id, the all-zero
 * id of a branch creation or deletion) is refused, so it never reaches a
 * GitHub/GitLab archive URL or a stored rescan.
 */
export function isCommitSha(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    COMMIT_SHA_PATTERN.test(value) &&
    !NULL_SHA_PATTERN.test(value)
  );
}
