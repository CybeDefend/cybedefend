import { status } from '@grpc/grpc-js';
import { DataSource } from 'typeorm';
import { DataPurgeService } from './data-purge.service';
import { PURGE_BATCH_SIZE } from './purge-tables';

const PROJECT = '11111111-1111-4111-8111-111111111111';
const TEAM = '22222222-2222-4222-8222-222222222222';
const ORG = '33333333-3333-4333-8333-333333333333';
const FAR = () => Date.now() + 60_000;

type Answer = (sql: string, params: unknown[]) => number;

/** TypeORM's postgres `query` answers `[rows, rowCount]` for DELETE and UPDATE. */
function makeService(answer: Answer = () => 0) {
  const query = jest.fn(async (sql: string, params: unknown[]) => [
    [],
    answer(sql, params),
  ]);
  const service = new DataPurgeService({ query } as unknown as DataSource);
  return { service, query };
}

const statements = (query: jest.Mock) =>
  query.mock.calls.map(([sql, params]) => ({
    sql: String(sql).replace(/\s+/g, ' ').trim(),
    params: params as unknown[],
  }));

const invalidArgument = {
  error: expect.objectContaining({ code: status.INVALID_ARGUMENT }),
};

describe('DataPurgeService', () => {
  it("deletes the project's evaluations and violations", async () => {
    const { service, query } = makeService((sql) =>
      sql.startsWith('DELETE') ? 3 : 0,
    );

    const res = await service.purgeProject(PROJECT, ORG, FAR());

    const deletes = statements(query).filter((s) => s.sql.startsWith('DELETE'));
    expect(deletes).toEqual([
      {
        sql: 'DELETE FROM "policy_violations" WHERE "id" IN (SELECT "id" FROM "policy_violations" WHERE "projectId" = $1 LIMIT $2)',
        params: [PROJECT, PURGE_BATCH_SIZE],
      },
      {
        sql: 'DELETE FROM "policy_evaluations" WHERE "id" IN (SELECT "id" FROM "policy_evaluations" WHERE "projectId" = $1 LIMIT $2)',
        params: [PROJECT, PURGE_BATCH_SIZE],
      },
    ]);
    expect(res.complete).toBe(true);
    expect(res.deleted.policy_violations).toBe(3);
    expect(res.deleted.policy_evaluations).toBe(3);
  });

  it("removes the project from every policy's targets and keeps the policy", async () => {
    const { service, query } = makeService((sql) =>
      sql.startsWith('UPDATE') ? 2 : 0,
    );

    const res = await service.purgeProject(PROJECT, ORG, FAR());

    const all = statements(query);
    expect(
      all.some((s) => s.sql.includes('DELETE FROM "security_policies"')),
    ).toBe(false);
    const updates = all.filter((s) => s.sql.startsWith('UPDATE'));
    expect(updates).toEqual([
      {
        sql: 'UPDATE "security_policies" SET "projectIds" = "projectIds" - $2::text WHERE "id" IN (SELECT "id" FROM "security_policies" WHERE "projectIds" @> $1::jsonb LIMIT $3)',
        params: [JSON.stringify([PROJECT]), PROJECT, PURGE_BATCH_SIZE],
      },
    ]);
    expect(res.deleted['security_policies.projectIds']).toBe(2);
    expect(res.complete).toBe(true);
  });

  it("removes the team from every policy's targets", async () => {
    const { service, query } = makeService((sql) =>
      sql.startsWith('UPDATE') ? 1 : 0,
    );

    const res = await service.purgeTeam(TEAM, ORG, FAR());

    expect(statements(query)).toEqual([
      {
        sql: 'UPDATE "security_policies" SET "teamIds" = "teamIds" - $2::text WHERE "id" IN (SELECT "id" FROM "security_policies" WHERE "teamIds" @> $1::jsonb LIMIT $3)',
        params: [JSON.stringify([TEAM]), TEAM, PURGE_BATCH_SIZE],
      },
    ]);
    expect(res).toEqual({
      complete: true,
      deleted: { 'security_policies.teamIds': 1 },
    });
  });

  it("deletes the organization's policies and evaluations", async () => {
    const { service, query } = makeService((sql) =>
      sql.startsWith('DELETE') ? 5 : 0,
    );

    const res = await service.purgeOrganization(ORG, [TEAM], FAR());

    const tables = statements(query).map((s) => {
      expect(s.params).toEqual([ORG, PURGE_BATCH_SIZE]);
      expect(s.sql).toMatch(/WHERE "organizationId" = \$1 LIMIT \$2\)$/);
      return /^DELETE FROM "([a-z_]+)"/.exec(s.sql)?.[1];
    });
    // Violations go first, in batches, so the policies' cascade stays bounded.
    expect(tables).toEqual([
      'policy_violations',
      'policy_evaluations',
      'security_policies',
    ]);
    expect(res).toEqual({
      complete: true,
      deleted: {
        policy_violations: 5,
        policy_evaluations: 5,
        security_policies: 5,
      },
    });
  });

  describe('refuses a malformed id and deletes nothing', () => {
    const bad = ['', 'x', '%', '*', 'reports', '../etc', `${PROJECT} OR 1=1`];

    it.each(bad)('project id %p', async (id) => {
      const { service, query } = makeService();
      await expect(service.purgeProject(id, ORG, FAR())).rejects.toMatchObject(
        invalidArgument,
      );
      expect(query).not.toHaveBeenCalled();
    });

    it.each(bad)('team id %p', async (id) => {
      const { service, query } = makeService();
      await expect(service.purgeTeam(id, ORG, FAR())).rejects.toMatchObject(
        invalidArgument,
      );
      expect(query).not.toHaveBeenCalled();
    });

    it.each(bad)('organization id %p', async (id) => {
      const { service, query } = makeService();
      await expect(
        service.purgeOrganization(id, [], FAR()),
      ).rejects.toMatchObject(invalidArgument);
      await expect(
        service.purgeProject(PROJECT, id, FAR()),
      ).rejects.toMatchObject(invalidArgument);
      await expect(service.purgeTeam(TEAM, id, FAR())).rejects.toMatchObject(
        invalidArgument,
      );
      expect(query).not.toHaveBeenCalled();
    });

    it('a malformed team id of an organization purge', async () => {
      const { service, query } = makeService();
      await expect(
        service.purgeOrganization(ORG, [TEAM, '*'], FAR()),
      ).rejects.toMatchObject(invalidArgument);
      expect(query).not.toHaveBeenCalled();
    });
  });

  describe('stops at the deadline and resumes', () => {
    it('runs exactly one statement once the deadline has passed', async () => {
      const { service, query } = makeService(() => PURGE_BATCH_SIZE);

      const res = await service.purgeProject(PROJECT, ORG, Date.now() - 1);

      expect(query).toHaveBeenCalledTimes(1);
      expect(res).toEqual({
        complete: false,
        deleted: { policy_violations: PURGE_BATCH_SIZE },
      });
    });

    it('the next call continues where the last stopped', async () => {
      let left = PURGE_BATCH_SIZE + 10;
      const { service } = makeService((sql) => {
        if (!sql.includes('"policy_violations"')) return 0;
        const n = Math.min(left, PURGE_BATCH_SIZE);
        left -= n;
        return n;
      });

      const first = await service.purgeProject(PROJECT, ORG, Date.now() - 1);
      expect(first.complete).toBe(false);
      const second = await service.purgeProject(PROJECT, ORG, FAR());
      expect(second.complete).toBe(true);
      expect(second.deleted.policy_violations).toBe(10);
    });

    it('loops on a full batch while time remains', async () => {
      let left = 2 * PURGE_BATCH_SIZE + 1;
      const { service, query } = makeService((sql) => {
        if (!sql.includes('"policy_evaluations"')) return 0;
        const n = Math.min(left, PURGE_BATCH_SIZE);
        left -= n;
        return n;
      });

      const res = await service.purgeOrganization(ORG, [], FAR());

      expect(res.complete).toBe(true);
      expect(res.deleted.policy_evaluations).toBe(2 * PURGE_BATCH_SIZE + 1);
      expect(query).toHaveBeenCalledTimes(1 + 3 + 1);
    });

    it('an organization purge stops too', async () => {
      const { service, query } = makeService(() => PURGE_BATCH_SIZE);
      const res = await service.purgeOrganization(ORG, [], Date.now() - 1);
      expect(query).toHaveBeenCalledTimes(1);
      expect(res.complete).toBe(false);
    });

    it('a team purge stops too', async () => {
      const { service, query } = makeService(() => PURGE_BATCH_SIZE);
      const res = await service.purgeTeam(TEAM, ORG, Date.now() - 1);
      expect(query).toHaveBeenCalledTimes(1);
      expect(res.complete).toBe(false);
    });
  });

  it('is idempotent', async () => {
    const { service } = makeService(() => 0);

    expect(await service.purgeProject(PROJECT, ORG, FAR())).toEqual({
      complete: true,
      deleted: {
        policy_violations: 0,
        policy_evaluations: 0,
        'security_policies.projectIds': 0,
      },
    });
    expect(await service.purgeTeam(TEAM, ORG, FAR())).toEqual({
      complete: true,
      deleted: { 'security_policies.teamIds': 0 },
    });
    expect(await service.purgeOrganization(ORG, [], FAR())).toEqual({
      complete: true,
      deleted: {
        policy_violations: 0,
        policy_evaluations: 0,
        security_policies: 0,
      },
    });
  });

  it('fails closed on a database error, with nothing but the code', async () => {
    const query = jest
      .fn()
      .mockRejectedValue(new Error('connection to db-host:5432 refused'));
    const service = new DataPurgeService({ query } as unknown as DataSource);
    await expect(
      service.purgeProject(PROJECT, ORG, FAR()),
    ).rejects.toMatchObject({
      error: { code: status.INTERNAL, message: 'INTERNAL' },
    });
  });

  it.each([
    ['an empty array', []],
    ['rows only', [[]]],
    ['a row count that is not a number', [[], '5']],
    ['an object', { affected: 5 }],
    ['undefined', undefined],
  ])(
    'fails closed on an unknown result shape (%s), never reads it as 0',
    async (_label, answer) => {
      const query = jest.fn().mockResolvedValue(answer);
      const service = new DataPurgeService({ query } as unknown as DataSource);
      await expect(
        service.purgeProject(PROJECT, ORG, FAR()),
      ).rejects.toMatchObject({
        error: { code: status.INTERNAL, message: 'INTERNAL' },
      });
      expect(query).toHaveBeenCalledTimes(1);
    },
  );
});
