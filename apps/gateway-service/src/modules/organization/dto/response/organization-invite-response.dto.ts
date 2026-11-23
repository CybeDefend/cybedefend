import { ApiProperty } from '@nestjs/swagger';
import { IsUUID, IsString, IsNotEmpty, IsDateString } from 'class-validator';

export class OrganizationInviteResponseDto {
  @ApiProperty({
    description: 'Invitation unique identifier',
    type: 'string',
    format: 'uuid',
  })
  @IsUUID()
  @IsNotEmpty()
  id: string;

  @ApiProperty({ description: 'Invitation token', type: 'string' })
  @IsString()
  @IsNotEmpty()
  token: string;

  @ApiProperty({ description: 'Email of the invitee', type: 'string' })
  @IsString()
  @IsNotEmpty()
  email: string;

  @ApiProperty({
    description: 'Current status of the invitation',
    type: 'string',
  })
  @IsString()
  @IsNotEmpty()
  status: string;

  @ApiProperty({
    description: 'Organization unique identifier',
    type: 'string',
    format: 'uuid',
  })
  @IsUUID()
  @IsNotEmpty()
  organizationId: string;

  @ApiProperty({ description: 'Organization name', type: 'string' })
  @IsString()
  @IsNotEmpty()
  organizationName: string;

  @ApiProperty({ description: 'Role in the organization', type: 'string' })
  @IsString()
  @IsNotEmpty()
  organizationRole: string;

  @ApiProperty({
    description: 'Invitation expiration date',
    type: 'string',
    format: 'date-time',
  })
  @IsDateString()
  @IsNotEmpty()
  expiresAt: Date;

  constructor(
    id: string,
    token: string,
    email: string,
    status: string,
    organizationId: string,
    organizationName: string,
    organizationRole: string,
    expiresAt: Date,
  ) {
    this.id = id;
    this.token = token;
    this.email = email;
    this.status = status;
    this.organizationId = organizationId;
    this.organizationName = organizationName;
    this.organizationRole = organizationRole;
    this.expiresAt = expiresAt;
  }

  public toString(): string {
    return JSON.stringify(this);
  }
}
