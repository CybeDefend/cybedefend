import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { GrpcModule } from '@grpc/grpc.module';
import { AuthGuard } from 'src/core/guards/auth/auth.guard';
import { PermissionsGuard } from 'src/core/guards/permissions/permissions.guard';
import { RateLimitGuard } from 'src/core/guards/throttler/throttler.guard';
import { SecretsModule } from 'src/core/secrets/secrets.module';
import SecretsService from 'src/core/secrets/secrets.service';
import { ScanService } from '../scan.service';
import { ScanImportController } from './scan-import.controller';
import { ScanImportService } from './scan-import.service';

/**
 * `POST /project/:projectId/scan/import/start`, the SARIF import,
 * Community Edition only: it is in COMMUNITY_ONLY_MODULES,
 * so the cloud never mounts it (404). CombinedAuthRateLimitGuard needs
 * AuthGuard and RateLimitGuard, with the same JwtModule.registerAsync block
 * as scan.module.ts; REDIS_CLIENT comes from the global GatewayRedisModule.
 *
 * `ScanImportService` is one instance per pod, which counts the imports in
 * flight (ScanRunModule keeps its own for the scanner uploads).
 */
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
  controllers: [ScanImportController],
  providers: [
    ScanService,
    ScanImportService,
    AuthGuard,
    RateLimitGuard,
    PermissionsGuard,
  ],
})
export class ScanImportModule {}
