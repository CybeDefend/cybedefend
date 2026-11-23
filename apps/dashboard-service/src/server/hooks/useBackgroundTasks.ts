import { useEffect, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { openStream } from '../services/realtimeStream';
import { getMyAsyncTasks } from '../services/asyncTasksService';
import {
    hydrate,
    updateProgress,
    completeTask,
    selectActiveTasks,
    AsyncTask,
} from '../store/backgroundTasksSlice';
import { getRegionConfig } from '@/utils/function/region';
import { getAccessTokenForFetch } from '../api/tokenManager';
import type { AppDispatch } from '../store/index';

interface RootStateAuth {
    auth: { accessToken: string | null };
}

/**
 * App-root hook that manages the background-task SSE lifecycle.
 *
 * Mount ONCE at the app root. Behaviour:
 * 1. On mount: fetches in-flight tasks via getMyAsyncTasks and hydrates
 *    the Redux store (best-effort — errors are swallowed/logged).
 * 2. Reactively opens an SSE stream for every active (queued/running) task.
 *    Streams are keyed by taskId in a ref-Map; the effect re-runs only
 *    when the set of active task ids changes.
 * 3. Closes streams when a task transitions to a terminal state
 *    (completed/failed/dismissed) and on unmount.
 * 4. Dispatches updateProgress / completeTask on incoming SSE events.
 */
export function useBackgroundTasks(): void {
    const dispatch = useDispatch<AppDispatch>();

    // Read access token via ref to avoid re-running effect on rotation.
    // Mirror of useRealtimeStream's pattern.
    const accessToken = useSelector((s: RootStateAuth) => s.auth.accessToken);
    const accessTokenRef = useRef<string | null>(accessToken);
    accessTokenRef.current = accessToken;

    // Scan tasks are advanced by useActiveScanTasksTracker (REST polling of
    // getScanById), NOT by the async-task SSE channel — they have no
    // /v1/realtime/tasks/<id>/stream endpoint. Exclude them here so we don't
    // open a dead stream per running scan.
    const activeTasks = useSelector(selectActiveTasks).filter(
        (t: AsyncTask) => t.type !== 'scan',
    );

    // Stable string key so the effect only re-runs when the ID set changes.
    const activeIdKey = activeTasks.map((t: AsyncTask) => t.id).join(',');

    // Map of open streams, keyed by taskId.
    const streamsRef = useRef<Map<string, { close(): void }>>(new Map());

    // Hydrate at most once per session (not on every token rotation).
    const hydratedRef = useRef(false);

    // ---------- hydrate store with in-flight tasks (auth-gated) ----------
    // GET /me/async-tasks requires a Bearer token. On a hard refresh this hook
    // mounts BEFORE Logto restores the access token into the store, so firing
    // the request immediately would send no Authorization header → 401. Gate on
    // the token being present and hydrate once it is.
    useEffect(() => {
        if (!accessToken || hydratedRef.current) return;
        hydratedRef.current = true;
        getMyAsyncTasks()
            .then((tasks) => {
                dispatch(hydrate(tasks));
            })
            .catch((err) => {
                // Best-effort — don't crash if the endpoint is temporarily
                // unavailable. Allow a retry on the next token change.
                hydratedRef.current = false;
                console.warn('[useBackgroundTasks] hydration failed:', err);
            });
    }, [accessToken, dispatch]);

    // ---------- reactive stream lifecycle ----------
    useEffect(() => {
        const BASE = getRegionConfig().apiUrl;
        const streams = streamsRef.current;

        // Current active id set for quick lookup
        const activeIdSet = new Set(activeTasks.map((t: AsyncTask) => t.id));

        // Close streams for tasks that are no longer active
        for (const [id, handle] of streams.entries()) {
            if (!activeIdSet.has(id)) {
                handle.close();
                streams.delete(id);
            }
        }

        // Open streams for new active tasks
        for (const task of activeTasks) {
            if (streams.has(task.id)) continue; // guard double-open

            const taskId = task.id;
            const url = `${BASE}/v1/realtime/tasks/${taskId}/stream`;

            const handle = openStream(
                url,
                {
                    ASYNC_TASK_PROGRESS: (env?: any) => {
                        const a = env?.payload?.asyncTask;
                        if (!a) return;
                        dispatch(
                            updateProgress({
                                id: a.taskId,
                                processed: a.processed,
                                succeeded: a.succeeded,
                                failed: a.failed,
                                status: a.status,
                            }),
                        );
                    },
                    ASYNC_TASK_COMPLETED: (env?: any) => {
                        const a = env?.payload?.asyncTask;
                        if (!a) return;
                        dispatch(
                            completeTask({
                                id: a.taskId,
                                status: a.status,
                                succeeded: a.succeeded,
                                failed: a.failed,
                                error: a.error,
                                resultUrl: a.resultUrl,
                            }),
                        );
                        // The task will leave the active list on next render,
                        // which causes the effect to close this stream.
                    },
                },
                {
                    tokenProvider: () => accessTokenRef.current,
                    // A task can outlive the JWT its stream was opened with,
                    // and the gateway closes the stream at that expiry. The
                    // reconnect must therefore mint a new token instead of
                    // replaying the redux snapshot, which is the expired one.
                    refreshToken: () => getAccessTokenForFetch(),
                },
            );

            streams.set(taskId, handle);
        }

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeIdKey]);

    // ---------- unmount: close all streams ----------
    useEffect(() => {
        const streams = streamsRef.current;
        return () => {
            for (const handle of streams.values()) {
                handle.close();
            }
            streams.clear();
        };
    }, []);
}

export default useBackgroundTasks;
