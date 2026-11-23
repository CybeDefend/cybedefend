// Mock uuid before importing the controller
jest.mock('uuid', () => ({
  v6: jest.fn(() => 'mock-uuid-v6'),
}));

import 'reflect-metadata';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ScanController } from './scan.controller';
import { ScanService } from './scan.service';
import { ProjectService } from 'src/modules/project/project.service';
import { OrganizationService } from 'src/modules/organization/organization.service';
import { Logger } from 'nestjs-pino';
import { CombinedAuthRateLimitGuard } from 'src/core/guards/combined-auth-rate-limit.guard';
import { PermissionsGuard } from 'src/core/guards/permissions/permissions.guard';
import { AuthGuard } from 'src/core/guards/auth/auth.guard';
import { RateLimitGuard } from 'src/core/guards/throttler/throttler.guard';
import { FeatureGuard } from 'src/core/guards/feature/feature.guard';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import SecretsService from 'src/core/secrets/secrets.service';
import { ProjectInformationsResponse } from '@grpc/global-management/project';
import { GetScanRequest } from '@grpc/security-scanning/scan';
import { UploadFileResponse } from '@grpc/file-management/file';

describe('ScanController', () => {
  let controller: ScanController;
  let scanService: jest.Mocked<ScanService>;
  let projectService: jest.Mocked<ProjectService>;
  const permissions = {
    canActivate: jest.fn().mockResolvedValue(true),
    checkPermission: jest.fn(),
  };
  const userReq = { user: { sub: 'u-token' } };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ScanController],
      providers: [
        {
          provide: ScanService,
          useValue: {
            getScan: jest.fn(),
            createScan: jest.fn(),
            processUploadFile: jest.fn(),
            checkExistingScan: jest.fn(),
            startScan: jest.fn(),
            cancelScan: jest.fn(),
          },
        },
        {
          provide: ProjectService,
          useValue: {
            getProject: jest.fn(),
            updateProject: jest.fn(),
          },
        },
        { provide: OrganizationService, useValue: {} },
        {
          provide: Logger,
          useValue: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
        },
        {
          provide: CombinedAuthRateLimitGuard,
          useValue: { canActivate: jest.fn().mockResolvedValue(true) },
        },
        { provide: PermissionsGuard, useValue: permissions },
        {
          provide: AuthGuard,
          useValue: { canActivate: jest.fn().mockResolvedValue(true) },
        },
        {
          provide: RateLimitGuard,
          useValue: { canActivate: jest.fn().mockResolvedValue(true) },
        },
        { provide: Reflector, useValue: { get: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: SecretsService, useValue: { getSecret: jest.fn() } },
      ],
    })
      .overrideGuard(FeatureGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(ScanController);
    scanService = module.get(ScanService);
    projectService = module.get(ProjectService);
    permissions.checkPermission.mockReset().mockResolvedValue(true);
  });

  describe('getScan', () => {
    it('forwards projectId to downstream and returns the scan', async () => {
      // The gateway MUST send the projectId alongside the scanId
      // so the downstream security-scanning service can verify the scan belongs
      // to the requested project.
      const projectId = '11111111-1111-4111-8111-111111111111';
      const scanId = '22222222-2222-4222-8222-222222222222';
      const expected = { id: scanId } as any;
      (scanService.getScan as jest.Mock).mockResolvedValue(expected);

      const res = await controller.getScan(userReq, projectId, scanId);
      expect(scanService.getScan).toHaveBeenCalledWith({
        scanId,
        projectId,
        includePipeline: true,
      } as GetScanRequest);
      expect(res).toBe(expected);
    });

    // The dashboard polls this route every 5 s per active scan. It used to call
    // global-management's getProject first and discard the answer, and that
    // getProject fans out to analysis-reporting (~12 counting queries),
    // external-integrations and security-scanning, which made scan polls most
    // of global-management's load. Access is already decided by PermissionsGuard
    // (read_scan_result on the path project, whose Permify relation is removed
    // before a project is deleted) and security-scanning checks that the scan
    // belongs to that project.
    it('does not call global-management on a scan poll', async () => {
      (scanService.getScan as jest.Mock).mockResolvedValue({} as any);

      await controller.getScan(
        userReq,
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
      );

      expect(projectService.getProject).not.toHaveBeenCalled();
    });

    // The user-facing route asks
    // security-scanning for where the scan really is (queue position, scanner
    // lane, AI stage). Internal callers never set the flag and pay nothing
    // more. The response is still the gRPC one, as is.
    it('asks security-scanning for the scan pipeline and returns it as is', async () => {
      const projectId = '11111111-1111-4111-8111-111111111111';
      const scanId = '22222222-2222-4222-8222-222222222222';
      const expected = {
        id: scanId,
        state: 'running',
        pipeline: {
          slotReleased: true,
          scanners: { total: 2, open: 0, completed: 2, failed: 0 },
          agent: { stage: 'analyzing', processed: 45, total: 165 },
        },
      } as any;
      (scanService.getScan as jest.Mock).mockResolvedValue(expected);

      const res = await controller.getScan(userReq, projectId, scanId);

      expect(
        (scanService.getScan as jest.Mock).mock.calls[0][0].includePipeline,
      ).toBe(true);
      expect(res).toBe(expected);
    });

    it('propagates error from service to a member of the project', async () => {
      (scanService.getScan as jest.Mock).mockRejectedValue(new Error('boom'));
      await expect(
        controller.getScan(
          userReq,
          '11111111-1111-4111-8111-111111111111',
          '22222222-2222-4222-8222-222222222222',
        ),
      ).rejects.toThrow('boom');
      expect(permissions.checkPermission).toHaveBeenCalledWith(
        '11111111-1111-4111-8111-111111111111',
        'project',
        'read',
        'u-token',
      );
    });

    it('answers 403, not the service error, to a caller outside the project', async () => {
      (scanService.getScan as jest.Mock).mockRejectedValue(
        new NotFoundException('Scan not found'),
      );
      permissions.checkPermission.mockResolvedValueOnce(false);
      await expect(
        controller.getScan(
          userReq,
          '11111111-1111-4111-8111-111111111111',
          '22222222-2222-4222-8222-222222222222',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  // GET /project/:projectId/scan/:scanId is never readable
  // without a Permify check. Since the product split the check runs in the
  // handler (by scan kind, see above), not through a static guard that would
  // add a second Permify call per poll.
  describe('getScan permission decorators (project-scoped read)', () => {
    const proto = (ScanController as any).prototype;

    it('carries no static permission: the handler checks it', () => {
      expect(Reflect.getMetadata('permissions', proto.getScan)).toBeUndefined();
      expect(
        Reflect.getMetadata('__guards__', proto.getScan) ?? [],
      ).not.toContain(PermissionsGuard);
    });

    it('is authenticated by the controller guard', () => {
      expect(Reflect.getMetadata('__guards__', ScanController)).toContain(
        CombinedAuthRateLimitGuard,
      );
    });
  });

  describe('startScan', () => {
    it('creates scan, uploads file and returns upload response', async () => {
      const projectId = '11111111-1111-4111-8111-111111111111';
      const userId = '33333333-3333-4333-8333-333333333333';
      const req: any = { user: { sub: userId } };
      const body = { branch: 'main' };
      const projInfo: ProjectInformationsResponse = {
        id: projectId,
        name: 'P',
        description: 'D',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        scaEnabled: true,
        iacEnabled: false,
        sastEnabled: true,
      } as any;
      (projectService.getProject as jest.Mock).mockResolvedValue(projInfo);
      (scanService.checkExistingScan as jest.Mock).mockResolvedValue({
        exists: false,
      });
      const uploadRes: UploadFileResponse = {
        url: 'https://signed-url',
      } as any;
      (scanService.processUploadFile as jest.Mock).mockResolvedValue(uploadRes);
      (scanService.createScan as jest.Mock).mockResolvedValue({
        message: 'created',
      });

      const res = await controller.startScan(projectId, body as any, req);
      // Type scan for sca + sast
      expect(scanService.processUploadFile).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId,
          typeScan: expect.stringContaining('sca'),
        }),
      );
      expect(scanService.createScan).toHaveBeenCalledWith(
        expect.objectContaining({ projectId, initializerUserId: userId }),
      );
      expect(res).toBe(uploadRes);
    });

    // The core names no scan.proto field a registered product adds:
    // an AppSec start sends no graph-only key at all.
    it('sends no graph-only field for appsec', async () => {
      (projectService.getProject as jest.Mock).mockResolvedValue({
        sastEnabled: true,
      } as any);
      (scanService.processUploadFile as jest.Mock).mockResolvedValue({
        url: 'https://signed-url',
      } as any);
      (scanService.createScan as jest.Mock).mockResolvedValue({});

      await controller.startScan(
        '11111111-1111-4111-8111-111111111111',
        { product: 'appsec' } as any,
        userReq,
      );

      const sent = (scanService.createScan as jest.Mock).mock.calls[0][0];
      expect(sent).not.toHaveProperty('graphOnly');
    });
  });

  describe('startContainerScan', () => {
    const projectId = '550e8400-e29b-41d4-a716-446655440000';
    const req = { user: { sub: 'user-1' } };

    beforeEach(() => {
      (projectService.getProject as jest.Mock).mockResolvedValue({
        id: projectId,
      } as any);
      (scanService.checkExistingScan as jest.Mock).mockResolvedValue({
        exists: true,
      });
      (scanService.createScan as jest.Mock).mockResolvedValue({
        success: true,
      });
      (scanService.startScan as jest.Mock).mockResolvedValue({
        success: true,
        message: 'started',
        detectedLanguages: [],
      });
    });

    it('checks the CONTAINER pool for the same image, so a running SAST/SCA scan never blocks it', async () => {
      await controller.startContainerScan(
        projectId,
        { imageToScan: 'https://registry.example/App:1' } as any,
        req,
      );

      expect(scanService.checkExistingScan).toHaveBeenCalledWith({
        projectId,
        scanType: 'container',
        imageToScan: 'registry.example/App:1',
      });
      expect(scanService.createScan).toHaveBeenCalledWith(
        expect.objectContaining({ projectId, scanType: 'container' }),
      );
    });

    it('does not create the scan when the same image is already being scanned', async () => {
      (scanService.checkExistingScan as jest.Mock).mockRejectedValue(
        new Error('A scan of this image is already in progress'),
      );

      await expect(
        controller.startContainerScan(
          projectId,
          { imageToScan: 'registry.example/app:1' } as any,
          req,
        ),
      ).rejects.toThrow(/already in progress/);

      expect(scanService.createScan).not.toHaveBeenCalled();
      expect(scanService.startScan).not.toHaveBeenCalled();
    });
  });

  it('startScan (code) checks the CODE pool only: no scan kind, no image', async () => {
    const projectId = '550e8400-e29b-41d4-a716-446655440000';
    (projectService.getProject as jest.Mock).mockResolvedValue({
      sastEnabled: true,
      iacEnabled: false,
      scaEnabled: false,
    } as any);
    (scanService.checkExistingScan as jest.Mock).mockResolvedValue({
      exists: true,
    });
    (scanService.processUploadFile as jest.Mock).mockResolvedValue({
      url: 'https://signed-url',
    } as any);
    (scanService.createScan as jest.Mock).mockResolvedValue({ success: true });

    await controller.startScan(projectId, { branch: 'main' } as any, {
      user: { sub: 'user-1' },
    });

    expect(scanService.checkExistingScan).toHaveBeenCalledWith({
      projectId,
      branch: 'main',
    });
  });

  // Starting a scan reads the project's scanner flags (and, for a
  // diff scan, its default minimum severity); a container scan only checks the
  // project exists. A full ProjectService/Get also counted the project's
  // vulnerabilities in analysis-reporting before any of them. The lean read
  // still answers NOT_FOUND for an unknown project.
  describe('project read before a scan starts', () => {
    const projectId = '550e8400-e29b-41d4-a716-446655440000';
    const lean = {
      projectId,
      skipVulnerabilityStats: true,
      skipIntegrationStatus: true,
      skipSecurityContext: true,
    };

    beforeEach(() => {
      (projectService.getProject as jest.Mock).mockResolvedValue({
        sastEnabled: true,
        iacEnabled: false,
        scaEnabled: true,
        secretEnabled: false,
        diffScanMinSeverity: 'high',
      } as any);
      (scanService.checkExistingScan as jest.Mock).mockResolvedValue({
        exists: false,
      });
      (scanService.processUploadFile as jest.Mock).mockResolvedValue({
        url: 'https://signed-url',
      } as any);
      (scanService.createScan as jest.Mock).mockResolvedValue({
        success: true,
      });
      (scanService.startScan as jest.Mock).mockResolvedValue({
        success: true,
        message: 'started',
        detectedLanguages: [],
      });
    });

    it('startScan', async () => {
      await controller.startScan(projectId, {} as any, {
        user: { sub: 'u1' },
      });

      expect(projectService.getProject).toHaveBeenCalledWith(lean);
      expect(scanService.processUploadFile).toHaveBeenCalledWith(
        expect.objectContaining({ typeScan: 'sast,sca' }),
      );
    });

    it('startContainerScan', async () => {
      await controller.startContainerScan(
        projectId,
        { imageToScan: 'registry.example/app:1' } as any,
        { user: { sub: 'u1' } },
      );

      expect(projectService.getProject).toHaveBeenCalledWith(lean);
    });
  });
});
