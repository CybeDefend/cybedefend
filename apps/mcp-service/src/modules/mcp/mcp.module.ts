import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { McpController } from './mcp.controller';
import { McpService } from './mcp.service';
import { PromptRegistry } from './prompts/registry';
import { InMemorySessionStore } from './session/session.store';
import { RedisSessionStore } from './session/redis.session-store';
import {
  SESSION_STORE,
  type SessionStore,
} from './session/session-store.interface';
import { ToolRegistry } from './tools/registry';

/**
 * Mounts the MCP Streamable HTTP entry point (`POST/DELETE /mcp`) and
 * exports `McpService`, `ToolRegistry`, and `PromptRegistry` so feature
 * modules (e.g. `sast`) can register their tools and prompts on
 * boot.
 *
 * The session store is provided behind the `SESSION_STORE` token. The
 * factory picks at boot:
 *  - `REDIS_URL` present (and non-empty) → `RedisSessionStore` (multi-
 *    replica deploys).
 *  - Otherwise → `InMemorySessionStore` (single-replica / local dev). This
 *    keeps the dev experience Redis-free.
 *
 * The store is intentionally module-private — external modules have no
 * reason to touch the session cache directly; they interact through
 * `McpService.createSession` / `destroy`.
 */
@Module({
  controllers: [McpController],
  providers: [
    McpService,
    ToolRegistry,
    PromptRegistry,
    // Logger provider lets the factory below receive a proper Nest logger.
    Logger,
    {
      provide: SESSION_STORE,
      useFactory: (config: ConfigService, logger: Logger): SessionStore => {
        const redisUrl = config.get<string>('REDIS_URL');
        if (redisUrl && redisUrl.trim().length > 0) {
          logger.log(
            `SessionStore: using Redis backend at ${redisUrl}`,
            'McpModule',
          );
          return new RedisSessionStore(redisUrl, logger);
        }
        logger.log(
          'SessionStore: using in-memory backend (set REDIS_URL to share across replicas)',
          'McpModule',
        );
        return new InMemorySessionStore();
      },
      inject: [ConfigService, Logger],
    },
  ],
  exports: [McpService, ToolRegistry, PromptRegistry, SESSION_STORE],
})
export class McpModule {}
