import { Module } from '@nestjs/common';
import { DataPurgeController } from './data-purge.controller';
import { DataPurgeService } from './data-purge.service';

/** Purge of a deleted project's, team's or organization's policy data. */
@Module({
  controllers: [DataPurgeController],
  providers: [DataPurgeService],
})
export class DataPurgeModule {}
