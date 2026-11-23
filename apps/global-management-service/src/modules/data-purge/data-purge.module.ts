import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GrpcModule } from '@grpc/grpc.module';
import { DataPurgeJob } from '../../entities/data-purge-job.entity';
import { DataPurgeStep } from '../../entities/data-purge-step.entity';
import { PermifyModule } from '../permify/permify.module';
import { DataPurgeLedger } from './data-purge.ledger';
import { DataPurgeRunner } from './data-purge.runner';
import { DataPurgeSteps } from './data-purge.steps';
import { DataPurgeStore } from './data-purge.store';

/**
 * The purge ledger and its runner: the jobs a project,
 * team or organization deletion records in its own transaction, and the
 * runner that calls each service's DataPurgeService until they are done. The
 * deletions kick the runner after their commit; the CronJob
 * (`main.cron-data-purge.ts`) runs whatever is due.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([DataPurgeJob, DataPurgeStep]),
    GrpcModule.register(),
    PermifyModule,
  ],
  providers: [DataPurgeLedger, DataPurgeStore, DataPurgeSteps, DataPurgeRunner],
  exports: [DataPurgeLedger, DataPurgeRunner],
})
export class DataPurgeModule {}
