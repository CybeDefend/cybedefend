import { Test, TestingModule } from '@nestjs/testing';
import { ClientGrpc } from '@nestjs/microservices';
import { of, throwError } from 'rxjs';

import { OrganizationService } from './organization.service';
import {
  ORGANIZATION_SERVICE_NAME,
  OrganizationServiceClient,
} from '@grpc/global-management/global_management';

import {
  OrganizationInviteRequest,
  OrganizationInviteResponse,
  OrganizationCancelRequest,
  OrganizationGetInvitationsRequest,
  GetOrganizationInvitationsResponse,
  OrganizationGetRequest,
  OrganizationInformationsResponse,
  OrganizationGetAllRequest,
  OrganizationInformationsList,
  OrganizationUpdateRequest,
  OrganizationUpdateResponse,
  OrganizationCreateRequest,
  OrganizationCreateResponse,
  ConfirmOrganizationDeletionRequest,
  OrganizationDeleteResponse,
  OrganizationGetMembersRequest,
  OrganizationAcceptInviteRequest,
  OrganizationAcceptInviteResponse,
  OrganizationUpdateRoleRequest,
  OrganizationUpdateRoleResponse,
  OrganizationDeleteMemberRequest,
  OrganizationDeleteMemberResponse,
  OrganizationGetIdByProjectIdRequest,
  OrganizationGetIdByProjectIdResponse,
  PaginatedOrganizationMembersResponse,
} from '@grpc/global-management/organization';

