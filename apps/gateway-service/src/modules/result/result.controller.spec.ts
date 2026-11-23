import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from 'nestjs-pino';
import { ResultController } from './result.controller';
import { ResultService } from './result.service';
import { CombinedAuthRateLimitGuard } from 'src/core/guards/combined-auth-rate-limit.guard';
import { PermissionsGuard } from 'src/core/guards/permissions/permissions.guard';
import { AuthGuard } from 'src/core/guards/auth/auth.guard';
import { RateLimitGuard } from 'src/core/guards/throttler/throttler.guard';
import { FeatureGuard } from 'src/core/guards/feature/feature.guard';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { HttpService } from '@nestjs/axios';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import SecretsService from 'src/core/secrets/secrets.service';

import {
  GetProjectContainerImagesResponse,
  GetProjectContainerVulnerabilitiesResponse,
  GetProjectContainerVulnerabilityByIdResponse,
  GetProjectIacVulnerabilitiesResponse,
  GetProjectOverviewResponse,
  GetProjectPackagesResponse,
  GetProjectSastVulnerabilitiesResponse,
  GetProjectScaVulnerabilitiesResponse,
  GetProjectVulnerabilityByIdResponse,
  ProjectDeleteResponse,
  UpdateProjectVulnerabilityResponse,
} from '@grpc/analysis-reporting/result';

