import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class GetProjectContainerVulnerabilitiesBodyDto {
  @ApiPropertyOptional() @IsOptional() @IsString() sort?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() order?: string;
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? [value] : value))
  severity?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? [value] : value))
  status?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? [value] : value))
  priority?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? [value] : value))
  classType?: string[];

  @ApiPropertyOptional({
    description: 'Filter results by a specific container image ID.',
    type: String,
    format: 'uuid',
  })
  imageId?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() searchQuery?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) page?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) limit?: number;

  @ApiPropertyOptional({
    description: 'Filter by branch name (e.g. main, develop, feature/xyz)',
  })
  @IsOptional()
  @IsString()
  branch?: string;

  @ApiPropertyOptional({
    description:
      'Filter by autofix status: true = only with autofix, false = only without autofix, omit = all',
    type: 'boolean',
  })
  @IsOptional()
  hasAutofix?: boolean;

  @ApiPropertyOptional({
    description:
      'Filter by exploitability verdict (repeat the param for multiple values)',
    type: [String],
    enum: ['not_exploitable', 'theoretical', 'proven', 'actively_exploited'],
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? [value] : value))
  exploitabilityVerdict?: string[];

  @ApiPropertyOptional({
    description:
      'Filter by scoring source: "static" (deterministic scorer) or "agent" (LLM-produced)',
    enum: ['static', 'agent'],
  })
  @IsOptional()
  @IsIn(['static', 'agent'])
  scoringSource?: 'static' | 'agent';
}
