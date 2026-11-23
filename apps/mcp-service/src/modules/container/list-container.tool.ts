import {
  READ_ONLY_TOOL,
  uuidProperty,
  withUntrustedFindingText,
} from '../mcp/tools/schema-parts';
import { McpToolDefinition } from '../mcp/tools/types';
import { GatewayClientService } from '../gateway-client/gateway-client.service';

/**
 * Container scanner has its own schema dialect, preserved verbatim from
 * the STDIO source:
 *  - `order` accepts `ASC` / `DESC` in either case: the gateway lower-cases
 *    it for every scanner, and the other list tools advertise lowercase, so
 *    a caller sending `desc` to every list tool must not be refused here.
 *  - Pagination keys are `page` / `limit` (not `pageNumber` / `pageSizeNumber`).
 *  - Extra `imageId` filter narrows results to a single container image.
 * We do not normalise to match SAST — the Gateway contract differs by design.
 */
const CONTAINER_LIST_PROPERTIES = {
  projectId: uuidProperty('Project UUID.'),
  severity: {
    type: 'array',
    items: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
    description: 'Filter by severity levels.',
  },
  status: {
    type: 'array',
    items: {
      type: 'string',
      enum: ['to_verify', 'resolved', 'confirmed', 'ignored'],
    },
    description: 'Filter by statuses.',
  },
  priority: {
    type: 'array',
    items: {
      type: 'string',
      enum: ['critical_urgent', 'urgent', 'normal', 'low', 'very_low'],
    },
    description: 'Filter by priority levels.',
  },
  searchQuery: { type: 'string', description: 'Full-text search query.' },
  branch: { type: 'string', description: 'Filter by branch name.' },
  imageId: uuidProperty('Filter by container image UUID.'),
  hasAutofix: {
    type: 'boolean',
    description: 'Filter by autofix availability.',
  },
  sort: { type: 'string', description: 'Sort field.' },
  order: {
    type: 'string',
    enum: ['ASC', 'DESC', 'asc', 'desc'],
    description: 'Sort order.',
  },
  page: { type: 'number', minimum: 1, description: 'Page number.' },
  limit: { type: 'number', minimum: 1, description: 'Page size.' },
} as const;

export function buildListVulnerabilitiesContainerTool(
  gateway: GatewayClientService,
): McpToolDefinition {
  return {
    name: 'list_vulnerabilities_container',
    annotations: READ_ONLY_TOOL,
    description: withUntrustedFindingText(
      'List container image vulnerabilities of a project.',
    ),
    inputSchema: {
      type: 'object',
      properties: CONTAINER_LIST_PROPERTIES,
      required: ['projectId'],
    },
    async run(args, context) {
      if (!context?.accessToken) {
        throw new Error('Missing access token in tool context');
      }
      const projectId =
        typeof args.projectId === 'string' ? args.projectId.trim() : '';
      if (!projectId) {
        throw new Error('projectId is required');
      }
      const query: Record<string, unknown> = {
        ...(args as Record<string, unknown>),
      };
      delete query.projectId;
      return gateway.listVulnerabilities(
        projectId,
        'container',
        query,
        context.accessToken,
      );
    },
  };
}
