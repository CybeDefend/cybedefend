import { useEffect } from 'react';
import { useDispatch } from 'react-redux';
import { releaseScanTask, upsertScanTask } from '../store/backgroundTasksSlice';
import { buildScanTaskUpsert, ScanLike } from '../store/scanTask';

/**
 * Mirror the scan a results page is currently tracking into the global
 * background-tasks panel.
 *
 * Call once from the shared `AnalyseWrapper`, passing the live `scanData`. On
 * every state/progress change it dispatches `upsertScanTask`, which:
 *  - registers + pops the panel the first time an ACTIVE scan is seen
 *    (i.e. right after the user launches one), and
 *  - updates an already-tracked scan in place without re-popping the panel.
 *
 * An already-terminal, untracked scan is ignored by the reducer, so simply
 * viewing a page whose last scan finished long ago never spawns a row.
 *
 * While mounted, the page polls this scan itself: the task is marked
 * `ownedByPage` so the app-root tracker leaves it alone (one
 * poller per scan). When the page goes away or moves to another scan, the
 * scan is released and the tracker follows it again from any route.
 */
export function useScanBackgroundTask(
    scan: ScanLike | null | undefined,
): void {
    const dispatch = useDispatch();

    const id = scan?.id;
    const projectId = scan?.projectId;
    const state = scan?.state ?? undefined;
    const progress = scan?.progress;

    useEffect(() => {
        if (!id) return;
        dispatch(
            upsertScanTask({
                ...buildScanTaskUpsert({ id, projectId, state, progress }),
                ownedByPage: true,
            }),
        );
    }, [id, projectId, state, progress, dispatch]);

    // Keyed on the id alone: a progress tick must not release the scan and
    // take it back, the tracker would read it in between.
    useEffect(() => {
        if (!id) return undefined;
        return () => {
            dispatch(releaseScanTask(id));
        };
    }, [id, dispatch]);
}

export default useScanBackgroundTask;
