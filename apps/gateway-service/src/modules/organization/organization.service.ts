// src/modules/organization/organization.service.ts

import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { Span } from 'nestjs-otel';

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
  RequestOrganizationDeletionCodeRequest,
  RequestOrganizationDeletionCodeResponse,
} from '@grpc/global-management/organization';
import { safeGrpcCall } from '@grpc/wrapper-grpc';
import { wrapGrpcClientWithTracing } from '@grpc/traced-grpc-client';

import { callWithOrganizationRefusals } from './organization-refusals';
import { callWithOrganizationDeletionRefusals } from './organization-deletion-refusals';

@Injectable()
export class OrganizationService implements OnModuleInit {
  private organizationServiceClient!: OrganizationServiceClient;

  constructor(
    @Inject('GLOBAL_MANAGEMENT_SERVICE')
    private readonly client: ClientGrpc,
  ) {}

  onModuleInit() {
    const client = this.client.getService<OrganizationServiceClient>(
      ORGANIZATION_SERVICE_NAME,
    );
    // Wrap client to automatically inject OpenTelemetry trace context
    this.organizationServiceClient = wrapGrpcClientWithTracing(client);
  }

  /** Refused with an organisation refusal code (organization-refusals.ts). */
  @Span()
  inviteUserToOrganization(
    data: OrganizationInviteRequest,
  ): Promise<OrganizationInviteResponse> {
    return callWithOrganizationRefusals(
      this.organizationServiceClient.invite(data),
    );
  }

  @Span()
  cancelOrganizationInvitation(
    data: OrganizationCancelRequest,
  ): Promise<OrganizationInviteResponse> {
    return safeGrpcCall(this.organizationServiceClient.cancelInvitation(data));
  }

  @Span()
  getOrganizationInvitations(
    data: OrganizationGetInvitationsRequest,
  ): Promise<GetOrganizationInvitationsResponse> {
    return safeGrpcCall(this.organizationServiceClient.getInvitations(data));
  }

  @Span()
  getOrganization(
    data: OrganizationGetRequest,
  ): Promise<OrganizationInformationsResponse> {
    return safeGrpcCall(this.organizationServiceClient.get(data));
  }

  @Span()
  getOrganizations(
    data: OrganizationGetAllRequest,
  ): Promise<OrganizationInformationsList> {
    return safeGrpcCall(this.organizationServiceClient.getAll(data));
  }

  @Span()
  updateOrganization(
    data: OrganizationUpdateRequest,
  ): Promise<OrganizationUpdateResponse> {
    return safeGrpcCall(this.organizationServiceClient.update(data));
  }

  @Span()
  createOrganization(
    data: OrganizationCreateRequest,
  ): Promise<OrganizationCreateResponse> {
    return safeGrpcCall(this.organizationServiceClient.create(data));
  }

  /**
   * Refused with a deletion code (organization-deletion-refusals.ts). Calls
   * ConfirmOrganizationDeletion, never the former Delete: a global-management
   * older than the code answers it UNIMPLEMENTED (501) instead of ignoring
   * the code and deleting.
   */
  @Span()
  deleteOrganization(
    data: ConfirmOrganizationDeletionRequest,
  ): Promise<OrganizationDeleteResponse> {
    return callWithOrganizationDeletionRefusals(
      this.organizationServiceClient.confirmOrganizationDeletion(data),
    );
  }

  /** E-mails the creator the code that confirms the deletion. */
  @Span()
  requestOrganizationDeletionCode(
    data: RequestOrganizationDeletionCodeRequest,
  ): Promise<RequestOrganizationDeletionCodeResponse> {
    return callWithOrganizationDeletionRefusals(
      this.organizationServiceClient.requestOrganizationDeletionCode(data),
    );
  }

  @Span()
  getOrganizationMembers(
    data: OrganizationGetMembersRequest,
  ): Promise<PaginatedOrganizationMembersResponse> {
    return safeGrpcCall(this.organizationServiceClient.getMembers(data));
  }

  @Span()
  acceptInvitationToOrganization(
    data: OrganizationAcceptInviteRequest,
  ): Promise<OrganizationAcceptInviteResponse> {
    return safeGrpcCall(this.organizationServiceClient.acceptInvitation(data));
  }

  /** Refused with an organisation refusal code (organization-refusals.ts). */
  @Span()
  updateOrganizationMemberRole(
    data: OrganizationUpdateRoleRequest,
  ): Promise<OrganizationUpdateRoleResponse> {
    return callWithOrganizationRefusals(
      this.organizationServiceClient.updateMember(data),
    );
  }

  // updateMemberProducts belongs to the cloud edition (ClosedOrganizationService).

  @Span()
  removeOrganizationMember(
    data: OrganizationDeleteMemberRequest,
  ): Promise<OrganizationDeleteMemberResponse> {
    return safeGrpcCall(this.organizationServiceClient.removeMember(data));
  }

  @Span()
  getOrganizationIdByProjectId(
    data: OrganizationGetIdByProjectIdRequest,
  ): Promise<OrganizationGetIdByProjectIdResponse> {
    return safeGrpcCall(
      this.organizationServiceClient.getOrganizationIdByProjectId(data),
    );
  }

  @Span()
  getOrganizationByProject(
    data: OrganizationGetIdByProjectIdRequest,
  ): Promise<OrganizationInformationsResponse> {
    return safeGrpcCall(this.organizationServiceClient.getByProject(data));
  }

  // getBillingProfile / updateBillingProfile (ClosedOrganizationService) and
  // getMcpPolicy / updateMcpPolicy (McpPolicyService) belong to the cloud
  // edition.
}
