import {
  ExecutionContext,
  ForbiddenException,
  INestApplication,
  Type,
  UnauthorizedException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Logger } from 'nestjs-pino';
import request from 'supertest';
import { of } from 'rxjs';

import { CombinedAuthRateLimitGuard } from 'src/core/guards/combined-auth-rate-limit.guard';
import { PermissionsGuard } from 'src/core/guards/permissions/permissions.guard';
import { ENTITLEMENTS_PORT } from 'src/edition/ports/entitlements.port';
import { FeatureGuard } from './feature.guard';
import { ProjectOrgResolver } from 'src/core/project-org/project-org-resolver.service';
import { PolicyController } from 'src/modules/policy/policy.controller';
import { PolicyService } from 'src/modules/policy/policy.service';
import { SlackController } from 'src/modules/integrations/slack/slack.controller';
import { SlackService } from 'src/modules/integrations/slack/slack.service';

/**
 * With `@UseGuards(CombinedAuthRateLimitGuard) @Feature(...)
 * @UseGuards(FeatureGuard)` on the class, NestJS runs FeatureGuard first.
 * Authentication must answer first, before anything is asked downstream: an
 * anonymous call never learns whether the organization's plan has the
 * feature, and costs no gRPC call.
 */
const ORGANIZATION_ID = '11111111-1111-1111-1111-111111111111';
const PROJECT_ID = '22222222-2222-2222-2222-222222222222';

describe.each<[string, Type<unknown>, Type<unknown>, string[]]>([
  [
    'PolicyController',
    PolicyController,
    PolicyService,
    [
      `/organization/${ORGANIZATION_ID}/policies`,
      `/projects/${PROJECT_ID}/violations`,
    ],
  ],
  [
    'SlackController',
    SlackController,
    SlackService,
    [
      `/organization/${ORGANIZATION_ID}/slack/installation`,
      `/project/${PROJECT_ID}/slack/channel`,
    ],
  ],
])(
  '%s: authentication runs before the plan check',
  (_name, controller, service, paths) => {
    let app: INestApplication;
    const entitlements = { checkFeatureAccess: jest.fn() };
    const orgClient = { getOrganizationIdByProjectId: jest.fn() };
    const userClient = { getUserProfile: jest.fn() };
    /** What Permify answers; a member by default. */
    let permifyAllows = true;

    beforeAll(async () => {
      const moduleFixture = await Test.createTestingModule({
        controllers: [controller],
        providers: [
          FeatureGuard,
          ProjectOrgResolver,
          { provide: service, useValue: {} },
          // SlackController keeps its OAuth states in Redis; no route
          // exercised here touches it.
          { provide: 'REDIS_CLIENT', useValue: {} },
          {
            provide: Logger,
            useValue: { log: jest.fn(), error: jest.fn(), warn: jest.fn() },
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
        // The real guard needs Logto and Redis; this one keeps its contract:
        // no bearer token, 401.
        .overrideGuard(CombinedAuthRateLimitGuard)
        .useValue({
          canActivate: (context: ExecutionContext) => {
            const req = context.switchToHttp().getRequest();
            if (!req.headers.authorization) throw new UnauthorizedException();
            req.user = { sub: 'user-1' };
            return true;
          },
        })
        .overrideGuard(PermissionsGuard)
        .useValue({
          canActivate: () => {
            if (!permifyAllows) {
              throw new ForbiddenException(
                'You do not have permission to access this resource',
              );
            }
            return true;
          },
        })
        .compile();

      app = moduleFixture.createNestApplication();
      await app.init();
    });

    afterAll(async () => {
      await app.close();
    });

    beforeEach(() => {
      jest.clearAllMocks();
      permifyAllows = true;
      orgClient.getOrganizationIdByProjectId.mockReturnValue(
        of({ organizationId: ORGANIZATION_ID }),
      );
      entitlements.checkFeatureAccess.mockResolvedValue({
        allowed: false,
        requiredPlan: 'pro',
      });
    });

    it.each(paths)(
      'answers 401 to an anonymous GET %s and asks nothing downstream',
      async (path) => {
        await request(app.getHttpServer()).get(path).expect(401);

        expect(entitlements.checkFeatureAccess).not.toHaveBeenCalled();
        expect(orgClient.getOrganizationIdByProjectId).not.toHaveBeenCalled();
        expect(userClient.getUserProfile).not.toHaveBeenCalled();
      },
    );

    it.each(paths)(
      'still checks the plan of an authenticated GET %s',
      async (path) => {
        await request(app.getHttpServer())
          .get(path)
          .set('Authorization', 'Bearer token')
          .expect(403);

        expect(entitlements.checkFeatureAccess).toHaveBeenCalledWith(
          ORGANIZATION_ID,
          expect.any(String),
        );
      },
    );

    /**
     * The plan check runs after the method's PermissionsGuard: a caller
     * Permify refuses gets Permify's 403, never the plan 403, and costs no
     * billing or global-management call.
     */
    it.each(paths)(
      'answers the permission 403 to a caller Permify refuses on GET %s, without asking about the plan',
      async (path) => {
        permifyAllows = false;

        const res = await request(app.getHttpServer())
          .get(path)
          .set('Authorization', 'Bearer token')
          .expect(403);

        expect(res.body.message).toBe(
          'You do not have permission to access this resource',
        );
        expect(entitlements.checkFeatureAccess).not.toHaveBeenCalled();
        expect(orgClient.getOrganizationIdByProjectId).not.toHaveBeenCalled();
      },
    );
  },
);
