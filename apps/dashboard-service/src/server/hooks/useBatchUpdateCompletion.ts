import { useEffect, useRef } from 'react';
import { useSelector } from 'react-redux';
import { selectBackgroundTasks } from '../store/backgroundTasksSlice';

/**
 * Fires `onComplete()` once when a `vuln_batch_update` task for `projectId`
 * transitions to a terminal state (completed | failed). Tasks already terminal
 * when the hook first runs are seeded as "already handled" (no spurious refetch
 * on mount/hydration).
 */
export function useBatchUpdateCompletion(
    projectId: string | undefined,
    onComplete: () => void,
): void {
    const tasks = useSelector(selectBackgroundTasks);

    // Keep onComplete in a ref so the effect doesn't depend on callback identity.
    const cbRef = useRef(onComplete);
    cbRef.current = onComplete;

    // Track which task ids have already triggered onComplete.
    const handledRef = useRef<Set<string>>(new Set());
    // Whether we've done the initial seed pass.
    const initRef = useRef(false);

    useEffect(() => {
        if (!projectId) return;

        const matching = tasks.filter(
            (t) =>
                t.type === 'vuln_batch_update' &&
                t.projectId === projectId &&
                (t.status === 'completed' || t.status === 'failed'),
        );

        if (!initRef.current) {
            // Seed pass: mark all currently-terminal tasks as already handled
            // without firing the callback.
            matching.forEach((t) => handledRef.current.add(t.id));
            initRef.current = true;
            return;
        }

        // Subsequent runs: fire once for any newly-terminal task.
        matching.forEach((t) => {
            if (!handledRef.current.has(t.id)) {
                handledRef.current.add(t.id);
                cbRef.current();
            }
        });
    }, [tasks, projectId]);
}
