import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Project compliance summary for the CISO overview
 */
export class ProjectComplianceSummaryDto {
  @ApiProperty({
    description: 'Project ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  projectId: string;

  @ApiProperty({
    description: 'Project name',
    example: 'My Project',
  })
  projectName: string;

  @ApiProperty({
    description: 'Compliance status',
    enum: ['Compliant', 'Non-Compliant', 'Pending'],
    example: 'Compliant',
  })
  complianceStatus: string;

  @ApiProperty({
    description: 'Total number of violations',
    example: 10,
  })
  totalViolations: number;

  @ApiProperty({
    description: 'Number of BLOCK violations',
    example: 2,
  })
  blockedCount: number;

  @ApiProperty({
    description: 'Number of WARN violations',
    example: 8,
  })
  warnedCount: number;

  @ApiProperty({
    description: 'Number of applicable policies',
    example: 3,
  })
  applicablePoliciesCount: number;

  @ApiPropertyOptional({
    description: 'Last evaluation timestamp (ISO 8601)',
    example: '2024-01-15T10:30:00Z',
  })
  lastEvaluatedAt?: string;

  @ApiPropertyOptional({
    description: 'Last scan ID',
    example: '550e8400-e29b-41d4-a716-446655440001',
  })
  lastScanId?: string;

  @ApiProperty({
    description: 'Team IDs this project belongs to',
    type: [String],
    example: ['550e8400-e29b-41d4-a716-446655440002'],
  })
  teamIds: string[];
}

/**
 * Organization-wide compliance statistics
 */
export class OrganizationComplianceStatsDto {
  @ApiProperty({
    description: 'Total number of projects in the organization',
    example: 50,
  })
  totalProjects: number;

  @ApiProperty({
    description: 'Number of compliant projects',
    example: 40,
  })
  compliantProjects: number;

  @ApiProperty({
    description: 'Number of non-compliant projects',
    example: 5,
  })
  nonCompliantProjects: number;

  @ApiProperty({
    description: 'Number of pending projects (awaiting evaluation)',
    example: 5,
  })
  pendingProjects: number;

  @ApiProperty({
    description: 'Total violations across all projects',
    example: 150,
  })
  totalViolations: number;

  @ApiProperty({
    description: 'Total BLOCK violations',
    example: 30,
  })
  totalBlocked: number;

  @ApiProperty({
    description: 'Total WARN violations',
    example: 120,
  })
  totalWarned: number;

  @ApiProperty({
    description: 'Number of active policies in the organization',
    example: 5,
  })
  activePoliciesCount: number;

  @ApiProperty({
    description: 'Compliance rate percentage (0-100)',
    example: 88.89,
  })
  complianceRate: number;
}

/**
 * Violation breakdown by rule type for charts
 */
export class ViolationBreakdownDto {
  @ApiProperty({
    description: 'Rule type/name',
    example: 'Critical Severity Check',
  })
  ruleType: string;

  @ApiProperty({
    description: 'Total violations for this rule type',
    example: 25,
  })
  count: number;

  @ApiProperty({
    description: 'BLOCK violations for this rule type',
    example: 10,
  })
  blockedCount: number;

  @ApiProperty({
    description: 'WARN violations for this rule type',
    example: 15,
  })
  warnedCount: number;
}

/**
 * Compliance trend data point for time-series charts
 */
export class ComplianceTrendPointDto {
  @ApiProperty({
    description: 'Date (ISO 8601)',
    example: '2024-01-15T00:00:00Z',
  })
  date: string;

  @ApiProperty({
    description: 'Number of compliant projects on this day',
    example: 38,
  })
  compliantCount: number;

  @ApiProperty({
    description: 'Number of non-compliant projects on this day',
    example: 7,
  })
  nonCompliantCount: number;

  @ApiProperty({
    description: 'Number of pending projects on this day',
    example: 5,
  })
  pendingCount: number;

  @ApiProperty({
    description: 'Compliance rate percentage on this day',
    example: 84.44,
  })
  complianceRate: number;
}

/**
 * Complete organization compliance overview response for CISO dashboard
 */
export class OrganizationComplianceOverviewResponseDto {
  @ApiProperty({
    description: 'Organization-wide compliance statistics',
    type: OrganizationComplianceStatsDto,
  })
  stats: OrganizationComplianceStatsDto;

  @ApiProperty({
    description: 'List of projects with their compliance summary',
    type: [ProjectComplianceSummaryDto],
  })
  projects: ProjectComplianceSummaryDto[];

  @ApiProperty({
    description: 'Violation breakdown by rule type',
    type: [ViolationBreakdownDto],
  })
  violationBreakdown: ViolationBreakdownDto[];

  @ApiProperty({
    description: 'Compliance trend over time (last 30 days)',
    type: [ComplianceTrendPointDto],
  })
  trend: ComplianceTrendPointDto[];

  @ApiProperty({
    description: 'Total count of projects (for pagination)',
    example: 50,
  })
  total: number;

  @ApiProperty({
    description: 'Current page',
    example: 1,
  })
  page: number;

  @ApiProperty({
    description: 'Page size',
    example: 20,
  })
  pageSize: number;
}
