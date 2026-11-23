import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { DeprecatedApiKeyMiddleware } from './core/middleware/deprecated-api-key.middleware';
import { OrganizationModule } from './modules/organization/organization.module';
import { ProjectModule } from './modules/project/project.module';
import { TeamModule } from './modules/team/team.module';
import { LoggerModule } from './core/logger/logger.module';
import { ConfigModule } from '@nestjs/config';
import { ResultModule } from './modules/result/result.module';
import { ScanModule } from './modules/scan/scan.module';
import { UserModule } from './modules/user/user.module';
import { VulnerabilityModule } from './modules/vulnerability/vulnerability.module';
import { IntegrationsModule } from './modules/integrations/integrations.module';
import { PolicyModule } from './modules/policy/policy.module';
import { validationSchema } from './core/config/validation.schema';
import { GrpcModule } from '@grpc/grpc.module';
import { ProjectOrgModule } from './core/project-org/project-org.module';
import { GatewayRedisModule } from './core/redis/gateway-redis.module';
import { SecretsModule } from './core/secrets/secrets.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { MeAsyncTasksModule } from './modules/me-async-tasks/me-async-tasks.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { OpenTelemetryModule } from 'nestjs-otel';
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
    GrpcModule.register(),
    GatewayRedisModule,
    ProjectOrgModule,
    SecretsModule,
    LoggerModule,
    OrganizationModule,
    ProjectModule,
    TeamModule,
    ScanModule,
    ResultModule,
    UserModule,
    VulnerabilityModule,
    IntegrationsModule,
    PolicyModule,
    RealtimeModule,
    MeAsyncTasksModule,
    ...editionImports(),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(DeprecatedApiKeyMiddleware).forRoutes('*');
  }
}
