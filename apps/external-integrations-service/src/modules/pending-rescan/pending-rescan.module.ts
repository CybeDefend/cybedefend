import { Module } from '@nestjs/common';
import { RedisModule } from '../../core/redis/redis.module';
import { PendingRescanStore } from './pending-rescan.store';

/**
 * Deferred rescans of refused pushes: the Redis store, shared
 * by the webhook handlers (which record and supersede) and the repo-scan
 * worker's consumer (which claims and settles).
 *
 * Imports RedisModule itself rather than leaning on its @Global scope: the
 * worker's module graph is not the API's (see RedisModule).
 */
@Module({
  imports: [RedisModule],
  providers: [PendingRescanStore],
  exports: [PendingRescanStore],
})
export class PendingRescanModule {}
