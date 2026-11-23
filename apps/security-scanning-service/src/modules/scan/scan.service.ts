import { Inject, Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { GitHistoryCursorService } from './git-history/git-history-cursor.service';
import { ilike } from '@cybedefend/db-dialect';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Span } from 'nestjs-otel';
import { Logger } from 'nestjs-pino';
import { firstValueFrom } from 'rxjs';
import { FileManagementService } from 'src/modules/file/file-management.service';
import { normalizeScanFailure } from './core/scan-failure.util';
import {
  buildScanPipeline,
  deriveAgentStage,
  isAgentContainer,
  isClosedStatus,
  pickAgentContainer,
  PipelineContext,
  QueueReason,
} from './core/scanPipeline';
import {
  readScanPipelineConfig,
  ScanPipelineConfig,
} from './core/scanPipelineConfig';
import { EXIT_INFRA_ERROR } from '../../core/constants/scanlink-error-codes';
import { In, LessThan, Repository } from 'typeorm';
import { Container } from '../../entities/container.entity';
import { Scan } from '../../entities/scan.entity';
import * as fs from 'node:fs';
import { ClientGrpc, RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import {
  ResultServiceClient,
  RESULT_SERVICE_NAME,
} from '@grpc/analysis-reporting/analysis_reporting';
import {
  ORGANIZATION_SERVICE_NAME,
  OrganizationServiceClient,
  PROJECT_SERVICE_NAME,
  ProjectServiceClient,
} from '@grpc/global-management/global_management';
import { ProjectUpdateRequest } from '@grpc/global-management/project';

import {
  GetScanRequest,
  ScanResponse,
  Container as ContainerInterface,
  GetLastScanStatusResponse,
  ProjectGetRequest,
  StartScanRequest,
  StartScanResponse,
  UpdateScanRequest,
  UpdateScanResponse,
  CreateFailedScanRequest,
  CreateFailedScanResponse,
  CreateScanRequest,
  CreateScanResponse,
  UpdateScanDataRequest,
  CheckExistingScanResponse,
  GetScanIdsByBranchRequest,
  GetScanIdsByBranchResponse,
  CreateCompletedScanRequest,
  CreateCompletedScanResponse,
  GetProjectBranchesFromScansPaginatedRequest,
  GetProjectBranchesFromScansPaginatedResponse,
} from '@grpc/security-scanning/scan';

// Types for batch scan status - will be generated after proto regeneration
interface GetProjectsScanStatusRequest {
  projectIds: string[];
}
interface ProjectScanStatusEntry {
  projectId: string;
  isScanning: boolean;
}
interface GetProjectsScanStatusResponse {
  statuses: ProjectScanStatusEntry[];
}

// Types for project branches from scans
interface GetProjectBranchesFromScansRequest {
  projectId: string;
}
interface GetProjectBranchesFromScansResponse {
  branches: string[];
}

import { isHeldForResults } from './core/resultsHold';
import type { FinalizeResultsOutcome } from './core/resultsHold';
import { resultsStatusOf } from './core/resultsStatus';
import { safeGrpcCall } from '@grpc/wrapper-grpc.module';
import {
  ExistingScanCheckOptions,
  OrganizationManager,
  ScanPipelineEvents,
  ScanProgressUtils,
  ScanStateManager,
  ScanStateStore,
  ScanUtils,
  ScanValidation,
} from './core';
import {
  SCANNER_ORCHESTRATOR_PORT,
  ScannerOrchestratorPort,
} from 'src/edition/ports/scanner-orchestrator.port';
import {
  SCAN_LIFECYCLE_HOOKS,
  ScanLifecycleHooks,
} from 'src/edition/ports/scan-lifecycle-hooks.port';
import {
  SCANNER_PODS_PORT,
  ScannerPodsPort,
} from 'src/edition/ports/scanner-pods.port';
import {
  AI_ANALYSIS_PORT,
  AiAnalysisPort,
} from 'src/edition/ports/ai-analysis.port';
import { ContainerScanBranchResolver } from './core/containerScanBranchResolver';
import { ImportScanService } from './import/import-scan.service';
import { RealtimeEventPublisher } from '@cybedefend/realtime-publisher';
import { ulid } from 'ulid';

@Injectable()
export class ScanService implements OnModuleInit {
  private projectServiceClient!: ProjectServiceClient;
  private organizationServiceClient!: OrganizationServiceClient;
  private resultServiceClient!: ResultServiceClient;
  private extensionToLanguageMap: Map<string, string> = new Map();
  private readonly MAX_CONCURRENT_SCANS_PLATFORM: number;
  validFilesWithoutExtension: any;
  private readonly hbTimers = new Map<string, NodeJS.Timeout>();
  /**
   * Budgets and switches of the scan pipeline,
   * read once from the environment with safe defaults.
   */
  private readonly pipelineConfig: ScanPipelineConfig;

  constructor(
    @InjectRepository(Scan)
    private readonly scanRepository: Repository<Scan>,
    @InjectRepository(Container)
    private readonly containerRepository: Repository<Container>,
    private readonly fileManagementService: FileManagementService,
    // The pod clean-up goes through the port, which each edition binds.
    @Inject(SCANNER_PODS_PORT)
    private readonly pods: ScannerPodsPort,
    private readonly scanUtils: ScanUtils,
    private readonly scanProgressUtils: ScanProgressUtils,
    private readonly scanStateManager: ScanStateManager,
    private readonly scanValidation: ScanValidation,
    private readonly organizationManager: OrganizationManager,
    // CreateScan's write and StartScan of a non-import scan go through the
    // port, which each edition binds.
    @Inject(SCANNER_ORCHESTRATOR_PORT)
    private readonly orchestrator: ScannerOrchestratorPort,
    @Inject(SCAN_LIFECYCLE_HOOKS)
    private readonly hooks: ScanLifecycleHooks,
    // The agent ingestion, the graph-only start and the AI queue go
    // through the port, which each edition binds.
    @Inject(AI_ANALYSIS_PORT)
    private readonly aiAnalysis: AiAnalysisPort,
    private readonly containerScanBranches: ContainerScanBranchResolver,
    // CreateScan and StartScan of an import scan: no pod,
    // no conflict check, the stored file handed to analysis-reporting.
    private readonly importScans: ImportScanService,
    private readonly scanStateStore: ScanStateStore,
    private readonly pipelineEvents: ScanPipelineEvents,
    private readonly realtime: RealtimeEventPublisher,
    private configService: ConfigService,
    private readonly logger: Logger,
    @Inject('GLOBAL_MANAGEMENT_SERVICE')
    private readonly globalManagementClient: ClientGrpc,
    @Inject('ANALYSIS_REPORTING_SERVICE')
    private readonly analysisReportingClient: ClientGrpc,
    @Optional() private readonly schedulerRegistry?: SchedulerRegistry,
    @Optional() private readonly historyCursors?: GitHistoryCursorService,
  ) {
    this.MAX_CONCURRENT_SCANS_PLATFORM = Number.parseInt(
      this.configService.get<string>('MAX_CONCURRENT_SCANS_PLATFORM', '25'),
    );
    this.pipelineConfig = readScanPipelineConfig((key) =>
      this.configService.get<string>(key),
    );
    this.logger.log(
      `Initialized scan service with MAX_CONCURRENT_SCANS_PLATFORM=${this.MAX_CONCURRENT_SCANS_PLATFORM}, SCAN_SCANNER_PHASE_MAX_MS=${this.pipelineConfig.scannerPhaseMaxMs}, SCAN_MAX_TOTAL_MS=${this.pipelineConfig.scanMaxTotalMs}`,
    );
  }

  onModuleInit() {
    this.projectServiceClient =
      this.globalManagementClient.getService<ProjectServiceClient>(
        PROJECT_SERVICE_NAME,
      );
    this.organizationServiceClient =
      this.globalManagementClient.getService<OrganizationServiceClient>(
        ORGANIZATION_SERVICE_NAME,
      );
    this.resultServiceClient =
      this.analysisReportingClient.getService<ResultServiceClient>(
        RESULT_SERVICE_NAME,
      );
  }

  /**
   * Get the last scan status for a project.
   * @param data The request data containing the project ID.
   * @returns The last scan status for the project.
   */
  @Span()
  async getScan(data: GetScanRequest): Promise<ScanResponse> {
    // When the caller sends a projectId, the lookup is scoped by it, so a
    // scanId of another project is not found (NOT_FOUND, never a hint that
    // the scan exists). The gateway always sends it on user-facing requests;
    // service-to-service callers that already own the scan id may omit it.
    const where: { id: string; projectId?: string } = { id: data.scanId };
    if (data.projectId) {
      where.projectId = data.projectId;
    }

    // The scanner relation gives each container its scanner type. A join of the same query: no extra
    // round trip for any caller.
    //
    // `find`, not `findOne`: `findOne` puts a LIMIT on the joined query, and
    // TypeORM then runs a DISTINCT pre-query for the scan id before the join.
    // The WHERE holds the primary key, so at most one row
    // comes back without any limit.
    const [scan] = await this.scanRepository.find({
      where,
      relations: ['containers', 'containers.scanner'],
    });

    if (!scan) {
      this.logger.log(
        `Scan with id ${data.scanId} not found - metadata: { scanId: ${data.scanId}, projectId: ${data.projectId || '(none)'} }`,
      );
      throw new RpcException({
        code: status.NOT_FOUND,
        message: `Scan not found`,
      });
    }

    let progress = await this.scanProgressUtils.calculateScanProgress(scan);

    // An import scan (`importFormat IS NOT NULL`) has no container.
    // While it runs, its step is the import one; its findings count is the
    // one CompleteImportScan stored in `metadata.importFindingsCount`.
    const isImportScan = Boolean(scan.importFormat);

    let step = 'completed';
    if (isImportScan && scan.state === 'running') {
      step = 'import: processing results';
    } else if (scan.containers) {
      for (const container of scan.containers) {
        if (container.status !== 'completed') {
          step = container.step;
          break;
        }
      }
    }

    // Every container is closed but the results are not final yet: the scan
    // is still ingesting them, so it reads as almost done, never as 100.
    if (isHeldForResults(scan)) {
      step = 'processing results';
      progress = 99;
    }

    let vulnsDetected = 0;
    if (isImportScan) {
      vulnsDetected = Number(scan.metadata?.importFindingsCount ?? 0);
    } else {
      // Detected by the scanners only: the agent's processed count is the
      // findings it analysed, and adding it counted them twice during the AI.
      for (const container of scan.containers ?? []) {
        if (isAgentContainer(container)) continue;
        if (container.processedVulnerabilities) {
          vulnsDetected += container.processedVulnerabilities;
        }
      }
    }

    const containersResponse: ContainerInterface[] = scan.containers
      ? scan.containers.map((container) => this.toContainerResponse(container))
      : [];

    // Cast: the agent's former project id is no field of the public proto;
    // the private one still declares it, and an absent string decodes as ''.
    const scanResponse = {
      id: scan.id,
      name: scan.name,
      state: scan.state,
      language: scan.language,
      projectId: scan.projectId,
      private: scan.private,
      initializerUserId: scan.initializerUserId,
      createAt: scan.createAt ? scan.createAt.toISOString() : '',
      updatedAt: scan.updatedAt ? scan.updatedAt.toISOString() : '',
      scanType: scan.scanType,
      startTime: scan.startTime ? scan.startTime.toISOString() : '',
      endTime: scan.endTime ? scan.endTime.toISOString() : '',
      containers: containersResponse,
      progress,
      step,
      resultsStatus: resultsStatusOf(scan, scan.containers ?? []),
      resultsFinalizedAt: scan.resultsFinalizedAt
        ? scan.resultsFinalizedAt.toISOString()
        : undefined,
      vulnerabilityDetected: vulnsDetected,
      branch: scan.branch || '',
      // Error information reported by the scanner container
      errorMessage: scan.errorMessage || undefined,
      errorCode: scan.errorCode || undefined,
      errorCategory: scan.errorCategory || undefined,
      // Surfaced so analysis-reporting can skip the finalize
      // auto-resolve of out-of-scope vulns for diff scans.
      isDiffScan: scan.isDiffScan || false,
      // A graph-only repository import (closed extension): the gateway
      // checks its own permission on the status route for it. mysql2 hands
      // the TINYINT(1) back as a number.
      isGraphOnly: Boolean(scan.isGraphOnly),
      // Read by analysis-reporting into the scan-diff history. `metadata` is
      // untyped JSON, so only a string passes.
      codingAgent:
        typeof scan.metadata?.codingAgent === 'string'
          ? scan.metadata.codingAgent
          : undefined,
      // The import read model — set only on an import
      // scan, absent on every other one.
      importFormat: scan.importFormat || undefined,
      importTool: scan.importTool || undefined,
    } as ScanResponse;

    // What the scan did about the git history, and how much of the branch is
    // covered. Both absent when there is nothing to say.
    const historyPass = scan.metadata?.historyPass;
    if (historyPass) scanResponse.historyPass = historyPass;
    // Coverage costs a read: only the user-facing route asks for it, and a
    // failure of that read never fails GetScan.
    if (data.includePipeline && scan.branch && this.historyCursors) {
      try {
        const coverage = await this.historyCursors.coverageFor(
          scan.projectId,
          scan.branch,
        );
        if (coverage) scanResponse.historyCoverage = coverage;
      } catch (error) {
        this.logger.warn(
          `[GitHistory] Scan ${scan.id}: coverage not read: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    // Only the gateway's user-facing route asks for it; internal callers
    // (analysis-reporting, the AI agent, crons) pay nothing more.
    if (data.includePipeline) {
      const containers = scan.containers ?? [];
      scanResponse.pipeline = buildScanPipeline(
        scan,
        containers,
        await this.pipelineContextFor(scan, containers),
      );
    }

    return scanResponse;
  }

  /**
   * One container as `getScan` returns it. The fields of the scan pipeline
   * are absent when the row has no value, except
   * `scannerType`, empty for the agent or a scanner whose relation is gone.
   */
  private toContainerResponse(container: Container): ContainerInterface {
    const response: ContainerInterface = {
      id: container.id,
      status: container.status,
      createdAt: container.createdAt ? container.createdAt.toISOString() : '',
      startedAt: container.startedAt ? container.startedAt.toISOString() : '',
      finishedAt: container.finishedAt
        ? container.finishedAt.toISOString()
        : '',
      scanId: container.scanId,
      step: container.step,
      image: container.image || '',
      // added podName field (proto updated)
      podName: container.podName || '',
      scannerType: isAgentContainer(container)
        ? ''
        : (container.scanner?.scannerType ?? ''),
    };
    if (container.totalVulnerabilities != null) {
      response.totalVulnerabilities = container.totalVulnerabilities;
    }
    if (container.processedVulnerabilities != null) {
      response.processedVulnerabilities = container.processedVulnerabilities;
    }
    if (container.outcomeReason) {
      response.outcomeReason = container.outcomeReason;
    }
    const queuedAt = this.toIsoString(container.analysisQueuedAt);
    if (queuedAt) response.analysisQueuedAt = queuedAt;
    const startedAt = this.toIsoString(container.analysisStartedAt);
    if (startedAt) response.analysisStartedAt = startedAt;
    return response;
  }

  /** ISO-8601 of a stored date, or undefined when absent or invalid. */
  private toIsoString(value: Date | null | undefined): string | undefined {
    if (!value) return undefined;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }

  /**
   * What the pipeline of `getScan` needs beyond the scan's own rows. Extra
   * queries in two cases only: a
   * `queued` scan (its place in the organisation queue and why it waits),
   * and an agent queued for AI in a running scan (its place in the AI
   * queue). Each lookup is best-effort: a failure leaves its field out and
   * never makes the scan unreadable.
   */
  @Span()
  private async pipelineContextFor(
    scan: Scan,
    containers: Container[],
  ): Promise<PipelineContext> {
    const ctx: PipelineContext = { config: this.pipelineConfig };
    if (scan.state === 'queued') {
      Object.assign(ctx, await this.queuedScanPlace(scan));
    }
    const agent = pickAgentContainer(containers);
    if (
      scan.state === 'running' &&
      deriveAgentStage(agent) === 'queued_for_ai'
    ) {
      const aiQueuePosition = await this.aiQueuePlace(scan.id, agent);
      if (aiQueuePosition !== undefined) ctx.aiQueuePosition = aiQueuePosition;
    }
    return ctx;
  }

  /**
   * A queued scan's place in its organisation's queue, and why it waits:
   * - `queuePosition`: 1 + the organisation's queued scans created earlier,
   *   the order the dequeue follows (`createAt` ascending);
   * - `queueReason`: `platform_limit` when the platform cap is reached,
   *   `org_limit` when the organisation's slot-holding scans reach its
   *   limit, `starting` otherwise (the next dequeue tick starts it). Both
   *   counts are the slot-holding ones the dequeue reads.
   *
   * Never counted without an organisation: an unscoped count would read the
   * whole queue.
   */
  @Span()
  private async queuedScanPlace(
    scan: Scan,
  ): Promise<{ queuePosition?: number; queueReason?: QueueReason }> {
    const place: { queuePosition?: number; queueReason?: QueueReason } = {};
    const organizationId = scan.organizationId;
    if (!organizationId) return place;

    if (scan.createAt) {
      try {
        const ahead = await this.scanRepository.count({
          where: {
            organizationId,
            state: 'queued',
            createAt: LessThan(scan.createAt),
          },
        });
        place.queuePosition = ahead + 1;
      } catch (error) {
        this.logger.warn(
          `[getScan] queue position of scan ${scan.id} unavailable: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    try {
      const slotHolding =
        await this.organizationManager.getSlotHoldingScansCount();
      if (slotHolding.total >= this.MAX_CONCURRENT_SCANS_PLATFORM) {
        place.queueReason = 'platform_limit';
      } else {
        const limit =
          await this.organizationManager.getOrganizationConcurrentScanLimit(
            organizationId,
          );
        place.queueReason =
          (slotHolding.byOrganization[organizationId] ?? 0) >= limit
            ? 'org_limit'
            : 'starting';
      }
    } catch (error) {
      this.logger.warn(
        `[getScan] queue reason of scan ${scan.id} unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return place;
  }

  /**
   * An agent's approximate place in the AI queue, platform-wide: 1 + the
   * agents of running scans queued for AI before it (`analysisQueuedAt`,
   * then `scanId`, the order `selectAnalysesToStart` starts from). The
   * fairness rule may reorder the queue, hence approximate. One query of
   * the running scans with a few container columns, counted in memory.
   */
  @Span()
  private async aiQueuePlace(
    scanId: string,
    agent: Container,
  ): Promise<number | undefined> {
    const queuedAt = agent.analysisQueuedAt
      ? new Date(agent.analysisQueuedAt).getTime()
      : NaN;
    if (Number.isNaN(queuedAt)) return undefined;
    try {
      const runningScans = await this.scanRepository.find({
        where: { state: 'running' },
        relations: ['containers'],
        select: {
          id: true,
          containers: {
            id: true,
            status: true,
            image: true,
            podName: true,
            createdAt: true,
            analysisQueuedAt: true,
            analysisStartedAt: true,
          },
        },
      });
      let ahead = 0;
      for (const other of runningScans) {
        if (other.id === scanId) continue;
        const otherAgent = pickAgentContainer(other.containers ?? []);
        if (deriveAgentStage(otherAgent) !== 'queued_for_ai') continue;
        const otherAt = new Date(otherAgent.analysisQueuedAt).getTime();
        if (otherAt < queuedAt || (otherAt === queuedAt && other.id < scanId)) {
          ahead++;
        }
      }
      return ahead + 1;
    } catch (error) {
      this.logger.warn(
        `[getScan] AI queue position of scan ${scanId} unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
    }
  }

  /**
   * Update a scan with new information.
   *
   * @param updateScan The new information to update the scan with.
   * @returns The updated scan or an error if the scan does not exist.
   */
  @Span()
  async updateScan(updateScan: UpdateScanRequest): Promise<UpdateScanResponse> {
    // Minimal entry log (low noise, still traceable)
    this.logger.log(
      `[updateScan] scan=${updateScan.scanId} pod=${updateScan.podName} state=${updateScan.state}`,
    );

    const scan = await this.scanValidation.findScanById(updateScan.scanId);
    if (!scan) {
      this.scanValidation.handleScanNotFound(updateScan.scanId);
      return { success: false, message: 'Scan not found' }; // safety net (handleScanNotFound should throw)
    }

    // Falls back to the scan's agent container when podName is empty or stale:
    // podName is optional in the proto, and the agent reports without it when
    // it cannot resolve its pod.
    const container = await this.scanValidation.findContainerForUpdate(
      updateScan.podName,
      updateScan.scanId,
    );
    if (!container) {
      // A caller that never had a pod — file-management reporting a failed
      // download, say — sends no podName, and a scan still in
      // `waiting_for_file` has no container to fall back on either. Throwing
      // INTERNAL here would make the caller give up and leave the scan
      // orphaned until the 45-minute watchdog. A terminal state carries all the information a
      // scan-level update needs, so apply it instead of discarding it.
      //
      // Scoped to a scan that launched NOTHING. `findContainerForUpdate` only
      // falls back to the AGENT container (image LIKE '%agent%'), so landing
      // here does not mean the scan has no containers — a scan with SAST/SCA
      // pods mid-flight lands here too, and forcing it terminal would strand
      // those pods and discard their results. Anything with a container keeps
      // today's `Container not found`.
      if (!updateScan.podName && this.isScanTerminalState(updateScan.state)) {
        const containerCount = await this.containerRepository.count({
          where: { scanId: scan.id },
        });
        if (containerCount === 0) {
          this.logger.warn(
            `[updateScan] no podName and no container for scan=${scan.id}; applying terminal state '${updateScan.state}' at scan level`,
          );
          return await this.applyScanLevelTerminalUpdate(scan, updateScan);
        }
        this.logger.warn(
          `[updateScan] no podName for scan=${scan.id} but it has ${containerCount} container(s); refusing to force '${updateScan.state}' at scan level`,
        );
      }
      this.scanValidation.handleContainerNotFound(scan.id, updateScan.podName);
      return { success: false, message: 'Container not found' }; // garde-fou
    }

    try {
      // Truncate step to 255 bytes to avoid DB constraint violations with multi-byte UTF-8
      if (updateScan.step) {
        const encoder = new TextEncoder();
        const bytes = encoder.encode(updateScan.step);
        if (bytes.length > 255) {
          const decoder = new TextDecoder();
          updateScan.step = decoder.decode(bytes.slice(0, 252)) + '...';
        }
      }

      const previousStep = container.step;
      // What the pipeline events compare with.
      const before = {
        status: container.status,
        processed: container.processedVulnerabilities ?? null,
      };
      const update = await this.scanValidation.updateContainerStatus(
        container,
        updateScan,
      );
      if (!update.applied) {
        // Nothing was written, so there is nothing to recompute, publish or
        // notify. Answering success stops the caller's retries — a reanalysis
        // keeps reporting
        // progress on the project's last scan, whose agent container is long
        // closed, and its verdicts travel through analysis-reporting anyway.
        const message =
          update.reason === 'analysis_started'
            ? 'Update ignored: analysis already started'
            : 'Update ignored: container already closed';
        const line = `[updateScan] ${message} - metadata: { scanId: ${scan.id}, containerId: ${container.id}, containerStatus: ${container.status}, requestedState: ${updateScan.state} }`;
        if (isClosedStatus(updateScan.state)) {
          this.logger.log(line);
        } else {
          this.logger.debug(line);
        }
        return { success: true, message };
      }
      this.logger.log(
        `[updateScan] container=${container.id} -> state=${updateScan.state}`,
      );

      if (
        updateScan.step &&
        container.step &&
        container.step !== previousStep
      ) {
        void this.realtime.publish({
          eventId: ulid(),
          type: 'AGENT_STEP_CHANGED',
          scope: {
            organizationId: scan.organizationId,
            projectId: scan.projectId,
            scanId: scan.id,
          },
          payload: {
            agentStepChanged: {
              scanId: scan.id,
              podName: container.podName,
              previousStep: previousStep ?? '',
              currentStep: container.step,
            },
          },
        });
      }

      const containerClosed = this.scanStateManager.isContainerTerminated(
        updateScan.state,
      );
      let scanEnded = false;
      try {
        // Only a container status change can move the scan state: the
        // progress ticks, most of the UpdateScans, would recompute it for
        // nothing. A closed container refuses any update above, so a
        // terminal report is always a change.
        if ((updateScan.state || before.status) !== before.status) {
          scanEnded = await this.scanStateManager.recordScanState(scan);
        }
        // After the recompute, so the page refetches the scan's new state.
        this.pipelineEvents.publishContainerUpdate(
          scan,
          container,
          updateScan,
          before,
        );

        if (containerClosed) {
          this.logger.log(
            `[updateScan] containerTerminated id=${container.id} scan=${scan.id} finalState=${updateScan.state}`,
          );
          // Release the agent slots if relevant + trigger the deferred notification
          try {
            const marker = (
              (container.image || '') + (container.podName || '')
            ).toLowerCase();
            if (marker.includes('agent')) {
              this.logger.log(
                `[Agent] Slots released for scan=${scan.id} (agent container end)`,
              );
              // Trigger deferred scan completion notification in analysis-reporting
              // (notifications were deferred while waiting for agent to complete)
              safeGrpcCall(
                this.resultServiceClient.notifyScanComplete({
                  scanId: scan.id,
                  projectId: scan.projectId,
                }),
              ).catch((err) => {
                this.logger.error(
                  `[Agent] Failed to trigger deferred notification for scan=${scan.id}: ${err instanceof Error ? err.message : err}`,
                );
              });
            }
          } catch (e) {
            this.logger.log(
              `[Agent] Slot release failure scan=${scan.id}: ${e instanceof Error ? e.message : e}`,
            );
          }
        }
      } finally {
        // The clean-up comes once the scan state is written and published,
        // and whatever happened to that write: a recompute that throws must
        // not leave the pod and its Secrets behind.
        await this.cleanUpAfterUpdate(scan, container, {
          scanEnded,
          containerClosed,
        });
      }

      const terminatedCount = scan.containers?.filter?.(
        (c: any) => c.status === 'completed' || c.status === 'failed',
      ).length;
      this.logger.log(
        `[updateScan][exit] scanId=${scan.id} state=${scan.state} terminatedContainers=${terminatedCount ?? 'not recomputed'}`,
      );

      return { success: true, message: 'Scan updated successfully' };
    } catch (e) {
      if (e instanceof RpcException) throw e;
      this.logger.error(
        `[updateScan] Unexpected error for scan=${updateScan.scanId}: ${e instanceof Error ? e.message : e}`,
      );
      throw new RpcException({
        code: status.INTERNAL,
        message: `UpdateScan failed: ${e instanceof Error ? e.message : 'unknown error'}`,
      });
    }
  }

  /**
   * The clean-up an applied UpdateScan owes: the scan's end (archive
   * deletion, analysis-reporting's notification, policy evaluation) when the
   * update ended the scan, and the pod with its Secrets when the container
   * closed. Side by side, so an archive deletion that hangs never keeps the
   * pod and its registry credentials alive. Both are still
   * awaited: nothing else deletes a Succeeded pod nor an orphan archive.
   * Never rejects: each failure is logged.
   */
  @Span()
  private async cleanUpAfterUpdate(
    scan: Scan,
    container: Container,
    {
      scanEnded,
      containerClosed,
    }: { scanEnded: boolean; containerClosed: boolean },
  ): Promise<void> {
    const steps: { name: string; run: () => Promise<void> }[] = [];
    if (scanEnded) {
      steps.push({
        name: 'scan end',
        run: () => this.scanStateManager.handleCompletedScan(scan),
      });
    }
    if (containerClosed) {
      steps.push({
        name: 'pod deletion',
        // The pod clean-up goes through SCANNER_PODS_PORT.
        run: () => this.pods.releaseTerminatedContainer(scan, container),
      });
    }
    const results = await Promise.allSettled(
      steps.map((step) => Promise.resolve().then(step.run)),
    );
    results.forEach((result, i) => {
      if (result.status === 'rejected') {
        const reason: unknown = result.reason;
        this.logger.error(
          `[updateScan] ${steps[i].name} clean-up failed for scan=${scan.id} container=${container.id}: ${reason instanceof Error ? reason.message : String(reason)}`,
        );
      }
    });
  }

  /**
   * A scan state from which the scan never moves again.
   *
   * Deliberately narrower than `ScanStateManager.isContainerTerminated`: that
   * one classifies CONTAINER states (and includes `completed` /
   * `completed_degraded`, which are results a container reports). Here we only
   * accept the two states a caller with no container may legitimately force on
   * the scan itself — a success has to come from the containers that produced
   * it.
   */
  private isScanTerminalState(state: string): boolean {
    return state === 'failed' || state === 'cancelled';
  }

  /**
   * A scan that has already reached an outcome and must not be rewritten.
   *
   * Broader than `isScanTerminalState`, which asks what a caller may REQUEST;
   * this asks what the scan already IS. `updateScanData` guards the same way
   * for `cancelled`; the scan-level path guards all four outcomes, because a
   * late pod-less `failed` report arriving after a user cancel, after the
   * stalled-queue watchdog, or after a normal completion would otherwise
   * rewrite the state, overwrite `endTime` and publish a bogus transition.
   */
  private isScanSettled(state: string): boolean {
    return (
      state === 'failed' ||
      state === 'cancelled' ||
      state === 'completed' ||
      state === 'completed_degraded'
    );
  }

  /**
   * Apply a terminal state directly to the scan, for an
   * `UpdateScan` that has no container to attach itself to.
   *
   * `UpdateScanRequest` carries no errorCode/errorMessage (see
   * libs/protos/security-scanning/scan.proto), so a `failed` gets the generic
   * infra code — the same one `markQueuedScanInfraFailed` uses — which the
   * dashboard renders through its i18n table. A code already stored by a more
   * precise reporter (e.g. `updateScanData`) is never overwritten, and a
   * `cancelled` gets no failure triplet at all: a cancellation is not a
   * failure.
   */
  private async applyScanLevelTerminalUpdate(
    scan: Scan,
    updateScan: UpdateScanRequest,
  ): Promise<UpdateScanResponse> {
    if (this.isScanSettled(scan.state)) {
      this.logger.warn(
        `[updateScan] ignoring '${updateScan.state}' for scan ${scan.id}: already ${scan.state}`,
      );
      return {
        success: true,
        message: `Scan is already ${scan.state}, update ignored`,
      };
    }

    const previousState = scan.state;
    scan.state = updateScan.state;
    scan.endTime = new Date();

    if (updateScan.state === 'failed' && scan.errorCode == null) {
      const failure = normalizeScanFailure({ errorCode: EXIT_INFRA_ERROR });
      scan.errorCode = failure.errorCode ?? null;
      scan.errorCategory = failure.errorCategory ?? null;
      scan.errorMessage = this.scanUtils.truncateErrorMessage(
        failure.errorMessage ?? null,
      );
    }

    await this.scanRepository.save(scan);
    this.scanStateManager.publishStatusChanged(scan, previousState);
    // A scan ended at scan level (no container to report on) is handed to
    // the lifecycle hooks. Fire-and-forget.
    this.hooks.onScanClosed(scan, scan.state, 'scan_level');

    return { success: true, message: 'Scan updated successfully' };
  }

  /**
   * Refuse to start a scan that would collide with one already in flight.
   * The rule lives in `ScanStateStore`; this keeps the gRPC-facing
   * signature the controller calls.
   */
  @Span()
  async checkExistingScan(
    projectId: string,
    branch?: string,
    options: ExistingScanCheckOptions = {},
  ): Promise<CheckExistingScanResponse> {
    await this.orchestrator.assertProjectScannable(projectId, options.scanType);
    return this.scanStateStore.checkExistingScan(projectId, branch, options);
  }

  async updateScanData(
    request: UpdateScanDataRequest,
  ): Promise<UpdateScanResponse> {
    const scan = await this.scanRepository.findOne({
      where: { id: request.scanId },
    });

    if (!scan) {
      this.logger.error(
        `Failed to update scan data: Scan with id ${request.scanId} not found - metadata: { scanId: ${request.scanId} }`,
      );
      throw new RpcException({
        code: status.NOT_FOUND,
        message: `Scan not found`,
      });
    }

    // Guard: never override a cancelled scan
    if (scan.state === 'cancelled') {
      this.logger.warn(
        `updateScanData: ignoring update for scan ${request.scanId} because it is already cancelled`,
      );
      return { message: 'Scan is cancelled, update ignored', success: true };
    }

    const updatableFields: Partial<
      Record<keyof UpdateScanDataRequest, (value: any) => any>
    > = {
      state: (value) => value,
      startedAt: (value) => (value ? new Date(value) : null),
      language: (value) => value || null,
      startTime: (value) => (value ? new Date(value) : null),
      endTime: (value) => (value ? new Date(value) : null),
      totalLOC: (value) => (typeof value === 'number' ? value : null),
      scanType: (value) => (value ? value.join(',') : null),
      errorMessage: (value) =>
        this.scanUtils.truncateErrorMessage(value ? String(value) : null),
      totalSize: (value) => value || null,
      errorCode: (value) => (typeof value === 'number' ? value : null),
      errorCategory: (value) => (value ? String(value) : null),
    };

    // Guard: if the caller wants to set state to 'failed', check whether
    // containers are still running.  A gRPC timeout on the startScan call can
    // cause file-management-service to believe the scan failed even though the
    // pods were created and are running normally.
    let skipFailedState = false;
    if (request.state === 'failed') {
      const activeContainers = await this.containerRepository.find({
        where: {
          scanId: request.scanId,
          status: In(['running', 'starting', 'pending']),
        },
      });
      if (activeContainers.length > 0) {
        this.logger.warn(
          `updateScanData: ignoring state=failed for scan ${request.scanId} because ${activeContainers.length} container(s) are still active`,
        );
        skipFailedState = true;
      }
    }

    for (const [field, transform] of Object.entries(updatableFields)) {
      const value = request[field as keyof UpdateScanDataRequest];
      if (value !== undefined && value !== null) {
        if (field === 'state' && skipFailedState) continue;
        if (field === 'errorMessage' && skipFailedState) continue;
        (scan as any)[field] = transform(value);
      }
    }

    // If this update carries an errorCode, re-derive errorCategory (and fill
    // errorMessage when absent) so the stored triplet is always consistent.
    if (
      request.errorCode !== undefined &&
      request.errorCode !== null &&
      typeof request.errorCode === 'number'
    ) {
      const derived = normalizeScanFailure({
        errorCode: request.errorCode,
        errorMessage: request.errorMessage || undefined,
      });
      scan.errorCategory = derived.errorCategory ?? null;
      // A structured errorCode is a genuine scanner failure (the spurious
      // gRPC-timeout 'failed' carries no errorCode), so always record its
      // message — including when the state flip was deferred because a
      // container is still active and the field-loop above skipped errorMessage.
      scan.errorMessage = this.scanUtils.truncateErrorMessage(
        derived.errorMessage ?? null,
      );
    }

    await this.scanRepository.save(scan);

    return {
      message: 'Scan updated successfully',
      success: true,
    };
  }
  /**
   * Gets the last scan status for a project.
   * If no scan is found, it returns a default object indicating
   * that the project has never been scanned, without throwing an error.
   *
   * @param scanRequestStatus The request containing the project ID.
   * @returns The last scan status.
   */
  @Span()
  async getLastScanStatus(
    scanRequestStatus: ProjectGetRequest,
  ): Promise<GetLastScanStatusResponse> {
    const scan = await this.scanRepository.findOne({
      // Diff scans are isolated — never surface as the project's "last scan".
      // A graph-only scan (a repository import) is not an AppSec scan either,
      // unless the caller asks for it (`graphOnly`): the graph-only repository
      // analysis reads the project's latest graph-only scan, in any state.
      where: {
        projectId: scanRequestStatus.projectId,
        isDiffScan: false,
        isGraphOnly: scanRequestStatus.graphOnly === true,
      },
      order: { createAt: 'DESC' },
    });

    // No scan found: return a "default" response.
    if (!scan) {
      const defaultResponse: GetLastScanStatusResponse = {
        id: '', // An empty id means there is no real scan.
        state: 'never_scanned', // An explicit state for the frontend.
        projectId: scanRequestStatus.projectId,
        createAt: '', // An empty date.
        scanType: '',
      };
      return defaultResponse;
    }

    // A scan was found: return its information.
    const response: GetLastScanStatusResponse = {
      id: scan.id,
      state: scan.state,
      projectId: scan.projectId,
      createAt: scan.createAt.toISOString(),
      scanType: scan.scanType || '',
    };

    return response;
  }

  /**
   * Create a scan in failed state directly.
   * This is useful for recording scan attempts that failed before they could be fully started.
   *
   * @param data The data for creating a failed scan
   * @returns The response with the created scan or an error
   */
  @Span()
  async createFailedScan(
    data: CreateFailedScanRequest,
  ): Promise<CreateFailedScanResponse> {
    try {
      // Generate a unique identifier for the scan name
      const scanNameId = Date.now().toString(36).substr(-8);

      // Create a new scan entity
      const scan = new Scan();
      scan.projectId = data.projectId;
      scan.state = 'failed';
      scan.name = `Failed-Scan-${scanNameId}`;
      scan.errorMessage = this.scanUtils.truncateErrorMessage(
        data.errorMessage,
      );
      scan.createAt = new Date();
      scan.startTime = new Date();
      scan.endTime = new Date();
      scan.language = [];
      scan.organizationId = data.organizationId;

      // Normalize the error triplet so a scanner sending only an exit code
      // still gets a category + human message, and a wrong category is corrected.
      const normalized = normalizeScanFailure({
        errorCode:
          data.errorCode !== undefined && data.errorCode !== null
            ? data.errorCode
            : undefined,
        errorCategory: data.errorCategory || undefined,
        errorMessage: data.errorMessage || undefined,
      });
      scan.errorCode = normalized.errorCode ?? null;
      scan.errorCategory = normalized.errorCategory ?? null;
      // errorMessage was already set via truncateErrorMessage above; re-apply
      // it now using the normalized value so empty strings get a description.
      scan.errorMessage = this.scanUtils.truncateErrorMessage(
        normalized.errorMessage ?? null,
      );

      // Save the scan in the database
      await this.scanRepository.save(scan);

      return {
        scanId: scan.id,
        state: scan.state,
        success: true,
        message: 'Scan created in failed state',
      };
    } catch (error) {
      this.logger.error(
        `Failed to create failed scan for project ${data.projectId}: ${error}`,
      );
      throw new RpcException('Failed to create failed scan');
    }
  }

  /**
   * Create a scan in completed state directly.
   * This is used for OSV sync when new vulnerabilities are discovered and a policy evaluation is needed.
   * The scan is created as "completed" because no actual scanning is performed - we just need
   * a valid scan record to associate with the policy evaluation.
   *
   * @param data The data for creating a completed scan
   * @returns The response with the created scan ID
   */
  @Span()
  async createCompletedScan(
    data: CreateCompletedScanRequest,
  ): Promise<CreateCompletedScanResponse> {
    try {
      // Generate a unique identifier for the scan name
      const scanNameId = Date.now().toString(36).substr(-8);

      // Create a new scan entity
      const scan = new Scan();
      scan.projectId = data.projectId;
      scan.state = 'completed';
      scan.name = `OSV-Sync-${scanNameId}`;
      scan.scanType = data.reason || 'osv-sync';
      scan.createAt = new Date();
      scan.startTime = new Date();
      scan.endTime = new Date();
      scan.language = [];
      scan.organizationId = data.organizationId;

      // Set branch if provided
      if (data.branch) {
        scan.branch = data.branch;
      }

      // Save the scan in the database
      await this.scanRepository.save(scan);

      this.logger.log(
        `Created completed scan for OSV sync: scanId=${scan.id}, projectId=${data.projectId}, reason=${data.reason}`,
      );

      return {
        success: true,
        message: 'Scan created in completed state for OSV sync',
        scanId: scan.id,
      };
    } catch (error) {
      this.logger.error(
        `Failed to create completed scan for project ${data.projectId}: ${error}`,
      );
      throw new RpcException('Failed to create completed scan');
    }
  }

  /**
   * Creates a new scan in waiting_for_file state.
   *
   * @param data The request data containing the scan information.
   * @returns The response of the create scan request.
   */
  @Span()
  async createScan(data: CreateScanRequest): Promise<CreateScanResponse> {
    // An import scan (import_format set) is created without the
    // orchestrator — no pod, no conflict check, no diff/graph rules — and is
    // typed by import_type, never by vulnerability_types (which holds
    // severities). normaliseCreate refuses before any read or write.
    const isImport = this.importScans.isImportRequest(data);
    const imported = isImport ? this.importScans.normaliseCreate(data) : null;
    // The scanner orchestrator decides first whether this edition
    // runs such a scan at all (the Community Edition refuses every non-import
    // scan here, before anything is read or written).
    if (!isImport) this.orchestrator.assertScanSupported(data);

    // A diff scan must neither be blocked by, nor block, a full scan
    // (they run constantly in the agent loop). Instead it is throttled per
    // project to bound pre-commit abuse (each scan spins up real K8s pods). The
    // throttle is enforced transactionally at insert time (saveDiffScanWithinQuota).
    // An import scan blocks nothing and is blocked by nothing.
    if (!isImport && !data.isDiffScan && !data.graphOnly) {
      await this.checkExistingScan(data.projectId, data.branch, {
        scanType: data.scanType,
      });
    }
    const userId = data.initializerUserId;
    const projectResult = await this.organizationManager.getProjectInformation(
      data.projectId,
    );
    const organizationId = projectResult.organizationId;
    // A container scan's branch is the API caller's free text, and the
    // dashboard shows a linked project on its repository's branches only (an
    // image tag sent as the branch would be saved and never shown). Every
    // container route creates its scan here, so this is where the branch is
    // checked against the linked repository, or defaulted when none is sent;
    // a refusal (INVALID_ARGUMENT) stores nothing. A container IMPORT goes
    // through ResolveScanBranch exactly as a container scan does (its
    // refusals propagate and nothing is stored); every other import type
    // keeps the code-scan rule: its normalised branch, unresolved.
    const isContainer = imported
      ? imported.type === 'container'
      : data.scanType === 'container';
    const requestedBranch = imported ? imported.branch : data.branch;
    const branch = isContainer
      ? await this.containerScanBranches.resolve(
          data.projectId,
          requestedBranch ?? '',
          projectResult.referenceBranch ?? '',
        )
      : requestedBranch;

    let finalScanType = ''; // Use the scanType from the request if provided (for container scans).
    if (imported) {
      // An import scan's type is import_type.
      finalScanType = imported.type;
    } else if (data.scanType) {
      finalScanType = data.scanType;
    } else if (data.scanTypesCsv) {
      // Diff scan: the gateway already computed the effective restricted
      // scanner types (subset of sast/iac/secret, inferred from the changed files
      // ∩ project-enabled), comma-joined. Use them verbatim instead of the
      // project's full set.
      finalScanType = data.scanTypesCsv;
    } else {
      // Otherwise, use project settings for code scans (SAST/IaC/SCA).
      const projectInfo = projectResult as any; // Ensure enabledScanTypes is an array before joining.
      const enabledScanTypes: string[] = projectInfo.enabledScanTypes || [];
      finalScanType = enabledScanTypes.join(',');
    }

    // Carry the gateway-computed minimum-severity set for
    // a diff scan so startScan applies it to every scanner pod it launches.
    // `codingAgent` is the AI coding agent (MCP client) that requested the
    // scan, read back by analysis-reporting for the scan-diff history.
    const metadata: Record<string, string | boolean> = {};
    if (data.isDiffScan && data.vulnerabilityTypes?.length) {
      metadata.diffScanSeverities = data.vulnerabilityTypes.join(',');
    }
    if (data.codingAgent) {
      metadata.codingAgent = data.codingAgent;
    }
    if (imported && imported.type === 'container' && imported.image) {
      // A container import carries its image from CreateScan on —
      // no StartScan field carries it and no reservation runs.
      metadata.imageToScan = imported.image;
    }
    if (imported?.sbom) {
      // An sca import that stored its CycloneDX SBOM (import/<p>/<s>.sbom):
      // StartScan hands it to ImportResults, every terminal move deletes it.
      metadata.importSbom = true;
    }

    // Create scan record in waiting_for_file state
    const scan: Scan = this.scanRepository.create({
      id: data.scanId,
      name: `Scan-${data.scanId.substring(0, 8)}`,
      state: 'waiting_for_file',
      projectId: data.projectId,
      organizationId: organizationId,
      language: [],
      createAt: new Date(),
      initializerUserId: userId,
      scanType: finalScanType,
      totalSize: '0Mo',
      totalLOC: 0,
      private: data.privateScan,
      startTime: new Date(),
      branch: branch || undefined, // Store branch for GitHub/GitLab scans
      isDiffScan: data.isDiffScan || false, // diff scan flag
      isGraphOnly: data.graphOnly || false, // graph-only repository import
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
      // The import columns; `importFormat IS NOT NULL` is the one
      // definition of an import scan.
      ...(imported
        ? { importFormat: imported.format, importTool: imported.tool }
        : {}),
    });

    try {
      if (imported) {
        // An import scan's row is a plain save — no diff quota, no
        // graph-only limits, no pod.
        await this.scanRepository.save(scan);
      } else {
        // The orchestrator writes the row (a diff scan within its
        // per-user quota, a graph-only scan within its limits, else a save).
        await this.orchestrator.saveNewScan(scan);
      }

      // Update project's lastScanSourceType if sourceType is provided
      this.logger.log(
        `[DEBUG] createScan called - metadata: { projectId: ${data.projectId}, sourceType: "${data.sourceType}", scanId: ${data.scanId} }`,
      );
      // Never for a diff scan: it is not the project's last scan (the last-scan
      // reads exclude it), and the update's PROJECT_STATE_CHANGED would make
      // every open home page reload its list and KPI cards.
      if (data.sourceType && !scan.isDiffScan) {
        const validSourceTypes = [
          'manual',
          'cli',
          'github',
          'gitlab',
          'jetbrains',
          'vscode',
        ];
        if (validSourceTypes.includes(data.sourceType)) {
          try {
            const updateRequest: ProjectUpdateRequest = {
              projectId: data.projectId,
              lastScanSourceType: data.sourceType,
              // Required arrays - empty means "no change" on the backend
              sastSeverities: [],
              iacSeverities: [],
              scaSeverities: [],
              containerSeverities: [],
              secretSeverities: [],
              agentCategoriesSast: [],
              agentCategoriesIac: [],
              agentCategoriesCicd: [],
              issueCreationBranches: [],
              notifSeverityThreshold: [],
              notifScannerTypes: [],
              zeroDaySeverityThreshold: [],
            };
            await firstValueFrom(
              this.projectServiceClient.update(updateRequest),
            );
            this.logger.log(
              `Updated project ${data.projectId} lastScanSourceType to ${data.sourceType}`,
            );
          } catch (updateError) {
            // Log but don't fail the scan creation if project update fails
            this.logger.warn(
              `Failed to update project lastScanSourceType - metadata: { projectId: ${data.projectId}, sourceType: ${data.sourceType} }, error: ${updateError}`,
            );
          }
        }
      }

      return {
        success: true,
        message: 'Scan created and waiting for file upload',
      };
    } catch (error) {
      // Preserve typed errors — notably RESOURCE_EXHAUSTED from the per-user
      // diff-scan quota (saveDiffScanWithinQuota) — so the gateway maps them to
      // the right HTTP status (429), not 500. Only wrap unknown errors.
      if (error instanceof RpcException) throw error;
      this.logger.error(
        `Failed to create scan - metadata: { scanId: ${data.scanId} }, error: ${error}`,
      );
      throw new RpcException({
        code: status.INTERNAL,
        message: 'Failed to create scan',
      });
    }
  }

  /**
   * Starts a scan that was previously created and is waiting for file upload.
   * This method orchestrates the entire start process, including file processing,
   * queuing logic, and launching different types of scanners.
   *
   * @param data The request data containing the scan ID and optional image to scan.
   * @returns The response of the start scan request.
   */
  @Span()
  async startScan(data: StartScanRequest): Promise<StartScanResponse> {
    // 1. Retrieve the scan record
    const scan = await this.scanRepository.findOne({
      where: { id: data.scanId },
    });

    if (!scan) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: `Scan not found`,
      });
    }

    // Guard: never start a cancelled scan
    if (scan.state === 'cancelled') {
      this.logger.warn(
        `startScan: ignoring start for scan ${data.scanId} because it is already cancelled`,
      );
      throw new RpcException({
        code: status.FAILED_PRECONDITION,
        message: `Scan ${data.scanId} is cancelled and cannot be started`,
      });
    }

    // An import scan starts without a pod — before the orchestrator,
    // so no image is reserved and no container row is written.
    if (scan.importFormat) return this.importScans.start(scan, data);

    return this.orchestrator.startScan(scan, data);
  }

  /**
   * Cleans up a temporary ZIP file from the local filesystem.
   * This is called after processZipFile extracts the necessary metadata.
   * The file-management-service keeps a separate copy for scanner pods to download.
   *
   * @param zipFilePath The path to the temporary ZIP file to delete.
   */
  private async cleanupTempZipFile(zipFilePath: string): Promise<void> {
    try {
      if (fs.existsSync(zipFilePath)) {
        await fs.promises.unlink(zipFilePath);
        this.logger.log(
          `Successfully cleaned up temporary ZIP file: ${zipFilePath}`,
        );
      }
    } catch (cleanupError) {
      // Log but don't throw - cleanup failure shouldn't block the scan
      this.logger.warn(
        `Failed to cleanup temporary ZIP file ${zipFilePath}: ${cleanupError}`,
      );
    }
  }

  /**
   * Get all scan IDs for a specific project and branch.
   * Used by analysis-reporting-service to filter vulnerabilities by branch.
   *
   * @param data The request data containing the project ID and branch name.
   * @returns A list of scan IDs matching the project and branch.
   */
  @Span()
  async getScanIdsByBranch(
    data: GetScanIdsByBranchRequest,
  ): Promise<GetScanIdsByBranchResponse> {
    const scans = await this.scanRepository.find({
      where: {
        projectId: data.projectId,
        branch: data.branch,
      },
      select: ['id'],
    });

    return {
      scanIds: scans.map((scan) => scan.id),
    };
  }

  /**
   * Get the scan status for multiple projects at once.
   * This method is optimized for performance to support polling from the frontend.
   * Uses a single database query to check all projects.
   *
   * @param data The request containing the list of project IDs to check.
   * @returns A list of project scan status entries indicating if each project has an active scan.
   */
  @Span()
  async getProjectsScanStatus(
    data: GetProjectsScanStatusRequest,
  ): Promise<GetProjectsScanStatusResponse> {
    if (!data.projectIds || data.projectIds.length === 0) {
      return { statuses: [] };
    }

    // Query all active scans for the given project IDs in a single query
    const activeScans = await this.scanRepository
      .createQueryBuilder('scan')
      .select('scan.projectId', 'projectId')
      .where('scan.projectId IN (:...projectIds)', {
        projectIds: data.projectIds,
      })
      .andWhere('scan.state IN (:...states)', {
        states: ['running', 'queued', 'waiting_for_file'],
      })
      // Diff scans are isolated — they must not mark a project as "scanning".
      .andWhere('scan.isDiffScan = :isDiffScan', { isDiffScan: false })
      // A graph-only scan (a repository import) is not an AppSec scan.
      .andWhere('scan.isGraphOnly = :isGraphOnly', { isGraphOnly: false })
      .groupBy('scan.projectId')
      .getRawMany<{ projectId: string }>();

    // Create a Set for O(1) lookup of projects with active scans
    const projectsWithActiveScans = new Set(
      activeScans.map((scan) => scan.projectId),
    );

    // Build the response with status for each requested project
    const statuses: ProjectScanStatusEntry[] = data.projectIds.map(
      (projectId) => ({
        projectId,
        isScanning: projectsWithActiveScans.has(projectId),
      }),
    );

    return { statuses };
  }

  /**
   * Get distinct branches from all scans for a project.
   * This method retrieves all unique branch names from the Scan table,
   * which is more reliable than querying vulnerability detections since
   * scans can complete without finding vulnerabilities.
   *
   * @param data The request containing the project ID.
   * @returns A list of distinct branch names for the project.
   */
  @Span()
  async getProjectBranchesFromScans(
    data: GetProjectBranchesFromScansRequest,
  ): Promise<GetProjectBranchesFromScansResponse> {
    if (!data.projectId) {
      return { branches: [] };
    }

    try {
      // Query distinct branches from the Scan table
      const branches = await this.scanRepository
        .createQueryBuilder('scan')
        .select('DISTINCT scan.branch', 'branch')
        .where('scan.projectId = :projectId', { projectId: data.projectId })
        .andWhere('scan.branch IS NOT NULL')
        .andWhere("scan.branch != ''")
        // Diff scans are isolated — their branch label must not leak.
        .andWhere('scan.isDiffScan = :isDiffScan', { isDiffScan: false })
        .andWhere('scan.isGraphOnly = :isGraphOnly', { isGraphOnly: false })
        .orderBy('scan.branch', 'ASC')
        .getRawMany<{ branch: string }>();

      return {
        branches: branches.map((b) => b.branch),
      };
    } catch (error) {
      this.logger.error(
        `Error retrieving branches for project ${data.projectId}: ${error}`,
      );
      throw new RpcException({
        code: status.INTERNAL,
        message: `Error retrieving project branches`,
      });
    }
  }

  /**
   * Get distinct branches from all scans for a project with pagination and search support.
   * Supports filtering archived branches, default-branch-first ordering, and search.
   *
   * @param data The paginated request for project branches.
   * @returns Paginated list of branches with metadata and total count.
   */
  @Span()
  async getProjectBranchesFromScansPaginated(
    data: GetProjectBranchesFromScansPaginatedRequest,
  ): Promise<GetProjectBranchesFromScansPaginatedResponse> {
    if (!data.projectId) return { branches: [], total: 0 };
    const pageSize = Math.min(Math.max(data.pageSize || 30, 1), 100);
    const page = Math.max(data.page || 1, 1);
    try {
      const base = () =>
        this.scanRepository
          .createQueryBuilder('scan')
          .where('scan.projectId = :projectId', { projectId: data.projectId })
          .andWhere('scan.branch IS NOT NULL')
          .andWhere("scan.branch != ''")
          // Diff scans are isolated — exclude their branches + count.
          .andWhere('scan.isDiffScan = :isDiffScan', { isDiffScan: false })
          // A graph-only scan (a repository import) is not an AppSec scan.
          .andWhere('scan.isGraphOnly = :isGraphOnly', { isGraphOnly: false });
      const applyFilters = (qb: any) => {
        if (data.search)
          // Case-insensitive on both engines: LIKE under MySQL's collation,
          // ILIKE on PostgreSQL.
          qb.andWhere(ilike('scan.branch', ':search').text, {
            search: `%${data.search}%`,
          });
        if (!data.includeArchived && data.archivedNames?.length) {
          qb.andWhere('scan.branch NOT IN (:...archivedNames)', {
            archivedNames: data.archivedNames,
          });
        }
        return qb;
      };
      // GROUP BY, not SELECT DISTINCT: PostgreSQL refuses a DISTINCT whose
      // ORDER BY holds an expression outside the select list (the default
      // branch first); grouped, both engines order by it.
      const pageQb = applyFilters(base())
        .select('scan.branch', 'branch')
        .groupBy('scan.branch')
        .orderBy('CASE WHEN scan.branch = :def THEN 0 ELSE 1 END', 'ASC')
        .setParameter('def', data.defaultBranch || '')
        .addOrderBy('scan.branch', 'ASC')
        .offset((page - 1) * pageSize)
        .limit(pageSize);
      const rows: { branch: string }[] = await pageQb.getRawMany();
      const countQb = applyFilters(base()).select(
        'COUNT(DISTINCT scan.branch)',
        'total',
      );
      const totalRow: { total: string } | undefined = await countQb.getRawOne();
      const total = parseInt(totalRow?.total ?? '0', 10);
      const archivedSet = new Set(data.archivedNames || []);
      return {
        branches: rows.map((r) => ({
          name: r.branch,
          isDefault: r.branch === data.defaultBranch,
          archived: archivedSet.has(r.branch),
        })),
        total,
      };
    } catch (error) {
      this.logger.error(
        `Error paginated branches for project ${data.projectId}: ${error?.message ?? error}`,
      );
      throw new RpcException({
        code: status.INTERNAL,
        message: 'Error retrieving project branches',
      });
    }
  }

  /**
   * Get last scan dates for multiple projects in a single batch request.
   * This method is optimized for performance to support fetching last scan info
   * when listing projects.
   *
   * @param data The request containing the list of project IDs to check.
   * @returns A list of project last scan entries with their dates.
   */
  @Span()
  async getBatchLastScans(data: {
    projectIds: string[];
  }): Promise<{ scans: Array<{ projectId: string; lastScan: string }> }> {
    if (!data.projectIds || data.projectIds.length === 0) {
      return { scans: [] };
    }

    try {
      // Query to get the most recent completed scan for each project
      const lastScans = await this.scanRepository
        .createQueryBuilder('scan')
        .select('scan.projectId', 'projectId')
        .addSelect('MAX(scan.createAt)', 'lastScan')
        .where('scan.projectId IN (:...projectIds)', {
          projectIds: data.projectIds,
        })
        // Every terminal state that ran its scanners. `completed_degraded`
        // is a normal end (an optional scanner failed): left out, the
        // project list would show an older "last scan" than the project page.
        .andWhere('scan.state IN (:...completedStates)', {
          completedStates: ['completed', 'completed_degraded', 'failed'],
        })
        // Diff scans are isolated — excluded from the project's last-scan date.
        .andWhere('scan.isDiffScan = :isDiffScan', { isDiffScan: false })
        .andWhere('scan.isGraphOnly = :isGraphOnly', { isGraphOnly: false })
        .groupBy('scan.projectId')
        .getRawMany<{ projectId: string; lastScan: Date }>();

      // Build a map for O(1) lookup
      const lastScanMap = new Map<string, Date>();
      for (const scan of lastScans) {
        lastScanMap.set(scan.projectId, scan.lastScan);
      }

      // Build the response with last scan for each requested project
      const scans = data.projectIds.map((projectId) => ({
        projectId,
        lastScan: lastScanMap.has(projectId)
          ? lastScanMap.get(projectId)!.toISOString()
          : '',
      }));

      return { scans };
    } catch (error) {
      this.logger.error(`Error getting batch last scans: ${error}`);
      throw new RpcException({
        code: status.INTERNAL,
        message: `Error getting batch last scans`,
      });
    }
  }

  /**
   * The cancel is ONE conditional UPDATE, so concurrent cancels cannot all
   * pass a state check read beforehand. The WHERE carries the whole
   * precondition, the project scope included (a scan of another project
   * matches nothing), and only the call whose UPDATE moved the row deletes
   * the archive.
   */
  @Span()
  async cancelScan(
    scanId: string,
    projectId: string,
  ): Promise<UpdateScanResponse> {
    try {
      const cancelled = await this.scanStateStore.compareAndSetScanState(
        { id: scanId, projectId },
        ['waiting_for_file', 'queued'],
        'cancelled',
        { endTime: new Date() },
      );
      if (!cancelled) {
        // Nothing moved: re-read only to tell the caller why, as before.
        const scan = await this.scanRepository.findOne({
          where: { id: scanId, projectId },
        });
        if (!scan) {
          throw new RpcException({
            code: status.NOT_FOUND,
            message: `Scan ${scanId} not found`,
          });
        }
        throw new RpcException({
          code: status.FAILED_PRECONDITION,
          message: `Scan cannot be cancelled in state: ${scan.state}`,
        });
      }
      // Only the cancel that moved the row gets here. The lifecycle hooks
      // take it from here (`cancel`).
      this.hooks.onScanClosed({ id: scanId }, 'cancelled', 'cancel');
      try {
        await this.fileManagementService.deleteFile(scanId);
      } catch (error) {
        this.logger.warn(
          `File deletion failed for cancelled scan ${scanId} (normal when no archive was uploaded yet): ${error instanceof Error ? error.message : error}`,
        );
      }
      return { success: true, message: 'Scan cancelled successfully' };
    } catch (error) {
      if (error instanceof RpcException) throw error;
      this.logger.error(`Error cancelling scan: ${error}`);
      throw new RpcException({
        code: status.INTERNAL,
        message: `Error cancelling scan`,
      });
    }
  }

  /**
   * Analysis-reporting says a scan's results are final: end the scan if it is
   * held for them. Returns the `finalizeResults` outcome.
   */
  async markScanResultsFinal(scanId: string): Promise<FinalizeResultsOutcome> {
    return this.scanStateManager.finalizeResults(scanId);
  }
}
