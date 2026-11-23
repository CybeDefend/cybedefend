import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { IsNull, Repository } from 'typeorm';
import { ident } from '@cybedefend/db-dialect';
import type {
  CreateScanRequest,
  ProjectScanSettings,
  StartScanRequest,
  StartScanResponse,
} from '@grpc/security-scanning/scan';
import { Scan } from 'src/entities/scan.entity';
import { EXIT_CLUSTER_LAUNCH_FAILED } from 'src/core/constants/scanlink-error-codes';
import { Container } from 'src/entities/container.entity';
import {
  NO_SCANNER_ENABLED,
  SCANNERS_NOT_AVAILABLE,
  type ScannerOrchestratorPort,
} from 'src/edition/ports/scanner-orchestrator.port';
import { OrganizationManager } from '../scan/core/organizationManager';
import { ScanStateManager } from '../scan/core/scanStateManager';
import { ScanStateStore } from '../scan/core/scanStateStore';
import {
  CLUSTER_SCANNING_CONFIG,
  type ClusterScanningConfig,
} from './cluster-scanning.config';
import { ClusterPodLauncher } from './cluster-pod-launcher';
import { CommunityScannerCatalogue, entriesFor } from './scanner-catalogue';
import { ClusterScanEnd } from './cluster-scan-end';

/** What one launchScan did. */
export type LaunchOutcome = 'launched' | 'requeued' | 'failed';

/** The branch a scan without one is stored and imported on. */
const DEFAULT_BRANCH = 'main';

const refuse = (): RpcException =>
  new RpcException({
    code: status.FAILED_PRECONDITION,
    message: SCANNERS_NOT_AVAILABLE,
  });

/**
 * The Community cluster engine's ScannerOrchestratorPort. The edition facade (CommunityScannerOrchestrator) delegates here
 * only while ClusterScanningState is enabled.
 *
 * - v1 runs code scans only: a container, diff or graph-only scan is refused
 *   SCANNERS_NOT_AVAILABLE at CreateScan, before any write.
 * - Admission (StartScan): the platform's slot-holding running scans plus
 *   the queued non-import non-diff scans, against MAX_CONCURRENT. The dequeue
 *   (ClusterScanQueue) counts the running ones only.
 *   No entitlement is checked.
 * - `launchScan` is the ONE start function of both paths: the direct start
 *   and a scan the 15 s tick takes out of the queue go through it alike.
 */
@Injectable()
export class ClusterScannerOrchestrator implements ScannerOrchestratorPort {
  private readonly logger = new Logger(ClusterScannerOrchestrator.name);
  private seeded: Promise<void> | null = null;

  constructor(
    @InjectRepository(Scan)
    private readonly scans: Repository<Scan>,
    private readonly store: ScanStateStore,
    private readonly scanStateManager: ScanStateManager,
    private readonly organizationManager: OrganizationManager,
    private readonly launcher: ClusterPodLauncher,
    private readonly catalogue: CommunityScannerCatalogue,
    private readonly scanEnd: ClusterScanEnd,
    @Inject(CLUSTER_SCANNING_CONFIG)
    private readonly config: ClusterScanningConfig | null,
  ) {}

  /**
   * A code scan of a project none of whose enabled scan types has a scanner
   * in the catalogue would start no pod: refused before its upload. A
   * container scan is left to assertScanSupported.
   */
  async assertProjectScannable(
    projectId: string,
    scanType?: string,
  ): Promise<void> {
    if (scanType === 'container') return;
    const settings: ProjectScanSettings =
      await this.organizationManager.getProjectInformation(projectId);
    if (entriesFor(settings.enabledScanTypes ?? []).length === 0) {
      throw new RpcException({
        code: status.FAILED_PRECONDITION,
        message: NO_SCANNER_ENABLED,
      });
    }
  }

  assertScanSupported(request: CreateScanRequest): void {
    if (request.scanType === 'container' || request.isDiffScan) throw refuse();
    if (request.graphOnly) throw refuse();
  }

  async saveNewScan(scan: Scan): Promise<void> {
    await this.scans.save(scan);
  }

  async startScan(
    scan: Scan,
    data: StartScanRequest,
  ): Promise<StartScanResponse> {
    // The request is the only place the archive's metrics exist; both
    // outcomes store them (the queued path launches from the row alone).
    scan.language = data.language ?? [];
    scan.totalLOC = data.totalLOC ?? 0;
    scan.totalSize = data.totalSize ?? '0Mo';
    scan.branch = scan.branch || data.branch || DEFAULT_BRANCH;

    if (await this.atCapacity()) {
      await this.store.claimScanStart(scan, 'queued', {
        branch: scan.branch,
        language: scan.language,
        totalLOC: scan.totalLOC,
        totalSize: scan.totalSize,
      });
      return {
        success: true,
        message: 'Scan queued due to concurrent scan limits',
        detectedLanguages: [],
      };
    }

    const outcome = await this.launchScan(scan);
    if (outcome === 'launched') {
      return {
        success: true,
        scanId: scan.id,
        message: 'Code scan started.',
        detectedLanguages: scan.language,
      };
    }
    if (outcome === 'requeued') {
      return {
        success: true,
        scanId: scan.id,
        message: 'Scan queued due to concurrent scan limits',
        detectedLanguages: [],
      };
    }
    return {
      success: false,
      scanId: scan.id,
      message: 'CLUSTER_LAUNCH_FAILED',
      detectedLanguages: [],
    };
  }

