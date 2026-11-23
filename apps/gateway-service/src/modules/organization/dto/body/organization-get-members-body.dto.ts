import { ApiProperty } from '@nestjs/swagger';
import {
  IsInt,
  Min,
  Max,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class OrganizationGetMembersBodyDto {
  @ApiProperty({
    description: 'Page number',
    required: true,
    type: 'number',
    minimum: 1,
  })
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page: number = 1;

  @ApiProperty({
    description: 'Number of items per page',
    required: true,
    type: 'number',
    minimum: 1,
    maximum: 20,
  })
  @IsInt()
  @Min(1)
  @Max(20)
  @Type(() => Number)
  pageSize: number = 15;

  @ApiProperty({ description: 'Search query', required: false, type: 'string' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search: string = '';
}
