import { Module } from '@nestjs/common';
import { TeamController } from './team.controller';
import { TeamService } from './team.service';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule } from '@nestjs/config';
import { AuthGuard } from 'src/core/guards/auth/auth.guard';
import { RateLimitGuard } from 'src/core/guards/throttler/throttler.guard';
import { GrpcModule } from '@grpc/grpc.module';
import { SecretsModule } from 'src/core/secrets/secrets.module';
import SecretsService from 'src/core/secrets/secrets.service';

@Module({
  imports: [
    ConfigModule.forRoot(),
    GrpcModule.register(),
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
  ],
  controllers: [TeamController],
  providers: [TeamService, AuthGuard, RateLimitGuard],
})
export class TeamModule {}
