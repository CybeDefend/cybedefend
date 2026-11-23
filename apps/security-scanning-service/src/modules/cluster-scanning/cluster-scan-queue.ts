import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { Scan } from 'src/entities/scan.entity';
import { OrganizationManager } from '../scan/core/organizationManager';
import {
  CLUSTER_SCANNING_CONFIG,
  type ClusterScanningConfig,
} from './cluster-scanning.config';
import { ClusterScannerOrchestrator } from './cluster-scanner-orchestrator';
import { ClusterScanningState } from './cluster-scanning.state';

/**
 * The Community cluster engine's dequeue. Every
 * 15 s, in the cron process only (a @Cron fires where ScheduleModule is
 * loaded: CronAppModule), and only while the engine is enabled: a disabled
 * engine leaves its queued scans queued (the watchdog's 6 h deadline still
 * applies).
 *
 * Free slots = MAX_CONCURRENT − the platform's slot-holding running scans
 * (the queue does not count itself). The oldest queued code scans
 * (`createAt` ASC) take them, one at a time, through the orchestrator's
 * `launchScan`, the function the direct start calls, the capacity counted
 * again before each launch (launchScan also re-counts after its claim). A
 * tick never rejects, one failing scan never stops the others, and a tick
 * re-entered in its own process (@Cron does not prevent it) does nothing.
 */
@Injectable()
export class ClusterScanQueue {
  private readonly logger = new Logger(ClusterScanQueue.name);
  private ticking = false;

  constructor(
    @InjectRepository(Scan)
    private readonly scans: Repository<Scan>,
    private readonly organizationManager: OrganizationManager,
    private readonly orchestrator: ClusterScannerOrchestrator,
    private readonly state: ClusterScanningState,
    @Inject(CLUSTER_SCANNING_CONFIG)
    private readonly config: ClusterScanningConfig | null,
  ) {}

  @Cron('*/15 * * * * *')
  async tick(): Promise<void> {
    if (this.ticking || !this.config || !this.state.enabled) return;
    this.ticking = true;
    try {
      await this.dequeue(this.config.maxConcurrent);
    } catch (error) {
      this.logger.error(
        `CLUSTER_QUEUE_TICK_FAILED error=${error instanceof Error ? error.name : 'unknown'}`,
      );
    } finally {
      this.ticking = false;
    }
  }

  private async dequeue(maxConcurrent: number): Promise<void> {
    const running = async () =>
      (await this.organizationManager.getSlotHoldingScansCount()).total;
    const free = maxConcurrent - (await running());
    if (free <= 0) return;
    const queued = await this.scans.find({
      where: {
        state: 'queued',
        isDiffScan: false,
        isGraphOnly: false,
        importFormat: IsNull(),
      },
      order: { createAt: 'ASC' },
      take: free,
    });
    for (const [i, scan] of queued.entries()) {
      // The direct start (API process) may have taken a slot since the read:
      // capacity is counted again before every launch after the first.
      if (i > 0 && (await running()) >= maxConcurrent) return;
      try {
        await this.orchestrator.launchScan(scan);
      } catch (error) {
        // Not started (cancelled meanwhile, project unreadable, seed failed):
        // the scan keeps its state and the next tick sees it again.
        this.logger.warn(
          `CLUSTER_QUEUE_START_FAILED scan=${scan.id} error=${error instanceof Error ? error.name : 'unknown'}`,
        );
      }
    }
  }
}
