import { Inject, Module, OnModuleInit } from '@nestjs/common';
import {
  MCP_EDITION_TEXTS,
  type McpEditionTexts,
} from '../../edition/ports/mcp-edition-texts.port';
import { McpModule } from '../mcp/mcp.module';
import { GatewayClientModule } from '../gateway-client/gateway-client.module';
import { ToolRegistry } from '../mcp/tools/registry';
import { GatewayClientService } from '../gateway-client/gateway-client.service';
import { buildCreateProjectTool } from './create-project.tool';
import { buildListOrganizationsTool } from './list-organizations.tool';
import { buildListTeamsTool } from './list-teams.tool';
import { buildSearchProjectsTool } from './search-projects.tool';

/**
 * Project-discovery feature module, on the unique public `/mcp` surface:
 * `list_organizations`, `search_projects` (always requires
 * `organizationId`), `list_teams` and `create_project` (gated by
 * `confirmed_by_user`).
 */
@Module({
  imports: [McpModule, GatewayClientModule],
})
export class DiscoveryModule implements OnModuleInit {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly gateway: GatewayClientService,
    @Inject(MCP_EDITION_TEXTS)
    private readonly texts: McpEditionTexts,
  ) {}

  onModuleInit() {
    this.registry.register(buildListOrganizationsTool(this.gateway));
    this.registry.register(buildSearchProjectsTool(this.gateway));
    this.registry.register(buildListTeamsTool(this.gateway));
    this.registry.register(
      buildCreateProjectTool(this.gateway, this.texts.noScanYetNextStep),
    );
  }
}
