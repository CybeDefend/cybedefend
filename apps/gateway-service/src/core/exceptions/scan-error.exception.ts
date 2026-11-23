import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Container scanner exit codes mapped to HTTP status codes
 * (the exit codes the container scanner defines).
 */
export enum ScanErrorCode {
  // Success
  SUCCESS = 0,

  // Authentication errors (10-19) -> 401/403
  AUTH_ERROR = 10,
  INVALID_CREDENTIALS = 11,
  MISSING_CREDENTIALS = 12,
  TOKEN_EXPIRED = 13,
  UNAUTHORIZED = 14,
  FORBIDDEN = 15,

  // Cloud provider errors (20-29) -> 401/403/502
  AWS_ECR_ERROR = 20,
  GCP_GCR_ERROR = 21,
  AZURE_ACR_ERROR = 22,

  // Network errors (30-39) -> 502/503/504
  NETWORK_ERROR = 30,
  DNS_ERROR = 31,
  TIMEOUT_ERROR = 32,
  CONNECTION_REFUSED = 33,

  // Scan errors (40-49) -> 400/404/422
  SCAN_ERROR = 40,
  IMAGE_NOT_FOUND = 41,
  MANIFEST_ERROR = 42,
  LAYER_ERROR = 43,

  // API errors (50-59) -> 502/503
  API_ERROR = 50,
  API_CONNECTION_ERROR = 51,
  API_AUTH_ERROR = 52,
  API_TIMEOUT = 53,
}

/**
 * Error category for grouping errors
 */
export type ScanErrorCategory =
  | 'success'
  | 'authentication'
  | 'cloud_provider'
  | 'network'
  | 'scan'
  | 'api'
  | 'unknown';

/**
 * Interface for scan error details
 */
export interface ScanErrorDetails {
  code: ScanErrorCode;
  category: ScanErrorCategory;
  message: string;
  httpStatus: HttpStatus;
  retriable: boolean;
}

/**
 * Map scan error codes to HTTP status codes and details
 */
