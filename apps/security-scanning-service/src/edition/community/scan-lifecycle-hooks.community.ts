/* eslint-disable @typescript-eslint/no-unused-vars -- the Community
   implementations ignore their port's arguments on purpose */
import type {
  ScanClosedVia,
  ScanLifecycleHooks,
} from '../ports/scan-lifecycle-hooks.port';

/**
 * The Community Edition has no diff-scan unit to settle and no agent-product
 * activation to report: a terminal scan triggers no hook work.
 */
export class CommunityScanLifecycleHooks implements ScanLifecycleHooks {
  onScanClosed(
    _scan: {
      id: string;
      organizationId?: string;
      projectId?: string;
      isDiffScan?: boolean | number;
      isGraphOnly?: boolean;
    },
    _state: string,
    _via: ScanClosedVia,
  ): void {
    // The closed edition's fire-and-forget work at the end of a scan does not
    // exist here.
  }
}
