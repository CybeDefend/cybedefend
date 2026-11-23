import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { LoggerModule } from './core/logger/logger.module';
import { FileModule } from './file/file.module';
import { DataPurgeModule } from './file/data-purge/data-purge.module';
import { validationSchema } from './core/config/validation.schema';
import { SecretsModule } from './core/secrets/secrets.module';
import { HealthModule } from './core/health/health.module';
import SecretsService from './core/secrets/secrets.service';
import { OpenTelemetryModule } from 'nestjs-otel';
import { EditionModule } from './edition/edition.module';
import { editionImports } from './edition/edition-imports';
import {
  buildTypeOrmOptions,
  resolveDbConnection,
} from './core/db/typeorm-options';

@Module({
  imports: [
    OpenTelemetryModule.forRoot({
      metrics: {
        hostMetrics: false,
      },
    }),
    SecretsModule,
    HealthModule,
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
          {
            context: 'api',
          },
        ),
      inject: [SecretsService, ConfigService],
    }),
    FileModule,
    DataPurgeModule,
    LoggerModule,
    ...editionImports(),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
