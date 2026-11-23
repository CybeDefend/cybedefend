import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsNumber,
  Min,
  Max,
  IsString,
  IsArray,
  IsBoolean,
  IsIn,
} from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Query DTO for Organization Overview.
 *
 * This endpoint provides aggregated statistics for an entire organization.
 * Filters are designed for organization-level analysis, not project-specific views.
 *
 * Use Cases:
 * - Dashboard: Get global security posture of the organization
 * - Executive reporting: High-level vulnerability trends
 * - Team performance: Compare security metrics across teams
 * - Trend analysis: Track improvement over time
 */
export class GetOrganizationOverviewQueryDto {
  // ═══════════════════════════════════════════════════════════════════════════
  // VULNERABILITY FILTERS - Filter which vulnerabilities are counted in stats
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Filter by severity levels.
   * Use to focus on critical issues or get counts for specific severity levels.
   *
   * @example "CRITICAL,HIGH" - Only count critical and high severity vulnerabilities
   * @example "CRITICAL" - Only count critical vulnerabilities
   */
  @ApiPropertyOptional({
    description:
      'Filter vulnerabilities by severity levels. Only vulnerabilities matching these severities will be counted in all statistics.',
    example: 'CRITICAL,HIGH',
    type: String,
    enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'],
  })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((v) => v.trim().toUpperCase())
          .filter((v) => ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].includes(v))
      : value,
  )
  @IsArray()
  severityFilter?: string[];

  /**
   * Filter by vulnerability status.
   * Use to focus on open issues or see resolved issues.
   *
   * @example "to_verify,confirmed" - Only open vulnerabilities
   * @example "resolved" - Only resolved vulnerabilities
   */
  @ApiPropertyOptional({
    description:
      'Filter vulnerabilities by status. Affects all counts and statistics.',
    example: 'to_verify,confirmed',
    type: String,
    enum: [
      'to_verify',
      'confirmed',
      'in_review',
      'resolved',
      'not_exploitable',
      'ignored',
    ],
  })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((v) => v.trim().toLowerCase())
          .filter((v) =>
            [
              'to_verify',
              'confirmed',
              'in_review',
              'resolved',
              'not_exploitable',
              'ignored',
            ].includes(v),
          )
      : value,
  )
  @IsArray()
  statusFilter?: string[];

  /**
   * Filter by analysis type.
   * Use to focus on specific security analysis categories.
   *
   * @example "SAST,SCA" - Only SAST and SCA vulnerabilities
   * @example "SECRET" - Only secret detection findings
   */
  @ApiPropertyOptional({
    description:
      'Filter vulnerabilities by analysis type (security scanner category).',
    example: 'SAST,SCA',
    type: String,
    enum: ['SAST', 'SCA', 'IAC', 'CONTAINER', 'CICD', 'SECRET'],
  })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((v) => v.trim().toUpperCase())
          .filter((v) =>
            ['SAST', 'SCA', 'IAC', 'CONTAINER', 'CICD', 'SECRET'].includes(v),
          )
      : value,
  )
  @IsArray()
  analysisTypes?: string[];

  /**
   * Include resolved vulnerabilities in counts.
   * By default, only open vulnerabilities are counted.
   *
   * @default false
   */
  @ApiPropertyOptional({
    description:
      'Include resolved/closed vulnerabilities in all counts. Default: false (only open vulnerabilities).',
    example: false,
    default: false,
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  includeResolved?: boolean;

  // ═══════════════════════════════════════════════════════════════════════════
  // DATE RANGE FILTERS - Filter vulnerabilities by creation date
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Start date for vulnerability filtering.
   * Only vulnerabilities created on or after this date will be included.
   *
   * @example "2024-01-01T00:00:00Z" - From January 1st, 2024
   */
  @ApiPropertyOptional({
    description:
      'Start date for filtering vulnerabilities by creation date (ISO 8601 format).',
    example: '2024-01-01T00:00:00Z',
  })
  @IsOptional()
  @IsString()
  dateFrom?: string;

  /**
   * End date for vulnerability filtering.
   * Only vulnerabilities created on or before this date will be included.
   *
   * @example "2024-12-31T23:59:59Z" - Until December 31st, 2024
   */
  @ApiPropertyOptional({
    description:
      'End date for filtering vulnerabilities by creation date (ISO 8601 format).',
    example: '2024-12-31T23:59:59Z',
  })
  @IsOptional()
  @IsString()
  dateTo?: string;

  // ═══════════════════════════════════════════════════════════════════════════
  // BRANCH FILTER - Filter vulnerabilities by branch names
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Filter vulnerabilities by branch names.
   * Only vulnerabilities from these specific branches will be counted.
   * Supports multiple branches separated by comma.
   *
   * @example "main" - Only vulnerabilities from main branch
   * @example "main,develop" - Vulnerabilities from main OR develop branches
   */
  @ApiPropertyOptional({
    description:
      'Filter vulnerabilities by branch names (comma-separated). Only vulnerabilities from these branches will be included in all statistics.',
    example: 'main,develop',
  })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((v) => v.trim())
          .filter((v) => v.length > 0)
      : value,
  )
  @IsArray()
  branches?: string[];

  // ═══════════════════════════════════════════════════════════════════════════
  // PROJECT FILTERS - Filter data by specific projects
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Filter by specific project IDs.
   * Use to focus overview on a subset of projects within the organization.
   *
   * @example "project-uuid1,project-uuid2" - Only data from these projects
   */
  @ApiPropertyOptional({
    description:
      'Filter data to specific projects by their IDs (comma-separated UUIDs). Only these projects will be included in all statistics.',
    example: 'project-uuid1,project-uuid2',
    type: String,
  })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean)
      : value,
  )
  @IsArray()
  projectIds?: string[];

  // ═══════════════════════════════════════════════════════════════════════════
  // TEAM FILTERS - Filter data by team
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Filter by specific team IDs.
   * Use to compare or focus on specific teams within the organization.
   *
   * @example "team-uuid1,team-uuid2" - Only data from these teams
   */
  @ApiPropertyOptional({
    description:
      'Filter data to specific teams by their IDs. Only projects belonging to these teams will be included.',
    example: 'team-uuid1,team-uuid2',
    type: String,
  })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean)
      : value,
  )
  @IsArray()
  teamIds?: string[];

  // ═══════════════════════════════════════════════════════════════════════════
  // TREND & COMPARISON OPTIONS - Configure trend calculations
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Number of days for trend calculations (new issues, resolved issues).
   * Affects: newIssuesLast7Days, solvedIssuesLast7Days fields.
   *
   * @default 7
   * @example 14 - Show trends for last 14 days
   * @example 30 - Show trends for last 30 days
   */
  @ApiPropertyOptional({
    description:
      'Number of days for trend calculation. Affects new/resolved issue counts.',
    example: 7,
    default: 7,
    minimum: 1,
    maximum: 365,
  })
  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsNumber()
  @Min(1)
  @Max(365)
  trendPeriodDays?: number;

  /**
   * Period for comparison analysis (current vs previous period).
   * Returns change percentage and trend direction for each severity.
   *
   * @example "week" - Compare this week vs last week
   * @example "month" - Compare this month vs last month
   * @example "quarter" - Compare this quarter vs last quarter
   */
  @ApiPropertyOptional({
    description:
      'Comparison period for period-over-period analysis. Enables severityComparison and totalComparison in response.',
    example: 'week',
    enum: ['week', 'month', 'quarter'],
  })
  @IsOptional()
  @IsString()
  @IsIn(['week', 'month', 'quarter'])
  comparisonPeriod?: 'week' | 'month' | 'quarter';

  // ═══════════════════════════════════════════════════════════════════════════
  // PAGINATION - Control pagination for projects and teams lists
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Page number for projects summary list.
   *
   * @default 1
   * @max 10000 Defensive upper bound — out-of-range pages just slice to an
   *   empty list, but reject absurd input early rather than let it through.
   */
  @ApiPropertyOptional({
    description: 'Page number for projects summary pagination.',
    example: 1,
    default: 1,
    minimum: 1,
    maximum: 10000,
  })
  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsNumber()
  @Min(1)
  @Max(10000)
  projectsPage?: number;

  /**
   * Number of projects per page.
   *
   * @default 50
   * @max 100
   */
  @ApiPropertyOptional({
    description: 'Number of projects per page in projectsSummary.',
    example: 50,
    default: 50,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsNumber()
  @Min(1)
  @Max(100)
  projectsPageSize?: number;

  /**
   * Page number for teams summary list.
   *
   * @default 1
   * @max 10000 Defensive upper bound — out-of-range pages just slice to an
   *   empty list, but reject absurd input early rather than let it through.
   */
  @ApiPropertyOptional({
    description: 'Page number for teams summary pagination.',
    example: 1,
    default: 1,
    minimum: 1,
    maximum: 10000,
  })
  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsNumber()
  @Min(1)
  @Max(10000)
  teamsPage?: number;

  /**
   * Number of teams per page.
   *
   * @default 50
   * @max 100
   */
  @ApiPropertyOptional({
    description: 'Number of teams per page in teamsSummary.',
    example: 50,
    default: 50,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsNumber()
  @Min(1)
  @Max(100)
  teamsPageSize?: number;

  // ═══════════════════════════════════════════════════════════════════════════
  // SORTING - Control sort order for projects and teams lists
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Field to sort projects and teams by.
   *
   * @default "total_vulnerabilities"
   */
  @ApiPropertyOptional({
    description:
      'Sort field for projects and teams summaries. Applied to both lists.',
    example: 'total_vulnerabilities',
    default: 'total_vulnerabilities',
    enum: ['total_vulnerabilities', 'critical_count', 'risk_level', 'name'],
  })
  @IsOptional()
  @IsString()
  @IsIn(['total_vulnerabilities', 'critical_count', 'risk_level', 'name'])
  sortBy?: 'total_vulnerabilities' | 'critical_count' | 'risk_level' | 'name';

  /**
   * Sort direction.
   *
   * @default "DESC"
   */
  @ApiPropertyOptional({
    description:
      'Sort direction for projects and teams summaries. DESC = highest first.',
    example: 'DESC',
    default: 'DESC',
    enum: ['ASC', 'DESC'],
  })
  @IsOptional()
  @IsString()
  @IsIn(['ASC', 'DESC'])
  sortOrder?: 'ASC' | 'DESC';

  // ═══════════════════════════════════════════════════════════════════════════
  // OUTPUT OPTIONS - Control what sections are included in response
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Include detailed per-project breakdown.
   * Disable to reduce response size if only totals are needed.
   *
   * @default true
   */
  @ApiPropertyOptional({
    description:
      'Include projectsSummary array in response. Disable for faster, smaller response.',
    example: true,
    default: true,
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  includeProjectsSummary?: boolean;

  /**
   * Include detailed per-team breakdown.
   * Disable to reduce response size if only totals are needed.
   *
   * @default true
   */
  @ApiPropertyOptional({
    description:
      'Include teamsSummary array in response. Disable for faster, smaller response.',
    example: true,
    default: true,
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  includeTeamsSummary?: boolean;

  /**
   * Include vulnerability timeline data.
   * Useful for charts showing vulnerability trends over time.
   *
   * @default true
   */
  @ApiPropertyOptional({
    description:
      'Include vulnerabilitiesOverTime array for timeline charts. Disable if not needed.',
    example: true,
    default: true,
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  includeOverTimeData?: boolean;

  /**
   * Number of top vulnerable projects to return.
   * Used for "Top N most vulnerable projects" widget.
   *
   * @default 10
   * @max 50
   */
  @ApiPropertyOptional({
    description:
      'Limit for topVulnerableProjects array. Returns N most vulnerable projects.',
    example: 10,
    default: 10,
    minimum: 1,
    maximum: 50,
  })
  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsNumber()
  @Min(1)
  @Max(50)
  topVulnerableLimit?: number;
}
