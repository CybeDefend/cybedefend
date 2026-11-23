import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { GrpcModule } from '@grpc/grpc.module';
import { AuthGuard } from 'src/core/guards/auth/auth.guard';
import { RateLimitGuard } from 'src/core/guards/throttler/throttler.guard';
import { SecretsModule } from 'src/core/secrets/secrets.module';
import SecretsService from 'src/core/secrets/secrets.service';
import { InstanceController } from './instance.controller';

/**
 * `GET /instance/capabilities`. Mounted only in community mode,
 * through COMMUNITY_ONLY_MODULES. CombinedAuthRateLimitGuard needs AuthGuard
 * and RateLimitGuard, with the same JwtModule.registerAsync block as
 * local-auth.module.ts; REDIS_CLIENT comes from the global
 * GatewayRedisModule, never from a provider of this module.
 */
@Module({
  imports: [
    SecretsModule,
    JwtModule.registerAsync({
      imports: [SecretsModule],
      useFactory: async (secretsService: SecretsService) => {
        await secretsService.ensureCacheLoaded();
        const jwtSecret = secretsService.getSecret('JWT_SECRET');
        return {
          secret: jwtSecret,
          signOptions: { expiresIn: '300s' },
        };
      },
      inject: [SecretsService],
    }),
    ConfigModule.forRoot(),
    GrpcModule.register(),
  ],
  controllers: [InstanceController],
  providers: [AuthGuard, RateLimitGuard],
})
export class InstanceModule {}
