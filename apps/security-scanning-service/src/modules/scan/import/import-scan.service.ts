import { Inject, Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ClientGrpc, RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { Logger } from 'nestjs-pino';
import { QueryDeepPartialEntity, Repository } from 'typeorm';
import { lastValueFrom, throwError, timeout } from 'rxjs';
import {
  CompleteImportScanRequest,
  CompleteImportScanResponse,
  CreateScanRequest,
  StartScanRequest,
  StartScanResponse,
} from '@grpc/security-scanning/scan';
import {
  RESULT_SERVICE_NAME,
  ResultServiceClient,
} from '@grpc/analysis-reporting/analysis_reporting';
import { ImportResultsRequest } from '@grpc/analysis-reporting/result';
import { Scan } from '../../../entities/scan.entity';
import { importFailure } from '../../../core/constants/scanlink-error-codes';
import { isCommunityEdition } from 'src/edition/edition';
import {
  ENTITLEMENTS_PORT,
  EntitlementsPort,
} from 'src/edition/ports/entitlements.port';
import { FileManagementService } from '../../file/file-management.service';
import { ScanStateManager } from '../core/scanStateManager';
import { ScanStateStore } from '../core/scanStateStore';
import { ProjectAppsecMarker } from '../core/projectAppsecMarker';
import { HandledScanStartError } from '../core/handled-scan-start-error';
import { grpcCodeOf } from '../core/grpc-status.util';
import { normaliseToolList } from './import-tool';
import {
  hasImportSbom,
  importObjectKey,
  importObjectKeysOf,
  importSbomObjectKey,
} from './import-object-key';
import { ScanResultsService } from '../cluster-results/scan-results.service';

/** The file formats an import scan accepts. */
export const IMPORT_FORMATS = ['sarif'] as const;

/** The import types of `CreateScanRequest.import_type`. */
export const IMPORT_TYPES = [
  'sast',
  'iac',
  'secret',
  'cicd',
  'sca',
  'container',
] as const;

/**
 * SARIF import is a Community Edition feature, every type of it. The gateway answers 400 IMPORT_TYPE_NOT_AVAILABLE outside it; this service
 * refuses with IMPORT_TYPE_INVALID, at CreateScan and again at StartScan, so
 * no other path (a direct call, a future route, an import scan created
 * before the change) brings imported findings into another edition. The edition is
 * read at each call, never cached.
 */
const refuseOutsideCommunity = (): void => {
  if (!isCommunityEdition()) {
    throw new RpcException({
      code: status.INVALID_ARGUMENT,
      message: 'IMPORT_TYPE_INVALID',
    });
  }
};

export type ImportType = (typeof IMPORT_TYPES)[number];

/** Deadline of the analysis-reporting `ImportResults` call (15 s). */
export const IMPORT_RESULTS_TIMEOUT_MS = 15_000;

/**
 * The shape of a failure code `CompleteImportScan.errorCode` carries:
 * the same pattern `importFailure` maps to a number.
 */
const IMPORT_ERROR_CODE_PATTERN = /^IMPORT_[A-Z_]{1,40}$/;

export interface NormalisedImportCreate {
  format: 'sarif';
  type: ImportType;
  branch: string;
  tool: string | null;
  image: string | null;
  /** An sca import that stored a CycloneDX SBOM next to its SARIF. */
  sbom: boolean;
}

/**
 * `CreateScan` and `StartScan` of an import scan. An import scan is a
 * `running` scan with no container: no pod is launched, no image is reserved,
 * no scan quota is consumed or released. StartScan claims
 * waiting_for_file → running and hands the stored file
 * (`import/<projectId>/<scanId>.sarif`) to analysis-reporting `ImportResults`.
 */
@Injectable()
export class ImportScanService implements OnModuleInit {
  private resultServiceClient!: ResultServiceClient;

  constructor(
    @InjectRepository(Scan)
    private readonly scanRepository: Repository<Scan>,
    private readonly store: ScanStateStore,
    private readonly scanStateManager: ScanStateManager,
    private readonly projectAppsec: ProjectAppsecMarker,
    private readonly fileManagementService: FileManagementService,
    @Inject(ENTITLEMENTS_PORT)
    private readonly entitlements: EntitlementsPort,
    @Inject('ANALYSIS_REPORTING_SERVICE')
    private readonly analysisReportingClient: ClientGrpc,
    private readonly logger: Logger,
    // The end of a Community cluster container's import. Provided by the
    // Community-only, global ClusterScanningModule; absent in the closed
    // edition.
    @Optional()
    private readonly clusterResults?: ScanResultsService,
  ) {}

  onModuleInit(): void {
    this.resultServiceClient =
      this.analysisReportingClient.getService<ResultServiceClient>(
        RESULT_SERVICE_NAME,
      );
  }

  /** `importFormat IS NOT NULL` is the one definition of an import scan. */
  isImportRequest(request: CreateScanRequest): boolean {
    return request.importFormat !== undefined && request.importFormat !== '';
  }

  /**
   * Validate and normalise a CreateScan of an import scan. Every refusal is
   * INVALID_ARGUMENT and happens before any read or write, in the order
   * format, type, edition, image, branch, flags.
   */
  normaliseCreate(request: CreateScanRequest): NormalisedImportCreate {
    const refuse = (message: string): never => {
      throw new RpcException({ code: status.INVALID_ARGUMENT, message });
    };

    if (
      !request.importFormat ||
      !(IMPORT_FORMATS as readonly string[]).includes(request.importFormat)
    ) {
      refuse('IMPORT_FORMAT_UNSUPPORTED');
    }
    const type = request.importType ?? '';
    if (!(IMPORT_TYPES as readonly string[]).includes(type)) {
      // `vulnerabilityTypes` holds severities, as for every scan: it is
      // neither read as the type nor applied as a filter.
      refuse('IMPORT_TYPE_INVALID');
    }
    refuseOutsideCommunity();

    let image: string | null = null;
    const rawImage = (request.importImage ?? '').trim();
    if (type === 'container') {
      // Kept trimmed and otherwise verbatim: its format (255 characters,
      // the reference pattern) is the gateway's check, not this service's.
      if (!rawImage) refuse('IMPORT_IMAGE_REQUIRED');
      image = rawImage;
    } else if (rawImage) {
      refuse('IMPORT_FLAGS_CONFLICT');
    }

    // The SBOM goes with an sca import only (its packages and the SARIF's
    // vulnerabilities are one picture of the branch).
    const sbom = request.importSbom === true;
    if (sbom && type !== 'sca') refuse('IMPORT_FLAGS_CONFLICT');

    const branch = (request.branch ?? '').trim().replace(/^refs\/heads\//, '');
    if (!branch) refuse('IMPORT_BRANCH_REQUIRED');
    if (branch.length > 255) refuse('IMPORT_BRANCH_TOO_LONG');

    if (
      request.isDiffScan ||
      request.graphOnly ||
      request.scanType ||
      request.scanTypesCsv
    ) {
      // A container import is typed by import_type, never by scanType.
      refuse('IMPORT_FLAGS_CONFLICT');
    }

    return {
      format: 'sarif',
      type: type as ImportType,
      branch,
      tool: normaliseToolList(request.importTool),
      image,
      sbom,
    };
  }

  /**
   * StartScan of an import scan. The metrics of `StartScanRequest` are
   * ignored: the file is already stored, analysis-reporting reads it.
   */
  async start(
    scan: Scan,
    request: StartScanRequest,
  ): Promise<StartScanResponse> {
    // Before any read or write: no claim, no event, no ImportResults call.
    refuseOutsideCommunity();
    if (scan.state !== 'waiting_for_file') {
      throw new HandledScanStartError({
        code: status.FAILED_PRECONDITION,
        message: `Scan ${scan.id} cannot be started in state: ${scan.state}`,
      });
    }

    // An import scan consumes no scan quota and never releases one: only the
    // plain writable gate, the same exception the code scans throw.
    const writable = await this.entitlements.isWritable(scan.organizationId);
    if (writable.writable === false) {
      throw new RpcException({
        code: status.PERMISSION_DENIED,
        message: 'WRITES_BLOCKED',
      });
    }

    await this.projectAppsec.markProjectAppsecOrRefuse(scan);

    try {
      await this.store.claimScanStart(scan, 'running', {
        startTime: new Date(),
        branch: request.branch && !scan.branch ? request.branch : scan.branch,
      });
    } catch (error) {
      if (error instanceof RpcException) {
        const inner = error.getError() as { code: status; message: string };
        throw new HandledScanStartError({
          code: inner.code,
          message: inner.message,
        });
      }
      throw error;
    }
    this.scanStateManager.publishStatusChanged(scan, 'waiting_for_file');

    const imageToScan: unknown = scan.metadata?.imageToScan;
    const importResultsRequest: ImportResultsRequest = {
      scanId: scan.id,
      projectId: scan.projectId,
      organizationId: scan.organizationId,
      branch: scan.branch ?? '',
      vulnerabilityType: scan.scanType ?? '',
      format: scan.importFormat ?? '',
      fileKey: importObjectKey(scan.projectId, scan.id),
      // the image key is absent for every other type
      ...(scan.scanType === 'container' && typeof imageToScan === 'string'
        ? { image: imageToScan }
        : {}),
      ...(hasImportSbom(scan)
        ? { sbomFileKey: importSbomObjectKey(scan.projectId, scan.id) }
        : {}),
    };

    let accepted = false;
    let failure: unknown;
    try {
      const response = await lastValueFrom(
        this.resultServiceClient.importResults(importResultsRequest).pipe(
          timeout({
            each: IMPORT_RESULTS_TIMEOUT_MS,
            with: () => throwError(() => ({ code: status.DEADLINE_EXCEEDED })),
          }),
        ),
      );
      accepted = response.accepted === true;
    } catch (error) {
      failure = error;
    }

    if (accepted) {
      return {
        success: true,
        scanId: scan.id,
        message: 'Import started.',
        detectedLanguages: [],
      };
    }

    // Not accepted or the call failed: the scan goes failed with 75
    // IMPORT_UNAVAILABLE, the import object is deleted (never the scan
    // archive), and the controller must not record another failure.
    await this.store.moveScanState(scan, ['running'], 'failed', {
      endTime: new Date(),
      ...importFailure('IMPORT_UNAVAILABLE'),
    });
    this.scanStateManager.publishStatusChanged(scan, 'running');
    await this.deleteImportObjects(scan);
    const downstreamCode =
      failure === undefined ? undefined : grpcCodeOf(failure);
    this.logger.warn(
      `IMPORT_START_FAILED scan=${scan.id} code=${
        downstreamCode !== undefined ? status[downstreamCode] : 'UNKNOWN'
      }`,
    );
    // Too many imports already waiting for the organization: a deliberate
    // refusal (429), not an outage. The caller sends the file again later.
    if (downstreamCode === status.RESOURCE_EXHAUSTED) {
      throw new HandledScanStartError({
        code: status.RESOURCE_EXHAUSTED,
        message: 'IMPORT_QUEUE_FULL',
      });
    }
    const handledCode =
      downstreamCode === undefined ||
      downstreamCode === status.UNAVAILABLE ||
      downstreamCode === status.DEADLINE_EXCEEDED ||
      downstreamCode === status.UNIMPLEMENTED
        ? status.UNAVAILABLE
        : status.INTERNAL;
    throw new HandledScanStartError({
      code: handledCode,
      message: 'IMPORT_UNAVAILABLE',
    });
  }

  /**
   * `CompleteImportScan` — analysis-reporting's end-of-import signal
   * (retried by its sender). The
   * running import moves to `completed` or `failed` with ONE conditional
   * UPDATE whose affected count decides the winner (the watchdog races on
   * the same row): on a won move the state change is published, the import
   * object is deleted (never the scan archive), and a completion runs the
   * usual scan-end clean-up. A repeated completion is idempotent; any other
   * state refuses FAILED_PRECONDITION.
   */
  async complete(
    request: CompleteImportScanRequest,
  ): Promise<CompleteImportScanResponse> {
    const refuse = (code: status, message: string): never => {
      throw new RpcException({ code, message });
    };

    // A completion that names a container is the
    // end of one Community cluster container's import. It closes that
    // container, never the import scan path below. Without the cluster
    // engine (the closed edition) it is refused before any read or write.
    if (request.containerId) {
      if (!this.clusterResults) {
        refuse(status.INVALID_ARGUMENT, 'CONTAINER_ID_NOT_SUPPORTED');
      }
      return this.clusterResults.closeContainer({
        ...request,
        containerId: request.containerId,
      });
    }

    // Validated before any read or write: nothing is stored on a refusal.
    if (!request.scanId) {
      refuse(status.INVALID_ARGUMENT, 'Bad request - missing scanId');
    }
    if (request.status !== 'completed' && request.status !== 'failed') {
      refuse(status.INVALID_ARGUMENT, 'IMPORT_STATUS_INVALID');
    }
    if (
      request.status === 'failed' &&
      !IMPORT_ERROR_CODE_PATTERN.test(request.errorCode)
    ) {
      // An unexpected failure arrives as IMPORT_INTERNAL_ERROR, never ''.
      refuse(status.INVALID_ARGUMENT, 'IMPORT_ERROR_CODE_INVALID');
    }

    const scan = await this.scanRepository.findOne({
      where: { id: request.scanId },
    });
    if (!scan) {
      refuse(status.NOT_FOUND, 'Scan not found');
    }
    if (!scan.importFormat) {
      refuse(status.FAILED_PRECONDITION, 'NOT_AN_IMPORT_SCAN');
    }

    const findingsCount = Math.max(0, Math.trunc(request.findingsCount || 0));
    const columns: QueryDeepPartialEntity<Scan> = {
      endTime: new Date(),
      metadata: {
        ...scan.metadata,
        importFindingsCount: findingsCount,
      } as Scan['metadata'],
      // The tool list stored at creation wins; otherwise the sender's list.
      importTool: scan.importTool ?? normaliseToolList(request.toolName),
    };
    if (request.status === 'failed') {
      Object.assign(columns, importFailure(request.errorCode));
    } else {
      columns.errorCode = null;
      columns.errorCategory = null;
      columns.errorMessage = null;
    }

    const won = await this.store.moveScanState(
      scan,
      ['running'],
      request.status,
      columns,
    );
    if (!won) {
      // Lost the race (the watchdog, or a repeated completion): re-read.
      const current = await this.scanRepository.findOne({
        where: { id: request.scanId },
      });
      if (!current) {
        refuse(status.NOT_FOUND, 'Scan not found');
      }
      if (current.state === request.status) {
        // analysis-reporting may retry: the same answer, no event, no
        // clean-up.
        return {
          success: true,
          message: `Import scan already ${request.status}`,
        };
      }
      refuse(
        status.FAILED_PRECONDITION,
        `Import scan cannot be completed in state: ${current.state}`,
      );
    }

    this.logger.log(
      `IMPORT_SCAN_COMPLETED scan=${scan.id} status=${request.status} code=${
        request.errorCode || '-'
      } findings=${findingsCount}`,
    );
    this.scanStateManager.publishStatusChanged(scan, 'running');
    // Best effort, on every won terminal move: the object is deleted,
    // never the scan archive (`deleteFile` is not called for an import).
    await this.deleteImportObjects(scan);
    if (request.status === 'completed') {
      // NotifyScanEnded (deduplicated by analysis-reporting's scan-end
      // lock) and the policy evaluation, as for any scan; its archive
      // deletion is skipped for an import. A failure here never rejects
      // the RPC.
      try {
        await this.scanStateManager.handleCompletedScan(scan);
      } catch (error) {
        this.logger.error(
          `IMPORT_SCAN_END_CLEANUP_FAILED scan=${scan.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    return { success: true, message: `Import scan ${request.status}` };
  }

  /** Best effort: the SARIF, and the SBOM when the import stored one. */
  private async deleteImportObjects(scan: Scan): Promise<void> {
    for (const key of importObjectKeysOf(scan)) {
      await this.fileManagementService.deleteImportObject(scan.projectId, key);
    }
  }
}
