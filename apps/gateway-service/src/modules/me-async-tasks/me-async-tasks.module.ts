import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { GrpcModule } from '@grpc/grpc.module';
import { AuthGuard } from 'src/core/guards/auth/auth.guard';
import { RateLimitGuard } from 'src/core/guards/throttler/throttler.guard';
import { CombinedAuthRateLimitGuard } from 'src/core/guards/combined-auth-rate-limit.guard';
import { SecretsModule } from 'src/core/secrets/secrets.module';
import { MeAsyncTasksController } from './me-async-tasks.controller';
import { MeAsyncTasksService } from './me-async-tasks.service';

@Module({
  imports: [ConfigModule.forRoot(), GrpcModule.register(), SecretsModule],
  controllers: [MeAsyncTasksController],
  providers: [
    MeAsyncTasksService,
    AuthGuard,
    RateLimitGuard,
    CombinedAuthRateLimitGuard,
    // RateLimitGuard's REDIS_CLIENT comes from the global GatewayRedisModule.
  ],
})
export class MeAsyncTasksModule {}
