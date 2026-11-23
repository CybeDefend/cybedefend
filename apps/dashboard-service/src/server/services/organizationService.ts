import gatewayAPI from "../api/gatewayAPI";
import {
  GetOrganizationInvitationsResponseDto,
  OrganizationCreationRequestDto,
  OrganizationCreationResponseDto,
  OrganizationDeleteMemberResponseDto,
  OrganizationInviteRequest,
  OrganizationInviteResponseDto,
  OrganizationUpdateRoleResponseDto,
  TeamAssignment,
} from "../interfaces/Organization";
import { PaginatedUser } from "../interfaces/User";
import type { Product } from "../../utils/product";

export const createOrganization = async (
  organizationCreationRequestDto: OrganizationCreationRequestDto
): Promise<OrganizationCreationResponseDto> => {
  try {
    const response = await gatewayAPI.post(
      "/organization",
      organizationCreationRequestDto
    );
    return response.data;
  } catch (error) {
    throw error;
  }
};

export const fetchMyOrganizations = async () => {
  try {
    const response = await gatewayAPI.get("/organization");
    return response.data;
  } catch (error) {
    throw error;
  }
};

export const fetchOrganizationById = async (organizationId: string) => {
  const response = await gatewayAPI.get(`/organization/${organizationId}`);
  return response.data;
};

export const acceptOrganizationInvite = async ({
  token,
}: {
  token: string;
}) => {
  try {
    const response = await gatewayAPI.post("/organization/invite/accept", {
      token,
    });
    return response.data;
  } catch (error) {
    throw error;
  }
};

export const fetchOrganizationUsers = async (
  organizationId: string,
  page: number,
  pageSize: number,
  searchQuery: string
): Promise<PaginatedUser> => {
  try {
    const response = await gatewayAPI.get(
      `/organization/${organizationId}/members`,
      {
        params: {
          page,
          pageSize,
          search: searchQuery,
        },
      }
    );
    return response.data;
  } catch (error: any) {
    throw error;
  }
};

export const updateOrganizationMemberRole = async (
  organizationId: string,
  userId: string,
  role: string
): Promise<OrganizationUpdateRoleResponseDto> => {
  try {
    const response = await gatewayAPI.put(
      `/organization/${organizationId}/member/role`,
      {
        userId,
        role,
      }
    );
    return response.data;
  } catch (error: any) {
    throw error;
  }
};

export const removeOrganizationMember = async (
  organizationId: string,
  userId: string
): Promise<OrganizationDeleteMemberResponseDto> => {
  try {
    const response = await gatewayAPI.delete(
      `/organization/${organizationId}/member`,
      {
        data: { userId },
      }
    );
    return response.data;
  } catch (error: any) {
    throw error;
  }
};

export const fetchOrganizationTeams = async (organizationId: string) => {
  try {
    const response = await gatewayAPI.get(
      `/organization/${organizationId}/teams`
    );
    return response.data;
  } catch (error: any) {
    throw error;
  }
};

export const addOrganizationMember = async (
  organizationId: string,
  email: string,
  role: string,
  teamAssignments?: TeamAssignment[],
  products?: Product[]
) => {
  try {
    const requestBody: OrganizationInviteRequest = {
      email,
      role,
    };

    // Only add teamAssignments if provided and not empty
    if (teamAssignments && teamAssignments.length > 0) {
      requestBody.teamAssignments = teamAssignments;
    }

    // The products the invitation gives (per-member products).
    // Without them the gateway gives every active product the
    // inviter may give.
    if (products) {
      requestBody.products = products;
    }

    const response = await gatewayAPI.post(
      `/organization/${organizationId}/invite`,
      requestBody
    );
    return response.data;
  } catch (error: any) {
    throw error;
  }
};

export const fetchOrganizationInvitations = async (
  organizationId: string,
  page: number,
  pageSize: number
): Promise<GetOrganizationInvitationsResponseDto> => {
  try {
    const response = await gatewayAPI.get(
      `/organization/${organizationId}/invitations`,
      {
        params: {
          page,
          pageSize,
        },
      }
    );
    return response.data;
  } catch (error: any) {
    throw error;
  }
};

export const cancelOrganizationInvitation = async (
  organizationId: string,
  invitationId: string
): Promise<OrganizationInviteResponseDto> => {
  try {
    const response = await gatewayAPI.delete(
      `/organization/${organizationId}/invitation/${invitationId}`
    );
    return response.data;
  } catch (error: any) {
    throw error;
  }
};
