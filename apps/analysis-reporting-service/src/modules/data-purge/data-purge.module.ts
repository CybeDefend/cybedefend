import { Module } from '@nestjs/common';
import { OrganizationStatisticsModule } from '../organization-statistics/organization-statistics.module';
import { DataPurgeController } from './data-purge.controller';
import { DataPurgeService } from './data-purge.service';

/**
 * Complete data deletion:
 * `cybedefend.analysis_reporting.DataPurgeService`. Uses the application's
 * TypeORM DataSource and the Redis client of the global ScanQueueModule.
 * OrganizationStatisticsModule marks the KPI cards dirty after a project purge
 * (it imports neither ResultModule nor this module: no cycle).
 */
@Module({
  imports: [OrganizationStatisticsModule],
  controllers: [DataPurgeController],
  providers: [DataPurgeService],
  exports: [DataPurgeService],
})
export class DataPurgeModule {}
