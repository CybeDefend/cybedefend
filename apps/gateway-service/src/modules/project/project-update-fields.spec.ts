import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { Logger } from 'nestjs-pino';

import { CombinedAuthRateLimitGuard } from 'src/core/guards/combined-auth-rate-limit.guard';
import { PermissionsGuard } from 'src/core/guards/permissions/permissions.guard';

import { ProjectController } from './project.controller';
import { ProjectService } from './project.service';
import {
  projectUpdateFields,
  registerProjectUpdateField,
  resetProjectUpdateFieldsForTests,
} from './project-update-fields';

/**
 * The update-field registry: PATCH /project/:projectId copies only the body
 * keys an extension registered (a closed extension's fields register
 * themselves at instantiation).
 * Same supertest harness as project.controller.validation.spec.ts, minus the
 * whitelist: the registry loop, not the pipe, is what drops an unregistered
 * field here.
 */
describe('ProjectController update: the update-field registry', () => {
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
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    resetProjectUpdateFieldsForTests();
    await app.close();
  });

  it('starts empty in the core', () => {
    expect(projectUpdateFields()).toEqual([]);
  });

  it('drops a field no extension registered', async () => {
    projectServiceMock.updateProject.mockReset();
    projectServiceMock.updateProject.mockResolvedValue({ message: 'ok' });
    await request(app.getHttpServer())
      .patch(`/project/${uuid()}`)
      .send({ closedProductEnabled: true })
      .expect(200);
    expect(projectServiceMock.updateProject).toHaveBeenCalledTimes(1);
    const arg = projectServiceMock.updateProject.mock.calls[0][0];
    expect(arg).not.toHaveProperty('closedProductEnabled');
  });

  it('copies a registered field', async () => {
    registerProjectUpdateField('closedProductEnabled');
    expect(projectUpdateFields()).toEqual(['closedProductEnabled']);
    projectServiceMock.updateProject.mockReset();
    projectServiceMock.updateProject.mockResolvedValue({ message: 'ok' });
    await request(app.getHttpServer())
      .patch(`/project/${uuid()}`)
      .send({ closedProductEnabled: true })
      .expect(200);
    expect(projectServiceMock.updateProject).toHaveBeenCalledWith(
      expect.objectContaining({ closedProductEnabled: true }),
    );
    resetProjectUpdateFieldsForTests();
  });

  it('registers a field once (idempotent)', () => {
    registerProjectUpdateField('someExtensionField');
    registerProjectUpdateField('someExtensionField');
    expect(projectUpdateFields()).toEqual(['someExtensionField']);
    resetProjectUpdateFieldsForTests();
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
