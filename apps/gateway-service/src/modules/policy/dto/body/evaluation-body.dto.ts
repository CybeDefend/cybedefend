import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsArray,
  IsUUID,
  IsNotEmpty,
  IsNumber,
  IsInt,
  ValidateNested,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';

export class VulnerabilityDto {
  @ApiProperty({ description: 'Vulnerability ID' })
  @IsString()
  @IsNotEmpty()
  id: string;

  @ApiProperty({ description: 'Vulnerability title' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({ description: 'Severity level' })
  @IsString()
  @IsNotEmpty()
  severity: string;

  @ApiPropertyOptional({ description: 'CWE ID' })
  @IsString()
  @IsOptional()
  cweId?: string;

  @ApiPropertyOptional({ description: 'CVSS Score (0-10)' })
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(10)
  cvssScore?: number;

  @ApiPropertyOptional({
    description: 'File path where vulnerability was found',
  })
  @IsString()
  @IsOptional()
  filePath?: string;

  @ApiPropertyOptional({ description: 'Line number in file' })
  @IsInt()
  @IsOptional()
  @Min(1)
  lineNumber?: number;

  @ApiPropertyOptional({ description: 'OWASP category' })
  @IsString()
  @IsOptional()
  owaspCategory?: string;
}

export class EvaluateScanBodyDto {
  @ApiProperty({
    description: 'Scan ID to evaluate',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsUUID()
  @IsNotEmpty()
  scanId: string;

  @ApiProperty({
    description: 'Project ID',
    example: '550e8400-e29b-41d4-a716-446655440001',
  })
  @IsUUID()
  @IsNotEmpty()
  projectId: string;

  @ApiPropertyOptional({
    description: 'Team ID for policy hierarchy',
    example: '550e8400-e29b-41d4-a716-446655440002',
  })
  @IsUUID()
  @IsOptional()
  teamId?: string;

  @ApiPropertyOptional({
    description: 'Organization ID for policy hierarchy',
    example: '550e8400-e29b-41d4-a716-446655440003',
  })
  @IsUUID()
  @IsOptional()
  organizationId?: string;

  @ApiProperty({
    description: 'Scanner type (sast, dast, secret, sca, container, iac)',
    example: 'sast',
  })
  @IsString()
  @IsNotEmpty()
  scannerType: string;

  @ApiProperty({
    description: 'List of vulnerabilities to evaluate',
    type: [VulnerabilityDto],
    example: [
      {
        id: 'vuln-1',
        title: 'SQL Injection',
        severity: 'critical',
        cweId: 'CWE-89',
        cvssScore: 9.8,
        filePath: 'src/controllers/user.ts',
        lineNumber: 42,
      },
    ],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VulnerabilityDto)
  vulnerabilities: VulnerabilityDto[];

  @ApiPropertyOptional({
    description: 'Previous scan ID for "new only" comparisons',
  })
  @IsUUID()
  @IsOptional()
  previousScanId?: string;
}

export class CheckComplianceBodyDto {
  @ApiProperty({
    description: 'Scan ID to check compliance for',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsUUID()
  @IsNotEmpty()
  scanId: string;

  @ApiProperty({
    description: 'Project ID',
    example: '550e8400-e29b-41d4-a716-446655440001',
  })
  @IsUUID()
  @IsNotEmpty()
  projectId: string;

  @ApiPropertyOptional({
    description: 'Team ID for policy hierarchy',
  })
  @IsUUID()
  @IsOptional()
  teamId?: string;

  @ApiPropertyOptional({
    description: 'Organization ID for policy hierarchy',
  })
  @IsUUID()
  @IsOptional()
  organizationId?: string;

  @ApiProperty({
    description: 'Scanner type',
    example: 'sast',
  })
  @IsString()
  @IsNotEmpty()
  scannerType: string;

  @ApiProperty({
    description: 'Vulnerabilities to check',
    type: [VulnerabilityDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VulnerabilityDto)
  vulnerabilities: VulnerabilityDto[];
}

/**
 * Scanner type enum matching the proto definition
 */
export enum ScannerTypeEnum {
  SAST = 'sast',
  SCA = 'sca',
  IAC = 'iac',
  CONTAINER = 'container',
  SECRET = 'secret',
  CICD = 'cicd',
}

/**
 * DTO for triggering async policy evaluation on a scan
 */
export class TriggerEvaluationBodyDto {
  @ApiProperty({
    description: 'Scanner type to evaluate policies for',
    enum: ScannerTypeEnum,
    example: ScannerTypeEnum.SAST,
  })
  @IsString()
  @IsNotEmpty()
  scannerType: ScannerTypeEnum;
}
