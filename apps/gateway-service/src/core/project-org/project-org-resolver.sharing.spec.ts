import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { of } from 'rxjs';

import { FeatureGuard } from 'src/core/guards/feature/feature.guard';
import { ENTITLEMENTS_PORT } from 'src/edition/ports/entitlements.port';
import { ProjectOrgResolver } from './project-org-resolver.service';

/**
 * FeatureGuard and a closed extension both need a project's organization,
 * and both ask the shared ProjectOrgResolver instead of global-management
 * on every request. The closed extension's case is tested with the cloud
 * edition.
 */
describe('ProjectOrgResolver shared by FeatureGuard and the closed guard service', () => {
  const orgClient = {
    getOrganizationIdByProjectId: jest.fn(),
    getOrganizationIdByTeamId: jest.fn(),
  };
  const entitlements = { checkFeatureAccess: jest.fn() };
  let guard: FeatureGuard;

  const projectRoute = (projectId: string): ExecutionContext => {
    const req = { params: { projectId }, user: { sub: 'u1' } };
    return {
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    orgClient.getOrganizationIdByProjectId.mockReturnValue(
      of({ organizationId: 'org-1' }),
    );
    entitlements.checkFeatureAccess.mockResolvedValue({ allowed: true });
    const moduleRef = await Test.createTestingModule({
      providers: [
        FeatureGuard,
        ProjectOrgResolver,
        {
          provide: Reflector,
          useValue: {
            get: (key: string) =>
              key === 'feature' ? 'container_scanning' : undefined,
          },
        },
        {
          provide: 'GLOBAL_MANAGEMENT_SERVICE',
          useValue: { getService: () => orgClient },
        },
        {
          provide: ENTITLEMENTS_PORT,
          useValue: entitlements,
        },
      ],
    }).compile();
    await moduleRef.init();
    guard = moduleRef.get(FeatureGuard);
  });

  it('two plan checks on the same project ask global-management once', async () => {
    await expect(guard.canActivate(projectRoute('p1'))).resolves.toBe(true);
    await expect(guard.canActivate(projectRoute('p1'))).resolves.toBe(true);

    expect(orgClient.getOrganizationIdByProjectId).toHaveBeenCalledTimes(1);
    expect(entitlements.checkFeatureAccess).toHaveBeenCalledTimes(2);
  });
});
