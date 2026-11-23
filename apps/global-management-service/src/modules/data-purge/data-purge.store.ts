import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  ident,
  inList,
  run,
  sql,
  updateJoin,
  type Row,
  type Sql,
} from '@cybedefend/db-dialect';
import { DataPurgeJob, PurgeKind } from '../../entities/data-purge-job.entity';
import {
  DataPurgeStep,
  PurgeStepName,
} from '../../entities/data-purge-step.entity';

/** A job's row, without its relation. */
export type PurgeJobRow = Omit<DataPurgeJob, 'steps'>;
/** A step's row, without its relation. */
export type PurgeStepRow = Omit<DataPurgeStep, 'job'>;

/**
 * A job still pending long after its deletion, or halted (whatever its age),
 * with the pending step it is reported by (null when no step is pending: the
 * pass awaits its runner).
 */
export interface StuckPurgeJob {
  jobId: string;
  kind: PurgeKind;
  step: PurgeStepName | null;
  attempts: number | null;
  lastErrorCode: string | null;
  /** Halted: its subject was found again; no run will touch it. */
  halted: boolean;
}

interface StuckRow {
  jobId: string;
  kind: PurgeKind;
  step: PurgeStepName | null;
  attempts: number | string | null;
  lastErrorCode: string | null;
  nextAttemptAt: Date | string | null;
}

/** The table of each subject: the runner checks it is gone before a run. */
const SUBJECT_TABLES: Record<PurgeKind, string> = {
  project: 'project',
  team: 'team',
  organization: 'organization',
};

/** The columns the runner writes, and how each is sent. */
const JOB_COLUMNS = new Set<keyof PurgeJobRow>([
  'status',
  'pass',
  'nextAttemptAt',
  'completedAt',
]);
const STEP_COLUMNS = new Set<keyof PurgeStepRow>([
  'status',
  'attempts',
  'nextAttemptAt',
  'lastErrorCode',
  'doneAt',
  'deleted',
]);
const JSON_COLUMNS = new Set<string>(['deleted']);

/**
 * The purge ledger as the runner reads and writes it. Every write that
 * decides who runs a job is one conditional UPDATE: the claim takes a free
 * lease on a due job; the renewal holds only while the lease token is still
 * ours; every job and step write also only while that lease has not expired
 * (a runner whose lease lapsed, its calls still in flight, can never
 * write over the next runner's pass). `run(...).affected` counts the rows
 * matched on both engines (mysql2 FOUND rows, pg rowCount), so
 * `affected === 1` means the row matched, i.e. the lease matched.
 */
@Injectable()
export class DataPurgeStore {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async dueJobIds(now: Date, limit: number): Promise<string[]> {
    const { rows } = await run(
      this.dataSource,
      sql`SELECT ${c('id')} FROM ${c('data_purge_job')} WHERE ${c('status')} = 'pending' AND ${c('nextAttemptAt')} <= ${now} AND (${c('leaseUntil')} IS NULL OR ${c('leaseUntil')} < ${now}) ORDER BY ${c('nextAttemptAt')} ASC LIMIT ${positive(limit)}`,
    );
    return rows.map((r) => String(r.id));
  }

  /**
   * Every pending job deleted before `deletedBefore`, and every halted job
   * whatever its age (it waits for an operator), one entry each, with
   * the pending step it is reported by: a failing step first (most attempts),
   * else the one due earliest. All the steps of a pass are pending since the
   * same moment, so « oldest » cannot tell them apart; a failing step says
   * more than one that only needs another call.
   */
  async stuckJobs(
    deletedBefore: Date,
    limit: number,
  ): Promise<StuckPurgeJob[]> {
    const jobs = (
      await run(
        this.dataSource,
        sql`SELECT ${c('id')}, ${c('kind')}, ${c('status')} FROM ${c('data_purge_job')} WHERE (${c('status')} = 'pending' AND ${c('deletedAt')} < ${deletedBefore}) OR ${c('status')} = 'halted' ORDER BY ${c('deletedAt')} ASC LIMIT ${positive(limit)}`,
      )
    ).rows as unknown as { id: string; kind: PurgeKind; status: string }[];
    if (jobs.length === 0) return [];
    const rows = (
      await run(
        this.dataSource,
        sql`SELECT ${c('jobId')}, ${c('step')}, ${c('attempts')}, ${c('lastErrorCode')}, ${c('nextAttemptAt')} FROM ${c('data_purge_step')} WHERE ${c('status')} = 'pending' AND ${c('jobId')} IN ${inList(jobs.map((j) => j.id))}`,
      )
    ).rows as unknown as StuckRow[];
    return jobs.map((job) => {
      const pending = rows
        .filter((r) => r.jobId === job.id)
        .sort(
          (a, b) =>
            Number(a.lastErrorCode === null) -
              Number(b.lastErrorCode === null) ||
            Number(b.attempts) - Number(a.attempts) ||
            new Date(a.nextAttemptAt as Date).getTime() -
              new Date(b.nextAttemptAt as Date).getTime() ||
            String(a.step).localeCompare(String(b.step)),
        );
      const step = pending[0];
      return {
        jobId: job.id,
        kind: job.kind,
        step: step?.step ?? null,
        attempts: step ? Number(step.attempts) : null,
        lastErrorCode: step?.lastErrorCode ?? null,
        halted: job.status === 'halted',
      };
    });
  }

