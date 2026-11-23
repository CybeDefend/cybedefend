import { PaginatedUsersResponseDto } from './paginated-users-response.dto';

/** Where @ApiProperty lists a class's documented properties (@nestjs/swagger). */
const API_MODEL_PROPERTIES_ARRAY = 'swagger/apiModelPropertiesArray';

/**
 * GET /organization/:organizationId/members and GET /team/:teamId/members
 * document this DTO. Its Swagger schema must only promise what the members
 * RPC returns (team.proto PaginatedUsersResponse: users, totalUsers,
 * totalPages): `totalAdministrators` was declared and never sent, and the
 * dashboard built a « last administrator » lock on it.
 */
describe('PaginatedUsersResponseDto — documented fields', () => {
  it('documents exactly the fields of the members RPC', () => {
    const documented = (
      Reflect.getMetadata(
        API_MODEL_PROPERTIES_ARRAY,
        PaginatedUsersResponseDto.prototype,
      ) as string[]
    ).map((property) => property.replace(/^:/, ''));

    expect(documented.sort()).toEqual(['totalPages', 'totalUsers', 'users']);
  });
});
