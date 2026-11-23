import { Controller, Inject } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import { Logger } from 'nestjs-pino';

import { GithubIssueService } from '../github/github-issue.service';
import { GitlabIssueService } from '../gitlab/gitlab-issue.service';
import { JiraIssueService } from '../jira/jira-issue.service';
import {
  ENTITLEMENTS_PORT,
  EntitlementsPort,
} from '../../edition/ports/entitlements.port';
import { ISSUE_TRACKER_FEATURE } from './issue-tracker-feature';

import {
  CreateGithubIssuesRequest,
  CreateGithubIssuesResponse,
  CloseGithubIssueRequest,
  CloseGithubIssueResponse,
  GetGithubProjectIssuesRequest,
  GetGithubProjectIssuesResponse,
  UpdateGithubIssueRequest,
  UpdateGithubIssueResponse,
  CreateGitlabIssuesRequest,
  CreateGitlabIssuesResponse,
  CloseGitlabIssueRequest,
  CloseGitlabIssueResponse,
  GetGitlabProjectIssuesRequest,
  GetGitlabProjectIssuesResponse,
  UpdateGitlabIssueRequest,
  UpdateGitlabIssueResponse,
  CreateJiraIssuesRequest,
  CreateJiraIssuesResponse,
  LinkJiraIssueRequest,
  LinkJiraIssueResponse,
  GetJiraProjectIssuesRequest,
  GetJiraProjectIssuesResponse,
  GetJiraIssueStatusRequest,
  GetJiraIssueStatusResponse,
} from '@grpc/external-integrations/issue';

/**
 * gRPC Controller for GitHub and GitLab issue services.
 */
@Controller()
export class IssueController {
  constructor(
    private readonly githubIssueService: GithubIssueService,
    private readonly gitlabIssueService: GitlabIssueService,
    private readonly jiraIssueService: JiraIssueService,
    @Inject(ENTITLEMENTS_PORT)
    private readonly entitlements: EntitlementsPort,
    private readonly logger: Logger,
  ) {}

  // ==================== GitHub Issue Service ====================

  @GrpcMethod('GithubIssueService', 'CreateIssues')
  async createGithubIssues(
    request: CreateGithubIssuesRequest,
  ): Promise<CreateGithubIssuesResponse> {
    this.logger.log(
      `GithubIssueService.CreateIssues called for project ${request.projectId}`,
    );
    await this.entitlements.assertFeatureAllowed(
      request.organizationId,
      'github_issues',
    );
    return this.githubIssueService.createIssues(request);
  }

  @GrpcMethod('GithubIssueService', 'CloseIssue')
  async closeGithubIssue(
    request: CloseGithubIssueRequest,
  ): Promise<CloseGithubIssueResponse> {
    this.logger.log(
      `GithubIssueService.CloseIssue called for project ${request.projectId}, issue #${request.issueNumber}`,
    );
    return this.githubIssueService.closeIssue(request);
  }

  @GrpcMethod('GithubIssueService', 'GetProjectIssues')
  async getGithubProjectIssues(
    request: GetGithubProjectIssuesRequest,
  ): Promise<GetGithubProjectIssuesResponse> {
    this.logger.log(
      `GithubIssueService.GetProjectIssues called for project ${request.projectId}`,
    );
    return this.githubIssueService.getProjectIssues(request);
  }

  @GrpcMethod('GithubIssueService', 'UpdateIssue')
  async updateGithubIssue(
    request: UpdateGithubIssueRequest,
  ): Promise<UpdateGithubIssueResponse> {
    this.logger.log(
      `GithubIssueService.UpdateIssue called for project ${request.projectId}, issue #${request.issueNumber}`,
    );
    return this.githubIssueService.updateIssue(request);
  }

  // ==================== GitLab Issue Service ====================

  @GrpcMethod('GitlabIssueService', 'CreateIssues')
  async createGitlabIssues(
    request: CreateGitlabIssuesRequest,
  ): Promise<CreateGitlabIssuesResponse> {
    this.logger.log(
      `GitlabIssueService.CreateIssues called for project ${request.projectId}`,
    );
    await this.entitlements.assertFeatureAllowed(
      request.organizationId,
      'gitlab_issues',
    );
    return this.gitlabIssueService.createIssues(request);
  }

  @GrpcMethod('GitlabIssueService', 'CloseIssue')
  async closeGitlabIssue(
    request: CloseGitlabIssueRequest,
  ): Promise<CloseGitlabIssueResponse> {
    this.logger.log(
      `GitlabIssueService.CloseIssue called for project ${request.projectId}, issue #${request.issueIid}`,
    );
    return this.gitlabIssueService.closeIssue(request);
  }

  @GrpcMethod('GitlabIssueService', 'GetProjectIssues')
  async getGitlabProjectIssues(
    request: GetGitlabProjectIssuesRequest,
  ): Promise<GetGitlabProjectIssuesResponse> {
    this.logger.log(
      `GitlabIssueService.GetProjectIssues called for project ${request.projectId}`,
    );
    return this.gitlabIssueService.getProjectIssues(request);
  }

  @GrpcMethod('GitlabIssueService', 'UpdateIssue')
  async updateGitlabIssue(
    request: UpdateGitlabIssueRequest,
  ): Promise<UpdateGitlabIssueResponse> {
    this.logger.log(
      `GitlabIssueService.UpdateIssue called for project ${request.projectId}, issue #${request.issueIid}`,
    );
    return this.gitlabIssueService.updateIssue(request);
  }

  // ==================== Jira Issue Service ====================

  @GrpcMethod('JiraIssueService', 'CreateIssues')
  async createJiraIssues(
    request: CreateJiraIssuesRequest,
  ): Promise<CreateJiraIssuesResponse> {
    this.logger.log(
      `JiraIssueService.CreateIssues called for project ${request.projectId}`,
    );
    // `jira` is the feature key checked for issue creation.
    await this.entitlements.assertFeatureAllowed(
      request.organizationId,
      ISSUE_TRACKER_FEATURE,
    );
    return this.jiraIssueService.createIssues(request);
  }

  @GrpcMethod('JiraIssueService', 'LinkExistingIssue')
  async linkJiraIssue(
    request: LinkJiraIssueRequest,
  ): Promise<LinkJiraIssueResponse> {
    this.logger.log(
      `JiraIssueService.LinkExistingIssue called for project ${request.projectId}, key ${request.jiraIssueKey}`,
    );
    await this.entitlements.assertFeatureAllowed(
      request.organizationId,
      ISSUE_TRACKER_FEATURE,
    );
    return this.jiraIssueService.linkExistingIssue(request);
  }

  @GrpcMethod('JiraIssueService', 'GetProjectIssues')
  async getJiraProjectIssues(
    request: GetJiraProjectIssuesRequest,
  ): Promise<GetJiraProjectIssuesResponse> {
    this.logger.log(
      `JiraIssueService.GetProjectIssues called for project ${request.projectId}`,
    );
    return this.jiraIssueService.getProjectIssues(request);
  }

  @GrpcMethod('JiraIssueService', 'GetIssueStatus')
  async getJiraIssueStatus(
    request: GetJiraIssueStatusRequest,
  ): Promise<GetJiraIssueStatusResponse> {
    this.logger.log(
      `JiraIssueService.GetIssueStatus called for project ${request.projectId}`,
    );
    return this.jiraIssueService.getIssueStatus(request);
  }
}
