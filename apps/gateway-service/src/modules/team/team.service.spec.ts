import { Test, TestingModule } from '@nestjs/testing';
import { ClientGrpc } from '@nestjs/microservices';
import { of, throwError } from 'rxjs';

import { TeamService } from './team.service';
import {
  TEAM_SERVICE_NAME,
  TeamServiceClient,
} from '@grpc/global-management/global_management';

import {
  TeamGetRequest,
  TeamInformationsResponse,
  TeamGetAllRequest,
  TeamInformationsList,
  TeamCreateRequest,
  TeamCreateResponse,
  TeamUpdateRequest,
  TeamUpdateResponse,
  TeamDeleteRequest,
  TeamDeleteResponse,
  TeamAddMemberRequest,
  TeamAddMemberResponse,
  TeamRemoveUserRequest,
  TeamRemoveUserResponse,
  UpdateTeamRoleRequest,
  UpdateTeamRoleResponse,
  TeamGetMembersRequest,
  PaginatedUsersResponse,
  TeamGetMemberRequest,
} from '@grpc/global-management/team';
import { UserInformationsResponse } from '@grpc/global-management/user';

describe('TeamService', () => {
  let service: TeamService;
  let clientMock: jest.Mocked<ClientGrpc>;
  let grpcStub: jest.Mocked<TeamServiceClient>;

  beforeEach(async () => {
    grpcStub = {
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
    } as any;

    clientMock = {
      getService: jest.fn().mockReturnValue(grpcStub),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TeamService,
        { provide: 'GLOBAL_MANAGEMENT_SERVICE', useValue: clientMock },
      ],
    }).compile();

    service = module.get(TeamService);
    service.onModuleInit();
  });

  it(
    'should init gRPC client',
    () => {
      expect(clientMock.getService).toHaveBeenCalledWith(TEAM_SERVICE_NAME);
    },
    expect.anything(),
  );

  it(
    'getTeam returns data',
    async () => {
      const req: TeamGetRequest = { teamId: 't1', organizationId: 'o1' };
      const res: TeamInformationsResponse = {
        id: 't1',
        name: 'A',
        description: 'd',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      grpcStub.getTeam.mockReturnValue(of(res) as any);
      await expect(service.getTeam(req)).resolves.toEqual(res);
      expect(grpcStub.getTeam).toHaveBeenCalledWith(req, expect.anything());
    },
    expect.anything(),
  );

  it('getTeam propagates error', async () => {
    grpcStub.getTeam.mockReturnValue(
      throwError(() => new Error('boom')) as any,
    );
    await expect(
      service.getTeam({ teamId: 'x', organizationId: 'o' }),
    ).rejects.toThrow('boom');
  });

  it('getAllTeams returns list', async () => {
    const req: TeamGetAllRequest = { organizationId: 'o1', userId: 'u1' };
    const res: TeamInformationsList = { teams: [] };
    grpcStub.getAllTeams.mockReturnValue(of(res) as any);
    await expect(service.getAllTeams(req)).resolves.toEqual(res);
  });

  it('createTeam returns response', async () => {
    const req: TeamCreateRequest = {
      organizationId: 'o1',
      name: 'N',
      description: 'D',
      creatorId: 'u1',
    };
    const res: TeamCreateResponse = {
      message: 'ok',
      organizationId: 'o1',
      teamId: 't1',
      name: 'N',
      description: 'D',
    };
    grpcStub.createTeam.mockReturnValue(of(res) as any);
    await expect(service.createTeam(req)).resolves.toEqual(res);
  });

  it('updateTeam returns response', async () => {
    const req: TeamUpdateRequest = {
      teamId: 't1',
      name: 'N',
      description: 'D',
    };
    const res: TeamUpdateResponse = {
      message: 'updated',
      updatedTeam: {
        id: 't1',
        name: 'N',
        description: 'D',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    };
    grpcStub.updateTeam.mockReturnValue(of(res) as any);
    await expect(service.updateTeam(req)).resolves.toEqual(res);
  });

  it('deleteTeam returns response', async () => {
    const req: TeamDeleteRequest = { teamId: 't1' };
    const res: TeamDeleteResponse = { message: 'deleted' };
    grpcStub.deleteTeam.mockReturnValue(of(res) as any);
    await expect(service.deleteTeam(req)).resolves.toEqual(res);
  });

  it('addMember returns response', async () => {
    const req: TeamAddMemberRequest = {
      teamId: 't1',
      userId: 'u1',
      role: 'dev',
    };
    const res: TeamAddMemberResponse = {
      message: 'added',
      updatedTeam: {
        id: 't1',
        name: 'N',
        description: 'D',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    };
    grpcStub.addMember.mockReturnValue(of(res) as any);
    await expect(service.addMember(req)).resolves.toEqual(res);
  });

  it('removeMember returns response', async () => {
    const req: TeamRemoveUserRequest = { teamId: 't1', userId: 'u1' };
    const res: TeamRemoveUserResponse = { message: 'removed' };
    grpcStub.removeMember.mockReturnValue(of(res) as any);
    await expect(service.removeMember(req)).resolves.toEqual(res);
  });

  it('updateMemberRole returns response', async () => {
    const req: UpdateTeamRoleRequest = {
      teamId: 't1',
      userId: 'u1',
      role: 'lead',
    };
    const res: UpdateTeamRoleResponse = { message: 'role updated' };
    grpcStub.updateMemberRole.mockReturnValue(of(res) as any);
    await expect(service.updateMemberRole(req)).resolves.toEqual(res);
  });

  it('getMembers returns paginated list', async () => {
    const req: TeamGetMembersRequest = {
      teamId: 't1',
      page: 1,
      pageSize: 10,
      searchQuery: '',
    };
    const res: PaginatedUsersResponse = {
      users: [],
      totalUsers: 0,
      totalPages: 0,
    };
    grpcStub.getMembers.mockReturnValue(of(res) as any);
    await expect(service.getMembers(req)).resolves.toEqual(res);
  });

  it('getMember returns user', async () => {
    const req: TeamGetMemberRequest = { teamId: 't1', userId: 'u1' };
    const res: UserInformationsResponse = {
      id: 'u1',
      firstName: 'John',
      lastName: 'Doe',
      email: 'john@doe.tld',
      picture: '',
    };
    grpcStub.getMember.mockReturnValue(of(res) as any);
    await expect(service.getMember(req)).resolves.toEqual(res);
  });
});
