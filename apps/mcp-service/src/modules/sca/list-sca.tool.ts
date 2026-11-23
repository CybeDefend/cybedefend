import {
  READ_ONLY_TOOL,
  uuidProperty,
  withUntrustedFindingText,
} from '../mcp/tools/schema-parts';
import { McpToolDefinition } from '../mcp/tools/types';
import { GatewayClientService } from '../gateway-client/gateway-client.service';

const SCA_LIST_PROPERTIES = {
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
  packageType: {
    type: 'array',
    items: { type: 'string', enum: ['direct', 'dev', 'transitive'] },
    description: 'Filter by package dependency type.',
  },
  language: { type: 'string', description: 'Filter by language.' },
  searchQuery: { type: 'string', description: 'Full-text search query.' },
  branch: { type: 'string', description: 'Filter by branch name.' },
  hasAutofix: {
    type: 'boolean',
    description: 'Filter by autofix availability.',
  },
  malwareOnly: {
    type: 'boolean',
    description:
      'Malware separation: true = return ONLY malicious-package (malware) findings; omit/false = exclude malware from the normal vulnerabilities list.',
  },
  sort: {
    type: 'string',
    enum: [
      'currentState',
      'currentSeverity',
      'currentPriority',
      'createdAt',
      'updatedAt',
      'currentCVSS',
    ],
    description: 'Sort field.',
  },
  order: { type: 'string', enum: ['asc', 'desc'], description: 'Sort order.' },
  page: { type: 'number', minimum: 1, description: 'Page number.' },
  limit: {
    type: 'number',
    minimum: 10,
    maximum: 100,
    description: 'Page size (10-100).',
  },
} as const;

export function buildListVulnerabilitiesScaTool(
  gateway: GatewayClientService,
): McpToolDefinition {
  return {
    name: 'list_vulnerabilities_sca',
    annotations: READ_ONLY_TOOL,
    description: withUntrustedFindingText(
      'List SCA vulnerabilities of a project with optional filters and pagination.',
    ),
    inputSchema: {
      type: 'object',
      properties: SCA_LIST_PROPERTIES,
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
        'sca',
        query,
        context.accessToken,
      );
    },
  };
}
