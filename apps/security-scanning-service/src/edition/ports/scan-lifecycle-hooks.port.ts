export const SCAN_LIFECYCLE_HOOKS = 'SCAN_LIFECYCLE_HOOKS';

export type ScanClosedVia = 'containers' | 'scan_level' | 'cancel';

export interface ScanLifecycleHooks {
  /**
   * A scan reached a terminal state. Synchronous; never throws; its work is
   * fire-and-forget. Community: does nothing.
   */
  onScanClosed(
    scan: {
      id: string;
      organizationId?: string;
      projectId?: string;
      isDiffScan?: boolean | number;
      isGraphOnly?: boolean;
    },
    state: string,
    via: ScanClosedVia,
  ): void;
}
