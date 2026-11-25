import { Test, TestingModule } from '@nestjs/testing';
import {
  ExecutionContext,
  ForbiddenException,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import request from 'supertest';
import { Logger } from 'nestjs-pino';

import { ProjectController } from './project.controller';
import { ProjectService } from './project.service';
import { CombinedAuthRateLimitGuard } from 'src/core/guards/combined-auth-rate-limit.guard';
import { PermissionsGuard } from 'src/core/guards/permissions/permissions.guard';
import { GLOBAL_VALIDATION_PIPE_OPTIONS } from 'src/core/validation/global-validation-pipe-options';

/**
 * PATCH /project/:projectId, with the pipe options of the running gateway.
 *
 * The permission guard is replaced by one that reads the permissions the
 * route really declares and grants only those the test caller holds (header
 * `x-test-granted`), so a caller without the route's permission is refused
 * before anything reaches global-management.
 */
// Names with no visible character, or holding a control character.
const INVALID_NAME_CONTENT: Array<[string, string]> = [
  ['made of a zero-width space only', '\u200b'],
  ['made of invisible characters only', ' \u200b\u200c\u200d\u2060\ufeff '],
  ['made of a soft hyphen only', '\u00ad'],
  ['holding a NUL byte', 'pay\u0000ments'],
  ['holding a line feed', 'pay\nments'],
  ['holding an escape character', 'pay\u001bments'],
  ['holding a DEL character', 'pay\u007fments'],
  ['holding a C1 control character', 'pay\u0085ments'],
];

describe('ProjectController PATCH /project/:projectId update rules', () => {
  let app: INestApplication;
  const projectServiceMock = {
    updateProject: jest.fn(),
    createProject: jest.fn(),
  };
  const reflector = new Reflector();
  const projectId = '0b6f1b2a-2c4d-4e8f-9a1b-3c5d7e9f1a2b';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
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
        canActivate: (context: ExecutionContext) => {
          context.switchToHttp().getRequest().user = { sub: 'u1' };
          return true;
        },
      })
      .overrideGuard(PermissionsGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          const required =
            reflector.get<string[]>('permissions', context.getHandler()) ?? [];
          const header = context.switchToHttp().getRequest().headers[
            'x-test-granted'
          ] as string | undefined;
          const granted = (header ?? '').split(',').filter(Boolean);
          if (!required.every((p) => granted.includes(p))) {
            throw new ForbiddenException('Permission denied');
          }
          return true;
        },
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    projectServiceMock.updateProject.mockReset();
    projectServiceMock.updateProject.mockResolvedValue({ success: true });
    projectServiceMock.createProject.mockReset();
    projectServiceMock.createProject.mockResolvedValue({ projectId });
  });

  const teamId = '1c7e2b3a-4d5f-4a6b-8c9d-0e1f2a3b4c5d';
  const create = (body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post(`/team/${teamId}/project`)
      .set('x-test-granted', 'create_project')
      .send(body);

  const patch = (body: Record<string, unknown>, granted = 'update') =>
    request(app.getHttpServer())
      .patch(`/project/${projectId}`)
      .set('x-test-granted', granted)
      .send(body);

  const sent = () => projectServiceMock.updateProject.mock.calls[0][0];

  describe('issue-creation branches', () => {
    it('a body without the field does not clear them', async () => {
      await patch({ githubIssueEnabled: true }).expect(200);

      expect(sent().clearIssueCreationBranches).toBe(false);
      expect(sent().issueCreationBranches).toEqual([]);
    });

    it('a body with an empty array clears them for a caller allowed to update the project', async () => {
      await patch({ issueCreationBranches: [] }).expect(200);

      expect(sent().clearIssueCreationBranches).toBe(true);
    });

    it('a body with branches replaces them without clearing', async () => {
      await patch({ issueCreationBranches: ['main', 'release'] }).expect(200);

      expect(sent().clearIssueCreationBranches).toBe(false);
      expect(sent().issueCreationBranches).toEqual(['main', 'release']);
    });

    it('a caller allowed only to scan cannot clear them', async () => {
      await patch({ issueCreationBranches: [] }, 'start_scan').expect(403);

      expect(projectServiceMock.updateProject).not.toHaveBeenCalled();
    });
  });

  // Both list fields follow one rule: an array (possibly empty) is a change,
  // null or a missing key is "not sent", and anything else is refused rather
  // than converted (the pipe would turn {} into an empty array, i.e. a clear).
  describe.each([
    {
      field: 'issueCreationBranches',
      clear: 'clearIssueCreationBranches',
      value: ['main', 'release'],
    },
    {
      field: 'agentCategoriesCicd',
      clear: 'clearAgentCategoriesCicd',
      value: ['cicd_security'],
    },
  ])('$field', ({ field, clear, value }) => {
    it.each([
      ['a missing key', {}],
      ['null', { [field]: null }],
    ])('%s changes nothing', async (_case, body) => {
      await patch({ githubIssueEnabled: true, ...body }).expect(200);

      expect(sent()[clear]).toBe(false);
      expect(sent()[field]).toEqual([]);
    });

    it('an empty array asks for the explicit clear', async () => {
      await patch({ [field]: [] }).expect(200);

      expect(sent()[clear]).toBe(true);
      expect(sent()[field]).toEqual([]);
    });

    it('a non-empty array replaces the list without clearing', async () => {
      await patch({ [field]: value }).expect(200);

      expect(sent()[clear]).toBe(false);
      expect(sent()[field]).toEqual(value);
    });

    it.each([
      ['an empty string', ''],
      ['an array holding an empty string', ['']],
      ['an object', {}],
      ['a number', 5],
      ['a string', 'main'],
    ])('%s is refused', async (_case, bad) => {
      await patch({ [field]: bad }).expect(400);

      expect(projectServiceMock.updateProject).not.toHaveBeenCalled();
    });

    it('a caller allowed only to scan cannot clear the list', async () => {
      await patch({ [field]: [] }, 'start_scan').expect(403);

      expect(projectServiceMock.updateProject).not.toHaveBeenCalled();
    });
  });

  describe('rename', () => {
    it('trims the new name', async () => {
      await patch({ name: '  Payments API  ' }).expect(200);

      expect(sent().name).toBe('Payments API');
    });

    it('accepts a name of 255 characters', async () => {
      await patch({ name: 'a'.repeat(255) }).expect(200);

      expect(sent().name).toHaveLength(255);
    });

    it.each([
      ['longer than 255 characters', 'a'.repeat(256)],
      ['made of spaces only', '   '],
      ['empty', ''],
      ['not a string', 12345],
      ...INVALID_NAME_CONTENT,
    ])('refuses a name %s', async (_case, name) => {
      await patch({ name }).expect(400);

      expect(projectServiceMock.updateProject).not.toHaveBeenCalled();
    });

    it('accepts a name with letters of any script and an inner joiner', async () => {
      await patch({ name: 'Café 支付 👩\u200d💻' }).expect(200);

      expect(sent().name).toBe('Café 支付 👩\u200d💻');
    });
  });

  describe('create', () => {
    it.each(INVALID_NAME_CONTENT)(
      'refuses a name %s, as a rename does',
      async (_case, name) => {
        await create({ name }).expect(400);

        expect(projectServiceMock.createProject).not.toHaveBeenCalled();
      },
    );

    it('accepts a plain name', async () => {
      await create({ name: '  Payments API ' }).expect(201);

      expect(projectServiceMock.createProject).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Payments API' }),
      );
    });
  });
});
