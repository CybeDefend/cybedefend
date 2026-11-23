import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { InjectDataSource } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { ident, sql } from '@cybedefend/db-dialect';
import { firstValueFrom } from 'rxjs';

import { QUEUE_NAMES } from '../scan-queue/queue-names';

import {
  PROJECT_SERVICE_NAME,
  ProjectServiceClient,
} from '@grpc/global-management/global_management';

/**
 * Pushes the persisted CybeRisk score to global-management, where it
 * is denormalized onto `project.cyber_risk_score` and used purely as the SQL
 * sort key for the organization project list (ORDER BY ... LIMIT).
 *
 * Both entry points are BEST-EFFORT: a push failure must never affect the
 * authoritative score, which is computed and stored here in analysis-reporting
 * (`project_cyber_risk`). global-management treats the copy as a sort key only
 * and never displays it, so brief staleness is harmless.
 *
 *  - pushScore(): called by the recompute processor after each recompute, so
 *    the sort key tracks the score over time.
 *  - onApplicationBootstrap(): one backfill pass pushing every persisted score,
 *    so the sort key is correct on first deploy and for projects that won't
 *    recompute soon. Worker-only (provided in WorkerModule, like
 *    CyberiskStartupBackfillService). Every booting worker ran
 *    it, several at once on a rollout or a scale-up; one runs it now, under a
 *    Redis lock (SET NX PX, released with its token).
 */
