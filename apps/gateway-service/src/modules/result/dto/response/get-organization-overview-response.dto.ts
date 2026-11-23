import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsInt, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { TotalByAnalysisTypeDto } from './get-project-overview-response.dto';

/**
 * Summary of vulnerability statistics for a single project.
 */
export class ProjectOverviewSummaryDto {
  @ApiProperty({ description: 'Unique project identifier', type: 'string' })
  @IsString()
  projectId: string;

  @ApiProperty({ description: 'Project name', type: 'string' })
  @IsString()
  projectName: string;

  @ApiProperty({ description: 'Team identifier', type: 'string' })
  @IsString()
  teamId: string;

  @ApiProperty({ description: 'Team name', type: 'string' })
  @IsString()
  teamName: string;

  @ApiProperty({
    description:
      'CybeRisk level of the project (critical, high, medium, low, none). Derived from the unbounded CybeRisk score (sum of CVSS-based points, branch-scoped).',
    type: 'string',
  })
  @IsString()
  cyberRiskLevel: string;

  @ApiProperty({
    description:
      'CybeRisk score of the project — unbounded sum of CVSS-based points (not capped at 100).',
    type: 'number',
  })
  @IsInt()
  cyberRiskScore: number;

  @ApiProperty({
    description: 'Number of critical severity vulnerabilities',
    type: 'number',
  })
  @IsInt()
  criticalCount: number;

  @ApiProperty({
    description: 'Number of high severity vulnerabilities',
    type: 'number',
  })
  @IsInt()
  highCount: number;

  @ApiProperty({
    description: 'Number of medium severity vulnerabilities',
    type: 'number',
  })
  @IsInt()
  mediumCount: number;

  @ApiProperty({
    description: 'Number of low severity vulnerabilities',
    type: 'number',
  })
  @IsInt()
  lowCount: number;

  @ApiProperty({
    description: 'Total number of vulnerabilities in the project',
    type: 'number',
  })
  @IsInt()
  totalVulnerabilities: number;

  @ApiProperty({
    description: 'Number of SAST vulnerabilities',
    type: 'number',
  })
  @IsInt()
  sastCount: number;

  @ApiProperty({
    description: 'Number of SCA vulnerabilities',
    type: 'number',
  })
  @IsInt()
  scaCount: number;

  @ApiProperty({
    description: 'Number of IAC vulnerabilities',
    type: 'number',
  })
  @IsInt()
  iacCount: number;

  @ApiProperty({
    description: 'Number of Container vulnerabilities',
    type: 'number',
  })
  @IsInt()
  containerCount: number;
}

/**
 * Summary of vulnerability statistics for a team.
 */
export class TeamOverviewSummaryDto {
  @ApiProperty({ description: 'Team identifier', type: 'string' })
  @IsString()
  teamId: string;

  @ApiProperty({ description: 'Team name', type: 'string' })
  @IsString()
  teamName: string;

  @ApiProperty({
    description: 'Number of projects in the team',
    type: 'number',
  })
  @IsInt()
  projectCount: number;

  @ApiProperty({
    description: 'Number of critical severity vulnerabilities',
    type: 'number',
  })
  @IsInt()
  criticalCount: number;

  @ApiProperty({
    description: 'Number of high severity vulnerabilities',
    type: 'number',
  })
  @IsInt()
  highCount: number;

  @ApiProperty({
    description: 'Number of medium severity vulnerabilities',
    type: 'number',
  })
  @IsInt()
  mediumCount: number;

  @ApiProperty({
    description: 'Number of low severity vulnerabilities',
    type: 'number',
  })
  @IsInt()
  lowCount: number;

  @ApiProperty({
    description: 'Total number of vulnerabilities in the team',
    type: 'number',
  })
  @IsInt()
  totalVulnerabilities: number;

  @ApiProperty({
    description: 'Number of projects with critical risk level',
    type: 'number',
  })
  @IsInt()
  criticalRiskProjects: number;

  @ApiProperty({
    description: 'Number of projects with high risk level',
    type: 'number',
  })
  @IsInt()
  highRiskProjects: number;

  @ApiProperty({
    description: 'Number of projects with medium risk level',
    type: 'number',
  })
  @IsInt()
  mediumRiskProjects: number;

  @ApiProperty({
    description: 'Number of projects with low risk level',
    type: 'number',
  })
  @IsInt()
  lowRiskProjects: number;
}

/**
 * Top vulnerable project summary.
 */
export class TopVulnerableProjectDto {
  @ApiProperty({ description: 'Unique project identifier', type: 'string' })
  @IsString()
  projectId: string;

  @ApiProperty({ description: 'Project name', type: 'string' })
  @IsString()
  projectName: string;

  @ApiProperty({ description: 'Team name', type: 'string' })
  @IsString()
  teamName: string;

