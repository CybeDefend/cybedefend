import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { FindOptionsWhere, In, IsNull, Not, Repository } from 'typeorm';
import { Span } from 'nestjs-otel';
import { Logger } from 'nestjs-pino';
import { LinearIntegration } from '../../entities/linear-integration.entity';
import {
  IssuePlatform,
  VulnerabilityIssueMapping,
} from '../../entities/vulnerability-issue-mapping.entity';
import {
  ApplyLinearFindingStatesRequest,
  ApplyLinearFindingStatesResponse,
} from '@grpc/external-integrations/issue';
import { LinearService } from './linear.service';

type Outcome = 'fixed' | 'ignored' | 'reopened';
type DoneOutcome = Exclude<Outcome, 'reopened'>;

const OUTCOMES: readonly Outcome[] = ['fixed', 'ignored', 'reopened'];

// Terminal Linear state types; a ticket removed in Linear is `deleted` locally.
const TERMINAL_STATE_TYPES = ['completed', 'canceled'];
const DELETED_STATE = 'deleted';

// A row written by linking a finding to an existing ticket. A ticket whose rows
// are all linked was made in Linear by a person: commented on, never closed. A
// ticket with any other row is CybeDefend's, linked occurrences added to it
// included.
const LINKED_MODE = 'linked';

// Widths of the vulnerability_issue_mapping columns written here.
const MAX_STATE_NAME = 255;
const MAX_STATE_TYPE = 16;

// The dismissal reason is at most 512 characters at the gateway.
const MAX_REASON_LENGTH = 512;

const NOTHING_DONE: ApplyLinearFindingStatesResponse = {
  closed: 0,
  commented: 0,
};

// The ticket's own state and the states of the team it is in now: a ticket
// moved to another team since its creation closes in that team's states.
const ISSUE_STATES_QUERY = `query LinearIssueClosingStates($id: String!) {
  issue(id: $id) {
    state { name type }
    team { states(first: 50) { nodes { id name type position } } }
  }
}`;

const CLOSE_ISSUE_MUTATION = `mutation LinearCloseIssue($id: String!, $input: IssueUpdateInput!) {
  issueUpdate(id: $id, input: $input) { success }
}`;

const COMMENT_MUTATION = `mutation LinearCommentIssue($input: CommentCreateInput!) {
  commentCreate(input: $input) { success }
}`;

interface LinearStateNode {
  id: string;
  name: string;
  type: string;
  position: number;
}

interface IssueStatesData {
  issue?: {
    state?: { name?: string | null; type?: string | null } | null;
    team?: { states?: { nodes?: LinearStateNode[] | null } | null } | null;
  } | null;
}

interface IssueUpdateData {
  issueUpdate?: { success?: boolean | null } | null;
}

interface CommentCreateData {
  commentCreate?: { success?: boolean | null } | null;
}

/** One Linear ticket and every row that links a finding to it. */
interface Ticket {
  linearOrganizationId: string;
  issueId: string;
  rows: VulnerabilityIssueMapping[];
}

interface TicketResult {
  closed?: boolean;
  commented?: boolean;
}

function isTerminal(row: VulnerabilityIssueMapping): boolean {
  return (
    row.issueState === DELETED_STATE ||
    TERMINAL_STATE_TYPES.includes(row.linearStateType)
  );
}

function ticketKey(linearOrganizationId: string, issueId: string): string {
  return JSON.stringify([linearOrganizationId, issueId]);
}

/** At most `max` characters (code points, as the column counts them). */
function clip(value: string, max: number): string {
  return Array.from(value).slice(0, max).join('');
}

function findings(count: number): string {
  return `${count} ${count === 1 ? 'finding' : 'findings'}`;
}

/**
 * The dismissal reason as plain text on one line: whitespace collapsed, capped,
 * and every character that could open a Markdown construct (link, image, HTML,
 * heading, code) escaped. Written by a person or by the agent, it is shown, not
 * rendered.
 */
