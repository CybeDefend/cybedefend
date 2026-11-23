import { Module } from '@nestjs/common';
import { SlackController } from './slack.controller';
import { SlackService } from './slack.service';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule } from '@nestjs/config';
import { AuthGuard } from 'src/core/guards/auth/auth.guard';
import { RateLimitGuard } from 'src/core/guards/throttler/throttler.guard';
import { FeatureGuard } from 'src/core/guards/feature/feature.guard';
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
  controllers: [SlackController],
  providers: [SlackService, AuthGuard, RateLimitGuard, FeatureGuard],
})
export class SlackModule {}
