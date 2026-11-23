import { status } from '@grpc/grpc-js';
import { RpcException } from '@nestjs/microservices';
import { DataSource } from 'typeorm';
import { ScanQueueService } from '../scan-queue/scan-queue.service';
import { OrganizationStatisticsService } from '../organization-statistics/organization-statistics.service';
import { DataPurgeService } from './data-purge.service';
import { PurgeTableExtension } from '../../edition/ports/purge-table-extensions.port';
import {
  ORGANIZATION_PURGE_TABLES,
  PROJECT_PURGE_TABLES,
} from './purge-tables';

const PROJECT_ID = '11111111-2222-4333-8444-555555555555';
const ORG_ID = '66666666-7777-4888-9999-aaaaaaaaaaaa';
const TEAM_ID = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
const OTHER_TEAM_ID = 'cccccccc-dddd-4eee-8fff-000000000000';
const LATER = () => Date.now() + 60_000;

function setup(
  affectedRows: number | ((sql: string) => number) = 0,
  purgeExtensions?: PurgeTableExtension,
) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const query = jest.fn(async (sql: string, _params?: unknown[]) => ({
    affectedRows:
      typeof affectedRows === 'function' ? affectedRows(sql) : affectedRows,
  }));
  const redis = {
    // 0: the keys are already gone, as on a second pass.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    del: jest.fn(async (..._keys: string[]) => 0),
  };
  const scanQueue = { getRedisClient: jest.fn(async () => redis) };
  const statistics = {
    markDirty: jest.fn(async () => undefined),
    markDirtyIfPresent: jest.fn(async () => undefined),
  };
  // run() asks for a structured result (a third argument): the statement
  // and its parameters are what these tests check.
  const dataSource = {
    query: (sql: string, params?: unknown[]) => query(sql, params),
  };
  const service = new DataPurgeService(
    dataSource as unknown as DataSource,
    scanQueue as unknown as ScanQueueService,
    statistics as unknown as OrganizationStatisticsService,
    purgeExtensions,
  );
  return { service, query, redis, statistics };
}

function tableOf(sql: string): string {
  const m = /^DELETE FROM `([a-z_]+)`/.exec(sql);
  if (!m) throw new Error(`not a delete: ${sql}`);
  return m[1];
}

async function rejection(p: Promise<unknown>): Promise<RpcException> {
  try {
    await p;
  } catch (e) {
    return e as RpcException;
  }
  throw new Error('expected a rejection');
}

