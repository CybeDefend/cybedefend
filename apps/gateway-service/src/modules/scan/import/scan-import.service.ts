import {
  FILE_SERVICE_NAME,
  FileServiceClient,
} from '@grpc/file-management/file_management';
import { safeGrpcCall } from '@grpc/wrapper-grpc';
import { wrapGrpcClientWithTracing } from '@grpc/traced-grpc-client';
import {
  HttpException,
  Inject,
  Injectable,
  OnModuleInit,
} from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { Logger } from 'nestjs-pino';
import { Span } from 'nestjs-otel';
import { importRefusal } from './import-errors';

/** Imports a pod holds at once (each buffers up to 50 MiB). */
export const IMPORT_MAX_IN_FLIGHT_PER_POD = 4;
/** file-management's import RPCs. */
export const IMPORT_STORAGE_RPC_DEADLINE_MS = 10_000;
/**
 * The PUT of the file to storage. The signed URL lives 300 s; a PUT that
 * hangs must not hold an in-flight slot that long.
 */
export const IMPORT_UPLOAD_TIMEOUT_MS = 120_000;

/** The HTTP status a failed gRPC call was mapped to, for the log line. */
const statusOf = (error: unknown): string =>
  error instanceof HttpException ? String(error.getStatus()) : 'unknown';

/**
 * Stores the file of a SARIF import and counts the imports in flight on this pod. Never logs the
 * signed URL, its headers or a downstream message: only status codes.
 */
@Injectable()
export class ScanImportService implements OnModuleInit {
  private fileServiceClient!: FileServiceClient;
  private inFlight = 0;

  constructor(
    @Inject('FILE_MANAGEMENT_SERVICE')
    private readonly fileClient: ClientGrpc,
    private readonly logger: Logger,
  ) {}

  onModuleInit() {
    this.fileServiceClient = wrapGrpcClientWithTracing(
      this.fileClient.getService<FileServiceClient>(FILE_SERVICE_NAME),
    );
  }

  /** Takes an in-flight slot; false when all of them are taken. */
  tryAcquireSlot(): boolean {
    if (this.inFlight >= IMPORT_MAX_IN_FLIGHT_PER_POD) return false;
    this.inFlight += 1;
    return true;
  }

  releaseSlot(): void {
    if (this.inFlight > 0) this.inFlight -= 1;
  }

  /**
   * Asks file-management for a signed PUT URL keyed by the scan, then PUTs
   * the bytes with the signed headers as given (no Content-Type of ours).
   * Any failure is 503 IMPORT_STORAGE_UNAVAILABLE. Returns the object key.
   *
   * `containerId` (a scanner pod's upload) keys the object per
   * container, `import/<p>/<s>/<c>.sarif`; without it the request is the
   * one the import route has always sent. `kind: 'sbom'` stores the
   * CycloneDX SBOM of an sca import, `import/<p>/<s>.sbom`.
   */
  @Span()
  async storeImportFile(
    scanId: string,
    projectId: string,
    body: Buffer,
    gzip: boolean,
    containerId?: string,
    kind: 'sarif' | 'sbom' = 'sarif',
  ): Promise<string> {
    let upload: {
      uploadUrl: string;
      objectKey: string;
      uploadHeaders: Record<string, string>;
    };
    try {
      upload = await safeGrpcCall(
        this.fileServiceClient.requestImportUploadUrl({
          scanId,
          projectId,
          ...(containerId ? { containerId } : {}),
          contentEncoding: gzip ? 'gzip' : 'identity',
          contentLength: body.length,
          ...(kind === 'sbom' ? { kind } : {}),
        }),
        { deadlineMs: IMPORT_STORAGE_RPC_DEADLINE_MS },
      );
    } catch (error) {
      this.logger.warn(
        `IMPORT_STORAGE_UNAVAILABLE scan=${scanId} step=upload_url status=${statusOf(error)}`,
      );
      throw importRefusal('IMPORT_STORAGE_UNAVAILABLE');
    }

    let response: Response;
    try {
      response = await fetch(upload.uploadUrl, {
        method: 'PUT',
        headers: {
          ...(upload.uploadHeaders ?? {}),
          'Content-Length': String(body.length),
        },
        // A Buffer from toBuffer() sits on a plain ArrayBuffer, never a shared one.
        body: body as Uint8Array<ArrayBuffer>,
        redirect: 'error',
        signal: AbortSignal.timeout(IMPORT_UPLOAD_TIMEOUT_MS),
      });
    } catch {
      // The error of fetch can carry the URL: it is never logged.
      this.logger.warn(
        `IMPORT_STORAGE_UNAVAILABLE scan=${scanId} step=put status=network`,
      );
      throw importRefusal('IMPORT_STORAGE_UNAVAILABLE');
    }
    // The answer is not read: a storage error body can echo the request.
    if (!response.ok) {
      this.logger.warn(
        `IMPORT_STORAGE_UNAVAILABLE scan=${scanId} step=put status=${response.status}`,
      );
      throw importRefusal('IMPORT_STORAGE_UNAVAILABLE');
    }
    return upload.objectKey;
  }

  /**
   * Best effort: the stored file of an import whose scan could not be
   * created. A failure is logged with its status only.
   */
  @Span()
  async deleteImportObject(
    projectId: string,
    objectKey: string,
  ): Promise<void> {
    try {
      await safeGrpcCall(
        this.fileServiceClient.deleteImportObject({ projectId, objectKey }),
        { deadlineMs: IMPORT_STORAGE_RPC_DEADLINE_MS },
      );
    } catch (error) {
      this.logger.warn(
        `IMPORT_OBJECT_NOT_DELETED project=${projectId} status=${statusOf(error)}`,
      );
    }
  }
}
