import { Module, OnModuleInit } from '@nestjs/common';
import { McpModule } from '../mcp/mcp.module';
import { GatewayClientModule } from '../gateway-client/gateway-client.module';
import { ToolRegistry } from '../mcp/tools/registry';
import { GatewayClientService } from '../gateway-client/gateway-client.service';
import { buildUpdateVulnerabilityTool } from './update.tool';
import { buildSetExploitabilityTool } from './set-exploitability.tool';

/**
 * Cross-scanner vulnerability actions: `update_vulnerability`,
 * `set_exploitability`. All registered on the unique public `/mcp` surface;
 * Gateway enforces Permify and idempotency upstream on the underlying REST
 * endpoints.
 *
 * `get_similar_vulnerabilities` was removed: its uncapped
 * occurrence fan-out bloated the LLM context and its value overlapped a
 * rule/CWE-filtered `list_vulnerabilities_*` query. The Gateway endpoint
 * stays for the dashboard.
 */
@Module({
  imports: [McpModule, GatewayClientModule],
})
export class VulnerabilitiesModule implements OnModuleInit {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly gateway: GatewayClientService,
  ) {}

  onModuleInit() {
    this.registry.register(buildUpdateVulnerabilityTool(this.gateway));
    this.registry.register(buildSetExploitabilityTool(this.gateway));
  }
}
