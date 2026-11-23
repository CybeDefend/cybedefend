// external-integrations-service/src/core/redis/redis.module.ts

import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * Injection token for the shared ioredis client.
 *
 * Value-identical to the raw `'REDIS_CLIENT'` string already injected by
 * existing call sites (gitlab.service), so this module is a drop-in provider
 * for them and the constant can be adopted incrementally.
 */
export const REDIS_CLIENT = 'REDIS_CLIENT';

/**
 * Single source of truth for the Redis connection in this service.
 *
 * `REDIS_CLIENT` used to be declared inline in `gitlab.module.ts` only, so any
 * other module injecting it compiled fine and passed its unit tests (the client
 * is mocked there) but crashed bootstrap with `UnknownDependenciesException`.
 * That factory is gone: every consumer now resolves to the provider below, and
 * one ioredis connection serves them all.
 *
 * `@Global()` follows the convention already used by this service's other
 * cross-cutting infrastructure modules (`SecretsModule`,
 * `RepoScanQueueModule`).
 *
 * **Import it explicitly anyway.** `@Global()` only publishes the provider once
 * something in the graph pulls this module in, and the graph is not the same at
 * every entry point: `worker.module.ts` loads `GitlabModule` — a REDIS_CLIENT
 * consumer — WITHOUT any container-registry module, and those are the modules
 * that drag `RegistryTagsCacheModule` (and therefore this one) along. Leaning on
 * the global scope there would compile, pass every unit test, and crash the
 * worker at boot. Every consumer module imports this one directly for that
 * reason; treat the global scope as a convenience, never as the guarantee.
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: (configService: ConfigService): Redis => {
        const redisUrl = configService.get<string>('REDIS_URL');
        if (!redisUrl) {
          // Fail fast rather than silently defaulting to localhost, which in
          // prod would connect to nothing (or worse, the wrong instance).
          throw new TypeError(
            'REDIS_URL is not defined in environment variables',
          );
        }
        return new Redis(redisUrl);
      },
      inject: [ConfigService],
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
