import { Inject, Injectable } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, MoreThan, Repository } from 'typeorm';
import {
  AnalysisReportingEntitlementsPort,
  ENTITLEMENTS_PORT,
} from 'src/edition/ports/entitlements.port';
import { GeneratedReport } from 'src/entities/generated-report.entity';
import { AggregatedReport } from 'src/entities/aggregated-report.entity';
import { ProjectOrgResolver } from 'src/core/realtime/project-org-resolver.service';

/**
 * Fair-usage quota on the number of stored reports per organization.
 *
 * The count is org-scoped over BOTH report tables: only `ready`, non-expired
 * rows consume a slot (queued/failed never block, expired ones already freed
 * their slot). `maxStoredReports` comes from billing entitlements:
 *  - `-1` → unlimited (skip).
 *  - entitlements unavailable → fail-open (allow): a rare billing outage must
 *    not block a human-triggered report generation; the quota is a soft
 *    fair-usage guard, not a security control. The DB remains the source of
 *    truth so the count self-heals on the next attempt.
 */
@Injectable()
export class ReportQuotaService {
  constructor(
    @Inject(ENTITLEMENTS_PORT)
    private readonly entitlements: AnalysisReportingEntitlementsPort,
    @InjectRepository(GeneratedReport)
    private readonly generatedRepo: Repository<GeneratedReport>,
    @InjectRepository(AggregatedReport)
    private readonly aggregatedRepo: Repository<AggregatedReport>,
    private readonly projectOrgResolver: ProjectOrgResolver,
    private readonly logger: Logger,
  ) {}

  private async resolveMaxStoredReports(orgId: string): Promise<number | null> {
    try {
      const entitlements = await this.entitlements.getEntitlements(orgId);
      const max = entitlements.maxStoredReports;
      // Guard against NaN (typeof NaN === 'number'): treat it as unavailable
      // (fail-open) rather than letting `count >= NaN` silently pass.
      return typeof max === 'number' && Number.isFinite(max) ? max : null;
    } catch (err) {
      this.logger.warn(
        `[quota] getEntitlements(${orgId}) failed, allowing report (fail-open): ${(err as Error).message}`,
      );
      return null;
    }
  }

  /** Count `ready`, non-expired reports owned by the org across both tables. */
  async countStoredForOrg(
    orgId: string,
    now: Date = new Date(),
  ): Promise<number> {
    const generatedWhere = [
      { organizationId: orgId, status: 'ready', expiresAt: IsNull() },
      { organizationId: orgId, status: 'ready', expiresAt: MoreThan(now) },
    ];
    const aggregatedWhere = [
      { organizationId: orgId, status: 'ready', expiresAt: IsNull() },
      { organizationId: orgId, status: 'ready', expiresAt: MoreThan(now) },
    ];
    const [generated, aggregated] = await Promise.all([
      this.generatedRepo.count({ where: generatedWhere as any }),
      this.aggregatedRepo.count({ where: aggregatedWhere as any }),
    ]);
    return generated + aggregated;
  }

  /**
   * Throw RESOURCE_EXHAUSTED if the org is already at/over its stored-report
   * quota. No-op for unlimited plans, null org, or when entitlements can't be
   * read (fail-open).
   */
  async assertWithinQuotaForOrg(orgId: string | null): Promise<void> {
    if (!orgId) return;
    const max = await this.resolveMaxStoredReports(orgId);
    // null = billing unavailable (fail-open); <0 = unlimited. A literal 0 is
    // treated as "not enforced" too: no plan produces 0 (the floor is 500) and
    // the nullable per-org override has no producer setting it, so a stray 0
    // must not silently block ALL report generation (count >= 0 is always true).
    if (max === null || max <= 0) return;
    const count = await this.countStoredForOrg(orgId);
    if (count >= max) {
      throw new RpcException({
        code: status.RESOURCE_EXHAUSTED,
        message: `Report storage limit reached (${count}/${max}). Delete old reports or upgrade your plan.`,
      });
    }
  }

  async assertWithinQuotaForProject(projectId: string): Promise<void> {
    const orgId = await this.projectOrgResolver.resolveOrgId(projectId);
    await this.assertWithinQuotaForOrg(orgId);
  }

  /**
   * The org-wide shared usage shown in the stored-reports banner.
   * `used` is the same count enforcement uses (project + org/team/batch reports
   * for the org); `limit` is the plan's `maxStoredReports` (-1 = unlimited /
   * unknown when billing is unavailable). Project and org reports therefore
   * report the SAME shared pool.
   */
  async getUsageForOrg(
    orgId: string,
  ): Promise<{ used: number; limit: number }> {
    const [used, max] = await Promise.all([
      this.countStoredForOrg(orgId),
      this.resolveMaxStoredReports(orgId),
    ]);
    return { used, limit: max ?? -1 };
  }

  /** Same shared usage, resolved from a project's owning org. */
  async getUsageForProject(
    projectId: string,
  ): Promise<{ used: number; limit: number }> {
    const orgId = await this.projectOrgResolver.resolveOrgId(projectId);
    if (!orgId) return { used: 0, limit: -1 };
    return this.getUsageForOrg(orgId);
  }
}
