import { Inject, Injectable, Optional } from '@nestjs/common';
import type Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { ScanQueueService } from '../../scan-queue/scan-queue.service';
import { Logger } from 'nestjs-pino';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, LessThanOrEqual, MoreThan, Repository } from 'typeorm';
import { monotonicFactory } from 'ulid';
import {
  AnalysisReportingEntitlementsPort,
  ENTITLEMENTS_PORT,
} from 'src/edition/ports/entitlements.port';
import { GeneratedReport } from 'src/entities/generated-report.entity';
import { AggregatedReport } from 'src/entities/aggregated-report.entity';
import { ProjectOrgResolver } from 'src/core/realtime/project-org-resolver.service';

/**
 * Reports of one organization that may wait or render at the same time,
 * across both report tables. The report workers are shared by every
 * organization of the instance: without this bound, one organization could
 * fill the queue and delay everyone else's reports. Tunable with
 * REPORTS_MAX_IN_FLIGHT_PER_ORG (a positive integer; anything else keeps the
 * default).
 */
export const DEFAULT_MAX_IN_FLIGHT_REPORTS_PER_ORG = 3;

export function maxInFlightReportsPerOrg(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = Number(env.REPORTS_MAX_IN_FLIGHT_PER_ORG);
  return Number.isInteger(raw) && raw > 0
    ? raw
    : DEFAULT_MAX_IN_FLIGHT_REPORTS_PER_ORG;
}

import { REPORT_STALE_AFTER_MS } from './stale-report-sweep';

export { REPORT_STALE_AFTER_MS };

/** Time-ordered report ids, increasing within this process. */
const nextReportId = monotonicFactory();

/** What the admission lock needs from ScanQueueService. */
export interface RedisSource {
  getRedisClient(): Promise<Redis>;
}

