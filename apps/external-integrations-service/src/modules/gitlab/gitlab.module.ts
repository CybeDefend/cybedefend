// external-integrations-service/src/modules/gitlab/gitlab.module.ts

import { Module, Logger } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { GitlabIntegration } from '../../entities/gitlab-integration.entity';
import { GitlabRepository } from '../../entities/gitlab-repository.entity';
import { GitlabBranch } from '../../entities/gitlab-branch.entity';
import { VulnerabilityIssueMapping } from '../../entities/vulnerability-issue-mapping.entity';
import { LoggerModule } from '../../core/logger/logger.module';
import { GitlabController } from './gitlab.controller';
import { GitlabService } from './gitlab.service';
import { GitlabIssueService } from './gitlab-issue.service';
import { GitlabWebhookTokenMigration } from './gitlab-webhook-token-migration';
import { GrpcModule } from '@grpc/grpc.module';
import { SecretsModule } from 'src/core/secrets/secrets.module';
import { IssueDescriptionService } from '../issue/issue-description.service';
import { RedisModule } from '../../core/redis/redis.module';
import { PendingRescanModule } from '../pending-rescan/pending-rescan.module';
import { RepoHistoryModule } from '../repo-scan-queue/git-history/repo-history.module';

/**
 * GitLab Integration Module
 * Provides GitLab OAuth, repository management, and webhook handling
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      GitlabIntegration,
      GitlabRepository,
      GitlabBranch,
      VulnerabilityIssueMapping,
    ]),
    LoggerModule,
    ConfigModule.forRoot(),
    GrpcModule.register(),
    SecretsModule,
    HttpModule,
    // `GitlabService` injects REDIS_CLIENT, so the module that needs it is the
    // module that imports it — the same rule the container-registry modules
    // follow. It used to declare its own identical factory, which opened a
    // second ioredis connection to the same instance and shadowed the shared
    // provider (a local provider wins over a @Global one).
    //
    // Imported HERE rather than left to RedisModule's @Global registration on
    // purpose: that registration only happens if something in the graph pulls
    // RedisModule in, and `worker.module.ts` loads GitlabModule WITHOUT a single
    // container-registry module — the only other importer. Relying on the global
    // scope would have compiled, passed every unit test, and crashed the worker
    // at bootstrap with `UnknownDependenciesException`.
    RedisModule,
    // GitlabService records / supersedes deferred rescans.
    PendingRescanModule,
    // GitlabService fetches the history of the branch it scans.
    RepoHistoryModule,
  ],
  controllers: [GitlabController],
  providers: [
    GitlabService,
    GitlabIssueService,
    IssueDescriptionService,
    GitlabWebhookTokenMigration,
    Logger,
  ],
  exports: [GitlabService, GitlabIssueService, GitlabWebhookTokenMigration],
})
export class GitlabModule {}
