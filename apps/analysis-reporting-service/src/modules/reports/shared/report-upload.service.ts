import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc, RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { Logger } from 'nestjs-pino';
import { Span } from 'nestjs-otel';

import {
  FILE_SERVICE_NAME,
  FileServiceClient,
} from '@grpc/file-management/file_management';
import { safeGrpcCall } from '@grpc/wrapper-grpc.module';

const DEFAULT_TTL_SECONDS = 900; // 15 minutes — must match dashboard expectations.

// On Google Cloud Storage, file-management mints the report PUT URL with a
// signed `x-goog-content-length-range` extension header (file.service.ts
// requestReportUploadUrl). A signed header MUST be echoed verbatim on the PUT
// or the storage rejects the request (HTTP 400). This value MUST stay in
// lockstep with the range file-management signs. An S3 signed URL carries no
// such header, so the header is added only for googleapis.com URLs — matching
// the convention in github/gitlab/dashboard upload paths (buildUploadHeaders).
const GCS_CONTENT_LENGTH_RANGE = '0,104857600'; // 0–100 MB

export interface UploadReportInput {
  projectId: string;
  filename: string;
  contentType: string;
  buffer: Buffer;
}

export interface UploadedReport {
  downloadUrl: string;
  expiresAtMs: number;
  filename: string;
  contentType: string;
  // storage object key — persisted so the URL can be re-minted later via
  // signExisting() once the original signed URL has expired.
  objectPath: string;
}

export interface SignExistingInput {
  // The tenant owning the report. Required so file-management can enforce
  // that the objectPath belongs to this projectId (cross-tenant boundary).
  projectId: string;
  objectPath: string;
  filename: string;
  ttlSeconds?: number;
}

export interface SignedReport {
  downloadUrl: string;
  expiresAtMs: number;
}

/**
 * Orchestrates the two-step upload to file-management so each
 * report generator can drop a Buffer and get back a signed download URL.
 *
 * The buffer never transits over gRPC — it is PUT directly to object storage via
 * the short-lived signed URL returned by file-management. This avoids the
 * 50 MB gRPC max-message ceiling and bounds RAM under concurrent reports
 * (no extra copy on the file-management side).
 *
 * Failure semantics:
 *   - Any RpcException from file-management propagates unchanged.
 *   - A non-2xx PUT response wraps as RpcException(INTERNAL).
 *   - In both cases, FinalizeReportUpload is not called, and the caller
 *     should NOT persist an audit row for the report.
 */
@Injectable()
export class ReportUploadService implements OnModuleInit {
  private fileServiceClient!: FileServiceClient;

  constructor(
    @Inject('FILE_MANAGEMENT_SERVICE')
    private readonly fileClient: ClientGrpc,
    private readonly logger: Logger,
  ) {}

  onModuleInit(): void {
    this.fileServiceClient =
      this.fileClient.getService<FileServiceClient>(FILE_SERVICE_NAME);
  }

  @Span()
  async uploadReport(input: UploadReportInput): Promise<UploadedReport> {
    const { projectId, filename, contentType, buffer } = input;

    // Step 1 — ask file-management for a signed PUT URL + assigned key.
    const upload = await safeGrpcCall(
      this.fileServiceClient.requestReportUploadUrl({
        projectId,
        filename,
        contentType,
      }),
    );

    // Step 2 — PUT the buffer directly to object storage via the signed URL.
    // A Google Cloud Storage signed URL pins `x-goog-content-length-range`,
    // a signed header that has to be sent back on the PUT or the storage
    // rejects it (HTTP 400). An S3 signed URL carries no such header.
    const headers: Record<string, string> = { 'Content-Type': contentType };
    if (upload.uploadUrl.includes('googleapis.com')) {
      headers['x-goog-content-length-range'] = GCS_CONTENT_LENGTH_RANGE;
    }

    let response: Response;
    try {
      response = await fetch(upload.uploadUrl, {
        method: 'PUT',
        headers,
        body: buffer as unknown as BodyInit,
      });
    } catch (err) {
      this.logger.error(
        `Failed to PUT report to signed URL: ${(err as Error).message}`,
      );
      throw new RpcException({
        code: status.INTERNAL,
        message: 'Report storage temporarily unavailable',
      });
    }

    if (!response.ok) {
      // Best-effort body capture for ops triage; don't fail if it can't be read.
      let body = '';
      try {
        body = (await response.text()).slice(0, 256);
      } catch {
        // ignore
      }
      this.logger.error(
        `Report PUT rejected by storage: ${response.status} ${response.statusText} ${body}`,
      );
      throw new RpcException({
        code: status.INTERNAL,
        message: `Report storage upload failed (HTTP ${response.status})`,
      });
    }

    // Step 3 — exchange the object path for a signed READ URL.
    // We re-send the filename so file-management can embed it in
    // Content-Disposition: attachment on the signed URL — without that the
    // browser would render PDFs inline instead of triggering a download.
    // We also re-send projectId so file-management can enforce the
    // cross-tenant boundary on the objectPath (defence in depth alongside
    // the analysis-reporting-side guard in result.controller.ts).
    const finalize = await safeGrpcCall(
      this.fileServiceClient.finalizeReportUpload({
        objectPath: upload.objectPath,
        ttlSeconds: DEFAULT_TTL_SECONDS,
        filename,
        projectId,
      }),
    );

    return {
      downloadUrl: finalize.downloadUrl,
      expiresAtMs: Number(finalize.expiresAtMs),
      filename,
      contentType,
      objectPath: upload.objectPath,
    };
  }

  /**
   * Re-mint a fresh signed READ URL for an object already in storage.
   *
   * Used by the async-report refetch path (GetGeneratedReport): the original
   * 15-minute URL handed out at generation time may have expired, so the
   * gateway asks for a new one keyed by the persisted objectPath. No re-upload
   * happens — only a FinalizeReportUpload call.
   */
  @Span()
  async signExisting(input: SignExistingInput): Promise<SignedReport> {
    const finalize = await safeGrpcCall(
      this.fileServiceClient.finalizeReportUpload({
        objectPath: input.objectPath,
        ttlSeconds: input.ttlSeconds ?? DEFAULT_TTL_SECONDS,
        filename: input.filename,
        projectId: input.projectId,
      }),
    );
    return {
      downloadUrl: finalize.downloadUrl,
      expiresAtMs: Number(finalize.expiresAtMs),
    };
  }

  /**
   * Hard-delete a stored report object. Used by the retention purge
   * cron and the user-initiated delete endpoints. file-management enforces the
   * reports/<projectId>/ cross-tenant boundary and is idempotent on a missing
   * object, so a NOT_FOUND resolves successfully here too.
   */
  @Span()
  async deleteReport(objectPath: string, projectId: string): Promise<void> {
    await safeGrpcCall(
      this.fileServiceClient.deleteReportObject({ objectPath, projectId }),
    );
  }
}
