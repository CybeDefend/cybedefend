import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsIn, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

export interface ProjectBranchSelectionDto {
  projectId: string;
  branches: string[];
}

export class GenerateReportQueryDto {
  @ApiProperty({
    description: 'Whether to include detailed information in the report',
    required: false,
    type: String,
    example: 'true',
    enum: ['true', 'false'],
  })
  @IsOptional()
  @IsString()
  detailed?: string;

  @ApiProperty({
    description:
      'Branch filter mode: "all" includes all branches, "reference" includes only the reference branch of each project, "selected" includes only specified per-project branches',
    required: false,
    type: String,
    example: 'all',
    enum: ['all', 'reference', 'selected'],
  })
  @IsOptional()
  @IsString()
  @IsIn(['all', 'reference', 'selected'])
  branchFilter?: string;

  @ApiProperty({
    description:
      'JSON-encoded array of per-project branch selections. Format: [{"projectId":"uuid","branches":["main","dev"]}]',
    required: false,
    type: String,
    example:
      '[{"projectId":"550e8400-e29b-41d4-a716-446655440000","branches":["main"]}]',
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch {
        return [];
      }
    }
    return value;
  })
  projectBranchSelections?: ProjectBranchSelectionDto[];

  @ApiProperty({
    description:
      'Organization ID for license override lookups (used with license report type)',
    required: false,
    type: String,
    format: 'uuid',
  })
  @IsOptional()
  @IsString()
  organizationId?: string;

  @ApiPropertyOptional({
    description:
      'Filter by branch name. Empty/omitted = all branches (current behavior).',
    example: 'main',
  })
  @IsOptional()
  @IsString()
  @MaxLength(191)
  readonly branch?: string;
}
