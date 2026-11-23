import { Module, OnModuleInit } from '@nestjs/common';
import { McpModule } from '../mcp/mcp.module';
import { GatewayClientModule } from '../gateway-client/gateway-client.module';
import { ToolRegistry } from '../mcp/tools/registry';
import { GatewayClientService } from '../gateway-client/gateway-client.service';
import { buildGetProjectOverviewTool } from './overview.tool';
import { buildGetBranchesTool } from './branches.tool';

/**
 * Groups the two project-level discovery tools — `get_project_overview`
 * and `get_branches` — into a single feature module. Both are
 * single-project and registered on the unique public `/mcp` surface.
 */
@Module({
  imports: [McpModule, GatewayClientModule],
})
export class OverviewModule implements OnModuleInit {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly gateway: GatewayClientService,
  ) {}

  onModuleInit() {
    this.registry.register(buildGetProjectOverviewTool(this.gateway));
    this.registry.register(buildGetBranchesTool(this.gateway));
  }
}
