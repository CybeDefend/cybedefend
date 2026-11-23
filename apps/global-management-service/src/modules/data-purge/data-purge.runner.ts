import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { Logger } from 'nestjs-pino';
import type { PurgeDataResponse } from '@grpc/data-purge/data_purge';
import type { PurgeStepName } from '../../entities/data-purge-step.entity';
import {
  DataPurgeStore,
  PurgeJobRow,
  PurgeStepRow,
  StuckPurgeJob,
} from './data-purge.store';
import { DataPurgeSteps } from './data-purge.steps';

/** Delay after the 1st, 2nd, 3rd and 4th failure of a step. */
export const PURGE_BACKOFF_MS = [60_000, 300_000, 1_800_000, 7_200_000];
/** Delay after every further failure: a step is retried forever. */
export const PURGE_BACKOFF_MAX_MS = 21_600_000;
/** The second pass, after every step of the first one is done. */
export const PURGE_SECOND_PASS_DELAY_MS = 86_400_000;
/** A job still pending this long after its deletion logs DATA_PURGE_STUCK. */
export const PURGE_STUCK_AFTER_MS = 7 * 86_400_000;
/** How long a claim holds a job. */
export const PURGE_LEASE_MS = 600_000;
/** How often a runner renews the lease of the job it works on. */
export const PURGE_LEASE_RENEW_MS = 60_000;
/** Calls of an incomplete step per run, before it waits for the next run. */
export const PURGE_MAX_CALLS_PER_STEP = 20;
/**
 * How long `runDue` keeps claiming jobs: 40 min, inside the CronJob's
 * `activeDeadlineSeconds: 3000` with room for the job in progress.
 */
export const PURGE_RUN_BUDGET_MS = 2_400_000;
/** Stuck jobs logged per run. */
const PURGE_STUCK_LOG_LIMIT = 500;

export function purgeBackoffMs(attempts: number): number {
  return PURGE_BACKOFF_MS[attempts - 1] ?? PURGE_BACKOFF_MAX_MS;
}

/**
 * The name of a failure's gRPC code (`UNAVAILABLE`), never its message: a
 * message can carry a path or a value of the customer's data.
 */
export function purgeErrorCode(error: unknown): string {
  const raw =
    error instanceof RpcException
      ? (error.getError() as { code?: unknown } | string)
      : error;
  const code =
    raw && typeof raw === 'object' ? (raw as { code?: unknown }).code : null;
  if (typeof code === 'number' && typeof status[code] === 'string') {
    return status[code];
  }
  return 'UNKNOWN';
}

/** The class of an error, the only thing of it a log line carries. */
const errorClass = (error: unknown): string =>
  (error as Error)?.constructor?.name ?? typeof error;

interface Lease {
  held: boolean;
}

interface Counts {
  stepsDone: number;
  stepsFailed: number;
}

/**
 * Runs the purge jobs that project, team and organization deletion record:
 * every step is called until its service answers
 * `complete`, retried with backoff on failure, then run again in a second
 * pass 24 h later. Two runners never work on one job at once: a run claims
 * the job with a conditional UPDATE, renews the lease every minute while it
 * works and gives it back by token. Every step and job write holds only
 * while the lease is still this run's: a runner that lost it, whose
 * calls were still in flight, can never write over the next runner's pass.
 * The API kicks it after each deletion; the CronJob
 * (`main.cron-data-purge.ts`) runs whatever is due.
 */
@Injectable()
export class DataPurgeRunner {
  constructor(
    private readonly store: DataPurgeStore,
    private readonly steps: DataPurgeSteps,
    private readonly logger: Logger,
  ) {}

  /**
   * Runs the jobs one after the other in the background. Never throws and
   * never waits: the deletion that recorded them is already committed, and
   * the CronJob takes over whatever this leaves.
   */
  kick(jobIds: string[]): void {
    if (!Array.isArray(jobIds) || jobIds.length === 0) return;
    const ids = [...jobIds];
    void (async () => {
      for (const jobId of ids) {
        try {
          await this.runJob(jobId);
        } catch (error) {
          this.logger.error(
            `DATA_PURGE_RUN_FAILED job=${jobId} error=${errorClass(error)}`,
          );
        }
      }
    })();
  }

  async runJob(jobId: string): Promise<void> {
    await this.run(jobId);
  }

