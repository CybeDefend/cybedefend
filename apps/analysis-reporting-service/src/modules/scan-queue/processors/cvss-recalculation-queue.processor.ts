import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger, Inject } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_NAMES } from '../queue-names';
import { SecurityContextForScoring } from '../../cvss/cvss-calculator.service';
import { mapProjectContextToScoringContext } from '../../cvss/security-context-mapper';
import { ProjectSecurityContext } from '@grpc/global-management/project';
import { CyberiskRecomputeEnqueuer } from '../../cyber-risk/cyberisk-recompute.enqueuer';
import { getQueueConcurrency } from '../concurrency.config';

export interface CvssRecalculationJobData {
  projectId: string;
  trigger?: 'context_change' | 'priority_recompute' | 'osv_severity_change';
  /**
   * Set only for trigger 'osv_severity_change': the OSV ids whose CVSS actually
   * changed in the latest delta sync. The refresh re-derives those detections'
   * CVSS from the current OSV severities.
   */
  osvIds?: string[];
}

// Forward reference types to avoid circular dependencies
type CvssRecalculationProcessorType = {
  recalculateForProject: (
    projectId: string,
    context: SecurityContextForScoring,
  ) => Promise<number>;
  recomputePrioritiesForProject: (
    projectId: string,
    businessCriticality: number,
    dataClassification: number,
  ) => Promise<number>;
  refreshCvssFromOsv: (
    projectId: string,
    osvIds: string[],
    context: SecurityContextForScoring,
  ) => Promise<number>;
};

type ResultServiceType = {
  getSecurityContextCached: (
    projectId: string,
  ) => Promise<ProjectSecurityContext | null>;
  invalidateSecurityContextCache: (projectId: string) => void;
};

/**
 * BullMQ Processor for CVSS recalculation jobs.
 *
 * Consumes jobs from the cvss-recalculation-queue, added by
 * result.controller.ts when a project's security context changes.
 *
 * Dispatches based on job.data.trigger:
 * - 'context_change' (default): full CVSS environmental recalculation + priority
 * - 'priority_recompute': priority-only recomputation (no CVSS recalc)
 */
@Processor(QUEUE_NAMES.CVSS_RECALCULATION, {
  concurrency: getQueueConcurrency('CVSS_RECALCULATION'),
  lockDuration: 600000, // 10 minutes - large projects may have many detections
  lockRenewTime: 120000, // Renew lock every 2 minutes
})
export class CvssRecalculationQueueProcessor extends WorkerHost {
  private readonly logger = new Logger(CvssRecalculationQueueProcessor.name);

  constructor(
    @Inject('CVSS_RECALCULATION_PROCESSOR')
    private readonly cvssRecalculationProcessor: CvssRecalculationProcessorType,
    @Inject('RESULT_SERVICE')
    private readonly resultService: ResultServiceType,
    private readonly cyberiskEnqueuer: CyberiskRecomputeEnqueuer,
  ) {
    super();
  }

  async process(job: Job<CvssRecalculationJobData>): Promise<void> {
    const { projectId, trigger } = job.data;

    this.logger.log(
      `[CVSS Recalc] Starting job ${job.id} for project=${projectId}, trigger=${trigger}`,
    );

    const startTime = Date.now();

    try {
      this.resultService.invalidateSecurityContextCache(projectId);
      const ctx = await this.resultService.getSecurityContextCached(projectId);

      if (trigger === 'priority_recompute') {
        const updated =
          await this.cvssRecalculationProcessor.recomputePrioritiesForProject(
            projectId,
            ctx?.businessCriticality ?? 0,
            ctx?.dataClassification ?? 0,
          );
        this.logger.log(
          `[CVSS Recalc] Priority recompute done for project=${projectId}, updated=${updated}`,
        );
      } else if (trigger === 'osv_severity_change') {
        // An OSV record's CVSS changed in the delta sync — re-derive the
        // affected detections' CVSS from the current severities (SCA + container).
        if (!ctx) {
          this.logger.warn(
            `[CVSS Recalc] No security context found for project=${projectId}, skipping OSV severity refresh`,
          );
          return;
        }
        const scoringContext = mapProjectContextToScoringContext(ctx);
        const updated =
          await this.cvssRecalculationProcessor.refreshCvssFromOsv(
            projectId,
            job.data.osvIds ?? [],
            scoringContext,
          );
        this.logger.log(
          `[CVSS Recalc] OSV severity refresh done for project=${projectId}, updated=${updated}`,
        );
      } else {
        // 'context_change' or unknown trigger: full CVSS + priority recalculation
        if (!ctx) {
          this.logger.warn(
            `[CVSS Recalc] No security context found for project=${projectId}, skipping recalculation`,
          );
          return;
        }

        const scoringContext = mapProjectContextToScoringContext(ctx);
        const updated =
          await this.cvssRecalculationProcessor.recalculateForProject(
            projectId,
            scoringContext,
          );
        this.logger.log(
          `[CVSS Recalc] Recalculation done for project=${projectId}, updated=${updated}`,
        );
      }

      const duration = Date.now() - startTime;
      this.logger.log(`[CVSS Recalc] Job ${job.id} completed in ${duration}ms`);

      await this.cyberiskEnqueuer.enqueue(projectId, 'security_context_update');
    } catch (error) {
      this.logger.error(
        `[CVSS Recalc] Error processing job ${job.id}: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw error; // Re-throw to trigger BullMQ retry
    }
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job<CvssRecalculationJobData>) {
    this.logger.debug(`[CVSS Recalc] Job ${job.id} completed successfully`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<CvssRecalculationJobData>, error: Error) {
    this.logger.error(
      `[CVSS Recalc] Job ${job.id} failed after ${job.attemptsMade} attempts: ${error.message}`,
    );
  }
}
