import {
  FILE_SERVICE_NAME,
  FileServiceClient,
} from '@grpc/file-management/file_management';
import { safeGrpcCall } from '@grpc/wrapper-grpc';
import { wrapGrpcClientWithTracing } from '@grpc/traced-grpc-client';
import {
  PROJECT_SERVICE_NAME,
  ProjectServiceClient,
} from '@grpc/global-management/global_management';
import {
  HttpException,
  Inject,
  Injectable,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Logger } from 'nestjs-pino';
import { Span } from 'nestjs-otel';
import { importRefusal } from './import-errors';

/**
 * Imports a pod stores and starts at once (each holds up to 50 MiB). A slot
 * is taken once the body is read, so a client that uploads slowly holds
 * none.
 */
export const IMPORT_MAX_IN_FLIGHT_PER_POD = 4;
/**
 * Imports one organization has in progress on a pod, from the first byte
 * read to the answer, across all its projects: one organization can never
 * hold every slot. Tunable with `IMPORT_MAX_IN_FLIGHT_PER_ORGANIZATION`.
 */
export const IMPORT_MAX_IN_FLIGHT_PER_ORGANIZATION = 2;
/**
 * Upload bodies a pod holds in memory at once, the results import and the
 * scanner uploads together, all organizations together: each is buffered (up
 * to two files of 50 MiB). A place is taken before the read and given back
 * with the answer, so no more bodies than this exist at any time, about
 * 8 x 100 MiB by default; the read deadline bounds how long a slow body
 * holds one. Tunable with `IMPORT_MAX_READING_PER_POD` (1 to 64).
 */
export const IMPORT_MAX_READING_PER_POD = 8;

/** `Retry-After` of a 503 IMPORT_BUSY, in seconds. */
export const IMPORT_BUSY_RETRY_AFTER_S = 15;

/** The read places of the process: one budget for every upload route. */
const podReadPlaces = { taken: 0 };
export function importMaxReadingPerPod(
  env: NodeJS.ProcessEnv = process.env,
): number {
  return boundedEnvInt(
    env.IMPORT_MAX_READING_PER_POD,
    IMPORT_MAX_READING_PER_POD,
    1,
    64,
  );
}
/**
 * The time an import body may take to arrive, in milliseconds. Tunable with
 * `IMPORT_BODY_READ_TIMEOUT_MS` (1 s to 10 min).
 */
export const IMPORT_BODY_READ_TIMEOUT_MS = 60_000;

/** A whole number from the environment within [min, max], else `fallback`. */
function boundedEnvInt(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (!raw || !/^\d+$/.test(raw.trim())) return fallback;
  const value = Number(raw.trim());
  return value >= min && value <= max ? value : fallback;
}

/** Read per call, so a test or an operator can change it without a restart of the module. */
export function importBodyReadTimeoutMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  return boundedEnvInt(
    env.IMPORT_BODY_READ_TIMEOUT_MS,
    IMPORT_BODY_READ_TIMEOUT_MS,
    1,
    600_000,
  );
}

export function importMaxInFlightPerOrganization(
  env: NodeJS.ProcessEnv = process.env,
): number {
  return boundedEnvInt(
    env.IMPORT_MAX_IN_FLIGHT_PER_ORGANIZATION,
    IMPORT_MAX_IN_FLIGHT_PER_ORGANIZATION,
    1,
    IMPORT_MAX_IN_FLIGHT_PER_POD,
  );
}

/**
 * Reads an upload's body with `read`, within `timeoutMs`. Past it, the
 * answer is 408 IMPORT_UPLOAD_TIMEOUT, and the connection is closed once
 * that answer is sent, which ends the read still waiting for bytes.
 */
