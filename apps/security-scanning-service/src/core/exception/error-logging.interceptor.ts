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
import { serializeLoggedError } from '../logger/logged-error';

const SERVICE = 'security-scanning-service';

/** The header in which a calling service names itself on a gRPC call. */
const CALLER_HEADER = 'x-cybedefend-service';

const MAX_FIELD_LENGTH = 128;

/** What the log says about the failed call: never its data, query values or headers. */
export interface FailedCall {
  /** The HTTP method, or `grpc`. */
  method: string;
  /** The route pattern (`/projects/:projectId`), or the handler of an RPC. */
  route: string;
  /** The status the caller gets for an unexpected error. */
  status: number | string;
  /** The signed-in user's id (HTTP), or the calling service (gRPC). */
  caller?: string;
}

/** Letters, digits and `_ . - / : { } *` only, cut to 128 characters. */
function safe(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const text = String(value)
    .replace(/[^\w.\-/:{}*]/g, '_')
    .slice(0, MAX_FIELD_LENGTH);
  return text.length > 0 ? text : undefined;
}

interface HttpRequestLike {
  method?: unknown;
  routeOptions?: { url?: unknown };
  routerPath?: unknown;
  route?: { path?: unknown };
  user?: { userId?: unknown; id?: unknown; sub?: unknown };
}

interface MetadataLike {
  get?: (key: string) => unknown[];
}

function describeCall(context: ExecutionContext): FailedCall {
  const handler = `${context.getClass?.()?.name ?? 'unknown'}.${context.getHandler?.()?.name ?? 'unknown'}`;
  if (context.getType?.() === 'http') {
    const req = (context.switchToHttp().getRequest?.() ??
      {}) as HttpRequestLike;
    const user = req.user ?? {};
    return {
      method: safe(req.method) ?? 'unknown',
      // The pattern, never the URL: its path and query string carry values.
      route:
        safe(req.routeOptions?.url) ??
        safe(req.routerPath) ??
        safe(req.route?.path) ??
        handler,
      status: 500,
      caller: safe(user.userId) ?? safe(user.id) ?? safe(user.sub),
    };
  }
  const metadata = context.switchToRpc?.().getContext?.() as
    | MetadataLike
    | undefined;
  const callers =
    typeof metadata?.get === 'function' ? metadata.get(CALLER_HEADER) : [];
  return {
    method: 'grpc',
    route: handler,
    // What gRPC answers for an error that is not an RpcException.
    status: 'UNKNOWN',
    caller: safe(callers[0]),
  };
}

/**
 * Logs an unexpected error of a call (never an HttpException or an
 * RpcException, which are answers): the call's method, route pattern or
 * handler, status and caller, and the error through the shared serializer,
 * which keeps its class, codes, constraint and stack and drops a database
 * error's statement, parameters and quoted values. The request's data, query
 * values and headers or metadata are never logged.
 */
@Injectable()
export class ErrorLoggingInterceptor implements NestInterceptor {
  constructor(private readonly logger: Logger) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      catchError((err: unknown) => {
        if (!(err instanceof HttpException) && !(err instanceof RpcException)) {
          const error = serializeLoggedError(err);
          const type =
            typeof error === 'object' && error !== null && 'type' in error
              ? String(error.type)
              : typeof err;
          this.logger.error(
            `${type} in microservice ${SERVICE}, "call": ${JSON.stringify(
              describeCall(context),
            )}, "error": ${JSON.stringify(error)}, "timestamp": "${new Date().toISOString()}", "service": "${SERVICE}" }`,
          );
        }

        return throwError(() => err);
      }),
    );
  }
}
