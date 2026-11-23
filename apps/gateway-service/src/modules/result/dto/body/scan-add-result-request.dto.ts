// src/global-management/vulnerability/body/code-structure.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';

export class CodeStructure {
  @ApiProperty({ description: 'Line number in the file', type: 'number' })
  @IsNumber()
  line: number;

  @ApiProperty({ description: 'Content of the line', type: 'string' })
  @IsString()
  content: string;

  toString(): string {
    return JSON.stringify(this);
  }
}

export class CodeSnippet {
  @ApiProperty({
    description: 'Line number where the vulnerability starts',
    type: 'number',
  })
  @IsInt()
  vulnerableStartLine: number;

  @ApiProperty({
    description: 'Line number where the vulnerability ends',
    type: 'number',
  })
  @IsInt()
  vulnerableEndLine: number;

  @ApiProperty({ description: 'Line number for snippet start', type: 'number' })
  @IsInt()
  startLine: number;

  @ApiProperty({ description: 'Line number for snippet end', type: 'number' })
  @IsInt()
  endLine: number;

  @ApiProperty({
    description: 'Lines of code in the snippet',
    isArray: true,
    type: () => [CodeStructure],
  })
  @IsArray()
  @ValidateNested({ each: true })
  code: CodeStructure[];

  @ApiProperty({
    description: 'Programming language of the snippet',
    type: 'string',
  })
  @IsString()
  language: string;

  @ApiProperty({ description: 'File path for the snippet', type: 'string' })
  @IsString()
  path: string;

  toString(): string {
    return JSON.stringify(this);
  }
}

export class DataFlowItem {
  @ApiProperty({
    description: 'Highlighted variable or function name',
    type: 'string',
  })
  @IsString()
  nameHighlight: string;

  @ApiProperty({
    description: 'Line number where the element is found',
    type: 'number',
  })
  @IsNumber()
  line: number;

  @ApiProperty({
    description: 'Lines of code surrounding the dataflow item',
    isArray: true,
    type: () => [CodeStructure],
  })
  @IsArray()
  @ValidateNested({ each: true })
  code: CodeStructure[];

  @ApiProperty({
    description: 'Programming language for this code snippet',
    type: 'string',
  })
  @IsString()
  language: string;

  @ApiProperty({ description: 'File path', type: 'string' })
  @IsString()
  path: string;

  @ApiProperty({
    description: 'Type of data flow step (e.g. source, sink)',
    type: 'string',
  })
  @IsString()
  type: string;

  @ApiProperty({
    description: 'Order of this item in the dataflow sequence',
    type: 'number',
  })
  @IsInt()
  order: number;

  toString(): string {
    return JSON.stringify(this);
  }
}

export class VulnerabilityDtoRequest {
  @ApiProperty({ description: 'Rule identifier', type: 'string' })
  @IsString()
  ruleId: string;

  @ApiProperty({ description: 'Programming language used', type: 'string' })
  @IsString()
  language: string;

