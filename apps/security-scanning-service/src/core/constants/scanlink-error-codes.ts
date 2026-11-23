/**
 * Scanlink Container Exit Codes
 *
 * These codes are returned by the scanner containers to indicate the result
 * of a container scan operation. They are used to provide detailed error
 * information to the API services.
 */

// Success
export const EXIT_SUCCESS = 0;

// Authentication errors (10-19)
export const EXIT_AUTH_ERROR = 10; // Generic authentication error
export const EXIT_INVALID_CREDENTIALS = 11; // Invalid credentials provided
export const EXIT_MISSING_CREDENTIALS = 12; // Credentials not provided
export const EXIT_TOKEN_EXPIRED = 13; // Token has expired
export const EXIT_UNAUTHORIZED = 14; // Registry returned 401
export const EXIT_FORBIDDEN = 15; // Registry returned 403

// Cloud provider errors (20-29)
export const EXIT_AWS_ECR_ERROR = 20; // AWS ECR specific error
export const EXIT_GCP_GCR_ERROR = 21; // Google GCR specific error
export const EXIT_AZURE_ACR_ERROR = 22; // Azure ACR specific error

// Network errors (30-39)
export const EXIT_NETWORK_ERROR = 30; // Generic network error
export const EXIT_DNS_ERROR = 31; // DNS resolution failed
export const EXIT_TIMEOUT_ERROR = 32; // Connection timeout
export const EXIT_CONNECTION_REFUSED = 33; // Connection refused

// Scan errors (40-49)
export const EXIT_SCAN_ERROR = 40; // Generic scan error
export const EXIT_IMAGE_NOT_FOUND = 41; // Image not found
export const EXIT_MANIFEST_ERROR = 42; // Image manifest error
export const EXIT_LAYER_ERROR = 43; // Image layer download error

// API errors (50-59)
export const EXIT_API_ERROR = 50; // Generic API error
export const EXIT_API_CONNECTION_ERROR = 51; // Cannot connect to API
export const EXIT_API_AUTH_ERROR = 52; // API authentication failed
export const EXIT_API_TIMEOUT = 53; // API request timeout

// Infrastructure errors (60-69)
export const EXIT_INFRA_ERROR = 60; // Generic infrastructure error
export const EXIT_INFRA_OOM = 61; // Scanner ran out of memory
export const EXIT_INFRA_TIMEOUT = 62; // Scan timed out
export const EXIT_INFRA_IMAGE_PULL = 63; // Could not pull the image
export const EXIT_INFRA_POD_LOST = 64; // Scan interrupted (worker lost)
// The scan waited too long for a free slot in its organization and
// was cancelled by the stalled-queue watchdog (see ScanService.checkExpiredScan).
export const EXIT_INFRA_QUEUE_TIMEOUT = 65;
// Emitted by external-integrations when the repository archive could
// not be downloaded from the Git provider. A Community cluster pod that
// cannot fetch the scan's archive from this instance's storage fails 88.
export const EXIT_INFRA_SOURCE_FETCH_FAILED = 66;
// Same, but the provider answered with a rate-limit — retriable.
export const EXIT_INFRA_SOURCE_RATE_LIMITED = 67;
// The archive was downloaded but could not be turned into a
// scannable source tree (too large, not a valid zip, or the rewrite failed).
export const EXIT_INFRA_SOURCE_INVALID = 68;
// The scan was queued while its organisation could run scans, and left the
// queue once it no longer could (the entitlements port's writability check).
// Stamped by ScanService.startQueuedScan on the cancel; no scanner emits it.
export const EXIT_INFRA_WRITES_BLOCKED = 69;

// Import scan failures (70-79): stored on
// the scan as a number (`scan.errorCode`) with `scan.errorMessage` the string
// code verbatim and `scan.errorCategory` 'import'. The dashboard maps the
// number; the CLI and the scanners print the message.
export const EXIT_IMPORT_INVALID_SARIF = 70; // The uploaded file is not valid SARIF
export const EXIT_IMPORT_TOO_LARGE = 71; // Over the stored or decoded size limit
export const EXIT_IMPORT_TOO_MANY_RESULTS = 72; // Over 100,000 results
export const EXIT_IMPORT_TOO_MANY_RUNS = 73; // Over 20 runs
export const EXIT_IMPORT_STORAGE_UNAVAILABLE = 74; // The import object could not be read
export const EXIT_IMPORT_UNAVAILABLE = 75; // The results service did not accept the import
export const EXIT_IMPORT_TIMEOUT = 76; // The import watchdog retired the scan
export const EXIT_IMPORT_INTERNAL_ERROR = 77; // Unexpected error while importing
export const EXIT_IMPORT_UNSUPPORTED_RESULT = 78; // An sca/container result lacks package name or installed version
// Fallback for any other `IMPORT_[A-Z_]{1,40}` code.
export const EXIT_IMPORT_ERROR = 79;

