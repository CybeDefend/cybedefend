import { status } from '@grpc/grpc-js';
import { RpcException } from '@nestjs/microservices';
import { EntityManager } from 'typeorm';
import { CommunityPurgeSteps } from 'src/edition/community/purge-steps.community';
import type { PurgeStepsPort } from 'src/edition/ports/purge-steps.port';
import {
  CapturedStatement,
  createSqlCaptureDataSource,
} from 'src/test-utils/sql-capture.util';
import { CORE_PURGE_STEPS, DataPurgeLedger } from './data-purge.ledger';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PROJECT = '11111111-1111-4111-8111-111111111111';
const PROJECT_2 = '22222222-2222-4222-8222-222222222222';
const TEAM = '33333333-3333-4333-8333-333333333333';
const TEAM_2 = '44444444-4444-4444-8444-444444444444';
const ORG = '55555555-5555-4555-8555-555555555555';

/**
 * The ledger runs the real TypeORM insert code on a DataSource that never
 * connects: every statement is recorded, so the spec reads the rows it writes.
 */
async function capture(): Promise<{
  manager: EntityManager;
  statements: CapturedStatement[];
}> {
  const { dataSource, statements } = await createSqlCaptureDataSource(() => ({
    affected: 1,
  }));
  return { manager: dataSource.manager, statements };
}

const inserts = (statements: CapturedStatement[], table: string) =>
  // A plain prefix test: no pattern built from a variable (CD-SAST-0434).
  statements.filter((s) =>
    s.sql
      .trimStart()
      .toUpperCase()
      .startsWith(`INSERT INTO \`${table.toUpperCase()}\``),
  );

