import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Per-project branch selection for batch reports
 */
export class ProjectBranchSelectionBodyDto {
  @ApiProperty({
    description: 'Project ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsString()
  @IsUUID('4')
  projectId: string;

  @ApiProperty({
    description: 'Branch names to include for this project',
    example: ['main', 'develop'],
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  branches: string[];
}

/**
 * DTO for generating batch project report
 */
export class GenerateBatchReportBodyDto {
  @ApiProperty({
    description:
      'List of project IDs to include in the report. Cap of 50 entries to prevent abuse and per-project permission enumeration.',
    example: [
      '550e8400-e29b-41d4-a716-446655440000',
      '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
    ],
    type: [String],
    maxItems: 50,
  })
  @IsArray()
  @IsNotEmpty()
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  projectIds: string[];

  @ApiProperty({
    description:
      'Generate detailed report with full vulnerability descriptions',
    example: true,
    required: false,
    default: true,
  })
  @IsBoolean()
  @IsOptional()
  detailed?: boolean;

  @ApiProperty({
    description:
      'Branch filter mode: "all" includes all branches, "reference" includes only the reference branch of each project, "selected" includes only specified per-project branches',
    example: 'all',
    required: false,
    default: 'all',
    enum: ['all', 'reference', 'selected'],
  })
  @IsOptional()
  @IsString()
  @IsIn(['all', 'reference', 'selected'])
  branchFilter?: string;

  @ApiProperty({
    description:
      'Per-project branch selections when branchFilter is "selected"',
    required: false,
    type: [ProjectBranchSelectionBodyDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProjectBranchSelectionBodyDto)
  projectBranchSelections?: ProjectBranchSelectionBodyDto[];
}
