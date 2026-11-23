import { Injectable } from '@nestjs/common';
import { Inject, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { Logger } from 'nestjs-pino';
import { GATEWAY_ERROR_TRANSLATOR } from '../../edition/ports/gateway-error-translator.port';
import type { GatewayErrorTranslator } from '../../edition/ports/gateway-error-translator.port';

/**
 * 180 seconds. The Gateway's slowest endpoints (e.g. a retrieval over a
 * vector index) can take a while on cold starts; shorter
 * timeouts would surface as spurious 504s to MCP clients. Tuned to match
 * the Gateway's own worst-case and leave a small budget for inbound
 * propagation.
 */
const DEFAULT_TIMEOUT_MS = 180_000;

/** Longest gateway validation message relayed to the agent. */
const VALIDATION_MESSAGE_MAX = 500;

/**
 * Supported scanner families for the `/project/{id}/results/{scanner}/{vid}`
 * endpoints exposed through MCP. Mirrors the legacy STDIO tool set one-to-one
 * so the Gateway URL is constructed from a closed set of trusted strings.
 */
export type ScannerFamily =
  | 'sast'
  | 'sca'
  | 'iac'
  | 'cicd'
  | 'secret'
  | 'container';

/**
 * Strip `undefined` / `null` entries from a shallow record before forwarding
 * it as axios `params`. Axios would silently serialize `undefined` as the
 * literal string `"undefined"` in some edge cases; easier to drop the keys
 * here so every tool consumer gets the same predictable query string.
 */
export function pruneQuery(
  query: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!query) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) {
      out[key] = value;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Strip `@grpc/proto-loader` proto3-`optional` presence markers from a JSON
 * payload before it reaches the LLM.
 *
 * The Gateway loads protos with `oneofs: true` (gateway grpc.module.ts), so
 * every proto3 `optional` field is exposed as a synthetic oneof and serialised
 * as a sibling key `_<field>` whose value is the field name string itself
 * (e.g. `_cvss3: "cvss3"`, `_branch: "branch"`). Nothing reads these markers,
 * yet they add ~30% of pure noise to every object an MCP tool forwards in
 * passthrough mode (overview / branches / posture / discovery).
 *
 * We drop any key `_k` whose string value equals `k`, recursing through arrays
 * and objects. Real (named) oneofs are untouched — their property key has no
 * leading underscore — and a coincidental `_k` whose value differs from `k` is
 * preserved.
 */
export function stripOneofMarkers(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripOneofMarkers);
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (key.length > 1 && key[0] === '_' && val === key.slice(1)) {
        continue;
      }
      out[key] = stripOneofMarkers(val);
    }
    return out;
  }
  return value;
}

/**
 * Thin HTTP client that forwards MCP tool calls to the CybeDefend Gateway.
 *
 * Design choices worth knowing about:
 *  - The AxiosInstance is constructed once per app boot (no per-request
 *    overhead) and locked to the Gateway's base URL via configuration.
 *  - Every call forwards the END USER's Bearer JWT — this service never
 *    carries service-account credentials. Authorization decisions (Permify
 *    `read_scan_result`) are enforced by the Gateway against that user.
 *  - We translate every failure mode into a plain `Error` with a meaningful
 *    message; {@link McpService} then converts those into `isError: true`
 *    tool responses. Upstream JSON bodies are preferred (`message` → `reason`
 *    → axios `message`) so operators get actionable output in logs.
 */
@Injectable()
export class GatewayClientService {
  protected readonly http: AxiosInstance;

  constructor(
    private readonly config: ConfigService,
    protected readonly logger: Logger,
    @Optional()
    @Inject(GATEWAY_ERROR_TRANSLATOR)
    private readonly errorTranslator?: GatewayErrorTranslator,
  ) {
    const baseURL = this.config.get<string>('CYBEDEFEND_API_RESOURCE');
    if (!baseURL) {
      throw new Error(
        'CYBEDEFEND_API_RESOURCE is required to construct GatewayClientService',
      );
    }
    this.http = axios.create({
      baseURL,
      timeout: DEFAULT_TIMEOUT_MS,
      headers: { 'User-Agent': 'cybedefend-mcp-service/0.4.0' },
      // An array is sent as one plain key per value (`severity=a&severity=b`),
      // never axios' default `severity[]=a`: the gateway's query parser reads
      // `severity[]` as another, undeclared key, which its validation pipe
      // strips, so the filter would be dropped without an error.
      paramsSerializer: { indexes: null },
    });
  }

