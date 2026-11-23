import { Module, OnModuleInit } from '@nestjs/common';
import { McpModule } from '../mcp/mcp.module';
import { GatewayClientModule } from '../gateway-client/gateway-client.module';
import { ToolRegistry } from '../mcp/tools/registry';
import { GatewayClientService } from '../gateway-client/gateway-client.service';
import { buildListVulnerabilitiesIacTool } from './list-iac.tool';
import { buildGetVulnerabilityIacTool } from './get-iac.tool';

@Module({
  imports: [McpModule, GatewayClientModule],
})
export class IacModule implements OnModuleInit {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly gateway: GatewayClientService,
  ) {}

  onModuleInit() {
    this.registry.register(buildListVulnerabilitiesIacTool(this.gateway));
    this.registry.register(buildGetVulnerabilityIacTool(this.gateway));
  }
}
