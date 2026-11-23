import { ApiProperty } from '@nestjs/swagger';
import {
  TotalBySeverityDto,
  TotalByStateDto,
  VulnerabilitiesOverTimeDto,
} from './get-project-overview-response.dto';

export class OrganizationSeverityDistributionResponseDto {
  @ApiProperty({ type: [TotalBySeverityDto] })
  totalBySeverity: TotalBySeverityDto[];
}

export class OrganizationStateDistributionResponseDto {
  @ApiProperty({ type: [TotalByStateDto] })
  totalByState: TotalByStateDto[];
}

export class PeriodComparisonDto {
  @ApiProperty() currentPeriodCount: number;
  @ApiProperty() previousPeriodCount: number;
  @ApiProperty() changePercentage: number;
  @ApiProperty() trend: string;
}

export class SeverityComparisonDto {
  @ApiProperty() severity: string;
  @ApiProperty({ type: PeriodComparisonDto }) comparison: PeriodComparisonDto;
}

export class OrganizationVulnerabilitiesOverTimeResponseDto {
  @ApiProperty({ type: [VulnerabilitiesOverTimeDto] })
  vulnerabilitiesOverTime: VulnerabilitiesOverTimeDto[];
  @ApiProperty({ type: [SeverityComparisonDto], required: false })
  severityComparison?: SeverityComparisonDto[];
  @ApiProperty({ type: PeriodComparisonDto, required: false })
  totalComparison?: PeriodComparisonDto;
}
