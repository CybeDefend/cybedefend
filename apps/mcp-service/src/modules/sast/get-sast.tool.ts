import {
  READ_ONLY_TOOL,
  uuidProperty,
  withUntrustedFindingText,
} from '../mcp/tools/schema-parts';
import { McpToolDefinition } from '../mcp/tools/types';
import { GatewayClientService } from '../gateway-client/gateway-client.service';

/**
 * MCP adapter for single-SAST-vulnerability lookup. The hosted mcp-service
 * requires `projectId` explicitly — the STDIO fallback env var is
 * intentionally not ported, because this process serves multiple tenants.
 *
 * Authorisation: the gateway checks `read_scan_result` on the supplied
 * `projectId` (Permify) for every call; this tool only forwards the caller's
 * token, so a project the caller cannot read is refused upstream.
 */
export function buildGetVulnerabilitySastTool(
  gateway: GatewayClientService,
): McpToolDefinition {
  return {
    name: 'get_vulnerability_sast',
    annotations: READ_ONLY_TOOL,
    description: withUntrustedFindingText(
      'Get details of a single SAST vulnerability by ID.',
    ),
    inputSchema: {
      type: 'object',
      properties: {
        projectId: uuidProperty('Project UUID.'),
        vulnerabilityId: uuidProperty('UUID of the vulnerability.'),
      },
      required: ['projectId', 'vulnerabilityId'],
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
      const vulnerabilityId =
        typeof args.vulnerabilityId === 'string'
          ? args.vulnerabilityId.trim()
          : '';
      if (!vulnerabilityId) {
        throw new Error('vulnerabilityId is required');
      }
      return gateway.getVulnerability(
        projectId,
        'sast',
        vulnerabilityId,
        context.accessToken,
      );
    },
  };
}
