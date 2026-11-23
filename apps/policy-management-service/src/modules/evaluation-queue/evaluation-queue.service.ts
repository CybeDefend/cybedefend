import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue, JobsOptions } from 'bullmq';
import { POLICY_QUEUE_NAMES } from './queue-names';
import { QueueBacklogResponse, QueueDepthStats } from './queue-metrics.types';
import type { ProjectHierarchy } from '@modules/policy/policy.service';

/**
 * Job data for policy evaluation processing
 */
export interface PolicyEvaluationJobData {
  evaluationId: string;
  scanId: string;
  projectId: string;
  organizationId: string;
  teamId?: string;
  triggeredBy: string;
  branch?: string;
  /**
   * The project's organization and team as global-management resolved them
   * when the evaluation was triggered, so the processor does not resolve them
   * a second time. Absent from a job queued before the field
   * existed and from an OSV re-evaluation: the processor resolves it then.
   *
   * Reusing it is safe because global-management never moves a project to
   * another team or organization (ProjectService/Update ignores its teamId).
   * If moving a project is ever added, revisit this: a job queued before the
   * move would apply the former team's policies. Also, a project deleted
   * between the trigger and the job is now evaluated against that hierarchy
   * (its policies merged, its scan's vulnerabilities fetched), where the
   * second resolution used to fail the job.
   */
  hierarchy?: ProjectHierarchy;
}

/**
 * Service responsible for adding policy evaluation jobs to BullMQ queues.
 */
@Injectable()
export class EvaluationQueueService {
  private readonly logger = new Logger(EvaluationQueueService.name);

  constructor(
    @InjectQueue(POLICY_QUEUE_NAMES.EVALUATION)
    private readonly evaluationQueue: Queue<PolicyEvaluationJobData>,
  ) {}

  /**
   * Add a policy evaluation job to the queue
   */
  async addEvaluationJob(
    data: PolicyEvaluationJobData,
    options?: JobsOptions,
  ): Promise<string> {
    const job = await this.evaluationQueue.add('evaluate-scan', data, {
      ...options,
      jobId: data.evaluationId, // Use evaluationId as jobId for deduplication
    });

    this.logger.log(
      `Added evaluation job ${job.id} for scan=${data.scanId}, project=${data.projectId}`,
    );

    return job.id || data.evaluationId;
  }

  /**
   * Get the status of an evaluation job
   */
  async getJobStatus(evaluationId: string): Promise<{
    status: string;
    progress: number;
    failedReason?: string;
  }> {
    const job = await this.evaluationQueue.getJob(evaluationId);

    if (!job) {
      return { status: 'not_found', progress: 0 };
    }

    const state = await job.getState();
    const progress = typeof job.progress === 'number' ? job.progress : 0;

    return {
      status: state,
      progress,
      failedReason: job.failedReason,
    };
  }

  /**
   * Check if a job is already queued or processing for a scan
   */
  async isJobQueued(evaluationId: string): Promise<boolean> {
    const job = await this.evaluationQueue.getJob(evaluationId);
    if (!job) return false;

    const state = await job.getState();
    return ['waiting', 'active', 'delayed'].includes(state);
  }

  /**
   * Remove a job from the queue
   */
  async removeJob(evaluationId: string): Promise<void> {
    const job = await this.evaluationQueue.getJob(evaluationId);
    if (job) {
      await job.remove();
      this.logger.log(`Removed evaluation job: ${evaluationId}`);
    }
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
  }> {
    const [waiting, active, completed, failed] = await Promise.all([
      this.evaluationQueue.getWaitingCount(),
      this.evaluationQueue.getActiveCount(),
      this.evaluationQueue.getCompletedCount(),
      this.evaluationQueue.getFailedCount(),
    ]);

    return { waiting, active, completed, failed };
  }

  /**
   * Get a snapshot of the policy-evaluation queue depth for KEDA autoscaling.
   *
   * Uses BullMQ getJobCounts('wait','prioritized','delayed','active').
   * The `wait` key (BullMQ internal name for the FIFO list) is mapped to
   * `waiting` in the output so callers never need to know about BullMQ internals.
   *
   * Intended to be scraped by the KEDA metrics-api scaler for autoscaling
   * decisions. The payload contains integers only — no tenant data.
   */
  async getQueueBacklog(): Promise<QueueBacklogResponse> {
    const STATES = ['wait', 'prioritized', 'delayed', 'active'] as const;

    const counts = await this.evaluationQueue.getJobCounts(...STATES);

    const toStats = (c: Record<string, number>): QueueDepthStats => {
      const waiting = c['wait'] ?? 0;
      const prioritized = c['prioritized'] ?? 0;
      const delayed = c['delayed'] ?? 0;
      const active = c['active'] ?? 0;
      const pending = waiting + prioritized + delayed;
      return {
        waiting,
        prioritized,
        delayed,
        active,
        pending,
        backlog: pending + active,
      };
    };

    return {
      queues: {
        policyEvaluation: toStats(counts),
      },
    };
  }
}
