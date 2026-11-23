// src/global-management/vulnerability/response/count-vulnerabilities-count-by-type.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsDate,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class CountVulnerabilitiesCountByType {
  @ApiProperty({
    description: 'Number of SAST vulnerabilities',
    type: 'number',
  })
  @IsNotEmpty()
  @IsNumber()
  sast: number;

  @ApiProperty({ description: 'Number of IaC vulnerabilities', type: 'number' })
  @IsNotEmpty()
  @IsNumber()
  iac: number;

  @ApiProperty({ description: 'Number of SCA vulnerabilities', type: 'number' })
  @IsNotEmpty()
  @IsNumber()
  sca: number;

  @ApiProperty({
    description: 'Number of Container vulnerabilities',
    type: 'number',
  })
  @IsNotEmpty()
  @IsNumber()
  container: number;

  @ApiProperty({
    description: 'Number of CICD vulnerabilities',
    type: 'number',
  })
  @IsNotEmpty()
  @IsNumber()
  cicd: number;

  @ApiProperty({
    description: 'Number of Secret vulnerabilities',
    type: 'number',
  })
  @IsNotEmpty()
  @IsNumber()
  secret: number;

  @ApiProperty({
    description:
      'Number of AI-BOM components (EU AI Act Annex IV inventory). ' +
      'Counted on the merged Cisco + Trusera view.',
    type: 'number',
    required: false,
  })
  @IsOptional()
  @IsNumber()
  aibom?: number;
}

export class ScanProjectInfoDto {
  @ApiProperty({ description: 'Scan unique identifier', type: 'string' })
  @IsString()
  @IsNotEmpty()
  scanId: string;

  @ApiProperty({
    description: 'Scan state',
    enum: ['queued', 'running', 'completed', 'failed'],
  })
  @IsEnum(['queued', 'running', 'completed', 'failed'])
  state: string;

  @ApiProperty({
    description: 'Date when the scan was created',
    type: 'string',
    format: 'date-time',
  })
  @IsDate()
  createAt: Date;

  @ApiProperty({
    description: 'Type of the scan (optional)',
    required: false,
    type: 'string',
  })
  @IsOptional()
  @IsString()
  scanType?: string;

  constructor(
    scanId: string,
    state: string,
    createAt: Date,
    scanType?: string,
  ) {
    this.scanId = scanId;
    this.state = state;
    this.createAt = createAt;
    this.scanType = scanType;
  }

  public toString(): string {
    return JSON.stringify(this);
  }
}

export class GetProjectVulnerabilitiesResponseDto {
  @ApiProperty({ description: 'Project unique identifier', type: 'string' })
  @IsString()
  @IsNotEmpty()
  projectId: string;

  @ApiProperty({ description: 'Project name', type: 'string' })
  @IsString()
  @IsNotEmpty()
  projectName: string;

  @ApiProperty({
    description: 'Current page number',
    type: 'number',
    minimum: 1,
  })
  @IsInt()
  @Min(1)
  @IsNotEmpty()
  page: number;

  @ApiProperty({
    description: 'Number of items per page',
    type: 'number',
    minimum: 10,
    maximum: 25,
  })
  @IsInt()
  @Min(10)
  @Max(25)
  @IsNotEmpty()
  limit: number;

  @ApiProperty({ description: 'Total number of pages', type: 'number' })
  @IsNotEmpty()
  @IsNumber()
  totalPages: number;

  @ApiProperty({
    description: 'Field used for sorting',
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
    description: 'Order of sorting',
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
  severity: string[];

  @ApiProperty({
    description: 'Filter by vulnerability status',
    required: false,
    isArray: true,
    enum: ['to_verify', 'resolved', 'confirmed', 'ignored'],
  })
  @IsArray()
  @IsOptional()
  @IsIn(['to_verify', 'resolved', 'confirmed', 'ignored'], {
    each: true,
  })
  status: string[];

  @ApiProperty({
    description: 'Filter by programming language',
    required: false,
    type: 'string',
  })
  @IsString()
  @IsOptional()
  language: string;

  @ApiProperty({
    description: 'Filter by priority levels',
    required: false,
    isArray: true,
    enum: ['critical_urgent', 'urgent', 'normal', 'low', 'very_low'],
  })
  @IsArray()
  @IsOptional()
  @IsIn(['critical_urgent', 'urgent', 'normal', 'low', 'very_low'], {
    each: true,
  })
  priority: string[];

  @ApiProperty({
    type: [String],
    description:
      'Distinct languages present for this project/type (populates the language filter dropdown, independent of pagination and filters).',
  })
  @IsArray()
  languages: string[];

  @ApiProperty({
    description: 'List of vulnerabilities matching the filters',
    isArray: true,
    type: 'object',
    additionalProperties: true,
  })
  @IsArray()
  vulnerabilities: any[];

  @ApiProperty({
    description: 'Total number of vulnerabilities found',
    type: 'number',
  })
  @IsInt()
  total: number;

  @ApiProperty({
    description: 'Information about the ongoing or last scan',
    required: false,
    type: () => ScanProjectInfoDto,
  })
  @IsOptional()
  scanProjectInfo: ScanProjectInfoDto;

  @ApiProperty({
    description: 'Count of vulnerabilities grouped by type (SAST, SCA, IaC)',
    required: false,
    type: () => CountVulnerabilitiesCountByType,
  })
  @IsOptional()
  vulnCountByType: CountVulnerabilitiesCountByType;

  public toString(): string {
    return JSON.stringify(this);
  }
}
