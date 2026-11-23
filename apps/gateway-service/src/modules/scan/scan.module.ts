import { Module } from '@nestjs/common';
import { ScanController } from './scan.controller';
import { ScanService } from './scan.service';
import { ProjectService } from 'src/modules/project/project.service';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule } from '@nestjs/config';
import { AuthGuard } from 'src/core/guards/auth/auth.guard';
import { RateLimitGuard } from 'src/core/guards/throttler/throttler.guard';
import { FeatureGuard } from 'src/core/guards/feature/feature.guard';
import { PermissionsGuard } from 'src/core/guards/permissions/permissions.guard';
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
  // The SARIF import's controller is ScanImportModule's, Community only
  // (COMMUNITY_ONLY_MODULES).
  controllers: [ScanController],
  providers: [
    ScanService,
    ProjectService,
    AuthGuard,
    RateLimitGuard,
    FeatureGuard,
    // Injected by ScanController.getScan, which checks by scan kind.
    // REDIS_CLIENT is the global GatewayRedisModule's.
    PermissionsGuard,
  ],
})
export class ScanModule {}
