import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { ClientGrpc, RpcException } from '@nestjs/microservices';
import { InjectRepository } from '@nestjs/typeorm';
import { status } from '@grpc/grpc-js';
import { lastValueFrom, throwError, timeout } from 'rxjs';
import { In, IsNull, Not, Repository } from 'typeorm';
import {
  RESULT_SERVICE_NAME,
  ResultServiceClient,
} from '@grpc/analysis-reporting/analysis_reporting';
import type {
  AuthorizeScanUploadRequest,
  AuthorizeScanUploadResponse,
  CompleteImportScanRequest,
  CompleteImportScanResponse,
  SubmitScanResultsRequest,
  SubmitScanResultsResponse,
} from '@grpc/security-scanning/scan';
import { Container } from 'src/entities/container.entity';
import { currentEdition, type Edition } from 'src/edition/edition';
import { Scan } from 'src/entities/scan.entity';
import {
  CLUSTER_FAILURE_CODES,
  type ClusterFailureName,
  EXIT_INFRA_ERROR,
  EXIT_INFRA_IMAGE_PULL,
  EXIT_CLUSTER_ARCHIVE_FETCH_FAILED,
  EXIT_INFRA_OOM,
  getErrorDescription,
  importFailure,
} from 'src/core/constants/scanlink-error-codes';
import { FileManagementService } from '../../file/file-management.service';
import { entryForImage } from '../../cluster-scanning/scanner-catalogue';
import { normalizeScanFailure } from '../core/scan-failure.util';
import { normalizeSeverityList } from '../core/vulnerability-types';
import { isClosedStatus } from '../core/scanPipeline';
import {
  importObjectKey,
  importSbomObjectKey,
} from '../import/import-object-key';
import { ScanService } from '../scan.service';
import { ScanUploadTokens } from './scan-upload-tokens';

/**
 * The scan-run protocols this service speaks (`X-CybeDefend-Scan-Protocol`):
 * 1, the SARIF alone; 2, the sca container may also send its CycloneDX SBOM
 * in the same submission (`SubmitScanResultsRequest.sbom_object_key`).
 */
export const SCAN_RUN_PROTOCOL_VERSIONS: readonly number[] = Object.freeze([
  1, 2,
]);
/** The only import category whose container may send an SBOM (trivy fs). */
const SBOM_CATEGORY = 'sca';
/** Deadline of the analysis-reporting `ImportResults` call (15 s, as the import). */
export const SCAN_RESULTS_IMPORT_TIMEOUT_MS = 15_000;
/** The branch an import goes on when the scan has none. */
const DEFAULT_BRANCH = 'main';

const OPEN_CONTAINER_STATUSES = ['starting', 'running'];
/** Scan states a close never writes an error onto. */
const TERMINAL_SCAN_STATES = [
  'completed',
  'completed_degraded',
  'failed',
  'cancelled',
];
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A container closes failed with an import code or a cluster code. */
const FAILURE_CODE_PATTERN = /^(?:IMPORT|CLUSTER)_[A-Z_]{1,40}$/;

/**
 * The ImportResults failures a retry may get past: the claim is given back only for these, or for a transport error that
 * carries no gRPC code.
 */
const RETRYABLE_IMPORT_CODES: ReadonlySet<number> = new Set([
  status.UNAVAILABLE,
  status.DEADLINE_EXCEEDED,
  status.RESOURCE_EXHAUSTED,
]);

const refuse = (code: status, message: string): RpcException =>
  new RpcException({ code, message });
const tokenInvalid = () => refuse(status.UNAUTHENTICATED, 'SCAN_TOKEN_INVALID');
const alreadySubmitted = () =>
  refuse(status.ALREADY_EXISTS, 'SCAN_RESULTS_ALREADY_SUBMITTED');

/**
 * The infrastructure codes a cluster container can fail with besides 80–87
 * (the watchdog): written on the container as these CLUSTER_ names, so
 * a close request (`^(IMPORT|CLUSTER)_…$`) carries them like the others.
 */
export const CLUSTER_INFRA_FAILURE_CODES: Readonly<Record<string, number>> =
  Object.freeze({
    CLUSTER_INFRA_ERROR: EXIT_INFRA_ERROR,
    CLUSTER_OUT_OF_MEMORY: EXIT_INFRA_OOM,
    CLUSTER_IMAGE_PULL_FAILED: EXIT_INFRA_IMAGE_PULL,
  });