export function getScanErrorDetails(
  errorCode: number,
  errorMessage?: string,
): ScanErrorDetails {
  const baseMessage = errorMessage || 'An error occurred during the scan';

  switch (errorCode) {
    // Success
    case ScanErrorCode.SUCCESS:
      return {
        code: ScanErrorCode.SUCCESS,
        category: 'success',
        message: 'Scan completed successfully',
        httpStatus: HttpStatus.OK,
        retriable: false,
      };

    // Authentication errors -> 401
    case ScanErrorCode.AUTH_ERROR:
      return {
        code: ScanErrorCode.AUTH_ERROR,
        category: 'authentication',
        message: baseMessage || 'Authentication failed',
        httpStatus: HttpStatus.UNAUTHORIZED,
        retriable: false,
      };

    case ScanErrorCode.INVALID_CREDENTIALS:
      return {
        code: ScanErrorCode.INVALID_CREDENTIALS,
        category: 'authentication',
        message:
          baseMessage || 'Invalid credentials provided for container registry',
        httpStatus: HttpStatus.UNAUTHORIZED,
        retriable: false,
      };

    case ScanErrorCode.MISSING_CREDENTIALS:
      return {
        code: ScanErrorCode.MISSING_CREDENTIALS,
        category: 'authentication',
        message:
          baseMessage ||
          'Credentials are required for this private container registry',
        httpStatus: HttpStatus.UNAUTHORIZED,
        retriable: false,
      };

    case ScanErrorCode.TOKEN_EXPIRED:
      return {
        code: ScanErrorCode.TOKEN_EXPIRED,
        category: 'authentication',
        message: baseMessage || 'Authentication token has expired',
        httpStatus: HttpStatus.UNAUTHORIZED,
        retriable: true,
      };

    case ScanErrorCode.UNAUTHORIZED:
      return {
        code: ScanErrorCode.UNAUTHORIZED,
        category: 'authentication',
        message: baseMessage || 'Unauthorized access to container registry',
        httpStatus: HttpStatus.UNAUTHORIZED,
        retriable: false,
      };

    case ScanErrorCode.FORBIDDEN:
      return {
        code: ScanErrorCode.FORBIDDEN,
        category: 'authentication',
        message: baseMessage || 'Access forbidden to container registry',
        httpStatus: HttpStatus.FORBIDDEN,
        retriable: false,
      };

    // Cloud provider errors -> 401/502
    case ScanErrorCode.AWS_ECR_ERROR:
      return {
        code: ScanErrorCode.AWS_ECR_ERROR,
        category: 'cloud_provider',
        message: baseMessage || 'AWS ECR authentication or access error',
        httpStatus: HttpStatus.UNAUTHORIZED,
        retriable: false,
      };

    case ScanErrorCode.GCP_GCR_ERROR:
      return {
        code: ScanErrorCode.GCP_GCR_ERROR,
        category: 'cloud_provider',
        message: baseMessage || 'Google GCR authentication or access error',
        httpStatus: HttpStatus.UNAUTHORIZED,
        retriable: false,
      };

    case ScanErrorCode.AZURE_ACR_ERROR:
      return {
        code: ScanErrorCode.AZURE_ACR_ERROR,
        category: 'cloud_provider',
        message: baseMessage || 'Azure ACR authentication or access error',
        httpStatus: HttpStatus.UNAUTHORIZED,
        retriable: false,
      };

    // Network errors -> 502/503/504
    case ScanErrorCode.NETWORK_ERROR:
      return {
        code: ScanErrorCode.NETWORK_ERROR,
        category: 'network',
        message:
          baseMessage || 'Network error connecting to container registry',
        httpStatus: HttpStatus.BAD_GATEWAY,
        retriable: true,
      };

    case ScanErrorCode.DNS_ERROR:
      return {
        code: ScanErrorCode.DNS_ERROR,
        category: 'network',
        message:
          baseMessage || 'DNS resolution failed for container registry host',
        httpStatus: HttpStatus.BAD_GATEWAY,
        retriable: true,
      };

    case ScanErrorCode.TIMEOUT_ERROR:
      return {
        code: ScanErrorCode.TIMEOUT_ERROR,
        category: 'network',
        message: baseMessage || 'Connection to container registry timed out',
        httpStatus: HttpStatus.GATEWAY_TIMEOUT,
        retriable: true,
      };

    case ScanErrorCode.CONNECTION_REFUSED:
      return {
        code: ScanErrorCode.CONNECTION_REFUSED,
        category: 'network',
        message: baseMessage || 'Connection to container registry was refused',
        httpStatus: HttpStatus.SERVICE_UNAVAILABLE,
        retriable: true,
      };

    // Scan errors -> 400/404/422
    case ScanErrorCode.SCAN_ERROR:
      return {
        code: ScanErrorCode.SCAN_ERROR,
        category: 'scan',
        message: baseMessage || 'An error occurred during the scan',
        httpStatus: HttpStatus.UNPROCESSABLE_ENTITY,
        retriable: false,
      };

    case ScanErrorCode.IMAGE_NOT_FOUND:
      return {
        code: ScanErrorCode.IMAGE_NOT_FOUND,
        category: 'scan',
        message: baseMessage || 'Container image not found in registry',
        httpStatus: HttpStatus.NOT_FOUND,
        retriable: false,
      };

    case ScanErrorCode.MANIFEST_ERROR:
      return {
        code: ScanErrorCode.MANIFEST_ERROR,
        category: 'scan',
        message: baseMessage || 'Failed to retrieve image manifest',
        httpStatus: HttpStatus.UNPROCESSABLE_ENTITY,
        retriable: false,
      };

    case ScanErrorCode.LAYER_ERROR:
      return {
        code: ScanErrorCode.LAYER_ERROR,
        category: 'scan',
        message: baseMessage || 'Failed to download image layers',
        httpStatus: HttpStatus.UNPROCESSABLE_ENTITY,
        retriable: true,
      };

    // API errors -> 502/503
    case ScanErrorCode.API_ERROR:
      return {
        code: ScanErrorCode.API_ERROR,
        category: 'api',
        message: baseMessage || 'Internal API communication error',
        httpStatus: HttpStatus.BAD_GATEWAY,
        retriable: true,
      };

    case ScanErrorCode.API_CONNECTION_ERROR:
      return {
        code: ScanErrorCode.API_CONNECTION_ERROR,
        category: 'api',
        message: baseMessage || 'Cannot connect to internal API',
        httpStatus: HttpStatus.SERVICE_UNAVAILABLE,
        retriable: true,
      };

    case ScanErrorCode.API_AUTH_ERROR:
      return {
        code: ScanErrorCode.API_AUTH_ERROR,
        category: 'api',
        message: baseMessage || 'Internal API authentication failed',
        httpStatus: HttpStatus.INTERNAL_SERVER_ERROR,
        retriable: false,
      };

    case ScanErrorCode.API_TIMEOUT:
      return {
        code: ScanErrorCode.API_TIMEOUT,
        category: 'api',
        message: baseMessage || 'Internal API request timed out',
        httpStatus: HttpStatus.GATEWAY_TIMEOUT,
        retriable: true,
      };

    // Unknown error
    default:
      return {
        code: errorCode as ScanErrorCode,
        category: 'unknown',
        message: baseMessage || `Unknown error (code: ${errorCode})`,
        httpStatus: HttpStatus.INTERNAL_SERVER_ERROR,
        retriable: false,
      };
  }
}