/** How long one admission may hold its organization's lock. */
const ADMISSION_LOCK_TTL_MS = 5_000;
/** How long a request waits for the lock before admitting by rank alone. */
const ADMISSION_LOCK_WAIT_MS = 3_000;
const RELEASE_LOCK = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0`;

/** A report row holds a stored-report slot from the moment it is queued. */
const SLOT_STATUSES = ['queued', 'ready'];

/**
 * Fair-usage quota on the number of stored reports per organization.
 *
 * The count is org-scoped over BOTH report tables: `queued` (waiting or
 * rendering) and `ready` non-expired rows consume a slot, so jobs not yet
 * finished count as well (failed never block, expired ones already freed
 * their slot). `maxStoredReports` comes from the entitlements port:
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
    // The instance's Redis, for the per-organization admission lock.
    @Optional()
    @Inject(ScanQueueService)
    private readonly redisSource?: RedisSource,
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

  /**
   * Count the org's non-expired `queued` and `ready` reports across both
   * tables.
   */
  async countStoredForOrg(
    orgId: string,
    now: Date = new Date(),
  ): Promise<number> {
    const generatedWhere = [
      { organizationId: orgId, status: In(SLOT_STATUSES), expiresAt: IsNull() },
      {
        organizationId: orgId,
        status: In(SLOT_STATUSES),
        expiresAt: MoreThan(now),
      },
    ];
    const aggregatedWhere = [
      { organizationId: orgId, status: In(SLOT_STATUSES), expiresAt: IsNull() },
      {
        organizationId: orgId,
        status: In(SLOT_STATUSES),
        expiresAt: MoreThan(now),
      },
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

  /**
   * Reports of the org still waiting or rendering, across both tables. A
   * queued row older than REPORT_STALE_AFTER_MS no longer counts: its job
   * was lost (the stale sweep settles it), and it must not block the org's
   * reports until then. `upToId` counts only the rows ranked up to that id
   * (report ids are ULIDs: they sort by creation time in both tables).
   */
  async countInFlightForOrg(
    orgId: string,
    opts: { upToId?: string; now?: Date } = {},
  ): Promise<number> {
    const since = new Date(
      (opts.now ?? new Date()).getTime() - REPORT_STALE_AFTER_MS,
    );
    const where = {
      organizationId: orgId,
      status: 'queued',
      createdAt: MoreThan(since),
      ...(opts.upToId ? { id: LessThanOrEqual(opts.upToId) } : {}),
    };
    const [generated, aggregated] = await Promise.all([
      this.generatedRepo.count({ where: where as never }),
      this.aggregatedRepo.count({ where: where as never }),
    ]);
    return generated + aggregated;
  }

  /**
   * Insert a queued report row under the org's in-flight cap, and return
   * its id.
   *
   * The id (a ULID, so time-ordered) is made right before `insert` saves the
   * row; `remove` deletes it again. The org's admissions run one at a time
   * (lockOrg). Refused early when the org is already at the cap. After the
   * insert the request is admitted when its row is among the first `cap`
   * in-flight rows of the org in id order: under the lock that is exactly
   * the first `cap` requests of a burst; without it, of requests that race
   * the earliest ones are kept, so a burst is never refused as a whole. A
   * refused request leaves no row behind and gets RESOURCE_EXHAUSTED. No
   * org: no cap (nothing to group by).
   */
  async admitQueuedReport(
    orgId: string | null,
    insert: (reportId: string) => Promise<void>,
    remove: (reportId: string) => Promise<void>,
  ): Promise<string> {
    if (!orgId) {
      const reportId = nextReportId();
      await insert(reportId);
      return reportId;
    }
    const release = await this.lockOrg(orgId);
    try {
      return await this.admitUnderCap(orgId, insert, remove);
    } finally {
      await release();
    }
  }

  private async admitUnderCap(
    orgId: string,
    insert: (reportId: string) => Promise<void>,
    remove: (reportId: string) => Promise<void>,
  ): Promise<string> {
    const cap = maxInFlightReportsPerOrg();
    if ((await this.countInFlightForOrg(orgId)) >= cap) {
      throw this.inFlightRefusal(cap);
    }
    const reportId = nextReportId();
    await insert(reportId);
    let rank: number;
    try {
      rank = await this.countInFlightForOrg(orgId, { upToId: reportId });
    } catch (err) {
      await this.removeQuietly(() => remove(reportId));
      throw err;
    }
    if (rank > cap) {
      await this.removeQuietly(() => remove(reportId));
      throw this.inFlightRefusal(cap);
    }
    return reportId;
  }

  /**
   * Serialize the admissions of one organization on the instance's Redis, so
   * the count and the insert are one step and exactly `cap` requests of a
   * burst are admitted. The lock holds no database connection while waiting.
   * Without Redis, or when the lock is not granted in time, the admission
   * still runs, by rank alone. Returns the release function.
   */
  private async lockOrg(orgId: string): Promise<() => Promise<void>> {
    const none = async () => undefined;
    if (!this.redisSource) return none;
    let redis: Redis;
    try {
      redis = await this.redisSource.getRedisClient();
    } catch {
      return none;
    }
    const key = `reports:admission:${orgId}`;
    const token = randomUUID();
    const deadline = Date.now() + ADMISSION_LOCK_WAIT_MS;
    try {
      for (;;) {
        const ok = await redis.set(
          key,
          token,
          'PX',
          ADMISSION_LOCK_TTL_MS,
          'NX',
        );
        if (ok === 'OK') break;
        if (Date.now() >= deadline) return none;
        await new Promise((r) => setTimeout(r, 10 + Math.random() * 15));
      }
    } catch {
      return none;
    }
    return async () => {
      try {
        await redis.eval(RELEASE_LOCK, 1, key, token);
      } catch {
        // The lock expires on its own.
      }
    };
  }

  private inFlightRefusal(cap: number): RpcException {
    return new RpcException({
      code: status.RESOURCE_EXHAUSTED,
      message: `Too many reports are being generated for this organization (at most ${cap} at a time). Try again once one of them is ready.`,
    });
  }

  private async removeQuietly(remove: () => Promise<void>): Promise<void> {
    try {
      await remove();
    } catch (err) {
      this.logger.warn(
        `[quota] could not remove a refused queued report: ${(err as Error).message}`,
      );
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
