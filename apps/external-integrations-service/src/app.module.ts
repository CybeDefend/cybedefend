import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { GithubModule } from './modules/github/github.module';
import { GitlabModule } from './modules/gitlab/gitlab.module';
import { IssueModule } from './modules/issue/issue.module';
import { IssueController } from './modules/issue/issue.controller';
import { SlackModule } from './modules/slack/slack.module';
import { JiraModule } from './modules/jira/jira.module';
import { LinearModule } from './modules/linear/linear.module';
import { IntegrationsAdminModule } from './modules/integrations-admin/integrations-admin.module';
import { DataPurgeModule } from './modules/data-purge/data-purge.module';
import { ProjectIntegrationStatusModule } from './modules/project-integration-status/project-integration-status.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { validationSchema } from './core/config/validation.schema';
import { LoggerModule } from './core/logger/logger.module';
import { OpenTelemetryModule } from 'nestjs-otel';
import { GrpcModule } from '@grpc/grpc.module';
import SecretsService from './core/secrets/secrets.service';
import { SecretsModule } from './core/secrets/secrets.module';
import { HealthModule } from './core/health/health.module';
import { RepoScanQueueModule } from './modules/repo-scan-queue/repo-scan-queue.module';
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
          { context: 'api' },
        ),
      inject: [SecretsService, ConfigService],
    }),
    OpenTelemetryModule.forRoot({
      metrics: {
        hostMetrics: true,
      },
    }),
    GrpcModule.register(),
    // BullMQ producer surface — GithubService/GitlabService enqueue repo-scan
    // jobs here; the dedicated worker process consumes them.
    RepoScanQueueModule,
    GithubModule,
    GitlabModule,
    IssueModule,
    // The container registry modules belong to the closed edition:
    // mountable at this root only in cloud mode, through ...editionImports()
    // below, like the other closed modules.
    SlackModule,
    JiraModule,
    LinearModule,
    IntegrationsAdminModule,
    DataPurgeModule,
    ProjectIntegrationStatusModule,
    // RepositoryHistoryModule belongs to the closed edition:
    // it reaches this context through ...editionImports() in cloud mode only.
    ...editionImports(),
  ],
  // No CRM controller in the core — CrmSyncApiModule (gRPC handlers +
  // queue producer) reaches this context in cloud mode only, through
  // ...editionImports() below.
  controllers: [AppController, IssueController],
  providers: [AppService],
})
export class AppModule {}
