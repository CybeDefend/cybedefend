import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';

import { ProjectController } from './project.controller';
import { ProjectService } from './project.service';
import { Logger } from 'nestjs-pino';
import { CombinedAuthRateLimitGuard } from 'src/core/guards/combined-auth-rate-limit.guard';
import { PermissionsGuard } from 'src/core/guards/permissions/permissions.guard';

describe('ProjectController DTO validation (integration-light)', () => {
  let app: INestApplication;
  const projectServiceMock = {
    getProjectsOrganization: jest.fn(),
    getProjectsTeam: jest.fn(),
    getProject: jest.fn(),
    createProject: jest.fn(),
    updateProject: jest.fn(),
    deleteProject: jest.fn(),
    getProjectSecurityContext: jest.fn(),
    updateProjectSecurityContext: jest.fn(),
  };

  beforeAll(async () => {
    const moduleBuilder = Test.createTestingModule({
      controllers: [ProjectController],
      providers: [
        { provide: ProjectService, useValue: projectServiceMock },
        // No COMPLIANCE_FRAMEWORKS_SYNC bound: the sync is skipped, as in
        // the Community Edition.
        {
          provide: Logger,
          useValue: { log: jest.fn(), error: jest.fn(), warn: jest.fn() },
        },
      ],
    })
      .overrideGuard(CombinedAuthRateLimitGuard)
      .useValue({
        canActivate: (context) => {
          const req = context.switchToHttp().getRequest();
          req.user = { sub: 'u1' };
          return true;
        },
      })
      .overrideGuard(PermissionsGuard)
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

  describe('GET /organization/:organizationId/projects', () => {
    it('should return 400 when organizationId is not a valid UUID', async () => {
      projectServiceMock.getProjectsOrganization.mockReset();
      await request(app.getHttpServer())
        .get(`/organization/not-a-uuid/projects`)
        .expect(400);
      expect(projectServiceMock.getProjectsOrganization).not.toHaveBeenCalled();
    });

    // Note: this route does not use a DTO for page/pageSize, so type coercion
    // is handled in controller without class-validator. We skip non-numeric page test here.
  });

  describe('GET /team/:teamId/projects', () => {
    it.each([
      'aiMergeRequestEnabled',
      'improvingResultsEnabled',
      'sortsVulnerabilitiesEnabled',
    ])(
      'should return 400 when %s is sent on creation with no extension registered',
      async (field) => {
        projectServiceMock.createProject.mockReset();
        await request(app.getHttpServer())
          .post(`/team/${uuid()}/project`)
          .send({ name: 'P', [field]: true })
          .expect(400);
        expect(projectServiceMock.createProject).not.toHaveBeenCalled();
      },
    );

    it('should return 400 when teamId is not a valid UUID', async () => {
      projectServiceMock.getProjectsTeam.mockReset();
      await request(app.getHttpServer())
        .get(`/team/not-a-uuid/projects`)
        .query({ page: 1, pageSize: 10 })
        .expect(400);
      expect(projectServiceMock.getProjectsTeam).not.toHaveBeenCalled();
    });

    it('should return 400 when pageSize > 20', async () => {
      projectServiceMock.getProjectsTeam.mockReset();
      await request(app.getHttpServer())
        .get(`/team/${uuid()}/projects`)
        .query({ page: 1, pageSize: 50 })
        .expect(400);
      expect(projectServiceMock.getProjectsTeam).not.toHaveBeenCalled();
    });
  });

  describe('GET /project/:projectId', () => {
    it('should return 400 when projectId is not a valid UUID', async () => {
      projectServiceMock.getProject.mockReset();
      await request(app.getHttpServer()).get(`/project/not-a-uuid`).expect(400);
      expect(projectServiceMock.getProject).not.toHaveBeenCalled();
    });
  });

  describe('POST /team/:teamId/project', () => {
    it('should return 400 when body is missing required fields', async () => {
      projectServiceMock.createProject.mockReset();
      await request(app.getHttpServer())
        .post(`/team/${uuid()}/project`)
        .send({})
        .expect(400);
      expect(projectServiceMock.createProject).not.toHaveBeenCalled();
    });

    it('should return 400 when teamId is not a valid UUID', async () => {
      projectServiceMock.createProject.mockReset();
      await request(app.getHttpServer())
        .post(`/team/not-a-uuid/project`)
        .send({ name: 'proj' })
        .expect(400);
      expect(projectServiceMock.createProject).not.toHaveBeenCalled();
    });

    it.each(['AppSec', 'billing', 'both', ''])(
      'should return 400 when product is %p',
      async (product) => {
        projectServiceMock.createProject.mockReset();
        await request(app.getHttpServer())
          .post(`/team/${uuid()}/project`)
          .send({ name: 'proj', product })
          .expect(400);
        expect(projectServiceMock.createProject).not.toHaveBeenCalled();
      },
    );

    // The closed extension tests its own product.
    it.each(['appsec'])('accepts product %p', async (product) => {
      projectServiceMock.createProject.mockReset();
      projectServiceMock.createProject.mockResolvedValue({ id: 'p1' });
      await request(app.getHttpServer())
        .post(`/team/${uuid()}/project`)
        .send({ name: 'proj', product })
        .expect(201);
      expect(projectServiceMock.createProject).toHaveBeenCalledWith(
        expect.objectContaining({ product }),
      );
    });

    it('should return 400 when securityContext.environment is invalid', async () => {
      projectServiceMock.createProject.mockReset();
      await request(app.getHttpServer())
        .post(`/team/${uuid()}/project`)
        .send({
          name: 'proj',
          securityContext: { environment: 'not-an-env' },
        })
        .expect(400);
      expect(projectServiceMock.createProject).not.toHaveBeenCalled();
    });

    it('should accept a partial securityContext (valid enum only)', async () => {
      projectServiceMock.createProject.mockReset();
      projectServiceMock.createProject.mockResolvedValue({ id: 'p' });
      await request(app.getHttpServer())
        .post(`/team/${uuid()}/project`)
        .send({
          name: 'proj',
          securityContext: { environment: 'staging' },
        })
        .expect(201);
      expect(projectServiceMock.createProject).toHaveBeenCalledTimes(1);
    });
  });

  describe('PATCH /project/:projectId', () => {
    it('should return 400 when projectId is not a valid UUID', async () => {
      projectServiceMock.updateProject.mockReset();
      await request(app.getHttpServer())
        .patch(`/project/not-a-uuid`)
        .send({ name: 'x' })
        .expect(400);
      expect(projectServiceMock.updateProject).not.toHaveBeenCalled();
    });

    it('should return 400 when array enums are invalid', async () => {
      projectServiceMock.updateProject.mockReset();
      await request(app.getHttpServer())
        .patch(`/project/${uuid()}`)
        .send({ sastSeverities: ['invalid'] })
        .expect(400);
      expect(projectServiceMock.updateProject).not.toHaveBeenCalled();
    });

    // The closed product's update field left the core DTO: with no extension
    // registered, the whitelist refuses it (400); the closed extension
    // re-registers it and tests its cases.
    it('should return 400 when a closed product field is sent with no extension registered', async () => {
      projectServiceMock.updateProject.mockReset();
      await request(app.getHttpServer())
        .patch(`/project/${uuid()}`)
        .send({ closedProductEnabled: true })
        .expect(400);
      expect(projectServiceMock.updateProject).not.toHaveBeenCalled();
    });

    // The AI-BOM scan and the AI settings belong to closed features: with no
    // extension registered, the whitelist refuses them.
    it.each([
      'aibomEnabled',
      'aiMergeRequestEnabled',
      'improvingResultsEnabled',
      'sortsVulnerabilitiesEnabled',
    ])(
      'should return 400 when %s is sent with no extension registered',
      async (field) => {
        projectServiceMock.updateProject.mockReset();
        await request(app.getHttpServer())
          .patch(`/project/${uuid()}`)
          .send({ [field]: true })
          .expect(400);
        expect(projectServiceMock.updateProject).not.toHaveBeenCalled();
      },
    );

    it('should return 400 when scanOnCommitEnabled is not a boolean', async () => {
      projectServiceMock.updateProject.mockReset();
      await request(app.getHttpServer())
        .patch(`/project/${uuid()}`)
        .send({ scanOnCommitEnabled: 'yes' })
        .expect(400);
      expect(projectServiceMock.updateProject).not.toHaveBeenCalled();
    });

    it('should accept scanOnCommitEnabled when it is a boolean', async () => {
      projectServiceMock.updateProject.mockReset();
      projectServiceMock.updateProject.mockResolvedValue({ message: 'ok' });
      await request(app.getHttpServer())
        .patch(`/project/${uuid()}`)
        .send({ scanOnCommitEnabled: false })
        .expect(200);
      expect(projectServiceMock.updateProject).toHaveBeenCalledTimes(1);
    });

    // The reference branch reaches the SQL of the project-list
    // counts. A value that is no plausible git branch is refused at the edge.
    it.each([
      ['an apostrophe', "main' OR '1'='1"],
      ['a double quote', 'ma"in'],
      ['a backslash', 'ma\\in'],
      ['two consecutive dots', 'feature/..'],
      ['a control character', 'main\n'],
      ['more than 191 characters', 'b'.repeat(192)],
    ])(
      'should return 400 when referenceBranch contains %s',
      async (_case, referenceBranch) => {
        projectServiceMock.updateProject.mockReset();
        await request(app.getHttpServer())
          .patch(`/project/${uuid()}`)
          .send({ referenceBranch })
          .expect(400);
        expect(projectServiceMock.updateProject).not.toHaveBeenCalled();
      },
    );

    it.each(['feature/x.y', 'release-1.2', 'b'.repeat(191), '', null])(
      'should accept referenceBranch %p',
      async (referenceBranch) => {
        projectServiceMock.updateProject.mockReset();
        projectServiceMock.updateProject.mockResolvedValue({ message: 'ok' });
        await request(app.getHttpServer())
          .patch(`/project/${uuid()}`)
          .send({ referenceBranch })
          .expect(200);
        expect(projectServiceMock.updateProject).toHaveBeenCalledTimes(1);
      },
    );
  });

  describe('DELETE /project/:projectId', () => {
    it('should return 400 when projectId is not a valid UUID', async () => {
      projectServiceMock.deleteProject.mockReset();
      await request(app.getHttpServer())
        .delete(`/project/not-a-uuid`)
        .expect(400);
      expect(projectServiceMock.deleteProject).not.toHaveBeenCalled();
    });
  });
});

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replaceAll(
    /[xy]/g,
    function (c) {
      const r = (Math.random() * 16) | 0,
        v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    },
  );
}
