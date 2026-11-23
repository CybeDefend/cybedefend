import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsArray } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Query DTO for Project Overview.
 *
 * This endpoint provides aggregated statistics for a specific project.
 * Optional branch filter allows narrowing results to specific branches.
 *
 * Use Cases:
 * - Project dashboard: Get security posture of a specific project
 * - Branch analysis: Filter vulnerabilities to specific branches (e.g., main, develop)
 * - Release readiness: Check vulnerability status for specific branches before release
 */
export class GetProjectOverviewQueryDto {
  /**
   * Filter by branch names.
   * When specified, only vulnerabilities from these branches will be counted.
   * Use getProjectBranches endpoint to retrieve available branches.
   *
   * @example ["main"] - Only count vulnerabilities from the main branch
   * @example ["main", "develop"] - Count vulnerabilities from main and develop branches
   */
  @ApiPropertyOptional({
    description:
      'Filter vulnerabilities by branch names. Only vulnerabilities from these branches will be counted. Use GET /project/:projectId/branches to get available branches. Can be passed as comma-separated string or multiple query params.',
    example: ['main', 'develop'],
    type: [String],
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => {
    // Handle both comma-separated string and array
    if (typeof value === 'string') {
      return value
        .split(',')
        .map((b) => b.trim())
        .filter(Boolean);
    }
    return Array.isArray(value) ? value : [value];
  })
  branches?: string[];
}