  @ApiProperty({
    description: 'Associated CWE (if any)',
    required: false,
    isArray: true,
    type: 'string',
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  cwe: string[];

  @ApiProperty({
    description: 'Associated OWASP Top 10 categories',
    required: false,
    isArray: true,
    type: 'string',
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  owaspTop10: string[];

  @ApiProperty({ description: 'Vulnerability name', type: 'string' })
  @IsString()
  name: string;

  @ApiProperty({ description: 'Vulnerability description', type: 'string' })
  @IsString()
  description: string;

  @ApiProperty({ description: 'Severity level', type: 'string' })
  @IsString()
  severity: string;

  @ApiProperty({ description: 'Confidence level', type: 'string' })
  @IsString()
  confidence: string;

  @ApiProperty({ description: 'File path', type: 'string' })
  @IsString()
  path: string;

  @ApiProperty({ description: 'File hash', type: 'string' })
  @IsString()
  fileHash: string;

  @ApiProperty({
    description: 'Code snippet related to the vulnerability',
    type: () => CodeSnippet,
  })
  @ValidateNested()
  codeSnippet: CodeSnippet;

  @ApiProperty({
    description: 'Data flow steps leading to the vulnerability',
    required: false,
    isArray: true,
    type: () => [DataFlowItem],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @IsOptional()
  dataFlow: DataFlowItem[];

  public toString(): string {
    return JSON.stringify(this);
  }
}

export class ScanAddResultRequestDto {
  @ApiProperty({ description: 'Scan unique identifier', format: 'uuid' })
  @IsUUID()
  scanId: string;

  @ApiProperty({
    description: 'Project unique identifier',
    required: false,
    format: 'uuid',
  })
  @IsUUID()
  projectId: string;

  @ApiProperty({ description: 'Name of the scanner tool', type: 'string' })
  @IsString()
  scannerName: string;

  @ApiProperty({
    description: 'Docker image used for scanning',
    type: 'string',
  })
  @IsString()
  runningDockerImage: string;

  @ApiProperty({
    description: 'Version of the Docker image used for scanning',
    type: 'string',
  })
  @IsString()
  runningDockerImageVersion: string;

  @ApiProperty({
    description: 'Date and time when the scan started',
    format: 'date-time',
  })
  @IsDateString()
  startedAt: string;

  @ApiProperty({
    description: 'Date and time when the scan finished',
    format: 'date-time',
  })
  @IsDateString()
  finishedAt: string;

  @ApiProperty({
    description: 'Indicates if this is the last request for this scan',
    required: false,
    type: 'boolean',
  })
  @IsBoolean()
  @IsOptional()
  isLastRequest?: boolean;

  @ApiProperty({
    description: 'Type of the vulnerability (e.g., sast, sca, etc.)',
    required: false,
    type: 'string',
  })
  @IsString()
  @IsOptional()
  vulnerabilityType?: string;

  @ApiProperty({
    description: 'List of discovered vulnerabilities',
    isArray: true,
    type: () => [VulnerabilityDtoRequest],
  })
  @IsArray()
  @ValidateNested({ each: true })
  vulnerabilities: VulnerabilityDtoRequest[];

  constructor(
    projectId: string,
    scanId: string,
    scannerName: string,
    runningDockerImage: string,
    runningDockerImageVersion: string,
    startedAt: string,
    finishedAt: string,
    vulnerabilities: VulnerabilityDtoRequest[],
    isLastRequest?: boolean,
    vulnerabilityType?: string,
  ) {
    this.scanId = scanId;
    this.projectId = projectId;
    this.scannerName = scannerName;
    this.runningDockerImage = runningDockerImage;
    this.runningDockerImageVersion = runningDockerImageVersion;
    this.startedAt = startedAt;
    this.finishedAt = finishedAt;
    this.isLastRequest = isLastRequest;
    this.vulnerabilityType = vulnerabilityType;
    this.vulnerabilities = vulnerabilities;
  }

  public toString(): string {
    return JSON.stringify(this);
  }
}

export class LibraryDto {
  @ApiProperty({ description: 'Library name', type: 'string' })
  @IsString()
  name: string;

  @ApiProperty({ description: 'Library version', type: 'string' })
  @IsString()
  version: string;

  @ApiProperty({
    description: 'File where the library is declared',
    type: 'string',
  })
  @IsString()
  file: string;

  @ApiProperty({
    description: 'Ecosystem type (npm, maven, etc.)',
    type: 'string',
  })
  @IsString()
  ecosystem: string;

  @IsArray()
  path: string[];

  @IsBoolean()
  isTransitive: boolean;

  @IsBoolean()
  isDev: boolean;

  @ApiProperty({
    description:
      'Indicates if dependency info (isDev/isTransitive) is available from the scanner',
    type: 'boolean',
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  dependencyInfoAvailable?: boolean;

  constructor(
    name: string,
    version: string,
    file: string,
    ecosystem: string,
    path: string[],
    isTransitive?: boolean,
    isDev?: boolean,
    dependencyInfoAvailable?: boolean,
  ) {
    this.name = name;
    this.version = version;
    this.file = file;
    this.ecosystem = ecosystem;
    this.path = path;
    this.isTransitive = isTransitive || false;
    this.isDev = isDev || false;
    this.dependencyInfoAvailable = dependencyInfoAvailable;
  }

  public toString(): string {
    return JSON.stringify(this);
  }
}
