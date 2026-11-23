import { Controller } from '@nestjs/common';
import { Span } from 'nestjs-otel';
import {
  GetBatchProjectIntegrationLinkStatusRequest,
  GetBatchProjectIntegrationLinkStatusResponse,
  GetProjectIntegrationLinkStatusRequest,
  GetProjectIntegrationLinkStatusResponse,
  ProjectIntegrationStatusServiceController,
  ProjectIntegrationStatusServiceControllerMethods,
  ResolveProjectsByRepositoryRequest,
  ResolveProjectsByRepositoryResponse,
  ResolveScanBranchRequest,
  ResolveScanBranchResponse,
} from '@grpc/external-integrations/external_integrations';
import { ProjectIntegrationStatusService } from './project-integration-status.service';

@Controller()
@ProjectIntegrationStatusServiceControllerMethods()
export class ProjectIntegrationStatusController implements ProjectIntegrationStatusServiceController {
  constructor(private readonly service: ProjectIntegrationStatusService) {}

  @Span()
  async getProjectIntegrationLinkStatus(
    request: GetProjectIntegrationLinkStatusRequest,
  ): Promise<GetProjectIntegrationLinkStatusResponse> {
    return this.service.getProjectIntegrationLinkStatus({
      projectId: request.projectId,
      organizationId: request.organizationId,
    });
  }

  @Span()
  async getBatchProjectIntegrationLinkStatus(
    request: GetBatchProjectIntegrationLinkStatusRequest,
  ): Promise<GetBatchProjectIntegrationLinkStatusResponse> {
    const { statuses, isJiraLinked, isLinearLinked } =
      await this.service.getBatchProjectIntegrationLinkStatus({
        organizationId: request.organizationId,
        projectIds: request.projectIds ?? [],
      });
    return {
      statuses: statuses.map((s) => ({
        projectId: s.projectId,
        isGithubLinked: s.isGithubLinked,
        isGitlabLinked: s.isGitlabLinked,
        defaultBranch: s.defaultBranch,
      })),
      isJiraLinked,
      isLinearLinked,
    };
  }

  // Dashboard repository link (task B2) — repository slug -> linked project
  // resolution; provider validation and lookups live in the service.
  @Span()
  async resolveProjectsByRepository(
    request: ResolveProjectsByRepositoryRequest,
  ): Promise<ResolveProjectsByRepositoryResponse> {
    return this.service.resolveProjectsByRepository({
      provider: request.provider,
      slug: request.slug,
      host: request.host ?? '',
    });
  }

  // The branch a container scan is stored on.
  @Span()
  async resolveScanBranch(
    request: ResolveScanBranchRequest,
  ): Promise<ResolveScanBranchResponse> {
    const branch = await this.service.resolveScanBranch({
      projectId: request.projectId,
      branch: request.branch ?? '',
      referenceBranch: request.referenceBranch ?? '',
    });
    return { branch };
  }
}
