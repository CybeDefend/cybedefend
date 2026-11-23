import {
  READ_ONLY_TOOL,
  uuidProperty,
  withUntrustedFindingText,
} from '../mcp/tools/schema-parts';
import { McpToolDefinition } from '../mcp/tools/types';
import { GatewayClientService } from '../gateway-client/gateway-client.service';

const SAST_LIST_PROPERTIES = {
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
  language: { type: 'string', description: 'Filter by programming language.' },
  searchQuery: { type: 'string', description: 'Full-text search query.' },
  branch: { type: 'string', description: 'Filter by branch name.' },
  hasAutofix: {
    type: 'boolean',
    description: 'Filter by autofix availability.',
  },
  sort: {
    type: 'string',
    enum: [
      'currentState',
      'currentSeverity',
      'currentPriority',
      'language',
      'createdAt',
      'updateAt',
    ],
    description: 'Sort field.',
  },
  order: { type: 'string', enum: ['asc', 'desc'], description: 'Sort order.' },
  pageNumber: {
    type: 'number',
    minimum: 1,
    description: 'Page number (starts at 1).',
  },
  pageSizeNumber: { type: 'number', minimum: 1, description: 'Page size.' },
} as const;

/**
 * `list_vulnerabilities_sast` — single-project listing. `projectId` is
 * mandatory and forwarded to Gateway, which enforces Permify on the
 * underlying REST endpoint. There is no cross-project fan-out; agents
 * narrow scope with `list_organizations` → `search_projects` first.
 */
export function buildListVulnerabilitiesSastTool(
  gateway: GatewayClientService,
): McpToolDefinition {
  return {
    name: 'list_vulnerabilities_sast',
    annotations: READ_ONLY_TOOL,
    description: withUntrustedFindingText(
      'List SAST vulnerabilities of a project with optional filters and pagination.',
    ),
    inputSchema: {
      type: 'object',
      properties: SAST_LIST_PROPERTIES,
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
        'sast',
        query,
        context.accessToken,
      );
    },
  };
}
