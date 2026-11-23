import { Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Logger } from 'nestjs-pino';
import { ulid } from 'ulid';
import {
  GeneratedReport,
  GeneratedReportKind,
} from '../../../entities/generated-report.entity';
import { ScanQueueService } from '../../scan-queue/scan-queue.service';
import { AsyncTaskStore } from '../../../core/realtime/async-task-store.service';
import { ReportRetentionService } from '../retention/report-retention.service';
import { ReportQuotaService } from '../retention/report-quota.service';

export interface EnqueueProjectReportInput {
  kind: GeneratedReportKind;
  projectId: string;
  format: string;
  detailed: boolean;
  branch?: string;
  scannerTypes?: string[];
  userId?: string;
}

/**
 * Insert a queued GeneratedReport row and enqueue its async generation job.
 * Shared by the premium-report handlers (core and ee: it was
 * ResultController.enqueueReport) — each returns immediately with a reportId;
 * the worker publishes REPORT_READY when the artifact is up.
 */
@Injectable()
export class ProjectReportEnqueuer {
  constructor(
    @InjectRepository(GeneratedReport)
    private readonly generatedReportRepo: Repository<GeneratedReport>,
    private readonly scanQueueService: ScanQueueService,
    private readonly asyncTaskStore: AsyncTaskStore,
    private readonly reportRetention: ReportRetentionService,
    private readonly reportQuota: ReportQuotaService,
    private readonly logger: Logger,
  ) {}

  async enqueue(input: EnqueueProjectReportInput): Promise<string> {
    // Refuse before doing any work if the org is at its stored-report
    // quota (soft, fail-open on billing outage).
    await this.reportQuota.assertWithinQuotaForProject(input.projectId);
    const reportId = ulid();
    // Resolve the owning org + plan-derived expiry once, at creation.
    const { organizationId, expiresAt } =
      await this.reportRetention.computeExpiresAtForProject(input.projectId);
    await this.generatedReportRepo.save(
      this.generatedReportRepo.create({
        id: reportId,
        kind: input.kind,
        projectId: input.projectId,
        organizationId,
        format: input.format,
        detailed: input.detailed,
        branch: input.branch ?? null,
        scannerTypes: input.scannerTypes ?? null,
        status: 'queued',
        expiresAt,
      }),
    );

    // Surface the generation in the background-tasks widget. Created
    // only when a userId is known (the widget is per-user) and rolled back with
    // the row if the enqueue fails.
    const taskId = input.userId ? ulid() : undefined;
    if (taskId && input.userId) {
      const nowMs = Date.now();
      await this.asyncTaskStore.create({
        taskId,
        type: 'report_generation',
        status: 'queued',
        total: 1,
        processed: 0,
        succeeded: 0,
        failed: 0,
        projectId: input.projectId,
        organizationId: organizationId ?? undefined,
        userId: input.userId,
        createdAt: nowMs,
        updatedAt: nowMs,
      });
    }

    // M2 — if enqueueing fails (Redis transient, BullMQ misconfig, …) the
    // GeneratedReport row would otherwise stay 'queued' forever, polluting
    // the user's history with rows that no worker will ever pick up. Roll
    // back the row (and the async task) and surface UNAVAILABLE.
    try {
      await this.scanQueueService.addReportJob({
        reportId,
        kind: input.kind,
        projectId: input.projectId,
        format: input.format,
        detailed: input.detailed,
        branch: input.branch,
        scannerTypes: input.scannerTypes,
        taskId,
        userId: input.userId,
      });
    } catch (err) {
      try {
        await this.generatedReportRepo.delete({ id: reportId });
      } catch (deleteErr) {
        // The orphan row is a soft failure; we still want to surface the
        // original enqueue error to the caller, not the cleanup error.
        this.logger.warn(
          `[reports] failed to clean up orphan GeneratedReport ${reportId}: ${(deleteErr as Error).message}`,
        );
      }
      if (taskId) {
        try {
          await this.asyncTaskStore.delete(taskId);
        } catch {
          // best-effort rollback of the widget task
        }
      }
      throw new RpcException({
        code: status.UNAVAILABLE,
        message: `Failed to enqueue report job: ${(err as Error).message}`,
      });
    }
    return reportId;
  }
}
