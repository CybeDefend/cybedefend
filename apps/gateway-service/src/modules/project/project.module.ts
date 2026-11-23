import { Module } from '@nestjs/common';
import { ProjectController } from './project.controller';
import { McpProjectController } from './mcp-project.controller';
import { ProjectService } from './project.service';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule } from '@nestjs/config';
import { AuthGuard } from 'src/core/guards/auth/auth.guard';
import { RateLimitGuard } from 'src/core/guards/throttler/throttler.guard';
import { PermissionsGuard } from 'src/core/guards/permissions/permissions.guard';
import { GrpcModule } from '@grpc/grpc.module';
import { SecretsModule } from 'src/core/secrets/secrets.module';
import SecretsService from 'src/core/secrets/secrets.service';

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
    // The compliance-frameworks sync is bound by the ee
    // ComplianceFrameworksSyncModule (COMPLIANCE_FRAMEWORKS_SYNC), injected
    // @Optional() by ProjectController.
  ],
  controllers: [ProjectController, McpProjectController],
  providers: [
    ProjectService,
    AuthGuard,
    RateLimitGuard,
    // Provided so other modules of this folder can inject it (the route that
    // needs it, GET /user/projects/resolve, belongs to the cloud edition's
    // UserProjectResolveModule, which declares its own).
    PermissionsGuard,
  ],
  exports: [ProjectService],
})
export class ProjectModule {}
