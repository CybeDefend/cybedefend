import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import {
  ProjectServiceClient,
  PROJECT_SERVICE_NAME,
  OrganizationServiceClient,
  ORGANIZATION_SERVICE_NAME,
} from '@grpc/global-management/global_management';
import { safeGrpcCall } from '@grpc/wrapper-grpc.module';
import { GetMainStatisticsResponse } from '@grpc/analysis-reporting/result';
import { OrganizationStatisticsRepository } from './organization-statistics.repository';
import { OrganizationStatisticsEnqueuer } from './organization-statistics.enqueuer';
import { ORG_STATS_TRAILING_MS } from './organization-statistics-debounce';

// The 16 KPI fields persisted in the JSON column (everything in
// GetMainStatisticsResponse except the echoed projectIds).
export const ORG_STAT_KEYS = [
  'criticalRiskProjects',
  'criticalRiskProjectsInLast7Days',
  'highRiskProjects',
  'highRiskProjectsInLast7Days',
  'solvedIssues',
  'solvedIssuesInLast7Days',
  'newIssues',
  'newIssuesInLast7Days',
  'criticalIssues',
  'highIssues',
  'mediumIssues',
  'lowIssues',
  'agentAnalysesCount',
  'agentAutofixCount',
  'agentTriageCount',
  'agentFalsePositiveCount',
] as const;

/** Pure: project a getMainStatistics DTO into the persisted KPI record. */
export function statsRecordFromMainStatistics(
  dto: GetMainStatisticsResponse | null | undefined,
): Record<string, number> {
  const src = dto as unknown as Record<string, number> | null | undefined;
  const out: Record<string, number> = {};
  for (const k of ORG_STAT_KEYS) {
    out[k] = src?.[k] ?? 0;
  }
  return out;
}

/** Pure: project a persisted KPI record back into the gRPC response shape. */
export function mainStatisticsFromRecord(
  stats: Record<string, number> | null,
): GetMainStatisticsResponse {
  const out = { projectIds: [] } as unknown as GetMainStatisticsResponse;
  const sink = out as unknown as Record<string, number>;
  for (const k of ORG_STAT_KEYS) {
    sink[k] = stats?.[k] ?? 0;
  }
  return out;
}

/**
 * Owns the org-statistics persistence + the debounce trigger. Deliberately does
 * NOT depend on ResultService (which would create a module cycle): the actual
 * org-wide aggregation (getMainStatistics) is run by the caller — the
 * recompute processor and the read-path controller — both of which already
 * have ResultService. This service only resolves IDs, marks dirty, and reads/
 * writes the persisted row.
 */
@Injectable()
export class OrganizationStatisticsService implements OnModuleInit {
  private readonly logger = new Logger(OrganizationStatisticsService.name);
  private projectClient!: ProjectServiceClient;
  private orgClient!: OrganizationServiceClient;
  // projectId -> organizationId is immutable, so cache it forever (per replica).
  private readonly projectOrgCache = new Map<string, string>();

  constructor(
    @Inject('GLOBAL_MANAGEMENT_SERVICE')
    private readonly gmClient: ClientGrpc,
    private readonly repo: OrganizationStatisticsRepository,
    private readonly enqueuer: OrganizationStatisticsEnqueuer,
  ) {}

  onModuleInit() {
    this.projectClient =
      this.gmClient.getService<ProjectServiceClient>(PROJECT_SERVICE_NAME);
    this.orgClient = this.gmClient.getService<OrganizationServiceClient>(
      ORGANIZATION_SERVICE_NAME,
    );
  }

  /** Trigger: a project changed → mark its org dirty. Best-effort. */
  async markDirtyForProject(projectId: string): Promise<void> {
    try {
      const organizationId = await this.resolveOrgId(projectId);
      if (organizationId) await this.markDirty(organizationId);
    } catch (err: any) {
      this.logger.warn(
        `org-stats markDirtyForProject failed project=${projectId}: ${String(
          err?.message ?? err,
        )}`,
      );
    }
  }

  /** Mark an org dirty + schedule the (debounced) drain. Best-effort. */
  async markDirty(organizationId: string): Promise<void> {
    try {
      await this.repo.markDirty(organizationId);
      await this.enqueuer.enqueueDrain(organizationId, ORG_STATS_TRAILING_MS);
    } catch (err: any) {
      this.logger.warn(
        `org-stats markDirty failed org=${organizationId}: ${String(
          err?.message ?? err,
        )}`,
      );
    }
  }

  /**
   * Data purge only: mark an org dirty if it still has a statistics row, and
   * schedule the drain only then. Never inserts a row. Throws; the caller
   * decides (the purge logs it).
   */
  async markDirtyIfPresent(organizationId: string): Promise<void> {
    if (await this.repo.markDirtyIfPresent(organizationId)) {
      await this.enqueuer.enqueueDrain(organizationId, ORG_STATS_TRAILING_MS);
    }
  }

  /** System-scope project IDs of the org (for the org-wide aggregation). */
  async resolveProjectIds(organizationId: string): Promise<string[]> {
    const res = await safeGrpcCall(
      this.projectClient.getOrganizationProjectIds({ organizationId }),
    );
    return res?.projectIds ?? [];
  }

  /** Read the debounce timings + DB clock (used by the drain processor). */
  readTimings(organizationId: string) {
    return this.repo.readTimings(organizationId);
  }

  /** Persist a freshly computed payload; returns whether still dirty. */
  finishCompute(
    organizationId: string,
    stats: Record<string, number>,
    computeStartMs: number,
  ) {
    return this.repo.finishCompute(organizationId, stats, computeStartMs);
  }

  saveInitial(organizationId: string, stats: Record<string, number>) {
    return this.repo.saveInitial(organizationId, stats);
  }

  /** Read the persisted payload, or null when the org has never been computed. */
  async readPersisted(
    organizationId: string,
  ): Promise<GetMainStatisticsResponse | null> {
    const row = await this.repo.findByOrgId(organizationId);
    return row?.stats ? mainStatisticsFromRecord(row.stats) : null;
  }

  private async resolveOrgId(projectId: string): Promise<string | null> {
    const cached = this.projectOrgCache.get(projectId);
    if (cached) return cached;
    const res = await safeGrpcCall(
      this.orgClient.getOrganizationIdByProjectId({ projectId }),
    );
    const organizationId = res?.organizationId || null;
    if (organizationId) this.projectOrgCache.set(projectId, organizationId);
    return organizationId;
  }
}