// Community cluster scan failures (80-88): stored on the
// scan as `scan.errorCode` (and on a container as its `outcomeReason`) with
// `scan.errorCategory` 'cluster'. Set by the Community cluster engine only.
export const EXIT_CLUSTER_NO_RESULTS = 80; // Pod Succeeded, upload token never spent
export const EXIT_CLUSTER_UNSCHEDULABLE = 81; // Pod Pending for more than 10 min
export const EXIT_CLUSTER_DEADLINE = 82; // Container open past scannerPhaseMaxMs
export const EXIT_CLUSTER_LAUNCH_FAILED = 83; // Secret or pod create refused, or no container after 5 min
export const EXIT_CLUSTER_IMAGE_INCOMPATIBLE = 84; // Runner exit 4 (no --scan-run) or 5 (protocol refused)
export const EXIT_CLUSTER_TOOL_FAILED = 85; // Runner exit 2
export const EXIT_CLUSTER_RESULTS_REFUSED = 86; // Runner exit 3
export const EXIT_CLUSTER_POD_LOST = 87; // Pod gone while its container is open and its token unspent
export const EXIT_CLUSTER_ARCHIVE_FETCH_FAILED = 88; // Runner exit 6: the archive could not be fetched from the storage

// Full-scan archive refusals (90-99): file-management refused the uploaded
// archive, on one of its limits (90-93) or because it cannot be scanned at
// all (94-98), before anything was scanned. Stored on the
// scan as `scan.errorCode` with `scan.errorCategory` 'archive' and
// `scan.errorMessage` `<NAME>: <reason naming the limit>`. file-management
// declares the same numbers (`ARCHIVE_FAILURE_CODES`).
export const EXIT_ARCHIVE_TOO_LARGE = 90; // Uploaded object over FULL_SCAN_MAX_ARCHIVE_BYTES
export const EXIT_ARCHIVE_TOO_MANY_ENTRIES = 91; // Over FULL_SCAN_MAX_ENTRIES entries
export const EXIT_ARCHIVE_ENTRY_TOO_LARGE = 92; // One entry over FULL_SCAN_MAX_ENTRY_BYTES inflated
export const EXIT_ARCHIVE_INFLATED_TOO_LARGE = 93; // All entries over FULL_SCAN_MAX_UNCOMPRESSED_BYTES inflated
export const EXIT_ARCHIVE_INVALID = 94; // Not a readable ZIP archive
export const EXIT_ARCHIVE_EMPTY = 95; // A ZIP that holds no file
export const EXIT_ARCHIVE_ENCRYPTED = 96; // A password-protected archive
export const EXIT_ARCHIVE_UNSAFE_PATH = 97; // An entry path absolute or outside the archive's folder
export const EXIT_ARCHIVE_NOT_RECEIVED = 98; // No archive uploaded before the upload deadline

/** The archive refusals, by the name file-management puts first in the message. */
export const ARCHIVE_ERROR_CODES = {
  ARCHIVE_TOO_LARGE: EXIT_ARCHIVE_TOO_LARGE,
  ARCHIVE_TOO_MANY_ENTRIES: EXIT_ARCHIVE_TOO_MANY_ENTRIES,
  ARCHIVE_ENTRY_TOO_LARGE: EXIT_ARCHIVE_ENTRY_TOO_LARGE,
  ARCHIVE_INFLATED_TOO_LARGE: EXIT_ARCHIVE_INFLATED_TOO_LARGE,
  ARCHIVE_INVALID: EXIT_ARCHIVE_INVALID,
  ARCHIVE_EMPTY: EXIT_ARCHIVE_EMPTY,
  ARCHIVE_ENCRYPTED: EXIT_ARCHIVE_ENCRYPTED,
  ARCHIVE_UNSAFE_PATH: EXIT_ARCHIVE_UNSAFE_PATH,
  ARCHIVE_NOT_RECEIVED: EXIT_ARCHIVE_NOT_RECEIVED,
} as const;

/**
 * Error code categories
 */
export const ERROR_CATEGORY = {
  SUCCESS: 'success',
  AUTHENTICATION: 'authentication',
  CLOUD_PROVIDER: 'cloud_provider',
  NETWORK: 'network',
  SCAN: 'scan',
  API: 'api',
  INFRA: 'infra',
  IMPORT: 'import',
  CLUSTER: 'cluster',
  ARCHIVE: 'archive',
  UNKNOWN: 'unknown',
} as const;

