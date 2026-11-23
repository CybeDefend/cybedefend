/**
 * Port token: what else runs once a scan has completed, before its
 * notifications are dispatched. Each listener is told the scan and its
 * project, once per completed scan (the scan-complete lock), never for a diff
 * scan. A listener is best-effort: ScanCompleteNotificationService logs and
 * ignores a listener that throws or rejects, so none can cost a scan its
 * notifications, issues or cyber-risk recompute. The Community Edition binds
 * an empty list (src/edition/community/scan-completed-listeners.binding.ts).
 */
export const SCAN_COMPLETED_LISTENERS = 'SCAN_COMPLETED_LISTENERS';

export interface ScanCompletedListener {
  onScanCompleted(scanId: string, projectId: string): Promise<void>;
}
