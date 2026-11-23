import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class McpIssueCountDto {
  @ApiProperty() critical: number;
  @ApiProperty() high: number;
  @ApiProperty() medium: number;
  @ApiProperty() low: number;
}

/**
 * Slim, discovery-oriented project item served on the MCP-only surface
 * (`GET /mcp/organization/:id/projects`). The dashboard list item carries a
 * per-scanner `analyses[]` breakdown, an org-wide `mainStatistics` rollup,
 * timestamps and several `is*Linked` flags — none of which an AI agent needs to
 * resolve a human-readable name into a `projectId`. We keep just enough to pick
 * a project and judge its risk.
 */
export class McpProjectListItemDto {
  @ApiProperty({ description: 'Project UUID.' })
  projectId: string;

  @ApiProperty({ description: 'Project name.' })
  name: string;

  @ApiPropertyOptional({ description: 'Owning team name.' })
  teamName?: string;

  @ApiPropertyOptional({
    description: 'CyberRisk level (critical|high|medium|low|none).',
  })
  cyberRiskLevel?: string;

  @ApiProperty({ description: 'CyberRisk score (uncapped sum of points).' })
  cyberRiskScore: number;

  @ApiPropertyOptional({ type: McpIssueCountDto })
  issuesCount?: McpIssueCountDto;
}

export class McpProjectListResponseDto {
  @ApiProperty({ type: [McpProjectListItemDto] })
  projects: McpProjectListItemDto[];

  @ApiProperty({ description: 'Total matching projects.' })
  totalProjects: number;

  @ApiProperty({ description: 'Total pages at the (capped) page size.' })
  totalPages: number;
}
