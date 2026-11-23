import { READ_ONLY_TOOL, uuidProperty } from '../mcp/tools/schema-parts';
import { McpToolDefinition } from '../mcp/tools/types';
import { GatewayClientService } from '../gateway-client/gateway-client.service';

const DEFAULT_PAGE = 1;
// Hard upper bound on the Gateway's `/projects` listing endpoint
// (`ProjectGetAllBodyDto.pageSize` is capped at 10). Going higher returns
// 400, so we mirror the limit here both as the default and as the JSON-Schema
// maximum so the LLM never asks for a page the upstream would reject.
const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 10;

/**
 * Coerce a JSON-Schema `integer` arg that some clients send as a numeric
 * string (`"3"`) into a real number. Returns `undefined` for non-coercible
 * input so the caller can fall back to the default.
 */
function coerceInt(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return undefined;
}

async function fetchProjectsForOrganization(
  gateway: GatewayClientService,
  organizationId: string,
  args: Record<string, unknown>,
  accessToken: string,
): Promise<unknown> {
  const search =
    typeof args.search === 'string' && args.search.trim() !== ''
      ? args.search.trim()
      : undefined;
  const page = coerceInt(args.page) ?? DEFAULT_PAGE;
  const rawPageSize = coerceInt(args.pageSize) ?? DEFAULT_PAGE_SIZE;
  // Clamp at MAX_PAGE_SIZE so a caller who ignores the JSON-Schema
  // `maximum` (or a non-validating MCP client) still gets a valid request.
  const pageSize = Math.min(Math.max(rawPageSize, 1), MAX_PAGE_SIZE);

  const query: Record<string, unknown> = { page, pageSize };
  if (search !== undefined) query.search = search;

  return gateway.listProjects(organizationId, query, accessToken);
}

const SEARCH_PROJECTS_PROPERTIES = {
  organizationId: uuidProperty('Organization UUID (from list_organizations).'),
  search: {
    type: 'string',
    description:
      'Optional free-text filter on the project name. Omit to list every project in the organization.',
  },
  page: {
    type: 'integer',
    minimum: 1,
    description: `Page number (1-based). Defaults to ${DEFAULT_PAGE}.`,
  },
  pageSize: {
    type: 'integer',
    minimum: 1,
    maximum: MAX_PAGE_SIZE,
    description: `Items per page (1-${MAX_PAGE_SIZE}). Defaults to ${DEFAULT_PAGE_SIZE}.`,
  },
} as const;

/**
 * `search_projects` — list projects within a single organization. The
 * caller must already know which organization they want (typically via
 * `list_organizations`); MCP never resolves a cross-organisation list of
 * accessible projects on its own. Per-organisation authorisation is
 * enforced downstream by the Gateway on the listProjects call.
 */
export function buildSearchProjectsTool(
  gateway: GatewayClientService,
): McpToolDefinition {
  return {
    name: 'search_projects',
    annotations: READ_ONLY_TOOL,
    description:
      'Search projects within an organization by name and return their ' +
      'projectIds. Call list_organizations first to obtain an organizationId.',
    inputSchema: {
      type: 'object',
      properties: SEARCH_PROJECTS_PROPERTIES,
      required: ['organizationId'],
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
        throw new Error('organizationId is required');
      }
      return fetchProjectsForOrganization(
        gateway,
        organizationId,
        args,
        context.accessToken,
      );
    },
  };
}
