import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JiraIntegration } from '../../entities/jira-integration.entity';
import { LinearIntegration } from '../../entities/linear-integration.entity';
import { GithubIntegration } from '../../entities/github-integration.entity';
import { GitlabIntegration } from '../../entities/gitlab-integration.entity';
import { SlackIntegration } from '../../entities/slack-integration.entity';
import { IntegrationsAdminService } from './integrations-admin.service';
import { OrphanIntegrationsCleanupService } from './orphan-integrations-cleanup.service';
import { IntegrationsAdminController } from './integrations-admin.controller';
import { LoggerModule } from '../../core/logger/logger.module';
import { GrpcModule } from '../../core/grpc/grpc.module';

/**
 * Org-wide count and bulk delete for integration entities. Used by
 * billing-service plan transitions (Trial -> Developer wipes everything) and,
 * via OrphanIntegrationsCleanupService, by the orphan sweep.
 *
 * The container registry token tables are not here: the service counts and
 * deletes them through CONTAINER_REGISTRIES_ADMIN_PORT, bound by the edition
 * layer (no-op in the Community Edition, the closed tables in cloud).
 */
@Module({
  imports: [
    LoggerModule,
    GrpcModule.register(),
    TypeOrmModule.forFeature([
      JiraIntegration,
      LinearIntegration,
      GithubIntegration,
      GitlabIntegration,
      SlackIntegration,
    ]),
  ],
  controllers: [IntegrationsAdminController],
  providers: [IntegrationsAdminService, OrphanIntegrationsCleanupService],
  exports: [IntegrationsAdminService, OrphanIntegrationsCleanupService],
})
export class IntegrationsAdminModule {}
