import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsNumber,
  Min,
  Max,
  IsString,
  IsIn,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class GetGroupedContainerImagesQueryDto {
  @ApiPropertyOptional({
    description: 'Page number (starts from 1)',
    example: 1,
    minimum: 1,
  })
  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsNumber()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    description: 'Number of items per page',
    example: 20,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({
    description: 'Branch name to filter container images',
    example: 'main',
  })
  @IsOptional()
  @IsString()
  branch?: string;

  @ApiPropertyOptional({
    description: 'Sort field',
    example: 'latestScanAt',
    enum: ['repositoryName', 'tagCount', 'latestScanAt'],
  })
  @IsOptional()
  @IsString()
  @IsIn(['repositoryName', 'tagCount', 'latestScanAt'])
  sort?: string;

  @ApiPropertyOptional({
    description: 'Sort order',
    example: 'DESC',
    enum: ['ASC', 'DESC'],
  })
  @IsOptional()
  @IsString()
  @IsIn(['ASC', 'DESC'])
  order?: string;

  @ApiPropertyOptional({
    description: 'Search query for repository name',
    example: 'nginx',
  })
  @IsOptional()
  @IsString()
  searchQuery?: string;
}