/**
 * Check if an error code is authentication-related
 */
export function isAuthenticationError(errorCode: number): boolean {
  return (
    (errorCode >= 10 && errorCode <= 19) || (errorCode >= 20 && errorCode <= 22)
  );
}

/**
 * Check if an error is retriable
 */
export function isRetriableError(errorCode: number): boolean {
  const retriableCodes = [
    ScanErrorCode.TOKEN_EXPIRED,
    ScanErrorCode.NETWORK_ERROR,
    ScanErrorCode.DNS_ERROR,
    ScanErrorCode.TIMEOUT_ERROR,
    ScanErrorCode.CONNECTION_REFUSED,
    ScanErrorCode.LAYER_ERROR,
    ScanErrorCode.API_ERROR,
    ScanErrorCode.API_CONNECTION_ERROR,
    ScanErrorCode.API_TIMEOUT,
  ];
  return retriableCodes.includes(errorCode);
}

/**
 * Custom exception for scan errors with proper HTTP status mapping
 */
export class ScanErrorException extends HttpException {
  /** The numeric scan code: HttpException owns `errorCode`, a string. */
  public readonly scanErrorCode: number;
  public readonly errorCategory: ScanErrorCategory;
  public readonly retriable: boolean;

  constructor(
    errorCode: number,
    errorMessage?: string,
    errorCategory?: ScanErrorCategory,
  ) {
    const details = getScanErrorDetails(errorCode, errorMessage);

    super(
      {
        statusCode: details.httpStatus,
        error: getHttpStatusText(details.httpStatus),
        message: details.message,
        errorCode: details.code,
        errorCategory: errorCategory || details.category,
        retriable: details.retriable,
      },
      details.httpStatus,
    );

    this.scanErrorCode = details.code;
    this.errorCategory = errorCategory || details.category;
    this.retriable = details.retriable;
  }

  /**
   * Create a ScanErrorException from scan response data
   */
  static fromScanResponse(scanResponse: {
    errorCode?: number;
    errorMessage?: string;
    errorCategory?: string;
    state?: string;
  }): ScanErrorException | null {
    if (
      scanResponse.state !== 'failed' ||
      scanResponse.errorCode === undefined
    ) {
      return null;
    }

    return new ScanErrorException(
      scanResponse.errorCode,
      scanResponse.errorMessage,
      scanResponse.errorCategory as ScanErrorCategory,
    );
  }
}

/**
 * Get HTTP status text from status code
 */
function getHttpStatusText(status: HttpStatus): string {
  const statusTexts: Record<number, string> = {
    [HttpStatus.OK]: 'OK',
    [HttpStatus.BAD_REQUEST]: 'Bad Request',
    [HttpStatus.UNAUTHORIZED]: 'Unauthorized',
    [HttpStatus.FORBIDDEN]: 'Forbidden',
    [HttpStatus.NOT_FOUND]: 'Not Found',
    [HttpStatus.UNPROCESSABLE_ENTITY]: 'Unprocessable Entity',
    [HttpStatus.INTERNAL_SERVER_ERROR]: 'Internal Server Error',
    [HttpStatus.BAD_GATEWAY]: 'Bad Gateway',
    [HttpStatus.SERVICE_UNAVAILABLE]: 'Service Unavailable',
    [HttpStatus.GATEWAY_TIMEOUT]: 'Gateway Timeout',
  };
  return statusTexts[status] || 'Error';
}

/**
 * Registry-specific authentication error for better user feedback
 */
export class RegistryAuthenticationException extends ScanErrorException {
  public readonly registryType: string;
  public readonly registryUrl?: string;

  constructor(
    registryType: string,
    errorCode: number,
    errorMessage?: string,
    registryUrl?: string,
  ) {
    const enhancedMessage = registryUrl
      ? `${errorMessage || 'Authentication failed'} for registry ${registryUrl}`
      : errorMessage || `${registryType} authentication failed`;

    super(errorCode, enhancedMessage, 'authentication');

    this.registryType = registryType;
    this.registryUrl = registryUrl;
  }
}
