/**
 * Scan-failure codes emitted by external-integrations-service when a repository
 * could not be fetched from its provider.
 *
 * They share the numbering of the scanner exit codes so security-scanning
 * derives a single `errorCategory` for every scan failure, whatever produced
 * it. The canonical table lives in
 * `security-scanning-service/src/core/constants/scanlink-error-codes.ts`
 * (60-69 = infrastructure range) and the dashboard maps the same numbers to its
 * i18n keys. These constants are declared locally because the scanner codes
 * belong to another service and are not carried by any proto contract — keep
 * the two tables in sync.
 */

/** The repository archive could not be downloaded (any non-rate-limit reason). */
export const SCAN_FAILURE_SOURCE_FETCH_FAILED = 66;

/** The provider rate-limited the archive download (HTTP 429, or 403 + headers). */
export const SCAN_FAILURE_SOURCE_RATE_LIMITED = 67;

/**
 * Repository archive could not be processed: too large, not a zip, or rewrite
 * failed. The download itself succeeded — this is not a fetch failure.
 */
export const SCAN_FAILURE_SOURCE_INVALID = 68;

const SCAN_FAILURE_CODES: ReadonlySet<number> = new Set([
  SCAN_FAILURE_SOURCE_FETCH_FAILED,
  SCAN_FAILURE_SOURCE_RATE_LIMITED,
  SCAN_FAILURE_SOURCE_INVALID,
]);

/**
 * The scan-failure code an error carries, defaulting to
 * {@link SCAN_FAILURE_SOURCE_FETCH_FAILED}.
 *
 * Only the codes declared above are accepted: a grpc-js `ServiceError` also
 * exposes a numeric `code` (a gRPC status, 1-16) and axios a string one
 * (`ECONNRESET`) — neither is a scan-failure code.
 */
export function scanFailureCodeFromError(error: unknown): number {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  return typeof code === 'number' && SCAN_FAILURE_CODES.has(code)
    ? code
    : SCAN_FAILURE_SOURCE_FETCH_FAILED;
}
