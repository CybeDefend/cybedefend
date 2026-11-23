import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, IsNull, LessThan, Repository } from 'typeorm';
import type {
  V1ContainerStateTerminated,
  V1Pod,
} from '@kubernetes/client-node';
import { Container } from 'src/entities/container.entity';
import { Scan } from 'src/entities/scan.entity';
import {
  EXIT_CLUSTER_DEADLINE,
  EXIT_CLUSTER_IMAGE_INCOMPATIBLE,
  EXIT_CLUSTER_LAUNCH_FAILED,
  EXIT_CLUSTER_NO_RESULTS,
  EXIT_CLUSTER_POD_LOST,
  EXIT_CLUSTER_RESULTS_REFUSED,
  EXIT_CLUSTER_TOOL_FAILED,
  EXIT_CLUSTER_UNSCHEDULABLE,
  EXIT_INFRA_ERROR,
  EXIT_INFRA_IMAGE_PULL,
  EXIT_INFRA_OOM,
  EXIT_INFRA_QUEUE_TIMEOUT,
  EXIT_CLUSTER_ARCHIVE_FETCH_FAILED,
  EXIT_ARCHIVE_NOT_RECEIVED,
} from 'src/core/constants/scanlink-error-codes';
import { ScanService } from '../scan/scan.service';
import { getPodFailureReason } from '../scan/core/pod-failure';
import { readScanPipelineConfig } from '../scan/core/scanPipelineConfig';
import { ScanStateStore } from '../scan/core/scanStateStore';
import { ScanUploadTokens } from '../scan/cluster-results/scan-upload-tokens';
import {
  clusterFailureName,
  ScanResultsService,
} from '../scan/cluster-results/scan-results.service';
import {
  CLUSTER_SCANNING_CONFIG,
  type ClusterScanningConfig,
} from './cluster-scanning.config';
import { ClusterScanningState } from './cluster-scanning.state';
import { secretNameOf } from './cluster-pod-launcher';
import { ClusterScanEnd } from './cluster-scan-end';
import {
  COMMUNITY_KUBE_CLIENT,
  INSTANCE_LABEL,
  type CommunityKubeClient,
} from './kube-client';
import { entryForImage } from './scanner-catalogue';

/** Scan deadlines (the closed edition's checkExpiredScan values). */
export const QUEUED_MAX_MS = 6 * 3_600_000;
export const WAITING_FOR_FILE_MAX_MS = 45 * 60_000;
export const RUNNING_WITHOUT_CONTAINER_MAX_MS = 5 * 60_000;
export const POD_PENDING_MAX_MS = 10 * 60_000;
export const ORPHAN_MIN_AGE_MS = 10 * 60_000;
/**
 * A failing image pull fails 63 only once the container has been pulling
 * this long (from the pod's start, else the row's), and always within the
 * 10 min Pending budget: a first ErrImagePull is often a registry blip.
 */
export const IMAGE_PULL_GRACE_MS = 3 * 60_000;
/**
 * A container whose token is spent is left to its import; it fails
 * IMPORT_UNAVAILABLE only if still open this long after the claim (final
 * review, Important 3). The 82 phase deadline never applies to it.
 */
export const IMPORT_BACKSTOP_MS = 30 * 60_000;
/** A closed container's Secret is deleted by name once within this window. */
const CLOSED_SECRET_WINDOW_MS = 60 * 60_000;

const OPEN_STATUSES = new Set(['starting', 'running']);
/** The outcome of a container closed at its deadline (82). */
const DEADLINE_OUTCOME = clusterFailureName(EXIT_CLUSTER_DEADLINE);
const CLOSED_STATUSES = ['completed', 'failed', 'completed_degraded'];

/** Runner exit codes (scanners repository) → cluster failure codes. */
const RUNNER_EXIT_CODES: Record<number, number> = {
  2: EXIT_CLUSTER_TOOL_FAILED,
  3: EXIT_CLUSTER_RESULTS_REFUSED,
  4: EXIT_CLUSTER_IMAGE_INCOMPATIBLE,
  5: EXIT_CLUSTER_IMAGE_INCOMPATIBLE,
  6: EXIT_CLUSTER_ARCHIVE_FETCH_FAILED,
};

