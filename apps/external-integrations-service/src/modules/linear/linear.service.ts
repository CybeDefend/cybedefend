import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { Span } from 'nestjs-otel';
import { Logger } from 'nestjs-pino';
import { isDeadlock, isUniqueViolation } from '@cybedefend/db-dialect';
import SecretsService from '../../core/secrets/secrets.service';
import { TokenCipherService } from '../../core/crypto/token-cipher.service';
import { LinearIntegration } from '../../entities/linear-integration.entity';
import { LinearProjectMapping } from '../../entities/linear-project-mapping.entity';
import {
  IssuePlatform,
  VulnerabilityIssueMapping,
} from '../../entities/vulnerability-issue-mapping.entity';
import {
  DisconnectLinearRequest,
  GenerateLinearOAuthUrlRequest,
  GenerateLinearOAuthUrlResponse,
  GetLinearInstallationForOrgaRequest,
  GetLinearInstallationForOrgaResponse,
  GetLinearTeamOptionsRequest,
  GetLinearTeamOptionsResponse,
  GetProjectLinearConfigRequest,
  GetProjectLinearConfigResponse,
  LinearCallbackInstallRequest,
  LinearCallbackInstallResponse,
  LinearGenericResponse,
  LinearOptionDto,
  ListLinearTeamsRequest,
  ListLinearTeamsResponse,
  RemoveProjectLinearConfigRequest,
  SetProjectLinearConfigRequest,
} from '@grpc/external-integrations/linear';
import {
  LinearApiClient,
  LinearApiError,
  LinearTokenSet,
} from './linear-api.client';
import { linearRefusal } from './linear-refusals';

/** The refusal of the Linear connect route on an instance without a Linear OAuth app. */
export const LINEAR_NOT_CONFIGURED = 'LINEAR_NOT_CONFIGURED';

const LINEAR_AUTHORIZE_URL = 'https://linear.app/oauth/authorize';
// `write` covers issues, comments and attachments; webhooks belong to the app,
// so `admin` is not asked for.
const LINEAR_SCOPES = 'read,write';

// Refresh a token that expires within this window.
const TOKEN_EXPIRY_BUFFER_MS = 300_000;

const VIEWER_WORKSPACE_QUERY = `query LinearWorkspace {
  viewer { organization { id name urlKey } }
}`;

const DISCONNECTED_MESSAGE = 'Linear integration disconnected';

// Connections are read 50 at a time and stop at this many items (five pages): a
// bound on the calls one request can make, and on what a select offers.
const MAX_LISTED_ITEMS = 250;

const TEAMS_QUERY = `query LinearTeams($after: String) {
  teams(first: 50, after: $after) {
    nodes { id key name }
    pageInfo { hasNextPage endCursor }
  }
}`;

const TEAM_QUERY = `query LinearTeam($teamId: String!) {
  team(id: $teamId) { id key name }
}`;

