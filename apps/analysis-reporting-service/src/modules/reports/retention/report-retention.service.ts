import { Inject, Injectable } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, Not, Repository } from 'typeorm';
import {
  AnalysisReportingEntitlementsPort,
  ENTITLEMENTS_PORT,
} from 'src/edition/ports/entitlements.port';
import { GeneratedReport } from 'src/entities/generated-report.entity';
import { AggregatedReport } from 'src/entities/aggregated-report.entity';
import { ProjectOrgResolver } from 'src/core/realtime/project-org-resolver.service';
import { ReportUploadService } from '../shared/report-upload.service';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Derives a report's retention window from the org's billing plan and
 * purges expired reports (storage object then DB row).
 *
 * `expiresAt` is computed once at creation: `now + reportRetentionDays`.
 *  - retentionDays < 0  → NULL (unlimited, e.g. enterprise if configured so)
 *  - entitlements unavailable → NULL (fail-open: never wrongly purge a report)
 */
@Injectable()
export class ReportRetentionService {
  constructor(
    @Inject(ENTITLEMENTS_PORT)
    private readonly entitlements: AnalysisReportingEntitlementsPort,
    private readonly projectOrgResolver: ProjectOrgResolver,
    @InjectRepository(GeneratedReport)
    private readonly generatedRepo: Repository<GeneratedReport>,
    @InjectRepository(AggregatedReport)
    private readonly aggregatedRepo: Repository<AggregatedReport>,
    private readonly reportUpload: ReportUploadService,
    private readonly logger: Logger,
  ) {}

  /**
   * Plan-derived report retention in days, or `null` when entitlements cannot
   * be read (billing down). Callers treat `null` as "do not set an expiry".
   */
  async resolveRetentionDays(orgId: string): Promise<number | null> {
    try {
      const entitlements = await this.entitlements.getEntitlements(orgId);
      const days = entitlements.reportRetentionDays;
      // Guard against NaN (typeof NaN === 'number'): treat as unavailable (null,
      // fail-open keep) rather than producing an Invalid Date in computeExpiresAt.
      return typeof days === 'number' && Number.isFinite(days) ? days : null;
    } catch (err) {
      this.logger.warn(
        `[retention] getEntitlements(${orgId}) failed, keeping report unbounded: ${(err as Error).message}`,
      );
      return null;
    }
  }

  /** Pure: turn a retentionDays value into an absolute expiry instant. */
  computeExpiresAt(retentionDays: number | null, nowMs: number): Date | null {
    if (retentionDays === null) return null; // entitlements unavailable
    // <= 0 → never expire. -1 is the documented "unlimited" sentinel; a stray 0
    // (e.g. a nullable per-org override edited to 0) must be fail-SAFE (keep),
    // never fail-dangerous (nowMs + 0 = now → the periodic purge would delete a
    // freshly-generated report). Mirrors ReportQuotaService's `max <= 0` guard.
    if (retentionDays <= 0) return null;
    return new Date(nowMs + retentionDays * DAY_MS);
  }

  async computeExpiresAtForOrg(
    orgId: string | null,
    nowMs: number = Date.now(),
  ): Promise<Date | null> {
    if (!orgId) return null;
    const days = await this.resolveRetentionDays(orgId);
    return this.computeExpiresAt(days, nowMs);
  }

  /**
   * Resolve the project's org and compute its report expiry in one call, so the
   * per-project enqueue path can persist both `organizationId` and `expiresAt`.
   */
  async computeExpiresAtForProject(
    projectId: string,
    nowMs: number = Date.now(),
  ): Promise<{ organizationId: string | null; expiresAt: Date | null }> {
    const organizationId =
      await this.projectOrgResolver.resolveOrgId(projectId);
    const expiresAt = await this.computeExpiresAtForOrg(organizationId, nowMs);
    return { organizationId, expiresAt };
  }

