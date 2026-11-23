import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { FindOptionsWhere, In, IsNull, Not, Repository } from 'typeorm';
import { Span } from 'nestjs-otel';
import { Logger } from 'nestjs-pino';
import { isUniqueViolation } from '@cybedefend/db-dialect';
import {
  CreateLinearIssuesRequest,
  CreateLinearIssuesResponse,
  GetLinearProjectIssuesRequest,
  GetLinearProjectIssuesResponse,
  IssueInfo,
  LinkLinearIssueRequest,
  LinkLinearIssueResponse,
  SyncLinearIssueStatusRequest,
  SyncLinearIssueStatusResponse,
  VulnerabilityInfo,
} from '@grpc/external-integrations/issue';
import {
  IssuePlatform,
  VulnerabilityIssueMapping,
} from '../../entities/vulnerability-issue-mapping.entity';
import { LinearIntegration } from '../../entities/linear-integration.entity';
import { LinearProjectMapping } from '../../entities/linear-project-mapping.entity';
import {
  ENTITLEMENTS_PORT,
  EntitlementsPort,
} from '../../edition/ports/entitlements.port';
import {
  buildCybeDefendGroupUrl,
  groupVulnerabilities,
  normalizeIssueCreationMode,
  vulnerabilityDisplayName,
} from '../issue/issue-grouping';
import { LinearService } from './linear.service';
import {
  LinearDescriptionService,
  LinearPriority,
} from './linear-description.service';
import { LinearWorkflowState, resolveStartStateId } from './linear-start-state';
import { linearRefusal } from './linear-refusals';

// Linear counts requests per hour: tickets are created one at a time, this
// long apart.
const CREATION_PAUSE_MS = 300;

// A ticket is finished in Linear once its state is of one of these types, or
// once it was deleted (local state written by the webhook).
const TERMINAL_STATE_TYPES = ['completed', 'canceled'];
const DELETED_STATE = 'deleted';

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info'];

// Widths of the vulnerability_issue_mapping columns written from Linear's
// answer: a longer value would fail the INSERT after the ticket exists.
const MAX_IDENTIFIER = 32;
const MAX_TEAM_KEY = 16;
const MAX_PRIORITY = 32;
const MAX_ASSIGNEE = 255;
const MAX_STATE_TYPE = 16;
const MAX_STATE_NAME = 255;
const MAX_ISSUE_URL = 255;
const MAX_GROUP_KEY = 255;
const MAX_ATTACHMENT_TITLE = 255;
const MAX_ISSUE_TITLE = 255;

// Linear answers a status read for this many tickets at most.
const STATUS_BATCH_SIZE = 50;

// An identifier is its team key (1 to 10 letters or digits, the first a
// letter), a dash and the ticket number.
const ISSUE_IDENTIFIER = /^[A-Za-z][A-Za-z0-9]{0,9}-\d{1,9}$/;
const LINEAR_HOST = 'linear.app';
const INVALID_ISSUE_REF = 'Invalid Linear issue reference';

const TEAM_QUERY = `query LinearIssueTeam($teamId: String!) {
  team(id: $teamId) {
    id
    key
    name
    triageEnabled
    defaultIssueState { id type }
    states(first: 50) { nodes { id type position name } }
  }
}`;

const ISSUE_CREATE_MUTATION = `mutation LinearIssueCreate($input: IssueCreateInput!) {
  issueCreate(input: $input) {
    success
    issue {
      id
      identifier
      url
      priorityLabel
      state { name type }
      team { key }
      assignee { name }
    }
  }
}`;

const ATTACHMENT_CREATE_MUTATION = `mutation LinearAttachmentCreate($input: AttachmentCreateInput!) {
  attachmentCreate(input: $input) { success }
}`;

const ISSUE_LOOKUP_QUERY = `query LinearIssueLookup($id: String!) {
  issue(id: $id) {
    id
    identifier
    url
    title
    priorityLabel
    state { name type }
    team { key }
    assignee { name }
  }
}`;

const ISSUES_STATUS_QUERY = `query LinearIssuesStatus($ids: [ID!]!) {
  issues(filter: { id: { in: $ids } }, first: 50) {
    nodes {
      id
      identifier
      url
      priorityLabel
      state { name type }
      team { key }
      assignee { name }
    }
  }
}`;

interface LinearTeam {
  id: string;
  key: string;
  name: string;
  triageEnabled?: boolean | null;
  defaultIssueState?: { id: string; type: string } | null;
  states?: { nodes?: LinearWorkflowState[] | null } | null;
}

interface CreatedIssue {
  id: string;
  identifier?: string | null;
  url?: string | null;
  priorityLabel?: string | null;
  state?: { name?: string | null; type?: string | null } | null;
  team?: { key?: string | null } | null;
  assignee?: { name?: string | null } | null;
}

interface LinkedIssue extends CreatedIssue {
  title?: string | null;
}

interface IssuesStatusData {
  issues?: { nodes?: Array<CreatedIssue | null> | null } | null;
}

