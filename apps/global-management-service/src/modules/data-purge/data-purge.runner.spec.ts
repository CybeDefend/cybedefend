import { status } from '@grpc/grpc-js';
import { RpcException } from '@nestjs/microservices';
import { Logger } from 'nestjs-pino';
import type { PurgeDataResponse } from '@grpc/data-purge/data_purge';
import type {
  DataPurgeJob,
  PurgeKind,
} from '../../entities/data-purge-job.entity';
import type {
  DataPurgeStep,
  PurgeStepName,
} from '../../entities/data-purge-step.entity';
import { CORE_PURGE_STEPS } from './data-purge.ledger';
import {
  DataPurgeRunner,
  PURGE_BACKOFF_MS,
  PURGE_LEASE_MS,
  PURGE_MAX_CALLS_PER_STEP,
  PURGE_RUN_BUDGET_MS,
  PURGE_SECOND_PASS_DELAY_MS,
  PURGE_STUCK_AFTER_MS,
} from './data-purge.runner';
import type { DataPurgeStore, StuckPurgeJob } from './data-purge.store';
import type { DataPurgeSteps } from './data-purge.steps';

const T0 = new Date('2026-10-27T10:00:00.000Z').getTime();
const PROJECT = '11111111-1111-4111-8111-111111111111';
const ORG = '55555555-5555-4555-8555-555555555555';
const TEAM = '33333333-3333-4333-8333-333333333333';

type Job = Omit<DataPurgeJob, 'steps'>;
type Step = Omit<DataPurgeStep, 'job'>;
/** The store's public methods (its DataSource is private). */
type StoreApi = { [K in keyof DataPurgeStore]: DataPurgeStore[K] };

/**
 * The ledger in memory, with the claim, renewal and release of the real store:
 * the conditional UPDATEs of `DataPurgeStore`, one row at a time.
 */
class MemoryStore implements StoreApi {
  jobs = new Map<string, Job>();
  steps = new Map<string, Step[]>();
  subjects = new Set<string>();
  renewals = 0;
  /** Every renewal refused, as when another runner took the job over. */
  refuseRenewals = false;
  /** A step whose write throws, as on a database error. */
  failingWrite: PurgeStepName | null = null;
  releasedAt: number[] = [];

  addJob(
    kind: PurgeKind,
    id: string,
    patch: Partial<Job> = {},
    stepNames: readonly PurgeStepName[] = CORE_PURGE_STEPS[kind],
  ): Job {
    const now = new Date(Date.now());
    const job: Job = {
      id,
      kind,
      subjectId:
        kind === 'organization' ? ORG : kind === 'team' ? TEAM : PROJECT,
      organizationId: ORG,
      teamIds: kind === 'organization' ? [TEAM] : null,
      deletedAt: now,
      status: 'pending',
      pass: 1,
      nextAttemptAt: now,
      leaseUntil: null,
      leaseToken: null,
      completedAt: null,
      ...patch,
    };
    this.jobs.set(id, job);
    this.steps.set(
      id,
      stepNames.map((step) => ({
        jobId: id,
        step,
        status: 'pending',
        attempts: 0,
        nextAttemptAt: now,
        lastErrorCode: null,
        doneAt: null,
        deleted: null,
      })),
    );
    return job;
  }

  step(jobId: string, name: PurgeStepName): Step {
    return this.steps.get(jobId)!.find((s) => s.step === name)!;
  }

  async dueJobIds(now: Date, limit: number): Promise<string[]> {
    return [...this.jobs.values()]
      .filter(
        (j) =>
          j.status === 'pending' &&
          j.nextAttemptAt <= now &&
          (j.leaseUntil === null || j.leaseUntil < now),
      )
      .slice(0, limit)
      .map((j) => j.id);
  }