export type ErrorCategory =
  (typeof ERROR_CATEGORY)[keyof typeof ERROR_CATEGORY];

/**
 * Get the category of an exit code
 */
export function getErrorCategory(exitCode: number): ErrorCategory {
  if (exitCode === EXIT_SUCCESS) return ERROR_CATEGORY.SUCCESS;
  if (exitCode >= 10 && exitCode <= 19) return ERROR_CATEGORY.AUTHENTICATION;
  if (exitCode >= 20 && exitCode <= 29) return ERROR_CATEGORY.CLOUD_PROVIDER;
  if (exitCode >= 30 && exitCode <= 39) return ERROR_CATEGORY.NETWORK;
  if (exitCode >= 40 && exitCode <= 49) return ERROR_CATEGORY.SCAN;
  if (exitCode >= 50 && exitCode <= 59) return ERROR_CATEGORY.API;
  if (exitCode >= 60 && exitCode <= 69) return ERROR_CATEGORY.INFRA;
  if (exitCode >= 70 && exitCode <= 79) return ERROR_CATEGORY.IMPORT;
  if (exitCode >= 80 && exitCode <= 88) return ERROR_CATEGORY.CLUSTER;
  if (exitCode >= 90 && exitCode <= 99) return ERROR_CATEGORY.ARCHIVE;
  return ERROR_CATEGORY.UNKNOWN;
}

/**
 * The known import error codes, by their string name. 79 is
 * the fallback for any other `IMPORT_[A-Z_]{1,40}` and is deliberately absent.
 */
export const IMPORT_ERROR_CODES: Record<string, number> = {
  IMPORT_INVALID_SARIF: EXIT_IMPORT_INVALID_SARIF,
  IMPORT_TOO_LARGE: EXIT_IMPORT_TOO_LARGE,
  IMPORT_TOO_MANY_RESULTS: EXIT_IMPORT_TOO_MANY_RESULTS,
  IMPORT_TOO_MANY_RUNS: EXIT_IMPORT_TOO_MANY_RUNS,
  IMPORT_STORAGE_UNAVAILABLE: EXIT_IMPORT_STORAGE_UNAVAILABLE,
  IMPORT_UNAVAILABLE: EXIT_IMPORT_UNAVAILABLE,
  IMPORT_TIMEOUT: EXIT_IMPORT_TIMEOUT,
  IMPORT_INTERNAL_ERROR: EXIT_IMPORT_INTERNAL_ERROR,
  IMPORT_UNSUPPORTED_RESULT: EXIT_IMPORT_UNSUPPORTED_RESULT,
};

/** The names of the nine Community cluster scan failure codes (80–88). */
export type ClusterFailureName =
  | 'CLUSTER_NO_RESULTS'
  | 'CLUSTER_UNSCHEDULABLE'
  | 'CLUSTER_DEADLINE'
  | 'CLUSTER_LAUNCH_FAILED'
  | 'CLUSTER_IMAGE_INCOMPATIBLE'
  | 'CLUSTER_TOOL_FAILED'
  | 'CLUSTER_RESULTS_REFUSED'
  | 'CLUSTER_POD_LOST'
  | 'CLUSTER_ARCHIVE_FETCH_FAILED';

/** The Community cluster scan failure codes, by their name. */
export const CLUSTER_FAILURE_CODES: Record<ClusterFailureName, number> = {
  CLUSTER_NO_RESULTS: EXIT_CLUSTER_NO_RESULTS,
  CLUSTER_UNSCHEDULABLE: EXIT_CLUSTER_UNSCHEDULABLE,
  CLUSTER_DEADLINE: EXIT_CLUSTER_DEADLINE,
  CLUSTER_LAUNCH_FAILED: EXIT_CLUSTER_LAUNCH_FAILED,
  CLUSTER_IMAGE_INCOMPATIBLE: EXIT_CLUSTER_IMAGE_INCOMPATIBLE,
  CLUSTER_TOOL_FAILED: EXIT_CLUSTER_TOOL_FAILED,
  CLUSTER_RESULTS_REFUSED: EXIT_CLUSTER_RESULTS_REFUSED,
  CLUSTER_POD_LOST: EXIT_CLUSTER_POD_LOST,
  CLUSTER_ARCHIVE_FETCH_FAILED: EXIT_CLUSTER_ARCHIVE_FETCH_FAILED,
};

const IMPORT_CODE_PATTERN = /^IMPORT_[A-Z_]{1,40}$/;

