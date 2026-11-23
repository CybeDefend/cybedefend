import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsArray, ValidateNested, IsUUID } from 'class-validator';
import { OrganizationInviteResponseDto } from './organization-invite-response.dto';

export class GetOrganizationInvitationsResponseDto {
  @ApiProperty({
    description: 'Organization unique identifier',
    type: 'string',
    format: 'uuid',
  })
  @IsUUID()
  @IsNotEmpty()
  organizationId: string;

  @ApiProperty({
    description: 'List of invitations',
    isArray: true,
    type: () => [OrganizationInviteResponseDto],
  })
  @IsNotEmpty()
  @IsArray()
  @ValidateNested({ each: true })
  invitations: OrganizationInviteResponseDto[];

  constructor(
    organizationId: string,
    invitations: OrganizationInviteResponseDto[],
  ) {
    this.organizationId = organizationId;
    this.invitations = invitations;
  }

  public toString(): string {
    return JSON.stringify(this);
  }
}
