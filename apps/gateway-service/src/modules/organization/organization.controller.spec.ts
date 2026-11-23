import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from 'nestjs-pino';
import { OrganizationController } from './organization.controller';
import { OrganizationService } from './organization.service';
import { CombinedAuthRateLimitGuard } from 'src/core/guards/combined-auth-rate-limit.guard';
import { PermissionsGuard } from 'src/core/guards/permissions/permissions.guard';
import { AuthGuard } from 'src/core/guards/auth/auth.guard';
import { RateLimitGuard } from 'src/core/guards/throttler/throttler.guard';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import SecretsService from 'src/core/secrets/secrets.service';

import {
  GetOrganizationInvitationsResponse,
  OrganizationAcceptInviteResponse,
  OrganizationDeleteMemberResponse,
  OrganizationDeleteResponse,
  OrganizationInformationsList,
  OrganizationInformationsResponse,
  OrganizationInviteResponse,
  OrganizationUpdateResponse,
  OrganizationUpdateRoleResponse,
  PaginatedOrganizationMembersResponse,
} from '@grpc/global-management/organization';

import { OrganizationInviteBodyDto } from './dto/body/organization-invite-body.dto';
import { OrganizationGetInvitationsBodyDto } from './dto/body/organization-get-invitations-body.dto';
import { OrganizationUpdateBodyDto } from './dto/body/organization-update-body.dto';
import { OrganizationUpdateRoleBodyDto } from './dto/body/organization-update-role-body.dto';
import { OrganizationDeleteMemberBodyDto } from './dto/body/organization-delete-member-body.dto';
import { OrganizationCreateBodyDto } from './dto/body/organization-create-body.dto';
import { OrganizationGetMembersBodyDto } from './dto/body/organization-get-members-body.dto';
import { OrganizationAcceptInviteBodyDto } from './dto/body/organization-accept-invite-body.dto';

