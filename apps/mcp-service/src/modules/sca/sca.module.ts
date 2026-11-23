import { Module, OnModuleInit } from '@nestjs/common';
import { McpModule } from '../mcp/mcp.module';
import { GatewayClientModule } from '../gateway-client/gateway-client.module';
import { ToolRegistry } from '../mcp/tools/registry';
import { GatewayClientService } from '../gateway-client/gateway-client.service';
import { buildListVulnerabilitiesScaTool } from './list-sca.tool';
import { buildGetVulnerabilityScaTool } from './get-sca.tool';

/**
 * Feature module for the SCA scanner family: one listing tool and one getter.
 * Both single-project and registered on the unique public `/mcp` surface.
 *
 * `list_sca_packages` (the full-SBOM inventory) was removed: an AI
 * agent reads the lockfile directly for package presence/version and uses
 * `list_vulnerabilities_sca` for vulnerable dependencies, so a large
 * SBOM only bloated the LLM context. The Gateway endpoint stays for the
 * dashboard.
 */
@Module({
  imports: [McpModule, GatewayClientModule],
})
export class ScaModule implements OnModuleInit {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly gateway: GatewayClientService,
  ) {}

  onModuleInit() {
    this.registry.register(buildListVulnerabilitiesScaTool(this.gateway));
    this.registry.register(buildGetVulnerabilityScaTool(this.gateway));
  }
}
