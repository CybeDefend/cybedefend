import { Module } from '@nestjs/common';
import { JiraService } from './jira.service';
import { JiraController } from './jira.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { JiraIntegration } from '../../entities/jira-integration.entity';
import { JiraProjectMapping } from '../../entities/jira-project-mapping.entity';
import { VulnerabilityIssueMapping } from '../../entities/vulnerability-issue-mapping.entity';
import { JiraIssueService } from './jira-issue.service';
import { JiraDescriptionService } from './jira-description.service';
import { GrpcModule } from '@grpc/grpc.module';

@Module({
  imports: [
    ConfigModule.forRoot(),
    GrpcModule.register(),
    TypeOrmModule.forFeature([
      JiraIntegration,
      JiraProjectMapping,
      VulnerabilityIssueMapping,
    ]),
  ],
  controllers: [JiraController],
  providers: [JiraService, JiraIssueService, JiraDescriptionService],
  exports: [JiraService, JiraIssueService],
})
export class JiraModule {}
