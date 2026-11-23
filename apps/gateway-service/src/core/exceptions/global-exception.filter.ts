import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { FastifyReply } from 'fastify';
import {
  ScanErrorException,
  getScanErrorDetails,
} from './scan-error.exception';
import { redactUrlSecrets } from '../utils/redact-url-secrets.util';
import { retryAfterSeconds } from '../http/upstream-error';
import { fixedErrorBodyFor } from './fixed-error-bodies';

/**
 * Standard error response structure
 */
export interface StandardErrorResponse {
  statusCode: number;
  error: string;
  message: string;
  /**
   * A fixed, documented string code the client can switch on, e.g.
   * `GRAPH_NOT_READY`.
   */
  code?: string;
  errorCode?: number;
  errorCategory?: string;
  retriable?: boolean;
  /** A registered fixed body only: `false`, the block reason and the unit. */
  success?: false;
  reason?: string;
  unit?: string;
  /**
   * A registered fixed body only: an https page the client may follow
   * (validated by the thrower), possibly empty.
   */
  paymentUrl?: string;
  timestamp: string;
  path: string;
}

/**
 * Global exception filter that handles all exceptions and converts them
 * to a standardized error response format.
 *
 * Special handling for:
 * - gRPC exceptions with scan error codes
 * - Authentication errors (401/403)
 * - Network/registry errors
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest();
    // Logged on 4xx and echoed in the body: mask the secrets a path can carry.
    const path = redactUrlSecrets(request.url);

    const errorResponse = this.buildErrorResponse(exception, path);

    // Log the error with appropriate level
    if (errorResponse.statusCode >= 500) {
      this.logger.error(
        `[${errorResponse.statusCode}] ${errorResponse.message}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else if (errorResponse.statusCode >= 400) {
      this.logger.warn(
        `[${errorResponse.statusCode}] ${errorResponse.message} - ${path}`,
      );
    }

    const retryAfter = this.retryAfterOf(exception, errorResponse.statusCode);
    if (retryAfter !== undefined) {
      response.header('Retry-After', String(retryAfter));
    }

    // Use Fastify's send() method instead of Express's json()
    response.status(errorResponse.statusCode).send(errorResponse);
  }

  /**
   * The `Retry-After` of a 429 `HttpException` whose body carries
   * `retryAfter` (seconds): the rate-limit guards' shape, and the one
   * `throwUpstreamHttpError` uses to forward an upstream 429's header. A
   * value that is not a whole number of seconds within a day is ignored.
   */
  private retryAfterOf(exception: unknown, status: number): number | undefined {
    if (
      status !== HttpStatus.TOO_MANY_REQUESTS ||
      !(exception instanceof HttpException)
    ) {
      return undefined;
    }
    const body = exception.getResponse();
    if (typeof body !== 'object' || body === null) return undefined;
    const value = (body as { retryAfter?: unknown }).retryAfter;
    return typeof value === 'number' ? retryAfterSeconds(value) : undefined;
  }

  private buildErrorResponse(
    exception: unknown,
    path: string,
  ): StandardErrorResponse {
    const timestamp = new Date().toISOString();

    // Handle ScanErrorException (our custom exception)
    if (exception instanceof ScanErrorException) {
      return {
        statusCode: exception.getStatus(),
        error: this.getStatusText(exception.getStatus()),
        message: exception.message,
        errorCode: exception.scanErrorCode,
        errorCategory: exception.errorCategory,
        retriable: exception.retriable,
        timestamp,
        path,
      };
    }

    // Handle standard HttpException
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      // Check if it's an object response with additional fields
      if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        const resp = exceptionResponse as Record<string, unknown>;
        // A registered fixed body (402 refusals of the closed side) keeps
        // its whole body: clients switch on the code and the extra fields.
        const build = fixedErrorBodyFor(resp.code);
        if (build) {
          // A registered fixed body sets `message` itself; the cast only
          // tells TS the spread result is a full StandardErrorResponse.
          return {
            statusCode: status,
            error: this.getStatusText(status),
            ...build(resp),
            timestamp,
            path,
          } as StandardErrorResponse;
        }
        return {
          statusCode: status,
          error: this.getStatusText(status),
          message:
            (resp.message as string) ||
            exception.message ||
            'An error occurred',
          errorCode: resp.errorCode as number | undefined,
          // Absent when the response carries none: never a `code: undefined`.
          ...(typeof resp.code === 'string' ? { code: resp.code } : {}),
          errorCategory: resp.errorCategory as string | undefined,
          retriable: resp.retriable as boolean | undefined,
          timestamp,
          path,
        };
      }

      return {
        statusCode: status,
        error: this.getStatusText(status),
        message:
          typeof exceptionResponse === 'string'
            ? exceptionResponse
            : exception.message,
        timestamp,
        path,
      };
    }

    // Handle RpcException (from gRPC calls)
    if (exception instanceof RpcException) {
      return this.handleRpcException(exception, path, timestamp);
    }

    // Handle gRPC errors that come as plain objects
    if (this.isGrpcError(exception)) {
      return this.handleGrpcError(exception, path, timestamp);
    }

    // Handle generic errors.
    //
    // This branch never grep-matches `exception.message` to infer 401/403
    // from arbitrary error strings (an Error containing "forbidden" or
    // "unauthorized" is not an auth error): that would present unrelated
    // 500-class failures as auth errors.
    //
    // Proper status inference must come from the exception **class** —
    // `BadRequestException`, `NotFoundException`, etc. all extend
    // `HttpException` and are already handled above with `getStatus()`.
    // Anything left here is a plain `Error` and is, by definition, a 500 —
    // unless it carries a numeric 4xx `statusCode`, which is how Fastify and
    // its plugins reject a request (@fastify/static's forbidden path → 403,
    // an oversized body → 413). That is a status set by code, not inferred
    // from a message, so it is honoured.
    if (exception instanceof Error) {
      const statusCode = (exception as { statusCode?: unknown }).statusCode;
      if (
        typeof statusCode === 'number' &&
        statusCode >= 400 &&
        statusCode <= 499
      ) {
        return {
          statusCode,
          error: this.getStatusText(statusCode),
          message: exception.message || this.getStatusText(statusCode),
          timestamp,
          path,
        };
      }

      return {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        error: 'Internal Server Error',
        message: exception.message || 'An unexpected error occurred',
        timestamp,
        path,
      };
    }

    // Fallback for unknown error types
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'Internal Server Error',
      message: 'An unexpected error occurred',
      timestamp,
      path,
    };
  }

  /**
   * Handle RpcException from gRPC calls
   */
  private handleRpcException(
    exception: RpcException,
    path: string,
    timestamp: string,
  ): StandardErrorResponse {
    const error = exception.getError();

    // Handle error object from gRPC
    if (typeof error === 'object' && error !== null) {
      const errorObj = error as Record<string, unknown>;

      // Check for scan error codes
      if (typeof errorObj.errorCode === 'number') {
        const details = getScanErrorDetails(
          errorObj.errorCode,
          errorObj.message as string,
        );
        return {
          statusCode: details.httpStatus,
          error: this.getStatusText(details.httpStatus),
          message: details.message,
          errorCode: details.code,
          errorCategory: (errorObj.errorCategory as string) || details.category,
          retriable: details.retriable,
          timestamp,
          path,
        };
      }

      // Map gRPC status codes to HTTP — numeric code only, no string
      // sniffing: a 500 INTERNAL whose detail happens to contain
      // "unauthorized" must stay a 500, not flip to 401.
      const grpcCode = errorObj.code as number;
      const message = (errorObj.message ||
        errorObj.details ||
        'gRPC error') as string;
      const httpStatus = this.grpcToHttpStatus(grpcCode);

      return {
        statusCode: httpStatus,
        error: this.getStatusText(httpStatus),
        message,
        timestamp,
        path,
      };
    }

    // Handle string error: no numeric gRPC code is available
    // on a bare-string payload, so we default to 500 instead of grepping
    // the message. Anything that needs a precise status should throw a
    // proper RpcException with an object payload carrying `code`.
    if (typeof error === 'string') {
      return {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        error: 'Internal Server Error',
        message: error,
        timestamp,
        path,
      };
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'Internal Server Error',
      message: 'An error occurred in the service',
      timestamp,
      path,
    };
  }

  /**
   * Check if an object looks like a gRPC error
   */
  private isGrpcError(obj: unknown): obj is Record<string, unknown> {
    if (typeof obj !== 'object' || obj === null) return false;
    const error = obj as Record<string, unknown>;
    return (
      typeof error.code === 'number' ||
      typeof error.details === 'string' ||
      typeof error.metadata === 'object'
    );
  }

  /**
   * Handle raw gRPC error objects
   */
  private handleGrpcError(
    error: Record<string, unknown>,
    path: string,
    timestamp: string,
  ): StandardErrorResponse {
    // Check for scan error codes in the error
    if (typeof error.errorCode === 'number') {
      const details = getScanErrorDetails(
        error.errorCode,
        error.message as string,
      );
      return {
        statusCode: details.httpStatus,
        error: this.getStatusText(details.httpStatus),
        message: details.message,
        errorCode: details.code,
        errorCategory: (error.errorCategory as string) || details.category,
        retriable: details.retriable,
        timestamp,
        path,
      };
    }

    const grpcCode = error.code as number;
    const message = (error.details ||
      error.message ||
      'Service error') as string;
    // The numeric code is the only signal we honour. The message
    // is still forwarded so operators see the upstream detail.
    const httpStatus = this.grpcToHttpStatus(grpcCode);

    return {
      statusCode: httpStatus,
      error: this.getStatusText(httpStatus),
      message,
      timestamp,
      path,
    };
  }

  /**
   * Map gRPC status codes to HTTP status codes.
   *
   * The status is driven by the numeric gRPC code only; unmapped codes
   * default to 500. The message is never grepped for words like
   * "unauthorized" / "forbidden" / "not found": that would mis-classify an
   * `INTERNAL` error as `401`/`403` whenever the upstream detail happens to
   * include a trigger word.
   *
   * Reference: https://grpc.github.io/grpc/core/md_doc_statuscodes.html
   */
  private grpcToHttpStatus(grpcCode: number): HttpStatus {
    const grpcToHttp: Record<number, HttpStatus> = {
      0: HttpStatus.OK, // OK
      1: HttpStatus.INTERNAL_SERVER_ERROR, // CANCELLED
      2: HttpStatus.INTERNAL_SERVER_ERROR, // UNKNOWN
      3: HttpStatus.BAD_REQUEST, // INVALID_ARGUMENT
      4: HttpStatus.GATEWAY_TIMEOUT, // DEADLINE_EXCEEDED
      5: HttpStatus.NOT_FOUND, // NOT_FOUND
      6: HttpStatus.CONFLICT, // ALREADY_EXISTS
      7: HttpStatus.FORBIDDEN, // PERMISSION_DENIED
      8: HttpStatus.TOO_MANY_REQUESTS, // RESOURCE_EXHAUSTED
      9: HttpStatus.BAD_REQUEST, // FAILED_PRECONDITION
      10: HttpStatus.CONFLICT, // ABORTED
      11: HttpStatus.BAD_REQUEST, // OUT_OF_RANGE
      12: HttpStatus.NOT_IMPLEMENTED, // UNIMPLEMENTED
      13: HttpStatus.INTERNAL_SERVER_ERROR, // INTERNAL
      14: HttpStatus.SERVICE_UNAVAILABLE, // UNAVAILABLE
      15: HttpStatus.INTERNAL_SERVER_ERROR, // DATA_LOSS
      16: HttpStatus.UNAUTHORIZED, // UNAUTHENTICATED
    };

    return grpcToHttp[grpcCode] ?? HttpStatus.INTERNAL_SERVER_ERROR;
  }

  /**
   * Get HTTP status text
   */
  private getStatusText(status: HttpStatus): string {
    const statusTexts: Record<number, string> = {
      [HttpStatus.OK]: 'OK',
      [HttpStatus.BAD_REQUEST]: 'Bad Request',
      [HttpStatus.UNAUTHORIZED]: 'Unauthorized',
      [HttpStatus.PAYMENT_REQUIRED]: 'Payment Required',
      [HttpStatus.FORBIDDEN]: 'Forbidden',
      [HttpStatus.NOT_FOUND]: 'Not Found',
      [HttpStatus.CONFLICT]: 'Conflict',
      [HttpStatus.PAYLOAD_TOO_LARGE]: 'Payload Too Large',
      [HttpStatus.UNPROCESSABLE_ENTITY]: 'Unprocessable Entity',
      [HttpStatus.TOO_MANY_REQUESTS]: 'Too Many Requests',
      [HttpStatus.INTERNAL_SERVER_ERROR]: 'Internal Server Error',
      [HttpStatus.NOT_IMPLEMENTED]: 'Not Implemented',
      [HttpStatus.BAD_GATEWAY]: 'Bad Gateway',
      [HttpStatus.SERVICE_UNAVAILABLE]: 'Service Unavailable',
      [HttpStatus.GATEWAY_TIMEOUT]: 'Gateway Timeout',
    };
    return statusTexts[status] || 'Error';
  }
}
