import { Module, OnModuleInit } from '@nestjs/common';
import { McpModule } from '../mcp/mcp.module';
import { GatewayClientModule } from '../gateway-client/gateway-client.module';
import { ToolRegistry } from '../mcp/tools/registry';
import { GatewayClientService } from '../gateway-client/gateway-client.service';
import { buildListVulnerabilitiesContainerTool } from './list-container.tool';
import { buildGetVulnerabilityContainerTool } from './get-container.tool';

@Module({
  imports: [McpModule, GatewayClientModule],
})
export class ContainerModule implements OnModuleInit {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly gateway: GatewayClientService,
  ) {}

  onModuleInit() {
    this.registry.register(buildListVulnerabilitiesContainerTool(this.gateway));
    this.registry.register(buildGetVulnerabilityContainerTool(this.gateway));
  }
}
