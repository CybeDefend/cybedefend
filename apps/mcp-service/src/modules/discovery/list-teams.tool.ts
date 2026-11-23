import { READ_ONLY_TOOL, uuidProperty } from '../mcp/tools/schema-parts';
import { McpToolDefinition } from '../mcp/tools/types';
import { InvalidArgumentError } from '../mcp/tools/errors';
import { GatewayClientService } from '../gateway-client/gateway-client.service';

/** A team as `list_teams` returns it (the Gateway's timestamps are dropped). */
export interface TeamSummary {
  id: string;
  name: string;
  description: string;
}

/**
 * Read the `{ teams: [...] }` answer of `GET /organization/:id/teams`
 * defensively: anything else is an empty list, a team without an id is
 * dropped. Shared with `create_project`, which resolves its team from it.
 */
export function readTeams(body: unknown): TeamSummary[] {
  const raw = (body as { teams?: unknown } | null)?.teams;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((t) => (t ?? {}) as Record<string, unknown>)
    .filter((t) => typeof t.id === 'string' && t.id !== '')
    .map((t) => ({
      id: t.id as string,
      name: typeof t.name === 'string' ? t.name : '',
      description: typeof t.description === 'string' ? t.description : '',
    }));
}

/**
 * `list_teams` — the teams of one organization, so the agent can ask the
 * user where to create a project. Authorisation is the Gateway's
 * (`organization:read`).
 */
export function buildListTeamsTool(
  gateway: GatewayClientService,
): McpToolDefinition {
  return {
    name: 'list_teams',
    annotations: READ_ONLY_TOOL,
    description:
      'List the teams of an organization that you can see (organization creators and ' +
      'administrators see every team, other members only their own). Call ' +
      'list_organizations first to obtain an organizationId. Creating a project in a ' +
      'team (create_project) requires the team manager role or organization ' +
      'creator/administrator.',
    inputSchema: {
      type: 'object',
      properties: {
        organizationId: uuidProperty(
          'Organization UUID (from list_organizations).',
        ),
      },
      required: ['organizationId'],
      additionalProperties: false,
    },
    async run(args, context) {
      if (!context?.accessToken) {
        throw new Error('Missing access token in tool context');
      }
      const organizationId =
        typeof args.organizationId === 'string'
          ? args.organizationId.trim()
          : '';
      if (!organizationId) {
        throw new InvalidArgumentError('organizationId', 'is required');
      }
      const body = await gateway.listTeams(organizationId, context.accessToken);
      return { teams: readTeams(body) };
    },
  };
}
