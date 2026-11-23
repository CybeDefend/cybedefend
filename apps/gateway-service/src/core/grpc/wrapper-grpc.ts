// src/core/grpc/exception-grpc.filter.ts
import { HttpException, HttpStatus } from '@nestjs/common';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { lastValueFrom, Observable, throwError, timeout } from 'rxjs';
import { context, propagation, trace } from '@opentelemetry/api';
import { Metadata } from '@grpc/grpc-js';

const grpcToHttpMap: Record<number, number> = {
  [GrpcStatus.CANCELLED]: 499, // Client Closed Request
  [GrpcStatus.UNKNOWN]: HttpStatus.INTERNAL_SERVER_ERROR,
  [GrpcStatus.INVALID_ARGUMENT]: HttpStatus.BAD_REQUEST,
  [GrpcStatus.DEADLINE_EXCEEDED]: HttpStatus.GATEWAY_TIMEOUT,
  [GrpcStatus.NOT_FOUND]: HttpStatus.NOT_FOUND,
  [GrpcStatus.ALREADY_EXISTS]: HttpStatus.CONFLICT,
  [GrpcStatus.PERMISSION_DENIED]: HttpStatus.FORBIDDEN,
  [GrpcStatus.RESOURCE_EXHAUSTED]: HttpStatus.TOO_MANY_REQUESTS,
  [GrpcStatus.FAILED_PRECONDITION]: HttpStatus.BAD_REQUEST,
  [GrpcStatus.ABORTED]: HttpStatus.CONFLICT,
  [GrpcStatus.OUT_OF_RANGE]: HttpStatus.BAD_REQUEST,
  [GrpcStatus.UNIMPLEMENTED]: HttpStatus.NOT_IMPLEMENTED,
  [GrpcStatus.INTERNAL]: HttpStatus.INTERNAL_SERVER_ERROR,
  [GrpcStatus.UNAVAILABLE]: HttpStatus.SERVICE_UNAVAILABLE,
  [GrpcStatus.DATA_LOSS]: HttpStatus.INTERNAL_SERVER_ERROR,
  [GrpcStatus.UNAUTHENTICATED]: HttpStatus.UNAUTHORIZED,
};

/**
 * Create gRPC metadata with OpenTelemetry trace context propagation
 * This ensures distributed tracing works across microservices
 */
export function createTracedMetadata(): Metadata {
  const metadata = new Metadata();
  const activeContext = context.active();
  const span = trace.getSpan(activeContext);

  if (!span) {
    return metadata; // No active span, return empty metadata
  }

  const carrier: Record<string, string> = {};

  // Inject trace context using W3C Trace Context propagator
  propagation.inject(activeContext, carrier);

  // Add all propagated headers to gRPC metadata
  Object.entries(carrier).forEach(([key, value]) => {
    metadata.set(key, value);
  });

  return metadata;
}

/**
 * security-scanning's refusals of a graph-only analysis (closed extension):
 * at most one in flight per project, three per organisation. They come as RESOURCE_EXHAUSTED
 * with the code as `details`, and leave the gateway as a 429 whose body
 * carries the same `code` and a fixed sentence: the dashboard switches on
 * the code and shows its own translated sentence.
 */
const GRAPH_ONLY_LIMITS: Record<string, string> = {
  GRAPH_ONLY_PROJECT_BUSY: 'An analysis of this project is already running',
  GRAPH_ONLY_ORG_LIMIT:
    'Three analyses are already running in this organisation',
};

/**
 * Stable refusal codes of the scan start routes, keyed by gRPC
 * status, then by the gRPC message. `safeGrpcCall` answers a listed pair as
 * `HttpException({ code: <message>, message: <fixed sentence> }, status)`,
 * so clients switch on the body's `code` in every edition.
 * SCANNERS_NOT_AVAILABLE comes from security-scanning `CreateScan` /
 * `StartScan` and from external-integrations manual scans,
 * on every scan start route; NO_SCANNER_ENABLED from security-scanning
 * `CheckExistingScan` when no scanner would run for the project; IMPORT_UNAVAILABLE from security-scanning's
 * `StartScan` when the import results could not be queued. Every other refusal keeps the plain status
 * mapping and the server's text.
 */
export const GRPC_REFUSAL_CODES: Readonly<
  Record<
    number,
    Readonly<Record<string, { status: HttpStatus; message: string }>>
  >
> = {
  [GrpcStatus.FAILED_PRECONDITION]: {
    SCANNERS_NOT_AVAILABLE: {
      status: HttpStatus.CONFLICT,
      message: 'This edition runs no scanners; import results instead.',
    },
    NO_SCANNER_ENABLED: {
      status: HttpStatus.CONFLICT,
      message:
        "This project has no scanner enabled: turn on at least one of SAST, IaC, SCA or secrets in the project's settings.",
    },
  },
  [GrpcStatus.UNAVAILABLE]: {
    IMPORT_UNAVAILABLE: {
      status: HttpStatus.SERVICE_UNAVAILABLE,
      message: 'The results could not be queued for processing.',
    },
  },
};

/** The HTTP status of a gRPC status code; 500 for anything unknown. */
export function grpcStatusToHttpStatus(grpcCode: unknown): number {
  return (
    (typeof grpcCode === 'number' ? grpcToHttpMap[grpcCode] : undefined) ??
    HttpStatus.INTERNAL_SERVER_ERROR
  );
}

export interface SafeGrpcCallOptions {
  /** Give up after this many ms: the call is cancelled and answers 504. */
  deadlineMs?: number;
}

/**
 * `call`, abandoned after `deadlineMs`. Unsubscribing cancels
 * the gRPC call (the teardown of a Nest unary observable is `call.cancel()`),
 * and the error is shaped like the one grpc-js raises for a deadline, so a
 * caller maps it like any other status: DEADLINE_EXCEEDED, i.e. 504.
 */
export function withGrpcDeadline<T>(
  call: Observable<T>,
  deadlineMs: number,
): Observable<T> {
  return call.pipe(
    timeout({
      first: deadlineMs,
      with: () => throwError(() => deadlineExceeded(deadlineMs)),
    }),
  );
}

function deadlineExceeded(deadlineMs: number): Error & {
  code: number;
  details: string;
} {
  const details = `Deadline of ${deadlineMs} ms exceeded`;
  return Object.assign(
    new Error(`${GrpcStatus.DEADLINE_EXCEEDED} DEADLINE_EXCEEDED: ${details}`),
    { code: GrpcStatus.DEADLINE_EXCEEDED, details },
  );
}

export async function safeGrpcCall<T>(
  observable: Observable<T>,
  { deadlineMs }: SafeGrpcCallOptions = {},
): Promise<T> {
  const call = deadlineMs
    ? withGrpcDeadline(observable, deadlineMs)
    : observable;
  try {
    return await lastValueFrom(call);
  } catch (error) {
    const grpcCode = (error as any)?.code ?? 2;
    const message =
      (error as any)?.details ??
      (error as any)?.message ??
      'Internal server error';

    if (
      grpcCode === GrpcStatus.RESOURCE_EXHAUSTED &&
      typeof message === 'string' &&
      Object.prototype.hasOwnProperty.call(GRAPH_ONLY_LIMITS, message)
    ) {
      throw new HttpException(
        { code: message, message: GRAPH_ONLY_LIMITS[message] },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (typeof message === 'string') {
      const refusal = GRPC_REFUSAL_CODES[grpcCode]?.[message];
      if (refusal) {
        throw new HttpException(
          { code: message, message: refusal.message },
          refusal.status,
        );
      }
    }

    throw new HttpException(message, grpcStatusToHttpStatus(grpcCode));
  }
}
