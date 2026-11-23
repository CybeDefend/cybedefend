// Mock uuid before importing the controller
jest.mock('uuid', () => ({
  v6: jest.fn(() => 'mock-uuid-v6'),
}));

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { ScanController } from './scan.controller';
import { ScanService } from './scan.service';
import { ProjectService } from 'src/modules/project/project.service';
import { Logger } from 'nestjs-pino';
import { OrganizationService } from 'src/modules/organization/organization.service';
import { CombinedAuthRateLimitGuard } from 'src/core/guards/combined-auth-rate-limit.guard';
import { PermissionsGuard } from 'src/core/guards/permissions/permissions.guard';
import { FeatureGuard } from 'src/core/guards/feature/feature.guard';

describe('ScanController validation (integration-light)', () => {
  let app: INestApplication;
  const scanServiceMock = {
    getScan: jest.fn(),
    createScan: jest.fn(),
    processUploadFile: jest.fn(),
    checkExistingScan: jest.fn(),
    startScan: jest.fn(),
  };
  const projectServiceMock = {
    getProject: jest.fn().mockResolvedValue({}),
  };
  beforeAll(async () => {
    const moduleBuilder = Test.createTestingModule({
      controllers: [ScanController],
      providers: [
        { provide: ScanService, useValue: scanServiceMock },
        { provide: ProjectService, useValue: projectServiceMock },
        { provide: OrganizationService, useValue: {} },
        { provide: Logger, useValue: { log: jest.fn(), error: jest.fn() } },
        // getScan checks its permission in the handler, by scan kind.
        {
          provide: PermissionsGuard,
          useValue: { checkPermission: jest.fn().mockResolvedValue(true) },
        },
      ],
    })
      .overrideGuard(CombinedAuthRateLimitGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(FeatureGuard)
      .useValue({ canActivate: () => true });

    const module: TestingModule = await moduleBuilder.compile();

    app = module.createNestApplication();
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

  const uuid = () =>
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replaceAll(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });

  describe('GET /project/:projectId/scan/:scanId', () => {
    it('returns 400 for invalid UUIDs', async () => {
      await request(app.getHttpServer())
        .get(`/project/not-a-uuid/scan/also-not-uuid`)
        .expect(400);
      expect(scanServiceMock.getScan).not.toHaveBeenCalled();
    });
  });

  describe('POST /project/:projectId/scan/start', () => {
    it('returns 400 for invalid projectId', async () => {
      await request(app.getHttpServer())
        .post(`/project/not-a-uuid/scan/start`)
        .expect(400);
      expect(scanServiceMock.createScan).not.toHaveBeenCalled();
    });

    // A branch the scan row cannot store (over 255 characters) used to reach
    // the database and answer 500, after the upload URL was already signed.
    it.each([
      ['over 255 characters', 'a'.repeat(256)],
      ['not a Git branch name', '../../etc;rm -rf'],
    ])(
      'returns 400 for a branch %s, before any upload URL is signed',
      async (_label, branch) => {
        scanServiceMock.processUploadFile.mockReset();
        scanServiceMock.checkExistingScan.mockReset();
        await request(app.getHttpServer())
          .post(`/project/${uuid()}/scan/start`)
          .send({ branch })
          .expect(400);
        expect(scanServiceMock.checkExistingScan).not.toHaveBeenCalled();
        expect(scanServiceMock.processUploadFile).not.toHaveBeenCalled();
        expect(scanServiceMock.createScan).not.toHaveBeenCalled();
      },
    );
  });

  describe('POST /project/:projectId/scan/container/start', () => {
    it('returns 400 for invalid projectId', async () => {
      await request(app.getHttpServer())
        .post(`/project/not-a-uuid/scan/container/start`)
        .expect(400);
      expect(scanServiceMock.startScan).not.toHaveBeenCalled();
    });

    it('returns 400 when imageToScan is missing', async () => {
      scanServiceMock.startScan.mockReset();
      await request(app.getHttpServer())
        .post(`/project/${uuid()}/scan/container/start`)
        .send({})
        .expect(400);
      expect(scanServiceMock.startScan).not.toHaveBeenCalled();
    });
  });
});
