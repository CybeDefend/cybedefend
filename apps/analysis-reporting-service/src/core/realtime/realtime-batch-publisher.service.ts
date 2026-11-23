import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  Optional,
} from '@nestjs/common';
import { RealtimeEventPublisher } from '@cybedefend/realtime-publisher';
import { ProjectOrgResolver } from './project-org-resolver.service';
import { OverviewCacheService } from 'src/modules/result/overview-cache.service';

export const REALTIME_BATCH_PUBLISHER_OPTIONS =
  'REALTIME_BATCH_PUBLISHER_OPTIONS';
export interface RealtimeBatchPublisherOptions {
  delayMs: number;
}

const DEFAULT_DELAY_MS = 1500;

interface Pending {
  envelope: any;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Coalesces high-frequency realtime events sharing the same scope key into at
 * most one trailing publish per window (a trailing THROTTLE). The first call to
 * publishDebounced(key, env) arms the window; later calls within it only
 * replace the pending envelope and never re-arm the timer, so the latest
 * envelope is guaranteed to go out `delayMs` after the first call even while
 * calls keep coming. A resetting debounce used to stay silent for a whole
 * ingestion when batches arrived less than the window apart, so the issues list never filled in progressively.
 *
 * Used to avoid flooding the dashboard with N near-simultaneous
 * VULNERABILITY_BATCH_APPENDED events from a single scan worker burst.
 *
 * publishNow(key, env) bypasses the window: it drops the pending envelope for
 * that key (its data is superseded) and publishes immediately. Processors use
 * it right after a scanner's finalization succeeds — the last throttled event
 * fires during finalization, and without a trailing event the dashboard keeps
 * showing pre-finalization data until a manual reload.
 *
 * Single-process scope. With multiple worker pods sharing a queue, each pod
 * debounces independently; in the worst case the dashboard sees one event per
 * pod instead of one per batch — still a large reduction.
 *
 * Also enriches the envelope's scope with organizationId (resolved from
 * projectId via the ProjectOrgResolver cache) so the channel router can fan
 * the event out to the org overview channel — the dashboard's overview page
 * needs vuln batches to refresh its summary widgets.
 */
@Injectable()
export class RealtimeBatchPublisher implements OnModuleDestroy {
  private readonly logger = new Logger(RealtimeBatchPublisher.name);
  private readonly pending = new Map<string, Pending>();
  private readonly delayMs: number;

  constructor(
    @Optional() private readonly realtime: RealtimeEventPublisher | null,
    @Optional() private readonly orgResolver: ProjectOrgResolver | null,
    @Optional()
    @Inject(REALTIME_BATCH_PUBLISHER_OPTIONS)
    options?: RealtimeBatchPublisherOptions,
    @Optional() private readonly overviewCache?: OverviewCacheService | null,
  ) {
    this.delayMs = options?.delayMs ?? DEFAULT_DELAY_MS;
  }

  publishDebounced(key: string, envelope: any): void {
    const existing = this.pending.get(key);
    if (existing) {
      // Window already armed: keep its deadline, just carry the latest envelope.
      existing.envelope = envelope;
      return;
    }

    const timer = setTimeout(() => {
      const current = this.pending.get(key);
      this.pending.delete(key);
      void this.fire(current?.envelope ?? envelope);
    }, this.delayMs);

    this.pending.set(key, { envelope, timer });
  }

  publishNow(key: string, envelope: any): void {
    const existing = this.pending.get(key);
    if (existing) {
      clearTimeout(existing.timer);
      this.pending.delete(key);
    }
    void this.fire(envelope);
  }

  flushAll(): void {
    for (const [key, p] of this.pending) {
      clearTimeout(p.timer);
      void this.fire(p.envelope);
      this.pending.delete(key);
    }
  }

  onModuleDestroy(): void {
    for (const p of this.pending.values()) clearTimeout(p.timer);
    this.pending.clear();
  }

  private async fire(envelope: any): Promise<void> {
    if (!this.realtime) return;
    try {
      const projectId: string | undefined = envelope?.scope?.projectId;
      let orgId: string | undefined = envelope?.scope?.organizationId;
      if (projectId && !orgId && this.orgResolver) {
        const resolved = await this.orgResolver.resolveOrgId(projectId);
        if (resolved) {
          orgId = resolved;
          envelope.scope = { ...envelope.scope, organizationId: orgId };
        }
      }
      if (orgId && this.overviewCache) {
        try {
          await this.overviewCache.bumpGeneration(orgId);
        } catch (cacheErr) {
          this.logger.warn(
            `overview cache bump failed: ${(cacheErr as Error).message}`,
          );
        }
      }
      await this.realtime.publish(envelope);
    } catch (err) {
      this.logger.warn(`debounced publish failed: ${(err as Error).message}`);
    }
  }
}
