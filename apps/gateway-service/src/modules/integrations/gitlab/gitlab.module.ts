import { PermissionsGuard } from 'src/core/guards/permissions/permissions.guard';
import { Module, Logger } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule } from '@nestjs/config';
import { AuthGuard } from 'src/core/guards/auth/auth.guard';
import { RateLimitGuard } from 'src/core/guards/throttler/throttler.guard';
import { GrpcModule } from '@grpc/grpc.module';
import SecretsService from 'src/core/secrets/secrets.service';
import { SecretsModule } from 'src/core/secrets/secrets.module';
import { GitlabController } from './gitlab.controller';
import { GitlabService } from './gitlab.service';

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
  controllers: [GitlabController],
  providers: [
    GitlabService,
    Logger,
    AuthGuard,
    RateLimitGuard,
    // Injected by GitlabController.startScan, which checks by product.
    // REDIS_CLIENT is the global GatewayRedisModule's.
    PermissionsGuard,
  ],
})
export class GitlabModule {}