  @ApiProperty({
    description: 'Total number of vulnerabilities',
    type: 'number',
  })
  @IsInt()
  vulnerabilityCount: number;

  @ApiProperty({
    description: 'Number of critical severity vulnerabilities',
    type: 'number',
  })
  @IsInt()
  criticalCount: number;

  @ApiProperty({
    description: 'Number of high severity vulnerabilities',
    type: 'number',
  })
  @IsInt()
  highCount: number;

  @ApiProperty({
    description:
      'CybeRisk level of the project (critical, high, medium, low, none).',
    type: 'string',
  })
  @IsString()
  cyberRiskLevel: string;

  @ApiProperty({
    description:
      'CybeRisk score of the project — unbounded sum of CVSS-based points (not capped at 100).',
    type: 'number',
  })
  @IsInt()
  cyberRiskScore: number;

  @ApiProperty({
    description: 'Number of open vulnerabilities',
    type: 'number',
  })
  @IsInt()
  openCount: number;

  @ApiProperty({
    description: 'Number of new vulnerabilities in last 7 days',
    type: 'number',
  })
  @IsInt()
  newLast7Days: number;

  @ApiProperty({
    description: 'Team identifier',
    type: 'string',
    required: false,
  })
  @IsString()
  teamId?: string;
}

/**
 * Complete organization overview response.
 * Contains aggregated statistics across all projects in the organization.
 */
export class GetOrganizationOverviewResponseDto {
  @ApiProperty({ description: 'Organization identifier', type: 'string' })
  @IsString()
  organizationId: string;

  @ApiProperty({
    description: 'Total number of projects in the organization',
    type: 'number',
  })
  @IsInt()
  totalProjects: number;

  @ApiProperty({
    description: 'Total number of teams in the organization',
    type: 'number',
  })
  @IsInt()
  totalTeams: number;

  // totalBySeverity / totalByState / vulnerabilitiesOverTime moved to
  // the dedicated lazy endpoints (severity-distribution / state-distribution /
  // vulnerabilities-over-time) and are `reserved` in the proto — see
  // organization-distribution-response.dto.ts. They are no longer returned here.

  @ApiProperty({
    description: 'Aggregation of vulnerabilities grouped by analysis type',
    isArray: true,
    type: () => [TotalByAnalysisTypeDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TotalByAnalysisTypeDto)
  totalByAnalysisType: TotalByAnalysisTypeDto[];

  @ApiProperty({
    description: 'Summary statistics for each project',
    isArray: true,
    type: () => [ProjectOverviewSummaryDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProjectOverviewSummaryDto)
  projectsSummary: ProjectOverviewSummaryDto[];

  @ApiProperty({
    description: 'Summary statistics for each team',
    isArray: true,
    type: () => [TeamOverviewSummaryDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TeamOverviewSummaryDto)
  teamsSummary: TeamOverviewSummaryDto[];

  @ApiProperty({
    description: 'Top 10 most vulnerable projects',
    isArray: true,
    type: () => [TopVulnerableProjectDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TopVulnerableProjectDto)
  topVulnerableProjects: TopVulnerableProjectDto[];

  @ApiProperty({
    description: 'Number of projects with critical risk level',
    type: 'number',
  })
  @IsInt()
  criticalRiskProjects: number;

  @ApiProperty({
    description: 'Number of projects with high risk level',
    type: 'number',
  })
  @IsInt()
  highRiskProjects: number;

  @ApiProperty({
    description: 'Number of projects with medium risk level',
    type: 'number',
  })
  @IsInt()
  mediumRiskProjects: number;

  @ApiProperty({
    description: 'Number of projects with low or no risk level',
    type: 'number',
  })
  @IsInt()
  lowRiskProjects: number;

  @ApiProperty({
    description: 'Number of new issues discovered in the last 7 days',
    type: 'number',
  })
  @IsInt()
  newIssuesLast7Days: number;

  @ApiProperty({
    description: 'Number of issues resolved in the last 7 days',
    type: 'number',
  })
  @IsInt()
  solvedIssuesLast7Days: number;

  @ApiProperty({
    description: 'Total number of resolved issues',
    type: 'number',
  })
  @IsInt()
  solvedIssues: number;

  @ApiProperty({
    description: 'Total number of new issues (all time)',
    type: 'number',
  })
  @IsInt()
  newIssues: number;

  @ApiProperty({
    description: 'Total number of critical severity issues',
    type: 'number',
  })
  @IsInt()
  criticalIssues: number;

  @ApiProperty({
    description: 'Total number of high severity issues',
    type: 'number',
  })
  @IsInt()
  highIssues: number;

  @ApiProperty({
    description: 'Total number of medium severity issues',
    type: 'number',
  })
  @IsInt()
  mediumIssues: number;

  @ApiProperty({
    description: 'Total number of low severity issues',
    type: 'number',
  })
  @IsInt()
  lowIssues: number;
}
