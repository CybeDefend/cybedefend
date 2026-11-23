import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Span } from 'nestjs-otel';
import { ulid } from 'ulid';
import { RealtimeEventPublisher } from '@cybedefend/realtime-publisher';
import { UpdateScanRequest } from '@grpc/security-scanning/scan';

import { Scan } from '../../../entities/scan.entity';
import { Container } from '../../../entities/container.entity';
import { holdsScanSlot, isAgentContainer } from './scanPipeline';
import {
  readScanPipelineConfig,
  ScanPipelineConfig,
} from './scanPipelineConfig';

/**
 * Why a scan's pipeline moved: the `reason` of SCAN_PIPELINE_CHANGED.
 */
export type PipelineChangeReason =
  | 'container_status'
  | 'slot_released'
  | 'agent_stage'
  | 'ai_progress';

/**
 * The SCAN_PIPELINE_CHANGED publisher of the scan pipeline, extracted from
 * `ScanService` so the edition implementations can inject it.
 */
@Injectable()
export class ScanPipelineEvents {
  private readonly pipelineConfig: ScanPipelineConfig;

  constructor(
    private readonly realtime: RealtimeEventPublisher,
    private readonly configService: ConfigService,
  ) {
    this.pipelineConfig = readScanPipelineConfig((key) =>
      this.configService.get<string>(key),
    );
  }

  /**
   * Tells the Results page that a scan's pipeline moved: the page refetches
   * the scan, whose pipeline carries the detail. The scope comes from the
   * scan row, so the event only reaches the project stream the gateway authorised through Permify
   * (`cybe:event:project:<projectId>:issues`, none without a project).
   *
   * Deduplicated for 5 s on `scan:<id>:pipeline:<reason>[:<detail>]`. The
   * detail names the transition, so two different ones both go out;
   * `ai_progress` has none, so a scan's analysis progress publishes at most
   * once every 5 s. Fire-and-forget: the publisher never rejects.
   */
  @Span()
  publishPipelineChanged(
    scan: Pick<Scan, 'id' | 'organizationId' | 'projectId'>,
    reason: PipelineChangeReason,
    detail = '',
  ): void {
    const suffix = reason !== 'ai_progress' && detail ? `:${detail}` : '';
    void this.realtime.publish(
      {
        eventId: ulid(),
        type: 'SCAN_PIPELINE_CHANGED',
        scope: {
          organizationId: scan.organizationId,
          projectId: scan.projectId,
          scanId: scan.id,
        },
        payload: { scanPipelineChanged: { scanId: scan.id, reason } },
      },
      {
        dedupeKey: `scan:${scan.id}:pipeline:${reason}${suffix}`,
        dedupeTtlSec: 5,
      },
    );
  }

  /**
   * SCAN_PIPELINE_CHANGED for an UpdateScan that was applied to a container:
   * - `container_status` when the container's status changed;
   * - `slot_released` when that change released the scan's slot: the scan
   *   still runs, and its containers held the slot before the change and no
   *   longer do. Never with the kill switch off;
   * - `ai_progress` when the agent's processed count changed.
   *
   * Runs after `updateScanState`, which leaves on `scan` the containers it
   * loaded after the change: the slot check reads them, with the container's
   * former status for "before", and costs no query.
   */
  @Span()
  publishContainerUpdate(
    scan: Scan,
    container: Container,
    update: UpdateScanRequest,
    before: { status: string; processed: number | null },
  ): void {
    const status = update.state || before.status;
    if (status !== before.status) {
      this.publishPipelineChanged(
        scan,
        'container_status',
        `${container.id}:${status}`,
      );
      if (
        this.changesReleasedScanSlot(
          scan,
          new Map([[container.id, before.status]]),
        )
      ) {
        this.publishPipelineChanged(scan, 'slot_released');
      }
    }
    const processed = update.processedVulnerabilities;
    if (
      isAgentContainer(container) &&
      processed !== undefined &&
      processed !== null &&
      processed !== before.processed
    ) {
      this.publishPipelineChanged(scan, 'ai_progress');
    }
  }

  /**
   * SCAN_PIPELINE_CHANGED for the scanner containers a budget of
   * `checkExpiredScan` closed, as if
   * their pods had reported their end: `container_status` for each, and
   * `slot_released` when these closes released the scan's slot, by the rule
   * of an UpdateScan. When the budget closes the last open scanner while the
   * agent still runs, the scan stays `running`: no SCAN_STATUS_CHANGED would
   * tell the Results page.
   *
   * @param closed the containers this pass closed (`failed`), each with the
   *   status it had before; a close that lost its conditional update is not
   *   in it.
   * @param recomputed the scan reloaded and recomputed after the closes, or
   *   null when there is none to read (its state was recomputed elsewhere,
   *   or the row is gone): no `slot_released` then.
   */
  @Span()
  publishScannerCloses(
    scan: Scan,
    closed: ReadonlyMap<string, string>,
    recomputed: Scan | null,
  ): void {
    for (const containerId of closed.keys()) {
      this.publishPipelineChanged(
        scan,
        'container_status',
        `${containerId}:failed`,
      );
    }
    if (recomputed && this.changesReleasedScanSlot(recomputed, closed)) {
      this.publishPipelineChanged(scan, 'slot_released');
    }
  }

  /**
   * Whether changes of container statuses released their scan's slot:
   * `scan.containers` (loaded after the changes) no longer hold it, and the
   * same containers with the changed ones at their former status did. Only
   * for a scan still `running`: a scan that ended with its last scanner
   * freed its slot by ending, which SCAN_STATUS_CHANGED says.
   *
   * @param previousStatus the former status of each changed container, by id.
   */
  changesReleasedScanSlot(
    scan: Scan,
    previousStatus: ReadonlyMap<string, string>,
  ): boolean {
    const after = scan.containers;
    if (
      scan.state !== 'running' ||
      !after?.some((c) => previousStatus.has(c.id))
    ) {
      return false;
    }
    const before = after.map((c) =>
      previousStatus.has(c.id) ? { ...c, status: previousStatus.get(c.id) } : c,
    );
    const enabled = this.pipelineConfig.slotReleaseEnabled;
    return holdsScanSlot(before, enabled) && !holdsScanSlot(after, enabled);
  }
}
