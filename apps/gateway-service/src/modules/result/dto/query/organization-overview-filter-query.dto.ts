import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsArray, IsBoolean } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Shared filter query DTO for the split Organization Overview endpoints.
 *
 * Contains ONLY the filter fields (vulnerability, date, branch, project, team).
 * Pagination, sorting, trend, and output-flag fields are intentionally excluded.
 */
export class OrganizationOverviewFilterQueryDto {
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
}
