import { Module, Logger } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule } from '@nestjs/config';
import { GrpcModule } from '@grpc/grpc.module';
import { SecretsModule } from 'src/core/secrets/secrets.module';
import SecretsService from 'src/core/secrets/secrets.service';
import { AuthGuard } from 'src/core/guards/auth/auth.guard';
import { RateLimitGuard } from 'src/core/guards/throttler/throttler.guard';
import { IntegrationOverviewController } from './integration-overview.controller';
import { IntegrationOverviewService } from './integration-overview.service';

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
  controllers: [IntegrationOverviewController],
  providers: [IntegrationOverviewService, Logger, AuthGuard, RateLimitGuard],
  exports: [IntegrationOverviewService],
})
export class IntegrationOverviewModule {}
