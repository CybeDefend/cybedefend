import { rawIdent } from 'src/core/db/raw-sql';
import { Inject, Injectable, OnModuleInit, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ClientGrpc, RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { Span } from 'nestjs-otel';
import { Logger } from 'nestjs-pino';

import { IacVulnerabilityDetections } from 'src/entities/iac-vulnerability-detections.entity';
import { SastVulnerabilityDetections } from 'src/entities/sast-vulnerability-detections.entity';
import { CicdVulnerabilityDetections } from 'src/entities/cicd-vulnerability-detections.entity';
import { SecretVulnerabilityDetections } from 'src/entities/secret-vulnerability-detections.entity';
import { AutoFixRecord } from 'src/entities/autofix-record.entity';
import { ScaVulnerabilityDetections } from 'src/entities/sca-vulnerability-detections.entity';
import { Repository } from 'typeorm';
import { currentDialect, ilike } from '@cybedefend/db-dialect';
import type { Dialect } from '@cybedefend/db-dialect';
import { ResultService } from '../result/result.service';
import { applyPriorityFilter } from '../result/priority-filter.helper';
import { effectiveSeveritySql } from '../cvss/effective-severity-sql';
import { applyExploitabilityVerdictFilter } from '../result/exploitability-verdict-filter.helper';
import { applyLanguageAndSourcePathFilters } from '../result/path-language-filter.helper';
import { fetchDistinctVulnerabilityLanguages } from '../result/distinct-languages.helper';
import { clampListPageSize } from '../result/list-page-size.util';
import { emptyAutofixCountByType } from '../result/slim-list.util';
import { findCybeAnalysedDetectionIds } from '../result/cybe-analysed-detections.helper';
import {
  CatalogRule,
  catalogRuleIdOf,
  catalogVulnIdsOf,
  SastIacUtilsService,
  SecretHistoryRule,
  secretHistoryRuleOf,
} from './sast-iac.utils';
import {
  inlineIgnoreNeedsCatalogRule,
  isNeutralizedByInlineIgnore,
  isSecretFinding,
  neutralisingForm,
} from './inline-ignore/inline-ignore';
import {
  codeOccurrenceKey,
  compareOccurrenceEntries,
  normalizeOccurrenceLine,
  occurrenceTieBreak,
} from '../findings-export/fingerprint.util';
import {
  HistoryPassOutcome,
  parseHistoryPassOutcome,
  ScanQueueService,
} from '../scan-queue/scan-queue.service';
import {
  readScanRecordMeta,
  ScanMetaCache,
  ScanRecordMeta,
} from '../scan-queue/scan-meta-cache.service';
import { SecurityContextCacheService } from '../security-context/security-context-cache.service';
import {
  GetProjectIacVulnerabilitiesRequest,
  GetProjectIacVulnerabilitiesResponse,
  GetProjectCicdVulnerabilitiesRequest,
  GetProjectCicdVulnerabilitiesResponse,
  GetProjectSecretVulnerabilitiesRequest,
  GetProjectSecretVulnerabilitiesResponse,
  GetProjectSastVulnerabilitiesRequest,
  GetProjectSastVulnerabilitiesResponse,
  GetProjectVulnerabilityByIdRequest,
  GetProjectVulnerabilityByIdResponse,
  ScanAddResultRequest,
  ScanAddResultResponse,
  ScanProjectInfo,
  VulnerabilityDtoRequest,
  VulnerabilityIac,
  VulnerabilityCicd,
  VulnerabilitySecret,
  VulnerabilitySast,
  HistoryItem,
} from '@grpc/analysis-reporting/result';
import { ProjectInformationsResponse } from '@grpc/global-management/project';
import {
  PROJECT_SERVICE_NAME,
  ProjectServiceClient,
  USER_SERVICE_NAME,
  UserServiceClient,
} from '@grpc/global-management/global_management';
import { UserInformationsResponse } from '@grpc/global-management/user';
import {
  mapIacDetectionToProto,
  mapCicdDetectionToProto,
  mapSecretDetectionToProto,
  mapSastDetectionToProto,
  mapSastDetectionEntityToListInterface,
  mapIacDetectionEntityToListInterface,
  mapCicdDetectionEntityToListInterface,
  mapSecretDetectionEntityToListInterface,
} from './sast-iac.mapper';
import { CvssExplainerService } from '../cvss/cvss-explainer.service';
import {
  SCAN_SERVICE_NAME,
  ScanServiceClient,
} from '@grpc/security-scanning/security_scanning';
import { GetLastScanStatusResponse } from '@grpc/security-scanning/scan';
import { safeGrpcCall } from '@grpc/wrapper-grpc.module';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Optional } from '@nestjs/common';
import {
  DIFF_SCAN_SINK,
  DiffScanLauncherInfo,
  DiffScanSink,
} from '../../edition/ports/diff-scan-sink.port';
import { hasParsedBranch } from '../../core/utils/project-read.util';
import { lookupProjectWithScaBranches } from '../sca/sca-branch.util';

/**
 * Statuses an `autofix_records` row can carry when the attempt did
 * NOT produce a usable fix. `hasAutofix` splits the AutoFix page in two lists
 * ("To Fix" / "Fix Proposed"), so a finding whose only attempt failed has to
 * stay on the left-hand side: counting the mere existence of a row moved it to
 * "Fix Proposed" with nothing to propose. The dashboard used to paper over
 * this by re-filtering the page it received while keeping the server's
 * totalCount — the pagination lied. The predicate is the backend's now.
 *
 * The async pipeline deletes a non-successful record on finalize, but rows
 * from the synchronous era still carry these statuses in production.
 */
export const AUTOFIX_UNSUCCESSFUL_STATUSES = [
  '',
  'error',
  'failed',
  'no_fix',
  'noop',
];

const AUTOFIX_UNSUCCESSFUL_STATUSES_SQL = AUTOFIX_UNSUCCESSFUL_STATUSES.map(
  (s) => `'${s}'`,
).join(', ');

/**
 * `SELECT 1 …` body matching a SUCCESSFUL autofix record for the detection
 * of query-builder alias `detectionAlias`. The raw text is not rewritten by
 * the query builder, so both names go through `rawIdent`: quoted on
 * PostgreSQL, as written on MySQL.
 */
export const successfulAutofixSubquery = (
  detectionAlias: string,
  dialect: Dialect = currentDialect(),
): string =>
  `SELECT 1 FROM autofix_records afr WHERE ${rawIdent('afr.detectionId', dialect)} = ${rawIdent(`${detectionAlias}.id`, dialect)}` +
  ` AND afr.status NOT IN (${AUTOFIX_UNSUCCESSFUL_STATUSES_SQL})`;

/** JS mirror of the SQL predicate above, for in-memory post-filtering. */
export const hasSuccessfulAutofixRecord = (detection: {
  autofixRecords?: { status?: string }[];
}): boolean =>
  (detection.autofixRecords || []).some(
    (r) =>
      !AUTOFIX_UNSUCCESSFUL_STATUSES.includes((r?.status || '').toLowerCase()),
  );

@Injectable()
export class SastIacService implements OnModuleInit {
  private projectServiceClient!: ProjectServiceClient;
  private userServiceClient!: UserServiceClient;
  private scanServiceClient!: ScanServiceClient;

  constructor(
    @InjectRepository(SastVulnerabilityDetections)
    private readonly sastVulnDetectRepository: Repository<SastVulnerabilityDetections>,
    private readonly logger: Logger,
    @InjectRepository(IacVulnerabilityDetections)
    private readonly iacVulnDetectRepository: Repository<IacVulnerabilityDetections>,
    @InjectRepository(CicdVulnerabilityDetections)
    private readonly cicdVulnDetectRepository: Repository<CicdVulnerabilityDetections>,
    @InjectRepository(SecretVulnerabilityDetections)
    private readonly secretVulnDetectRepository: Repository<SecretVulnerabilityDetections>,
    @InjectRepository(ScaVulnerabilityDetections)
    private readonly scaVulnDetectRepository: Repository<ScaVulnerabilityDetections>,
    @Inject(forwardRef(() => ResultService))
    private readonly resultService: ResultService,
    @Inject(forwardRef(() => SastIacUtilsService))
    private readonly sastIacUtilsService: SastIacUtilsService,
    @Inject('GLOBAL_MANAGEMENT_SERVICE')
    private readonly globalManagementClient: ClientGrpc,
    @Inject('SECURITY_SCANNING_SERVICE')
    private readonly securityScanningClient: ClientGrpc,
    private readonly cvssExplainer: CvssExplainerService,
    private readonly securityContextCache: SecurityContextCacheService,
    @Optional() private readonly schedulerRegistry?: SchedulerRegistry,
    @InjectRepository(AutoFixRecord)
    private readonly autoFixRepo?: Repository<AutoFixRecord>,
    // When set and the scan is a diff scan,
    // findings are routed to the DIFF_SCAN_SINK (isolated ephemeral store,
    // closed code) instead of the real detection tables.
    // Absent in the Community Edition: a diff scan then fails loud with
    // INTERNAL rather than ingest into the real tables.
    @Optional()
    @Inject(DIFF_SCAN_SINK)
    private readonly diffScanSink?: DiffScanSink,
    // Owns the Redis connection used to scope the fingerprint occurrence index
    // to the whole (scan, scanner) instead of a single BullMQ batch. Optional:
    // ScanQueueModule is @Global and present in every real runtime, but the
    // many unit-test modules that build this service do not provide it, and a
    // missing allocator only degrades to the batch-local ranking.
    @Optional()
    private readonly scanQueueService?: ScanQueueService,
    // The scan's fixed metadata (branch, diff flag, …) read
    // once per scan instead of one GetScan per batch. Optional for the same
    // reason as above; without it every batch reads GetScan, as before.
    @Optional()
    private readonly scanMetaCache?: ScanMetaCache,
  ) {}

  /** Synthetic user object for system-originated history actions */
  private getSystemUser(): UserInformationsResponse {
    return {
      id: 'system',
      firstName: 'Cybe',
      lastName: 'Agent',
      email: 'system@internal',
      picture: '',
      role: 'system',
    };
  }

  /**
   * Resolve a set of history-item userIds into a Map<userId, user> in a single
   * parallel batch. Replaces the legacy nested for-loop that fired one serial
   * gRPC per history item (N+1 across vulnerabilities × history items).
   *
   * - 'system' / empty userIds are not fetched; callers substitute getSystemUser().
   * - Failures degrade to null for that user instead of failing the whole batch.
   */
  private async resolveHistoryUsers(
    historyItemSources: Array<
      { historyItems?: { userId?: string }[] } | null | undefined
    >,
  ): Promise<Map<string, UserInformationsResponse | null>> {
    const userIds: string[] = [];
    for (const src of historyItemSources) {
      if (!src || !Array.isArray(src.historyItems)) continue;
      for (const h of src.historyItems) {
        if (h.userId && h.userId !== 'system') userIds.push(h.userId);
      }
    }
    return this.resolveUsersByIds(userIds);
  }

  /**
   * A slim list (`slim: true`, the MCP surface) answers with
   * its page only. What a flat list reads besides the page — the project (name,
   * parsed branches), the last scan, the per-type and autofix counters, the
   * languages facet — is then not read, and `fallback` (the empty value) is
   * returned instead.
   */
  private unlessSlim<T>(
    slim: boolean | undefined,
    fallback: T,
    read: () => Promise<T>,
  ): Promise<T> {
    return slim ? Promise.resolve(fallback) : read();
  }

  /**
   * Resolve users by id in a single parallel batch, each distinct id once.
   * A user that cannot be resolved (deleted, global-management down) maps to
   * null instead of failing the others.
   */
  @Span()
  async resolveUsersByIds(
    userIds: string[],
  ): Promise<Map<string, UserInformationsResponse | null>> {
    const userMap = new Map<string, UserInformationsResponse | null>();
    const ids = Array.from(new Set(userIds));
    if (ids.length === 0) return userMap;
    const results = await Promise.allSettled(
      ids.map((uid) =>
        safeGrpcCall<UserInformationsResponse>(
          this.userServiceClient.getById({ userId: uid }),
        ),
      ),
    );
    results.forEach((res, i) => {
      if (res.status === 'fulfilled') {
        userMap.set(ids[i], res.value);
      } else {
        this.logger.warn(
          `Failed to get user info for ${ids[i]}: ${res.reason}`,
        );
        userMap.set(ids[i], null);
      }
    });
    return userMap;
  }

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
   * The scan's fixed metadata: from the ScanMetaCache when the scan already
   * has an entry, else from GetScan (and then cached). Null when the scan
   * record could not be read — a GetScan error is logged here — so the
   * callers' diff-scan fail-safe decides; nothing is cached in that case.
   */
  private async readScanMeta(scanId: string): Promise<ScanRecordMeta | null> {
    try {
      return await readScanRecordMeta(this.scanMetaCache, scanId, () =>
        safeGrpcCall(this.scanServiceClient.getScan({ scanId })),
      );
    } catch (e) {
      this.logger.warn(
        `Could not retrieve branch for scan ${scanId}: ${(e as Error).message}`,
      );
      return null;
    }
  }

