import { status as GrpcStatus } from '@grpc/grpc-js';
import { HttpException, HttpStatus } from '@nestjs/common';
import { importRefusal } from '../scan/import/import-errors';

/**
 * The refusals of `POST /scan-runs/:scanId/results` that are not the
 * import's own. Clients (the scanner runner) switch on `body.code`; the
 * message is a fixed sentence, never what a downstream service answered.
 */
export const SCAN_RUN_CODES = [
  'SCAN_TOKEN_INVALID',
  'SCAN_PROTOCOL_UNSUPPORTED',
  'SCAN_RESULTS_ALREADY_SUBMITTED',
] as const;

export type ScanRunCode = (typeof SCAN_RUN_CODES)[number];

const REFUSALS: Readonly<
  Record<ScanRunCode, { status: HttpStatus; message: string }>
> = {
  SCAN_TOKEN_INVALID: {
    status: HttpStatus.UNAUTHORIZED,
    message: 'The scan token is invalid.',
  },
  SCAN_PROTOCOL_UNSUPPORTED: {
    status: HttpStatus.BAD_REQUEST,
    message: 'This scan protocol version is not supported.',
  },
  SCAN_RESULTS_ALREADY_SUBMITTED: {
    status: HttpStatus.CONFLICT,
    message: 'The results of this scanner were already submitted.',
  },
};

/** The refusal of `code`: its status, `{ code, message }` as the body. */
export function scanRunRefusal(code: ScanRunCode): HttpException {
  const { status, message } = REFUSALS[code];
  return new HttpException({ code, message }, status);
}

/** How a gRPC refusal of `ClusterScanService` leaves the gateway. */
export interface ClusterScanRefusal {
  /** The HTTP answer, with a fixed body. */
  exception: HttpException;
  /**
   * True only when the call was refused before the token could be spent:
   * the object just stored belongs to no import and may be deleted. False
   * for ALREADY_EXISTS (a concurrent winner imports that very object) and
   * for every failure whose outcome is unknown (deadline, unavailable):
   * security-scanning deletes what it claimed and could not import.
   */
  refusedBeforeClaim: boolean;
}

/** The status and message of a grpc-js ServiceError, never thrown at. */
function grpcStatusOf(error: unknown): { code: unknown; details: unknown } {
  const e = error as { code?: unknown; details?: unknown } | null;
  return { code: e?.code, details: e?.details };
}

/**
 * The closed mapping of a `ClusterScanService` failure (its refusals):
 * UNAUTHENTICATED ⇒ 401 SCAN_TOKEN_INVALID, ALREADY_EXISTS ⇒ 409
 * SCAN_RESULTS_ALREADY_SUBMITTED, INVALID_ARGUMENT or FAILED_PRECONDITION
 * ⇒ 400 with the gRPC message as the code when it is SCAN_PROTOCOL_UNSUPPORTED
 * (IMPORT_INVALID_REQUEST otherwise). UNIMPLEMENTED (a cloud security-scanning,
 * which mints no token), NOT_FOUND and PERMISSION_DENIED are an invalid token
 * too. Anything else is 503 IMPORT_UNAVAILABLE: the runner retries.
 */
export function clusterScanRefusal(error: unknown): ClusterScanRefusal {
  const { code, details } = grpcStatusOf(error);
  switch (code) {
    case GrpcStatus.UNAUTHENTICATED:
    case GrpcStatus.UNIMPLEMENTED:
    case GrpcStatus.NOT_FOUND:
    case GrpcStatus.PERMISSION_DENIED:
      return {
        exception: scanRunRefusal('SCAN_TOKEN_INVALID'),
        refusedBeforeClaim: true,
      };
    case GrpcStatus.ALREADY_EXISTS:
      return {
        exception: scanRunRefusal('SCAN_RESULTS_ALREADY_SUBMITTED'),
        refusedBeforeClaim: false,
      };
    case GrpcStatus.INVALID_ARGUMENT:
    case GrpcStatus.FAILED_PRECONDITION:
      return {
        exception:
          details === 'SCAN_PROTOCOL_UNSUPPORTED'
            ? scanRunRefusal('SCAN_PROTOCOL_UNSUPPORTED')
            : importRefusal('IMPORT_INVALID_REQUEST'),
        refusedBeforeClaim: true,
      };
    default:
      return {
        exception: importRefusal('IMPORT_UNAVAILABLE'),
        refusedBeforeClaim: false,
      };
  }
}

/** The gRPC status name of a failure, for a log line; never its message. */
export function grpcStatusName(error: unknown): string {
  const { code } = grpcStatusOf(error);
  return typeof code === 'number' && GrpcStatus[code] !== undefined
    ? GrpcStatus[code]
    : 'unknown';
}