  /** Poll a scan's status (state, progress, step). */
  async getScanStatus(
    projectId: string,
    scanId: string,
    accessToken: string,
  ): Promise<unknown> {
    const headers = { Authorization: `Bearer ${accessToken}` };
    try {
      const { data } = await this.http.get(
        `/project/${encodeURIComponent(projectId)}/scan/${encodeURIComponent(scanId)}`,
        { headers },
      );
      return data;
    } catch (e: unknown) {
      throw this.wrapError(
        e,
        `GatewayClient.getScanStatus failed project=${projectId} scan=${scanId}`,
      );
    }
  }

  /**
   * `GET /organizations` — every organization the bearer-token user is a
   * member of. Pairs with {@link listProjects} to bootstrap an AI agent that
   * needs to resolve a human-readable project name into the `projectId`
   * required by every other tool. No path / query params: the user identity
   * is taken from the JWT, mirroring the Gateway endpoint.
   */
  async listOrganizations(accessToken: string): Promise<unknown> {
    return this.request(
      'get',
      '/organizations',
      { accessToken },
      'listOrganizations',
    );
  }

  /**
   * `GET /mcp/organization/{id}/projects` — paginated, search-friendly project
   * listing on the MCP-only slim surface. Returns a discovery-shaped
   * item (projectId/name/teamName/cyberRisk/issuesCount) — the dashboard's
   * per-scanner `analyses[]`, org `mainStatistics`, timestamps and link flags
   * are dropped. `query` accepts `search`, `page`, `pageSize`; we forward only
   * defined values. The dashboard `/organization/{id}/projects` is unchanged.
   */
  async listProjects(
    organizationId: string,
    query: Record<string, unknown>,
    accessToken: string,
  ): Promise<unknown> {
    return this.request(
      'get',
      `/mcp/organization/${encodeURIComponent(organizationId)}/projects`,
      { accessToken, params: pruneQuery(query) },
      `listProjects organization=${organizationId}`,
    );
  }

  /**
   * `GET /organization/{id}/teams` — the teams of an organization the caller
   * can see (`organization:read`). Creators / administrators see every team,
   * other members only their own.
   */
  async listTeams(
    organizationId: string,
    accessToken: string,
  ): Promise<unknown> {
    return this.request(
      'get',
      `/organization/${encodeURIComponent(organizationId)}/teams`,
      { accessToken },
      `listTeams organization=${organizationId}`,
    );
  }

  /**
   * `POST /team/{id}/project` — create a project (`team:create_project`:
   * team manager or organization creator / administrator). 409 when the name
   * is taken in the team, 429 when the project limit is reached.
   *
   * Every AI feature is sent on, as the dashboard's creation does
   * (`AI_FEATURES_AT_CREATION`): an absent one is stored false by
   * global-management. Each one is turned off in the project settings.
   */
  async createProject(
    teamId: string,
    name: string,
    accessToken: string,
  ): Promise<unknown> {
    return this.request(
      'post',
      `/team/${encodeURIComponent(teamId)}/project`,
      {
        accessToken,
        body: {
          name,
          aiMergeRequestEnabled: true,
          improvingResultsEnabled: true,
          sortsVulnerabilitiesEnabled: true,
          securityChampionEnabled: true,
        },
      },
      `createProject team=${teamId}`,
    );
  }

  /** `GET /organization/{id}/github/repositories` (`organization:manage_integration`). */
  async listGithubRepositories(
    organizationId: string,
    accessToken: string,
  ): Promise<unknown> {
    return this.request(
      'get',
      `/organization/${encodeURIComponent(organizationId)}/github/repositories`,
      { accessToken },
      `listGithubRepositories organization=${organizationId}`,
    );
  }

  /** `GET /integrations/gitlab/organization/{id}/repositories` (`organization:manage_integration`). */
  async listGitlabRepositories(
    organizationId: string,
    accessToken: string,
  ): Promise<unknown> {
    return this.request(
      'get',
      `/integrations/gitlab/organization/${encodeURIComponent(organizationId)}/repositories`,
      { accessToken },
      `listGitlabRepositories organization=${organizationId}`,
    );
  }

  /**
   * `POST /organization/{org}/project/{project}/github/link` — link the
   * integration's repository row to the project; starts the first scan.
   */
  async linkGithubRepository(
    organizationId: string,
    projectId: string,
    repositoryId: string,
    accessToken: string,
  ): Promise<unknown> {
    return this.request(
      'post',
      `/organization/${encodeURIComponent(organizationId)}/project/${encodeURIComponent(projectId)}/github/link`,
      { accessToken, body: { repositoryId } },
      `linkGithubRepository project=${projectId}`,
    );
  }

