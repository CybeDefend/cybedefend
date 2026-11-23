/**
 * Scanlink Container Exit Codes
 *
 * These codes are returned by scanlink-container to indicate the result
 * of a container scan operation. They are used to provide detailed error
 * information to the API services.
 *
 * @see scanlink-container/pkg/errors/errors.go
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
  return ERROR_CATEGORY.UNKNOWN;
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
