import { Module } from '@nestjs/common';
import { LoggerModule } from './core/logger/logger.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { validationSchema } from './core/config/validation.schema';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JiraModule } from './modules/jira/jira.module';
import { JiraWebhookCron } from './modules/jira/jira-webhook.cron';
import { SecretsModule } from './core/secrets/secrets.module';
import SecretsService from './core/secrets/secrets.service';
import { EditionModule } from './edition/edition.module';
import { editionImportsFor } from './edition/edition-imports';
import {
  buildTypeOrmOptions,
  resolveDbConnection,
} from './core/db/typeorm-options';

// Lightweight module that only loads what Jira webhook refresh needs.
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
    // No ScheduleModule: this entrypoint is a one-shot K8s CronJob (the
    // schedule lives in the Helm chart), not a self-scheduling daemon.
    JiraModule,
    ...editionImportsFor('cron-webhook'),
  ],
  providers: [JiraWebhookCron],
})
export class CronWebhookModule {}
