export interface Team {
  id: string;
  name: string;
  description: string;
  myRole: string;
  createdAt: string;
  updatedAt: string;
}

export interface TeamUpdateRoleResponseDto {
  success: boolean;
  message: string;
}

export interface TeamDeleteMemberResponseDto {
  success: boolean;
  message: string;
}

export interface TeamDeleteResponseDto {
  success: boolean;
  message: string;
}

export interface TeamCreateResponseDto {
  success: boolean;
  message: string;
  organizationId: string;
  teamId: string;
  name: string;
  description: string;
}
