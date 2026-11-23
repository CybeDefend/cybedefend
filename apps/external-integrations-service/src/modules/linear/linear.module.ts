import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LinearIntegration } from '../../entities/linear-integration.entity';
import { LinearProjectMapping } from '../../entities/linear-project-mapping.entity';
import { VulnerabilityIssueMapping } from '../../entities/vulnerability-issue-mapping.entity';
import { TokenCipherModule } from '../../core/crypto/token-cipher.module';
import { LinearApiClient } from './linear-api.client';
import { LinearController } from './linear.controller';
import { LinearDescriptionService } from './linear-description.service';
import { LinearFindingStatesService } from './linear-finding-states.service';
import { LinearIssueController } from './linear-issue.controller';
import { LinearIssueService } from './linear-issue.service';
import { LinearService } from './linear.service';
import { LinearWebhookService } from './linear-webhook.service';

/**
 * Linear, organisation-scoped like Jira. SecretsService comes from
 * the global secrets module, the entitlements port from the global
 * EditionModule, the pino Logger from the global LoggerModule.
 *
 * Both controllers are registered here: IssueController (Jira, GitHub, GitLab)
 * lives in AppModule, but LinearIssueController needs nothing from it.
 */
@Module({
  imports: [
    ConfigModule,
    TokenCipherModule,
    TypeOrmModule.forFeature([
      LinearIntegration,
      LinearProjectMapping,
      VulnerabilityIssueMapping,
    ]),
  ],
  controllers: [LinearController, LinearIssueController],
  providers: [
    LinearApiClient,
    LinearService,
    LinearWebhookService,
    LinearDescriptionService,
    LinearIssueService,
    LinearFindingStatesService,
  ],
  exports: [LinearService, LinearIssueService],
})
export class LinearModule {}
