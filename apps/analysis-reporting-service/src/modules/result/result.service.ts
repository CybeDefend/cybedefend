import {
  Inject,
  Injectable,
  Logger,
  Optional,
  forwardRef,
} from '@nestjs/common';
import { RealtimeEventPublisher } from '@cybedefend/realtime-publisher';
import { dateBucket, inList, intervalAgo, sql } from '@cybedefend/db-dialect';
import type { Sql } from '@cybedefend/db-dialect';
import {
  joinSql,
  rawBool,
  rawIdent,
  rawSql,
  sumExists,
} from 'src/core/db/raw-sql';
import { vulnerabilityUpdatedEvent } from 'src/core/realtime/vulnerability-updated.event';
import { InjectRepository } from '@nestjs/typeorm';
import { Span } from 'nestjs-otel';
import {
  Repository,
  In,
  MoreThanOrEqual,
  ObjectLiteral,
  SelectQueryBuilder,
} from 'typeorm';
import { ClientGrpc, RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { IacVulnerabilityDetections } from 'src/entities/iac-vulnerability-detections.entity';
import { CicdVulnerabilityDetections } from 'src/entities/cicd-vulnerability-detections.entity';
import { SecretVulnerabilityDetections } from 'src/entities/secret-vulnerability-detections.entity';
import { SastVulnerabilityDetections } from 'src/entities/sast-vulnerability-detections.entity';
import { ScaVulnerabilityDetections } from 'src/entities/sca-vulnerability-detections.entity';
import {
  SCAN_SERVICE_NAME,
  ScanServiceClient,
} from '@grpc/security-scanning/security_scanning';
import { SastIacUtilsService } from '../sast-iac/sast-iac.utils';
import { ACTIVE_VULN_STATES } from '../cyber-risk/cyber-risk.constants';
import {
  DISPLAYABLE_SEVERITIES,
  effectiveSeveritySql,
  UNLABELLED_SEVERITY,
} from '../cvss/effective-severity-sql';
import {
  CountVulnerabilitiesCountByType,
  CountVulnerabilitiesTypeResponse,
  GetMainStatisticsRequest,
  GetMainStatisticsResponse,
  GetProjectOverviewRequest,
  GetProjectOverviewResponse,
  GetProjectRiskSummaryRequest,
  GetProjectRiskSummaryResponse,
  GetProjectVulnerabilitiesCountResponse,
  GetProjectVulnerabilityByIdResponse,
  ProjectGetRequest,
  TotalByAnalysisType,
  TotalBySeverity,
  TotalByState,
  UpdateResultRequest,
  VulnerabilitiesOverTime,
  GetOrganizationOverviewRequest,
  GetOrganizationOverviewResponse,
  GetOrganizationSeverityDistributionRequest,
  GetOrganizationSeverityDistributionResponse,
  GetOrganizationStateDistributionRequest,
  GetOrganizationStateDistributionResponse,
  GetOrganizationVulnerabilitiesOverTimeRequest,
  GetOrganizationVulnerabilitiesOverTimeResponse,
  BatchUpdateResultRequest,
  BatchUpdateResultResponse,
  BatchUpdateResultItem,
  GetPriorityDecompositionRequest,
  GetPriorityDecompositionResponse,
  GetTopVulnerabilitiesRequest,
  GetTopVulnerabilitiesResponse,
  TopVulnerabilityItem,
  CyberRiskScore as CyberRiskScoreProto,
} from 'src/core/grpc/analysis-reporting/result';
import { VulnerabilityDetectionsContainer } from 'src/entities/container_vulnerability_detections.entity';
import { SastIacService } from '../sast-iac/sast-iac.service';
import { GetLastScanStatusResponse } from '@grpc/security-scanning/scan';
import { safeGrpcCall } from '@grpc/wrapper-grpc.module';
// The DeleteProjectVulnerabilityDetections RPC uses result.proto's
// ProjectDeleteRequest (carries organizationId ), not
// global-management's same-named message — import from the canonical contract.
import {
  ProjectDeleteRequest,
  ProjectDeleteResponse,
} from '@grpc/analysis-reporting/result';
import { ScaDetectedPackages } from 'src/entities/sca-detected-packages.entity';
import { ContainerDetectedImage } from 'src/entities/container-detected-image.entity';
import { ContainerDetectedPackage } from 'src/entities/container-detected-package.entity';
import { ContainerService } from '../container/container.service';
import { ScaService } from '../sca/sca.service';
import { HistoryItem as HistoryItemEntity } from 'src/entities/history-item.entity';
import { AutoFixRecord } from 'src/entities/autofix-record.entity';
import { SecurityContextCacheService } from '../security-context/security-context-cache.service';
import { CyberRiskService } from '../cyber-risk/cyber-risk.service';
import { ProjectCyberRiskRepository } from '../cyber-risk/repositories/project-cyber-risk.repository';
import { CyberiskRecomputeEnqueuer } from '../cyber-risk/cyberisk-recompute.enqueuer';
import { ActiveVulnFetcher } from '../cyber-risk/active-vuln-fetcher.service';
import { ReferenceBranchResolver } from '../cyber-risk/reference-branch.resolver';
import { scopingBranchesFor } from '../cyber-risk/branch-scoping.util';
import { resolveScaEffectiveBranches } from '../sca/sca-branch.util';
import {
  persistedCyberRiskToProto,
  buildBreakdown,
} from '../cyber-risk/cyber-risk.mapper';
import { OrganizationOverviewService } from './organization-overview.service';
import { accumulateOpenOverTime, OverTimeRawRow } from './over-time.util';
import { unionAll } from './union-all.util';
import { createConcurrencyLimiter } from './concurrency-limiter.util';
import {
  PriorityCalculatorService,
  PriorityInput,
  PriorityResult,
} from './priority-calculator.service';
import { ProjectSecurityContext } from '@grpc/global-management/project';
import {
  CvssCalculatorService,
  EnvironmentalResult,
} from '../cvss/cvss-calculator.service';
import { mapProjectContextToScoringContext } from '../cvss/security-context-mapper';
import { resolveEffectiveSeverity } from '../cvss/severity-from-cvss';
import {
  AIBOM_INVENTORY,
  type AibomInventory,
} from '../../edition/ports/aibom-inventory.port';
import { IssueIntegrationService } from '../vulnerability/issue-integration.service';
import {
  TicketOutcome,
  ticketOutcomeOf,
} from '../vulnerability/ticket-outcome';

/**
 * The most queries one project overview runs at once. The
 * service's pool has 20 connections (app.module.ts) and the overview is
 * opened twice per visit.
 */
const OVERVIEW_QUERIES_IN_FLIGHT = 6;

/**
 * The per-type and autofix counters take the SCA branch
 * partition from their caller. A caller that does not pass it is a bug: fail
 * loudly rather than quietly resolve it with one more `ProjectService/Get`.
 */
function assertScaPartition(scaEffectiveBranches: string[]): void {
  if (!Array.isArray(scaEffectiveBranches)) {
    throw new RpcException({
      code: status.INTERNAL,
      message: 'The SCA branch partition of the counters is required',
    });
  }
}

/** Most findings the project top answers with. */
const MAX_TOP_VULNERABILITIES = 50;

/**
 * The detection columns the project top reads: the
 * composite score inputs (see computeScore), the item fields and the order.
 * The top used to hydrate whole detections and their whole catalogue entry.
 */
const TOP_SCORE_COLUMNS = {
  id: true,
  currentSeverity: true,
  effectiveSeverity: true,
  cvss4EnvironmentalScore: true,
  cvss4BaseScore: true,
  epssScore: true,
  epssPercentile: true,
  exploitabilityScore: true,
  exploitabilityVerdict: true,
  exploitabilityReason: true,
  exploitabilityScoreReason: true,
  exploitabilitySource: true,
  priorityManualOverride: true,
  priorityScore: true,
} as const;

/** The catalogue columns a SAST/IaC/CICD/Secret item of the top shows. */
const TOP_RULE_COLUMNS = {
  id: true,
  name: true,
  shortDescription: true,
  cwe: true,
} as const;

/**
 * The reason shown on the ticket: only a dismissal carries one
 * (`dismissalReason`, required when the status is `ignored`).
 */
function ticketReasonOf(
  outcome: TicketOutcome,
  dismissalReason: string | undefined,
): string | undefined {
  return outcome === 'ignored' ? dismissalReason || undefined : undefined;
}
import { applyProjectImportedAdvisories } from '../results-import/imported-advisory.view';

@Injectable()
export class ResultService {
  private readonly logger = new Logger(ResultService.name);

  private scanServiceClient!: ScanServiceClient;

  constructor(
    @InjectRepository(SastVulnerabilityDetections)
    private readonly sastVulnDetectRepository: Repository<SastVulnerabilityDetections>,
    @InjectRepository(IacVulnerabilityDetections)
    private readonly iacVulnDetectRepository: Repository<IacVulnerabilityDetections>,
    @InjectRepository(CicdVulnerabilityDetections)
    private readonly cicdVulnDetectRepository: Repository<CicdVulnerabilityDetections>,
    @InjectRepository(SecretVulnerabilityDetections)
    private readonly secretVulnDetectRepository: Repository<SecretVulnerabilityDetections>,
    @InjectRepository(ScaVulnerabilityDetections)
    private readonly scaVulnDetectRepository: Repository<ScaVulnerabilityDetections>,
    @InjectRepository(VulnerabilityDetectionsContainer)
    private readonly containerVulnDetectRepository: Repository<VulnerabilityDetectionsContainer>,
    @InjectRepository(ScaDetectedPackages)
    private readonly scaDetectedPackageRepository: Repository<ScaDetectedPackages>,
    @InjectRepository(ContainerDetectedImage)
    private readonly containerDetectedImageRepository: Repository<ContainerDetectedImage>,
    @InjectRepository(ContainerDetectedPackage)
    private readonly containerDetectedPackageRepository: Repository<ContainerDetectedPackage>,
    @InjectRepository(HistoryItemEntity)
    private readonly historyItemRepository: Repository<HistoryItemEntity>,
    @Inject('SECURITY_SCANNING_SERVICE')
    private readonly securityScanningClient: ClientGrpc,
    @Inject(forwardRef(() => SastIacUtilsService))
    private readonly sastIacUtilsService: SastIacUtilsService,
    @Inject(forwardRef(() => ContainerService))
    private readonly containerService: ContainerService,
    @Inject(forwardRef(() => ScaService))
    private readonly scaService: ScaService,
    @Inject(forwardRef(() => SastIacService))
    private readonly sastIacService: SastIacService,
    @InjectRepository(AutoFixRecord)
    private readonly autoFixRepo: Repository<AutoFixRecord>,
    private readonly organizationOverviewService: OrganizationOverviewService,
    private readonly priorityCalculator: PriorityCalculatorService,
    private readonly cvssCalculator: CvssCalculatorService,
    private readonly securityContextCache: SecurityContextCacheService,
    private readonly cyberRiskService: CyberRiskService,
    private readonly projectCyberRiskRepo: ProjectCyberRiskRepository,
    private readonly activeVulnFetcher: ActiveVulnFetcher,
    private readonly referenceBranchResolver: ReferenceBranchResolver,
    private readonly cyberiskEnqueuer: CyberiskRecomputeEnqueuer,
    // A finding handled here is reported to Linear. forwardRef:
    // IssueIntegrationService sits in the SastIacService <-> ResultService
    // cycle (sast-iac.utils.ts injects both).
    @Inject(forwardRef(() => IssueIntegrationService))
    private readonly issueIntegrationService: IssueIntegrationService,
    @Optional() private readonly realtime?: RealtimeEventPublisher | null,
    // The closed AI-BOM inventory, supplied by the ee AibomModule.
    // Absent in the Community Edition: no AI-BOM count, nothing to delete.
    @Optional()
    @Inject(AIBOM_INVENTORY)
    private readonly aibom?: AibomInventory,
  ) {}

  /**
   * Notify subscribers of the per-vulnerability stream that the row changed
   * (status / priority / comment / autofix verdict / agent reanalysis ...).
   * Keeps the issue detail page live without polling.
   */
  private publishVulnerabilityUpdated(
    projectId: string,
    vulnerabilityId: string,
    scannerType: string,
  ): void {
    if (!this.realtime) return;
    void this.realtime.publish(
      vulnerabilityUpdatedEvent(projectId, vulnerabilityId, scannerType),
    );
  }

  onModuleInit() {
    this.scanServiceClient =
      this.securityScanningClient.getService<ScanServiceClient>(
        SCAN_SERVICE_NAME,
      );
  }

  /**
   * Fetch the project security context from global-management, with in-memory caching.
   * Thin wrapper preserved for backward compatibility — delegates to the shared cache.
   */
  async getSecurityContextCached(
    projectId: string,
  ): Promise<ProjectSecurityContext | null> {
    return this.securityContextCache.get(projectId);
  }

  invalidateSecurityContextCache(projectId: string): void {
    this.securityContextCache.invalidate(projectId);
  }

  /**
   * Compute environmental CVSS score + full vector for a given project and base vector.
   * Resolves the project's security context, maps gRPC enums to scoring strings,
   * and delegates to CvssCalculatorService.applyEnvironmentalMetrics.
   *
   * Returns null when the security context cannot be resolved or the base vector is invalid.
   */
  async computeEnvironmentalForProject(
    projectId: string,
    cvss4BaseVector: string,
  ): Promise<EnvironmentalResult | null> {
    const grpcCtx = await this.getSecurityContextCached(projectId);
    if (!grpcCtx) return null;
    const scoringCtx = mapProjectContextToScoringContext(grpcCtx);
    return this.cvssCalculator.applyEnvironmentalMetrics(
      cvss4BaseVector,
      scoringCtx,
    );
  }

  /**
   * Recalculate priority for a detection entity using the algorithmic formula.
   * Returns the new priority, or null if manual override is active.
   *
   * effectiveSeverity is intentionally NOT a parameter - resolveEffectiveSeverity
   * recomputes it from the CVSS4 scores already passed in, so forwarding a
   * precomputed value is redundant and fragile (if callers derived it from
   * stale scores the live recompute would silently diverge).
   */
  async recalculatePriority(
    vuln: {
      cvss4EnvironmentalScore: number;
      cvss4BaseScore: number;
      currentSeverity: string;
      epssScore: number;
      epssPercentile: number | null;
      exploitabilityScore: number;
      priorityManualOverride: boolean;
      isMalware?: boolean;
    },
    projectId: string,
    reachability?: string | null,
    opts?: { forceRecompute?: boolean },
  ): Promise<PriorityResult | null> {
    const ctx = await this.getSecurityContextCached(projectId);
    const input: PriorityInput = {
      cvss4EnvironmentalScore: vuln.cvss4EnvironmentalScore ?? null,
      cvss4BaseScore: vuln.cvss4BaseScore ?? null,
      currentSeverity: resolveEffectiveSeverity(vuln) ?? '',
      epssScore: vuln.epssScore ?? null,
      epssPercentile: vuln.epssPercentile ?? null,
      exploitabilityScore: vuln.exploitabilityScore ?? null,
      businessCriticality: ctx?.businessCriticality ?? 0,
      dataClassification: ctx?.dataClassification ?? 0,
      reachability: reachability ?? null,
      isMalware: vuln.isMalware ?? false, // malware flag
      // A manual verdict freezes the priority against AUTOMATED
      // crons (EPSS/OSV/agent reanalyze). When the analyst explicitly changes the
      // verdict (forceRecompute), that explicit action must recompute the priority
      // from the new exploitability score — the freeze only blocks automated churn,
      // not the analyst's own action.
      priorityManualOverride: opts?.forceRecompute
        ? false
        : (vuln.priorityManualOverride ?? false),
    };
    return this.priorityCalculator.calculate(input);
  }

  /**
   * Get priority decomposition for a specific vulnerability detection.
   */
  async getPriorityDecomposition(
    request: GetPriorityDecompositionRequest,
  ): Promise<GetPriorityDecompositionResponse> {
    const { projectId, vulnerabilityId, vulnerabilityType } = request;

    const repoMap: Record<string, Repository<any>> = {
      sast: this.sastVulnDetectRepository,
      iac: this.iacVulnDetectRepository,
      sca: this.scaVulnDetectRepository,
      container: this.containerVulnDetectRepository,
      cicd: this.cicdVulnDetectRepository,
      secret: this.secretVulnDetectRepository,
    };

    const normalizedType = vulnerabilityType?.toLowerCase();
    const repo = repoMap[normalizedType];
    if (!repo) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: `Invalid vulnerability type: ${vulnerabilityType}`,
      });
    }

    // SCA reachability lives on the package, not the detection — without the
    // relation the decomposition stays flat across detections of the same
    // severity/CVSS, making the "Why this priority?" bar look static.
    const findOptions: Record<string, unknown> = {
      where: { projectId, id: vulnerabilityId },
    };
    if (normalizedType === 'sca') {
      findOptions.relations = ['scaDetectedPackage'];
    }

    const vuln = await repo.findOne(findOptions);
    if (!vuln) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: `Vulnerability ${vulnerabilityId} not found`,
      });
    }

    // Secrets bypass the multi-signal composite — priority is deterministic
    // (always critical_urgent) and exploitability does not apply. Return a flat
    // decomposition rather than weighting CVSS/EPSS/exploitability .
    //
    if (normalizedType === 'secret') {
      return {
        decomposition: {
          priority: vuln.priorityManualOverride
            ? ''
            : (vuln.currentPriority ?? 'critical_urgent'),
          compositeScore: (vuln.priorityScore ?? 100) / 100,
          cvss4Contribution: 0,
          epssContribution: 0,
          exploitContribution: 0,
          contextContribution: 0,
          w1: 0,
          w2: 0,
          w3: 0,
          w4: 0,
          isManualOverride: vuln.priorityManualOverride ?? false,
        },
      };
    }

    const ctx = await this.getSecurityContextCached(projectId);
    const reachability =
      normalizedType === 'sca'
        ? (vuln.scaDetectedPackage?.reachability ?? null)
        : null;
    const input: PriorityInput = {
      cvss4EnvironmentalScore: vuln.cvss4EnvironmentalScore ?? null,
      cvss4BaseScore: vuln.cvss4BaseScore ?? null,
      currentSeverity: resolveEffectiveSeverity(vuln) ?? '',
      epssScore: vuln.epssScore ?? null,
      epssPercentile: vuln.epssPercentile ?? null,
      exploitabilityScore: vuln.exploitabilityScore ?? null,
      businessCriticality: ctx?.businessCriticality ?? 0,
      dataClassification: ctx?.dataClassification ?? 0,
      reachability,
      priorityManualOverride: vuln.priorityManualOverride ?? false,
      // SCA malware uses the exploitability+context-only weight model.
      isMalware: normalizedType === 'sca' ? (vuln.isMalware ?? false) : false,
    };

    const decomposition = this.priorityCalculator.decompose(input);
    return { decomposition };
  }

  /**
   * Update the scan result, then report the finding's new state to Linear
   *  without waiting for it: a Linear failure never fails the
   * update. A priority-only or comment-only update reports nothing.
   *
   * @param request - The update result request.
   * @param options.deferTicketSync - the caller reports the outcome itself,
   *   once for many findings (`applyBatchUpdate`).
   * @returns The vulnerability by id response.
   */
  @Span()
  async updateScanResult(
    request: UpdateResultRequest,
    options: { deferTicketSync?: boolean } = {},
  ): Promise<GetProjectVulnerabilityByIdResponse> {
    const result = await this.applyScanResultUpdate(request);
    const outcome = ticketOutcomeOf(request.status);
    if (outcome && !options.deferTicketSync) {
      this.reportHandledFindings(
        request.projectId,
        [request.vulnerabilityId],
        outcome,
        ticketReasonOf(outcome, request.dismissalReason),
      );
    }
    return result;
  }

  /**
   * Tell Linear what became of findings a person or the agent handled
   * : external-integrations closes, comments on or reopens their
   * tickets. Fire and forget: never awaited, never throws.
   */
  reportHandledFindings(
    projectId: string,
    vulnerabilityIds: string[],
    outcome: TicketOutcome,
    reason?: string,
  ): void {
    const logFailure = (error: unknown): void =>
      this.logger.warn(
        `[TicketSync] Could not report ${vulnerabilityIds.length} ${outcome} finding(s) of project ${projectId}: ${(error as Error)?.message || error}`,
      );
    try {
      void this.issueIntegrationService
        .syncLinearFindingStates(projectId, vulnerabilityIds, outcome, reason)
        .catch(logFailure);
    } catch (error) {
      logFailure(error);
    }
  }

  /** Apply one update with the handler of the finding's scanner. */
  private async applyScanResultUpdate(
    request: UpdateResultRequest,
  ): Promise<GetProjectVulnerabilityByIdResponse> {
    try {
      const { projectId, vulnerabilityId } = request;

      if (!projectId || !vulnerabilityId) {
        throw new RpcException({
          code: status.INVALID_ARGUMENT,
          message: 'projectId and vulnerabilityId are required',
        });
      }

      const vulnContainer = await this.containerVulnDetectRepository.findOne({
        where: { projectId, id: vulnerabilityId },
        relations: ['detectedImage', 'detectedPackage', 'historyItems'],
      });
      if (vulnContainer) {
        const result = await this.containerService.handleUpdateContainer(
          vulnContainer,
          request,
        );
        this.publishVulnerabilityUpdated(
          projectId,
          vulnerabilityId,
          'container',
        );
        return result;
      }

      const vulnSast = await this.sastVulnDetectRepository.findOne({
        where: { projectId, id: vulnerabilityId },
      });

      if (vulnSast) {
        const result = await this.sastIacUtilsService.handleUpdateSast(
          vulnSast,
          request,
        );
        this.publishVulnerabilityUpdated(projectId, vulnerabilityId, 'sast');
        return result;
      }

      const vulnIac = await this.iacVulnDetectRepository.findOne({
        where: { projectId, id: vulnerabilityId },
      });

      if (vulnIac) {
        const result = await this.sastIacUtilsService.handleUpdateIac(
          vulnIac,
          request,
        );
        this.publishVulnerabilityUpdated(projectId, vulnerabilityId, 'iac');
        return result;
      }

      const vulnSca = await this.scaVulnDetectRepository.findOne({
        where: { id: vulnerabilityId },
        relations: ['scaDetectedPackage'],
      });

      if (vulnSca && vulnSca.scaDetectedPackage?.projectId === projectId) {
        const result = await this.scaService.handleUpdateSca(vulnSca, request);
        this.publishVulnerabilityUpdated(projectId, vulnerabilityId, 'sca');
        return result;
      }

      const vulnCicd = await this.cicdVulnDetectRepository.findOne({
        where: { projectId, id: vulnerabilityId },
      });

      if (vulnCicd) {
        const result = await this.sastIacUtilsService.handleUpdateCicd(
          vulnCicd,
          request,
        );
        this.publishVulnerabilityUpdated(projectId, vulnerabilityId, 'cicd');
        return result;
      }

      const vulnSecret = await this.secretVulnDetectRepository.findOne({
        where: { projectId, id: vulnerabilityId },
      });

      if (vulnSecret) {
        const result = await this.sastIacUtilsService.handleUpdateSecret(
          vulnSecret,
          request,
        );
        this.publishVulnerabilityUpdated(projectId, vulnerabilityId, 'secret');
        return result;
      }

      throw new RpcException({
        code: status.NOT_FOUND,
        message: `Vulnerability #${vulnerabilityId} not found in project (SAST/IAC/SCA/CICD/Secret)`,
      });
    } catch (error) {
      if (error instanceof RpcException) {
        throw error;
      }
      throw new RpcException({
        code: status.INTERNAL,
        message: `Error updating scan result`,
      });
    }
  }

  /**
   * Core batch-update loop shared by the synchronous gRPC path and the async
   * worker path.  An optional `onProgress` callback is invoked after every
   * item (including after the event-loop yield) so callers can report
   * incremental progress without polling.
   *
   * @param request  - The batch update request containing project ID, items, and user ID.
   * @param onProgress - Optional callback called after each item with running totals.
   * @returns The batch update response with results per vulnerability.
   */
  async applyBatchUpdate(
    request: BatchUpdateResultRequest,
    onProgress?: (p: {
      processed: number;
      succeeded: number;
      failed: number;
    }) => void | Promise<void>,
  ): Promise<BatchUpdateResultResponse> {
    const {
      projectId,
      items,
      userId,
      agentToolCallId,
      agentConversationId,
      agentStreamId,
    } = request;
    const results: BatchUpdateResultItem[] = [];
    let successCount = 0;
    let failureCount = 0;
    // Reported to Linear once the batch is done, one call per
    // outcome and reason: 50 findings of one ticket dismissed together make
    // one comment and one closing, not 50.
    const handled = new Map<
      string,
      { outcome: TicketOutcome; reason?: string; vulnerabilityIds: string[] }
    >();

    // Process each vulnerability update
    for (const item of items) {
      try {
        // Skip if no update fields provided
        if (!item.status && !item.priority && !item.comment) {
          results.push({
            vulnerabilityId: item.vulnerabilityId,
            success: false,
            error:
              'No update fields provided (status, priority, or comment required)',
          });
          failureCount++;
        } else {
          // Build update request for single vulnerability. The audit
          // ids are forwarded so every HistoryItem produced by this batch
          // points back to the same chat tool call.
          const updateRequest: UpdateResultRequest = {
            projectId,
            vulnerabilityId: item.vulnerabilityId,
            status: item.status || '',
            priority: item.priority || '',
            comment: item.comment || '',
            // The batch item carries its own justification. Without it
            // the per-handler assertDismissalReason would make bulk dismissal
            // IMPOSSIBLE rather than merely audited — the queue path never
            // constructs the gateway DTO that would otherwise supply it.
            dismissalReason: item.dismissalReason || '',
            userId,
            exploitabilityScore: 0,
            exploitabilityVerdict: '',
            exploitabilityReason: '',
            exploitabilitySource: '',
            exploitabilityFactors: '',
            cvss4EnvAdjustments: '',
            scoringSource: '',
            exploitabilityScoreReason: '',
            agentToolCallId: agentToolCallId || '',
            agentConversationId: agentConversationId || '',
            agentStreamId: agentStreamId || '',
          };

          // Attempt to update using existing method
          await this.updateScanResult(updateRequest, { deferTicketSync: true });

          const outcome = ticketOutcomeOf(updateRequest.status);
          if (outcome) {
            const reason = ticketReasonOf(
              outcome,
              updateRequest.dismissalReason,
            );
            const key = JSON.stringify([outcome, reason ?? '']);
            const group = handled.get(key) ?? {
              outcome,
              reason,
              vulnerabilityIds: [],
            };
            group.vulnerabilityIds.push(item.vulnerabilityId);
            handled.set(key, group);
          }

          results.push({
            vulnerabilityId: item.vulnerabilityId,
            success: true,
          });
          successCount++;
        }
      } catch (error) {
        // Handle individual vulnerability errors without failing the whole batch
        let errorMessage = 'Unknown error';
        if (error instanceof RpcException) {
          const errorDetails = error.getError();
          errorMessage =
            typeof errorDetails === 'object' && 'message' in errorDetails
              ? (errorDetails as { message: string }).message
              : String(errorDetails);
        } else if (error instanceof Error) {
          errorMessage = error.message;
        }

        results.push({
          vulnerabilityId: item.vulnerabilityId,
          success: false,
          error: errorMessage,
        });
        failureCount++;
      }

      // Yield to event loop to prevent blocking during large batch operations
      await this.yieldToEventLoop();

      await onProgress?.({
        processed: successCount + failureCount,
        succeeded: successCount,
        failed: failureCount,
      });
    }

    for (const { outcome, reason, vulnerabilityIds } of handled.values()) {
      this.reportHandledFindings(projectId, vulnerabilityIds, outcome, reason);
    }

    return {
      projectId,
      totalCount: items.length,
      successCount,
      failureCount,
      results,
    };
  }

  /**
   * Batch update multiple vulnerabilities at once.
   * Updates status, priority, and/or comment for each vulnerability.
   * Returns results for each vulnerability (success/failure).
   *
   * @param request - The batch update request containing project ID, items, and user ID.
   * @returns The batch update response with results per vulnerability.
   */
  @Span()
  async batchUpdateScanResults(
    request: BatchUpdateResultRequest,
  ): Promise<BatchUpdateResultResponse> {
    return this.applyBatchUpdate(request);
  }

  /**
   * Add History Item to the database.
   *
   * @param historyItem - The history item.
   * @returns The history item.
   */
  @Span()
  async addHistoryItem(
    historyItem: HistoryItemEntity,
  ): Promise<HistoryItemEntity> {
    return this.historyItemRepository.save(historyItem);
  }

  /**
   * Get the count of vulnerabilities by type.
   *
   * @param projectId - The project ID.
   * @param branch - Optional branch filter for vulnerability isolation.
   * @param scaEffectiveBranches - The SCA logical branch partition,
   *   derived by the caller from the project it already read
   *   (`lookupProjectWithScaBranches`). Required: resolving it
   *   here cost one more `ProjectService/Get` per counter.
   * @returns The count of vulnerabilities by type.
   */
  @Span()
  async getCountVulnerabilitiesCountByType(
    projectId: string,
    branch: string | undefined,
    scaEffectiveBranches: string[],
  ): Promise<CountVulnerabilitiesCountByType> {
    if (!projectId) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Project ID is required',
      });
    }
    assertScaPartition(scaEffectiveBranches);

    const activeStates = [...ACTIVE_VULN_STATES];

    try {
      // Count only detections whose EFFECTIVE (env-derived) severity is one of
      // the four displayable bands — mirroring the list view's default
      // severity filter. A detection that resolves to 'none' (e.g. a CVSS
      // score of 0) is hidden from every list, so the per-type tab badge must
      // not count it either (BUG: badge showed 1 while the list showed 0). The
      // band is derived LIVE from the CVSS4 scores via effectiveSeveritySql,
      // never the stale effective_severity column.
      const displayable = [...DISPLAYABLE_SEVERITIES];
      // One part of the UNION ALL: `<alias>` as its type label, and the count.
      const countActiveDisplayable = (
        repo: Repository<ObjectLiteral>,
        alias: string,
        opts: {
          joinScaPackage?: boolean;
          branches?: string[];
          excludeMalware?: boolean;
        } = {},
      ) => {
        const qb = repo
          .createQueryBuilder(alias)
          .select(`'${alias}'`, 'type')
          .addSelect('COUNT(*)', 'count');
        if (opts.joinScaPackage) {
          qb.innerJoin(`${alias}.scaDetectedPackage`, 'pkg');
        }
        qb.where(`${alias}.projectId = :projectId`, { projectId })
          .andWhere(`${alias}.currentState IN (:...activeStates)`, {
            activeStates,
          })
          .andWhere(`${effectiveSeveritySql(alias)} IN (:...displayable)`, {
            displayable,
          });
        // Malware is separated out of the "Vulnerabilities" list, so
        // the SCA tab badge must not count it either (keep tab == list).
        if (opts.excludeMalware) {
          qb.andWhere(`${alias}.is_malware = :isMalware`, { isMalware: false });
        }
        // SCA passes its full logical branch partition (canonical
        // branch + legacy '' rows) so the tab badge matches the SCA list. Other
        // types keep the exact-branch behavior.
        if (opts.branches) {
          qb.andWhere(`${alias}.branch IN (:...branches)`, {
            branches: opts.branches,
          });
        } else if (branch) {
          qb.andWhere(`${alias}.branch = :branch`, { branch });
        }
        return qb;
      };

      // The six counts used to be six round-trips awaited
      // one after the other; they are one UNION ALL. COUNT(*) equals the
      // COUNT(DISTINCT id) getCount() ran: the only join (SCA → its package)
      // is many-to-one.
      const [sql, parameters] = unionAll([
        countActiveDisplayable(this.sastVulnDetectRepository, 'sast'),
        countActiveDisplayable(this.iacVulnDetectRepository, 'iac'),
        countActiveDisplayable(this.cicdVulnDetectRepository, 'cicd'),
        countActiveDisplayable(this.secretVulnDetectRepository, 'secret'),
        // On the detection's own projectId, the leading
        // column of IDX_vd_sca_proj_state: `pkg.projectId` made MySQL scan the
        // whole SCA table or every package of the project. Same rows while a
        // detection carries its package's project, which both ingestion
        // factories write. The INNER JOIN stays: it keeps out the detections
        // whose package is gone, as the SCA list does. The partition is the
        // caller's: the one its list reads.
        countActiveDisplayable(this.scaVulnDetectRepository, 'sca', {
          joinScaPackage: true,
          branches: scaEffectiveBranches,
          excludeMalware: true,
        }),
        countActiveDisplayable(this.containerVulnDetectRepository, 'container'),
      ]);

      const [rows, aibomCount] = await Promise.all([
        this.sastVulnDetectRepository.query(sql, parameters) as Promise<
          Array<{ type: string; count: string | number }>
        >,
        // Surface the AI-BOM (EU AI Act Annex IV) inventory count on
        // every listing so the dashboard's AI-BOM tab badge stays in sync no
        // matter which sibling tab the user is on. countMergedComponents
        // swallows its own errors → never blocks the vulnerability counts.
        this.aibom ? this.aibom.countMergedComponents(projectId, branch) : 0,
      ]);
      const countOf = (type: string): number =>
        Number(rows.find((row) => row.type === type)?.count ?? 0);

      return {
        sast: countOf('sast'),
        iac: countOf('iac'),
        cicd: countOf('cicd'),
        secret: countOf('secret'),
        sca: countOf('sca'),
        container: countOf('container'),
        aibom: aibomCount,
      };
    } catch (error) {
      this.logger.error(
        `Error getting vulnerability counts: ${(error as Error)?.message ?? String(error)}`,
        (error as Error)?.stack,
      );
      throw new RpcException({
        code: status.INTERNAL,
        message: `Error getting vulnerability counts`,
      });
    }
  }

  /**
   * Get the count of vulnerabilities with/without autofix by type.
   * Counts SAST, IAC, CICD, Secret, and SCA vulnerabilities.
   *
   * @param projectId - The project ID.
   * @param branch - Optional branch filter for vulnerability isolation.
   * @param scaEffectiveBranches - The SCA logical branch partition, required:
   *   see {@link getCountVulnerabilitiesCountByType}.
   * @returns Autofix statistics by vulnerability type.
   */
  @Span()
  async getAutofixCountByType(
    projectId: string,
    branch: string | undefined,
    scaEffectiveBranches: string[],
  ): Promise<{
    sast: { withAutofix: number; withoutAutofix: number };
    iac: { withAutofix: number; withoutAutofix: number };
    cicd: { withAutofix: number; withoutAutofix: number };
    secret: { withAutofix: number; withoutAutofix: number };
    sca: { withAutofix: number; withoutAutofix: number };
  }> {
    if (!projectId) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Project ID is required',
      });
    }

    assertScaPartition(scaEffectiveBranches);

    const activeStates = [...ACTIVE_VULN_STATES];

    // The SCA autofix sub-counts must use the same logical branch
    // partition (canonical branch + legacy '' rows) as the SCA list and the
    // headline count, so the "To Fix / Fix Proposed" split returned alongside
    // the list never disagrees with it: the caller's partition.
    const scaBranches = scaEffectiveBranches;

    try {
      // One query per table instead of two: the
      // active total and, among them, those with an autofix record
      // (COUNT(*) + SUM(EXISTS(...))). "Without" is the difference: EXISTS
      // is never NULL, so every row is in exactly one of the two. The five
      // queries run in parallel instead of ten in a row.
      const countWithAutofix = (
        repo: Repository<ObjectLiteral>,
        autofixExists: string,
        scoped: (qb: SelectQueryBuilder<ObjectLiteral>) => void,
      ): Promise<{ withAutofix: number; withoutAutofix: number }> => {
        const qb = repo
          .createQueryBuilder('v')
          .select('COUNT(*)', 'total')
          .addSelect(sumExists(autofixExists), 'withAutofix')
          .where('v.projectId = :projectId', { projectId })
          .andWhere('v.currentState IN (:...states)', { states: activeStates });
        scoped(qb);
        return qb
          .getRawOne<{
            total: string | number;
            withAutofix: string | number | null;
          }>()
          .then((row) => {
            const total = Number(row?.total ?? 0);
            const withAutofix = Number(row?.withAutofix ?? 0);
            return { withAutofix, withoutAutofix: total - withAutofix };
          });
      };
      // SAST, IaC, CICD, Secret: any autofix record on the detection.
      const codeAutofix = `SELECT 1 FROM autofix_records ar WHERE ${rawIdent('ar.detectionId')} = v.id`;
      const onBranch = (qb: SelectQueryBuilder<ObjectLiteral>) => {
        if (branch) qb.andWhere('v.branch = :branch', { branch });
      };

      const [sast, iac, cicd, secret, sca] = await Promise.all([
        countWithAutofix(this.sastVulnDetectRepository, codeAutofix, onBranch),
        countWithAutofix(this.iacVulnDetectRepository, codeAutofix, onBranch),
        countWithAutofix(this.cicdVulnDetectRepository, codeAutofix, onBranch),
        countWithAutofix(
          this.secretVulnDetectRepository,
          codeAutofix,
          onBranch,
        ),
        // SCA: an autofix record with a fix available. On the detection's own
        // projectId (B5, as the SCA tab count); the INNER JOIN on its package
        // stays, and so does the partition on the package's branch.
        countWithAutofix(
          this.scaVulnDetectRepository,
          `SELECT 1 FROM sca_autofix_records sar WHERE ${rawIdent('sar.scaVulnerabilityDetectionId')} = v.id AND ${rawIdent('sar.hasFixAvailable')} = ${rawBool(true)}`,
          (qb) => {
            qb.innerJoin('v.scaDetectedPackage', 'pkg').andWhere(
              'pkg.branch IN (:...branches)',
              { branches: scaBranches },
            );
          },
        ),
      ]);

      return { sast, iac, cicd, secret, sca };
    } catch (error) {
      // Return zeros on error rather than failing the whole request
      this.logger.warn(
        `Error getting autofix counts: ${(error as Error)?.message ?? String(error)}`,
      );
      return {
        sast: { withAutofix: 0, withoutAutofix: 0 },
        iac: { withAutofix: 0, withoutAutofix: 0 },
        cicd: { withAutofix: 0, withoutAutofix: 0 },
        secret: { withAutofix: 0, withoutAutofix: 0 },
        sca: { withAutofix: 0, withoutAutofix: 0 },
      };
    }
  }

  /**
   * Get the vulnerabilities count for a project.
   *
   * @param request - The project request.
   * @returns The vulnerabilities count response.
   */
  @Span()
  async getVulnerabilitiesCount(
    request: ProjectGetRequest,
  ): Promise<GetProjectVulnerabilitiesCountResponse> {
    try {
      const { projectId } = request;

      if (!projectId) {
        throw new RpcException({
          code: status.INVALID_ARGUMENT,
          message: 'projectId is required',
        });
      }

      const states = [...ACTIVE_VULN_STATES];

      // One grouped aggregation per table: bucket active detections by the
      // env-derived effective severity (live from CVSS4 scores). This collapses
      // the former 4-COUNT-per-table fan-out (24 round-trips, each re-scanning
      // the same project rows once per severity) into 6 single-pass GROUP BY
      // queries — mirroring the optimized batch path (getBatchVulnerabilitiesCount).
      const groupedCountsBySeverity = (
        repo: Repository<ObjectLiteral>,
      ): Promise<Array<{ severity: string; count: string }>> =>
        repo
          .createQueryBuilder('d')
          .select(effectiveSeveritySql('d'), 'severity')
          .addSelect('COUNT(*)', 'count')
          .where('d.projectId = :projectId', { projectId })
          .andWhere('d.currentState IN (:...states)', { states })
          .groupBy(effectiveSeveritySql('d'))
          .getRawMany<{ severity: string; count: string }>();

      // Scan status and the persisted cyber-risk row are independent of the
      // counts, so they ride in the same parallel batch instead of being
      // awaited before/after them (former serial chain: scan → counts →
      // cyberRisk). The critical path is now a single round-trip.
      const [
        sastRows,
        iacRows,
        cicdRows,
        secretRows,
        scaRows,
        containerRows,
        scanResponse,
        cyberRiskRow,
        detectedLanguages,
      ] = await Promise.all([
        groupedCountsBySeverity(this.sastVulnDetectRepository),
        groupedCountsBySeverity(this.iacVulnDetectRepository),
        groupedCountsBySeverity(this.cicdVulnDetectRepository),
        groupedCountsBySeverity(this.secretVulnDetectRepository),
        // SCA detections carry their own projectId column (no package join here).
        groupedCountsBySeverity(this.scaVulnDetectRepository),
        groupedCountsBySeverity(this.containerVulnDetectRepository),
        safeGrpcCall<GetLastScanStatusResponse>(
          this.scanServiceClient.getLastScanStatus({ projectId }),
        ),
        this.projectCyberRiskRepo.findByProjectId(projectId),
        this.getDetectedLanguages(projectId),
      ]);

      // Fold grouped rows into the four displayable bands; any other band (the
      // 'none' bucket from a CVSS score of 0, or a null/empty label) is dropped
      // — it is invisible in every list view, so the counts must not include it.
      const tally = (
        rows: Array<{ severity: string; count: string }>,
      ): { critical: number; high: number; medium: number; low: number } => {
        const out = { critical: 0, high: 0, medium: 0, low: 0 };
        for (const row of rows) {
          if (
            row.severity === 'critical' ||
            row.severity === 'high' ||
            row.severity === 'medium' ||
            row.severity === 'low'
          ) {
            out[row.severity] += Number(row.count) || 0;
          }
        }
        return out;
      };

      const sast = tally(sastRows);
      const iac = tally(iacRows);
      const cicd = tally(cicdRows);
      const secret = tally(secretRows);
      const sca = tally(scaRows);
      const container = tally(containerRows);

      const totalCritical =
        sast.critical +
        iac.critical +
        cicd.critical +
        secret.critical +
        sca.critical +
        container.critical;
      const totalHigh =
        sast.high +
        iac.high +
        cicd.high +
        secret.high +
        sca.high +
        container.high;
      const totalMedium =
        sast.medium +
        iac.medium +
        cicd.medium +
        secret.medium +
        sca.medium +
        container.medium;
      const totalLow =
        sast.low + iac.low + cicd.low + secret.low + sca.low + container.low;

      const lastScan = scanResponse?.createAt;

      const sastVulnerabilitiesCount: CountVulnerabilitiesTypeResponse = {
        type: 'sast',
        lastScan,
        source: 'github',
        critical: sast.critical,
        high: sast.high,
        medium: sast.medium,
        low: sast.low,
      };

      const iacVulnerabilitiesCount: CountVulnerabilitiesTypeResponse = {
        type: 'iac',
        lastScan,
        source: 'github',
        critical: iac.critical,
        high: iac.high,
        medium: iac.medium,
        low: iac.low,
      };

      const cicdVulnerabilitiesCount: CountVulnerabilitiesTypeResponse = {
        type: 'cicd',
        lastScan,
        source: 'github',
        critical: cicd.critical,
        high: cicd.high,
        medium: cicd.medium,
        low: cicd.low,
      };

      const secretVulnerabilitiesCount: CountVulnerabilitiesTypeResponse = {
        type: 'secret',
        lastScan,
        source: 'github',
        critical: secret.critical,
        high: secret.high,
        medium: secret.medium,
        low: secret.low,
      };

      const scaVulnerabilitiesCount: CountVulnerabilitiesTypeResponse = {
        type: 'sca',
        lastScan,
        source: 'github',
        critical: sca.critical,
        high: sca.high,
        medium: sca.medium,
        low: sca.low,
      };

      const containerVulnerabilitiesCount: CountVulnerabilitiesTypeResponse = {
        type: 'container',
        lastScan,
        source: 'docker',
        critical: container.critical,
        high: container.high,
        medium: container.medium,
        low: container.low,
      };

      this.enqueueCyberRiskBackfillIfMissing(projectId, cyberRiskRow);

      return {
        projectId,
        critical: totalCritical,
        high: totalHigh,
        medium: totalMedium,
        low: totalLow,
        cyberRisk: persistedCyberRiskToProto(cyberRiskRow),
        analyses: [
          sastVulnerabilitiesCount,
          iacVulnerabilitiesCount,
          cicdVulnerabilitiesCount,
          secretVulnerabilitiesCount,
          scaVulnerabilitiesCount,
          containerVulnerabilitiesCount,
        ],
        detectedLanguages,
      };
    } catch (error) {
      if (error instanceof RpcException) {
        throw error;
      }
      // Surface the real cause server-side; the client keeps the opaque message.
      this.logger.error(
        `Error getting vulnerabilities count for project ${
          request.projectId
        }: ${(error as Error)?.message ?? String(error)}`,
        (error as Error)?.stack,
      );
      throw new RpcException({
        code: status.INTERNAL,
        message: `Error getting vulnerabilities count`,
      });
    }
  }

  /**
   * The persisted CybeRisk score and the detected languages of a
   * project: the only two fields of getVulnerabilitiesCount that
   * global-management's ProjectService/Get keeps. Same values, same backfill,
   * without the six severity GROUP BY nor the security-scanning
   * GetLastScanStatus call.
   *
   * @param request - The project request.
   * @returns The project's score and languages.
   */
  @Span()
  async getProjectRiskSummary(
    request: GetProjectRiskSummaryRequest,
  ): Promise<GetProjectRiskSummaryResponse> {
    const { projectId } = request;
    if (!projectId) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'projectId is required',
      });
    }

    try {
      const [cyberRiskRow, detectedLanguages] = await Promise.all([
        this.projectCyberRiskRepo.findByProjectId(projectId),
        this.getDetectedLanguages(projectId),
      ]);

      this.enqueueCyberRiskBackfillIfMissing(projectId, cyberRiskRow);

      return {
        projectId,
        cyberRisk: persistedCyberRiskToProto(cyberRiskRow),
        detectedLanguages,
      };
    } catch (error) {
      this.logger.error(
        `Error getting risk summary for project ${projectId}: ${
          (error as Error)?.message ?? String(error)
        }`,
        (error as Error)?.stack,
      );
      throw new RpcException({
        code: status.INTERNAL,
        message: `Error getting project risk summary`,
      });
    }
  }

  /**
   * Distinct languages across the code-bearing tables (SAST/IaC/
   * CICD/Secret only — SCA/Container carry no language), deduped and sorted.
   * One cheap indexed DISTINCT per table, run in parallel.
   */
  private async getDetectedLanguages(projectId: string): Promise<string[]> {
    const distinctLanguages = (
      repo: Repository<ObjectLiteral>,
    ): Promise<Array<{ language: string }>> =>
      repo
        .createQueryBuilder('d')
        .select('d.language', 'language')
        .where('d.projectId = :projectId', { projectId })
        .andWhere('d.language IS NOT NULL')
        .andWhere("d.language != ''")
        .groupBy('d.language')
        .getRawMany<{ language: string }>();

    const languageRows = await Promise.all([
      distinctLanguages(this.sastVulnDetectRepository),
      distinctLanguages(this.iacVulnDetectRepository),
      distinctLanguages(this.cicdVulnDetectRepository),
      distinctLanguages(this.secretVulnDetectRepository),
    ]);

    return Array.from(
      new Set(
        languageRows
          .flat()
          .map((r) => r.language)
          .filter((l): l is string => Boolean(l && l.trim())),
      ),
    ).sort();
  }

  /** A project read before its first recompute gets one enqueued (backfill). */
  private enqueueCyberRiskBackfillIfMissing(
    projectId: string,
    cyberRiskRow: unknown,
  ): void {
    if (!cyberRiskRow) {
      void this.cyberiskEnqueuer
        .enqueue(projectId, 'backfill')
        .catch(() => undefined);
    }
  }

  /**
   * Yield to event loop to prevent blocking during batch processing.
   */
  private yieldToEventLoop(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve));
  }

  /**
   * Get vulnerabilities count for multiple projects in a single optimized batch request.
   * Uses parallel queries with event loop yielding for better performance.
   *
   * @param request - The batch request containing project IDs and optional reference branches.
   * @returns The batch response with counts for all projects.
   */
  @Span()
  async getBatchVulnerabilitiesCount(request: {
    projectIds: string[];
    referenceBranches?: Array<{
      projectId: string;
      referenceBranch: string;
      defaultBranch?: string;
    }>;
  }): Promise<{ counts: GetProjectVulnerabilitiesCountResponse[] }> {
    const { projectIds, referenceBranches } = request;

    if (!projectIds || projectIds.length === 0) {
      return { counts: [] };
    }

    // Each project is counted on the branches its CybeRisk is scoped on:
    // reference branch, else git default branch, else main/master. Summing
    // every branch counted one finding once per branch it was seen on, and a
    // pipeline that scans its container image on each tag push stores every
    // tag as a branch.
    const inputsByProject = new Map(
      (referenceBranches ?? []).map((rb) => [rb.projectId, rb]),
    );
    const scopeOf = (projectId: string): string[] => {
      const inputs = inputsByProject.get(projectId);
      return scopingBranchesFor(inputs?.referenceBranch, inputs?.defaultBranch);
    };

    // Projects sharing a set of branches go into one condition.
    const groupByBranches = (
      branchesOf: (projectId: string) => string[],
    ): Array<{ projectIds: string[]; branches: string[] }> => {
      const groups = new Map<
        string,
        { projectIds: string[]; branches: string[] }
      >();
      for (const projectId of projectIds) {
        const branches = branchesOf(projectId);
        const key = JSON.stringify(branches);
        const group = groups.get(key) ?? { projectIds: [], branches };
        group.projectIds.push(projectId);
        groups.set(key, group);
      }
      return [...groups.values()];
    };
    const scopeGroups = groupByBranches(scopeOf);
    // SCA folds in its legacy '' partition, as its tab on the project page
    // does.
    const scaScopeGroups = groupByBranches((projectId) =>
      resolveScaEffectiveBranches(scopeOf(projectId)),
    );

    const states = [...ACTIVE_VULN_STATES];

    // A reference branch is written by any project admin: project ids and
    // branches are bound as parameters, never pasted into the SQL text.
    const scopeCondition = (
      projectIdField: string,
      branchField: string,
      groups: Array<{ projectIds: string[]; branches: string[] }>,
    ): { condition: string; params: Record<string, string[]> } => {
      const params: Record<string, string[]> = {};
      const parts = groups.map((group, i) => {
        params[`scope_pids_${i}`] = group.projectIds;
        params[`scope_branches_${i}`] = group.branches;
        return `(${projectIdField} IN (:...scope_pids_${i}) AND ${branchField} IN (:...scope_branches_${i}))`;
      });
      return { condition: `(${parts.join(' OR ')})`, params };
    };

    const buildCountQuery = (
      repository: {
        createQueryBuilder: (alias: string) => any;
      },
      alias: string,
    ): Promise<
      Array<{ projectId: string; severity: string; count: string }>
    > => {
      const projectIdField = `${alias}.projectId`;
      const { condition, params } = scopeCondition(
        projectIdField,
        `${alias}.branch`,
        scopeGroups,
      );
      // Bucket by the env-derived effective severity (live from CVSS4 scores),
      // not the raw scanner label — the project-list pills must match the
      // group/detail views (BUG: list showed base 'critical' for an env-'high'
      // finding). See effectiveSeveritySql.
      return repository
        .createQueryBuilder(alias)
        .select(projectIdField, 'projectId')
        .addSelect(effectiveSeveritySql(alias), 'severity')
        .addSelect('COUNT(*)', 'count')
        .where(`${projectIdField} IN (:...projectIds)`, { projectIds })
        .andWhere(`${alias}.currentState IN (:...states)`, { states })
        .andWhere(condition, params)
        .groupBy(`${projectIdField}, ${effectiveSeveritySql(alias)}`)
        .getRawMany() as Promise<
        Array<{ projectId: string; severity: string; count: string }>
      >;
    };

    const scaScope = scopeCondition(
      'sca.projectId',
      'sca.branch',
      scaScopeGroups,
    );

    const [
      sastCounts,
      iacCounts,
      cicdCounts,
      secretCounts,
      scaCounts,
      containerCounts,
      // Last scans for all projects
      lastScansResponse,
    ] = await Promise.all([
      buildCountQuery(this.sastVulnDetectRepository, 'sast'),
      buildCountQuery(this.iacVulnDetectRepository, 'iac'),
      buildCountQuery(this.cicdVulnDetectRepository, 'cicd'),
      buildCountQuery(this.secretVulnDetectRepository, 'secret'),
      // SCA - On the detection's own projectId
      // (IDX_vd_sca_proj_state) instead of its package's, which made MySQL
      // read the whole SCA table; the INNER JOIN on the package stays (it
      // leaves out detections whose package is gone).
      this.scaVulnDetectRepository
        .createQueryBuilder('sca')
        .innerJoin('sca.scaDetectedPackage', 'pkg')
        .select('sca.projectId', 'projectId')
        .addSelect(effectiveSeveritySql('sca'), 'severity')
        .addSelect('COUNT(*)', 'count')
        .where('sca.projectId IN (:...projectIds)', { projectIds })
        .andWhere('sca.currentState IN (:...states)', { states })
        .andWhere(scaScope.condition, scaScope.params)
        .groupBy(`sca.projectId, ${effectiveSeveritySql('sca')}`)
        .getRawMany<{
          projectId: string;
          severity: string;
          count: string;
        }>(),
      buildCountQuery(this.containerVulnDetectRepository, 'container'),
      // Fetch last scan dates from security-scanning service
      safeGrpcCall(
        (this.scanServiceClient as any).getBatchLastScans({ projectIds }),
      ).catch(() => ({ scans: [] })),
    ]);

    // Yield to event loop after DB queries
    await this.yieldToEventLoop();

    // Build map for last scan dates
    const lastScanMap = new Map<string, string>();
    for (const scan of (lastScansResponse as any)?.scans || []) {
      lastScanMap.set(scan.projectId, scan.lastScan || '');
    }

    // Build maps for quick lookup
    const buildCountMap = (
      counts: Array<{ projectId: string; severity: string; count: string }>,
    ): Map<
      string,
      { critical: number; high: number; medium: number; low: number }
    > => {
      const map = new Map<
        string,
        { critical: number; high: number; medium: number; low: number }
      >();
      for (const row of counts) {
        if (!map.has(row.projectId)) {
          map.set(row.projectId, { critical: 0, high: 0, medium: 0, low: 0 });
        }
        const entry = map.get(row.projectId)!;
        const severity = row.severity?.toLowerCase() || '';
        const count = parseInt(row.count, 10) || 0;
        if (severity === 'critical') entry.critical = count;
        else if (severity === 'high') entry.high = count;
        else if (severity === 'medium') entry.medium = count;
        else if (severity === 'low') entry.low = count;
      }
      return map;
    };

    const sastMap = buildCountMap(sastCounts);
    const iacMap = buildCountMap(iacCounts);
    const cicdMap = buildCountMap(cicdCounts);
    const secretMap = buildCountMap(secretCounts);
    const scaMap = buildCountMap(scaCounts);
    const containerMap = buildCountMap(containerCounts);

    // Read the persisted all-time CybeRisk score for all projects in
    // one query. Missing rows trigger a fire-and-forget backfill recompute.
    // Breakdown is intentionally omitted in listing responses; the detail
    // endpoint /results/overview returns it.
    const cyberRiskRows =
      await this.projectCyberRiskRepo.findByProjectIds(projectIds);
    const cyberRiskRowById = new Map(
      cyberRiskRows.map((r) => [r.projectId, r]),
    );

    // Yield again before building responses
    await this.yieldToEventLoop();

    // Build response for each project
    const counts: GetProjectVulnerabilitiesCountResponse[] = [];

    for (const projectId of projectIds) {
      const sast = sastMap.get(projectId) || {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
      };
      const iac = iacMap.get(projectId) || {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
      };
      const cicd = cicdMap.get(projectId) || {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
      };
      const secret = secretMap.get(projectId) || {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
      };
      const sca = scaMap.get(projectId) || {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
      };
      const container = containerMap.get(projectId) || {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
      };

      const totalCritical =
        sast.critical +
        iac.critical +
        cicd.critical +
        secret.critical +
        sca.critical +
        container.critical;
      const totalHigh =
        sast.high +
        iac.high +
        cicd.high +
        secret.high +
        sca.high +
        container.high;
      const totalMedium =
        sast.medium +
        iac.medium +
        cicd.medium +
        secret.medium +
        sca.medium +
        container.medium;
      const totalLow =
        sast.low + iac.low + cicd.low + secret.low + sca.low + container.low;

      const cyberRiskRow = cyberRiskRowById.get(projectId);
      if (!cyberRiskRow) {
        void this.cyberiskEnqueuer
          .enqueue(projectId, 'backfill')
          .catch(() => undefined);
      }

      // Get last scan date for this project
      const projectLastScan = lastScanMap.get(projectId) || '';

      counts.push({
        projectId,
        critical: totalCritical,
        high: totalHigh,
        medium: totalMedium,
        low: totalLow,
        cyberRisk: persistedCyberRiskToProto(cyberRiskRow ?? null),
        analyses: [
          {
            type: 'sast',
            lastScan: projectLastScan,
            source: 'github',
            ...sast,
          },
          { type: 'iac', lastScan: projectLastScan, source: 'github', ...iac },
          {
            type: 'cicd',
            lastScan: projectLastScan,
            source: 'github',
            ...cicd,
          },
          {
            type: 'secret',
            lastScan: projectLastScan,
            source: 'github',
            ...secret,
          },
          { type: 'sca', lastScan: projectLastScan, source: 'github', ...sca },
          {
            type: 'container',
            lastScan: projectLastScan,
            source: 'docker',
            ...container,
          },
        ],
        lastScan: projectLastScan,
        // Batch path does not populate detectedLanguages (not needed by consumers
        // of the batch endpoint — cost would be O(projects × 4 queries)).
        detectedLanguages: [],
      });

      // Yield every 10 projects to keep event loop responsive
      if (counts.length % 10 === 0) {
        await this.yieldToEventLoop();
      }
    }

    return { counts };
  }

  /**
   * Get project overview statistics for a project.
   *
   * @param request - The project overview request.
   * @returns The project overview response.
   */
  @Span()
  async getProjectOverview(
    request: GetProjectOverviewRequest,
  ): Promise<GetProjectOverviewResponse> {
    try {
      const { projectId, branches } = request;
      // Filter branches: remove empty strings and trim whitespace
      const branchFilters = (branches || [])
        .map((b) => b.trim())
        .filter(Boolean);
      const hasBranchFilter = branchFilters.length > 0;

      if (!projectId) {
        throw new RpcException({
          code: status.INVALID_ARGUMENT,
          message: 'projectId is required',
        });
      }

      // Active vulnerability states — counters must exclude resolved /
      // not_exploitable / proposed_not_exploitable / ignored.
      const activeStates = [...ACTIVE_VULN_STATES];

      // The overview used to await 24 queries one after
      // the other (per table: severities, states, a COUNT, two trend
      // series), then read the score. It now runs 8: one GROUP BY
      // (severity, state) per table, which yields the three breakdowns, one
      // UNION ALL of the 12 trend series, and the persisted score row; at
      // most OVERVIEW_QUERIES_IN_FLIGHT of them at a time, so one overview
      // never holds more than that from the 20-connection pool.
      const limited = createConcurrencyLimiter(OVERVIEW_QUERIES_IN_FLIGHT);
      const tables: Array<{
        type: string;
        repo: Repository<ObjectLiteral>;
        alias: string;
        // The update-date column the closed series falls back to.
        touchedAt: 'updateAt' | 'updatedAt';
      }> = [
        {
          type: 'SAST',
          repo: this.sastVulnDetectRepository,
          alias: 'sast',
          touchedAt: 'updateAt',
        },
        {
          type: 'IAC',
          repo: this.iacVulnDetectRepository,
          alias: 'iac',
          touchedAt: 'updateAt',
        },
        {
          type: 'SCA',
          repo: this.scaVulnDetectRepository,
          alias: 'sca',
          touchedAt: 'updatedAt',
        },
        {
          type: 'CONTAINER',
          repo: this.containerVulnDetectRepository,
          alias: 'container',
          touchedAt: 'updatedAt',
        },
        {
          type: 'CICD',
          repo: this.cicdVulnDetectRepository,
          alias: 'cicd',
          touchedAt: 'updateAt',
        },
        {
          type: 'SECRET',
          repo: this.secretVulnDetectRepository,
          alias: 'secret',
          touchedAt: 'updateAt',
        },
      ];
      const scoped = (
        qb: SelectQueryBuilder<ObjectLiteral>,
        alias: string,
      ): SelectQueryBuilder<ObjectLiteral> => {
        qb.where(`${alias}.projectId = :projectId`, { projectId });
        if (hasBranchFilter) {
          qb.andWhere(`${alias}.branch IN (:...branches)`, {
            branches: branchFilters,
          });
        }
        return qb;
      };

      // Per table, every (band, state) pair with its count, and how many of
      // those rows are active: the state breakdown counts every row, the
      // severity and analysis-type breakdowns the active ones. Rows of one
      // group share their state, so a group is active as a whole, exactly
      // as the former `currentState IN (...)` WHERE decided.
      type SeverityStateRow = {
        severity: string | null;
        state: string;
        count: string | number;
        activeCount: string | number | null;
      };
      const severityStates = (
        table: (typeof tables)[number],
      ): Promise<SeverityStateRow[]> => {
        const band = effectiveSeveritySql(table.alias);
        return scoped(
          table.repo
            .createQueryBuilder(table.alias)
            .select(band, 'severity')
            .addSelect(`${table.alias}.currentState`, 'state')
            .addSelect('COUNT(*)', 'count')
            .addSelect(
              `SUM(CASE WHEN ${table.alias}.currentState IN (:...activeStates) THEN 1 ELSE 0 END)`,
              'activeCount',
            )
            .setParameter('activeStates', activeStates),
          table.alias,
        )
          .groupBy(band)
          .addGroupBy(`${table.alias}.currentState`)
          .getRawMany<SeverityStateRow>();
      };

      // The trend: per table, the detections created each day (every state)
      // and those closed each day (resolved / ignored / not_exploitable,
      // dated by resolved_at / triaged_at, the update date as a fallback).
      // No ORDER BY: MySQL drops it inside a UNION, and
      // accumulateOpenOverTime sorts the dates itself.
      const createdSeries = (table: (typeof tables)[number]) => {
        const band = effectiveSeveritySql(table.alias);
        const day = dateBucket(`${table.alias}.createdAt`, 'day').text;
        return scoped(
          table.repo
            .createQueryBuilder(table.alias)
            .select("'created'", 'action')
            .addSelect(day, 'date')
            .addSelect(band, 'severity')
            .addSelect('COUNT(*)', 'count'),
          table.alias,
        )
          .groupBy(day)
          .addGroupBy(band);
      };
      const closedSeries = (table: (typeof tables)[number]) => {
        const band = effectiveSeveritySql(table.alias);
        const closedOn = `COALESCE(${table.alias}.resolvedAt, ${table.alias}.triagedAt, ${table.alias}.${table.touchedAt})`;
        const day = dateBucket(closedOn, 'day').text;
        return scoped(
          table.repo
            .createQueryBuilder(table.alias)
            .select("'closed'", 'action')
            .addSelect(day, 'date')
            .addSelect(band, 'severity')
            .addSelect('COUNT(*)', 'count'),
          table.alias,
        )
          .andWhere(`${table.alias}.currentState IN (:...closedStates)`, {
            closedStates: ['resolved', 'ignored', 'not_exploitable'],
          })
          .andWhere(`${closedOn} IS NOT NULL`)
          .groupBy(day)
          .addGroupBy(band);
      };
      const [overTimeSql, overTimeParameters] = unionAll(
        tables.flatMap((table) => [createdSeries(table), closedSeries(table)]),
      );

      // The persisted all-time CybeRisk score. Its breakdown is
      // scoped to the project's scoring branches, so only an existing row
      // needs them: that Get starts as soon as the row is known, while the
      // counts still run (it holds no database connection).
      const cyberRiskRowLookup = limited(() =>
        this.projectCyberRiskRepo.findByProjectId(projectId),
      );
      const scoringBranchesLookup = cyberRiskRowLookup.then((row) =>
        row ? this.referenceBranchResolver.getScoringBranches(projectId) : null,
      );

      const [perTable, combinedOverTimeRaw, cyberRiskRow, scoringBranches] =
        await Promise.all([
          Promise.all(
            tables.map((table) => limited(() => severityStates(table))),
          ),
          limited(
            () =>
              this.sastVulnDetectRepository.query(
                overTimeSql,
                overTimeParameters,
              ) as Promise<OverTimeRawRow[]>,
          ),
          cyberRiskRowLookup,
          scoringBranchesLookup,
        ]);

      // `effectiveSeveritySql()` returns NULL for a row with no CVSS score whose
      // effective_severity AND currentSeverity are both NULL/empty — calling.
      // toUpperCase() on it turned the whole overview into a 500. Fall back to
      // the SQL expression's own 'none' band so the count survives.
      const severityMap: Record<string, number> = {};
      const stateMap: Record<string, number> = {};
      const totalByAnalysisType: TotalByAnalysisType[] = tables.map(
        (table, i) => {
          let active = 0;
          for (const row of perTable[i]) {
            stateMap[row.state] =
              (stateMap[row.state] || 0) + Number(row.count);
            const activeCount = Number(row.activeCount ?? 0);
            if (activeCount > 0) {
              const band = (
                row.severity?.trim() ? row.severity : UNLABELLED_SEVERITY
              ).toUpperCase();
              severityMap[band] = (severityMap[band] || 0) + activeCount;
              active += activeCount;
            }
          }
          return { analysisType: table.type, count: active };
        },
      );
      const totalBySeverity: TotalBySeverity[] = Object.keys(severityMap).map(
        (severity) => ({
          severity,
          count: severityMap[severity],
        }),
      );
      const totalByState: TotalByState[] = Object.keys(stateMap).map(
        (state) => ({
          state,
          count: stateMap[state],
        }),
      );

      // the trend shows what was OPEN at the end of each
      // day — every creation adds on its day, every closing (resolved /
      // ignored / not_exploitable, dated by resolved_at / triaged_at) subtracts
      // on its day. A resolved finding leaves the current point, which equals
      // the severity/state counters, but stays on every date it was open.
      const vulnerabilitiesOverTime: VulnerabilitiesOverTime[] =
        accumulateOpenOverTime(combinedOverTimeRaw);

      // Rebuild the byScanType/topContributors breakdown live from
      // the current active vulns (the persisted row only stores
      // score+level+computedAt), scoped to the project reference branch so it
      // matches the persisted score. It runs after the counts above, so this
      // overview never holds more than OVERVIEW_QUERIES_IN_FLIGHT connections.
      let cyberRisk: CyberRiskScoreProto;
      if (cyberRiskRow) {
        const metaVulns = await this.activeVulnFetcher.fetchActiveVulnsWithMeta(
          projectId,
          scoringBranches,
        );
        const breakdown = buildBreakdown(cyberRiskRow.score, metaVulns);
        cyberRisk = persistedCyberRiskToProto(cyberRiskRow, breakdown);
      } else {
        void this.cyberiskEnqueuer
          .enqueue(projectId, 'backfill')
          .catch(() => undefined);
        cyberRisk = persistedCyberRiskToProto(cyberRiskRow);
      }

      return {
        totalBySeverity,
        totalByState,
        totalByAnalysisType,
        vulnerabilitiesOverTime,
        cyberRisk,
      };
    } catch (error) {
      if (error instanceof RpcException) {
        throw error;
      }
      // Surface the real cause server-side (SQL error, downstream failure, …)
      // — the client still gets the opaque message below. Without this the
      // root cause is invisible in the logs (this catch used to swallow it).
      this.logger.error(
        `Error getting project overview for project ${request.projectId}: ${
          (error as Error)?.message ?? String(error)
        }`,
        (error as Error)?.stack,
      );
      throw new RpcException({
        code: status.INTERNAL,
        message: `Error getting project overview`,
      });
    }
  }

  /**
   * Get organization-wide overview statistics aggregating all projects.
   * Delegates to OrganizationOverviewService for the actual implementation.
   *
   * @param request - The organization overview request containing organizationId and userId.
   * @returns Aggregated statistics for the entire organization.
   */
  @Span()
  async getOrganizationOverview(
    request: GetOrganizationOverviewRequest,
  ): Promise<GetOrganizationOverviewResponse> {
    return this.organizationOverviewService.getOrganizationOverview(request);
  }

  @Span()
  async getOrganizationSeverityDistribution(
    request: GetOrganizationSeverityDistributionRequest,
  ): Promise<GetOrganizationSeverityDistributionResponse> {
    return this.organizationOverviewService.getOrganizationSeverityDistribution(
      request,
    );
  }

  @Span()
  async getOrganizationStateDistribution(
    request: GetOrganizationStateDistributionRequest,
  ): Promise<GetOrganizationStateDistributionResponse> {
    return this.organizationOverviewService.getOrganizationStateDistribution(
      request,
    );
  }

  @Span()
  async getOrganizationVulnerabilitiesOverTime(
    request: GetOrganizationVulnerabilitiesOverTimeRequest,
  ): Promise<GetOrganizationVulnerabilitiesOverTimeResponse> {
    return this.organizationOverviewService.getOrganizationVulnerabilitiesOverTime(
      request,
    );
  }

  /**
   * Get the main statistics for a project.
   *
   * @param request - The request to get the main statistics.
   * @returns The vulnerabilities for the project.
   */
  @Span()
  async getMainStatistics(
    request: GetMainStatisticsRequest,
  ): Promise<GetMainStatisticsResponse> {
    const { projectIds } = request;

    if (!projectIds || projectIds.length === 0) {
      return {
        projectIds: [],
        criticalRiskProjects: 0,
        criticalRiskProjectsInLast7Days: 0,
        highRiskProjects: 0,
        highRiskProjectsInLast7Days: 0,
        solvedIssues: 0,
        solvedIssuesInLast7Days: 0,
        newIssues: 0,
        newIssuesInLast7Days: 0,
        criticalIssues: 0,
        highIssues: 0,
        mediumIssues: 0,
        lowIssues: 0,
        agentAnalysesCount: 0,
        agentAutofixCount: 0,
        agentTriageCount: 0,
        agentFalsePositiveCount: 0,
      };
    }

    // Run all queries in parallel for better performance. getRiskLevelProjects
    // already returns BOTH the all-time level and the 7-day level per project,
    // so we derive the InLast7Days counts from it — no second CybeRisk pass.
    // New and solved findings come from the overview's own count, so the home
    // cards and the organization overview can never disagree on them.
    const [
      projectRiskLevels,
      issueTrend,
      totalIssues,
      agentActivity,
      agentAutofixCount,
    ] = await Promise.all([
      this.getRiskLevelProjects(projectIds),
      this.organizationOverviewService.getIssueTrend(projectIds),
      this.getTotalIssuesProjects(projectIds),
      this.getAgentActivityCounts(projectIds),
      this.getAgentAutofixCount(projectIds),
    ]);

    const criticalRiskProjectsIds = projectRiskLevels.filter(
      (project) => project.riskLevel === 'critical',
    );
    const criticalRiskProjectsInLast7DaysIds = projectRiskLevels.filter(
      (project) => project.riskLevelInLast7Days === 'critical',
    );

    const highRiskProjectsIdsOnly = projectRiskLevels.filter(
      (project) => project.riskLevel === 'high',
    );
    const highRiskProjectsInLast7DaysIdsOnly = projectRiskLevels.filter(
      (project) => project.riskLevelInLast7Days === 'high',
    );

    return {
      projectIds,
      criticalRiskProjects: criticalRiskProjectsIds.length,
      criticalRiskProjectsInLast7Days:
        criticalRiskProjectsInLast7DaysIds.length,
      highRiskProjects: highRiskProjectsIdsOnly.length,
      highRiskProjectsInLast7Days: highRiskProjectsInLast7DaysIdsOnly.length,
      solvedIssues: issueTrend.solvedIssues,
      solvedIssuesInLast7Days: issueTrend.solvedIssuesLastPeriod,
      newIssues: issueTrend.newIssues,
      newIssuesInLast7Days: issueTrend.newIssuesLastPeriod,
      criticalIssues: totalIssues.criticalIssues,
      highIssues: totalIssues.highIssues,
      mediumIssues: totalIssues.mediumIssues,
      lowIssues: totalIssues.lowIssues,
      agentAnalysesCount: agentActivity.analyses,
      agentAutofixCount: agentAutofixCount,
      agentTriageCount: agentActivity.triage,
      agentFalsePositiveCount: agentActivity.falsePositives,
    };
  }

  /**
   * Get total issues count by severity for multiple projects using batch queries.
   *
   * @param projectIds - The project IDs to query.
   * @returns The total issues count by severity.
   */
  @Span()
  async getTotalIssuesProjects(projectIds: string[]): Promise<{
    criticalIssues: number;
    highIssues: number;
    mediumIssues: number;
    lowIssues: number;
  }> {
    if (!projectIds || projectIds.length === 0) {
      return {
        criticalIssues: 0,
        highIssues: 0,
        mediumIssues: 0,
        lowIssues: 0,
      };
    }

    const states = [...ACTIVE_VULN_STATES];

    // Run all queries in parallel with batch projectIds
    const [sastCounts, iacCounts, scaCounts, containerCounts] =
      await Promise.all([
        // SAST counts by severity
        this.sastVulnDetectRepository
          .createQueryBuilder('v')
          .select(effectiveSeveritySql('v'), 'severity')
          .addSelect('COUNT(*)', 'count')
          .where('v.projectId IN (:...projectIds)', { projectIds })
          .andWhere('v.currentState IN (:...states)', { states })
          .groupBy(effectiveSeveritySql('v'))
          .getRawMany<{ severity: string; count: string }>(),

        // IAC counts by severity
        this.iacVulnDetectRepository
          .createQueryBuilder('v')
          .select(effectiveSeveritySql('v'), 'severity')
          .addSelect('COUNT(*)', 'count')
          .where('v.projectId IN (:...projectIds)', { projectIds })
          .andWhere('v.currentState IN (:...states)', { states })
          .groupBy(effectiveSeveritySql('v'))
          .getRawMany<{ severity: string; count: string }>(),

        // SCA counts by severity. On the detection's own
        // projectId (indexed), the INNER JOIN on its package kept.
        this.scaVulnDetectRepository
          .createQueryBuilder('v')
          .innerJoin('v.scaDetectedPackage', 'pkg')
          .select(effectiveSeveritySql('v'), 'severity')
          .addSelect('COUNT(*)', 'count')
          .where('v.projectId IN (:...projectIds)', { projectIds })
          .andWhere('v.currentState IN (:...states)', { states })
          .groupBy(effectiveSeveritySql('v'))
          .getRawMany<{ severity: string; count: string }>(),

        // Container counts by severity
        this.containerVulnDetectRepository
          .createQueryBuilder('v')
          .select(effectiveSeveritySql('v'), 'severity')
          .addSelect('COUNT(*)', 'count')
          .where('v.projectId IN (:...projectIds)', { projectIds })
          .andWhere('v.currentState IN (:...states)', { states })
          .groupBy(effectiveSeveritySql('v'))
          .getRawMany<{ severity: string; count: string }>(),
      ]);

    // Aggregate counts from all vulnerability types
    const aggregateBySeverity = (
      counts: Array<{ severity: string; count: string }>,
    ) => {
      const result = { critical: 0, high: 0, medium: 0, low: 0 };
      for (const row of counts) {
        const severity = row.severity?.toLowerCase() || '';
        const count = parseInt(row.count, 10) || 0;
        if (severity === 'critical') result.critical += count;
        else if (severity === 'high') result.high += count;
        else if (severity === 'medium') result.medium += count;
        else if (severity === 'low') result.low += count;
      }
      return result;
    };

    const sast = aggregateBySeverity(sastCounts);
    const iac = aggregateBySeverity(iacCounts);
    const sca = aggregateBySeverity(scaCounts);
    const container = aggregateBySeverity(containerCounts);

    return {
      criticalIssues:
        sast.critical + iac.critical + sca.critical + container.critical,
      highIssues: sast.high + iac.high + sca.high + container.high,
      mediumIssues: sast.medium + iac.medium + sca.medium + container.medium,
      lowIssues: sast.low + iac.low + sca.low + container.low,
    };
  }

  /**
   * Get Risk Level for multiple projects using batch queries.
   *
   * @param projectIds - The project IDs.
   * @returns The risk level for each project.
   */
  @Span()
  async getRiskLevelProjects(
    projectIds: string[],
  ): Promise<
    { projectId: string; riskLevel: string; riskLevelInLast7Days: string }[]
  > {
    if (!projectIds || projectIds.length === 0) {
      return [];
    }

    // Both the all-time AND the 7-day level are read O(1) from the persisted
    // row (refreshed by the recompute worker) — no live CybeRisk fetch on the
    // hot path. Missing rows trigger a backfill recompute.
    const allTimeRows =
      await this.projectCyberRiskRepo.findByProjectIds(projectIds);
    const allTimeRowById = new Map(allTimeRows.map((r) => [r.projectId, r]));

    return projectIds.map((projectId) => {
      const row = allTimeRowById.get(projectId);
      if (!row) {
        void this.cyberiskEnqueuer
          .enqueue(projectId, 'backfill')
          .catch(() => undefined);
      }
      return {
        projectId,
        riskLevel: row?.level ?? 'low',
        riskLevelInLast7Days: row?.level7Days ?? 'low',
      };
    });
  }

  /**
   * Count agent-made history_item entries (userId IS NULL) across all 6 detection
   * type tables.  Returns totals for analyses, triage actions and false-positive
   * status changes.
   */
  /**
   * Detection type tables and their FK columns in history_item.
   * Shared across agent KPI queries.
   */
  private static readonly DETECTION_TABLES = [
    {
      table: 'vulnerability_detections_sast',
      fk: 'sastVulnerabilityDetectionId',
    },
    {
      table: 'vulnerability_detections_iac',
      fk: 'iacVulnerabilityDetectionId',
    },
    {
      table: 'vulnerability_detections_cicd',
      fk: 'cicdVulnerabilityDetectionId',
    },
    {
      table: 'vulnerability_detections_secret',
      fk: 'secretVulnerabilityDetectionId',
    },
    {
      table: 'vulnerability_detections_sca',
      fk: 'scaVulnerabilityDetectionId',
    },
    {
      table: 'vulnerability_detections_container',
      fk: 'containerVulnerabilityDetectionId',
    },
  ];

  /**
   * Count distinct vulnerabilities analyzed by the AI agent in the last 30 days.
   * A vulnerability is "analyzed" if it has at least one history_item with userId='system'.
   * Also counts the subset marked as 'ignored' (= false positives) and 'confirmed' (= true positives).
   */
  private async getAgentActivityCounts(
    projectIds: string[],
  ): Promise<{ analyses: number; triage: number; falsePositives: number }> {
    if (!projectIds || projectIds.length === 0) {
      return { analyses: 0, triage: 0, falsePositives: 0 };
    }

    const tables = ResultService.DETECTION_TABLES;
    const h = (column: string): Sql => rawSql(rawIdent(`h.${column}`));
    const window = sql`${h('date')} >= ${intervalAgo(30, 'day')}`;
    // `h.userId = 'system'` keeps each engine's comparison: MySQL's
    // collation matches it case-insensitively, as it always has here.

    // Count distinct vulns with ANY agent activity (comment, status_change, etc.)
    const analysesUnion = tables.map(
      ({ table, fk }) =>
        sql`SELECT DISTINCT ${h(fk)} AS did FROM history_item h INNER JOIN ${rawSql(table)} d ON d.id = ${h(fk)} WHERE ${h('userId')} = 'system' AND ${rawSql(rawIdent('d.projectId'))} IN ${inList(projectIds)} AND ${window}`,
    );

    // Count distinct vulns where agent set status to 'ignored' (= false positive verdict)
    const fpUnion = tables.map(
      ({ table, fk }) =>
        sql`SELECT DISTINCT ${h(fk)} AS did FROM history_item h INNER JOIN ${rawSql(table)} d ON d.id = ${h(fk)} WHERE ${h('userId')} = 'system' AND ${rawSql(rawIdent('d.projectId'))} IN ${inList(projectIds)} AND ${h('type')} = 'status_change' AND ${h('value')} = 'ignored' AND ${window}`,
    );

    const query = sql`SELECT (SELECT COUNT(*) FROM (${joinSql(analysesUnion, ' UNION ALL ')}) a) AS analyses, (SELECT COUNT(*) FROM (${joinSql(fpUnion, ' UNION ALL ')}) f) AS ${rawSql(rawIdent('falsePositives'))}`;

    const rows: { analyses: string; falsePositives: string }[] =
      await this.historyItemRepository.query(query.text, query.params);

    const analyses = parseInt(rows[0]?.analyses ?? '0', 10);
    const falsePositives = parseInt(rows[0]?.falsePositives ?? '0', 10);

    // triage = analyses (every analyzed vuln is triaged by definition)
    return { analyses, triage: analyses, falsePositives };
  }

  /**
   * Count successful autofix records for the given projects.
   * Includes standard autofixes (status='ok') and SCA autofixes
   * (status IN ('ok','direct_update') with a PR URL).
   */
  private async getAgentAutofixCount(projectIds: string[]): Promise<number> {
    if (!projectIds || projectIds.length === 0) {
      return 0;
    }

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const column = (name: string): Sql => rawSql(rawIdent(name));
    const scaAutofixCount = sql`SELECT COUNT(*) AS cnt FROM sca_autofix_records WHERE ${column('projectId')} IN ${inList(projectIds)} AND status IN ('ok','direct_update') AND ${column('prUrl')} IS NOT NULL AND ${column('createdAt')} >= ${intervalAgo(30, 'day')}`;

    const [standardCount, scaRows] = await Promise.all([
      this.autoFixRepo.count({
        where: {
          projectId: In(projectIds),
          status: 'ok',
          createdAt: MoreThanOrEqual(thirtyDaysAgo),
        },
      }),
      this.historyItemRepository.query(
        scaAutofixCount.text,
        scaAutofixCount.params,
      ) as Promise<{ cnt: string }[]>,
    ]);

    return standardCount + parseInt(scaRows[0]?.cnt ?? '0', 10);
  }

  /**
   * Get the vulnerabilities for a project.
   *
   * @param getProjectVulnerabilitiesRequestDto - The request to get the vulnerabilities.
   * @returns The vulnerabilities for the project.
   */
  @Span()
  async calculateRiskLevel(
    projectId: string,
  ): Promise<{ riskLevel: string; riskLevelInLast7Days: string }> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [allTimeRow, last7DaysLevel] = await Promise.all([
      this.projectCyberRiskRepo.findByProjectId(projectId),
      this.cyberRiskService.computeProjectScoreLevelSince(
        projectId,
        sevenDaysAgo,
      ),
    ]);
    if (!allTimeRow) {
      void this.cyberiskEnqueuer
        .enqueue(projectId, 'backfill')
        .catch(() => undefined);
    }

    return {
      riskLevel: allTimeRow?.level ?? 'low',
      riskLevelInLast7Days: last7DaysLevel,
    };
  }

  /**
   * Get the vulnerabilities for a project.
   *
   * @param getProjectVulnerabilitiesRequestDto - The request to get the vulnerabilities.
   * @returns The vulnerabilities for the project.
   */
  @Span()
  async calculateRiskLevelInLast7Days(projectId: string): Promise<string> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    return this.cyberRiskService.computeProjectScoreLevelSince(
      projectId,
      sevenDaysAgo,
    );
  }

  async deleteProjectVulnerabilityDetections(
    request: ProjectDeleteRequest,
  ): Promise<ProjectDeleteResponse> {
    const { projectId } = request;

    try {
      await this.sastVulnDetectRepository.delete({ projectId });
      await this.iacVulnDetectRepository.delete({ projectId });
      await this.scaVulnDetectRepository.delete({ projectId });
      await this.containerVulnDetectRepository.delete({ projectId });
      await this.scaDetectedPackageRepository.delete({ projectId });
      await this.containerDetectedImageRepository.delete({ projectId });
      await this.containerDetectedPackageRepository.delete({ projectId });
      // Purge the AI-BOM (components + compliance reports). Otherwise the
      // aibom_components/aibom_compliance_reports rows outlive the project
      // deletion (personal data kept, and a quota skewed after the delete).
      if (this.aibom) await this.aibom.deleteAllForProject(projectId);

      return {
        message: 'Project vulnerability detections deleted successfully',
      };
    } catch (error) {
      if (error instanceof RpcException) {
        throw error;
      }
      throw new RpcException({
        code: status.INTERNAL,
        message: `Error deleting project vulnerability detections`,
      });
    }
  }

  /**
   * Get distinct branches from scans for a project.
   * This endpoint retrieves branches from the Scan table in security-scanning-service,
   * which is more reliable than querying vulnerability detections since scans can
   * complete without finding any vulnerabilities.
   *
   * @param projectId - The project identifier.
   * @returns List of distinct branch names found in all scans for the project.
   */
  @Span()
  async getProjectBranches(projectId: string): Promise<string[]> {
    if (!projectId) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'projectId is required',
      });
    }

    try {
      // Call security-scanning-service to get branches from Scan table
      const response = await safeGrpcCall(
        this.scanServiceClient.getProjectBranchesFromScans({ projectId }),
      );

      return response.branches || [];
    } catch (error) {
      if (error instanceof RpcException) {
        throw error;
      }
      throw new RpcException({
        code: status.INTERNAL,
        message: `Error retrieving project branches`,
      });
    }
  }

  /**
   * Helper to get vulnerability counts by severity for a project, optionally filtered by date.
   *
   * @param projectId - The project ID.
   * @param since - Optional date to filter vulnerabilities created after.
   * @returns Counts of vulnerabilities by severity.
   */
  private async getCountsBySeverity(
    projectId: string,
    since?: Date,
  ): Promise<{ critical: number; high: number; medium: number; low: number }> {
    const states = [...ACTIVE_VULN_STATES];

    const queries = [
      this.sastVulnDetectRepository
        .createQueryBuilder('v')
        .select(effectiveSeveritySql('v'), 'severity')
        .addSelect('COUNT(*)', 'count')
        .where('v.projectId = :projectId', { projectId })
        .andWhere('v.currentState IN (:...states)', { states }),
      this.iacVulnDetectRepository
        .createQueryBuilder('v')
        .select(effectiveSeveritySql('v'), 'severity')
        .addSelect('COUNT(*)', 'count')
        .where('v.projectId = :projectId', { projectId })
        .andWhere('v.currentState IN (:...states)', { states }),
      this.scaVulnDetectRepository
        .createQueryBuilder('v')
        .innerJoin('v.scaDetectedPackage', 'pkg')
        .select(effectiveSeveritySql('v'), 'severity')
        .addSelect('COUNT(*)', 'count')
        .where('pkg.projectId = :projectId', { projectId })
        .andWhere('v.currentState IN (:...states)', { states }),
      this.containerVulnDetectRepository
        .createQueryBuilder('v')
        .select(effectiveSeveritySql('v'), 'severity')
        .addSelect('COUNT(*)', 'count')
        .where('v.projectId = :projectId', { projectId })
        .andWhere('v.currentState IN (:...states)', { states }),
      this.secretVulnDetectRepository
        .createQueryBuilder('v')
        .select(effectiveSeveritySql('v'), 'severity')
        .addSelect('COUNT(*)', 'count')
        .where('v.projectId = :projectId', { projectId })
        .andWhere('v.currentState IN (:...states)', { states }),
      this.cicdVulnDetectRepository
        .createQueryBuilder('v')
        .select(effectiveSeveritySql('v'), 'severity')
        .addSelect('COUNT(*)', 'count')
        .where('v.projectId = :projectId', { projectId })
        .andWhere('v.currentState IN (:...states)', { states }),
    ];

    if (since) {
      queries.forEach((q) => q.andWhere('v.createdAt > :since', { since }));
    }

    const results = await Promise.all(
      queries.map((q) =>
        q
          .groupBy(effectiveSeveritySql('v'))
          .getRawMany<{ severity: string; count: string }>(),
      ),
    );

    const counts = { critical: 0, high: 0, medium: 0, low: 0 };
    results.flat().forEach((res) => {
      const severity = res.severity?.toLowerCase();
      const count = parseInt(res.count, 10) || 0;
      if (severity === 'critical') counts.critical += count;
      else if (severity === 'high') counts.high += count;
      else if (severity === 'medium') counts.medium += count;
      else if (severity === 'low') counts.low += count;
    });

    return counts;
  }

  /**
   * Helper to get vulnerability counts by severity for multiple projects, including total and last 7 days.
   *
   * @param projectIds - The project IDs.
   * @returns A map of project ID to its total and last 7 days counts.
   */
  private async getVulnerabilityCountsBatch(projectIds: string[]): Promise<
    Map<
      string,
      {
        total: {
          critical: number;
          high: number;
          medium: number;
          low: number;
        };
        last7days: {
          critical: number;
          high: number;
          medium: number;
          low: number;
        };
      }
    >
  > {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const states = [...ACTIVE_VULN_STATES];
    const projectCounts = new Map<
      string,
      {
        total: { critical: number; high: number; medium: number; low: number };
        last7days: {
          critical: number;
          high: number;
          medium: number;
          low: number;
        };
      }
    >();

    // Initialize map
    projectIds.forEach((id) => {
      projectCounts.set(id, {
        total: { critical: 0, high: 0, medium: 0, low: 0 },
        last7days: { critical: 0, high: 0, medium: 0, low: 0 },
      });
    });

    const queries = [
      this.sastVulnDetectRepository
        .createQueryBuilder('v')
        .select('v.projectId', 'projectId')
        .addSelect(effectiveSeveritySql('v'), 'severity')
        .addSelect('COUNT(*)', 'count')
        .addSelect(
          `SUM(CASE WHEN v.createdAt > :sevenDaysAgo THEN 1 ELSE 0 END)`,
          'last7days',
        )
        .where('v.projectId IN (:...projectIds)', { projectIds })
        .andWhere('v.currentState IN (:...states)', { states })
        .groupBy('v.projectId')
        .addGroupBy(effectiveSeveritySql('v')),
      this.iacVulnDetectRepository
        .createQueryBuilder('v')
        .select('v.projectId', 'projectId')
        .addSelect(effectiveSeveritySql('v'), 'severity')
        .addSelect('COUNT(*)', 'count')
        .addSelect(
          `SUM(CASE WHEN v.createdAt > :sevenDaysAgo THEN 1 ELSE 0 END)`,
          'last7days',
        )
        .where('v.projectId IN (:...projectIds)', { projectIds })
        .andWhere('v.currentState IN (:...states)', { states })
        .groupBy('v.projectId')
        .addGroupBy(effectiveSeveritySql('v')),
      this.scaVulnDetectRepository
        .createQueryBuilder('v')
        .innerJoin('v.scaDetectedPackage', 'pkg')
        .select('pkg.projectId', 'projectId')
        .addSelect(effectiveSeveritySql('v'), 'severity')
        .addSelect('COUNT(*)', 'count')
        .addSelect(
          `SUM(CASE WHEN v.createdAt > :sevenDaysAgo THEN 1 ELSE 0 END)`,
          'last7days',
        )
        .where('pkg.projectId IN (:...projectIds)', { projectIds })
        .andWhere('v.currentState IN (:...states)', { states })
        .groupBy('pkg.projectId')
        .addGroupBy(effectiveSeveritySql('v')),
      this.containerVulnDetectRepository
        .createQueryBuilder('v')
        .select('v.projectId', 'projectId')
        .addSelect(effectiveSeveritySql('v'), 'severity')
        .addSelect('COUNT(*)', 'count')
        .addSelect(
          `SUM(CASE WHEN v.createdAt > :sevenDaysAgo THEN 1 ELSE 0 END)`,
          'last7days',
        )
        .where('v.projectId IN (:...projectIds)', { projectIds })
        .andWhere('v.currentState IN (:...states)', { states })
        .groupBy('v.projectId')
        .addGroupBy(effectiveSeveritySql('v')),
      this.secretVulnDetectRepository
        .createQueryBuilder('v')
        .select('v.projectId', 'projectId')
        .addSelect(effectiveSeveritySql('v'), 'severity')
        .addSelect('COUNT(*)', 'count')
        .addSelect(
          `SUM(CASE WHEN v.createdAt > :sevenDaysAgo THEN 1 ELSE 0 END)`,
          'last7days',
        )
        .where('v.projectId IN (:...projectIds)', { projectIds })
        .andWhere('v.currentState IN (:...states)', { states })
        .groupBy('v.projectId')
        .addGroupBy(effectiveSeveritySql('v')),
      this.cicdVulnDetectRepository
        .createQueryBuilder('v')
        .select('v.projectId', 'projectId')
        .addSelect(effectiveSeveritySql('v'), 'severity')
        .addSelect('COUNT(*)', 'count')
        .addSelect(
          `SUM(CASE WHEN v.createdAt > :sevenDaysAgo THEN 1 ELSE 0 END)`,
          'last7days',
        )
        .where('v.projectId IN (:...projectIds)', { projectIds })
        .andWhere('v.currentState IN (:...states)', { states })
        .groupBy('v.projectId')
        .addGroupBy(effectiveSeveritySql('v')),
    ];

    const results = await Promise.all(
      queries.map((q) =>
        q.setParameter('sevenDaysAgo', sevenDaysAgo).getRawMany<{
          projectId: string;
          severity: string;
          count: string;
          last7days: string;
        }>(),
      ),
    );

    // Some queries might use different aliases for projectId (e.g. SCA), but we selected it as 'projectId'
    results.flat().forEach((res) => {
      const { projectId, severity, count, last7days } = res;
      const proj = projectCounts.get(projectId);
      if (!proj) return;

      const sev = severity?.toLowerCase();
      const c = parseInt(count, 10) || 0;
      const l7 = parseInt(last7days, 10) || 0;

      if (sev === 'critical') {
        proj.total.critical += c;
        proj.last7days.critical += l7;
      } else if (sev === 'high') {
        proj.total.high += c;
        proj.last7days.high += l7;
      } else if (sev === 'medium') {
        proj.total.medium += c;
        proj.last7days.medium += l7;
      } else if (sev === 'low') {
        proj.total.low += c;
        proj.last7days.low += l7;
      }
    });

    return projectCounts;
  }

  /**
   * Get top N vulnerabilities across all detection types, ranked by composite priority score.
   * Queries each detection table for active (non-resolved) vulnerabilities, computes composite
   * scores using PriorityCalculatorService, then merges and returns the top N.
   */
  @Span()
  async getTopVulnerabilities(
    request: GetTopVulnerabilitiesRequest,
  ): Promise<GetTopVulnerabilitiesResponse> {
    const { projectId } = request;
    // `limit` comes from the query string; clamped silently at
    // 50, so no table is read for more than 200 rows (perTypeLimit below).
    const limit =
      request.limit > 0 ? Math.min(request.limit, MAX_TOP_VULNERABILITIES) : 5;

    if (!projectId) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Bad request - missing projectId',
      });
    }

    const activeStates = [...ACTIVE_VULN_STATES];
    const perTypeLimit = Math.max(limit * 4, 20); // Fetch more per type to ensure good ranking

    // Fetch the security context once for priority calculation
    const ctx = await this.getSecurityContextCached(projectId);
    const businessCriticality = ctx?.businessCriticality ?? 0;
    const dataClassification = ctx?.dataClassification ?? 0;

    // Query all detection types in parallel
    const [
      sastDetections,
      iacDetections,
      cicdDetections,
      secretDetections,
      scaDetections,
      containerDetections,
    ] = await Promise.all([
      // Pre-fetch ordered by priorityScore DESC so that when perTypeLimit
      // truncates the result set we keep the highest-priority rows. A prior
      // version used `{ currentSeverity: 'ASC' }` with the comment "CRITICAL
      // first (alphabetical)"; that was wrong because the lexicographic order
      // is critical < high < info < low < medium, dropping `medium` below
      // `low`/`info` and silently discarding top items when the table was
      // large. On MySQL, `DESC` already places NULLs last, and we add
      // `currentSeverity ASC` as a deterministic tie-breaker when rows share
      // the same (or NULL) priorityScore.
      this.sastVulnDetectRepository.find({
        where: { projectId, currentState: In(activeStates) },
        select: {
          ...TOP_SCORE_COLUMNS,
          path: true,
          vulnerableStartLine: true,
          vulnerability: TOP_RULE_COLUMNS,
        },
        relations: ['vulnerability'],
        take: perTypeLimit,
        order: { priorityScore: 'DESC', currentSeverity: 'ASC' },
      }),
      this.iacVulnDetectRepository.find({
        where: { projectId, currentState: In(activeStates) },
        select: {
          ...TOP_SCORE_COLUMNS,
          path: true,
          vulnerableStartLine: true,
          vulnerability: TOP_RULE_COLUMNS,
        },
        relations: ['vulnerability'],
        take: perTypeLimit,
        order: { priorityScore: 'DESC', currentSeverity: 'ASC' },
      }),
      this.cicdVulnDetectRepository.find({
        where: { projectId, currentState: In(activeStates) },
        select: {
          ...TOP_SCORE_COLUMNS,
          path: true,
          vulnerableStartLine: true,
          vulnerability: TOP_RULE_COLUMNS,
        },
        relations: ['vulnerability'],
        take: perTypeLimit,
        order: { priorityScore: 'DESC', currentSeverity: 'ASC' },
      }),
      this.secretVulnDetectRepository.find({
        where: { projectId, currentState: In(activeStates) },
        select: {
          ...TOP_SCORE_COLUMNS,
          path: true,
          vulnerableStartLine: true,
          vulnerability: TOP_RULE_COLUMNS,
        },
        relations: ['vulnerability'],
        take: perTypeLimit,
        order: { priorityScore: 'DESC', currentSeverity: 'ASC' },
      }),
      this.scaVulnDetectRepository.find({
        where: { projectId, currentState: In(activeStates) },
        select: {
          ...TOP_SCORE_COLUMNS,
          vulnerability: { id: true, summary: true },
          scaDetectedPackage: { id: true, packageName: true },
        },
        relations: ['vulnerability', 'scaDetectedPackage'],
        take: perTypeLimit,
        order: { priorityScore: 'DESC', currentSeverity: 'ASC' },
      }),
      this.containerVulnDetectRepository.find({
        where: { projectId, currentState: In(activeStates) },
        select: {
          ...TOP_SCORE_COLUMNS,
          vulnerabilityIdentifier: true,
          vulnerability: { id: true, summary: true },
          // Known defect, to fix on its own: mapContainer reads
          // `detectedPackage.name`, a property the entity does not have (it is
          // `packageName`), so container items of the top carry no package
          // name. Only the id is read until then.
          detectedPackage: { id: true },
        },
        relations: ['vulnerability', 'detectedPackage'],
        take: perTypeLimit,
        order: { priorityScore: 'DESC', currentSeverity: 'ASC' },
      }),
    ]);

    // An advisory the project imported is described by the project's own row.
    await applyProjectImportedAdvisories(
      this.scaVulnDetectRepository.manager,
      projectId,
      scaDetections,
      (d) =>
        d.scaDetectedPackage
          ? {
              packageName: d.scaDetectedPackage.packageName,
              ecosystem: d.scaDetectedPackage.ecosystem ?? '',
            }
          : null,
    );
    await applyProjectImportedAdvisories(
      this.containerVulnDetectRepository.manager,
      projectId,
      containerDetections,
      () => null,
    );

    // Helper: compute composite score for a detection
    const computeScore = (vuln: any, reachability?: string | null): number => {
      const input: PriorityInput = {
        cvss4EnvironmentalScore: vuln.cvss4EnvironmentalScore ?? null,
        cvss4BaseScore: vuln.cvss4BaseScore ?? null,
        currentSeverity: resolveEffectiveSeverity(vuln) ?? '',
        epssScore: vuln.epssScore ?? null,
        epssPercentile: vuln.epssPercentile ?? null,
        exploitabilityScore: vuln.exploitabilityScore ?? null,
        businessCriticality,
        dataClassification,
        reachability: reachability ?? null,
        priorityManualOverride: vuln.priorityManualOverride ?? false,
      };
      const result = this.priorityCalculator.calculate(input);
      return result?.compositeScore ?? 0;
    };

    // Map SAST/IAC/CICD/Secret detections (all have same structure with vulnerability relation)
    const mapSastLike = (
      detection: any,
      type: string,
    ): TopVulnerabilityItem & { _score: number } => {
      const score = computeScore(detection);
      return {
        _score: score,
        id: detection.id,
        vulnerabilityType: type,
        name: detection.vulnerability?.name ?? '',
        description: detection.vulnerability?.shortDescription ?? '',
        severity: detection.currentSeverity,
        compositeScore: score,
        cvss4EnvironmentalScore: detection.cvss4EnvironmentalScore ?? undefined,
        exploitabilityVerdict: detection.exploitabilityVerdict ?? undefined,
        exploitabilityReason: detection.exploitabilityReason ?? undefined,
        exploitabilityScoreReason:
          detection.exploitabilityScoreReason ?? undefined,
        exploitabilitySource: detection.exploitabilitySource ?? undefined,
        filePath: detection.path ?? undefined,
        line: detection.vulnerableStartLine ?? undefined,
        cveId: undefined,
        cwe: detection.vulnerability?.cwe ?? [],
        packageName: undefined,
      };
    };

    // Map SCA detections
    const mapSca = (
      detection: any,
    ): TopVulnerabilityItem & { _score: number } => {
      const score = computeScore(detection);
      const osvVuln = detection.vulnerability;
      return {
        _score: score,
        id: detection.id,
        vulnerabilityType: 'sca',
        name: osvVuln?.id ?? '',
        description: osvVuln?.summary ?? '',
        severity: detection.currentSeverity,
        compositeScore: score,
        cvss4EnvironmentalScore: detection.cvss4EnvironmentalScore ?? undefined,
        exploitabilityVerdict: detection.exploitabilityVerdict ?? undefined,
        exploitabilityReason: detection.exploitabilityReason ?? undefined,
        exploitabilityScoreReason:
          detection.exploitabilityScoreReason ?? undefined,
        exploitabilitySource: detection.exploitabilitySource ?? undefined,
        filePath: undefined,
        line: undefined,
        cveId: osvVuln?.id ?? undefined,
        cwe: [],
        packageName: detection.scaDetectedPackage?.packageName ?? undefined,
      };
    };

    // Map Container detections
    const mapContainer = (
      detection: any,
    ): TopVulnerabilityItem & { _score: number } => {
      const score = computeScore(detection);
      const osvVuln = detection.vulnerability;
      return {
        _score: score,
        id: detection.id,
        vulnerabilityType: 'container',
        name: detection.vulnerabilityIdentifier ?? osvVuln?.id ?? '',
        description: osvVuln?.summary ?? '',
        severity: detection.currentSeverity,
        compositeScore: score,
        cvss4EnvironmentalScore: detection.cvss4EnvironmentalScore ?? undefined,
        exploitabilityVerdict: detection.exploitabilityVerdict ?? undefined,
        exploitabilityReason: detection.exploitabilityReason ?? undefined,
        exploitabilityScoreReason:
          detection.exploitabilityScoreReason ?? undefined,
        exploitabilitySource: detection.exploitabilitySource ?? undefined,
        filePath: undefined,
        line: undefined,
        cveId: detection.vulnerabilityIdentifier ?? undefined,
        cwe: [],
        packageName: detection.detectedPackage?.name ?? undefined,
      };
    };

    // Map Secret detections. Secrets bypass the multi-signal composite — their
    // priority is deterministic (always critical_urgent) and exploitability
    // does not apply — so rank them by their stored priorityScore (normalized
    // to 0-1) and never expose exploitability fields.
    const mapSecret = (
      detection: any,
    ): TopVulnerabilityItem & { _score: number } => {
      const score = (detection.priorityScore ?? 0) / 100;
      return {
        _score: score,
        id: detection.id,
        vulnerabilityType: 'secret',
        name: detection.vulnerability?.name ?? '',
        description: detection.vulnerability?.shortDescription ?? '',
        severity: detection.currentSeverity,
        compositeScore: score,
        cvss4EnvironmentalScore: detection.cvss4EnvironmentalScore ?? undefined,
        exploitabilityVerdict: undefined,
        exploitabilityReason: undefined,
        exploitabilityScoreReason: undefined,
        exploitabilitySource: undefined,
        filePath: detection.path ?? undefined,
        line: detection.vulnerableStartLine ?? undefined,
        cveId: undefined,
        cwe: detection.vulnerability?.cwe ?? [],
        packageName: undefined,
      };
    };

    // Build scored items from all types
    const allItems: Array<TopVulnerabilityItem & { _score: number }> = [
      ...sastDetections.map((d) => mapSastLike(d, 'sast')),
      ...iacDetections.map((d) => mapSastLike(d, 'iac')),
      ...cicdDetections.map((d) => mapSastLike(d, 'cicd')),
      ...secretDetections.map((d) => mapSecret(d)),
      ...scaDetections.map(mapSca),
      ...containerDetections.map(mapContainer),
    ];

    // Sort by composite score descending, take top N
    allItems.sort((a, b) => b._score - a._score);
    const topItems = allItems.slice(0, limit);

    // Strip internal _score field and map to proto shape
    const items: TopVulnerabilityItem[] = topItems.map((entry) => ({
      id: entry.id,
      vulnerabilityType: entry.vulnerabilityType,
      name: entry.name,
      description: entry.description,
      severity: entry.severity,
      compositeScore: entry.compositeScore,
      cvss4EnvironmentalScore: entry.cvss4EnvironmentalScore,
      exploitabilityVerdict: entry.exploitabilityVerdict,
      exploitabilityReason: entry.exploitabilityReason,
      exploitabilityScoreReason: entry.exploitabilityScoreReason,
      exploitabilitySource: entry.exploitabilitySource,
      filePath: entry.filePath,
      line: entry.line,
      cveId: entry.cveId,
      cwe: entry.cwe,
      packageName: entry.packageName,
    }));

    return { items };
  }
}
