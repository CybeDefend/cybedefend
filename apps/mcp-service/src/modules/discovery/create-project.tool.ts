import { uuidProperty } from '../mcp/tools/schema-parts';
import { McpToolDefinition } from '../mcp/tools/types';
import {
  InternalMcpError,
  InvalidArgumentError,
  MCP_ERROR_CODES,
  McpToolError,
} from '../mcp/tools/errors';
import { GatewayClientService } from '../gateway-client/gateway-client.service';
import { readTeams, TeamSummary } from './list-teams.tool';
import {
  linkRepositoryToProject,
  lookupRepository,
  normalizeHost,
  RepositoryLinkOutcome,
  RepositoryRef,
} from './repository-link';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Same pattern and bound as the Gateway's `GET /user/projects/resolve` DTO.
const SLUG_RE = /^[\w.-]+(\/[\w.-]+)+$/;
// A GitHub repository is exactly owner/repo: `github.com/acme/web` is a URL
// fragment, not a slug.
const GITHUB_SLUG_RE = /^[\w.-]+\/[\w.-]+$/;
const MAX_SLUG_LENGTH = 512;
// `ProjectCreateBodyDto.name` is `@Length(0, 255)`.
const MAX_NAME_LENGTH = 255;

export interface CreateProjectResult {
  projectId: string;
  organizationId: string;
  teamId: string;
  teamName: string;
  name: string;
  repository?: RepositoryLinkOutcome;
  nextSteps: string[];
}

interface CreateProjectInput {
  organizationId: string;
  name: string;
  teamId?: string;
  repository?: RepositoryRef;
}

function isAbsent(v: unknown): boolean {
  return v === undefined || v === null || v === '';
}

function parseRepository(raw: unknown): RepositoryRef | undefined {
  if (isAbsent(raw)) return undefined;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new InvalidArgumentError(
      'repository',
      'must be an object { provider, slug, host? }',
    );
  }
  const r = raw as Record<string, unknown>;
  if (r.provider !== 'github' && r.provider !== 'gitlab') {
    throw new InvalidArgumentError(
      'repository.provider',
      "must be 'github' or 'gitlab'",
    );
  }
  const slug =
    typeof r.slug === 'string' ? r.slug.trim().replace(/\.git$/i, '') : '';
  const slugRe = r.provider === 'github' ? GITHUB_SLUG_RE : SLUG_RE;
  if (slug.length > MAX_SLUG_LENGTH || !slugRe.test(slug)) {
    throw new InvalidArgumentError(
      'repository.slug',
      'must look like owner/repo (GitLab: group/subgroup/project)',
    );
  }
  let host: string | undefined;
  if (!isAbsent(r.host)) {
    const normalized =
      typeof r.host === 'string' ? normalizeHost(r.host) : null;
    if (!normalized) {
      throw new InvalidArgumentError(
        'repository.host',
        'must be a host name such as github.com',
      );
    }
    host = normalized;
  }
  return { provider: r.provider, slug, ...(host ? { host } : {}) };
}

function parseInput(args: Record<string, unknown>): CreateProjectInput {
  if (args.confirmed_by_user !== true) {
    throw new InvalidArgumentError(
      'confirmed_by_user',
      'must be true. Ask the user to confirm the project name, organization and ' +
        'team, and call create_project only after an explicit yes.',
    );
  }
  const organizationId =
    typeof args.organizationId === 'string' ? args.organizationId.trim() : '';
  if (!UUID_RE.test(organizationId)) {
    throw new InvalidArgumentError(
      'organizationId',
      'must be an organization UUID (from list_organizations)',
    );
  }
  const name = typeof args.name === 'string' ? args.name.trim() : '';
  if (name.length === 0 || name.length > MAX_NAME_LENGTH) {
    throw new InvalidArgumentError(
      'name',
      `must be 1 to ${MAX_NAME_LENGTH} characters`,
    );
  }
  let teamId: string | undefined;
  if (!isAbsent(args.teamId)) {
    teamId = typeof args.teamId === 'string' ? args.teamId.trim() : '';
    if (!UUID_RE.test(teamId)) {
      throw new InvalidArgumentError(
        'teamId',
        'must be a team UUID (from list_teams)',
      );
    }
  }
  return {
    organizationId,
    name,
    teamId,
    repository: parseRepository(args.repository),
  };
}

