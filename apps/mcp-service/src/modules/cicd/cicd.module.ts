import { Module, OnModuleInit } from '@nestjs/common';
import { McpModule } from '../mcp/mcp.module';
import { GatewayClientModule } from '../gateway-client/gateway-client.module';
import { ToolRegistry } from '../mcp/tools/registry';
import { GatewayClientService } from '../gateway-client/gateway-client.service';
import { buildListVulnerabilitiesCicdTool } from './list-cicd.tool';
import { buildGetVulnerabilityCicdTool } from './get-cicd.tool';

@Module({
  imports: [McpModule, GatewayClientModule],
})
export class CicdModule implements OnModuleInit {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly gateway: GatewayClientService,
  ) {}

  onModuleInit() {
    this.registry.register(buildListVulnerabilitiesCicdTool(this.gateway));
    this.registry.register(buildGetVulnerabilityCicdTool(this.gateway));
  }
}
