import { Module } from '@nestjs/common';

import { GatewayClientService } from './gateway-client.service';

/**
 * Provides the outbound HTTP client used by MCP tools to talk to the
 * CybeDefend Gateway.
 *
 * Exported as a singleton so every feature module that needs to call the
 * Gateway reuses the same preconfigured AxiosInstance (shared connection
 * pool, single base URL). ConfigModule is made global at the app level, so
 * we do not re-import it here.
 */
@Module({
  providers: [GatewayClientService],
  exports: [GatewayClientService],
})
export class GatewayClientModule {}
