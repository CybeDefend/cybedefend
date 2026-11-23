import { PROJECT_SETTINGS_COMMUNITY_BINDINGS } from 'src/edition/community/project-settings.binding';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { Logger } from 'nestjs-pino';
import { of } from 'rxjs';
import { DataSource, In } from 'typeorm';
import { RealtimeEventPublisher } from '@cybedefend/realtime-publisher';
import { dialectApi, run, type DialectApi } from '@cybedefend/db-dialect';

import { ProjectService } from './project.service';
import { OrganizationService } from '../organization/organization.service';
import { buildOrganizationService } from '../organization/organization.service.fixtures';
import { ENTITLEMENTS_PORT } from 'src/edition/ports/entitlements.port';
import { AuthorizationService } from '../authorization/authorization.service';
import { DataPurgeLedger } from '../data-purge/data-purge.ledger';
import { DataPurgeRunner } from '../data-purge/data-purge.runner';
import { Project } from 'src/entities/project.entity';
import { ProjectBranchIngestion } from 'src/entities/project-branch-ingestion.entity';
import { ArchivedBranch } from 'src/entities/archived-branch.entity';
import { ProjectSecurityContext } from 'src/entities/project-security-context.entity';
import { Team } from 'src/entities/team.entity';
import { User } from 'src/entities/user.entity';
import { createLoggerMock } from 'src/test-utils/typeorm-mock.util';
import {
  createLiveDatabase,
  insertRows,
  liveEnabled,
  liveSelects,
} from 'src/core/db/live-database';

/**
 * LIVE spec against a REAL MySQL or PostgreSQL: what a project read and the
 * CybeRisk score sync send to the
 * database.
 *
 * - A project with its team and organization was read with `findOne` and
 *   relations, which TypeORM runs as a `SELECT DISTINCT distinctAlias`
 *   pre-query plus the read.
 *   The previous call is run here next to the new one, so the spec shows both
 *   counts.
 * - setProjectCyberRiskScores reads 3 columns per batch of 100 and
 *   writes one UPDATE ... CASE per batch.
 *
 * It is skipped unless `GM_LIVE=1` (or the former `GM_MYSQL_LIVE=1`, which
 * means MySQL), so `pnpm run test` stays hermetic. The engine is
 * `LIVE_DB_TYPE` (mysql by default). It creates a throwaway database, builds
 * it with the migrations of global-management, and drops it at the end.
 *
 * How to run (the local docker MySQL listens on 3308):
 *   GM_LIVE=1 LIVE_DB_TYPE=mysql GM_MYSQL_URL=mysql://root:<password>@127.0.0.1:3308 \
 *     pnpm exec jest --testPathPatterns=project.service.live --runInBand
 *   GM_LIVE=1 LIVE_DB_TYPE=postgres GM_PG_URL=postgres://postgres:postgres@127.0.0.1:5432 \
 *     pnpm exec jest --testPathPatterns=project.service.live --runInBand
 */
const LIVE = liveEnabled('GM');
const describeLive = LIVE ? describe : describe.skip;