describe('DataPurgeService', () => {
  it('purges the secret and CI/CD detections', async () => {
    const { service, query } = setup();
    await service.purgeProject(PROJECT_ID, ORG_ID, LATER());

    expect(query).toHaveBeenCalledWith(
      'DELETE FROM `vulnerability_detections_secret` WHERE `projectId` = ? LIMIT ?',
      [PROJECT_ID, 1000],
    );
    expect(query).toHaveBeenCalledWith(
      'DELETE FROM `vulnerability_detections_cicd` WHERE `projectId` = ? LIMIT ?',
      [PROJECT_ID, 1000],
    );
  });

  it('deletes every project table in order', async () => {
    const { service, query, redis } = setup();
    const res = await service.purgeProject(PROJECT_ID, ORG_ID, LATER());

    expect(query.mock.calls.map(([sql]) => tableOf(sql))).toEqual(
      PROJECT_PURGE_TABLES.map((t) => t.table),
    );
    expect(query).toHaveBeenCalledWith(
      'DELETE FROM `project_cyber_risk` WHERE `project_id` = ? LIMIT ?',
      [PROJECT_ID, 1000],
    );
    // The SCA AutoFix keys moved to EE_PURGE_TABLES (ee).
    expect(redis.del).toHaveBeenCalledWith(`cyberisk:dirty:${PROJECT_ID}`);
    // A cvss-recalc job is a BullMQ job id, not a key: left to the queue.
    expect(redis.del).toHaveBeenCalledTimes(1);
    expect(res.complete).toBe(true);
  });

  it('purgeProject without extensions touches only core tables', async () => {
    const { service, query, redis } = setup();
    await service.purgeProject(PROJECT_ID, ORG_ID, LATER());

    expect(query.mock.calls.map(([sql]) => tableOf(sql))).toEqual(
      PROJECT_PURGE_TABLES.map((t) => t.table),
    );
    // The SCA AutoFix keys moved to EE_PURGE_TABLES (ee).
    expect(redis.del).toHaveBeenCalledWith(`cyberisk:dirty:${PROJECT_ID}`);
  });

  it('purgeProject appends the extension tables and keys after the core ones', async () => {
    const ext: PurgeTableExtension = {
      project: [{ table: 'x_t', column: 'projectId' }],
      team: [],
      organization: [],
      projectRedisKeys: (p) => [`x:${p}`],
      organizationRedisKeys: () => [],
    };
    const { service, query, redis } = setup(0, ext);
    const res = await service.purgeProject(PROJECT_ID, ORG_ID, LATER());

    expect(query.mock.calls.map(([sql]) => tableOf(sql))).toEqual([
      ...PROJECT_PURGE_TABLES.map((t) => t.table),
      'x_t',
    ]);
    expect(query).toHaveBeenCalledWith(
      'DELETE FROM `x_t` WHERE `projectId` = ? LIMIT ?',
      [PROJECT_ID, 1000],
    );
    expect(redis.del).toHaveBeenCalledWith(
      `cyberisk:dirty:${PROJECT_ID}`,
      `x:${PROJECT_ID}`,
    );
    expect(res.complete).toBe(true);
  });

  it('loops on a table until a batch comes back short', async () => {
    let secretCalls = 0;
    const { service, query } = setup((sql) => {
      if (!sql.includes('vulnerability_detections_secret')) return 0;
      secretCalls += 1;
      return secretCalls < 3 ? 1000 : 12;
    });
    const res = await service.purgeProject(PROJECT_ID, ORG_ID, LATER());

    expect(secretCalls).toBe(3);
    expect(res.deleted.vulnerability_detections_secret).toBe(2012);
    expect(res.complete).toBe(true);
    expect(query).toHaveBeenCalledTimes(PROJECT_PURGE_TABLES.length + 2);
  });

  it.each([
    [''],
    ['x'],
    ['%'],
    ['*'],
    ['reports'],
    ['../11111111-2222-4333-8444-555555555555'],
    [`${PROJECT_ID}' OR '1'='1`],
  ])('refuses a malformed id and deletes nothing (%p)', async (bad) => {
    const { service, query, redis } = setup();

    for (const call of [
      () => service.purgeProject(bad, ORG_ID, LATER()),
      () => service.purgeTeam(bad, ORG_ID, LATER()),
      () => service.purgeOrganization(bad, [], LATER()),
      () => service.purgeOrganization(ORG_ID, [bad], LATER()),
    ]) {
      const err = await rejection(call());
      expect(err).toBeInstanceOf(RpcException);
      expect(err.getError()).toMatchObject({ code: status.INVALID_ARGUMENT });
    }
    expect(query).not.toHaveBeenCalled();
    expect(redis.del).not.toHaveBeenCalled();
  });

  it('stops at the deadline and resumes', async () => {
    const { service, query, redis } = setup(1000);
    const res = await service.purgeProject(PROJECT_ID, ORG_ID, Date.now() - 1);

    expect(query).toHaveBeenCalledTimes(1);
    expect(tableOf(query.mock.calls[0][0])).toBe(PROJECT_PURGE_TABLES[0].table);
    expect(res.complete).toBe(false);
    expect(res.deleted[PROJECT_PURGE_TABLES[0].table]).toBe(1000);
    expect(redis.del).not.toHaveBeenCalled();

    // The next call continues: once every table answers short, it completes.
    query.mockImplementation(async () => ({ affectedRows: 0 }));
    const next = await service.purgeProject(PROJECT_ID, ORG_ID, LATER());
    expect(next.complete).toBe(true);
  });

  it('is idempotent', async () => {
    const { service } = setup(0);
    const res = await service.purgeProject(PROJECT_ID, ORG_ID, LATER());

    expect(res.complete).toBe(true);
    for (const { table } of PROJECT_PURGE_TABLES) {
      expect(res.deleted[table]).toBe(0);
    }
    expect(Object.values(res.deleted).every((n) => n === 0)).toBe(true);
  });

  it('accepts an empty organization id on a project purge (older callers)', async () => {
    const { service, query } = setup();
    const res = await service.purgeProject(PROJECT_ID, '', LATER());
    expect(res.complete).toBe(true);
    expect(query).toHaveBeenCalled();
  });

  it("purges the team's aggregated reports", async () => {
    const { service, query } = setup(3);
    const res = await service.purgeTeam(TEAM_ID, ORG_ID, LATER());

    expect(query.mock.calls).toEqual([
      [
        "DELETE FROM `aggregated_reports` WHERE `scope_id` = ? AND `scope_type` = 'team' LIMIT ?",
        [TEAM_ID, 1000],
      ],
    ]);
    expect(res).toEqual({ complete: true, deleted: { aggregated_reports: 3 } });
  });

  it("purges the organization's tables and keys", async () => {
    const { service, query, redis } = setup();
    const res = await service.purgeOrganization(ORG_ID, [TEAM_ID], LATER());

    const statements = query.mock.calls.map(([sql, params]) => [sql, params]);
    for (const { table, column, where } of ORGANIZATION_PURGE_TABLES) {
      if (where) continue;
      expect(statements).toContainEqual([
        `DELETE FROM \`${table}\` WHERE \`${column}\` = ? LIMIT ?`,
        [ORG_ID, 1000],
      ]);
    }
    expect(statements).toContainEqual([
      "DELETE FROM `aggregated_reports` WHERE `scope_id` = ? AND `scope_type` = 'team' LIMIT ?",
      [TEAM_ID, 1000],
    ]);
    expect(
      ORGANIZATION_PURGE_TABLES.map((t) => `${t.table}.${t.column}`),
    ).toEqual([
      'aggregated_reports.organization_id',
      'aggregated_reports.scope_id',
      'organization_statistics.organization_id',
      'sca_license_overrides.organizationId',
    ]);
    // The SCA AutoFix live-job set moved to EE_PURGE_TABLES (ee).
    expect(redis.del).toHaveBeenCalledWith(`ovw:gen:${ORG_ID}`);
    expect(res.complete).toBe(true);
    expect(res.deleted.aggregated_reports).toBe(0);
  });

  it('purges the organization-scope and team-scope reports that have no organization id', async () => {
    const { service, query } = setup();
    await service.purgeOrganization(ORG_ID, [TEAM_ID, OTHER_TEAM_ID], LATER());

    const statements = query.mock.calls.map(([sql, params]) => [sql, params]);
    // Rows written before organization_id existed (no backfill): matched by scope.
    expect(statements).toContainEqual([
      "DELETE FROM `aggregated_reports` WHERE `scope_id` = ? AND `scope_type` = 'organization' LIMIT ?",
      [ORG_ID, 1000],
    ]);
    for (const teamId of [TEAM_ID, OTHER_TEAM_ID]) {
      expect(statements).toContainEqual([
        "DELETE FROM `aggregated_reports` WHERE `scope_id` = ? AND `scope_type` = 'team' LIMIT ?",
        [teamId, 1000],
      ]);
    }
  });

  it('purges the legacy batch reports that include the project', async () => {
    const { service, query } = setup();
    await service.purgeProject(PROJECT_ID, ORG_ID, LATER());

    const batch = query.mock.calls.filter(([sql]) =>
      sql.includes("`scope_type` = 'batch'"),
    );
    expect(batch).toEqual([
      [
        "DELETE FROM `aggregated_reports` WHERE FIND_IN_SET(?, `scope_id`) > 0 AND `scope_type` = 'batch' AND `organization_id` IS NULL LIMIT ?",
        [PROJECT_ID, 1000],
      ],
    ]);
    // A batch report with an organization id is the organization's document.
    expect(batch[0][0]).toContain('`organization_id` IS NULL');
  });

  it('marks the organization statistics dirty once the project purge completes', async () => {
    const { service, statistics } = setup();
    const res = await service.purgeProject(PROJECT_ID, ORG_ID, LATER());

    expect(res.complete).toBe(true);
    expect(statistics.markDirtyIfPresent).toHaveBeenCalledTimes(1);
    expect(statistics.markDirtyIfPresent).toHaveBeenCalledWith(ORG_ID);
    // Never the inserting markDirty, which re-created the statistics row
    // the organization job of the same delete had just removed.
    expect(statistics.markDirty).not.toHaveBeenCalled();
  });

  it('does not mark them dirty on an incomplete call', async () => {
    const { service, statistics } = setup(1000);
    const res = await service.purgeProject(PROJECT_ID, ORG_ID, Date.now() - 1);

    expect(res.complete).toBe(false);
    expect(statistics.markDirtyIfPresent).not.toHaveBeenCalled();
  });

  it('does not mark dirty without an organization id (older callers)', async () => {
    const { service, statistics } = setup();
    await service.purgeProject(PROJECT_ID, '', LATER());
    expect(statistics.markDirtyIfPresent).not.toHaveBeenCalled();
  });

  it('a markDirty failure does not fail the purge', async () => {
    const { service, statistics } = setup();
    statistics.markDirtyIfPresent.mockRejectedValueOnce(
      new Error('redis down'),
    );

    const res = await service.purgeProject(PROJECT_ID, ORG_ID, LATER());
    expect(res.complete).toBe(true);
  });

  it('fails closed when a statement fails', async () => {
    const { service, query } = setup();
    query.mockRejectedValueOnce(
      Object.assign(new Error('Lock wait timeout'), { code: 'ER_LOCK' }),
    );
    await expect(
      service.purgeProject(PROJECT_ID, ORG_ID, LATER()),
    ).rejects.toThrow();
  });
});
