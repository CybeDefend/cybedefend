import { Module } from '@nestjs/common';
import { DataPurgeController } from './data-purge.controller';
import { DataPurgeService } from './data-purge.service';

@Module({
  // No ScanModule import any more — the pod deletion goes through
  // SCANNER_PODS_PORT, which EditionModule provides in both editions.
  controllers: [DataPurgeController],
  providers: [DataPurgeService],
})
export class DataPurgeModule {}
