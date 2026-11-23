import { READ_ONLY_TOOL } from '../mcp/tools/schema-parts';
import { McpToolDefinition } from '../mcp/tools/types';
import { GatewayClientService } from '../gateway-client/gateway-client.service';

/**
 * MCP tool adapter for `GET /organizations`.
 *
 * Every other MCP tool requires a `projectId`. Without a discovery path, an
 * AI client (Claude Code, hosted agents, etc.) has no way to resolve a
 * human-readable name like "API gateway" into a UUID. This tool pairs with
 * {@link buildSearchProjectsTool} to close that gap:
 *
 *   list_organizations  →  search_projects  →  any project-scoped tool
 *
 * No required arguments — the caller's identity is inferred from the bearer
 * token forwarded through the tool context. The Gateway returns every
 * organization the user belongs to, including names + IDs, so the agent can
 * pick one for the next call.
 */
export function buildListOrganizationsTool(
  gateway: GatewayClientService,
): McpToolDefinition {
  return {
    name: 'list_organizations',
    annotations: READ_ONLY_TOOL,
    description:
      'List every organization the authenticated user is a member of. ' +
      'Use this as the first step to discover an organizationId, then call ' +
      'search_projects to resolve a project name into a projectId.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
    async run(_args, context) {
      if (!context?.accessToken) {
        throw new Error('Missing access token in tool context');
      }
      return gateway.listOrganizations(context.accessToken);
    },
  };
}
