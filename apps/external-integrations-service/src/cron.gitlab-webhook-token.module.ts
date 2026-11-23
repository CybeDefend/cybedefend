import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoggerModule } from './core/logger/logger.module';
import { validationSchema } from './core/config/validation.schema';
import { SecretsModule } from './core/secrets/secrets.module';
import SecretsService from './core/secrets/secrets.service';
import { EditionModule } from './edition/edition.module';
import { editionImportsFor } from './edition/edition-imports';
import {
  buildTypeOrmOptions,
  resolveDbConnection,
} from './core/db/typeorm-options';
import { RepoScanQueueModule } from './modules/repo-scan-queue/repo-scan-queue.module';
import { GitlabModule } from './modules/gitlab/gitlab.module';

/**
 * The one-shot process of the `gitlab-webhook-token-migration` task
 * (main.cron.ts). GitlabService needs what the worker gives it: the
 * repo-scan queue producer (RepoScanQueueModule) and the edition bindings;
 * GitlabModule brings Redis, the gRPC clients and the pending rescans.
 */
@Module({
  imports: [
    SecretsModule,
    LoggerModule,
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      validationSchema,
    }),
    EditionModule.forRoot(),
    TypeOrmModule.forRootAsync({
      useFactory: async (
        secretsService: SecretsService,
        configService: ConfigService,
      ) =>
        buildTypeOrmOptions(
          await resolveDbConnection(secretsService, configService),
          { context: 'cron-webhook' },
        ),
      inject: [SecretsService, ConfigService],
    }),
    RepoScanQueueModule,
    GitlabModule,
    ...editionImportsFor('cron-webhook'),
  ],
})
export class CronGitlabWebhookTokenModule {}
