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

@Injectable()
export class ErrorLoggingInterceptor implements NestInterceptor {
  constructor(private readonly logger: Logger) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      catchError((err) => {
        // An HttpException or an RpcException is not logged
        if (!(err instanceof HttpException) && !(err instanceof RpcException)) {
          const timestamp = new Date().toISOString();
          const main_request = context.switchToRpc().getContext();
          const error_name = err.constructor.name;

          this.logger.error(
            `${error_name} in microservice external-integrations-service, "errorMessage": "${err.message}", "errorStack": "${err.stack}", "error": ${JSON.stringify(
              err,
            )}, "request": ${JSON.stringify(
              main_request,
            )}, "timestamp": "${timestamp}", "service": "external-integrations-service" }`,
          );
        }

        return throwError(() => err);
      }),
    );
  }
}
