import { Test, TestingModule } from '@nestjs/testing';
import { TeamController } from './team.controller';
import { TeamService } from './team.service';
import { Logger } from 'nestjs-pino';
import { CombinedAuthRateLimitGuard } from 'src/core/guards/combined-auth-rate-limit.guard';
import { PermissionsGuard } from 'src/core/guards/permissions/permissions.guard';
import { AuthGuard } from 'src/core/guards/auth/auth.guard';
import { RateLimitGuard } from 'src/core/guards/throttler/throttler.guard';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import SecretsService from 'src/core/secrets/secrets.service';
import {
  TeamInformationsResponse,
  TeamInformationsList,
  TeamCreateResponse,
  TeamUpdateResponse,
  TeamDeleteResponse,
  TeamAddMemberResponse,
  TeamRemoveUserResponse,
  UpdateTeamRoleResponse,
  PaginatedUsersResponse,
} from '@grpc/global-management/team';
import { UserInformationsResponse } from '@grpc/global-management/user';

describe('TeamController', () => {
  let controller: TeamController;
  let service: TeamService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TeamController],
      providers: [
        {
          provide: TeamService,
          useValue: {
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
          },
        },
        { provide: Logger, useValue: { log: jest.fn(), error: jest.fn() } },
        {
          provide: CombinedAuthRateLimitGuard,
          useValue: { canActivate: jest.fn().mockResolvedValue(true) },
        },
        {
          provide: PermissionsGuard,
          useValue: { canActivate: jest.fn().mockResolvedValue(true) },
        },
        { provide: Reflector, useValue: { get: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: SecretsService, useValue: { getSecret: jest.fn() } },
        {
          provide: AuthGuard,
          useValue: { canActivate: jest.fn().mockResolvedValue(true) },
        },
        {
          provide: RateLimitGuard,
          useValue: { canActivate: jest.fn().mockResolvedValue(true) },
        },
      ],
    }).compile();

    controller = module.get<TeamController>(TeamController);
    service = module.get<TeamService>(TeamService);
  });

  describe('getTeam', () => {
    it('should return team details for valid team and organization ids', async () => {
      const result: TeamInformationsResponse = {
        id: '1',
        name: 'Development Team',
        description: 'Handles all development tasks',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      jest.spyOn(service, 'getTeam').mockResolvedValue(result);

      const response = await controller.getTeam('team1', 'org123');
      expect(response).toEqual(result);
    });

    it('should handle errors when invalid ids are provided', async () => {
      jest
        .spyOn(service, 'getTeam')
        .mockRejectedValue(new Error('Invalid IDs provided'));

      await expect(controller.getTeam('', '')).rejects.toThrow(
        'Invalid IDs provided',
      );
    });
  });

  describe('getTeams', () => {
    it('should return all teams within a given organization', async () => {
      const result: TeamInformationsList = {
        teams: [
          {
            id: '1',
            name: 'Development Team',
            description: 'Handles all development tasks',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          {
            id: '2',
            name: 'Marketing Team',
            description: 'Handles marketing',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      };
      jest.spyOn(service, 'getAllTeams').mockResolvedValue(result);

      const response = await controller.getTeams('org123', {
        user: { sub: 'u1' },
      } as any);
      expect(response).toEqual(result);
    });

    it('should handle errors when an invalid organization ID is provided', async () => {
      jest
        .spyOn(service, 'getAllTeams')
        .mockRejectedValue(new Error('Invalid organization ID'));

      await expect(
        controller.getTeams('', { user: { sub: 'u1' } } as any),
      ).rejects.toThrow('Invalid organization ID');
    });
  });

  describe('createTeam', () => {
    it('should successfully create a team within an organization', async () => {
      const result: TeamCreateResponse = {
        message: 'Team created successfully',
        organizationId: 'org123',
        teamId: '1',
        name: 'New Team',
        description: 'New team description',
      };
      jest.spyOn(service, 'createTeam').mockResolvedValue(result);

      const body = { name: 'New Team', description: 'New team description' };
      expect(
        await controller.createTeam(
          'org123',
          { user: { sub: 'u1' } } as any,
          body as any,
        ),
      ).toEqual(result);
    });

    it('should handle errors when invalid data is provided', async () => {
      jest
        .spyOn(service, 'createTeam')
        .mockRejectedValue(new Error('Invalid data provided'));

      await expect(
        controller.createTeam(
          'org123',
          { user: { sub: 'u1' } } as any,
          { name: '', description: '' } as any,
        ),
      ).rejects.toThrow('Invalid data provided');
    });
  });

  describe('updateTeam', () => {
    it('should update a team successfully with valid data', async () => {
      const result: TeamUpdateResponse = {
        message: 'Team updated successfully',
        updatedTeam: {
          id: '1',
          name: 'Updated Team',
          description: 'Updated description',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      };
      jest.spyOn(service, 'updateTeam').mockResolvedValue(result);

      const body = { name: 'Updated Team', description: 'Updated description' };
      expect(
        await controller.updateTeam(
          '1',
          body as any,
          { user: { sub: 'u1' } } as any,
        ),
      ).toEqual(result);
    });

    it('should handle errors when mandatory fields are missing', async () => {
      jest
        .spyOn(service, 'updateTeam')
        .mockRejectedValue(new Error('Mandatory fields are missing'));

      await expect(
        controller.updateTeam(
          '1',
          { name: '', description: '' } as any,
          { user: { sub: 'u1' } } as any,
        ),
      ).rejects.toThrow('Mandatory fields are missing');
    });
  });

  describe('deleteTeam', () => {
    it('should successfully delete a team', async () => {
      const result: TeamDeleteResponse = {
        message: 'Team successfully deleted',
      };
      jest.spyOn(service, 'deleteTeam').mockResolvedValue(result);

      expect(
        await controller.deleteTeam('team1', { user: { sub: 'u1' } } as any),
      ).toEqual(result);
    });

    it('should handle errors when trying to delete a non-existent team', async () => {
      jest
        .spyOn(service, 'deleteTeam')
        .mockRejectedValue(new Error('Team not found'));

      await expect(
        controller.deleteTeam('invalidTeamId', { user: { sub: 'u1' } } as any),
      ).rejects.toThrow('Team not found');
    });
  });

  describe('TeamAddMember', () => {
    it('should successfully add a member to a team with correct data', async () => {
      const result: TeamAddMemberResponse = {
        message: 'Member added successfully',
        updatedTeam: {
          id: '1',
          name: 'Dev Team',
          description: 'Handles development',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      };
      jest.spyOn(service, 'addMember').mockResolvedValue(result);

      const body = { userId: 'mem123', role: 'developer' };
      expect(
        await controller.TeamAddMember(
          'team1',
          { user: { sub: 'u1' } } as any,
          body as any,
        ),
      ).toEqual(result);
    });

    it('should handle errors when incomplete data is provided', async () => {
      jest
        .spyOn(service, 'addMember')
        .mockRejectedValue(new Error('Incomplete data provided'));

      await expect(
        controller.TeamAddMember(
          'team1',
          { user: { sub: 'u1' } } as any,
          { userId: '', role: '' } as any,
        ),
      ).rejects.toThrow('Incomplete data provided');
    });
  });

  describe('deleteTeamMember', () => {
    it('should successfully remove a member from a team', async () => {
      const result: TeamRemoveUserResponse = {
        message: 'Member successfully removed',
      };
      jest.spyOn(service, 'removeMember').mockResolvedValue(result);

      expect(
        await controller.deleteTeamMember(
          'team1',
          { user: { sub: 'u1' } } as any,
          { userId: 'mem1' } as any,
        ),
      ).toEqual(result);
    });

    it('names the token subject as the requester, never a body field', async () => {
      const removeMember = jest
        .spyOn(service, 'removeMember')
        .mockResolvedValue({ message: 'ok' });

      await controller.deleteTeamMember(
        'team1',
        { user: { sub: 'u1' } } as any,
        { userId: 'mem1', removedBy: 'someone-else' } as any,
      );

      expect(removeMember).toHaveBeenCalledWith({
        teamId: 'team1',
        userId: 'mem1',
        removedBy: 'u1',
      });
    });

    it('should handle errors when trying to remove a non-existent member', async () => {
      jest
        .spyOn(service, 'removeMember')
        .mockRejectedValue(new Error('Member not found'));

      await expect(
        controller.deleteTeamMember(
          'team1',
          { user: { sub: 'u1' } } as any,
          { userId: 'invalid' } as any,
        ),
      ).rejects.toThrow('Member not found');
    });
  });

  describe('updateTeamMemberRole', () => {
    it("should successfully update a team member's role", async () => {
      const result: UpdateTeamRoleResponse = {
        message: 'Role updated successfully',
      };
      jest.spyOn(service, 'updateMemberRole').mockResolvedValue(result);

      const body = { userId: 'userId1', role: 'developer' };
      expect(
        await controller.updateTeamMemberRole(
          'team1',
          { user: { sub: 'u1' } } as any,
          body as any,
        ),
      ).toEqual(result);
    });

    it('names the token subject as the requester of a role change', async () => {
      const updateMemberRole = jest
        .spyOn(service, 'updateMemberRole')
        .mockResolvedValue({ message: 'ok' });

      await controller.updateTeamMemberRole(
        'team1',
        { user: { sub: 'u1' } } as any,
        { userId: 'userId1', role: 'developer', updatedBy: 'x' } as any,
      );

      expect(updateMemberRole).toHaveBeenCalledWith({
        teamId: 'team1',
        userId: 'userId1',
        role: 'developer',
        updatedBy: 'u1',
      });
    });

    it('should handle errors when invalid data is provided', async () => {
      jest
        .spyOn(service, 'updateMemberRole')
        .mockRejectedValue(new Error('Invalid data'));

      await expect(
        controller.updateTeamMemberRole(
          'team1',
          { user: { sub: 'u1' } } as any,
          { userId: '', role: '' } as any,
        ),
      ).rejects.toThrow('Invalid data');
    });
  });

  describe('getTeamMembers', () => {
    it('should return all members of a specified team', async () => {
      const result: PaginatedUsersResponse = {
        users: [
          {
            id: '1',
            firstName: 'John',
            lastName: 'Doe',
            email: 'john.doe@example.com',
            picture: 'pic1.jpg',
          },
          {
            id: '2',
            firstName: 'Jane',
            lastName: 'Doe',
            email: 'jane.doe@example.com',
            picture: 'pic2.jpg',
          },
        ],
        totalUsers: 2,
        totalPages: 1,
      };
      jest.spyOn(service, 'getMembers').mockResolvedValue(result);

      const response = await controller.getTeamMembers('team1', {
        page: 1,
        pageSize: 10,
        search: '',
      } as any);
      expect(response).toEqual(result);
    });

    it('should handle errors when no team is found for the provided team ID', async () => {
      jest
        .spyOn(service, 'getMembers')
        .mockRejectedValue(new Error('Team not found'));

      await expect(
        controller.getTeamMembers('invalidTeamId', {
          page: 1,
          pageSize: 10,
          search: '',
        } as any),
      ).rejects.toThrow('Team not found');
    });
  });

  describe('getTeamMember', () => {
    it('should return details of a specific member in a team', async () => {
      const result: UserInformationsResponse = {
        id: '1',
        firstName: 'John',
        lastName: 'Doe',
        email: 'john.doe@example.com',
        picture: 'pic.jpg',
      };
      jest.spyOn(service, 'getMember').mockResolvedValue(result);

      const response = await controller.getTeamMember('team1', '1');
      expect(response).toEqual(result);
    });

    it('should handle errors when the specified member is not found in the team', async () => {
      jest
        .spyOn(service, 'getMember')
        .mockRejectedValue(new Error('Member not found'));

      await expect(
        controller.getTeamMember('team1', 'nonExistentMemberId'),
      ).rejects.toThrow('Member not found');
    });
  });
});
