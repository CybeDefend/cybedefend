import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

/**
 * CybeRisk Score DTOs exposed by gateway.
 *
 * Mirrors the proto `CyberRiskScore` from analysis-reporting. The breakdown
 * is `optional` because listing endpoints (org projects page) omit it to keep
 * responses small; the project detail endpoint always populates it.
 */

export class CyberRiskScanTypeContributionDto {
  @ApiProperty() @IsInt() critical: number;
  @ApiProperty() @IsInt() high: number;
  @ApiProperty() @IsInt() medium: number;
  @ApiProperty() @IsInt() low: number;
  @ApiProperty({
    description: 'Sum of CVSS-based points contributed by this scan type.',
  })
  @IsNumber()
  weightedScore: number;

  @ApiProperty({
    description:
      'Deprecated: reachability no longer feeds the score. Always 0.',
  })
  @IsNumber()
  avgReachabilityFactor: number;
}

export class CyberRiskTopContributorDto {
  @ApiProperty() @IsString() vulnerabilityId: string;
  @ApiProperty({
    description:
      'Scan type discriminator: SAST | SCA | IAC | CICD | CONTAINER | SECRET.',
  })
  @IsString()
  scanType: string;

  @ApiProperty({ description: 'critical | high | medium | low' })
  @IsString()
  severity: string;

  @ApiProperty({
    description:
      'SCA only: used | test_only | potentially_used | unused | unknown. Empty for other scan types.',
  })
  @IsString()
  reachability: string;

  @ApiProperty({
    description:
      'SAST/IaC/CICD: not_exploitable | theoretical | proven | actively_exploited. Empty for SCA.',
  })
  @IsString()
  exploitabilityVerdict: string;

  @ApiProperty({
    description: 'CVSS-based points contributed by this single vulnerability.',
  })
  @IsNumber()
  contribution: number;
}

export class CyberRiskBusinessContextDto {
  @ApiProperty() @IsString() businessCriticality: string;
  @ApiProperty() @IsBoolean() handlesPii: boolean;
  @ApiProperty() @IsBoolean() handlesPaymentData: boolean;
  @ApiProperty() @IsBoolean() safetyCritical: boolean;
  @ApiProperty() @IsString() dataClassification: string;
}

export class CyberRiskExposureContextDto {
  @ApiProperty() @IsString() internetExposure: string;
  @ApiProperty() @IsString() environment: string;
  @ApiProperty() @IsString() deploymentType: string;
}

export class CyberRiskBreakdownDto {
  @ApiProperty({
    description:
      'Sum of CVSS-based points across active vulns — equal to the final score.',
  })
  @IsNumber()
  base: number;

  @ApiProperty({
    description:
      'Deprecated: business/exposure multipliers were removed and are always 1.',
  })
  @IsNumber()
  businessMultiplier: number;

  @ApiProperty({
    description: 'Deprecated: see businessMultiplier. Always 1.',
  })
  @IsNumber()
  exposureMultiplier: number;

  @ApiProperty({
    description: 'Per-scan-type contribution to the score.',
    type: 'object',
    additionalProperties: { type: 'object' },
  })
  byScanType: { [key: string]: CyberRiskScanTypeContributionDto };

  @ApiProperty({
    description: 'Top contributing vulnerabilities (max 5), descending.',
    type: () => [CyberRiskTopContributorDto],
  })
  @ValidateNested({ each: true })
  @Type(() => CyberRiskTopContributorDto)
  topContributors: CyberRiskTopContributorDto[];

  @ApiProperty({
    type: () => CyberRiskBusinessContextDto,
    required: false,
    description:
      'Deprecated: no longer populated by analysis-reporting; omitted from the breakdown.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => CyberRiskBusinessContextDto)
  businessContext?: CyberRiskBusinessContextDto;

  @ApiProperty({
    type: () => CyberRiskExposureContextDto,
    required: false,
    description:
      'Deprecated: no longer populated by analysis-reporting; omitted from the breakdown.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => CyberRiskExposureContextDto)
  exposureContext?: CyberRiskExposureContextDto;
}

export class CyberRiskScoreDto {
  @ApiProperty({
    description:
      'Final score: unbounded non-negative integer (sum of CVSS-based points). Not capped at 100.',
  })
  @IsInt()
  score: number;

  @ApiProperty({
    description: 'critical | high | medium | low | none',
  })
  @IsString()
  level: string;

  @ApiProperty({
    description:
      'Per-component breakdown. Omitted in listing endpoints to keep payload small.',
    type: () => CyberRiskBreakdownDto,
    required: false,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => CyberRiskBreakdownDto)
  breakdown?: CyberRiskBreakdownDto;

  @ApiProperty({
    description:
      'ISO 8601 timestamp at which the persisted score was last (re)computed by the recompute worker.',
  })
  @IsString()
  computedAt: string;
}