  /**
   * The history rule of a scanner's secrets at finalize: the scan's recorded
   * pass, and the outcome the scanner's last batch sent, which the queue kept
   * until the finalize gate. An outcome Redis cannot answer is read as absent
   * (one WARN): only an `ok` outcome lets the branch's first full pass resolve
   * the secrets it did not report, so a lost one closes nothing.
   */
  private async readSecretHistoryRule(
    scanId: string,
    scannerName: string,
    scanMeta: ScanRecordMeta,
  ): Promise<SecretHistoryRule> {
    let outcome: HistoryPassOutcome | null = null;
    if (this.scanQueueService?.getHistoryPassOutcome) {
      try {
        outcome = await this.scanQueueService.getHistoryPassOutcome(
          scanId,
          scannerName,
        );
      } catch (e) {
        this.logger.warn(
          `HISTORY_OUTCOME_UNREADABLE scan=${scanId} scanner=${scannerName}: ${(e as Error).message}`,
        );
      }
    }
    // The files the scanner dropped for the ignore file. An unreadable set
    // closes nothing.
    let ignoredPaths = new Set<string>();
    if (this.scanQueueService?.getIgnoredPaths) {
      try {
        ignoredPaths = await this.scanQueueService.getIgnoredPaths(
          scanId,
          scannerName,
        );
      } catch (e) {
        this.logger.warn(
          `IGNORED_PATHS_UNREADABLE scan=${scanId} scanner=${scannerName}: ${(e as Error).message}`,
        );
      }
    }
    return secretHistoryRuleOf(scanMeta, outcome, ignoredPaths);
  }

