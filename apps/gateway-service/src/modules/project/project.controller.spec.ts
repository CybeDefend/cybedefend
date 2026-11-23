import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from 'nestjs-pino';
import { ProjectController } from './project.controller';
import { ProjectService } from './project.service';
import { CombinedAuthRateLimitGuard } from 'src/core/guards/combined-auth-rate-limit.guard';
import { PermissionsGuard } from 'src/core/guards/permissions/permissions.guard';
import { AuthGuard } from 'src/core/guards/auth/auth.guard';
import { RateLimitGuard } from 'src/core/guards/throttler/throttler.guard';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import SecretsService from 'src/core/secrets/secrets.service';

import {
  PaginatedProjectsAllInformationsResponse,
  PaginatedProjectsResponse,
  ProjectInformationsResponse,
  ProjectUpdateResponse,
  ProjectDeleteResponse,
} from '@grpc/global-management/project';

import { ProjectGetAllBodyDto } from './dto/body/project-get-all-body.dto';
import { ProjectCreateBodyDto } from './dto/body/project-create-body.dto';
import { ProjectUpdateBodyDto } from './dto/body/project-update-body.dto';
import { COMPLIANCE_FRAMEWORKS_SYNC } from './compliance-frameworks-sync';

describe('ProjectController', () => {
  let controller: ProjectController;
  let service: jest.Mocked<ProjectService>;
  let complianceSync: { setComplianceFrameworks: jest.Mock };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProjectController],
      providers: [
        {
          provide: ProjectService,
          useValue: {
            getProjectsOrganization: jest.fn(),
            getProjectsTeam: jest.fn(),
            getProject: jest.fn(),
            createProject: jest.fn(),
            updateProject: jest.fn(),
            deleteProject: jest.fn(),
            getProjectSecurityContext: jest.fn(),
            updateProjectSecurityContext: jest.fn(),
          },
        },
        {
          provide: COMPLIANCE_FRAMEWORKS_SYNC,
          useValue: {
            setComplianceFrameworks: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: Logger,
          useValue: { log: jest.fn(), error: jest.fn(), warn: jest.fn() },
        },
        { provide: Reflector, useValue: { get: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: SecretsService, useValue: { getSecret: jest.fn() } },
        {
          provide: CombinedAuthRateLimitGuard,
          useValue: { canActivate: jest.fn().mockResolvedValue(true) },
        },
        {
          provide: PermissionsGuard,
          useValue: { canActivate: jest.fn().mockResolvedValue(true) },
        },
        { provide: AuthGuard, useValue: { canActivate: jest.fn() } },
        { provide: RateLimitGuard, useValue: { canActivate: jest.fn() } },
      ],
    }).compile();

    controller = module.get<ProjectController>(ProjectController);
    service = module.get(ProjectService) as any;
    complianceSync = module.get(COMPLIANCE_FRAMEWORKS_SYNC) as any;
  });

  describe('getProjectsOrganization', () => {
    it('maps query and param to ProjectGetAllRequest', async () => {
      const res: PaginatedProjectsAllInformationsResponse = {
        projects: [],
        totalProjects: 0,
        totalPages: 0,
      } as any;
      service.getProjectsOrganization.mockResolvedValue(res);
      const dto: ProjectGetAllBodyDto = { page: 2, pageSize: 5, search: 'q' };
      const out = await controller.getProjectsOrganization(
        '11111111-1111-1111-1111-111111111111',
        dto,
        { user: { sub: 'u1' } } as any,
      );
      expect(out).toEqual(res);
      expect(service.getProjectsOrganization).toHaveBeenCalledWith(
        expect.objectContaining({
          teamId: '11111111-1111-1111-1111-111111111111',
          pageNumber: 2,
          pageSizeNumber: 5,
          searchQuery: 'q',
          userId: 'u1',
        }),
      );
    });
  });

  describe('getProjectsTeam', () => {
    it('maps DTO and param to ProjectGetAllRequest', async () => {
      const res: PaginatedProjectsResponse = {
        projects: [],
        totalProjects: 0,
        totalPages: 0,
      } as any;
      service.getProjectsTeam.mockResolvedValue(res);
      const dto: ProjectGetAllBodyDto = { page: 1, pageSize: 10, search: '' };
      const out = await controller.getProjectsTeam(
        '11111111-1111-1111-1111-111111111111',
        dto,
        { user: { sub: 'u1' } } as any,
      );
      expect(out).toEqual(res);
      expect(service.getProjectsTeam).toHaveBeenCalledWith(
        expect.objectContaining({
          teamId: '11111111-1111-1111-1111-111111111111',
          pageNumber: 1,
          pageSizeNumber: 10,
          searchQuery: '',
          userId: 'u1',
        }),
      );
    });
  });

  describe('getProject', () => {
    it('maps param to ProjectGetRequest', async () => {
      const res = {
        id: 'p1',
        name: 'Proj',
        teamId: 't1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        defaultBranch: '',
      } as any;
      service.getProject.mockResolvedValue(res);
      const out = await controller.getProject(
        '22222222-2222-2222-2222-222222222222',
      );
      expect(out).toEqual(res);
      expect(service.getProject).toHaveBeenCalledWith({
        projectId: '22222222-2222-2222-2222-222222222222',
      });
    });
  });

  describe('createProject', () => {
    it('maps body + params + req.user to ProjectCreateRequest', async () => {
      const res: ProjectInformationsResponse = {
        id: 'p1',
        name: 'N',
        teamId: 't1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as any;
      service.createProject.mockResolvedValue(res);
      // A setting of a closed feature the body may still carry (an older
      // client) is not forwarded: no extension registered it.
      const dto = {
        name: 'N',
        aiMergeRequestEnabled: true,
      } as ProjectCreateBodyDto;
      const out = await controller.createProject(
        '33333333-3333-3333-3333-333333333333',
        dto,
        { user: { sub: 'u1' } } as any,
      );
      expect(out).toEqual(res);
      expect(service.createProject).toHaveBeenCalledWith(
        expect.objectContaining({
          teamId: '33333333-3333-3333-3333-333333333333',
          name: 'N',
          creatorId: 'u1',
        }),
      );
      expect(service.createProject.mock.calls[0][0]).not.toHaveProperty(
        'aiMergeRequestEnabled',
      );
    });

    it.each(['appsec', 'closed-product'] as const)(
      'forwards the space the project is created from (%s)',
      async (product) => {
        service.createProject.mockResolvedValue({ id: 'p1' } as any);
        await controller.createProject(
          '33333333-3333-3333-3333-333333333333',
          { name: 'N', product } as ProjectCreateBodyDto,
          { user: { sub: 'u1' } } as any,
        );
        expect(service.createProject.mock.calls[0][0].product).toBe(product);
      },
    );

    it('sends no product for an old caller that names none', async () => {
      service.createProject.mockResolvedValue({ id: 'p1' } as any);
      await controller.createProject(
        '33333333-3333-3333-3333-333333333333',
        { name: 'N' } as ProjectCreateBodyDto,
        { user: { sub: 'u1' } } as any,
      );
      expect(service.createProject.mock.calls[0][0].product).toBeUndefined();
    });

    it('omits securityContext from the gRPC payload when absent', async () => {
      service.createProject.mockResolvedValue({ id: 'p1' } as any);
      await controller.createProject(
        '33333333-3333-3333-3333-333333333333',
        { name: 'N' } as ProjectCreateBodyDto,
        { user: { sub: 'u1' } } as any,
      );
      const arg = service.createProject.mock.calls[0][0];
      expect(arg.securityContext).toBeUndefined();
    });

    it('maps securityContext string enums to proto enums', async () => {
      service.createProject.mockResolvedValue({ id: 'p2' } as any);
      const dto: ProjectCreateBodyDto = {
        name: 'N2',
        securityContext: {
          environment: 'staging',
          internetExposure: 'internal',
          deploymentType: 'onprem',
          dataClassification: 'regulated',
          handlesPii: true,
          handlesPaymentData: false,
          businessCriticality: 'mission_critical',
          userBaseSize: 'large',
          complianceFrameworks: ['SOC2', 'GDPR'],
          safetyCritical: true,
          networkSegmentation: 'microsegmented',
        },
      } as any;

      await controller.createProject(
        '33333333-3333-3333-3333-333333333333',
        dto,
        { user: { sub: 'u1' } } as any,
      );

      const arg = service.createProject.mock.calls[0][0];
      expect(arg.securityContext).toBeDefined();
      // ts-proto generates numeric enums; STAGING=2, INTERNAL=2, ONPREM=2,
      // REGULATED=4, MISSION_CRITICAL=4, LARGE=3, MICROSEGMENTED=3
      expect(arg.securityContext.environment).toBe(2);
      expect(arg.securityContext.internetExposure).toBe(2);
      expect(arg.securityContext.deploymentType).toBe(2);
      expect(arg.securityContext.dataClassification).toBe(4);
      expect(arg.securityContext.handlesPii).toBe(true);
      expect(arg.securityContext.handlesPaymentData).toBe(false);
      expect(arg.securityContext.businessCriticality).toBe(4);
      expect(arg.securityContext.userBaseSize).toBe(3);
      expect(arg.securityContext.complianceFrameworks).toEqual([
        'SOC2',
        'GDPR',
      ]);
      expect(arg.securityContext.safetyCritical).toBe(true);
      expect(arg.securityContext.networkSegmentation).toBe(3);
    });
  });

  describe('updateProject', () => {
    it('maps PATCH partial fields to ProjectUpdateRequest', async () => {
      const res: ProjectUpdateResponse = {
        message: 'ok',
        updatedProject: {
          id: 'p1',
          name: 'X',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      } as any;
      service.updateProject.mockResolvedValue(res);
      const dto: ProjectUpdateBodyDto = new ProjectUpdateBodyDto({
        name: 'X',
        emailAlertEnabled: true,
        sastSeverities: ['high'],
      });
      const out = await controller.updateProject(
        '44444444-4444-4444-4444-444444444444',
        dto,
        { user: { sub: 'u9' } } as any,
      );
      expect(out).toEqual(res);
      expect(service.updateProject).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: '44444444-4444-4444-4444-444444444444',
          name: 'X',
          emailAlertEnabled: true,
          sastSeverities: ['high'],
        }),
      );
    });

    // The closed extension's update field is registered and tested by that
    // extension.

    // Scan-on-commit opt-out. false is the whole point of the setting, so it
    // must survive the mapping — a truthy check here would drop it silently.
    it('maps scanOnCommitEnabled=false to ProjectUpdateRequest', async () => {
      const res: ProjectUpdateResponse = { message: 'ok' } as any;
      service.updateProject.mockResolvedValue(res);
      const dto: ProjectUpdateBodyDto = new ProjectUpdateBodyDto({
        scanOnCommitEnabled: false,
      });
      await controller.updateProject(
        '44444444-4444-4444-4444-444444444444',
        dto,
        { user: { sub: 'u9' } } as any,
      );
      expect(service.updateProject).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: '44444444-4444-4444-4444-444444444444',
          scanOnCommitEnabled: false,
        }),
      );
    });

    it('omits scanOnCommitEnabled from the gRPC payload when absent', async () => {
      const res: ProjectUpdateResponse = { message: 'ok' } as any;
      service.updateProject.mockResolvedValue(res);
      const dto: ProjectUpdateBodyDto = new ProjectUpdateBodyDto({ name: 'X' });
      await controller.updateProject(
        '44444444-4444-4444-4444-444444444444',
        dto,
        { user: { sub: 'u9' } } as any,
      );
      const arg = service.updateProject.mock.calls[0][0];
      expect(arg).not.toHaveProperty('scanOnCommitEnabled');
    });
  });

  describe('deleteProject', () => {
    it('maps params and req.user to ProjectDeleteRequest', async () => {
      const res: ProjectDeleteResponse = { message: 'deleted' } as any;
      service.deleteProject.mockResolvedValue(res);
      const out = await controller.deleteProject(
        '55555555-5555-5555-5555-555555555555',
        { user: { sub: 'u1' } } as any,
      );
      expect(out).toEqual(res);
      expect(service.deleteProject).toHaveBeenCalledWith({
        projectId: '55555555-5555-5555-5555-555555555555',
      });
    });
  });

  describe('Security Context — compliance-frameworks sync', () => {
    const securityContext = {
      projectId: 'p1',
      complianceFrameworks: ['SOC2', 'GDPR'],
    };

    it('skips the compliance sync when no sync is bound', async () => {
      service.updateProjectSecurityContext.mockResolvedValue({
        securityContext,
      } as any);
      const unbound = new ProjectController(
        service as any,
        { log: jest.fn(), warn: jest.fn(), error: jest.fn() } as any,
        undefined,
      );
      await expect(
        unbound.updateProjectSecurityContext(
          'p1',
          {} as any,
          { headers: { authorization: 'Bearer tok' } } as any,
        ),
      ).resolves.toBeDefined();
      expect(complianceSync.setComplianceFrameworks).not.toHaveBeenCalled();
    });

    it('getProjectSecurityContext syncs complianceFrameworks to security_rules', async () => {
      service.getProjectSecurityContext.mockResolvedValue({
        securityContext,
      } as any);

      await controller.getProjectSecurityContext('p1', {
        headers: { authorization: 'Bearer tok' },
      } as any);

      expect(complianceSync.setComplianceFrameworks).toHaveBeenCalledWith(
        'p1',
        ['SOC2', 'GDPR'],
        'tok',
      );
    });

    it('updateProjectSecurityContext syncs complianceFrameworks to security_rules', async () => {
      service.updateProjectSecurityContext.mockResolvedValue({
        securityContext,
      } as any);

      await controller.updateProjectSecurityContext(
        'p1',
        {} as any,
        {
          headers: { authorization: 'Bearer tok' },
        } as any,
      );

      expect(complianceSync.setComplianceFrameworks).toHaveBeenCalledWith(
        'p1',
        ['SOC2', 'GDPR'],
        'tok',
      );
    });

    it('does not sync when the project has no security context', async () => {
      service.getProjectSecurityContext.mockResolvedValue({
        securityContext: undefined,
      } as any);

      const out = await controller.getProjectSecurityContext('p1', {
        headers: {},
      } as any);

      expect(out).toBeNull();
      expect(complianceSync.setComplianceFrameworks).not.toHaveBeenCalled();
    });

    // The dashboard reads the Security Context from GET
    // /project/:id, so the sync on GET /security-context no longer runs for
    // every project. A project created with frameworks must be synced at birth.
    // global-management stores the frameworks it is sent (when there are
    // some) and answers createProject WITHOUT the Security Context
    // (mapToGrpcProject(saved)): the gateway syncs what it sent.
    it('createProject syncs the frameworks the new project was created with', async () => {
      service.createProject.mockResolvedValue({ projectId: 'p-new' } as any);

      await controller.createProject(
        '33333333-3333-3333-3333-333333333333',
        {
          name: 'N',
          securityContext: { complianceFrameworks: ['SOC2', 'HIPAA'] },
        } as ProjectCreateBodyDto,
        {
          user: { sub: 'u1' },
          headers: { authorization: 'Bearer tok' },
        } as any,
      );

      expect(complianceSync.setComplianceFrameworks).toHaveBeenCalledWith(
        'p-new',
        ['SOC2', 'HIPAA'],
        'tok',
      );
    });

    it('createProject does not call security_rules for a project without frameworks', async () => {
      service.createProject.mockResolvedValue({ projectId: 'p-new' } as any);

      await controller.createProject(
        '33333333-3333-3333-3333-333333333333',
        { name: 'N' } as ProjectCreateBodyDto,
        { user: { sub: 'u1' }, headers: {} } as any,
      );
      await controller.createProject(
        '33333333-3333-3333-3333-333333333333',
        {
          name: 'N',
          securityContext: { environment: 'staging', complianceFrameworks: [] },
        } as ProjectCreateBodyDto,
        { user: { sub: 'u1' }, headers: {} } as any,
      );

      expect(complianceSync.setComplianceFrameworks).not.toHaveBeenCalled();
    });

    it('createProject still answers when the frameworks sync rejects', async () => {
      const created = { projectId: 'p-new' } as any;
      service.createProject.mockResolvedValue(created);
      complianceSync.setComplianceFrameworks.mockRejectedValue(
        new Error('ingestion down'),
      );

      await expect(
        controller.createProject(
          '33333333-3333-3333-3333-333333333333',
          {
            name: 'N',
            securityContext: { complianceFrameworks: ['SOC2'] },
          } as ProjectCreateBodyDto,
          { user: { sub: 'u1' }, headers: {} } as any,
        ),
      ).resolves.toBe(created);
      expect(complianceSync.setComplianceFrameworks).toHaveBeenCalledWith(
        'p-new',
        ['SOC2'],
        '',
      );
    });

    it('does not fail the request when the sync rejects', async () => {
      service.getProjectSecurityContext.mockResolvedValue({
        securityContext,
      } as any);
      complianceSync.setComplianceFrameworks.mockRejectedValue(
        new Error('ingestion down'),
      );

      await expect(
        controller.getProjectSecurityContext('p1', { headers: {} } as any),
      ).resolves.toBeDefined();
    });
  });
});
