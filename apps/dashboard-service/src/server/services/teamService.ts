import gatewayAPI from "../api/gatewayAPI";
import {
    Team,
    TeamCreateResponseDto,
    TeamDeleteMemberResponseDto,
    TeamDeleteResponseDto,
    TeamUpdateRoleResponseDto,
} from "../interfaces/Team";
import { PaginatedUser } from "../interfaces/User";

export const fetchAllTeams = async (
    organizationId: string
): Promise<Team[]> => {
  try {
    const response = await gatewayAPI.get(`/organization/${organizationId}/teams`);
    return response.data?.teams;
  } catch (error) {
    throw error;
  }
};

export const fetchTeamUsers = async (
  teamId: string,
  page: number,
  pageSize: number,
  searchQuery: string
): Promise<PaginatedUser> => {
  try {
    const response = await gatewayAPI.get(
      `/team/${teamId}/members`,
      {
        params: {
          page,
          pageSize,
          search: searchQuery,
        },
      }
    );
    return response.data;
  } catch (error:any) {
    throw error;
  }
};

export const updateTeamMemberRole = async (
  teamId: string,
  userId: string,
  role: string
): Promise<TeamUpdateRoleResponseDto> => {
  try {
    const response = await gatewayAPI.put(
      `/team/${teamId}/member/role`,
      {
        userId,
        role,
      }
    );
    return response.data;
  } catch (error:any) {
    throw error;
  }
};

export const removeTeamMember = async (
    teamId: string,
  userId: string
): Promise<TeamDeleteMemberResponseDto> => {
  try {
    const response = await gatewayAPI.delete(
      `/team/${teamId}/member`,
      {
        data: { userId },
      }
    );
    return response.data;
  } catch (error:any) {
    throw error;
  }
};

export const deleteTeam = async (
  teamId: string,
  organizationId: string
): Promise<TeamDeleteResponseDto> => {
  try {
    const response = await gatewayAPI.delete(`/team/${teamId}`, {
      data: {
        organizationId: organizationId,
      },
    });

    return response.data;
  } catch (error: any) {
    throw error;
  }
};

export const createTeam = async (
  organizationId: string,
  name: string,
  description: string
): Promise<TeamCreateResponseDto> => {
  try {
    const response = await gatewayAPI.post(
      `/organization/${organizationId}/team`,
      {
        name: name,
        description: description,
      }
    );
    return response.data;
  } catch (error: any) {
    throw error;
  }
};

export const addTeamMember = async (
  teamId: string,
  userId: string,
  role: string
): Promise<void> => {
  try {
    const response = await gatewayAPI.post(
      `/team/${teamId}/member`,
      {
        userId,
        role,
      }
    );
  } catch (error: any) {
    throw error;
  }
}
