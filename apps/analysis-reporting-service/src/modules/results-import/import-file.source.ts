import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import type { ClientGrpc } from '@nestjs/microservices';
import { HttpService } from '@nestjs/axios';
import { PassThrough, Readable } from 'stream';
import { firstValueFrom, timeout } from 'rxjs';
import {
  FILE_SERVICE_NAME,
  FileServiceClient,
} from '@grpc/file-management/file_management';
import {
  ImportError,
  SARIF_IMPORT_LIMITS,
  SarifSource,
} from './sarif/import-limits';

/** GetImportDownloadUrl deadline. */
const SIGNED_URL_TIMEOUT_MS = 20_000;
/** The signed GET: 60 s, no redirect followed. */
const DOWNLOAD_TIMEOUT_MS = 60_000;

const unavailable = (what: string): ImportError =>
  new ImportError('IMPORT_STORAGE_UNAVAILABLE', what);

/**
 * Reads an import object: file-management's
 * `GetImportDownloadUrl({ project_id, object_key })`, then a streamed GET of
 * the signed URL. Never `GetDownloadUrl`, which looks up a `file_scan` row
 * that an import has none of.
 *
 * Each call of the returned factory asks for a fresh signed URL, so a later
 * pass never reads an expired one. Errors carry fixed messages only: the
 * signed URL, the object key and the storage's own error text are never
 * part of one. A body larger than the announced size is still cut by the
 * reader (`decodeSarifBytes`).
 */
@Injectable()
export class ImportFileSource implements OnModuleInit {
  private files: FileServiceClient;

  constructor(
    @Inject('FILE_MANAGEMENT_SERVICE') private readonly fmClient: ClientGrpc,
    private readonly http: HttpService,
  ) {}

  onModuleInit(): void {
    this.files = this.fmClient.getService<FileServiceClient>(FILE_SERVICE_NAME);
  }

  open(projectId: string, fileKey: string): SarifSource {
    return () => this.read(projectId, fileKey);
  }

  private async read(projectId: string, fileKey: string): Promise<Readable> {
    let url: string;
    let sizeBytes: number;
    try {
      const answer = await firstValueFrom(
        this.files
          .getImportDownloadUrl({ projectId, objectKey: fileKey })
          .pipe(timeout(SIGNED_URL_TIMEOUT_MS)),
      );
      url = answer?.url ?? '';
      // uint64: a string on the wire (longs: String)
      sizeBytes = Number(answer?.sizeBytes);
    } catch {
      throw unavailable('the import object URL could not be obtained');
    }
    if (!url) throw unavailable('no URL was returned for the import object');

    if (
      Number.isFinite(sizeBytes) &&
      sizeBytes > SARIF_IMPORT_LIMITS.maxUploadedBytes
    ) {
      throw new ImportError(
        'IMPORT_TOO_LARGE',
        `stored object is ${sizeBytes} bytes, over the limit of ${SARIF_IMPORT_LIMITS.maxUploadedBytes}`,
      );
    }

    let body: Readable;
    try {
      const response = await this.http.axiosRef.get<Readable>(url, {
        responseType: 'stream',
        timeout: DOWNLOAD_TIMEOUT_MS,
        maxRedirects: 0,
      });
      if (response.status < 200 || response.status >= 300) {
        response.data?.destroy?.();
        throw new Error('non-2xx');
      }
      body = response.data;
    } catch {
      throw unavailable('the import object could not be read');
    }

    // A read error mid-stream is a storage failure, not a malformed file:
    // the reader passes an ImportError through as it is.
    const out = new PassThrough();
    body.on('error', () =>
      out.destroy(unavailable('the import object read was interrupted')),
    );
    out.on('close', () => body.destroy());
    body.pipe(out);
    return out;
  }
}