/** What a ticket's rows cache of its Linear state, all of it kept in step. */
type TicketChanges = Partial<
  Pick<
    VulnerabilityIssueMapping,
    | 'issueState'
    | 'issueUrl'
    | 'linearStateType'
    | 'linearAssignee'
    | 'linearPriority'
    | 'linearTeamKey'
    | 'linearIdentifier'
  >
>;

interface IssueCreateData {
  issueCreate?: { success?: boolean; issue?: CreatedIssue | null } | null;
}

/** Where the tickets of one call go, and with what. */
interface Target {
  teamId: string;
  linearProjectId: string | null;
  labelIds: string[];
  assigneeId: string | null;
}

/** Creates Linear tickets from CybeDefend findings. */
@Injectable()
export class LinearIssueService {
  constructor(
    @InjectRepository(VulnerabilityIssueMapping)
    private readonly issueMappingRepo: Repository<VulnerabilityIssueMapping>,
    private readonly linearService: LinearService,
    private readonly descriptionService: LinearDescriptionService,
    @Inject(ENTITLEMENTS_PORT)
    private readonly entitlements: EntitlementsPort,
    private readonly logger: Logger,
  ) {}

  /**
   * One ticket per group of findings (see groupVulnerabilities), in the
   * request's team or, without one, the project's Linear settings.
   *
   * A group that already has an open Linear ticket, or with a finding linked to
   * one, is skipped. A group that fails is reported in failedVulnerabilityIds
   * and the next one is tried, except when Linear's rate limit is reached,
   * Linear is unavailable or the workspace must be reconnected: every later
   * call would fail too, so the remaining groups are reported failed without
   * being tried. `success` is false only when a group failed and none was
   * created.
   */
  @Span()
  async createIssues(
    request: CreateLinearIssuesRequest,
  ): Promise<CreateLinearIssuesResponse> {
    const { projectId, organizationId, scanId, mode, cybedefendBaseUrl } =
      request;

    // Gate ticket creation behind reverse-trial writability, before anything.
    await this.entitlements.assertWritable(organizationId);

    const integration =
      await this.linearService.getIntegrationForOrga(organizationId);
    const projectConfig = await this.projectConfigOf(projectId, integration);

    const vulnerabilities = this.onAllowedBranches(
      request.vulnerabilities ?? [],
      projectConfig,
    );
    if (vulnerabilities.length === 0) {
      return this.nothingCreated(
        'Branch restriction: none of the vulnerabilities are on allowed branches',
        request.vulnerabilities ?? [],
      );
    }

    const target = this.targetOf(request, projectConfig);
    const team = await this.readTeam(integration, target.teamId);
    const stateId = resolveStartStateId(
      team.states?.nodes ?? [],
      team.defaultIssueState ?? null,
    );
    if (!stateId) {
      this.logger.warn(
        { organizationId, projectId, linearTeamId: team.id },
        'Linear team has no backlog or unstarted state to create tickets in',
      );
      return this.nothingCreated(
        'The Linear team has no state to create tickets in',
        vulnerabilities,
      );
    }

    const creationMode = normalizeIssueCreationMode(mode);
    const issues: IssueInfo[] = [];
    const failedVulnerabilityIds: string[] = [];
    const groups = [...groupVulnerabilities(vulnerabilities, mode)];
    let attempted = 0;

    for (const [index, [groupKey, groupVulns]] of groups.entries()) {
      const vulnIds = groupVulns.map((v) => v.vulnerabilityId);
      try {
        if (
          await this.hasOpenTicket(projectId, creationMode, groupKey, vulnIds)
        ) {
          continue;
        }

        if (attempted > 0) await this.pause(CREATION_PAUSE_MS);
        attempted += 1;

        const title = this.descriptionService.buildTitle(
          groupVulns,
          mode,
          groupKey,
        );
        const name = vulnerabilityDisplayName(groupVulns[0]);
        // Built from the request's base URL and ids only, never from a
        // finding's own `cybedefendUrl`.
        const groupUrl = buildCybeDefendGroupUrl(
          cybedefendBaseUrl,
          projectId,
          groupVulns[0].scannerType,
          groupVulns[0].name || name,
        );
        const severity = this.highestSeverity(groupVulns);

        const issue = await this.createIssue(integration, {
          teamId: target.teamId,
          title,
          description: this.descriptionService.buildDescription(
            groupVulns,
            groupUrl,
          ),
          priority: this.priorityOf(request.priority, severity),
          stateId,
          ...(target.assigneeId ? { assigneeId: target.assigneeId } : {}),
          ...(target.linearProjectId
            ? { projectId: target.linearProjectId }
            : {}),
          ...(target.labelIds.length > 0 ? { labelIds: target.labelIds } : {}),
        });

        await this.attachLink(integration, issue, {
          url: groupUrl,
          title: clip(`CybeDefend · ${name}`, MAX_ATTACHMENT_TITLE),
          subtitle: `${groupVulns.length} ${groupVulns.length === 1 ? 'occurrence' : 'occurrences'} · ${capitalize(severity) || 'Unknown'}`,
        });

        try {
          await this.saveMappings(groupVulns, issue, {
            projectId,
            scanId,
            title,
            creationMode,
            groupKey,
            team,
            integration,
          });
        } catch (err) {
          // The ticket exists in Linear, but no finding points to it: name it,
          // so it can be found and linked by hand.
          this.logger.error(
            {
              organizationId,
              projectId,
              linearIssueId: issue.id,
              linearIdentifier: issue.identifier ?? '',
              reason: this.reasonOf(err),
            },
            'Linear issue created but its findings could not be recorded',
          );
          throw err;
        }
        issues.push(this.toIssueInfo(issue, title, team.key, vulnIds));
        this.logger.log(
          {
            organizationId,
            projectId,
            linearIssueId: issue.id,
            vulnerabilities: vulnIds.length,
          },
          'Linear issue created',
        );
      } catch (err) {
        failedVulnerabilityIds.push(...vulnIds);
        const stop = this.stopsTheRun(err);
        this.logger.error(
          {
            organizationId,
            projectId,
            groupIndex: index,
            reason: this.reasonOf(err),
          },
          stop
            ? 'Linear issue creation stopped: Linear refuses every further call'
            : 'Linear issue creation failed for a group',
        );
        if (stop) {
          for (const [, rest] of groups.slice(index + 1)) {
            failedVulnerabilityIds.push(...rest.map((v) => v.vulnerabilityId));
          }
          break;
        }
      }
    }

    return {
      // Groups skipped because they are ticketed already are not a failure.
      success: issues.length > 0 || failedVulnerabilityIds.length === 0,
      message: `Created ${issues.length} Linear ${issues.length === 1 ? 'issue' : 'issues'}`,
      issues,
      failedVulnerabilityIds,
    };
  }

