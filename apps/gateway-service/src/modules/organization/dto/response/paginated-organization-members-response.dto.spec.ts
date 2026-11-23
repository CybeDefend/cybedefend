import {
  OrganizationMemberResponseDto,
  PaginatedOrganizationMembersResponseDto,
} from './paginated-organization-members-response.dto';

/** Where @ApiProperty lists a class's documented properties (@nestjs/swagger). */
const API_MODEL_PROPERTIES_ARRAY = 'swagger/apiModelPropertiesArray';

const documented = (prototype: object): string[] =>
  (Reflect.getMetadata(API_MODEL_PROPERTIES_ARRAY, prototype) as string[])
    .map((property) => property.replace(/^:/, ''))
    .sort();

/**
 * GET /organization/:organizationId/members documents these DTOs. They must
 * promise exactly what the members RPC returns (organization.proto
 * PaginatedOrganizationMembersResponse, OrganizationMember), products
 * included.
 */
describe('PaginatedOrganizationMembersResponseDto — documented fields', () => {
  it('documents exactly the fields of the members page', () => {
    expect(
      documented(PaginatedOrganizationMembersResponseDto.prototype),
    ).toEqual(['totalPages', 'totalUsers', 'users']);
  });

  it('documents exactly the fields of a member, its products included', () => {
    expect(documented(OrganizationMemberResponseDto.prototype)).toEqual([
      'email',
      'firstName',
      'id',
      'lastName',
      'picture',
      'products',
      'role',
    ]);
  });
});