  /**
   * One run of the CronJob. First one DATA_PURGE_STUCK line per job still
   * pending `PURGE_STUCK_AFTER_MS` after its deletion, so a run killed
   * later still alerts; then the due jobs, one at a time, claiming none once
   * `PURGE_RUN_BUDGET_MS` is spent. Rejects when the ledger cannot be
   * read or a job failed unexpectedly, after the others ran.
   */
  async runDue(
    now: Date = new Date(),
    limit = 50,
  ): Promise<{ jobs: number; stepsDone: number; stepsFailed: number }> {
    const startedAt = Date.now();
    const summary = { jobs: 0, stepsDone: 0, stepsFailed: 0 };
    let failure: unknown = null;

    try {
      const stuck = await this.store.stuckJobs(
        new Date(now.getTime() - PURGE_STUCK_AFTER_MS),
        PURGE_STUCK_LOG_LIMIT,
      );
      for (const s of stuck) this.logStuck(s);
    } catch (error) {
      failure = error;
      this.logger.error(
        `DATA_PURGE_STUCK_READ_FAILED error=${errorClass(error)}`,
      );
    }

    const ids = await this.store.dueJobIds(now, limit);
    for (const jobId of ids) {
      if (Date.now() - startedAt >= PURGE_RUN_BUDGET_MS) {
        this.logger.warn(
          `DATA_PURGE_RUN_BUDGET_SPENT jobs=${summary.jobs} left=${ids.length - ids.indexOf(jobId)}`,
        );
        break;
      }
      try {
        const result = await this.run(jobId);
        if (!result) continue;
        summary.jobs += 1;
        summary.stepsDone += result.stepsDone;
        summary.stepsFailed += result.stepsFailed;
      } catch (error) {
        failure = error;
        this.logger.error(
          `DATA_PURGE_RUN_FAILED job=${jobId} error=${errorClass(error)}`,
        );
      }
    }

    if (failure) throw failure;
    return summary;
  }

  /**
   * One line per stuck job, naming one pending step: `code=HALTED` for a
   * halted job (its subject was found again: no run touches it until an
   * operator does), else a failing step with its code, else
   * `code=INCOMPLETE` (a step that keeps answering `complete: false`, or the
   * organization's permify waiting on billing).
   */
  private logStuck(s: StuckPurgeJob): void {
    const code = s.halted ? 'HALTED' : (s.lastErrorCode ?? 'INCOMPLETE');
    this.logger.error(
      `DATA_PURGE_STUCK job=${s.jobId} kind=${s.kind} step=${s.step ?? 'none'} attempts=${s.attempts ?? 0} code=${code}`,
    );
  }

  /** Claims, works, releases. Null when another runner holds the job. */
  private async run(jobId: string): Promise<Counts | null> {
    const token = randomUUID();
    const claimedAt = Date.now();
    const claimed = await this.store.claim(
      jobId,
      token,
      new Date(claimedAt),
      new Date(claimedAt + PURGE_LEASE_MS),
    );
    if (!claimed) return null;

    const lease: Lease = { held: true };
    const renewal = setInterval(() => {
      if (!lease.held) return;
      this.store
        .renew(jobId, token, new Date(Date.now() + PURGE_LEASE_MS))
        .then(
          (ok) => {
            if (!ok) lease.held = false;
          },
          () => {
            lease.held = false;
          },
        );
    }, PURGE_LEASE_RENEW_MS);
    renewal.unref?.();

    try {
      return await this.work(jobId, token, lease);
    } finally {
      // `work` returns only once every call it started has settled: the
      // lease is never given back while one of them can still write.
      clearInterval(renewal);
      await this.store.release(jobId, token).catch((error) => {
        this.logger.warn(
          `DATA_PURGE_RELEASE_FAILED job=${jobId} error=${errorClass(error)}`,
        );
      });
    }
  }

  private async work(
    jobId: string,
    token: string,
    lease: Lease,
  ): Promise<Counts> {
    const counts: Counts = { stepsDone: 0, stepsFailed: 0 };
    const job = await this.store.getJob(jobId);
    if (!job || job.status !== 'pending') return counts;

    // The subject is gone for good (its id is a UUID that nothing reuses):
    // finding it again is a bug, and the purge stops rather than delete the
    // data of a live project. Checked once per run.
    if (await this.store.subjectExists(job.kind, job.subjectId)) {
      await this.store.updateJob(jobId, token, { status: 'halted' });
      this.logger.error(
        `DATA_PURGE_SUBJECT_EXISTS job=${jobId} kind=${job.kind}`,
      );
      return counts;
    }

    const steps = await this.store.getSteps(jobId);
    const now = Date.now();
    const due = (s: PurgeStepRow) =>
      s.status === 'pending' && s.nextAttemptAt.getTime() <= now;
    // An organization's attributes go only once billing has deleted its
    // subscriptions: a billing webhook in between would write them again.
    // On both passes.
    const waitsForBilling = (s: PurgeStepRow) =>
      job.kind === 'organization' && s.step === 'permify';
    const billing = steps.find((s) => s.step === 'billing');

    await settleAll(
      steps
        .filter((s) => due(s) && !waitsForBilling(s))
        .map((s) => this.runStep(job, s, token, lease, counts)),
    );
    for (const s of steps.filter((x) => due(x) && waitsForBilling(x))) {
      if (lease.held && (!billing || billing.status === 'done')) {
        await this.runStep(job, s, token, lease, counts);
      }
    }
    if (!lease.held) return counts;

    if (steps.every((s) => s.status === 'done')) {
      await this.finishPass(job, steps, token, lease);
      return counts;
    }

    const next = Math.min(
      ...steps
        .filter((s) => s.status === 'pending')
        .map((s) =>
          waitsForBilling(s) && billing && billing.status !== 'done'
            ? Math.max(
                s.nextAttemptAt.getTime(),
                billing.nextAttemptAt.getTime(),
              )
            : s.nextAttemptAt.getTime(),
        ),
    );
    await this.store.updateJob(jobId, token, {
      nextAttemptAt: new Date(next),
    });
    return counts;
  }

