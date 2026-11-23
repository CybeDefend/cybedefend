import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class GetProjectVulnerabilitiesBodyDto {
  @ApiProperty({
    description: 'Sort field',
    required: false,
    enum: [
      'currentState',
      'currentSeverity',
      'currentPriority',
      'priorityScore',
      'language',
      'createdAt',
      'updateAt',
    ],
  })
  @IsString()
  @IsOptional()
  @IsIn([
    'currentState',
    'currentSeverity',
    'currentPriority',
    'priorityScore',
    'language',
    'createdAt',
    'updateAt',
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
    description:
      'Filter by severity (repeat the param for multiple values, e.g. severity=critical&severity=high)',
    required: false,
    isArray: true,
    enum: ['critical', 'high', 'medium', 'low'],
    name: 'severity',
    type: 'string',
  })
  @IsOptional()
  @IsOptional()
  @Transform(({ value }) => (Array.isArray(value) ? value : [value]))
  @IsArray()
  @IsString({ each: true })
  @IsIn(['critical', 'high', 'medium', 'low'], { each: true })
  severity: string[];

  @ApiProperty({
    description:
      'Filter by status (repeat the param, e.g. status=to_verify&status=confirmed)',
    required: false,
    isArray: true,
    enum: ['to_verify', 'resolved', 'confirmed', 'ignored'],
    name: 'status',
    type: 'string',
  })
  @IsOptional()
  @Transform(({ value }) => (Array.isArray(value) ? value : [value]))
  @IsArray()
  @IsString({ each: true })
  @IsIn(['to_verify', 'resolved', 'confirmed', 'ignored'], {
    each: true,
  })
  status: string[];

  @ApiProperty({
    description:
      'Filter by priority (repeat the param, e.g. priority=critical_urgent&priority=urgent)',
    required: false,
    isArray: true,
    enum: ['critical_urgent', 'urgent', 'normal', 'low', 'very_low'],
    name: 'priority',
    type: 'string',
  })
  @IsOptional()
  @Transform(({ value }) => (Array.isArray(value) ? value : [value]))
  @IsArray()
  @IsString({ each: true })
  @IsIn(['critical_urgent', 'urgent', 'normal', 'low', 'very_low'], {
    each: true,
  })
  priority: string[];

  @ApiProperty({
    description:
      'Filter by programming language (repeat the param for multiple values, e.g. language=python&language=java)',
    required: false,
    isArray: true,
    name: 'language',
    type: 'string',
  })
  @IsOptional()
  @Transform(({ value }) =>
    Array.isArray(value) ? value : value ? [value] : [],
  )
  @IsArray()
  @IsString({ each: true })
  language: string[];

  @ApiPropertyOptional({
    description:
      'Filter by file path (substring "contains" match, e.g. sourcePath=src/auth)',
    type: 'string',
  })
  @IsString()
  @IsOptional()
  sourcePath?: string;

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

  @ApiProperty({
    description: 'Page size alias',
    required: false,
    minimum: 1,
  })
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

  // Documentation only: the controller reads the raw query
  // value and parses it like hasAutofix, so 'false' stays false.
  @ApiPropertyOptional({
    description:
      'Leave the autofix statistics (autofixCountByType) out of the response, which makes the request faster. Default: false.',
    type: 'boolean',
  })
  @IsOptional()
  excludeAutofixCounts?: string;

  constructor(
    sort: string,
    order: string,
    severity: string[],
    status: string[],
    priority: string[],
    language: string[],
    pageNumber: number,
    pageSizeNumber: number,
    searchQuery: string,
  ) {
    this.sort = sort;
    this.order = order;
    this.severity = severity;
    this.status = status;
    this.priority = priority;
    this.language = language;
    this.pageNumber = pageNumber;
    this.pageSizeNumber = pageSizeNumber;
    this.searchQuery = searchQuery;
  }
}