  /**
   * The one start function of both paths. Before the claim (nothing moved,
   * the scan keeps the state it was read in): the catalogue seed and the
   * project read, whose errors propagate. Then the claim `running` (the core
   * conditional claimScanStart: a scan cancelled meanwhile is not started,
   * FAILED_PRECONDITION), then the pods. A launch that fails after the claim
   * leaves the scan `failed` with 83 CLUSTER_LAUNCH_FAILED ('failed'): never
   * a `running` scan without its pods.
   *
   * MAX_CONCURRENT across processes (the direct start in the API, the tick
   * in the cron): the admission read and the claim are two statements, so
   * after the claim the slot-holding scans are counted again. Above the
   * limit, the scan steps back to `queued` (one conditional move, only while
   * it is `running` with no container) and nothing is launched ('requeued');
   * the tick starts it later. Every scan that stays read a count, after its
   * own claim, that held every other stayer claimed before it: at most
   * MAX_CONCURRENT stay. Two racers may both step back; the tick admits one.
   */
  async launchScan(scan: Scan): Promise<LaunchOutcome> {
    await this.ensureSeeded();
    const settings: ProjectScanSettings =
      await this.organizationManager.getProjectInformation(scan.projectId);
    const fromState = scan.state;
    await this.store.claimScanStart(scan, 'running', {
      startTime: new Date(),
      branch: scan.branch || DEFAULT_BRANCH,
      language: scan.language ?? [],
      totalLOC: scan.totalLOC ?? 0,
      totalSize: scan.totalSize ?? '0Mo',
    });
    if (await this.overCapacity()) {
      if (await this.stepBack(scan)) {
        this.logger.log(`CLUSTER_SCAN_REQUEUED scan=${scan.id}`);
        if (fromState !== 'queued') {
          this.scanStateManager.publishStatusChanged(scan, fromState);
        }
        return 'requeued';
      }
    }
    this.scanStateManager.publishStatusChanged(scan, fromState);
    try {
      await this.launcher.launch(scan, settings);
      return 'launched';
    } catch {
      // launch logs its own line (status only) and throws only
      // CLUSTER_LAUNCH_FAILED; nothing of the error is logged here.
      await this.scanEnd.fail(scan, 'running', EXIT_CLUSTER_LAUNCH_FAILED);
      return 'failed';
    }
  }

  /** The slot-holding running scans (platform), this one included, > MAX_CONCURRENT. */
  private async overCapacity(): Promise<boolean> {
    const max = this.config?.maxConcurrent ?? 0;
    const { total } = await this.organizationManager.getSlotHoldingScansCount();
    return total > max;
  }

  /**
   * running → queued, one conditional UPDATE: only while the scan is still
   * `running` with no container row (a scan whose launch began is never
   * stepped back). Decided on the affected count.
   */
  private async stepBack(scan: Scan): Promise<boolean> {
    const containers = this.scans.manager
      .getRepository(Container)
      .createQueryBuilder('c')
      .select('1')
      .where(`c.${ident('scanId').text} = :id`);
    const result = await this.scans
      .createQueryBuilder()
      .update(Scan)
      .set({ state: 'queued', startTime: null })
      .where('id = :id', { id: scan.id })
      .andWhere('state = :running', { running: 'running' })
      .andWhere(`NOT EXISTS (${containers.getQuery()})`)
      .execute();
    if ((result.affected ?? 0) !== 1) return false;
    scan.state = 'queued';
    scan.startTime = null;
    return true;
  }

  /** Slot-holding running scans (platform) + queued code scans ≥ MAX_CONCURRENT. */
  private async atCapacity(): Promise<boolean> {
    const max = this.config?.maxConcurrent ?? 0;
    const { total } = await this.organizationManager.getSlotHoldingScansCount();
    const queued = await this.scans.count({
      where: {
        state: 'queued',
        isDiffScan: false,
        isGraphOnly: false,
        importFormat: IsNull(),
      },
    });
    return total + queued >= max;
  }

  /** The catalogue rows the containers reference: seeded once per process, before the first launch. */
  private ensureSeeded(): Promise<void> {
    if (!this.seeded) {
      this.seeded = this.catalogue.seed().catch((error: unknown) => {
        this.seeded = null;
        this.logger.error('CLUSTER_CATALOGUE_SEED_FAILED');
        throw error;
      });
    }
    return this.seeded;
  }
}
