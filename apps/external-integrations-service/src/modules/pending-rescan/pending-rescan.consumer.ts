import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { GithubService } from '../github/github.service';
import { GitlabService } from '../gitlab/gitlab.service';
import {
  ClaimedRescan,
  PendingRescan,
  PendingRescanOutcome,
  PendingRescanStore,
} from './pending-rescan.store';

/** How often a worker looks for due pending rescans. */
export const PENDING_RESCAN_TICK_MS = 30_000;
/** Entries claimed per tick and per worker. */
const PENDING_RESCAN_BATCH = 20;

/**
 * Consumer of the deferred rescans of refused pushes. Runs in
 * the repo-scan worker process only (WorkerModule), never in the gRPC API.
 *
 * Where a deferred rescan is consumed, and why it cannot loop:
 *  - every PENDING_RESCAN_TICK_MS each worker pod claims the due entries; a
 *    claim is atomic, so two pods never process the same entry at once;
 *  - an entry's check is due PENDING_RESCAN_RETRY_DELAY_MS after the refused
 *    push, then again every PENDING_RESCAN_RETRY_DELAY_MS while the branch is
 *    still being scanned. "The scan ended" is read from security-scanning's
 *    CheckExistingScan, the very check that refused the push, so it holds
 *    whatever way that scan ended (completed, failed, cancelled, expired);
 *  - once the branch is free the entry starts ONE scan (the regular push
 *    start) of the branch head read from the provider at that moment, unless
 *    that head is the commit whose scan last started, and is forgotten. A
 *    push refused meanwhile replaces it, so at most one rescan is pending per
 *    (project, branch); reading the head means a newer push arrived after
 *    the claim, or pushes delivered out of order, never make an older commit
 *    scanned after a newer one;
 *  - a scan started by any other path (push, manual, consumer) forgets the
 *    pushes refused before it (PendingRescanStore.supersede);
 *  - the consumer never records an entry: only a refused push webhook does.
 *    Re-arming never extends the entry's TTL, so an entry nobody can consume
 *    (a branch that stays busy, an error that keeps coming back) disappears
 *    after PENDING_RESCAN_TTL_SECONDS (6 h) at the latest; only a final
 *    refusal drops it sooner.
 */
@Injectable()
export class PendingRescanConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PendingRescanConsumer.name);
  private timer: NodeJS.Timeout | undefined;
  private ticking = false;

  constructor(
    private readonly store: PendingRescanStore,
    private readonly githubService: GithubService,
    private readonly gitlabService: GitlabService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.tick();
    }, PENDING_RESCAN_TICK_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /**
   * Processes the entries due now. Returns how many were claimed; a tick that
   * overlaps a running one, or fails to claim, claims nothing.
   */
  async tick(): Promise<number> {
    if (this.ticking) {
      return 0;
    }
    this.ticking = true;
    try {
      const claims = await this.store.claimDue(PENDING_RESCAN_BATCH);
      for (const claim of claims) {
        await this.consume(claim);
      }
      return claims.length;
    } catch (error: unknown) {
      this.logger.warn(`PENDING_RESCAN claim failed: ${error}`);
      return 0;
    } finally {
      this.ticking = false;
    }
  }

  private async consume(claim: ClaimedRescan): Promise<void> {
    try {
      if (!claim.entry) {
        // Expired since it was scheduled, or unreadable: nothing to scan.
        await this.store.settle(claim);
        this.logger.log(
          `PENDING_RESCAN_DROPPED reason=expired entry=${claim.raw === null ? 'absent' : 'unreadable'} member=${claim.member}`,
        );
        return;
      }
      const { entry } = claim;
      const outcome = await this.run(entry);
      if (outcome === 'busy') {
        if (!(await this.store.rearm(claim.member))) {
          this.logger.log(
            `PENDING_RESCAN_DROPPED reason=expired provider=${entry.provider} project=${entry.projectId} branch=${entry.branch} commit=${entry.commitSha}`,
          );
        }
        return;
      }
      await this.store.settle(claim);
      this.logger.log(
        `PENDING_RESCAN outcome=${outcome} provider=${entry.provider} project=${entry.projectId} branch=${entry.branch} commit=${entry.commitSha}`,
      );
    } catch (error: unknown) {
      // Redis failed while settling: the entry keeps its lease and is
      // claimed again once it runs out.
      this.logger.warn(`PENDING_RESCAN ${claim.member} not settled: ${error}`);
    }
  }

  private async run(entry: PendingRescan): Promise<PendingRescanOutcome> {
    try {
      return entry.provider === 'github'
        ? await this.githubService.runPendingRescan(entry)
        : await this.gitlabService.runPendingRescan(entry);
    } catch (error: unknown) {
      // Checked again later: the entry's TTL bounds the retries.
      this.logger.warn(
        `PENDING_RESCAN failed for project ${entry.projectId} (branch ${entry.branch}), checked again later: ${error}`,
      );
      return 'busy';
    }
  }
}
