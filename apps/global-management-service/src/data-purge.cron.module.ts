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
import { DataPurgeModule } from './modules/data-purge/data-purge.module';
import { EditionModule } from './edition/edition.module';
import { editionImportsFor } from './edition/edition-imports';

/**
 * Root of the one-shot data purge cron (main.cron-data-purge.ts): the
 * service's configuration, secrets, logger and database, and the purge
 * runner with its gRPC clients and Permify on top. Same connection as
 * AppModule, never the migrations: those belong to the service's own deploy,
 * and a cron pod that migrated would race it.
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
          { context: 'cron-data-purge' },
        ),
      inject: [SecretsService, ConfigService],
    }),
    DataPurgeModule,
    ...editionImportsFor('data-purge-cron'),
  ],
})
export class DataPurgeCronModule {}
