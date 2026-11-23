// src/modules/team/team.service.ts
import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { Span } from 'nestjs-otel';

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
import {
  TEAM_SERVICE_NAME,
  TeamServiceClient,
} from '@grpc/global-management/global_management';
import { UserInformationsResponse } from '@grpc/global-management/user';
import { safeGrpcCall } from '@grpc/wrapper-grpc';
import { wrapGrpcClientWithTracing } from '@grpc/traced-grpc-client';

@Injectable()
export class TeamService implements OnModuleInit {
  private teamServiceClient!: TeamServiceClient;

  constructor(
    @Inject('GLOBAL_MANAGEMENT_SERVICE')
    private readonly client: ClientGrpc,
  ) {}

  onModuleInit() {
    this.teamServiceClient = wrapGrpcClientWithTracing(
      this.client.getService<TeamServiceClient>(TEAM_SERVICE_NAME),
    );
  }

  @Span()
  getTeam(data: TeamGetRequest): Promise<TeamInformationsResponse> {
    return safeGrpcCall(this.teamServiceClient.getTeam(data));
  }

  @Span()
  getAllTeams(data: TeamGetAllRequest): Promise<TeamInformationsList> {
    return safeGrpcCall(this.teamServiceClient.getAllTeams(data));
  }

  @Span()
  createTeam(data: TeamCreateRequest): Promise<TeamCreateResponse> {
    return safeGrpcCall(this.teamServiceClient.createTeam(data));
  }

  @Span()
  updateTeam(data: TeamUpdateRequest): Promise<TeamUpdateResponse> {
    return safeGrpcCall(this.teamServiceClient.updateTeam(data));
  }

  @Span()
  deleteTeam(data: TeamDeleteRequest): Promise<TeamDeleteResponse> {
    return safeGrpcCall(this.teamServiceClient.deleteTeam(data));
  }

  @Span()
  addMember(data: TeamAddMemberRequest): Promise<TeamAddMemberResponse> {
    return safeGrpcCall(this.teamServiceClient.addMember(data));
  }

  @Span()
  removeMember(data: TeamRemoveUserRequest): Promise<TeamRemoveUserResponse> {
    return safeGrpcCall(this.teamServiceClient.removeMember(data));
  }

  @Span()
  updateMemberRole(
    data: UpdateTeamRoleRequest,
  ): Promise<UpdateTeamRoleResponse> {
    return safeGrpcCall(this.teamServiceClient.updateMemberRole(data));
  }

  @Span()
  getMembers(data: TeamGetMembersRequest): Promise<PaginatedUsersResponse> {
    return safeGrpcCall(this.teamServiceClient.getMembers(data));
  }

  @Span()
  getMember(data: TeamGetMemberRequest): Promise<UserInformationsResponse> {
    return safeGrpcCall(this.teamServiceClient.getMember(data));
  }
}