@Injectable()
export class ProjectScoreSyncService
  implements OnModuleInit, OnApplicationBootstrap
{
  private readonly logger = new Logger(ProjectScoreSyncService.name);
  private projectClient?: ProjectServiceClient;

  // Bound the boot backfill push so a first-deploy run of thousands of projects
  // doesn't build one oversized gRPC message.
  private static readonly BACKFILL_CHUNK = 500;

  /** The lock one booting worker holds while it runs the backfill. */
  static readonly BACKFILL_LOCK_KEY = 'cyberisk:score-sync:backfill-lock';

  /**
   * How long the lock outlives a worker that died holding it. The backfill
   * takes seconds (one GM call per 500 scores); a worker booting within the
   * TTL of a dead holder skips it, and the per-recompute pushes keep the sort
   * key moving meanwhile.
   */
  static readonly BACKFILL_LOCK_TTL_MS = 5 * 60_000;

  /**
   * Deletes KEYS[1] only while it still holds ARGV[1], the token of the worker
   * releasing it: a worker whose TTL ran out never deletes the lock another one
   * has taken since (same compare-and-delete as the detection creation lock).
   */
  static readonly BACKFILL_LOCK_RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

  constructor(
    @Inject('GLOBAL_MANAGEMENT_SERVICE') private readonly gm: ClientGrpc,
    @InjectDataSource() private readonly dataSource: DataSource,
    // The BullMQ connection of the worker, for the backfill lock. Optional:
    // without a queue the backfill runs unlocked, as it always did.
    @Optional()
    @InjectQueue(QUEUE_NAMES.CYBERISK_RECOMPUTE)
    private readonly queue?: Queue,
  ) {}

  onModuleInit(): void {
    try {
      this.projectClient =
        this.gm.getService<ProjectServiceClient>(PROJECT_SERVICE_NAME);
    } catch (err: any) {
      // Client resolution must never crash the worker; pushes become no-ops.
      this.logger.warn(
        `Failed to resolve global-management ProjectService client: ${String(
          err?.message ?? err,
        )}`,
      );
    }
  }

  /** Best-effort single-score push. Never throws. */
  async pushScore(projectId: string, score: number): Promise<void> {
    if (!projectId) return;
    await this.pushScores([{ projectId, score }]);
  }

  /** Best-effort batch push. Never throws. */
  async pushScores(
    items: Array<{ projectId: string; score: number }>,
  ): Promise<void> {
    if (!items.length || !this.projectClient) return;
    try {
      await firstValueFrom(
        this.projectClient.setProjectCyberRiskScores({ items }),
      );
    } catch (err: any) {
      this.logger.warn(
        `Failed to push ${items.length} CybeRisk score(s) to global-management: ${String(
          err?.message ?? err,
        )}`,
      );
    }
  }

  /**
   * Worker-boot backfill: push every persisted score so global-management's
   * denormalized sort key is correct even for projects that won't recompute
   * soon. Best-effort, chunked, and never crashes the worker.
   */
  async onApplicationBootstrap(): Promise<void> {
    const lock = await this.acquireBackfillLock();
    if (lock === 'held') {
      this.logger.log(
        'CybeRisk score sync backfill: another worker is running it — skip',
      );
      return;
    }
    try {
      await this.backfill();
    } finally {
      if (lock) await this.releaseBackfillLock(lock.redis, lock.token);
    }
  }

  private async backfill(): Promise<void> {
    try {
      // Quoted alias: PostgreSQL folds a bare projectId to lower case.
      const q = sql`SELECT project_id AS ${ident('projectId')}, score FROM project_cyber_risk`;
      const rows: Array<{ projectId: string; score: number }> =
        await this.dataSource.query(q.text, q.params);
      if (!rows || rows.length === 0) {
        this.logger.log('CybeRisk score sync backfill: 0 rows — skip');
        return;
      }
      const CHUNK = ProjectScoreSyncService.BACKFILL_CHUNK;
      for (let i = 0; i < rows.length; i += CHUNK) {
        await this.pushScores(
          rows.slice(i, i + CHUNK).map((r) => ({
            projectId: r.projectId,
            score: Number(r.score) || 0,
          })),
        );
      }
      this.logger.log(
        `CybeRisk score sync backfill: pushed ${rows.length} score(s) to global-management`,
      );
    } catch (err: any) {
      // A backfill failure must never crash the worker — log and move on.
      this.logger.warn(
        `CybeRisk score sync backfill skipped due to error: ${String(
          err?.message ?? err,
        )}`,
      );
    }
  }

  /**
   * The backfill lock: its token when taken, 'held' when another worker holds
   * it, null when there is no lock to take, in which case the backfill runs
   * unlocked as before: no queue, or the lock command failed (an error
   * answered by Redis: READONLY, OOM, NOAUTH...).
   *
   * An unreachable Redis is not a failure here: the BullMQ connection retries
   * forever and queues its commands (`maxRetriesPerRequest: null`), so
   * `queue.client` and the SET wait for Redis to be ready. The boot of the
   * worker (its metrics endpoint listens after onApplicationBootstrap) waits
   * with them, which the queues it consumes would do anyway.
   */
  private async acquireBackfillLock(): Promise<
    { redis: Redis; token: string } | 'held' | null
  > {
    if (!this.queue) return null;
    try {
      // BullMQ narrows `queue.client` to its own interface; the runtime client
      // is ioredis (same cast as CyberiskRecomputeEnqueuer).
      const redis = (await this.queue.client) as unknown as Redis;
      const token = randomUUID();
      const taken = await redis.set(
        ProjectScoreSyncService.BACKFILL_LOCK_KEY,
        token,
        'PX',
        ProjectScoreSyncService.BACKFILL_LOCK_TTL_MS,
        'NX',
      );
      return taken === 'OK' ? { redis, token } : 'held';
    } catch (err: any) {
      this.logger.warn(
        `CybeRisk score sync backfill lock unavailable, running unlocked: ${String(
          err?.message ?? err,
        )}`,
      );
      return null;
    }
  }

  private async releaseBackfillLock(
    redis: Redis,
    token: string,
  ): Promise<void> {
    try {
      const deleted = await redis.eval(
        ProjectScoreSyncService.BACKFILL_LOCK_RELEASE_SCRIPT,
        1,
        ProjectScoreSyncService.BACKFILL_LOCK_KEY,
        token,
      );
      if (Number(deleted) !== 1) {
        this.logger.warn(
          'CybeRisk score sync backfill outlived its lock: another worker may have run it too',
        );
      }
    } catch (err: any) {
      // The TTL frees it anyway.
      this.logger.warn(
        `CybeRisk score sync backfill lock not released: ${String(
          err?.message ?? err,
        )}`,
      );
    }
  }
}