describe('OrganizationController', () => {
  let controller: OrganizationController;
  let service: jest.Mocked<OrganizationService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [OrganizationController],
      providers: [
        {
          provide: OrganizationService,
          useValue: {
            inviteUserToOrganization: jest.fn(),
            cancelOrganizationInvitation: jest.fn(),
            getOrganizationInvitations: jest.fn(),
            getOrganization: jest.fn(),
            getOrganizations: jest.fn(),
            updateOrganization: jest.fn(),
            createOrganization: jest.fn(),
            deleteOrganization: jest.fn(),
            requestOrganizationDeletionCode: jest.fn(),
            getOrganizationMembers: jest.fn(),
            acceptInvitationToOrganization: jest.fn(),
            updateOrganizationMemberRole: jest.fn(),
            removeOrganizationMember: jest.fn(),
            getOrganizationIdByProjectId: jest.fn(),
            getOrganizationByProject: jest.fn(),
          },
        },
        { provide: Logger, useValue: { log: jest.fn(), error: jest.fn() } },
        { provide: Reflector, useValue: { get: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: SecretsService, useValue: { getSecret: jest.fn() } },
        {
          provide: CombinedAuthRateLimitGuard,
          useValue: { canActivate: jest.fn().mockResolvedValue(true) },
        },
        {
          provide: PermissionsGuard,
          useValue: { canActivate: jest.fn().mockResolvedValue(true) },
        },
        { provide: AuthGuard, useValue: { canActivate: jest.fn() } },
        { provide: RateLimitGuard, useValue: { canActivate: jest.fn() } },
      ],
    }).compile();

    controller = module.get<OrganizationController>(OrganizationController);
    service = module.get(OrganizationService) as any;
  });

  describe('inviteUserToOrganization', () => {
    it('maps params, body, and req.user to OrganizationInviteRequest', async () => {
      const res: OrganizationInviteResponse = { message: 'ok' } as any;
      service.inviteUserToOrganization.mockResolvedValue(res);
      const dto: OrganizationInviteBodyDto = {
        email: 'a@b.c',
        role: 'member',
        teamAssignments: [],
      } as any;
      const out = await controller.inviteUserToOrganization(
        '11111111-1111-1111-1111-111111111111',
        { user: { sub: 'u1' } } as any,
        dto,
      );
      expect(out).toEqual(res);
      expect(service.inviteUserToOrganization).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: '11111111-1111-1111-1111-111111111111',
          invitedBy: 'u1',
          email: 'a@b.c',
          role: 'member',
          // Per-member products: a body that names none (an older
          // dashboard, the CLI) means every active product the inviter may
          // give (cloud edition).
          products: [],
        }),
      );
    });
  });

  describe('getOrganizationInvitations', () => {
    it('maps param and query DTO', async () => {
      const res: GetOrganizationInvitationsResponse = {
        invitations: [],
        totalInvitations: 0,
        totalPages: 0,
      } as any;
      service.getOrganizationInvitations.mockResolvedValue(res);
      const dto: OrganizationGetInvitationsBodyDto = {
        page: 1,
        pageSize: 10,
      } as any;
      const out = await controller.getOrganizationInvitations(
        '11111111-1111-1111-1111-111111111111',
        dto,
      );
      expect(out).toEqual(res);
      expect(service.getOrganizationInvitations).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: '11111111-1111-1111-1111-111111111111',
          page: 1,
          pageSize: 10,
        }),
      );
    });
  });

  describe('cancelOrganizationInvitation', () => {
    it('maps params and req.user', async () => {
      const res: OrganizationInviteResponse = { message: 'cancelled' } as any;
      service.cancelOrganizationInvitation.mockResolvedValue(res);
      const out = await controller.cancelOrganizationInvitation(
        '11111111-1111-1111-1111-111111111111',
        '22222222-2222-2222-2222-222222222222',
        { user: { sub: 'u1' } } as any,
      );
      expect(out).toEqual(res);
      expect(service.cancelOrganizationInvitation).toHaveBeenCalledWith({
        organizationId: '11111111-1111-1111-1111-111111111111',
        invitationId: '22222222-2222-2222-2222-222222222222',
      });
    });
  });

  describe('acceptInvitationToOrganization', () => {
    it('maps req.user and body', async () => {
      const res: OrganizationAcceptInviteResponse = { message: 'ok' } as any;
      service.acceptInvitationToOrganization.mockResolvedValue(res);
      const dto: OrganizationAcceptInviteBodyDto = { token: 'tok' } as any;
      const out = await controller.acceptInvitationToOrganization(
        { user: { sub: 'u1' } } as any,
        dto,
      );
      expect(out).toEqual(res);
      expect(service.acceptInvitationToOrganization).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'u1', token: 'tok' }),
      );
    });
  });

  describe('getOrganizations', () => {
    it('maps req.user to OrganizationGetAllRequest', async () => {
      const res: OrganizationInformationsList = { organizations: [] } as any;
      service.getOrganizations.mockResolvedValue(res);
      const out = await controller.getOrganizations({
        user: { sub: 'u1' },
      } as any);
      expect(out).toEqual(res);
      expect(service.getOrganizations).toHaveBeenCalledWith({ userId: 'u1' });
    });
  });

  describe('getOrganization', () => {
    it('maps param to OrganizationGetRequest', async () => {
      const res: OrganizationInformationsResponse = {
        id: 'o1',
        name: 'Org',
        industry: 'software',
        country: 'FR',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as any;
      service.getOrganization.mockResolvedValue(res);
      const out = await controller.getOrganization(
        '11111111-1111-1111-1111-111111111111',
      );
      expect(out).toEqual(res);
      expect(service.getOrganization).toHaveBeenCalledWith({
        organizationId: '11111111-1111-1111-1111-111111111111',
      });
    });
  });

  describe('updateOrganization', () => {
    it('maps body + params + req.user to OrganizationUpdateRequest', async () => {
      const res: OrganizationUpdateResponse = { message: 'ok' } as any;
      service.updateOrganization.mockResolvedValue(res);
      const dto: OrganizationUpdateBodyDto = {
        name: 'New',
        industry: 'software',
        country: 'FR',
      } as any;
      const out = await controller.updateOrganization(
        '11111111-1111-1111-1111-111111111111',
        { user: { sub: 'u1' } } as any,
        dto,
      );
      expect(out).toEqual(res);
      expect(service.updateOrganization).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: '11111111-1111-1111-1111-111111111111',
          name: 'New',
          industry: 'software',
          country: 'FR',
        }),
      );
    });
  });

  describe('createOrganization', () => {
    it('maps req.user + body to OrganizationCreateRequest', async () => {
      const res = {
        message: 'created',
        organizationId: 'o1',
      } as any;
      service.createOrganization.mockResolvedValue(res);
      const dto: OrganizationCreateBodyDto = {
        name: 'N',
        industry: 'software',
        country: 'FR',
        customerType: 'individual',
        firstName: 'A',
        lastName: 'B',
      } as any;
      const out = await controller.createOrganization(
        { user: { sub: 'u1' } } as any,
        dto,
      );
      expect(out).toEqual(res);
      expect(service.createOrganization).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'N', creatorId: 'u1' }),
      );
    });

    /**
     * The core takes the organisation's name, industry and country, and
     * nothing else: the sign-up's marketing context, billing identity and
     * network context belong to a closed extension, which registers how it
     * maps them. None is registered here.
     */
    it('forwards none of the sign-up fields a closed extension owns', async () => {
      service.createOrganization.mockResolvedValue({
        message: 'created',
        organizationId: 'o1',
      } as any);
      const body = {
        name: 'N',
        industry: 'software',
        country: 'FR',
        customerType: 'company',
        companyName: 'Acme',
        vatNumber: 'FR00',
        billingAddressLine1: '1 rue',
        billingCity: 'Paris',
        billingPostalCode: '75001',
        attribution: { first: { source: 'meta' } },
        hdyhau: 'advertising',
        intendedPlan: 'team',
        leadId: '6f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f',
      } as unknown as OrganizationCreateBodyDto;

      await controller.createOrganization(
        {
          user: { sub: 'u1' },
          ip: '203.0.113.9',
          headers: { 'user-agent': 'Mozilla/5.0', 'cf-ipcountry': 'US' },
        } as any,
        body,
      );

      expect(service.createOrganization).toHaveBeenCalledWith({
        name: 'N',
        industry: 'software',
        country: 'FR',
        creatorId: 'u1',
        customerType: '',
        firstName: '',
        lastName: '',
        companyName: '',
        vatNumber: '',
        billingAddressLine1: '',
        billingAddressLine2: '',
        billingCity: '',
        billingPostalCode: '',
        billingRegion: '',
        attribution: undefined,
        clientIp: '',
        clientUserAgent: '',
      });
    });
  });

  describe('deleteOrganization', () => {
    it('maps params, the code and req.user to OrganizationDeleteRequest', async () => {
      const res: OrganizationDeleteResponse = { message: 'deleted' } as any;
      service.deleteOrganization.mockResolvedValue(res);
      const out = await controller.deleteOrganization(
        '11111111-1111-1111-1111-111111111111',
        { code: '012345' },
        { user: { sub: 'u1' } } as any,
      );
      expect(out).toEqual(res);
      expect(service.deleteOrganization).toHaveBeenCalledWith({
        organizationId: '11111111-1111-1111-1111-111111111111',
        requestedBy: 'u1',
        confirmationCode: '012345',
      });
    });
  });

  describe('requestOrganizationDeletionCode', () => {
    it('maps the param and req.user, never a body', async () => {
      service.requestOrganizationDeletionCode.mockResolvedValue({
        expiresAt: '2026-10-27T10:10:00.000Z',
      });
      const out = await controller.requestOrganizationDeletionCode(
        '11111111-1111-1111-1111-111111111111',
        { user: { sub: 'u1' } } as any,
      );
      expect(out).toEqual({ expiresAt: '2026-10-27T10:10:00.000Z' });
      expect(service.requestOrganizationDeletionCode).toHaveBeenCalledWith({
        organizationId: '11111111-1111-1111-1111-111111111111',
        requestedBy: 'u1',
      });
    });
  });

  describe('getOrganizationMembers', () => {
    it('maps query DTO and param to OrganizationGetMembersRequest', async () => {
      const res: PaginatedOrganizationMembersResponse = {
        users: [],
        totalUsers: 0,
        totalPages: 0,
      } as any;
      service.getOrganizationMembers.mockResolvedValue(res);
      const dto: OrganizationGetMembersBodyDto = {
        page: 2,
        pageSize: 5,
        search: 'jane',
      } as any;
      const out = await controller.getOrganizationMembers(
        '11111111-1111-1111-1111-111111111111',
        dto,
      );
      expect(out).toEqual(res);
      expect(service.getOrganizationMembers).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: '11111111-1111-1111-1111-111111111111',
          page: 2,
          pageSize: 5,
          searchQuery: 'jane',
        }),
      );
    });
  });

  describe('updateOrganizationMemberRole', () => {
    // Global-management ranks the change against
    // its author, who is the token's subject, never a body field.
    it('maps body and params to OrganizationUpdateRoleRequest, the author from the token', async () => {
      const res: OrganizationUpdateRoleResponse = { message: 'ok' } as any;
      service.updateOrganizationMemberRole.mockResolvedValue(res);
      const dto: OrganizationUpdateRoleBodyDto = {
        userId: '22222222-2222-2222-2222-222222222222',
        role: 'member',
      } as any;
      const out = await controller.updateOrganizationMemberRole(
        '11111111-1111-1111-1111-111111111111',
        dto,
        { user: { sub: 'u1' } } as any,
      );
      expect(out).toEqual(res);
      expect(service.updateOrganizationMemberRole).toHaveBeenCalledWith({
        organizationId: '11111111-1111-1111-1111-111111111111',
        userId: '22222222-2222-2222-2222-222222222222',
        role: 'member',
        updatedBy: 'u1',
      });
    });
  });

  describe('removeOrganizationMember', () => {
    // The removal is ranked against its author,
    // the token's subject.
    it('maps body and params to OrganizationDeleteMemberRequest, the author from the token', async () => {
      const res: OrganizationDeleteMemberResponse = { message: 'ok' } as any;
      service.removeOrganizationMember.mockResolvedValue(res);
      const dto: OrganizationDeleteMemberBodyDto = {
        userId: '22222222-2222-2222-2222-222222222222',
      } as any;
      const out = await controller.removeOrganizationMember(
        '11111111-1111-1111-1111-111111111111',
        dto,
        { user: { sub: 'u1' } } as any,
      );
      expect(out).toEqual(res);
      expect(service.removeOrganizationMember).toHaveBeenCalledWith({
        organizationId: '11111111-1111-1111-1111-111111111111',
        userId: '22222222-2222-2222-2222-222222222222',
        removedBy: 'u1',
      });
    });
  });

  // The billing profile routes belong to the cloud edition.
});
