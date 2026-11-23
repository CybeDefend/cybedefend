import { Module, OnModuleInit } from '@nestjs/common';
import { McpModule } from '../mcp/mcp.module';
import { GatewayClientModule } from '../gateway-client/gateway-client.module';
import { ToolRegistry } from '../mcp/tools/registry';
import { GatewayClientService } from '../gateway-client/gateway-client.service';
import { buildListVulnerabilitiesSecretTool } from './list-secret.tool';
import { buildGetVulnerabilitySecretTool } from './get-secret.tool';

@Module({
  imports: [McpModule, GatewayClientModule],
})
export class SecretModule implements OnModuleInit {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly gateway: GatewayClientService,
  ) {}

  onModuleInit() {
    this.registry.register(buildListVulnerabilitiesSecretTool(this.gateway));
    this.registry.register(buildGetVulnerabilitySecretTool(this.gateway));
  }
}