/** The team to create in, from the teams of the organization the caller can see. */
function resolveTeam(
  teams: TeamSummary[],
  organizationId: string,
  teamId?: string,
): TeamSummary {
  const listed = teams.map((t) => `${t.name} (${t.id})`).join(', ');
  if (teamId) {
    const team = teams.find((t) => t.id.toLowerCase() === teamId.toLowerCase());
    if (team) return team;
    throw new McpToolError(
      MCP_ERROR_CODES.INVALID_ARGUMENT,
      `Team ${teamId} is not a team of organization ${organizationId} that you can see.` +
        (teams.length > 0 ? ` Teams: ${listed}.` : ''),
      { argument: 'teamId', teams },
    );
  }
  if (teams.length === 1) return teams[0];
  if (teams.length === 0) {
    throw new McpToolError(
      MCP_ERROR_CODES.INVALID_ARGUMENT,
      `No team of organization ${organizationId} is visible to you: an ` +
        'organization administrator must add you to a team first.',
      { argument: 'teamId', teams },
    );
  }
  throw new McpToolError(
    MCP_ERROR_CODES.INVALID_ARGUMENT,
    `Organization ${organizationId} has several teams: ask the user which one ` +
      `and pass its id as teamId. Teams: ${listed}.`,
    { argument: 'teamId', teams },
  );
}

