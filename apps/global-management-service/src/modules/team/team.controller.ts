import { Controller } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { Logger } from 'nestjs-pino';
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
  ValidateTeamsInOrganizationRequest,
  ValidateTeamsInOrganizationResponse,
} from '@grpc/global-management/team';
import {
  TeamServiceController,
  TeamServiceControllerMethods,
} from '@grpc/global-management/global_management';
import { TeamService } from './team.service';
import { UserInformationsResponse } from '@grpc/global-management/user';

@TeamServiceControllerMethods()
@Controller()
export class TeamController implements TeamServiceController {
  constructor(
    private readonly service: TeamService,
    private readonly logger: Logger,
  ) {}

  async getTeam(request: TeamGetRequest): Promise<TeamInformationsResponse> {
    if (!request.teamId || !request.organizationId) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'teamId and organizationId are required',
      });
    }
    return this.service.getTeam(request);
  }

  async getAllTeams(request: TeamGetAllRequest): Promise<TeamInformationsList> {
    if (!request.organizationId || !request.userId) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'organizationId and userId are required',
      });
    }
    return this.service.getAllTeams(request);
  }

  async createTeam(request: TeamCreateRequest): Promise<TeamCreateResponse> {
    if (!request.organizationId || !request.name || !request.description) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'organizationId, name and description are required',
      });
    }
    return this.service.createTeam(request);
  }

  async updateTeam(request: TeamUpdateRequest): Promise<TeamUpdateResponse> {
    if (!request.teamId) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'teamId is required',
      });
    }
    return this.service.updateTeam(request);
  }

  async deleteTeam(request: TeamDeleteRequest): Promise<TeamDeleteResponse> {
    if (!request.teamId) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'teamId is required',
      });
    }
    return this.service.deleteTeam(request);
  }

  async addMember(
    request: TeamAddMemberRequest,
  ): Promise<TeamAddMemberResponse> {
    if (!request.teamId || !request.userId || !request.role) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'teamId, userId and role are required',
      });
    }
    return this.service.addMember(request);
  }

  async removeMember(
    request: TeamRemoveUserRequest,
  ): Promise<TeamRemoveUserResponse> {
    if (!request.teamId || !request.userId) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'teamId and userId are required',
      });
    }
    return this.service.removeMember(request);
  }

  async updateMemberRole(
    request: UpdateTeamRoleRequest,
  ): Promise<UpdateTeamRoleResponse> {
    if (!request.teamId || !request.userId || !request.role) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'teamId, userId and role are required',
      });
    }
    return this.service.updateMemberRole(request);
  }

  async getMembers(
    request: TeamGetMembersRequest,
  ): Promise<PaginatedUsersResponse> {
    if (!request.teamId) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'teamId is required',
      });
    }
    return this.service.getMembers(request);
  }

  async getMember(
    request: TeamGetMemberRequest,
  ): Promise<UserInformationsResponse> {
    if (!request.teamId || !request.userId) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'teamId and userId are required',
      });
    }
    return this.service.getMember(request);
  }

  // ========== Bulk Validation for Policy Management ==========

  async validateTeamsInOrganization(
    request: ValidateTeamsInOrganizationRequest,
  ): Promise<ValidateTeamsInOrganizationResponse> {
    if (!request.organizationId) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'organizationId is required',
      });
    }
    return this.service.validateTeamsInOrganization(request);
  }
}
