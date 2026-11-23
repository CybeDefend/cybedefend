import { Injectable, Logger } from '@nestjs/common';
import type { Scan } from 'src/entities/scan.entity';
import { FileManagementService } from '../file/file-management.service';
import { normalizeScanFailure } from '../scan/core/scan-failure.util';
import { ScanStateManager } from '../scan/core/scanStateManager';
import { ScanStateStore } from '../scan/core/scanStateStore';

/**
 * The one end of a Community cluster scan that the engine fails itself (a
 * refused launch, a watchdog deadline): one conditional move to `failed`,
 * then, only for the move that won, the status publish and:
 * - a refused launch (`endOfScan`, the default): the scan's end,
 *   ScanStateManager.handleCompletedScan (the archive goes, once);
 * - a watchdog deadline (`endOfScan: false`): the archive delete only, as
 *   the cloud's checkExpiredScan. A scan that ran no scanner gets no
 *   notifyScanEnded (issues, notification, cyber-risk) nor policy evaluation.
 */
@Injectable()
export class ClusterScanEnd {
  private readonly logger = new Logger(ClusterScanEnd.name);

  constructor(
    private readonly store: ScanStateStore,
    private readonly scanStateManager: ScanStateManager,
    private readonly files: FileManagementService,
  ) {}

  /** @returns true when this call failed the scan. */
  async fail(
    scan: Scan,
    from: string,
    errorCode: number | undefined,
    opts: { now?: Date; endOfScan?: boolean } = {},
  ): Promise<boolean> {
    const now = opts.now ?? new Date();
    const failure =
      errorCode === undefined ? {} : normalizeScanFailure({ errorCode });
    const moved = await this.store.moveScanState(scan, [from], 'failed', {
      endTime: now,
      ...failure,
    });
    if (!moved) return false;
    this.scanStateManager.publishStatusChanged(scan, from);
    try {
      if (opts.endOfScan === false) {
        await this.files.deleteFile(scan.id);
      } else {
        await this.scanStateManager.handleCompletedScan(scan);
      }
    } catch {
      this.logger.warn(`CLUSTER_SCAN_ARCHIVE_DELETE_FAILED scan=${scan.id}`);
    }
    return true;
  }
}
