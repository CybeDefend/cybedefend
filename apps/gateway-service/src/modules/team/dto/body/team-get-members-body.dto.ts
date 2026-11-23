// src/global-management/team/body/team-get-members-query-request.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min, Max, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';

export class TeamGetMembersBodyDto {
  @ApiProperty({ description: 'Page number', minimum: 1, type: 'number' })
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page: number = 1;

  @ApiProperty({
    description: 'Number of items per page',
    minimum: 1,
    maximum: 20,
    type: 'number',
  })
  @IsInt()
  @Min(1)
  @Max(20)
  @Type(() => Number)
  pageSize: number = 15;

  @ApiProperty({
    description: 'Search query',
    required: false,
    type: 'string',
  })
  @IsOptional()
  @IsString()
  search: string = '';
}