  /**
   * `POST /integrations/gitlab/organization/{org}/project/{project}/link` —
   * same as GitHub, except that GitLab overwrites an existing link, so the
   * caller must check the row's `projectId` first.
   */
  async linkGitlabRepository(
    organizationId: string,
    projectId: string,
    repositoryId: string,
    accessToken: string,
  ): Promise<unknown> {
    return this.request(
      'post',
      `/integrations/gitlab/organization/${encodeURIComponent(organizationId)}/project/${encodeURIComponent(projectId)}/link`,
      { accessToken, body: { repositoryId } },
      `linkGitlabRepository project=${projectId}`,
    );
  }

  /**
   * `GET /project/{id}/results/overview` — severity counts + trends per
   * scanner. `branches` is sent as a comma-separated `?branches=` string to
   * match the legacy STDIO tool (the Gateway DTO expects that encoding).
   */
  async getProjectOverview(
    projectId: string,
    branches: string[] | undefined,
    accessToken: string,
  ): Promise<unknown> {
    const params = branches?.length
      ? { branches: branches.join(',') }
      : undefined;
    return this.request(
      'get',
      `/project/${encodeURIComponent(projectId)}/results/overview`,
      { accessToken, params },
      `getProjectOverview project=${projectId}`,
    );
  }

  /**
   * `GET /project/{id}/branches` — distinct branch names surfaced by
   * vulnerability detections. Used by AI clients as a discovery step before
   * scoping subsequent `list_vulnerabilities_*` calls.
   */
  async getBranches(projectId: string, accessToken: string): Promise<unknown> {
    return this.request(
      'get',
      `/project/${encodeURIComponent(projectId)}/branches`,
      { accessToken },
      `getBranches project=${projectId}`,
    );
  }

  /**
   * `GET /mcp/project/{id}/results/{scanner}` — list vulnerabilities for one of
   * the supported scanner families on the MCP-only slim surface.
   *
   * This targets the dedicated `/mcp/...` Gateway route (NOT the dashboard
   * `/project/...` endpoint): the response is page-capped (default 20, max 50)
   * and each item is slimmed to the fields an LLM needs to triage — heavy
   * fields (autofix diffs, code snippets, dataflow, advisory bodies, CVSS
   * explanations, history) are reserved for the detail tools. Query string is
   * forwarded verbatim; each scanner's enum values are validated by the tool's
   * JSON Schema upstream.
   */
  async listVulnerabilities(
    projectId: string,
    scanner: ScannerFamily,
    query: Record<string, unknown>,
    accessToken: string,
  ): Promise<unknown> {
    return this.request(
      'get',
      `/mcp/project/${encodeURIComponent(projectId)}/results/${scanner}`,
      { accessToken, params: pruneQuery(query) },
      `listVulnerabilities scanner=${scanner} project=${projectId}`,
    );
  }

  /**
   * `GET /mcp/project/{id}/results/{scanner}/{vid}` — single-vulnerability
   * detail lookup on the MCP-only slim surface. Returns a truncated
   * payload (long markdown clipped, dataflow capped without per-step code,
   * autofix reduced to a PR pointer, references capped) sized for an LLM. The
   * dashboard `/project/.../results/{scanner}/{vid}` endpoint is unchanged.
   */
  async getVulnerability(
    projectId: string,
    scanner: ScannerFamily,
    vulnerabilityId: string,
    accessToken: string,
  ): Promise<unknown> {
    return this.request(
      'get',
      `/mcp/project/${encodeURIComponent(projectId)}/results/${scanner}/${encodeURIComponent(vulnerabilityId)}`,
      { accessToken },
      `getVulnerability scanner=${scanner} project=${projectId} vuln=${vulnerabilityId}`,
    );
  }

  /**
   * `PATCH /project/{id}/results/{vid}` — mutate a vulnerability's status,
   * priority, or append a comment. Body is forwarded verbatim (minus the
   * `projectId`/`vulnerabilityId` path components the tool already strips).
   */
  async updateVulnerability(
    projectId: string,
    vulnerabilityId: string,
    body: unknown,
    accessToken: string,
    idempotencyKey?: string,
  ): Promise<unknown> {
    return this.request(
      'patch',
      `/project/${encodeURIComponent(projectId)}/results/${encodeURIComponent(vulnerabilityId)}`,
      { accessToken, body, idempotencyKey },
      `updateVulnerability project=${projectId} vuln=${vulnerabilityId}`,
    );
  }

