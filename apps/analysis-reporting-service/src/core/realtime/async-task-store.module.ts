import { Module } from '@nestjs/common';
import { AsyncTaskStore } from './async-task-store.service';
import { ScanQueueService } from '../../modules/scan-queue/scan-queue.service';

/**
 * Provides and exports AsyncTaskStore, wired to the BullMQ Redis client
 * exposed by ScanQueueService.getRedisClient().
 *
 * Import this module wherever AsyncTaskStore is needed. ScanQueueModule is
 * @Global, so ScanQueueService is already available in the DI container
 * without re-importing ScanQueueModule here.
 */
@Module({
  providers: [
    {
      provide: AsyncTaskStore,
      useFactory: async (scanQueue: ScanQueueService) =>
        new AsyncTaskStore(await scanQueue.getRedisClient()),
      inject: [ScanQueueService],
    },
  ],
  exports: [AsyncTaskStore],
})
export class AsyncTaskStoreModule {}
