import { redisConnectionOptions } from '../../core/redis/redis-connection-options';
import { Module, Global } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EvaluationQueueService } from './evaluation-queue.service';
import { POLICY_QUEUE_NAMES } from './queue-names';

export { POLICY_QUEUE_NAMES } from './queue-names';

/**
 * Global module that sets up BullMQ queues for policy evaluation processing.
 *
 * Features:
 * - Redis-backed job queues for async policy evaluation
 * - Global module so EvaluationQueueService is available everywhere
 *
 * Note: Processors are registered in the WorkerModule where evaluation
 * services are available.
 */
@Global()
@Module({
  imports: [
    ConfigModule,
    // Register BullMQ with Redis connection from env vars
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        return {
          connection: redisConnectionOptions(configService),
          // Default settings for all workers
          defaultJobOptions: {
            removeOnComplete: { age: 3600 }, // Keep completed jobs for 1 hour
            removeOnFail: { age: 86400 }, // Keep failed jobs for 24 hours
            attempts: 3,
            backoff: {
              type: 'exponential',
              delay: 1000,
            },
          },
        };
      },
    }),
    // Register the evaluation queue
    BullModule.registerQueue({ name: POLICY_QUEUE_NAMES.EVALUATION }),
  ],
  providers: [EvaluationQueueService],
  exports: [EvaluationQueueService, BullModule],
})
export class EvaluationQueueModule {}