  /** The selection of DataPurgeStore.stuckJobs, in memory. */
  async stuckJobs(deletedBefore: Date): Promise<StuckPurgeJob[]> {
    return [...this.jobs.values()]
      .filter(
        (j) =>
          (j.status === 'pending' && j.deletedAt < deletedBefore) ||
          j.status === 'halted',
      )
      .map((j) => {
        const [step] = this.steps
          .get(j.id)!
          .filter((st) => st.status === 'pending')
          .sort(
            (a, b) =>
              Number(a.lastErrorCode === null) -
                Number(b.lastErrorCode === null) ||
              b.attempts - a.attempts ||
              a.nextAttemptAt.getTime() - b.nextAttemptAt.getTime() ||
              a.step.localeCompare(b.step),
          );
        return {
          jobId: j.id,
          kind: j.kind,
          step: step?.step ?? null,
          attempts: step ? step.attempts : null,
          lastErrorCode: step?.lastErrorCode ?? null,
          halted: j.status === 'halted',
        };
      });
  }

  async claim(
    jobId: string,
    token: string,
    now: Date,
    leaseUntil: Date,
  ): Promise<boolean> {
    const j = this.jobs.get(jobId);
    if (
      !j ||
      j.status !== 'pending' ||
      j.nextAttemptAt > now ||
      (j.leaseUntil !== null && j.leaseUntil >= now)
    ) {
      return false;
    }
    j.leaseUntil = leaseUntil;
    j.leaseToken = token;
    return true;
  }

  async renew(
    jobId: string,
    token: string,
    leaseUntil: Date,
  ): Promise<boolean> {
    this.renewals += 1;
    const j = this.jobs.get(jobId);
    if (this.refuseRenewals || !j || j.leaseToken !== token) return false;
    j.leaseUntil = leaseUntil;
    return true;
  }

  async release(jobId: string, token: string): Promise<void> {
    this.releasedAt.push(Date.now());
    const j = this.jobs.get(jobId);
    if (j && j.leaseToken === token) {
      j.leaseUntil = null;
      j.leaseToken = null;
    }
  }

  async getJob(jobId: string): Promise<Job | null> {
    const j = this.jobs.get(jobId);
    return j ? { ...j } : null;
  }

  async getSteps(jobId: string): Promise<Step[]> {
    return (this.steps.get(jobId) ?? []).map((s) => ({ ...s }));
  }

  /** Applied only while `token` holds an unexpired lease. */
  private leased(jobId: string, token: string): boolean {
    const j = this.jobs.get(jobId);
    return (
      !!j &&
      j.leaseToken === token &&
      j.leaseUntil !== null &&
      j.leaseUntil.getTime() > Date.now()
    );
  }

  async updateStep(
    jobId: string,
    token: string,
    step: PurgeStepName,
    patch: Partial<Step>,
  ): Promise<boolean> {
    if (this.failingWrite === step) throw new Error('ER_LOCK_WAIT_TIMEOUT');
    if (!this.leased(jobId, token)) return false;
    Object.assign(this.step(jobId, step), patch);
    return true;
  }

  async updateJob(
    jobId: string,
    token: string,
    patch: Partial<Job>,
  ): Promise<boolean> {
    if (!this.leased(jobId, token)) return false;
    Object.assign(this.jobs.get(jobId)!, patch);
    return true;
  }

  async subjectExists(_kind: PurgeKind, subjectId: string): Promise<boolean> {
    return this.subjects.has(subjectId);
  }
}

type StepImpl = (step: PurgeStepName, job: Job) => Promise<PurgeDataResponse>;

const complete = (deleted: Record<string, number> = {}) =>
  Promise.resolve({ complete: true, deleted });