/**
 * The message stored on a scan failed with `code`: its sentence, and for a
 * pod that could not fetch the archive (88) the storage address the pods are
 * given (its origin only, never a path or credentials), the operator's first
 * check. That address is the self-hosting operator's own setting, so it is
 * named in the Community Edition only: any other edition's storage host is
 * internal and never reaches a user. Undefined: the sentence of the code.
 */
export function clusterFailureMessage(
  code: number,
  storagePublicUrl: string | undefined = process.env.S3_PUBLIC_ENDPOINT,
  edition: Edition = currentEdition(),
): string | undefined {
  if (
    edition !== 'community' ||
    code !== EXIT_CLUSTER_ARCHIVE_FETCH_FAILED ||
    !storagePublicUrl
  ) {
    return undefined;
  }
  let origin: string;
  try {
    origin = new URL(storagePublicUrl).origin;
  } catch {
    return undefined;
  }
  return `${getErrorDescription(code)}; the pods fetch it from ${origin}`;
}

/** The container outcome name of a cluster failure code; throws for a code without one. */
export function clusterFailureName(code: number): string {
  const all = { ...CLUSTER_FAILURE_CODES, ...CLUSTER_INFRA_FAILURE_CODES };
  const name = Object.keys(all).find((k) => all[k] === code);
  if (!name) throw new Error(`no cluster failure name for code ${code}`);
  return name;
}

/**
 * Every object a cluster container may have stored: its SARIF and, for the
 * sca container (protocol 2), its SBOM. No row says whether the SBOM was sent,
 * so the sca container's close always deletes its key: a missing object is a
 * success for DeleteImportObject.
 */
export function containerObjectKeys(
  scan: Pick<Scan, 'projectId' | 'id'>,
  container: Pick<Container, 'id'>,
  category: string,
): string[] {
  return [
    importObjectKey(scan.projectId, scan.id, container.id),
    ...(category === SBOM_CATEGORY
      ? [importSbomObjectKey(scan.projectId, scan.id, container.id)]
      : []),
  ];
}

/** The stored error code (a number) of a container's outcome; undefined when unknown. */
export function containerFailureCode(
  outcomeReason: string | null | undefined,
): number | undefined {
  if (!outcomeReason) return undefined;
  if (outcomeReason in CLUSTER_FAILURE_CODES) {
    return CLUSTER_FAILURE_CODES[outcomeReason as ClusterFailureName];
  }
  if (outcomeReason in CLUSTER_INFRA_FAILURE_CODES) {
    return CLUSTER_INFRA_FAILURE_CODES[outcomeReason];
  }
  if (/^IMPORT_[A-Z_]{1,40}$/.test(outcomeReason)) {
    return importFailure(outcomeReason).errorCode;
  }
  return undefined;
}

/**
 * `ClusterScanService.AuthorizeScanUpload` / `SubmitScanResults`, and the end
 * of a Community cluster container's import.
 *
 * - A scanner pod's results are imported per container: the key is
 *   `import/<projectId>/<scanId>/<containerId>.sarif`, the category and the
 *   severities come from the container's token. In protocol 2 the sca
 *   container (trivy fs) may send its CycloneDX SBOM in the same submission,
 *   `import/<projectId>/<scanId>/<containerId>.sbom`, imported with the SARIF
 *   as one picture and deleted with it when the container closes.
 * - authorize refuses, in this order: a protocol other than 1
 *   or 2 (FAILED_PRECONDITION SCAN_PROTOCOL_UNSUPPORTED), an unknown, foreign or
 *   expired token (UNAUTHENTICATED SCAN_TOKEN_INVALID), a spent one
 *   (ALREADY_EXISTS SCAN_RESULTS_ALREADY_SUBMITTED, so a runner whose answer
 *   was lost stops retrying), a closed container (SCAN_TOKEN_INVALID).
 * - submit claims the token once (one conditional UPDATE): two concurrent
 *   submits of one container import once. After the claim it never answers
 *   INVALID_ARGUMENT nor FAILED_PRECONDITION, which would make the gateway
 *   delete an object being imported. An unavailable import (UNAVAILABLE,
 *   DEADLINE_EXCEEDED, RESOURCE_EXHAUSTED, or no gRPC code) gives
 *   the claim back (one conditional UPDATE on its claim time), leaves the
 *   container open and the object in place, and answers UNAVAILABLE, so the
 *   runner's retry imports. Only when nothing
 *   could be given back does it fail the container IMPORT_UNAVAILABLE and
 *   delete the object.
 * - closeContainer is analysis-reporting's CompleteImportScan with a
 *   container: the container closes through UpdateScan (which recomputes the
 *   scan); a failed scan takes its error from its first failed container.
 *
 * Nothing here logs a token, its hash or a URL. ScanService is resolved at
 * call time (ScanService → ImportScanService → this service would be a
 * constructor cycle).
 */