describe('OrganizationService', () => {
  let service: OrganizationService;
  let clientMock: jest.Mocked<ClientGrpc>;
  let grpcStub: jest.Mocked<OrganizationServiceClient>;

  beforeEach(async () => {
    grpcStub = {
      invite: jest.fn(),
      cancelInvitation: jest.fn(),
      getInvitations: jest.fn(),
      get: jest.fn(),
      getAll: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
      confirmOrganizationDeletion: jest.fn(),
      getMembers: jest.fn(),
      acceptInvitation: jest.fn(),
      updateMember: jest.fn(),
      removeMember: jest.fn(),
      getOrganizationIdByProjectId: jest.fn(),
      getByProject: jest.fn(),
    } as any;

    clientMock = {
      getService: jest.fn().mockReturnValue(grpcStub),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrganizationService,
        { provide: 'GLOBAL_MANAGEMENT_SERVICE', useValue: clientMock },
      ],
    }).compile();

    service = module.get(OrganizationService);
    service.onModuleInit();
  });

  it('should init gRPC client', () => {
    expect(clientMock.getService).toHaveBeenCalledWith(
      ORGANIZATION_SERVICE_NAME,
    );
  });

  it(
    'inviteUserToOrganization returns response',
    async () => {
      const req: OrganizationInviteRequest = {
        invitedBy: 'u1',
        email: 'a@b.c',
        role: 'member',
        organizationId: 'o1',
        teamAssignments: [],
      } as any;
      const res: OrganizationInviteResponse = { message: 'ok' } as any;
      grpcStub.invite.mockReturnValue(of(res) as any);
      await expect(service.inviteUserToOrganization(req)).resolves.toEqual(res);
      expect(grpcStub.invite).toHaveBeenCalledWith(req, expect.anything());
    },
    expect.anything(),
  );

  it('cancelOrganizationInvitation returns response', async () => {
    const req: OrganizationCancelRequest = {
      organizationId: 'o1',
      invitationId: 'i1',
    } as any;
    const res: OrganizationInviteResponse = { message: 'cancelled' } as any;
    grpcStub.cancelInvitation.mockReturnValue(of(res) as any);
    await expect(service.cancelOrganizationInvitation(req)).resolves.toEqual(
      res,
    );
  });

  it('getOrganizationInvitations returns response', async () => {
    const req: OrganizationGetInvitationsRequest = {
      organizationId: 'o1',
      page: 1,
      pageSize: 10,
    };
    const res: GetOrganizationInvitationsResponse = {
      invitations: [],
      totalInvitations: 0,
      totalPages: 0,
    } as any;
    grpcStub.getInvitations.mockReturnValue(of(res) as any);
    await expect(service.getOrganizationInvitations(req)).resolves.toEqual(res);
  });

  it('getOrganization returns details', async () => {
    const req: OrganizationGetRequest = { organizationId: 'o1' };
    const res: OrganizationInformationsResponse = {
      id: 'o1',
      name: 'Org',
      industry: 'software',
      country: 'FR',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as any;
    grpcStub.get.mockReturnValue(of(res) as any);
    await expect(service.getOrganization(req)).resolves.toEqual(res);
  });

  it('getOrganizations returns list', async () => {
    const req: OrganizationGetAllRequest = { userId: 'u1' } as any;
    const res: OrganizationInformationsList = { organizations: [] } as any;
    grpcStub.getAll.mockReturnValue(of(res) as any);
    await expect(service.getOrganizations(req)).resolves.toEqual(res);
  });

  it('updateOrganization returns response', async () => {
    const req: OrganizationUpdateRequest = {
      organizationId: 'o1',
      name: 'N',
      industry: 'software',
      country: 'FR',
    } as any;
    const res: OrganizationUpdateResponse = { message: 'updated' } as any;
    grpcStub.update.mockReturnValue(of(res) as any);
    await expect(service.updateOrganization(req)).resolves.toEqual(res);
  });

  it('createOrganization returns response', async () => {
    const req: OrganizationCreateRequest = {
      name: 'N',
      industry: 'software',
      country: 'FR',
      creatorId: 'u1',
    } as any;
    const res: OrganizationCreateResponse = { message: 'created' } as any;
    grpcStub.create.mockReturnValue(of(res) as any);
    await expect(service.createOrganization(req)).resolves.toEqual(res);
  });

  it('deleteOrganization calls ConfirmOrganizationDeletion, never the former Delete', async () => {
    const req: ConfirmOrganizationDeletionRequest = {
      organizationId: 'o1',
      requestedBy: 'u1',
      confirmationCode: '012345',
    };
    const res: OrganizationDeleteResponse = { message: 'deleted' } as any;
    grpcStub.confirmOrganizationDeletion.mockReturnValue(of(res) as any);
    await expect(service.deleteOrganization(req)).resolves.toEqual(res);
    expect(grpcStub.confirmOrganizationDeletion).toHaveBeenCalledWith(
      req,
      expect.anything(),
    );
    expect(grpcStub.delete).not.toHaveBeenCalled();
  });

  it('getOrganizationMembers returns paginated users', async () => {
    const req: OrganizationGetMembersRequest = {
      organizationId: 'o1',
      page: 1,
      pageSize: 10,
      searchQuery: '',
    } as any;
    const res: PaginatedOrganizationMembersResponse = {
      users: [],
      totalUsers: 0,
      totalPages: 0,
    } as any;
    grpcStub.getMembers.mockReturnValue(of(res) as any);
    await expect(service.getOrganizationMembers(req)).resolves.toEqual(res);
  });

  it('acceptInvitationToOrganization returns response', async () => {
    const req: OrganizationAcceptInviteRequest = { userId: 'u1', token: 't' };
    const res: OrganizationAcceptInviteResponse = { message: 'ok' } as any;
    grpcStub.acceptInvitation.mockReturnValue(of(res) as any);
    await expect(service.acceptInvitationToOrganization(req)).resolves.toEqual(
      res,
    );
  });

  it('updateOrganizationMemberRole returns response', async () => {
    const req: OrganizationUpdateRoleRequest = {
      organizationId: 'o1',
      userId: 'u1',
      role: 'member',
    } as any;
    const res: OrganizationUpdateRoleResponse = { message: 'ok' } as any;
    grpcStub.updateMember.mockReturnValue(of(res) as any);
    await expect(service.updateOrganizationMemberRole(req)).resolves.toEqual(
      res,
    );
  });

  it('removeOrganizationMember returns response', async () => {
    const req: OrganizationDeleteMemberRequest = {
      organizationId: 'o1',
      userId: 'u1',
    } as any;
    const res: OrganizationDeleteMemberResponse = { message: 'ok' } as any;
    grpcStub.removeMember.mockReturnValue(of(res) as any);
    await expect(service.removeOrganizationMember(req)).resolves.toEqual(res);
  });

  it('getOrganizationIdByProjectId returns response', async () => {
    const req: OrganizationGetIdByProjectIdRequest = { projectId: 'p1' };
    const res: OrganizationGetIdByProjectIdResponse = {
      organizationId: 'o1',
    } as any;
    grpcStub.getOrganizationIdByProjectId.mockReturnValue(of(res) as any);
    await expect(service.getOrganizationIdByProjectId(req)).resolves.toEqual(
      res,
    );
  });

  it('getOrganizationByProject returns details', async () => {
    const req: OrganizationGetIdByProjectIdRequest = { projectId: 'p1' };
    const res: OrganizationInformationsResponse = {
      id: 'o1',
      name: 'Org',
      industry: 'software',
      country: 'FR',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as any;
    grpcStub.getByProject.mockReturnValue(of(res) as any);
    await expect(service.getOrganizationByProject(req)).resolves.toEqual(res);
  });

  // getBillingProfile / updateBillingProfile belong to the cloud edition.

  it('propagates error from gRPC', async () => {
    grpcStub.invite.mockReturnValue(throwError(() => new Error('boom')) as any);
    await expect(service.inviteUserToOrganization({} as any)).rejects.toThrow(
      'boom',
    );
  });
});
