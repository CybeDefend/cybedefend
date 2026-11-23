import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { closeRedisClient, RedisToClose } from './close-redis-client';
import { createGatewayRedisClient } from './gateway-redis-client';

/**
 * The gateway's one `REDIS_CLIENT`, with a command timeout.
 *
 * Global, imported once by AppModule. Every module whose guards
 * (RateLimitGuard, ChatThrottlerGuard, SsoConnectorsRateLimitGuard,
 * AsyncTaskOwnerGuard) or services inject `REDIS_CLIENT` resolves it from
 * here, one connection per process with a command timeout, instead of one
 * client per module, which could wait forever on a half-open connection.
 * A module that mounts a guarded
 * controller no longer has to provide the client itself
 * (app.module.bootstrap.spec.ts resolves the whole graph). A spec compiling
 * one module on its own imports this module, or provides the token.
 *
 * A closed module with public, unauthenticated routes keeps its own client
 * (same options; a local provider wins over a global one), off the
 * connection that the authenticated routes share.
 *
 * The client is closed at application shutdown (closeRedisClient): left
 * open, its socket kept the process alive after app.close().
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: 'REDIS_CLIENT',
      useFactory: (config: ConfigService) =>
        createGatewayRedisClient(config.get<string>('REDIS_URL')),
      inject: [ConfigService],
    },
  ],
  exports: ['REDIS_CLIENT'],
})
export class GatewayRedisModule implements OnApplicationShutdown {
  constructor(@Inject('REDIS_CLIENT') private readonly redis: RedisToClose) {}

  async onApplicationShutdown(): Promise<void> {
    await closeRedisClient(this.redis);
  }
}