@Injectable()
export class ScanResultsService implements OnModuleInit {
  private readonly logger = new Logger(ScanResultsService.name);
  private resultService!: ResultServiceClient;

  constructor(
    private readonly tokens: ScanUploadTokens,
    @InjectRepository(Scan)
    private readonly scans: Repository<Scan>,
    @InjectRepository(Container)
    private readonly containers: Repository<Container>,
    private readonly files: FileManagementService,
    @Inject('ANALYSIS_REPORTING_SERVICE')
    private readonly analysisReportingClient: ClientGrpc,
    private readonly moduleRef: ModuleRef,
  ) {}

  onModuleInit(): void {
    this.resultService =
      this.analysisReportingClient.getService<ResultServiceClient>(
        RESULT_SERVICE_NAME,
      );
  }

  async authorize(
    req: AuthorizeScanUploadRequest,
  ): Promise<AuthorizeScanUploadResponse> {
    if (!SCAN_RUN_PROTOCOL_VERSIONS.includes(req.protocolVersion)) {
      throw refuse(status.FAILED_PRECONDITION, 'SCAN_PROTOCOL_UNSUPPORTED');
    }
    const { scan, container, category } = await this.openRun(
      req.scanId,
      req.tokenHash,
    );
    return {
      projectId: scan.projectId,
      organizationId: scan.organizationId,
      containerId: container.id,
      category,
    };
  }

  async submit(
    req: SubmitScanResultsRequest,
  ): Promise<SubmitScanResultsResponse> {
    const { scan, container, category, severities } = await this.openRun(
      req.scanId,
      req.tokenHash,
    );
    const key = importObjectKey(scan.projectId, scan.id, container.id);
    if (req.objectKey !== key) {
      throw refuse(status.INVALID_ARGUMENT, 'IMPORT_OBJECT_KEY_INVALID');
    }
    // The SBOM rides on the same submission, from the sca container only,
    // under that container's own key. Refused before the claim, so the
    // gateway deletes what it stored and the token stays unspent.
    const sbomKey = req.sbomObjectKey || undefined;
    if (
      sbomKey !== undefined &&
      (category !== SBOM_CATEGORY ||
        sbomKey !== importSbomObjectKey(scan.projectId, scan.id, container.id))
    ) {
      throw refuse(status.INVALID_ARGUMENT, 'IMPORT_OBJECT_KEY_INVALID');
    }

    const claimedAt = new Date();
    const claim = await this.tokens.claim(scan.id, req.tokenHash, claimedAt);
    if (claim === 'used') throw alreadySubmitted();
    if (claim !== 'claimed') throw tokenInvalid();

    // Claimed: from here on, only UNAVAILABLE or INTERNAL.
    let accepted = false;
    let unavailable = false;
    try {
      const answer = await lastValueFrom(
        this.resultService
          .importResults({
            scanId: scan.id,
            projectId: scan.projectId,
            organizationId: scan.organizationId,
            branch: scan.branch || DEFAULT_BRANCH,
            vulnerabilityType: category,
            format: 'sarif',
            fileKey: key,
            containerId: container.id,
            severities: normalizeSeverityList(severities).toLowerCase(),
            ...(sbomKey !== undefined ? { sbomFileKey: sbomKey } : {}),
          })
          .pipe(
            timeout({
              each: SCAN_RESULTS_IMPORT_TIMEOUT_MS,
              with: () =>
                throwError(() => ({ code: status.DEADLINE_EXCEEDED })),
            }),
          ),
      );
      accepted = answer?.accepted === true;
    } catch (error) {
      const code = (error as { code?: unknown })?.code;
      unavailable =
        typeof code !== 'number' || RETRYABLE_IMPORT_CODES.has(code);
      this.logger.warn(
        `SCAN_RESULTS_IMPORT_FAILED scan=${scan.id} container=${container.id} code=${
          typeof code === 'number' && status[code] ? status[code] : 'UNKNOWN'
        }`,
      );
    }
    if (accepted) {
      this.logger.log(
        `SCAN_RESULTS_SUBMITTED scan=${scan.id} container=${container.id} category=${category}${
          sbomKey !== undefined ? ' sbom=true' : ''
        }`,
      );
      return { accepted: true };
    }

    // The import was not queued, so the claim is
    // given back and the container stays open; the runner's retry claims
    // again and overwrites the same key with the same SARIF. A first call
    // that did reach analysis-reporting is safe too: its jobId
    // results-import-<scanId>-<containerId> makes the retried add a no-op.
    // Only an unavailability is retried: a refusal (accepted: false, any
    // other code) would refuse the retry too, so it fails the container now.
    if (
      unavailable &&
      (await this.releaseClaim(scan.id, container.id, req.tokenHash, claimedAt))
    ) {
      throw refuse(status.UNAVAILABLE, 'IMPORT_UNAVAILABLE');
    }

    // A refusal, or nothing given back: the token stays spent, so the
    // container is failed and the object deleted, as before.
    try {
      await this.closeContainer({
        scanId: scan.id,
        containerId: container.id,
        status: 'failed',
        errorCode: 'IMPORT_UNAVAILABLE',
        findingsCount: 0,
        toolName: '',
      });
    } catch {
      // the object is still deleted below; the watchdog closes the container
      this.logger.warn(
        `SCAN_RESULTS_CLOSE_FAILED scan=${scan.id} container=${container.id}`,
      );
      for (const objectKey of containerObjectKeys(scan, container, category)) {
        await this.files.deleteImportObject(scan.projectId, objectKey);
      }
    }
    throw refuse(status.UNAVAILABLE, 'IMPORT_UNAVAILABLE');
  }

