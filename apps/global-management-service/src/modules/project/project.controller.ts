import { Controller } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import { ProjectService } from './project.service';
import {
  PaginatedProjectsAllInformationsResponse,
  PaginatedProjectsResponse,
  ProjectCreateRequest,
  ProjectDeleteRequest,
  ProjectDeleteResponse,
  ProjectGetAllRequest,
  ProjectGetRequest,
  ProjectInformationsResponse,
  ProjectUpdateRequest,
  ProjectUpdateResponse,
  GetProjectBranchesRequest,
  GetProjectBranchesResponse,
  CountProjectsInOrganizationRequest,
  CountProjectsInOrganizationResponse,
  ArchiveBranchRequest,
  ArchiveBranchResponse,
  UnarchiveBranchRequest,
  UnarchiveBranchResponse,
  GetArchivedBranchesRequest,
  GetArchivedBranchesResponse,
  GetProjectSecurityContextRequest,
  GetProjectSecurityContextResponse,
  UpdateProjectSecurityContextRequest,
  UpdateProjectSecurityContextResponse,
  SetProjectCyberRiskScoresRequest,
  SetProjectCyberRiskScoresResponse,
  GetOrganizationMainStatisticsRequest,
  MainStatisticsResponse,
  GetOrganizationProjectIdsRequest,
  OrganizationProjectIdsResponse,
  GetReadableProjectsRequest,
  ReadableProjectsResponse,
  MarkProjectAppsecRequest,
  MarkProjectAppsecResponse,
} from '@grpc/global-management/project';

/**
 * Core `ProjectService` handlers. Each RPC carries an explicit
 * `@GrpcMethod`: the closed RPC of this service is served by the closed
 * edition, and stripped from the exported proto, so the class decorator over
 * the whole generated interface is gone.
 */
@Controller()
export class ProjectController {
  constructor(private readonly projectService: ProjectService) {}

  @GrpcMethod('ProjectService', 'GetAllFromOrganization')
  async getAllFromOrganization(
    data: ProjectGetAllRequest,
  ): Promise<PaginatedProjectsAllInformationsResponse> {
    return this.projectService.getProjectsOrganization(data);
  }

  @GrpcMethod('ProjectService', 'SetProjectCyberRiskScores')
  async setProjectCyberRiskScores(
    data: SetProjectCyberRiskScoresRequest,
  ): Promise<SetProjectCyberRiskScoresResponse> {
    return this.projectService.setProjectCyberRiskScores(data);
  }

  @GrpcMethod('ProjectService', 'GetOrganizationMainStatistics')
  async getOrganizationMainStatistics(
    data: GetOrganizationMainStatisticsRequest,
  ): Promise<MainStatisticsResponse> {
    return this.projectService.getOrganizationMainStatistics(data);
  }

  @GrpcMethod('ProjectService', 'GetOrganizationProjectIds')
  async getOrganizationProjectIds(
    data: GetOrganizationProjectIdsRequest,
  ): Promise<OrganizationProjectIdsResponse> {
    return this.projectService.getOrganizationProjectIds(data);
  }

  @GrpcMethod('ProjectService', 'GetReadableProjectsInOrganization')
  async getReadableProjectsInOrganization(
    data: GetReadableProjectsRequest,
  ): Promise<ReadableProjectsResponse> {
    return this.projectService.getReadableProjectsInOrganization(data);
  }

  @GrpcMethod('ProjectService', 'GetAllFromTeam')
  async getAllFromTeam(
    data: ProjectGetAllRequest,
  ): Promise<PaginatedProjectsResponse> {
    return this.projectService.getProjectsTeam(data);
  }

  @GrpcMethod('ProjectService', 'Get')
  async get(data: ProjectGetRequest): Promise<ProjectInformationsResponse> {
    return this.projectService.getProject(data);
  }

  @GrpcMethod('ProjectService', 'Create')
  async create(
    data: ProjectCreateRequest,
  ): Promise<ProjectInformationsResponse> {
    return this.projectService.createProject(data);
  }

