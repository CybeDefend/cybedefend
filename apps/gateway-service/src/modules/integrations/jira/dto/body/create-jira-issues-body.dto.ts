import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class VulnerabilityInfoDto {
  @ApiProperty({ description: 'Vulnerability detection ID' })
  @IsString()
  @IsNotEmpty()
  vulnerabilityId: string;

  @ApiProperty({
    description: 'Scanner type: sast, sca, iac, container, secret',
  })
  @IsString()
  @IsNotEmpty()
  scannerType: string;

  @ApiProperty({ description: 'Severity level' })
  @IsString()
  @IsNotEmpty()
  severity: string;

  @ApiProperty({ description: 'Vulnerability name' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ description: 'Short description' })
  @IsString()
  @IsOptional()
  shortDescription?: string;

  @ApiPropertyOptional({ description: 'Detailed description' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ description: 'File path' })
  @IsString()
  @IsOptional()
  filePath?: string;

  @ApiPropertyOptional({ description: 'Start line number' })
  @IsNumber()
  @IsOptional()
  startLine?: number;

  @ApiPropertyOptional({ description: 'End line number' })
  @IsNumber()
  @IsOptional()
  endLine?: number;

  @ApiPropertyOptional({ description: 'CWE identifiers' })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  cwe?: string[];

  @ApiPropertyOptional({ description: 'OWASP Top 10 categories' })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  owaspTop10?: string[];

  @ApiPropertyOptional({ description: 'CVSS score' })
  @IsNumber()
  @IsOptional()
  cvssScore?: number;

  @ApiPropertyOptional({ description: 'Package name (SCA)' })
  @IsString()
  @IsOptional()
  packageName?: string;

  @ApiPropertyOptional({ description: 'Package version (SCA)' })
  @IsString()
  @IsOptional()
  packageVersion?: string;

  @ApiPropertyOptional({ description: 'Fixed version (SCA)' })
  @IsString()
  @IsOptional()
  fixedVersion?: string;

  @ApiPropertyOptional({ description: 'External vulnerability ID (e.g. CVE)' })
  @IsString()
  @IsOptional()
  externalId?: string;

  @ApiPropertyOptional({ description: 'CybeDefend URL for this vulnerability' })
  @IsString()
  @IsOptional()
  cybedefendUrl?: string;

  @ApiPropertyOptional({ description: 'Branch where detected' })
  @IsString()
  @IsOptional()
  branch?: string;
}

export class CreateJiraIssuesBodyDto {
  @ApiPropertyOptional({
    description: 'Scan ID (optional — used for deduplication)',
  })
  @IsString()
  @IsOptional()
  scanId?: string;

  @ApiProperty({
    description:
      'Issue creation mode: 1=per_vulnerability, 2=per_vulnerability_type, 3=per_file',
    example: 2,
  })
  @IsNumber()
  mode: number;

  @ApiProperty({
    description: 'Vulnerabilities to create issues for',
    type: [VulnerabilityInfoDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VulnerabilityInfoDto)
  vulnerabilities: VulnerabilityInfoDto[];

  @ApiProperty({ description: 'Base URL for CybeDefend links' })
  @IsString()
  @IsNotEmpty()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @Matches(
    /^https:\/\/(?!localhost|127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.)/,
    { message: 'cybedefendBaseUrl must be a public HTTPS URL' },
  )
  @MaxLength(2048)
  cybedefendBaseUrl: string;

  @ApiPropertyOptional({
    description: 'Override Jira project key (uses default if not specified)',
    example: 'TRI',
  })
  @IsString()
  @IsOptional()
  jiraProjectKey?: string;
}
