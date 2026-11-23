import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc, RpcException } from '@nestjs/microservices';
import { Span } from 'nestjs-otel';
import { Logger } from 'nestjs-pino';
import {
  FILE_SERVICE_NAME,
  FileServiceClient,
} from '@grpc/file-management/file_management';
import { status } from '@grpc/grpc-js';
import { safeGrpcCall } from '@grpc/wrapper-grpc.module';
import { DeleteFileResponse } from '@grpc/file-management/file';
import { throwError, timeout } from 'rxjs';
import { grpcCodeOf } from '../scan/core/grpc-status.util';

/**
 * Deadline of a scan archive deletion. Callers await it from terminal state
 * moves and from the results finalization sweeper, so a call that never
 * answers (a half-open connection) would hold them for good. On a timeout the
 * archive is left in storage: nothing here retries the deletion.
 */
export const FILE_DELETE_TIMEOUT_MS = 30_000;

@Injectable()
export class FileManagementService implements OnModuleInit {
  private fileServiceClient: FileServiceClient;

  constructor(
    @Inject('FILE_MANAGEMENT_SERVICE') private readonly client: ClientGrpc,
    private readonly logger: Logger,
  ) {}

  /**
   * OnModuleInit hook to initialize the gRPC client.
   */
  onModuleInit() {
    this.fileServiceClient =
      this.client.getService<FileServiceClient>(FILE_SERVICE_NAME);
  }

  /**
   * Delete a file from storage.
   *
   * @param scanId - The scan ID associated with the file to delete.
   * @returns A response indicating success or an error.
   */
  @Span()
  async deleteFile(scanId: string): Promise<DeleteFileResponse> {
    try {
      return safeGrpcCall(
        this.fileServiceClient.deleteFile({ scanId }).pipe(
          timeout({
            each: FILE_DELETE_TIMEOUT_MS,
            with: () =>
              throwError(() => ({
                code: status.DEADLINE_EXCEEDED,
                details: `no answer within ${FILE_DELETE_TIMEOUT_MS} ms`,
              })),
          }),
        ),
      );
    } catch (error) {
      this.logger.error(
        `Error while deleting file with scanId ${scanId} - metadata: { error: ${JSON.stringify(error)} }`,
      );
      throw new RpcException({
        code: status.INTERNAL,
        message: `Error while deleting file`,
      });
    }
  }

  /**
   * Delete a SARIF import object
   * (`import/<projectId>/<scanId>.sarif`, whatever the compression) through
   * file-management `DeleteImportObject`. Best effort: it never rejects, so a
   * terminal state move is never undone by a storage hiccup, and it logs the
   * gRPC code name only. A missing object answers success.
   */
  @Span()
  async deleteImportObject(
    projectId: string,
    objectKey: string,
  ): Promise<void> {
    try {
      await safeGrpcCall(
        this.fileServiceClient.deleteImportObject({
          projectId,
          objectKey,
        }),
      );
    } catch (error) {
      const code = grpcCodeOf(error);
      const scanLabel = (objectKey.split('/').pop() ?? objectKey).replace(
        /\.sarif$/,
        '',
      );
      this.logger.warn(
        `IMPORT_OBJECT_DELETE_FAILED scan=${scanLabel} code=${
          code !== undefined ? status[code] : 'UNKNOWN'
        }`,
      );
    }
  }

  /**
   * Get the download URL for a file associated with a scan.
   *
   * @param scanId - The scan ID associated with the file.
   * @param artifact - 'history' for the scan's git history; the archive when absent.
   * @returns The download URL for the file or an error.
   */
  @Span()
  async getDownloadUrl(scanId: string, artifact?: 'history'): Promise<string> {
    try {
      const response = await safeGrpcCall(
        this.fileServiceClient.getDownloadUrl({
          scanId,
          ...(artifact ? { artifact } : {}),
        }),
      );

      return response.url;
    } catch (error) {
      // A scan without a history artifact answers NOT_FOUND: keep it readable.
      if (artifact && grpcCodeOf(error) === status.NOT_FOUND) {
        throw new RpcException({
          code: status.NOT_FOUND,
          message: 'No history for this scan',
        });
      }
      this.logger.error(error);
      throw new RpcException({
        code: status.INTERNAL,
        message: `Error while getting download URL`,
      });
    }
  }

  /**
   * The scan archive's URL signed for
   * S3_PUBLIC_ENDPOINT (`audience: 'external'`), for a
   * scanner pod on a cluster outside the instance. The URL is a credential:
   * it is never logged, and a failure logs the gRPC code name only.
   */
  @Span()
  async getExternalDownloadUrl(scanId: string): Promise<string> {
    try {
      const response = await safeGrpcCall(
        this.fileServiceClient.getDownloadUrl({
          scanId,
          audience: 'external',
        }),
      );
      return response.url;
    } catch (error) {
      const code = grpcCodeOf(error);
      this.logger.error(
        `EXTERNAL_DOWNLOAD_URL_FAILED scan=${scanId} code=${
          code !== undefined ? status[code] : 'UNKNOWN'
        }`,
      );
      throw new RpcException({
        code: status.INTERNAL,
        message: `Error while getting download URL`,
      });
    }
  }
}
