import { useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
    upsertScanTask,
    dismissTask,
    selectActiveScanTasks,
    AsyncTask,
} from '../store/backgroundTasksSlice';
import { buildScanTaskUpsert, isScanGone } from '../store/scanTask';
import scanService from '../services/scanService';
import { usePollingWhenVisible } from './usePollingWhenVisible';

/**
 * How often active scan tasks are re-fetched to advance their progress. Was
 * 5 s; the results page that shows a scan polls it itself every 10 s, and
 * this tracker only follows the scans no page shows.
 */
export const SCAN_POLL_INTERVAL_MS = 15_000;

/**
 * App-root hook that keeps scan background-tasks live GLOBALLY.
 *
 * The results page that owns a scan only updates the panel while it is
 * mounted. Once the user navigates away (e.g. to the dashboard home), nothing
 * would advance the scan row — it would freeze at its last percentage and
 * never resolve. This hook polls `getScanById` for every active scan task and
 * dispatches `upsertScanTask`, so progress and completion are reflected
 * everywhere, independent of the current route.
 *
 * One poller per scan:
 * - a scan whose results page is mounted (`ownedByPage`) is skipped: the
 *   page polls it. Ownership is read at each tick, so a page taking or
 *   releasing a scan never restarts the timer nor fires an extra request;
 *   a released scan is read at the next tick;
 * - nothing is polled in a hidden tab; on return, an overdue poll runs at once;
 * - a 404 drops the task: the scan no longer exists. Any other failure keeps
 *   the last-known progress and retries on the next tick.
 *
 * Mount ONCE at the app root, next to `useBackgroundTasks`.
 */
export function useActiveScanTasksTracker(): void {
    const dispatch = useDispatch();
    const scanTasks = useSelector(selectActiveScanTasks);

    // Latest active scan tasks, read inside the poll without forcing the
    // timer to restart on every progress tick.
    const scanTasksRef = useRef<AsyncTask[]>(scanTasks);
    scanTasksRef.current = scanTasks;

    // Restart (with an immediate poll) only when the SET of active scans changes.
    const activeKey = scanTasks
        .map((t) => `${t.projectId ?? ''}:${t.id}`)
        .join(',');

    usePollingWhenVisible(
        async () => {
            const tasks = scanTasksRef.current.filter(
                (t) => t.projectId && !t.ownedByPage,
            );
            await Promise.all(
                tasks.map(async (t) => {
                    try {
                        const scan = await scanService.getScanById(
                            t.projectId as string,
                            t.id,
                        );
                        dispatch(upsertScanTask(buildScanTaskUpsert(scan)));
                    } catch (error) {
                        if (isScanGone(error)) dispatch(dismissTask(t.id));
                        // Otherwise transient: keep last-known progress and
                        // retry on the next tick.
                    }
                }),
            );
        },
        SCAN_POLL_INTERVAL_MS,
        { enabled: scanTasks.length > 0, immediate: true, key: activeKey },
    );
}

export default useActiveScanTasksTracker;
