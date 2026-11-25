import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { Scan } from 'src/entities/scan.entity';
import { OrganizationManager } from '../scan/core/organizationManager';
import {
  CLUSTER_SCANNING_CONFIG,
  organizationScanLimit,
  type ClusterScanningConfig,
} from './cluster-scanning.config';
import {
  ClusterScannerOrchestrator,
  QUEUED_CODE_SCAN,
} from './cluster-scanner-orchestrator';
import { ClusterScanningState } from './cluster-scanning.state';

/**
 * The Community cluster engine's dequeue. Every
 * 15 s, in the cron process only (a @Cron fires where ScheduleModule is
 * loaded: CronAppModule), and only while the engine is enabled: a disabled
 * engine leaves its queued scans queued (the watchdog's 6 h deadline still
 * applies).
 *
 * Free slots = MAX_CONCURRENT − the platform's slot-holding running scans
 * (the queue does not count itself). Each organization with scans waiting
 * may start at most the per-organization limit (organizationScanLimit, an
 * instance setting, at least 1) minus its own slot-holding running scans:
 * the dequeue counts the running scans only, so a queued scan never counts
 * against itself and the queue drains. The free slots are shared out one at
 * a time: each pick goes to the organization with the fewest scans running
 * (this tick's picks included), then to the organization whose oldest scan
 * has waited longest, so one organization's backlog never holds another
 * organization's scan back.
 *
 * Reads per tick: the running count, one grouped query over the queue (each
 * waiting organization's queued count and oldest scan), then the scans of
 * the organizations picked, at most one query per free slot, whatever the
 * number of waiting organizations. The picks start through the
 * orchestrator's `launchScan`, the function the direct start calls, the
 * capacity counted again before each launch (launchScan also re-counts after
 * its claim, the organization's scans included). A tick never rejects, one
 * failing scan never stops the others, and a tick re-entered in its own
 * process (@Cron does not prevent it) does nothing. Two replicas ticking at
 * once may pick the same scan: the conditional claim starts it once.
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
      await this.dequeue(this.config);
    } catch (error) {
      this.logger.error(
        `CLUSTER_QUEUE_TICK_FAILED error=${error instanceof Error ? error.name : 'unknown'}`,
      );
    } finally {
      this.ticking = false;
    }
  }

  private async dequeue(config: ClusterScanningConfig): Promise<void> {
    const maxConcurrent = config.maxConcurrent;
    const running = async () =>
      (await this.organizationManager.getSlotHoldingScansCount()).total;
    const snapshot = await this.organizationManager.getSlotHoldingScansCount();
    const free = maxConcurrent - snapshot.total;
    if (free <= 0) return;

    const picks = pickOrganizations(
      await this.waitingOrganizations(),
      snapshot.byOrganization,
      organizationScanLimit(config),
      free,
    );
    // Each picked organization's oldest scans, as many as it was picked.
    const counts = new Map<string | null, number>();
    for (const organizationId of picks) {
      counts.set(organizationId, (counts.get(organizationId) ?? 0) + 1);
    }
    const scansOf = new Map<string | null, Scan[]>();
    for (const [organizationId, take] of counts) {
      scansOf.set(
        organizationId,
        await this.scans.find({
          where: {
            ...QUEUED_CODE_SCAN,
            organizationId: organizationId ?? IsNull(),
          },
          order: { createAt: 'ASC' },
          take,
        }),
      );
    }

    let launched = 0;
    for (const organizationId of picks) {
      const scan = scansOf.get(organizationId)?.shift();
      // Started or cancelled since the grouped read: nothing to take.
      if (!scan) continue;
      // The direct start (API process) may have taken a slot since the read:
      // capacity is counted again before every launch after the first.
      if (launched > 0 && (await running()) >= maxConcurrent) return;
      launched++;
      try {
        await this.orchestrator.launchScan(scan);
      } catch (error) {
        // Not started (cancelled meanwhile, claimed by another replica,
        // project unreadable, seed failed): the scan keeps its state and the
        // next tick sees it again.
        this.logger.warn(
          `CLUSTER_QUEUE_START_FAILED scan=${scan.id} error=${error instanceof Error ? error.name : 'unknown'}`,
        );
      }
    }
  }

  /** Each organization (null: none) with code scans waiting: how many, and since when. */
  private async waitingOrganizations(): Promise<WaitingOrganization[]> {
    const rows = await this.scans
      .createQueryBuilder('s')
      .select('s.organizationId', 'organizationId')
      .addSelect('COUNT(*)', 'waiting')
      .addSelect('MIN(s.createAt)', 'oldest')
      .where({ ...QUEUED_CODE_SCAN })
      .groupBy('s.organizationId')
      .getRawMany<{
        organizationId: string | null;
        waiting: string | number;
        oldest: Date | string | null;
      }>();
    return rows.map((row) => ({
      organizationId: row.organizationId ?? null,
      // COUNT comes back as a string on both engines.
      waiting: Number(row.waiting),
      oldest: row.oldest ? new Date(row.oldest).getTime() : 0,
    }));
  }
}

/** One organization with scans waiting (`oldest`: epoch milliseconds). */
export interface WaitingOrganization {
  organizationId: string | null;
  waiting: number;
  oldest: number;
}

/**
 * The organizations the free slots go to, in launch order, one entry per
 * slot. Each pick goes to the organization with the fewest slot-holding
 * running scans, this tick's picks included, then to the one whose oldest
 * scan has waited longest, then to the smallest id; an organization is never
 * picked beyond its waiting scans or beyond `limit` running. An organization
 * alone in the queue can take every free slot the limit allows; as soon as
 * another one waits, it gets its turn. Scans without an organization form
 * one group, bound by the platform only.
 */
export function pickOrganizations(
  waiting: readonly WaitingOrganization[],
  runningByOrganization: Readonly<Record<string, number>>,
  limit: number,
  free: number,
): Array<string | null> {
  const candidates = waiting
    .map((w) => ({
      ...w,
      running:
        w.organizationId === null
          ? 0
          : (runningByOrganization[w.organizationId] ?? 0),
      left: w.waiting,
    }))
    .sort(
      (a, b) =>
        a.oldest - b.oldest ||
        compareIds(a.organizationId ?? '', b.organizationId ?? ''),
    );
  const picks: Array<string | null> = [];
  while (picks.length < free) {
    let best: (typeof candidates)[number] | undefined;
    for (const c of candidates) {
      if (c.left <= 0) continue;
      if (c.organizationId !== null && c.running >= limit) continue;
      // `candidates` is sorted, so the strict `<` keeps the oldest waiter
      // among the organizations with the fewest scans running.
      if (!best || c.running < best.running) best = c;
    }
    if (!best) break;
    picks.push(best.organizationId);
    best.running++;
    best.left--;
  }
  return picks;
}

/** Locale-independent string order, so the tie-break is the same everywhere. */
function compareIds(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}
