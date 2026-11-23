import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Logger } from 'nestjs-pino';
import { IsNull, LessThan, Not, Repository } from 'typeorm';

import { Scan } from '../../../entities/scan.entity';
import { importFailure } from '../../../core/constants/scanlink-error-codes';
import { FileManagementService } from '../../file/file-management.service';
import { ScanStateManager } from '../core/scanStateManager';
import { ScanStateStore } from '../core/scanStateStore';
import { importObjectKeysOf } from './import-object-key';

/** An import whose file never arrived is retired after 45 minutes. */
export const IMPORT_WAITING_FOR_FILE_MAX_MS = 45 * 60_000;

/** An import still `running` after 2 hours is retired. */
export const IMPORT_RUNNING_MAX_MS = 2 * 3_600_000;

/**
 * The import watchdog. It runs in the cron worker, in both editions: an import analysis-reporting
 * never completes would otherwise stay `running` for ever, and a
 * never-uploaded one `waiting_for_file`.
 *
 * Every minute it reads the two stuck lists — imports only
 * (`importFormat IS NOT NULL`), so a code scan is never touched — and moves
 * each row to `failed` with 76 IMPORT_TIMEOUT through ONE conditional UPDATE
 * (`ScanStateStore.moveScanState`), the same row `CompleteImportScan` races
 * on: the UPDATE's affected count decides the winner, on both engines. A won
 * move publishes the status change and deletes the import object
 * (`import/<projectId>/<scanId>.sarif`, and its `.sbom` when the import
 * stored one; best effort, never the scan archive);
 * a lost move deletes nothing and is not counted.
 */
@Injectable()
export class ImportScanWatchdog {
  constructor(
    @InjectRepository(Scan)
    private readonly scanRepository: Repository<Scan>,
    private readonly store: ScanStateStore,
    private readonly scanStateManager: ScanStateManager,
    private readonly fileManagementService: FileManagementService,
    private readonly logger: Logger,
  ) {}

  /**
   * The cron entry point: catches and logs, never rejects — a failed tick must
   * not kill the scheduler.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async handleCron(): Promise<void> {
    try {
      const expired = await this.expireStuckImports();
      if (expired > 0) {
        this.logger.log(
          `import watchdog retired ${expired} stuck import scan(s)`,
        );
      }
    } catch (error) {
      this.logger.error(
        `import watchdog failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Retire the stuck import scans and return how many moves were won.
   *
   * @param now The application clock the deadlines are read against.
   */
  async expireStuckImports(now: Date = new Date()): Promise<number> {
    const waitingForFile = await this.scanRepository.find({
      where: {
        state: 'waiting_for_file',
        importFormat: Not(IsNull()),
        createAt: LessThan(
          new Date(now.getTime() - IMPORT_WAITING_FOR_FILE_MAX_MS),
        ),
      },
    });
    const running = await this.scanRepository.find({
      where: {
        state: 'running',
        importFormat: Not(IsNull()),
        startTime: LessThan(new Date(now.getTime() - IMPORT_RUNNING_MAX_MS)),
      },
    });

    let won = 0;
    for (const scan of [...waitingForFile, ...running]) {
      const previousState = scan.state;
      const moved = await this.store.moveScanState(
        scan,
        [previousState],
        'failed',
        { endTime: now, ...importFailure('IMPORT_TIMEOUT') },
      );
      if (!moved) continue;
      won += 1;
      this.logger.warn(
        `IMPORT_TIMEOUT scan=${scan.id} from=${previousState} project=${scan.projectId}`,
      );
      this.scanStateManager.publishStatusChanged(scan, previousState);
      // Best effort, on every won terminal move: the object is
      // deleted, never the scan archive (`deleteFile` is not called for an
      // import).
      for (const key of importObjectKeysOf(scan)) {
        await this.fileManagementService.deleteImportObject(
          scan.projectId,
          key,
        );
      }
    }
    return won;
  }
}
