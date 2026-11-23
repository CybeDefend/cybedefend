import { READ_ONLY_TOOL, uuidProperty } from '../mcp/tools/schema-parts';
import { McpToolDefinition } from '../mcp/tools/types';
import { GatewayClientService } from '../gateway-client/gateway-client.service';

/**
 * `get_project_overview` — single-project posture (severity counts, trends
 * per scanner). `projectId` is mandatory and is point-checked against
 * Permify before the Gateway call. Cross-project survey is the LLM's job:
 * `list_organizations` → `search_projects` → one call per target project.
 */
export function buildGetProjectOverviewTool(
  gateway: GatewayClientService,
): McpToolDefinition {
  return {
    name: 'get_project_overview',
    annotations: READ_ONLY_TOOL,
    description:
      'Returns a security overview of a project (severity counts, trends per scanner).',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: uuidProperty('Project UUID.'),
        branches: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional. Filter by branch names.',
        },
      },
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
      const branches = Array.isArray(args.branches)
        ? (args.branches.filter((b) => typeof b === 'string') as string[])
        : undefined;

      return gateway.getProjectOverview(
        projectId,
        branches,
        context.accessToken,
      );
    },
  };
}