  async claim(
    jobId: string,
    token: string,
    now: Date,
    leaseUntil: Date,
  ): Promise<boolean> {
    const affected = await this.execute(
      sql`UPDATE ${c('data_purge_job')} SET ${c('leaseUntil')} = ${leaseUntil}, ${c('leaseToken')} = ${token} WHERE ${c('id')} = ${jobId} AND ${c('status')} = 'pending' AND ${c('nextAttemptAt')} <= ${now} AND (${c('leaseUntil')} IS NULL OR ${c('leaseUntil')} < ${now})`,
    );
    return affected === 1;
  }

  async renew(
    jobId: string,
    token: string,
    leaseUntil: Date,
  ): Promise<boolean> {
    const affected = await this.execute(
      sql`UPDATE ${c('data_purge_job')} SET ${c('leaseUntil')} = ${leaseUntil} WHERE ${c('id')} = ${jobId} AND ${c('leaseToken')} = ${token}`,
    );
    return affected === 1;
  }

  async release(jobId: string, token: string): Promise<void> {
    await this.execute(
      sql`UPDATE ${c('data_purge_job')} SET ${c('leaseUntil')} = NULL, ${c('leaseToken')} = NULL WHERE ${c('id')} = ${jobId} AND ${c('leaseToken')} = ${token}`,
    );
  }

  async getJob(jobId: string): Promise<PurgeJobRow | null> {
    return this.dataSource
      .getRepository(DataPurgeJob)
      .findOne({ where: { id: jobId } });
  }

  async getSteps(jobId: string): Promise<PurgeStepRow[]> {
    return this.dataSource
      .getRepository(DataPurgeStep)
      .find({ where: { jobId } });
  }

  /**
   * A step write, applied only while `token` holds the job's lease and the
   * lease has not expired. False: another runner owns the job now.
   */
  async updateStep(
    jobId: string,
    token: string,
    step: PurgeStepName,
    patch: Partial<PurgeStepRow>,
  ): Promise<boolean> {
    const set = setRow(patch, STEP_COLUMNS);
    if (!set) return false;
    const affected = await this.execute(
      updateJoin({
        table: 'data_purge_step',
        alias: 's',
        join: {
          table: 'data_purge_job',
          alias: 'j',
          on: sql`${c('j.id')} = ${c('s.jobId')}`,
        },
        set,
        where: sql`${c('s.jobId')} = ${jobId} AND ${c('s.step')} = ${step} AND ${c('j.leaseToken')} = ${token} AND ${c('j.leaseUntil')} > ${new Date()}`,
      }),
    );
    return affected === 1;
  }

  /** A job write, applied only while `token` holds an unexpired lease. */
  async updateJob(
    jobId: string,
    token: string,
    patch: Partial<PurgeJobRow>,
  ): Promise<boolean> {
    const set = setRow(patch, JOB_COLUMNS);
    if (!set) return false;
    const affected = await this.execute(
      sql`UPDATE ${c('data_purge_job')} SET ${setList(set)} WHERE ${c('id')} = ${jobId} AND ${c('leaseToken')} = ${token} AND ${c('leaseUntil')} > ${new Date()}`,
    );
    return affected === 1;
  }

  async subjectExists(kind: PurgeKind, subjectId: string): Promise<boolean> {
    const table = SUBJECT_TABLES[kind];
    if (!table) throw new Error('DATA_PURGE_UNKNOWN_KIND');
    // COUNT(*) is a string on both engines (mysql2 BIGINT, pg int8).
    const { rows } = await run(
      this.dataSource,
      sql`SELECT COUNT(*) AS ${c('cnt')} FROM ${c(table)} WHERE ${c('id')} = ${subjectId}`,
    );
    return Number(rows[0]?.cnt ?? 0) > 0;
  }

  /** One statement, and the number of rows it matched. */
  private async execute(statement: Sql): Promise<number> {
    return (await run(this.dataSource, statement)).affected;
  }
}

const c = ident;

/** The written columns of `patch`, each value as sent (JSON as text); null if none. */
function setRow(
  patch: Record<string, unknown>,
  allowed: Set<string>,
): Row | null {
  const keys = Object.keys(patch).filter((k) => patch[k] !== undefined);
  for (const key of keys) {
    if (!allowed.has(key)) throw new Error(`DATA_PURGE_UNKNOWN_COLUMN ${key}`);
  }
  if (keys.length === 0) return null;
  const row: Row = {};
  for (const k of keys) {
    row[k] =
      JSON_COLUMNS.has(k) && patch[k] !== null
        ? JSON.stringify(patch[k])
        : patch[k];
  }
  return row;
}

/** `col1` = ?, `col2` = ? for a single-table SET. */
function setList(set: Row): Sql {
  return Object.keys(set)
    .map((k) => sql`${c(k)} = ${set[k]}`)
    .reduce((acc, part) => sql`${acc}, ${part}`);
}

function positive(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error('DATA_PURGE_INVALID_LIMIT');
  }
  return limit;
}
