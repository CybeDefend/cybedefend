import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  IsNumber,
  IsBoolean,
  IsArray,
  Min,
  IsIn,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';

export class GetGroupedVulnerabilitiesBodyDto {
  @ApiPropertyOptional({
    description: 'Page number',
    example: 1,
    default: 1,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  page?: number = 1;

  @ApiPropertyOptional({
    description: 'Page size',
    example: 10,
    default: 10,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  perPage?: number = 10;

  @ApiPropertyOptional({
    description: 'Sort field',
    example: 'occurrenceCount',
    default: 'occurrenceCount',
    enum: [
      'occurrenceCount',
      'highestSeverity',
      'lastSeen',
      'currentSeverity',
      'currentPriority',
      'priorityScore',
      'createdAt',
    ],
  })
  @IsOptional()
  @IsString()
  sort?: string = 'occurrenceCount';

  @ApiPropertyOptional({
    description: 'Sort order',
    example: 'DESC',
    default: 'DESC',
    enum: ['ASC', 'DESC', 'asc', 'desc'],
  })
  @IsOptional()
  @IsString()
  order?: string = 'DESC';

  @ApiPropertyOptional({
    description:
      'Filter by severity (repeat the param for multiple values, e.g. severityFilter=critical&severityFilter=high)',
    isArray: true,
    enum: ['critical', 'high', 'medium', 'low'],
    name: 'severityFilter',
    type: 'string',
  })
  @IsOptional()
  @Transform(({ value }) =>
    Array.isArray(value) ? value : value ? [value] : [],
  )
  @IsArray()
  @IsString({ each: true })
  @IsIn(['critical', 'high', 'medium', 'low'], { each: true })
  severityFilter?: string[];

  @ApiPropertyOptional({
    description:
      'Filter by status (repeat the param for multiple values, e.g. statusFilter=to_verify&statusFilter=confirmed)',
    isArray: true,
    enum: ['to_verify', 'resolved', 'confirmed', 'ignored'],
    name: 'statusFilter',
    type: 'string',
  })
  @IsOptional()
  @Transform(({ value }) =>
    Array.isArray(value) ? value : value ? [value] : [],
  )
  @IsArray()
  @IsString({ each: true })
  @IsIn(['to_verify', 'resolved', 'confirmed', 'ignored'], { each: true })
  statusFilter?: string[];

  @ApiPropertyOptional({
    description:
      'Filter by priority (repeat the param for multiple values, e.g. priorityFilter=critical_urgent&priorityFilter=urgent)',
    isArray: true,
    enum: ['critical_urgent', 'urgent', 'normal', 'low', 'very_low'],
    name: 'priorityFilter',
    type: 'string',
  })
  @IsOptional()
  @Transform(({ value }) =>
    Array.isArray(value) ? value : value ? [value] : [],
  )
  @IsArray()
  @IsString({ each: true })
  @IsIn(['critical_urgent', 'urgent', 'normal', 'low', 'very_low'], {
    each: true,
  })
  priorityFilter?: string[];

  @ApiPropertyOptional({
    description: 'Search query',
    example: 'SQL Injection',
  })
  @IsOptional()
  @IsString()
  searchQuery?: string;

  @ApiPropertyOptional({
    description:
      'Filter by programming language (repeat the param for multiple values, e.g. languageFilter=python&languageFilter=java)',
    isArray: true,
    name: 'languageFilter',
    type: 'string',
  })
  @IsOptional()
  @Transform(({ value }) =>
    Array.isArray(value) ? value : value ? [value] : [],
  )
  @IsArray()
  @IsString({ each: true })
  languageFilter?: string[];

  @ApiPropertyOptional({
    description:
      'Filter by file path (substring "contains" match, e.g. sourcePath=src/auth)',
    example: 'src/auth',
  })
  @IsOptional()
  @IsString()
  sourcePath?: string;

  @ApiPropertyOptional({
    description: 'Filter by branch',
    example: 'main',
  })
  @IsOptional()
  @IsString()
  branch?: string;

  @ApiPropertyOptional({
    description:
      'Filter by autofix availability: true = only with autofix, false = only without autofix, omit = all',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  hasAutofix?: boolean;

  @ApiPropertyOptional({
    description:
      'Filter by source (repeat the param for multiple values, e.g. sourceFilter=head&sourceFilter=history)',
    isArray: true,
    enum: ['head', 'history'],
    name: 'sourceFilter',
    type: 'string',
  })
  @IsOptional()
  @Transform(({ value }) =>
    Array.isArray(value) ? value : value ? [value] : [],
  )
  @IsArray()
  @IsString({ each: true })
  @IsIn(['head', 'history'], { each: true })
  sourceFilter?: string[];

  @ApiPropertyOptional({
    description:
      'Filter by scoring source: "static" (deterministic) or "agent" (LLM-produced). Omit for both.',
    enum: ['static', 'agent'],
  })
  @IsOptional()
  @IsString()
  @IsIn(['static', 'agent'])
  scoringSource?: 'static' | 'agent';

  @ApiPropertyOptional({
    description:
      'Malware separation. Unset/false => exclude malware; true => only malware (the Malware sub-tab).',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
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

export class GetGroupedScaVulnerabilitiesBodyDto extends GetGroupedVulnerabilitiesBodyDto {
  @ApiPropertyOptional({
    description: 'Sort field',
    example: 'occurrenceCount',
    default: 'occurrenceCount',
    enum: [
      'occurrenceCount',
      'highestSeverity',
      'lastSeen',
      'currentSeverity',
      'currentPriority',
      'priorityScore',
      'createdAt',
      'highestCvss',
      'currentCVSS',
    ],
  })
  @IsOptional()
  @IsString()
  override sort?: string = 'occurrenceCount';

  @ApiPropertyOptional({
    description:
      'Filter by package type (repeat the param for multiple values, e.g. packageManagerFilter=dev&packageManagerFilter=direct)',
    isArray: true,
    enum: ['dev', 'direct', 'transitive'],
    name: 'packageManagerFilter',
    type: 'string',
  })
  @IsOptional()
  @Transform(({ value }) =>
    Array.isArray(value) ? value : value ? [value] : [],
  )
  @IsArray()
  @IsString({ each: true })
  @IsIn(['dev', 'direct', 'transitive'], { each: true })
  packageManagerFilter?: string[];

  @ApiPropertyOptional({
    description:
      'Filter by package manager / ecosystem (repeat the param, e.g. packageManager=npm&packageManager=maven)',
    isArray: true,
    name: 'packageManager',
    type: 'string',
  })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.split(',') : value,
  )
  @IsArray()
  @IsString({ each: true })
  packageManager?: string[];

  @ApiPropertyOptional({
    description:
      'Filter by package source / manifest file (repeat the param, e.g. packageSource=package.json)',
    isArray: true,
    name: 'packageSource',
    type: 'string',
  })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.split(',') : value,
  )
  @IsArray()
  @IsString({ each: true })
  packageSource?: string[];

  @ApiPropertyOptional({
    description:
      'Filter by exploitability verdict (repeat the param, e.g. exploitabilityVerdict=proven&exploitabilityVerdict=actively_exploited)',
    isArray: true,
    enum: [
      'not_exploitable',
      'theoretical',
      'proven',
      'actively_exploited',
      'not_evaluated',
    ],
    name: 'exploitabilityVerdict',
    type: 'string',
  })
  @IsOptional()
  @Transform(({ value }) =>
    Array.isArray(value) ? value : value ? [value] : [],
  )
  @IsArray()
  @IsString({ each: true })
  @IsIn(
    [
      'not_exploitable',
      'theoretical',
      'proven',
      'actively_exploited',
      'not_evaluated',
    ],
    { each: true },
  )
  exploitabilityVerdict?: string[];
}
