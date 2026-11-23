import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { validationSchema } from './core/config/validation.schema';
import {
  buildTypeOrmOptions,
  resolveDbConnection,
} from './core/db/typeorm-options';
import { LoggerModule } from './core/logger/logger.module';
import { SecretsModule } from './core/secrets/secrets.module';
import SecretsService from './core/secrets/secrets.service';
import { EditionModule } from './edition/edition.module';
import { isCommunityEdition } from './edition/edition';
import { editionImportsFor } from './edition/edition-imports';
import { LocalAuthModule } from './modules/local-auth/local-auth.module';
import { PasswordResetCli } from './modules/local-auth/password-reset-cli';

/**
 * Root of the one-shot `auth:reset-password` CLI (main.auth-reset-password.ts):
 * the service's configuration, secrets, logger and database — the
 * DataPurgeCronModule layout, TypeORM without running migrations (context
 * 'cli', those belong to the service's own deploy) — plus LocalAuthModule,
 * which provides PasswordResetService. The CLI is the Community Edition's
 * answer to a forgotten password when no SMTP is configured: it prints the
 * reset link instead of mailing it. LocalAuthModule and the CLI are imported
 * in the Community Edition only; the entrypoint refuses the cloud edition
 * before importing this module.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      validationSchema,
    }),
    EditionModule.forRoot(),
    SecretsModule,
    LoggerModule,
    TypeOrmModule.forRootAsync({
      useFactory: async (
        secretsService: SecretsService,
        configService: ConfigService,
      ) =>
        buildTypeOrmOptions(
          await resolveDbConnection(secretsService, configService),
          { context: 'cli' },
        ),
      inject: [SecretsService, ConfigService],
    }),
    ...(isCommunityEdition() ? [LocalAuthModule] : []),
    ...editionImportsFor('auth-reset-password-cli'),
  ],
  providers: isCommunityEdition() ? [PasswordResetCli] : [],
})
export class AuthResetPasswordCliModule {}
