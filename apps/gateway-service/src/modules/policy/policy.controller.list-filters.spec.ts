import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Logger } from 'nestjs-pino';
import request from 'supertest';

import { CombinedAuthRateLimitGuard } from 'src/core/guards/combined-auth-rate-limit.guard';
import { FeatureGuard } from 'src/core/guards/feature/feature.guard';
import { PermissionsGuard } from 'src/core/guards/permissions/permissions.guard';
import { PolicyScope } from '@grpc/policy-management/policy_types';

import { PolicyController } from './policy.controller';
import { PolicyService } from './policy.service';

const ORG = '11111111-1111-4111-8111-111111111111';
const URL = `/organization/${ORG}/policies`;

/**
 * GET /organization/:organizationId/policies filters on the server: the
 * dashboard's policy list pages through the filtered result instead of
 * filtering the current page only.
 */
describe('GET /organization/:organizationId/policies — filters', () => {
  const service = { listPolicies: jest.fn() };

  const build = async (withGatewayPipe: boolean): Promise<INestApplication> => {
    const moduleFixture = await Test.createTestingModule({
      controllers: [PolicyController],
      providers: [
        { provide: PolicyService, useValue: service },
        {
          provide: Logger,
          useValue: { log: jest.fn(), error: jest.fn(), warn: jest.fn() },
        },
      ],
    })
      .overrideGuard(CombinedAuthRateLimitGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(FeatureGuard)
      .useValue({ canActivate: () => true })
      .compile();

    const app = moduleFixture.createNestApplication();
    if (withGatewayPipe) {
      // The gateway's own pipe (main.ts).
      app.useGlobalPipes(
        new ValidationPipe({
          transform: true,
          whitelist: true,
          transformOptions: { enableImplicitConversion: true },
        }),
      );
    }
    await app.init();
    return app;
  };

  beforeEach(() => {
    service.listPolicies.mockReset();
    service.listPolicies.mockResolvedValue({
      policies: [],
      total: 0,
      page: 1,
      pageSize: 20,
    });
  });

  const forwarded = () => service.listPolicies.mock.calls[0][0];

  describe.each([
    ['with the gateway pipe', true],
    // The route parses its own query: a change to the global pipe must not
    // turn « false » into a truthy string sent to policy-management.
    ['without any global pipe', false],
  ])('isEnabled, %s', (_label, withGatewayPipe) => {
    let app: INestApplication;
    beforeAll(async () => {
      app = await build(withGatewayPipe);
    });
    afterAll(async () => {
      await app.close();
    });

    it.each([
      ['false', false],
      ['true', true],
    ])('forwards isEnabled=%s as the boolean %s', async (query, expected) => {
      await request(app.getHttpServer())
        .get(URL)
        .query({ isEnabled: query })
        .expect(200);

      expect(forwarded().isEnabled).toBe(expected);
    });

    it('forwards no isEnabled when the query has none', async () => {
      await request(app.getHttpServer()).get(URL).expect(200);

      expect(forwarded().isEnabled).toBeUndefined();
    });

    // The global ValidationPipe runs before a parameter pipe and, for a
    // `boolean` parameter, turns every value but 'true' into false: with
    // the gateway pipe, an invalid value must still reach the route's own
    // check and be refused, not be read as « disabled ».
    it.each(['yes', '1', 'TRUE', ''])(
      'refuses isEnabled=%p with a 400, without asking for any policy',
      async (query) => {
        await request(app.getHttpServer())
          .get(URL)
          .query({ isEnabled: query })
          .expect(400);

        expect(service.listPolicies).not.toHaveBeenCalled();
      },
    );
  });

  describe('scope', () => {
    let app: INestApplication;
    beforeAll(async () => {
      app = await build(true);
    });
    afterAll(async () => {
      await app.close();
    });

    it.each([
      ['ORGANIZATION', PolicyScope.POLICY_SCOPE_ORGANIZATION],
      ['TEAM', PolicyScope.POLICY_SCOPE_TEAM],
      ['PROJECT', PolicyScope.POLICY_SCOPE_PROJECT],
    ])('forwards scope=%s as the proto value %s', async (query, expected) => {
      await request(app.getHttpServer())
        .get(URL)
        .query({ scope: query })
        .expect(200);

      expect(forwarded().scope).toBe(expected);
    });

    it('forwards no scope when the query has none', async () => {
      await request(app.getHttpServer()).get(URL).expect(200);

      expect(forwarded().scope).toBeUndefined();
    });
  });
});
