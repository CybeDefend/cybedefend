import { Module } from '@nestjs/common';
import { ScanController } from './scan.controller';
import { ScanService } from './scan.service';
import { ScanCoreModule } from './scan-core.module';
import { ImportScanService } from './import/import-scan.service';
import { ImportScanWatchdog } from './import/import-scan.watchdog';
import { ScanResultsFinalizationSweeper } from './core/scan-results-finalization.sweeper';
import { SecretsModule } from 'src/core/secrets/secrets.module';

// The scan cron (queue, pod watchdog, diff-scan sweep) belongs to the closed
// edition; ScanModule provides only ScanService, which it exports.
@Module({
  imports: [ScanCoreModule, SecretsModule],
  controllers: [ScanController],
  // ImportScanService serves CreateScan/StartScan of import scans;
  // its dependencies (repositories, core primitives, gRPC clients,
  // ENTITLEMENTS_PORT) come from ScanCoreModule, GrpcModule and the global
  // EditionModule.
  // ImportScanWatchdog retires stuck import scans from the cron
  // worker; it is a core provider in both editions, its @Cron runs
  // where ScheduleModule is loaded (CronAppModule). So does
  // ScanResultsFinalizationSweeper, which ends the scans held for their
  // results.
  // The per-container upload tokens, the scanner results route and the end
  // of a Community cluster container's import live in the Community-only
  // ClusterScanningModule, so the closed edition's module graph holds none of
  // them. ImportScanService takes
  // ScanResultsService @Optional() from that global module.
  providers: [
    ScanService,
    ImportScanService,
    ImportScanWatchdog,
    ScanResultsFinalizationSweeper,
  ],
  // The data purge does not import ScanModule: it reaches the pods through
  // SCANNER_PODS_PORT (EditionModule provides it in both editions).
  exports: [ScanCoreModule, ScanService],
})
export class ScanModule {}