/**
 * Build the failure triplet stored on an import scan from its string code: a
 * known code maps to its number, any other `IMPORT_[A-Z_]{1,40}` to the
 * fallback 79, and the message is the code verbatim. Anything else is a
 * programming error and throws a TypeError.
 */
export function importFailure(code: string): {
  errorCode: number;
  errorCategory: 'import';
  errorMessage: string;
} {
  if (!IMPORT_CODE_PATTERN.test(code)) {
    throw new TypeError('importFailure expects an IMPORT_[A-Z_]{1,40} code');
  }
  return {
    errorCode: IMPORT_ERROR_CODES[code] ?? EXIT_IMPORT_ERROR,
    errorCategory: ERROR_CATEGORY.IMPORT,
    errorMessage: code,
  };
}

/**
 * Check if the error is related to authentication
 */
export function isAuthenticationError(exitCode: number): boolean {
  return exitCode >= 10 && exitCode <= 19;
}

/**
 * Check if the error is related to cloud provider
 */
export function isCloudProviderError(exitCode: number): boolean {
  return exitCode >= 20 && exitCode <= 29;
}

/**
 * Check if the error is related to network
 */
export function isNetworkError(exitCode: number): boolean {
  return exitCode >= 30 && exitCode <= 39;
}

/**
 * Check if the error is related to scan
 */
export function isScanError(exitCode: number): boolean {
  return exitCode >= 40 && exitCode <= 49;
}

/**
 * Human-readable error descriptions
 */