  /**
   * Purge every report whose `expiresAt` is in the past: delete the stored object
   * FIRST, then the DB row. If the object delete fails the row is kept so the
   * next tick retries — we never leave a dangling object that nothing references
   * (the row stays as the pointer). Rows with NULL `expiresAt` are never matched
   * by `LessThan`, so unlimited/legacy reports are safe.
   */
  async purgeExpired(opts?: {
    now?: Date;
    batchSize?: number;
  }): Promise<{ generated: number; aggregated: number }> {
    const now = opts?.now ?? new Date();
    const batchSize = opts?.batchSize ?? 500;

    const generated = await this.purgeRows(
      this.generatedRepo,
      now,
      batchSize,
      'generated',
    );
    const aggregated = await this.purgeRows(
      this.aggregatedRepo,
      now,
      batchSize,
      'aggregated',
    );
    return { generated, aggregated };
  }

  /**
   * Flip `queued` rows older than `maxAgeMs` (default 1h, aligned with the
   * async-task TTL) to `failed`. A zombie queued row — whose worker died before
   * settling it — would otherwise hold a quota slot forever and show as
   * "generating" in the stored-report list. `failed` rows free the slot and are
   * themselves purged once expired.
   */
  async failStaleQueued(opts?: {
    now?: Date;
    maxAgeMs?: number;
  }): Promise<{ generated: number; aggregated: number }> {
    const now = opts?.now ?? new Date();
    const cutoff = new Date(now.getTime() - (opts?.maxAgeMs ?? 60 * 60 * 1000));
    const patch = { status: 'failed', error: 'Report generation timed out' };
    const [generated, aggregated] = await Promise.all([
      this.generatedRepo.update(
        { status: 'queued', createdAt: LessThan(cutoff) } as any,
        patch as any,
      ),
      this.aggregatedRepo.update(
        { status: 'queued', createdAt: LessThan(cutoff) } as any,
        patch as any,
      ),
    ]);
    return {
      generated: generated.affected ?? 0,
      aggregated: aggregated.affected ?? 0,
    };
  }

  private async purgeRows(
    repo: Repository<GeneratedReport> | Repository<AggregatedReport>,
    now: Date,
    batchSize: number,
    label: string,
  ): Promise<number> {
    let deleted = 0;
    // Ids that failed to purge in THIS invocation. They are excluded from
    // subsequent fetches so a single permanently-failing ("poison") row can
    // never be re-fetched forever, nor fill the batch and starve the rest of
    // the expired set. Each iteration strictly shrinks the
    // {expired ∧ not-yet-failed} set — every fetched row is either deleted or
    // quarantined here — so the loop always terminates.
    const failedIds = new Set<string>();
    for (;;) {
      const where: Record<string, unknown> = { expiresAt: LessThan(now) };
      if (failedIds.size > 0) where.id = Not(In([...failedIds]));
      const rows: Array<{ id: string; objectPath: string | null }> = (await (
        repo as Repository<any>
      ).find({
        where,
        take: batchSize,
        order: { id: 'ASC' },
      })) as any;
      if (rows.length === 0) break;

      for (const row of rows) {
        try {
          if (row.objectPath) {
            // tenant segment of reports/<tenant>/<id> — projectId for
            // per-project reports, organizationId for aggregated ones.
            const tenant = row.objectPath.split('/')[1] ?? '';
            await this.reportUpload.deleteReport(row.objectPath, tenant);
          }
          await (repo as Repository<any>).delete({ id: row.id });
          deleted += 1;
        } catch (err) {
          // Keep the row (object stays referenced) but quarantine it for the
          // rest of this run so it can't block progress on the other rows; a
          // future cron tick retries it.
          failedIds.add(row.id);
          this.logger.warn(
            `[retention] failed to purge ${label} report ${row.id}, keeping for retry: ${(err as Error).message}`,
          );
        }
      }
    }
    if (deleted > 0) {
      this.logger.log(
        `[retention] purged ${deleted} expired ${label} report(s)`,
      );
    }
    return deleted;
  }
}
