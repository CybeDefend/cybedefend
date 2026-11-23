import { READ_ONLY_TOOL, uuidProperty } from '../mcp/tools/schema-parts';
import { McpToolDefinition } from '../mcp/tools/types';
import { GatewayClientService } from '../gateway-client/gateway-client.service';

/**
 * MCP tool adapter returning distinct branches detected across vulnerability
 * scans for a project. Primarily a discovery aid: AI clients call this to
 * learn which branch names they can pass to subsequent list/overview tools.
 *
 * Authorisation: the gateway checks `read_scan_result` on the supplied
 * `projectId` (Permify) for every call; this tool only forwards the caller's
 * token, so a project the caller cannot read is refused upstream.
 */
export function buildGetBranchesTool(
  gateway: GatewayClientService,
): McpToolDefinition {
  return {
    name: 'get_branches',
    annotations: READ_ONLY_TOOL,
    description: 'Get all distinct branches from vulnerability detections.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: uuidProperty('Project UUID.'),
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
      return gateway.getBranches(projectId, context.accessToken);
    },
  };
}
