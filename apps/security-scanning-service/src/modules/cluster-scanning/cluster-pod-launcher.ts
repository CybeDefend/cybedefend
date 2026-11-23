import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { In, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import type { V1EnvVar, V1Pod } from '@kubernetes/client-node';
import type { ProjectScanSettings } from '@grpc/security-scanning/scan';
import { Container } from 'src/entities/container.entity';
import type { Scan } from 'src/entities/scan.entity';
import type { Scanner } from 'src/entities/scanner.entity';
import { FileManagementService } from '../file/file-management.service';
import { insertScannerContainers } from '../scan/core/insert-scanner-containers';
import { normalizeSeverityList } from '../scan/core/vulnerability-types';
import { buildScannerPodManifest } from '../scan/core/scanner-pod-manifest';
import { readScanPipelineConfig } from '../scan/core/scanPipelineConfig';
import { ScanStateManager } from '../scan/core/scanStateManager';
import { ScanStateStore } from '../scan/core/scanStateStore';
import { ScanUploadTokens } from '../scan/cluster-results/scan-upload-tokens';
import {
  CLUSTER_SCANNING_CONFIG,
  type ClusterScanningConfig,
} from './cluster-scanning.config';
import {
  COMMUNITY_KUBE_CLIENT,
  INSTANCE_LABEL,
  KubeCallError,
  MANAGED_BY_LABEL,
  MANAGED_BY_VALUE,
  type CommunityKubeClient,
} from './kube-client';
import {
  entriesFor,
  pullReference,
  storedImage,
  type CatalogueEntry,
} from './scanner-catalogue';

/** The failure code a refused launch leaves on every row of the scan. */
export const CLUSTER_LAUNCH_FAILED = 'CLUSTER_LAUNCH_FAILED';

/** The non-root user of the cybedefend-scanners images. */
const SCANNER_UID = 65532;
/** A token stays valid this long past the scanner phase (upload retries). */
const TOKEN_GRACE_MS = 15 * 60_000;
/** activeDeadlineSeconds = scannerPhaseMaxMs + this. */
const POD_DEADLINE_GRACE_S = 300;
/**
 * The tool's --timeout is scannerPhaseMaxMs minus this: the archive fetch
 * takes at most 15 min, the upload retries at most 6 min, 4 min of margin,
 * so the runner exits with its own code before activeDeadlineSeconds.
 */
const RUNNER_OVERHEAD_MS = 25 * 60_000;
/** The --timeout never goes below this (a very short scanner phase). */
const MIN_TOOL_TIMEOUT_S = 60;

/** The keys of the pod's Secret; each reaches the runner as a secretKeyRef. */
const SECRET_KEYS = [
  'CYBEDEFEND_API_URL',
  'CYBEDEFEND_SCAN_ID',
  'CYBEDEFEND_SCAN_TOKEN',
  'CYBEDEFEND_ARCHIVE_URL',
] as const;

/** The name of a scanner pod's Secret; the watchdog deletes it by this name. */
export function secretNameOf(podName: string): string {
  return `${podName}-run`;
}

/** The status a failed Kubernetes call is logged with: never its body. */
function statusOf(error: unknown): string {
  if (error instanceof KubeCallError) return String(error.status ?? 'network');
  return 'internal';
}

interface Launch {
  entry: CatalogueEntry;
  container: Container;
}

/**
 * The pods of one Community cluster scan.
 *
 * - The scanners are the Community catalogue's, picked by category
 *   (`entriesFor`), never by a scanner row's type or `enabled`: the MySQL
 *   track seeds the cloud's scanner rows, which never run here.
 * - One container row, one upload token, one Secret `<podName>-run` and one
 *   pod per entry. A container is never relaunched: a new scan makes
 *   new rows.
 * - `container.image` stores the image without the registry; the pod pulls `<registry>/<image>`.
 * - The archive URL (signed for S3_PUBLIC_ENDPOINT) and the token reach the
 *   pod only through its Secret: never in the pod spec, a label or a log. A
 *   refused call is logged by HTTP status only.
 */
@Injectable()
export class ClusterPodLauncher {
  private readonly logger = new Logger(ClusterPodLauncher.name);
  private readonly scannerPhaseMaxMs: number;

  constructor(
    @InjectRepository(Container)
    private readonly containers: Repository<Container>,
    private readonly store: ScanStateStore,
    private readonly scanStateManager: ScanStateManager,
    private readonly files: FileManagementService,
    private readonly tokens: ScanUploadTokens,
    @Inject(COMMUNITY_KUBE_CLIENT)
    private readonly kube: CommunityKubeClient,
    @Inject(CLUSTER_SCANNING_CONFIG)
    private readonly config: ClusterScanningConfig,
    configService: ConfigService,
  ) {
    this.scannerPhaseMaxMs = readScanPipelineConfig((key) =>
      configService.get<string>(key),
    ).scannerPhaseMaxMs;
  }

  /**
   * Rows, tokens, Secrets and pods of a scan already claimed `running`.
   * Throws RpcException(INTERNAL,'CLUSTER_LAUNCH_FAILED') after undoing a
   * partial launch. Returns the number of pods.
   */
  async launch(scan: Scan, settings: ProjectScanSettings): Promise<number> {
    const entries = entriesFor(settings.enabledScanTypes ?? []);
    if (entries.length === 0) {
      await this.completeWithoutScanner(scan);
      return 0;
    }

    let archiveUrl: string;
    try {
      archiveUrl = await this.files.getExternalDownloadUrl(scan.id);
    } catch {
      this.logger.error(
        `${CLUSTER_LAUNCH_FAILED} scan=${scan.id} step=archive_url`,
      );
      throw launchFailed();
    }

    const launches: Launch[] = entries.map((entry) => {
      const id = uuidv4();
      return {
        entry,
        container: this.containers.create({
          id,
          podName: `cd-scan-${entry.adapter}-${id}`,
          image: storedImage(entry.adapter, this.config.imageTag),
          status: 'starting',
          scanId: scan.id,
          scanner: { id: entry.id } as Scanner,
        }),
      };
    });
    try {
      await insertScannerContainers(
        this.containers,
        launches.map((l) => l.container),
      );
    } catch (error) {
      // One INSERT: nothing was written. A driver error can quote the row,
      // so only the status is logged; launch only ever throws launchFailed.
      this.logger.error(
        `${CLUSTER_LAUNCH_FAILED} scan=${scan.id} step=containers status=${statusOf(error)}`,
      );
      throw launchFailed();
    }

    const results = await Promise.allSettled(
      launches.map((l) => this.launchOne(scan, settings, l, archiveUrl)),
    );
    const failed = results
      .map((result, i) => ({ result, launch: launches[i] }))
      .filter(
        (x): x is { result: PromiseRejectedResult; launch: Launch } =>
          x.result.status === 'rejected',
      );
    if (failed.length > 0) {
      for (const { result, launch } of failed) {
        this.logger.error(
          `${CLUSTER_LAUNCH_FAILED} scan=${scan.id} container=${launch.container.id} status=${statusOf(result.reason)}`,
        );
      }
      await this.undo(scan, launches);
      throw launchFailed();
    }
    this.logger.log(
      `CLUSTER_SCAN_LAUNCHED scan=${scan.id} pods=${launches.length}`,
    );
    return launches.length;
  }

  /** The cloud's processScans with no scanner: the scan ends, its archive goes. */
  private async completeWithoutScanner(scan: Scan): Promise<void> {
    const moved = await this.store.moveScanState(
      scan,
      ['running'],
      'completed',
      { endTime: new Date() },
    );
    if (moved) this.scanStateManager.publishStatusChanged(scan, 'running');
    try {
      await this.files.deleteFile(scan.id);
    } catch {
      this.logger.warn(`CLUSTER_SCAN_ARCHIVE_DELETE_FAILED scan=${scan.id}`);
    }
  }

  private async launchOne(
    scan: Scan,
    settings: ProjectScanSettings,
    { entry, container }: Launch,
    archiveUrl: string,
  ): Promise<void> {
    const severities = normalizeSeverityList(
      settings.vulnerabilityTypesByScan?.[entry.scannerType],
    ).toLowerCase();
    const token = await this.tokens.mint({
      scanId: scan.id,
      containerId: container.id,
      category: entry.category,
      severities,
      expiresAt: new Date(Date.now() + this.scannerPhaseMaxMs + TOKEN_GRACE_MS),
    });

    const labels = {
      [MANAGED_BY_LABEL]: MANAGED_BY_VALUE,
      'cybedefend.io/scan-id': scan.id,
      'cybedefend.io/container-id': container.id,
      'cybedefend.io/adapter': entry.adapter,
      [INSTANCE_LABEL]: this.config.instanceId,
    };
    const secretName = secretNameOf(container.podName);
    await this.kube.createSecret(secretName, labels, {
      CYBEDEFEND_API_URL: this.config.apiUrl,
      CYBEDEFEND_SCAN_ID: scan.id,
      CYBEDEFEND_SCAN_TOKEN: token,
      CYBEDEFEND_ARCHIVE_URL: archiveUrl,
    });

    const { uid } = await this.kube.createPod(
      this.manifest(entry, container, labels, secretName),
    );
    await this.containers.update(container.id, {
      podUid: uid,
      startedAt: new Date(),
    });
  }

  private manifest(
    entry: CatalogueEntry,
    container: Container,
    labels: Record<string, string>,
    secretName: string,
  ): V1Pod {
    const resources = this.config.resources[entry.adapter];
    const env: V1EnvVar[] = SECRET_KEYS.map((key) => ({
      name: key,
      valueFrom: { secretKeyRef: { name: secretName, key } },
    }));
    if (entry.adapter === 'trivy-fs') env.push(...this.trivyMirrorEnv());
    const toolTimeoutS = Math.max(
      MIN_TOOL_TIMEOUT_S,
      Math.floor((this.scannerPhaseMaxMs - RUNNER_OVERHEAD_MS) / 1000),
    );
    return buildScannerPodManifest({
      name: container.podName,
      labels,
      image: pullReference(this.config, entry.adapter),
      imagePullPolicy: 'IfNotPresent',
      ...(this.config.imagePullSecret && {
        imagePullSecrets: [this.config.imagePullSecret],
      }),
      command: ['/usr/local/bin/cybedefend-scanner'],
      args: [
        'run',
        entry.adapter,
        '--scan-run',
        '--timeout',
        `${toolTimeoutS}s`,
      ],
      env,
      resources: {
        requests: {
          cpu: resources.cpuRequest,
          memory: resources.memoryRequest,
          'ephemeral-storage': '1Gi',
        },
        limits: {
          cpu: resources.cpuLimit,
          memory: resources.memoryLimit,
          'ephemeral-storage': '5Gi',
        },
      },
      emptyDirs: [
        { name: 'src', mountPath: '/src' },
        { name: 'scanner-tmp', mountPath: '/tmp/cybedefend-scanner' },
      ],
      readOnlyRootFilesystem: true,
      runAsUser: SCANNER_UID,
      activeDeadlineSeconds:
        Math.ceil(this.scannerPhaseMaxMs / 1000) + POD_DEADLINE_GRACE_S,
    });
  }

  /**
   * The operator's mirror of Trivy's databases, when configured: public
   * repository addresses, so plain variables rather than Secret keys.
   */
  private trivyMirrorEnv(): V1EnvVar[] {
    const env: V1EnvVar[] = [];
    if (this.config.trivyDbRepository) {
      env.push({
        name: 'TRIVY_DB_REPOSITORY',
        value: this.config.trivyDbRepository,
      });
    }
    if (this.config.trivyJavaDbRepository) {
      env.push({
        name: 'TRIVY_JAVA_DB_REPOSITORY',
        value: this.config.trivyJavaDbRepository,
      });
    }
    return env;
  }

  /**
   * A scan whose pods could not all be launched runs none of them: every pod
   * and Secret of the launch is deleted (a create may have landed and its
   * answer been lost; a 404 counts as done), and every row is failed with
   * CLUSTER_LAUNCH_FAILED. Best effort: the launch error is thrown whatever
   * happens here.
   */
  private async undo(scan: Scan, launches: Launch[]): Promise<void> {
    const cleanUp = await Promise.allSettled([
      ...launches.flatMap(({ container }) => [
        this.kube.deletePod(container.podName),
        this.kube.deleteSecret(secretNameOf(container.podName)),
      ]),
      this.containers.update(
        { id: In(launches.map((l) => l.container.id)) },
        {
          status: 'failed',
          finishedAt: new Date(),
          outcomeReason: CLUSTER_LAUNCH_FAILED,
        },
      ),
    ]);
    const incomplete = cleanUp.filter((r) => r.status === 'rejected').length;
    if (incomplete > 0) {
      this.logger.warn(
        `CLUSTER_LAUNCH_CLEANUP_INCOMPLETE scan=${scan.id} failures=${incomplete}`,
      );
    }
  }
}

function launchFailed(): RpcException {
  return new RpcException({
    code: status.INTERNAL,
    message: CLUSTER_LAUNCH_FAILED,
  });
}
