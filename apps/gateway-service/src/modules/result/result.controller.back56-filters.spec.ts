/**
 * Gateway-level tests for the `language` (multi-value) + `sourcePath`
 * list filters. The language facet is now embedded in the list
 * responses (the dedicated `/results/languages/:type` endpoint was removed).
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { ResultController } from './result.controller';
import { ResultService } from './result.service';
import { Logger } from 'nestjs-pino';
import { CombinedAuthRateLimitGuard } from 'src/core/guards/combined-auth-rate-limit.guard';
import { PermissionsGuard } from 'src/core/guards/permissions/permissions.guard';
import { FeatureGuard } from 'src/core/guards/feature/feature.guard';
import { HttpService } from '@nestjs/axios';

const PROJECT = '11111111-1111-4111-8111-111111111111';

describe('ResultController – language/sourcePath filters & facets', () => {
  let app: INestApplication;
  let controller: ResultController;
  const serviceMock = {
    findAllSast: jest.fn().mockResolvedValue({ vulnerabilities: [] }),
    findAllIac: jest.fn().mockResolvedValue({ vulnerabilities: [] }),
    findAllCicd: jest.fn().mockResolvedValue({ vulnerabilities: [] }),
    findAllSecret: jest.fn().mockResolvedValue({ vulnerabilities: [] }),
    getGroupedSastVulnerabilities: jest
      .fn()
      .mockResolvedValue({ groupedVulnerabilities: [] }),
  };

  beforeAll(async () => {
    const moduleBuilder = Test.createTestingModule({
      controllers: [ResultController],
      providers: [
        { provide: ResultService, useValue: serviceMock },
        {
          provide: Logger,
          useValue: { log: jest.fn(), error: jest.fn(), warn: jest.fn() },
        },
        { provide: HttpService, useValue: { get: jest.fn() } },
        {
          provide: PermissionsGuard,
          useValue: {
            canActivate: () => true,
            checkPermission: jest.fn().mockResolvedValue(true),
          },
        },
      ],
    })
      .overrideGuard(CombinedAuthRateLimitGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(FeatureGuard)
      .useValue({ canActivate: () => true });

    const moduleFixture: TestingModule = await moduleBuilder.compile();

    controller = moduleFixture.get<ResultController>(ResultController);

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterEach(() => jest.clearAllMocks());
  afterAll(async () => {
    await app.close();
  });

  describe('GET /project/:projectId/results/sast (filters)', () => {
    it('forwards a multi-value language filter as an array', async () => {
      await request(app.getHttpServer())
        .get(`/project/${PROJECT}/results/sast`)
        .query({ language: ['python', 'java'] })
        .expect(200);

      expect(serviceMock.findAllSast).toHaveBeenCalledWith(
        expect.objectContaining({ language: ['python', 'java'] }),
      );
    });

    it('coerces a single language value into an array', async () => {
      await request(app.getHttpServer())
        .get(`/project/${PROJECT}/results/sast`)
        .query({ language: 'python' })
        .expect(200);

      expect(serviceMock.findAllSast).toHaveBeenCalledWith(
        expect.objectContaining({ language: ['python'] }),
      );
    });

    it("coerces an empty language value to an empty array (no IN (''))", async () => {
      await request(app.getHttpServer())
        .get(`/project/${PROJECT}/results/sast`)
        .query({ language: '' })
        .expect(200);

      expect(serviceMock.findAllSast).toHaveBeenCalledWith(
        expect.objectContaining({ language: [] }),
      );
    });

    it('forwards the sourcePath filter', async () => {
      await request(app.getHttpServer())
        .get(`/project/${PROJECT}/results/sast`)
        .query({ sourcePath: 'src/auth' })
        .expect(200);

      expect(serviceMock.findAllSast).toHaveBeenCalledWith(
        expect.objectContaining({ sourcePath: 'src/auth' }),
      );
    });
  });

  describe('GET /project/:projectId/results/secret (filters)', () => {
    it('forwards language + sourcePath alongside secret-only filters', async () => {
      await request(app.getHttpServer())
        .get(`/project/${PROJECT}/results/secret`)
        .query({ language: 'go', sourcePath: '.env' })
        .expect(200);

      expect(serviceMock.findAllSecret).toHaveBeenCalledWith(
        expect.objectContaining({ language: ['go'], sourcePath: '.env' }),
      );
    });
  });

  describe('languages facet on list responses', () => {
    it('surfaces the languages field on the detailed sast route', async () => {
      serviceMock.findAllSast.mockResolvedValueOnce({
        vulnerabilities: [],
        languages: ['go', 'ruby'],
      });

      const res = await request(app.getHttpServer())
        .get(`/project/${PROJECT}/results/sast`)
        .expect(200);

      expect(res.body).toEqual(
        expect.objectContaining({ languages: ['go', 'ruby'] }),
      );
    });

    // The grouped route is exercised via a direct controller call: under the
    // Express test adapter, '/results/sast/grouped' is shadowed by the earlier
    // '/results/sast/:vulnerabilityId' route (ParseUUIDPipe rejects 'grouped').
    // Production runs on Fastify where the static segment wins, so this is a
    // test-harness artifact only. The handler returns the service response
    // verbatim, so a direct invocation proves the languages pass-through.
    it('surfaces the languages field on the grouped sast route', async () => {
      serviceMock.getGroupedSastVulnerabilities.mockResolvedValueOnce({
        groupedVulnerabilities: [],
        languages: ['go', 'ruby'],
      });

      const res = await controller.getGroupedSastVulnerabilities(
        PROJECT,
        {} as never,
      );

      expect(res).toEqual(
        expect.objectContaining({ languages: ['go', 'ruby'] }),
      );
    });
  });
});
