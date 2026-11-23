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

describe('ResultController DTO validation (integration-light)', () => {
  let app: INestApplication;
  const serviceMock = {
    findAllContainerImages: jest.fn(),
    findAllContainerPackages: jest.fn(),
    findAllContainer: jest.fn(),
    findOneContainer: jest.fn(),
    findAllSast: jest.fn(),
    findAllIac: jest.fn(),
    findAllSca: jest.fn(),
    findAllScaPackages: jest.fn(),
    findOneSca: jest.fn(),
    findOneSast: jest.fn(),
    findOneIac: jest.fn(),
    update: jest.fn(),
    getProjectOverview: jest.fn(),
    deleteContainerImage: jest.fn(),
    getProjectLicenseSummary: jest.fn(),
    getPackagesByLicense: jest.fn(),
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
          // Controller injects PermissionsGuard for per-project Permify
          // checks in batch report endpoints; provide a stub so the
          // module compiles.
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

  afterAll(async () => {
    await app.close();
  });

  describe('GET container lists', () => {
    it('returns 400 for invalid UUID projectId', async () => {
      await request(app.getHttpServer())
        .get('/project/not-a-uuid/results/container')
        .expect(400);
    });

    it('returns 400 for invalid query types (page must be number)', async () => {
      await request(app.getHttpServer())
        .get('/project/11111111-1111-4111-8111-111111111111/results/container')
        .query({ page: 'abc' })
        .expect(400);
      expect(serviceMock.findAllContainer).not.toHaveBeenCalled();
    });
  });

  describe('PATCH /project/:projectId/results/:vulnerabilityId', () => {
    it('returns 400 when projectId or vulnerabilityId is not UUID', async () => {
      await request(app.getHttpServer())
        .patch('/project/not-a-uuid/results/not-a-uuid')
        .send({ status: 'resolved' })
        .expect(400);
      expect(serviceMock.update).not.toHaveBeenCalled();
    });

    it('returns 400 when comment is too long', async () => {
      const long = 'a'.repeat(600);
      await request(app.getHttpServer())
        .patch(
          '/project/11111111-1111-4111-8111-111111111111/results/77777777-7777-4777-8777-777777777777',
        )
        .send({ comment: long })
        .expect(400);
      expect(serviceMock.update).not.toHaveBeenCalled();
    });
  });

  // These routes check access to the PROJECT. An organization
  // named in the query string must not choose whose license policy applies.
  describe('GET /project/:projectId/results/sca/licenses/*', () => {
    const projectId = '11111111-1111-4111-8111-111111111111';
    const otherOrganizationId = '99999999-9999-4999-8999-999999999999';

    it('the summary does not forward an organizationId read from the query', async () => {
      serviceMock.getProjectLicenseSummary.mockReset();
      serviceMock.getProjectLicenseSummary.mockResolvedValue({});
      await request(app.getHttpServer())
        .get(`/project/${projectId}/results/sca/licenses/summary`)
        .query({ organizationId: otherOrganizationId, branch: 'main' })
        .expect(200);
      expect(serviceMock.getProjectLicenseSummary).toHaveBeenCalledTimes(1);
      const args = serviceMock.getProjectLicenseSummary.mock.calls[0];
      expect(args).toEqual(expect.arrayContaining([projectId, 'main']));
      expect(args).not.toContain(otherOrganizationId);
    });

    it('the packages of a license do not forward an organizationId read from the query', async () => {
      serviceMock.getPackagesByLicense.mockReset();
      serviceMock.getPackagesByLicense.mockResolvedValue({});
      await request(app.getHttpServer())
        .get(`/project/${projectId}/results/sca/licenses/MIT/packages`)
        .query({ organizationId: otherOrganizationId, branch: 'main' })
        .expect(200);
      expect(serviceMock.getPackagesByLicense).toHaveBeenCalledTimes(1);
      const args = serviceMock.getPackagesByLicense.mock.calls[0];
      expect(args).toEqual(expect.arrayContaining([projectId, 'MIT', 'main']));
      expect(args).not.toContain(otherOrganizationId);
    });
  });

  describe('POST /organization/:organizationId/project/report/batch (cap)', () => {
    it('returns 400 when projectIds exceeds the 50-item cap', async () => {
      // Generate 51 valid UUIDs (varying last segment) to trigger
      // ArrayMaxSize(50): one request names a bounded number of projects.
      const ids = Array.from({ length: 51 }, (_, i) => {
        const last = String(i).padStart(12, '0');
        return `11111111-1111-1111-1111-${last}`;
      });
      await request(app.getHttpServer())
        .post(
          '/organization/11111111-1111-4111-8111-111111111111/project/report/batch/owasp/json',
        )
        .send({ projectIds: ids })
        .expect(400);
    });
  });
});