  /** Pass 1 → every step again in 24 h; pass 2 → done. */
  private async finishPass(
    job: PurgeJobRow,
    steps: PurgeStepRow[],
    token: string,
    lease: Lease,
  ): Promise<void> {
    if (job.pass >= 2) {
      await this.store.updateJob(job.id, token, {
        status: 'done',
        completedAt: new Date(),
      });
      return;
    }
    const second = new Date(Date.now() + PURGE_SECOND_PASS_DELAY_MS);
    // Steps first: should the job write fail, the next run finds them
    // pending and completes the first pass again, which deletes nothing more.
    for (const s of steps) {
      const written = await this.writeStep(job.id, token, s.step, lease, {
        status: 'pending',
        attempts: 0,
        lastErrorCode: null,
        doneAt: null,
        nextAttemptAt: second,
      });
      if (!written) return;
    }
    await this.store.updateJob(job.id, token, {
      pass: 2,
      nextAttemptAt: second,
    });
  }

  /**
   * A step write, applied only while this run holds the lease. A refusal
   * means another runner owns the job now: this one stops working on it.
   */
  private async writeStep(
    jobId: string,
    token: string,
    step: PurgeStepName,
    lease: Lease,
    patch: Partial<PurgeStepRow>,
  ): Promise<boolean> {
    const written = await this.store.updateStep(jobId, token, step, patch);
    if (!written) {
      lease.held = false;
      this.logger.warn(`DATA_PURGE_LEASE_LOST job=${jobId} step=${step}`);
    }
    return written;
  }

  /**
   * Calls one step until it answers `complete`, at most
   * PURGE_MAX_CALLS_PER_STEP times; then it waits for the next run, with no
   * attempt counted. A failure counts an attempt and schedules the retry.
   * `step` is updated in place once its write is accepted, so the caller
   * sees its outcome.
   */
  private async runStep(
    job: PurgeJobRow,
    step: PurgeStepRow,
    token: string,
    lease: Lease,
    counts: Counts,
  ): Promise<void> {
    const deleted: Record<string, number> = { ...(step.deleted ?? {}) };
    let calls = 0;
    let answered = false;
    while (calls < PURGE_MAX_CALLS_PER_STEP && lease.held) {
      calls += 1;
      let response: PurgeDataResponse;
      try {
        response = await this.steps.runStep(step.step, job);
      } catch (error) {
        const code = purgeErrorCode(error);
        const attempts = step.attempts + 1;
        const nextAttemptAt = new Date(Date.now() + purgeBackoffMs(attempts));
        const written = await this.writeStep(job.id, token, step.step, lease, {
          attempts,
          lastErrorCode: code,
          nextAttemptAt,
          ...(answered ? { deleted } : {}),
        });
        if (!written) return;
        Object.assign(step, { attempts, lastErrorCode: code, nextAttemptAt });
        if (answered) step.deleted = deleted;
        counts.stepsFailed += 1;
        this.logger.warn(
          `DATA_PURGE_STEP_FAILED job=${job.id} kind=${job.kind} step=${step.step} attempts=${attempts} code=${code}`,
        );
        return;
      }
      answered = true;
      addCounts(deleted, response.deleted);
      if (response.complete) {
        const doneAt = new Date();
        const written = await this.writeStep(job.id, token, step.step, lease, {
          status: 'done',
          doneAt,
          lastErrorCode: null,
          deleted,
        });
        if (!written) return;
        Object.assign(step, {
          status: 'done',
          doneAt,
          lastErrorCode: null,
          deleted,
        });
        counts.stepsDone += 1;
        return;
      }
    }
    // Incomplete after its calls, or the lease is gone (then the write is
    // refused): what was deleted is on record, and the step is due again
    // at the next run.
    if (!answered || !lease.held) return;
    const nextAttemptAt = new Date();
    const written = await this.writeStep(job.id, token, step.step, lease, {
      deleted,
      nextAttemptAt,
    });
    if (written) Object.assign(step, { deleted, nextAttemptAt });
  }
}

/**
 * Waits for every promise, then rejects with the first failure, if any: a
 * failed write never lets the lease go while a sibling call still runs.
 */
async function settleAll(promises: Promise<unknown>[]): Promise<void> {
  const results = await Promise.allSettled(promises);
  const failed = results.find(
    (r): r is PromiseRejectedResult => r.status === 'rejected',
  );
  if (failed) throw failed.reason;
}

function addCounts(
  into: Record<string, number>,
  more: Record<string, number> | undefined,
): void {
  for (const [key, value] of Object.entries(more ?? {})) {
    const n = Number(value);
    if (Number.isFinite(n)) into[key] = (into[key] ?? 0) + n;
  }
}
