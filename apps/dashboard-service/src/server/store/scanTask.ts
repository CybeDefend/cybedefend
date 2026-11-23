import type { AsyncTaskStatus, ScanTaskUpsert } from './backgroundTasksSlice';

/**
 * Scans report a `progress` already expressed as 0–100, so a scan
 * background-task uses a fixed `total` of 100 and stores the progress
 * percentage directly in `processed`.
 */
export const SCAN_TASK_TOTAL = 100;

/** Minimal shape consumed from a scan (ScanResponseDto / ScanInfo) to build a task. */
export interface ScanLike {
    id: string;
    projectId?: string;
    state?: string | null;
    progress?: number;
}

/**
 * Map a security-scanning lifecycle state to the background-task status model.
 *
 * The panel only understands `queued | running | completed | failed`, so the
 * richer scan states collapse onto those four:
 *  - `waiting_for_file` / `queued`            → queued
 *  - `running`                                → running
 *  - `completed` / `completed_degraded`       → completed
 *  - `cancelled`                              → completed (terminal; auto-cleaned)
 *  - `failed`                                 → failed
 *
 * The raw scan state is preserved separately (`scanState`) so the row can show
 * an accurate label/colour (e.g. distinguish "cancelled" from "completed").
 */
export function mapScanStateToStatus(
    state: string | null | undefined,
): AsyncTaskStatus {
    switch (state) {
        case 'running':
            return 'running';
        case 'completed':
        case 'completed_degraded':
        case 'cancelled':
            return 'completed';
        case 'failed':
            return 'failed';
        case 'waiting_for_file':
        case 'queued':
        default:
            return 'queued';
    }
}

/**
 * Build the `upsertScanTask` payload for a scan. Pure + exported so the
 * mapping is unit-testable without a store or the scan service.
 */
export function buildScanTaskUpsert(scan: ScanLike): ScanTaskUpsert {
    const status = mapScanStateToStatus(scan.state);
    const raw = typeof scan.progress === 'number' ? scan.progress : 0;
    // A terminal-completed scan always renders as a full bar; otherwise clamp
    // the reported percentage into 0..100.
    const processed =
        status === 'completed'
            ? SCAN_TASK_TOTAL
            : Math.max(0, Math.min(SCAN_TASK_TOTAL, Math.round(raw)));

    return {
        id: scan.id,
        projectId: scan.projectId,
        status,
        scanState: scan.state ?? undefined,
        processed,
        total: SCAN_TASK_TOTAL,
    };
}

/**
 * A read of a scan that will never succeed through this project: the API
 * answers 404 when the scan is not in the project of the URL (deleted, or a
 * scan of another project, e.g. after a results page moved to another
 * project). Its poller stops and lets go of the scan. Any other
 * failure (network, 5xx, 429, 401 being refreshed) is retried.
 */
export function isScanGone(error: unknown): boolean {
    return (error as { response?: { status?: number } } | null)?.response?.status === 404;
}
