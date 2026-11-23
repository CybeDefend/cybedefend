import { createHmac, timingSafeEqual } from 'crypto';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { Span } from 'nestjs-otel';
import { Logger } from 'nestjs-pino';
import SecretsService from '../../core/secrets/secrets.service';
import { LinearIntegration } from '../../entities/linear-integration.entity';
import {
  IssuePlatform,
  VulnerabilityIssueMapping,
} from '../../entities/vulnerability-issue-mapping.entity';
import {
  LinearWebhookEventRequest,
  LinearWebhookResponse,
} from '@grpc/external-integrations/linear';
import { LinearService } from './linear.service';

// A delivery older than this (or dated further ahead) may be a replay.
const MAX_TIMESTAMP_SKEW_MS = 60_000;

// Widths of the vulnerability_issue_mapping columns this service writes: a
// longer value would fail the UPDATE, and Linear stops delivering to a webhook
// that keeps failing.
const MAX_STATE_NAME = 255;
const MAX_STATE_TYPE = 16;
const MAX_PRIORITY = 32;
const MAX_TEAM_KEY = 16;
const MAX_IDENTIFIER = 32;
const MAX_ASSIGNEE = 255;
const MAX_ISSUE_URL = 255;

const DELETED_STATE = 'deleted';

const UNAUTHORIZED: LinearWebhookResponse = {
  success: false,
  message: 'Unauthorized',
};
const INVALID_JSON: LinearWebhookResponse = {
  success: false,
  message: 'Invalid JSON',
};
const STALE: LinearWebhookResponse = {
  success: false,
  message: 'Stale webhook',
};
const PROCESSED: LinearWebhookResponse = {
  success: true,
  message: 'Webhook processed',
};
const IGNORED: LinearWebhookResponse = {
  success: true,
  message: 'Webhook ignored',
};

type Payload = Record<string, unknown>;

type IssueChanges = Partial<
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

