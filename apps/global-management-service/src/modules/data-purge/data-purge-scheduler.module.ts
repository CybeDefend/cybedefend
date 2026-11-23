import { Module } from '@nestjs/common';
import { DataPurgeModule } from './data-purge.module';
import { DataPurgeScheduler } from './data-purge.scheduler';

/**
 * The in-process data purge schedule of the Community Edition,
 * loaded only through COMMUNITY_ONLY_MODULES, i.e. in the API context in
 * community mode. The cloud runs the same `runDue()` from its CronJob
 * (`main.cron-data-purge.ts`) and never loads this module.
 */
@Module({
  imports: [DataPurgeModule],
  providers: [DataPurgeScheduler],
})
export class DataPurgeSchedulerModule {}
