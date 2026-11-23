import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMinSize,
  ArrayUnique,
  IsEmail,
  IsNotEmpty,
  IsString,
  IsIn,
  IsOptional,
  IsArray,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { ASSIGNABLE_ORGANIZATION_ROLES } from '../../organization-roles';
import { Type } from 'class-transformer';

import { PRODUCT_KEYS } from 'src/core/products/products';

export class TeamAssignmentDto {
  @ApiProperty({
    description: 'Team ID',
    format: 'uuid',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsUUID(4)
  @IsNotEmpty()
  teamId: string;

  @ApiProperty({
    description: 'Role in the team',
    /** Team role: team_manager, analyst_developer, developer, read_only */
    enum: ['team_manager', 'analyst_developer', 'developer', 'read_only'],
    example: 'developer',
  })
  @IsString()
  @IsNotEmpty()
  @IsIn(['team_manager', 'analyst_developer', 'developer', 'read_only'])
  role: string;
}

export class OrganizationInviteBodyDto {
  @ApiProperty({
    description: 'Email of the person invited',
    required: true,
    format: 'email',
  })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({
    description: 'Role to assign',
    required: true,
    enum: ASSIGNABLE_ORGANIZATION_ROLES,
  })
  @IsString()
  @IsNotEmpty()
  @IsIn(ASSIGNABLE_ORGANIZATION_ROLES)
  role: string;

  @ApiProperty({
    description:
      'Array of team assignments with roles for automatic addition upon invitation acceptance',
    required: false,
    type: [TeamAssignmentDto],
    example: [
      {
        teamId: '550e8400-e29b-41d4-a716-446655440000',
        role: 'developer',
      },
      {
        teamId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
        role: 'team_manager',
      },
    ],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TeamAssignmentDto)
  teamAssignments?: TeamAssignmentDto[];

  @ApiProperty({
    description:
      'The products the invitation gives (per-member products). Absent: every active product the inviter may give (refused `NO_PRODUCT_SELECTED` when that is none). Each must be active on the organisation (refused `PRODUCT_NOT_ACTIVE`) and, for a manager, one they hold (`PRODUCT_NOT_GRANTABLE`); AppSec takes an AppSec seat (`APPSEC_SEATS_FULL`). An administrator is always given both.',
    required: false,
    isArray: true,
    enum: PRODUCT_KEYS,
    example: ['appsec'],
  })
  // Present, at least one: an empty list reaches global-management as « none
  // named », i.e. every product, so the gateway refuses it.
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsIn(PRODUCT_KEYS, { each: true })
  products?: string[];

  public toString(): string {
    return JSON.stringify(this);
  }

  constructor(
    email: string,
    role: string,
    teamAssignments?: TeamAssignmentDto[],
    products?: string[],
  ) {
    this.email = email;
    this.role = role;
    this.teamAssignments = teamAssignments;
    this.products = products;
  }
}
