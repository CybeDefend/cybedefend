import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron } from '@nestjs/schedule';
import { Logger } from 'nestjs-pino';
import { IsNull, LessThan, Repository } from 'typeorm';

import { Scan } from '../../../entities/scan.entity';
import { ScanStateManager } from './scanStateManager';
import { allContainersClosed } from './resultsHold';

/** A held scan is asked again once it has been held this long. */
const RECHECK_AFTER_MS_DEFAULT = 20_000;

/**
 * Past this hold, a scan whose results never became final ends
 * `completed_degraded`. Above analysis-reporting's own give-up window on a
 * scanner's results, so it only fires when analysis-reporting never answered.
 */
const FINALIZATION_MAX_MS_DEFAULT = 5_400_000;

/**
 * A delay from the environment. A malformed value, or one that is not
 * strictly positive, keeps the default: a typo must never turn the ceiling
 * off.
 */
function delayFromEnv(key: string, fallback: number): number {
  const raw = process.env[key]?.trim();
  const value = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * The sweeper of the scans held for their results. A scan whose containers
 * are all closed stays `running` until analysis-reporting says its results
 * are final (NotifyScanEnded at the hold, then MarkScanResultsFinal). Either
 * signal can be lost: a restart, an analysis-reporting that is down or
 * predates the callback. Every 30 s, in the cron process only (a @Cron fires
 * where ScheduleModule is loaded: CronAppModule), in both editions:
 *
 * - a scan held for `SCAN_RESULTS_RECHECK_AFTER_MS` (20 s) or more is asked
 *   again, once; when its results are final, it ends (`finalizeResults`);
 * - a scan held for more than `SCAN_RESULTS_FINALIZATION_MAX_MS` (90 min) is
 *   ended without asking, `completed_degraded` with the reason
 *   `results_processing`, and logged `SCAN_RESULTS_NOT_FINALIZED`;
 * - a scan whose results were finalized but which is still `running` (its
 *   terminal write failed after the finalization) gets its terminal state
 *   written.
 *
 * The hold is counted from the last container that closed, else from the
 * scan's last update. Both delays are tuning variables with a default in
 * code, read once at construction. A sweep never rejects, one failing scan
 * never stops the others, and a sweep that starts while the previous one
 * still runs does nothing.
 */
@Injectable()
export class ScanResultsFinalizationSweeper {
  private readonly recheckAfterMs: number;
  private readonly finalizationMaxMs: number;
  private sweeping = false;

  constructor(
    @InjectRepository(Scan)
    private readonly scanRepository: Repository<Scan>,
    private readonly scanStateManager: ScanStateManager,
    private readonly logger: Logger,
  ) {
    this.recheckAfterMs = delayFromEnv(
      'SCAN_RESULTS_RECHECK_AFTER_MS',
      RECHECK_AFTER_MS_DEFAULT,
    );
    this.finalizationMaxMs = delayFromEnv(
      'SCAN_RESULTS_FINALIZATION_MAX_MS',
      FINALIZATION_MAX_MS_DEFAULT,
    );
  }

  @Cron('*/30 * * * * *')
  async sweep(): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      const now = Date.now();
      await this.endFinalizedScans(now);
      await this.settleHeldScans(now);
    } catch (error) {
      this.logger.error(
        `[ResultsHold] results sweep failed: ${errorMessage(error)}`,
      );
    } finally {
      this.sweeping = false;
    }
  }

  /** Ask again, or give up on, each scan held for its results. */
  private async settleHeldScans(now: number): Promise<void> {
    const scans = await this.scanRepository.find({
      where: {
        state: 'running',
        resultsFinalizedAt: IsNull(),
        isGraphOnly: false,
        importFormat: IsNull(),
      },
      relations: { containers: true },
      select: {
        id: true,
        projectId: true,
        organizationId: true,
        updatedAt: true,
        containers: { id: true, status: true, finishedAt: true },
      },
    });
    for (const scan of scans) {
      if (!allContainersClosed(scan.containers)) continue;
      try {
        await this.settleHeldScan(scan, now - heldSince(scan));
      } catch (error) {
        this.logger.error(
          `[ResultsHold] Scan ${scan.id} could not be swept, it stays held: ${errorMessage(error)}`,
        );
      }
    }
  }

  private async settleHeldScan(scan: Scan, heldMs: number): Promise<void> {
    if (heldMs < this.recheckAfterMs) return;
    if (heldMs > this.finalizationMaxMs) {
      this.logger.warn(
        `SCAN_RESULTS_NOT_FINALIZED scan=${scan.id} heldMs=${heldMs}`,
      );
      await this.scanStateManager.finalizeResults(scan.id, {
        resultsTimedOut: true,
      });
      return;
    }
    if (await this.scanStateManager.askResultsFinal(scan, 'once')) {
      await this.scanStateManager.finalizeResults(scan.id);
    }
  }

  /**
   * Write the terminal state of the scans whose results were finalized but
   * which are still `running`: the finalization's terminal write failed, and
   * no results signal will come for them again. Only once the finalization
   * is older than the recheck delay, so a finalization still writing its
   * terminal state is not ended twice.
   */
  private async endFinalizedScans(now: number): Promise<void> {
    const scans = await this.scanRepository.find({
      where: {
        state: 'running',
        resultsFinalizedAt: LessThan(new Date(now - this.recheckAfterMs)),
        isGraphOnly: false,
        importFormat: IsNull(),
      },
      relations: { containers: true },
    });
    for (const scan of scans) {
      if (!allContainersClosed(scan.containers)) continue;
      try {
        this.logger.warn(
          `[ResultsHold] Scan ${scan.id} has final results but is still running: writing its terminal state`,
        );
        await this.scanStateManager.updateScanState(scan);
      } catch (error) {
        this.logger.error(
          `[ResultsHold] Scan ${scan.id} terminal state could not be written: ${errorMessage(error)}`,
        );
      }
    }
  }
}

/**
 * When a held scan's hold began: the end of its last container, else the
 * scan's last update.
 */
function heldSince(scan: Scan): number {
  const ends = (scan.containers ?? [])
    .map((container) => container.finishedAt)
    .filter((finishedAt) => finishedAt != null)
    .map((finishedAt) => new Date(finishedAt).getTime());
  return ends.length > 0
    ? Math.max(...ends)
    : new Date(scan.updatedAt).getTime();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
