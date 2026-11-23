jest.mock('uuid', () => ({ v6: jest.fn(() => 'mock-uuid-v6') }));

import 'reflect-metadata';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { ScanController } from './scan.controller';
import { ScanService } from './scan.service';
import { ProjectService } from 'src/modules/project/project.service';
import { CombinedAuthRateLimitGuard } from 'src/core/guards/combined-auth-rate-limit.guard';
import { PermissionsGuard } from 'src/core/guards/permissions/permissions.guard';
import { AuthGuard } from 'src/core/guards/auth/auth.guard';
import { RateLimitGuard } from 'src/core/guards/throttler/throttler.guard';
import { FeatureGuard } from 'src/core/guards/feature/feature.guard';
import SecretsService from 'src/core/secrets/secrets.service';

describe('ScanController.getScanResultsStatus', () => {
  let controller: ScanController;
  const getScan = jest.fn();
  const permissions = { canActivate: jest.fn(), checkPermission: jest.fn() };
  const userReq = { user: { sub: 'u-token' } };
  const projectId = '11111111-1111-4111-8111-111111111111';
  const scanId = '22222222-2222-4222-8222-222222222222';
  const allow = { canActivate: jest.fn().mockResolvedValue(true) };

  beforeEach(async () => {
    getScan.mockReset();
    permissions.checkPermission.mockReset().mockResolvedValue(true);
    const module = await Test.createTestingModule({
      controllers: [ScanController],
      providers: [
        { provide: ScanService, useValue: { getScan } },
        { provide: ProjectService, useValue: {} },
        { provide: Logger, useValue: { log: jest.fn(), warn: jest.fn() } },
        { provide: CombinedAuthRateLimitGuard, useValue: allow },
        { provide: PermissionsGuard, useValue: permissions },
        { provide: AuthGuard, useValue: allow },
        { provide: RateLimitGuard, useValue: allow },
        { provide: Reflector, useValue: { get: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: SecretsService, useValue: { getSecret: jest.fn() } },
      ],
    })
      .overrideGuard(FeatureGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = module.get(ScanController);
  });

  it('projects the four fields and asks without the pipeline', async () => {
    getScan.mockResolvedValue({
      id: scanId,
      state: 'completed',
      resultsStatus: 'ready',
      resultsFinalizedAt: '2026-11-13T10:15:30.000Z',
      projectId,
      pipeline: { slotReleased: true },
    });

    const res = await controller.getScanResultsStatus(
      userReq,
      projectId,
      scanId,
    );

    expect(res).toEqual({
      scanId,
      state: 'completed',
      resultsStatus: 'ready',
      resultsFinalizedAt: '2026-11-13T10:15:30.000Z',
    });
    expect(getScan).toHaveBeenCalledWith({
      scanId,
      projectId,
      includePipeline: false,
    });
  });

  it('leaves resultsFinalizedAt absent while results are processing', async () => {
    getScan.mockResolvedValue({
      id: scanId,
      state: 'running',
      resultsStatus: 'processing',
    });
    const res = await controller.getScanResultsStatus(
      userReq,
      projectId,
      scanId,
    );
    expect(res.resultsStatus).toBe('processing');
    expect(res.resultsFinalizedAt).toBeUndefined();
  });

  it('answers 403 without the read permission', async () => {
    getScan.mockResolvedValue({ id: scanId, state: 'completed' });
    permissions.checkPermission.mockResolvedValue(false);
    await expect(
      controller.getScanResultsStatus(userReq, projectId, scanId),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('answers 403 when there is no authenticated user', async () => {
    await expect(
      controller.getScanResultsStatus({}, projectId, scanId),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(getScan).not.toHaveBeenCalled();
  });

  it('surfaces the downstream error of another project scan to a member', async () => {
    getScan.mockRejectedValue(new NotFoundException('Scan not found'));
    await expect(
      controller.getScanResultsStatus(userReq, projectId, scanId),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(permissions.checkPermission).toHaveBeenCalledWith(
      projectId,
      'project',
      'read',
      'u-token',
    );
  });

  it('answers 403, not the downstream error, to a non member', async () => {
    getScan.mockRejectedValue(new NotFoundException('Scan not found'));
    permissions.checkPermission.mockResolvedValueOnce(false);
    await expect(
      controller.getScanResultsStatus(userReq, projectId, scanId),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
