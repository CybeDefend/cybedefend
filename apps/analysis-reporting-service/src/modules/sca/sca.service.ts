// analysis-reporting-service/src/modules/sca/sca.service.ts
// License support v3

import { rawIdent } from 'src/core/db/raw-sql';
import { scaFixAvailableExistsSql } from '../result/autofix-exists-sql';
import {
  forwardRef,
  Inject,
  Injectable,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { deriveEffectiveSeverity } from 'src/modules/cvss/severity-from-cvss';
import { computeScaFingerprint } from '../findings-export/fingerprint.util';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { Logger } from 'nestjs-pino';
import {
  columnType,
  ilike,
  isDeadlock,
  isUniqueViolation,
  jsonArrayLength,
} from '@cybedefend/db-dialect';
import { withinSavepoint } from 'src/core/db/within-savepoint';
import {
  DataSource,
  EntityTarget,
  Not,
  QueryDeepPartialEntity,
  Repository,
  In,
} from 'typeorm';
import { ClientGrpc, RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { Span } from 'nestjs-otel';

// --- GRPC DTO Imports ---
import {
  ScanAddScaResultRequest,
  ScanAddScaResultResponse,
  GetProjectPackagesResponse,
  GetProjectScaVulnerabilitiesRequest,
  GetProjectScaVulnerabilitiesResponse,
  GetProjectVulnerabilityByIdResponse,
  ScanProjectInfo,
  HistoryItem as HistoryItemInterface,
  VulnerabilitySca,
  UpdateResultRequest,
  GetProjectLicenseSummaryResponse,
  LicenseSummaryItem,
  GetScaFilterOptionsRequest,
  GetScaFilterOptionsResponse,
  Library,
} from '@grpc/analysis-reporting/result';
import {
  PROJECT_SERVICE_NAME,
  ProjectServiceClient,
  USER_SERVICE_NAME,
  UserServiceClient,
} from '@grpc/global-management/global_management';
import { ProjectInformationsResponse } from '@grpc/global-management/project';
import { findCybeAnalysedDetectionIds } from '../result/cybe-analysed-detections.helper';
import { clampListPageSize } from '../result/list-page-size.util';
import { emptyAutofixCountByType } from '../result/slim-list.util';
import {
  SCAN_SERVICE_NAME,
  ScanServiceClient,
} from '@grpc/security-scanning/security_scanning';

// --- Local Entity Imports ---
import { HistoryItem } from 'src/entities/history-item.entity';
import { ScaDetectedPackages } from 'src/entities/sca-detected-packages.entity';
import { ScaVulnerabilityDetections } from 'src/entities/sca-vulnerability-detections.entity';
import { VulnerabilityDetectionHistory } from 'src/entities/vulnerability-detection-history.entity';
import { VulnerabilityOsvAffected } from 'src/entities/osv';
import { ScaLicenseOverride } from 'src/entities/sca-license-override.entity';

// --- Service & Utility Imports ---
import {
  Cvss4BaseResult,
  CvssCalculatorService,
} from '../cvss/cvss-calculator.service';
import { effectiveSeveritySql } from '../cvss/effective-severity-sql';
import { computeScaStaticExploitability } from './sca-static-exploitability';
import {
  VERDICT_TO_SCORE,
  verdictToScore,
} from '../cvss/static-exploitability';
import {
  ADVISORY_MATCHER,
  AdvisoryMatcher,
} from '../../edition/ports/advisory-matcher.port';
import {
  DETECTION_ENRICHERS,
  DetectionEnricher,
} from '../../edition/ports/detection-enrichers.port';
import { ScannedLibrary } from './scanned-library';
import {
  applyMalwareOverrides,
  isMalwareAdvisory,
  MALWARE_EPSS_PERCENTILE,
  MALWARE_EPSS_SCORE,
  MALWARE_EXPLOITABILITY_SCORE,
} from './malware.util';
import {
  ACTIVE_VULN_STATES,
  DEFAULT_SCORING_BRANCHES,
} from '../cyber-risk/cyber-risk.constants';
import {
  calculateCvssScoreFromSeverityArray,
  calculateOsvCvssScore,
  getMinFixedAbove,
  capImportLocations,
} from './sca.utils';
import {
  mapScaPackageEntityToInterface,
  mapScaDetectionEntityToInterface,
  mapScaDetectionEntityToListInterface,
} from './sca.mapper';
import { CvssExplainerService } from '../cvss/cvss-explainer.service';
import { ResultService } from '../result/result.service';
import { CyberiskRecomputeEnqueuer } from '../cyber-risk/cyberisk-recompute.enqueuer';
import {
  ReferenceBranchResolver,
  scoringBranchesFromProject,
} from '../cyber-risk/reference-branch.resolver';
import { ProjectOrgResolver } from '../../core/realtime/project-org-resolver.service';
import {
  lookupProjectWithScaBranches,
  resolveScaEffectiveBranches,
} from './sca-branch.util';
import {
  hasParsedBranch,
  projectWithDefaultBranchRequest,
} from '../../core/utils/project-read.util';
import { applyPriorityFilter } from '../result/priority-filter.helper';
import { applyAgentAuditFields } from '../result/agent-audit.helper';
import {
  applySightingToDetection,
  applyTriageToDetection,
  assertDismissalReason,
  clearResolutionOnRevive,
  mergeDetectionTriage,
  shouldAutoResolveScaOnDisappearance,
} from '../findings-export/lifecycle.util';
import { applyExploitabilityVerdictFilter } from '../result/exploitability-verdict-filter.helper';
import { clearExploitabilityFields } from '../result/exploitability-reset.util';
import { safeGrpcCall } from '@grpc/wrapper-grpc.module';
import {
  readScanRecordMeta,
  ScaProjectContext,
  ScanMetaCache,
} from '../scan-queue/scan-meta-cache.service';
import {
  IssueIntegrationService,
  projectIssueSettingsOf,
} from '../vulnerability/issue-integration.service';
import {
  getLicenseInfo,
  getHighestRiskCategory,
  LicenseCategory,
  getAllKnownLicenses,
} from './license.utils';
import { getEffectiveLicenses } from './spdx-expression.utils';

/**
 * Configuration for batch processing SCA packages
 */
/** The scan an ingestMatched call writes for. */
export interface ScaScanMeta {
  projectId: string;
  scanId: string;
  /** The severity CSV, as ScanAddScaResultRequest.vulnerability_type. */
  vulnerabilityType: string;
}

/** One scanned package and the advisories already matched to it. */
export interface ScaMatchedItem {
  library: Library;
  affected: VulnerabilityOsvAffected[];
}

interface BatchProcessingConfig {
  /** Packages per multi-row upsert (a scanner batch, 50) */
  batchSize: number;
  /** Yield to event loop every N packages */
  yieldEvery: number;
}

/** IN-list size of the SELECT that reads a batch's upserted packages back. */
const SCA_PACKAGE_SELECT_CHUNK = 500;

/** Rows per grouped write: UPDATE / DELETE by ids, multi-row INSERT. */
const SCA_WRITE_CHUNK = 500;

/**
 * What the scan's auto-resolve writes on a detection: the state, and the
 * fields `applyTriageToDetection` stamps for a `resolved` decision by the
 * machine (`sca.bulk-writes.spec.ts` pins the two lists together).
 */
const AUTO_RESOLVE_FIELDS = [
  'currentState',
  'triagedAt',
  'triagedBy',
  'triagedByType',
  'resolvedAt',
  'dismissalReason',
] as const;

type AutoResolveFields = Pick<
  ScaVulnerabilityDetections,
  (typeof AUTO_RESOLVE_FIELDS)[number]
>;

/**
 * The domain on which JS case folding is the equality of
 * `utf8mb4_0900_ai_ci`: printable ASCII (no ignorable character, no
 * contraction, NO PAD).
 */
const PRINTABLE_ASCII = /^[\x20-\x7e]*$/;

/**
 * A package whose stored import locations (a JSON array written as text) hold
 * at least one entry. Read in a query builder on the `pkg` alias. The column
 * is `text` on both engines: MySQL's JSON_LENGTH parses it, PostgreSQL's
 * jsonb_array_length needs the cast, so the cast is written on both.
 */
export const HAS_IMPORT_LOCATIONS_SQL = `${
  jsonArrayLength(`CAST(pkg.importLocations AS ${String(columnType('json'))})`)
    .text
} > 0`;

/**
 * Whether a scope is the main/master fallback of `scopingBranchesFor`, i.e.
 * the project read named neither a reference branch nor a git default
 * branch. A named branch always yields a single-branch scope.
 */
function isFallbackScope(scoringBranches: readonly string[]): boolean {
  return (
    scoringBranches.length === DEFAULT_SCORING_BRANCHES.length &&
    scoringBranches.every((branch, i) => branch === DEFAULT_SCORING_BRANCHES[i])
  );
}

@Injectable()
export class ScaService implements OnModuleInit {
  private scanServiceClient!: ScanServiceClient;
  private projectServiceClient!: ProjectServiceClient;
  private userServiceClient!: UserServiceClient;

  /** Default batch processing configuration - tuned for responsiveness */
  private readonly batchConfig: BatchProcessingConfig = {
    batchSize: 50,
    yieldEvery: 2,
  };

  constructor(
    @InjectRepository(ScaDetectedPackages)
    private readonly scaDetectedRepo: Repository<ScaDetectedPackages>,
    @InjectRepository(ScaVulnerabilityDetections)
    private readonly scaVulnDetectRepo: Repository<ScaVulnerabilityDetections>,
    @InjectRepository(VulnerabilityDetectionHistory)
    private readonly vulnHistoryRepo: Repository<VulnerabilityDetectionHistory>,
    @InjectRepository(HistoryItem)
    private readonly historyItemRepo: Repository<HistoryItem>,
    @InjectRepository(ScaLicenseOverride)
    private readonly licenseOverrideRepo: Repository<ScaLicenseOverride>,
    private readonly logger: Logger,
    private readonly cvssCalculator: CvssCalculatorService,
    @Inject(forwardRef(() => ResultService))
    private readonly resultService: ResultService,
    @Inject(forwardRef(() => IssueIntegrationService))
    private readonly issueIntegrationService: IssueIntegrationService,
    @Inject('GLOBAL_MANAGEMENT_SERVICE')
    private readonly globalManagementClient: ClientGrpc,
    @Inject('SECURITY_SCANNING_SERVICE')
    private readonly securityScanningClient: ClientGrpc,
    private readonly cvssExplainer: CvssExplainerService,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly cyberiskEnqueuer: CyberiskRecomputeEnqueuer,
    private readonly referenceBranchResolver: ReferenceBranchResolver,
    private readonly projectOrgResolver: ProjectOrgResolver,
    // The scan's branch read once per scan, not per batch.
    // Optional for the unit-test modules; without it every batch reads
    // GetScan, as before.
    @Optional()
    private readonly scanMetaCache?: ScanMetaCache,
    // Advisory matching and detection enrichment are optional
    // tokens only ee supplies (the OSV matcher, EPSS). Absent — the Community
    // Edition — a batch stores its packages, matches nothing, enriches nothing.
    @Optional()
    @Inject(ADVISORY_MATCHER)
    private readonly advisoryMatcher?: AdvisoryMatcher,
    @Optional()
    @Inject(DETECTION_ENRICHERS)
    private readonly enrichers?: DetectionEnricher[],
  ) {}

  onModuleInit() {
    this.projectServiceClient =
      this.globalManagementClient.getService<ProjectServiceClient>(
        PROJECT_SERVICE_NAME,
      );
    this.userServiceClient =
      this.globalManagementClient.getService<UserServiceClient>(
        USER_SERVICE_NAME,
      );
    this.scanServiceClient =
      this.securityScanningClient.getService<ScanServiceClient>(
        SCAN_SERVICE_NAME,
      );
  }

  /**
   * The scan's branch, '' when it has none or when the scan record cannot be
   * read (logged; nothing is cached then, the next batch reads it again).
   * Read once per scan through the ScanMetaCache.
   */
  private async readScanBranch(scanId: string): Promise<string> {
    try {
      const meta = await readScanRecordMeta(this.scanMetaCache, scanId, () =>
        safeGrpcCall(this.scanServiceClient.getScan({ scanId })),
      );
      return meta?.branch || '';
    } catch (e) {
      this.logger.warn(
        `Could not retrieve branch for scan ${scanId}: ${(e as Error).message}`,
      );
      return '';
    }
  }

  /**
   * What this worker reads of the project for a scan: the
   * branch scope of the triage carry-over and of the finalization,
   * the reachability flags and the issue settings. The batches of a scan
   * share one lean ProjectService/Get through the ScanMetaCache (every batch
   * used to read it); destructive writes read the project afresh.
   *
   * - `fresh`: never served from nor written to the cache. Used by the
   *   finalization (it deletes packages, resolves findings and closes issues)
   *   and by a tranche that resolves findings, for the issues it closes: they
   *   work on the project as it is now, not on the copy the first batch took.
   * - A scope that fell back to main/master (no reference branch, no git
   *   default branch) is used but not cached: global-management answers an
   *   empty defaultBranch when it cannot reach the integration status, and
   *   such a degraded read cannot be told from a project without a branch.
   *   Those projects read the project once per batch, as before.
   *
   * Gets per scan of N batches: 1 for the batches (a floor: the first batches
   * of a scan run concurrently and each may miss the cache before one writes
   * it, 2 to 4 in practice), N when the scope fell back; plus 1 for the
   * finalization, plus 1 per tranche that resolves findings.
   *
   * The integration status stays in the read: the scope reads defaultBranch.
   * Null when the project cannot be read (logged); nothing is cached then,
   * and the next batch reads it again.
   */
  private async readProjectContext(
    projectId: string,
    scanId: string,
    { fresh = false }: { fresh?: boolean } = {},
  ): Promise<ScaProjectContext | null> {
    const load = async (): Promise<ScaProjectContext | null> => {
      const project = await safeGrpcCall(
        this.projectServiceClient.get(
          projectWithDefaultBranchRequest(projectId),
        ),
      );
      if (!project) return null;
      return {
        scoringBranches: scoringBranchesFromProject(project),
        reachabilityPriorityEnabled:
          project.scaReachabilityPriorityEnabled ?? true,
        reachabilityStatusEnabled: project.scaReachabilityStatusEnabled ?? true,
        issueSettings: projectIssueSettingsOf(projectId, project),
      };
    };
    try {
      return this.scanMetaCache && !fresh
        ? await this.scanMetaCache.getOrLoad(scanId, 'scaProject', load, {
            // Keyed by scan id alone: never another project's context.
            accept: (context) => context.issueSettings.projectId === projectId,
            store: (context) => !isFallbackScope(context.scoringBranches),
          })
        : await load();
    } catch (e) {
      this.logger.warn(
        `Could not retrieve project settings for ${projectId}: ${(e as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Yield back to the Node.js event loop to let other I/O proceed.
   * Useful when processing large batches to avoid starving other RPC calls.
   */
  private yieldToEventLoop(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve));
  }

  /**
   * Delay for a specified number of milliseconds.
   * Used to add breathing room between queue item processing.
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Resolves the set of SCA branch partitions that make up the single
   * logical branch for a project + raw branch. The empty-string partition ('')
   * — produced by no-branch scans and the legacy column default — is folded
   * into the project's canonical default/scoring branch, while real feature
   * branches stay strictly scoped to themselves. Shared by the resolver and the
   * three read paths so finalization, vulns, packages and licences never
   * disagree on which partition is "the default branch".
   *
   * Resilient by design: `ReferenceBranchResolver.getScoringBranches` swallows
   * lookup failures and falls back to the main/master scoring branches.
   */
  private async getScaEffectiveBranches(
    projectId: string,
    rawBranch?: string | null,
  ): Promise<string[]> {
    const scoringBranches =
      await this.referenceBranchResolver.getScoringBranches(projectId);
    return resolveScaEffectiveBranches(scoringBranches, rawBranch);
  }

  /**
   * Legacy method for backward compatibility.
   * When BullMQ is enabled, this is only called directly for immediate processing.
   * @deprecated Use BullMQ queue via ScanQueueService instead
   */
  async addScaScanResult(
    dto: ScanAddScaResultRequest,
  ): Promise<ScanAddScaResultResponse> {
    // Direct processing - used when not going through BullMQ
    return this.processScaBatch(dto);
  }

  /**
   * Process a SCA scan batch. Called by the BullMQ processor.
   * When isLastRequest is true, runs finalization to mark missing packages as resolved.
   *
   * @param dto The SCA scan request
   * @returns Processing result
   */
  @Span()
  async processScaBatch(
    dto: ScanAddScaResultRequest,
  ): Promise<ScanAddScaResultResponse> {
    const { projectId, scanId, packages, isLastRequest } = dto;
    const startTime = Date.now();

    this.logger.log(
      `[SCA] Processing batch for project=${projectId}, scan=${scanId}, isLast=${isLastRequest}, packagesCount=${packages.length}`,
    );

    const { touchedDetectionIds, branch } = await this.ingestPackages(
      { projectId, scanId, vulnerabilityType: dto.vulnerabilityType },
      packages,
      (rows) => this.batchFindVulnerabilities(rows),
    );

    // Run finalization when isLastRequest is true
    if (isLastRequest) {
      this.logger.log(
        `scan=${scanId}: isLastRequest=true, running finalization...`,
      );
      await this.removeMissingLibs(
        projectId,
        scanId,
        branch,
        // Finalized on the project as it is now (see readProjectContext).
        await this.readProjectContext(projectId, scanId, { fresh: true }),
      );
    }

    // Fire-and-forget: enrich newly created/updated SCA detections with EPSS
    // scores so they don't have to wait for the next daily cron run. Failure
    // must not block scan ingestion — we just warn and move on.
    // Each bound enricher (EPSS in the cloud, none in the Community
    // Edition) runs the same way.
    if (touchedDetectionIds.length > 0) {
      for (const e of this.enrichers ?? []) {
        e.enrichDetections({ detectionIds: touchedDetectionIds }).catch((err) =>
          this.logger.warn(
            `[SCA] ${e.name} enrichment failed for scan ${scanId}: ${(err as Error)?.message ?? err}`,
          ),
        );
      }
    }

    const duration = Date.now() - startTime;
    this.logger.log(
      `scan=${scanId}: SCA batch processing completed for project ${projectId} in ${duration}ms.`,
    );

    return {
      projectId,
      scanId,
      message: `SCA batch processed successfully (${packages.length} packages).`,
    };
  }

  /**
   * The SCA write path of a scanner batch — the package upsert, the
   * detections, the fingerprint, the triage carry-over and the history —
   * given advisories a caller already matched (an import). No matching,
   * no finalization, no enrichment. Returns the touched detection ids.
   */
  @Span()
  async ingestMatched(
    scanMeta: ScaScanMeta,
    items: ScaMatchedItem[],
  ): Promise<string[]> {
    const keyOf = (name: string | undefined, version: string | undefined) =>
      `${(name || '').toLowerCase().trim()}@${version}`;
    const affectedByKey = new Map<string, VulnerabilityOsvAffected[]>();
    for (const item of items) {
      const key = keyOf(item.library.name, item.library.version);
      affectedByKey.set(key, [
        ...(affectedByKey.get(key) ?? []),
        ...(item.affected ?? []),
      ]);
    }
    const { touchedDetectionIds } = await this.ingestPackages(
      scanMeta,
      items.map((i) => i.library),
      async (rows) => {
        const map = new Map<string, VulnerabilityOsvAffected[]>();
        for (const row of rows) {
          map.set(
            row.id,
            affectedByKey.get(keyOf(row.packageName, row.packageVersion)) ?? [],
          );
        }
        return map;
      },
    );
    return touchedDetectionIds;
  }

  /**
   * The package and detection writes of processScaBatch, with the
   * advisories of each upserted package supplied by `matchFor`. Also returns
   * the scan's branch, which processScaBatch's finalization needs.
   */
  private async ingestPackages(
    meta: ScaScanMeta,
    libraries: Library[],
    matchFor: (
      rows: ScaDetectedPackages[],
    ) => Promise<Map<string, VulnerabilityOsvAffected[]>>,
  ): Promise<{ touchedDetectionIds: string[]; branch: string }> {
    const { projectId, scanId } = meta;
    const packages = libraries;

    // Get the branch from the scan for vulnerability tracking
    const branch = await this.readScanBranch(scanId);
    this.logger.log(`scan=${scanId}: Retrieved branch='${branch}'`);

    // The project settings: the reachability configuration AND the branch
    // scope of the triage carry-over, read once per scan. The
    // scope used to be resolved again for every tranche of packages, one Get
    // each, and the settings read again by every batch.
    const projectContext = await this.readProjectContext(projectId, scanId);
    const reachabilityPriorityEnabled =
      projectContext?.reachabilityPriorityEnabled ?? true;
    const reachabilityStatusEnabled =
      projectContext?.reachabilityStatusEnabled ?? true;
    // A failed read scopes to main/master, as ReferenceBranchResolver does.
    const scoringBranches =
      projectContext?.scoringBranches ?? scoringBranchesFromProject(null);

    // Deduplicate incoming packages
    const uniquePackagesMap = new Map<string, any>();
    for (const pkg of packages) {
      const packageKey = `${(pkg.name || '').toLowerCase().trim()}@${pkg.version}`;
      if (!uniquePackagesMap.has(packageKey)) {
        uniquePackagesMap.set(packageKey, pkg);
      }
    }
    const uniquePackages = Array.from(uniquePackagesMap.values());

    this.logger.log(
      `scan=${scanId}: Processing ${uniquePackages.length} unique packages after deduplication.`,
    );

    const processedPackageKeys = new Set<string>();
    const { batchSize, yieldEvery } = this.batchConfig;

    // Process packages in batches
    const allProcessedPackages: ScaDetectedPackages[] = [];

    for (let i = 0; i < uniquePackages.length; i += batchSize) {
      const batch = uniquePackages.slice(i, i + batchSize);

      // Step 1: Save/update package records
      const processedBatch = await this.processPackageBatch(
        batch,
        projectId,
        scanId,
        processedPackageKeys,
        branch,
      );

      allProcessedPackages.push(...processedBatch);

      // Yield to event loop after every batch to keep responsive
      await this.yieldToEventLoop();

      // Log progress periodically
      const batchNumber = Math.floor(i / batchSize);
      if (batchNumber % yieldEvery === 0) {
        this.logger.debug(
          `scan=${scanId}: Processed ${Math.min(i + batchSize, uniquePackages.length)}/${uniquePackages.length} packages...`,
        );
      }
    }

    this.logger.log(
      `scan=${scanId}: Saved ${allProcessedPackages.length} packages. Starting vulnerability matching...`,
    );

    // Step 2: Find vulnerabilities for all packages in parallel batches
    const vulnMap = await matchFor(allProcessedPackages);

    this.logger.log(
      `scan=${scanId}: Completed OSV matching. Processing vulnerabilities...`,
    );

    // Step 3: Process vulnerabilities in batches
    const packagesWithVulns = allProcessedPackages
      .filter((pkg) => vulnMap.has(pkg.id))
      .map((pkg) => ({
        pkg,
        vulns: vulnMap.get(pkg.id) || [],
      }));

    // One tranche per scanner batch: its existing detections,
    // its carry-over and its grouped writes are read and written once. The
    // loops below still yield every few vulnerabilities.
    const vulnBatchSize = batchSize;
    const touchedDetectionIds: string[] = [];
    for (let i = 0; i < packagesWithVulns.length; i += vulnBatchSize) {
      const batch = packagesWithVulns.slice(i, i + vulnBatchSize);
      const idsFromBatch = await this.batchHandleVulnerabilities(
        batch,
        projectId,
        scanId,
        meta.vulnerabilityType,
        branch,
        scoringBranches,
        reachabilityPriorityEnabled,
        reachabilityStatusEnabled,
      );
      touchedDetectionIds.push(...idsFromBatch);
      await this.yieldToEventLoop();

      this.logger.debug(
        `scan=${scanId}: Handled vulnerabilities for ${Math.min(i + vulnBatchSize, packagesWithVulns.length)}/${packagesWithVulns.length} packages...`,
      );
    }

    return { touchedDetectionIds, branch };
  }

  /**
   * Finalize a SCA scan by removing libraries that were not detected in the current scan.
   * This should only be called after ALL batches have been processed.
   *
   * @param projectId The project ID
   * @param scanId The scan ID
   */
  @Span()
  async finalizeScan(projectId: string, scanId: string): Promise<void> {
    this.logger.log(
      `[SCA Finalize] Starting finalization for project=${projectId}, scan=${scanId}`,
    );

    // Get the branch from the scan
    const branch = await this.readScanBranch(scanId);
    // The project as it is now, not the batches' copy: the cleanup deletes,
    // resolves and closes issues with it.
    const projectContext = await this.readProjectContext(projectId, scanId, {
      fresh: true,
    });

    // Run the cleanup
    await this.removeMissingLibs(projectId, scanId, branch, projectContext);

    this.logger.log(
      `[SCA Finalize] Finalization completed for project=${projectId}, scan=${scanId}`,
    );
  }

  /**
   * Process a batch of packages using UPSERT for multi-pod safety.
   * Uses INSERT ... ON DUPLICATE KEY UPDATE to handle concurrent access.
   * Returns the processed ScaDetectedPackages entities for further vulnerability
   * handling, in the order the packages came.
   *
   * One multi-row upsert and one SELECT per batch, where every
   * package paid its own INSERT, TypeORM's re-SELECT of it, a findOne by
   * unique key, and sometimes a save ORing the dev/transitive flags back on.
   * - `updateEntity(false)`: nothing reads the generated values back; the
   *   SELECT below returns the rows, existing ids included.
   * - Rows sorted by unique key, so that two consumers upserting shared
   *   packages take their gap locks in the same order; one retry on a
   *   deadlock anyway.
   * - `isDev` / `isTransitive` are what THIS scan saw (`VALUES(...)`), never
   *   an OR with the stored row: an OR made a dev flag stick from one scan to
   *   the next.
   * - Any other error replays the batch one row at a time, so that a bad
   *   package (`Data too long for column 'importLocations'`) loses only
   *   itself, as before.
   */
  private async processPackageBatch(
    batch: Library[],
    projectId: string,
    scanId: string,
    processedKeys: Set<string>,
    branch: string,
  ): Promise<ScaDetectedPackages[]> {
    const packagesToUpsert: Library[] = [];

    // Filter out already processed packages. processScaBatch deduplicates on
    // the same key before calling this, so a repeat never reaches here today;
    // the guard stays so that a package is never upserted twice in one batch.
    for (const libDto of batch) {
      const nameLC = (libDto.name || '').toLowerCase().trim();
      const version = libDto.version;
      const packageKey = `${nameLC}@${version}`;

      if (processedKeys.has(packageKey)) {
        continue;
      }
      processedKeys.add(packageKey);
      packagesToUpsert.push(libDto);
    }

    if (packagesToUpsert.length === 0) {
      return [];
    }

    const rows = packagesToUpsert.map((libDto) =>
      this.packageRowOf(libDto, projectId, scanId, branch),
    );
    let persisted: Library[] = packagesToUpsert;
    try {
      await this.upsertPackageRows(this.sortedByUniqueKey(rows), true);
    } catch (e) {
      this.logger.warn(
        `[SCA] multi-row package upsert failed for scan ${scanId} (${(e as Error).message}); upserting the ${rows.length} package(s) one by one`,
      );
      persisted = await this.upsertPackagesOneByOne(packagesToUpsert, rows);
    }

    // A package that fails to upsert never reaches the results, so it
    // vanishes from the customer's SCA report. Say so once, explicitly,
    // instead of only as N scattered per-package lines.
    const upsertFailures = packagesToUpsert.length - persisted.length;
    if (upsertFailures > 0) {
      // One explicit, alertable line. Without it the only trace of a partial
      // report is N per-package errors that no rule counts, which is how
      // `Data too long for column 'importLocations'` would go unnoticed.
      this.logger.error(
        `[SCA] INCOMPLETE RESULTS: ${upsertFailures}/${packagesToUpsert.length} package(s) failed to persist for scan ${scanId} (project ${projectId}, branch ${branch}) and are missing from the report`,
      );
    }

    return this.loadUpsertedPackages(persisted, projectId, branch);
  }

  /** The `sca_detected_packages` row a scanned package upserts. */
  private packageRowOf(
    libDto: Library,
    projectId: string,
    scanId: string,
    branch: string,
  ): Partial<ScaDetectedPackages> {
    // Use the explicit dependencyInfoAvailable flag from the scanner
    // If not provided, default to true (assume info is available)
    const hasDependencyInfo = libDto.dependencyInfoAvailable ?? true;
    return {
      projectId,
      packageName: libDto.name,
      packageVersion: libDto.version,
      fileName: libDto.file,
      ecosystem: libDto.ecosystem,
      path: libDto.path,
      isDev: libDto.isDev || false,
      isTransitive: libDto.isTransitive || false,
      dependencyInfoAvailable: hasDependencyInfo,
      lastScanId: scanId,
      branch,
      reachability: libDto.reachability || null,
      // Bounded: the column is TEXT (65535 bytes) and an overflow makes
      // MySQL reject the whole row, dropping the package from the report.
      importLocations: capImportLocations(libDto.importLocations),
      licenses: libDto.licenses || [],
      licenseExpression: libDto.licenseExpression || null,
    };
  }

  /**
   * Rows in one deterministic order: lowercased name, then version (project
   * and branch are the batch's). What limits the gap locks two consumers take
   * on shared packages is that both sort the same way, not that the order
   * matches the index: `UQ_sca_detected_packages_project_name_version_branch`
   * is a prefix index (`packageName(100)`, `packageVersion(50)`, migration
   * 1765380916623), which no JS order reproduces exactly anyway.
   */
  private sortedByUniqueKey(
    rows: Partial<ScaDetectedPackages>[],
  ): Partial<ScaDetectedPackages>[] {
    const keyOf = (row: Partial<ScaDetectedPackages>) =>
      `${(row.packageName ?? '').toLowerCase()}\u0000${(row.packageVersion ?? '').toLowerCase()}`;
    return [...rows].sort((a, b) => {
      const ka = keyOf(a);
      const kb = keyOf(b);
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
  }

  /**
   * Inserts a new SCA detection. A concurrent pod may already have created it:
   * the unique refuses the insert and the caller fetches that row instead.
   * Inside a transaction the insert runs in a savepoint, so the refused insert
   * leaves the transaction usable on PostgreSQL.
   */
  private insertNewDetection(
    newDetection: ScaVulnerabilityDetections,
  ): Promise<ScaVulnerabilityDetections> {
    const repository = this.scaVulnDetectRepo;
    return withinSavepoint(repository.manager, () =>
      repository.save(newDetection),
    );
  }

  /**
   * Upsert of the given rows (ON DUPLICATE KEY UPDATE on MySQL, ON CONFLICT
   * on the unique key on PostgreSQL), atomic and safe
   * against concurrent inserts from other pods. Retried once on a deadlock
   * when `retryOnDeadlock`.
   */
  private async upsertPackageRows(
    rows: Partial<ScaDetectedPackages>[],
    retryOnDeadlock: boolean,
  ): Promise<void> {
    const run = () =>
      this.scaDetectedRepo
        .createQueryBuilder()
        .insert()
        .into(ScaDetectedPackages)
        .values(rows)
        .orUpdate(
          [
            'fileName',
            'ecosystem',
            'path',
            'isDev',
            'isTransitive',
            'dependencyInfoAvailable',
            'lastScanId',
            'updatedAt',
            'reachability',
            'importLocations',
            'licenses',
            'licenseExpression',
          ],
          ['projectId', 'packageName', 'packageVersion', 'branch'],
        )
        .updateEntity(false)
        .execute();
    try {
      await run();
    } catch (e) {
      if (!retryOnDeadlock || !isDeadlock(e)) throw e;
      this.logger.warn(
        `[SCA] deadlock on a ${rows.length}-row package upsert, retrying once`,
      );
      await run();
    }
  }

  /**
   * The fallback of a failed multi-row upsert: each package on its own, so
   * that one bad row fails alone. Returns the packages that were persisted.
   */
  private async upsertPackagesOneByOne(
    packages: Library[],
    rows: Partial<ScaDetectedPackages>[],
  ): Promise<Library[]> {
    const persisted: Library[] = [];
    for (let i = 0; i < packages.length; i++) {
      const libDto = packages[i];
      try {
        await this.upsertPackageRows([rows[i]], false);
        persisted.push(libDto);
      } catch (e) {
        // Log and continue - don't let one package failure break the whole batch
        this.logger.error(
          `Error upserting package ${libDto.name}@${libDto.version}: ${(e as Error).message}`,
        );
      }
      // Yield to event loop periodically to avoid blocking other requests
      if (i % 2 === 1) {
        await this.yieldToEventLoop();
      }
    }
    return persisted;
  }

  /**
   * The rows of the packages just upserted, in their order: one SELECT by
   * name, re-associated in JS on (name, version).
   *
   * The columns are `utf8mb4_0900_ai_ci`: the stored row of `LoDash` may be
   * `lodash`. JS compares by case folding, which is the collation's equality
   * on printable ASCII only; a package outside it, or one JS cannot tell
   * apart, is read back by its unique key as before, where MySQL decides.
   */
  private async loadUpsertedPackages(
    packages: Library[],
    projectId: string,
    branch: string,
  ): Promise<ScaDetectedPackages[]> {
    if (packages.length === 0) return [];
    const keyOf = (name: string, version: string) =>
      `${name.toLowerCase()}\u0000${version.toLowerCase()}`;
    const names = [...new Set(packages.map((p) => p.name))];

    const byKey = new Map<string, ScaDetectedPackages[]>();
    for (let i = 0; i < names.length; i += SCA_PACKAGE_SELECT_CHUNK) {
      const found = await this.scaDetectedRepo.find({
        where: {
          projectId,
          branch,
          packageName: In(names.slice(i, i + SCA_PACKAGE_SELECT_CHUNK)),
        },
      });
      for (const row of found ?? []) {
        const key = keyOf(row.packageName ?? '', row.packageVersion ?? '');
        byKey.set(key, [...(byKey.get(key) ?? []), row]);
      }
    }

    const results: ScaDetectedPackages[] = [];
    for (const libDto of packages) {
      const ascii =
        PRINTABLE_ASCII.test(libDto.name ?? '') &&
        PRINTABLE_ASCII.test(libDto.version ?? '');
      const candidates = ascii
        ? (byKey.get(keyOf(libDto.name ?? '', libDto.version ?? '')) ?? [])
        : [];
      if (candidates.length === 1) {
        results.push(candidates[0]);
        continue;
      }
      const upserted = await this.scaDetectedRepo.findOne({
        where: {
          projectId,
          packageName: libDto.name,
          packageVersion: libDto.version,
          branch,
        },
      });
      if (upserted) {
        results.push(upserted);
      }
    }
    return results;
  }

  /**
   * The re-detections of a tranche in one save: one
   * transaction, one read of the stored rows, the UPDATEs, and no reload of
   * `updatedAt` that nothing reads. When the grouped save fails, each
   * detection is saved on its own, so that one failure costs only its own
   * history row, as before. Returns the detections that were saved.
   */
  private async saveRedetections(
    detections: ScaVulnerabilityDetections[],
  ): Promise<ScaVulnerabilityDetections[]> {
    if (detections.length === 0) return [];
    try {
      await this.scaVulnDetectRepo.save(detections, { reload: false });
      return detections;
    } catch (e) {
      this.logger.warn(
        `[SCA] grouped save of ${detections.length} re-detection(s) failed (${(e as Error).message}); saving them one by one`,
      );
    }
    const saved: ScaVulnerabilityDetections[] = [];
    for (const detection of detections) {
      try {
        await this.scaVulnDetectRepo.save(detection, { reload: false });
        saved.push(detection);
      } catch (e) {
        this.logger.error(
          `Error updating detection ${detection.id}: ${(e as Error).message}`,
        );
      }
    }
    return saved;
  }

  /**
   * Writes the scan's auto-resolutions by id, in chunks of 500 , where
   *  each detection used to be saved whole. Only the fields the
   * auto-resolve sets (`currentState` and what `applyTriageToDetection`
   * stamps, see AUTO_RESOLVE_FIELDS) are written, with the values the
   * in-memory detection now holds; detections whose values differ go in
   * separate statements. `updatedAt` moves as with a save.
   */
  private async writeAutoResolutions(
    detections: ScaVulnerabilityDetections[],
  ): Promise<void> {
    const groups = new Map<string, { set: AutoResolveFields; ids: string[] }>();
    for (const detection of detections) {
      const set = Object.fromEntries(
        AUTO_RESOLVE_FIELDS.map((field) => [field, detection[field]]),
      ) as AutoResolveFields;
      const key = JSON.stringify(set);
      const group = groups.get(key) ?? { set, ids: [] };
      group.ids.push(detection.id);
      groups.set(key, group);
    }
    for (const { set, ids } of groups.values()) {
      for (let i = 0; i < ids.length; i += SCA_WRITE_CHUNK) {
        await this.scaVulnDetectRepo
          .createQueryBuilder()
          .update(ScaVulnerabilityDetections)
          .set(set)
          .whereInIds(ids.slice(i, i + SCA_WRITE_CHUNK))
          .execute();
        await this.yieldToEventLoop();
      }
    }
  }

  /** History items in one INSERT per 500, nothing read back. */
  private async insertHistoryItems(items: HistoryItem[]): Promise<void> {
    await this.insertForExistingDetections(
      this.historyItemRepo,
      HistoryItem,
      items,
      'status',
    );
  }

  /** Detection history rows in one INSERT per 500. */
  private async insertDetectionHistory(
    rows: VulnerabilityDetectionHistory[],
  ): Promise<void> {
    await this.insertForExistingDetections(
      this.vulnHistoryRepo,
      VulnerabilityDetectionHistory,
      rows,
      'history',
    );
  }

  /**
   * Rows hanging off SCA detections, in one INSERT per 500, nothing read
   * back. The detections used to be read again by id first,
   * and a row written only for those found: when an INSERT is refused (a
   * detection deleted meanwhile breaks its foreign key), the chunk is written
   * again for the detections that still exist.
   */
  private async insertForExistingDetections<
    T extends { scaVulnerabilityDetection?: { id: string } | null },
  >(
    repository: Repository<T>,
    target: EntityTarget<T>,
    rows: T[],
    kind: string,
  ): Promise<void> {
    const insert = (chunk: T[]) =>
      repository
        .createQueryBuilder()
        .insert()
        .into(target)
        .values(chunk as QueryDeepPartialEntity<T>[])
        .updateEntity(false)
        .execute();
    for (let i = 0; i < rows.length; i += SCA_WRITE_CHUNK) {
      const chunk = rows.slice(i, i + SCA_WRITE_CHUNK);
      try {
        await insert(chunk);
      } catch (e) {
        const ids = [
          ...new Set(chunk.map((row) => row.scaVulnerabilityDetection?.id)),
        ].filter(Boolean);
        const existing = new Set(
          (
            await this.scaVulnDetectRepo.find({
              select: { id: true },
              where: { id: In(ids) },
            })
          ).map((detection) => detection.id),
        );
        const kept = chunk.filter((row) =>
          existing.has(row.scaVulnerabilityDetection?.id),
        );
        this.logger.warn(
          `[SCA] ${kind} insert of ${chunk.length} row(s) refused (${(e as Error).message}); writing the ${kept.length} of detections that still exist`,
        );
        if (kept.length > 0) {
          await insert(kept);
        }
      }
      await this.yieldToEventLoop();
    }
  }

  /**
   * OSV vulnerability matching for the packages of a batch.
   * Returns a map of package ID to matched vulnerabilities.
   *
   * One candidate query per batch
   * (`findMatchingVulnerabilitiesForLibraries`), where every package used to
   * run its own (4 in parallel, 4 joins each). The matcher returns, for each
   * package, what the per-package lookup returned.
   */
  private async batchFindVulnerabilities(
    packages: ScaDetectedPackages[],
  ): Promise<Map<string, VulnerabilityOsvAffected[]>> {
    const results = new Map<string, VulnerabilityOsvAffected[]>();
    if (packages.length === 0) {
      return results;
    }

    // No advisory matcher bound (the Community Edition): nothing
    // to match, and no call.
    if (!this.advisoryMatcher) {
      return results;
    }

    const libraries: ScannedLibrary[] = packages.map((pkg) => ({
      name: pkg.packageName,
      version: pkg.packageVersion,
      ecosystem: pkg.ecosystem,
    }));
    const matches =
      await this.advisoryMatcher.findMatchingVulnerabilitiesForLibraries(
        libraries,
      );
    packages.forEach((pkg, index) => {
      results.set(pkg.id, matches[index] ?? []);
    });

    // Yield after the lookup to keep the event loop responsive
    await this.yieldToEventLoop();

    return results;
  }

  private applyScaStaticExploitabilityIfAllowed(
    detection: ScaVulnerabilityDetections,
    result: ReturnType<typeof computeScaStaticExploitability>,
  ): void {
    // Never overwrite an exploitability verdict that a user (manual), the
    // agent, or the malware policy has explicitly set — only re-evaluate
    // static/unset verdicts. (Malware is re-applied after this guard anyway,
    // but skipping avoids a spurious static write on every re-scan.)
    if (
      detection.exploitabilitySource === 'agent' ||
      detection.exploitabilitySource === 'manual' ||
      detection.exploitabilitySource === 'malware'
    ) {
      return;
    }

    const changed =
      detection.exploitabilityVerdict !== result.verdict ||
      detection.exploitabilityScore !== result.score ||
      detection.exploitabilityReason !== result.reason ||
      detection.exploitabilitySource !== 'static';

    if (!changed) {
      return;
    }

    detection.exploitabilityVerdict = result.verdict;
    detection.exploitabilityScore = result.score;
    detection.exploitabilityReason = result.reason;
    detection.exploitabilitySource = 'static' as const;
    detection.exploitabilityUpdatedAt = new Date();
  }

  /** Key a triage decision by the FINDING it describes, not by the row holding it. */
  private static triageCarryOverKey(
    ecosystem: string | null | undefined,
    packageName: string | null | undefined,
    osvId: string,
  ): string {
    return `${(ecosystem ?? '').toLowerCase()}|${(packageName ?? '').toLowerCase()}|${osvId}`;
  }

  /**
   * Triage decisions taken on OTHER versions of the packages this scan just saw.
   *
   * A triage answers "is this advisory, on this package, a problem here?" — it
   * is a decision about a finding, not about a build artefact. But a detection
   * hangs off `ScaDetectedPackages`, which is unique on
   * `(projectId, packageName, packageVersion, branch)`: bumping the package
   * mints a new package row, so the finding comes back as a brand-new detection
   * in `to_verify` with a fresh first-detection date: every package bump
   * would silently re-open the same decisions.
   *
   * Scoped to the project AND the branch, so a decision never leaks across
   * either. Only rows an explicit user/agent decision froze are loaded; a
   * machine's auto-resolve carries nothing (`mergeDetectionTriage` enforces the
   * same rule again on adoption).
   *
   * The branch scope is the LOGICAL branch, not the literal column:
   * a scan run with no branch is stored as `''` and is the same branch as the
   * project's canonical default, so a decision taken on `main` has to apply to
   * a later no-branch scan. That is a second, independent way for an `ignored`
   * to come back — the read paths and `removeMissingLibs` already resolve the
   * partition, ingestion never did. A real feature branch stays strictly
   * itself, so nothing leaks between genuine branches.
   *
   * `scoringBranches` is the project's canonical scope, derived by the batch
   * from the project it already read (`scoringBranchesFromProject`), so this
   * lookup costs no `ProjectService/Get` of its own.
   */
  private async loadTriageCarryOver(
    projectId: string,
    branchValue: string,
    scoringBranches: readonly string[],
    packages: ScaDetectedPackages[],
  ): Promise<Map<string, ScaVulnerabilityDetections>> {
    const carryOver = new Map<string, ScaVulnerabilityDetections>();
    const packageNames = [
      ...new Set(packages.map((p) => p.packageName).filter(Boolean)),
    ];
    if (packageNames.length === 0) {
      return carryOver;
    }

    const effectiveBranches = resolveScaEffectiveBranches(
      scoringBranches,
      branchValue,
    );

    let rows: ScaVulnerabilityDetections[] = [];
    try {
      rows = await this.scaVulnDetectRepo.find({
        where: {
          projectId,
          branch: In(effectiveBranches),
          stateManuallyModified: true,
          // `resolved` is excluded even when a person set it: the re-detection
          // path already reopens a resolved row because the scan contradicts it,
          // so carrying one onto the bumped version would file a finding this
          // very scan just saw as already closed.
          currentState: Not('resolved'),
          scaDetectedPackage: { projectId, packageName: In(packageNames) },
        },
        relations: ['vulnerability', 'scaDetectedPackage'],
      });
    } catch (e) {
      // Never fail an ingestion over the carry-over: the worst case without it
      // is the pre-existing behaviour (a re-opened decision), not a lost scan.
      this.logger.warn(
        `[SCA] triage carry-over lookup failed for project=${projectId}: ${(e as Error).message}`,
      );
      return carryOver;
    }

    for (const row of rows) {
      const osvId = row.vulnerability?.id;
      if (!osvId) continue;
      // Re-asserted here, not left to the WHERE clause: the invariant is that a
      // finding this scan just saw is never adopted as closed, and it must hold
      // whatever the query returns.
      if (row.currentState === 'resolved') continue;
      const key = ScaService.triageCarryOverKey(
        row.scaDetectedPackage?.ecosystem,
        row.scaDetectedPackage?.packageName,
        osvId,
      );
      const held = carryOver.get(key);
      // Several old versions may each carry a decision; the LATEST one stands,
      // matching `mergeDetectionTriage`'s own tie-break.
      if (
        !held ||
        (row.triagedAt?.getTime() ?? 0) > (held.triagedAt?.getTime() ?? 0)
      ) {
        carryOver.set(key, row);
      }
    }
    return carryOver;
  }

  /**
   * Process vulnerabilities for multiple packages using batch operations.
   * Uses UPSERT strategy for multi-pod safety - handles concurrent inserts gracefully.
   * This reduces the number of individual DB queries significantly.
   */
  private async batchHandleVulnerabilities(
    packagesWithVulns: Array<{
      pkg: ScaDetectedPackages;
      vulns: VulnerabilityOsvAffected[];
    }>,
    projectId: string,
    scanId: string,
    vulnerabilityType: string,
    branch: string | undefined,
    scoringBranches: readonly string[],
    reachabilityPriorityEnabled = true,
    reachabilityStatusEnabled = true,
  ): Promise<string[]> {
    const allowedSeverities = new Set(
      vulnerabilityType.split(',').map((s) => s.trim().toUpperCase()),
    );

    // Collect all package IDs for batch fetching existing detections
    const pkgIds = packagesWithVulns.map((p) => p.pkg.id);

    if (pkgIds.length === 0) return [];

    // Build where clause - always filter by branch (empty string if not provided)
    const branchValue = branch || '';

    // Fetch all existing detections for all packages in one query, filtered by branch
    const existingDetections = await this.scaVulnDetectRepo.find({
      where: {
        scaDetectedPackage: { id: In(pkgIds) },
        branch: branchValue,
      },
      relations: ['vulnerability', 'scaDetectedPackage'],
    });

    // Build a map: packageId -> (osvVulnId -> detection)
    const existingByPkg = new Map<
      string,
      Map<string, ScaVulnerabilityDetections>
    >();
    for (const det of existingDetections) {
      const pkgId = det.scaDetectedPackage.id;
      if (!existingByPkg.has(pkgId)) {
        existingByPkg.set(pkgId, new Map());
      }
      existingByPkg.get(pkgId)!.set(det.vulnerability.id, det);
    }

    // Decisions taken on other versions of these same packages, so a version
    // bump does not re-open them.
    const triageCarryOver = await this.loadTriageCarryOver(
      projectId,
      branchValue,
      scoringBranches,
      packagesWithVulns.map((p) => p.pkg),
    );

    const historyToCreate: Array<{
      detectionId: string;
      scanId: string;
    }> = [];
    // Re-detections are saved together once the tranche is processed.
    const redetected: ScaVulnerabilityDetections[] = [];
    const resolvedDetections: ScaVulnerabilityDetections[] = [];
    const resolvedHistoryItems: HistoryItem[] = [];

    // Track which vulnerability IDs were processed for each package
    const processedByPkg = new Map<string, Set<string>>();

    for (const { pkg, vulns } of packagesWithVulns) {
      const existingMap = existingByPkg.get(pkg.id) || new Map();
      const processedVulnIds = new Set<string>();
      processedByPkg.set(pkg.id, processedVulnIds);

      // Deduplicate vulnerabilities by ID
      const uniqueByVuln = new Map<string, VulnerabilityOsvAffected>();
      for (const a of vulns || []) {
        const id = a?.vulnerability?.id;
        if (!id) continue;
        if (!uniqueByVuln.has(id)) uniqueByVuln.set(id, a);
      }

      // Track vulns processed to yield frequently
      let vulnsSinceYield = 0;
      const yieldEveryVulns = 3;

      for (const affected of uniqueByVuln.values()) {
        const osvVuln = affected.vulnerability;
        if (!osvVuln) continue;

        processedVulnIds.add(osvVuln.id);

        // A malicious-package advisory (OSV MAL-* / database_specific)
        // is always ingested as a maximally dangerous "malware" finding — it
        // surfaces as critical and is never dropped by the scan severity filter.
        const isMalware = isMalwareAdvisory(osvVuln);

        const { severity: rawSeverity, cvssScore } =
          this.getSeverityAndCvss(affected);
        const severity = isMalware ? 'CRITICAL' : rawSeverity;
        const cvss4Result = this.computeCvss4FromAffected(affected, severity);

        if (
          !isMalware &&
          allowedSeverities.size > 0 &&
          !allowedSeverities.has(severity) &&
          !allowedSeverities.has('ALL')
        ) {
          continue;
        }

        const reachability = reachabilityPriorityEnabled
          ? pkg.reachability
          : null;
        // Apply project security context to compute env score + vector FIRST.
        // Falls back to base when no context exists for the project.
        // Must happen before recalculatePriority so the env score is used there.
        // An advisory with no CVSS gets the default vector of its label; that
        // vector is left as it is, so the label is the severity shown.
        let envScore: number | null = cvss4Result?.baseScore ?? null;
        let envVector: string | null = null;
        if (cvss4Result?.vector && cvss4Result.source !== 'severity') {
          const envResult =
            await this.resultService.computeEnvironmentalForProject(
              projectId,
              cvss4Result.vector,
            );
          if (envResult) {
            envScore = envResult.environmentalScore;
            envVector = envResult.fullVector;
          }
        }

        const exploitResult = computeScaStaticExploitability({
          isDev: pkg.isDev,
          isTransitive: pkg.isTransitive,
          reachability: pkg.reachability ?? null,
          dependencyInfoAvailable: pkg.dependencyInfoAvailable ?? true,
        });
        const priorityResult = await this.resultService.recalculatePriority(
          {
            cvss4EnvironmentalScore: envScore ?? cvss4Result?.baseScore ?? null,
            cvss4BaseScore: cvss4Result?.baseScore ?? null,
            currentSeverity: severity,
            // Malware maxes out EPSS + exploitability so the priority composite
            // ranks it at the top.
            epssScore: isMalware ? MALWARE_EPSS_SCORE : null,
            epssPercentile: isMalware ? MALWARE_EPSS_PERCENTILE : null,
            exploitabilityScore: isMalware
              ? MALWARE_EXPLOITABILITY_SCORE
              : exploitResult.score,
            priorityManualOverride: false,
            isMalware,
          },
          projectId,
          reachability,
        );
        const adjustedPriority =
          priorityResult?.priority ?? this.mapSeverityToPriority(severity);
        const adjustedPriorityScore = priorityResult?.priorityScore ?? null;
        let adjustedState = 'to_verify';

        if (reachabilityStatusEnabled && pkg.reachability === 'unused') {
          adjustedState = 'ignored';
        }

        // The scanner's reachability is best-effort: on any failure it comes
        // back '' / 'unknown' (scanlink-sca serializes a missing verdict as '',
        // never as a fresh reachable verdict). A conclusive verdict is one we
        // can actually act on; an absent/unknown signal is NOT evidence that a
        // previously `unused` package became reachable.
        const reachabilityConclusive =
          pkg.reachability === 'unused' ||
          pkg.reachability === 'used' ||
          pkg.reachability === 'potentially_used' ||
          pkg.reachability === 'test_only';

        const existing = existingMap.get(osvVuln.id);

        // SHADOW MODE: written, never read for matching yet. The pair
        // (package, advisory) already carries the identity here — unlike the
        // code families there is no line number to drift — so this is the
        // low-risk half of the roll-out. Computed once for BOTH branches so
        // the update path produces divergence evidence and backfills rows
        // that predate the column, instead of leaving them NULL forever.
        const expectedFingerprint = computeScaFingerprint({
          projectId: pkg.projectId,
          branch: branchValue ?? null,
          ecosystem: pkg.ecosystem,
          packageName: pkg.packageName,
          packageVersion: pkg.packageVersion,
          osvId: osvVuln.id,
        });

        if (existing) {
          if (
            existing.fingerprint &&
            existing.fingerprint !== expectedFingerprint
          ) {
            this.logger.warn(
              `FINGERPRINT_MISMATCH det=${existing.id} stored=${existing.fingerprint} computed=${expectedFingerprint}`,
            );
          }
          // Never overwrite a stored fingerprint — that would hide the very
          // drift being measured.
          existing.fingerprint = existing.fingerprint ?? expectedFingerprint;

          // Update existing detection - simple update, no conflict possible.
          // Preserve a user/agent-decided state across re-scans: a still-present
          // `confirmed` / `ignored` decision is frozen. Scan-managed states
          // (to_verify, reachability-driven ignored) are re-evaluated normally.
          // A reappearing `resolved` vuln always wins the lifecycle: it is reset
          // to `to_verify` and the (now stale) manual flags are cleared.
          const existingWasResolved = existing.currentState === 'resolved';
          // But do NOT churn a reachability-driven auto-ignore back to
          // `to_verify` when THIS scan produced no usable reachability signal:
          // keep the prior decision until a conclusive verdict re-evaluates it
          // (used/potentially_used -> to_verify, unused -> stays ignored).
          const keepReachabilityIgnored =
            reachabilityStatusEnabled &&
            existing.currentState === 'ignored' &&
            !existing.stateManuallyModified &&
            !reachabilityConclusive;
          if (
            (!existing.stateManuallyModified || existingWasResolved) &&
            !keepReachabilityIgnored
          ) {
            existing.currentState = adjustedState;
            existing.stateManuallyModified = false;
          }
          existing.currentSeverity = severity;
          // Freeze an analyst-set priority the same way as the state; a
          // reappearing resolved vuln re-evaluates and drops the stale lock.
          if (!existing.priorityManualOverride || existingWasResolved) {
            existing.currentPriority = adjustedPriority;
            existing.priorityScore = adjustedPriorityScore;
            existing.priorityManualOverride = false;
          }
          existing.currentCVSS = cvssScore;
          existing.cvss4Vector = cvss4Result?.vector ?? existing.cvss4Vector;
          existing.cvss4BaseScore =
            cvss4Result?.baseScore ?? existing.cvss4BaseScore;
          existing.cvss4EnvironmentalScore =
            envScore ?? existing.cvss4EnvironmentalScore;
          existing.effectiveSeverity = deriveEffectiveSeverity(
            existing.cvss4EnvironmentalScore ?? null,
            existing.cvss4BaseScore ?? null,
          );
          existing.cvss4EnvironmentalVector = envVector;
          this.applyScaStaticExploitabilityIfAllowed(existing, exploitResult);
          // Malware overrides win over the static/env-derived scoring above.
          applyMalwareOverrides(existing, osvVuln);
          // This scan saw the finding: move the sighting window forward, and
          // drop a resolution date the revive above has just invalidated.
          applySightingToDetection(existing, new Date());
          clearResolutionOnRevive(existing);
          redetected.push(existing);
        } else {
          // Create new detection - use upsert for multi-pod safety
          try {
            const newDetection = this.scaVulnDetectRepo.create({
              projectId: pkg.projectId,
              scaDetectedPackage: pkg,
              vulnerability: osvVuln,
              currentSeverity: severity,
              currentPriority: adjustedPriority,
              priorityScore: adjustedPriorityScore,
              currentCVSS: cvssScore,
              currentState: adjustedState,
              branch: branchValue,
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
              // SHADOW MODE: written, never read for matching yet.
              fingerprint: expectedFingerprint,
            });

            // Malware overrides win over the static/env-derived scoring above.
            applyMalwareOverrides(newDetection, osvVuln);

            // Same finding, new package version: adopt the decision already
            // taken on the version this scan replaces (see loadTriageCarryOver).
            const carried = triageCarryOver.get(
              ScaService.triageCarryOverKey(
                pkg.ecosystem,
                pkg.packageName,
                osvVuln.id,
              ),
            );
            if (
              carried &&
              carried.scaDetectedPackage?.id !== pkg.id &&
              mergeDetectionTriage(newDetection, carried)
            ) {
              // The finding is not new — only the version it sits on is. Keeping
              // the original date is what stops a bump reading as a fresh
              // detection. `applySightingToDetection` below seeds this field only
              // when it is empty, so it moves `last_detected_at` and leaves this.
              newDetection.firstDetectedAt = carried.firstDetectedAt ?? null;
              this.logger.debug(
                `[SCA] carried triage ${carried.currentState} from detection ${carried.id} (${carried.scaDetectedPackage?.packageVersion}) to ${pkg.packageName}@${pkg.packageVersion} / ${osvVuln.id}`,
              );
            }

            applySightingToDetection(newDetection, new Date());

            const saved = await this.insertNewDetection(newDetection);
            existingMap.set(osvVuln.id, saved);
            historyToCreate.push({ detectionId: saved.id, scanId });
          } catch (e) {
            if (isUniqueViolation(e)) {
              // Another pod created it - fetch and update instead
              const already = await this.scaVulnDetectRepo.findOne({
                where: {
                  scaDetectedPackage: { id: pkg.id },
                  vulnerability: { id: osvVuln.id },
                  branch: branchValue,
                },
                relations: ['vulnerability'],
              });
              if (already) {
                // Same shadow-mode treatment as the update path above: this is
                // the row another pod just created, so it is a re-detection
                // from this pod's point of view.
                if (
                  already.fingerprint &&
                  already.fingerprint !== expectedFingerprint
                ) {
                  this.logger.warn(
                    `FINGERPRINT_MISMATCH det=${already.id} stored=${already.fingerprint} computed=${expectedFingerprint}`,
                  );
                }
                already.fingerprint =
                  already.fingerprint ?? expectedFingerprint;
                const alreadyWasResolved = already.currentState === 'resolved';
                already.currentSeverity = severity;
                // Preserve a user/agent-decided priority (see update path above).
                if (!already.priorityManualOverride || alreadyWasResolved) {
                  already.currentPriority = adjustedPriority;
                  already.priorityScore = adjustedPriorityScore;
                  already.priorityManualOverride = false;
                }
                already.currentCVSS = cvssScore;
                // Preserve a user/agent-decided state (see update path above),
                // and likewise keep a reachability-driven auto-ignore when this
                // scan lost the reachability signal.
                const keepAlreadyReachabilityIgnored =
                  reachabilityStatusEnabled &&
                  already.currentState === 'ignored' &&
                  !already.stateManuallyModified &&
                  !reachabilityConclusive;
                if (
                  (!already.stateManuallyModified || alreadyWasResolved) &&
                  !keepAlreadyReachabilityIgnored
                ) {
                  already.currentState = adjustedState;
                  already.stateManuallyModified = false;
                }
                already.cvss4Vector =
                  cvss4Result?.vector ?? already.cvss4Vector;
                already.cvss4BaseScore =
                  cvss4Result?.baseScore ?? already.cvss4BaseScore;
                already.cvss4EnvironmentalScore =
                  envScore ?? already.cvss4EnvironmentalScore;
                already.effectiveSeverity = deriveEffectiveSeverity(
                  already.cvss4EnvironmentalScore ?? null,
                  already.cvss4BaseScore ?? null,
                );
                already.cvss4EnvironmentalVector = envVector;
                this.applyScaStaticExploitabilityIfAllowed(
                  already,
                  exploitResult,
                );
                // Malware overrides win over the static/env-derived scoring.
                applyMalwareOverrides(already, osvVuln);
                applySightingToDetection(already, new Date());
                clearResolutionOnRevive(already);
                await this.scaVulnDetectRepo.save(already);
                existingMap.set(osvVuln.id, already);
                historyToCreate.push({ detectionId: already.id, scanId });
              }
            } else {
              this.logger.error(
                `Error creating detection for ${osvVuln.id}: ${(e as Error).message}`,
              );
            }
          }
        }

        // Yield after every few vulnerabilities to keep event loop responsive
        vulnsSinceYield++;
        if (vulnsSinceYield >= yieldEveryVulns) {
          vulnsSinceYield = 0;
          await this.yieldToEventLoop();
        }
      }

      // Yield after each package as well
      await this.yieldToEventLoop();
    }

    // The re-detections of the tranche, in one save.
    for (const saved of await this.saveRedetections(redetected)) {
      historyToCreate.push({ detectionId: saved.id, scanId });
    }

    // Find detections to resolve (not in current scan) - only for packages we processed
    // One instant for the sweep: its rows are written by one UPDATE.
    const sweepResolvedAt = new Date();
    for (const { pkg } of packagesWithVulns) {
      const existingMap = existingByPkg.get(pkg.id) || new Map();
      const processedVulnIds = processedByPkg.get(pkg.id) || new Set();

      for (const [vulnId, det] of existingMap.entries()) {
        // Only a person's or the agent's dismissal survives the advisory going
        // away; a confirm is closed like any open finding (see the gate).
        if (
          !processedVulnIds.has(vulnId) &&
          shouldAutoResolveScaOnDisappearance(det)
        ) {
          det.currentState = 'resolved';
          const resolvedAt = sweepResolvedAt;
          // The scan resolved this, not a person. `source: 'system'` on the
          // history row and `triagedByType: 'system'` on the detection are the
          // same statement — without them a null userId reads as "unknown
          // user" on every future export row.
          applyTriageToDetection(
            det,
            { status: 'resolved' },
            resolvedAt,
            'system',
          );
          resolvedDetections.push(det);

          const historyItem = this.historyItemRepo.create({
            type: 'status_change',
            value: 'resolved',
            date: resolvedAt,
            source: 'system',
            scaVulnerabilityDetection: det,
          });
          resolvedHistoryItems.push(historyItem);
          historyToCreate.push({ detectionId: det.id, scanId });
        }
      }
    }

    // The resolutions in one UPDATE per 500, their status rows in one
    // INSERT per 500.
    await this.writeAutoResolutions(resolvedDetections);
    await this.insertHistoryItems(resolvedHistoryItems);

    // The scan's history rows: one INSERT per 500, straight from the ids
    // already in memory (the detections used to be read again for it).
    const sightedAt = new Date();
    await this.insertDetectionHistory(
      historyToCreate
        .filter((h) => h.detectionId)
        .map(({ detectionId, scanId: historyScanId }) =>
          this.vulnHistoryRepo.create({
            scanId: historyScanId,
            detectedAt: sightedAt,
            scaVulnerabilityDetection: {
              id: detectionId,
            } as ScaVulnerabilityDetections,
          }),
        ),
    );

    // Close issues for resolved vulnerabilities (version upgrade fixed the vulnerability)
    if (resolvedDetections.length > 0) {
      try {
        const resolvedVulnerabilityIds = resolvedDetections.map((d) => d.id);
        this.logger.log(
          `[SCA] Closing issues for ${resolvedVulnerabilityIds.length} resolved SCA vulnerabilities (version change)...`,
        );
        // Closing issues is destructive: done with the settings the project
        // has now, not the scan's copy. When that read fails, nothing is
        // handed over and closeIssues reads the project itself, as before.
        const current = await this.readProjectContext(projectId, scanId, {
          fresh: true,
        });
        await this.issueIntegrationService.closeIssuesForResolvedVulnerabilities(
          projectId,
          resolvedVulnerabilityIds,
          'version_upgrade_fixed',
          'sca',
          { settings: current?.issueSettings },
        );
      } catch (error: any) {
        // Don't fail the scan processing if issue closing fails
        this.logger.warn(
          `[SCA] Failed to close issues for resolved vulnerabilities: ${error?.message || error}`,
        );
      }
    }

    // De-duplicate detection ids that were created or updated in this batch
    // (historyToCreate contains one entry per save, including repeats when the
    // same detection is touched twice — unlikely but possible).
    const touchedDetectionIds = Array.from(
      new Set(historyToCreate.map((h) => h.detectionId).filter(Boolean)),
    );
    return touchedDetectionIds;
  }

  /**
   * Update SCA vulnerabilities in the database.
   *
   * @param vuln - The vulnerability to update.
   * @param dto - The update result request DTO.
   * @returns The updated vulnerability.
   */
  @Span()
  async handleUpdateSca(
    vuln: ScaVulnerabilityDetections,
    dto: UpdateResultRequest,
  ): Promise<GetProjectVulnerabilityByIdResponse> {
    // Reject a reasonless dismissal BEFORE any mutation — a
    // half-applied dismissal would change the row and still tell the
    // caller it failed. See assertDismissalReason for why the gateway
    // DTO is not sufficient on its own.
    assertDismissalReason(dto);

    const oldStatus = vuln.currentState;
    const oldPriority = vuln.currentPriority;

    if (dto.status) {
      vuln.currentState = dto.status;
      // Freeze this state against scan re-evaluation: an explicit user/agent
      // status decision must survive subsequent re-scans (BACK — SCA status reset).
      vuln.stateManuallyModified = true;
    }

    if (dto.priority && dto.exploitabilitySource !== 'agent') {
      vuln.currentPriority = dto.priority;
      vuln.priorityManualOverride = true;
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

    // ONE clock for the whole decision: the detection stamps below and every
    // history_item.date written further down share this instant, which is what
    // lets backfill-lifecycle.ts join a dismissal comment to its transition.
    const date = new Date();
    applyTriageToDetection(vuln, dto, date);

    await this.scaVulnDetectRepo.save(vuln);

    if (dto.status && dto.status !== oldStatus) {
      const historyItem = new HistoryItem();
      historyItem.type = 'status_change';
      historyItem.value = dto.status;
      historyItem.date = date;
      historyItem.userId = dto.userId;
      historyItem.scaVulnerabilityDetection = vuln;
      applyAgentAuditFields(historyItem, dto);
      await this.resultService.addHistoryItem(historyItem);
    }

    if (dto.priority && dto.priority !== oldPriority) {
      const historyItem = new HistoryItem();
      historyItem.type = 'priority_change';
      historyItem.value = dto.priority;
      historyItem.date = date;
      historyItem.userId = dto.userId;
      historyItem.scaVulnerabilityDetection = vuln;
      applyAgentAuditFields(historyItem, dto);
      await this.resultService.addHistoryItem(historyItem);
    }

    if (dto.comment) {
      const historyItem = new HistoryItem();
      historyItem.type = 'comment';
      historyItem.value = dto.comment;
      historyItem.date = date;
      historyItem.userId = dto.userId;
      historyItem.scaVulnerabilityDetection = vuln;
      applyAgentAuditFields(historyItem, dto);
      await this.resultService.addHistoryItem(historyItem);
    }

    // Persist exploitability fields from agent or manual assessment.
    // The score is derived deterministically from the verdict — agent-supplied
    // scores are intentionally ignored.
    if (dto.exploitabilityVerdict === 'not_evaluated') {
      // Manual reset: set the verdict back to NULL, then recompute the base priority.
      clearExploitabilityFields(vuln);
      vuln.exploitabilityUpdatedAt = new Date();

      const historyItem = new HistoryItem();
      historyItem.type = 'exploitability_change';
      historyItem.value = JSON.stringify({ cleared: true });
      historyItem.date = date;
      historyItem.userId = dto.userId;
      historyItem.scaVulnerabilityDetection = vuln;
      applyAgentAuditFields(historyItem, dto);
      await this.resultService.addHistoryItem(historyItem);

      const pkg = await this.scaDetectedRepo.findOne({
        where: {
          id:
            (vuln.scaDetectedPackage as any)?.id ||
            (vuln as any).scaDetectedPackageId,
        },
      });
      const result = await this.resultService.recalculatePriority(
        vuln,
        dto.projectId,
        pkg?.reachability,
        { forceRecompute: dto.exploitabilitySource === 'manual' },
      );
      if (result) {
        vuln.priorityScore = result.priorityScore;
      }
      if (result && result.priority !== oldPriority) {
        vuln.currentPriority = result.priority;
        const priorityHistoryItem = new HistoryItem();
        priorityHistoryItem.type = 'priority_change';
        priorityHistoryItem.value = result.priority;
        priorityHistoryItem.date = date;
        // Inherit the triggering actor instead of the 'system'
        // sentinel so a human edit no longer renders as the AI agent.
        priorityHistoryItem.userId = dto.userId;
        priorityHistoryItem.scaVulnerabilityDetection = vuln;
        applyAgentAuditFields(priorityHistoryItem, dto);
        await this.resultService.addHistoryItem(priorityHistoryItem);
      }
      await this.scaVulnDetectRepo.save(vuln);
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
      // analyst-set manual verdicts freeze the priority label.
      if (dto.exploitabilitySource === 'manual') {
        vuln.priorityManualOverride = true;
      }

      const historyItem = new HistoryItem();
      historyItem.type = 'exploitability_change';
      historyItem.value = JSON.stringify({ score, verdict });
      historyItem.date = date;
      historyItem.userId = dto.userId;
      historyItem.scaVulnerabilityDetection = vuln;
      applyAgentAuditFields(historyItem, dto);
      await this.resultService.addHistoryItem(historyItem);

      // Pass reachability from the detected package for SCA-specific modifier
      const pkg = await this.scaDetectedRepo.findOne({
        where: {
          id:
            (vuln.scaDetectedPackage as any)?.id ||
            (vuln as any).scaDetectedPackageId,
        },
      });
      const result = await this.resultService.recalculatePriority(
        vuln,
        dto.projectId,
        pkg?.reachability,
        { forceRecompute: dto.exploitabilitySource === 'manual' },
      );
      if (result) {
        vuln.priorityScore = result.priorityScore;
      }
      if (result && result.priority !== oldPriority) {
        vuln.currentPriority = result.priority;
        const priorityHistoryItem = new HistoryItem();
        priorityHistoryItem.type = 'priority_change';
        priorityHistoryItem.value = result.priority;
        priorityHistoryItem.date = date;
        // Inherit the triggering actor instead of the 'system'
        // sentinel so a human edit no longer renders as the AI agent.
        priorityHistoryItem.userId = dto.userId;
        priorityHistoryItem.scaVulnerabilityDetection = vuln;
        applyAgentAuditFields(priorityHistoryItem, dto);
        await this.resultService.addHistoryItem(priorityHistoryItem);
      }
      await this.scaVulnDetectRepo.save(vuln);
    }

    await this.cyberiskEnqueuer.enqueue(dto.projectId, 'vuln_update');

    return this.getScaVulnerabilityByIdInProject({
      projectId: dto.projectId,
      vulnerabilityId: dto.vulnerabilityId,
    });
  }

  /**
   * Collects the known `fixed` versions per OSV id for a batch of records,
   * used by the paginated SCA list endpoint. Returns the raw list per id; the
   * caller picks the installed-aware recommendation (smallest fix strictly
   * above each detection's installed version) via {@link getMinFixedAbove},
   * because several detections can share one OSV id with different installs.
   *
   * Does NOT load any TypeORM relation: it issues a single SELECT that joins
   * `vulnerability_osv_affected` → `_range` → `_event`, returning all
   * non-empty `event.fixed` rows scoped to the visible page.
   *
   * This is the cheap replacement for the old `.leftJoinAndSelect(
   * 'osv.affected') ... .ranges ... .events` chain that pushed list
   * responses past the 50 MB gRPC ceiling on projects with hundreds of
   * critical CVEs (e.g. Log4Shell). Cardinality stays bounded:
   * `page_size × affected × ranges × events` rows per call.
   *
   * @param osvIds  Unique list of OSV ids visible on the current page.
   * @param dataSource  Optional TypeORM data source for testability; falls
   *                    back to the service-injected one.
   */
  /**
   * Cheap batched lookup of the CVE alias per OSV id. The list-mode query
   * intentionally skips the heavy `osv.aliases` join, but the
   * dashboard list still renders the CVE — resolve just that one string here so
   * it doesn't show "N/A" for every row.
   */
  private async loadCveMap(
    osvIds: string[],
    dataSource: DataSource = this.dataSource,
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    if (!osvIds.length) return result;

    const rows = await dataSource
      .createQueryBuilder()
      .select('a.vulnerabilityOsvId', 'osvId')
      .addSelect('MIN(a.alias)', 'cve')
      .from('vulnerability_osv_alias', 'a')
      .where('a.vulnerabilityOsvId IN (:...osvIds)', { osvIds })
      .andWhere(ilike('a.alias', "'CVE-%'").text)
      .groupBy('a.vulnerabilityOsvId')
      .getRawMany<{ osvId: string; cve: string | null }>();

    for (const row of rows) {
      if (row.cve) result.set(row.osvId, row.cve);
    }
    return result;
  }

  private async loadFixedVersionsByOsv(
    osvIds: string[],
    dataSource: DataSource = this.dataSource,
  ): Promise<Map<string, string[]>> {
    const result = new Map<string, string[]>();
    if (!osvIds.length) return result;

    const rows = await dataSource
      .createQueryBuilder()
      .select('aff.vulnerabilityOsvId', 'osvId')
      .addSelect('evt.fixed', 'fixedVersion')
      .from('vulnerability_osv_affected', 'aff')
      .innerJoin(
        'vulnerability_osv_affected_range',
        'rng',
        'rng.affectedId = aff.id',
      )
      .innerJoin(
        'vulnerability_osv_affected_event',
        'evt',
        'evt.rangeId = rng.id',
      )
      .where('aff.vulnerabilityOsvId IN (:...osvIds)', { osvIds })
      .andWhere('evt.fixed IS NOT NULL')
      .andWhere("evt.fixed <> ''")
      .getRawMany<{ osvId: string; fixedVersion: string | null }>();

    // Group the raw fixed-version strings per OSV id. The installed-aware
    // selection (smallest fix strictly above the installed version) is done per
    // detection by the caller, since several detections can share one OSV id
    // with different installed versions. Missing ids are simply absent (the
    // caller defaults to an empty list).
    for (const row of rows) {
      const fixed = row.fixedVersion ?? '';
      if (!fixed) continue;
      const bucket = result.get(row.osvId);
      if (bucket) {
        bucket.push(fixed);
      } else {
        result.set(row.osvId, [fixed]);
      }
    }

    return result;
  }

  /**
   * Returns a paginated and filtered list of SCA vulnerabilities for a project.
   * The data is fetched from local detections and joined with OSV data,
   * then mapped to the public gRPC DTO.
   */
  @Span()
  async getProjectScaVulnerabilities(
    dto: GetProjectScaVulnerabilitiesRequest,
  ): Promise<GetProjectScaVulnerabilitiesResponse> {
    const {
      projectId,
      sort = 'currentSeverity',
      order = 'ASC',
      severity,
      status,
      priority,
      searchQuery,
      packageType,
      hasAutofix,
      exploitabilityVerdict,
      scoringSource,
      packageManager,
      packageSource,
      slim,
    } = dto;

    // The gRPC server loads the proto with `defaults: true`: an absent
    // pageNumber/pageSizeNumber arrives as 0, so a destructuring default never
    // applies.
    // - pageNumber 0 is page 1, never a negative OFFSET.
    // - An explicit page size is clamped at 500, silently rather than
    //   rejected: the IDE extension asks for 500 rows in one call without
    //   walking totalPages.
    // - pageSizeNumber 0 still returns the whole list: the post-scan policy
    //   evaluation (policy-management `fetchAllVulnerabilities`) sends no
    //   paging and must see every SCA detection. Public callers always get a
    //   page size from the gateway.
    const pageNumber = Math.max(dto.pageNumber || 1, 1);
    const limit = clampListPageSize(dto.pageSizeNumber);
    const orderUpperCase = order.toUpperCase() as 'ASC' | 'DESC';
    const allowedSortFields = [
      'currentState',
      'currentSeverity',
      'currentPriority',
      'priorityScore',
      'createdAt',
      'updatedAt',
      'currentCVSS',
    ];
    const allowedOrder = ['ASC', 'DESC'];

    const safeSort = allowedSortFields.includes(sort)
      ? sort
      : 'currentSeverity';
    const safeOrder = allowedOrder.includes(orderUpperCase)
      ? orderUpperCase
      : 'ASC';

    // List-mode query: only joins what the dashboard list table reads
    // (package, history, autofix, plus OSV scalar fields used by the light
    // mapper). The heavy `aliases / severities / references / affected /
    // ranges / events` joins are intentionally skipped — they live in the
    // detail path (`getScaVulnerabilityByIdInProject`) where the full
    // `mapVulnerabilityScaEntityToMetadata` is used.
    const qb = this.scaVulnDetectRepo
      .createQueryBuilder('vulnDetection')
      .leftJoinAndSelect('vulnDetection.scaDetectedPackage', 'scaPackage')
      .leftJoinAndSelect('vulnDetection.vulnerability', 'osv')
      .leftJoinAndSelect(
        'vulnDetection.scaAutofixRecords',
        'scaAutofixRecords',
      );
    // The slim (MCP) list loads no history; hasCybeAnalysis is
    // read for the ids of the page below.
    if (!slim) {
      qb.leftJoinAndSelect('vulnDetection.historyItems', 'historyItems');
    }
    qb.where('vulnDetection.projectId = :projectId', { projectId });

    // Scope to the full logical branch partition (canonical branch +
    // legacy '' rows) so the default-branch view matches the resolver and the
    // package/license lists, instead of an exact single-branch equality that
    // missed orphaned '' rows (overview counted them, detail showed 0).
    // Derived from the list's own (and only) project Get, not
    // from a second one through getScoringBranches. A failed Get still fails
    // the list (awaited below); the partition then falls back to main/master.
    const { projectLookup, scaBranches } = lookupProjectWithScaBranches(
      this.projectServiceClient,
      projectId,
      dto.branch,
    );
    const branches = await scaBranches;
    qb.andWhere('vulnDetection.branch IN (:...branches)', { branches });

    // Malware is separated from the ordinary "Vulnerabilities" list.
    // Default (malwareOnly unset/false) => exclude malware; malwareOnly=true =>
    // return only the malware findings (the SCA "Malware" sub-tab).
    qb.andWhere('vulnDetection.isMalware = :malwareOnly', {
      malwareOnly: !!dto.malwareOnly,
    });

    if (severity?.length > 0) {
      qb.andWhere(
        `${effectiveSeveritySql('vulnDetection')} IN (:...severity)`,
        { severity: severity.map((s) => s.toLowerCase()) },
      );
    }
    if (status?.length > 0) {
      qb.andWhere('vulnDetection.currentState IN (:...status)', { status });
    }
    applyPriorityFilter(qb, priority, 'vulnDetection');
    // The exploitability-verdict filter must NOT apply to the Malware
    // sub-tab — malware always carries the `malicious` verdict, which is not a
    // user-selectable filter value, so the default filter set would wrongly
    // hide every malware finding.
    if (!dto.malwareOnly) {
      applyExploitabilityVerdictFilter(
        qb,
        exploitabilityVerdict,
        'vulnDetection',
      );
    }
    if (scoringSource) {
      if (scoringSource === 'agent') {
        qb.andWhere(
          '(vulnDetection.scoringSource = :scoringSource OR vulnDetection.exploitabilitySource = :agentExploitabilitySource)',
          { scoringSource, agentExploitabilitySource: 'agent' },
        );
      } else {
        qb.andWhere(
          'vulnDetection.scoringSource = :scoringSource AND (vulnDetection.exploitabilitySource IS NULL OR vulnDetection.exploitabilitySource <> :agentExploitabilitySource)',
          { scoringSource, agentExploitabilitySource: 'agent' },
        );
      }
    }
    if (searchQuery) {
      // The SCA search box also matches the package manager (ecosystem)
      // and manifest file name, so it doubles as the ecosystem/source filter
      // (the dropdown UI was reverted). Aliases use an EXISTS sub-query so we can
      // keep matching by alias without hydrating `osv.aliases` for every row on
      // the page (those collections drive the 50 MB gRPC payload blow-up the
      // list-mode slimming targets).
      qb.andWhere(
        `(${ilike('osv.summary', ':search').text} OR ${ilike('osv.id', ':search').text}
          OR ${ilike('scaPackage.ecosystem', ':search').text} OR ${ilike('scaPackage.fileName', ':search').text}
          OR EXISTS (
          SELECT 1 FROM vulnerability_osv_alias a
          WHERE ${rawIdent('a.vulnerabilityOsvId')} = osv.id AND ${ilike('a.alias', ':search').text}
        ))`,
        { search: `%${searchQuery}%` },
      );
    }
    if (packageType?.length > 0) {
      const conditions: string[] = [];
      const parameters: any = {};
      if (packageType.includes('dev')) {
        conditions.push('scaPackage.isDev = :isDev');
        parameters.isDev = true;
      }
      if (packageType.includes('direct')) {
        conditions.push(
          '(scaPackage.isDev = :isNotDev AND scaPackage.isTransitive = :isNotTransitive)',
        );
        parameters.isNotDev = false;
        parameters.isNotTransitive = false;
      }
      if (packageType.includes('transitive')) {
        conditions.push('scaPackage.isTransitive = :isTransitive');
        parameters.isTransitive = true;
      }
      if (conditions.length > 0) {
        qb.andWhere(`(${conditions.join(' OR ')})`, parameters);
      }
    }
    if (packageManager?.length > 0) {
      qb.andWhere('scaPackage.ecosystem IN (:...packageManager)', {
        packageManager,
      });
    }
    if (packageSource?.length > 0) {
      qb.andWhere('scaPackage.fileName IN (:...packageSource)', {
        packageSource,
      });
    }

    // Filter by autofix status if specified
    if (hasAutofix !== undefined && hasAutofix !== null) {
      if (hasAutofix === true) {
        // Has autofix: must have at least one SCA autofixRecord with a fix available
        qb.andWhere(`EXISTS (${scaFixAvailableExistsSql('vulnDetection.id')})`);
      } else {
        // No autofix: must NOT have any SCA autofixRecord with a fix available
        qb.andWhere(
          `NOT EXISTS (${scaFixAvailableExistsSql('vulnDetection.id')})`,
        );
      }
    }

    let detections: ScaVulnerabilityDetections[] = [];
    let total = 0;

    if (safeSort === 'currentCVSS') {
      // Optimized SQL-based sorting by severity first, then by CVSS score
      // N/A scores (0 or null) are placed at the end of each severity group
      qb.addSelect(
        `CASE
          WHEN ${effectiveSeveritySql('vulnDetection')} = 'critical' THEN 1
          WHEN ${effectiveSeveritySql('vulnDetection')} = 'high' THEN 2
          WHEN ${effectiveSeveritySql('vulnDetection')} = 'medium' THEN 3
          WHEN ${effectiveSeveritySql('vulnDetection')} = 'low' THEN 4
          ELSE 5 END`,
        'severity_order',
      );

      // Add the CVSS null/zero ordering as a select with alias to avoid TypeORM alias parsing issues
      qb.addSelect(
        `CASE WHEN vulnDetection.currentCVSS = 0 OR vulnDetection.currentCVSS IS NULL THEN 1 ELSE 0 END`,
        'cvss_null_order',
      );

      // Sort by severity first, then by CVSS score within the same severity
      // Scores of 0 are placed at the end of each severity group
      if (safeOrder === 'DESC') {
        // DESC: CRITICAL first (severity_order ASC), highest CVSS first, 0 scores last
        qb.orderBy('severity_order', 'ASC')
          .addOrderBy('cvss_null_order', 'ASC')
          .addOrderBy('vulnDetection.currentCVSS', 'DESC');
      } else {
        // ASC: LOW first (severity_order DESC), lowest CVSS first, 0 scores last
        qb.orderBy('severity_order', 'DESC')
          .addOrderBy('cvss_null_order', 'ASC')
          .addOrderBy('vulnDetection.currentCVSS', 'ASC');
      }

      total = await qb.getCount();
      detections = await qb
        .skip((pageNumber - 1) * limit)
        .take(limit)
        .getMany();
    } else {
      // Invert the order for CASE-based sorting (critical=1, low=4)
      // DESC (descending severity) -> ASC on severity_order to get critical first
      // ASC (ascending severity) -> DESC on severity_order to get low first
      const invertedOrder = safeOrder === 'DESC' ? 'ASC' : 'DESC';

      if (safeSort === 'currentSeverity') {
        qb.addSelect(
          `CASE
            WHEN ${effectiveSeveritySql('vulnDetection')} = 'critical' THEN 1
            WHEN ${effectiveSeveritySql('vulnDetection')} = 'high' THEN 2
            WHEN ${effectiveSeveritySql('vulnDetection')} = 'medium' THEN 3
            WHEN ${effectiveSeveritySql('vulnDetection')} = 'low' THEN 4
            ELSE 5 END`,
          'severity_order',
        ).orderBy('severity_order', invertedOrder);
      } else if (safeSort === 'currentPriority') {
        qb.addSelect(
          `CASE
            WHEN LOWER(vulnDetection.currentPriority) = 'critical_urgent' THEN 1
            WHEN LOWER(vulnDetection.currentPriority) = 'urgent' THEN 2
            WHEN LOWER(vulnDetection.currentPriority) = 'normal' THEN 3
            WHEN LOWER(vulnDetection.currentPriority) = 'low' THEN 4
            WHEN LOWER(vulnDetection.currentPriority) = 'very_low' THEN 5
            ELSE 6 END`,
          'priority_order',
        ).orderBy('priority_order', invertedOrder);
      } else if (safeSort === 'priorityScore') {
        qb.addSelect(
          'CASE WHEN vulnDetection.priorityScore IS NULL THEN 1 ELSE 0 END',
          'priority_score_null_order',
        )
          .orderBy('priority_score_null_order', 'ASC')
          .addOrderBy('vulnDetection.priorityScore', safeOrder);
      } else {
        qb.orderBy(`vulnDetection.${safeSort}`, safeOrder);
      }

      total = await qb.getCount();
      detections = await qb
        .skip((pageNumber - 1) * limit)
        .take(limit)
        .getMany();
    }

    // List-mode mapping: fetch hasFix for the visible page only and route
    // through the light mapper instead of the full one. This avoids loading
    // `osv.affected.ranges.events` for every detection (was the bulk of the
    // payload weight in the heavy join path).
    const osvIds = Array.from(
      new Set(
        detections
          .map((d) => d.vulnerability?.id)
          .filter((id): id is string => !!id),
      ),
    );
    const [fixedVersionsMap, cveMap, cybeAnalysed] = await Promise.all([
      this.loadFixedVersionsByOsv(osvIds),
      this.loadCveMap(osvIds),
      slim
        ? findCybeAnalysedDetectionIds(
            this.scaVulnDetectRepo,
            projectId,
            detections.map((d) => d.id),
          )
        : Promise.resolve(null),
    ]);

    const vulnerabilities: VulnerabilitySca[] = detections.map((det) => {
      // Installed-aware fix: the smallest fixed version strictly above this
      // detection's installed version (never a downgrade); empty when already
      // past every listed fix.
      const fixedAbove = getMinFixedAbove(
        fixedVersionsMap.get(det.vulnerability?.id ?? '') ?? [],
        det.scaDetectedPackage?.packageVersion ?? '',
      );
      const item = mapScaDetectionEntityToListInterface(
        det,
        { hasFix: !!fixedAbove, fixedVersion: fixedAbove ?? '' },
        this.cvssExplainer,
        cveMap.get(det.vulnerability?.id ?? '') ?? '',
      );
      if (cybeAnalysed) item.hasCybeAnalysis = cybeAnalysed.has(det.id);
      return item;
    });
    const totalPages = Math.ceil(total / limit);

    // Parallel fan-out: project, scan, per-type counts, autofix and the
    // reachability="unused" ignored count are all independent. Previously 5
    // sequential awaits on the critical path.
    const [
      projectResponse,
      scanResponse,
      vulnCountByType,
      autofixCounts,
      reachabilityIgnoredCount,
      malwareCount,
    ] = await Promise.all([
      // A slim (MCP) list reads none of these and answers with
      // the empty values instead. It still reads the project once, for the
      // The branch scoping above (the list's own Get), and
      // awaits that Get: a failed read fails the list, never serves it scoped
      // to the main/master fallback.
      slim
        ? projectLookup.then(() => ({}) as ProjectInformationsResponse)
        : projectLookup,
      slim
        ? Promise.resolve(undefined)
        : safeGrpcCall(this.scanServiceClient.getLastScanStatus({ projectId })),
      // Perf — reuse the already-resolved `branches` so these don't
      // re-resolve getScoringBranches (was 3 gRPC round-trips per request).
      slim
        ? Promise.resolve(undefined)
        : this.resultService.getCountVulnerabilitiesCountByType(
            projectId,
            dto.branch,
            branches,
          ),
      // The dashboard Results pages never read these counts:
      // they opt out (excludeAutofixCounts) and save five queries.
      slim
        ? Promise.resolve(emptyAutofixCountByType())
        : dto.excludeAutofixCounts
          ? undefined
          : this.resultService.getAutofixCountByType(
              projectId,
              dto.branch,
              branches,
            ),
      slim
        ? Promise.resolve(0)
        : this.scaVulnDetectRepo
            .createQueryBuilder('vd')
            .innerJoin('vd.scaDetectedPackage', 'pkg')
            .where('vd.projectId = :projectId', { projectId })
            .andWhere('vd.currentState = :state', { state: 'ignored' })
            .andWhere('pkg.reachability = :reachability', {
              reachability: 'unused',
            })
            // Same logical branch partition as the list query above.
            .andWhere('vd.branch IN (:...branches)', { branches })
            .getCount(),
      // Project-wide malware count (independent of the current
      // filter/pagination) that drives the "Malware" sub-tab badge + banner.
      // Scoped to the active vuln states so the badge/banner match the list
      // (which defaults to currentState IN active states) — a resolved/removed
      // malware must drop from the count too.
      slim
        ? Promise.resolve(0)
        : this.scaVulnDetectRepo
            .createQueryBuilder('vd')
            .where('vd.projectId = :projectId', { projectId })
            .andWhere('vd.isMalware = :isMalware', { isMalware: true })
            .andWhere('vd.currentState IN (:...activeStates)', {
              activeStates: [...ACTIVE_VULN_STATES],
            })
            .andWhere('vd.branch IN (:...branches)', { branches })
            .getCount(),
    ]);

    let scanProjectInfo: ScanProjectInfo | undefined;
    if (scanResponse) {
      scanProjectInfo = {
        scanId: scanResponse.id,
        state: scanResponse.state,
        createAt: scanResponse.createAt,
        scanType: scanResponse.scanType,
      };
    }

    // Check if project has been parsed (code-graph assistant available)
    const parsedBranches = (projectResponse as any).parsedBranches || [];
    const isProjectParsed = parsedBranches.length > 0;

    return {
      projectId,
      projectName: 'name' in projectResponse ? projectResponse.name || '' : '',
      page: pageNumber,
      limit,
      totalPages,
      sort,
      order,
      severity,
      status,
      priority,
      vulnerabilities,
      total,
      scanProjectInfo,
      vulnCountByType,
      isProjectParsed,
      autofixCountByType: autofixCounts
        ? {
            sast: autofixCounts.sast,
            iac: autofixCounts.iac,
            cicd: autofixCounts.cicd,
            secret: autofixCounts.secret,
            sca: autofixCounts.sca,
          }
        : undefined,
      reachabilityIgnoredCount,
      malwareCount,
    };
  }

  /**
   * Returns the distinct ecosystem (package manager) and fileName (manifest)
   * values for packages that have at least one vulnerability in the project,
   * optionally scoped to a branch. Sourced from the vulnerability list (not all
   * detected packages) so the dropdown only offers options that actually narrow
   * the SCA results it filters. Used to populate dashboard filter dropdowns.
   */
  @Span()
  async getScaFilterOptions(
    request: GetScaFilterOptionsRequest,
  ): Promise<GetScaFilterOptionsResponse> {
    const { projectId, branch } = request;
    if (!projectId) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Bad request - missing projectId',
      });
    }

    // Scope the filter-dropdown options to the SAME logical branch
    // partition the vuln list uses, so the offered options always match what
    // the list actually contains (canonical branch + legacy '' rows).
    const branches = await this.getScaEffectiveBranches(projectId, branch);

    const distinct = async (column: 'ecosystem' | 'fileName') => {
      const qb = this.scaVulnDetectRepo
        .createQueryBuilder('v')
        .innerJoin('v.scaDetectedPackage', 'pkg')
        .select(`pkg.${column}`, 'value')
        .distinct(true)
        .where('v.projectId = :projectId', { projectId })
        .andWhere(`pkg.${column} IS NOT NULL`)
        .andWhere(`pkg.${column} <> ''`)
        .andWhere('v.branch IN (:...branches)', { branches });
      const rows = await qb.getRawMany<{ value: string }>();
      return rows
        .map((r) => r.value)
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));
    };

    const [ecosystems, fileNames] = await Promise.all([
      distinct('ecosystem'),
      distinct('fileName'),
    ]);

    return { ecosystems, fileNames };
  }

  /**
   * Returns a paginated list of all detected packages for a project.
   */
  @Span()
  async getProjectScaPackages(
    dto: GetProjectScaVulnerabilitiesRequest,
  ): Promise<GetProjectPackagesResponse> {
    const {
      projectId,
      page = 1,
      limit = 10,
      searchQuery,
      packageType,
      packageManager,
      packageSource,
    } = dto;

    if (!projectId) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Project ID is required',
      });
    }

    // Scope to the full logical branch partition (canonical branch +
    // legacy '' rows) so the default-branch view isn't empty when packages were
    // ingested without a branch. Shared with the resolver and the other reads.
    const branches = await this.getScaEffectiveBranches(projectId, dto.branch);

    const qb = this.scaDetectedRepo
      .createQueryBuilder('pkg')
      .where('pkg.projectId = :projectId', { projectId })
      .andWhere('pkg.branch IN (:...branches)', { branches });

    if (searchQuery) {
      // Search matches package name OR ecosystem OR manifest file name
      qb.andWhere(
        `(${ilike('pkg.packageName', ':searchTerm').text} OR ${ilike('pkg.ecosystem', ':searchTerm').text} OR ${ilike('pkg.fileName', ':searchTerm').text})`,
        {
          searchTerm: `%${searchQuery}%`,
        },
      );
    }

    if (packageType && packageType.length > 0) {
      const conditions: string[] = [];
      const parameters: any = {};

      if (packageType.includes('dev')) {
        conditions.push('pkg.isDev = :isDev');
        parameters.isDev = true;
      }
      if (packageType.includes('direct')) {
        conditions.push(
          '(pkg.isDev = :isNotDev AND pkg.isTransitive = :isNotTransitive)',
        );
        parameters.isNotDev = false;
        parameters.isNotTransitive = false;
      }
      if (packageType.includes('transitive')) {
        conditions.push('pkg.isTransitive = :isTransitive');
        parameters.isTransitive = true;
      }
      if (conditions.length > 0) {
        qb.andWhere(`(${conditions.join(' OR ')})`, parameters);
      }
    }

    if (packageManager?.length > 0) {
      qb.andWhere('pkg.ecosystem IN (:...packageManager)', { packageManager });
    }
    if (packageSource?.length > 0) {
      qb.andWhere('pkg.fileName IN (:...packageSource)', { packageSource });
    }

    const total = await qb.getCount();
    const packagesEntities = await qb
      .skip((page - 1) * limit)
      .take(limit)
      .getMany();
    const packages = packagesEntities.map(mapScaPackageEntityToInterface);
    const totalPages = Math.ceil(total / limit);

    return {
      projectId,
      page,
      limit,
      total,
      totalPages,
      packages,
    };
  }

  /**
   * Load the license overrides of the project's organization as a Map. The
   * organization is resolved from the project, never taken from the caller:
   * the license routes only check access to the project. No
   * resolved organization, no override.
   */
  private async loadOverrides(
    projectId: string,
  ): Promise<Map<string, LicenseCategory> | undefined> {
    const organizationId =
      await this.projectOrgResolver.resolveOrgId(projectId);
    if (!organizationId) return undefined;
    const rows = await this.licenseOverrideRepo.find({
      where: { organizationId },
    });
    if (rows.length === 0) return undefined;
    const map = new Map<string, LicenseCategory>();
    for (const row of rows) {
      map.set(row.spdxId, row.category as LicenseCategory);
    }
    return map;
  }

  private filterByPackageType<
    T extends { isDev?: boolean; isTransitive?: boolean },
  >(packages: T[], packageType?: string[]): T[] {
    if (!packageType || packageType.length === 0) return packages;
    return packages.filter((pkg) => {
      if (packageType.includes('dev') && pkg.isDev) return true;
      if (packageType.includes('direct') && !pkg.isDev && !pkg.isTransitive)
        return true;
      if (packageType.includes('transitive') && pkg.isTransitive) return true;
      return false;
    });
  }

  /**
   * Returns aggregated license statistics for all SCA packages in a project.
   */
  @Span()
  async getProjectLicenseSummary(dto: {
    projectId: string;
    branch?: string;
    packageType?: string[];
  }): Promise<GetProjectLicenseSummaryResponse> {
    const { projectId, packageType } = dto;
    // Same logical branch partition as the package list / resolver.
    const branches = await this.getScaEffectiveBranches(projectId, dto.branch);

    const [allPackagesRaw, overrides] = await Promise.all([
      this.scaDetectedRepo.find({
        where: { projectId, branch: In(branches) },
        select: [
          'id',
          'licenses',
          'licenseExpression',
          'isDev',
          'isTransitive',
          'isLicenseIgnored',
        ],
      }),
      this.loadOverrides(projectId),
    ]);

    const allPackages = this.filterByPackageType(allPackagesRaw, packageType);
    const ignoredCount = allPackages.filter((p) => p.isLicenseIgnored).length;
    const activePackages = allPackages.filter((p) => !p.isLicenseIgnored);
    const totalPackages = activePackages.length;
    let packagesWithLicenses = 0;
    let packagesWithoutLicenses = 0;

    // Count occurrences per SPDX ID (for the license list table)
    const licenseCounts = new Map<string, number>();

    // Count per-package effective risk (using expression when available)
    let permissiveCount = 0;
    let weakCopyleftCount = 0;
    let strongCopyleftCount = 0;
    let unknownCount = 0;

    for (const pkg of activePackages) {
      const licenses = pkg.licenses;
      if (licenses && licenses.length > 0) {
        packagesWithLicenses++;

        // Count effective licenses (respects OR — only count chosen branch)
        let licensesToCount = licenses;
        if (pkg.licenseExpression) {
          const effective = getEffectiveLicenses(
            pkg.licenseExpression,
            overrides,
          );
          if (effective.size > 0) {
            licensesToCount = licenses.filter((l) => effective.has(l));
            if (licensesToCount.length === 0) licensesToCount = licenses;
          }
        }
        for (const lic of licensesToCount) {
          licenseCounts.set(lic, (licenseCounts.get(lic) || 0) + 1);
        }

        // Effective risk per package — respects OR/AND from expression
        const effectiveCategory = getHighestRiskCategory(
          licenses,
          overrides,
          pkg.licenseExpression,
        );
        switch (effectiveCategory) {
          case LicenseCategory.PERMISSIVE:
            permissiveCount++;
            break;
          case LicenseCategory.WEAK_COPYLEFT:
            weakCopyleftCount++;
            break;
          case LicenseCategory.STRONG_COPYLEFT:
            strongCopyleftCount++;
            break;
          default:
            unknownCount++;
            break;
        }
      } else {
        packagesWithoutLicenses++;
      }
    }

    // Build license summary items with categorization
    const licenses: LicenseSummaryItem[] = [];
    for (const [spdxId, count] of licenseCounts.entries()) {
      const info = getLicenseInfo(spdxId, overrides);
      licenses.push({
        spdxId: info.spdxId,
        name: info.name,
        category: info.category,
        risk: info.risk,
        riskDescription: info.riskDescription,
        count,
      });
    }

    // Packages without any license are counted as Unknown
    unknownCount += packagesWithoutLicenses;
    if (packagesWithoutLicenses > 0) {
      const unknownInfo = getLicenseInfo('UNKNOWN', overrides);
      const existingUnknown = licenses.find((l) => l.spdxId === 'UNKNOWN');
      if (existingUnknown) {
        existingUnknown.count += packagesWithoutLicenses;
      } else {
        licenses.push({
          spdxId: unknownInfo.spdxId,
          name: unknownInfo.name,
          category: unknownInfo.category,
          risk: unknownInfo.risk,
          riskDescription: unknownInfo.riskDescription,
          count: packagesWithoutLicenses,
        });
      }
    }

    // Sort by risk severity, then by count descending
    const riskOrder = { HIGH: 0, UNKNOWN: 1, MEDIUM: 2, NONE: 3 };
    licenses.sort((a, b) => {
      const riskDiff = (riskOrder[a.risk] ?? 4) - (riskOrder[b.risk] ?? 4);
      if (riskDiff !== 0) return riskDiff;
      return b.count - a.count;
    });

    return {
      projectId,
      totalPackages,
      packagesWithLicenses,
      packagesWithoutLicenses,
      permissiveCount,
      weakCopyleftCount,
      strongCopyleftCount,
      unknownCount,
      ignoredCount,
      licenses,
    };
  }

  /**
   * Returns all packages that use a specific license (by SPDX ID).
   */
  @Span()
  async getPackagesByLicense(dto: {
    projectId: string;
    spdxId: string;
    branch?: string;
    packageType?: string[];
  }) {
    const { projectId, spdxId, packageType } = dto;
    // Same logical branch partition as the license summary / resolver.
    const branches = await this.getScaEffectiveBranches(projectId, dto.branch);

    const [allPackagesRaw, overrides] = await Promise.all([
      this.scaDetectedRepo.find({
        where: { projectId, branch: In(branches) },
        select: [
          'id',
          'packageName',
          'packageVersion',
          'ecosystem',
          'licenses',
          'licenseExpression',
          'isTransitive',
          'isDev',
          'isLicenseIgnored',
        ],
      }),
      this.loadOverrides(projectId),
    ]);

    const allPackages = this.filterByPackageType(allPackagesRaw, packageType);

    // For UNKNOWN, match packages with no licenses at all
    let matchingPackages;
    if (spdxId === 'UNKNOWN') {
      matchingPackages = allPackages.filter(
        (pkg) => !pkg.licenses || pkg.licenses.length === 0,
      );
    } else {
      matchingPackages = allPackages.filter((pkg) => {
        if (!pkg.licenses || !pkg.licenses.includes(spdxId)) return false;

        // If the package has an OR expression, check if spdxId is in the effective set
        if (pkg.licenseExpression) {
          const effective = getEffectiveLicenses(
            pkg.licenseExpression,
            overrides,
          );
          if (effective.size > 0) {
            return effective.has(spdxId);
          }
        }
        return true;
      });
    }

    const info = getLicenseInfo(spdxId, overrides);

    return {
      spdxId: info.spdxId,
      name: info.name,
      category: info.category,
      risk: info.risk,
      riskDescription: info.riskDescription,
      totalCount: matchingPackages.length,
      packages: matchingPackages.map((pkg) => ({
        id: pkg.id,
        packageName: pkg.packageName,
        packageVersion: pkg.packageVersion,
        ecosystem: pkg.ecosystem,
        licenses: pkg.licenses || [],
        isTransitive: pkg.isTransitive,
        isDev: pkg.isDev,
        isLicenseIgnored: pkg.isLicenseIgnored,
      })),
    };
  }

  /**
   * Returns all known licenses with their default categories and any org-level overrides.
   */
  @Span()
  async getLicenseClassifications(dto: { organizationId: string }) {
    const { organizationId } = dto;

    const allLicenses = getAllKnownLicenses();
    const knownSpdxIds = new Set(allLicenses.map((l) => l.spdxId));

    const overrides = await this.licenseOverrideRepo.find({
      where: { organizationId },
    });
    const overrideMap = new Map<string, string>();
    for (const o of overrides) {
      overrideMap.set(o.spdxId, o.category);
    }

    const licenses = allLicenses.map((lic) => {
      const overriddenCategory = overrideMap.get(lic.spdxId);
      return {
        spdxId: lic.spdxId,
        name: lic.name,
        defaultCategory: lic.defaultCategory,
        currentCategory: overriddenCategory ?? lic.defaultCategory,
        isOverridden: !!overriddenCategory,
        isCustom: false,
      };
    });

    // Include overridden SPDX IDs that are not in the known list (custom/unknown)
    for (const o of overrides) {
      if (!knownSpdxIds.has(o.spdxId)) {
        licenses.push({
          spdxId: o.spdxId,
          name: o.spdxId,
          defaultCategory: LicenseCategory.UNKNOWN,
          currentCategory: o.category,
          isOverridden: true,
          isCustom: true,
        });
      }
    }

    return { licenses };
  }

  /**
   * Updates license classification overrides for an organization.
   */
  @Span()
  async updateLicenseClassifications(dto: {
    organizationId: string;
    overrides: Array<{ spdxId: string; category: string }>;
  }) {
    const { organizationId, overrides } = dto;
    const validCategories = new Set([
      LicenseCategory.PERMISSIVE,
      LicenseCategory.WEAK_COPYLEFT,
      LicenseCategory.STRONG_COPYLEFT,
      LicenseCategory.UNKNOWN,
    ]);

    const entities: ScaLicenseOverride[] = [];
    for (const o of overrides) {
      if (!validCategories.has(o.category as LicenseCategory)) continue;
      const entity = new ScaLicenseOverride();
      entity.organizationId = organizationId;
      entity.spdxId = o.spdxId;
      entity.category = o.category;
      entities.push(entity);
    }

    if (entities.length > 0) {
      await this.licenseOverrideRepo.save(entities);
    }

    return { success: true, updatedCount: entities.length };
  }

  /**
   * Resets all license classification overrides for an organization.
   */
  @Span()
  async resetLicenseClassifications(dto: { organizationId: string }) {
    await this.licenseOverrideRepo.delete({
      organizationId: dto.organizationId,
    });
    return { success: true };
  }

  /**
   * Deletes a single custom license override for an organization.
   * Only allows deletion of custom licenses (not in the known SPDX list).
   */
  @Span()
  async deleteLicenseOverride(dto: { organizationId: string; spdxId: string }) {
    const { organizationId, spdxId } = dto;

    const knownSpdxIds = new Set(getAllKnownLicenses().map((l) => l.spdxId));
    if (knownSpdxIds.has(spdxId)) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message:
          'Cannot delete a known SPDX license. Use category override instead.',
      });
    }

    const result = await this.licenseOverrideRepo.delete({
      organizationId,
      spdxId,
    });

    if (!result.affected || result.affected === 0) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'License override not found',
      });
    }

    return { success: true };
  }

  /**
   * Manually assigns a license SPDX ID to a specific package.
   */
  @Span()
  async assignPackageLicense(dto: {
    projectId: string;
    packageId: string;
    spdxId: string;
  }) {
    const { projectId, packageId, spdxId } = dto;

    const pkg = await this.scaDetectedRepo.findOne({
      where: { id: packageId, projectId },
    });
    if (!pkg) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'Package not found',
      });
    }

    const currentLicenses = pkg.licenses || [];
    const updatedLicenses = currentLicenses.filter(
      (l) => l !== 'UNKNOWN' && l !== '',
    );
    if (!updatedLicenses.includes(spdxId)) {
      updatedLicenses.push(spdxId);
    }

    pkg.licenses = updatedLicenses;
    await this.scaDetectedRepo.save(pkg);

    return { success: true };
  }

  @Span()
  async setPackageLicenseIgnored(dto: {
    projectId: string;
    packageId: string;
    ignored: boolean;
  }) {
    const { projectId, packageId, ignored } = dto;

    const pkg = await this.scaDetectedRepo.findOne({
      where: { id: packageId, projectId },
    });
    if (!pkg) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'Package not found',
      });
    }

    pkg.isLicenseIgnored = ignored;
    await this.scaDetectedRepo.save(pkg);

    return { success: true };
  }

  /**
   * Returns a single SCA vulnerability by its detection ID.
   */
  @Span()
  async getScaVulnerabilityByIdInProject(dto: {
    projectId: string;
    vulnerabilityId: string;
  }): Promise<GetProjectVulnerabilityByIdResponse> {
    const { projectId, vulnerabilityId } = dto;

    const detection = await this.scaVulnDetectRepo.findOne({
      where: { id: vulnerabilityId, projectId: projectId },
      relations: [
        'historyItems',
        'scaDetectedPackage',
        'scaAutofixRecords',
        'vulnerability',
        'vulnerability.aliases',
        'vulnerability.references',
        'vulnerability.severities',
        'vulnerability.affected',
        'vulnerability.affected.ranges',
        'vulnerability.affected.ranges.events',
      ],
    });

    if (!detection) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: `Vulnerability detection not found in project`,
      });
    }

    // Dedupe userIds across history items + parallel fetch via
    // Promise.allSettled (no whole-batch failure on a single bad user).
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
    const historyItemsWithUserDetails: HistoryItemInterface[] = (
      detection.historyItems || []
    ).map((item) => ({
      ...item,
      user: userMap.get(item.userId) ?? null,
      date: item.date.toISOString(),
    }));

    const scaResponse = mapScaDetectionEntityToInterface(
      detection,
      this.cvssExplainer,
    );
    scaResponse.base.historyItems = { items: historyItemsWithUserDetails };

    // For transitive deps with no import locations, find the closest ancestor in the
    // dependency path that has import locations in the DB.
    // Path format: [vulnerable_pkg, ..., direct_dep, root_project]
    // We skip index 0 (the package itself) and the last element (root project, not in DB).
    const pkg = detection.scaDetectedPackage;
    if (
      pkg &&
      pkg.isTransitive &&
      (!pkg.importLocations || pkg.importLocations.length === 0) &&
      pkg.path &&
      pkg.path.length > 2 &&
      scaResponse.library
    ) {
      let found = false;

      // Pass 1: Look for an ancestor in the path that has importLocations
      for (let i = pkg.path.length - 2; i >= 1; i--) {
        const entry = pkg.path[i];
        const atIndex = entry.lastIndexOf('@');
        if (atIndex <= 0) continue;
        const ancestorName = entry.substring(0, atIndex);

        const ancestorPkg = await this.scaDetectedRepo
          .createQueryBuilder('pkg')
          .select('pkg.importLocations')
          .where('pkg.projectId = :projectId', { projectId })
          .andWhere('pkg.packageName = :name', { name: ancestorName })
          .andWhere('pkg.branch = :branch', { branch: pkg.branch })
          .andWhere('pkg.importLocations IS NOT NULL')
          .andWhere(HAS_IMPORT_LOCATIONS_SQL)
          .getOne();
        if (ancestorPkg?.importLocations) {
          scaResponse.library.importLocations = ancestorPkg.importLocations.map(
            (loc) => ({
              file: loc.file,
              line: loc.line,
              content: loc.content ?? '',
            }),
          );
          found = true;
          break;
        }
      }

      // Pass 2: If no ancestor in path has importLocations, look for a package
      // with the same npm scope that has importLocations (e.g. @aws-sdk/s3-request-presigner
      // for @aws-sdk/client-s3)
      if (!found) {
        for (let i = pkg.path.length - 2; i >= 1; i--) {
          const entry = pkg.path[i];
          const atIndex = entry.lastIndexOf('@');
          if (atIndex <= 0) continue;
          const ancestorName = entry.substring(0, atIndex);

          // Check if this ancestor is a scoped package (e.g. @aws-sdk/client-s3)
          const scopeMatch = ancestorName.match(/^(@[^/]+)\//);
          if (!scopeMatch) continue;
          const scope = scopeMatch[1];

          const scopedPkg = await this.scaDetectedRepo
            .createQueryBuilder('pkg')
            .select('pkg.importLocations')
            .where('pkg.projectId = :projectId', { projectId })
            .andWhere(ilike('pkg.packageName', ':scope').text, {
              scope: `${scope}/%`,
            })
            .andWhere('pkg.branch = :branch', { branch: pkg.branch })
            .andWhere('pkg.importLocations IS NOT NULL')
            .andWhere(HAS_IMPORT_LOCATIONS_SQL)
            .limit(1)
            .getOne();
          if (scopedPkg?.importLocations) {
            scaResponse.library.importLocations = scopedPkg.importLocations.map(
              (loc) => ({
                file: loc.file,
                line: loc.line,
                content: loc.content ?? '',
              }),
            );
            found = true;
            break;
          }
        }
      }
    }

    // Check if project has been parsed (code-graph assistant available).
    // GetProjectBranches is one indexed read in global-
    // management; ProjectService/Get also counted the project's
    // vulnerabilities back in this service.
    const { branches } = await safeGrpcCall(
      this.projectServiceClient.getProjectBranches({ projectId }),
    );
    const isProjectParsed = hasParsedBranch(branches);

    return {
      projectId,
      vulnerabilityId,
      sca: scaResponse,
      isProjectParsed,
    };
  }

  /**
   * Deletes libraries that were not re-detected in the current scan for the specific branch.
   * It now works by checking which packages were not "seen" (marked with the current scanId).
   * Packages are now scoped by branch, so this only affects packages from the scanned branch.
   * Optimized to yield to event loop periodically.
   */
  private async removeMissingLibs(
    projectId: string,
    scanId: string,
    branch?: string,
    projectContext?: ScaProjectContext | null,
  ) {
    const branchValue = branch || '';
    // Resolve the FULL logical branch partition. The empty-string
    // partition ('') — produced by no-branch scans and the legacy column
    // default — is the same logical branch as the project's canonical default
    // branch, so finalizing 'main' must also heal orphaned '' rows left by an
    // earlier no-branch scan. A real feature branch stays scoped to itself.
    // The scope is the scan's project context when it could be read
    // ; the resolver's own read otherwise, as before.
    const effectiveBranches = projectContext
      ? resolveScaEffectiveBranches(projectContext.scoringBranches, branchValue)
      : await this.getScaEffectiveBranches(projectId, branchValue);
    this.logger.log(
      `[Cleanup] Starting cleanup for scan ${scanId}, branch='${branchValue}', effectiveBranches=[${effectiveBranches
        .map((b) => `'${b}'`)
        .join(', ')}] (input branch='${branch}')...`,
    );

    // 1. Find all packages for this project AND logical branch that were NOT marked during this scan.
    const libsToRemove = await this.scaDetectedRepo.find({
      where: {
        projectId,
        branch: In(effectiveBranches),
        lastScanId: Not(scanId),
      },
    });

    this.logger.log(
      `[Cleanup] Query: projectId=${projectId}, effectiveBranches=[${effectiveBranches.join(
        ', ',
      )}], lastScanId != '${scanId}' -> found ${libsToRemove.length} packages`,
    );

    if (libsToRemove.length === 0) {
      this.logger.log('[Cleanup] No missing libraries to remove.');
      return;
    }

    this.logger.warn(
      `[Cleanup] Found ${libsToRemove.length} libraries to remove as they were not detected in scan ${scanId} for branch ${branchValue || 'default'}.`,
    );

    // Batch fetch all detections for libraries to remove, filtered by branch
    const libIds = libsToRemove.map((lib) => lib.id);
    const allDetections = await this.scaVulnDetectRepo.find({
      where: {
        scaDetectedPackage: { id: In(libIds) },
        branch: In(effectiveBranches),
      },
      relations: ['scaDetectedPackage'],
    });

    // Group detections by library
    const detectionsByLib = new Map<string, ScaVulnerabilityDetections[]>();
    for (const det of allDetections) {
      const libId = det.scaDetectedPackage.id;
      if (!detectionsByLib.has(libId)) {
        detectionsByLib.set(libId, []);
      }
      detectionsByLib.get(libId)!.push(det);
    }

    // Process in batches with yielding
    const resolvedDetections: ScaVulnerabilityDetections[] = [];
    const resolvedVulnerabilityIds: string[] = [];
    // One instant for the cleanup: its rows are written by one UPDATE.
    const cleanupResolvedAt = new Date();
    const historyItems: HistoryItem[] = [];
    const historyRecords: VulnerabilityDetectionHistory[] = [];

    for (const lib of libsToRemove) {
      const detections = detectionsByLib.get(lib.id) || [];

      for (const det of detections) {
        // Same gate as the in-scan sweep. A confirm left open here would stay
        // open for good: the package row is removed below (FK SET NULL).
        if (shouldAutoResolveScaOnDisappearance(det)) {
          det.currentState = 'resolved';
          const resolvedAt = cleanupResolvedAt;
          // Same statement as the other auto-resolve site: the machine did it.
          applyTriageToDetection(
            det,
            { status: 'resolved' },
            resolvedAt,
            'system',
          );
          resolvedDetections.push(det);
          resolvedVulnerabilityIds.push(det.id);

          const historyItem = this.historyItemRepo.create({
            type: 'status_change',
            value: 'resolved',
            date: resolvedAt,
            source: 'system',
            scaVulnerabilityDetection: det,
          });
          historyItems.push(historyItem);

          // NB: this row records that the package DISAPPEARED, so it is
          // deliberately not a sighting — `last_detected_at` stays where the
          // last scan that actually saw the finding left it.
          const hist = this.vulnHistoryRepo.create({
            scanId,
            detectedAt: resolvedAt,
            scaVulnerabilityDetection: det,
          });
          historyRecords.push(hist);
        }
      }
    }

    // Grouped writes: the resolutions in one UPDATE per 500,
    // their status and history rows in one INSERT per 500.
    await this.writeAutoResolutions(resolvedDetections);
    await this.insertHistoryItems(historyItems);
    await this.insertDetectionHistory(historyRecords);

    // Close issues for resolved vulnerabilities (dependencies removed)
    if (resolvedVulnerabilityIds.length > 0) {
      try {
        this.logger.log(
          `[Cleanup] Closing issues for ${resolvedVulnerabilityIds.length} resolved SCA vulnerabilities...`,
        );
        await this.issueIntegrationService.closeIssuesForResolvedVulnerabilities(
          projectId,
          resolvedVulnerabilityIds,
          'dependency_removed',
          'sca',
          { settings: projectContext?.issueSettings },
        );
      } catch (error: any) {
        // Don't fail the cleanup if issue closing fails
        this.logger.warn(
          `[Cleanup] Failed to close issues for resolved vulnerabilities: ${error?.message || error}`,
        );
      }
    }

    // Remove libraries in chunks of 500, by id. Their detections keep their
    // rows: the foreign key is ON DELETE SET NULL, and the package entity has
    // no relation for `remove()` to cascade to.
    for (let i = 0; i < libIds.length; i += SCA_WRITE_CHUNK) {
      await this.scaDetectedRepo
        .createQueryBuilder()
        .delete()
        .from(ScaDetectedPackages)
        .whereInIds(libIds.slice(i, i + SCA_WRITE_CHUNK))
        .execute();
      await this.yieldToEventLoop();

      this.logger.log(
        `[Cleanup] Removed ${Math.min(i + SCA_WRITE_CHUNK, libIds.length)}/${libIds.length} libraries...`,
      );
    }

    this.logger.log(`[Cleanup] Cleanup completed for scan ${scanId}.`);
  }

  // --- Private Helper Methods ---

  /**
   * Compute CVSS 4.0 base score from an OSV affected entry.
   * Checks package-specific severity first, then global OSV severities as fallback.
   */
  private computeCvss4FromAffected(
    affected: VulnerabilityOsvAffected,
    severity: string,
  ): Cvss4BaseResult | null {
    const cvss4Sev = affected.severity?.find((s) => s.type === 'CVSS_V4');
    const cvss3Sev = affected.severity?.find((s) => s.type === 'CVSS_V3');

    // Fall back to global OSV severity if package-specific is missing
    const osv = affected.vulnerability;
    const globalCvss4 = osv?.severities?.find((s) => s.type === 'CVSS_V4');
    const globalCvss3 = osv?.severities?.find((s) => s.type === 'CVSS_V3');

    return this.cvssCalculator.computeCvss4Base({
      cvss4Vector: cvss4Sev?.score ?? globalCvss4?.score ?? null,
      cvss3Vector: cvss3Sev?.score ?? globalCvss3?.score ?? null,
      severity,
    });
  }

  /**
   * Determines the highest severity for a match using a definitive fallback strategy.
   * @param affected The vulnerability context for a specific package.
   * @returns An object with severity string and CVSS score.
   */
  private getSeverityAndCvss(affected: VulnerabilityOsvAffected): {
    severity: string;
    cvssScore: number;
  } {
    const osv = affected.vulnerability;
    let score = 0; // Priority 1: Use the CVSS score SPECIFIC to the affected package, if it exists.

    // This is the most precise information.
    score = calculateCvssScoreFromSeverityArray(affected.severity);
    if (score > 0) {
      this.logger.debug(
        `Using package-specific CVSS score for ${osv.id}: ${score}`,
      );
    }

    // Priority 2: If no specific score, use the GLOBAL CVSS score.
    if (score === 0) {
      score = calculateOsvCvssScore(osv);
      if (score > 0) {
        this.logger.debug(`Using global CVSS score for ${osv.id}: ${score}`);
      }
    }

    // Convert calculated score to a severity string
    if (score >= 9.0) return { severity: 'CRITICAL', cvssScore: score };
    if (score >= 7.0) return { severity: 'HIGH', cvssScore: score };
    if (score >= 4.0) return { severity: 'MEDIUM', cvssScore: score };
    if (score > 0) return { severity: 'LOW', cvssScore: score }; // Priority 3 (Fallback): Use the generic text-based severity from the global level.

    const specificSeverity = osv.severities?.find(
      (s) => s.type === 'DATABASE_SPECIFIC',
    );
    if (specificSeverity?.score) {
      const severityString = specificSeverity.score.toUpperCase();
      if (['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].includes(severityString)) {
        this.logger.debug(
          `Using fallback text-based severity for ${osv.id}: ${severityString}`,
        );
        return { severity: severityString, cvssScore: 0 };
      }
    } // Priority 4 (Default): Default to MEDIUM if no other info is found.

    this.logger.warn(
      `No parsable severity found for ${osv.id}. Defaulting to MEDIUM.`,
    );
    return { severity: 'MEDIUM', cvssScore: 0 };
  }

  private mapSeverityToPriority(severity: string): string {
    switch (severity) {
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

  private async addScaHistory(
    detection: ScaVulnerabilityDetections,
    scanId: string,
  ) {
    const hist = this.vulnHistoryRepo.create({
      scanId,
      detectedAt: new Date(),
      scaVulnerabilityDetection: detection,
    });
    await this.vulnHistoryRepo.save(hist);
  }
}
