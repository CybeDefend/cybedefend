import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';

import { OrganizationController } from './organization.controller';
import { OrganizationService } from './organization.service';
import { Logger } from 'nestjs-pino';
import { ConfigService } from '@nestjs/config';
import { CombinedAuthRateLimitGuard } from 'src/core/guards/combined-auth-rate-limit.guard';
import { PermissionsGuard } from 'src/core/guards/permissions/permissions.guard';

describe('OrganizationController DTO validation (integration-light)', () => {
  let app: INestApplication;
  const organizationServiceMock = {
    inviteUserToOrganization: jest.fn(),
    cancelOrganizationInvitation: jest.fn(),
    getOrganizationInvitations: jest.fn(),
    getOrganization: jest.fn(),
    getOrganizations: jest.fn(),
    updateOrganization: jest.fn(),
    createOrganization: jest.fn(),
    deleteOrganization: jest.fn(),
    getOrganizationMembers: jest.fn(),
    acceptInvitationToOrganization: jest.fn(),
    updateOrganizationMemberRole: jest.fn(),
    removeOrganizationMember: jest.fn(),
  };
  const configMock = { get: jest.fn() };

  beforeAll(async () => {
    const moduleBuilder = Test.createTestingModule({
      controllers: [OrganizationController],
      providers: [
        { provide: OrganizationService, useValue: organizationServiceMock },
        { provide: Logger, useValue: { log: jest.fn(), error: jest.fn() } },
        // The controller reads NODE_ENV to decide whether `cf-connecting-ip`
        // and `cf-ipcountry` are trustworthy; this module has no ConfigModule
        // of its own.
        { provide: ConfigService, useValue: configMock },
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

  describe('POST /organization/:organizationId/invite', () => {
    it('400 when organizationId is not UUID', async () => {
      organizationServiceMock.inviteUserToOrganization.mockReset();
      await request(app.getHttpServer())
        .post(`/organization/not-a-uuid/invite`)
        .send({ email: 'a@b.c', role: 'member' })
        .expect(400);
      expect(
        organizationServiceMock.inviteUserToOrganization,
      ).not.toHaveBeenCalled();
    });

    it('400 when body invalid', async () => {
      organizationServiceMock.inviteUserToOrganization.mockReset();
      await request(app.getHttpServer())
        .post(`/organization/${uuid()}/invite`)
        .send({ email: 'not-an-email', role: 'nope' })
        .expect(400);
      expect(
        organizationServiceMock.inviteUserToOrganization,
      ).not.toHaveBeenCalled();
    });
  });

  describe('GET /organization/:organizationId/invitations', () => {
    it('400 when organizationId is not UUID', async () => {
      organizationServiceMock.getOrganizationInvitations.mockReset();
      await request(app.getHttpServer())
        .get(`/organization/not-a-uuid/invitations`)
        .query({ page: 1, pageSize: 10 })
        .expect(400);
      expect(
        organizationServiceMock.getOrganizationInvitations,
      ).not.toHaveBeenCalled();
    });

    it('400 when pageSize > 20', async () => {
      organizationServiceMock.getOrganizationInvitations.mockReset();
      await request(app.getHttpServer())
        .get(`/organization/${uuid()}/invitations`)
        .query({ page: 1, pageSize: 50 })
        .expect(400);
      expect(
        organizationServiceMock.getOrganizationInvitations,
      ).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /organization/:organizationId/invitation/:invitationId', () => {
    it('400 when organizationId is not UUID', async () => {
      organizationServiceMock.cancelOrganizationInvitation.mockReset();
      await request(app.getHttpServer())
        .delete(`/organization/not-a-uuid/invitation/${uuid()}`)
        .expect(400);
      expect(
        organizationServiceMock.cancelOrganizationInvitation,
      ).not.toHaveBeenCalled();
    });

    it('400 when invitationId is not UUID', async () => {
      organizationServiceMock.cancelOrganizationInvitation.mockReset();
      await request(app.getHttpServer())
        .delete(`/organization/${uuid()}/invitation/not-a-uuid`)
        .expect(400);
      expect(
        organizationServiceMock.cancelOrganizationInvitation,
      ).not.toHaveBeenCalled();
    });
  });

  describe('POST /organization/invite/accept', () => {
    it('400 when body invalid', async () => {
      organizationServiceMock.acceptInvitationToOrganization.mockReset();
      await request(app.getHttpServer())
        .post(`/organization/invite/accept`)
        .send({ token: '' })
        .expect(400);
      expect(
        organizationServiceMock.acceptInvitationToOrganization,
      ).not.toHaveBeenCalled();
    });
  });

  describe('GET /organizations', () => {
    it('passes without body; no validation errors occur', async () => {
      organizationServiceMock.getOrganizations.mockReset();
      await request(app.getHttpServer()).get(`/organizations`).expect(200);
    });
  });

  describe('GET /organization/:organizationId', () => {
    it('400 when organizationId is not UUID', async () => {
      organizationServiceMock.getOrganization.mockReset();
      await request(app.getHttpServer())
        .get(`/organization/not-a-uuid`)
        .expect(400);
      expect(organizationServiceMock.getOrganization).not.toHaveBeenCalled();
    });
  });

  describe('PUT /organization/:organizationId', () => {
    it('400 when organizationId is not UUID', async () => {
      organizationServiceMock.updateOrganization.mockReset();
      await request(app.getHttpServer())
        .put(`/organization/not-a-uuid`)
        .send({ name: 'n', industry: 'software', country: 'FR' })
        .expect(400);
      expect(organizationServiceMock.updateOrganization).not.toHaveBeenCalled();
    });

    it('400 when body invalid', async () => {
      organizationServiceMock.updateOrganization.mockReset();
      await request(app.getHttpServer())
        .put(`/organization/${uuid()}`)
        .send({ name: '', industry: 'invalid', country: '' })
        .expect(400);
      expect(organizationServiceMock.updateOrganization).not.toHaveBeenCalled();
    });
  });

  describe('POST /organization', () => {
    it('400 when body invalid', async () => {
      organizationServiceMock.createOrganization.mockReset();
      await request(app.getHttpServer())
        .post(`/organization`)
        .send({})
        .expect(400);
      expect(organizationServiceMock.createOrganization).not.toHaveBeenCalled();
    });

    // The cloud edition's case (the header's country stands in for the
    // body's) is tested there: the Community Edition reads no edge header.
    describe('billing country from the edge', () => {
      afterEach(() => configMock.get.mockReset());

      it('still validates a country the body declares, and keeps it', async () => {
        organizationServiceMock.createOrganization.mockReset();
        configMock.get.mockImplementation((key: string) =>
          key === 'NODE_ENV' ? 'production' : undefined,
        );

        await request(app.getHttpServer())
          .post(`/organization`)
          .set('CF-IPCountry', 'US')
          .send({ name: 'Acme', country: 'France' })
          .expect(400);
        expect(
          organizationServiceMock.createOrganization,
        ).not.toHaveBeenCalled();

        await request(app.getHttpServer())
          .post(`/organization`)
          .set('CF-IPCountry', 'US')
          .send({ name: 'Acme', country: 'FR' })
          .expect(201);
        expect(organizationServiceMock.createOrganization).toHaveBeenCalledWith(
          expect.objectContaining({ country: 'FR' }),
        );
      });
    });
  });

  describe('DELETE /organization/:organizationId', () => {
    it('400 when organizationId is not UUID', async () => {
      organizationServiceMock.deleteOrganization.mockReset();
      await request(app.getHttpServer())
        .delete(`/organization/not-a-uuid`)
        .expect(400);
      expect(organizationServiceMock.deleteOrganization).not.toHaveBeenCalled();
    });
  });

  describe('GET /organization/:organizationId/members', () => {
    it('400 when organizationId is not UUID', async () => {
      organizationServiceMock.getOrganizationMembers.mockReset();
      await request(app.getHttpServer())
        .get(`/organization/not-a-uuid/members`)
        .query({ page: 1, pageSize: 10 })
        .expect(400);
      expect(
        organizationServiceMock.getOrganizationMembers,
      ).not.toHaveBeenCalled();
    });

    it('400 when pageSize > 20', async () => {
      organizationServiceMock.getOrganizationMembers.mockReset();
      await request(app.getHttpServer())
        .get(`/organization/${uuid()}/members`)
        .query({ page: 1, pageSize: 50 })
        .expect(400);
      expect(
        organizationServiceMock.getOrganizationMembers,
      ).not.toHaveBeenCalled();
    });
  });

  describe('PUT /organization/:organizationId/member/role', () => {
    it('400 when organizationId is not UUID', async () => {
      organizationServiceMock.updateOrganizationMemberRole.mockReset();
      await request(app.getHttpServer())
        .put(`/organization/not-a-uuid/member/role`)
        .send({ userId: uuid(), role: 'member' })
        .expect(400);
      expect(
        organizationServiceMock.updateOrganizationMemberRole,
      ).not.toHaveBeenCalled();
    });

    it('400 when userId is not UUID or role is invalid', async () => {
      organizationServiceMock.updateOrganizationMemberRole.mockReset();
      await request(app.getHttpServer())
        .put(`/organization/${uuid()}/member/role`)
        .send({ userId: 'not-a-uuid', role: 'nope' })
        .expect(400);
      expect(
        organizationServiceMock.updateOrganizationMemberRole,
      ).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /organization/:organizationId/member', () => {
    it('400 when organizationId is not UUID', async () => {
      organizationServiceMock.removeOrganizationMember.mockReset();
      await request(app.getHttpServer())
        .delete(`/organization/not-a-uuid/member`)
        .send({ userId: uuid() })
        .expect(400);
      expect(
        organizationServiceMock.removeOrganizationMember,
      ).not.toHaveBeenCalled();
    });

    it('400 when body invalid', async () => {
      organizationServiceMock.removeOrganizationMember.mockReset();
      await request(app.getHttpServer())
        .delete(`/organization/${uuid()}/member`)
        .send({ userId: 'not-a-uuid' })
        .expect(400);
      expect(
        organizationServiceMock.removeOrganizationMember,
      ).not.toHaveBeenCalled();
    });
  });

  // The billing profile routes belong to the cloud edition, which covers
  // their 400s.
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
