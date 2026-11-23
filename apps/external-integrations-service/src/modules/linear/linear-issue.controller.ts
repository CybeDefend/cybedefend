import { Controller, Inject } from '@nestjs/common';
import { Span } from 'nestjs-otel';
import {
  ApplyLinearFindingStatesRequest,
  ApplyLinearFindingStatesResponse,
  CreateLinearIssuesRequest,
  CreateLinearIssuesResponse,
  GetLinearProjectIssuesRequest,
  GetLinearProjectIssuesResponse,
  LinearIssueServiceController,
  LinearIssueServiceControllerMethods,
  LinkLinearIssueRequest,
  LinkLinearIssueResponse,
  SyncLinearIssueStatusRequest,
  SyncLinearIssueStatusResponse,
} from '@grpc/external-integrations/issue';
import {
  ENTITLEMENTS_PORT,
  EntitlementsPort,
} from '../../edition/ports/entitlements.port';
import { ISSUE_TRACKER_FEATURE } from '../issue/issue-tracker-feature';
import { LinearFindingStatesService } from './linear-finding-states.service';
import { LinearIssueService } from './linear-issue.service';

/**
 * gRPC face of Linear issues. Creating and linking a ticket are
 * checked against the plan's issue tracker feature, as Jira's are; reading the
 * project's tickets, syncing their status and applying a finding's new state
 * are not, so an organisation that loses the feature keeps its open tickets in
 * step with the findings.
 */
@Controller()
@LinearIssueServiceControllerMethods()
export class LinearIssueController implements LinearIssueServiceController {
  constructor(
    private readonly issueService: LinearIssueService,
    private readonly findingStatesService: LinearFindingStatesService,
    @Inject(ENTITLEMENTS_PORT)
    private readonly entitlements: EntitlementsPort,
  ) {}

  @Span()
  async createIssues(
    request: CreateLinearIssuesRequest,
  ): Promise<CreateLinearIssuesResponse> {
    await this.entitlements.assertFeatureAllowed(
      request.organizationId,
      ISSUE_TRACKER_FEATURE,
    );
    return await this.issueService.createIssues(request);
  }

  @Span()
  async linkExistingIssue(
    request: LinkLinearIssueRequest,
  ): Promise<LinkLinearIssueResponse> {
    await this.entitlements.assertFeatureAllowed(
      request.organizationId,
      ISSUE_TRACKER_FEATURE,
    );
    return await this.issueService.linkExistingIssue(request);
  }

  @Span()
  async getProjectIssues(
    request: GetLinearProjectIssuesRequest,
  ): Promise<GetLinearProjectIssuesResponse> {
    return await this.issueService.getProjectIssues(request);
  }

  @Span()
  async syncIssueStatus(
    request: SyncLinearIssueStatusRequest,
  ): Promise<SyncLinearIssueStatusResponse> {
    return await this.issueService.syncIssueStatus(request);
  }

  @Span()
  async applyFindingStates(
    request: ApplyLinearFindingStatesRequest,
  ): Promise<ApplyLinearFindingStatesResponse> {
    return await this.findingStatesService.applyFindingStates(request);
  }
}