  /**
   * Yield back to the Node.js event loop to let other I/O proceed.
   * Useful when processing large batches to avoid starving other RPC calls.
   */
  private yieldToEventLoop(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve));
  }

  /**
   * Process a list of vulnerabilities with bounded concurrency and periodic yielding.
   * This improves throughput while keeping the event loop responsive.
   */
  private async processVulnsWithConcurrency(
    vulns: any[],
    existingVulnsMap: any,
    existingSastVulnsProcessed: SastVulnerabilityDetections[],
    existingIacVulnsProcessed: IacVulnerabilityDetections[],
    scanId: string,
    projectId: string,
    scannerNameLowerCase: string,
    vulnerabilityType?: string | null,
    branch?: string,
    concurrency = 6,
    yieldEvery = 5,
    occurrenceIndexes?: (number | null)[],
  ): Promise<void> {
    if (!Array.isArray(vulns) || vulns.length === 0) return;

    let index = 0;

    const worker = async () => {
      // Each worker has its own yield counter to ensure regular yielding
      let localProcessedSinceYield = 0;

      while (true) {
        const i = index++;
        if (i >= vulns.length) break;

        const vulnDto = vulns[i];
        await this.sastIacUtilsService.processVulnerability(
          vulnDto,
          existingVulnsMap,
          existingSastVulnsProcessed,
          existingIacVulnsProcessed,
          scanId,
          projectId,
          scannerNameLowerCase,
          vulnerabilityType,
          branch,
          // `?? 0` would turn the UNRANKABLE marker back into index 0 — the
          // very collision computeOccurrenceIndexes emits it to avoid. Absent
          // array (no ranking pass ran at all) still means 0.
          occurrenceIndexes ? (occurrenceIndexes[i] ?? null) : 0,
        );

        // Each worker yields independently to ensure event loop isn't blocked
        localProcessedSinceYield++;
        if (localProcessedSinceYield >= yieldEvery) {
          localProcessedSinceYield = 0;
          await this.yieldToEventLoop();
        }
      }
    };

    const workers = Array.from(
      { length: Math.min(concurrency, vulns.length) },
      () => worker(),
    );
    await Promise.all(workers);
  }

  /**
   * Add scan result to the database for SAST and IAC.
   * Legacy method for backward compatibility - delegates to processSastIacBatch.
   *
   * @param request - The scan result request.
   * @returns The scan result response.
   */
  @Span()
  async addScanResult(
    request: ScanAddResultRequest,
  ): Promise<ScanAddResultResponse> {
    // For backward compatibility, this processes immediately including finalization if isLastRequest
    return this.processSastIacBatchInternal(request, request.isLastRequest);
  }

  /**
   * Process a SAST/IAC scan batch. Called by the BullMQ processor.
   * When isLastRequest is true, runs finalization to mark old vulnerabilities as resolved.
   *
   * @param request The SAST/IAC scan request
   * @returns Processing result
   */
  @Span()
  async processSastIacBatch(
    request: ScanAddResultRequest,
  ): Promise<ScanAddResultResponse> {
    // Run finalization when isLastRequest is true
    return this.processSastIacBatchInternal(request, request.isLastRequest);
  }

  /**
   * Internal method to process SAST/IAC batch with optional finalization.
   *
   * @param request - The scan result request.
   * @param runFinalization - Whether to run finalization
   * @returns The scan result response.
   */
  private async processSastIacBatchInternal(
    request: ScanAddResultRequest,
    runFinalization: boolean,
  ): Promise<ScanAddResultResponse> {
    try {
      const {
        scanId,
        projectId,
        vulnerabilities,
        scannerName,
        vulnerabilityType,
      } = request;

      if (!scanId || !projectId) {
        throw new RpcException({
          code: status.INVALID_ARGUMENT,
          message: 'scanId and projectId are required',
        });
      }

      this.logger.log(
        `[SAST/IAC] Processing batch for project=${projectId}, scan=${scanId}, vulns=${vulnerabilities?.length || 0}`,
      );

      // Get the branch from the scan for vulnerability tracking (and whether
      // this is a diff scan — read from the SAME getScan call, no extra cost).
      // Once per scan since The first batch reads GetScan, the
      // others the ScanMetaCache.
      const scanMeta = await this.readScanMeta(scanId);
      const branch: string | undefined = scanMeta?.branch || undefined;
      const isDiffScan = scanMeta?.isDiffScan === true;

      // Diff-scan fail-safe (mirrors finalizeScan): getScan is the ONLY signal
      // telling a diff scan apart from a normal one (ScanAddResultRequest has no
      // isDiffScan flag). If we couldn't read the scan record, defaulting to a
      // non-diff scan would route a diff scan's findings into the real detection
      // tables and permanently pollute the project's posture. Throw to force a
      // BullMQ retry rather than ingest blind. Nothing is cached in that case,
      // so the retry reads the scan record again.
      if (!scanMeta) {
        throw new RpcException({
          code: status.UNAVAILABLE,
          message: `Cannot determine diff status for scan ${scanId} (scan record unavailable); deferring ingestion`,
        });
      }

      const scannerNameLowerCase = scannerName.toLowerCase();

      // The platform, not the scanner, decides `cybedefend-ignore`.
      // Decided HERE, once, because this is the only point the diff and full
      // paths share: both then see the same kept list. And BEFORE
      // computeOccurrenceIndexes: until now the scanner dropped these issues
      // before sending, so twin occurrence indexes (hence fingerprints) were
      // computed without them — ranking them now would shift the index, then
      // the fingerprint, of every twin that follows a neutralised issue.
      const { kept, keptRules, catalogRules } =
        await this.dropNeutralisedIssues(
          vulnerabilities,
          scanId,
          scannerNameLowerCase,
        );

      // A diff scan's findings are fully isolated — route them
      // to the ephemeral diff_scan_finding store and SKIP the normal ingestion
      // entirely (no dedup/insert into the real detection tables, no finalize).
      // This keeps diff findings out of every posture/stats/cyber-risk query by
      // construction; the agent reads them by scanId (ST-5) and a TTL cron purges
      // them (ST-10).
      if (isDiffScan) {
        // The dependency is @Optional() only for legacy unit-test modules; in
        // every real (worker) module it is provided (by the ee
        // DiffScanFindingModule in the cloud). Fail LOUD if it is somehow
        // missing rather than silently returning success with no findings stored
        // (a data-loss failure mode the `?.` call would otherwise hide).
        if (!this.diffScanSink) {
          throw new RpcException({
            code: status.INTERNAL,
            message:
              'DiffScanFindingService unavailable; cannot store diff-scan findings',
          });
        }
        // A diff finding is named, graded and kept by its catalogue
        // rule. Stored without one, every finding would be dropped and the
        // agent told the change is clean: defer to a BullMQ retry instead.
        if (kept.length > 0 && !catalogRules) {
          this.logger.error(
            `[SAST/IAC] Cannot resolve the catalogue rules of diff scan ${scanId} ` +
              `(scanner=${scannerNameLowerCase}); deferring the batch`,
          );
          throw new RpcException({
            code: status.UNAVAILABLE,
            message: `Cannot resolve the catalogue rules of diff scan ${scanId}; deferring ingestion`,
          });
        }
        // The sink resolves the scanner category itself (from the
        // scanner name, else the docker image) and checks each finding's
        // catalogue severity against the requested SEVERITY filter carried by
        // the proto `vulnerabilityType` field.
        await this.diffScanSink.ingestBatch(
          request,
          kept,
          keptRules,
          scannerNameLowerCase,
        );
        return {
          scanId,
          projectId,
          message: 'Diff scan results stored (isolated)',
          success: true,
        };
      }

      const {
        existingSastVulns,
        existingIacVulns,
        existingCicdVulns,
        existingSecretVulns,
        existingVulnsMap,
      } = await this.sastIacUtilsService.getExistingVulnerabilities(
        projectId,
        scanId,
        scannerNameLowerCase,
        branch,
      );

      const existingSastVulnsProcessed: SastVulnerabilityDetections[] = [];
      const existingIacVulnsProcessed: IacVulnerabilityDetections[] = [];

      const toProcess = this.isIacBatch(vulnerabilityType)
        ? this.deduplicateVulnList(kept)
        : kept;

      // Rank identical findings (same catalogue vuln, same normalised path,
      // same normalised vulnerable code) so that N copies of one pattern get
      // distinct fingerprints. Computed over the WHOLE deduplicated batch
      // before any concurrent worker starts, and allocated per (scan, scanner)
      // so a group straddling a chunk boundary cannot collide.
      const occurrenceIndexes = await this.computeOccurrenceIndexes(
        toProcess,
        scanId,
        scannerNameLowerCase,
        catalogRules && catalogVulnIdsOf(catalogRules),
      );

      // Process with bounded concurrency to utilize CPU/IO better without exhausting DB pool
      await this.processVulnsWithConcurrency(
        toProcess,
        existingVulnsMap,
        existingSastVulnsProcessed,
        existingIacVulnsProcessed,
        scanId,
        projectId,
        scannerNameLowerCase,
        vulnerabilityType,
        branch,
        3, // max concurrency (reduced to keep gRPC responsive)
        2, // yield to event loop every 2 items per worker
        occurrenceIndexes,
      );

      // Only run finalization if explicitly requested
      if (runFinalization) {
        // Read after this batch was processed, so its sightings are in.
        // Shared by the 2 to 4 calls below, as in finalizeScan.
        const sightings =
          await this.sastIacUtilsService.loadCurrentScanSightings(
            projectId,
            scanId,
            branch,
          );
        await this.sastIacUtilsService.finalizeOldScanVulnerabilities(
          existingSastVulns,
          existingSastVulnsProcessed,
          projectId,
          scanId,
          branch,
          sightings,
        );
        await this.sastIacUtilsService.finalizeOldScanVulnerabilities(
          existingIacVulns,
          existingIacVulnsProcessed,
          projectId,
          scanId,
          branch,
          sightings,
        );

        // Keep this inline path symmetric with finalizeScan — CICD
        // detections are never processed via processVulnsWithConcurrency, so
        // they carry no "processed" list; pass [] and let finalization resolve
        // any that disappeared. Gated on presence to avoid the extra work when
        // this scanner has no CICD detections.
        if (existingCicdVulns?.length) {
          await this.sastIacUtilsService.finalizeOldScanVulnerabilities(
            existingCicdVulns,
            [],
            projectId,
            scanId,
            branch,
            sightings,
          );
        }

        // Same for the scanner's secret detections, under the scan's history
        // rule: this request is the last batch, it carries the outcome.
        if (existingSecretVulns?.length) {
          await this.sastIacUtilsService.finalizeOldScanVulnerabilities(
            existingSecretVulns,
            [],
            projectId,
            scanId,
            branch,
            sightings,
            secretHistoryRuleOf(
              scanMeta,
              parseHistoryPassOutcome(request.historyPassOutcome),
              request.ignoredPaths ?? [],
            ),
          );
        }
      }

      return {
        scanId,
        projectId,
        message: 'Scan results added successfully',
        success: true,
      };
    } catch (error) {
      this.logger.error(
        `Error adding scan result: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Finalize a SAST/IAC scan by resolving vulnerabilities that were not detected.
   * This should only be called after ALL batches have been processed.
   *
   * @param projectId The project ID
   * @param scanId The scan ID
   * @param scannerName The scanner that finalized (e.g. 'checkov', 'opengrep').
   *   Resolution is scoped to this scanner's detections .
   * @param onlyType The one detection type to finalize. A SARIF
   *   import carries one type per scan, while one tool (Trivy) reports IaC
   *   findings and secrets alike: an `iac` import must not resolve the
   *   secrets a `secret` import of the same tool stored. Absent (every
   *   scanner scan), every type of the scanner is finalized, as before.
   */
  @Span()
  async finalizeScan(
    projectId: string,
    scanId: string,
    scannerName: string,
    onlyType?: 'sast' | 'iac' | 'cicd' | 'secret',
  ): Promise<void> {
    this.logger.log(
      `[SAST/IAC Finalize] Starting finalization for project=${projectId}, scan=${scanId}`,
    );

    // Get the branch from the scan (and whether it is a diff scan), from the
    // ScanMetaCache the scan's batches filled.
    const scanMeta = await this.readScanMeta(scanId);
    const branch: string | undefined = scanMeta?.branch || undefined;
    const isDiffScan = scanMeta?.isDiffScan === true;
    const scanTypeCsv: string | undefined = scanMeta?.scanType || undefined;
    // Diff scans only: who launched the scan, and with which AI coding agent.
    const launcher: DiffScanLauncherInfo = {
      initializerUserId: scanMeta?.initializerUserId || undefined,
      codingAgent: scanMeta?.codingAgent || undefined,
    };

    // Diff-scan fail-safe: if we couldn't read the scan record, we know neither its
    // branch nor whether it is a diff scan. Finalizing blind would (a) auto-resolve
    // vulns across the wrong/all branches and (b) let a diff scan whose getScan
    // failed resolve real out-of-scope vulns. Skip finalization rather than risk
    // destructive over-resolution.
    if (!scanMeta) {
      this.logger.warn(
        `[SAST/IAC Finalize] Skipping finalization for scan ${scanId} — scan record unavailable (cannot determine branch / diff status)`,
      );
      return;
    }

    // A diff scan (SAST/IaC/secret on changed files only) re-submits
    // findings for a *subset* of the project. Running finalizeOldScanVulnerabilities
    // would auto-resolve every out-of-scope vuln of the (project, branch) that the
    // diff did not re-detect — and close its Jira/GitHub issues. New findings were
    // already ingested/deduped per-batch upstream, so skip finalization entirely.
    if (isDiffScan) {
      // Persist a durable per-scan summary (counts survive the 48h finding TTL)
      // that powers the diff-scan history tab. Recomputed from the
      // findings on every scanner finalization → converges; posture stays
      // isolated (no posture/stats/cyber-risk query reads diff_scan_summary).
      await this.diffScanSink?.upsertSummary(
        scanId,
        projectId,
        branch,
        scanTypeCsv,
        launcher,
      );
      this.logger.log(
        `[SAST/IAC Finalize] Skipping finalization for diff scan ${scanId} (changed-files only; no out-of-scope auto-resolve)`,
      );
      return;
    }

    // Load this scanner's existing detections. We MUST pass the real scanner
    // name: `getExistingVulnerabilities` filters by `scannerType`, and TypeORM
    // treats a literal '*' as `scanner_type = '*'` (matches nothing) — which
    // silently made finalization a no-op and left fixed vulns unresolved.
    // Finalizing per-scanner also avoids any cross-scanner timing
    // race (each scanner resolves only its own detections after its batches).
    const existing = await this.sastIacUtilsService.findExistingDetections(
      projectId,
      scannerName.toLowerCase(),
      branch,
    );
    const kept = <T>(type: typeof onlyType, rows: T[]): T[] =>
      onlyType === undefined || onlyType === type ? rows : [];
    const existingSastVulns = kept('sast', existing.existingSastVulns);
    const existingIacVulns = kept('iac', existing.existingIacVulns);
    const existingCicdVulns = kept('cicd', existing.existingCicdVulns);
    const existingSecretVulns = kept('secret', existing.existingSecretVulns);

    // What the scan sighted, read once — the history of the
    // scan and the sighted detections — and shared by the 2 to 4 calls below,
    // each of which used to read it again (and to reload every detection of
    // the project). Every batch of the scanner is done by now (maybeFinalize).
    const sightings = await this.sastIacUtilsService.loadCurrentScanSightings(
      projectId,
      scanId,
      branch,
    );

    // Finalize with empty processed lists - all existing vulns not in current scan will be resolved
    if (onlyType === undefined || onlyType === 'sast') {
      await this.sastIacUtilsService.finalizeOldScanVulnerabilities(
        existingSastVulns,
        [], // No processed vulns means all existing get marked as resolved
        projectId,
        scanId,
        branch,
        sightings,
      );
    }
    if (onlyType === undefined || onlyType === 'iac') {
      await this.sastIacUtilsService.finalizeOldScanVulnerabilities(
        existingIacVulns,
        [],
        projectId,
        scanId,
        branch,
        sightings,
      );
    }

    // CICD detections were never resolved on re-scan. Finalize the
    // scanner's CICD detections too (only when it has any).
    if (existingCicdVulns?.length) {
      await this.sastIacUtilsService.finalizeOldScanVulnerabilities(
        existingCicdVulns,
        [],
        projectId,
        scanId,
        branch,
        sightings,
      );
    }

    // Secret detections were never resolved on re-scan either (a secret
    // removed from the code, or a path added to .cybeignore, stayed open).
    // Same scanner + branch scope, behind the same diff-scan and
    // unreadable-scan guards above, under the scan's history rule: a secret
    // is resolved by absence only from the HEAD pass.
    if (existingSecretVulns?.length) {
      await this.sastIacUtilsService.finalizeOldScanVulnerabilities(
        existingSecretVulns,
        [],
        projectId,
        scanId,
        branch,
        sightings,
        await this.readSecretHistoryRule(
          scanId,
          scannerName.toLowerCase(),
          scanMeta,
        ),
      );
    }

    this.logger.log(
      `[SAST/IAC Finalize] Finalization completed for project=${projectId}, scan=${scanId}`,
    );
  }

  /**
   * Drop the issues a `cybedefend-ignore` directive neutralises.
   *
   * The batch's rule ids are resolved ONCE to their catalogue rule — the very
   * row `processVulnerability` raises the finding against — and each issue is
   * decided against that rule's code. A secret (a gitleaks issue, or one
   * resolved to a rule raised as a secret) is decided like any other issue.
   * A neutralised issue creates nothing; an existing finding it used to match
   * is auto-resolved at finalize, as when the scanner dropped it.
   *
   * If the catalogue cannot be read, the batch is deferred to a BullMQ retry
   * (UNAVAILABLE) only when a decision depends on the resolution
   * (`inlineIgnoreNeedsCatalogRule`: a directive listing a code, whatever the
   * scanner, gitleaks included): raising an issue the customer neutralised and
   * hiding one they did not are both wrong. Otherwise — no directive, scanner
   * ids only, or the bare form, which covers every rule of its line — it is
   * decided without the catalogue and goes on exactly as before.
   *
   * @returns the kept issues, in input order; the catalogue rule of each kept
   *   issue (code and type, null when unresolved) keyed by its rule id as
   *   reported, for the diff store; and the resolution itself for the
   *   occurrence ranking to reuse — absent when it failed, so that the ranking
   *   resolves (and degrades) on its own.
   */
  private async dropNeutralisedIssues(
    vulnerabilities: VulnerabilityDtoRequest[] | undefined | null,
    scanId: string,
    scannerNameLowerCase: string,
  ): Promise<{
    kept: VulnerabilityDtoRequest[];
    keptRules: Map<string, CatalogRule | null>;
    catalogRules?: Map<string, CatalogRule>;
  }> {
    const issues = Array.isArray(vulnerabilities) ? vulnerabilities : [];
    const kept: VulnerabilityDtoRequest[] = [];
    const keptRules = new Map<string, CatalogRule | null>();
    if (issues.length === 0) return { kept, keptRules };

    let rules: Map<string, CatalogRule> | undefined;
    try {
      rules = await this.sastIacUtilsService.resolveCatalogRules(
        issues.map((v) => v?.ruleId),
        scannerNameLowerCase,
      );
    } catch (e) {
      const cause = (e as Error)?.message;
      if (issues.some((v) => inlineIgnoreNeedsCatalogRule(v?.inlineIgnores))) {
        this.logger.error(
          `[SAST/IAC] Cannot resolve the catalogue rules cybedefend-ignore directives are decided against ` +
            `(scan=${scanId}, scanner=${scannerNameLowerCase}); deferring the batch: ${cause}`,
        );
        throw new RpcException({
          code: status.UNAVAILABLE,
          message: `Cannot evaluate cybedefend-ignore directives for scan ${scanId} (catalogue unavailable); deferring ingestion`,
        });
      }
      this.logger.warn(
        `[SAST/IAC] Could not resolve catalogue codes (scan=${scanId}, scanner=${scannerNameLowerCase}); ` +
          `no cybedefend-ignore decision of this batch depends on them, ingesting without codes: ${cause}`,
      );
    }

    // The log below names catalogue codes only: never a secret's value, path
    // or rule id, nor the directive's reason.
    const neutralisedCodes = new Set<string>();
    for (const v of issues) {
      const rule = rules?.get(catalogRuleIdOf(v?.ruleId));
      if (!isNeutralizedByInlineIgnore(v?.inlineIgnores, rule)) {
        kept.push(v);
        keptRules.set(v?.ruleId, rule ?? null);
        continue;
      }
      if (rule?.code) {
        neutralisedCodes.add(rule.code);
      }
      // A directive can hide a real credential: each secret it silences is
      // audited, where and by which code and form. Never its value, the
      // scanner's rule id or the directive's reason.
      if (isSecretFinding(scannerNameLowerCase, rule)) {
        this.logger.warn(
          `SECRET_NEUTRALISED scan=${scanId} scanner=${scannerNameLowerCase} ` +
            `code=${rule?.code || 'none'} form=${neutralisingForm(v?.inlineIgnores)} ` +
            `path=${v?.path} line=${v?.codeSnippet?.vulnerableStartLine}`,
        );
      }
    }

    const neutralised = issues.length - kept.length;
    if (neutralised > 0) {
      // Never the directive's reason: free text copied from the customer's code.
      this.logger.log(
        `[SAST/IAC] Neutralised ${neutralised} of ${issues.length} issue(s) by cybedefend-ignore directive(s) ` +
          `(scan=${scanId}, scanner=${scannerNameLowerCase}, codes=${[...neutralisedCodes].sort().join(',') || 'none'})`,
      );
    }
    return { kept, keptRules, catalogRules: rules };
  }

  /**
   * Deduplicate a list of vulnerability DTOs by strict identity fields.
   * Keyed by ruleId + path + language + vulnerable line range + fileHash.
   * This helps avoid inserting duplicates emitted within the same scanner batch (e.g., KICS).
   */
  private deduplicateVulnList(vulns: any[] | undefined | null): any[] {
    if (!Array.isArray(vulns) || vulns.length === 0) return [];
    const seen = new Set<string>();
    const out: any[] = [];
    for (const v of vulns) {
      const cs = v?.codeSnippet ?? {};
      const key = [
        String(v?.ruleId ?? ''),
        String(v?.path ?? ''),
        String(v?.language ?? ''),
        String(cs?.vulnerableStartLine ?? ''),
        String(cs?.vulnerableEndLine ?? ''),
        String(v?.fileHash ?? ''),
      ].join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(v);
    }
    return out;
  }

  /**
   * Rank each finding among the findings that would hash to the same
   * fingerprint, so N copies of one pattern in a file get distinct digests.
   *
   * Two properties are load-bearing and were both wrong in the first cut:
   *
   * 1. The bucket key is built from the components `computeCodeFingerprint`
   *    consumes — the CATALOGUE vulnerability id and the NORMALISED path and
   *    snippet — never the raw scanner `ruleId` or the raw path.
   *    `correspondance_table` is many-to-one onto the catalogue id (one kics
   *    vuln is mapped by dozens of ruleIds), so a ruleId-keyed bucket splits
   *    exactly the findings that collide and hands them both index 0.
   * 2. The index is scoped to the (scan, scanner), not to this BullMQ batch.
   *    A scanner's output arrives as N independent jobs consumed concurrently
   *    across pods; two twins either side of a chunk boundary would otherwise
   *    both be ranked 0 and be persisted with one identical fingerprint.
   *
   * The line number is only the ascending tie-break, never part of the key —
   * and it is not the LAST tie-break: two findings sharing a start line are
   * separated by `tieBreakOf` (end line + language, length-prefixed) before
   * arrival order is consulted, because ranking them on the scanner's output
   * order made them swap fingerprints between two scans of unchanged code and
   * every per-fingerprint state (dismissal, status, first-seen) follow the
   * wrong finding.
   *
   * That holds for the members of a group that land in the SAME batch. Two
   * members that land in DIFFERENT batches are still ordered by which batch
   * reached Redis first, so they still swap fingerprints when the batches race
   * differently — the allocator hands each call one contiguous block per group
   * and nothing orders the calls. The full argument, and why it cannot be
   * closed without moving the stamp to the finalize gate, is in the residue
   * section of `ScanQueueService.allocateOccurrenceIndexes`; the behaviour is
   * pinned in `scan-queue.occurrence-index.spec.ts`. Do not read the paragraph
   * above as "the tie-break made the index order-independent" — it made it
   * order-independent within a batch.
   *
   * @param vulns - The deduplicated batch, in the order it will be processed.
   * @param scanId - The scan, for the cross-batch allocation scope.
   * @param scannerNameLowerCase - The scanner, same scope.
   * @param catalogVulnIds - The batch's catalogue resolution when the caller
   *   already holds it (resolved once, for the cybedefend-ignore
   *   decision); otherwise it is resolved here.
   * @returns One index per input item, positionally aligned with `vulns`, and
   *   `null` for any item this function could not rank with certainty — the
   *   batch could not be bucketed (catalogue resolution failed), the
   *   cross-batch allocator was absent or threw, or it answered short.
   *   `null` means "write no fingerprint", NOT "index 0".
   */
  private async computeOccurrenceIndexes(
    vulns: any[] | undefined | null,
    scanId: string,
    scannerNameLowerCase: string,
    catalogVulnIds?: Map<string, string>,
  ): Promise<(number | null)[]> {
    if (!Array.isArray(vulns) || vulns.length === 0) return [];

    // The digest hashes the catalogue vuln id, so the bucket must too.
    let catalogByRuleId = new Map<string, string>();
    try {
      catalogByRuleId =
        catalogVulnIds ??
        (await this.sastIacUtilsService.resolveCatalogVulnIds(
          vulns.map((v) => v?.ruleId),
          scannerNameLowerCase,
        ));
    } catch (e) {
      // Degrade, never fail the batch — but do NOT degrade the bucket key.
      //
      // An earlier cut fell back to the empty map, arguing that the resulting
      // ('', path, snippet) bucket is COARSER than the digest and that a
      // coarser bucket can only merge, never collide. That is true of a
      // batch-LOCAL ranking and false of the allocator actually in use:
      // uniqueness comes from a Redis counter keyed on the bucket's own hash
      // (`hincrby <key> n:<groupId>`), so a different bucket key is a different
      // counter, starting again at 0.
      //
      // Scan S, kics, two identical Terraform blocks at lines 10 and 400 split
      // across batches A and B: A resolves (group GA, index 0); B blips,
      // degrades to group GB, fresh counter, index 0. Both rows are still
      // created — processVulnerability does its own per-finding lookup, which
      // succeeded — so both digests hash the same catalogue vuln, path, snippet
      // and index 0. ONE fingerprint on TWO rows: permanent ER_DUP_ENTRY under
      // the planned UNIQUE index, and two findings merged into one identity
      // after the matching switch-over. A partial degrade is the realistic
      // shape: concurrency 3 across KEDA-scaled pods against one MySQL means a
      // single batch's query can fail while its siblings succeed.
      //
      // So the batch is marked UNRANKABLE and its new detections are written
      // with a NULL fingerprint. NULL is what the whole pre-existing corpus
      // carries, MySQL treats NULLs as distinct in a unique index, and the next
      // healthy scan backfills them through applyShadowFingerprint. The cost is
      // one scan of shadow evidence for one batch; the alternative is a
      // duplicate identity that never self-heals.
      this.logger.error(
        `[SAST/IAC] Could not pre-resolve catalogue ids for the occurrence index; ` +
          `this batch is UNRANKABLE and its new detections are written with a NULL ` +
          `fingerprint (the next scan backfills them): ${(e as Error).message}`,
      );
      return new Array<number | null>(vulns.length).fill(null);
    }

    const keyOf = (v: any): string => {
      const cs = v?.codeSnippet ?? {};
      const extracted = String(v?.ruleId ?? '')
        .split('.')
        .pop();
      return codeOccurrenceKey({
        catalogVulnId: catalogByRuleId.get(extracted) ?? '',
        path: v?.path,
        snippetLines: cs?.code,
        vulnerableStartLine: cs?.vulnerableStartLine ?? 0,
        vulnerableEndLine: cs?.vulnerableEndLine ?? 0,
      });
    };
    // `normalizeOccurrenceLine`, not a bare `Number(...)`: a non-numeric,
    // non-null `vulnerableStartLine` yields NaN, and `a.line - b.line` on a NaN
    // is NaN — an intransitive comparator whose permutation is whatever V8's
    // sort happens to produce for that array length. It is also the SAME
    // coercion the allocator and `assignOccurrenceIndexes` apply, which is what
    // makes the three agree entry-for-entry.
    const lineOf = (v: any) =>
      normalizeOccurrenceLine(v?.codeSnippet?.vulnerableStartLine ?? 0);

    /**
     * The stable discriminator for two findings the digest cannot tell apart.
     *
     * `vulnerableEndLine` and `language` are both in `dupWhereBase` and in the
     * `existingVulnsMap` predicate — so a pair differing only in one of them is
     * TWO rows — yet neither is hashed by `computeCodeFingerprint` nor present
     * in `codeOccurrenceKey`. Ranking such a pair by its position in the
     * scanner's output made the two findings swap fingerprints between scans of
     * unchanged code.
     *
     * Length-prefixed via `occurrenceTieBreak` rather than joined by hand. Note
     * what that is NOT: an earlier version of this comment claimed a plain
     * `${endLine} ${language}` collides, giving '12 3java' for (12, '3java') and
     * '123 java' for (123, 'java'). It does not — those two strings differ, and
     * a two-component join led by a decimal line number is injective, because
     * the first space is always the boundary. The framing is used because that
     * argument is a property of THIS component list: it dies if a third
     * discriminator is added here, or if a component that can contain the
     * separator is (a scanner-reported `language` is free text). Building it
     * with the shared helper means the next person to add a component does not
     * have to re-derive the side condition — and
     * `sast-iac.occurrence-index.spec.ts` pins that this call site keeps using
     * it.
     */
    const tieBreakOf = (v: any) =>
      occurrenceTieBreak([
        v?.codeSnippet?.vulnerableEndLine ?? '',
        v?.language ?? '',
      ]);

    // Same policy as the catalogue failure above, for the same reason: never
    // guess an index. A batch cannot rank a group it only PARTLY contains —
    // scanner output arrives as N independent jobs — so the batch-local ranking
    // that used to back this path handed index 0 to a finding in batch A and to
    // its twin in batch B: one fingerprint on two rows, i.e. a permanent
    // ER_DUP_ENTRY under the planned UNIQUE index and two findings merged into
    // one identity after the matching switch-over. The cross-batch counter is
    // the ONLY thing that makes the index unique, so when it cannot answer the
    // batch is UNRANKABLE and its new detections are written with a NULL
    // fingerprint. A NULL is a hole the next healthy scan backfills through
    // applyShadowFingerprint; a duplicate identity never self-heals.
    if (!this.scanQueueService?.allocateOccurrenceIndexes) {
      return new Array<number | null>(vulns.length).fill(null);
    }

    try {
      // Hand entries over in ascending (line, tie-break) order per group so a
      // group that does fit in one batch comes out line-ordered (hence stable
      // under drift) AND order-independent within a line. The comparator is the
      // shared one, so this ordering, the allocator's and the batch-local
      // fallback's are one definition instead of three lookalikes.
      const order = vulns
        .map((v, i) => ({
          i,
          key: keyOf(v),
          line: lineOf(v),
          tie: tieBreakOf(v),
        }))
        .sort((a, b) =>
          compareOccurrenceEntries(
            { line: a.line, tie: a.tie, ordinal: a.i },
            { line: b.line, tie: b.tie, ordinal: b.i },
          ),
        );
      const allocated = await this.scanQueueService.allocateOccurrenceIndexes(
        'sast-iac',
        scanId,
        scannerNameLowerCase,
        order.map((o) => ({
          groupKey: o.key,
          line: o.line,
          tieBreak: o.tie,
        })),
      );
      // A short or sparse response — and an EXPLICIT null, which the allocator
      // returns for an entry whose index it cannot certify as unique (its
      // counter hash was evicted mid-scan) — leaves its entries NULL. Reusing a
      // local rank for the entries the allocator did not cover is the same
      // collision by another route, so the read is explicitly null-preserving.
      const out = new Array<number | null>(vulns.length).fill(null);
      order.forEach((o, rank) => {
        const index = allocated?.[rank];
        out[o.i] = Number.isFinite(index as number) ? Number(index) : null;
      });
      return out;
    } catch (e) {
      // `error`, not `warn`: this suppresses a whole batch of findings from the
      // fingerprint-keyed export until the next scan re-stamps them.
      this.logger.error(
        `[SAST/IAC] Cross-batch occurrence allocation unavailable; this batch is ` +
          `UNRANKABLE and its new detections are written with a NULL fingerprint ` +
          `(the next scan backfills them): ${(e as Error).message}`,
      );
      return new Array<number | null>(vulns.length).fill(null);
    }
  }

  /**
   * Determine if the current batch represents IAC vulnerabilities based on the request's vulnerabilityType.
   * Accepts comma-separated values and matches case-insensitively.
   */
  private isIacBatch(vulnerabilityType?: string | null): boolean {
    if (!vulnerabilityType) return false;
    const parts = vulnerabilityType
      .toString()
      .toLowerCase()
      .split(',')
      .map((s) => s.trim());
    return parts.includes('iac');
  }

  /**
   * Get project SAST vulnerabilities.
   *
   * @param GetProjectVulnerabilitiesRequestDto - The request to get the vulnerabilities.
   * @returns The vulnerabilities for the project.
   */
  @Span()
  async getProjectSastVulnerabilities(
    request: GetProjectSastVulnerabilitiesRequest,
  ): Promise<GetProjectSastVulnerabilitiesResponse> {
    const {
      projectId,
      pageNumber = 1,
      pageSizeNumber = 10,
      sort = 'currentSeverity',
      order = 'ASC',
      severity,
      status,
      priority,
      searchQuery,
      branch,
      hasAutofix,
      excludeAutofixCounts,
      exploitabilityVerdict,
      scoringSource,
      language,
      sourcePath,
      slim,
    } = request;

    // An explicit size is clamped at 500; 0 keeps the whole
    // list (policy-management reads it unpaged).
    const limit = clampListPageSize(pageSizeNumber);

    const orderUpperCase = order.toUpperCase();

    const allowedSortFields = [
      'currentState',
      'currentSeverity',
      'currentPriority',
      'priorityScore',
      'createdAt',
      'updateAt',
    ];
    const allowedOrder = ['ASC', 'DESC'];

    const safeSort = allowedSortFields.includes(sort)
      ? sort
      : 'currentSeverity';
    const safeOrder = allowedOrder.includes(orderUpperCase)
      ? orderUpperCase
      : 'ASC';

    const queryBuilder = this.sastVulnDetectRepository
      .createQueryBuilder('vulnDetection')
      .leftJoinAndSelect('vulnDetection.vulnerability', 'vulnerability');
    // The slim (MCP) list shows no history.
    if (!slim) {
      queryBuilder.leftJoinAndSelect(
        'vulnDetection.historyItems',
        'historyItems',
      );
    }
    queryBuilder
      .leftJoinAndSelect('vulnDetection.autofixRecords', 'autofixRecords')
      .where('vulnDetection.projectId = :projectId', { projectId });

    // Filter by branch if specified
    if (branch) {
      queryBuilder.andWhere('vulnDetection.branch = :branch', { branch });
    }

    if (severity && severity.length > 0) {
      queryBuilder.andWhere(
        `${effectiveSeveritySql('vulnDetection')} IN (:...severity)`,
        { severity: severity.map((s) => s.toLowerCase()) },
      );
    }

    if (status && status.length > 0) {
      queryBuilder.andWhere('vulnDetection.currentState IN (:...status)', {
        status,
      });
    }

    applyPriorityFilter(queryBuilder, priority, 'vulnDetection');

    applyLanguageAndSourcePathFilters(
      queryBuilder,
      language,
      sourcePath,
      'vulnDetection',
    );

    applyExploitabilityVerdictFilter(
      queryBuilder,
      exploitabilityVerdict,
      'vulnDetection',
    );

    if (scoringSource) {
      if (scoringSource === 'agent') {
        queryBuilder.andWhere(
          '(vulnDetection.scoringSource = :scoringSource OR vulnDetection.exploitabilitySource = :agentExploitabilitySource)',
          { scoringSource, agentExploitabilitySource: 'agent' },
        );
      } else {
        queryBuilder.andWhere(
          'vulnDetection.scoringSource = :scoringSource AND (vulnDetection.exploitabilitySource IS NULL OR vulnDetection.exploitabilitySource <> :agentExploitabilitySource)',
          { scoringSource, agentExploitabilitySource: 'agent' },
        );
      }
    }

    if (searchQuery) {
      // Search matches the vulnerability name OR the source file path
      queryBuilder.andWhere(
        `(${ilike('vulnerability.name', ':searchTerm').text} OR ${ilike('vulnDetection.path', ':searchTerm').text})`,
        {
          searchTerm: `%${searchQuery}%`,
        },
      );
    }

    // Filter by autofix status if specified
    if (hasAutofix !== undefined && hasAutofix !== null) {
      if (hasAutofix === true) {
        // Has autofix: must have at least one autofixRecord
        queryBuilder.andWhere(
          `EXISTS (${successfulAutofixSubquery('vulnDetection')})`,
        );
      } else {
        // No autofix: must NOT have any autofixRecord
        queryBuilder.andWhere(
          `NOT EXISTS (${successfulAutofixSubquery('vulnDetection')})`,
        );
      }
    }

    const invertedOrder = safeOrder === 'DESC' ? 'ASC' : 'DESC';

    if (safeSort === 'currentSeverity') {
      queryBuilder
        .addSelect(
          `CASE
          WHEN ${effectiveSeveritySql('vulnDetection')} = 'critical' THEN 1
          WHEN ${effectiveSeveritySql('vulnDetection')} = 'high' THEN 2
          WHEN ${effectiveSeveritySql('vulnDetection')} = 'medium' THEN 3
          WHEN ${effectiveSeveritySql('vulnDetection')} = 'low' THEN 4
          ELSE 5
        END`,
          'severity_order',
        )
        .orderBy('severity_order', invertedOrder as 'ASC' | 'DESC');
    } else if (safeSort === 'currentPriority') {
      queryBuilder
        .addSelect(
          `CASE
          WHEN vulnDetection.currentPriority = 'critical_urgent' THEN 1
          WHEN vulnDetection.currentPriority = 'urgent' THEN 2
          WHEN vulnDetection.currentPriority = 'normal' THEN 3
          WHEN vulnDetection.currentPriority = 'low' THEN 4
          WHEN vulnDetection.currentPriority = 'very_low' THEN 5
          ELSE 6
        END`,
          'priority_order',
        )
        .orderBy('priority_order', invertedOrder as 'ASC' | 'DESC');
    } else if (safeSort === 'priorityScore') {
      queryBuilder
        .addSelect(
          'CASE WHEN vulnDetection.priorityScore IS NULL THEN 1 ELSE 0 END',
          'priority_score_null_order',
        )
        .orderBy('priority_score_null_order', 'ASC')
        .addOrderBy('vulnDetection.priorityScore', safeOrder as 'ASC' | 'DESC');
    } else {
      queryBuilder.orderBy(
        `vulnDetection.${safeSort}`,
        safeOrder as 'ASC' | 'DESC',
      );
    }

    const skip = (pageNumber - 1) * limit;
    queryBuilder.skip(skip).take(limit);

    // getManyAndCount + 5 tail fetches all in one Promise.all — same fix as
    // the IAC sibling. project, scan, vulnCount, autofix and the
    // languages facet are independent of each other and of the paginated list,
    // so the previous serial chain was strictly leftover. The two
    // counters wait for the project lookup (their SCA branch partition comes
    // from it), still in parallel with the rest.
    // A slim list does not read the project at all.
    const lookup = slim
      ? undefined
      : lookupProjectWithScaBranches(
          this.projectServiceClient,
          projectId,
          branch,
        );
    const [
      [vulnerabilitiesRaw, total],
      projectResponse,
      scanResponse,
      vulnCountByType,
      autofixCounts,
      languages,
    ] = await Promise.all([
      queryBuilder.getManyAndCount() as Promise<
        [SastVulnerabilityDetections[], number]
      >,
      // A slim list reads none of these (see unlessSlim).
      this.unlessSlim(
        slim,
        {} as ProjectInformationsResponse,
        () => lookup.projectLookup,
      ),
      this.unlessSlim(slim, {} as GetLastScanStatusResponse, () =>
        safeGrpcCall<GetLastScanStatusResponse>(
          this.scanServiceClient.getLastScanStatus({ projectId }),
        ),
      ),
      this.unlessSlim(slim, undefined, () =>
        lookup.scaBranches.then((branches) =>
          this.resultService.getCountVulnerabilitiesCountByType(
            projectId,
            branch,
            branches,
          ),
        ),
      ),
      // The dashboard Results pages never read these counts:
      // they opt out (excludeAutofixCounts) and save five queries.
      this.unlessSlim(slim, emptyAutofixCountByType(), () =>
        excludeAutofixCounts
          ? Promise.resolve(undefined)
          : lookup.scaBranches.then((branches) =>
              this.resultService.getAutofixCountByType(
                projectId,
                branch,
                branches,
              ),
            ),
      ),
      this.unlessSlim(slim, [], () =>
        fetchDistinctVulnerabilityLanguages(
          this.sastVulnDetectRepository,
          projectId,
          branch,
          (error) =>
            this.logger.warn(
              `languages facet failed for project=${projectId} (sast); returning []: ${error}`,
            ),
        ),
      ),
    ]);

    let vulnerabilitiesEntities = vulnerabilitiesRaw;

    // Safety post-filter for hasAutofix (SAST)
    if (hasAutofix === true) {
      const beforeCount = vulnerabilitiesEntities.length;
      vulnerabilitiesEntities = vulnerabilitiesEntities.filter((v) =>
        hasSuccessfulAutofixRecord(v),
      );
      this.logger.log(
        `[SAST hasAutofix POST-FILTER] hasAutofix=true: ${beforeCount} -> ${vulnerabilitiesEntities.length} entities`,
      );
    } else if (hasAutofix === false) {
      const beforeCount = vulnerabilitiesEntities.length;
      vulnerabilitiesEntities = vulnerabilitiesEntities.filter(
        (v) => !hasSuccessfulAutofixRecord(v),
      );
      this.logger.log(
        `[SAST hasAutofix POST-FILTER] hasAutofix=false: ${beforeCount} -> ${vulnerabilitiesEntities.length} entities`,
      );
    }

    const totalPages = Math.ceil(total / limit);

    for (const vuln of vulnerabilitiesEntities) {
      delete vuln.scannerType;
    }

    // The slim list loads no history; Cybe analysis is read
    // for the ids of the page.
    const cybeAnalysed = slim
      ? await findCybeAnalysedDetectionIds(
          this.sastVulnDetectRepository,
          projectId,
          vulnerabilitiesEntities.map((v) => v.id),
        )
      : null;
    // Resolve history-item users via the dedupe + parallel helper (kills
    // the N+1 sequential userService.getById on heavily-triaged pages).
    const userMap = await this.resolveHistoryUsers(vulnerabilitiesEntities);

    const vulnerabilities: VulnerabilitySast[] = [];
    for (const vulnEntity of vulnerabilitiesEntities) {
      const vulnProto: VulnerabilitySast = {
        base: mapSastDetectionEntityToListInterface(
          vulnEntity,
          this.cvssExplainer,
        ),
        dataFlowItems: [],
      };
      if (cybeAnalysed) {
        vulnProto.base.hasCybeAnalysis = cybeAnalysed.has(vulnEntity.id);
      }
      const historyItemsWithUserDetails: HistoryItem[] = [];
      if (
        Array.isArray(vulnEntity.historyItems) &&
        vulnEntity.historyItems.length > 0
      ) {
        for (const historyItem of vulnEntity.historyItems) {
          const uid = historyItem.userId;
          const userGetResponse: UserInformationsResponse | null =
            !uid || uid === 'system'
              ? this.getSystemUser()
              : (userMap.get(uid) ?? null);
          historyItemsWithUserDetails.push({
            ...historyItem,
            user: userGetResponse,
            date: historyItem.date
              ? historyItem.date.toISOString()
              : new Date().toISOString(),
          });
        }
      }
      vulnProto.base.historyItems = { items: historyItemsWithUserDetails };
      vulnerabilities.push(vulnProto);
    }

    const scanProjectInfo: ScanProjectInfo = {
      scanId: scanResponse.id,
      state: scanResponse.state,
      createAt: scanResponse.createAt,
      scanType: scanResponse.scanType,
    };

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
      languages,
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
    };
  }

  /**
   * Get project IAC vulnerabilities.
   *
   * @param GetProjectVulnerabilitiesRequestDto - The request to get the vulnerabilities.
   * @returns The vulnerabilities for the project.
   */
  @Span()
  async getProjectIacVulnerabilities(
    GetProjectVulnerabilitiesRequestDto: GetProjectIacVulnerabilitiesRequest,
  ): Promise<GetProjectIacVulnerabilitiesResponse> {
    const {
      projectId,
      pageNumber = 1,
      pageSizeNumber = 10,
      sort = 'currentSeverity',
      order = 'ASC',
      severity,
      status,
      priority,
      searchQuery,
      branch,
      hasAutofix,
      excludeAutofixCounts,
      exploitabilityVerdict,
      scoringSource,
      language,
      sourcePath,
      slim,
    } = GetProjectVulnerabilitiesRequestDto;

    // An explicit size is clamped at 500; 0 keeps the whole
    // list (policy-management reads it unpaged).
    const limit = clampListPageSize(pageSizeNumber);
    const orderUpperCase = order.toUpperCase();

    const allowedSortFields = [
      'currentState',
      'currentSeverity',
      'currentPriority',
      'priorityScore',
      'language',
      'createdAt',
      'updateAt',
    ];
    const allowedOrder = ['ASC', 'DESC'];

    const safeSort = allowedSortFields.includes(sort)
      ? sort
      : 'currentSeverity';
    const safeOrder = allowedOrder.includes(orderUpperCase)
      ? orderUpperCase
      : 'ASC';

    const queryBuilder = this.iacVulnDetectRepository
      .createQueryBuilder('vulnDetection')
      .leftJoinAndSelect('vulnDetection.vulnerability', 'vulnerability');
    // The slim (MCP) list shows no history.
    if (!slim) {
      queryBuilder.leftJoinAndSelect(
        'vulnDetection.historyItems',
        'historyItems',
      );
    }
    queryBuilder
      .leftJoinAndSelect('vulnDetection.autofixRecords', 'autofixRecords')
      .where('vulnDetection.projectId = :projectId', { projectId });

    // Filter by branch if specified
    if (branch) {
      queryBuilder.andWhere('vulnDetection.branch = :branch', { branch });
    }

    if (severity && severity.length > 0) {
      queryBuilder.andWhere(
        `${effectiveSeveritySql('vulnDetection')} IN (:...severity)`,
        { severity: severity.map((s) => s.toLowerCase()) },
      );
    }

    if (status && status.length > 0) {
      queryBuilder.andWhere('vulnDetection.currentState IN (:...status)', {
        status,
      });
    }

    applyPriorityFilter(queryBuilder, priority, 'vulnDetection');

    applyLanguageAndSourcePathFilters(
      queryBuilder,
      language,
      sourcePath,
      'vulnDetection',
    );

    applyExploitabilityVerdictFilter(
      queryBuilder,
      exploitabilityVerdict,
      'vulnDetection',
    );

    if (scoringSource) {
      if (scoringSource === 'agent') {
        queryBuilder.andWhere(
          '(vulnDetection.scoringSource = :scoringSource OR vulnDetection.exploitabilitySource = :agentExploitabilitySource)',
          { scoringSource, agentExploitabilitySource: 'agent' },
        );
      } else {
        queryBuilder.andWhere(
          'vulnDetection.scoringSource = :scoringSource AND (vulnDetection.exploitabilitySource IS NULL OR vulnDetection.exploitabilitySource <> :agentExploitabilitySource)',
          { scoringSource, agentExploitabilitySource: 'agent' },
        );
      }
    }

    if (searchQuery) {
      // Search matches the vulnerability name OR the source file path
      queryBuilder.andWhere(
        `(${ilike('vulnerability.name', ':searchTerm').text} OR ${ilike('vulnDetection.path', ':searchTerm').text})`,
        {
          searchTerm: `%${searchQuery}%`,
        },
      );
    }

    // Filter by autofix status if specified
    if (hasAutofix !== undefined && hasAutofix !== null) {
      if (hasAutofix === true) {
        // Has autofix: must have at least one autofixRecord
        queryBuilder.andWhere(
          `EXISTS (${successfulAutofixSubquery('vulnDetection')})`,
        );
      } else {
        // No autofix: must NOT have any autofixRecord
        queryBuilder.andWhere(
          `NOT EXISTS (${successfulAutofixSubquery('vulnDetection')})`,
        );
      }
    }

    // Invert the order for CASE-based sorting (critical=1, low=4)
    // DESC (descending severity) -> ASC on severity_order to get critical first
    // ASC (ascending severity) -> DESC on severity_order to get low first
    const invertedOrder = safeOrder === 'DESC' ? 'ASC' : 'DESC';
    if (safeSort === 'currentSeverity') {
      queryBuilder
        .addSelect(
          `CASE
          WHEN ${effectiveSeveritySql('vulnDetection')} = 'critical' THEN 1
          WHEN ${effectiveSeveritySql('vulnDetection')} = 'high' THEN 2
          WHEN ${effectiveSeveritySql('vulnDetection')} = 'medium' THEN 3
          WHEN ${effectiveSeveritySql('vulnDetection')} = 'low' THEN 4
          ELSE 5
        END`,
          'severity_order',
        )
        .orderBy('severity_order', invertedOrder as 'ASC' | 'DESC');
    } else if (safeSort === 'currentPriority') {
      queryBuilder
        .addSelect(
          `CASE
          WHEN vulnDetection.currentPriority = 'critical_urgent' THEN 1
          WHEN vulnDetection.currentPriority = 'urgent' THEN 2
          WHEN vulnDetection.currentPriority = 'normal' THEN 3
          WHEN vulnDetection.currentPriority = 'low' THEN 4
          WHEN vulnDetection.currentPriority = 'very_low' THEN 5
          ELSE 6
        END`,
          'priority_order',
        )
        .orderBy('priority_order', invertedOrder as 'ASC' | 'DESC');
    } else if (safeSort === 'priorityScore') {
      queryBuilder
        .addSelect(
          'CASE WHEN vulnDetection.priorityScore IS NULL THEN 1 ELSE 0 END',
          'priority_score_null_order',
        )
        .orderBy('priority_score_null_order', 'ASC')
        .addOrderBy('vulnDetection.priorityScore', safeOrder as 'ASC' | 'DESC');
    } else {
      queryBuilder.orderBy(
        `vulnDetection.${safeSort}`,
        safeOrder as 'ASC' | 'DESC',
      );
    }

    const skip = (pageNumber - 1) * limit;
    queryBuilder.skip(skip).take(limit);

    // getManyAndCount: single SQL round-trip instead of getCount + getMany.
    // The 5 tail fetches (project, scan, vulnCount, autofix, languages) join the
    // same Promise.all — all independent of the paginated list and of each other,
    // except the counters, which wait for the project lookup.
    // A slim list does not read the project at all.
    const lookup = slim
      ? undefined
      : lookupProjectWithScaBranches(
          this.projectServiceClient,
          projectId,
          branch,
        );
    const [
      [vulnerabilitiesEntities, total],
      projectResponse,
      scanResponse,
      vulnCountByType,
      autofixCounts,
      languages,
    ] = await Promise.all([
      queryBuilder.getManyAndCount() as Promise<
        [IacVulnerabilityDetections[], number]
      >,
      // A slim list reads none of these (see unlessSlim).
      this.unlessSlim(
        slim,
        {} as ProjectInformationsResponse,
        () => lookup.projectLookup,
      ),
      this.unlessSlim(slim, {} as GetLastScanStatusResponse, () =>
        safeGrpcCall<GetLastScanStatusResponse>(
          this.scanServiceClient.getLastScanStatus({ projectId }),
        ),
      ),
      this.unlessSlim(slim, undefined, () =>
        lookup.scaBranches.then((branches) =>
          this.resultService.getCountVulnerabilitiesCountByType(
            projectId,
            branch,
            branches,
          ),
        ),
      ),
      // The dashboard Results pages never read these counts:
      // they opt out (excludeAutofixCounts) and save five queries.
      this.unlessSlim(slim, emptyAutofixCountByType(), () =>
        excludeAutofixCounts
          ? Promise.resolve(undefined)
          : lookup.scaBranches.then((branches) =>
              this.resultService.getAutofixCountByType(
                projectId,
                branch,
                branches,
              ),
            ),
      ),
      this.unlessSlim(slim, [], () =>
        fetchDistinctVulnerabilityLanguages(
          this.iacVulnDetectRepository,
          projectId,
          branch,
          (error) =>
            this.logger.warn(
              `languages facet failed for project=${projectId} (iac); returning []: ${error}`,
            ),
        ),
      ),
    ]);

    const totalPages = Math.ceil(total / limit);

    const scanProjectInfo: ScanProjectInfo = {
      scanId: scanResponse.id,
      state: scanResponse.state,
      createAt: scanResponse.createAt,
      scanType: scanResponse.scanType,
    };

    for (const vuln of vulnerabilitiesEntities) {
      delete vuln.scannerType;
    }

    // The slim list loads no history; Cybe analysis is read
    // for the ids of the page.
    const cybeAnalysed = slim
      ? await findCybeAnalysedDetectionIds(
          this.iacVulnDetectRepository,
          projectId,
          vulnerabilitiesEntities.map((v) => v.id),
        )
      : null;
    // Resolve history-item users via the dedupe + parallel helper.
    const userMap = await this.resolveHistoryUsers(vulnerabilitiesEntities);

    const vulnerabilities: VulnerabilityIac[] = [];
    for (const vulnEntity of vulnerabilitiesEntities) {
      const vulnProto: VulnerabilityIac = {
        base: mapIacDetectionEntityToListInterface(
          vulnEntity,
          this.cvssExplainer,
        ),
      };
      if (cybeAnalysed) {
        vulnProto.base.hasCybeAnalysis = cybeAnalysed.has(vulnEntity.id);
      }
      const historyItemsWithUserDetails: HistoryItem[] = [];
      if (
        Array.isArray(vulnEntity.historyItems) &&
        vulnEntity.historyItems.length > 0
      ) {
        for (const historyItem of vulnEntity.historyItems) {
          const uid = historyItem.userId;
          const userGetResponse: UserInformationsResponse | null =
            !uid || uid === 'system'
              ? this.getSystemUser()
              : (userMap.get(uid) ?? null);
          historyItemsWithUserDetails.push({
            ...historyItem,
            user: userGetResponse,
            date: historyItem.date
              ? historyItem.date.toISOString()
              : new Date().toISOString(),
          });
        }
      }
      vulnProto.base.historyItems = { items: historyItemsWithUserDetails };
      vulnerabilities.push(vulnProto);
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
      languages,
      vulnerabilities: vulnerabilities,
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
    };
  }

  /**
   * Get project SAST vulnerability by id.
   *
   * @param GetProjectVulnerabilityByIdRequestDto - The request to get the vulnerability.
   * @returns The vulnerability for the project.
   */
  @Span()
  async getSastVulnerabilityByIdInProject(
    request: GetProjectVulnerabilityByIdRequest,
  ): Promise<GetProjectVulnerabilityByIdResponse> {
    const { projectId, vulnerabilityId } = request;

    const vulnerability = await this.sastVulnDetectRepository.findOne({
      where: { projectId, id: vulnerabilityId },
      relations: [
        'vulnerability',
        'vulnerability.references',
        'historyItems',
        'codeSnippets',
        'dataFlowItems',
        'autofixRecords',
      ],
    });

    if (!vulnerability) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: `Vulnerability not found in project`,
      });
    }

    delete vulnerability.scannerType;

    // Parallel fan-out: user batch + parsed branches + security-context cache
    // were three serial awaits on the critical path. They are independent.
    const [userMap, isProjectParsed, securityContextUpdatedAt] =
      await Promise.all([
        this.resolveHistoryUsers([vulnerability]),
        this.isProjectParsed(projectId),
        this.securityContextCache.getUpdatedAt(projectId),
      ]);

    const historyItemsWithUserDetails: HistoryItem[] = [];
    for (const historyItem of vulnerability.historyItems) {
      const uid = historyItem.userId;
      const userGetResponse: UserInformationsResponse | null =
        !uid || uid === 'system'
          ? this.getSystemUser()
          : (userMap.get(uid) ?? null);
      historyItemsWithUserDetails.push({
        ...historyItem,
        user: userGetResponse,
        date: historyItem.date
          ? historyItem.date.toISOString()
          : new Date().toISOString(),
      });
    }

    const vulnerabilityInterface: VulnerabilitySast = mapSastDetectionToProto(
      vulnerability,
      this.cvssExplainer,
      securityContextUpdatedAt,
    );
    vulnerabilityInterface.base.historyItems = {
      items: historyItemsWithUserDetails,
    } as any;
    // Inject autofix records (proto regeneration pending -> cast any)
    const autoRecords = (vulnerability.autofixRecords || []).map((r) => ({
      id: r.id,
      branch: r.branch,
      prUrl: r.prUrl || '',
      status: r.status,
      reason: r.reason || '',
      commitMessage: r.commitMessage,
      prTitle: r.prTitle,
      prBody: r.prBody,
      diff: r.diff
        ? r.diff.length > 200000
          ? r.diff.slice(0, 200000) + '\n...[truncated]'
          : r.diff
        : '',
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
    (vulnerabilityInterface.base as any).autofixRecords = autoRecords;

    return {
      projectId,
      vulnerabilityId,
      sast: vulnerabilityInterface,
      isProjectParsed,
    } as any;
  }

  /**
   * Whether the project has a parsed branch (`isProjectParsed`,
   * the code-graph assistant button of a vulnerability detail). GetProjectBranches
   * is one indexed read in global-management, where ProjectService/Get also
   * counted the project's vulnerabilities back in this service.
   */
  private async isProjectParsed(projectId: string): Promise<boolean> {
    const { branches } = await safeGrpcCall(
      this.projectServiceClient.getProjectBranches({ projectId }),
    );
    return hasParsedBranch(branches);
  }

  /**
   * Get project IAC vulnerability by id.
   *
   * @param GetProjectVulnerabilityByIdRequestDto - The request to get the vulnerability.
   * @returns The vulnerability for the project.
   */
  @Span()
  async getIacVulnerabilityByIdInProject(
    GetProjectVulnerabilityByIdRequestDto: GetProjectVulnerabilityByIdRequest,
  ): Promise<GetProjectVulnerabilityByIdResponse> {
    const { projectId, vulnerabilityId } =
      GetProjectVulnerabilityByIdRequestDto;

    const vulnerability = await this.iacVulnDetectRepository.findOne({
      where: { projectId, id: vulnerabilityId },
      relations: [
        'vulnerability',
        'vulnerability.references',
        'historyItems',
        'codeSnippets',
        'autofixRecords',
      ],
    });

    if (!vulnerability) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: `Vulnerability not found in project`,
      });
    }

    delete vulnerability.scannerType;

    // Parallel fan-out: user batch + parsed branches + security-context cache.
    const [userMap, isProjectParsed, securityContextUpdatedAt] =
      await Promise.all([
        this.resolveHistoryUsers([vulnerability]),
        this.isProjectParsed(projectId),
        this.securityContextCache.getUpdatedAt(projectId),
      ]);

    const historyItemsWithUserDetails: HistoryItem[] = [];
    for (const historyItem of vulnerability.historyItems) {
      const uid = historyItem.userId;
      const userGetResponse: UserInformationsResponse | null =
        !uid || uid === 'system'
          ? this.getSystemUser()
          : (userMap.get(uid) ?? null);
      historyItemsWithUserDetails.push({
        ...historyItem,
        user: userGetResponse,
        date: historyItem.date
          ? historyItem.date.toISOString()
          : new Date().toISOString(),
      });
    }

    const vulnerabilityInterface: VulnerabilityIac = mapIacDetectionToProto(
      vulnerability,
      this.cvssExplainer,
      securityContextUpdatedAt,
    );

    vulnerabilityInterface.base.historyItems = {
      items: historyItemsWithUserDetails,
    };

    return {
      projectId,
      vulnerabilityId,
      iac: vulnerabilityInterface,
      isProjectParsed,
    };
  }

  /**
   * Get project CICD vulnerabilities.
   *
   * @param GetProjectVulnerabilitiesRequestDto - The request to get the vulnerabilities.
   * @returns The vulnerabilities for the project.
   */
  @Span()
  async getProjectCicdVulnerabilities(
    GetProjectVulnerabilitiesRequestDto: GetProjectCicdVulnerabilitiesRequest,
  ): Promise<GetProjectCicdVulnerabilitiesResponse> {
    const {
      projectId,
      pageNumber = 1,
      pageSizeNumber = 10,
      sort = 'currentSeverity',
      order = 'ASC',
      severity,
      status,
      priority,
      searchQuery,
      branch,
      hasAutofix,
      excludeAutofixCounts,
      exploitabilityVerdict,
      scoringSource,
      language,
      sourcePath,
      slim,
    } = GetProjectVulnerabilitiesRequestDto;

    // An explicit size is clamped at 500; 0 keeps the whole
    // list (policy-management reads it unpaged).
    const limit = clampListPageSize(pageSizeNumber);
    const orderUpperCase = order.toUpperCase();

    const allowedSortFields = [
      'currentState',
      'currentSeverity',
      'currentPriority',
      'priorityScore',
      'language',
      'createdAt',
      'updateAt',
    ];
    const allowedOrder = ['ASC', 'DESC'];

    const safeSort = allowedSortFields.includes(sort)
      ? sort
      : 'currentSeverity';
    const safeOrder = allowedOrder.includes(orderUpperCase)
      ? orderUpperCase
      : 'ASC';

    const queryBuilder = this.cicdVulnDetectRepository
      .createQueryBuilder('vulnDetection')
      .leftJoinAndSelect('vulnDetection.vulnerability', 'vulnerability');
    // The slim (MCP) list shows no history.
    if (!slim) {
      queryBuilder.leftJoinAndSelect(
        'vulnDetection.historyItems',
        'historyItems',
      );
    }
    queryBuilder
      .leftJoinAndSelect('vulnDetection.autofixRecords', 'autofixRecords')
      .where('vulnDetection.projectId = :projectId', { projectId });

    // Filter by branch if specified
    if (branch) {
      queryBuilder.andWhere('vulnDetection.branch = :branch', { branch });
    }

    if (severity && severity.length > 0) {
      queryBuilder.andWhere(
        `${effectiveSeveritySql('vulnDetection')} IN (:...severity)`,
        { severity: severity.map((s) => s.toLowerCase()) },
      );
    }

    if (status && status.length > 0) {
      queryBuilder.andWhere('vulnDetection.currentState IN (:...status)', {
        status,
      });
    }

    applyPriorityFilter(queryBuilder, priority, 'vulnDetection');

    applyLanguageAndSourcePathFilters(
      queryBuilder,
      language,
      sourcePath,
      'vulnDetection',
    );

    applyExploitabilityVerdictFilter(
      queryBuilder,
      exploitabilityVerdict,
      'vulnDetection',
    );

    if (scoringSource) {
      if (scoringSource === 'agent') {
        queryBuilder.andWhere(
          '(vulnDetection.scoringSource = :scoringSource OR vulnDetection.exploitabilitySource = :agentExploitabilitySource)',
          { scoringSource, agentExploitabilitySource: 'agent' },
        );
      } else {
        queryBuilder.andWhere(
          'vulnDetection.scoringSource = :scoringSource AND (vulnDetection.exploitabilitySource IS NULL OR vulnDetection.exploitabilitySource <> :agentExploitabilitySource)',
          { scoringSource, agentExploitabilitySource: 'agent' },
        );
      }
    }

    if (searchQuery) {
      // Search matches the vulnerability name OR the source file path
      queryBuilder.andWhere(
        `(${ilike('vulnerability.name', ':searchTerm').text} OR ${ilike('vulnDetection.path', ':searchTerm').text})`,
        {
          searchTerm: `%${searchQuery}%`,
        },
      );
    }

    // Filter by autofix status if specified
    if (hasAutofix !== undefined && hasAutofix !== null) {
      if (hasAutofix === true) {
        // Has autofix: must have at least one autofixRecord
        queryBuilder.andWhere(
          `EXISTS (${successfulAutofixSubquery('vulnDetection')})`,
        );
      } else {
        // No autofix: must NOT have any autofixRecord
        queryBuilder.andWhere(
          `NOT EXISTS (${successfulAutofixSubquery('vulnDetection')})`,
        );
      }
    }

    // Invert the order for CASE-based sorting (critical=1, low=4)
    // DESC (descending severity) -> ASC on severity_order to get critical first
    // ASC (ascending severity) -> DESC on severity_order to get low first
    const invertedOrder = safeOrder === 'DESC' ? 'ASC' : 'DESC';

    if (safeSort === 'currentSeverity') {
      queryBuilder
        .addSelect(
          `CASE
          WHEN ${effectiveSeveritySql('vulnDetection')} = 'critical' THEN 1
          WHEN ${effectiveSeveritySql('vulnDetection')} = 'high' THEN 2
          WHEN ${effectiveSeveritySql('vulnDetection')} = 'medium' THEN 3
          WHEN ${effectiveSeveritySql('vulnDetection')} = 'low' THEN 4
          ELSE 5
        END`,
          'severity_order',
        )
        .orderBy('severity_order', invertedOrder as 'ASC' | 'DESC');
    } else if (safeSort === 'currentPriority') {
      queryBuilder
        .addSelect(
          `CASE
          WHEN vulnDetection.currentPriority = 'critical_urgent' THEN 1
          WHEN vulnDetection.currentPriority = 'urgent' THEN 2
          WHEN vulnDetection.currentPriority = 'normal' THEN 3
          WHEN vulnDetection.currentPriority = 'low' THEN 4
          WHEN vulnDetection.currentPriority = 'very_low' THEN 5
          ELSE 6
        END`,
          'priority_order',
        )
        .orderBy('priority_order', invertedOrder as 'ASC' | 'DESC');
    } else if (safeSort === 'priorityScore') {
      queryBuilder
        .addSelect(
          'CASE WHEN vulnDetection.priorityScore IS NULL THEN 1 ELSE 0 END',
          'priority_score_null_order',
        )
        .orderBy('priority_score_null_order', 'ASC')
        .addOrderBy('vulnDetection.priorityScore', safeOrder as 'ASC' | 'DESC');
    } else {
      queryBuilder.orderBy(
        `vulnDetection.${safeSort}`,
        safeOrder as 'ASC' | 'DESC',
      );
    }

    const skip = (pageNumber - 1) * limit;
    queryBuilder.skip(skip).take(limit);

    // Same parallel tail pattern as SAST/IAC list above (incl. the
    // languages facet).
    // A slim list does not read the project at all.
    const lookup = slim
      ? undefined
      : lookupProjectWithScaBranches(
          this.projectServiceClient,
          projectId,
          branch,
        );
    const [
      [vulnerabilitiesEntities, total],
      projectResponse,
      scanResponse,
      vulnCountByType,
      autofixCounts,
      languages,
    ] = await Promise.all([
      queryBuilder.getManyAndCount() as Promise<
        [CicdVulnerabilityDetections[], number]
      >,
      // A slim list reads none of these (see unlessSlim).
      this.unlessSlim(
        slim,
        {} as ProjectInformationsResponse,
        () => lookup.projectLookup,
      ),
      this.unlessSlim(slim, {} as GetLastScanStatusResponse, () =>
        safeGrpcCall<GetLastScanStatusResponse>(
          this.scanServiceClient.getLastScanStatus({ projectId }),
        ),
      ),
      this.unlessSlim(slim, undefined, () =>
        lookup.scaBranches.then((branches) =>
          this.resultService.getCountVulnerabilitiesCountByType(
            projectId,
            branch,
            branches,
          ),
        ),
      ),
      // The dashboard Results pages never read these counts:
      // they opt out (excludeAutofixCounts) and save five queries.
      this.unlessSlim(slim, emptyAutofixCountByType(), () =>
        excludeAutofixCounts
          ? Promise.resolve(undefined)
          : lookup.scaBranches.then((branches) =>
              this.resultService.getAutofixCountByType(
                projectId,
                branch,
                branches,
              ),
            ),
      ),
      this.unlessSlim(slim, [], () =>
        fetchDistinctVulnerabilityLanguages(
          this.cicdVulnDetectRepository,
          projectId,
          branch,
          (error) =>
            this.logger.warn(
              `languages facet failed for project=${projectId} (cicd); returning []: ${error}`,
            ),
        ),
      ),
    ]);

    const totalPages = Math.ceil(total / limit);

    const scanProjectInfo: ScanProjectInfo = {
      scanId: scanResponse.id,
      state: scanResponse.state,
      createAt: scanResponse.createAt,
      scanType: scanResponse.scanType,
    };

    for (const vuln of vulnerabilitiesEntities) {
      delete vuln.scannerType;
    }

    // The slim list loads no history; Cybe analysis is read
    // for the ids of the page.
    const cybeAnalysed = slim
      ? await findCybeAnalysedDetectionIds(
          this.cicdVulnDetectRepository,
          projectId,
          vulnerabilitiesEntities.map((v) => v.id),
        )
      : null;
    const userMap = await this.resolveHistoryUsers(vulnerabilitiesEntities);

    const vulnerabilities: VulnerabilityCicd[] = [];
    for (const vulnEntity of vulnerabilitiesEntities) {
      const vulnProto: VulnerabilityCicd = {
        base: mapCicdDetectionEntityToListInterface(
          vulnEntity,
          this.cvssExplainer,
        ),
      };
      if (cybeAnalysed) {
        vulnProto.base.hasCybeAnalysis = cybeAnalysed.has(vulnEntity.id);
      }
      const historyItemsWithUserDetails: HistoryItem[] = [];
      if (
        Array.isArray(vulnEntity.historyItems) &&
        vulnEntity.historyItems.length > 0
      ) {
        for (const historyItem of vulnEntity.historyItems) {
          const uid = historyItem.userId;
          const userGetResponse: UserInformationsResponse | null =
            !uid || uid === 'system'
              ? this.getSystemUser()
              : (userMap.get(uid) ?? null);
          historyItemsWithUserDetails.push({
            ...historyItem,
            user: userGetResponse,
            date: historyItem.date
              ? historyItem.date.toISOString()
              : new Date().toISOString(),
          });
        }
      }
      vulnProto.base.historyItems = { items: historyItemsWithUserDetails };
      vulnerabilities.push(vulnProto);
    }

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
      languages,
      vulnerabilities: vulnerabilities,
      total,
      scanProjectInfo,
      vulnCountByType,
      autofixCountByType: autofixCounts
        ? {
            sast: autofixCounts.sast,
            iac: autofixCounts.iac,
            cicd: autofixCounts.cicd,
            secret: autofixCounts.secret,
            sca: autofixCounts.sca,
          }
        : undefined,
    };
  }

  /**
   * Get project CICD vulnerability by id.
   *
   * @param GetProjectVulnerabilityByIdRequestDto - The request to get the vulnerability.
   * @returns The vulnerability for the project.
   */
  @Span()
  async getCicdVulnerabilityByIdInProject(
    GetProjectVulnerabilityByIdRequestDto: GetProjectVulnerabilityByIdRequest,
  ): Promise<GetProjectVulnerabilityByIdResponse> {
    const { projectId, vulnerabilityId } =
      GetProjectVulnerabilityByIdRequestDto;

    const vulnerability = await this.cicdVulnDetectRepository.findOne({
      where: { projectId, id: vulnerabilityId },
      relations: [
        'vulnerability',
        'vulnerability.references',
        'historyItems',
        'codeSnippets',
        'autofixRecords',
      ],
    });

    if (!vulnerability) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: `Vulnerability not found in project`,
      });
    }

    delete vulnerability.scannerType;

    // Parallel fan-out: user batch + security-context cache.
    const [userMap, securityContextUpdatedAt] = await Promise.all([
      this.resolveHistoryUsers([vulnerability]),
      this.securityContextCache.getUpdatedAt(projectId),
    ]);

    const historyItemsWithUserDetails: HistoryItem[] = [];
    for (const historyItem of vulnerability.historyItems) {
      const uid = historyItem.userId;
      const userGetResponse: UserInformationsResponse | null =
        !uid || uid === 'system'
          ? this.getSystemUser()
          : (userMap.get(uid) ?? null);
      historyItemsWithUserDetails.push({
        ...historyItem,
        user: userGetResponse,
        date: historyItem.date
          ? historyItem.date.toISOString()
          : new Date().toISOString(),
      });
    }

    const vulnerabilityInterface: VulnerabilityCicd = mapCicdDetectionToProto(
      vulnerability,
      this.cvssExplainer,
      securityContextUpdatedAt,
    );

    vulnerabilityInterface.base.historyItems = {
      items: historyItemsWithUserDetails,
    };

    return {
      projectId,
      vulnerabilityId,
      cicd: vulnerabilityInterface,
    };
  }

  /**
   * Get all project secret vulnerabilities with pagination.
   *
   * @param GetProjectVulnerabilitiesRequestDto - The request to get the vulnerabilities.
   * @returns The vulnerabilities for the project.
   */
  @Span()
  async getProjectSecretVulnerabilities(
    GetProjectVulnerabilitiesRequestDto: GetProjectSecretVulnerabilitiesRequest,
  ): Promise<GetProjectSecretVulnerabilitiesResponse> {
    const {
      projectId,
      pageNumber = 1,
      pageSizeNumber = 10,
      sort = 'currentSeverity',
      order = 'ASC',
      severity,
      status,
      priority,
      searchQuery,
      branch,
      hasAutofix,
      excludeAutofixCounts,
      exploitabilityVerdict,
      scoringSource,
      commitSha,
      source,
      language,
      sourcePath,
      slim,
    } = GetProjectVulnerabilitiesRequestDto;

    // An explicit size is clamped at 500; 0 keeps the whole
    // list (policy-management reads it unpaged).
    const limit = clampListPageSize(pageSizeNumber);
    const orderUpperCase = order.toUpperCase();

    const allowedSortFields = [
      'currentState',
      'currentSeverity',
      'currentPriority',
      'priorityScore',
      'language',
      'createdAt',
      'updateAt',
    ];
    const allowedOrder = ['ASC', 'DESC'];

    const safeSort = allowedSortFields.includes(sort)
      ? sort
      : 'currentSeverity';
    const safeOrder = allowedOrder.includes(orderUpperCase)
      ? orderUpperCase
      : 'ASC';

    const queryBuilder = this.secretVulnDetectRepository
      .createQueryBuilder('vulnDetection')
      .leftJoinAndSelect('vulnDetection.vulnerability', 'vulnerability');
    // The slim (MCP) list shows no history.
    if (!slim) {
      queryBuilder.leftJoinAndSelect(
        'vulnDetection.historyItems',
        'historyItems',
      );
    }
    queryBuilder
      .leftJoinAndSelect('vulnDetection.autofixRecords', 'autofixRecords')
      .where('vulnDetection.projectId = :projectId', { projectId });

    // Filter by branch if specified
    if (branch) {
      queryBuilder.andWhere('vulnDetection.branch = :branch', { branch });
    }

    // Filter by commitSha prefix (for history scanning)
    if (commitSha) {
      queryBuilder.andWhere(
        ilike('vulnDetection.commitSha', ':commitShaPrefix').text,
        {
          commitShaPrefix: `${commitSha}%`,
        },
      );
    }

    // Filter by source ("head" or "history")
    if (source && (source === 'head' || source === 'history')) {
      queryBuilder.andWhere('vulnDetection.source = :source', { source });
    }

    if (severity && severity.length > 0) {
      queryBuilder.andWhere(
        `${effectiveSeveritySql('vulnDetection')} IN (:...severity)`,
        { severity: severity.map((s) => s.toLowerCase()) },
      );
    }

    if (status && status.length > 0) {
      queryBuilder.andWhere('vulnDetection.currentState IN (:...status)', {
        status,
      });
    }

    applyPriorityFilter(queryBuilder, priority, 'vulnDetection');

    applyLanguageAndSourcePathFilters(
      queryBuilder,
      language,
      sourcePath,
      'vulnDetection',
    );

    applyExploitabilityVerdictFilter(
      queryBuilder,
      exploitabilityVerdict,
      'vulnDetection',
    );

    if (scoringSource) {
      if (scoringSource === 'agent') {
        queryBuilder.andWhere(
          '(vulnDetection.scoringSource = :scoringSource OR vulnDetection.exploitabilitySource = :agentExploitabilitySource)',
          { scoringSource, agentExploitabilitySource: 'agent' },
        );
      } else {
        queryBuilder.andWhere(
          'vulnDetection.scoringSource = :scoringSource AND (vulnDetection.exploitabilitySource IS NULL OR vulnDetection.exploitabilitySource <> :agentExploitabilitySource)',
          { scoringSource, agentExploitabilitySource: 'agent' },
        );
      }
    }

    if (searchQuery) {
      // Search matches the vulnerability name OR the source file path
      queryBuilder.andWhere(
        `(${ilike('vulnerability.name', ':searchTerm').text} OR ${ilike('vulnDetection.path', ':searchTerm').text})`,
        {
          searchTerm: `%${searchQuery}%`,
        },
      );
    }

    // Filter by autofix status if specified
    if (hasAutofix !== undefined && hasAutofix !== null) {
      if (hasAutofix === true) {
        // Has autofix: must have at least one autofixRecord
        queryBuilder.andWhere(
          `EXISTS (${successfulAutofixSubquery('vulnDetection')})`,
        );
      } else {
        // No autofix: must NOT have any autofixRecord
        queryBuilder.andWhere(
          `NOT EXISTS (${successfulAutofixSubquery('vulnDetection')})`,
        );
      }
    }

    // Invert the order for CASE-based sorting (critical=1, low=4)
    // DESC (descending severity) -> ASC on severity_order to get critical first
    // ASC (ascending severity) -> DESC on severity_order to get low first
    const invertedOrder = safeOrder === 'DESC' ? 'ASC' : 'DESC';

    if (safeSort === 'currentSeverity') {
      queryBuilder
        .addSelect(
          `CASE
          WHEN ${effectiveSeveritySql('vulnDetection')} = 'critical' THEN 1
          WHEN ${effectiveSeveritySql('vulnDetection')} = 'high' THEN 2
          WHEN ${effectiveSeveritySql('vulnDetection')} = 'medium' THEN 3
          WHEN ${effectiveSeveritySql('vulnDetection')} = 'low' THEN 4
          ELSE 5
        END`,
          'severity_order',
        )
        .orderBy('severity_order', invertedOrder as 'ASC' | 'DESC');
    } else if (safeSort === 'currentPriority') {
      queryBuilder
        .addSelect(
          `CASE
          WHEN vulnDetection.currentPriority = 'critical_urgent' THEN 1
          WHEN vulnDetection.currentPriority = 'urgent' THEN 2
          WHEN vulnDetection.currentPriority = 'normal' THEN 3
          WHEN vulnDetection.currentPriority = 'low' THEN 4
          WHEN vulnDetection.currentPriority = 'very_low' THEN 5
          ELSE 6
        END`,
          'priority_order',
        )
        .orderBy('priority_order', invertedOrder as 'ASC' | 'DESC');
    } else if (safeSort === 'priorityScore') {
      queryBuilder
        .addSelect(
          'CASE WHEN vulnDetection.priorityScore IS NULL THEN 1 ELSE 0 END',
          'priority_score_null_order',
        )
        .orderBy('priority_score_null_order', 'ASC')
        .addOrderBy('vulnDetection.priorityScore', safeOrder as 'ASC' | 'DESC');
    } else {
      queryBuilder.orderBy(
        `vulnDetection.${safeSort}`,
        safeOrder as 'ASC' | 'DESC',
      );
    }

    const skip = (pageNumber - 1) * limit;
    queryBuilder.skip(skip).take(limit);

    // Same parallel tail pattern as SAST/IAC/CICD list above (incl. the
    // languages facet).
    // A slim list does not read the project at all.
    const lookup = slim
      ? undefined
      : lookupProjectWithScaBranches(
          this.projectServiceClient,
          projectId,
          branch,
        );
    const [
      [vulnerabilitiesEntities, total],
      projectResponse,
      scanResponse,
      vulnCountByType,
      autofixCounts,
      languages,
    ] = await Promise.all([
      queryBuilder.getManyAndCount() as Promise<
        [SecretVulnerabilityDetections[], number]
      >,
      // A slim list reads none of these (see unlessSlim).
      this.unlessSlim(
        slim,
        {} as ProjectInformationsResponse,
        () => lookup.projectLookup,
      ),
      this.unlessSlim(slim, {} as GetLastScanStatusResponse, () =>
        safeGrpcCall<GetLastScanStatusResponse>(
          this.scanServiceClient.getLastScanStatus({ projectId }),
        ),
      ),
      this.unlessSlim(slim, undefined, () =>
        lookup.scaBranches.then((branches) =>
          this.resultService.getCountVulnerabilitiesCountByType(
            projectId,
            branch,
            branches,
          ),
        ),
      ),
      // The dashboard Results pages never read these counts:
      // they opt out (excludeAutofixCounts) and save five queries.
      this.unlessSlim(slim, emptyAutofixCountByType(), () =>
        excludeAutofixCounts
          ? Promise.resolve(undefined)
          : lookup.scaBranches.then((branches) =>
              this.resultService.getAutofixCountByType(
                projectId,
                branch,
                branches,
              ),
            ),
      ),
      this.unlessSlim(slim, [], () =>
        fetchDistinctVulnerabilityLanguages(
          this.secretVulnDetectRepository,
          projectId,
          branch,
          (error) =>
            this.logger.warn(
              `languages facet failed for project=${projectId} (secret); returning []: ${error}`,
            ),
        ),
      ),
    ]);

    const totalPages = Math.ceil(total / limit);

    const scanProjectInfo: ScanProjectInfo = {
      scanId: scanResponse.id,
      state: scanResponse.state,
      createAt: scanResponse.createAt,
      scanType: scanResponse.scanType,
    };

    for (const vuln of vulnerabilitiesEntities) {
      delete vuln.scannerType;
    }

    // The slim list loads no history; Cybe analysis is read
    // for the ids of the page.
    const cybeAnalysed = slim
      ? await findCybeAnalysedDetectionIds(
          this.secretVulnDetectRepository,
          projectId,
          vulnerabilitiesEntities.map((v) => v.id),
        )
      : null;
    const userMap = await this.resolveHistoryUsers(vulnerabilitiesEntities);

    const vulnerabilities: VulnerabilitySecret[] = [];
    for (const vulnEntity of vulnerabilitiesEntities) {
      const vulnProto: VulnerabilitySecret = {
        base: mapSecretDetectionEntityToListInterface(
          vulnEntity,
          this.cvssExplainer,
        ),
        hasEncryptedSecret:
          vulnEntity.encryptedSecret != null &&
          vulnEntity.encryptedSecret.length > 0,
        commitSha: vulnEntity.commitSha || undefined,
        source: vulnEntity.source || undefined,
      };
      if (cybeAnalysed) {
        vulnProto.base.hasCybeAnalysis = cybeAnalysed.has(vulnEntity.id);
      }
      const historyItemsWithUserDetails: HistoryItem[] = [];
      if (
        Array.isArray(vulnEntity.historyItems) &&
        vulnEntity.historyItems.length > 0
      ) {
        for (const historyItem of vulnEntity.historyItems) {
          const uid = historyItem.userId;
          const userGetResponse: UserInformationsResponse | null =
            !uid || uid === 'system'
              ? this.getSystemUser()
              : (userMap.get(uid) ?? null);
          historyItemsWithUserDetails.push({
            ...historyItem,
            user: userGetResponse,
            date: historyItem.date
              ? historyItem.date.toISOString()
              : new Date().toISOString(),
          });
        }
      }
      vulnProto.base.historyItems = { items: historyItemsWithUserDetails };
      vulnerabilities.push(vulnProto);
    }

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
      languages,
      vulnerabilities: vulnerabilities,
      total,
      scanProjectInfo,
      vulnCountByType,
      autofixCountByType: autofixCounts
        ? {
            sast: autofixCounts.sast,
            iac: autofixCounts.iac,
            cicd: autofixCounts.cicd,
            secret: autofixCounts.secret,
            sca: autofixCounts.sca,
          }
        : undefined,
    };
  }

  /**
   * Get project Secret vulnerability by id.
   *
   * @param GetProjectVulnerabilityByIdRequestDto - The request to get the vulnerability.
   * @returns The vulnerability for the project.
   */
  @Span()
  async getSecretVulnerabilityByIdInProject(
    GetProjectVulnerabilityByIdRequestDto: GetProjectVulnerabilityByIdRequest,
  ): Promise<GetProjectVulnerabilityByIdResponse> {
    const { projectId, vulnerabilityId } =
      GetProjectVulnerabilityByIdRequestDto;

    const vulnerability = await this.secretVulnDetectRepository.findOne({
      where: { projectId, id: vulnerabilityId },
      relations: [
        'vulnerability',
        'vulnerability.references',
        'historyItems',
        'codeSnippets',
        'autofixRecords',
      ],
    });

    if (!vulnerability) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: `Vulnerability not found in project`,
      });
    }

    delete vulnerability.scannerType;

    // Dedupe + parallel user fetch via helper.
    const userMap = await this.resolveHistoryUsers([vulnerability]);

    const historyItemsWithUserDetails: HistoryItem[] = [];
    for (const historyItem of vulnerability.historyItems) {
      const uid = historyItem.userId;
      const userGetResponse: UserInformationsResponse | null =
        !uid || uid === 'system'
          ? this.getSystemUser()
          : (userMap.get(uid) ?? null);
      historyItemsWithUserDetails.push({
        ...historyItem,
        user: userGetResponse,
        date: historyItem.date
          ? historyItem.date.toISOString()
          : new Date().toISOString(),
      });
    }

    const vulnerabilityInterface: VulnerabilitySecret =
      mapSecretDetectionToProto(vulnerability, this.cvssExplainer);

    vulnerabilityInterface.base.historyItems = {
      items: historyItemsWithUserDetails,
    };

    return {
      projectId,
      vulnerabilityId,
      secret: vulnerabilityInterface,
    };
  }
}
