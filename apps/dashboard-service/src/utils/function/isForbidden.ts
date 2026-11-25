/**
 * True when a failed API call was refused for the caller's rights (HTTP 403).
 * Reads the axios error (`response.status`) and the API error body the
 * services rethrow (`statusCode`, `status`), without assuming either.
 */
export function isForbidden(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { response, statusCode, status } = error as {
    response?: { status?: unknown };
    statusCode?: unknown;
    status?: unknown;
  };
  if (response && typeof response === 'object' && response.status === 403) return true;
  return statusCode === 403 || status === 403;
}
