import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { IssueDescriptionService } from './issue-description.service';

/**
 * Module for issue description generation service.
 * The IssueController is registered in AppModule to avoid circular dependencies.
 */
@Module({
  imports: [ConfigModule],
  providers: [IssueDescriptionService],
  exports: [IssueDescriptionService],
})
export class IssueModule {}