/** A code scan: no import, no graph-only, no diff. */
const CODE_SCAN = {
  importFormat: IsNull(),
  isGraphOnly: false,
  isDiffScan: false,
};

function terminatedOf(pod: V1Pod): V1ContainerStateTerminated | undefined {
  for (const cs of pod.status?.containerStatuses ?? []) {
    const term = cs.state?.terminated ?? cs.lastState?.terminated;
    if (term) return term;
  }
  return undefined;
}

function imagePullFailing(pod: V1Pod): boolean {
  return (pod.status?.containerStatuses ?? []).some((cs) =>
    ['ImagePullBackOff', 'ErrImagePull'].includes(cs.state?.waiting?.reason),
  );
}

/**
 * The failure code of a pod read while its container is open and its token
 * unspent; null when the container is to be left as it is.
 */
export function podFailureCode(
  pod: V1Pod | null,
  openForMs: number,
  pullingForMs: number = openForMs,
): number | null {
  if (pod === null) return EXIT_CLUSTER_POD_LOST;
  if (pod.status?.reason === 'DeadlineExceeded') return EXIT_CLUSTER_DEADLINE;
  if (imagePullFailing(pod)) {
    return pullingForMs >= IMAGE_PULL_GRACE_MS || openForMs > POD_PENDING_MAX_MS
      ? EXIT_INFRA_IMAGE_PULL
      : null;
  }
  switch (pod.status?.phase) {
    case 'Pending':
      return openForMs > POD_PENDING_MAX_MS ? EXIT_CLUSTER_UNSCHEDULABLE : null;
    case 'Succeeded':
      return EXIT_CLUSTER_NO_RESULTS;
    case 'Failed': {
      const exit = terminatedOf(pod)?.exitCode;
      if (exit !== undefined && exit in RUNNER_EXIT_CODES) {
        return RUNNER_EXIT_CODES[exit];
      }
      return getPodFailureReason(pod)?.errorCode === EXIT_INFRA_OOM
        ? EXIT_INFRA_OOM
        : EXIT_INFRA_ERROR;
    }
    default:
      return null;
  }
}

/**
 * The Community cluster engine's watchdog. Every
 * minute, in the cron process only. It never rejects, and one failing pod or
 * scan never stops the others (every Kubernetes call is bounded at 10 s by
 * the client).
 *
 * - No configuration: no scan rule, but the open catalogue
 *   containers' 82 and import backstop still apply, from the database only,
 *   so no scan stays `running` forever.
 * - Scan deadlines, code scans only, with a configuration, enabled or not: `queued` 6 h ⇒
 *   failed 65; `waiting_for_file` 45 min ⇒ failed; `running` with no
 *   container 5 min after its start ⇒ failed 83. A disabled engine therefore
 *   fails nothing before these deadlines.
 * - Each open catalogue container of a running code scan (the pod read and
 *   every Kubernetes call only while enabled):
 *   a spent token ⇒ left to its import, never 80, 82 nor 87, and
 *   IMPORT_UNAVAILABLE only once still open IMPORT_BACKSTOP_MS after
 *   the claim; otherwise 82 once open scannerPhaseMaxMs past the pod's own
 *   start (`status.startTime`; without a read, past startedAt + the 10 min
 *   Pending budget, checked before the read), and its pod deleted;
 *   otherwise the pod read decides (`podFailureCode`).
 *   A failure goes through ScanResultsService.closeContainer, which closes
 *   the container through UpdateScan (pod release, scan recompute, scan
 *   error). No relaunch.
 * - While enabled, the orphan sweep: a managed pod of this instance
 *   (`cybedefend.io/instance`) older than 10 min whose
 *   container row is missing, or closed (unless keepPods, except a
 *   row closed at its deadline), is deleted
 *   with its Secret `<podName>-run`. Secrets are never listed: a
 *   recently closed container's Secret is deleted by name, once.
 */
@Injectable()
export class ClusterPodWatchdog {
  private readonly logger = new Logger(ClusterPodWatchdog.name);
  private readonly scannerPhaseMaxMs: number;
  /** Closed containers whose Secret this process already deleted, by close time. */
  private readonly sweptSecrets = new Map<string, number>();
  private ticking = false;