function isRecord(value: unknown): value is Payload {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A non-empty string, else undefined: an absent field is never a value. */
function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** At most `max` characters (code points, as the column counts them). */
function clip(value: string, max: number): string {
  return Array.from(value).slice(0, max).join('');
}

/** An https URL that fits its column, else undefined. */
function httpsUrl(value: unknown): string | undefined {
  const url = text(value);
  if (!url || url.length > MAX_ISSUE_URL) return undefined;
  try {
    return new URL(url).protocol === 'https:' ? url : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Linear's signed webhook: keeps the cached state of the tickets we created in
 * step with Linear (state, assignee, priority, team, identifier and URL after a
 * move, deletion), and notes an uninstalled app. Linear's `organizationId` is
 * the workspace, so every write is scoped by it: an issue id alone is never
 * enough to reach a row.
 */
@Injectable()
export class LinearWebhookService {
  constructor(
    @InjectRepository(LinearIntegration)
    private readonly integrationRepo: Repository<LinearIntegration>,
    @InjectRepository(VulnerabilityIssueMapping)
    private readonly issueMappingRepo: Repository<VulnerabilityIssueMapping>,
    private readonly linearService: LinearService,
    private readonly configService: ConfigService,
    private readonly secretsService: SecretsService,
    private readonly logger: Logger,
  ) {}

  @Span()
  async handleWebhook(
    request: LinearWebhookEventRequest,
    now: number = Date.now(),
  ): Promise<LinearWebhookResponse> {
    if (!(await this.isSigned(request))) {
      this.logger.warn('Linear webhook refused: signature missing or invalid');
      return UNAUTHORIZED;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(request.rawBody);
    } catch {
      return INVALID_JSON;
    }
    if (!isRecord(payload)) return INVALID_JSON;

    const sentAt = payload.webhookTimestamp;
    if (
      typeof sentAt !== 'number' ||
      !Number.isFinite(sentAt) ||
      Math.abs(now - sentAt) > MAX_TIMESTAMP_SKEW_MS
    ) {
      this.logger.warn('Linear webhook refused: timestamp out of range');
      return STALE;
    }

    const linearOrganizationId = text(payload.organizationId);
    if (!linearOrganizationId) return IGNORED;

    const { type, action } = payload;
    if (type === 'OAuthApp' && action === 'revoked') {
      return this.onAppRevoked(linearOrganizationId);
    }
    if (type === 'Issue' && (action === 'update' || action === 'remove')) {
      return this.onIssue(payload, action, linearOrganizationId);
    }
    return IGNORED;
  }

  // ========== Events ==========

  /**
   * The workspace uninstalled the app: its tokens are dead. Nothing is deleted,
   * settings and ticket links are found again when the workspace reconnects.
   */
  private async onAppRevoked(
    linearOrganizationId: string,
  ): Promise<LinearWebhookResponse> {
    if (!(await this.isKnownWorkspace(linearOrganizationId))) return IGNORED;
    await this.linearService.markNeedsReconnect(linearOrganizationId);
    return PROCESSED;
  }

  private async onIssue(
    payload: Payload,
    action: 'update' | 'remove',
    linearOrganizationId: string,
  ): Promise<LinearWebhookResponse> {
    const data = isRecord(payload.data) ? payload.data : undefined;
    const issueId = text(data?.id);
    if (!data || !issueId) return IGNORED;
    if (!(await this.isKnownWorkspace(linearOrganizationId))) return IGNORED;

    const changes: IssueChanges =
      action === 'remove'
        ? { issueState: DELETED_STATE }
        : this.changesFrom(data, payload);
    if (Object.keys(changes).length === 0) return PROCESSED;

    // The workspace is part of the key: the same issue id in another
    // workspace's payload reaches that workspace's rows, never these.
    const result = await this.issueMappingRepo.update(
      {
        platform: IssuePlatform.LINEAR,
        externalIssueId: issueId,
        linearOrganizationId,
      },
      changes,
    );
    this.logger.log(
      { linearOrganizationId, issueId, action, affected: result.affected ?? 0 },
      'Linear issue webhook applied',
    );
    return PROCESSED;
  }

  /**
   * What the payload says about the issue, field by field. An absent or empty
   * field is left alone (the row keeps what it had); `assignee: null` is the
   * one way to say unassigned.
   */
  private changesFrom(data: Payload, envelope: Payload): IssueChanges {
    const changes: IssueChanges = {};

    const state = isRecord(data.state) ? data.state : undefined;
    const stateName = text(state?.name);
    if (stateName) changes.issueState = clip(stateName, MAX_STATE_NAME);
    const stateType = text(state?.type);
    if (stateType) changes.linearStateType = clip(stateType, MAX_STATE_TYPE);

    const assignee = isRecord(data.assignee)
      ? text(data.assignee.name)
      : undefined;
    if (assignee) {
      changes.linearAssignee = clip(assignee, MAX_ASSIGNEE);
    } else if (data.assignee === null || data.assigneeId === null) {
      changes.linearAssignee = '';
    }

    const priority = text(data.priorityLabel);
    if (priority) changes.linearPriority = clip(priority, MAX_PRIORITY);

    // A ticket moved to another team keeps its id and gets a new identifier,
    // team and URL: the existing rows follow it.
    const team = isRecord(data.team) ? data.team : undefined;
    const teamKey = text(team?.key);
    if (teamKey) changes.linearTeamKey = clip(teamKey, MAX_TEAM_KEY);
    const identifier = text(data.identifier);
    if (identifier) changes.linearIdentifier = clip(identifier, MAX_IDENTIFIER);
    const url = httpsUrl(data.url) ?? httpsUrl(envelope.url);
    if (url) changes.issueUrl = url;

    return changes;
  }

  private async isKnownWorkspace(
    linearOrganizationId: string,
  ): Promise<boolean> {
    const integration = await this.integrationRepo.findOne({
      where: { linearOrganizationId },
    });
    if (!integration) {
      this.logger.debug(
        { linearOrganizationId },
        'Linear webhook for a workspace that is not connected',
      );
    }
    return !!integration;
  }

  // ========== Signature ==========

  /**
   * Linear signs the raw body: hex HMAC-SHA256 with the app's signing secret,
   * in the Linear-Signature header. Without a configured secret nothing is
   * accepted, whatever the signature.
   */
  private async isSigned(request: LinearWebhookEventRequest): Promise<boolean> {
    const { rawBody, signature } = request;
    if (typeof rawBody !== 'string' || !text(signature)) return false;

    const secret = await this.getSecretOrEnv('LINEAR_WEBHOOK_SECRET');
    if (!secret) {
      this.logger.error('LINEAR_WEBHOOK_SECRET is not configured');
      return false;
    }

    const expected = Buffer.from(
      createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex'),
    );
    const received = Buffer.from(signature);
    return (
      received.length === expected.length && timingSafeEqual(received, expected)
    );
  }

  private async getSecretOrEnv(key: string): Promise<string | undefined> {
    if (this.configService.get<string>('NODE_ENV') === 'development') {
      const envValue = this.configService.get<string>(key);
      if (envValue) return envValue;
    }
    await this.secretsService.ensureCacheLoaded();
    return this.secretsService.getSecret(key);
  }
}