  /**
   * Links findings to a ticket that exists already, given by identifier or by
   * URL. The ticket is only read, and gets the CybeDefend attachment: its
   * description and fields are never written. The rows are `linked`, so a
   * ticket someone else owns is only ever commented on, never closed.
   */
  @Span()
  async linkExistingIssue(
    request: LinkLinearIssueRequest,
  ): Promise<LinkLinearIssueResponse> {
    const {
      projectId,
      organizationId,
      issueRef,
      scannerType,
      cybedefendBaseUrl,
    } = request;
    const vulnerabilityIds = [...new Set(request.vulnerabilityIds ?? [])];
    const vulnerabilities = request.vulnerabilities ?? [];

    const identifier = this.parseIssueRef(issueRef);
    if (!identifier) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: INVALID_ISSUE_REF,
      });
    }
    // Nothing to link would still write an attachment on the ticket.
    if (vulnerabilityIds.length === 0) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'No vulnerability to link',
      });
    }

    const integration =
      await this.linearService.getIntegrationForOrga(organizationId);
    this.assertInWorkspace(issueRef, integration);
    const issue = await this.readIssue(integration, identifier);
    const title = clip(
      issue.title || issue.identifier || identifier,
      MAX_ISSUE_TITLE,
    );

    await this.saveLinks(vulnerabilityIds, issue, {
      projectId,
      scannerType,
      title,
      integration,
    });

    if (cybedefendBaseUrl) {
      const first = vulnerabilities[0];
      const name = first ? vulnerabilityDisplayName(first) : 'Vulnerability';
      // Built from the request's base URL and ids only, never from a
      // finding's own `cybedefendUrl`.
      const groupUrl = buildCybeDefendGroupUrl(
        cybedefendBaseUrl,
        projectId,
        scannerType,
        first?.name || name,
      );
      const severity = this.highestSeverity(vulnerabilities);
      await this.attachLink(integration, issue, {
        url: groupUrl,
        title: clip(`CybeDefend · ${name}`, MAX_ATTACHMENT_TITLE),
        subtitle: `${vulnerabilityIds.length} ${vulnerabilityIds.length === 1 ? 'occurrence' : 'occurrences'} · ${capitalize(severity) || 'Unknown'}`,
      });
    }

    this.logger.log(
      {
        organizationId,
        projectId,
        linearIssueId: issue.id,
        vulnerabilities: vulnerabilityIds.length,
      },
      'Linear issue linked',
    );
    return {
      success: true,
      message: `Linked ${vulnerabilityIds.length} ${vulnerabilityIds.length === 1 ? 'vulnerability' : 'vulnerabilities'} to ${issue.identifier || identifier}`,
      issue: this.toIssueInfo(
        issue,
        title,
        issue.team?.key ?? '',
        vulnerabilityIds,
      ),
    };
  }

  /**
   * The Linear tickets linked to a project's findings, one entry per ticket,
   * from what the rows cache. Only rows written for this organisation's
   * workspace: a project id that is guessed reaches nothing of another
   * organisation.
   *
   * `state` is `open` (not completed, canceled nor deleted), `closed` (the
   * reverse) or anything else for all.
   */
  @Span()
  async getProjectIssues(
    request: GetLinearProjectIssuesRequest,
  ): Promise<GetLinearProjectIssuesResponse> {
    const { projectId, organizationId, state } = request;
    const vulnerabilityIds = request.vulnerabilityIds ?? [];

    this.requireProjectId(projectId);
    const linearOrganizationId =
      await this.connectedWorkspaceOf(organizationId);
    const scope: FindOptionsWhere<VulnerabilityIssueMapping> = {
      projectId,
      platform: IssuePlatform.LINEAR,
      linearOrganizationId,
      ...(vulnerabilityIds.length > 0
        ? { vulnerabilityId: In(vulnerabilityIds) }
        : {}),
    };
    const rows = await this.issueMappingRepo.find({
      where: this.rowsInState(scope, state),
      order: { createdAt: 'ASC' },
    });

    const tickets = new Map<string, IssueInfo>();
    for (const row of rows) {
      const ticket = tickets.get(row.externalIssueId);
      if (!ticket) {
        tickets.set(row.externalIssueId, {
          issueId: row.externalIssueId,
          issueNumber: 0,
          title: row.issueTitle,
          url: row.issueUrl || '',
          state: row.issueState,
          vulnerabilityIds: [row.vulnerabilityId],
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
          linearIdentifier: row.linearIdentifier || '',
          linearTeamKey: row.linearTeamKey || '',
          linearPriority: row.linearPriority || '',
          linearAssignee: row.linearAssignee || '',
          linearStateType: row.linearStateType || '',
        });
        continue;
      }
      if (!ticket.vulnerabilityIds.includes(row.vulnerabilityId)) {
        ticket.vulnerabilityIds.push(row.vulnerabilityId);
      }
      if (row.updatedAt.toISOString() > ticket.updatedAt) {
        ticket.updatedAt = row.updatedAt.toISOString();
      }
    }

    return { success: true, issues: [...tickets.values()] };
  }

  /**
   * Reads the project's open tickets again from Linear, 50 at a time, and
   * brings the rows' cached state, assignee, priority, team, identifier and URL
   * in step: it catches up with a webhook Linear disabled. A ticket Linear no
   * longer returns (archived, deleted) is left as it is. `updated` counts the
   * project's rows that changed.
   *
   * A Linear failure ends the run and reaches the caller as it is; what the
   * earlier batches wrote stays.
   */
  @Span()
  async syncIssueStatus(
    request: SyncLinearIssueStatusRequest,
  ): Promise<SyncLinearIssueStatusResponse> {
    const { projectId, organizationId } = request;

    this.requireProjectId(projectId);
    const integration =
      await this.linearService.getIntegrationForOrga(organizationId);
    const rows = await this.issueMappingRepo.find({
      where: this.openTicketRows({
        projectId,
        platform: IssuePlatform.LINEAR,
        linearOrganizationId: integration.linearOrganizationId,
      }),
    });

    const rowsByTicket = new Map<string, VulnerabilityIssueMapping[]>();
    for (const row of rows) {
      if (!row.externalIssueId) continue;
      const ticketRows = rowsByTicket.get(row.externalIssueId) ?? [];
      ticketRows.push(row);
      rowsByTicket.set(row.externalIssueId, ticketRows);
    }
    const ticketIds = [...rowsByTicket.keys()];

    let updated = 0;
    for (let from = 0; from < ticketIds.length; from += STATUS_BATCH_SIZE) {
      // A read: the default retry on a server error is safe.
      const data = await this.linearService.linearCall<IssuesStatusData>(
        integration,
        ISSUES_STATUS_QUERY,
        { ids: ticketIds.slice(from, from + STATUS_BATCH_SIZE) },
      );
      for (const node of data.issues?.nodes ?? []) {
        const ticketRows = node?.id ? rowsByTicket.get(node.id) : undefined;
        if (!ticketRows) continue;
        updated += await this.refreshTicket(integration, node, ticketRows);
      }
    }

    this.logger.log(
      { organizationId, projectId, tickets: ticketIds.length, updated },
      'Linear issue states resynced',
    );
    return { success: true, updated };
  }

  /** The ticket's identifier from what a person typed or pasted, else null. */
  parseIssueRef(ref: string): string | null {
    return parseIssueRef(ref);
  }

  // ========== Target ==========

  /**
   * An absent project id is dropped from a TypeORM filter, which would then
   * match every project of the workspace.
   */
  private requireProjectId(projectId: string | undefined): void {
    if (!projectId) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'projectId is required',
      });
    }
  }

  /**
   * The workspace an organisation is connected to, for a read of the stored
   * links only. It is still answered while the workspace waits to be
   * reconnected (the links are in our database, Linear is not called), unlike
   * getIntegrationForOrga; only a missing connection refuses.
   */
  private async connectedWorkspaceOf(organizationId: string): Promise<string> {
    const installation = await this.linearService.getInstallationForOrga({
      organizationId,
    });
    if (!installation.isConfigured || !installation.linearOrganizationId) {
      throw linearRefusal('LINEAR_NOT_CONNECTED', status.FAILED_PRECONDITION);
    }
    return installation.linearOrganizationId;
  }

  /** The project's settings, when they belong to this organisation's workspace. */
  private async projectConfigOf(
    projectId: string,
    integration: LinearIntegration,
  ): Promise<LinearProjectMapping | null> {
    const config = await this.linearService.findProjectConfig(projectId);
    return config?.integrationId === integration.id ? config : null;
  }

  /**
   * A request without a team is an automatic creation: team, Linear project and
   * labels are the project's settings. A request with a team (a ticket created
   * by hand) uses its own Linear project, labels and assignee, an empty one
   * meaning none.
   */
  private targetOf(
    request: CreateLinearIssuesRequest,
    projectConfig: LinearProjectMapping | null,
  ): Target {
    const assigneeId = request.assigneeId || null;
    if (request.teamId) {
      return {
        teamId: request.teamId,
        linearProjectId: request.linearProjectId || null,
        labelIds: request.labelIds ?? [],
        assigneeId,
      };
    }
    if (!projectConfig?.teamId) {
      throw linearRefusal('LINEAR_NO_TEAM', status.FAILED_PRECONDITION);
    }
    return {
      teamId: projectConfig.teamId,
      linearProjectId: projectConfig.linearProjectId || null,
      labelIds: this.labelIdsOf(projectConfig.labels),
      assigneeId,
    };
  }

  /** The findings on a branch the project's settings allow (all without any). */
  private onAllowedBranches(
    vulnerabilities: VulnerabilityInfo[],
    projectConfig: LinearProjectMapping | null,
  ): VulnerabilityInfo[] {
    const allowed = new Set(
      this.parseJsonArray(projectConfig?.allowedBranches).filter(
        (branch): branch is string => typeof branch === 'string',
      ),
    );
    if (allowed.size === 0) return vulnerabilities;

    const kept = vulnerabilities.filter(
      (v) => !v.branch || allowed.has(v.branch),
    );
    if (kept.length < vulnerabilities.length) {
      this.logger.warn(
        { filtered: vulnerabilities.length - kept.length },
        'Filtered vulnerabilities on branches the Linear settings do not allow',
      );
    }
    return kept;
  }

  private async readTeam(
    integration: LinearIntegration,
    teamId: string,
  ): Promise<LinearTeam> {
    let team: LinearTeam | null | undefined;
    try {
      ({ team } = await this.linearService.linearCall<{
        team?: LinearTeam | null;
      }>(integration, TEAM_QUERY, { teamId }));
    } catch (err) {
      // An id of another workspace's team looks exactly like an unknown one.
      if (this.grpcCodeOf(err) === status.NOT_FOUND) {
        throw linearRefusal('LINEAR_TEAM_NOT_FOUND', status.NOT_FOUND);
      }
      throw err;
    }
    if (!team) {
      throw linearRefusal('LINEAR_TEAM_NOT_FOUND', status.NOT_FOUND);
    }
    return team;
  }

  // ========== Duplicates ==========

  /**
   * Whether the group already has an open Linear ticket, or one of its
   * findings is linked to one. A ticket is open until its state is completed or
   * canceled, or it is deleted.
   */
  private async hasOpenTicket(
    projectId: string,
    creationMode: string,
    groupKey: string,
    vulnIds: string[],
  ): Promise<boolean> {
    const byGroup = await this.issueMappingRepo.findOne({
      where: this.openTicketRows({
        projectId,
        platform: IssuePlatform.LINEAR,
        groupKey: clip(groupKey, MAX_GROUP_KEY, '...'),
        creationMode,
      }),
    });
    if (byGroup) {
      this.logger.log(
        { projectId, linearIssueId: byGroup.externalIssueId },
        'Skipping Linear issue creation: the group already has an open ticket',
      );
      return true;
    }

    const byVulnerability = await this.issueMappingRepo.find({
      where: this.openTicketRows({
        projectId,
        platform: IssuePlatform.LINEAR,
        vulnerabilityId: In(vulnIds),
      }),
    });
    if (byVulnerability.length > 0) {
      this.logger.log(
        { projectId, linked: byVulnerability.length },
        'Skipping Linear issue creation: findings already linked to an open ticket',
      );
      return true;
    }
    return false;
  }

  /** `where` matching the rows of open tickets (a row may have no state type). */
  private openTicketRows(
    where: FindOptionsWhere<VulnerabilityIssueMapping>,
  ): FindOptionsWhere<VulnerabilityIssueMapping>[] {
    const notDeleted = { ...where, issueState: Not(DELETED_STATE) };
    return [
      { ...notDeleted, linearStateType: Not(In(TERMINAL_STATE_TYPES)) },
      { ...notDeleted, linearStateType: IsNull() },
    ];
  }

  /** `where` matching the rows of finished tickets: completed, canceled, deleted. */
  private closedTicketRows(
    where: FindOptionsWhere<VulnerabilityIssueMapping>,
  ): FindOptionsWhere<VulnerabilityIssueMapping>[] {
    return [
      { ...where, linearStateType: In(TERMINAL_STATE_TYPES) },
      { ...where, issueState: DELETED_STATE },
    ];
  }

  private rowsInState(
    scope: FindOptionsWhere<VulnerabilityIssueMapping>,
    state: string | undefined,
  ):
    | FindOptionsWhere<VulnerabilityIssueMapping>
    | FindOptionsWhere<VulnerabilityIssueMapping>[] {
    if (state === 'open') return this.openTicketRows(scope);
    if (state === 'closed') return this.closedTicketRows(scope);
    return scope;
  }

  // ========== Linear calls ==========

  private async createIssue(
    integration: LinearIntegration,
    input: Record<string, unknown>,
  ): Promise<CreatedIssue> {
    // issueCreate is not idempotent: a 5xx may have created the ticket, so it
    // is never retried.
    const data = await this.linearService.linearCall<IssueCreateData>(
      integration,
      ISSUE_CREATE_MUTATION,
      { input },
      { retryOnServerError: false },
    );
    const issue = data.issueCreate?.issue;
    if (!data.issueCreate?.success || !issue?.id) {
      throw new Error('Linear did not create the issue');
    }
    return issue;
  }

  /**
   * A URL of another workspace is refused: its identifier would resolve to this
   * workspace's own ticket of that number, and link the wrong one. The token
   * can only read this workspace, which is why nothing else needs checking.
   */
  private assertInWorkspace(
    issueRef: string,
    integration: LinearIntegration,
  ): void {
    const url = parseIssueUrl(issueRef);
    const workspace = integration.workspaceUrlKey;
    if (
      url &&
      workspace &&
      url.workspace.toLowerCase() !== workspace.toLowerCase()
    ) {
      throw linearRefusal('LINEAR_ISSUE_NOT_FOUND', status.NOT_FOUND);
    }
  }

  private async readIssue(
    integration: LinearIntegration,
    identifier: string,
  ): Promise<LinkedIssue> {
    let issue: LinkedIssue | null | undefined;
    try {
      // A read: the default retry on a server error is safe.
      ({ issue } = await this.linearService.linearCall<{
        issue?: LinkedIssue | null;
      }>(integration, ISSUE_LOOKUP_QUERY, { id: identifier }));
    } catch (err) {
      if (this.grpcCodeOf(err) === status.NOT_FOUND) {
        throw linearRefusal('LINEAR_ISSUE_NOT_FOUND', status.NOT_FOUND);
      }
      throw err;
    }
    if (!issue?.id) {
      throw linearRefusal('LINEAR_ISSUE_NOT_FOUND', status.NOT_FOUND);
    }
    return issue;
  }

  /**
   * The link to the group in CybeDefend, as a rich attachment. A failure is
   * logged and the ticket kept: it exists already.
   */
  private async attachLink(
    integration: LinearIntegration,
    issue: CreatedIssue,
    attachment: { url: string; title: string; subtitle: string },
  ): Promise<void> {
    try {
      // attachmentCreate is idempotent per (issue, URL): the default retry is
      // safe.
      await this.linearService.linearCall(
        integration,
        ATTACHMENT_CREATE_MUTATION,
        { input: { issueId: issue.id, ...attachment } },
      );
    } catch (err) {
      this.logger.warn(
        { linearIssueId: issue.id, reason: this.reasonOf(err) },
        'CybeDefend link could not be attached to the Linear issue',
      );
    }
  }

  // ========== Storage ==========

  private async saveMappings(
    groupVulns: VulnerabilityInfo[],
    issue: CreatedIssue,
    context: {
      projectId: string;
      scanId: string;
      title: string;
      creationMode: string;
      groupKey: string;
      team: LinearTeam;
      integration: LinearIntegration;
    },
  ): Promise<void> {
    const { projectId, creationMode, team, integration } = context;
    const cached = this.cachedTicketFields(issue, team.key, integration);
    for (const vuln of groupVulns) {
      try {
        // doneAt / doneReason (Linear-only columns of this shared table) stay
        // null: a finding is handled later, when it is fixed or ignored.
        await this.issueMappingRepo.save({
          projectId,
          vulnerabilityId: vuln.vulnerabilityId,
          scannerType: vuln.scannerType,
          platform: IssuePlatform.LINEAR,
          externalIssueId: issue.id,
          ...cached,
          // buildTitle keeps it within the column (255).
          issueTitle: context.title,
          scanId: context.scanId,
          groupKey:
            creationMode === 'per_vulnerability'
              ? null
              : clip(context.groupKey, MAX_GROUP_KEY, '...'),
          creationMode,
        });
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        this.logger.log(
          { projectId, vulnerabilityId: vuln.vulnerabilityId },
          'Skipping duplicate Linear issue mapping',
        );
      }
    }
  }

  /**
   * One `linked` row per finding. A finding already linked to this ticket is
   * refreshed in place, keeping how its row was created: linking again must
   * not turn a ticket CybeDefend created into one it only comments on.
   */
  private async saveLinks(
    vulnerabilityIds: string[],
    issue: LinkedIssue,
    context: {
      projectId: string;
      scannerType: string;
      title: string;
      integration: LinearIntegration;
    },
  ): Promise<void> {
    if (vulnerabilityIds.length === 0) return;
    const { projectId, scannerType, title, integration } = context;
    const cached = this.cachedTicketFields(
      issue,
      issue.team?.key ?? '',
      integration,
    );

    const existing = await this.issueMappingRepo.find({
      where: {
        projectId,
        platform: IssuePlatform.LINEAR,
        externalIssueId: issue.id,
        vulnerabilityId: In(vulnerabilityIds),
      },
    });
    if (existing.length > 0) {
      await this.issueMappingRepo.update(
        { id: In(existing.map((row) => row.id)) },
        { ...cached, issueTitle: title },
      );
    }

    const linked = new Set(existing.map((row) => row.vulnerabilityId));
    for (const vulnerabilityId of vulnerabilityIds) {
      if (linked.has(vulnerabilityId)) continue;
      await this.issueMappingRepo.save({
        projectId,
        vulnerabilityId,
        scannerType,
        platform: IssuePlatform.LINEAR,
        externalIssueId: issue.id,
        ...cached,
        issueTitle: title,
        creationMode: 'linked',
      });
    }
  }

  /**
   * Writes what Linear says of a ticket on all its rows of this workspace, when
   * any of the project's rows differs. Returns how many of those rows differed.
   * A deleted ticket is never revived by a read that raced the webhook.
   */
  private async refreshTicket(
    integration: LinearIntegration,
    node: CreatedIssue,
    rows: VulnerabilityIssueMapping[],
  ): Promise<number> {
    const changes = this.changesFrom(node);
    const keys = Object.keys(changes) as Array<keyof TicketChanges>;
    const stale = rows.filter((row) =>
      keys.some((key) => (row[key] ?? '') !== changes[key]),
    );
    if (stale.length === 0) return 0;

    await this.issueMappingRepo.update(
      {
        platform: IssuePlatform.LINEAR,
        externalIssueId: node.id,
        linearOrganizationId: integration.linearOrganizationId,
        issueState: Not(DELETED_STATE),
      },
      changes,
    );
    return stale.length;
  }

  /**
   * What Linear's answer says of the ticket, field by field. A field it did not
   * give is left alone; `assignee: null` is the one way to say unassigned.
   */
  private changesFrom(node: CreatedIssue): TicketChanges {
    const changes: TicketChanges = {};

    if (node.state?.name) {
      changes.issueState = clip(node.state.name, MAX_STATE_NAME);
    }
    if (node.state?.type) {
      changes.linearStateType = clip(node.state.type, MAX_STATE_TYPE);
    }
    if (node.assignee?.name) {
      changes.linearAssignee = clip(node.assignee.name, MAX_ASSIGNEE);
    } else if (node.assignee === null) {
      changes.linearAssignee = '';
    }
    if (node.priorityLabel) {
      changes.linearPriority = clip(node.priorityLabel, MAX_PRIORITY);
    }
    // A ticket moved to another team keeps its id and gets a new identifier,
    // team and URL.
    if (node.team?.key) {
      changes.linearTeamKey = clip(node.team.key, MAX_TEAM_KEY);
    }
    if (node.identifier) {
      changes.linearIdentifier = clip(node.identifier, MAX_IDENTIFIER);
    }
    const url = httpsUrl(node.url);
    if (url) changes.issueUrl = url;

    return changes;
  }

  /**
   * What every row of a ticket caches of its Linear state, from Linear's
   * answer, cut to the columns. `teamKey` stands in when Linear gave none.
   */
  private cachedTicketFields(
    issue: CreatedIssue,
    teamKey: string,
    integration: LinearIntegration,
  ) {
    return {
      linearIdentifier: optionalClip(issue.identifier, MAX_IDENTIFIER),
      issueUrl: httpsUrl(issue.url),
      issueState: clip(issue.state?.name || 'open', MAX_STATE_NAME),
      linearTeamKey: optionalClip(issue.team?.key || teamKey, MAX_TEAM_KEY),
      linearPriority: optionalClip(issue.priorityLabel, MAX_PRIORITY),
      linearAssignee: optionalClip(issue.assignee?.name, MAX_ASSIGNEE),
      linearStateType: optionalClip(issue.state?.type, MAX_STATE_TYPE),
      linearOrganizationId: integration.linearOrganizationId,
    };
  }

  private toIssueInfo(
    issue: CreatedIssue,
    title: string,
    teamKey: string,
    vulnerabilityIds: string[],
  ): IssueInfo {
    const now = new Date().toISOString();
    return {
      issueId: issue.id,
      issueNumber: 0,
      title,
      url: issue.url ?? '',
      state: issue.state?.name ?? '',
      vulnerabilityIds,
      createdAt: now,
      updatedAt: now,
      linearIdentifier: issue.identifier ?? '',
      linearTeamKey: issue.team?.key || teamKey,
      linearPriority: issue.priorityLabel ?? '',
      linearAssignee: issue.assignee?.name ?? '',
      linearStateType: issue.state?.type ?? '',
    };
  }

  // ========== Helpers ==========

  private nothingCreated(
    message: string,
    vulnerabilities: VulnerabilityInfo[],
  ): CreateLinearIssuesResponse {
    return {
      success: false,
      message,
      issues: [],
      failedVulnerabilityIds: vulnerabilities.map((v) => v.vulnerabilityId),
    };
  }

  /** The request's priority when it is one Linear knows, else the severity's. */
  private priorityOf(
    requested: number | undefined,
    severity: string,
  ): LinearPriority {
    if (Number.isInteger(requested) && requested >= 0 && requested <= 4) {
      return requested as LinearPriority;
    }
    return this.descriptionService.severityToPriority(severity);
  }

  /** The highest known severity of the group, '' when none is known. */
  private highestSeverity(vulns: VulnerabilityInfo[]): string {
    const severities = new Set(vulns.map((v) => v.severity?.toLowerCase()));
    return SEVERITY_ORDER.find((level) => severities.has(level)) ?? '';
  }

  /**
   * Linear's rate limit, Linear unavailable, or a workspace to reconnect: every
   * later call of this run would be refused the same way.
   */
  private stopsTheRun(err: unknown): boolean {
    if (!(err instanceof RpcException)) return false;
    const { code, message } = err.getError() as {
      code?: unknown;
      message?: unknown;
    };
    return (
      code === status.RESOURCE_EXHAUSTED ||
      code === status.UNAVAILABLE ||
      message === 'LINEAR_NEEDS_RECONNECT'
    );
  }

  private grpcCodeOf(err: unknown): unknown {
    if (!(err instanceof RpcException)) return undefined;
    return (err.getError() as { code?: unknown })?.code;
  }

  /** What a log may say of a failure: its gRPC code or its class, no text. */
  private reasonOf(err: unknown): string {
    const code = this.grpcCodeOf(err);
    if (typeof code === 'number') return status[code] ?? String(code);
    return err instanceof Error ? err.name : typeof err;
  }

  private labelIdsOf(labels: string | null | undefined): string[] {
    return this.parseJsonArray(labels)
      .map((label) => (label as { id?: unknown })?.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
  }

  private parseJsonArray(json: string | null | undefined): unknown[] {
    if (!json) return [];
    try {
      const parsed: unknown = JSON.parse(json);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private pause(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/** Cut to `max` characters (code points), ending with `ellipsis`. */
function clip(value: string, max: number, ellipsis = ''): string {
  const chars = Array.from(value);
  if (chars.length <= max) return value;
  return `${chars.slice(0, max - ellipsis.length).join('')}${ellipsis}`;
}

function optionalClip(
  value: string | null | undefined,
  max: number,
): string | null {
  return value ? clip(value, max) : null;
}

/** An https URL that fits its column, else null. */
function httpsUrl(value: string | null | undefined): string | null {
  if (!value || value.length > MAX_ISSUE_URL) return null;
  try {
    return new URL(value).protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}

function capitalize(value: string): string {
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : '';
}

/** An issue URL of linear.app: its workspace and the ticket's identifier. */
function parseIssueUrl(
  ref: string,
): { workspace: string; identifier: string } | null {
  let url: URL;
  try {
    url = new URL(ref.trim());
  } catch {
    return null;
  }
  if (
    url.protocol !== 'https:' ||
    url.hostname !== LINEAR_HOST ||
    url.port ||
    url.username ||
    url.password
  ) {
    return null;
  }
  // /<workspace>/issue/<IDENTIFIER>[/<slug>]
  const [workspace, kind, identifier] = url.pathname.split('/').filter(Boolean);
  if (
    !workspace ||
    kind !== 'issue' ||
    !ISSUE_IDENTIFIER.test(identifier ?? '')
  ) {
    return null;
  }
  return { workspace, identifier: identifier.toUpperCase() };
}

/**
 * The identifier (`ENG-142`) of a ticket given as that identifier or as its
 * `https://linear.app/<workspace>/issue/ENG-142/...` URL; null for anything
 * else. Team keys are upper case in Linear, so a lower-case one is accepted.
 */
export function parseIssueRef(ref: string): string | null {
  if (typeof ref !== 'string') return null;
  const trimmed = ref.trim();
  if (ISSUE_IDENTIFIER.test(trimmed)) return trimmed.toUpperCase();
  return parseIssueUrl(trimmed)?.identifier ?? null;
}
