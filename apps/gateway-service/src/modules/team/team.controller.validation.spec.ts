import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';

import { TeamController } from './team.controller';
import { TeamService } from './team.service';
import { Logger } from 'nestjs-pino';
import { CombinedAuthRateLimitGuard } from 'src/core/guards/combined-auth-rate-limit.guard';
import { PermissionsGuard } from 'src/core/guards/permissions/permissions.guard';

describe('TeamController DTO validation (integration-light)', () => {
  let app: INestApplication;
  const teamServiceMock = {
    getTeam: jest.fn(),
    getAllTeams: jest.fn(),
    createTeam: jest.fn(),
    updateTeam: jest.fn(),
    deleteTeam: jest.fn(),
    addMember: jest.fn(),
    removeMember: jest.fn(),
    updateMemberRole: jest.fn(),
    getMembers: jest.fn(),
    getMember: jest.fn(),
  };

  beforeAll(async () => {
    const moduleBuilder = Test.createTestingModule({
      controllers: [TeamController],
      providers: [
        { provide: TeamService, useValue: teamServiceMock },
        { provide: Logger, useValue: { log: jest.fn(), error: jest.fn() } },
      ],
    })
      .overrideGuard(CombinedAuthRateLimitGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true });

    const moduleFixture: TestingModule = await moduleBuilder.compile();

    app = moduleFixture.createNestApplication();
    // The guards are stubbed; the handlers still read the caller's id.
    app.use(
      (req: { user?: { sub: string } }, _res: unknown, next: () => void) => {
        req.user = { sub: cryptoRandomUUID() };
        next();
      },
    );
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

  describe('POST /organization/:organizationId/team', () => {
    it('should return 400 when body is missing required fields', async () => {
      teamServiceMock.createTeam.mockReset();
      await request(app.getHttpServer())
        .post(`/organization/${cryptoRandomUUID()}/team`)
        .send({ description: 'desc only' })
        .expect(400);
      expect(teamServiceMock.createTeam).not.toHaveBeenCalled();
    });

    it('should return 400 when name is empty', async () => {
      teamServiceMock.createTeam.mockReset();
      await request(app.getHttpServer())
        .post(`/organization/${cryptoRandomUUID()}/team`)
        .send({ name: '', description: 'desc' })
        .expect(400);
      expect(teamServiceMock.createTeam).not.toHaveBeenCalled();
    });
  });

  describe('PUT /team/:teamId', () => {
    it('should return 400 when name is missing', async () => {
      teamServiceMock.updateTeam.mockReset();
      await request(app.getHttpServer())
        .put(`/team/${cryptoRandomUUID()}`)
        .send({ description: 'only desc' })
        .expect(400);
      expect(teamServiceMock.updateTeam).not.toHaveBeenCalled();
    });
  });

  // The team table stores the name and the description in 255-character
  // columns, and PostgreSQL refuses a NUL byte in text: a body the database
  // would refuse is a 400 here, never a 500 from the service.
  describe.each([
    {
      route: 'POST /organization/:organizationId/team',
      send: (body: object) =>
        request(app.getHttpServer())
          .post(`/organization/${cryptoRandomUUID()}/team`)
          .send(body),
      handler: () => teamServiceMock.createTeam,
    },
    {
      route: 'PUT /team/:teamId',
      send: (body: object) =>
        request(app.getHttpServer())
          .put(`/team/${cryptoRandomUUID()}`)
          .send(body),
      handler: () => teamServiceMock.updateTeam,
    },
  ])(
    '$route: name and description fit the team columns',
    ({ send, handler }) => {
      beforeEach(() => {
        handler().mockReset();
        handler().mockResolvedValue({ id: 't1', message: 'ok' });
      });

      it.each([
        [
          'a name over 255 characters',
          { name: 'n'.repeat(256), description: 'd' },
        ],
        [
          'a 10,000-character name',
          { name: 'n'.repeat(10_000), description: 'd' },
        ],
        [
          'a description over 255 characters',
          { name: 'team', description: 'd'.repeat(256) },
        ],
        [
          'a 1,024-character description',
          { name: 'team', description: 'd'.repeat(1024) },
        ],
        ['a NUL byte in the name', { name: 'te\u0000am', description: 'd' }],
        [
          'a NUL byte in the description',
          { name: 'team', description: 'd\u0000d' },
        ],
        ['a blank name', { name: '   ', description: 'd' }],
        ['a name of tabs and new lines', { name: '\t\n', description: 'd' }],
      ])('refuses %s with 400', async (_label, body) => {
        await send(body).expect(400);
        expect(handler()).not.toHaveBeenCalled();
      });

      it('accepts a 255-character name and description', async () => {
        await send({ name: 'n'.repeat(255), description: 'd'.repeat(255) });
        expect(handler()).toHaveBeenCalled();
      });
    },
  );

  describe('POST /team/:teamId/member', () => {
    it('should return 400 when userId is not a uuid', async () => {
      teamServiceMock.addMember.mockReset();
      await request(app.getHttpServer())
        .post(`/team/${cryptoRandomUUID()}/member`)
        .send({ userId: 'not-a-uuid', role: 'developer' })
        .expect(400);
      expect(teamServiceMock.addMember).not.toHaveBeenCalled();
    });

    it('should return 400 when role is not in allowed set', async () => {
      teamServiceMock.addMember.mockReset();
      await request(app.getHttpServer())
        .post(`/team/${cryptoRandomUUID()}/member`)
        .send({ userId: cryptoRandomUUID(), role: 'invalid_role' })
        .expect(400);
      expect(teamServiceMock.addMember).not.toHaveBeenCalled();
    });
  });

  describe('GET /team/:teamId/members', () => {
    it('should return 400 when page < 1', async () => {
      teamServiceMock.getMembers.mockReset();
      await request(app.getHttpServer())
        .get(`/team/${cryptoRandomUUID()}/members`)
        .query({ page: 0, pageSize: 10 })
        .expect(400);
      expect(teamServiceMock.getMembers).not.toHaveBeenCalled();
    });

    it('should return 400 when pageSize > 20', async () => {
      teamServiceMock.getMembers.mockReset();
      await request(app.getHttpServer())
        .get(`/team/${cryptoRandomUUID()}/members`)
        .query({ page: 1, pageSize: 25 })
        .expect(400);
      expect(teamServiceMock.getMembers).not.toHaveBeenCalled();
    });

    it('should return 400 when page is not a number', async () => {
      teamServiceMock.getMembers.mockReset();
      await request(app.getHttpServer())
        .get(`/team/${cryptoRandomUUID()}/members`)
        .query({ page: 'abc', pageSize: 10 })
        .expect(400);
      expect(teamServiceMock.getMembers).not.toHaveBeenCalled();
    });
  });
});

function cryptoRandomUUID() {
  // quick UUID v4 for tests; Node 16+ has crypto.randomUUID but avoid import here
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replaceAll(
    /[xy]/g,
    function (c) {
      const r = (Math.random() * 16) | 0,
        v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    },
  );
}
