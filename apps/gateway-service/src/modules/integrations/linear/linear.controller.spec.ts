import { Test, TestingModule } from '@nestjs/testing';
import { RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { LinearController } from './linear.controller';
import { LinearService } from './linear.service';
import { CombinedAuthRateLimitGuard } from 'src/core/guards/combined-auth-rate-limit.guard';
import { PermissionsGuard } from 'src/core/guards/permissions/permissions.guard';

const ORG_ID = '550e8400-e29b-41d4-a716-446655440000';
const PROJECT_ID = '660e8400-e29b-41d4-a716-446655440001';
const TEAM_ID = '8f14e45f-ceea-467a-9575-1ae4b1c3d2a1';
const LINEAR_PROJECT_ID = '2c9d1b0e-47aa-4b61-8c52-7de3f2a90b14';
const LABEL_ID = '0b6f4d2e-1c3a-4e8b-9d7f-5a2c8e1f3b60';
const ASSIGNEE_ID = '9e2a7c14-6b3d-4f58-a1c0-3d8b5e7f2a96';

const ORG = '/organization/:organizationId';
const PROJECT = `${ORG}/project/:projectId`;

type RouteRow = {
  handler: keyof LinearController;
  verb: RequestMethod;
  path: string;
  permissions: string[];
  subjects: string[];
};

// The routes, permissions and subject types of the Linear integration:
// manage_integration on the organization, plus `update` to write
// at project level and `start_scan` to read at project level, exactly as Jira.
const ROUTES: RouteRow[] = [
  {
    handler: 'generateInstallUrl',
    verb: RequestMethod.GET,
    path: `${ORG}/linear/oauth/url`,
    permissions: ['manage_integration'],
    subjects: ['organization'],
  },
  {
    handler: 'callbackInstall',
    verb: RequestMethod.POST,
    path: `${ORG}/linear/install/callback`,
    permissions: ['manage_integration'],
    subjects: ['organization'],
  },
  {
    handler: 'getInstallation',
    verb: RequestMethod.GET,
    path: `${ORG}/linear/installation`,
    permissions: ['manage_integration'],
    subjects: ['organization'],
  },
  {
    handler: 'disconnect',
    verb: RequestMethod.DELETE,
    path: `${ORG}/linear/disconnect`,
    permissions: ['manage_integration'],
    subjects: ['organization'],
  },
  {
    handler: 'listTeams',
    verb: RequestMethod.GET,
    path: `${ORG}/linear/teams`,
    permissions: ['manage_integration'],
    subjects: ['organization'],
  },
  {
    handler: 'getTeamOptions',
    verb: RequestMethod.GET,
    path: `${ORG}/linear/teams/:teamId/options`,
    permissions: ['manage_integration'],
    subjects: ['organization'],
  },
  {
    handler: 'setProjectLinearConfig',
    verb: RequestMethod.POST,
    path: `${PROJECT}/linear/config`,
    permissions: ['manage_integration', 'update'],
    subjects: ['organization', 'project'],
  },
  {
    handler: 'getProjectLinearConfig',
    verb: RequestMethod.GET,
    path: `${PROJECT}/linear/config`,
    permissions: ['manage_integration', 'start_scan'],
    subjects: ['organization', 'project'],
  },
  {
    handler: 'removeProjectLinearConfig',
    verb: RequestMethod.DELETE,
    path: `${PROJECT}/linear/config`,
    permissions: ['manage_integration', 'update'],
    subjects: ['organization', 'project'],
  },
  {
    handler: 'createIssues',
    verb: RequestMethod.POST,
    path: `${PROJECT}/linear/issues`,
    permissions: ['manage_integration', 'update'],
    subjects: ['organization', 'project'],
  },
  {
    handler: 'linkExistingIssue',
    verb: RequestMethod.POST,
    path: `${PROJECT}/linear/issues/link`,
    permissions: ['manage_integration', 'update'],
    subjects: ['organization', 'project'],
  },
  {
    handler: 'getProjectIssues',
    verb: RequestMethod.GET,
    path: `${PROJECT}/linear/issues`,
    permissions: ['manage_integration', 'start_scan'],
    subjects: ['organization', 'project'],
  },
  {
    handler: 'syncIssueStatus',
    verb: RequestMethod.POST,
    path: `${PROJECT}/linear/issues/sync-status`,
    permissions: ['manage_integration', 'start_scan'],
    subjects: ['organization', 'project'],
  },
];

describe('LinearController', () => {
  const mockReq = { user: { sub: 'user-123' } };

  let linearService: Record<string, jest.Mock>;

  // `null` = FRONTEND_URL is not configured at all.
  async function buildController(
    frontendUrl: string | null = 'https://app.example.com',
  ): Promise<LinearController> {
    linearService = {
      createIssues: jest.fn().mockResolvedValue({ success: true }),
      linkExistingIssue: jest.fn().mockResolvedValue({ success: true }),
      getProjectIssues: jest.fn().mockResolvedValue({ success: true }),
      syncIssueStatus: jest.fn().mockResolvedValue({ success: true }),
      setProjectLinearConfig: jest.fn().mockResolvedValue({ success: true }),
      getProjectLinearConfig: jest.fn().mockResolvedValue({}),
      removeProjectLinearConfig: jest.fn().mockResolvedValue({}),
      getInstallationForOrga: jest.fn().mockResolvedValue({}),
      disconnect: jest.fn().mockResolvedValue({ success: true }),
      listTeams: jest.fn().mockResolvedValue({ teams: [] }),
      getTeamOptions: jest.fn().mockResolvedValue({}),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [LinearController],
      providers: [
        { provide: LinearService, useValue: linearService },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              ({ FRONTEND_URL: frontendUrl ?? undefined })[key],
          },
        },
        {
          provide: Logger,
          useValue: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
        },
        {
          provide: 'REDIS_CLIENT',
          useValue: { set: jest.fn(), get: jest.fn(), del: jest.fn() },
        },
      ],
    })
      .overrideGuard(CombinedAuthRateLimitGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    return module.get(LinearController);
  }

  // ==================== routes, guards and permissions ====================

  describe('routes and permissions', () => {
    const proto = LinearController.prototype;

    it.each(ROUTES)(
      '$handler is $verb $path with $permissions on $subjects',
      ({ handler, verb, path, permissions, subjects }) => {
        const fn = proto[handler] as unknown as (...a: unknown[]) => unknown;

        expect(Reflect.getMetadata(METHOD_METADATA, fn)).toBe(verb);
        expect(Reflect.getMetadata(PATH_METADATA, fn)).toBe(path);
        expect(Reflect.getMetadata('permissions', fn)).toEqual(permissions);
        expect(Reflect.getMetadata('subjectTypes', fn)).toEqual(subjects);
      },
    );

    it.each(ROUTES)(
      '$handler runs PermissionsGuard, behind the class-level authentication',
      ({ handler }) => {
        const fn = proto[handler] as unknown as (...a: unknown[]) => unknown;

        expect(Reflect.getMetadata(GUARDS_METADATA, fn)).toEqual([
          PermissionsGuard,
        ]);
        expect(Reflect.getMetadata(GUARDS_METADATA, LinearController)).toEqual([
          CombinedAuthRateLimitGuard,
        ]);
      },
    );

    it('exposes no route that is missing from the table', () => {
      const routed = Object.getOwnPropertyNames(proto).filter(
        (name) =>
          name !== 'constructor' &&
          Reflect.getMetadata(
            PATH_METADATA,
            proto[name as keyof typeof proto],
          ) !== undefined,
      );

      expect(routed.sort()).toEqual(ROUTES.map((r) => r.handler).sort());
    });

    it('reads the organization-scoped Linear routes with manage_integration alone', () => {
      for (const route of ROUTES.filter((r) => !r.path.includes('/project/'))) {
        expect(route.permissions).toEqual(['manage_integration']);
      }
    });
  });

  // ==================== proxied reads and writes ====================

  describe('organization routes', () => {
    it('getInstallation passes the organization through unchanged', async () => {
      const controller = await buildController();

      await controller.getInstallation(ORG_ID);

      expect(linearService.getInstallationForOrga).toHaveBeenCalledWith({
        organizationId: ORG_ID,
      });
    });

    it('disconnect forwards the organization', async () => {
      const controller = await buildController();

      await controller.disconnect(mockReq, ORG_ID);

      expect(linearService.disconnect).toHaveBeenCalledWith({
        organizationId: ORG_ID,
      });
    });

    it('listTeams forwards the organization', async () => {
      const controller = await buildController();

      await controller.listTeams(ORG_ID);

      expect(linearService.listTeams).toHaveBeenCalledWith({
        organizationId: ORG_ID,
      });
    });

    it('getTeamOptions forwards the organization and the team', async () => {
      const controller = await buildController();

      await controller.getTeamOptions(ORG_ID, TEAM_ID);

      expect(linearService.getTeamOptions).toHaveBeenCalledWith({
        organizationId: ORG_ID,
        teamId: TEAM_ID,
      });
    });
  });

  describe('project config routes', () => {
    it('setProjectLinearConfig forwards the whole choice', async () => {
      const controller = await buildController();

      await controller.setProjectLinearConfig(
        mockReq,
        {
          teamId: TEAM_ID,
          linearProjectId: LINEAR_PROJECT_ID,
          labelIds: [LABEL_ID],
          allowedBranches: ['main'],
          autoCreateEnabled: true,
        },
        ORG_ID,
        PROJECT_ID,
      );

      expect(linearService.setProjectLinearConfig).toHaveBeenCalledWith({
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        teamId: TEAM_ID,
        linearProjectId: LINEAR_PROJECT_ID,
        labelIds: [LABEL_ID],
        allowedBranches: ['main'],
        autoCreateEnabled: true,
      });
    });

    it('setProjectLinearConfig defaults the optional fields to "none"', async () => {
      const controller = await buildController();

      await controller.setProjectLinearConfig(
        mockReq,
        { teamId: TEAM_ID },
        ORG_ID,
        PROJECT_ID,
      );

      expect(linearService.setProjectLinearConfig).toHaveBeenCalledWith({
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        teamId: TEAM_ID,
        linearProjectId: '',
        labelIds: [],
        allowedBranches: [],
        autoCreateEnabled: false,
      });
    });

    it('getProjectLinearConfig forwards the organization and the project', async () => {
      const controller = await buildController();

      await controller.getProjectLinearConfig(ORG_ID, PROJECT_ID);

      expect(linearService.getProjectLinearConfig).toHaveBeenCalledWith({
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
      });
    });

    it('removeProjectLinearConfig forwards the organization and the project', async () => {
      const controller = await buildController();

      await controller.removeProjectLinearConfig(mockReq, ORG_ID, PROJECT_ID);

      expect(linearService.removeProjectLinearConfig).toHaveBeenCalledWith({
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
      });
    });
  });

  // ==================== issues ====================

  describe('createIssues', () => {
    const vulnerabilities = [
      {
        vulnerabilityId: 'vuln-1',
        scannerType: 'sast',
        severity: 'high',
        name: 'SQL Injection',
      },
    ];
    const baseDto = {
      scanId: 'scan-1',
      mode: 2,
      vulnerabilities,
      cybedefendBaseUrl: 'https://client-provided.example.com',
    };

    it('forwards per-ticket choices', async () => {
      const controller = await buildController();

      await controller.createIssues(
        mockReq,
        {
          ...baseDto,
          teamId: TEAM_ID,
          linearProjectId: LINEAR_PROJECT_ID,
          assigneeId: ASSIGNEE_ID,
          labelIds: [LABEL_ID],
          priority: 2,
        },
        ORG_ID,
        PROJECT_ID,
      );

      expect(linearService.createIssues).toHaveBeenCalledWith({
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        scanId: 'scan-1',
        mode: 2,
        vulnerabilities,
        cybedefendBaseUrl: 'https://app.example.com',
        teamId: TEAM_ID,
        linearProjectId: LINEAR_PROJECT_ID,
        assigneeId: ASSIGNEE_ID,
        labelIds: [LABEL_ID],
        priority: 2,
      });
    });

    it('leaves every choice empty when the caller made none, priority absent', async () => {
      const controller = await buildController();

      await controller.createIssues(mockReq, baseDto, ORG_ID, PROJECT_ID);

      const sent = linearService.createIssues.mock.calls[0][0];
      expect(sent).toMatchObject({
        teamId: '',
        linearProjectId: '',
        assigneeId: '',
        labelIds: [],
      });
      // absent => derived from the severities by external-integrations
      expect(sent.priority).toBeUndefined();
    });

    it('forwards an explicit priority of 0 (no priority), never as absent', async () => {
      const controller = await buildController();

      await controller.createIssues(
        mockReq,
        { ...baseDto, priority: 0 },
        ORG_ID,
        PROJECT_ID,
      );

      expect(linearService.createIssues.mock.calls[0][0].priority).toBe(0);
    });

    it('sends a scan id that was not given as empty', async () => {
      const controller = await buildController();

      await controller.createIssues(
        mockReq,
        { ...baseDto, scanId: undefined },
        ORG_ID,
        PROJECT_ID,
      );

      expect(linearService.createIssues.mock.calls[0][0].scanId).toBe('');
    });

    it('uses FRONTEND_URL over the client origin', async () => {
      const controller = await buildController('https://app.example.com');

      await controller.createIssues(mockReq, baseDto, ORG_ID, PROJECT_ID);

      expect(linearService.createIssues).toHaveBeenCalledWith(
        expect.objectContaining({
          cybedefendBaseUrl: 'https://app.example.com',
        }),
      );
    });

    it.each([
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://0.0.0.0:3000',
      'http://[::1]:3000',
      'http://dev.local:3000',
    ])(
      'falls back to the client origin when FRONTEND_URL is local (%s)',
      async (localUrl) => {
        const controller = await buildController(localUrl);

        await controller.createIssues(mockReq, baseDto, ORG_ID, PROJECT_ID);

        expect(linearService.createIssues).toHaveBeenCalledWith(
          expect.objectContaining({
            cybedefendBaseUrl: 'https://client-provided.example.com',
          }),
        );
      },
    );

    it('falls back to the client origin when FRONTEND_URL is not set', async () => {
      const controller = await buildController(null);

      await controller.createIssues(mockReq, baseDto, ORG_ID, PROJECT_ID);

      expect(linearService.createIssues).toHaveBeenCalledWith(
        expect.objectContaining({
          cybedefendBaseUrl: 'https://client-provided.example.com',
        }),
      );
    });
  });

  describe('linkExistingIssue', () => {
    const baseDto = {
      issueRef: 'ENG-142',
      vulnerabilityIds: ['vuln-1'],
      scannerType: 'sca',
      cybedefendBaseUrl: 'https://client-provided.example.com',
    };

    it('forwards the reference, the findings and their scanner', async () => {
      const controller = await buildController();

      await controller.linkExistingIssue(mockReq, baseDto, ORG_ID, PROJECT_ID);

      expect(linearService.linkExistingIssue).toHaveBeenCalledWith({
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        issueRef: 'ENG-142',
        vulnerabilityIds: ['vuln-1'],
        scannerType: 'sca',
        vulnerabilities: [],
        cybedefendBaseUrl: 'https://app.example.com',
      });
    });

    it('uses FRONTEND_URL over the client origin', async () => {
      const controller = await buildController('https://app.example.com');

      await controller.linkExistingIssue(mockReq, baseDto, ORG_ID, PROJECT_ID);

      expect(linearService.linkExistingIssue).toHaveBeenCalledWith(
        expect.objectContaining({
          cybedefendBaseUrl: 'https://app.example.com',
        }),
      );
    });

    it('falls back to the client origin when FRONTEND_URL is local, then to ""', async () => {
      const controller = await buildController('http://localhost:3000');

      await controller.linkExistingIssue(mockReq, baseDto, ORG_ID, PROJECT_ID);
      await controller.linkExistingIssue(
        mockReq,
        { ...baseDto, cybedefendBaseUrl: undefined },
        ORG_ID,
        PROJECT_ID,
      );

      expect(
        linearService.linkExistingIssue.mock.calls.map(
          ([sent]) => sent.cybedefendBaseUrl,
        ),
      ).toEqual(['https://client-provided.example.com', '']);
    });
  });

  describe('getProjectIssues and syncIssueStatus', () => {
    it('lists every state of the project issues', async () => {
      const controller = await buildController();

      await controller.getProjectIssues(ORG_ID, PROJECT_ID);

      expect(linearService.getProjectIssues).toHaveBeenCalledWith({
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        state: 'all',
        vulnerabilityIds: [],
      });
    });

    it('syncs the statuses of the project', async () => {
      const controller = await buildController();

      await controller.syncIssueStatus(ORG_ID, PROJECT_ID);

      expect(linearService.syncIssueStatus).toHaveBeenCalledWith({
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
      });
    });
  });
});
