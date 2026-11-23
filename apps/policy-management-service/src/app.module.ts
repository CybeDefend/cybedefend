import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoggerModule } from './core/logger/logger.module';
import { validationSchema } from './core/config/validation.schema';
import { GrpcModule } from '@grpc/grpc.module';
import { RealtimePublisherModule } from '@cybedefend/realtime-publisher';
import { SecretsModule } from './core/secrets/secrets.module';
import { HealthModule } from './core/health/health.module';
import SecretsService from './core/secrets/secrets.service';
import { buildPolicyTypeOrmOptions } from './core/config/typeorm-options';
import { OpenTelemetryModule } from 'nestjs-otel';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { EditionModule } from './edition/edition.module';
import { editionImports, editionMigrations } from './edition/edition-imports';

// Feature modules
import { PolicyModule } from '@modules/policy/policy.module';
import { EvaluationModule } from '@modules/evaluation/evaluation.module';
import { ViolationModule } from '@modules/violation/violation.module';
import { EvaluationQueueModule } from '@modules/evaluation-queue/evaluation-queue.module';
import { QueueMetricsModule } from '@modules/evaluation-queue/queue-metrics.module';
import { DataPurgeModule } from '@modules/data-purge/data-purge.module';

/**
 * Root application module for the Policy Management Service.
 * Configures database connection, logging, and all feature modules.
 */
@Module({
  imports: [
    OpenTelemetryModule.forRoot({
      metrics: {
        hostMetrics: false,
      },
    }),
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      validationSchema,
    }),
    EditionModule.forRoot(),
    SecretsModule,
    HealthModule,
    LoggerModule,
    GrpcModule.register(),
    RealtimePublisherModule.forRoot({
      realtimeRedisUrl:
        process.env.REALTIME_REDIS_URL ?? process.env.REDIS_URL!,
    }),
    TypeOrmModule.forRootAsync({
      useFactory: (
        secretsService: SecretsService,
        configService: ConfigService,
      ) =>
        buildPolicyTypeOrmOptions(secretsService, configService, {
          entities: [__dirname + '/entities/**/*.entity{.ts,.js}'],
          migrations: editionMigrations(
            __dirname + '/core/migrations/*{.ts,.js}',
          ),
          migrationsRun:
            configService.get<string>('NODE_ENV') !== 'development',
          autoLoadEntities: true,
        }),
      inject: [SecretsService, ConfigService],
    }),
    // Feature modules
    EvaluationQueueModule,
    QueueMetricsModule,
    PolicyModule,
    EvaluationModule,
    ViolationModule,
    DataPurgeModule,
    ...editionImports(),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
