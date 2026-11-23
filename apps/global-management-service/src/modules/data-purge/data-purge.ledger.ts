import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { DataPurgeJob, PurgeKind } from '../../entities/data-purge-job.entity';
import {
  DataPurgeStep,
  PurgeStepName,
} from '../../entities/data-purge-step.entity';
import { PURGE_STEPS } from '../../edition/ports/purge-steps.port';
import type { PurgeStepsPort } from '../../edition/ports/purge-steps.port';

export type { PurgeKind } from '../../entities/data-purge-job.entity';
export type { PurgeStepName } from '../../entities/data-purge-step.entity';

/**
 * The steps the core runs itself, the Community list of each kind of job:
 * the steps of the closed edition come from the
 * PURGE_STEPS port. A team's projects get their
 * own project jobs (deleteTeam deletes each through deleteProject), and so do
 * an organization's.
 */
export const CORE_PURGE_STEPS: Record<PurgeKind, readonly PurgeStepName[]> = {
  project: [
    'analysis_reporting',
    'security_scanning',
    'file_management',
    'integrations',
    'policy',
    'permify',
  ],
  team: ['analysis_reporting', 'file_management', 'policy'],
  organization: [
    'analysis_reporting',
    'file_management',
    'integrations',
    'policy',
    'permify',
  ],
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Rows per INSERT: an organization of thousands of projects stays bounded. */
const INSERT_CHUNK = 500;

interface JobToWrite {
  kind: PurgeKind;
  subjectId: string;
  organizationId: string;
  teamIds: string[] | null;
}

/**
 * Records purge jobs. Every method takes the EntityManager of the caller's
 * transaction: the job is written with the deletes it stands for, or not at
 * all. It writes and never runs anything (the runner does).
 */
@Injectable()
export class DataPurgeLedger {
  constructor(
    @Inject(PURGE_STEPS) private readonly purgeSteps: PurgeStepsPort,
  ) {}

  async enqueueProject(
    manager: EntityManager,
    p: { projectId: string; organizationId: string },
  ): Promise<string> {
    const [id] = await this.enqueue(manager, [
      {
        kind: 'project',
        subjectId: p.projectId,
        organizationId: p.organizationId,
        teamIds: null,
      },
    ]);
    return id;
  }

  async enqueueTeam(
    manager: EntityManager,
    p: { teamId: string; organizationId: string },
  ): Promise<string> {
    const [id] = await this.enqueue(manager, [
      {
        kind: 'team',
        subjectId: p.teamId,
        organizationId: p.organizationId,
        teamIds: null,
      },
    ]);
    return id;
  }

  /** The organization job first, then one project job each. */
  async enqueueOrganization(
    manager: EntityManager,
    p: { organizationId: string; teamIds: string[]; projectIds: string[] },
  ): Promise<string[]> {
    for (const teamId of p.teamIds) assertUuid(teamId);
    return this.enqueue(manager, [
      {
        kind: 'organization',
        subjectId: p.organizationId,
        organizationId: p.organizationId,
        teamIds: [...p.teamIds],
      },
      ...p.projectIds.map(
        (projectId): JobToWrite => ({
          kind: 'project',
          subjectId: projectId,
          organizationId: p.organizationId,
          teamIds: null,
        }),
      ),
    ]);
  }

  private async enqueue(
    manager: EntityManager,
    jobs: JobToWrite[],
  ): Promise<string[]> {
    // Every id reaches a WHERE or a bucket prefix downstream: an empty or
    // malformed one is refused before anything is written, which rolls the
    // caller's deletion back.
    for (const job of jobs) {
      assertUuid(job.subjectId);
      assertUuid(job.organizationId);
    }

    const now = new Date();
    const rows: Partial<DataPurgeJob>[] = jobs.map((job) => ({
      id: randomUUID(),
      kind: job.kind,
      subjectId: job.subjectId,
      organizationId: job.organizationId,
      teamIds: job.teamIds,
      deletedAt: now,
      status: 'pending',
      pass: 1,
      nextAttemptAt: now,
      leaseUntil: null,
      leaseToken: null,
      completedAt: null,
    }));
    const steps: Partial<DataPurgeStep>[] = rows.flatMap((row) =>
      this.purgeSteps.steps[row.kind].map((step) => ({
        jobId: row.id,
        step,
        status: 'pending' as const,
        attempts: 0,
        nextAttemptAt: now,
        lastErrorCode: null,
        doneAt: null,
        deleted: null,
      })),
    );

    // updateEntity(false): the keys are ours, and MySQL's re-select of a
    // multi-row insert can hand a row another row's id.
    for (const chunk of chunks(rows)) {
      await manager
        .createQueryBuilder()
        .insert()
        .into(DataPurgeJob)
        .values(chunk)
        .updateEntity(false)
        .callListeners(false)
        .execute();
    }
    for (const chunk of chunks(steps)) {
      await manager
        .createQueryBuilder()
        .insert()
        .into(DataPurgeStep)
        .values(chunk)
        .updateEntity(false)
        .callListeners(false)
        .execute();
    }
    return rows.map((row) => row.id);
  }
}

function assertUuid(id: string): void {
  if (typeof id !== 'string' || !UUID.test(id)) {
    throw new Error('DATA_PURGE_INVALID_ID');
  }
}

function chunks<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += INSERT_CHUNK) {
    out.push(items.slice(i, i + INSERT_CHUNK));
  }
  return out;
}
