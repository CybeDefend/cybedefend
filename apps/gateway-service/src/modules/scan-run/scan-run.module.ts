import { Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import { GrpcModule } from '@grpc/grpc.module';
import { closeRedisClient } from 'src/core/redis/close-redis-client';
import { createGatewayRedisClient } from 'src/core/redis/gateway-redis-client';
import { ScanImportService } from '../scan/import/scan-import.service';
import {
  SCAN_RUN_REDIS_CLIENT,
  ScanRunThrottleGuard,
} from './scan-run-throttle.guard';
import { ScanRunClient } from './scan-run.client';
import { ScanRunController } from './scan-run.controller';
import { ScanUploadTokenGuard } from './scan-upload-token.guard';

/**
 * `POST /scan-runs/:scanId/results`, Community only: it is in
 * COMMUNITY_ONLY_MODULES, so the cloud never mounts it (404) and opens no
 * Redis client for it. Only Community mints upload tokens.
 *
 * The route is public, so its throttle has its own Redis connection
 * (`SCAN_RUN_REDIS_CLIENT`, the gateway client's options), like the
 * other public routes: a flood here queues on this connection, not on the
 * one every authenticated route's guards share. Nest runs no hook on a
 * factory's client, so the module closes it at shutdown.
 *
 * `ScanImportService` is this module's own instance: the scanner uploads
 * count their own in-flight slots (IMPORT_MAX_IN_FLIGHT_PER_POD), next to
 * the import route's.
 */
@Module({
  imports: [ConfigModule.forRoot(), GrpcModule.register()],
  controllers: [ScanRunController],
  providers: [
    ScanRunClient,
    ScanImportService,
    ScanUploadTokenGuard,
    ScanRunThrottleGuard,
    {
      provide: SCAN_RUN_REDIS_CLIENT,
      useFactory: (config: ConfigService) =>
        createGatewayRedisClient(config.get<string>('REDIS_URL')),
      inject: [ConfigService],
    },
  ],
})
export class ScanRunModule implements OnApplicationShutdown {
  constructor(@Inject(SCAN_RUN_REDIS_CLIENT) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    await closeRedisClient(this.redis);
  }
}
