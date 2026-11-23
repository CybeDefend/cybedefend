// src/modules/project/project.service.ts

import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { Span } from 'nestjs-otel';

import {
  PROJECT_SERVICE_NAME,
  ProjectServiceClient,
} from '@grpc/global-management/global_management';

import {
  ProjectGetAllRequest,
  ProjectGetRequest,
  ProjectCreateRequest,
  ProjectUpdateRequest,
  ProjectDeleteRequest,
  PaginatedProjectsAllInformationsResponse,
  PaginatedProjectsResponse,
  ProjectInformationsResponse,
  ProjectUpdateResponse,
  ProjectDeleteResponse,
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
  GetOrganizationMainStatisticsRequest,
  MainStatisticsResponse,
  ValidateProjectsInOrganizationRequest,
  ValidateProjectsInOrganizationResponse,
} from '@grpc/global-management/project';
import {
  RESULT_SERVICE_NAME,
  ResultServiceClient,
} from '@grpc/analysis-reporting/analysis_reporting';
import { safeGrpcCall } from '@grpc/wrapper-grpc';
import { resolveDefaultBranch } from './resolve-default-branch.util';
import { isCodeGraphSupported } from './code-graph-support.util';
import { wrapGrpcClientWithTracing } from '@grpc/traced-grpc-client';
import {
  EMPTY_MAIN_STATISTICS,
  toMainStatisticsResponse,
} from './mappers/main-statistics.mapper';

@Injectable()
export class ProjectService implements OnModuleInit {
  private readonly logger = new Logger(ProjectService.name);
  private projectServiceClient!: ProjectServiceClient;
  private resultServiceClient!: ResultServiceClient;

  constructor(
    @Inject('GLOBAL_MANAGEMENT_SERVICE')
    private readonly client: ClientGrpc,
    @Inject('ANALYSIS_REPORTING_SERVICE')
    private readonly analysisReportingClient: ClientGrpc,
  ) {}

  onModuleInit() {
    this.projectServiceClient = wrapGrpcClientWithTracing(
      this.client.getService<ProjectServiceClient>(PROJECT_SERVICE_NAME),
    );
    this.resultServiceClient = wrapGrpcClientWithTracing(
      this.analysisReportingClient.getService<ResultServiceClient>(
        RESULT_SERVICE_NAME,
      ),
    );
  }

  @Span()
  getProjectsOrganization(
    data: ProjectGetAllRequest,
  ): Promise<PaginatedProjectsAllInformationsResponse> {
    return safeGrpcCall(this.projectServiceClient.getAllFromOrganization(data));
  }

  /**
   * Home KPI cards of an organization, read from analysis-reporting.
   *
   * The caller is always forwarded: any member passes the route's
   * PermissionsGuard, so analysis-reporting narrows the figures to the
   * projects this user may read (the persisted organization-wide row only for
   * a caller who reads every project). Zeros when analysis-reporting fails.
   * global-management's GetOrganizationMainStatistics RPC stays for one
   * release.
   */
  @Span()
  async getOrganizationMainStatistics(
    data: GetOrganizationMainStatisticsRequest,
  ): Promise<MainStatisticsResponse> {
    try {
      const statistics = await safeGrpcCall(
        this.resultServiceClient.getOrganizationStatistics({
          organizationId: data.organizationId,
          userId: data.userId,
        }),
      );
      return toMainStatisticsResponse(statistics);
    } catch (err) {
      this.logger.warn(
        `Failed to fetch org statistics for ${data.organizationId}: ${err}. Falling back to zeros`,
      );
      return { ...EMPTY_MAIN_STATISTICS };
    }
  }

  @Span()
  getProjectsTeam(
    data: ProjectGetAllRequest,
  ): Promise<PaginatedProjectsResponse> {
    return safeGrpcCall(this.projectServiceClient.getAllFromTeam(data));
  }

  @Span()
  async getProject(data: ProjectGetRequest): Promise<
    ProjectInformationsResponse & {
      defaultBranch: string;
      codeGraphSupported: boolean;
    }
  > {
    const project = await safeGrpcCall(this.projectServiceClient.get(data));
    return {
      ...project,
      defaultBranch: resolveDefaultBranch(
        project.parsedBranches ?? [],
        project.referenceBranch ?? undefined,
      ),
      codeGraphSupported: isCodeGraphSupported(project.detectedLanguages),
    };
  }

  /**
   * Which of `projectIds` belong to `organizationId`, in one SQL query.
   * Cheaper than `getProject` when only ownership matters: that one also
   * fans out to integration status, vulnerability counts and security context.
   */
  @Span()
  validateProjectsInOrganization(
    data: ValidateProjectsInOrganizationRequest,
  ): Promise<ValidateProjectsInOrganizationResponse> {
    return safeGrpcCall(
      this.projectServiceClient.validateProjectsInOrganization(data),
    );
  }

  @Span()
  createProject(
    data: ProjectCreateRequest,
  ): Promise<ProjectInformationsResponse> {
    return safeGrpcCall(this.projectServiceClient.create(data));
  }

  @Span()
  updateProject(data: ProjectUpdateRequest): Promise<ProjectUpdateResponse> {
    return safeGrpcCall(this.projectServiceClient.update(data));
  }

  @Span()
  deleteProject(data: ProjectDeleteRequest): Promise<ProjectDeleteResponse> {
    return safeGrpcCall(this.projectServiceClient.delete(data));
  }

  @Span()
  archiveBranch(data: ArchiveBranchRequest): Promise<ArchiveBranchResponse> {
    return safeGrpcCall(this.projectServiceClient.archiveBranch(data));
  }

  @Span()
  unarchiveBranch(
    data: UnarchiveBranchRequest,
  ): Promise<UnarchiveBranchResponse> {
    return safeGrpcCall(this.projectServiceClient.unarchiveBranch(data));
  }

  @Span()
  getArchivedBranches(
    data: GetArchivedBranchesRequest,
  ): Promise<GetArchivedBranchesResponse> {
    return safeGrpcCall(this.projectServiceClient.getArchivedBranches(data));
  }

  @Span()
  getProjectSecurityContext(
    data: GetProjectSecurityContextRequest,
  ): Promise<GetProjectSecurityContextResponse> {
    return safeGrpcCall(
      this.projectServiceClient.getProjectSecurityContext(data),
    );
  }

  @Span()
  updateProjectSecurityContext(
    data: UpdateProjectSecurityContextRequest,
  ): Promise<UpdateProjectSecurityContextResponse> {
    return safeGrpcCall(
      this.projectServiceClient.updateProjectSecurityContext(data),
    );
  }
}