const TEAM_PROJECTS_QUERY = `query LinearTeamProjects($teamId: String!, $after: String) {
  team(id: $teamId) {
    projects(first: 50, after: $after) {
      nodes { id name }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

const TEAM_LABELS_QUERY = `query LinearTeamLabels($teamId: String!, $after: String) {
  team(id: $teamId) {
    labels(first: 50, after: $after) {
      nodes { id name }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

// The labels of the whole workspace are the ones that belong to no team.
const WORKSPACE_LABELS_QUERY = `query LinearWorkspaceLabels($after: String) {
  issueLabels(first: 50, after: $after, filter: { team: { null: true } }) {
    nodes { id name }
    pageInfo { hasNextPage endCursor }
  }
}`;

const TEAM_MEMBERS_QUERY = `query LinearTeamMembers($teamId: String!, $after: String) {
  team(id: $teamId) {
    members(first: 50, after: $after) {
      nodes { id name displayName active app }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

interface ViewerWorkspace {
  viewer?: {
    organization?: { id?: string; name?: string; urlKey?: string } | null;
  } | null;
}

interface Connection<N> {
  nodes?: N[] | null;
  pageInfo?: {
    hasNextPage?: boolean | null;
    endCursor?: string | null;
  } | null;
}

interface TeamData<T> {
  team?: T | null;
}

interface LinearNamed {
  id: string;
  name: string;
}

interface LinearTeamNode extends LinearNamed {
  key: string;
}

interface LinearMemberNode extends LinearNamed {
  displayName?: string | null;
  active?: boolean | null;
  app?: boolean | null;
}

type StoredTokens = Pick<
  LinearIntegration,
  'accessToken' | 'refreshToken' | 'tokenExpiresAt'
>;

interface Workspace {
  id: string;
  name: string;
  urlKey: string;
}

interface TokenPair {
  accessToken: string | null;
  refreshToken: string | null;
}

interface InstallOutcome {
  /** The organisation the workspace's row belongs to after the install. */
  ownerOrganizationId: string;
  /** The workspace the organisation was connected to before, now dropped. */
  replaced: { linearOrganizationId: string; storedTokens: TokenPair } | null;
}

// Two installs committing at the same time: gap locks taken by the locked
// reads of a missing row (REPEATABLE READ), or the same new row inserted
// twice. A deadlock or a unique violation, on either engine.
function isInstallRace(err: unknown): boolean {
  return isDeadlock(err) || isUniqueViolation(err);
}

/**
 * The Linear connection of an organisation: OAuth install, token refresh and
 * disconnect. One Linear workspace per organisation, and one organisation per
 * workspace (Linear keeps a single app token per workspace).
 */
@Injectable()
export class LinearService {
  constructor(
    @InjectRepository(LinearIntegration)
    private readonly integrationRepo: Repository<LinearIntegration>,
    @InjectRepository(LinearProjectMapping)
    private readonly projectMappingRepo: Repository<LinearProjectMapping>,
    @InjectRepository(VulnerabilityIssueMapping)
    private readonly issueMappingRepo: Repository<VulnerabilityIssueMapping>,
    private readonly linearApi: LinearApiClient,
    private readonly tokenCipher: TokenCipherService,
    private readonly configService: ConfigService,
    private readonly secretsService: SecretsService,
    private readonly logger: Logger,
  ) {}

  // ========== OAuth ==========

  generateOAuthUrl(
    request: GenerateLinearOAuthUrlRequest,
  ): GenerateLinearOAuthUrlResponse {
    const clientId = this.getSecretOrEnv('LINEAR_CLIENT_ID');
    // Linear is optional on an instance: without its OAuth app the connect
    // route answers a stable configuration refusal, not a server error.
    if (!clientId) {
      throw new RpcException({
        code: status.FAILED_PRECONDITION,
        message: LINEAR_NOT_CONFIGURED,
      });
    }

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: request.redirectUri,
      response_type: 'code',
      scope: LINEAR_SCOPES,
      state: request.state,
      actor: 'app',
      prompt: 'consent',
    });
    return { installUrl: `${LINEAR_AUTHORIZE_URL}?${params.toString()}` };
  }

  /**
   * Trades the code for an app token and stores it with the workspace it opens.
   *
   * A workspace already linked to another organisation: Linear has just issued
   * a new token for it (and may have invalidated the one that organisation
   * holds). The token belongs to the app and the workspace, not to whoever
   * obtained it, so it goes on that organisation's row, which keeps working,
   * and the requesting organisation is refused.
   *
   * The organisation connected to another workspace before: that workspace is
   * disconnected first (its ticket links and the project settings, which name
   * its teams, are deleted, and its grant revoked), then the new one installed.
   */
  @Span()
  async callbackInstall(
    request: LinearCallbackInstallRequest,
  ): Promise<LinearCallbackInstallResponse> {
    const { organizationId, userId, code, redirectUri } = request;

    let tokenSet: LinearTokenSet;
    let workspace: Workspace;
    let tokens: StoredTokens;
    try {
      tokenSet = await this.linearApi.exchangeCode(code, redirectUri);
      workspace = await this.readWorkspace(tokenSet.accessToken);
      tokens = await this.storedTokens(
        tokenSet.accessToken,
        tokenSet.refreshToken,
        tokenSet.expiresInSeconds,
      );
    } catch (err) {
      throw this.linearApi.toRpcException(err);
    }

    let outcome: InstallOutcome;
    try {
      outcome = await this.saveInstallationRetryingRaces(
        organizationId,
        userId,
        workspace,
        tokens,
      );
    } catch (err) {
      // Nothing was stored: the token just issued must not stay valid.
      this.logger.error(
        {
          organizationId,
          linearOrganizationId: workspace.id,
          dbErrorCode: this.dbErrorCode(err),
        },
        'Linear installation could not be saved, revoking the new token',
      );
      await this.revokeQuietly(tokenSet, {
        organizationId,
        linearOrganizationId: workspace.id,
      });
      throw this.linearApi.toRpcException(err);
    }

    const { ownerOrganizationId, replaced } = outcome;
    if (replaced) {
      this.logger.warn(
        {
          organizationId,
          previousLinearOrganizationId: replaced.linearOrganizationId,
          linearOrganizationId: workspace.id,
        },
        'Linear workspace replaced: the previous one was disconnected',
      );
      await this.revokeStoredQuietly(replaced.storedTokens, {
        organizationId,
        linearOrganizationId: replaced.linearOrganizationId,
      });
    }

    if (ownerOrganizationId !== organizationId) {
      this.logger.warn(
        {
          linearOrganizationId: workspace.id,
          ownerOrganizationId,
          requestingOrganizationId: organizationId,
        },
        'Linear workspace already linked to another organization: new token stored on its owner, request refused',
      );
      throw linearRefusal('LINEAR_WORKSPACE_TAKEN', status.ALREADY_EXISTS);
    }

    this.logger.log(
      { organizationId, linearOrganizationId: workspace.id },
      'Linear integration installed',
    );
    return { returnUri: redirectUri };
  }

  // ========== Installation ==========

  @Span()
  async getInstallationForOrga(
    request: GetLinearInstallationForOrgaRequest,
  ): Promise<GetLinearInstallationForOrgaResponse> {
    const integration = await this.integrationRepo.findOne({
      where: { organizationId: request.organizationId },
    });

    // A presence probe: absence is not an error (see JiraService).
    if (!integration) {
      return {
        isConfigured: false,
        id: '',
        linearOrganizationId: '',
        workspaceName: '',
        workspaceUrlKey: '',
        organizationId: '',
        installedByUserId: '',
        needsReconnect: false,
        createdAt: '',
        updatedAt: '',
      };
    }

    return {
      isConfigured: true,
      id: integration.id,
      linearOrganizationId: integration.linearOrganizationId,
      workspaceName: integration.workspaceName,
      workspaceUrlKey: integration.workspaceUrlKey,
      organizationId: integration.organizationId,
      installedByUserId: integration.installedByUserId || '',
      // A tinyint comes back from MySQL as 0 or 1.
      needsReconnect: Boolean(integration.needsReconnect),
      createdAt: integration.createdAt.toISOString(),
      updatedAt: integration.updatedAt.toISOString(),
    };
  }

  /**
   * The integration a Linear call works with. Refuses when there is none, or
   * when its token was rejected for good and the workspace must be connected
   * again.
   */
  async getIntegrationForOrga(
    organizationId: string,
  ): Promise<LinearIntegration> {
    const integration = await this.integrationRepo.findOne({
      where: { organizationId },
    });
    if (!integration) {
      throw linearRefusal('LINEAR_NOT_CONNECTED', status.FAILED_PRECONDITION);
    }
    if (integration.needsReconnect) {
      throw linearRefusal('LINEAR_NEEDS_RECONNECT', status.FAILED_PRECONDITION);
    }
    return integration;
  }

  // ========== Calls ==========

  /**
   * One GraphQL call with the integration's token, refreshed first when it
   * expires soon. A token Linear refuses is refreshed once and the call retried
   * once; a refresh Linear refuses for good marks the integration to reconnect.
   *
   * Every refresh runs under a row lock, so concurrent calls refresh once:
   * Linear rotates the refresh token, a second refresh would replay a consumed
   * one. The caller's `integration` carries the new token afterwards.
   *
   * `options` goes to LinearApiClient.graphql: a mutation that is not
   * idempotent passes `{ retryOnServerError: false }`.
   */
  async linearCall<T>(
    integration: LinearIntegration,
    query: string,
    variables?: Record<string, unknown>,
    options?: { retryOnServerError?: boolean },
  ): Promise<T> {
    const accessToken = await this.accessTokenFor(integration);
    try {
      return await this.linearApi.graphql<T>(
        accessToken,
        query,
        variables,
        options,
      );
    } catch (err) {
      if (!this.isKind(err, 'unauthorized')) {
        throw this.linearApi.toRpcException(err);
      }
    }

    const renewedToken = await this.lockedAccessToken(integration, accessToken);
    try {
      return await this.linearApi.graphql<T>(
        renewedToken,
        query,
        variables,
        options,
      );
    } catch (err) {
      if (this.isKind(err, 'unauthorized')) {
        await this.markNeedsReconnect(integration.linearOrganizationId);
        throw linearRefusal(
          'LINEAR_NEEDS_RECONNECT',
          status.FAILED_PRECONDITION,
        );
      }
      throw this.linearApi.toRpcException(err);
    }
  }

  /**
   * The workspace must be connected again (refresh refused, app uninstalled on
   * the Linear side). Nothing is deleted: project settings and ticket links are
   * found again on reconnection.
   */
  async markNeedsReconnect(linearOrganizationId: string): Promise<void> {
    await this.integrationRepo.update(
      { linearOrganizationId },
      { needsReconnect: true },
    );
    this.logger.warn(
      { linearOrganizationId },
      'Linear integration must be reconnected',
    );
  }

  // ========== Teams ==========

  @Span()
  async listTeams(
    request: ListLinearTeamsRequest,
  ): Promise<ListLinearTeamsResponse> {
    const integration = await this.getIntegrationForOrga(
      request.organizationId,
    );
    const teams = await this.listAll<
      { teams?: Connection<LinearTeamNode> },
      LinearTeamNode
    >(integration, TEAMS_QUERY, {}, (data) => data.teams);
    return { teams: teams.map(({ id, key, name }) => ({ id, key, name })) };
  }

  /**
   * What a settings screen or a ticket form can choose in a team: its Linear
   * projects, its labels together with the workspace's, and the members a
   * ticket can be assigned to (active people, never an app).
   */
  @Span()
  async getTeamOptions(
    request: GetLinearTeamOptionsRequest,
  ): Promise<GetLinearTeamOptionsResponse> {
    const { teamId } = request;
    this.requireValue(teamId, 'teamId');
    const integration = await this.getIntegrationForOrga(
      request.organizationId,
    );

    const [projects, labels, members] = await Promise.all([
      this.teamProjects(integration, teamId),
      this.teamAndWorkspaceLabels(integration, teamId),
      this.teamMembers(integration, teamId),
    ]);
    return {
      projects: this.toOptions(projects),
      labels: this.toOptions(labels),
      members: members
        .filter((member) => member.active !== false && member.app !== true)
        .map((member) => ({
          id: member.id,
          name: member.name ?? '',
          displayName: member.displayName ?? '',
        })),
    };
  }

  // ========== Per-project settings ==========

  /**
   * Replaces the project's Linear settings with the ones sent: the dashboard
   * sends the whole configuration on every change, so an empty Linear project,
   * an empty label list or an empty branch list clear what was stored.
   *
   * The team, project and labels are looked up in the connected workspace, and
   * their names are taken from Linear's answer, never from the request.
   */
  @Span()
  async setProjectLinearConfig(
    request: SetProjectLinearConfigRequest,
  ): Promise<LinearGenericResponse> {
    const { organizationId, projectId, linearProjectId } = request;
    this.requireValue(projectId, 'projectId');
    this.requireValue(request.teamId, 'teamId');
    const integration = await this.getIntegrationForOrga(organizationId);

    const team = await this.inTeam(async () => {
      const data = await this.linearCall<TeamData<LinearTeamNode>>(
        integration,
        TEAM_QUERY,
        { teamId: request.teamId },
      );
      return this.requireTeam(data.team);
    });

    let linearProject: LinearNamed | null = null;
    if (linearProjectId) {
      const projects = await this.teamProjects(integration, team.id);
      linearProject = projects.find((p) => p.id === linearProjectId) ?? null;
      if (!linearProject) {
        throw new RpcException({
          code: status.INVALID_ARGUMENT,
          message: 'Linear project does not belong to the team',
        });
      }
    }

    const labels = await this.resolveLabels(
      integration,
      team.id,
      request.labelIds ?? [],
    );

    const allowedBranches = request.allowedBranches ?? [];
    await this.upsertProjectMapping(integration, projectId, {
      teamId: team.id,
      teamKey: team.key,
      teamName: team.name,
      linearProjectId: linearProject?.id ?? null,
      linearProjectName: linearProject?.name ?? null,
      labels: labels.length > 0 ? JSON.stringify(labels) : null,
      allowedBranches:
        allowedBranches.length > 0 ? JSON.stringify(allowedBranches) : null,
      autoCreateEnabled: Boolean(request.autoCreateEnabled),
    });

    this.logger.log(
      { organizationId, projectId, linearTeamId: team.id },
      'Linear project settings saved',
    );
    return { success: true, message: 'Linear project settings saved' };
  }

  /**
   * The project's settings, `isConfigured: false` when it has none or belongs to
   * another organisation: a read never fails for lack of settings. It does not
   * need a usable connection, a workspace to reconnect still has its settings.
   */
  @Span()
  async getProjectLinearConfig(
    request: GetProjectLinearConfigRequest,
  ): Promise<GetProjectLinearConfigResponse> {
    const mapping = await this.findProjectConfig(request.projectId);
    if (
      !mapping ||
      !request.organizationId ||
      mapping.integration?.organizationId !== request.organizationId
    ) {
      return {
        isConfigured: false,
        teamId: '',
        teamKey: '',
        teamName: '',
        linearProjectId: '',
        linearProjectName: '',
        labels: [],
        allowedBranches: [],
        autoCreateEnabled: false,
      };
    }

    return {
      isConfigured: true,
      teamId: mapping.teamId,
      teamKey: mapping.teamKey,
      teamName: mapping.teamName,
      linearProjectId: mapping.linearProjectId ?? '',
      linearProjectName: mapping.linearProjectName ?? '',
      labels: this.parseLabels(mapping.labels),
      allowedBranches: this.parseBranches(mapping.allowedBranches),
      // A tinyint comes back from MySQL as 0 or 1.
      autoCreateEnabled: Boolean(mapping.autoCreateEnabled),
    };
  }

  /** Removes the project's settings, and nothing else (the connection stays). */
  @Span()
  async removeProjectLinearConfig(
    request: RemoveProjectLinearConfigRequest,
  ): Promise<LinearGenericResponse> {
    const mapping = await this.findProjectConfig(request.projectId);
    if (!mapping) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'No Linear config found for this project',
      });
    }
    if (mapping.integration?.organizationId !== request.organizationId) {
      throw new RpcException({
        code: status.PERMISSION_DENIED,
        message: 'Permission denied',
      });
    }

    await this.projectMappingRepo.remove(mapping);
    this.logger.log(
      { organizationId: request.organizationId, projectId: request.projectId },
      'Linear project settings removed',
    );
    return { success: true, message: 'Linear project settings removed' };
  }

  /**
   * The Linear settings of a CybeDefend project with their integration, or null.
   * The caller checks that the integration is the organisation's.
   */
  async findProjectConfig(
    projectId: string,
  ): Promise<LinearProjectMapping | null> {
    // An undefined id would match every row: TypeORM drops it from the filter.
    if (!projectId) return null;
    return this.projectMappingRepo.findOne({
      where: { projectId },
      relations: ['integration'],
    });
  }

  // ========== Disconnect ==========

  /**
   * The organisation's explicit decision: revoke both stored tokens at Linear
   * (a failure is logged and does not stop the disconnect), then delete the
   * integration, its project settings and its finding-ticket links. Idempotent.
   */
  @Span()
  async disconnect(
    request: DisconnectLinearRequest,
  ): Promise<LinearGenericResponse> {
    const { organizationId } = request;
    const integration = await this.integrationRepo.findOne({
      where: { organizationId },
    });
    if (!integration) {
      this.logger.log(
        { organizationId },
        'Linear integration already disconnected',
      );
      return { success: true, message: DISCONNECTED_MESSAGE };
    }

    await this.revokeStoredQuietly(integration, {
      organizationId,
      linearOrganizationId: integration.linearOrganizationId,
    });

    await this.issueMappingRepo.delete({
      platform: IssuePlatform.LINEAR,
      linearOrganizationId: integration.linearOrganizationId,
    });
    await this.projectMappingRepo.delete({ integrationId: integration.id });
    await this.integrationRepo.remove(integration);

    this.logger.log(
      {
        organizationId,
        linearOrganizationId: integration.linearOrganizationId,
      },
      'Linear integration disconnected',
    );
    return { success: true, message: DISCONNECTED_MESSAGE };
  }

  // ========== Internals ==========

  private getSecretOrEnv(key: string): string | undefined {
    if (this.configService.get<string>('NODE_ENV') === 'development') {
      const envValue = this.configService.get<string>(key);
      if (envValue) return envValue;
    }
    return this.secretsService.getSecret(key);
  }

  private async readWorkspace(accessToken: string): Promise<Workspace> {
    const data = await this.linearApi.graphql<ViewerWorkspace>(
      accessToken,
      VIEWER_WORKSPACE_QUERY,
    );
    const organization = data.viewer?.organization;
    if (!organization?.id) {
      this.logger.error('Linear viewer answer carries no workspace');
      throw new LinearApiError('unavailable', 'Linear returned no workspace');
    }
    return {
      id: organization.id,
      name: organization.name ?? '',
      urlKey: organization.urlKey ?? '',
    };
  }

  private async storedTokens(
    accessToken: string,
    refreshToken: string | null,
    expiresInSeconds: number,
  ): Promise<StoredTokens> {
    return {
      accessToken: await this.tokenCipher.encrypt(accessToken),
      refreshToken: refreshToken
        ? await this.tokenCipher.encrypt(refreshToken)
        : null,
      tokenExpiresAt: new Date(Date.now() + expiresInSeconds * 1000),
    };
  }

  private isFresh(tokenExpiresAt: Date | null | undefined): boolean {
    return (
      !!tokenExpiresAt &&
      tokenExpiresAt.getTime() > Date.now() + TOKEN_EXPIRY_BUFFER_MS
    );
  }

  private isKind(err: unknown, kind: LinearApiError['kind']): boolean {
    return err instanceof LinearApiError && err.kind === kind;
  }

  private async accessTokenFor(
    integration: LinearIntegration,
  ): Promise<string> {
    if (this.isFresh(integration.tokenExpiresAt)) {
      return this.tokenCipher.decrypt(integration.accessToken);
    }
    return this.lockedAccessToken(integration);
  }

  /**
   * Reads the integration under a `pessimistic_write` lock and returns a token
   * to use, refreshing it unless the locked row already holds a usable one:
   * another call may have refreshed it while this one waited for the lock.
   *
   * `rejectedToken` is the token Linear has just refused: the stored token is
   * usable only if it is a different one.
   */
  private async lockedAccessToken(
    integration: LinearIntegration,
    rejectedToken?: string,
  ): Promise<string> {
    let renewed: { accessToken: string; stored: StoredTokens };
    try {
      renewed = await this.integrationRepo.manager.transaction(async (em) => {
        const locked = await em.findOne(LinearIntegration, {
          where: { id: integration.id },
          lock: { mode: 'pessimistic_write' },
        });
        if (!locked) {
          throw linearRefusal(
            'LINEAR_NOT_CONNECTED',
            status.FAILED_PRECONDITION,
          );
        }

        const storedToken = await this.tokenCipher.decrypt(locked.accessToken);
        if (
          this.isFresh(locked.tokenExpiresAt) &&
          storedToken !== rejectedToken
        ) {
          return { accessToken: storedToken, stored: locked };
        }
        return this.refreshTokens(locked, em);
      });
    } catch (err) {
      if (this.isKind(err, 'invalid_grant')) {
        await this.markNeedsReconnect(integration.linearOrganizationId);
        throw linearRefusal(
          'LINEAR_NEEDS_RECONNECT',
          status.FAILED_PRECONDITION,
        );
      }
      throw this.linearApi.toRpcException(err);
    }

    integration.accessToken = renewed.stored.accessToken;
    integration.refreshToken = renewed.stored.refreshToken;
    integration.tokenExpiresAt = renewed.stored.tokenExpiresAt;
    return renewed.accessToken;
  }

  /** Refreshes the locked integration's tokens, saved in the same transaction. */
  private async refreshTokens(
    locked: LinearIntegration,
    em: EntityManager,
  ): Promise<{ accessToken: string; stored: StoredTokens }> {
    if (!locked.refreshToken) {
      throw new LinearApiError('invalid_grant', 'No refresh token stored');
    }
    const tokenSet = await this.linearApi.refresh(
      await this.tokenCipher.decrypt(locked.refreshToken),
    );
    const stored = await this.storedTokens(
      tokenSet.accessToken,
      tokenSet.refreshToken,
      tokenSet.expiresInSeconds,
    );
    // Linear rotates the refresh token; keep the old one if none came back.
    if (!stored.refreshToken) stored.refreshToken = locked.refreshToken;

    await em.getRepository(LinearIntegration).update({ id: locked.id }, stored);
    return { accessToken: tokenSet.accessToken, stored };
  }

  // ========== Reading Linear lists ==========

  /**
   * Reads a connection page by page (`first: 50`, then `after` the previous
   * page's cursor) until it ends or MAX_LISTED_ITEMS items are in.
   */
  private async listAll<D, N>(
    integration: LinearIntegration,
    query: string,
    variables: Record<string, unknown>,
    connectionOf: (data: D) => Connection<N> | null | undefined,
  ): Promise<N[]> {
    const items: N[] = [];
    let after: string | undefined;
    while (items.length < MAX_LISTED_ITEMS) {
      const data = await this.linearCall<D>(
        integration,
        query,
        after ? { ...variables, after } : variables,
      );
      const connection = connectionOf(data);
      if (!connection) break;
      items.push(...(connection.nodes ?? []));
      const { hasNextPage, endCursor } = connection.pageInfo ?? {};
      if (!hasNextPage || !endCursor) break;
      after = endCursor;
    }
    return items;
  }

  private teamProjects(
    integration: LinearIntegration,
    teamId: string,
  ): Promise<LinearNamed[]> {
    return this.inTeam(() =>
      this.listAll<
        TeamData<{ projects?: Connection<LinearNamed> }>,
        LinearNamed
      >(
        integration,
        TEAM_PROJECTS_QUERY,
        { teamId },
        (data) => this.requireTeam(data.team).projects,
      ),
    );
  }

  private teamMembers(
    integration: LinearIntegration,
    teamId: string,
  ): Promise<LinearMemberNode[]> {
    return this.inTeam(() =>
      this.listAll<
        TeamData<{ members?: Connection<LinearMemberNode> }>,
        LinearMemberNode
      >(
        integration,
        TEAM_MEMBERS_QUERY,
        { teamId },
        (data) => this.requireTeam(data.team).members,
      ),
    );
  }

  /** The team's labels, then the workspace's ones the team does not list. */
  private async teamAndWorkspaceLabels(
    integration: LinearIntegration,
    teamId: string,
  ): Promise<LinearNamed[]> {
    const [teamLabels, workspaceLabels] = await Promise.all([
      this.inTeam(() =>
        this.listAll<
          TeamData<{ labels?: Connection<LinearNamed> }>,
          LinearNamed
        >(
          integration,
          TEAM_LABELS_QUERY,
          { teamId },
          (data) => this.requireTeam(data.team).labels,
        ),
      ),
      this.listAll<{ issueLabels?: Connection<LinearNamed> }, LinearNamed>(
        integration,
        WORKSPACE_LABELS_QUERY,
        {},
        (data) => data.issueLabels,
      ),
    ]);

    const seen = new Set<string>();
    return [...teamLabels, ...workspaceLabels].filter((label) => {
      if (seen.has(label.id)) return false;
      seen.add(label.id);
      return true;
    });
  }

  /** Each label id as Linear names it, or INVALID_ARGUMENT when one is unknown. */
  private async resolveLabels(
    integration: LinearIntegration,
    teamId: string,
    labelIds: string[],
  ): Promise<LinearNamed[]> {
    const wanted = [...new Set(labelIds)];
    if (wanted.length === 0) return [];

    const available = new Map(
      (await this.teamAndWorkspaceLabels(integration, teamId)).map((label) => [
        label.id,
        label,
      ]),
    );
    return wanted.map((id) => {
      const label = available.get(id);
      if (!label) {
        throw new RpcException({
          code: status.INVALID_ARGUMENT,
          message: 'Unknown Linear label',
        });
      }
      return { id: label.id, name: label.name };
    });
  }

  /**
   * A Linear "not found" inside a call about a team is the team: the id of a
   * team of another workspace looks exactly like an unknown one.
   */
  private async inTeam<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (err) {
      if (err instanceof RpcException) {
        const { code } = err.getError() as { code?: unknown };
        if (code === status.NOT_FOUND) {
          throw linearRefusal('LINEAR_TEAM_NOT_FOUND', status.NOT_FOUND);
        }
      }
      throw err;
    }
  }

  private requireTeam<T>(team: T | null | undefined): T {
    if (!team) {
      throw linearRefusal('LINEAR_TEAM_NOT_FOUND', status.NOT_FOUND);
    }
    return team;
  }

  private toOptions(items: LinearNamed[]): LinearOptionDto[] {
    return items.map(({ id, name }) => ({ id, name }));
  }

  private requireValue(value: string | undefined, field: string): void {
    if (!value?.trim()) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: `${field} is required`,
      });
    }
  }

  // ========== Project settings storage ==========

  /**
   * Creates the project's settings row, or replaces the fields of the existing
   * one. A row that belongs to another organisation's integration is not ours to
   * change. Two saves of one project racing both insert: the loser's insert hits
   * the unique key and is redone once, as an update.
   */
  private async upsertProjectMapping(
    integration: LinearIntegration,
    projectId: string,
    fields: Partial<LinearProjectMapping>,
  ): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      const existing = await this.projectMappingRepo.findOne({
        where: { projectId },
      });
      if (existing && existing.integrationId !== integration.id) {
        throw new RpcException({
          code: status.PERMISSION_DENIED,
          message: 'Permission denied',
        });
      }

      const mapping = existing
        ? Object.assign(existing, fields)
        : this.projectMappingRepo.create({
            projectId,
            integrationId: integration.id,
            ...fields,
          });
      try {
        await this.projectMappingRepo.save(mapping);
        return;
      } catch (err) {
        if (attempt === 1 && isUniqueViolation(err)) {
          this.logger.warn(
            { projectId },
            'Linear project settings raced another save, retrying once',
          );
          continue;
        }
        throw this.linearApi.toRpcException(err);
      }
    }
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

  private parseLabels(json: string | null | undefined): LinearOptionDto[] {
    return this.parseJsonArray(json)
      .filter(
        (label): label is LinearNamed =>
          typeof (label as LinearNamed)?.id === 'string' &&
          typeof (label as LinearNamed)?.name === 'string',
      )
      .map(({ id, name }) => ({ id, name }));
  }

  private parseBranches(json: string | null | undefined): string[] {
    return this.parseJsonArray(json).filter(
      (branch): branch is string => typeof branch === 'string',
    );
  }

  // ========== Install transaction ==========

  /**
   * Saves the installation, once more when it raced another install: the
   * second pass reads the row the other one committed.
   */
  private async saveInstallationRetryingRaces(
    organizationId: string,
    userId: string,
    workspace: Workspace,
    tokens: StoredTokens,
  ): Promise<InstallOutcome> {
    try {
      return await this.saveInstallation(
        organizationId,
        userId,
        workspace,
        tokens,
      );
    } catch (err) {
      if (!isInstallRace(err)) throw err;
      const dbErrorCode = this.dbErrorCode(err);
      this.logger.warn(
        { organizationId, linearOrganizationId: workspace.id, dbErrorCode },
        'Linear installation raced another one, retrying once',
      );
      return this.saveInstallation(organizationId, userId, workspace, tokens);
    }
  }

  private async saveInstallation(
    organizationId: string,
    userId: string,
    workspace: Workspace,
    tokens: StoredTokens,
  ): Promise<InstallOutcome> {
    return this.integrationRepo.manager.transaction(async (em) => {
      const repo = em.getRepository(LinearIntegration);
      const linkedToWorkspace = await em.findOne(LinearIntegration, {
        where: { linearOrganizationId: workspace.id },
        lock: { mode: 'pessimistic_write' },
      });

      if (
        linkedToWorkspace &&
        linkedToWorkspace.organizationId !== organizationId
      ) {
        await repo.save({
          ...linkedToWorkspace,
          ...tokens,
          needsReconnect: false,
        });
        return {
          ownerOrganizationId: linkedToWorkspace.organizationId,
          replaced: null,
        };
      }

      // Same workspace reconnecting (settings and ticket links are kept), the
      // organisation's other workspace, or a first connection.
      const existing =
        linkedToWorkspace ??
        (await em.findOne(LinearIntegration, {
          where: { organizationId },
          lock: { mode: 'pessimistic_write' },
        }));

      let replaced: InstallOutcome['replaced'] = null;
      if (existing && existing.linearOrganizationId !== workspace.id) {
        await em.getRepository(VulnerabilityIssueMapping).delete({
          platform: IssuePlatform.LINEAR,
          linearOrganizationId: existing.linearOrganizationId,
        });
        await em
          .getRepository(LinearProjectMapping)
          .delete({ integrationId: existing.id });
        replaced = {
          linearOrganizationId: existing.linearOrganizationId,
          storedTokens: {
            accessToken: existing.accessToken,
            refreshToken: existing.refreshToken,
          },
        };
      }

      await repo.save({
        ...(existing ?? repo.create({ organizationId })),
        linearOrganizationId: workspace.id,
        workspaceName: workspace.name,
        workspaceUrlKey: workspace.urlKey,
        ...tokens,
        needsReconnect: false,
        installedByUserId: userId,
      });
      return { ownerOrganizationId: organizationId, replaced };
    });
  }

  /** The driver code of a failed query (MySQL's or PostgreSQL's), never its text. */
  private dbErrorCode(err: unknown): string {
    const { code, driverError } = (err ?? {}) as {
      code?: unknown;
      driverError?: { code?: unknown };
    };
    const found = typeof code === 'string' ? code : driverError?.code;
    return typeof found === 'string' ? found : '';
  }

  // ========== Revocation ==========

  /**
   * Revokes the refresh token and the access token, each on its own: a failure
   * is logged (never with the token) and does not stop the other one.
   */
  private async revokeQuietly(
    tokens: TokenPair,
    context: { organizationId: string; linearOrganizationId: string },
  ): Promise<void> {
    const pairs: Array<['refresh' | 'access', string | null]> = [
      ['refresh', tokens.refreshToken],
      ['access', tokens.accessToken],
    ];
    for (const [tokenType, token] of pairs) {
      if (!token) continue;
      try {
        await this.linearApi.revoke(token);
      } catch (err) {
        this.logger.warn(
          { ...context, tokenType, reason: this.reasonOf(err) },
          'Linear token revocation failed',
        );
      }
    }
  }

  /** Same as revokeQuietly, for the encrypted tokens of a stored row. */
  private async revokeStoredQuietly(
    stored: TokenPair,
    context: { organizationId: string; linearOrganizationId: string },
  ): Promise<void> {
    const decryptQuietly = async (value: string | null) => {
      if (!value) return null;
      try {
        return await this.tokenCipher.decrypt(value);
      } catch (err) {
        this.logger.warn(
          { ...context, reason: this.reasonOf(err) },
          'Stored Linear token could not be decrypted for revocation',
        );
        return null;
      }
    };
    await this.revokeQuietly(
      {
        refreshToken: await decryptQuietly(stored.refreshToken),
        accessToken: await decryptQuietly(stored.accessToken),
      },
      context,
    );
  }

  private reasonOf(err: unknown): string {
    if (err instanceof LinearApiError) return err.kind;
    return err instanceof Error ? err.name : typeof err;
  }
}
