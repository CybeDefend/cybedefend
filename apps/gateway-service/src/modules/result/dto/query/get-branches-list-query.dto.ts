import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

/**
 * Query parameters for the unified paginated branch list endpoint
 * (GET /project/:projectId/branches/list).
 *
 * The endpoint is routed server-side by the project's provider
 * (GitHub / GitLab / native scans), so a single contract serves all three.
 */
export class GetBranchesListQueryDto {
  @ApiPropertyOptional({
    description: 'Case-insensitive substring match on branch name',
    example: 'feature',
  })
  @IsOptional()
  @IsString()
  search?: string = '';

  @ApiPropertyOptional({
    description: 'Page number (starts from 1)',
    example: 1,
    default: 1,
    minimum: 1,
  })
  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    description: 'Number of items per page',
    example: 30,
    default: 30,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsNumber()
  @Min(1)
  @Max(100)
  pageSize?: number = 30;

  @ApiPropertyOptional({
    description: 'Include archived branches in the result',
    example: false,
    default: false,
  })
  @IsOptional()
  // @Type(() => String) prevents class-transformer's implicit boolean coercion
  // (which would turn the string 'false' into true) when the global
  // ValidationPipe is configured with enableImplicitConversion: true.
  // The explicit @Transform then handles the string → boolean conversion.
  @Type(() => String)
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  includeArchived?: boolean = false;
}
