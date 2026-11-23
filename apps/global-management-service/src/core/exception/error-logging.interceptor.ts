import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { RpcException } from '@nestjs/microservices';
import { framesOf, isDriverError, safeDriverFields } from './driver-error';

function driverFields(err: Record<string, unknown>): string {
  return Object.entries(safeDriverFields(err))
    .map(([field, value]) => ` ${field}=${value}`)
    .join('');
}

/**
 * Logs an unexpected error of an RPC (never an HttpException or an
 * RpcException, which are answers). It names the class, the handler and, for
 * an ordinary error, its message and stack. A database driver error is logged
 * by class, code and constraint only, with its stack frames: never its
 * message, parameters, statement or detail, which can carry an argon2id hash,
 * a token digest or a personal value. Neither the request's data nor its
 * metadata is logged.
 */
@Injectable()
export class ErrorLoggingInterceptor implements NestInterceptor {
  constructor(private readonly logger: Logger) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      catchError((err) => {
        if (!(err instanceof HttpException) && !(err instanceof RpcException)) {
          const timestamp = new Date().toISOString();
          const errorName = err?.constructor?.name ?? 'unknown';
          const handler = `${context.getClass?.()?.name ?? 'unknown'}.${context.getHandler?.()?.name ?? 'unknown'}`;
          const record = (err ?? {}) as Record<string, unknown>;

          if (isDriverError(record)) {
            this.logger.error(
              `${errorName} in microservice global-management-service, "handler": "${handler}", "driverError":${driverFields(record)}, "errorStack": "${framesOf(err as Error)}", "timestamp": "${timestamp}", "service": "global-management-service" }`,
            );
          } else {
            this.logger.error(
              `${errorName} in microservice global-management-service, "handler": "${handler}", "errorMessage": "${err?.message}", "errorStack": "${err?.stack}", "timestamp": "${timestamp}", "service": "global-management-service" }`,
            );
          }
        }

        return throwError(() => err);
      }),
    );
  }
}
