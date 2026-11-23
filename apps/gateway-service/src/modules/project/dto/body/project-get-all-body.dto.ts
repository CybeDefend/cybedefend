import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class ProjectGetAllBodyDto {
  @ApiProperty({
    description: 'Page number',
    minimum: 1,
    type: 'number',
    example: 1,
  })
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page: number = 1;

  @ApiProperty({
    description: 'Number of items per page',
    minimum: 1,
    maximum: 10,
    type: 'number',
    example: 10,
  })
  @IsInt()
  @Min(1)
  @Max(10)
  @Type(() => Number)
  pageSize: number = 10;

  @ApiProperty({ description: 'Search query', required: false, type: 'string' })
  @IsOptional()
  @IsString()
  search: string = '';
}
