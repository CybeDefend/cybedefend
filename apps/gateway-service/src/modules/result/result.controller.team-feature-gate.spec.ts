import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { Logger } from 'nestjs-pino';
import request from 'supertest';
import { of } from 'rxjs';

import { ResultController } from './result.controller';
import { ResultService } from './result.service';
import { CombinedAuthRateLimitGuard } from 'src/core/guards/combined-auth-rate-limit.guard';
import { PermissionsGuard } from 'src/core/guards/permissions/permissions.guard';
import { FeatureGuard } from 'src/core/guards/feature/feature.guard';
import { ENTITLEMENTS_PORT } from 'src/edition/ports/entitlements.port';
import { ProjectOrgResolver } from 'src/core/project-org/project-org-resolver.service';

/**
 * Through the real FeatureGuard: a /team/:teamId/* reports route
 * is gated by the plan of the team's own organization, and only once Permify
 * has accepted the caller on the team, so an outsider cannot read the plan of
 * an organization through the 403 it gets.
 */
describe('ResultController team reports feature gate', () => {
  let app: INestApplication;
  let permitted: boolean;
  const teamId = '22222222-2222-4222-8222-222222222222';
  const reportId = '33333333-3333-4333-8333-333333333333';

  const serviceMock = {
    listAggregatedReports: jest.fn().mockResolvedValue({ reports: [] }),
    getGeneratedAggregatedReport: jest.fn().mockResolvedValue({}),
    deleteAggregatedReport: jest.fn().mockResolvedValue({}),
    generateTeamReport: jest.fn().mockResolvedValue({}),
  };
  const orgClient = {
    getOrganizationIdByTeamId: jest.fn(),
    getOrganizationIdByProjectId: jest.fn(),
  };
  const userClient = { getUserProfile: jest.fn() };
  const entitlements = { checkFeatureAccess: jest.fn() };

  const routes: Array<[string, () => request.Test]> = [
    [
      'GET /team/:teamId/reports',
      () => server().get(`/team/${teamId}/reports`),
    ],
    [
      'GET /team/:teamId/reports/:reportId',
      () => server().get(`/team/${teamId}/reports/${reportId}`),
    ],
    [
      'DELETE /team/:teamId/reports/:reportId',
      () => server().delete(`/team/${teamId}/reports/${reportId}`),
    ],
    [
      'GET /team/:teamId/report/:reportType/:format',
      () => server().get(`/team/${teamId}/report/owasp/pdf`),
    ],
  ];
  const server = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [ResultController],
      providers: [
        FeatureGuard,
        ProjectOrgResolver,
        { provide: ResultService, useValue: serviceMock },
        {
          provide: Logger,
          useValue: { log: jest.fn(), error: jest.fn(), warn: jest.fn() },
        },
        { provide: HttpService, useValue: { get: jest.fn() } },
        {
          provide: PermissionsGuard,
          useValue: { canActivate: () => permitted },
        },
        {
          provide: ENTITLEMENTS_PORT,
          useValue: entitlements,
        },
        {
          provide: 'GLOBAL_MANAGEMENT_SERVICE',
          useValue: {
            getService: (name: string) =>
              name.includes('Organization') ? orgClient : userClient,
          },
        },
      ],
    })
      .overrideGuard(CombinedAuthRateLimitGuard)
      .useValue({
        canActivate: (context) => {
          context.switchToHttp().getRequest().user = { sub: 'user-1' };
          return true;
        },
      })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => permitted })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    permitted = true;
    orgClient.getOrganizationIdByTeamId.mockReturnValue(
      of({ organizationId: 'org-of-team' }),
    );
    userClient.getUserProfile.mockReturnValue(
      of({ myOrganizations: [{ id: 'org-paying' }, { id: 'org-of-team' }] }),
    );
  });

  describe.each(routes)('%s', (_route, send) => {
    it("answers when the team's organization has reports", async () => {
      entitlements.checkFeatureAccess.mockResolvedValue({ allowed: true });

      const res = await send();

      expect(res.status).toBeLessThan(300);
      expect(entitlements.checkFeatureAccess).toHaveBeenCalledWith(
        'org-of-team',
        'reports',
      );
    });

    it('refuses when only another organization of the user has reports', async () => {
      entitlements.checkFeatureAccess.mockImplementation(
        (organizationId: string) =>
          Promise.resolve({
            allowed: organizationId === 'org-paying',
            requiredPlan: 'pro',
          }),
      );

      await send().expect(403);
    });

    it('asks nothing about the plan of a team Permify refuses', async () => {
      permitted = false;
      entitlements.checkFeatureAccess.mockResolvedValue({ allowed: true });

      await send().expect(403);
      expect(orgClient.getOrganizationIdByTeamId).not.toHaveBeenCalled();
      expect(entitlements.checkFeatureAccess).not.toHaveBeenCalled();
    });
  });
});
