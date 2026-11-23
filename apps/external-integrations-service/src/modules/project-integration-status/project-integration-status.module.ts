import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GithubRepository } from '../../entities/github-repository.entity';
import { GitlabRepository } from '../../entities/gitlab-repository.entity';
import { JiraIntegration } from '../../entities/jira-integration.entity';
import { LinearIntegration } from '../../entities/linear-integration.entity';
import { LoggerModule } from '../../core/logger/logger.module';
import { ProjectIntegrationStatusController } from './project-integration-status.controller';
import { ProjectIntegrationStatusService } from './project-integration-status.service';
import { GithubModule } from '../github/github.module';
import { GitlabModule } from '../gitlab/gitlab.module';

@Module({
  imports: [
    LoggerModule,
    // resolveScanBranch checks a branch with the provider's service.
    GithubModule,
    GitlabModule,
    TypeOrmModule.forFeature([
      GithubRepository,
      GitlabRepository,
      JiraIntegration,
      LinearIntegration,
    ]),
  ],
  controllers: [ProjectIntegrationStatusController],
  providers: [ProjectIntegrationStatusService],
})
export class ProjectIntegrationStatusModule {}
