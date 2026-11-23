import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { Container } from 'src/entities/container.entity';
import type { Scan } from 'src/entities/scan.entity';
import type { ScannerPodsPort } from '../ports/scanner-pods.port';
import { ClusterScanningState } from '../../modules/cluster-scanning/cluster-scanning.state';
import {
  CLUSTER_SCANNING_CONFIG,
  type ClusterScanningConfig,
} from '../../modules/cluster-scanning/cluster-scanning.config';
import {
  COMMUNITY_KUBE_CLIENT,
  type CommunityKubeClient,
} from '../../modules/cluster-scanning/kube-client';
import { secretNameOf } from '../../modules/cluster-scanning/cluster-pod-launcher';
import { entryForImage } from '../../modules/cluster-scanning/scanner-catalogue';

/** Every pod of the cluster engine is named cd-scan-<adapter>-<containerId>. */
const CLUSTER_POD_PREFIX = 'cd-scan-';

/**
 * The Community ScannerPodsPort. While the cluster engine (global
 * ClusterScanningModule) is present and enabled:
 * - a closed cluster container's pod and its Secret `<podName>-run` are
 *   deleted, unless CYBEDEFEND_SCANNER_KEEP_PODS (best effort, never rejects:
 *   the watchdog's sweep deletes what is left);
 * - the data purge deletes the pod and its Secret whatever keepPods says,
 *   and rejects on a Kubernetes error.
 * Otherwise, as before: there is no pod, and both resolve.
 */
@Injectable()
export class CommunityScannerPods implements ScannerPodsPort {
  private readonly logger = new Logger(CommunityScannerPods.name);

  constructor(
    @Optional() private readonly state?: ClusterScanningState,
    @Optional()
    @Inject(COMMUNITY_KUBE_CLIENT)
    private readonly kube?: CommunityKubeClient | null,
    @Optional()
    @Inject(CLUSTER_SCANNING_CONFIG)
    private readonly config?: ClusterScanningConfig | null,
  ) {}

  private client(): CommunityKubeClient | null {
    return this.kube && this.config && this.state?.enabled ? this.kube : null;
  }

  async releaseTerminatedContainer(
    _scan: Scan,
    container: Container,
  ): Promise<void> {
    const kube = this.client();
    if (!kube || this.config.keepPods) return;
    if (!entryForImage(container.image ?? '')) return;
    try {
      await Promise.all([
        kube.deletePod(container.podName),
        kube.deleteSecret(secretNameOf(container.podName)),
      ]);
    } catch {
      this.logger.warn(`CLUSTER_POD_RELEASE_FAILED container=${container.id}`);
    }
  }

  async deleteScannerPodStrict(
    podName: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _scannerType?: string,
  ): Promise<void> {
    const kube = this.client();
    if (!kube || !podName?.startsWith(CLUSTER_POD_PREFIX)) return;
    await kube.deletePod(podName);
    await kube.deleteSecret(secretNameOf(podName));
  }
}
