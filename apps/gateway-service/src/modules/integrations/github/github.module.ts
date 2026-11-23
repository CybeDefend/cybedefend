import { PermissionsGuard } from 'src/core/guards/permissions/permissions.guard';
import { Module } from '@nestjs/common';
import { GithubController } from './github.controller';
import { GithubService } from './github.service';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule } from '@nestjs/config';
import { AuthGuard } from 'src/core/guards/auth/auth.guard';
import { RateLimitGuard } from 'src/core/guards/throttler/throttler.guard';
import { GrpcModule } from '@grpc/grpc.module';
import SecretsService from 'src/core/secrets/secrets.service';
import { SecretsModule } from 'src/core/secrets/secrets.module';

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
  controllers: [GithubController],
  providers: [
    GithubService,
    AuthGuard,
    RateLimitGuard,
    // Injected by GithubController.startScanForLastCommitAndProject, which
    // checks by product. REDIS_CLIENT is the global GatewayRedisModule's.
    PermissionsGuard,
  ],
})
export class GithubModule {}
