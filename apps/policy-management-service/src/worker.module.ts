import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoggerModule } from './core/logger/logger.module';
import { SecretsModule } from './core/secrets/secrets.module';
import SecretsService from './core/secrets/secrets.service';
import { buildPolicyTypeOrmOptions } from './core/config/typeorm-options';
import { validationSchema } from './core/config/validation.schema';
import { GrpcModule } from '@grpc/grpc.module';
import { RealtimePublisherModule } from '@cybedefend/realtime-publisher';
import { EditionModule } from './edition/edition.module';
import { editionImportsFor } from './edition/edition-imports';

// Queue module
import { EvaluationQueueModule } from '@modules/evaluation-queue/evaluation-queue.module';

// Processor
import { PolicyEvaluationProcessor } from '@modules/evaluation-queue/processors/policy-evaluation.processor';

// Services needed by processor
import { PolicyService } from '@modules/policy/policy.service';
import { PolicyYamlService } from '@modules/policy/policy-yaml.service';
import { PolicyValidationService } from '@modules/policy/policy-validation.service';

// Entities
import { SecurityPolicy } from '@entities/security-policy.entity';
import { PolicyViolation } from '@entities/policy-violation.entity';
import { PolicyEvaluation } from '@entities/policy-evaluation.entity';

/**
 * Dedicated Worker module for BullMQ queue processing.
 *
 * This module runs in a SEPARATE PROCESS from the main gRPC server.
 * It has its own:
 * - Database connection pool
 * - Redis/BullMQ connection
 * - Queue processors
 * - Required services (PolicyService, etc.)
 *
 * This architecture ensures that heavy queue processing doesn't block
 * the main gRPC server's event loop.
 *
 * Usage:
 *   WORKER_MODE=true node dist/worker.js
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
    // Database connection - separate pool from main app
    TypeOrmModule.forRootAsync({
      useFactory: (
        secretsService: SecretsService,
        configService: ConfigService,
      ) =>
        buildPolicyTypeOrmOptions(secretsService, configService, {
          entities: [SecurityPolicy, PolicyViolation, PolicyEvaluation],
        }),
      inject: [SecretsService, ConfigService],
    }),
    // Entity repositories for services
    TypeOrmModule.forFeature([
      SecurityPolicy,
      PolicyViolation,
      PolicyEvaluation,
    ]),
    // Queue module with Redis connection
    EvaluationQueueModule,
    // gRPC clients for fetching vulnerabilities
    GrpcModule.register(),
    // Realtime event publishing
    RealtimePublisherModule.forRoot({
      realtimeRedisUrl:
        process.env.REALTIME_REDIS_URL ?? process.env.REDIS_URL!,
    }),
    ...editionImportsFor('worker'),
  ],
  providers: [
    // Services needed by processors
    PolicyYamlService,
    PolicyValidationService,
    PolicyService,
    // The processor itself
    PolicyEvaluationProcessor,
  ],
})
export class WorkerModule {}
