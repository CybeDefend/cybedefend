import { Module, OnModuleInit } from '@nestjs/common';
import { McpModule } from '../mcp/mcp.module';
import { GatewayClientModule } from '../gateway-client/gateway-client.module';
import { ToolRegistry } from '../mcp/tools/registry';
import { GatewayClientService } from '../gateway-client/gateway-client.service';
import { buildListVulnerabilitiesSastTool } from './list-sast.tool';
import { buildGetVulnerabilitySastTool } from './get-sast.tool';

/**
 * Feature module for the SAST scanner family. Both `list_vulnerabilities_sast`
 * and `get_vulnerability_sast` are single-project tools registered on the
 * unique public `/mcp` surface.
 */
@Module({
  imports: [McpModule, GatewayClientModule],
})
export class SastModule implements OnModuleInit {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly gateway: GatewayClientService,
  ) {}

  onModuleInit() {
    this.registry.register(buildListVulnerabilitiesSastTool(this.gateway));
    this.registry.register(buildGetVulnerabilitySastTool(this.gateway));
  }
}