  /**
   * `GET /organization/{id}/results/overview` — aggregated security
   * posture across every project the user can read in the organization.
   *
   * Returns the gateway's `GetOrganizationOverviewResponseDto` shape; the
   * `get_user_posture` tool maps it to its own historical wire shape so
   * downstream LLM clients don't have to change.
   */
  async getOrganizationOverview(
    organizationId: string,
    branches: string[] | undefined,
    accessToken: string,
  ): Promise<unknown> {
    const params: Record<string, unknown> = {
      includeProjectsSummary: true,
      includeTeamsSummary: false,
      includeOverTimeData: false,
      topVulnerableLimit: 5,
    };
    if (branches?.length) {
      params.branches = branches.join(',');
    }
    return this.request(
      'get',
      `/organization/${encodeURIComponent(organizationId)}/results/overview`,
      { accessToken, params },
      `getOrganizationOverview org=${organizationId}`,
    );
  }

  /**
   * Shared HTTP dispatcher used by every proxy method above.
   *
   * Keeps the call sites declarative (verb + URL + accessToken) while
   * preserving the single error-shaping path — every Gateway proxy reuses
   * the same upstream-body preference logic (see {@link wrapError}).
   */
  protected async request(
    method: 'get' | 'patch' | 'post' | 'put',
    url: string,
    options: {
      accessToken: string;
      params?: Record<string, unknown>;
      body?: unknown;
      // When set, forwarded as the standard ``Idempotency-Key``
      // header so downstream services can dedupe non-idempotent actions
      // (start_scan, batch updates, autofix triggers, ...).
      idempotencyKey?: string;
    },
    logContext: string,
  ): Promise<unknown> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${options.accessToken}`,
    };
    if (options.idempotencyKey) {
      headers['Idempotency-Key'] = options.idempotencyKey;
    }
    try {
      let response;
      if (method === 'get') {
        response = await this.http.get(url, {
          headers,
          params: options.params,
        });
      } else if (method === 'post') {
        response = await this.http.post(url, options.body, {
          headers,
          params: options.params,
        });
      } else if (method === 'put') {
        response = await this.http.put(url, options.body, {
          headers,
          params: options.params,
        });
      } else {
        response = await this.http.patch(url, options.body, {
          headers,
          params: options.params,
        });
      }
      return stripOneofMarkers(response.data);
    } catch (e: unknown) {
      throw this.wrapError(e, `GatewayClient.${logContext} failed`);
    }
  }

  /**
   * Normalise thrown axios / unknown errors into an `Error` that prefers the
   * upstream body (`response.data.message` / `.reason`) over the axios-generated
   * string. The HTTP status code and connection-level error code are preserved
   * on `response.status` / `code` so the downstream MCP error-mapper can map
   * 403 -> PERMISSION_DENIED, 404 -> NOT_FOUND, etc. — losing the status here
   * would collapse every upstream failure to a generic `INTERNAL`.
   */
  protected wrapError(e: unknown, logPrefix: string): Error {
    // The edition's error translator recognises product-specific refusals
    // (in the cloud, a 402 for a product unit: an expected outcome that
    // becomes a typed tool error and is never retried). Its warning lines are
    // logged under this call's prefix; null falls through to the default
    // wrapping below.
    const translated = this.errorTranslator?.translate(e, (line) =>
      this.logger.warn(`${logPrefix}: ${line}`),
    );
    if (translated) {
      return translated;
    }
    const err = e as {
      message?: string;
      code?: string;
      response?: {
        status?: number;
        data?: { message?: string | string[]; reason?: string };
      };
    };
    const bodyMessage = err?.response?.data?.message;
    const upstream =
      (Array.isArray(bodyMessage) ? bodyMessage.join('; ') : bodyMessage) ||
      err?.response?.data?.reason ||
      err?.message ||
      'GATEWAY_REQUEST_FAILED';
    const status = err?.response?.status;
    const line = `${logPrefix}: ${upstream}${typeof status === 'number' ? ` (status=${status})` : ''}`;
    // A 4xx is the gateway refusing this call (invalid argument, permission,
    // unknown id): the caller's to fix, not a fault here.
    if (typeof status === 'number' && status >= 400 && status < 500) {
      this.logger.warn(line);
    } else {
      this.logger.error(line);
    }
    const wrapped = new Error(upstream) as Error & {
      response?: { status?: number };
      code?: string;
      validationMessage?: string;
    };
    if (typeof status === 'number') {
      wrapped.response = { status };
    }
    if (typeof err?.code === 'string') {
      wrapped.code = err.code;
    }
    // The gateway's validation pipe answers 400 with what is wrong with the
    // request (e.g. « each value in severity must be one of … »). The agent
    // needs it to correct its call, so it is kept, bounded; nothing else of
    // the body is.
    if ((status === 400 || status === 422) && typeof upstream === 'string') {
      wrapped.validationMessage = upstream.slice(0, VALIDATION_MESSAGE_MAX);
    }
    return wrapped;
  }
}
