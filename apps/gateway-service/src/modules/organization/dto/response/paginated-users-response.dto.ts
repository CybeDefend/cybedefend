import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsNumber } from 'class-validator';
import { UserInformationsResponseDto } from 'src/modules/user/dto/response/user-informations-response.dto';

export class PaginatedUsersResponseDto {
  @ApiProperty({ description: 'List of users', isArray: true })
  @IsArray()
  users: UserInformationsResponseDto[];

  @ApiProperty({ description: 'Total number of users', type: 'number' })
  @IsNumber()
  totalUsers: number;

  @ApiProperty({ description: 'Total number of pages', type: 'number' })
  @IsNumber()
  totalPages: number;

  // No totalAdministrators: the members RPC (team.proto
  // PaginatedUsersResponse) never carried it, so it was documented and never
  // sent.
  constructor(
    users: UserInformationsResponseDto[],
    totalUsers: number,
    totalPages: number,
  ) {
    this.users = users;
    this.totalUsers = totalUsers;
    this.totalPages = totalPages;
  }

  public toString(): string {
    return JSON.stringify({
      users: this.users,
      totalUsers: this.totalUsers,
      totalPages: this.totalPages,
    });
  }
}
