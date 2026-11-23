import { Controller } from '@nestjs/common';
import { GrpcMethod, RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { Span } from 'nestjs-otel';
import { Logger } from 'nestjs-pino';
import {
  GetOrganizationInvitationsResponse,
  OrganizationAcceptInviteRequest,
  OrganizationAcceptInviteResponse,
  OrganizationCancelRequest,
  CancelAllPendingInvitationsRequest,
  CancelAllPendingInvitationsResponse,
  OrganizationCreateRequest,
  OrganizationCreateResponse,
  OrganizationDeleteMemberRequest,
  OrganizationDeleteMemberResponse,
  OrganizationDeleteRequest,
  OrganizationDeleteResponse,
  OrganizationGetAllRequest,
  OrganizationGetIdByProjectIdRequest,
  OrganizationGetIdByProjectIdResponse,
  OrganizationGetIdByTeamIdRequest,
  OrganizationGetIdByTeamIdResponse,
  OrganizationGetInvitationsRequest,
  OrganizationGetMembersRequest,
  OrganizationGetRequest,
  OrganizationInformationsList,
  OrganizationInformationsResponse,
  OrganizationInviteRequest,
  OrganizationInviteResponse,
  OrganizationUpdateRequest,
  OrganizationUpdateResponse,
  OrganizationUpdateRoleRequest,
  OrganizationUpdateRoleResponse,
  CountMembersInOrganizationRequest,
  CountMembersInOrganizationResponse,
  PaginatedOrganizationMembersResponse,
  RequestOrganizationDeletionCodeRequest,
  RequestOrganizationDeletionCodeResponse,
  ConfirmOrganizationDeletionRequest,
} from '@grpc/global-management/organization';
import { OrganizationService } from './organization.service';

/**
 * Core `OrganizationService` handlers. Each RPC carries an explicit
 * `@GrpcMethod`: the closed RPCs of this service are served by the closed
 * edition, and stripped from the exported proto, so the class decorator over
 * the whole generated interface is gone.
 */
@Controller()
export class OrganizationController {
  constructor(
    private readonly organizationService: OrganizationService,
    private readonly logger: Logger,
  ) {}

  /**
   * Organization invitation member
   *
   * @param request organization invite request
   * @returns organization invite response
   */
  @GrpcMethod('OrganizationService', 'Invite')
  @Span()
  async invite(
    request: OrganizationInviteRequest,
  ): Promise<OrganizationInviteResponse> {
    if (!request) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Error inviting user to organization: Missing request data',
      });
    }
    return await this.organizationService.inviteUserToOrganization(request);
  }

  /**
   * Organization cancel invitation
   *
   * @param request organization cancel invitation request
   * @returns organization invite response
   */
  @GrpcMethod('OrganizationService', 'CancelInvitation')
  @Span()
  async cancelInvitation(
    request: OrganizationCancelRequest,
  ): Promise<OrganizationInviteResponse> {
    if (!request) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Error canceling invitation: Missing request data',
      });
    }
    return await this.organizationService.cancelInvitation(request);
  }

  /**
   * Organization cancel ALL pending invitations
   *
   * @param request organization id container
   * @returns count of cancelled invitations
   */
  @GrpcMethod('OrganizationService', 'CancelAllPendingInvitations')
  @Span()
  async cancelAllPendingInvitations(
    request: CancelAllPendingInvitationsRequest,
  ): Promise<CancelAllPendingInvitationsResponse> {
    if (!request) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Error cancelling all invitations: Missing request data',
      });
    }
    return await this.organizationService.cancelAllPendingInvitations(request);
  }

  /**
   * Organization get invitations
   *
   * @param request organization get invitations request
   * @returns organization invitations
   */
  @GrpcMethod('OrganizationService', 'GetInvitations')
  @Span()
  async getInvitations(
    request: OrganizationGetInvitationsRequest,
  ): Promise<GetOrganizationInvitationsResponse> {
    if (!request) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Error in data provided for getting invitations',
      });
    }
    return await this.organizationService.getOrganizationInvitations(request);
  }

  /**
   * Organization get information
   *
   * @param request organization get request
   * @returns organization information
   */
  @GrpcMethod('OrganizationService', 'Get')
  @Span()
  async get(
    request: OrganizationGetRequest,
  ): Promise<OrganizationInformationsResponse> {
    if (!request) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Error getting organization: Missing request data',
      });
    }

    return await this.organizationService.getOrganizationById(request);
  }

  /**
   * Organization get all information
   *
   * @param request organization get all request
   * @returns organization information list
   */
  @GrpcMethod('OrganizationService', 'GetAll')
  @Span()
  async getAll(
    request: OrganizationGetAllRequest,
  ): Promise<OrganizationInformationsList> {
    if (!request) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Error getting organizations: Missing request data',
      });
    }
    const organizations =
      await this.organizationService.getOrganizations(request);
    return { organizations };
  }

  /**
   * Organization update information
   *
   * @param request organization update request
   * @returns organization update response
   */
  @GrpcMethod('OrganizationService', 'Update')
  @Span()
  async update(
    request: OrganizationUpdateRequest,
  ): Promise<OrganizationUpdateResponse> {
    if (!request) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Error updating organization: Missing request data',
      });
    }
    return await this.organizationService.updateOrganization(request);
  }

  /**
   * Organization create
   *
   * @param request organization create request
   * @returns organization create response
   */
  @GrpcMethod('OrganizationService', 'Create')
  @Span()
  async create(
    request: OrganizationCreateRequest,
  ): Promise<OrganizationCreateResponse> {
    if (!request) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Invalid data provided for organization creation',
      });
    }
    return await this.organizationService.createOrganization(request);
  }

  /**
   * Organization delete
   *
   * @param request organization delete request
   * @returns organization delete response
   */
  @GrpcMethod('OrganizationService', 'Delete')
  @Span()
  async delete(
    request: OrganizationDeleteRequest,
  ): Promise<OrganizationDeleteResponse> {
    if (!request) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Error deleting organization: Missing request data',
      });
    }
    return await this.organizationService.deleteOrganization(request);
  }

  /**
   * The organization deletion: creator only, with the e-mailed code
   *
   * @param request organization, caller and confirmation code
   * @returns organization delete response
   */
  @GrpcMethod('OrganizationService', 'ConfirmOrganizationDeletion')
  @Span()
  async confirmOrganizationDeletion(
    request: ConfirmOrganizationDeletionRequest,
  ): Promise<OrganizationDeleteResponse> {
    if (!request?.organizationId) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Missing organizationId',
      });
    }
    return await this.organizationService.confirmOrganizationDeletion(request);
  }

  /**
   * E-mails the creator the code that confirms the organization's deletion
   *
   * @param request organization and caller
   * @returns when the code expires
   */
  @GrpcMethod('OrganizationService', 'RequestOrganizationDeletionCode')
  @Span()
  async requestOrganizationDeletionCode(
    request: RequestOrganizationDeletionCodeRequest,
  ): Promise<RequestOrganizationDeletionCodeResponse> {
    if (!request?.organizationId) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Missing organizationId',
      });
    }
    return await this.organizationService.requestOrganizationDeletionCode(
      request,
    );
  }

  /**
   * Organization get members
   *
   * @param request organization get members request
   * @returns organization members
   */
  @GrpcMethod('OrganizationService', 'GetMembers')
  @Span()
  async getMembers(
    request: OrganizationGetMembersRequest,
  ): Promise<PaginatedOrganizationMembersResponse> {
    if (!request) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Error getting organization members: Missing request data',
      });
    }

    return await this.organizationService.getMembersOrganization(request);
  }

  /**
   * Organization accept invitation
   *
   * @param request organization accept invitation request
   * @returns organization accept invite response
   */
  @GrpcMethod('OrganizationService', 'AcceptInvitation')
  @Span()
  async acceptInvitation(
    request: OrganizationAcceptInviteRequest,
  ): Promise<OrganizationAcceptInviteResponse> {
    return await this.organizationService.acceptInvitationFromOrganization(
      request,
    );
  }

  /**
   * Organization update member role
   *
   * @param request organization update member role request
   * @returns organization update role response
   */
  @GrpcMethod('OrganizationService', 'UpdateMember')
  @Span()
  async updateMember(
    request: OrganizationUpdateRoleRequest,
  ): Promise<OrganizationUpdateRoleResponse> {
    if (!request) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Error updating member in organization: Missing request data',
      });
    }

    return await this.organizationService.updateMemberRole(request);
  }

  /**
   * Organization remove member
   *
   * @param request organization remove member request
   * @returns organization delete member response
   */
  @GrpcMethod('OrganizationService', 'RemoveMember')
  @Span()
  async removeMember(
    request: OrganizationDeleteMemberRequest,
  ): Promise<OrganizationDeleteMemberResponse> {
    if (!request) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message:
          'Error removing member from organization: Missing request data',
      });
    }
    return await this.organizationService.deleteMember(request);
  }

  /**
   * Get organization id with project id linked
   *
   * @param request project get request
   * @returns organization id or error
   */
  @GrpcMethod('OrganizationService', 'GetOrganizationIdByProjectId')
  @Span()
  async getOrganizationIdByProjectId(
    request: OrganizationGetIdByProjectIdRequest,
  ): Promise<OrganizationGetIdByProjectIdResponse> {
    if (!request || !request.projectId) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message:
          'Error getting organization id by project id: Missing project id',
      });
    }
    return await this.organizationService.getOrganizationIdByProjectId(
      request.projectId,
    );
  }

  /**
   * Get the organization a team belongs to
   *
   * @param request team id
   * @returns organization id or error
   */
  @GrpcMethod('OrganizationService', 'GetOrganizationIdByTeamId')
  @Span()
  async getOrganizationIdByTeamId(
    request: OrganizationGetIdByTeamIdRequest,
  ): Promise<OrganizationGetIdByTeamIdResponse> {
    return await this.organizationService.getOrganizationIdByTeamId(
      request?.teamId,
    );
  }

  /**
   * Get organization details with project id linked
   *
   * @param request project get request
   * @returns organization details
   */
  @GrpcMethod('OrganizationService', 'GetByProject')
  @Span()
  async getByProject(
    request: OrganizationGetIdByProjectIdRequest,
  ): Promise<OrganizationInformationsResponse> {
    if (!request || !request.projectId) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Invalid data provided: projectId is required',
      });
    }
    return await this.organizationService.getOrganizationByProject(
      request.projectId,
    );
  }

  @GrpcMethod('OrganizationService', 'CountMembersInOrganization')
  @Span()
  async countMembersInOrganization(
    request: CountMembersInOrganizationRequest,
  ): Promise<CountMembersInOrganizationResponse> {
    if (!request?.organizationId) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'organizationId required',
      });
    }
    return this.organizationService.countMembersInOrganization(request);
  }
}