export const ERROR_DESCRIPTIONS: Record<number, string> = {
  [EXIT_SUCCESS]: 'Scan completed successfully',
  [EXIT_AUTH_ERROR]: 'Authentication failed',
  [EXIT_INVALID_CREDENTIALS]:
    'Invalid credentials provided for the container registry',
  [EXIT_MISSING_CREDENTIALS]: 'Credentials are required but not provided',
  [EXIT_TOKEN_EXPIRED]: 'Authentication token has expired',
  [EXIT_UNAUTHORIZED]: 'Registry returned unauthorized (401)',
  [EXIT_FORBIDDEN]: 'Access to registry is forbidden (403)',
  [EXIT_AWS_ECR_ERROR]: 'AWS ECR authentication or access error',
  [EXIT_GCP_GCR_ERROR]: 'Google GCR authentication or access error',
  [EXIT_AZURE_ACR_ERROR]: 'Azure ACR authentication or access error',
  [EXIT_NETWORK_ERROR]: 'Network error occurred',
  [EXIT_DNS_ERROR]: 'DNS resolution failed - registry hostname not found',
  [EXIT_TIMEOUT_ERROR]: 'Connection to registry timed out',
  [EXIT_CONNECTION_REFUSED]: 'Connection to registry was refused',
  [EXIT_SCAN_ERROR]: 'Scan encountered an error',
  [EXIT_IMAGE_NOT_FOUND]: 'Container image not found in registry',
  [EXIT_MANIFEST_ERROR]: 'Failed to retrieve image manifest',
  [EXIT_LAYER_ERROR]: 'Failed to download image layers',
  [EXIT_API_ERROR]: 'API communication error',
  [EXIT_API_CONNECTION_ERROR]: 'Cannot connect to CybeDefend API',
  [EXIT_API_AUTH_ERROR]: 'API authentication failed',
  [EXIT_API_TIMEOUT]: 'API request timed out',
  [EXIT_INFRA_ERROR]: 'Infrastructure error while running the scan',
  [EXIT_INFRA_OOM]: 'The scanner ran out of memory',
  [EXIT_INFRA_TIMEOUT]: 'The scan timed out before completing',
  [EXIT_INFRA_IMAGE_PULL]:
    'Could not pull the image — check the image name/tag and registry credentials',
  [EXIT_INFRA_POD_LOST]:
    'The scan was interrupted (worker lost) — please retry',
  [EXIT_INFRA_QUEUE_TIMEOUT]:
    'The scan waited too long for a free scan slot in your organization and was cancelled',
  [EXIT_INFRA_SOURCE_FETCH_FAILED]:
    'Could not download the repository from the Git provider',
  [EXIT_INFRA_SOURCE_RATE_LIMITED]:
    'The Git provider rate-limited the repository download — please retry in a few minutes',
  [EXIT_INFRA_SOURCE_INVALID]:
    'The repository archive could not be processed (too large, not a valid zip, or the rewrite failed)',
  [EXIT_INFRA_WRITES_BLOCKED]:
    "The scan was cancelled before it started: your organization's AppSec Platform is no longer active or its plan is unpaid",
  [EXIT_IMPORT_INVALID_SARIF]: 'The uploaded file is not valid SARIF',
  [EXIT_IMPORT_TOO_LARGE]:
    'The import file is too large (over 50 MiB stored or 200 MiB decompressed)',
  [EXIT_IMPORT_TOO_MANY_RESULTS]:
    'The import file holds more than 100,000 results',
  [EXIT_IMPORT_TOO_MANY_RUNS]: 'The import file holds more than 20 runs',
  [EXIT_IMPORT_STORAGE_UNAVAILABLE]:
    'The imported file could not be read from storage',
  [EXIT_IMPORT_UNAVAILABLE]: 'The results service did not accept the import',
  [EXIT_IMPORT_TIMEOUT]: 'The import did not finish in time and was retired',
  [EXIT_IMPORT_INTERNAL_ERROR]:
    'An unexpected error occurred while importing the results',
  [EXIT_IMPORT_UNSUPPORTED_RESULT]:
    'A result of this import type lacks its package name or installed version',
  [EXIT_IMPORT_ERROR]: 'The import failed',
  [EXIT_CLUSTER_NO_RESULTS]: 'The scanner finished without sending its results',
  [EXIT_CLUSTER_UNSCHEDULABLE]:
    'The cluster could not schedule the scanner pod within 10 minutes',
  [EXIT_CLUSTER_DEADLINE]: 'The scanner did not finish within its time limit',
  [EXIT_CLUSTER_LAUNCH_FAILED]: 'The cluster refused to start the scanner pod',
  [EXIT_CLUSTER_IMAGE_INCOMPATIBLE]:
    'The scanner image does not support this version of CybeDefend',
  [EXIT_CLUSTER_TOOL_FAILED]: 'The scanning tool failed inside its pod',
  [EXIT_CLUSTER_RESULTS_REFUSED]:
    'CybeDefend refused the results the scanner sent',
  [EXIT_CLUSTER_POD_LOST]:
    'The scanner pod disappeared before it sent its results',
  [EXIT_CLUSTER_ARCHIVE_FETCH_FAILED]:
    "The scanner pod could not download the scan's archive from this instance's storage: check that the storage address the pods are given (CYBEDEFEND_STORAGE_PUBLIC_URL) is reachable from the cluster",
  [EXIT_ARCHIVE_TOO_LARGE]:
    'The uploaded archive is larger than this instance accepts',
  [EXIT_ARCHIVE_TOO_MANY_ENTRIES]:
    'The uploaded archive holds more files than this instance accepts',
  [EXIT_ARCHIVE_ENTRY_TOO_LARGE]:
    'A file of the uploaded archive is larger than this instance accepts',
  [EXIT_ARCHIVE_INFLATED_TOO_LARGE]:
    'The uploaded archive is larger uncompressed than this instance accepts',
  [EXIT_ARCHIVE_INVALID]:
    'The uploaded file is not a ZIP archive that can be read',
  [EXIT_ARCHIVE_EMPTY]: 'The uploaded archive holds no file',
  [EXIT_ARCHIVE_ENCRYPTED]:
    'The uploaded archive is password-protected, so it cannot be scanned',
  [EXIT_ARCHIVE_UNSAFE_PATH]:
    "A file of the uploaded archive has a path that leaves the archive's folder",
  [EXIT_ARCHIVE_NOT_RECEIVED]:
    'The archive was never uploaded before the upload deadline',
};

/**
 * Get a human-readable description for an exit code
 */
export function getErrorDescription(exitCode: number): string {
  return ERROR_DESCRIPTIONS[exitCode] || `Unknown error (code: ${exitCode})`;
}

/**
 * Determine if the error is retriable
 */
export function isRetriableError(exitCode: number): boolean {
  const retriableCodes = [
    EXIT_TOKEN_EXPIRED, // Token can be refreshed
    EXIT_NETWORK_ERROR, // Transient network issue
    EXIT_TIMEOUT_ERROR, // Transient timeout
    EXIT_CONNECTION_REFUSED, // Service might be restarting
    EXIT_API_TIMEOUT, // API might be temporarily overloaded
    EXIT_INFRA_TIMEOUT, // Scan timed out — retry may succeed
    EXIT_INFRA_POD_LOST, // Worker lost — retry on another node
    EXIT_INFRA_SOURCE_RATE_LIMITED, // Provider rate-limit — retry in a few minutes
  ];
  return retriableCodes.includes(exitCode);
}

/**
 * Determine the scan state based on exit code
 */
export function getScanStateFromExitCode(
  exitCode: number,
): 'completed' | 'failed' {
  return exitCode === EXIT_SUCCESS ? 'completed' : 'failed';
}