export async function readUploadWithin<T>(
  req: FastifyRequest,
  reply: FastifyReply,
  read: () => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const reading = read();
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      // The read rejects when the connection closes: nothing waits for it.
      reading.catch(() => undefined);
      reply.header('Connection', 'close');
      reply.raw.once('finish', () => req.raw.destroy());
      reject(importRefusal('IMPORT_UPLOAD_TIMEOUT'));
    }, timeoutMs);
  });
  try {
    return await Promise.race([reading, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
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
  private projectServiceClient?: ProjectServiceClient;
  private inFlight = 0;
  private readonly inFlightByOrganization = new Map<string, number>();

  constructor(
    @Inject('FILE_MANAGEMENT_SERVICE')
    private readonly fileClient: ClientGrpc,
    private readonly logger: Logger,
    @Optional()
    @Inject('GLOBAL_MANAGEMENT_SERVICE')
    private readonly globalManagementClient?: ClientGrpc,
  ) {}

  onModuleInit() {
    this.fileServiceClient = wrapGrpcClientWithTracing(
      this.fileClient.getService<FileServiceClient>(FILE_SERVICE_NAME),
    );
    if (this.globalManagementClient) {
      this.projectServiceClient = wrapGrpcClientWithTracing(
        this.globalManagementClient.getService<ProjectServiceClient>(
          PROJECT_SERVICE_NAME,
        ),
      );
    }
  }

  /**
   * The organization of a project, with the light read (no statistics, no
   * integration status, no security context).
   */
  @Span()
  async organizationOfProject(projectId: string): Promise<string> {
    if (!this.projectServiceClient) {
      throw importRefusal('IMPORT_UNAVAILABLE');
    }
    const project = await safeGrpcCall(
      this.projectServiceClient.get({
        projectId,
        skipVulnerabilityStats: true,
        skipIntegrationStatus: true,
        skipSecurityContext: true,
      }),
      { deadlineMs: IMPORT_STORAGE_RPC_DEADLINE_MS },
    );
    if (!project?.organizationId) throw importRefusal('IMPORT_UNAVAILABLE');
    return project.organizationId;
  }

  /**
   * Admits one more import of `organizationId`; false when the organization
   * already has its share in progress on this pod.
   */
  tryAdmitOrganization(organizationId: string): boolean {
    const current = this.inFlightByOrganization.get(organizationId) ?? 0;
    if (current >= importMaxInFlightPerOrganization()) return false;
    this.inFlightByOrganization.set(organizationId, current + 1);
    return true;
  }

  /** Takes one of the pod's read places; false when all of them are taken. */
  tryAcquireReadPlace(): boolean {
    if (podReadPlaces.taken >= importMaxReadingPerPod()) return false;
    podReadPlaces.taken += 1;
    return true;
  }

  releaseReadPlace(): void {
    if (podReadPlaces.taken > 0) podReadPlaces.taken -= 1;
  }

  /**
   * Runs one upload in the order that keeps the pod fair and its memory
   * bounded:
   *   1. the organization's share (`IMPORT_MAX_IN_FLIGHT_PER_ORGANIZATION`);
   *   2. a read place of the pod, held until the answer;
   *   3. the body, read with `read` within the read deadline;
   *   4. only then a slot of the pod, for `handle`.
   * Each refusal is 503 IMPORT_BUSY with `Retry-After`, before anything else
   * is read; everything taken is given back when the request is answered.
   */
  async runUpload<P, R>(
    organizationId: string,
    req: FastifyRequest,
    reply: FastifyReply,
    read: () => Promise<P>,
    handle: (parts: P) => Promise<R>,
  ): Promise<R> {
    const busy = () => {
      reply.header('Retry-After', String(IMPORT_BUSY_RETRY_AFTER_S));
      return importRefusal('IMPORT_BUSY');
    };
    if (!this.tryAdmitOrganization(organizationId)) throw busy();
    try {
      if (!this.tryAcquireReadPlace()) throw busy();
      try {
        const parts = await readUploadWithin(
          req,
          reply,
          read,
          importBodyReadTimeoutMs(),
        );
        if (!this.tryAcquireSlot()) throw busy();
        try {
          return await handle(parts);
        } finally {
          this.releaseSlot();
        }
      } finally {
        this.releaseReadPlace();
      }
    } finally {
      this.releaseOrganization(organizationId);
    }
  }

  releaseOrganization(organizationId: string): void {
    const current = this.inFlightByOrganization.get(organizationId) ?? 0;
    if (current <= 1) this.inFlightByOrganization.delete(organizationId);
    else this.inFlightByOrganization.set(organizationId, current - 1);
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