  /** The give-back of a claim; false (never a throw) when nothing was given back. */
  private async releaseClaim(
    scanId: string,
    containerId: string,
    tokenHash: string,
    claimedAt: Date,
  ): Promise<boolean> {
    try {
      if (await this.tokens.release(tokenHash, claimedAt)) {
        this.logger.warn(
          `SCAN_RESULTS_CLAIM_RELEASED scan=${scanId} container=${containerId}`,
        );
        return true;
      }
    } catch {
      // logged below by ids only: a driver error can quote the statement
    }
    this.logger.warn(
      `SCAN_RESULTS_CLAIM_RELEASE_FAILED scan=${scanId} container=${containerId}`,
    );
    return false;
  }

  async closeContainer(
    req: CompleteImportScanRequest & { containerId: string },
  ): Promise<CompleteImportScanResponse> {
    if (!UUID_PATTERN.test(req.scanId ?? '')) {
      throw refuse(status.INVALID_ARGUMENT, 'Bad request - missing scanId');
    }
    if (!UUID_PATTERN.test(req.containerId ?? '')) {
      throw refuse(status.INVALID_ARGUMENT, 'CONTAINER_ID_INVALID');
    }
    if (req.status !== 'completed' && req.status !== 'failed') {
      throw refuse(status.INVALID_ARGUMENT, 'IMPORT_STATUS_INVALID');
    }
    if (
      req.status === 'failed' &&
      !FAILURE_CODE_PATTERN.test(req.errorCode ?? '')
    ) {
      throw refuse(status.INVALID_ARGUMENT, 'IMPORT_ERROR_CODE_INVALID');
    }

    const container = await this.containers.findOne({
      where: { id: req.containerId, scanId: req.scanId },
    });
    const scan = container
      ? await this.scans.findOne({ where: { id: req.scanId } })
      : null;
    if (!container || !scan) {
      throw refuse(status.NOT_FOUND, 'Container not found');
    }
    const entry = entryForImage(container.image);
    if (!entry) {
      throw refuse(status.FAILED_PRECONDITION, 'NOT_A_CLUSTER_CONTAINER');
    }
    const keys = containerObjectKeys(scan, container, entry.category);

    if (isClosedStatus(container.status)) {
      // analysis-reporting retries, and the watchdog may have closed it:
      // nothing to write, the objects go all the same.
      await this.deleteObjects(scan.projectId, keys);
      return {
        success: true,
        message: `Container already ${container.status}`,
      };
    }

    if (req.status === 'failed') {
      // UpdateScan keeps only a lower-case outcome (the agent's vocabulary):
      // the code is written on the open row first, then the close keeps it.
      await this.containers.update(
        { id: container.id, status: In(OPEN_CONTAINER_STATUSES) },
        { outcomeReason: req.errorCode },
      );
      await this.prepareScanFailure(scan.id, req.errorCode);
    }
    await this.scanService().updateScan({
      scanId: scan.id,
      podName: container.podName,
      state: req.status,
      totalVulnerabilities: Math.max(0, Math.trunc(req.findingsCount || 0)),
    });
    this.logger.log(
      `CLUSTER_CONTAINER_CLOSED scan=${scan.id} container=${container.id} status=${req.status} code=${
        req.errorCode || '-'
      }`,
    );

    if (req.status === 'failed') await this.recordScanFailure(scan.id);
    await this.deleteObjects(scan.projectId, keys);
    return { success: true, message: `Container ${req.status}` };
  }

