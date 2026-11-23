import { Logger, Module, OnModuleInit } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { GrpcModule } from 'src/core/grpc/grpc.module';
import { AuthGuard } from 'src/core/guards/auth/auth.guard';
import { RateLimitGuard } from 'src/core/guards/throttler/throttler.guard';
import { SecretsModule } from 'src/core/secrets/secrets.module';
import SecretsService from 'src/core/secrets/secrets.service';
import { JwksController } from './jwks.controller';
import { LocalAuthController } from './local-auth.controller';
import { LocalAuthRateLimitGuard } from './local-auth-rate-limit.guard';
import { LocalAuthService } from './local-auth.service';
import { LoginAccountLimiter } from './login-account-limiter';
import { LoginInFlightLimiter } from './login-in-flight-limiter';
import { PasswordChangeController } from './password-change.controller';
import { PersonalAccessTokensController } from './personal-access-tokens.controller';
import { refreshCookieOptions } from './refresh-cookie';

/**
 * The Community Edition's sign-in routes: setup, sign-up,
 * login, refresh, logout, password change and reset, invitations, personal
 * access tokens and the JWKS. Mounted only in community mode, through
 * COMMUNITY_ONLY_MODULES. REDIS_CLIENT comes from the global
 * GatewayRedisModule, JWKS_SOURCE from the global EditionModule.
 *
 * The authenticated controllers (password change, personal access tokens)
 * carry CombinedAuthRateLimitGuard, so the module provides AuthGuard and
 * RateLimitGuard, with the same JwtModule.registerAsync block as
 * organization.module.ts.
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
  controllers: [
    LocalAuthController,
    JwksController,
    PasswordChangeController,
    PersonalAccessTokensController,
  ],
  providers: [
    LocalAuthService,
    LocalAuthRateLimitGuard,
    LoginAccountLimiter,
    LoginInFlightLimiter,
    AuthGuard,
    RateLimitGuard,
  ],
})
export class LocalAuthModule implements OnModuleInit {
  private readonly logger = new Logger(LocalAuthModule.name);

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    if (!refreshCookieOptions(this.config).secure) {
      // The schema accepted it only on localhost; say so once.
      this.logger.warn(
        'AUTH_COOKIE_INSECURE: the refresh cookie is sent without Secure (AUTH_COOKIE_INSECURE_LOCALHOST=true)',
      );
    }
  }
}
