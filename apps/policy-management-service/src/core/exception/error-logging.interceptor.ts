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

/**
 * Interceptor for logging errors that occur during request processing.
 * Does not log HttpException or RpcException as these are expected errors.
 */
@Injectable()
export class ErrorLoggingInterceptor implements NestInterceptor {
  constructor(private readonly logger: Logger) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      catchError((err) => {
        // Do not log HttpException or RpcException as they are expected errors
        if (!(err instanceof HttpException) && !(err instanceof RpcException)) {
          const timestamp = new Date().toISOString();
          const mainRequest = context.switchToRpc().getContext();
          const errorName = err.constructor.name;

          this.logger.error(
            `${errorName} in microservice policy-management-service, "errorMessage": "${err.message}", "errorStack": "${err.stack}", "error": ${JSON.stringify(
              err,
            )}, "request": ${JSON.stringify(
              mainRequest,
            )}, "timestamp": "${timestamp}", "service": "policy-management-service" }`,
          );
        }

        return throwError(() => err);
      }),
    );
  }
}
