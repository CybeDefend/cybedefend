import { Controller } from '@nestjs/common';
import { GrpcMethod, Payload, RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { Logger } from 'nestjs-pino';
import { FileService } from './file.service';
import { Span } from 'nestjs-otel';
import {
  DeleteFileRequest,
  DeleteFileResponse,
  DeleteImportObjectRequest,
  DeleteImportObjectResponse,
  DeleteReportObjectRequest,
  DeleteReportObjectResponse,
  FinalizeReportUploadRequest,
  FinalizeReportUploadResponse,
  GetDownloadUrlRequest,
  GetDownloadUrlResponse,
  GetImportDownloadUrlRequest,
  GetImportDownloadUrlResponse,
  RequestImportUploadUrlRequest,
  RequestImportUploadUrlResponse,
  RequestReportUploadUrlRequest,
  RequestReportUploadUrlResponse,
  UploadFileRequest,
  UploadFileResponse,
} from '@grpc/file-management/file';

// Explicit @GrpcMethod handlers, never ts-proto's
// `@FileServiceControllerMethods()` + `implements FileServiceController` —
// the export strips RequestDiffScanUploadUrl from the proto, so the
// generated interface would no longer compile in the exported tree. That RPC
// is served by the closed edition; Nest serves one gRPC service from
// handlers spread over two controllers.
@Controller()
export class FileController {
  constructor(
    private readonly fileService: FileService,
    private readonly logger: Logger,
  ) {}

  /**
   * Upload a file to the storage bucket and save the metadata in the database.
   *
   * @param request - The request object containing the file and metadata.
   * @returns The response object containing the file metadata or an error.
   */
  @Span()
  @GrpcMethod('FileService', 'UploadFile')
  async uploadFile(request: UploadFileRequest): Promise<UploadFileResponse> {
    try {
      return await this.fileService.uploadFile(request);
    } catch (error) {
      // A bad artifact kind is the caller's mistake: keep its status.
      if (
        error instanceof RpcException &&
        (error.getError() as { code?: number })?.code ===
          status.INVALID_ARGUMENT
      ) {
        throw error;
      }
      this.logger.error(`Error while uploading file: ${error}`);
      throw new RpcException('Error while uploading file');
    }
  }

  /**
   * Delete a file from the storage bucket and the database.
   *
   * @param request - The request object containing the file ID.
   * @returns The response object containing the file ID or an error.
   */
  @Span()
  @GrpcMethod('FileService', 'DeleteFile')
  async deleteFile(
    @Payload() request: DeleteFileRequest,
  ): Promise<DeleteFileResponse> {
    try {
      return await this.fileService.deleteFile(request);
    } catch (error) {
      // DELETE is idempotent: a missing file/record means the desired state
      // (file gone) is already achieved, so this is a success — not an error.
      // Returning success here stops callers such as the security-scanning
      // cleanup cron from re-attempting (and logging) the deletion on every
      // run for scan files that were already deleted.
      if (
        error?.code === status.NOT_FOUND ||
        error?.message?.includes('not found')
      ) {
        this.logger.debug(
          `File ${request.scanId} not found (already deleted) - this is normal for completed scans`,
        );
        return { success: true, message: 'File already deleted' };
      }
      this.logger.error(`Error while deleting file : ${error}`);
      throw new RpcException('Error while deleting file');
    }
  }

  /**
   * Get download URL for a file by scan ID.
   *
   * @param message - The request message containing the scan ID, and the
   *   audience ('external' signs on S3_PUBLIC_ENDPOINT), passed through as is.
   * @returns The response object containing the download URL or an error.
   */
  @Span()
  @GrpcMethod('FileService', 'GetDownloadUrl')
  async getDownloadUrl(
    @Payload() request: GetDownloadUrlRequest,
  ): Promise<GetDownloadUrlResponse> {
    try {
      return await this.fileService.getDownloadUrl(request);
    } catch (error) {
      if (error instanceof RpcException) {
        // Keep the service's gRPC status. Wrapping it turned the
        // NOT_FOUND of a deleted scan archive into UNKNOWN, e.g. for a stale
        // ingestion parse task redelivered after its scan had finished.
        const rpcError = error.getError();
        const code =
          typeof rpcError === 'object' && rpcError !== null
            ? (rpcError as { code?: unknown }).code
            : undefined;
        if (code === status.NOT_FOUND) {
          this.logger.warn(
            `Download URL requested for scan ${request.scanId} but its archive is gone: ${error.message}`,
          );
        } else {
          this.logger.error(`Error while getting download URL: ${error}`);
        }
        throw error;
      }
      this.logger.error(`Error while getting download URL: ${error}`);
      throw new RpcException('Error while getting download URL');
    }
  }

  /**
   * Hand caller a signed PUT URL so they upload the report buffer
   * directly to object storage instead of streaming it back through gRPC.
   * Errors propagate without re-wrapping so RpcException codes (INVALID_ARGUMENT,
   * NOT_FOUND, INTERNAL) surface to the caller.
   */
  @Span()
  @GrpcMethod('FileService', 'RequestReportUploadUrl')
  async requestReportUploadUrl(
    @Payload() request: RequestReportUploadUrlRequest,
  ): Promise<RequestReportUploadUrlResponse> {
    return this.fileService.requestReportUploadUrl(request);
  }

  @Span()
  @GrpcMethod('FileService', 'FinalizeReportUpload')
  async finalizeReportUpload(
    @Payload() request: FinalizeReportUploadRequest,
  ): Promise<FinalizeReportUploadResponse> {
    return this.fileService.finalizeReportUpload(request);
  }

  /**
   * Hard-delete a stored report object (retention purge + user-initiated
   * delete). Idempotent at the service layer; cross-tenant guard enforced
   * there too.
   */
  @Span()
  @GrpcMethod('FileService', 'DeleteReportObject')
  async deleteReportObject(
    @Payload() request: DeleteReportObjectRequest,
  ): Promise<DeleteReportObjectResponse> {
    return this.fileService.deleteReportObject(request);
  }

  /**
   * Signed PUT URL for the SARIF import object
   * import/<projectId>/<scanId>.sarif, or import/<projectId>/<scanId>/<containerId>.sarif
   * when the request names a container (same key whatever the compression).
   * RpcExceptions (INVALID_ARGUMENT, UNAVAILABLE IMPORT_STORAGE_UNAVAILABLE)
   * pass through unchanged, like requestReportUploadUrl.
   */
  @Span()
  @GrpcMethod('FileService', 'RequestImportUploadUrl')
  async requestImportUploadUrl(
    @Payload() request: RequestImportUploadUrlRequest,
  ): Promise<RequestImportUploadUrlResponse> {
    return this.fileService.requestImportUploadUrl(request);
  }

  /** Signed GET URL (plus size) for an import object of the project. */
  @Span()
  @GrpcMethod('FileService', 'GetImportDownloadUrl')
  async getImportDownloadUrl(
    @Payload() request: GetImportDownloadUrlRequest,
  ): Promise<GetImportDownloadUrlResponse> {
    return this.fileService.getImportDownloadUrl(request);
  }

  /** Delete an import object of the project; idempotent. */
  @Span()
  @GrpcMethod('FileService', 'DeleteImportObject')
  async deleteImportObject(
    @Payload() request: DeleteImportObjectRequest,
  ): Promise<DeleteImportObjectResponse> {
    return this.fileService.deleteImportObject(request);
  }
}
