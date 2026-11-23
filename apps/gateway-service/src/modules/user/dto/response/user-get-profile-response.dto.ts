// src/global-management/user/response/get-user-profile-response.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Length,
} from 'class-validator';
import { PRODUCT_KEYS } from 'src/core/products/products';

export class GetUserProfileResponseDto {
  @ApiProperty({ description: 'User unique identifier', format: 'uuid' })
  @IsUUID()
  @IsNotEmpty()
  id: string;

  @ApiProperty({ description: 'User first name', type: 'string' })
  @IsString()
  @IsNotEmpty()
  firstName: string;

  @ApiProperty({ description: 'User email address', format: 'email' })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({
    description: 'User last name',
    required: false,
    type: 'string',
  })
  @IsOptional()
  @IsString()
  lastName: string;

  @ApiProperty({
    description: 'User picture URL',
    required: false,
    type: 'string',
    maxLength: 8192,
  })
  @IsOptional()
  @IsString()
  @Length(0, 8192)
  picture: string;

  @ApiProperty({
    description: 'Enable or disable notifications',
    type: 'boolean',
  })
  @IsBoolean()
  notification: boolean;

  @ApiProperty({
    description: 'Indicates if the onboarding is completed',
    type: 'boolean',
  })
  @IsBoolean()
  isOnboardingCompleted: boolean;

  @ApiProperty({
    description: 'Date of account creation',
    format: 'date-time',
  })
  @IsDateString()
  createdAt: Date;

  @ApiProperty({
    description: 'Date of last account update',
    format: 'date-time',
  })
  @IsDateString()
  updatedAt: Date;

  @ApiProperty({
    description: 'List of organizations the user is part of',
    required: false,
    isArray: true,
    type: () => [OrganizationDto],
  })
  @IsOptional()
  @IsArray()
  myOrganizations: OrganizationDto[];

  @ApiProperty({
    description:
      'Flat list of the projects the user can access by membership, ' +
      'across all organisations, at most 500, ordered by organization ' +
      'name then project name: a user who can access more receives the ' +
      'first 500. Cached in Redux on the dashboard so ' +
      'global-chat / pickers / etc. can read it without an extra HTTP ' +
      'round-trip per page change.',
    required: false,
    isArray: true,
    type: () => [MyAccessibleProjectDto],
  })
  @IsOptional()
  @IsArray()
  myAccessibleProjects?: MyAccessibleProjectDto[];

  constructor(
    id: string,
    firstName: string,
    email: string,
    lastName: string,
    picture: string,
    notification: boolean,
    isOnboardingCompleted: boolean,
    createdAt: Date,
    updatedAt: Date,
    myOrganizations: OrganizationDto[],
    myAccessibleProjects?: MyAccessibleProjectDto[],
  ) {
    this.id = id;
    this.firstName = firstName;
    this.email = email;
    this.lastName = lastName;
    this.picture = picture;
    this.notification = notification;
    this.isOnboardingCompleted = isOnboardingCompleted;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
    this.myOrganizations = myOrganizations;
    this.myAccessibleProjects = myAccessibleProjects;
  }

  toString(): string {
    return JSON.stringify(this);
  }
}

export class MyAccessibleProjectDto {
  @ApiProperty({ description: 'Project UUID', format: 'uuid' })
  @IsUUID()
  projectId: string;

  @ApiProperty({ description: 'Project display name', type: 'string' })
  @IsString()
  projectName: string;

  @ApiProperty({ description: 'Organisation UUID', format: 'uuid' })
  @IsUUID()
  organizationId: string;

  @ApiProperty({ description: 'Organisation display name', type: 'string' })
  @IsString()
  organizationName: string;
}

export class TeamDto {
  @ApiProperty({ description: 'Team unique identifier', format: 'uuid' })
  @IsUUID()
  id: string;

  @ApiProperty({ description: 'Team name', type: 'string' })
  @IsString()
  name: string;

  @ApiProperty({ description: 'User role within the team', type: 'string' })
  @IsString()
  myRole: string;

  constructor(id: string, name: string, myRole: string) {
    this.id = id;
    this.name = name;
    this.myRole = myRole;
  }

  toString(): string {
    return JSON.stringify(this);
  }
}

export class OrganizationDto {
  @ApiProperty({
    description: 'Organization unique identifier',
    format: 'uuid',
  })
  @IsUUID()
  id: string;

  @ApiProperty({ description: 'Organization name', type: 'string' })
  @IsString()
  name: string;

  @ApiProperty({ description: 'Organization country', type: 'string' })
  @IsString()
  country: string;

  @ApiProperty({ description: 'Organization industry', type: 'string' })
  @IsString()
  industry: string;

  @ApiProperty({ description: 'Organization active status', type: 'boolean' })
  @IsBoolean()
  isActive: boolean;

  @ApiProperty({
    description: 'List of teams within the organization',
    isArray: true,
    type: () => [TeamDto],
  })
  @IsArray()
  myTeams: TeamDto[];

  @ApiProperty({
    description: 'User role within the organization',
    type: 'string',
  })
  @IsString()
  myRole: string;

  @ApiProperty({
    description:
      'The products the user holds in this organization (per-member products), e.g. "appsec". Read it with myProductsKnown: empty with myProductsKnown true means no product; with myProductsKnown false or absent, the list is unknown, never "no access".',
    isArray: true,
    enum: PRODUCT_KEYS,
    example: ['appsec'],
  })
  @IsArray()
  @IsString({ each: true })
  myProducts: string[];

  @ApiProperty({
    description:
      'true when global-management computed myProducts; false means unknown, never "no product"',
    type: 'boolean',
    example: true,
  })
  @IsBoolean()
  myProductsKnown: boolean;

  @ApiProperty({
    description:
      "The organisation's per-member products switch. Absent means unknown (an older backend); false means every member holds both products.",
    required: false,
    type: 'boolean',
  })
  @IsOptional()
  @IsBoolean()
  memberProducts?: boolean;

  constructor(
    id: string,
    name: string,
    country: string,
    industry: string,
    isActive: boolean,
    myTeams: TeamDto[],
    myRole: string,
    myProducts: string[] = [],
    myProductsKnown = false,
  ) {
    this.id = id;
    this.name = name;
    this.country = country;
    this.industry = industry;
    this.isActive = isActive;
    this.myTeams = myTeams;
    this.myRole = myRole;
    this.myProducts = myProducts;
    this.myProductsKnown = myProductsKnown;
  }

  toString(): string {
    return JSON.stringify(this);
  }
}
