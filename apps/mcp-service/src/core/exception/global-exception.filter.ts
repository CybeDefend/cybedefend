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
import { serializeLoggedError } from '../logger/logged-error';

/** What the client reads for an error no code path meant to answer. */
export const UNEXPECTED_ERROR_MESSAGE = 'An unexpected error occurred';

/**
 * A gRPC UNKNOWN is what a service answers for an error it let escape: its
 * detail is that error's own text, not a message meant for the client.
 */
function isUnexpectedGrpcError(code: unknown): boolean {
  return code === 2;
}

/**
 * Standard error response structure (mirrors gateway-service envelope).
 */
export interface StandardErrorResponse {
  statusCode: number;
  error: string;
  message: string;
  errorCode?: number;
  errorCategory?: string;
  retriable?: boolean;
  timestamp: string;
  path: string;
}

/**
 * Global exception filter that handles all exceptions and converts them
 * to a standardized error response format.
 *
 * Ported from gateway-service; scan-specific (`ScanErrorException`) branch
 * has been removed since mcp-service does not handle scan flows. The
 * `RpcException` branch is kept (even though v1 has no gRPC clients) so
 * this filter remains drop-in compatible if gRPC is added later.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<{ url?: string }>();

    const errorResponse = this.buildErrorResponse(
      exception,
      request?.url ?? '',
    );

    // Logged without the query string, whose values can be tokens. A 5xx is
    // logged through the serializer: its code and stack, never the values a
    // statement's error quotes.
    const loggedPath = errorResponse.path.split('?')[0];
    if (errorResponse.statusCode >= 500) {
      this.logger.error({
        err:
          exception instanceof Error
            ? serializeLoggedError(exception)
            : { code: (exception as { code?: unknown } | null)?.code },
        msg: `[${errorResponse.statusCode}] ${errorResponse.message} - ${loggedPath}`,
      });
    } else if (errorResponse.statusCode >= 400) {
      this.logger.warn(
        `[${errorResponse.statusCode}] ${errorResponse.message} - ${loggedPath}`,
      );
    }

    // Fastify-style `status(n).send(x)`.
    response.status(errorResponse.statusCode).send(errorResponse);
  }

  private buildErrorResponse(
    exception: unknown,
    path: string,
  ): StandardErrorResponse {
    const timestamp = new Date().toISOString();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        const resp = exceptionResponse as Record<string, unknown>;
        return {
          statusCode: status,
          error: this.getStatusText(status),
          message:
            (resp.message as string) ||
            exception.message ||
            'An error occurred',
          errorCode: resp.errorCode as number | undefined,
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

    if (exception instanceof RpcException) {
      return this.handleRpcException(exception, path, timestamp);
    }

    if (this.isGrpcError(exception)) {
      return this.handleGrpcError(exception, path, timestamp);
    }

    if (exception instanceof Error) {
      const lowerMessage = exception.message.toLowerCase();
      if (
        lowerMessage.includes('unauthorized') ||
        lowerMessage.includes('authentication') ||
        lowerMessage.includes('credentials') ||
        lowerMessage.includes('401')
      ) {
        // The status is inferred from the error's words; the words are not
        // answered (a plain error's text is not meant for the client).
        return {
          statusCode: HttpStatus.UNAUTHORIZED,
          error: 'Unauthorized',
          message: 'Unauthorized',
          errorCategory: 'authentication',
          timestamp,
          path,
        };
      }

      if (lowerMessage.includes('forbidden') || lowerMessage.includes('403')) {
        return {
          statusCode: HttpStatus.FORBIDDEN,
          error: 'Forbidden',
          message: 'Forbidden',
          errorCategory: 'authentication',
          timestamp,
          path,
        };
      }

      return {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        error: 'Internal Server Error',
        message: UNEXPECTED_ERROR_MESSAGE,
        timestamp,
        path,
      };
    }

    // Fallback for unknown error types (strings, objects without .message, null, etc.)
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'Internal Server Error',
      message: 'An unexpected error occurred',
      timestamp,
      path,
    };
  }

  private handleRpcException(
    exception: RpcException,
    path: string,
    timestamp: string,
  ): StandardErrorResponse {
    const error = exception.getError();

    if (typeof error === 'object' && error !== null) {
      const errorObj = error as Record<string, unknown>;
      const grpcCode = errorObj.code as number;
      if (isUnexpectedGrpcError(grpcCode)) {
        return this.unexpectedGrpcError(grpcCode, path, timestamp);
      }
      const message = (errorObj.message ||
        errorObj.details ||
        'gRPC error') as string;
      const httpStatus = this.grpcToHttpStatus(grpcCode, message);

      return {
        statusCode: httpStatus,
        error: this.getStatusText(httpStatus),
        message,
        timestamp,
        path,
      };
    }

    if (typeof error === 'string') {
      const httpStatus = this.inferHttpStatusFromMessage(error);
      return {
        statusCode: httpStatus,
        error: this.getStatusText(httpStatus),
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

  /** A downstream error the service let escape: status from the code alone. */
  private unexpectedGrpcError(
    grpcCode: number,
    path: string,
    timestamp: string,
  ): StandardErrorResponse {
    const httpStatus = this.grpcToHttpStatus(grpcCode);
    return {
      statusCode: httpStatus,
      error: this.getStatusText(httpStatus),
      message: UNEXPECTED_ERROR_MESSAGE,
      timestamp,
      path,
    };
  }

  private isGrpcError(obj: unknown): obj is Record<string, unknown> {
    if (typeof obj !== 'object' || obj === null) return false;
    const error = obj as Record<string, unknown>;
    return (
      typeof error.code === 'number' ||
      typeof error.details === 'string' ||
      typeof error.metadata === 'object'
    );
  }

  private handleGrpcError(
    error: Record<string, unknown>,
    path: string,
    timestamp: string,
  ): StandardErrorResponse {
    const grpcCode = error.code as number;
    if (isUnexpectedGrpcError(grpcCode)) {
      return this.unexpectedGrpcError(grpcCode, path, timestamp);
    }
    const message = (error.details ||
      error.message ||
      'Service error') as string;
    const httpStatus = this.grpcToHttpStatus(grpcCode, message);

    return {
      statusCode: httpStatus,
      error: this.getStatusText(httpStatus),
      message,
      timestamp,
      path,
    };
  }

  private grpcToHttpStatus(grpcCode: number, message?: string): HttpStatus {
    if (message) {
      const lowerMessage = message.toLowerCase();
      if (
        lowerMessage.includes('unauthorized') ||
        lowerMessage.includes('invalid credentials') ||
        lowerMessage.includes('authentication failed')
      ) {
        return HttpStatus.UNAUTHORIZED;
      }
      if (
        lowerMessage.includes('forbidden') ||
        lowerMessage.includes('permission denied')
      ) {
        return HttpStatus.FORBIDDEN;
      }
    }

    // Reference: https://grpc.github.io/grpc/core/md_doc_statuscodes.html
    const grpcToHttp: Record<number, HttpStatus> = {
      0: HttpStatus.OK,
      1: HttpStatus.INTERNAL_SERVER_ERROR,
      2: HttpStatus.INTERNAL_SERVER_ERROR,
      3: HttpStatus.BAD_REQUEST,
      4: HttpStatus.GATEWAY_TIMEOUT,
      5: HttpStatus.NOT_FOUND,
      6: HttpStatus.CONFLICT,
      7: HttpStatus.FORBIDDEN,
      8: HttpStatus.TOO_MANY_REQUESTS,
      9: HttpStatus.BAD_REQUEST,
      10: HttpStatus.CONFLICT,
      11: HttpStatus.BAD_REQUEST,
      12: HttpStatus.NOT_IMPLEMENTED,
      13: HttpStatus.INTERNAL_SERVER_ERROR,
      14: HttpStatus.SERVICE_UNAVAILABLE,
      15: HttpStatus.INTERNAL_SERVER_ERROR,
      16: HttpStatus.UNAUTHORIZED,
    };

    return grpcToHttp[grpcCode] || HttpStatus.INTERNAL_SERVER_ERROR;
  }

  private inferHttpStatusFromMessage(message: string): HttpStatus {
    const lowerMessage = message.toLowerCase();

    if (
      lowerMessage.includes('unauthorized') ||
      lowerMessage.includes('authentication') ||
      lowerMessage.includes('credentials') ||
      lowerMessage.includes('401')
    ) {
      return HttpStatus.UNAUTHORIZED;
    }

    if (
      lowerMessage.includes('forbidden') ||
      lowerMessage.includes('permission') ||
      lowerMessage.includes('403')
    ) {
      return HttpStatus.FORBIDDEN;
    }

    if (lowerMessage.includes('not found') || lowerMessage.includes('404')) {
      return HttpStatus.NOT_FOUND;
    }

    if (
      lowerMessage.includes('timeout') ||
      lowerMessage.includes('timed out')
    ) {
      return HttpStatus.GATEWAY_TIMEOUT;
    }

    if (
      lowerMessage.includes('unavailable') ||
      lowerMessage.includes('connection refused')
    ) {
      return HttpStatus.SERVICE_UNAVAILABLE;
    }

    return HttpStatus.INTERNAL_SERVER_ERROR;
  }

  private getStatusText(status: HttpStatus): string {
    const statusTexts: Record<number, string> = {
      [HttpStatus.OK]: 'OK',
      [HttpStatus.BAD_REQUEST]: 'Bad Request',
      [HttpStatus.UNAUTHORIZED]: 'Unauthorized',
      [HttpStatus.FORBIDDEN]: 'Forbidden',
      [HttpStatus.NOT_FOUND]: 'Not Found',
      [HttpStatus.CONFLICT]: 'Conflict',
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
