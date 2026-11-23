import { batchUpdateVulnerabilities } from '../services/resultService';
import { addTask, hydrate, dismissTask } from './backgroundTasksSlice';
import { getMyAsyncTasks, deleteMyAsyncTask } from '../services/asyncTasksService';
import type { BatchUpdateVulnerabilitiesRequest } from '../interfaces/Vulnerability';
import type { AppDispatch } from './index';

/**
 * Enqueue an async batch-update job on the backend and register the
 * resulting task in the backgroundTasks Redux slice.
 *
 * The hook `useBackgroundTasks` (mounted at app root) will open an SSE
 * stream for the task as soon as the `addTask` action lands, so callers
 * only need to dispatch this thunk — no further wiring required.
 *
 * Errors from `batchUpdateVulnerabilities` are NOT swallowed: they
 * propagate so callers can surface them in the UI.
 *
 * @returns taskId of the enqueued job
 */
export const startBatchUpdate =
    (projectId: string, request: BatchUpdateVulnerabilitiesRequest) =>
    async (dispatch: AppDispatch): Promise<string> => {
        const res = await batchUpdateVulnerabilities(projectId, request);

        dispatch(
            addTask({
                id: res.taskId,
                type: 'vuln_batch_update',
                status: 'queued',
                total: res.total,
                processed: 0,
                projectId,
            }),
        );

        return res.taskId;
    };

/**
 * Start a report generation and surface it in the background-tasks
 * widget. Unlike batch-update/autofix, the generate endpoints return a
 * `reportId` (not the async task id), so we cannot `addTask` directly; instead
 * we trigger the generation and then re-hydrate the widget from
 * `GET /me/async-tasks` (the backend created the `report_generation` task at
 * enqueue). The SSE hook then streams it to completion, where its `resultUrl`
 * deep-links to the stored-reports page.
 *
 * `generate` is the report-generation call (it returns a reportId/status). Its
 * errors propagate so the caller can toast them.
 */
export const startReportGeneration =
    (generate: () => Promise<unknown>) =>
    async (dispatch: AppDispatch): Promise<void> => {
        await generate();
        await dispatch(refreshBackgroundTasks());
    };

/**
 * Pull the canonical async-task list from `GET /me/async-tasks` and
 * hydrate the widget. Used right after a report generation (whose response
 * carries a reportId, not the task id) so the freshly-created task shows
 * immediately; the app-root SSE hook then streams it to completion.
 * Best-effort: a failure is swallowed (the task still appears on next load).
 */
export const refreshBackgroundTasks =
    () =>
    async (dispatch: AppDispatch): Promise<void> => {
        try {
            const tasks = await getMyAsyncTasks();
            dispatch(hydrate(tasks));
        } catch {
            // Best-effort.
        }
    };

/**
 * Persistently dismiss a background task. Removes it from the widget
 * immediately (optimistic) and deletes it server-side so it does not reappear
 * on the next rehydration (page reload). A failed DELETE is swallowed — the
 * task simply comes back on the next load, which is the safe fallback.
 */
export const dismissBackgroundTask =
    (taskId: string) =>
    async (dispatch: AppDispatch): Promise<void> => {
        dispatch(dismissTask(taskId));
        try {
            await deleteMyAsyncTask(taskId);
        } catch {
            // Best-effort: it will reappear on the next /me/async-tasks load.
        }
    };