describeLive('Project reads on a real database', () => {
  jest.setTimeout(180_000);

  let dataSource: DataSource;
  let db: DialectApi;
  /** The engine's identifier quote, for the SQL the assertions read. */
  let q: string;
  let statements: string[];
  let drop: () => Promise<void>;
  let projectService: ProjectService;
  let organizationService: OrganizationService;
  const published: unknown[] = [];

  const organizationId = randomUUID();
  const teamId = randomUUID();
  const projectId = randomUUID();
  const creatorId = randomUUID();
  // Reads of the organization's projects: a team member and an
  // outsider next to the creator.
  const memberId = randomUUID();
  const outsiderId = randomUUID();
  // 250 more projects for the score sync, in the same team.
  const scored = Array.from({ length: 250 }, (_, i) => ({
    id: randomUUID(),
    name: `scored-${String(i).padStart(3, '0')}`,
  }));

  beforeAll(async () => {
    let dialect: 'mysql' | 'postgres';
    ({ dataSource, statements, drop, dialect } = await createLiveDatabase({
      prefix: 'gm_back240_l16_project',
      envPrefix: 'GM',
    }));
    db = dialectApi(dialect);
    q = dialect === 'mysql' ? '`' : '"';
    const insert = (table: string, rows: Record<string, unknown>[]) =>
      insertRows({ dataSource, dialect }, table, rows);
    await insert('organization', [
      { id: organizationId, name: 'Acme', industry: 'IT', country: 'FR' },
    ]);
    await insert('team', [
      { id: teamId, name: 'Core', description: '', organizationId },
    ]);
    await insert('project', [{ id: projectId, name: 'Payments', teamId }]);
    await insert(
      'project',
      scored.map((p, i) => ({
        id: p.id,
        name: p.name,
        teamId,
        cyber_risk_score: i,
      })),
    );
    await dataSource.getRepository(User).insert({
      id: creatorId,
      email: `creator-${creatorId}@example.test`,
      firstName: 'C',
      lastName: 'R',
      picture: '',
    } as Partial<User>);
    for (const id of [memberId, outsiderId]) {
      await dataSource.getRepository(User).insert({
        id,
        email: `user-${id}@example.test`,
        firstName: 'U',
        lastName: 'S',
        picture: '',
      } as Partial<User>);
    }
    await insert('users_organizations_members', [
      { id: randomUUID(), organizationId, userId: creatorId, role: 'creator' },
      { id: randomUUID(), organizationId, userId: memberId, role: 'member' },
      { id: randomUUID(), organizationId, userId: outsiderId, role: 'member' },
    ]);
    await insert('teams_members', [
      { id: randomUUID(), teamId, userId: memberId, role: 'member' },
    ]);

    const grpc = (service: Record<string, unknown>) => ({
      getService: () => service,
    });
    const moduleRef = await Test.createTestingModule({
      providers: [
        ProjectService,
        ...[
          Project,
          ProjectBranchIngestion,
          ArchivedBranch,
          ProjectSecurityContext,
          Team,
          User,
        ].map((entity) => ({
          provide: getRepositoryToken(entity),
          useValue: dataSource.getRepository(entity),
        })),
        { provide: getDataSourceToken(), useValue: dataSource },
        {
          provide: AuthorizationService,
          useValue: { addProjectRelation: async () => undefined },
        },
        { provide: DataPurgeLedger, useValue: {} },
        { provide: DataPurgeRunner, useValue: { kick: () => undefined } },
        {
          provide: 'ANALYSIS_REPORTING_SERVICE',
          useValue: grpc({
            getProjectRiskSummary: () =>
              of({ projectId, cyberRisk: { score: 3, level: 'low' } }),
            getBatchVulnerabilitiesCount: () => of({ counts: [] }),
          }),
        },
        {
          provide: 'SECURITY_SCANNING_SERVICE',
          useValue: grpc({
            getProjectsScanStatus: () => of({ statuses: [] }),
          }),
        },
        {
          provide: 'EXTERNAL_INTEGRATIONS_SERVICE',
          useValue: grpc({
            getProjectIntegrationLinkStatus: () =>
              of({ isGithubLinked: false, isGitlabLinked: false }),
            getBatchProjectIntegrationLinkStatus: () =>
              of({ statuses: [], isJiraLinked: false }),
          }),
        },
        {
          provide: ENTITLEMENTS_PORT,
          // No plan limit here, as the empty billing client answered.
          useValue: {
            getSubscription: jest.fn(async () => ({ projectLimit: -1 })),
          },
        },
        ...PROJECT_SETTINGS_COMMUNITY_BINDINGS,
        { provide: 'AGENT_SERVICE', useValue: grpc({}) },
        { provide: Logger, useValue: createLoggerMock() },
        {
          provide: RealtimeEventPublisher,
          useValue: {
            publish: async (event: unknown) => published.push(event),
          },
        },
      ],
    }).compile();
    projectService = moduleRef.get(ProjectService);
    projectService.onModuleInit();

    const testbed = await buildOrganizationService();
    organizationService = testbed.service;
    Object.assign(organizationService as unknown as Record<string, unknown>, {
      projectRepository: dataSource.getRepository(Project),
    });
  });

  afterAll(async () => {
    await drop?.();
  });

  const selectsOf = async (call: () => Promise<unknown>) => {
    statements.length = 0;
    await call();
    return liveSelects(statements);
  };

  describe('a project read is one SELECT', () => {
    it('the previous read, findOne with the team and the organization, took two', async () => {
      const reads = await selectsOf(() =>
        dataSource.getRepository(Project).findOne({
          where: { id: projectId },
          relations: ['team', 'team.organization'],
        }),
      );

      expect(reads).toHaveLength(2);
      expect(reads[0]).toMatch(
        new RegExp(`^SELECT DISTINCT ${q}distinctAlias${q}`),
      );
    });

    it('getProject (lean): the project read and its branch ingestions', async () => {
      const reads = await selectsOf(() =>
        projectService.getProject({
          projectId,
          skipVulnerabilityStats: true,
          skipIntegrationStatus: true,
          skipSecurityContext: true,
        }),
      );

      expect(reads).toHaveLength(2);
      expect(reads.join('\n')).not.toMatch(
        new RegExp(`DISTINCT ${q}distinctAlias${q}`),
      );
      expect(reads[0]).toMatch(
        new RegExp(`FROM ${q}project${q} ${q}project${q}`),
      );
    });

    it('getProject (full): the project, its branch ingestions and its security context', async () => {
      let res: Awaited<ReturnType<ProjectService['getProject']>>;
      const reads = await selectsOf(async () => {
        res = await projectService.getProject({ projectId });
      });

      expect(reads).toHaveLength(3);
      expect(reads.join('\n')).not.toMatch(
        new RegExp(`DISTINCT ${q}distinctAlias${q}`),
      );
      expect(res).toMatchObject({
        projectId,
        name: 'Payments',
        teamId,
        organizationId,
        cyberRiskScore: 3,
      });
    });

    it('getOrganizationIdByProjectId: one SELECT of two ids', async () => {
      let res: unknown;
      const reads = await selectsOf(async () => {
        res = await organizationService.getOrganizationIdByProjectId(projectId);
      });

      expect(reads).toHaveLength(1);
      expect(res).toEqual({ organizationId, teamId });
    });

    it('getOrganizationByProject: one SELECT', async () => {
      let res: unknown;
      const reads = await selectsOf(async () => {
        res = await organizationService.getOrganizationByProject(projectId);
      });

      expect(reads).toHaveLength(1);
      expect(res).toMatchObject({ id: organizationId, name: 'Acme' });
    });

    it('an unknown project is still NOT_FOUND', async () => {
      const thrown = await projectService
        .getProject({ projectId: randomUUID() })
        .catch((e) => e);
      const thrownByOrg = await organizationService
        .getOrganizationIdByProjectId(randomUUID())
        .catch((e) => e);

      expect(thrown.getError()).toEqual({
        code: 5,
        message: 'Project not found',
      });
      expect(thrownByOrg.getError()).toEqual({
        code: 5,
        message: 'Project not found',
      });
    });
  });

  // The project list, the readable projects and their count filter on the
  // caller's memberships through EXISTS subqueries written as raw SQL: their
  // camelCase columns must be quoted, or PostgreSQL folds them to lower case
  // and answers 42703 (every project list would fail).
  describe("an organization's projects, as each member reads them", () => {
    // `project` + the 250 scored projects, all in the one team.
    const all = 1 + scored.length;

    it('getProjectsOrganization: the creator sees every project, a team member too, an outsider none', async () => {
      const page = (userId: string) =>
        projectService.getProjectsOrganization({
          teamId: organizationId,
          userId,
          pageNumber: 1,
          pageSizeNumber: 10,
          searchQuery: '',
        } as Parameters<ProjectService['getProjectsOrganization']>[0]);

      const creator = await page(creatorId);
      const member = await page(memberId);
      const outsider = await page(outsiderId);

      expect(creator.totalProjects).toBe(all);
      expect(creator.projects).toHaveLength(10);
      expect(member.totalProjects).toBe(all);
      expect(outsider.totalProjects).toBe(0);
      expect(outsider.projects).toEqual([]);
    });

    it('getProjectsOrganization: the search applies to the readable projects', async () => {
      const res = await projectService.getProjectsOrganization({
        teamId: organizationId,
        userId: memberId,
        pageNumber: 1,
        pageSizeNumber: 10,
        searchQuery: 'PAYMENTS',
      } as Parameters<ProjectService['getProjectsOrganization']>[0]);

      expect(res.totalProjects).toBe(1);
      expect(res.projects[0]).toMatchObject({ projectId, name: 'Payments' });
    });

    it('getReadableProjectsInOrganization: every readable project with its team', async () => {
      const creator = await projectService.getReadableProjectsInOrganization({
        organizationId,
        userId: creatorId,
      });
      const outsider = await projectService.getReadableProjectsInOrganization({
        organizationId,
        userId: outsiderId,
      });

      expect(creator.projects).toHaveLength(all);
      expect(creator.projects.find((p) => p.projectId === projectId)).toEqual(
        expect.objectContaining({
          name: 'Payments',
          teamId,
          teamName: 'Core',
        }),
      );
      expect(outsider.projects).toEqual([]);
    });

    // An edition's summary columns are selected by the readable-projects
    // summary only. Added to the paginated list, which already loads the
    // whole entity, the column is selected twice inside the DISTINCT
    // pre-query of skip/take, and MySQL refuses it (ER_DUP_FIELDNAME): every
    // project list fails with a 500.
    describe("an edition's summary columns", () => {
      let original: unknown;
      beforeAll(() => {
        const service = projectService as unknown as Record<string, unknown>;
        original = service.projectSettings;
        const base = original as Record<string, unknown>;
        service.projectSettings = Object.assign(Object.create(base), {
          summarySelects: () => [['project.sastEnabled', 'sastEnabled']],
          // A column the query did not select stays visible as undefined.
          summaryFields: (row: Record<string, unknown>) => ({
            sastEnabled:
              row.sastEnabled === undefined
                ? undefined
                : Boolean(Number(row.sastEnabled)),
          }),
        });
      });
      afterAll(() => {
        (projectService as unknown as Record<string, unknown>).projectSettings =
          original;
      });

      it('getProjectsOrganization still answers a page', async () => {
        const res = await projectService.getProjectsOrganization({
          teamId: organizationId,
          userId: creatorId,
          pageNumber: 1,
          pageSizeNumber: 10,
          searchQuery: '',
        } as Parameters<ProjectService['getProjectsOrganization']>[0]);

        expect(res.totalProjects).toBe(all);
        expect(res.projects).toHaveLength(10);
      });

      it('getReadableProjectsInOrganization reads the column', async () => {
        await dataSource
          .getRepository(Project)
          .update({ id: projectId }, { sastEnabled: false });
        try {
          const res = await projectService.getReadableProjectsInOrganization({
            organizationId,
            userId: creatorId,
          });
          const row = res.projects.find((p) => p.projectId === projectId);
          expect(row).toEqual(expect.objectContaining({ sastEnabled: false }));
        } finally {
          await dataSource
            .getRepository(Project)
            .update({ id: projectId }, { sastEnabled: true });
        }
      });
    });

    it('countProjectsInOrganization: per user, and organization-wide', async () => {
      const count = (userId: string) =>
        projectService.countProjectsInOrganization({ organizationId, userId });

      expect((await count(memberId)).totalProjects).toBe(all);
      expect((await count(outsiderId)).totalProjects).toBe(0);
      expect(
        (
          await projectService.countProjectsInOrganization({
            organizationId,
            userId: '',
            orgWide: true,
          })
        ).totalProjects,
      ).toBe(0);
    });
  });

  describe('setProjectCyberRiskScores', () => {
    it('writes 230 changed scores of 250 with 3 SELECT and 3 UPDATE, and publishes them', async () => {
      // The stored score of scored[i] is i: the first 20 are pushed unchanged.
      const items = scored.map((p, i) => ({
        projectId: p.id,
        score: i < 20 ? i : 1000 + i,
      }));
      const before = await dataSource.getRepository(Project).find({
        where: { id: In(scored.slice(0, 20).map((p) => p.id)) },
      });
      published.length = 0;
      statements.length = 0;

      const res = await projectService.setProjectCyberRiskScores({
        items: [...items, { projectId: randomUUID(), score: 5 }],
      });

      expect(res.updated).toBe(230);
      expect(liveSelects(statements)).toHaveLength(3);
      const writes = statements.filter((s) => /^\s*UPDATE/i.test(s));
      expect(writes).toHaveLength(3);
      for (const write of writes) {
        expect(write).toMatch(new RegExp(`CASE ${q}id${q} WHEN`));
      }

      const rows = (
        await run(
          dataSource,
          db.sql`SELECT ${db.ident('id')} AS ${db.ident('id')}, ${db.ident('cyber_risk_score')} AS ${db.ident('score')} FROM ${db.ident('project')} WHERE ${db.ident('teamId')} = ${teamId} AND ${db.ident('id')} <> ${projectId}`,
        )
      ).rows as Array<{ id: string; score: number }>;
      const expected = new Map<string, number>(
        items.map((i) => [i.projectId, i.score]),
      );
      for (const row of rows) expect(row.score).toBe(expected.get(row.id));
      // The unchanged projects were not written at all.
      const after = await dataSource.getRepository(Project).find({
        where: { id: In(scored.slice(0, 20).map((p) => p.id)) },
      });
      expect(after).toEqual(before);
      expect(published).toHaveLength(230);
      expect(published[0]).toMatchObject({
        type: 'PROJECT_STATE_CHANGED',
        scope: { organizationId },
      });
    });

    it('a second push of the same scores writes nothing', async () => {
      const items = scored.map((p, i) => ({
        projectId: p.id,
        score: i < 20 ? i : 1000 + i,
      }));
      statements.length = 0;

      const res = await projectService.setProjectCyberRiskScores({ items });

      expect(res.updated).toBe(0);
      expect(statements.filter((s) => /^\s*UPDATE/i.test(s))).toHaveLength(0);
    });

    it('the cyber-risk score batch update writes every score on both engines', async () => {
      const three = [randomUUID(), randomUUID(), randomUUID()];
      await dataSource.getRepository(Project).insert(
        three.map((id, i) => ({
          id,
          name: `batch-${i}`,
          team: { id: teamId } as Team,
          cyberRiskScore: 50,
        })),
      );
      const scores = [10, 0, 99];

      const res = await projectService.setProjectCyberRiskScores({
        items: three.map((projectId, i) => ({ projectId, score: scores[i] })),
      });

      // One UPDATE … CASE matched the three rows.
      expect(res.updated).toBe(3);
      const stored = await dataSource
        .getRepository(Project)
        .find({ where: { id: In(three) } });
      expect(
        three.map((id) => stored.find((p) => p.id === id).cyberRiskScore),
      ).toEqual(scores);
    });
  });

  it('a project name is unique per team whatever its case', async () => {
    const created = await projectService.createProject({
      name: 'Api',
      teamId,
      creatorId,
    } as Parameters<ProjectService['createProject']>[0]);
    expect(created).toBeDefined();

    // MySQL by its collation, PostgreSQL by citext.
    const thrown = await projectService
      .createProject({
        name: 'API',
        teamId,
        creatorId,
      } as Parameters<ProjectService['createProject']>[0])
      .catch((e) => e);
    expect(thrown.getError()).toEqual({
      code: 6,
      message: 'Project already exists',
    });
  });
});