  private async deleteObjects(
    projectId: string,
    keys: string[],
  ): Promise<void> {
    for (const key of keys) await this.files.deleteImportObject(projectId, key);
  }

  /**
   * Before the close: the scan's error triplet, from its first failed
   * container (this one when none failed before), by one conditional UPDATE
   * on a scan not yet terminal. UpdateScan then flips the state and the
   * error in one write a reader sees together: ScanStateManager keeps the
   * error when the scan becomes `failed` and clears it when the scan stays
   * `running` or ends `completed`. Without it, SCAN_STATUS_CHANGED reached
   * the dashboard with a `failed` scan and no reason.
   */
  private async prepareScanFailure(
    scanId: string,
    errorCode: string,
  ): Promise<void> {
    const first = await this.containers.findOne({
      where: { scanId, status: 'failed', outcomeReason: Not(IsNull()) },
      order: { finishedAt: 'ASC', createdAt: 'ASC' },
    });
    const code =
      containerFailureCode(first?.outcomeReason) ??
      containerFailureCode(errorCode);
    if (code === undefined) return;
    const failure = normalizeScanFailure({
      errorCode: code,
      errorMessage: clusterFailureMessage(code),
    });
    await this.scans.update(
      { id: scanId, state: Not(In(TERMINAL_SCAN_STATES)) },
      {
        errorCode: failure.errorCode,
        errorCategory: failure.errorCategory,
        errorMessage: failure.errorMessage,
      },
    );
  }

  /**
   * Safety net, idempotent: a scan the close made `failed` with no error yet
   * takes one from its first failed container's code (normalizeScanFailure:
   * category and sentence from the number). Written only while the scan is
   * still `failed`. An error already on the row is kept: the lookup orders
   * by finishedAt, one-second precision, so once this container is closed
   * too it may return a later failure of the same second.
   */
  private async recordScanFailure(scanId: string): Promise<void> {
    const current = await this.scans.findOne({ where: { id: scanId } });
    if (current?.state !== 'failed' || current.errorCode != null) return;
    const first = await this.containers.findOne({
      where: { scanId, status: 'failed', outcomeReason: Not(IsNull()) },
      order: { finishedAt: 'ASC', createdAt: 'ASC' },
    });
    const errorCode = containerFailureCode(first?.outcomeReason);
    if (errorCode === undefined) return;
    const failure = normalizeScanFailure({
      errorCode,
      errorMessage: clusterFailureMessage(errorCode),
    });
    await this.scans.update(
      { id: scanId, state: 'failed' },
      {
        errorCode: failure.errorCode,
        errorCategory: failure.errorCategory,
        errorMessage: failure.errorMessage,
      },
    );
  }

  /**
   * The open run of a token: refuses an invalid token, a spent one
   * (ALREADY_EXISTS) and a closed or missing container (invalid).
   */
  private async openRun(
    scanId: string,
    tokenHash: string,
  ): Promise<{
    scan: Scan;
    container: Container;
    category: string;
    severities: string;
  }> {
    if (!UUID_PATTERN.test(scanId ?? '')) throw tokenInvalid();
    const answer = await this.tokens.authorize(scanId, tokenHash, new Date());
    if ('refused' in answer) {
      throw answer.refused === 'used' ? alreadySubmitted() : tokenInvalid();
    }
    const { row } = answer;
    const container = await this.containers.findOne({
      where: { id: row.containerId, scanId },
    });
    if (!container || !OPEN_CONTAINER_STATUSES.includes(container.status)) {
      throw tokenInvalid();
    }
    const scan = await this.scans.findOne({ where: { id: scanId } });
    if (!scan) throw tokenInvalid();
    return {
      scan,
      container,
      category: row.category,
      severities: row.severities,
    };
  }

  private scanService(): ScanService {
    return this.moduleRef.get(ScanService, { strict: false });
  }
}
