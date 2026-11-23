import { createHash } from 'node:crypto';
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Logger } from 'nestjs-pino';
import { importRefusal } from '../scan/import/import-errors';
import {
  clusterScanRefusal,
  grpcStatusName,
  scanRunRefusal,
} from './scan-run-errors';
import { ScanRunClient } from './scan-run.client';

/** A per-container upload token (Global Constraints): `cdst_` + 32 bytes in base64url. */
export const SCAN_TOKEN_PATTERN = /^cdst_[A-Za-z0-9_-]{43}$/;
/** The protocol header the scanner runner sends (`1`, or `2` when its sca pod may send an SBOM). */
export const SCAN_PROTOCOL_HEADER = 'x-cybedefend-scan-protocol';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** At most nine digits: anything longer is not an int32 the proto can carry. */
const PROTOCOL_PATTERN = /^[0-9]{1,9}$/;

/** What `AuthorizeScanUpload` said about the token, for the handler. */
export interface ScanRunContext {
  scanId: string;
  /** SHA-256 hex of the token; the token itself is never kept. */
  tokenHash: string;
  projectId: string;
  organizationId: string;
  containerId: string;
  category: string;
  /**
   * The protocol security-scanning accepted (1 or 2). Only 2 may carry the
   * `sbom` part, and only for the sca container.
   */
  protocolVersion: number;
}

export type ScanRunRequest = FastifyRequest & {
  params: { scanId?: string };
  scanRun?: ScanRunContext;
};

/** The bearer token of the request, or undefined when it is not one header `Bearer <token>`. */
function bearerOf(req: ScanRunRequest): string | undefined {
  const header = req.headers?.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
    return undefined;
  }
  return header.slice('Bearer '.length);
}

/** The protocol header as an int32; 0 when missing or not a small integer. */
function protocolVersionOf(req: ScanRunRequest): number {
  const value = req.headers?.[SCAN_PROTOCOL_HEADER];
  return typeof value === 'string' && PROTOCOL_PATTERN.test(value)
    ? Number(value)
    : 0;
}

/**
 * Authenticates `POST /scan-runs/:scanId/results` by the scanner pod's
 * per-container token, never by a user. The token must match
 * `SCAN_TOKEN_PATTERN` and the scan id be a UUID, or the request is 401
 * SCAN_TOKEN_INVALID before any gRPC call. Otherwise security-scanning's
 * `AuthorizeScanUpload` decides, from the token's SHA-256 hex and the
 * protocol header (missing ⇒ 0), and its answer lands on `req.scanRun`.
 *
 * In the cloud no token is ever minted and security-scanning serves no
 * `ClusterScanService` (UNIMPLEMENTED): every call is 401.
 *
 * Never logged: the token, its hash, the header value. A log line carries
 * the scan id and the gRPC status name only.
 */
@Injectable()
export class ScanUploadTokenGuard implements CanActivate {
  constructor(
    private readonly client: ScanRunClient,
    private readonly logger: Logger,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<ScanRunRequest>();
    const scanId = req.params?.scanId;
    const token = bearerOf(req);
    if (
      typeof scanId !== 'string' ||
      !UUID_PATTERN.test(scanId) ||
      token === undefined ||
      !SCAN_TOKEN_PATTERN.test(token)
    ) {
      throw scanRunRefusal('SCAN_TOKEN_INVALID');
    }
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const protocolVersion = protocolVersionOf(req);

    let answer: Awaited<ReturnType<ScanRunClient['authorizeScanUpload']>>;
    try {
      answer = await this.client.authorizeScanUpload({
        scanId,
        tokenHash,
        protocolVersion,
      });
    } catch (error) {
      this.logger.warn(
        `SCAN_RUN_UPLOAD_REFUSED scan=${scanId} step=authorize status=${grpcStatusName(error)}`,
      );
      throw clusterScanRefusal(error).exception;
    }

    // The container id names the storage key: it must be one, whatever
    // security-scanning answered.
    if (
      typeof answer?.containerId !== 'string' ||
      !UUID_PATTERN.test(answer.containerId) ||
      typeof answer.projectId !== 'string' ||
      !UUID_PATTERN.test(answer.projectId)
    ) {
      this.logger.warn(
        `SCAN_RUN_UPLOAD_REFUSED scan=${scanId} step=authorize status=malformed_answer`,
      );
      throw importRefusal('IMPORT_UNAVAILABLE');
    }

    req.scanRun = {
      scanId,
      tokenHash,
      projectId: answer.projectId,
      organizationId: answer.organizationId,
      containerId: answer.containerId,
      category: answer.category,
      protocolVersion,
    };
    return true;
  }
}
