// src/global-management/vulnerability/response/total-by-severity.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsInt, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { CyberRiskScoreDto } from './cyber-risk-score.dto';

export class TotalBySeverityDto {
  @ApiProperty({ description: 'Severity level', type: 'string' })
  @IsString()
  severity: string;

  @ApiProperty({
    description: 'Number of vulnerabilities for the given severity',
    type: 'number',
  })
  @IsInt()
  count: number;
}

export class TotalByStateDto {
  @ApiProperty({ description: 'State of the vulnerability', type: 'string' })
  @IsString()
  state: string;

  @ApiProperty({
    description: 'Number of vulnerabilities for the given state',
    type: 'number',
  })
  @IsInt()
  count: number;
}

export class TotalByAnalysisTypeDto {
  @ApiProperty({
    description: 'Type of analysis (SAST, IAC, SCA, etc.)',
    type: 'string',
  })
  @IsString()
  analysisType: string;

  @ApiProperty({
    description: 'Number of vulnerabilities for the given analysis type',
    type: 'number',
  })
  @IsInt()
  count: number;
}

export class VulnerabilitiesOverTimeDto {
  @ApiProperty({ description: 'Date of the aggregation', type: 'string' })
  @IsString()
  date: string;

  @ApiProperty({
    description: 'Number of vulnerabilities for the given date',
    type: 'number',
  })
  @IsString()
  severity: string;

  @ApiProperty({
    description: 'Number of vulnerabilities for the given date',
    type: 'number',
  })
  @IsInt()
  count: number;
}

export class GetProjectOverviewResponseDto {
  @ApiProperty({
    description: 'Aggregation of vulnerabilities grouped by severity',
    isArray: true,
    type: () => [TotalBySeverityDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  totalBySeverity: TotalBySeverityDto[];

  @ApiProperty({
    description: 'Aggregation of vulnerabilities grouped by state',
    isArray: true,
    type: () => [TotalByStateDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  totalByState: TotalByStateDto[];

  @ApiProperty({
    description: 'Aggregation of vulnerabilities grouped by analysis type',
    isArray: true,
    type: () => [TotalByAnalysisTypeDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  totalByAnalysisType: TotalByAnalysisTypeDto[];

  @ApiProperty({
    description: 'Number of vulnerabilities over time grouped by severity',
    isArray: true,
    type: () => [VulnerabilitiesOverTimeDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  vulnerabilitiesOverTime: VulnerabilitiesOverTimeDto[];

  @ApiProperty({
    description:
      'CybeRisk score for the project. Unbounded sum of per-vuln CVSS-based points, branch-scoped and persisted. Returned with the full breakdown (per-scan-type contributions and top contributors).',
    type: () => CyberRiskScoreDto,
  })
  @ValidateNested()
  @Type(() => CyberRiskScoreDto)
  cyberRisk: CyberRiskScoreDto;

  constructor(partial?: Partial<GetProjectOverviewResponseDto>) {
    Object.assign(this, partial);
  }

  toString() {
    return JSON.stringify(this);
  }
}