describe('ResultController', () => {
  let controller: ResultController;
  let service: jest.Mocked<ResultService>;
  let permissionsGuard: { canActivate: jest.Mock; checkPermission: jest.Mock };

  beforeEach(async () => {
    permissionsGuard = {
      canActivate: jest.fn().mockResolvedValue(true),
      checkPermission: jest.fn().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ResultController],
      providers: [
        {
          provide: ResultService,
          useValue: {
            findAllContainerImages: jest.fn(),
            findAllContainerPackages: jest.fn(),
            findAllContainer: jest.fn(),
            findOneContainer: jest.fn(),
            findAllSast: jest.fn(),
            findAllIac: jest.fn(),
            findAllCicd: jest.fn(),
            findAllSecret: jest.fn(),
            findAllSca: jest.fn(),
            getGroupedSastVulnerabilities: jest.fn(),
            getGroupedIacVulnerabilities: jest.fn(),
            getGroupedCicdVulnerabilities: jest.fn(),
            getGroupedSecretVulnerabilities: jest.fn(),
            findAllScaPackages: jest.fn(),
            findOneSca: jest.fn(),
            findOneSast: jest.fn(),
            findOneIac: jest.fn(),
            update: jest.fn(),
            getProjectOverview: jest.fn(),
            deleteContainerImage: jest.fn(),
            generateBatchReport: jest.fn(),
            getBatchProjectsBranches: jest.fn(),
            batchUpdate: jest.fn(),
            getOrganizationSeverityDistribution: jest.fn(),
            getOrganizationStateDistribution: jest.fn(),
            getOrganizationVulnerabilitiesOverTime: jest.fn(),
            // stored-report endpoints
            deleteGeneratedReport: jest.fn(),
            deleteAggregatedReport: jest.fn(),
            listGeneratedReports: jest.fn(),
            listAggregatedReports: jest.fn(),
            getReportUsage: jest.fn(),
          },
        },
        {
          provide: Logger,
          useValue: { log: jest.fn(), error: jest.fn(), warn: jest.fn() },
        },
        { provide: HttpService, useValue: { get: jest.fn() } },
        { provide: Reflector, useValue: { get: jest.fn() } },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue(undefined) },
        },
        {
          provide: SecretsService,
          useValue: { getSecret: jest.fn().mockReturnValue(undefined) },
        },
        {
          provide: CombinedAuthRateLimitGuard,
          useValue: { canActivate: jest.fn().mockResolvedValue(true) },
        },
        {
          provide: PermissionsGuard,
          useValue: permissionsGuard,
        },
        {
          provide: AuthGuard,
          useValue: { canActivate: jest.fn().mockResolvedValue(true) },
        },
        {
          provide: RateLimitGuard,
          useValue: { canActivate: jest.fn().mockResolvedValue(true) },
        },
      ],
    })
      .overrideGuard(FeatureGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<ResultController>(ResultController);
    service = module.get(ResultService) as any;
  });

  describe('container queries', () => {
    it('findAllContainer maps query and optional imageId', async () => {
      const res: GetProjectContainerVulnerabilitiesResponse = {
        vulnerabilities: [],
        total: 0,
      } as any;
      service.findAllContainer.mockResolvedValue(res);
      const out = await controller.findAllContainer(
        '11111111-1111-1111-1111-111111111111',
        {
          page: 2,
          limit: 5,
          sort: 'severity',
          order: 'desc',
          searchQuery: 'x',
          classType: ['os'],
        } as any,
        '22222222-2222-2222-2222-222222222222',
      );
      expect(out).toEqual(res);
      expect(service.findAllContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: '11111111-1111-1111-1111-111111111111',
          imageId: '22222222-2222-2222-2222-222222222222',
        }),
      );
    });

    it('findAllContainerImages maps projectId', async () => {
      const res: GetProjectContainerImagesResponse = { images: [] } as any;
      service.findAllContainerImages.mockResolvedValue(res);
      const out = await controller.findAllContainerImages(
        '11111111-1111-1111-1111-111111111111',
        { page: 1, limit: 10 } as any,
      );
      expect(out).toEqual(res);
      expect(service.findAllContainerImages).toHaveBeenCalledWith({
        projectId: '11111111-1111-1111-1111-111111111111',
        page: 1,
        limit: 10,
      });
    });

    it('findAllContainerPackages maps query and optional imageId', async () => {
      const res: GetProjectPackagesResponse = { packages: [], total: 0 } as any;
      service.findAllContainerPackages.mockResolvedValue(res);
      const out = await controller.findAllContainerPackages(
        '11111111-1111-1111-1111-111111111111',
        { page: 1, limit: 10, classType: ['os'] } as any,
        '22222222-2222-2222-2222-222222222222',
      );
      expect(out).toEqual(res);
      expect(service.findAllContainerPackages).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: '11111111-1111-1111-1111-111111111111',
          imageId: '22222222-2222-2222-2222-222222222222',
        }),
      );
    });

    it('findOneContainer maps path params', async () => {
      const res: GetProjectContainerVulnerabilityByIdResponse = {
        vulnerability: {} as any,
      } as any;
      service.findOneContainer.mockResolvedValue(res);
      const out = await controller.findOneContainer(
        '11111111-1111-1111-1111-111111111111',
        '33333333-3333-3333-3333-333333333333',
      );
      expect(out).toEqual(res);
      expect(service.findOneContainer).toHaveBeenCalledWith({
        projectId: '11111111-1111-1111-1111-111111111111',
        vulnerabilityId: '33333333-3333-3333-3333-333333333333',
      });
    });
  });

  describe('SAST/IaC/SCA lists', () => {
    it('findAllSast maps query to request', async () => {
      const res: GetProjectSastVulnerabilitiesResponse = {
        vulnerabilities: [],
        total: 0,
      } as any;
      service.findAllSast.mockResolvedValue(res);
      const out = await controller.findAllSast(
        { user: { sub: 'u1' } } as any,
        '11111111-1111-1111-1111-111111111111',
        {
          pageNumber: 1,
          pageSizeNumber: 20,
          searchQuery: 'q',
          language: 'ts',
        } as any,
      );
      expect(out).toEqual(res);
      expect(service.findAllSast).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: '11111111-1111-1111-1111-111111111111',
          pageNumber: 1,
          pageSizeNumber: 20,
        }),
      );
    });

    it('findAllIac maps query to request', async () => {
      const res: GetProjectIacVulnerabilitiesResponse = {
        vulnerabilities: [],
        total: 0,
      } as any;
      service.findAllIac.mockResolvedValue(res);
      const out = await controller.findAllIac(
        '11111111-1111-1111-1111-111111111111',
        { pageNumber: 2, pageSizeNumber: 10, priority: 'high' } as any,
      );
      expect(out).toEqual(res);
      expect(service.findAllIac).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: '11111111-1111-1111-1111-111111111111',
          pageNumber: 2,
          pageSizeNumber: 10,
        }),
      );
    });

    it('findAllSca maps query to request', async () => {
      const res: GetProjectScaVulnerabilitiesResponse = {
        vulnerabilities: [],
        total: 0,
      } as any;
      service.findAllSca.mockResolvedValue(res);
      const out = await controller.findAllSca(
        { user: { sub: 'u1' } } as any,
        '11111111-1111-1111-1111-111111111111',
        { page: 1, limit: 10, packageType: 'npm', searchQuery: 'q' } as any,
      );
      expect(out).toEqual(res);
      expect(service.findAllSca).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: '11111111-1111-1111-1111-111111111111',
          page: 1,
          limit: 10,
          packageType: 'npm',
        }),
      );
    });

    it('findAllScaPackages maps query to request', async () => {
      const res: GetProjectPackagesResponse = { packages: [], total: 0 } as any;
      service.findAllScaPackages.mockResolvedValue(res);
      const out = await controller.findAllScaPackages(
        '11111111-1111-1111-1111-111111111111',
        {
          page: 3,
          limit: 15,
          packageType: 'npm',
          packageManager: ['npm'],
          packageSource: ['package.json'],
        } as any,
      );
      expect(out).toEqual(res);
      expect(service.findAllScaPackages).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: '11111111-1111-1111-1111-111111111111',
          page: 3,
          limit: 15,
          packageManager: ['npm'],
          packageSource: ['package.json'],
        }),
      );
    });
  });

  describe('scoring source filter', () => {
    it('findAllSast propagates scoringSource to gRPC request', async () => {
      service.findAllSast.mockResolvedValue({} as any);
      await controller.findAllSast(
        { user: { sub: 'u1' } } as any,
        '11111111-1111-1111-1111-111111111111',
        { scoringSource: 'agent' } as any,
      );
      expect(service.findAllSast).toHaveBeenCalledWith(
        expect.objectContaining({ scoringSource: 'agent' }),
      );
    });

    it('findAllIac propagates scoringSource to gRPC request', async () => {
      service.findAllIac.mockResolvedValue({} as any);
      await controller.findAllIac('11111111-1111-1111-1111-111111111111', {
        scoringSource: 'agent',
      } as any);
      expect(service.findAllIac).toHaveBeenCalledWith(
        expect.objectContaining({ scoringSource: 'agent' }),
      );
    });

    it('findAllCicd propagates scoringSource to gRPC request', async () => {
      (service as any).findAllCicd.mockResolvedValue({} as any);
      await controller.findAllCicd('11111111-1111-1111-1111-111111111111', {
        scoringSource: 'agent',
      } as any);
      expect((service as any).findAllCicd).toHaveBeenCalledWith(
        expect.objectContaining({ scoringSource: 'agent' }),
      );
    });

    it('findAllSecret propagates scoringSource to gRPC request', async () => {
      (service as any).findAllSecret.mockResolvedValue({} as any);
      await controller.findAllSecret('11111111-1111-1111-1111-111111111111', {
        scoringSource: 'agent',
      } as any);
      expect((service as any).findAllSecret).toHaveBeenCalledWith(
        expect.objectContaining({ scoringSource: 'agent' }),
      );
    });

    it('findAllSca propagates scoringSource to gRPC request', async () => {
      service.findAllSca.mockResolvedValue({} as any);
      await controller.findAllSca(
        { user: { sub: 'u1' } } as any,
        '11111111-1111-1111-1111-111111111111',
        { scoringSource: 'static' } as any,
      );
      expect(service.findAllSca).toHaveBeenCalledWith(
        expect.objectContaining({ scoringSource: 'static' }),
      );
    });

    it('findAllContainer propagates scoringSource to gRPC request', async () => {
      service.findAllContainer.mockResolvedValue({} as any);
      await controller.findAllContainer(
        '11111111-1111-1111-1111-111111111111',
        { scoringSource: 'agent' } as any,
        '22222222-2222-2222-2222-222222222222',
      );
      expect(service.findAllContainer).toHaveBeenCalledWith(
        expect.objectContaining({ scoringSource: 'agent' }),
      );
    });
  });

  describe('detail endpoints', () => {
    it('findOneSca maps params', async () => {
      const res: GetProjectVulnerabilityByIdResponse = {
        vulnerability: {} as any,
      } as any;
      service.findOneSca.mockResolvedValue(res);
      const out = await controller.findOneSca(
        { user: { sub: 'u1' } } as any,
        '11111111-1111-1111-1111-111111111111',
        '44444444-4444-4444-4444-444444444444',
      );
      expect(out).toEqual(res);
      expect(service.findOneSca).toHaveBeenCalledWith({
        projectId: '11111111-1111-1111-1111-111111111111',
        vulnerabilityId: '44444444-4444-4444-4444-444444444444',
      });
    });

    it('findOneSast maps params', async () => {
      const res: GetProjectVulnerabilityByIdResponse = {
        vulnerability: {} as any,
      } as any;
      service.findOneSast.mockResolvedValue(res);
      const out = await controller.findOneSast(
        { user: { sub: 'u1' } } as any,
        '11111111-1111-1111-1111-111111111111',
        '55555555-5555-5555-5555-555555555555',
      );
      expect(out).toEqual(res);
      expect(service.findOneSast).toHaveBeenCalledWith({
        projectId: '11111111-1111-1111-1111-111111111111',
        vulnerabilityId: '55555555-5555-5555-5555-555555555555',
      });
    });

    it('findOneIac maps params', async () => {
      const res: GetProjectVulnerabilityByIdResponse = {
        vulnerability: {} as any,
      } as any;
      service.findOneIac.mockResolvedValue(res);
      const out = await controller.findOneIac(
        { user: { sub: 'u1' } } as any,
        '11111111-1111-1111-1111-111111111111',
        '66666666-6666-6666-6666-666666666666',
      );
      expect(out).toEqual(res);
      expect(service.findOneIac).toHaveBeenCalledWith({
        projectId: '11111111-1111-1111-1111-111111111111',
        vulnerabilityId: '66666666-6666-6666-6666-666666666666',
      });
    });
  });

  describe('update', () => {
    it('maps body and req.user into UpdateResultRequest', async () => {
      const res: UpdateProjectVulnerabilityResponse = { message: 'ok' } as any;
      service.update.mockResolvedValue(res);
      const out = await controller.update(
        { user: { sub: 'u1' } } as any,
        '11111111-1111-1111-1111-111111111111',
        '77777777-7777-7777-7777-777777777777',
        { status: 'resolved', priority: 'normal', comment: 'c' } as any,
      );
      expect(out).toEqual(res);
      expect(service.update).toHaveBeenCalledWith({
        projectId: '11111111-1111-1111-1111-111111111111',
        vulnerabilityId: '77777777-7777-7777-7777-777777777777',
        status: 'resolved',
        priority: 'normal',
        comment: 'c',
        userId: 'u1',
        exploitabilityScore: 0,
        exploitabilityVerdict: '',
        exploitabilityReason: '',
        exploitabilitySource: '',
        exploitabilityFactors: '',
        cvss4EnvAdjustments: '',
        scoringSource: '',
        exploitabilityScoreReason: '',
        agentToolCallId: '',
        agentConversationId: '',
        agentStreamId: '',
        dismissalReason: '',
      });
    });

    // exploitabilityVerdict / exploitabilityReason on the public DTO.
    it('forwards exploitabilityVerdict + reason and forces exploitabilitySource=manual', async () => {
      service.update.mockResolvedValue({} as any);
      await controller.update(
        { user: { sub: 'u2' } } as any,
        '11111111-1111-1111-1111-111111111111',
        '77777777-7777-7777-7777-777777777777',
        {
          exploitabilityVerdict: 'not_exploitable',
          exploitabilityReason: 'in tests folder',
        } as any,
      );
      expect(service.update).toHaveBeenCalledWith(
        expect.objectContaining({
          exploitabilityVerdict: 'not_exploitable',
          exploitabilityReason: 'in tests folder',
          exploitabilitySource: 'manual',
        }),
      );
    });

    // Without verdict, source must NOT be forced to 'manual'.
    it('does not force exploitabilitySource=manual when verdict is absent', async () => {
      service.update.mockResolvedValue({} as any);
      await controller.update(
        { user: { sub: 'u3' } } as any,
        '11111111-1111-1111-1111-111111111111',
        '77777777-7777-7777-7777-777777777777',
        { status: 'resolved' } as any,
      );
      expect(service.update).toHaveBeenCalledWith(
        expect.objectContaining({
          exploitabilityVerdict: '',
          exploitabilitySource: '',
        }),
      );
    });

    // The public API never carries exploitability factors: they are
    // an agent-observed judgement of the code, so a manual verdict always keeps
    // the frozen VERDICT_TO_SCORE value.
    it('never forwards exploitability factors from the public client', async () => {
      service.update.mockResolvedValue({} as any);
      await controller.update(
        { user: { sub: 'u5' } } as any,
        '11111111-1111-1111-1111-111111111111',
        '77777777-7777-7777-7777-777777777777',
        {
          exploitabilityVerdict: 'proven',
          exploitabilityFactors: JSON.stringify({
            attackVector: 'network',
            attackComplexity: 'low',
            privilegesRequired: 'none',
            userInteraction: 'none',
          }),
        } as any,
      );
      expect(service.update).toHaveBeenCalledWith(
        expect.objectContaining({
          exploitabilitySource: 'manual',
          exploitabilityFactors: '',
        }),
      );
    });

    // Agent audit fields propagated for HistoryItem traceability.
    it('propagates agentToolCallId / agentConversationId / agentStreamId', async () => {
      service.update.mockResolvedValue({} as any);
      await controller.update(
        { user: { sub: 'u4' } } as any,
        '11111111-1111-1111-1111-111111111111',
        '77777777-7777-7777-7777-777777777777',
        {
          exploitabilityVerdict: 'theoretical',
          agentToolCallId: 'tc-abc',
          agentConversationId: 'conv-1',
          agentStreamId: 'stream-1',
        } as any,
      );
      expect(service.update).toHaveBeenCalledWith(
        expect.objectContaining({
          agentToolCallId: 'tc-abc',
          agentConversationId: 'conv-1',
          agentStreamId: 'stream-1',
        }),
      );
    });

    // A DTO field nobody forwards is not a contract.
    // `assertDismissalReason` in analysis-reporting rejects an `ignored` with no
    // reason, so dropping it here would turn every single-finding dismissal into
    // a 400 that the caller cannot fix.
    it('forwards dismissalReason to analysis-reporting', async () => {
      service.update.mockResolvedValue({} as any);
      await controller.update(
        { user: { sub: 'u5' } } as any,
        '11111111-1111-1111-1111-111111111111',
        '77777777-7777-7777-7777-777777777777',
        { status: 'ignored', dismissalReason: 'accepted risk' } as any,
      );
      expect(service.update).toHaveBeenCalledWith(
        expect.objectContaining({ dismissalReason: 'accepted risk' }),
      );
    });
  });

  describe('overview and delete', () => {
    it('getProjectOverview maps projectId', async () => {
      const res: GetProjectOverviewResponse = { total: 0 } as any;
      service.getProjectOverview.mockResolvedValue(res);
      const out = await controller.getProjectOverview(
        '11111111-1111-1111-1111-111111111111',
      );
      expect(out).toEqual(res);
      expect(service.getProjectOverview).toHaveBeenCalledWith({
        projectId: '11111111-1111-1111-1111-111111111111',
        branches: [],
      });
    });

    it('getProjectOverview maps projectId with branch filter', async () => {
      const res: GetProjectOverviewResponse = { total: 0 } as any;
      service.getProjectOverview.mockResolvedValue(res);
      const out = await controller.getProjectOverview(
        '11111111-1111-1111-1111-111111111111',
        { branches: ['main'] } as any,
      );
      expect(out).toEqual(res);
      expect(service.getProjectOverview).toHaveBeenCalledWith({
        projectId: '11111111-1111-1111-1111-111111111111',
        branches: ['main'],
      });
    });

    it('getBatchProjectsBranches forwards the path organizationId + body projectIds to the service', async () => {
      // The org id is the cross-org fence: the service uses it to drop
      // projectIds that don't belong to the path org before any fan-out.
      // projectIds now travel in the request body (endpoint moved to POST).
      const res = {
        projects: [
          {
            projectId: 'p1',
            branches: ['main'],
            archivedBranches: ['legacy'],
            defaultBranch: 'main',
          },
          {
            projectId: 'p2',
            branches: [],
            archivedBranches: [],
            defaultBranch: '',
          },
        ],
      };
      service.getBatchProjectsBranches.mockResolvedValue(res);
      const out = await controller.getBatchProjectsBranches(
        { user: { sub: 'user-1' } },
        '00000000-0000-0000-0000-000000000000',
        { projectIds: ['p1', 'p2'] } as any,
      );
      expect(out).toEqual(res);
      // The caller is the bearer's subject: the service refuses any body id
      // that is not one of the caller's readable projects in the path org.
      expect(service.getBatchProjectsBranches).toHaveBeenCalledWith(
        '00000000-0000-0000-0000-000000000000',
        'user-1',
        ['p1', 'p2'],
      );
    });

    it('deleteContainerImage maps params and logs', async () => {
      const res: ProjectDeleteResponse = { message: 'deleted' } as any;
      service.deleteContainerImage.mockResolvedValue(res);
      const out = await controller.deleteContainerImage(
        '11111111-1111-1111-1111-111111111111',
        '99999999-9999-9999-9999-999999999999',
      );
      expect(out).toEqual(res);
      expect(service.deleteContainerImage).toHaveBeenCalledWith({
        projectId: '11111111-1111-1111-1111-111111111111',
        imageId: '99999999-9999-9999-9999-999999999999',
      });
    });
  });

  describe('findAllSecret with commitSha and source filters', () => {
    it('passes commitSha and source to the gRPC request', async () => {
      (service as any).findAllSecret = jest
        .fn()
        .mockResolvedValue({ vulnerabilities: [], total: 0 });
      const out = await controller.findAllSecret(
        '11111111-1111-1111-1111-111111111111',
        {
          sort: 'severity',
          order: 'desc',
          severity: [],
          status: [],
          language: '',
          priority: [],
          pageNumber: 1,
          pageSizeNumber: 10,
          searchQuery: '',
          branch: 'main',
        } as any,
        undefined,
        'abc123',
        'history',
      );
      expect(out).toEqual({ vulnerabilities: [], total: 0 });
      expect((service as any).findAllSecret).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: '11111111-1111-1111-1111-111111111111',
          commitSha: 'abc123',
          source: 'history',
        }),
      );
    });

    it('defaults commitSha and source to empty string when not provided', async () => {
      (service as any).findAllSecret = jest
        .fn()
        .mockResolvedValue({ vulnerabilities: [], total: 0 });
      await controller.findAllSecret('11111111-1111-1111-1111-111111111111', {
        sort: 'severity',
        order: 'asc',
        severity: [],
        status: [],
        language: '',
        priority: [],
        pageNumber: 1,
        pageSizeNumber: 10,
        searchQuery: '',
      } as any);
      expect((service as any).findAllSecret).toHaveBeenCalledWith(
        expect.objectContaining({
          commitSha: '',
          source: '',
        }),
      );
    });
  });

  describe('secret reveal and rotate', () => {
    it('revealSecret returns wrapped response with secret and revealedAt', async () => {
      const grpcRes = {
        secret: 'ghp_supersecret',
        revealedAt: '2026-04-09T12:00:00Z',
      };
      (service as any).revealSecret = jest.fn().mockResolvedValue(grpcRes);
      const req = { user: { sub: 'user-uuid-1' } };
      const out = await controller.revealSecret(
        req as any,
        '11111111-1111-1111-1111-111111111111',
        '22222222-2222-2222-2222-222222222222',
      );
      expect(out).toEqual({
        success: true,
        data: { secret: 'ghp_supersecret', revealedAt: '2026-04-09T12:00:00Z' },
        message: 'Secret revealed',
      });
      expect((service as any).revealSecret).toHaveBeenCalledWith({
        projectId: '11111111-1111-1111-1111-111111111111',
        vulnerabilityId: '22222222-2222-2222-2222-222222222222',
        userId: 'user-uuid-1',
      });
    });

    it('rotateSecret returns wrapped response with state', async () => {
      const grpcRes = { state: 'resolved' };
      (service as any).rotateSecret = jest.fn().mockResolvedValue(grpcRes);
      const req = { user: { sub: 'user-uuid-1' } };
      const out = await controller.rotateSecret(
        req as any,
        '11111111-1111-1111-1111-111111111111',
        '33333333-3333-3333-3333-333333333333',
      );
      expect(out).toEqual({
        success: true,
        data: { state: 'resolved' },
        message: 'Secret marked as rotated',
      });
      expect((service as any).rotateSecret).toHaveBeenCalledWith({
        projectId: '11111111-1111-1111-1111-111111111111',
        vulnerabilityId: '33333333-3333-3333-3333-333333333333',
        userId: 'user-uuid-1',
      });
    });
  });

  describe('SCA filter wiring', () => {
    it('findAllSca forwards packageManager and packageSource to resultService', async () => {
      (service as any).findAllSca = jest.fn().mockResolvedValue({});
      await controller.findAllSca(
        {} as any,
        'p1',
        { packageManager: ['npm'], packageSource: ['pom.xml'] } as any,
        undefined,
      );
      expect((service as any).findAllSca).toHaveBeenCalledWith(
        expect.objectContaining({
          packageManager: ['npm'],
          packageSource: ['pom.xml'],
        }),
      );
    });

    it('getGroupedScaVulnerabilities forwards packageManager and packageSource to resultService', async () => {
      (service as any).getGroupedScaVulnerabilities = jest
        .fn()
        .mockResolvedValue({});
      await controller.getGroupedScaVulnerabilities('p1', {
        packageManager: ['npm'],
        packageSource: ['pom.xml'],
      } as any);
      expect(
        (service as any).getGroupedScaVulnerabilities,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          packageManager: ['npm'],
          packageSource: ['pom.xml'],
        }),
      );
    });

    it('getScaFilterOptions delegates to resultService.getScaFilterOptions', async () => {
      (service as any).getScaFilterOptions = jest
        .fn()
        .mockResolvedValue({ ecosystems: [], fileNames: [] });
      await controller.getScaFilterOptions('p1', 'main');
      expect((service as any).getScaFilterOptions).toHaveBeenCalledWith(
        'p1',
        'main',
      );
    });
  });

  describe('generateBatchReport (per-project Permify check)', () => {
    const organizationId = '11111111-1111-1111-1111-111111111111';
    const projectIdA = '22222222-2222-2222-2222-222222222222';
    const projectIdB = '33333333-3333-3333-3333-333333333333';
    const grpcResponse = {
      scopeType: 'batch',
      scopeId: `${projectIdA},${projectIdB}`,
      reportType: 'owasp',
      format: 'pdf',
      content: 'UERGLUJZVEVT',
      filename: 'batch-owasp.pdf',
      contentType: 'application/pdf',
      projectsCount: 2,
      projectIds: [projectIdA, projectIdB],
    } as any;

    it('throws ForbiddenException when user lacks read_report on at least one project', async () => {
      // Allow projectIdA, deny projectIdB (cross-tenant scenario)
      permissionsGuard.checkPermission.mockImplementation(
        async (resourceId: string) => resourceId === projectIdA,
      );

      const req = { user: { sub: 'user-1' } };
      await expect(
        controller.generateBatchReport(
          req as any,
          organizationId,
          'owasp',
          'pdf',
          {
            projectIds: [projectIdA, projectIdB],
            detailed: true,
            branchFilter: 'all',
          } as any,
        ),
      ).rejects.toThrow(/permission|forbidden|access/i);

      // Critical: service must NOT be called when any project check fails
      expect(service.generateBatchReport).not.toHaveBeenCalled();
    });

    it('checks read_report on every projectId in the body via Permify', async () => {
      permissionsGuard.checkPermission.mockResolvedValue(true);
      service.generateBatchReport.mockResolvedValue(grpcResponse);

      const req = { user: { sub: 'user-1' } };
      await controller.generateBatchReport(
        req as any,
        organizationId,
        'owasp',
        'pdf',
        {
          projectIds: [projectIdA, projectIdB],
          detailed: true,
          branchFilter: 'all',
        } as any,
      );

      // Each project must be checked individually
      expect(permissionsGuard.checkPermission).toHaveBeenCalledWith(
        projectIdA,
        'project',
        'read_report',
        'user-1',
        'user',
      );
      expect(permissionsGuard.checkPermission).toHaveBeenCalledWith(
        projectIdB,
        'project',
        'read_report',
        'user-1',
        'user',
      );
    });

    it('forwards to service when user has read_report on all projects (regression)', async () => {
      permissionsGuard.checkPermission.mockResolvedValue(true);
      service.generateBatchReport.mockResolvedValue(grpcResponse);

      const req = { user: { sub: 'user-1' } };
      const out = await controller.generateBatchReport(
        req as any,
        organizationId,
        'owasp',
        'pdf',
        {
          projectIds: [projectIdA],
          detailed: true,
          branchFilter: 'all',
        } as any,
      );

      expect(out).toEqual(grpcResponse);
      expect(service.generateBatchReport).toHaveBeenCalledTimes(1);
      expect(service.generateBatchReport).toHaveBeenCalledWith(
        [projectIdA],
        'user-1',
        'owasp',
        'pdf',
        true,
        'all',
        [],
        organizationId,
      );
    });

    it('does not leak project existence in the error message', async () => {
      permissionsGuard.checkPermission.mockResolvedValue(false);

      const req = { user: { sub: 'user-1' } };
      try {
        await controller.generateBatchReport(
          req as any,
          organizationId,
          'owasp',
          'pdf',
          {
            projectIds: [projectIdA, projectIdB],
          } as any,
        );
        throw new Error('expected ForbiddenException');
      } catch (err: any) {
        // Error message must not contain a project UUID
        expect(err.message).not.toContain(projectIdA);
        expect(err.message).not.toContain(projectIdB);
      }
    });
  });

  describe('split overview routes', () => {
    it('delegates severity-distribution to the service with userId from JWT', async () => {
      (service.getOrganizationSeverityDistribution as jest.Mock) = jest
        .fn()
        .mockResolvedValue({ totalBySeverity: [] });

      await controller.getOrganizationSeverityDistribution(
        { user: { sub: 'user-1' } } as any,
        'org-1',
        {} as any,
      );

      expect(service.getOrganizationSeverityDistribution).toHaveBeenCalledWith(
        'org-1',
        'user-1',
        {},
      );
    });

    it('delegates state-distribution to the service with userId from JWT', async () => {
      (service.getOrganizationStateDistribution as jest.Mock) = jest
        .fn()
        .mockResolvedValue({ totalByState: [] });

      await controller.getOrganizationStateDistribution(
        { user: { sub: 'user-1' } } as any,
        'org-1',
        {} as any,
      );

      expect(service.getOrganizationStateDistribution).toHaveBeenCalledWith(
        'org-1',
        'user-1',
        {},
      );
    });

    it('delegates vulnerabilities-over-time to the service with userId from JWT', async () => {
      (service.getOrganizationVulnerabilitiesOverTime as jest.Mock) = jest
        .fn()
        .mockResolvedValue({ vulnerabilitiesOverTime: [] });

      await controller.getOrganizationVulnerabilitiesOverTime(
        { user: { sub: 'user-1' } } as any,
        'org-1',
        {} as any,
      );

      expect(
        service.getOrganizationVulnerabilitiesOverTime,
      ).toHaveBeenCalledWith('org-1', 'user-1', {});
    });
  });

  describe('batchUpdate (async enqueue)', () => {
    it('delegates to resultService.batchUpdate and returns the enqueue DTO', async () => {
      const enqueueResponse = {
        taskId: 'task-xyz',
        status: 'queued' as const,
        total: 5,
      };
      (service.batchUpdate as jest.Mock).mockResolvedValue(enqueueResponse);

      const req = { user: { sub: 'user-42' } } as any;
      const body = {
        items: [{ vulnerabilityId: 'v1', status: 'resolved' }],
        agentToolCallId: 'tc-1',
        agentConversationId: 'conv-1',
        agentStreamId: 'stream-1',
      } as any;

      const result = await controller.batchUpdate(
        req,
        '11111111-1111-1111-1111-111111111111',
        body,
      );

      expect(service.batchUpdate).toHaveBeenCalledWith(
        '11111111-1111-1111-1111-111111111111',
        body.items,
        'user-42',
        {
          agentToolCallId: 'tc-1',
          agentConversationId: 'conv-1',
          agentStreamId: 'stream-1',
        },
      );
      expect(result).toEqual(enqueueResponse);
    });
  });

  describe('stored-report endpoints', () => {
    const req = { user: { sub: 'user-42' } } as any;
    const PID = '11111111-1111-1111-1111-111111111111';
    const OID = '22222222-2222-2222-2222-222222222222';
    const TID = '33333333-3333-3333-3333-333333333333';

    it('deleteGeneratedReport forwards (projectId, reportId)', async () => {
      (service.deleteGeneratedReport as jest.Mock).mockResolvedValue({
        success: true,
      });
      await controller.deleteGeneratedReport(req, PID, 'rep-1');
      expect(service.deleteGeneratedReport).toHaveBeenCalledWith(PID, 'rep-1');
    });

    it('deleteOrganizationReport matches by organizationId alone (empty scope) so org-owned team/batch reports are deletable', async () => {
      (service.deleteAggregatedReport as jest.Mock).mockResolvedValue({
        success: true,
      });
      await controller.deleteOrganizationReport(req, OID, 'rep-2');
      expect(service.deleteAggregatedReport).toHaveBeenCalledWith(
        '',
        '',
        OID,
        'rep-2',
      );
    });

    it('deleteTeamReport maps to deleteAggregatedReport(team, teamId, "", reportId) — org resolved server-side', async () => {
      (service.deleteAggregatedReport as jest.Mock).mockResolvedValue({
        success: true,
      });
      await controller.deleteTeamReport(req, TID, 'rep-3');
      expect(service.deleteAggregatedReport).toHaveBeenCalledWith(
        'team',
        TID,
        '',
        'rep-3',
      );
    });

    it('listGeneratedReports applies default page/pageSize (1/20)', async () => {
      (service.listGeneratedReports as jest.Mock).mockResolvedValue({
        items: [],
        total: 0,
      });
      await controller.listGeneratedReports(PID);
      expect(service.listGeneratedReports).toHaveBeenCalledWith(PID, 1, 20);
    });

    it('listGeneratedReports clamps page>=1 and pageSize<=100', async () => {
      (service.listGeneratedReports as jest.Mock).mockResolvedValue({
        items: [],
        total: 0,
      });
      await controller.listGeneratedReports(PID, '0', '999');
      expect(service.listGeneratedReports).toHaveBeenCalledWith(PID, 1, 100);
    });

    it('listOrganizationReports maps scope + passes parsed pagination', async () => {
      (service.listAggregatedReports as jest.Mock).mockResolvedValue({
        items: [],
        total: 0,
      });
      await controller.listOrganizationReports(OID, '2', '10');
      expect(service.listAggregatedReports).toHaveBeenCalledWith(
        'organization',
        OID,
        OID,
        2,
        10,
      );
    });

    it('listTeamReports maps scope with "" organizationId + default pagination', async () => {
      (service.listAggregatedReports as jest.Mock).mockResolvedValue({
        items: [],
        total: 0,
      });
      await controller.listTeamReports(TID);
      expect(service.listAggregatedReports).toHaveBeenCalledWith(
        'team',
        TID,
        '',
        1,
        20,
      );
    });

    it('getProjectReportUsage queries usage by projectId (org resolved server-side)', async () => {
      (service.getReportUsage as jest.Mock).mockResolvedValue({
        used: 3,
        limit: 500,
      });
      await controller.getProjectReportUsage(PID);
      expect(service.getReportUsage).toHaveBeenCalledWith({ projectId: PID });
    });

    it('getOrganizationReportUsage queries usage by organizationId', async () => {
      (service.getReportUsage as jest.Mock).mockResolvedValue({
        used: 3,
        limit: 500,
      });
      await controller.getOrganizationReportUsage(OID);
      expect(service.getReportUsage).toHaveBeenCalledWith({
        organizationId: OID,
      });
    });
  });

  // The dashboard Results pages ask the lists to leave out
  // the autofix counts they never show. The flag is read raw and parsed like
  // hasAutofix ('false' must stay false); absent, nothing changes.
  describe('excludeAutofixCounts', () => {
    const PID = '11111111-1111-1111-1111-111111111111';
    type Call = (raw?: string) => Promise<unknown>;
    const lists: Array<[string, keyof ResultService, Call]> = [
      [
        'findAllSast',
        'findAllSast',
        (raw) =>
          controller.findAllSast({} as any, PID, {} as any, undefined, raw),
      ],
      [
        'findAllIac',
        'findAllIac',
        (raw) => controller.findAllIac(PID, {} as any, undefined, raw),
      ],
      [
        'findAllCicd',
        'findAllCicd',
        (raw) => controller.findAllCicd(PID, {} as any, undefined, raw),
      ],
      [
        'findAllSecret',
        'findAllSecret',
        (raw) =>
          controller.findAllSecret(
            PID,
            {} as any,
            undefined,
            undefined,
            undefined,
            raw,
          ),
      ],
      [
        'findAllSca',
        'findAllSca',
        (raw) =>
          controller.findAllSca(
            {} as any,
            PID,
            {} as any,
            undefined,
            undefined,
            raw,
          ),
      ],
      [
        'getGroupedSastVulnerabilities',
        'getGroupedSastVulnerabilities',
        (raw) =>
          controller.getGroupedSastVulnerabilities(
            PID,
            {} as any,
            undefined,
            raw,
          ),
      ],
      [
        'getGroupedIacVulnerabilities',
        'getGroupedIacVulnerabilities',
        (raw) =>
          controller.getGroupedIacVulnerabilities(
            PID,
            {} as any,
            undefined,
            raw,
          ),
      ],
      [
        'getGroupedCicdVulnerabilities',
        'getGroupedCicdVulnerabilities',
        (raw) =>
          controller.getGroupedCicdVulnerabilities(
            PID,
            {} as any,
            undefined,
            raw,
          ),
      ],
      [
        'getGroupedSecretVulnerabilities',
        'getGroupedSecretVulnerabilities',
        (raw) =>
          controller.getGroupedSecretVulnerabilities(
            PID,
            {} as any,
            undefined,
            raw,
          ),
      ],
    ];

    it.each(lists)(
      '%s forwards excludeAutofixCounts, parsed from its query-string form',
      async (_name, method, call) => {
        const forwarded = service[method] as unknown as jest.Mock;
        forwarded.mockResolvedValue({});

        for (const [raw, expected] of [
          ['true', true],
          ['1', true],
          ['false', false],
          [undefined, undefined],
        ] as Array<[string | undefined, boolean | undefined]>) {
          forwarded.mockClear();
          await call(raw);
          expect(forwarded).toHaveBeenCalledTimes(1);
          expect(forwarded.mock.calls[0][0].excludeAutofixCounts).toBe(
            expected,
          );
        }
      },
    );
  });
});

describe('ResultController — container findings are feature-gated', () => {
  // container_scanning is a gated feature. Reading the findings must be gated
  // like starting a container scan and the registry integrations: a client-side
  // hidden tab does not stop the API from serving the rows. Every container
  // result route must carry the same gate as the scan start.
  it.each([
    'findAllContainerImages',
    'getGroupedContainerImages',
    'findAllContainerPackages',
    'findAllContainer',
    'findOneContainer',
    'deleteContainerImage',
    'getGroupedContainerVulnerabilities',
  ])('gates %s with @Feature(container_scanning) + FeatureGuard', (handler) => {
    const fn = (ResultController.prototype as any)[handler];
    expect(fn).toBeDefined();
    expect(Reflect.getMetadata('feature', fn)).toBe('container_scanning');
    const guards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, fn) ?? [];
    expect(guards).toContain(FeatureGuard);
    // Permify must answer BEFORE the plan is resolved from the
    // projectId, so a caller with no access learns nothing about the plan.
    expect(guards.indexOf(PermissionsGuard)).toBeGreaterThanOrEqual(0);
    expect(guards.indexOf(PermissionsGuard)).toBeLessThan(
      guards.indexOf(FeatureGuard),
    );
  });
});