/** The rows an INSERT wrote, as column → value, read from its SQL and params. */
function rowsOf(statement: CapturedStatement): Record<string, unknown>[] {
  const columns = [
    ...statement.sql.match(/\(([^)]*)\)\s*VALUES/i)![1].matchAll(/`([^`]+)`/g),
  ].map((m) => m[1]);
  const values = /VALUES\s*(.*)$/is.exec(statement.sql)![1];
  const tuples = values.match(/\(([^)]*)\)/g)!;
  const rows: Record<string, unknown>[] = [];
  let p = 0;
  for (const tuple of tuples) {
    const cells = tuple.slice(1, -1).split(',');
    const row: Record<string, unknown> = {};
    cells.forEach((cell, i) => {
      row[columns[i]] =
        cell.trim() === '?' ? statement.params[p++] : cell.trim();
    });
    rows.push(row);
  }
  return rows;
}

const jobRows = (statements: CapturedStatement[]) =>
  inserts(statements, 'data_purge_job').flatMap(rowsOf);
const stepRows = (statements: CapturedStatement[]) =>
  inserts(statements, 'data_purge_step').flatMap(rowsOf);

describe('DataPurgeLedger', () => {
  // The community port: the edition's step list, an edition step refused.
  const communityPort: PurgeStepsPort = new CommunityPurgeSteps();
  const ledger = new DataPurgeLedger(communityPort);
  // Fake timers would replace Date, which the entity metadata reads: the spec
  // brackets the clock instead.
  const at = (value: unknown) => new Date(value as Date).getTime();

  it('names the community steps of each kind', () => {
    expect(CORE_PURGE_STEPS).toEqual({
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
    });
  });

  it('reads the steps of each kind from the port', () => {
    expect(communityPort.steps).toEqual(CORE_PURGE_STEPS);
  });

  it('the community port refuses an edition step', async () => {
    const error = await communityPort
      .runEditionStep('agent', {
        id: 'job-1',
        kind: 'project',
        subjectId: PROJECT,
        organizationId: ORG,
        teamIds: null,
        deletedAt: new Date(),
        status: 'pending',
        pass: 1,
        nextAttemptAt: new Date(),
        leaseUntil: null,
        leaseToken: null,
        completedAt: null,
      })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RpcException);
    expect((error as RpcException).getError()).toMatchObject({
      code: status.INVALID_ARGUMENT,
      message: 'DATA_PURGE_UNKNOWN_STEP',
    });
  });

  it('enqueues a project job with the project steps', async () => {
    const { manager, statements } = await capture();

    const before = Date.now();
    const jobId = await ledger.enqueueProject(manager, {
      projectId: PROJECT,
      organizationId: ORG,
    });
    const after = Date.now();

    expect(jobId).toMatch(UUID);
    const jobs = jobRows(statements);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      id: jobId,
      kind: 'project',
      subjectId: PROJECT,
      organizationId: ORG,
      status: 'pending',
      pass: 1,
    });
    expect(jobs[0].teamIds).toBeNull();
    const deletedAt = at(jobs[0].deletedAt);
    expect(deletedAt).toBeGreaterThanOrEqual(before);
    expect(deletedAt).toBeLessThanOrEqual(after);
    // Due at once: the first run picks it up.
    expect(at(jobs[0].nextAttemptAt)).toBe(deletedAt);

    const steps = stepRows(statements);
    expect(steps.map((s) => s.step)).toEqual([...CORE_PURGE_STEPS.project]);
    for (const step of steps) {
      expect(step).toMatchObject({ jobId, status: 'pending', attempts: 0 });
      expect(at(step.nextAttemptAt)).toBe(deletedAt);
    }
    // The job row is written before its steps (their FK names it).
    const jobAt = statements.indexOf(inserts(statements, 'data_purge_job')[0]);
    const stepAt = statements.indexOf(
      inserts(statements, 'data_purge_step')[0],
    );
    expect(jobAt).toBeLessThan(stepAt);
  });

  it('enqueues a team job', async () => {
    const { manager, statements } = await capture();

    const jobId = await ledger.enqueueTeam(manager, {
      teamId: TEAM,
      organizationId: ORG,
    });

    expect(jobId).toMatch(UUID);
    expect(jobRows(statements)).toEqual([
      expect.objectContaining({
        id: jobId,
        kind: 'team',
        subjectId: TEAM,
        organizationId: ORG,
      }),
    ]);
    expect(stepRows(statements).map((s) => s.step)).toEqual([
      ...CORE_PURGE_STEPS.team,
    ]);
  });

  it('enqueues one organization job and one job per project', async () => {
    const { manager, statements } = await capture();

    const jobIds = await ledger.enqueueOrganization(manager, {
      organizationId: ORG,
      teamIds: [TEAM, TEAM_2],
      projectIds: [PROJECT, PROJECT_2],
    });

    expect(jobIds).toHaveLength(3);
    expect(new Set(jobIds).size).toBe(3);
    const jobs = jobRows(statements);
    // The organization job first, then one project job each.
    expect(jobs.map((j) => [j.id, j.kind, j.subjectId])).toEqual([
      [jobIds[0], 'organization', ORG],
      [jobIds[1], 'project', PROJECT],
      [jobIds[2], 'project', PROJECT_2],
    ]);
    expect(jobs.every((j) => j.organizationId === ORG)).toBe(true);
    expect(JSON.parse(jobs[0].teamIds as string)).toEqual([TEAM, TEAM_2]);
    expect(jobs[1].teamIds).toBeNull();

    const steps = stepRows(statements);
    const stepsOf = (jobId: string) =>
      steps.filter((s) => s.jobId === jobId).map((s) => s.step);
    expect(stepsOf(jobIds[0])).toEqual([...CORE_PURGE_STEPS.organization]);
    expect(stepsOf(jobIds[1])).toEqual([...CORE_PURGE_STEPS.project]);
    expect(stepsOf(jobIds[2])).toEqual([...CORE_PURGE_STEPS.project]);
  });

  it('enqueues an organization with no project and no team', async () => {
    const { manager, statements } = await capture();

    const jobIds = await ledger.enqueueOrganization(manager, {
      organizationId: ORG,
      teamIds: [],
      projectIds: [],
    });

    expect(jobIds).toHaveLength(1);
    expect(JSON.parse(jobRows(statements)[0].teamIds as string)).toEqual([]);
  });

  it('never asks the database for the rows it just wrote', async () => {
    // A multi-row INSERT re-selected without ORDER BY can hand each entity
    // another row's id: the ledger sets every key itself.
    const { manager, statements } = await capture();

    await ledger.enqueueOrganization(manager, {
      organizationId: ORG,
      teamIds: [TEAM],
      projectIds: [PROJECT, PROJECT_2],
    });

    expect(statements.every((s) => /^\s*INSERT/i.test(s.sql))).toBe(true);
  });

  it.each([
    ['an empty project id', () => ({ projectId: '', organizationId: ORG })],
    ['a path', () => ({ projectId: '../reports', organizationId: ORG })],
    [
      'an empty organization id',
      () => ({ projectId: PROJECT, organizationId: '' }),
    ],
  ])('refuses %s and enqueues nothing', async (_label, input) => {
    const { manager, statements } = await capture();

    await expect(ledger.enqueueProject(manager, input())).rejects.toThrow();
    expect(statements).toEqual([]);
  });

  it('refuses an organization whose project or team list holds a malformed id', async () => {
    const { manager, statements } = await capture();

    await expect(
      ledger.enqueueOrganization(manager, {
        organizationId: ORG,
        teamIds: ['*'],
        projectIds: [PROJECT],
      }),
    ).rejects.toThrow();
    await expect(
      ledger.enqueueOrganization(manager, {
        organizationId: ORG,
        teamIds: [TEAM],
        projectIds: [''],
      }),
    ).rejects.toThrow();
    await expect(
      ledger.enqueueTeam(manager, { teamId: 'reports', organizationId: ORG }),
    ).rejects.toThrow();
    expect(statements).toEqual([]);
  });

  it('rejects when the insert fails', async () => {
    const { dataSource, setResponder } = await createSqlCaptureDataSource();
    setResponder(() => {
      throw new Error('ER_LOCK_DEADLOCK');
    });

    await expect(
      ledger.enqueueProject(dataSource.manager, {
        projectId: PROJECT,
        organizationId: ORG,
      }),
    ).rejects.toThrow('ER_LOCK_DEADLOCK');
  });
});
