import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { DataSource } from 'typeorm';
import { dialectApi } from '@cybedefend/db-dialect';
import { DataPurgeService } from './data-purge.service';
import { DataPurgeController } from './data-purge.controller';
import type { PurgeTableExtension } from '../../edition/ports/purge-table-extensions.port';
import {
  ORGANIZATION_INTEGRATION_TYPES,
  ORGANIZATION_PURGE_TABLES,
  PROJECT_PURGE_TABLES,
  PROJECT_UNLINK_TABLES,
  PURGE_BATCH_SIZE,
  PURGE_CALL_BUDGET_MS,
} from './purge-tables';
import { IntegrationsAdminService } from '../integrations-admin/integrations-admin.service';
import { createLoggerMock } from '../../test-utils/mocks';

const mysql = dialectApi('mysql');

const PROJECT = '7d1c2a4e-0b5f-4c39-9d7e-2f6a8b1c3e40';
const ORG = '0f9e8d7c-6b5a-4f32-8e1d-0c9b8a7f6e51';
const TEAM = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const FAR = () => Date.now() + 60_000;

describe('DataPurgeService', () => {
  let query: jest.Mock;
  let admin: { deleteIntegrationsForOrg: jest.Mock };
  let service: DataPurgeService;

  const statements = (): string[] => query.mock.calls.map((c) => c[0]);
  const answering = (affectedRows: number) =>
    query.mockResolvedValue({ affectedRows });

  beforeEach(() => {
    query = jest.fn();
    admin = { deleteIntegrationsForOrg: jest.fn().mockResolvedValue({}) };
    service = new DataPurgeService(
      { query } as unknown as DataSource,
      admin as unknown as IntegrationsAdminService,
      createLoggerMock(),
    );
  });

  describe('purgeProject', () => {
    it('deletes the issue mappings and integration mappings of the project', async () => {
      answering(0);
      const result = await service.purgeProject(PROJECT, ORG, FAR());

      for (const table of [
        'vulnerability_issue_mapping',
        'jira_project_mappings',
        'slack_channel_mappings',
      ]) {
        const expected = mysql.deleteBatch(
          table,
          mysql.sql`${mysql.ident('projectId')} = ${PROJECT}`,
          PURGE_BATCH_SIZE,
        );
        expect(query).toHaveBeenCalledWith(
          expected.text,
          expected.params,
          true,
        );
      }
      expect(result.complete).toBe(true);
    });

    it('unlinks and never deletes the repositories', async () => {
      answering(2);
      query.mockImplementation((sql: string) =>
        Promise.resolve({ affectedRows: sql.startsWith('UPDATE') ? 2 : 0 }),
      );
      const result = await service.purgeProject(PROJECT, ORG, FAR());

      for (const table of ['github_repositories', 'gitlab_repositories']) {
        const expected = mysql.updateBatch(
          table,
          { projectId: null, scanBranch: null },
          mysql.sql`${mysql.ident('projectId')} = ${PROJECT}`,
          PURGE_BATCH_SIZE,
        );
        expect(query).toHaveBeenCalledWith(
          expected.text,
          expected.params,
          true,
        );
        expect(result.deleted[table]).toBe(2);
      }
      for (const sql of statements()) {
        expect(sql).not.toMatch(
          /DELETE FROM `(github|gitlab)_(repositories|integrations|branches)`/,
        );
      }
      expect(admin.deleteIntegrationsForOrg).not.toHaveBeenCalled();
    });

    // The Linear settings of a project (its team, project and labels) exist only for it.
    it("deletes the project's Linear settings", async () => {
      answering(0);
      await service.purgeProject(PROJECT, ORG, FAR());
      const expected = mysql.deleteBatch(
        'linear_project_mappings',
        mysql.sql`${mysql.ident('projectId')} = ${PROJECT}`,
        PURGE_BATCH_SIZE,
      );
      expect(query).toHaveBeenCalledWith(expected.text, expected.params, true);
    });

    it('runs every project statement in order, once each when nothing is left', async () => {
      answering(0);
      await service.purgeProject(PROJECT, ORG, FAR());
      const tables = statements().map((s) => /`([a-z_]+)`/.exec(s)[1]);
      expect(tables).toEqual([
        ...PROJECT_UNLINK_TABLES.map((t) => t.table),
        ...PROJECT_PURGE_TABLES.map((t) => t.table),
      ]);
    });

    it('stops at the deadline and resumes', async () => {
      answering(PURGE_BATCH_SIZE);
      const first = await service.purgeProject(PROJECT, ORG, Date.now() - 1);
      expect(query).toHaveBeenCalledTimes(1);
      expect(first.complete).toBe(false);
      expect(first.deleted).toEqual({ github_repositories: PURGE_BATCH_SIZE });

      query.mockReset();
      answering(0);
      const next = await service.purgeProject(PROJECT, ORG, FAR());
      expect(next.complete).toBe(true);
    });

    it('is idempotent', async () => {
      answering(0);
      const result = await service.purgeProject(PROJECT, ORG, FAR());
      expect(result.complete).toBe(true);
      expect(Object.values(result.deleted).every((n) => n === 0)).toBe(true);
    });

    it('fails closed when a statement fails', async () => {
      query.mockRejectedValue(new Error('ER_LOCK_WAIT_TIMEOUT secret-ish'));
      await expect(
        service.purgeProject(PROJECT, ORG, FAR()),
      ).rejects.toMatchObject({
        error: { code: status.INTERNAL, message: 'INTERNAL' },
      });
    });
  });

  describe('purgeOrganization', () => {
    it("deletes the organization's integrations", async () => {
      answering(0);
      admin.deleteIntegrationsForOrg.mockResolvedValue({
        jira: 1,
        linear: 1,
        slack: 0,
        github_issues: 1,
        gitlab_issues: 0,
        container_registry: 3,
      });
      const result = await service.purgeOrganization(ORG, [TEAM], FAR());

      expect(admin.deleteIntegrationsForOrg).toHaveBeenCalledWith(
        ORG,
        [
          'jira',
          'linear',
          'slack',
          'github_issues',
          'gitlab_issues',
          'container_registry',
        ],
        { failClosed: true },
      );
      expect(ORGANIZATION_INTEGRATION_TYPES).toEqual([
        'jira',
        'linear',
        'slack',
        'github_issues',
        'gitlab_issues',
        'container_registry',
      ]);
      expect(result.complete).toBe(true);
      expect(result.deleted['integrations.container_registry']).toBe(3);
    });

    it('deletes the repositories and branches in batches before their integrations', async () => {
      answering(0);
      await service.purgeOrganization(ORG, [], FAR());
      const sqls = statements();
      const at = (re: RegExp) => sqls.findIndex((s) => re.test(s));
      expect(at(/^DELETE FROM `github_branches`/)).toBeGreaterThanOrEqual(0);
      expect(at(/^DELETE FROM `github_branches`/)).toBeLessThan(
        at(/^DELETE FROM `github_repositories`/),
      );
      expect(at(/^DELETE FROM `gitlab_branches`/)).toBeLessThan(
        at(/^DELETE FROM `gitlab_repositories`/),
      );
      for (const s of sqls) {
        expect(s).toMatch(/ LIMIT \?$/);
      }
      const lastQuery = Math.max(...query.mock.invocationCallOrder.map(Number));
      expect(
        admin.deleteIntegrationsForOrg.mock.invocationCallOrder[0],
      ).toBeGreaterThan(lastQuery);
    });

    it('does not delete the integrations while repositories remain', async () => {
      answering(PURGE_BATCH_SIZE);
      const result = await service.purgeOrganization(ORG, [], Date.now() - 1);
      expect(query).toHaveBeenCalledTimes(1);
      expect(result.complete).toBe(false);
      expect(admin.deleteIntegrationsForOrg).not.toHaveBeenCalled();
    });

    it('is idempotent', async () => {
      answering(0);
      admin.deleteIntegrationsForOrg.mockResolvedValue({ jira: 0 });
      const result = await service.purgeOrganization(ORG, [TEAM], FAR());
      expect(result.complete).toBe(true);
      expect(Object.values(result.deleted).every((n) => n === 0)).toBe(true);
    });

    it('fails closed when an integration delete fails', async () => {
      answering(0);
      admin.deleteIntegrationsForOrg.mockRejectedValue(new Error('boom'));
      await expect(
        service.purgeOrganization(ORG, [], FAR()),
      ).rejects.toMatchObject({ error: { code: status.INTERNAL } });
    });
  });

  describe('purge table extensions', () => {
    // The Community Edition has no extension: a purge then names only the
    // tables of the core lists, all of which its schema creates.
    const EXTENSION: PurgeTableExtension = {
      project: [{ table: 'closed_project_rows', column: 'projectId' }],
      organization: [{ table: 'closed_org_rows', column: 'organizationId' }],
    };
    const tablesOf = () => statements().map((s) => /`([a-z_]+)`/.exec(s)[1]);

    it('without one, a purge names only the core tables', async () => {
      answering(0);
      await service.purgeProject(PROJECT, ORG, FAR());
      await service.purgeOrganization(ORG, [], FAR());
      expect(tablesOf()).toEqual([
        ...PROJECT_UNLINK_TABLES.map((t) => t.table),
        ...PROJECT_PURGE_TABLES.map((t) => t.table),
        ...ORGANIZATION_PURGE_TABLES.map((t) => t.table),
      ]);
    });

    it('with one, its project tables follow the core ones and its organization tables run first, before the integrations', async () => {
      service = new DataPurgeService(
        { query } as unknown as DataSource,
        admin as unknown as IntegrationsAdminService,
        createLoggerMock(),
        EXTENSION,
      );
      answering(0);
      await service.purgeProject(PROJECT, ORG, FAR());
      expect(tablesOf()).toEqual([
        ...PROJECT_UNLINK_TABLES.map((t) => t.table),
        ...PROJECT_PURGE_TABLES.map((t) => t.table),
        'closed_project_rows',
      ]);
      query.mockClear();
      await service.purgeOrganization(ORG, [], FAR());
      expect(tablesOf()).toEqual([
        'closed_org_rows',
        ...ORGANIZATION_PURGE_TABLES.map((t) => t.table),
      ]);
      const orgDelete = mysql.deleteBatch(
        'closed_org_rows',
        mysql.sql`${mysql.ident('organizationId')} = ${ORG}`,
        PURGE_BATCH_SIZE,
      );
      expect(query).toHaveBeenCalledWith(
        orgDelete.text,
        orgDelete.params,
        true,
      );
      expect(admin.deleteIntegrationsForOrg).toHaveBeenCalled();
    });
  });

  describe('refuses a malformed id and deletes nothing', () => {
    const malformed = ['', 'x', '%', '*', 'reports', '../etc', `${PROJECT} `];

    it.each(malformed)('project id %p', async (id) => {
      await expect(service.purgeProject(id, ORG, FAR())).rejects.toMatchObject({
        error: { code: status.INVALID_ARGUMENT },
      });
      expect(query).not.toHaveBeenCalled();
    });

    it.each(malformed)('organization id %p', async (id) => {
      await expect(
        service.purgeProject(PROJECT, id, FAR()),
      ).rejects.toBeInstanceOf(RpcException);
      await expect(
        service.purgeOrganization(id, [], FAR()),
      ).rejects.toMatchObject({ error: { code: status.INVALID_ARGUMENT } });
      expect(query).not.toHaveBeenCalled();
      expect(admin.deleteIntegrationsForOrg).not.toHaveBeenCalled();
    });

    it.each(malformed)('team id %p', async (id) => {
      await expect(
        service.purgeOrganization(ORG, [TEAM, id], FAR()),
      ).rejects.toMatchObject({ error: { code: status.INVALID_ARGUMENT } });
      expect(query).not.toHaveBeenCalled();
      expect(admin.deleteIntegrationsForOrg).not.toHaveBeenCalled();
    });
  });
});

describe('DataPurgeController', () => {
  it('gives each call the purge budget', async () => {
    const svc = {
      purgeProject: jest
        .fn()
        .mockResolvedValue({ complete: true, deleted: {} }),
      purgeOrganization: jest
        .fn()
        .mockResolvedValue({ complete: true, deleted: {} }),
    };
    const controller = new DataPurgeController(
      svc as unknown as DataPurgeService,
    );
    const before = Date.now();

    await controller.purgeProjectData({
      projectId: PROJECT,
      organizationId: ORG,
    });
    await controller.purgeOrganizationData({
      organizationId: ORG,
      teamIds: [TEAM],
    });

    const [, , projectDeadline] = svc.purgeProject.mock.calls[0];
    expect(svc.purgeProject.mock.calls[0].slice(0, 2)).toEqual([PROJECT, ORG]);
    expect(projectDeadline).toBeGreaterThanOrEqual(
      before + PURGE_CALL_BUDGET_MS,
    );
    expect(projectDeadline).toBeLessThanOrEqual(
      Date.now() + PURGE_CALL_BUDGET_MS,
    );
    expect(svc.purgeOrganization.mock.calls[0].slice(0, 2)).toEqual([
      ORG,
      [TEAM],
    ]);
  });
});