  constructor(
    @InjectRepository(Scan)
    private readonly scans: Repository<Scan>,
    @InjectRepository(Container)
    private readonly containers: Repository<Container>,
    private readonly store: ScanStateStore,
    private readonly scanEnd: ClusterScanEnd,
    private readonly tokens: ScanUploadTokens,
    private readonly results: ScanResultsService,
    private readonly scanService: ScanService,
    private readonly state: ClusterScanningState,
    @Inject(COMMUNITY_KUBE_CLIENT)
    private readonly kube: CommunityKubeClient | null,
    @Inject(CLUSTER_SCANNING_CONFIG)
    private readonly config: ClusterScanningConfig | null,
    configService: ConfigService,
  ) {
    this.scannerPhaseMaxMs = readScanPipelineConfig((key) =>
      configService.get<string>(key),
    ).scannerPhaseMaxMs;
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async handleCron(): Promise<void> {
    await this.tick();
  }

  async tick(now: Date = new Date()): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const enabled =
        this.config !== null && this.state.enabled && this.kube !== null;
      await this.isolated('scan_deadlines', () =>
        this.scanDeadlines(now, enabled),
      );
      if (enabled) {
        await this.isolated('orphans', () => this.sweepOrphans(now));
      }
    } finally {
      this.ticking = false;
    }
  }

  private async isolated(step: string, run: () => Promise<void>) {
    try {
      await run();
    } catch (error) {
      this.logger.error(
        `CLUSTER_WATCHDOG_FAILED step=${step} error=${error instanceof Error ? error.name : 'unknown'}`,
      );
    }
  }

  private async scanDeadlines(now: Date, enabled: boolean): Promise<void> {
    const before = (ms: number) => LessThan(new Date(now.getTime() - ms));
    // The query bounds the age; the same bound is checked on the row read.
    const olderThan = (at: Date | undefined, ms: number) =>
      !!at && now.getTime() - new Date(at).getTime() > ms;
    // The scan rules need a configuration. The open containers'
    // deadlines (82, the import backstop) do not, so a scan never stays
    // running forever once the config is removed.
    const configured = this.config !== null;
    const queued = !configured
      ? []
      : await this.scans.find({
          where: {
            state: 'queued',
            createAt: before(QUEUED_MAX_MS),
            ...CODE_SCAN,
          },
        });
    for (const scan of queued) {
      if (!olderThan(scan.createAt, QUEUED_MAX_MS)) continue;
      await this.failScan(scan, 'queued', EXIT_INFRA_QUEUE_TIMEOUT, now);
    }
    const waiting = !configured
      ? []
      : await this.scans.find({
          where: {
            state: 'waiting_for_file',
            createAt: before(WAITING_FOR_FILE_MAX_MS),
            ...CODE_SCAN,
          },
        });
    for (const scan of waiting) {
      if (!olderThan(scan.createAt, WAITING_FOR_FILE_MAX_MS)) continue;
      await this.failScan(
        scan,
        'waiting_for_file',
        EXIT_ARCHIVE_NOT_RECEIVED,
        now,
      );
    }

    const running = await this.scans.find({
      where: { state: 'running', ...CODE_SCAN },
      relations: ['containers'],
    });
    for (const scan of running) {
      const containers = scan.containers ?? [];
      if (containers.length === 0) {
        if (
          configured &&
          olderThan(
            scan.startTime ?? scan.createAt,
            RUNNING_WITHOUT_CONTAINER_MAX_MS,
          )
        ) {
          await this.failScan(scan, 'running', EXIT_CLUSTER_LAUNCH_FAILED, now);
        }
        continue;
      }
      await this.watchContainers(scan, containers, now, enabled);
    }
  }

  private async failScan(
    scan: Scan,
    from: string,
    errorCode: number | undefined,
    now: Date,
  ): Promise<void> {
    await this.isolated('scan', async () => {
      // As the cloud's checkExpiredScan: move, publish, archive; no scan end.
      if (
        await this.scanEnd.fail(scan, from, errorCode, {
          now,
          endOfScan: false,
        })
      ) {
        this.logger.warn(
          `CLUSTER_SCAN_EXPIRED scan=${scan.id} from=${from} code=${errorCode ?? '-'}`,
        );
      }
    });
  }

  private async watchContainers(
    scan: Scan,
    containers: Container[],
    now: Date,
    enabled: boolean,
  ): Promise<void> {
    const open = containers.filter(
      (c) => OPEN_STATUSES.has(c.status) && entryForImage(c.image ?? ''),
    );
    if (open.length === 0) return;
    const spentAt = await this.tokens.spentAt(open.map((c) => c.id));
    for (const container of open) {
      await this.isolated('container', () =>
        this.watchContainer(
          scan,
          container,
          spentAt.get(container.id),
          now,
          enabled,
        ),
      );
    }
  }

  private async watchContainer(
    scan: Scan,
    container: Container,
    spentAt: Date | undefined,
    now: Date,
    enabled: boolean,
  ): Promise<void> {
    if (spentAt) {
      // Important 3: left to its import; the backstop only, never 82.
      if (now.getTime() - spentAt.getTime() > IMPORT_BACKSTOP_MS) {
        await this.failCode(scan, container, 'IMPORT_UNAVAILABLE');
      }
      return;
    }
    const since = container.startedAt ?? container.createdAt;
    const openForMs = since ? now.getTime() - new Date(since).getTime() : 0;
    // Important 3: 82 counts from the pod's own start. Without a pod read,
    // the latest it can have started is startedAt + the Pending budget (past
    // it the pod is 81), so that bound applies before the read.
    if (openForMs > POD_PENDING_MAX_MS + this.scannerPhaseMaxMs) {
      await this.deadline(scan, container, enabled);
      return;
    }
    // Disabled or without a config, the database rules above only.
    if (!enabled) return;

    const pod = await this.kube.readPod(container.podName);
    const podStart = pod?.status?.startTime;
    const runningForMs = podStart
      ? now.getTime() - new Date(podStart).getTime()
      : null;
    if (runningForMs !== null && runningForMs > this.scannerPhaseMaxMs) {
      await this.deadline(scan, container, enabled);
      return;
    }
    if (pod?.status?.phase === 'Running') {
      if (container.status === 'starting') {
        await this.scanService.updateScan({
          scanId: scan.id,
          podName: container.podName,
          state: 'running',
        });
      }
      return;
    }
    const code = podFailureCode(pod, openForMs, runningForMs ?? openForMs);
    if (code === null) return;
    // The upload may have landed since the batch read: never 80 nor 87 then.
    const spentNow = await this.tokens.spentContainers([container.id]);
    if (spentNow.has(container.id)) return;
    await this.fail(scan, container, code);
  }

  /**
   * 82: the pod goes whatever keepPods says. A refused delete still closes
   * the container this tick (CLUSTER_DEADLINE), and the orphan sweep deletes
   * the pod and Secret of a row closed with that outcome on a later tick,
   * keepPods or not.
   */
  private async deadline(
    scan: Scan,
    container: Container,
    enabled: boolean,
  ): Promise<void> {
    // Kubernetes deletes only while enabled; the sweep takes the pod of
    // a row closed at its deadline once the engine is back.
    if (enabled) {
      try {
        await this.deletePodAndSecret(container.podName);
      } catch {
        this.logger.warn(
          `CLUSTER_POD_DELETE_FAILED container=${container.id} step=deadline`,
        );
      }
    }
    await this.fail(scan, container, EXIT_CLUSTER_DEADLINE);
  }

  private async fail(
    scan: Scan,
    container: Container,
    code: number,
  ): Promise<void> {
    await this.failCode(scan, container, clusterFailureName(code));
  }

  private async failCode(
    scan: Scan,
    container: Container,
    errorCode: string,
  ): Promise<void> {
    this.logger.warn(
      `CLUSTER_CONTAINER_FAILED scan=${scan.id} container=${container.id} code=${errorCode}`,
    );
    await this.results.closeContainer({
      scanId: scan.id,
      containerId: container.id,
      status: 'failed',
      errorCode,
      findingsCount: 0,
      toolName: '',
    });
  }

  private async deletePodAndSecret(podName: string): Promise<void> {
    await Promise.all([
      this.kube.deletePod(podName),
      this.kube.deleteSecret(secretNameOf(podName)),
    ]);
  }

  private async sweepOrphans(now: Date): Promise<void> {
    const keepPods = this.config.keepPods;
    const pods = await this.kube.listManagedPods();
    for (const pod of pods) {
      await this.isolated('orphan_pod', async () => {
        const created = pod.metadata?.creationTimestamp;
        const name = pod.metadata?.name;
        if (!name || !created) return;
        // Important 2: the selector already names this instance; a pod of
        // another instance (or one without the label) is never touched.
        if (pod.metadata?.labels?.[INSTANCE_LABEL] !== this.config.instanceId) {
          return;
        }
        if (now.getTime() - new Date(created).getTime() <= ORPHAN_MIN_AGE_MS) {
          return;
        }
        const containerId =
          pod.metadata?.labels?.['cybedefend.io/container-id'];
        const row = containerId
          ? await this.containers.findOne({ where: { id: containerId } })
          : null;
        if (row && OPEN_STATUSES.has(row.status)) return;
        // Kept for debugging, but never past its deadline.
        if (row && keepPods && row.outcomeReason !== DEADLINE_OUTCOME) return;
        await this.deletePodAndSecret(name);
        this.logger.log(
          `CLUSTER_ORPHAN_DELETED pod=${name} row=${row ? 'closed' : 'missing'}`,
        );
      });
    }
    await this.sweepOpenRowsOfEndedScans(now);
    if (keepPods) return;

    // A Secret whose pod is already gone: by name, once per closed container.
    for (const [id, closedAt] of this.sweptSecrets) {
      if (now.getTime() - closedAt > 2 * CLOSED_SECRET_WINDOW_MS) {
        this.sweptSecrets.delete(id);
      }
    }
    const closed = await this.containers.find({
      where: {
        status: In(CLOSED_STATUSES),
        finishedAt: Between(
          new Date(now.getTime() - CLOSED_SECRET_WINDOW_MS),
          new Date(now.getTime() - ORPHAN_MIN_AGE_MS),
        ),
      },
      select: { id: true, podName: true, image: true, finishedAt: true },
    });
    for (const row of closed) {
      if (this.sweptSecrets.has(row.id) || !entryForImage(row.image ?? '')) {
        continue;
      }
      await this.isolated('orphan_secret', async () => {
        await this.kube.deleteSecret(secretNameOf(row.podName));
        this.sweptSecrets.set(row.id, new Date(row.finishedAt).getTime());
      });
    }
  }

  /**
   * A launch slower than the 5 min deadline leaves pods (and open rows) for
   * a scan the watchdog already failed: an open catalogue container of a
   * scan no longer `running`, created more than 10 min ago, is an orphan.
   * Its pod and Secret are deleted, then its row is closed by one
   * conditional UPDATE (only while still open); the scan is not recomputed.
   */
  private async sweepOpenRowsOfEndedScans(now: Date): Promise<void> {
    const rows = await this.containers.find({
      where: {
        status: In([...OPEN_STATUSES]),
        createdAt: LessThan(new Date(now.getTime() - ORPHAN_MIN_AGE_MS)),
      },
      relations: ['scan'],
      select: {
        id: true,
        podName: true,
        image: true,
        status: true,
        createdAt: true,
        scan: { id: true, state: true },
      },
    });
    for (const row of rows) {
      if (!row.scan || row.scan.state === 'running') continue;
      if (!entryForImage(row.image ?? '')) continue;
      await this.isolated('orphan_row', async () => {
        await this.deletePodAndSecret(row.podName);
        await this.store.closeOpenContainer(row.id, {
          status: 'failed',
          finishedAt: now,
          outcomeReason: 'CLUSTER_LAUNCH_FAILED',
        });
        this.logger.log(
          `CLUSTER_ORPHAN_DELETED pod=${row.podName} row=open scan_state=${row.scan.state}`,
        );
      });
    }
  }
}
