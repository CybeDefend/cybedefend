import { Module, OnModuleInit } from '@nestjs/common';

import { McpModule } from '../mcp/mcp.module';
import { GatewayClientModule } from '../gateway-client/gateway-client.module';
import { ToolRegistry } from '../mcp/tools/registry';
import { GatewayClientService } from '../gateway-client/gateway-client.service';
import { buildGetUserPostureTool } from './get-user-posture.tool';

/**
 * `get_user_posture` — cross-project posture rollup.
 *
 * Thin wrapper around Gateway's `GET /organization/{id}/results/overview`
 * endpoint; the auth + Permify scope check happens upstream at Gateway,
 * so the tool only forwards the user JWT and maps the response shape.
 */
@Module({
  imports: [McpModule, GatewayClientModule],
})
export class PostureModule implements OnModuleInit {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly gateway: GatewayClientService,
  ) {}

  onModuleInit() {
    this.registry.register(buildGetUserPostureTool(this.gateway));
  }
}
