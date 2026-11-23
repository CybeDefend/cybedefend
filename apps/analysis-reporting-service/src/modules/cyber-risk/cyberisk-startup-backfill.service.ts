import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ident, sql } from '@cybedefend/db-dialect';

import { CyberiskRecomputeEnqueuer } from './cyberisk-recompute.enqueuer';

/**
 * Self-healing startup backfill for CybeRisk scores.
 *
 * Runs in the WORKER process only (wired in worker.module.ts, NOT in
 * CyberRiskModule which is also imported by the main gRPC app). On
 * application bootstrap it finds every project that has detections but
 * no persisted score row, and enqueues a recompute for each.
 *
 * - On the first deploy the project_cyber_risk table is empty, so
 *   this populates scores for every project that already has findings.
 * - Once rows exist it is a cheap no-op (the anti-join returns nothing).
 *
 * The whole body is wrapped in try/catch: a backfill failure must NEVER
 * crash the worker. The anti-join query + best-effort enqueues are cheap;
 * the actual scoring happens asynchronously in the queue, so this does not
 * meaningfully block boot.
 */
@Injectable()
export class CyberiskStartupBackfillService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CyberiskStartupBackfillService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly enqueuer: CyberiskRecomputeEnqueuer,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      // Quoted camelCase: PostgreSQL folds a bare projectId to lower case.
      const projectId = ident('projectId');
      const dProjectId = ident('d.projectId');
      const q = sql`SELECT ${dProjectId} AS ${projectId} FROM (
           SELECT ${projectId} FROM vulnerability_detections_sast
           UNION SELECT ${projectId} FROM vulnerability_detections_iac
           UNION SELECT ${projectId} FROM vulnerability_detections_cicd
           UNION SELECT ${projectId} FROM vulnerability_detections_sca
           UNION SELECT ${projectId} FROM vulnerability_detections_container
           UNION SELECT ${projectId} FROM vulnerability_detections_secret
         ) d
         LEFT JOIN project_cyber_risk r ON r.project_id = ${dProjectId}
         WHERE r.project_id IS NULL AND ${dProjectId} IS NOT NULL AND ${dProjectId} <> ''`;
      const rows: Array<{ projectId: string }> = await this.dataSource.query(
        q.text,
        q.params,
      );

      if (!rows || rows.length === 0) {
        this.logger.log('CybeRisk startup backfill: 0 missing — skip');
        return;
      }

      // Enqueue in bounded parallel chunks rather than one-at-a-time so a
      // first-deploy backfill of thousands of projects doesn't serialize into
      // a long boot-time stall. enqueue() is best-effort (never throws).
      const CHUNK = 50;
      for (let i = 0; i < rows.length; i += CHUNK) {
        await Promise.all(
          rows
            .slice(i, i + CHUNK)
            .map((row) => this.enqueuer.enqueue(row.projectId, 'backfill')),
        );
      }

      this.logger.log(
        `CybeRisk startup backfill: enqueued ${rows.length} missing project score(s)`,
      );
    } catch (err: any) {
      // A backfill failure must never crash the worker — log and move on.
      this.logger.warn(
        `CybeRisk startup backfill skipped due to error: ${String(
          err?.message ?? err,
        )}`,
      );
    }
  }
}