function plainReason(reason: string | undefined): string {
  const oneLine = (reason ?? '').replace(/\s+/g, ' ').trim();
  return clip(oneLine, MAX_REASON_LENGTH).replace(/[\\`*_[\]<>!#|~]/g, '\\$&');
}

function failureCode(err: unknown): unknown {
  if (err instanceof RpcException) {
    const error = err.getError();
    return typeof error === 'object' && error !== null
      ? (error as { code?: unknown }).code
      : undefined;
  }
  return err instanceof Error ? err.name : typeof err;
}

/**
 * Linear unavailable, its rate limit reached, or the workspace to reconnect:
 * every later call of this run would fail the same way.
 */
function stopsTheCall(err: unknown): boolean {
  if (!(err instanceof RpcException)) return false;
  const error = err.getError();
  if (typeof error !== 'object' || error === null) return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  return (
    code === status.UNAVAILABLE ||
    code === status.RESOURCE_EXHAUSTED ||
    message === 'LINEAR_NEEDS_RECONNECT'
  );
}

/**
 * Keeps the Linear tickets in step with what became of their findings in
 * CybeDefend (fixed, ignored, put back to verify). A finding handled marks its
 * row done; a ticket CybeDefend created is closed once every one of its rows is
 * done (occurrences linked to it later included), a ticket a person made in
 * Linear (every row linked) is only commented on, and a closed or deleted
 * ticket is never touched.
 */
@Injectable()
export class LinearFindingStatesService {
  constructor(
    @InjectRepository(VulnerabilityIssueMapping)
    private readonly issueMappingRepo: Repository<VulnerabilityIssueMapping>,
    @InjectRepository(LinearIntegration)
    private readonly integrationRepo: Repository<LinearIntegration>,
    private readonly linearService: LinearService,
    private readonly logger: Logger,
  ) {}

  /**
   * analysis-reporting sends the new state of findings without their previous
   * one, and may send findings already in that state: a row already done the
   * same way changes nothing and is not reported again. A ticket is closed or
   * commented on only for rows this call changes: one whose rows were all done
   * before is left alone even when Linear shows it open, since a person may have
   * reopened it there (a close that failed on a Linear outage is not retried).
   */
  @Span()
  async applyFindingStates(
    request: ApplyLinearFindingStatesRequest,
  ): Promise<ApplyLinearFindingStatesResponse> {
    const { projectId } = request;
    const outcome = OUTCOMES.find((value) => value === request.outcome);
    if (!outcome) {
      this.logger.warn(
        { projectId },
        'Linear finding states ignored: unknown outcome',
      );
      return NOTHING_DONE;
    }
    const vulnerabilityIds = [
      ...new Set((request.vulnerabilityIds ?? []).filter(Boolean)),
    ];
    if (!projectId || vulnerabilityIds.length === 0) return NOTHING_DONE;

    const touched = await this.issueMappingRepo.find({
      where: {
        projectId,
        platform: IssuePlatform.LINEAR,
        vulnerabilityId: In(vulnerabilityIds),
      },
    });
    if (touched.length === 0) return NOTHING_DONE;

    if (outcome === 'reopened') {
      await this.reopen(touched);
      return NOTHING_DONE;
    }
    return this.markDone(touched, outcome, request.reason);
  }

  // ========== Outcomes ==========

  /**
   * The finding is to be dealt with again: its row is no longer done, so its
   * ticket does not close on its account. Never a Linear call, and a closed
   * ticket keeps its rows as they were (a closed ticket is never reopened).
   */
  private async reopen(touched: VulnerabilityIssueMapping[]): Promise<void> {
    const reopened = touched.filter((row) => row.doneAt && !isTerminal(row));
    if (reopened.length === 0) return;
    await this.issueMappingRepo.update(
      { id: In(reopened.map((row) => row.id)) },
      { doneAt: null, doneReason: null },
    );
  }

  private async markDone(
    touched: VulnerabilityIssueMapping[],
    outcome: DoneOutcome,
    reason: string,
  ): Promise<ApplyLinearFindingStatesResponse> {
    // Only a row this call changes counts as handled by it.
    const handledNow = touched.filter(
      (row) => !row.doneAt || row.doneReason !== outcome,
    );
    if (handledNow.length > 0) {
      await this.issueMappingRepo.update(
        { id: In(handledNow.map((row) => row.id)) },
        { doneAt: new Date(), doneReason: outcome },
      );
    }

    const handledIds = new Set(handledNow.map((row) => row.id));
    const shownReason = plainReason(reason);
    const tickets = await this.openTicketsOf(touched);
    const integrations = new Map<string, LinearIntegration | null>();
    const result = { closed: 0, commented: 0 };

    for (const [index, ticket] of tickets.entries()) {
      // Nothing changed on this ticket: no comment, and no close against a
      // person who reopened it in Linear.
      const ticketHandledNow = ticket.rows.filter((row) =>
        handledIds.has(row.id),
      );
      if (ticketHandledNow.length === 0) continue;

      const integration = await this.integrationFor(
        ticket.linearOrganizationId,
        integrations,
      );
      if (!integration) continue;
      try {
        const done = await this.applyToTicket(
          integration,
          ticket,
          ticketHandledNow,
          outcome,
          shownReason,
        );
        if (done.closed) result.closed += 1;
        if (done.commented) result.commented += 1;
      } catch (err) {
        // When Linear refuses every further call, the remaining tickets are
        // not tried, so a slow Linear does not drag the call on (their
        // findings stay handled).
        const stop = stopsTheCall(err);
        this.logger.warn(
          {
            linearOrganizationId: ticket.linearOrganizationId,
            issueId: ticket.issueId,
            code: failureCode(err),
            ...(stop ? { ticketsNotTried: tickets.length - index - 1 } : {}),
          },
          stop
            ? 'Linear issues not updated: Linear refuses every further call'
            : 'Linear issue not updated for its handled findings',
        );
        if (stop) break;
      }
    }
    return result;
  }

  /**
   * Closes a ticket CybeDefend created (any row not linked) once every one of
   * its rows is done; otherwise comments on what this call handled
   * (`handledNow`, never empty).
   */
  private async applyToTicket(
    integration: LinearIntegration,
    ticket: Ticket,
    handledNow: VulnerabilityIssueMapping[],
    outcome: DoneOutcome,
    reason: string,
  ): Promise<TicketResult> {
    const createdByCybedefend = ticket.rows.some(
      (row) => row.creationMode !== LINKED_MODE,
    );
    const closable =
      createdByCybedefend && ticket.rows.every((row) => !!row.doneAt);
    if (closable) {
      const closed = await this.close(
        integration,
        ticket,
        this.closingComment(ticket, handledNow, outcome, reason),
      );
      return { closed };
    }

    await this.comment(
      integration,
      ticket.issueId,
      this.progressComment(ticket, handledNow, outcome, reason),
    );
    return { commented: true };
  }

  /**
   * Moves the ticket to the first `completed` state of its team when at least
   * one finding was fixed, else to the first `canceled` one, then comments. A
   * ticket Linear already shows closed is only recorded so.
   */
  private async close(
    integration: LinearIntegration,
    ticket: Ticket,
    closingComment: string,
  ): Promise<boolean> {
    const context = {
      linearOrganizationId: ticket.linearOrganizationId,
      issueId: ticket.issueId,
    };
    const data = await this.linearService.linearCall<IssueStatesData>(
      integration,
      ISSUE_STATES_QUERY,
      { id: ticket.issueId },
    );
    const issue = data?.issue;
    if (!issue) {
      this.logger.warn(context, 'Linear issue to close was not found');
      return false;
    }

    const current = issue.state;
    if (current?.type && TERMINAL_STATE_TYPES.includes(current.type)) {
      await this.recordState(ticket, current.name ?? '', current.type);
      return false;
    }

    const wanted = ticket.rows.some((row) => row.doneReason === 'fixed')
      ? 'completed'
      : 'canceled';
    const target = (issue.team?.states?.nodes ?? [])
      .filter((state) => state.type === wanted)
      .sort((a, b) => a.position - b.position)[0];
    if (!target) {
      this.logger.warn(
        { ...context, stateType: wanted },
        'Linear team has no state to close the issue in',
      );
      return false;
    }

    // A state change is idempotent: the default retry applies.
    const updated = await this.linearService.linearCall<IssueUpdateData>(
      integration,
      CLOSE_ISSUE_MUTATION,
      { id: ticket.issueId, input: { stateId: target.id } },
    );
    if (!updated?.issueUpdate?.success) {
      this.logger.warn(context, 'Linear refused to close the issue');
      return false;
    }

    // Two calls closing the same ticket at once both get here: only the one
    // that records the close comments on it.
    if (!(await this.recordState(ticket, target.name, target.type))) {
      this.logger.log(context, 'Linear issue close already recorded');
      return false;
    }

    try {
      await this.comment(integration, ticket.issueId, closingComment);
    } catch (err) {
      this.logger.warn(
        { ...context, code: failureCode(err) },
        'Linear issue closed without its closing comment',
      );
    }
    this.logger.log(
      { ...context, stateType: target.type },
      'Linear issue closed: every finding handled',
    );
    return true;
  }

  /** Never retried on a server error: a comment is not idempotent. */
  private async comment(
    integration: LinearIntegration,
    issueId: string,
    body: string,
  ): Promise<void> {
    const data = await this.linearService.linearCall<CommentCreateData>(
      integration,
      COMMENT_MUTATION,
      { input: { issueId, body } },
      { retryOnServerError: false },
    );
    if (!data?.commentCreate?.success) {
      throw new Error('Linear refused the comment');
    }
  }

  // ========== Comments ==========

  /** Counts and the dismissal reason only: never a location, code or value. */
  private closingComment(
    ticket: Ticket,
    handledNow: VulnerabilityIssueMapping[],
    outcome: DoneOutcome,
    reason: string,
  ): string {
    const count = (doneReason: DoneOutcome) =>
      ticket.rows.filter((row) => row.doneReason === doneReason).length;
    return [
      `Handled in CybeDefend: ${count('fixed')} fixed, ${count('ignored')} ignored.`,
      ...this.reasonLines(handledNow, outcome, reason),
    ].join('\n');
  }

  private progressComment(
    ticket: Ticket,
    handledNow: VulnerabilityIssueMapping[],
    outcome: DoneOutcome,
    reason: string,
  ): string {
    const done = ticket.rows.filter((row) => row.doneAt).length;
    return [
      `Handled in CybeDefend: ${findings(handledNow.length)} ${outcome}.`,
      `${done} of ${findings(ticket.rows.length)} linked to this issue are handled.`,
      ...this.reasonLines(handledNow, outcome, reason),
    ].join('\n');
  }

  /** The reason of the findings this call dismissed, if any. */
  private reasonLines(
    handledNow: VulnerabilityIssueMapping[],
    outcome: DoneOutcome,
    reason: string,
  ): string[] {
    if (outcome !== 'ignored' || handledNow.length === 0 || !reason) return [];
    return ['', 'Dismissal reasons:', `- ${reason}`];
  }

  // ========== Storage ==========

  /**
   * The tickets of these rows that are still open, each with all its rows: in
   * every project, since a ticket is done only when every finding linked to it
   * is.
   */
  private async openTicketsOf(
    touched: VulnerabilityIssueMapping[],
  ): Promise<Ticket[]> {
    const wanted = new Set<string>();
    const issueIds = new Set<string>();
    for (const row of touched) {
      if (!row.linearOrganizationId || !row.externalIssueId) continue;
      if (isTerminal(row)) continue;
      wanted.add(ticketKey(row.linearOrganizationId, row.externalIssueId));
      issueIds.add(row.externalIssueId);
    }
    if (wanted.size === 0) return [];

    const rows = await this.issueMappingRepo.find({
      where: {
        platform: IssuePlatform.LINEAR,
        externalIssueId: In([...issueIds]),
      },
    });

    const tickets = new Map<string, Ticket>();
    for (const row of rows) {
      const key = ticketKey(row.linearOrganizationId, row.externalIssueId);
      if (!wanted.has(key)) continue;
      const ticket = tickets.get(key) ?? {
        linearOrganizationId: row.linearOrganizationId,
        issueId: row.externalIssueId,
        rows: [],
      };
      ticket.rows.push(row);
      tickets.set(key, ticket);
    }
    return [...tickets.values()].filter(
      (ticket) => !ticket.rows.some(isTerminal),
    );
  }

  /**
   * Writes the ticket's Linear state on its rows that are not closed or deleted
   * yet. False when there were none: the state was recorded by someone else.
   */
  private async recordState(
    ticket: Ticket,
    stateName: string,
    stateType: string,
  ): Promise<boolean> {
    const ticketRows: FindOptionsWhere<VulnerabilityIssueMapping> = {
      platform: IssuePlatform.LINEAR,
      externalIssueId: ticket.issueId,
      linearOrganizationId: ticket.linearOrganizationId,
      issueState: Not(DELETED_STATE),
    };
    const result = await this.issueMappingRepo.update(
      [
        { ...ticketRows, linearStateType: IsNull() },
        { ...ticketRows, linearStateType: Not(In(TERMINAL_STATE_TYPES)) },
      ],
      {
        issueState: clip(stateName, MAX_STATE_NAME),
        linearStateType: clip(stateType, MAX_STATE_TYPE),
      },
    );
    return (result.affected ?? 0) > 0;
  }

  /**
   * The integration of a workspace, read once per call. None when the workspace
   * is not connected or must be reconnected: its tickets are left as they are,
   * their findings stay handled, and no later call closes them on that account
   * (a ticket is closed only by a call that handles one of its findings).
   */
  private async integrationFor(
    linearOrganizationId: string,
    cache: Map<string, LinearIntegration | null>,
  ): Promise<LinearIntegration | null> {
    if (cache.has(linearOrganizationId)) return cache.get(linearOrganizationId);

    let integration = await this.integrationRepo.findOne({
      where: { linearOrganizationId },
    });
    if (!integration) {
      this.logger.warn(
        { linearOrganizationId },
        'Linear issues not updated: workspace not connected',
      );
    } else if (integration.needsReconnect) {
      this.logger.warn(
        { linearOrganizationId },
        'Linear issues not updated: workspace must be reconnected',
      );
      integration = null;
    }
    cache.set(linearOrganizationId, integration);
    return integration;
  }
}
