import type {
  ProjectAllInformationsResponse,
  PaginatedProjectsAllInformationsResponse,
} from '@grpc/global-management/project';
import {
  McpProjectListItemDto,
  McpProjectListResponseDto,
} from './dto/response/mcp-project-list-response.dto';

/** Map a full project entry to the slim discovery shape. */
export function toSlimProject(
  p: ProjectAllInformationsResponse,
): McpProjectListItemDto {
  return {
    projectId: p.projectId,
    name: p.name,
    teamName: p.teamName || undefined,
    cyberRiskLevel: p.cyberRiskLevel || undefined,
    cyberRiskScore: p.cyberRiskScore,
    issuesCount: p.issuesCount
      ? {
          critical: p.issuesCount.critical,
          high: p.issuesCount.high,
          medium: p.issuesCount.medium,
          low: p.issuesCount.low,
        }
      : undefined,
  };
}

/** Map the paginated project response to the slim discovery wrapper. */
export function toSlimProjectList(
  res: PaginatedProjectsAllInformationsResponse,
): McpProjectListResponseDto {
  return {
    projects: (res.projects ?? []).map(toSlimProject),
    totalProjects: res.totalProjects,
    totalPages: res.totalPages,
  };
}
