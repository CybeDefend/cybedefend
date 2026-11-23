import { Module } from '@nestjs/common';
import { OrganizationController } from './organization.controller';
import { OrganizationService } from './organization.service';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule } from '@nestjs/config';
import { AuthGuard } from 'src/core/guards/auth/auth.guard';
import { RateLimitGuard } from 'src/core/guards/throttler/throttler.guard';
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
  ],
  controllers: [OrganizationController],
  providers: [OrganizationService, AuthGuard, RateLimitGuard],
  /**
   * `OrganizationService` is exported for the core modules that call the
   * product-neutral reads (organization id by project, and so on).
   *
   * The closed pieces moved out: the MCP org policy
   * (`McpOrgPolicyController`, `McpOrgPolicyCacheService`,
   * `McpPolicyService`) now live in the cloud edition
   * (`McpOrgPolicyModule`, which `McpVerifyModule` imports), and so do a
   * member's products and the billing profile (`ClosedOrganizationModule`). `McpVerifyModule` no longer reads
   * `McpOrgPolicyCacheService` from this module.
   */
  exports: [OrganizationService],
})
export class OrganizationModule {}
