import { forwardRef, Inject, Injectable, Optional } from '@nestjs/common';
import { deriveEffectiveSeverity } from 'src/modules/cvss/severity-from-cvss';
import { computeContainerFingerprint } from '../findings-export/fingerprint.util';
import {
  applySightingToDetection,
  applyTriageToDetection,
  assertDismissalReason,
  clearResolutionOnRevive,
  shouldAutoResolveOnDisappearance,
} from '../findings-export/lifecycle.util';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not, In, IsNull } from 'typeorm';
import { ilike } from '@cybedefend/db-dialect';
import { codeAutofixExistsSql } from '../result/autofix-exists-sql';
import { Logger } from 'nestjs-pino';
import { Span } from 'nestjs-otel';
import { ClientGrpc, RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';

import {
  ContainerPackage,
  ContainerVulnerability,
  DeleteContainerImageRequest,
  GetProjectContainerImagesRequest,
  GetProjectContainerImagesResponse,
  GetProjectContainerVulnerabilitiesRequest,
  GetProjectContainerVulnerabilitiesResponse,
  GetProjectContainerVulnerabilityByIdRequest,
  GetProjectContainerVulnerabilityByIdResponse,
  GetProjectPackagesResponse,
  GetProjectScaVulnerabilitiesRequest,
  GetProjectVulnerabilityByIdResponse,
  ProjectDeleteResponse,
  ScanAddContainerResultRequest,
  ScanAddContainerResultResponse,
  ScanProjectInfo,
  UpdateResultRequest,
  GetGroupedContainerImagesRequest,
  GetGroupedContainerImagesResponse,
  GroupedContainerImage,
  ContainerImageTag,
  VulnerabilityCounts,
} from '@grpc/analysis-reporting/result';

import {
  VulnerabilityOsv,
  VulnerabilityOsvAlias,
  VulnerabilityOsvReference,
  VulnerabilityOsvSeverity,
} from 'src/entities/osv';
import {
  advisoryViewOf,
  isImportedAdvisoryView,
  loadCatalogueCveAliases,
  loadImportedAdvisories,
} from '../results-import/imported-advisory.view';

/** What the detail of one container finding reads of a catalogue advisory. */
export const CONTAINER_DETAIL_LIMITS = {
  aliases: 100,
  severities: 20,
  references: 100,
} as const;
import { calculateOsvCvssScore } from '../sca/sca.utils';
import { lookupProjectWithScaBranches } from '../sca/sca-branch.util';
import {
  PROJECT_SERVICE_NAME,
  ProjectServiceClient,
  USER_SERVICE_NAME,
  UserServiceClient,
} from '@grpc/global-management/global_management';
import { ProjectInformationsResponse } from '@grpc/global-management/project';
import {
  SCAN_SERVICE_NAME,
  ScanServiceClient,
} from '@grpc/security-scanning/security_scanning';

import { ContainerDetectedImage } from 'src/entities/container-detected-image.entity';
import { ContainerDetectedPackage } from 'src/entities/container-detected-package.entity';
import {
  ContainerDetectionSource,
  VulnerabilityDetectionsContainer,
} from 'src/entities/container_vulnerability_detections.entity';
import { isOsEndOfLife } from './os-eol';
import {
  CONTAINER_INVENTORY_MATCHER,
  ContainerAdvisoryWriter,
  ContainerInventoryMatcher,
} from '../../edition/ports/container-inventory-matcher.port';
import {
  OS_END_OF_LIFE,
  OsEndOfLifeLookup,
} from '../../edition/ports/os-end-of-life.port';
import { HistoryItem } from 'src/entities/history-item.entity';
import {
  findFixedVersionForPackage,
  mapContainerDetectionEntityToListInterface,
  mapDetectionEntity,
  tallyImageSeverityCounts,
} from './container.mapper';
import { ResultService } from '../result/result.service';
import { effectiveSeveritySql } from '../cvss/effective-severity-sql';
import {
  MAX_LIST_PAGE_SIZE,
  clampListPageSize,
} from '../result/list-page-size.util';
import { CyberiskRecomputeEnqueuer } from '../cyber-risk/cyberisk-recompute.enqueuer';
import { applyPriorityFilter } from '../result/priority-filter.helper';
import { applyExploitabilityVerdictFilter } from '../result/exploitability-verdict-filter.helper';
import { clearExploitabilityFields } from '../result/exploitability-reset.util';
import { CvssCalculatorService } from '../cvss/cvss-calculator.service';
import { CvssExplainerService } from '../cvss/cvss-explainer.service';
import {
  computeStaticExploitability,
  VERDICT_TO_SCORE,
  verdictToScore,
} from '../cvss/static-exploitability';
import { safeGrpcCall } from '@grpc/wrapper-grpc.module';
import { isUniqueViolation } from '@cybedefend/db-dialect';
import { withinSavepoint } from 'src/core/db/within-savepoint';

/**
 * Matches the DEPRECATED `…:sha256:<hex>` suffix — a digest sent in the tag
 * position, with no '@' to separate it.
 *
 * Only a FULL 64-hex sha256 is repaired: a shorter `:sha256:abc` suffix is far
 * more likely to be an (odd but real) tag than a digest, and silently moving it
 * would lose information. Kept identical to `DEPRECATED_DIGEST_SUFFIX` in
 * external-integrations-service/src/core/utils/image-reference.utils.ts.
 */
const DEPRECATED_DIGEST_SUFFIX = /:(sha256:[0-9a-f]{64})$/i;

/**
 * A duplicate key (MySQL 1062, PostgreSQL 23505) as surfaced by TypeORM's
 * QueryFailedError, or a MySQL « Duplicate entry » message.
 * The only error the ingestion pool is allowed to recover from.
 */
function isDuplicateEntryError(error: unknown): boolean {
  const message = (error as { message?: unknown } | null)?.message;
  return (
    isUniqueViolation(error) ||
    /duplicate entry/i.test(typeof message === 'string' ? message : '')
  );
}

/**
 * What a container import adds to a batch.
 * ScanAddContainerResultRequest has no image id; no scanner passes this.
 */
export interface ContainerBatchOptions {
  /** Written on the image row, on create and on update, when non-empty. */
  imageId?: string;
}

@Injectable()
export class ContainerService {
  private scanServiceClient!: ScanServiceClient;
  private projectServiceClient!: ProjectServiceClient;
  private userServiceClient!: UserServiceClient;

  constructor(
    @InjectRepository(ContainerDetectedImage)
    private readonly imageRepo: Repository<ContainerDetectedImage>,
    @InjectRepository(ContainerDetectedPackage)
    private readonly pkgRepo: Repository<ContainerDetectedPackage>,
    @InjectRepository(VulnerabilityDetectionsContainer)
    private readonly detRepo: Repository<VulnerabilityDetectionsContainer>,
    @InjectRepository(HistoryItem)
    private readonly histRepo: Repository<HistoryItem>,
    @InjectRepository(VulnerabilityOsv)
    private readonly osvRepo: Repository<VulnerabilityOsv>,
    @Inject('GLOBAL_MANAGEMENT_SERVICE')
    private readonly globalManagementClient: ClientGrpc,
    @Inject('SECURITY_SCANNING_SERVICE')
    private readonly securityScanningClient: ClientGrpc,
    @Inject(forwardRef(() => ResultService))
    private readonly resultService: ResultService,
    private readonly cvssCalculator: CvssCalculatorService,
    private readonly cvssExplainer: CvssExplainerService,
    private readonly logger: Logger,
    private readonly cyberiskEnqueuer: CyberiskRecomputeEnqueuer,
    // Live end-of-life lookup; optional so the static
    // table still answers wherever the service is not wired (unit tests).
    // The OS_END_OF_LIFE token, which only ee supplies.
    @Optional()
    @Inject(OS_END_OF_LIFE)
    private readonly endOfLife?: OsEndOfLifeLookup,
    // The OSV matching of the package inventory, which
    // only ee supplies. Absent — the Community Edition — a batch stores the
    // scanner's findings only.
    @Optional()
    @Inject(CONTAINER_INVENTORY_MATCHER)
    private readonly inventoryMatcher?: ContainerInventoryMatcher,
  ) {
    this.advisoryWriter = {
      findOrCreateOsvStub: this.findOrCreateOsvStub.bind(this),
      upsertDetection: this.upsertDetection.bind(this),
      highestSeverityOf: this.getHighestSeverityFromOsv.bind(this),
    };
  }

  /** The detection writes the inventory matcher goes through. */
  private readonly advisoryWriter: ContainerAdvisoryWriter;

  onModuleInit() {
    this.projectServiceClient =
      this.globalManagementClient.getService<ProjectServiceClient>(
        PROJECT_SERVICE_NAME,
      );
    this.scanServiceClient =
      this.securityScanningClient.getService<ScanServiceClient>(
        SCAN_SERVICE_NAME,
      );
    this.userServiceClient =
      this.globalManagementClient.getService<UserServiceClient>(
        USER_SERVICE_NAME,
      );
  }

  /**
   * Yield back to the Node.js event loop to let other I/O proceed.
   * Useful when processing large batches to avoid starving other RPC calls.
   */
  private yieldToEventLoop(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve));
  }

  /**
   * Process container packages with bounded concurrency and periodic yielding.
   */
  private async processPackagesWithConcurrency(
    image: ContainerDetectedImage,
    scanId: string,
    results: Array<{
      target: string;
      class: string;
      packages: ContainerPackage[];
    }>,
    options?: { concurrency?: number; yieldEvery?: number },
  ): Promise<void> {
    const tasks: Array<{
      pkgDto: ContainerPackage;
      context: { target: string; class: string };
    }> = [];

    for (const r of results) {
      for (const pkgDto of r.packages) {
        tasks.push({ pkgDto, context: { target: r.target, class: r.class } });
      }
    }

    if (tasks.length === 0) return;

    const concurrency = Math.max(
      1,
      Math.min(options?.concurrency ?? 6, tasks.length),
    );
    const yieldEvery = Math.max(1, options?.yieldEvery ?? 5);

    let index = 0;

    const worker = async () => {
      // Each worker has its own yield counter to ensure regular yielding
      let localProcessedSinceYield = 0;

      while (true) {
        const i = index++;
        if (i >= tasks.length) break;

        const { pkgDto, context } = tasks[i];
        await this.upsertPackage(image, scanId, pkgDto, context);

        // Each worker yields independently to ensure event loop isn't blocked
        localProcessedSinceYield++;
        if (localProcessedSinceYield >= yieldEvery) {
          localProcessedSinceYield = 0;
          await this.yieldToEventLoop();
        }
      }
    };

    await Promise.all(Array.from({ length: concurrency }, () => worker()));
  }

  /**
   * Process container vulnerabilities with bounded concurrency and periodic yielding.
   */
  private async processVulnsWithConcurrency(
    projectId: string,
    image: ContainerDetectedImage,
    results: Array<{
      target: string;
      class: string;
      vulnerabilities: ContainerVulnerability[];
    }>,
    branch?: string,
    options?: { concurrency?: number; yieldEvery?: number },
  ): Promise<void> {
    const tasks: Array<{
      vulnDto: ContainerVulnerability;
      context: { target: string; class: string };
    }> = [];

    // The scanner can report one advisory twice for the same
    // package (layers, aliases). Two identical tasks in the pool race each
    // other on the detection UNIQUE fingerprint, so collapse them upfront.
    const seen = new Set<string>();
    for (const r of results) {
      for (const vulnDto of r.vulnerabilities) {
        const key = [
          r.target,
          vulnDto.pkgName,
          vulnDto.installedVersion ?? '',
          vulnDto.vulnerabilityId,
        ].join(' ');
        if (seen.has(key)) continue;
        seen.add(key);
        tasks.push({ vulnDto, context: { target: r.target, class: r.class } });
      }
    }

    if (tasks.length === 0) return;

    const concurrency = Math.max(
      1,
      Math.min(options?.concurrency ?? 6, tasks.length),
    );
    const yieldEvery = Math.max(1, options?.yieldEvery ?? 5);

    let index = 0;

    const worker = async () => {
      // Each worker has its own yield counter to ensure regular yielding
      let localProcessedSinceYield = 0;

      while (true) {
        const i = index++;
        if (i >= tasks.length) break;

        const { vulnDto, context } = tasks[i];

        const relatedPackage = await this.resolvePackageRow(
          projectId,
          vulnDto,
          context.target,
        );

        if (!relatedPackage) {
          this.logger.warn(
            `Could not find package "${vulnDto.pkgName}" in DB for target "${context.target}". Skipping vulnerability "${vulnDto.vulnerabilityId}".`,
          );
        } else {
          const osvVulnerability = await this.findOrCreateOsvStub(
            vulnDto.vulnerabilityId,
          );
          if (osvVulnerability) {
            await this.upsertDetection(
              projectId,
              image,
              relatedPackage,
              osvVulnerability,
              vulnDto,
              branch,
            );
          } else {
            this.logger.warn(
              `Could not find or create an OSV stub for vuln ID "${vulnDto.vulnerabilityId}". Skipping.`,
            );
          }
        }

        // Each worker yields independently to ensure event loop isn't blocked
        localProcessedSinceYield++;
        if (localProcessedSinceYield >= yieldEvery) {
          localProcessedSinceYield = 0;
          await this.yieldToEventLoop();
        }
      }
    };

    await Promise.all(Array.from({ length: concurrency }, () => worker()));
  }

  /**
   * Adds a container scan result, processing the results in chunks.
   * Legacy method for backward compatibility - delegates to processContainerBatch.
   *
   * @param req - The request containing a chunk of scan results.
   * @returns A response indicating success or failure.
   */
  @Span()
  async addContainerScanResult(
    req: ScanAddContainerResultRequest,
  ): Promise<ScanAddContainerResultResponse> {
    // For backward compatibility, this processes immediately including finalization if isLast
    return this.processContainerBatchInternal(req, req.chunk?.isLast ?? false);
  }

  /**
   * Process a Container scan batch. Called by the BullMQ processor.
   * When chunk.isLast is true, runs finalization to mark missing packages as resolved.
   *
   * @param req The Container scan request
   * @returns Processing result
   */
  @Span()
  async processContainerBatch(
    req: ScanAddContainerResultRequest,
    options?: ContainerBatchOptions,
  ): Promise<ScanAddContainerResultResponse> {
    // Run finalization when chunk.isLast is true
    return this.processContainerBatchInternal(
      req,
      req.chunk?.isLast ?? false,
      options,
    );
  }

  /**
   * Internal method to process Container batch with optional finalization.
   *
   * @param req - The request containing a chunk of scan results.
   * @param runFinalization - Whether to run finalization
   * @returns A response indicating success or failure.
   */
  private async processContainerBatchInternal(
    req: ScanAddContainerResultRequest,
    runFinalization: boolean,
    options?: ContainerBatchOptions,
  ): Promise<ScanAddContainerResultResponse> {
    const { projectId, scanId, results, chunk } = req;
    this.logger.log(
      `[Container] Processing batch chunk ${chunk?.index || 0} for project=${projectId}, scan=${scanId}`,
    );

    // Get the branch from the scan for vulnerability tracking
    let branch: string | undefined;
    try {
      const scanResponse = await safeGrpcCall(
        this.scanServiceClient.getScan({ scanId }),
      );
      branch = scanResponse?.branch || undefined;
    } catch (e) {
      this.logger.warn(
        `Could not retrieve branch for scan ${scanId}: ${e.message}`,
      );
    }

    const image = await this.upsertImage(req, branch, options?.imageId);
    // First process packages with bounded concurrency
    await this.processPackagesWithConcurrency(image, scanId, results, {
      concurrency: 6,
      yieldEvery: 10,
    });

    // Then process vulnerabilities with bounded concurrency
    await this.processVulnsWithConcurrency(projectId, image, results, branch, {
      concurrency: 6,
      yieldEvery: 10,
    });

    // The scanner inventories, the mirror decides. Runs in the
    // container BullMQ job (worker), after the scanner's own findings so a
    // CVE both sides know is written once, as `scanner`.
    await this.inventoryMatcher?.matchInventory(
      { projectId, image, results, os: req.os, branch },
      this.advisoryWriter,
    );
    this.logger.log(
      `Finished processing vulnerabilities for chunk ${chunk?.index || 0}.`,
    );

    // Only run finalization if explicitly requested
    if (runFinalization) {
      this.logger.log(`[FINALIZING] Running finalization for scan ${scanId}.`);
      await this.markMissingPackagesResolved(image, scanId, branch);
    }

    return {
      projectId,
      scanId,
      success: true,
      message: `Chunk ${chunk?.index || 0} processed successfully.`,
    };
  }

  /**
   * Finalize a Container scan by resolving packages that were not detected.
   * This should only be called after ALL batches have been processed.
   *
   * @param projectId The project ID
   * @param scanId The scan ID
   */
  @Span()
  async finalizeScan(projectId: string, scanId: string): Promise<void> {
    this.logger.log(
      `[Container Finalize] Starting finalization for project=${projectId}, scan=${scanId}`,
    );

    // Get the branch from the scan
    let branch: string | undefined;
    try {
      const scanResponse = await safeGrpcCall(
        this.scanServiceClient.getScan({ scanId }),
      );
      branch = scanResponse?.branch || undefined;
    } catch (e) {
      this.logger.warn(
        `Could not retrieve branch for scan ${scanId}: ${e.message}`,
      );
    }

    // Find the image for this scan to run finalization
    const image = await this.imageRepo.findOne({
      where: { projectId, scanId },
    });

    if (image) {
      await this.markMissingPackagesResolved(image, scanId, branch);
    } else {
      this.logger.warn(
        `[Container Finalize] No image found for project=${projectId}, scan=${scanId}`,
      );
    }

    this.logger.log(
      `[Container Finalize] Finalization completed for project=${projectId}, scan=${scanId}`,
    );
  }

  /**
   * Updates a container vulnerability's status, priority, and adds comments.
   * It leverages TypeORM's cascade functionality to correctly save related history items.
   *
   * @param vuln - The fully loaded VulnerabilityDetectionsContainer entity to update.
   * @param dto - The update request data transfer object.
   * @returns The updated vulnerability, re-fetched from the database.
   */
  @Span()
  async handleUpdateContainer(
    vuln: VulnerabilityDetectionsContainer,
    dto: UpdateResultRequest,
  ): Promise<GetProjectVulnerabilityByIdResponse> {
    // Reject a reasonless dismissal BEFORE any mutation — a
    // half-applied dismissal would change the row and still tell the
    // caller it failed. See assertDismissalReason for why the gateway
    // DTO is not sufficient on its own.
    assertDismissalReason(dto);

    const oldStatus = vuln.currentState;
    const oldPriority = vuln.currentPriority;
    const date = new Date();

    // Ensure the historyItems array exists on the parent entity.
    if (!vuln.historyItems) {
      vuln.historyItems = [];
    } // If status changed, update the parent and add a new history item to its collection.

    if (dto.status) {
      // Freeze a DECIDED state (confirmed/ignored/resolved) against
      // scan re-evaluation. `to_verify` is the undecided, scan-managed state the
      // modal offers to revert an accidental confirm/ignore: it records no
      // decision to freeze. Mirrors `handleUpdateSast` and the migration
      // backfill.
      vuln.stateManuallyModified = dto.status !== 'to_verify';
    }

    if (dto.status && dto.status !== oldStatus) {
      vuln.currentState = dto.status;
      vuln.historyItems.push(
        this.histRepo.create({
          type: 'status_change',
          value: dto.status,
          date,
          userId: dto.userId,
        }),
      );
    } // If priority changed, update the parent and add a new history item.

    if (dto.priority && dto.exploitabilitySource !== 'agent') {
      vuln.currentPriority = dto.priority;
      vuln.priorityManualOverride = true;
      if (dto.priority !== oldPriority) {
        vuln.historyItems.push(
          this.histRepo.create({
            type: 'priority_change',
            value: dto.priority,
            date,
            userId: dto.userId,
          }),
        );
      }
    }

    const hasExploitabilityUpdate =
      dto.exploitabilityScore > 0 ||
      (!!dto.exploitabilityVerdict &&
        dto.exploitabilityVerdict !== 'not_evaluated');
    const nextScoringSource =
      dto.scoringSource === 'static' || dto.scoringSource === 'agent'
        ? dto.scoringSource
        : dto.exploitabilitySource === 'agent' ||
            (!dto.exploitabilitySource && hasExploitabilityUpdate)
          ? 'agent'
          : undefined;
    if (nextScoringSource) {
      vuln.scoringSource = nextScoringSource;
    }

    if (dto.comment) {
      vuln.historyItems.push(
        this.histRepo.create({
          type: 'comment',
          value: dto.comment,
          date,
          userId: dto.userId,
        }),
      );
    }

    // Persist exploitability fields from agent or manual assessment.
    // The score is derived deterministically from the verdict — agent-supplied
    // scores are intentionally ignored.
    if (dto.exploitabilityVerdict === 'not_evaluated') {
      // Manual reset: sets the verdict back to NULL, then recomputes the base priority.
      clearExploitabilityFields(vuln);
      vuln.exploitabilityUpdatedAt = new Date();

      vuln.historyItems.push(
        this.histRepo.create({
          type: 'exploitability_change',
          value: JSON.stringify({ cleared: true }),
          date,
          userId: dto.userId,
        }),
      );

      const result = await this.resultService.recalculatePriority(
        vuln,
        dto.projectId,
        undefined,
        { forceRecompute: dto.exploitabilitySource === 'manual' },
      );
      if (result) {
        vuln.priorityScore = result.priorityScore;
        if (result.priority !== oldPriority) {
          vuln.currentPriority = result.priority;
          vuln.historyItems.push(
            this.histRepo.create({
              type: 'priority_change',
              value: result.priority,
              date,
              // Inherit the triggering actor instead of the 'system'
              // sentinel so a human edit no longer renders as the AI agent.
              userId: dto.userId,
            }),
          );
        }
      }
    } else if (dto.exploitabilityVerdict) {
      const verdict = dto.exploitabilityVerdict;
      const score = verdictToScore(verdict) ?? VERDICT_TO_SCORE.theoretical;
      vuln.exploitabilityVerdict = verdict as any;
      vuln.exploitabilityScore = score;
      vuln.exploitabilityReason = dto.exploitabilityReason;
      vuln.exploitabilityScoreReason =
        dto.exploitabilityScoreReason ?? vuln.exploitabilityScoreReason;
      // Default to the conservative 'manual' when no source is given.
      vuln.exploitabilitySource = (dto.exploitabilitySource || 'manual') as any;
      vuln.exploitabilityUpdatedAt = new Date();

      vuln.historyItems.push(
        this.histRepo.create({
          type: 'exploitability_change',
          value: JSON.stringify({ score, verdict }),
          date,
          userId: dto.userId,
        }),
      );

      const result = await this.resultService.recalculatePriority(
        vuln,
        dto.projectId,
        undefined,
        { forceRecompute: dto.exploitabilitySource === 'manual' },
      );
      if (result) {
        vuln.priorityScore = result.priorityScore;
        if (result.priority !== oldPriority) {
          vuln.currentPriority = result.priority;
          vuln.historyItems.push(
            this.histRepo.create({
              type: 'priority_change',
              value: result.priority,
              date,
              // Inherit the triggering actor instead of the 'system'
              // sentinel so a human edit no longer renders as the AI agent.
              userId: dto.userId,
            }),
          );
        }
      }
    }

    // `date` above is the one clock for this decision: the history rows and
    // these detection stamps share the instant backfill-lifecycle.ts joins on.
    applyTriageToDetection(vuln, dto, date);

    // By saving the parent entity (`vuln`), TypeORM's cascade option will
    // automatically find the new items in the `historyItems` array,
    // insert them, and correctly set the foreign key.
    await this.detRepo.save(vuln);

    await this.cyberiskEnqueuer.enqueue(dto.projectId, 'vuln_update');

    // Return the re-fetched and now fully updated vulnerability.
    return this.getContainerVulnerabilityById({
      projectId: dto.projectId,
      vulnerabilityId: dto.vulnerabilityId,
    });
  }

  /**
   * Returns a list of all detected images for a specific project.
   * @param dto - The request containing the projectId.
   * @returns A list of detected container images.
   */
  @Span()
  async getProjectContainerImages(
    dto: GetProjectContainerImagesRequest,
  ): Promise<GetProjectContainerImagesResponse> {
    const { projectId } = dto;
    // `optional` fields: absent is undefined, but an explicit 0 must not take
    // 0 rows and divide the page count by zero.
    const page = Math.max(dto.page || 1, 1);
    // And at most 500 images (silently).
    const limit = Math.min(Math.max(dto.limit || 20, 1), MAX_LIST_PAGE_SIZE);

    // 1. Fetch the project name
    const projectResponse = await safeGrpcCall(
      this.projectServiceClient.get({ projectId }),
    );
    const projectName = projectResponse?.name ?? '';

    // Build where clause with optional branch filter
    const whereClause: any = { projectId };
    if (dto.branch) {
      whereClause.branch = dto.branch;
    }

    // 2. Count the images of this project (and branch, when given)
    const totalImages = await this.imageRepo.count({
      where: whereClause,
    });

    if (totalImages === 0) {
      return {
        projectName,
        images: [],
        totalImages: 0,
        totalPages: 0,
        currentPage: page,
        pageSize: limit,
      };
    }

    // 3. Compute the pagination
    const offset = (page - 1) * limit;
    const totalPages = Math.ceil(totalImages / limit);

    // 4. Fetch the images of the page
    const images = await this.imageRepo.find({
      where: whereClause,
      order: { updatedAt: 'DESC' },
      skip: offset,
      take: limit,
    });

    const imageIds = images.map((img) => img.id);

    // 5. One aggregate query counts the vulnerabilities per image and severity
    const counts = await this.detRepo
      .createQueryBuilder('det')
      .select('det.detectedImageId', 'imageId')
      .addSelect(effectiveSeveritySql('det'), 'severity')
      .addSelect('COUNT(det.id)', 'count')
      .where('det.detectedImageId IN (:...imageIds)', { imageIds })
      .groupBy(`det.detectedImageId, ${effectiveSeveritySql('det')}`)
      .getRawMany();

    // 6. Map the counts by imageId. effectiveSeveritySql() is NULL for
    // a detection with no CVSS score and no label: it counts as unknown
    // instead of throwing.
    const countsMap = tallyImageSeverityCounts(counts);

    // 7. Attach the counts to the image objects
    const enrichedImages = images.map((img) => {
      const vulnCounts = countsMap.get(img.id) || {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        unknown: 0,
      };
      return {
        id: img.id,
        projectId: img.projectId,
        artifactName: img.artifactName,
        osFamily: img.osFamily,
        osName: img.osName,
        osEosl: img.osEosl ?? false,
        branch: img.branch || '',
        createdAt: img.createdAt.toISOString(),
        updatedAt: img.updatedAt.toISOString(),
        vulnCounts, // Champ enrichi
      };
    });

    return {
      projectName,
      images: enrichedImages,
      totalImages,
      totalPages,
      currentPage: page,
      pageSize: limit,
    };
  }

  /**
   * Extracts the repository name (without tag or digest), the tag and the digest
   * from an artifact name. Handles:
   * - registry.gitlab.com/group/project:tag
   * - registry.io:5000/org/repo (the ':' is a port, not a tag)
   * - nginx:latest
   * - alpine (no tag)
   * - rg.example.com/group/project@sha256:<hex> (scanned by digest)
   * - repo:v1@sha256:<hex> (tag AND digest)
   * - repo:sha256:<hex> (DEPRECATED: a digest sent in the tag position)
   *
   * This is a deliberate LOCAL re-implementation, not a shared parser: the
   * services are deployed independently and only `libs/protos` crosses service
   * boundaries, so nothing here can be imported. Two other places re-implement
   * the same '@'-then-':'-after-the-last-'/' grammar, and this function is kept
   * consistent with them:
   * - security-scanning-service/src/modules/scan/core/image-reference.util.ts —
   *   `normalizeImageReference`, which only normalizes case (lowercase host and
   *   repository, tag preserved). It shares the grammar but does NOT
   *   repair the deprecated shape.
   * - external-integrations-service/src/core/utils/image-reference.utils.ts —
   *   `parseImageReference`, which is where the deprecated-shape repair below
   *   comes from, precondition included.
   *
   * @param artifactName The full artifact name (e.g., "registry.gitlab.com/group/project:v1.0.0")
   * @returns An object with repositoryName, tag and an optional digest
   */
  private extractRepositoryAndTag(artifactName: string): {
    repositoryName: string;
    tag: string;
    digest?: string;
  } {
    // The FIRST '@' separates the digest: everything after it belongs to the
    // digest and must never be mined for a tag. Splitting it off up-front is
    // what keeps `…/project@sha256:<hex>` from collapsing into a phantom
    // `…/project@sha256` repository that never groups with its sibling tags.
    const atIndex = artifactName.indexOf('@');
    let ref = atIndex === -1 ? artifactName : artifactName.slice(0, atIndex);
    let digest =
      atIndex === -1 ? undefined : artifactName.slice(atIndex + 1) || undefined;

    // The DEPRECATED `repo:sha256:<hex>` shape carries the digest in the tag
    // position with no '@' to split on, so the tag scan below would key off the
    // ':' INSIDE `sha256:<hex>` and hand back a truncated `repo:sha256`
    // repository — the phantom-repository bug again, this time on a
    // reference the dashboard still emits for untagged images.
    //
    // Repairing is attempted ONLY when no '@' was present, so an explicit
    // digest always wins: on `repo:tag@sha256:<hex>` the tag must survive, and
    // on a reference that carries BOTH shapes the '@' one is the authoritative
    // digest and must never be overwritten by the deprecated suffix.
    if (atIndex === -1) {
      const deprecated = ref.match(DEPRECATED_DIGEST_SUFFIX);
      if (deprecated) {
        digest = deprecated[1];
        ref = ref.slice(0, ref.length - deprecated[0].length);
      }
    }

    // A ':' BEFORE the last '/' is a registry port, not a tag separator.
    const lastSlashIndex = ref.lastIndexOf('/');
    const lastColonIndex = ref.lastIndexOf(':');
    if (lastColonIndex <= lastSlashIndex) {
      // No tag in the reference. `nginx` really does mean `nginx:latest` per
      // Docker's own defaulting, so keep that historical default — EXCEPT when
      // the image was addressed by DIGEST: `repo@sha256:<hex>` carries no tag at
      // all. Answering 'latest' there is a fabrication that (a) makes consumers
      // rebuild `repo:latest`, a DIFFERENT manifest, and (b) collapses two
      // digests of one repository into two identical rows. An empty
      // tag is the honest answer; the digest is what makes the row addressable.
      return { repositoryName: ref, tag: digest ? '' : 'latest', digest };
    }

    const repositoryName = ref.slice(0, lastColonIndex);
    const tag = ref.slice(lastColonIndex + 1) || 'latest';
    return { repositoryName, tag, digest };
  }

  /**
   * Returns container images grouped by repository name, showing all tags within each image.
   * This allows viewing images like nginx:v1.0.0 and nginx:latest as a single entity.
   *
   * @param dto - The request containing pagination, filters, and sorting options.
   * @returns A grouped response with repositories and their tags.
   */
  @Span()
  async getGroupedContainerImages(
    dto: GetGroupedContainerImagesRequest,
  ): Promise<GetGroupedContainerImagesResponse> {
    const { projectId, page = 1, limit = 20 } = dto;

    // 1. Get project name
    const projectResponse = await safeGrpcCall(
      this.projectServiceClient.get({ projectId }),
    );
    const projectName = projectResponse?.name ?? '';

    // Build base where clause
    const whereClause: Record<string, unknown> = { projectId };
    if (dto.branch) {
      whereClause.branch = dto.branch;
    }

    // 2. Fetch all images for this project (we'll group them in memory)
    let imagesQuery = this.imageRepo
      .createQueryBuilder('img')
      .where('img.projectId = :projectId', { projectId });

    if (dto.branch) {
      imagesQuery = imagesQuery.andWhere('img.branch = :branch', {
        branch: dto.branch,
      });
    }

    if (dto.searchQuery) {
      imagesQuery = imagesQuery.andWhere(
        ilike('img.artifactName', ':searchQuery').text,
        {
          searchQuery: `%${dto.searchQuery}%`,
        },
      );
    }

    const allImages = await imagesQuery
      .orderBy('img.updatedAt', 'DESC')
      .getMany();

    if (allImages.length === 0) {
      return {
        projectName,
        groupedImages: [],
        totalRepositories: 0,
        totalTags: 0,
        totalPages: 0,
        currentPage: page,
        pageSize: limit,
      };
    }

    // 3. Get vulnerability counts for all images in a single query
    const imageIds = allImages.map((img) => img.id);
    const counts = await this.detRepo
      .createQueryBuilder('det')
      .select('det.detectedImageId', 'imageId')
      .addSelect(effectiveSeveritySql('det'), 'severity')
      .addSelect('COUNT(det.id)', 'count')
      .where('det.detectedImageId IN (:...imageIds)', { imageIds })
      .groupBy(`det.detectedImageId, ${effectiveSeveritySql('det')}`)
      .getRawMany();

    // Map counts by image ID
    const countsMap = tallyImageSeverityCounts(counts);

    // 4. Group images by repository name
    const groupedMap = new Map<
      string,
      {
        repositoryName: string;
        projectId: string;
        osFamily: string;
        osName: string;
        osEosl: boolean;
        branch: string;
        tags: ContainerImageTag[];
        aggregatedCounts: VulnerabilityCounts;
        latestScanAt: Date;
      }
    >();

    for (const img of allImages) {
      const { repositoryName, tag, digest } = this.extractRepositoryAndTag(
        img.artifactName,
      );
      const vulnCounts = countsMap.get(img.id) || {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        unknown: 0,
      };

      if (!groupedMap.has(repositoryName)) {
        groupedMap.set(repositoryName, {
          repositoryName,
          projectId: img.projectId,
          osFamily: img.osFamily,
          osName: img.osName,
          osEosl: false,
          branch: img.branch || '',
          tags: [],
          aggregatedCounts: {
            critical: 0,
            high: 0,
            medium: 0,
            low: 0,
            unknown: 0,
          },
          latestScanAt: img.updatedAt,
        });
      }

      const group = groupedMap.get(repositoryName)!;

      // Add tag to the group. `repositoryName` + tag/digest is the ONLY thing a
      // consumer has to rebuild `artifactName`, so both halves travel: with the
      // digest published, `repository_name@digest` reproduces a by-digest
      // artifact byte for byte, and the empty tag tells the UI to label the row
      // with its digest instead of an invented 'latest'.
      // One EOL tag is enough to flag the whole repository.
      group.osEosl = group.osEosl || Boolean(img.osEosl);
      group.tags.push({
        id: img.id,
        tag,
        digest: digest ?? '',
        osEosl: img.osEosl ?? false,
        scanId: img.scanId,
        createdAt: img.createdAt.toISOString(),
        updatedAt: img.updatedAt.toISOString(),
        vulnCounts,
      });

      // Aggregate vulnerability counts
      group.aggregatedCounts.critical =
        (group.aggregatedCounts.critical ?? 0) + (vulnCounts.critical ?? 0);
      group.aggregatedCounts.high =
        (group.aggregatedCounts.high ?? 0) + (vulnCounts.high ?? 0);
      group.aggregatedCounts.medium =
        (group.aggregatedCounts.medium ?? 0) + (vulnCounts.medium ?? 0);
      group.aggregatedCounts.low =
        (group.aggregatedCounts.low ?? 0) + (vulnCounts.low ?? 0);
      group.aggregatedCounts.unknown =
        (group.aggregatedCounts.unknown ?? 0) + (vulnCounts.unknown ?? 0);

      // Track latest scan
      if (img.updatedAt > group.latestScanAt) {
        group.latestScanAt = img.updatedAt;
      }
    }

    // 5. Convert to array and sort
    let groupedArray = Array.from(groupedMap.values());
    const totalRepositories = groupedArray.length;
    const totalTags = allImages.length;

    // Apply sorting
    const sortField = dto.sort ?? 'latestScanAt';
    const sortOrder = (dto.order ?? 'DESC').toUpperCase();
    groupedArray.sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case 'repositoryName':
        case 'repository_name':
          comparison = a.repositoryName.localeCompare(b.repositoryName);
          break;
        case 'tagCount':
        case 'tag_count':
          comparison = a.tags.length - b.tags.length;
          break;
        case 'latestScanAt':
        case 'latest_scan_at':
        default:
          comparison = a.latestScanAt.getTime() - b.latestScanAt.getTime();
          break;
      }
      return sortOrder === 'ASC' ? comparison : -comparison;
    });

    // 6. Apply pagination
    const offset = (page - 1) * limit;
    const totalPages = Math.ceil(totalRepositories / limit);
    groupedArray = groupedArray.slice(offset, offset + limit);

    // 7. Map to response format
    const groupedImages: GroupedContainerImage[] = groupedArray.map(
      (group) => ({
        repositoryName: group.repositoryName,
        projectId: group.projectId,
        osFamily: group.osFamily,
        osName: group.osName,
        osEosl: group.osEosl,
        branch: group.branch,
        tagCount: group.tags.length,
        tags: group.tags,
        aggregatedVulnCounts: group.aggregatedCounts,
        latestScanAt: group.latestScanAt.toISOString(),
      }),
    );

    return {
      projectName,
      groupedImages,
      totalRepositories,
      totalTags,
      totalPages,
      currentPage: page,
      pageSize: limit,
    };
  }

  /**
   * Returns a paginated and filtered list of container vulnerabilities for a project.
   * This method uses a multi-stage enrichment pipeline to ensure data is both
   * performantly fetched and complete.
   *
   * @param dto - The request containing pagination and filtering options.
   * @returns A paginated response with container vulnerabilities.
   */
  @Span()
  async getProjectContainerVulnerabilities(
    dto: GetProjectContainerVulnerabilitiesRequest,
  ): Promise<GetProjectContainerVulnerabilitiesResponse> {
    const {
      projectId,
      page = 1,
      limit: requestedLimit = 10,
      sort = 'currentSeverity',
      order = 'ASC',
      severity,
      status,
      priority,
      searchQuery,
      imageId,
      hasAutofix,
      exploitabilityVerdict,
      scoringSource,
      slim,
    } = dto;
    // An explicit page size is clamped at 500 (silently).
    const limit = clampListPageSize(requestedLimit);
    // 1. Build the main query with all filters and sorting.

    const qb = this.detRepo
      .createQueryBuilder('det')
      .innerJoinAndSelect('det.detectedPackage', 'pkg')
      .innerJoin('det.detectedImage', 'image')
      .leftJoinAndSelect('det.vulnerability', 'osv')
      .where('det.projectId = :projectId', { projectId });

    // Filter by branch if specified
    if (dto.branch) {
      qb.andWhere('det.branch = :branch', { branch: dto.branch });
    }
    if (imageId) {
      qb.andWhere('image.id = :imageId', { imageId });
    }
    if (severity?.length) {
      qb.andWhere(`${effectiveSeveritySql('det')} IN (:...severity)`, {
        severity: severity.map((s) => s.toLowerCase()),
      });
    }
    if (status?.length) {
      qb.andWhere('det.currentState IN (:...status)', { status });
    }
    applyPriorityFilter(qb, priority, 'det');
    applyExploitabilityVerdictFilter(qb, exploitabilityVerdict, 'det');
    if (scoringSource) {
      if (scoringSource === 'agent') {
        qb.andWhere(
          '(det.scoringSource = :scoringSource OR det.exploitabilitySource = :agentExploitabilitySource)',
          { scoringSource, agentExploitabilitySource: 'agent' },
        );
      } else {
        qb.andWhere(
          'det.scoringSource = :scoringSource AND (det.exploitabilitySource IS NULL OR det.exploitabilitySource <> :agentExploitabilitySource)',
          { scoringSource, agentExploitabilitySource: 'agent' },
        );
      }
    }
    if (dto.classType?.length) {
      qb.andWhere('pkg.class IN (:...classType)', { classType: dto.classType });
    }
    if (searchQuery) {
      qb.andWhere(
        `(${ilike('det.vulnerabilityIdentifier', ':q').text} OR ${ilike('pkg.packageName', ':q').text} OR ${ilike('pkg.srcName', ':q').text})`,
        { q: `%${searchQuery}%` },
      );
    }

    // Filter by autofix status if specified, through the subquery the SAST
    // lists use: its alias is not the builder's, so its camelCase column is
    // quoted on PostgreSQL; `det.id` is the builder's alias, which TypeORM
    // quotes itself. It was `det`.`id`, a MySQL quote PostgreSQL refuses.
    const autofixOfDetection = codeAutofixExistsSql('det.id');
    if (hasAutofix !== undefined && hasAutofix !== null) {
      if (hasAutofix === true) {
        // Has autofix: must have at least one autofixRecord
        qb.andWhere(`EXISTS (${autofixOfDetection})`);
      } else {
        // No autofix: must NOT have any autofixRecord
        qb.andWhere(`NOT EXISTS (${autofixOfDetection})`);
      }
    }

    const allowedSort = [
      'currentSeverity',
      'currentState',
      'currentPriority',
      'priorityScore',
      'createdAt',
      'updatedAt',
      'cvssScore',
    ];
    const safeSort = allowedSort.includes(sort) ? sort : 'currentSeverity';
    const orderUC = (order || '').toUpperCase();
    const safeOrder = orderUC === 'DESC' ? 'DESC' : 'ASC';

    if (safeSort === 'currentSeverity') {
      qb.addSelect(
        `CASE WHEN ${effectiveSeveritySql('det')} = 'critical' THEN 1
              WHEN ${effectiveSeveritySql('det')} = 'high' THEN 2
              WHEN ${effectiveSeveritySql('det')} = 'medium' THEN 3
              WHEN ${effectiveSeveritySql('det')} = 'low' THEN 4
              ELSE 5 END`,
        'severity_order',
      ).orderBy('severity_order', safeOrder);
    } else if (safeSort === 'currentPriority') {
      qb.addSelect(
        `CASE WHEN LOWER(det.currentPriority) = 'critical_urgent' THEN 1 WHEN LOWER(det.currentPriority) = 'urgent' THEN 2 WHEN LOWER(det.currentPriority) = 'normal' THEN 3 WHEN LOWER(det.currentPriority) = 'low' THEN 4 WHEN LOWER(det.currentPriority) = 'very_low' THEN 5 ELSE 6 END`,
        'priority_order',
      ).orderBy('priority_order', safeOrder);
    } else if (safeSort === 'priorityScore') {
      qb.addSelect(
        'CASE WHEN det.priorityScore IS NULL THEN 1 ELSE 0 END',
        'priority_score_null_order',
      )
        .orderBy('priority_score_null_order', 'ASC')
        .addOrderBy('det.priorityScore', safeOrder);
    } else {
      qb.orderBy(`det.${safeSort}`, safeOrder);
    }

    // 2. Execute the query to get the paginated list and total count.
    let initialDetections: VulnerabilityDetectionsContainer[] = [];
    let total = 0;

    if (safeSort === 'cvssScore') {
      // For cvssScore, every detection is read, then sorted in memory
      // Sort: by severity first (CRITICAL > HIGH > MEDIUM > LOW), then by CVSS within a severity
      // N/A scores (0 or null) go to the end of each severity group
      const allDetections = await qb.getMany();
      total = allDetections.length;
      await this.applyProjectAdvisories(projectId, allDetections);

      // Attach the severity data to compute the CVSS score
      const detectionsWithSeverities =
        await this.enrichDetectionsWithSeverities(allDetections);

      // Severity rank (smaller = more critical)
      const getSeverityOrder = (severity: string | undefined): number => {
        switch (severity?.toLowerCase()) {
          case 'critical':
            return 1;
          case 'high':
            return 2;
          case 'medium':
            return 3;
          case 'low':
            return 4;
          default:
            return 5;
        }
      };

      // Precompute the CVSS score of each detection
      const scoresMap = new Map<string, number>();
      for (const det of detectionsWithSeverities) {
        const score = det.vulnerability
          ? calculateOsvCvssScore(det.vulnerability)
          : 0;
        scoresMap.set(det.id, score);
      }

      // Sort by severity first, then by CVSS score within a severity
      // N/A scores (0) go to the end of each group
      detectionsWithSeverities.sort((a, b) => {
        const severityOrderA = getSeverityOrder(
          a.effectiveSeverity ?? a.currentSeverity,
        );
        const severityOrderB = getSeverityOrder(
          b.effectiveSeverity ?? b.currentSeverity,
        );

        // Compare by severity first
        if (severityOrderA !== severityOrderB) {
          return safeOrder === 'DESC'
            ? severityOrderA - severityOrderB
            : severityOrderB - severityOrderA;
        }

        // Same severity: sort by the precomputed CVSS score
        const scoreA = scoresMap.get(a.id) ?? 0;
        const scoreB = scoresMap.get(b.id) ?? 0;

        // N/A scores (0) at the end of the group
        if (scoreA > 0 && scoreB === 0) return -1;
        if (scoreA === 0 && scoreB > 0) return 1;
        if (scoreA === 0 && scoreB === 0) return 0;

        // Les deux ont un score -> trier par score
        return safeOrder === 'DESC' ? scoreB - scoreA : scoreA - scoreB;
      });

      // Paginate after the sort
      initialDetections = detectionsWithSeverities.slice(
        (page - 1) * limit,
        page * limit,
      );
    } else {
      // Any other sort uses the regular SQL pagination
      [initialDetections, total] = await qb
        .skip((page - 1) * limit)
        .take(limit)
        .getManyAndCount();
    }

    // --- ENRICHMENT PIPELINE ---
    // 3. Run the detections through our enrichment pipeline. An advisory the
    // project imported is read from the project's own row only.
    if (safeSort !== 'cvssScore') {
      await this.applyProjectAdvisories(projectId, initialDetections);
    }

    let detectionsWithSeverities: VulnerabilityDetectionsContainer[];

    if (safeSort === 'cvssScore') {
      // When sorting by CVSS, the detections already carry their severities
      detectionsWithSeverities = initialDetections;
    } else {
      // Sinon, enrichir normalement
      detectionsWithSeverities =
        await this.enrichDetectionsWithSeverities(initialDetections);
    }

    // Parallel fan-out: the enrichment, project info, scan and per-type
    // counts are all independent. Previously 4 sequential awaits at the
    // tail of the pipeline. The counter takes its SCA branch
    // partition from the list's own (and only) project Get.
    // A slim (MCP) list reads neither the project, the scan
    // nor the counters, and answers with empty values instead.
    const lookup = slim
      ? undefined
      : lookupProjectWithScaBranches(
          this.projectServiceClient,
          projectId,
          dto.branch,
        );
    const [finalDetections, projectResponse, scanResponse, vulnCountByType] =
      await Promise.all([
        this.enrichDetectionsWithFixedVersions(detectionsWithSeverities),
        slim
          ? Promise.resolve({} as ProjectInformationsResponse)
          : lookup.projectLookup,
        slim
          ? Promise.resolve(undefined)
          : safeGrpcCall(
              this.scanServiceClient.getLastScanStatus({ projectId }),
            ),
        slim
          ? Promise.resolve(undefined)
          : lookup.scaBranches.then((branches) =>
              this.resultService.getCountVulnerabilitiesCountByType(
                projectId,
                dto.branch,
                branches,
              ),
            ),
      ]); // --- END PIPELINE ---
    let scanProjectInfo: ScanProjectInfo | undefined;
    if (scanResponse) {
      scanProjectInfo = {
        scanId: scanResponse.id,
        state: scanResponse.state,
        createAt: scanResponse.createAt,
        scanType: scanResponse.scanType,
      };
    } // 4. Return the final, fully-enriched data.

    return {
      projectId,
      projectName: projectResponse.name,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      sort,
      order,
      severity,
      status,
      priority,
      vulnerabilities: finalDetections.map((d) =>
        mapContainerDetectionEntityToListInterface(d, this.cvssExplainer),
      ),
      scanProjectInfo,
      vulnCountByType,
    };
  }

  /**
   * Resolves the package row an advisory belongs to.
   *
   * Trivy splits deb/rpm coordinates — Package.Version "8.30" + Release "3"
   * (+ Epoch) — but reports the advisory's InstalledVersion as the full
   * "8.30-3", so an equality lookup on the version misses EVERY Debian row
   * (68/68 advisories dropped on debian:10). Only apk carries the "-rN"
   * inside Version. Resolve by name + target, and use the version only to
   * pick between several rows (two versions of one package in one target).
   */
  private async resolvePackageRow(
    projectId: string,
    vulnDto: ContainerVulnerability,
    target: string,
  ): Promise<ContainerDetectedPackage | null> {
    const rows =
      (await this.pkgRepo.find({
        where: { projectId, packageName: vulnDto.pkgName, target },
      })) ?? [];
    if (rows.length <= 1) return rows[0] ?? null;

    const stripEpoch = (v: string) => (v ?? '').replace(/^\d+:/, '');
    const installed = vulnDto.installedVersion ?? '';
    const wanted = stripEpoch(installed);
    return (
      rows.find((r) => r.packageVersion === installed) ??
      rows.find((r) => stripEpoch(r.packageVersion) === wanted) ??
      rows.find((r) => wanted.startsWith(`${stripEpoch(r.packageVersion)}-`)) ??
      rows[0]
    );
  }

  /**
   * Finds an OSV entity by its ID or creates a minimal "stub" record if it doesn't exist.
   * This prevents heavy database lookups during scan ingestion by trusting the scanner's data first.
   * @param vulnerabilityId - The vulnerability identifier (e.g., CVE-2022-1234, GHSA-xxxx-xxxx-xxxx).
   * @returns A saved VulnerabilityOsv entity (either existing or newly created).
   */
  private async findOrCreateOsvStub(
    vulnerabilityId: string,
  ): Promise<VulnerabilityOsv> {
    if (!vulnerabilityId) return null; // Quick lookup by primary key. This is very fast.

    const existingOsv = await this.osvRepo.findOneBy({ id: vulnerabilityId });
    if (existingOsv) {
      return existingOsv;
    } // If not found, create and save a minimal stub.
    // This ensures we have a valid foreign key target for the detection record.
    // The full details can be synced from a canonical source later in a background job.

    const newOsvStub = this.osvRepo.create({
      id: vulnerabilityId, // We only need the ID to establish the relationship.
      // Other fields like summary, details, etc., will be null or default.
    });

    try {
      // Inside a transaction, a savepoint: the refused insert leaves it usable
      // on PostgreSQL, for the lookup of the winner's row below.
      const repository = this.osvRepo;
      return await withinSavepoint(repository.manager, () =>
        repository.save(newOsvStub),
      );
    } catch (error) {
      // The vulnerability pool runs several workers; two packages
      // hit by the same brand-new CVE both miss the lookup and both insert.
      // The loser must adopt the winner's row, not fail the whole batch.
      if (!isDuplicateEntryError(error)) throw error;
      const winner = await this.osvRepo.findOneBy({ id: vulnerabilityId });
      if (winner) return winner;
      throw error;
    }
  }

  /**
   * Replaces the advisory of each detection whose advisory the project
   * imported by the project's own row; gives every other one its CVE alias
   * (the same rule as the SCA list), so the list and the detail show one CVE.
   */
  private async applyProjectAdvisories(
    projectId: string,
    detections: VulnerabilityDetectionsContainer[],
  ): Promise<void> {
    const ids = [
      ...new Set(
        detections
          .map((d) => d.vulnerability?.id)
          .filter((id): id is string => !!id),
      ),
    ];
    if (ids.length === 0) return;
    const manager = this.osvRepo.manager;
    const imported = await loadImportedAdvisories(manager, projectId, ids);
    const catalogueIds = ids.filter((id) => !imported.has(id));
    const cves = catalogueIds.length
      ? await loadCatalogueCveAliases(manager, catalogueIds)
      : new Map<string, string>();
    for (const detection of detections) {
      const id = detection.vulnerability?.id;
      if (!id) continue;
      const own = imported.get(id);
      if (own) {
        detection.vulnerability = advisoryViewOf(own, {
          packageName: detection.detectedPackage?.packageName ?? '',
          ecosystem: '',
          alternateNames: detection.detectedPackage?.srcName
            ? [detection.detectedPackage.srcName]
            : [],
        });
      } else if (!detection.vulnerability.aliases && cves.has(id)) {
        detection.vulnerability.aliases = [
          Object.assign(new VulnerabilityOsvAlias(), {
            id: '',
            alias: cves.get(id),
          }),
        ];
      }
    }
  }

  /**
   * The aliases, severities and references of a catalogue advisory, each by
   * its own bounded query (never one join of every collection).
   */
  private async loadCatalogueCollections(
    advisory: VulnerabilityOsv,
  ): Promise<void> {
    const manager = this.osvRepo.manager;
    const where = { vulnerability: { id: advisory.id } };
    const listCve = advisory.aliases?.[0]?.alias;
    const [aliases, severities, references] = await Promise.all([
      manager.find(VulnerabilityOsvAlias, {
        where,
        order: { alias: 'ASC' },
        take: CONTAINER_DETAIL_LIMITS.aliases,
      }),
      manager.find(VulnerabilityOsvSeverity, {
        where,
        order: { id: 'ASC' },
        take: CONTAINER_DETAIL_LIMITS.severities,
      }),
      manager.find(VulnerabilityOsvReference, {
        where,
        order: { id: 'ASC' },
        take: CONTAINER_DETAIL_LIMITS.references,
      }),
    ]);
    if (listCve && !aliases.some((a) => a.alias === listCve)) {
      aliases.unshift(
        Object.assign(new VulnerabilityOsvAlias(), { id: '', alias: listCve }),
      );
    }
    Object.assign(advisory, { aliases, severities, references });
  }

  /**
   * Enriches a list of detections with fixed versions from the OSV database,
   * searching through both primary vulnerabilities and their aliases.
   * This method is optimized to run a minimal number of queries for an entire list.
   *
   * @param detections - The list of detections from a paginated query.
   * @returns The same list of detections, with the `fixedVersion` field populated where found.
   */
  private async enrichDetectionsWithFixedVersions(
    detections: VulnerabilityDetectionsContainer[],
  ): Promise<VulnerabilityDetectionsContainer[]> {
    // 1. Identify only the detections that need enrichment.
    // An imported advisory's fix is what the import declared (stored on the
    // detection): never looked up in the catalogue.
    const detectionsToEnrich = detections.filter(
      (d) =>
        !d.fixedVersion &&
        d.vulnerability &&
        !isImportedAdvisoryView(d.vulnerability),
    );

    if (detectionsToEnrich.length === 0) {
      return detections; // Nothing to do, return early.
    }

    // 2. Fetch the primary OSV records WITH their aliases for the detections that need enrichment.
    const primaryVulnerabilityIds = [
      ...new Set(detectionsToEnrich.map((d) => d.vulnerability.id)),
    ];

    const primaryOsvWithAliases = await this.osvRepo.find({
      where: { id: In(primaryVulnerabilityIds) },
      relations: ['aliases'],
    });

    // 3. Collect ALL relevant vulnerability IDs: primary ones AND all their aliases.
    const allVulnerabilityIds = new Set<string>(primaryVulnerabilityIds);
    const primaryOsvMap = new Map<string, VulnerabilityOsv>(); // Map to store primary OSV with aliases

    for (const osv of primaryOsvWithAliases) {
      primaryOsvMap.set(osv.id, osv);
      osv.aliases?.forEach((alias) => allVulnerabilityIds.add(alias.alias));
    }

    // 4. Batch-fetch the full OSV data (with 'affected' relationships) for ALL collected IDs.
    //    Only the affected rows of the detections' own packages (name or
    //    source name, as findFixedVersionForPackage compares them).
    const packageNames = [
      ...new Set(
        detectionsToEnrich.flatMap((d) =>
          [d.detectedPackage?.packageName, d.detectedPackage?.srcName]
            .filter((name): name is string => !!name)
            .map((name) => name.toLowerCase()),
        ),
      ),
    ];
    const fullOsvRecords = packageNames.length
      ? await this.osvRepo
          .createQueryBuilder('v')
          .leftJoinAndSelect(
            'v.affected',
            'aff',
            'LOWER(aff.packageName) IN (:...packageNames)',
            { packageNames },
          )
          .leftJoinAndSelect('aff.ranges', 'rng')
          .leftJoinAndSelect('rng.events', 'evt')
          .where('v.id IN (:...ids)', { ids: Array.from(allVulnerabilityIds) })
          .getMany()
      : [];

    // 5. Create a map of all fetched records for fast access.
    const allOsvDataMap = new Map<string, VulnerabilityOsv>(
      fullOsvRecords.map((osv) => [osv.id, osv]),
    );

    // 6. Loop through the detections needing enrichment and find the fixed version.
    for (const detection of detectionsToEnrich) {
      const primaryOsvId = detection.vulnerability.id;
      let foundFixedVersion = '';

      // First, check the primary vulnerability record.
      const fullPrimaryOsv = allOsvDataMap.get(primaryOsvId);
      if (fullPrimaryOsv) {
        foundFixedVersion = findFixedVersionForPackage(
          fullPrimaryOsv,
          detection,
        );
      }

      // If not found, check all its aliases.
      if (!foundFixedVersion) {
        const primaryOsv = primaryOsvMap.get(primaryOsvId);
        const aliasIds = primaryOsv?.aliases?.map((a) => a.alias) ?? [];

        for (const aliasId of aliasIds) {
          const fullAliasOsv = allOsvDataMap.get(aliasId);
          if (fullAliasOsv) {
            foundFixedVersion = findFixedVersionForPackage(
              fullAliasOsv,
              detection,
            );
            if (foundFixedVersion) {
              break; // Stop searching once we find a fix.
            }
          }
        }
      }

      if (foundFixedVersion) {
        detection.fixedVersion = foundFixedVersion;
      }
    }

    return detections;
  }
  /**
   * Enriches a list of detections with their full severity details for accurate CVSS mapping.
   * This method is optimized to run quickly on paginated results.
   *
   * @param detections The list of detections to enrich.
   * @returns The same list, with the `vulnerability.severities` property populated.
   */
  private async enrichDetectionsWithSeverities(
    detections: VulnerabilityDetectionsContainer[],
  ): Promise<VulnerabilityDetectionsContainer[]> {
    if (detections.length === 0) {
      return detections;
    }
    // An imported advisory keeps the severities its import declared.
    const vulnerabilityIds = [
      ...new Set(
        detections
          .filter((d) => !isImportedAdvisoryView(d.vulnerability))
          .map((d) => d.vulnerability?.id)
          .filter(Boolean),
      ),
    ];

    if (vulnerabilityIds.length === 0) {
      return detections;
    }

    // 1. First, load the vulnerabilities' own severities
    const directSeverities = await this.osvRepo.manager.find(
      VulnerabilityOsvSeverity,
      {
        where: { vulnerability: { id: In(vulnerabilityIds) } },
        relations: ['vulnerability'],
      },
    );

    const severitiesMap = new Map<string, VulnerabilityOsvSeverity[]>();
    for (const s of directSeverities) {
      const key = s.vulnerability.id;
      if (!severitiesMap.has(key)) {
        severitiesMap.set(key, []);
      }
      severitiesMap.get(key).push(s);
    }

    // 2. For vulnerabilities without their own severities, look in the aliases
    const vulnsWithoutSeverities = vulnerabilityIds.filter(
      (id) => !severitiesMap.has(id) || severitiesMap.get(id).length === 0,
    );

    if (vulnsWithoutSeverities.length > 0) {
      // Load the aliases of these vulnerabilities
      const vulnsWithAliases = await this.osvRepo.find({
        where: { id: In(vulnsWithoutSeverities) },
        relations: ['aliases'],
      });

      // Collect every alias id
      const aliasIds: string[] = [];
      const vulnToAliasMap = new Map<string, string[]>();
      for (const vuln of vulnsWithAliases) {
        const aliases = vuln.aliases?.map((a) => a.alias) ?? [];
        vulnToAliasMap.set(vuln.id, aliases);
        aliasIds.push(...aliases);
      }

      if (aliasIds.length > 0) {
        // Load the aliases' severities
        const aliasSeverities = await this.osvRepo.manager.find(
          VulnerabilityOsvSeverity,
          {
            where: { vulnerability: { id: In(aliasIds) } },
            relations: ['vulnerability'],
          },
        );

        // Map the alias severities to the main vulnerability
        const aliasSeveritiesMap = new Map<
          string,
          VulnerabilityOsvSeverity[]
        >();
        for (const s of aliasSeverities) {
          const key = s.vulnerability.id;
          if (!aliasSeveritiesMap.has(key)) {
            aliasSeveritiesMap.set(key, []);
          }
          aliasSeveritiesMap.get(key).push(s);
        }

        // Assign the alias severities to the main vulnerabilities
        for (const vulnId of vulnsWithoutSeverities) {
          const aliases = vulnToAliasMap.get(vulnId) ?? [];
          for (const aliasId of aliases) {
            const aliasSevs = aliasSeveritiesMap.get(aliasId);
            if (aliasSevs && aliasSevs.length > 0) {
              severitiesMap.set(vulnId, aliasSevs);
              break; // Utiliser les premières severities trouvées
            }
          }
        }
      }
    }

    for (const detection of detections) {
      if (detection.vulnerability) {
        if (isImportedAdvisoryView(detection.vulnerability)) continue;
        detection.vulnerability.severities =
          severitiesMap.get(detection.vulnerability.id) || [];
      }
    }
    return detections;
  }

  /**
   * Returns a paginated and filtered list of detected packages for a project.
   *
   * @param dto - The request containing pagination and filtering options.
   * @returns The paginated list of container packages.
   */
  @Span()
  async getProjectContainerPackages(
    dto: GetProjectScaVulnerabilitiesRequest,
  ): Promise<GetProjectPackagesResponse> {
    const {
      projectId,
      page = 1,
      limit: requestedLimit = 10,
      searchQuery,
      packageType,
      imageId,
    } = dto;
    // An explicit page size is clamped at 500 (silently).
    const limit = clampListPageSize(requestedLimit);

    const qb = this.pkgRepo
      .createQueryBuilder('pkg')
      .innerJoin('pkg.detectedImage', 'image')
      .where('pkg.projectId = :projectId', { projectId });

    if (imageId) {
      qb.andWhere('image.id = :imageId', { imageId });
    }

    if (searchQuery) {
      qb.andWhere(ilike('pkg.packageName', ':searchQuery').text, {
        searchQuery: `%${searchQuery}%`,
      });
    }

    if (packageType?.length > 0) {
      qb.andWhere('pkg.class IN (:...packageType)', { packageType });
    }

    qb.orderBy('pkg.packageName', 'ASC');

    const total = await qb.getCount();
    const packagesEntities = await qb
      .skip((page - 1) * limit)
      .take(limit)
      .getMany();

    const packages = packagesEntities.map((p) => ({
      id: p.id,
      projectId: p.projectId,
      packageName: p.packageName,
      packageVersion: p.packageVersion,
      fileName: p.target,
      ecosystem: p.class,
      isDev: false,
      isTransitive: false,
      path: [],
      importLocations: [],
      licenses: [],
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    }));

    return {
      projectId,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      packages,
    };
  }

  /**
   * Retrieves a specific container vulnerability by its ID, including its history and related entities.
   * This method now uses the unified enrichment pipeline to ensure data consistency with the list view.
   *
   * @param dto - The request containing the projectId and vulnerabilityId.
   * @returns The detailed container vulnerability information.
   */
  @Span()
  async getContainerVulnerabilityById(
    dto: GetProjectContainerVulnerabilityByIdRequest,
  ): Promise<GetProjectContainerVulnerabilityByIdResponse> {
    const { projectId, vulnerabilityId } = dto;

    // 1. Fetch the raw detection with all necessary relations for enrichment.
    // The query is powerful and fetches all potential data sources.
    const detectionRaw = await this.detRepo
      .createQueryBuilder('det')
      .where('det.id = :vulnerabilityId', { vulnerabilityId })
      .andWhere('det.projectId = :projectId', { projectId })
      .innerJoinAndSelect('det.detectedPackage', 'pkg')
      .leftJoinAndSelect('det.historyItems', 'historyItems')
      .leftJoinAndSelect('det.vulnerability', 'vulnerability')
      .getOne();

    if (!detectionRaw) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: `Container vulnerability not found in project`,
      });
    }
    // The advisory's collections: the project's own row when it imported
    // the advisory, else separate bounded reads of the catalogue.
    await this.applyProjectAdvisories(projectId, [detectionRaw]);
    if (
      detectionRaw.vulnerability &&
      !isImportedAdvisoryView(detectionRaw.vulnerability)
    ) {
      await this.loadCatalogueCollections(detectionRaw.vulnerability);
    }

    // 2. UNIFICATION: Use the exact same enrichment pipeline as the list view.
    // We pass an array with a single item and get an array back.
    const [detection] = await this.enrichDetectionsWithFixedVersions([
      detectionRaw,
    ]);

    // 3. Process history items: dedupe userIds and fire userService.getById
    // in parallel via Promise.allSettled. Replaces the serial nested loop.
    const uniqueUserIds = Array.from(
      new Set(
        (detection.historyItems || [])
          .map((h) => h.userId)
          .filter((uid): uid is string => !!uid),
      ),
    );
    const userMap = new Map<string, any>();
    if (uniqueUserIds.length > 0) {
      const results = await Promise.allSettled(
        uniqueUserIds.map((uid) =>
          safeGrpcCall(this.userServiceClient.getById({ userId: uid })),
        ),
      );
      results.forEach((res, i) => {
        userMap.set(
          uniqueUserIds[i],
          res.status === 'fulfilled' ? res.value : null,
        );
      });
    }
    const historyItemsWithUserDetails = (detection.historyItems || []).map(
      (historyItem) => ({
        ...historyItem,
        user: historyItem.userId
          ? (userMap.get(historyItem.userId) ?? null)
          : null,
        date: historyItem.date.toISOString(),
      }),
    );

    // 4. Map the fully enriched entity to the gRPC response object.
    const mappedDetection = mapDetectionEntity(detection, this.cvssExplainer);
    mappedDetection.historyItems = { items: historyItemsWithUserDetails };

    return {
      projectId: dto.projectId,
      vulnerabilityId: dto.vulnerabilityId,
      detection: mappedDetection,
      isProjectParsed: false,
    };
  }

  /**
   * Deletes a container image and all its associated data (packages, detections) for a given project.
   * The deletion of related packages and detections is handled automatically by the database
   * thanks to the `onDelete: 'CASCADE'` constraint on the entities.
   * @param req - The request containing the projectId and imageId.
   * @returns A response indicating the success of the operation.
   */
  @Span()
  async deleteContainerImage(
    req: DeleteContainerImageRequest,
  ): Promise<ProjectDeleteResponse> {
    const { projectId, imageId } = req;
    this.logger.log(
      `Attempting to delete container image ${imageId} for project ${projectId}.`,
    ); // 1. Find the image to ensure it exists and belongs to the specified project.

    const image = await this.imageRepo.findOneBy({
      id: imageId,
      projectId: projectId,
    });

    if (!image) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: `Container image with ID not found in project`,
      });
    } // 2. Remove the image. TypeORM will trigger the cascade deletion.

    await this.imageRepo.remove(image);

    this.logger.log(
      `Successfully deleted container image ${imageId} and its associated data.`,
    ); // 3. Return a success response.

    return {
      message: 'Container image and associated data deleted successfully.',
    };
  }

  private async upsertImage(
    req: ScanAddContainerResultRequest,
    branch?: string,
    imageId?: string,
  ): Promise<ContainerDetectedImage> {
    const { projectId, scanId, os, imageName } = req;
    const branchValue = branch || '';

    // Use imageName if provided, otherwise fallback to os.family + os.name
    const artifactDisplayName = imageName || `${os.family} ${os.name}`;
    // The scanner's EOSL flag only exists in Trivy's
    // vulnerability mode; in inventory mode the platform derives it from the
    // end-of-support table. Either source flags the image; an unknown release
    // falls back to what the scanner said.
    const derivedEosl = this.endOfLife
      ? await this.endOfLife.isOsEndOfLife(os?.family, os?.name)
      : isOsEndOfLife(os?.family, os?.name);
    const osEosl = (os?.eosl ?? false) || derivedEosl === true;

    // IMPORTANT: Include artifactName AND branch in the search criteria to distinguish
    // different container images that may share the same OS (e.g., two images
    // both using alpine 3.21.2 should be tracked separately per branch)
    let image = await this.imageRepo.findOne({
      where: {
        projectId,
        artifactName: artifactDisplayName,
        branch: branchValue,
      },
    });
    if (!image) {
      image = this.imageRepo.create({
        projectId,
        scanId,
        artifactName: artifactDisplayName,
        // An import names the image's id; a scan never does.
        imageId: imageId || '',
        osFamily: req.os?.family,
        osName: req.os?.name,
        // EOL base OS — advisories are no longer published for it.
        osEosl,
        branch: branchValue,
      });
    } else {
      // Update OS info in case it changed (e.g., image was rebuilt with new base)
      image.osFamily = req.os?.family ?? image.osFamily;
      image.osName = req.os?.name ?? image.osName;
      // Always refreshed: a rebuild onto a supported base must clear the flag.
      image.osEosl = osEosl;
      // Update scanId to track the latest scan
      image.scanId = scanId;
      if (imageId) image.imageId = imageId;
    }
    return this.imageRepo.save(image);
  }

  private async upsertPackage(
    image: ContainerDetectedImage,
    scanId: string,
    pkgDto: ContainerPackage,
    context: { target: string; class: string },
  ): Promise<ContainerDetectedPackage> {
    // 1. Define the search criteria for the `findOne` query.
    // We use TypeORM's IsNull() operator for the 'where' clause.
    const searchCriteria = {
      projectId: image.projectId,
      packageName: pkgDto.name,
      packageVersion: pkgDto.version,
      target: context.target,
      class: context.class,
      arch: pkgDto.arch || IsNull(),
    };

    let entity = await this.pkgRepo.findOne({ where: searchCriteria });

    // 2. Define the complete data object for the entity.
    // Here, we use a standard `null` for the 'arch' property if it's missing.
    const packageData = {
      projectId: image.projectId,
      packageName: pkgDto.name,
      packageVersion: pkgDto.version,
      target: context.target,
      class: context.class,
      arch: pkgDto.arch || null,
      detectedImage: image,
      srcName: pkgDto.srcName,
      srcVersion: pkgDto.srcVersion,
      // Persisted so the zero-day retro-match can compare deb/rpm
      // packages after the scan (the DTO is gone by then).
      fullVersion: pkgDto.fullVersion || null,
      srcFullVersion: pkgDto.srcFullVersion || null,
      digest: pkgDto.digest,
      licenses: JSON.stringify(pkgDto.licenses ?? []),
      dependsOn: pkgDto.dependsOn ?? [],
    };

    if (!entity) {
      // 3. Use the clean data object for the `create` method.
      entity = this.pkgRepo.create(packageData);
    } else {
      // 4. If found, update the existing entity with the new data to ensure it's fresh.
      Object.assign(entity, packageData);
    }

    // 5. Always update the lastScanId to mark it as "seen" in this scan.
    entity.lastScanId = scanId;

    return this.pkgRepo.save(entity);
  }

  private async findOsvVulnerabilityByIdentifier(
    identifier: string,
  ): Promise<VulnerabilityOsv | null> {
    if (!identifier) return null;

    return this.osvRepo
      .createQueryBuilder('v')
      .leftJoinAndSelect('v.aliases', 'alias')
      .leftJoinAndSelect('v.severities', 'severities')
      .leftJoinAndSelect('v.references', 'references')
      .leftJoinAndSelect('v.affected', 'affected')
      .leftJoinAndSelect('affected.ranges', 'ranges')
      .leftJoinAndSelect('ranges.events', 'events')
      .where('v.id = :identifier OR alias.alias = :identifier', { identifier })
      .getOne();
  }

  /**
   * Find-then-insert is not atomic under the worker pool. When the
   * insert loses the race on the fingerprint UNIQUE, the row now exists, so a
   * second pass takes the update branch instead of failing the batch.
   */
  private async upsertDetection(
    projectId: string,
    image: ContainerDetectedImage,
    pkg: ContainerDetectedPackage,
    osvStub: VulnerabilityOsv,
    vulnDto: ContainerVulnerability,
    branch?: string,
    source: ContainerDetectionSource = 'scanner',
  ): Promise<VulnerabilityDetectionsContainer> {
    try {
      // Inside a transaction, a savepoint: the refused insert leaves it usable
      // on PostgreSQL, for the second pass below.
      return await withinSavepoint(this.detRepo.manager, () =>
        this.upsertDetectionOnce(
          projectId,
          image,
          pkg,
          osvStub,
          vulnDto,
          branch,
          source,
        ),
      );
    } catch (error) {
      if (!isDuplicateEntryError(error)) throw error;
      return this.upsertDetectionOnce(
        projectId,
        image,
        pkg,
        osvStub,
        vulnDto,
        branch,
        source,
      );
    }
  }

  private async upsertDetectionOnce(
    projectId: string,
    image: ContainerDetectedImage,
    pkg: ContainerDetectedPackage,
    osvStub: VulnerabilityOsv,
    vulnDto: ContainerVulnerability,
    branch?: string,
    source: ContainerDetectionSource = 'scanner',
  ): Promise<VulnerabilityDetectionsContainer> {
    // Build where clause with optional branch filter
    const whereClause: any = {
      vulnerability: { id: osvStub.id },
      detectedPackage: { id: pkg.id },
      projectId,
    };
    if (branch) {
      whereClause.branch = branch;
    }

    let det = await this.detRepo.findOne({
      where: whereClause,
    });

    // SHADOW MODE: written on create, recomputed (but never overwritten) on
    // re-detection so the release produces divergence evidence for this family
    // too. The inputs mirror the row's own identity — the package coordinates
    // upsertPackage keys on, plus the advisory — so in the steady state the
    // recomputed value MUST equal the stored one; a FINGERPRINT_MISMATCH here
    // is a real alarm, not expected churn.
    //
    // That is why `image` is NOT an input, even though it is right there in the
    // signature. Neither this row nor its package row is keyed on the image
    // (whereClause below is {vulnerability, detectedPackage, projectId,
    // branch}; upsertPackage's is {projectId, packageName, packageVersion,
    // target, class, arch}), so for class='lang-pkgs' — where the Trivy target
    // is a manifest path inside the image — two images of one project share
    // this single row. Hashing the CURRENT scan's image would give that one row
    // two digests and log a mismatch on every alternating scan of unchanged
    // code, i.e. manufacture exactly the churn the paragraph above forbids.
    // Reading it off the row instead is no better: `det.detectedImage = image`
    // below re-points it at the latest scan. See ContainerFingerprintInput.
    //
    // The branch component comes from the ROW whenever there is a row, never
    // from the scan. `branch` is legitimately undefined when the getScan call
    // fails (this service only warns and carries on), and the whereClause above
    // adds `branch` only when it is truthy — so a branchless scan re-finds a
    // row created with branch='main'. Recomputing that row's digest from the
    // scan would contradict its own `branch` column: a false
    // FINGERPRINT_MISMATCH on every such scan, or a backfilled digest that
    // breaks the planned UNIQUE (projectId, branch, fingerprint). On create the
    // component mirrors what is actually written below — `branch` when truthy,
    // NULL otherwise.
    const fingerprintBranch = det ? (det.branch ?? null) : branch || null;
    const expectedFingerprint = computeContainerFingerprint({
      projectId,
      branch: fingerprintBranch,
      packageName: pkg.packageName,
      packageVersion: pkg.packageVersion,
      target: pkg.target ?? null,
      class: pkg.class ?? null,
      arch: pkg.arch ?? null,
      vulnerabilityIdentifier: vulnDto.vulnerabilityId,
    });

    // --- DATA SOURCE OF TRUTH SHIFT ---
    // We now trust the scanner's DTO for severity, priority, and CVSS score.
    const severity = vulnDto.severity.toUpperCase();
    const cveIdentifier = vulnDto.vulnerabilityId;

    let score = 0;
    if (vulnDto.cvss) {
      const cvssKeys = Object.keys(vulnDto.cvss);
      if (cvssKeys.length > 0) {
        const firstCvssInfo = vulnDto.cvss[cvssKeys[0]];
        score = firstCvssInfo?.v3Score ?? firstCvssInfo?.v2Score ?? 0;
      }
    }

    // Compute CVSS4 vector and base score
    let cvss3Vector: string | null = null;
    if (vulnDto.cvss) {
      const cvssKeys = Object.keys(vulnDto.cvss);
      if (cvssKeys.length > 0) {
        const firstCvssInfo = vulnDto.cvss[cvssKeys[0]];
        cvss3Vector = firstCvssInfo?.v3Vector || null;
      }
    }
    const cvss4Result = this.cvssCalculator.computeCvss4Base({
      cvss3Vector,
      severity,
    });

    // Apply project security context to compute env score + vector.
    // Falls back to base when no context exists for the project. A finding
    // with no CVSS gets the default vector of the scanner's label; that
    // vector is left as it is, so the label is the severity shown.
    let envScore: number | null = cvss4Result?.baseScore ?? null;
    let envVector: string | null = null;
    if (cvss4Result?.vector && cvss4Result.source !== 'severity') {
      const envResult = await this.resultService.computeEnvironmentalForProject(
        projectId,
        cvss4Result.vector,
      );
      if (envResult) {
        envScore = envResult.environmentalScore;
        envVector = envResult.fullVector;
      }
    }

    const exploitResult = computeStaticExploitability({ reachability: null });
    const priorityResult = await this.resultService.recalculatePriority(
      {
        cvss4EnvironmentalScore: envScore,
        cvss4BaseScore: cvss4Result?.baseScore ?? null,
        currentSeverity: severity,
        epssScore: null,
        epssPercentile: null,
        exploitabilityScore: exploitResult.score,
        priorityManualOverride: false,
      },
      projectId,
    );
    const priority =
      priorityResult?.priority ?? this.mapSeverityToPriority(severity);

    if (!det) {
      // This detection is genuinely new for this package.
      det = this.detRepo.create({
        projectId,
        detectedImage: image,
        detectedPackage: pkg,
        vulnerability: osvStub, // Link to the stub entity
        vulnerabilityIdentifier: cveIdentifier,
        fixedVersion: vulnDto.fixedVersion, // Use the scanner's fixedVersion
        currentState: 'to_verify',
        currentSeverity: severity,
        currentPriority: priority,
        priorityScore: priorityResult?.priorityScore ?? null,
        cvssScore: score,
        cvss4Vector: cvss4Result?.vector ?? null,
        cvss4BaseScore: cvss4Result?.baseScore ?? null,
        cvss4EnvironmentalScore: envScore,
        effectiveSeverity: deriveEffectiveSeverity(
          envScore,
          cvss4Result?.baseScore ?? null,
        ),
        cvss4EnvironmentalVector: envVector,
        exploitabilityVerdict: exploitResult.verdict,
        exploitabilityScore: exploitResult.score,
        exploitabilityReason: exploitResult.reason,
        exploitabilitySource: 'static' as const,
        exploitabilityUpdatedAt: new Date(),
        detectionSource: source,
        // SHADOW MODE: written, never read for matching yet.
        fingerprint: expectedFingerprint,
        ...(branch ? { branch } : {}),
      });
    } else {
      // SHADOW MODE evidence for the container family: log any divergence
      // between the stored digest and the one this scan would compute, and
      // backfill a row that predates the column. Never overwrite a stored
      // value — that would hide the very drift being measured.
      if (det.fingerprint && det.fingerprint !== expectedFingerprint) {
        this.logger.warn(
          `FINGERPRINT_MISMATCH det=${det.id} stored=${det.fingerprint} computed=${expectedFingerprint}`,
        );
      }
      det.fingerprint = det.fingerprint ?? expectedFingerprint;

      // This detection already existed. We update it.
      det.detectedImage = image; // Update to point to the latest scan's image
      det.fixedVersion = vulnDto.fixedVersion; // Always update with the latest info

      const resolvedStates = ['resolved', 'completed'];
      if (resolvedStates.includes(det.currentState)) {
        det.currentState = 'to_verify';
        // A reappearing finding always wins the lifecycle: the (now stale)
        // freeze on a manual `resolved` is dropped so the scan manages it
        // again. Same rule as sca.service's `existingWasResolved`.
        det.stateManuallyModified = false;
        // Open again: the resolution date no longer holds. This is not a
        // triage — nobody decided anything — so the actor fields are untouched.
        clearResolutionOnRevive(det);
        await this.saveHistory(det, 're-opened', 'system');
      }

      det.currentSeverity = severity;
      det.currentPriority = priority;
      det.priorityScore = priorityResult?.priorityScore ?? det.priorityScore;
      det.vulnerabilityIdentifier = cveIdentifier;
      det.cvssScore = score;
      det.cvss4Vector = cvss4Result?.vector ?? det.cvss4Vector;
      det.cvss4BaseScore = cvss4Result?.baseScore ?? det.cvss4BaseScore;
      det.cvss4EnvironmentalScore = envScore ?? det.cvss4EnvironmentalScore;
      det.effectiveSeverity = deriveEffectiveSeverity(
        det.cvss4EnvironmentalScore ?? null,
        det.cvss4BaseScore ?? null,
      );
      det.cvss4EnvironmentalVector = envVector;
      det.updatedAt = new Date();
      // The scanner's own report is the stronger evidence: it relabels an
      // OSV-matched row, never the other way round.
      if (source === 'scanner') det.detectionSource = 'scanner';
    }

    // Container findings have no `vulnerability_detection_history` rows (the
    // table carries no container FK), so this upsert IS the family's sighting
    // funnel — both branches above converge here.
    applySightingToDetection(det, new Date());

    return this.detRepo.save(det);
  }

  private async saveHistory(
    det: VulnerabilityDetectionsContainer,
    value: string,
    source?: 'system',
  ) {
    const hist = this.histRepo.create({
      type: 'status_change',
      value: value,
      date: new Date(),
      // Scan-driven rows carry no userId. Saying 'system' out loud is what
      // stops that null reading as "unknown user" downstream.
      ...(source ? { source } : {}),
      containerVulnerabilityDetection: det,
    });
    await this.histRepo.save(hist);
  }

  private async markMissingPackagesResolved(
    image: ContainerDetectedImage,
    scanId: string,
    branch?: string,
  ) {
    const packagesNotSeenInScan = await this.pkgRepo.find({
      where: { detectedImage: { id: image.id }, lastScanId: Not(scanId) },
    });
    for (const pkg of packagesNotSeenInScan) {
      // Build where clause with optional branch filter
      const detectionWhere: any = {
        detectedPackage: { id: pkg.id },
        currentState: Not('resolved'),
      };
      if (branch) {
        detectionWhere.branch = branch;
      }

      const detectionsToResolve = await this.detRepo.find({
        where: detectionWhere,
      });
      let resolved = 0;
      for (const det of detectionsToResolve) {
        // The auto-resolve is a LIFECYCLE write since the GRC columns landed: it
        // overwrites triaged_by / triaged_by_type / dismissal_reason with the
        // machine's own. A dismissal closed here would lose its reason for good
        // (this family has no ingestion trail), so `ignored` is left alone. A
        // confirm closes: its actor stays on the status_change row it wrote.
        if (!shouldAutoResolveOnDisappearance(det)) {
          continue;
        }
        det.currentState = 'resolved';
        // The scan resolved this, not a person; see the SCA/SAST equivalents.
        applyTriageToDetection(
          det,
          { status: 'resolved' },
          new Date(),
          'system',
        );
        await this.detRepo.save(det);
        await this.saveHistory(det, 'resolved', 'system');
        resolved++;
      }
      this.logger.log(
        `${resolved}/${detectionsToResolve.length} detections for package ` +
          `${pkg.packageName}@${pkg.packageVersion} marked as resolved as package ` +
          `is no longer detected; the rest are dismissed and stay ignored.`,
      );
    }
  }

  private getHighestSeverityFromOsv(osv: VulnerabilityOsv): string {
    const score = calculateOsvCvssScore(osv);
    if (score >= 9.0) return 'CRITICAL';
    if (score >= 7.0) return 'HIGH';
    if (score >= 4.0) return 'MEDIUM';
    if (score > 0) return 'LOW';
    const specificSeverity = osv.severities?.find(
      (s) => s.type === 'DATABASE_SPECIFIC',
    );
    if (specificSeverity?.score) {
      const severityString = specificSeverity.score.toUpperCase();
      if (['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].includes(severityString)) {
        return severityString;
      }
    }
    return 'MEDIUM';
  }

  private mapSeverityToPriority(severity: string): string {
    switch (severity.toUpperCase()) {
      case 'CRITICAL':
        return 'critical_urgent';
      case 'HIGH':
        return 'urgent';
      case 'MEDIUM':
        return 'normal';
      case 'LOW':
        return 'low';
      default:
        return 'very_low';
    }
  }
}