/** Typed errors for the creation failures the agent must explain; others pass through. */
function creationError(e: unknown, team: TeamSummary, name: string): unknown {
  const status = (e as { response?: { status?: unknown } } | null)?.response
    ?.status;
  const upstream = e instanceof Error ? e.message : String(e);
  if (status === 403) {
    return new McpToolError(
      MCP_ERROR_CODES.PERMISSION_DENIED,
      `Creating a project in team ${team.name} requires the team manager role ` +
        `or organization creator/administrator (gateway: ${upstream}).`,
      { teamId: team.id },
    );
  }
  if (status === 409) {
    return new McpToolError(
      MCP_ERROR_CODES.ALREADY_EXISTS,
      `A project named "${name}" already exists in team ${team.name}: pick another name.`,
      { teamId: team.id, name },
    );
  }
  if (status === 429) {
    return new McpToolError(
      MCP_ERROR_CODES.RESOURCE_EXHAUSTED,
      `${upstream}: the organization holds no more projects; delete a project in the dashboard.`,
      { teamId: team.id },
    );
  }
  return e;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function buildNextSteps(
  projectId: string,
  noScanYetNextStep: string,
  repository?: RepositoryLinkOutcome,
): string[] {
  const writeConfig =
    `Write .cybedefend/config.json at the repository root with {"projectId": "${projectId}"} ` +
    '(merge into the existing file and keep its other keys).';
  return [
    // Linked to another project between the pre-check and the link: the
    // repository already has its project, the new one is likely unwanted.
    repository?.status === 'already_linked'
      ? `Ask the user whether to pin the existing project ${repository.linkedProjectId}, ` +
        `which ${repository.slug} is already linked to, in .cybedefend/config.json ` +
        `instead of the new project ${projectId}; if so, delete ${projectId} in the ` +
        `dashboard. Otherwise: ${writeConfig}`
      : writeConfig,
    repository?.status === 'linked'
      ? 'The first scan of the default branch has started; results appear in the ' +
        'dashboard when it completes.'
      : noScanYetNextStep,
  ];
}

/**
 * `create_project` — create a project in a team of an organization, then
 * link it to the GitHub / GitLab repository when one is given.
 *
 * A forwarder: the Gateway authorises the creation (`team:create_project`)
 * and every link call. The tool only adds the confirmation gate, the
 * team-in-organization check, typed errors for 403 / 409 / 429, and the
 * link orchestration (`repository-link.ts`). Once the project exists it
 * never throws: the link outcome is in `repository`.
 */
export function buildCreateProjectTool(
  gateway: GatewayClientService,
  noScanYetNextStep: string,
): McpToolDefinition {
  return {
    name: 'create_project',
    // Adds a project; changes nothing that exists.
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    description:
      'Create a CybeDefend project in a team of an organization, and optionally link it ' +
      'to the GitHub / GitLab repository the user is working in. Use it when the ' +
      'repository has no CybeDefend project yet (no .cybedefend/config.json and ' +
      'search_projects finds none). Before calling: list_organizations, then list_teams; ' +
      'ask the user ONCE to confirm the project name (default: the repository name), the ' +
      'organization and the team; call only after an explicit yes, with ' +
      '`confirmed_by_user: true` (a new project is a lasting change to the organization). ' +
      'Pass `repository` from `git remote get-url origin` when it is a github.com or ' +
      'gitlab.com remote: the tool links it through the organization integration, which ' +
      'starts the first scan. Afterwards, write .cybedefend/config.json with ' +
      '{"projectId": "<projectId>"} at the repository root, and tell the user ' +
      '`repository.message` and `nextSteps`. teamId may be omitted when the ' +
      'organization has exactly one team you can see.',
    inputSchema: {
      type: 'object',
      required: ['organizationId', 'name', 'confirmed_by_user'],
      properties: {
        organizationId: uuidProperty(
          'Organization UUID (from list_organizations).',
        ),
        name: {
          type: 'string',
          minLength: 1,
          maxLength: MAX_NAME_LENGTH,
          description:
            'Project name, confirmed by the user. Unique within the team.',
        },
        teamId: uuidProperty(
          'Team UUID (from list_teams). Optional when the organization has exactly one team you can see.',
        ),
        repository: {
          type: 'object',
          description:
            'The GitHub / GitLab repository to link, parsed from `git remote get-url origin`. ' +
            'Omit it for a repository hosted elsewhere or without a remote.',
          required: ['provider', 'slug'],
          properties: {
            provider: { type: 'string', enum: ['github', 'gitlab'] },
            slug: {
              type: 'string',
              description:
                'owner/repo (GitLab: group/subgroup/project), without .git.',
            },
            host: {
              type: 'string',
              description:
                'Remote host, e.g. github.com. Defaults to github.com / gitlab.com.',
            },
          },
          additionalProperties: false,
        },
        confirmed_by_user: {
          type: 'boolean',
          description:
            'MUST be true. The agent must have asked the user and received an explicit yes ' +
            'on the project name, organization and team before calling this tool.',
        },
      },
      additionalProperties: false,
    },
    async run(args, context) {
      if (!context?.accessToken) {
        throw new Error('Missing access token in tool context');
      }
      const input = parseInput(args);
      const team = resolveTeam(
        readTeams(
          await gateway.listTeams(input.organizationId, context.accessToken),
        ),
        input.organizationId,
        input.teamId,
      );

      if (input.repository) {
        // A repository already bound to a project means the user wants that
        // project, not a new empty one counted against the plan. Any other
        // pre-check outcome (not in the integration, no right, unsupported
        // host) still creates the project; the link below reports it.
        const found = await lookupRepository(
          gateway,
          input.organizationId,
          input.repository,
          context.accessToken,
        );
        if ('outcome' in found && found.outcome.status === 'already_linked') {
          const linked = found.outcome.linkedProjectId;
          throw new McpToolError(
            MCP_ERROR_CODES.ALREADY_EXISTS,
            `${input.repository.slug} is already linked to project ${linked}: use that ` +
              `project (write .cybedefend/config.json with {"projectId": "${linked}"}; ` +
              'ask its owners for access if you cannot open it) instead of creating a ' +
              'new one. No project was created.',
            { linkedProjectId: linked, repository: input.repository.slug },
          );
        }
      }

      let created: unknown;
      try {
        created = await gateway.createProject(
          team.id,
          input.name,
          context.accessToken,
        );
      } catch (e) {
        throw creationError(e, team, input.name);
      }

      const body = (created ?? {}) as Record<string, unknown>;
      const projectId = str(body.projectId);
      if (!projectId) {
        throw new InternalMcpError(
          'The gateway answered the creation without a projectId',
        );
      }
      const project = {
        projectId,
        organizationId: str(body.organizationId) || input.organizationId,
        teamId: str(body.teamId) || team.id,
        teamName: str(body.teamName) || team.name,
        name: str(body.name) || input.name,
      };

      const repository = input.repository
        ? await linkRepositoryToProject(
            gateway,
            { organizationId: project.organizationId, projectId },
            input.repository,
            context.accessToken,
          )
        : undefined;

      const result: CreateProjectResult = {
        ...project,
        ...(repository ? { repository } : {}),
        nextSteps: buildNextSteps(projectId, noScanYetNextStep, repository),
      };
      return result;
    },
  };
}