describe('DataPurgeRunner', () => {
  let store: MemoryStore;
  let logger: { log: jest.Mock; warn: jest.Mock; error: jest.Mock };
  let impl: jest.Mock<ReturnType<StepImpl>, Parameters<StepImpl>>;
  let runner: DataPurgeRunner;

  beforeEach(() => {
    jest.useFakeTimers({ now: T0 });
    store = new MemoryStore();
    logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    impl = jest.fn<ReturnType<StepImpl>, Parameters<StepImpl>>(() =>
      complete(),
    );
    runner = new DataPurgeRunner(
      store as unknown as DataPurgeStore,
      { runStep: (step, job) => impl(step, job) } as unknown as DataPurgeSteps,
      logger as unknown as Logger,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const errors = () => logger.error.mock.calls.map((c) => String(c[0]));
  const allLogs = () =>
    [
      ...logger.log.mock.calls,
      ...logger.warn.mock.calls,
      ...logger.error.mock.calls,
    ]
      .map((c) => String(c[0]))
      .join('\n');

  it('runs every step of a project job and schedules the second pass 24 h later', async () => {
    store.addJob('project', 'j1');
    impl.mockImplementation((step) => complete({ [step]: 3 }));

    await runner.runJob('j1');

    expect(impl.mock.calls.map((c) => c[0]).sort()).toEqual(
      [...CORE_PURGE_STEPS.project].sort(),
    );
    // Each call carries the job's ids.
    expect(impl.mock.calls[0][1]).toMatchObject({
      subjectId: PROJECT,
      organizationId: ORG,
    });
    const job = store.jobs.get('j1')!;
    expect(job.pass).toBe(2);
    expect(job.status).toBe('pending');
    expect(job.nextAttemptAt.getTime()).toBe(T0 + PURGE_SECOND_PASS_DELAY_MS);
    expect(PURGE_SECOND_PASS_DELAY_MS).toBe(86_400_000);
    for (const step of store.steps.get('j1')!) {
      expect(step).toMatchObject({
        status: 'pending',
        attempts: 0,
        lastErrorCode: null,
        doneAt: null,
      });
      expect(step.nextAttemptAt.getTime()).toBe(
        T0 + PURGE_SECOND_PASS_DELAY_MS,
      );
      // The counts of the first pass stay as evidence.
      expect(step.deleted).toEqual({ [step.step]: 3 });
    }
    // The lease is given back.
    expect(job.leaseToken).toBeNull();
    expect(job.leaseUntil).toBeNull();
  });

  it('marks the job done after the second pass', async () => {
    store.addJob('project', 'j1');
    await runner.runJob('j1');

    // Not due before the 24 h are up.
    impl.mockClear();
    await runner.runJob('j1');
    expect(impl).not.toHaveBeenCalled();

    jest.setSystemTime(T0 + PURGE_SECOND_PASS_DELAY_MS);
    impl.mockImplementation((step) => complete({ [step]: 1 }));
    await runner.runJob('j1');

    expect(impl).toHaveBeenCalledTimes(CORE_PURGE_STEPS.project.length);
    const job = store.jobs.get('j1')!;
    expect(job.status).toBe('done');
    expect(job.completedAt!.getTime()).toBe(T0 + PURGE_SECOND_PASS_DELAY_MS);
    expect(store.steps.get('j1')!.every((s) => s.status === 'done')).toBe(true);
    // Counts add up across passes.
    expect(store.step('j1', 'policy').deleted).toEqual({ policy: 1 });

    impl.mockClear();
    jest.setSystemTime(T0 + 10 * PURGE_SECOND_PASS_DELAY_MS);
    await runner.runJob('j1');
    expect(impl).not.toHaveBeenCalled();
  });

  it('retries a failed step with backoff and records only the code', async () => {
    store.addJob('project', 'j1', {}, ['analysis_reporting', 'agent']);
    impl.mockImplementation((step) =>
      step === 'agent'
        ? Promise.reject(
            Object.assign(
              new Error('connect to /secret/customer path failed'),
              {
                code: status.UNAVAILABLE,
                details: 'connect to /secret/customer path failed',
              },
            ),
          )
        : complete(),
    );

    await runner.runJob('j1');

    const agent = store.step('j1', 'agent');
    expect(agent).toMatchObject({
      status: 'pending',
      attempts: 1,
      lastErrorCode: 'UNAVAILABLE',
    });
    expect(agent.nextAttemptAt.getTime()).toBe(T0 + 60_000);
    // The job waits for its earliest pending step.
    const job = store.jobs.get('j1')!;
    expect(job.pass).toBe(1);
    expect(job.nextAttemptAt.getTime()).toBe(T0 + 60_000);
    expect(allLogs()).not.toContain('secret');
    expect(JSON.stringify([...store.steps.values()])).not.toContain('secret');

    // The backoff grows: 1 min, 5 min, 30 min, 2 h, then every 6 h.
    expect(PURGE_BACKOFF_MS).toEqual([60_000, 300_000, 1_800_000, 7_200_000]);
    const expected = [300_000, 1_800_000, 7_200_000, 21_600_000, 21_600_000];
    for (const [i, delay] of expected.entries()) {
      jest.setSystemTime(agent.nextAttemptAt.getTime());
      const at = Date.now();
      impl.mockClear();
      await runner.runJob('j1');
      // Only the failing step is called again.
      expect(impl.mock.calls.map((c) => c[0])).toEqual(['agent']);
      expect(agent.attempts).toBe(i + 2);
      expect(agent.nextAttemptAt.getTime()).toBe(at + delay);
    }
  });

  it('an UNIMPLEMENTED step is retried, not failed for good', async () => {
    store.addJob('project', 'j1');
    impl.mockImplementation((step) =>
      step === 'policy'
        ? Promise.reject(
            new RpcException({ code: status.UNIMPLEMENTED, message: 'no' }),
          )
        : complete(),
    );

    await runner.runJob('j1');

    expect(store.step('j1', 'policy')).toMatchObject({
      status: 'pending',
      attempts: 1,
      lastErrorCode: 'UNIMPLEMENTED',
    });
    expect(store.jobs.get('j1')!.status).toBe('pending');

    // The service catches up: the next run completes the job's first pass.
    jest.setSystemTime(T0 + 60_000);
    impl.mockImplementation(() => complete());
    await runner.runJob('j1');
    expect(store.step('j1', 'policy').status).toBe('pending');
    expect(store.jobs.get('j1')!.pass).toBe(2);
  });

  it('records the name of the code of any failure, and UNKNOWN without one', async () => {
    store.addJob('project', 'j1', {}, ['analysis_reporting', 'agent']);
    impl.mockImplementation((step) =>
      step === 'agent'
        ? Promise.reject(new TypeError('boom'))
        : Promise.reject(
            Object.assign(new Error('x'), { code: status.DEADLINE_EXCEEDED }),
          ),
    );

    const summary = await runner.runDue(new Date(T0));

    expect(store.step('j1', 'agent').lastErrorCode).toBe('UNKNOWN');
    expect(store.step('j1', 'analysis_reporting').lastErrorCode).toBe(
      'DEADLINE_EXCEEDED',
    );
    expect(summary).toEqual({ jobs: 1, stepsDone: 0, stepsFailed: 2 });
  });

  it('calls an incomplete step again until it completes', async () => {
    store.addJob('project', 'j1', {}, ['analysis_reporting']);
    let calls = 0;
    impl.mockImplementation(() => {
      calls += 1;
      return Promise.resolve({
        complete: calls === 3,
        deleted: { rows: 1000 },
      });
    });

    await runner.runJob('j1');

    expect(impl).toHaveBeenCalledTimes(3);
    const step = store.step('j1', 'analysis_reporting');
    expect(step.deleted).toEqual({ rows: 3000 });
    expect(step.attempts).toBe(0);
    expect(store.jobs.get('j1')!.pass).toBe(2);
  });

  it('leaves a step pending after 20 incomplete calls', async () => {
    store.addJob('project', 'j1', {}, ['analysis_reporting']);
    impl.mockImplementation(() =>
      Promise.resolve({ complete: false, deleted: { rows: 1 } }),
    );

    await runner.runJob('j1');

    expect(PURGE_MAX_CALLS_PER_STEP).toBe(20);
    expect(impl).toHaveBeenCalledTimes(20);
    const step = store.step('j1', 'analysis_reporting');
    expect(step).toMatchObject({
      status: 'pending',
      attempts: 0,
      lastErrorCode: null,
      deleted: { rows: 20 },
    });
    // Due again at the next run, with no attempt counted.
    expect(step.nextAttemptAt.getTime()).toBe(T0);
    const job = store.jobs.get('j1')!;
    expect(job.pass).toBe(1);
    expect(job.nextAttemptAt.getTime()).toBe(T0);
  });

  it("runs the organization's permify step only after billing", async () => {
    store.addJob('organization', 'o1', {}, [
      ...CORE_PURGE_STEPS.organization,
      'billing',
    ]);
    const order: string[] = [];
    let billingDone!: () => void;
    impl.mockImplementation((step) => {
      order.push(`start:${step}`);
      if (step === 'billing') {
        return new Promise((resolve) => {
          billingDone = () => {
            order.push('end:billing');
            resolve({ complete: true, deleted: {} });
          };
        });
      }
      return complete();
    });

    const run = runner.runJob('o1');
    await jest.advanceTimersByTimeAsync(0);
    expect(order).toContain('start:billing');
    expect(order).not.toContain('start:permify');
    billingDone();
    await run;

    expect(order.indexOf('start:permify')).toBeGreaterThan(
      order.indexOf('end:billing'),
    );
    expect(store.jobs.get('o1')!.pass).toBe(2);
  });

  it('leaves the permify step untouched while billing fails, on both passes', async () => {
    store.addJob('organization', 'o1', {}, [
      ...CORE_PURGE_STEPS.organization,
      'billing',
    ]);
    impl.mockImplementation((step) =>
      step === 'billing'
        ? Promise.reject(Object.assign(new Error(), { code: status.INTERNAL }))
        : complete(),
    );

    await runner.runJob('o1');

    expect(impl.mock.calls.map((c) => c[0])).not.toContain('permify');
    expect(store.step('o1', 'permify')).toMatchObject({
      status: 'pending',
      attempts: 0,
    });
    // The job waits for billing, not for the permify step it cannot run.
    expect(store.jobs.get('o1')!.nextAttemptAt.getTime()).toBe(T0 + 60_000);

    // Billing recovers: permify follows, then the second pass resets both.
    jest.setSystemTime(T0 + 60_000);
    impl.mockImplementation(() => complete());
    await runner.runJob('o1');
    expect(store.jobs.get('o1')!.pass).toBe(2);

    jest.setSystemTime(T0 + 60_000 + PURGE_SECOND_PASS_DELAY_MS);
    const order: string[] = [];
    impl.mockImplementation((step) => {
      order.push(step);
      return step === 'billing'
        ? Promise.reject(Object.assign(new Error(), { code: status.INTERNAL }))
        : complete();
    });
    await runner.runJob('o1');
    expect(order).toContain('billing');
    expect(order).not.toContain('permify');
    expect(store.jobs.get('o1')!.status).toBe('pending');
  });

  it('sends the team ids of an organization job', async () => {
    store.addJob('organization', 'o1', {}, ['file_management']);
    await runner.runJob('o1');
    expect(impl.mock.calls[0][1]).toMatchObject({
      kind: 'organization',
      subjectId: ORG,
      teamIds: [TEAM],
    });
  });

  it('halts a job whose subject exists', async () => {
    store.addJob('project', 'j1', {}, ['analysis_reporting', 'agent']);
    store.subjects.add(PROJECT);

    await runner.runJob('j1');

    expect(impl).not.toHaveBeenCalled();
    expect(store.jobs.get('j1')!.status).toBe('halted');
    expect(errors()).toEqual(['DATA_PURGE_SUBJECT_EXISTS job=j1 kind=project']);

    // A halted job is never run again, and every run reports it, whatever
    // its age: it waits for an operator, not for another call.
    await runner.runDue(new Date(T0 + 60_000));
    jest.setSystemTime(T0 + PURGE_STUCK_AFTER_MS * 2);
    await runner.runDue();
    expect(impl).not.toHaveBeenCalled();
    expect(errors()).toEqual([
      'DATA_PURGE_SUBJECT_EXISTS job=j1 kind=project',
      'DATA_PURGE_STUCK job=j1 kind=project step=agent attempts=0 code=HALTED',
      'DATA_PURGE_STUCK job=j1 kind=project step=agent attempts=0 code=HALTED',
    ]);
  });

  it('does not run a job leased by another runner', async () => {
    store.addJob('project', 'j1', {
      leaseUntil: new Date(T0 + 5 * 60_000),
      leaseToken: 'other-runner',
    });

    await runner.runJob('j1');
    const summary = await runner.runDue(new Date(T0));

    expect(impl).not.toHaveBeenCalled();
    expect(summary).toEqual({ jobs: 0, stepsDone: 0, stepsFailed: 0 });
    // The other runner's lease is left alone.
    expect(store.jobs.get('j1')!.leaseToken).toBe('other-runner');

    // Once its lease has expired, the job is claimed again.
    jest.setSystemTime(T0 + 5 * 60_000 + 1);
    await runner.runJob('j1');
    expect(impl).toHaveBeenCalledTimes(CORE_PURGE_STEPS.project.length);
  });

  it('claims a job for 10 minutes and renews the lease every minute while it works', async () => {
    store.addJob('project', 'j1', {}, ['analysis_reporting']);
    let leaseSeen: number | null = null;
    let calls = 0;
    impl.mockImplementation(async () => {
      calls += 1;
      if (calls === 1) leaseSeen = store.jobs.get('j1')!.leaseUntil!.getTime();
      // Each call takes 90 s: past the first renewal of the lease.
      await new Promise((resolve) => setTimeout(resolve, 90_000));
      return { complete: calls === 15, deleted: {} };
    });

    const run = runner.runJob('j1');
    await jest.advanceTimersByTimeAsync(15 * 90_000);
    await run;

    expect(PURGE_LEASE_MS).toBe(600_000);
    expect(leaseSeen).toBe(T0 + PURGE_LEASE_MS);
    // 22.5 minutes of work: far past a 10 min lease, still ours throughout.
    expect(calls).toBe(15);
    expect(store.renewals).toBeGreaterThanOrEqual(22);
    // The step completed and the job moved on to its second pass.
    expect(store.jobs.get('j1')!.pass).toBe(2);
    expect(store.jobs.get('j1')!.leaseToken).toBeNull();
  });

  it('stops starting calls once its lease is lost', async () => {
    store.addJob('project', 'j1', {}, ['analysis_reporting']);
    let calls = 0;
    impl.mockImplementation(async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 45_000));
      return { complete: false, deleted: { rows: 1 } };
    });

    const run = runner.runJob('j1');
    // A cron run took the job over (its lease had expired, say).
    await jest.advanceTimersByTimeAsync(30_000);
    store.jobs.get('j1')!.leaseToken = 'cron-runner';
    await jest.advanceTimersByTimeAsync(10 * 60_000);
    await run;

    // The first renewal at 60 s fails: the call started at 45 s finishes,
    // no call starts after it.
    expect(calls).toBe(2);
    expect(store.step('j1', 'analysis_reporting').status).toBe('pending');
    // The other runner's lease and the job are left as they are.
    const job = store.jobs.get('j1')!;
    expect(job.leaseToken).toBe('cron-runner');
    expect(job.pass).toBe(1);
  });

  it('logs DATA_PURGE_STUCK for a job older than 7 days, with its failing step', async () => {
    store.addJob(
      'project',
      'old',
      {
        deletedAt: new Date(T0 - PURGE_STUCK_AFTER_MS - 1),
      },
      ['analysis_reporting', 'agent'],
    );
    store.addJob(
      'project',
      'young',
      {
        deletedAt: new Date(T0 - PURGE_STUCK_AFTER_MS + 60 * 60_000),
      },
      ['analysis_reporting', 'agent'],
    );
    impl.mockImplementation((step) =>
      step === 'agent'
        ? Promise.reject(
            Object.assign(new Error(), { code: status.UNAVAILABLE }),
          )
        : complete(),
    );

    await runner.runDue(new Date(T0));
    await runner.runDue(new Date(T0));
    jest.setSystemTime(T0 + 30 * 60_000);
    await runner.runDue(new Date(T0 + 30 * 60_000));

    expect(PURGE_STUCK_AFTER_MS).toBe(7 * 86_400_000);
    const stuck = errors().filter((l) => l.startsWith('DATA_PURGE_STUCK'));
    // One line per run, logged before the jobs run: the first run has seen
    // no failure yet; then the failing step with its code.
    expect(stuck).toEqual([
      'DATA_PURGE_STUCK job=old kind=project step=agent attempts=0 code=INCOMPLETE',
      'DATA_PURGE_STUCK job=old kind=project step=agent attempts=1 code=UNAVAILABLE',
      'DATA_PURGE_STUCK job=old kind=project step=agent attempts=1 code=UNAVAILABLE',
    ]);
  });

  it('logs DATA_PURGE_STUCK for a job whose step answers complete: false forever', async () => {
    store.addJob(
      'project',
      'old',
      { deletedAt: new Date(T0 - PURGE_STUCK_AFTER_MS - 1) },
      ['analysis_reporting', 'agent'],
    );
    impl.mockImplementation((step) =>
      step === 'agent'
        ? Promise.resolve({ complete: false, deleted: { rows: 1 } })
        : complete(),
    );

    await runner.runDue(new Date(T0));
    await runner.runDue(new Date(T0));

    const stuck = errors().filter((l) => l.startsWith('DATA_PURGE_STUCK'));
    expect(stuck).toEqual([
      // First run: both pending, none failing; the one due earliest, by name.
      'DATA_PURGE_STUCK job=old kind=project step=agent attempts=0 code=INCOMPLETE',
      // Then the step that never completes, with no error code.
      'DATA_PURGE_STUCK job=old kind=project step=agent attempts=0 code=INCOMPLETE',
    ]);
    expect(store.step('old', 'agent')).toMatchObject({
      status: 'pending',
      attempts: 0,
      lastErrorCode: null,
    });
  });

  it('logs every stuck job, before any job runs, even when the job loop then throws', async () => {
    store.addJob(
      'project',
      'a',
      {
        deletedAt: new Date(T0 - PURGE_STUCK_AFTER_MS - 1),
      },
      ['analysis_reporting', 'agent'],
    );
    store.addJob('team', 'b', {
      deletedAt: new Date(T0 - PURGE_STUCK_AFTER_MS - 1),
      nextAttemptAt: new Date(T0 + 60_000),
    });
    jest
      .spyOn(store, 'dueJobIds')
      .mockRejectedValue(new Error('ER_CON_COUNT_ERROR'));

    await expect(runner.runDue(new Date(T0))).rejects.toThrow();

    expect(errors().filter((l) => l.startsWith('DATA_PURGE_STUCK'))).toEqual([
      'DATA_PURGE_STUCK job=a kind=project step=agent attempts=0 code=INCOMPLETE',
      'DATA_PURGE_STUCK job=b kind=team step=analysis_reporting attempts=0 code=INCOMPLETE',
    ]);
    expect(impl).not.toHaveBeenCalled();
  });

  it(`claims no new job once the run has spent ${PURGE_RUN_BUDGET_MS} ms`, async () => {
    expect(PURGE_RUN_BUDGET_MS).toBe(2_400_000);
    for (const id of ['j1', 'j2', 'j3']) {
      store.addJob('project', id, {}, ['analysis_reporting']);
    }
    // Each job takes 25 min: j2 starts at 25 min, j3 would start at 50.
    impl.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25 * 60_000));
      return { complete: true, deleted: {} };
    });
    const claim = jest.spyOn(store, 'claim');

    const run = runner.runDue(new Date(T0));
    await jest.advanceTimersByTimeAsync(60 * 60_000);
    const summary = await run;

    expect(claim.mock.calls.map((c) => c[0])).toEqual(['j1', 'j2']);
    expect(summary.jobs).toBe(2);
    expect(store.jobs.get('j3')!.pass).toBe(1);
    expect(store.jobs.get('j3')!.leaseToken).toBeNull();
  });

  it('a step write made after the lease is lost changes nothing', async () => {
    store.addJob('project', 'j1', {}, ['analysis_reporting']);
    impl.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30_000));
      return { complete: true, deleted: { rows: 7 } };
    });

    const run = runner.runJob('j1');
    // Another runner took the job over while the call was in flight.
    await jest.advanceTimersByTimeAsync(10_000);
    store.jobs.get('j1')!.leaseToken = 'other-runner';
    await jest.advanceTimersByTimeAsync(30_000);
    await run;

    expect(store.step('j1', 'analysis_reporting')).toMatchObject({
      status: 'pending',
      doneAt: null,
      deleted: null,
    });
    expect(store.jobs.get('j1')).toMatchObject({
      pass: 1,
      leaseToken: 'other-runner',
    });
  });

  it('a pass-1 runner can never mark a pass-2 step done', async () => {
    store.addJob('project', 'j1', {}, ['analysis_reporting', 'agent']);
    store.refuseRenewals = true;
    // Runner A: its agent call hangs past its lease.
    let releaseA!: () => void;
    impl.mockImplementation((step) =>
      step === 'agent'
        ? new Promise((resolve) => {
            releaseA = () => resolve({ complete: true, deleted: { a: 1 } });
          })
        : complete(),
    );
    const runA = runner.runJob('j1');
    await jest.advanceTimersByTimeAsync(PURGE_LEASE_MS + 1);

    // Runner B claims the expired job, finishes pass 1, resets for pass 2.
    const runnerB = new DataPurgeRunner(
      store as unknown as DataPurgeStore,
      { runStep: () => complete({ b: 1 }) } as unknown as DataPurgeSteps,
      logger as unknown as Logger,
    );
    await runnerB.runJob('j1');
    expect(store.jobs.get('j1')!.pass).toBe(2);

    // A's call answers now: its `done` must not land on the pass-2 row.
    releaseA();
    await runA;

    expect(store.step('j1', 'agent')).toMatchObject({
      status: 'pending',
      doneAt: null,
      deleted: { b: 1 },
    });
    expect(store.jobs.get('j1')!.status).toBe('pending');
  });

  it('releases the lease only once the slowest call has settled', async () => {
    store.addJob('project', 'j1', {}, ['analysis_reporting', 'agent']);
    // The fast step's write fails at once; the other call runs 2 minutes.
    store.failingWrite = 'analysis_reporting';
    let slowSettledAt = 0;
    impl.mockImplementation(async (step) => {
      if (step === 'agent') {
        await new Promise((resolve) => setTimeout(resolve, 120_000));
        slowSettledAt = Date.now();
      }
      return { complete: true, deleted: {} };
    });

    const run = runner.runJob('j1');
    const settled = expect(run).rejects.toThrow('ER_LOCK_WAIT_TIMEOUT');
    await jest.advanceTimersByTimeAsync(130_000);
    await settled;

    expect(slowSettledAt).toBe(T0 + 120_000);
    expect(store.releasedAt).toHaveLength(1);
    expect(store.releasedAt[0]).toBeGreaterThanOrEqual(slowSettledAt);
    // The slow step's write still went through under the lease.
    expect(store.step('j1', 'agent').status).toBe('done');
  });

  it('runDue runs the due jobs and counts their steps', async () => {
    store.addJob('project', 'a', {}, ['analysis_reporting', 'agent']);
    store.addJob('team', 'b');
    store.addJob('project', 'later', {
      nextAttemptAt: new Date(T0 + 60_000),
    });
    impl.mockImplementation((step, job) =>
      job.id === 'a' && step === 'agent'
        ? Promise.reject(
            Object.assign(new Error(), { code: status.UNAVAILABLE }),
          )
        : complete(),
    );

    const summary = await runner.runDue(new Date(T0));

    expect(summary).toEqual({
      jobs: 2,
      stepsDone: 1 + CORE_PURGE_STEPS.team.length,
      stepsFailed: 1,
    });
    expect(impl.mock.calls.some((c) => c[1].id === 'later')).toBe(false);
  });

  it('runDue rejects when the ledger cannot be read', async () => {
    jest
      .spyOn(store, 'dueJobIds')
      .mockRejectedValue(new Error('ER_CON_COUNT_ERROR'));
    await expect(runner.runDue(new Date(T0))).rejects.toThrow();
  });

  it('kick runs the jobs in the background, one after the other, and swallows their errors', async () => {
    store.addJob('project', 'j1', {}, ['analysis_reporting']);
    store.addJob('project', 'j2', {}, ['analysis_reporting']);
    let inFlight = 0;
    let maxInFlight = 0;
    impl.mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return { complete: true, deleted: {} };
    });
    jest.spyOn(store, 'getJob').mockRejectedValueOnce(new Error('ER_X'));

    expect(runner.kick(['j0-missing', 'j1', 'j2'])).toBeUndefined();
    await jest.advanceTimersByTimeAsync(0);

    expect(maxInFlight).toBe(1);
    // j1's read failed: logged by class, the next job still runs.
    expect(store.jobs.get('j2')!.pass).toBe(2);
    expect(errors().some((l) => l.includes('error=Error'))).toBe(true);
    expect(allLogs()).not.toContain('ER_X');
  });
});