  @GrpcMethod('ProjectService', 'Update')
  async update(data: ProjectUpdateRequest): Promise<ProjectUpdateResponse> {
    return this.projectService.updateProject(data);
  }

  @GrpcMethod('ProjectService', 'Delete')
  async delete(data: ProjectDeleteRequest): Promise<ProjectDeleteResponse> {
    return this.projectService.deleteProject(data);
  }

  // The project becomes an AppSec project (first full scan).
  @GrpcMethod('ProjectService', 'MarkProjectAppsec')
  async markProjectAppsec(
    data: MarkProjectAppsecRequest,
  ): Promise<MarkProjectAppsecResponse> {
    return this.projectService.markProjectAppsec(data);
  }

  // Internal cron usage: global list of projects with optional flag filters.
  @GrpcMethod('ProjectService', 'GetAllProjects')
  async getAllProjects(data: {
    pageNumber?: number;
    pageSizeNumber?: number;
    weekly?: boolean;
    monthly?: boolean;
    emailAlert?: boolean;
    zeroDayEmail?: boolean;
    zeroDaySlack?: boolean;
    weeklySlack?: boolean;
    monthlySlack?: boolean;
    scanCompleteEmail?: boolean;
    scanCompleteSlack?: boolean;
  }): Promise<PaginatedProjectsResponse> {
    return this.projectService.getAllProjects(data);
  }

  // ========== Branch Ingestion Management ==========

  @GrpcMethod('ProjectService', 'GetProjectBranches')
  async getProjectBranches(
    data: GetProjectBranchesRequest,
  ): Promise<GetProjectBranchesResponse> {
    return this.projectService.getProjectBranches(data as any);
  }

  // ========== Branch Archiving ==========

  @GrpcMethod('ProjectService', 'ArchiveBranch')
  async archiveBranch(
    data: ArchiveBranchRequest,
  ): Promise<ArchiveBranchResponse> {
    return this.projectService.archiveBranch(data as any);
  }

  @GrpcMethod('ProjectService', 'UnarchiveBranch')
  async unarchiveBranch(
    data: UnarchiveBranchRequest,
  ): Promise<UnarchiveBranchResponse> {
    return this.projectService.unarchiveBranch(data as any);
  }

  @GrpcMethod('ProjectService', 'GetArchivedBranches')
  async getArchivedBranches(
    data: GetArchivedBranchesRequest,
  ): Promise<GetArchivedBranchesResponse> {
    return this.projectService.getArchivedBranches(data as any);
  }

  // ========== Bulk Validation for Policy Management ==========

  @GrpcMethod('ProjectService', 'ValidateProjectsInOrganization')
  async validateProjectsInOrganization(data: {
    projectIds: string[];
    organizationId: string;
  }): Promise<{
    valid: boolean;
    notFoundIds: string[];
    invalidIds: string[];
  }> {
    return this.projectService.validateProjectsInOrganization(data);
  }

  // ========== Security Context ==========

  @GrpcMethod('ProjectService', 'GetProjectSecurityContext')
  async getProjectSecurityContext(
    data: GetProjectSecurityContextRequest,
  ): Promise<GetProjectSecurityContextResponse> {
    return this.projectService.getProjectSecurityContext(data);
  }

  @GrpcMethod('ProjectService', 'UpdateProjectSecurityContext')
  async updateProjectSecurityContext(
    data: UpdateProjectSecurityContextRequest,
  ): Promise<UpdateProjectSecurityContextResponse> {
    return this.projectService.updateProjectSecurityContext(data);
  }

  // ========== Efficient Project Count ==========

  @GrpcMethod('ProjectService', 'CountProjectsInOrganization')
  async countProjectsInOrganization(
    data: CountProjectsInOrganizationRequest,
  ): Promise<CountProjectsInOrganizationResponse> {
    return this.projectService.countProjectsInOrganization(data);
  }
}
