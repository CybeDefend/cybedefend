import type { Container } from 'src/entities/container.entity';
import type { Scan } from 'src/entities/scan.entity';

export const SCANNER_PODS_PORT = 'SCANNER_PODS_PORT';

export interface ScannerPodsPort {
  /**
   * A container closed: delete its pod per the scanner's deletePodsOnFinish
   * / deletePodsOnError. Community: resolves, does nothing.
   */
  releaseTerminatedContainer(scan: Scan, container: Container): Promise<void>;
  /**
   * Data purge: delete a running scan's pod and its Secrets; rejects when
   * Kubernetes refuses. Community: resolves.
   */
  deleteScannerPodStrict(podName: string, scannerType?: string): Promise<void>;
}
