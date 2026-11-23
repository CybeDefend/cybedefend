import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoggerModule } from './core/logger/logger.module';
import { OrganizationModule } from './modules/organization/organization.module';
import { UserModule } from './modules/user/user.module';
import { ProjectModule } from './modules/project/project.module';
import { TeamModule } from './modules/team/team.module';
import { validationSchema } from './core/config/validation.schema';
import { GrpcModule } from '@grpc/grpc.module';
import { SecretsModule } from './core/secrets/secrets.module';
import SecretsService from './core/secrets/secrets.service';
import {
  buildTypeOrmOptions,
  resolveDbConnection,
} from './core/db/typeorm-options';
import { OpenTelemetryModule } from 'nestjs-otel';
import { PermifyModule } from './modules/permify/permify.module';
import { AuthorizationModule } from './modules/authorization/authorization.module';
import { RealtimePublisherModule } from '@cybedefend/realtime-publisher';
import { HealthModule } from './core/health/health.module';
import { EditionModule } from './edition/edition.module';
import { editionImports } from './edition/edition-imports';
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
    UserModule,
    LoggerModule,
    HealthModule,
    GrpcModule.register(),
    OrganizationModule,
    TeamModule,
    ProjectModule,
    PermifyModule,
    AuthorizationModule,
    RealtimePublisherModule.forRoot({
      realtimeRedisUrl:
        process.env.REALTIME_REDIS_URL ?? process.env.REDIS_URL!,
    }),
    TypeOrmModule.forRootAsync({
      // The connection lives in core/db/typeorm-options.ts, the one factory
      // for both engines, shared with the crons. The service runs the
      // migrations outside development, exactly as before; the crons never do.
      useFactory: async (
        secretsService: SecretsService,
        configService: ConfigService,
      ) =>
        buildTypeOrmOptions(
          await resolveDbConnection(secretsService, configService),
          { context: 'api' },
        ),
      inject: [SecretsService, ConfigService],
    }),
    ...editionImports(),
  ],
  controllers: [],
})
export class AppModule {}
