import { Logger, Module } from '@nestjs/common';
import { GithubModule } from './github/github.module';
import { GitlabModule } from './gitlab/gitlab.module';
import { IntegrationOverviewModule } from './integration-overview/integration-overview.module';
import { SlackModule } from './slack/slack.module';
import { JiraModule } from './jira/jira.module';
import { LinearModule } from './linear/linear.module';
import { WebhookController } from './webhook.controller';
import { WEBHOOK_BODY_CAP_PROVIDER } from './webhook-body-cap';
import { GithubService } from './github/github.service';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule } from '@nestjs/config';
import { GrpcModule } from '@grpc/grpc.module';
import { SecretsModule } from 'src/core/secrets/secrets.module';
import SecretsService from 'src/core/secrets/secrets.service';
import { GitlabService } from './gitlab/gitlab.service';
import { JiraService } from './jira/jira.service';
import { LinearService } from './linear/linear.service';

@Module({
  imports: [
    SecretsModule,
    JwtModule.registerAsync({
      imports: [SecretsModule],
      useFactory: async (secretsService: SecretsService) => {
        await secretsService.ensureCacheLoaded();
        const jwtSecret = secretsService.getSecret('JWT_SECRET');
        return {
          secret: jwtSecret,
          signOptions: { expiresIn: '300s' },
        };
      },
      inject: [SecretsService],
    }),
    ConfigModule.forRoot(),
    GrpcModule.register(),
    GithubModule,
    GitlabModule,
    // The container registry REST modules are closed (cloud only) and are
    // mounted through ...editionImports() at the app
    // root, like every other closed module.
    SlackModule,
    JiraModule,
    LinearModule,
    IntegrationOverviewModule,
  ],
  controllers: [WebhookController],
  providers: [
    GithubService,
    GitlabService,
    JiraService,
    LinearService,
    Logger,
    WEBHOOK_BODY_CAP_PROVIDER,
  ],
})
export class IntegrationsModule {}
