import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsIn, IsNumber } from 'class-validator';

import { UserInformationsResponseDto } from 'src/modules/user/dto/response/user-informations-response.dto';
import { PRODUCT_KEYS } from 'src/core/products/products';

/**
 * A member as GET /organization/:organizationId/members lists it
 * (organization.proto OrganizationMember): the user, their organisation role
 * and their products in the organisation.
 */
export class OrganizationMemberResponseDto extends UserInformationsResponseDto {
  @ApiProperty({
    description: "The member's products in the organisation",
    isArray: true,
    enum: PRODUCT_KEYS,
    example: ['appsec'],
  })
  @IsArray()
  @IsIn(PRODUCT_KEYS, { each: true })
  readonly products: string[];

  constructor(
    id: string,
    firstName: string,
    lastName: string,
    email: string,
    picture: string,
    products: string[],
    role?: string,
  ) {
    super(id, firstName, lastName, email, picture, role);
    this.products = products;
  }
}

/** organization.proto PaginatedOrganizationMembersResponse. */
export class PaginatedOrganizationMembersResponseDto {
  @ApiProperty({
    description: 'Members of the organisation',
    isArray: true,
    type: () => [OrganizationMemberResponseDto],
  })
  @IsArray()
  users: OrganizationMemberResponseDto[];

  @ApiProperty({ description: 'Total number of members', type: 'number' })
  @IsNumber()
  totalUsers: number;

  @ApiProperty({ description: 'Total number of pages', type: 'number' })
  @IsNumber()
  totalPages: number;

  constructor(
    users: OrganizationMemberResponseDto[],
    totalUsers: number,
    totalPages: number,
  ) {
    this.users = users;
    this.totalUsers = totalUsers;
    this.totalPages = totalPages;
  }
}
