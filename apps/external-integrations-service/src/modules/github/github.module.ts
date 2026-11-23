import { Module } from '@nestjs/common';
import { GithubService } from './github.service';
import { GithubController } from './github.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { GithubIntegration } from '../../entities/github-integration.entity';
import { GithubRepository } from '../../entities/github-repository.entity';
import { GithubBranch } from '../../entities/github-branch.entity';
import { VulnerabilityIssueMapping } from '../../entities/vulnerability-issue-mapping.entity';
import { GrpcModule } from '@grpc/grpc.module';
import { GithubIssueService } from './github-issue.service';
import { IssueDescriptionService } from '../issue/issue-description.service';
import { PendingRescanModule } from '../pending-rescan/pending-rescan.module';
import { RepoHistoryModule } from '../repo-scan-queue/git-history/repo-history.module';

@Module({
  imports: [
    ConfigModule.forRoot(),
    GrpcModule.register(),
    // GithubService records / supersedes deferred rescans.
    PendingRescanModule,
    // GithubService fetches the history of the branch it scans.
    RepoHistoryModule,
    TypeOrmModule.forFeature([
      GithubIntegration,
      GithubRepository,
      GithubBranch,
      VulnerabilityIssueMapping,
    ]),
  ],
  controllers: [GithubController],
  providers: [GithubService, GithubIssueService, IssueDescriptionService],
  exports: [GithubService, GithubIssueService],
})
export class GithubModule {}
