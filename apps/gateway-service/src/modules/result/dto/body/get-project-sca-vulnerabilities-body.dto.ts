// src/global-management/vulnerability/body/get-project-sca-vulnerabilities-request.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class GetProjectScaVulnerabilitiesBodyDto {
  @ApiProperty({ description: 'Search query', required: false, type: 'string' })
  @IsString()
  @IsOptional()
  query: string;

  @ApiProperty({ description: 'Page number', required: false, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page: number;

  @ApiProperty({
    description: 'Number of items per page',
    required: false,
    minimum: 10,
    maximum: 100,
  })
  @Type(() => Number)
  @IsInt()
  @Min(10)
  @Max(100)
  @IsOptional()
  limit: number;

  @ApiProperty({
    description: 'Sort field',
    required: false,
    enum: [
      'currentState',
      'currentSeverity',
      'currentPriority',
      'priorityScore',
      'createdAt',
      'updatedAt',
      'currentCVSS',
    ],
  })
  @IsString()
  @IsOptional()
  @IsIn([
    'currentState',
    'currentSeverity',
    'currentPriority',
    'priorityScore',
    'createdAt',
    'updatedAt',
    'currentCVSS',
  ])
  sort: string;

  @ApiProperty({
    description: 'Sort order',
    required: false,
    enum: ['asc', 'desc'],
  })
  @IsString()
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order: string;

  @ApiProperty({
    description: 'Filter by severity',
    required: false,
    isArray: true,
    enum: ['critical', 'high', 'medium', 'low'],
  })
  @IsArray()
  @IsOptional()
  @IsIn(['critical', 'high', 'medium', 'low'], { each: true })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.split(',') : value,
  )
  severity: string[];

  @ApiProperty({
    description: 'Filter by status',
    required: false,
    isArray: true,
    enum: ['to_verify', 'resolved', 'confirmed', 'ignored'],
  })
  @IsArray()
  @IsOptional()
  @IsIn(['to_verify', 'resolved', 'confirmed', 'ignored'], { each: true })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.split(',') : value,
  )
  status: string[];

  @ApiProperty({ description: 'Programming language', required: false })
  @IsString()
  @IsOptional()
  language: string;

  @ApiProperty({
    description: 'Filter by priority',
    required: false,
    isArray: true,
    enum: ['critical_urgent', 'urgent', 'normal', 'low', 'very_low'],
  })
  @IsArray()
  @IsOptional()
  @IsIn(['critical_urgent', 'urgent', 'normal', 'low', 'very_low'], {
    each: true,
  })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.split(',') : value,
  )
  priority: string[];

  @ApiProperty({
    description: 'Filter by package type',
    required: false,
    isArray: true,
    enum: ['direct', 'dev', 'transitive'],
  })
  @IsArray()
  @IsOptional()
  @IsIn(['direct', 'dev', 'transitive'], { each: true })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.split(',') : value,
  )
  packageType: string[];

  @ApiProperty({
    description:
      'Filter by package manager (ecosystem: npm, maven, pip, go...)',
    required: false,
    isArray: true,
  })
  @IsArray()
  @IsOptional()
  @IsString({ each: true })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.split(',') : value,
  )
  packageManager?: string[];

  @ApiProperty({
    description:
      'Filter by package source (manifest file: package.json, pom.xml...)',
    required: false,
    isArray: true,
  })
  @IsArray()
  @IsOptional()
  @IsString({ each: true })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.split(',') : value,
  )
  packageSource?: string[];

  @ApiProperty({
    description: 'Page number alias',
    required: false,
    minimum: 1,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  pageNumber: number;

  @ApiProperty({ description: 'Page size alias', required: false, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  pageSizeNumber: number;

  @ApiProperty({
    description: 'Search query alias',
    required: false,
    type: 'string',
  })
  @IsString()
  @IsOptional()
  searchQuery: string;

  @ApiProperty({
    description: 'Filter by branch name (e.g. main, develop, feature/xyz)',
    required: false,
    type: 'string',
  })
  @IsString()
  @IsOptional()
  branch?: string;

  @ApiProperty({
    description:
      'Filter by autofix status: true = only with autofix, false = only without autofix, omit = all',
    required: false,
    type: 'boolean',
  })
  @IsOptional()
  hasAutofix?: boolean;

  @ApiProperty({
    description:
      'Filter by exploitability verdict (repeat the param, e.g. exploitabilityVerdict=proven&exploitabilityVerdict=actively_exploited)',
    required: false,
    isArray: true,
    enum: ['not_exploitable', 'theoretical', 'proven', 'actively_exploited'],
    name: 'exploitabilityVerdict',
    type: 'string',
  })
  @IsOptional()
  @Transform(({ value }) => (Array.isArray(value) ? value : [value]))
  @IsArray()
  @IsString({ each: true })
  @IsIn(['not_exploitable', 'theoretical', 'proven', 'actively_exploited'], {
    each: true,
  })
  exploitabilityVerdict?: string[];

  @ApiPropertyOptional({
    description:
      'Filter by scoring source: "static" (deterministic scorer) or "agent" (LLM-produced)',
    enum: ['static', 'agent'],
  })
  @IsOptional()
  @IsIn(['static', 'agent'])
  scoringSource?: 'static' | 'agent';

  @ApiPropertyOptional({
    description:
      'Malware separation. Unset/false => exclude malware (the normal Vulnerabilities list); true => return ONLY malware (the Malware sub-tab).',
    type: 'boolean',
  })
  @IsOptional()
  malwareOnly?: boolean;

  // Documentation only: the controller reads the raw query
  // value and parses it like hasAutofix, so 'false' stays false.
  @ApiPropertyOptional({
    description:
      'Leave the autofix statistics (autofixCountByType) out of the response, which makes the request faster. Default: false.',
    type: 'boolean',
  })
  @IsOptional()
  excludeAutofixCounts?: string;
}
