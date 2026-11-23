import { createSelector, createSlice, PayloadAction } from '@reduxjs/toolkit';

export type AsyncTaskStatus = 'queued' | 'running' | 'completed' | 'failed';

/**
 * Known background-task types. Kept open (`| (string & {})`) so server-provided
 * types still flow through `mapAsyncTaskDto` while the known literals get
 * editor autocomplete in callers (thunks, row icon/label maps).
 */
export type AsyncTaskType =
    | 'vuln_batch_update'
    | 'autofix'
    | 'sca_autofix'
    | 'scan'
    | (string & {});

export interface AsyncTask {
    id: string;
    type: AsyncTaskType;
    projectId?: string;
    status: AsyncTaskStatus;
    total: number;
    processed: number;
    succeeded?: number;
    failed?: number;
    titleKey?: string;
    summary?: string;
    error?: string;
    /** URL of the PR / MR created by an autofix task (set when task completes). */
    resultUrl?: string;
    /**
     * Raw security-scanning lifecycle state for `type === 'scan'` tasks
     * (e.g. `waiting_for_file`, `running`, `completed_degraded`, `cancelled`).
     * Lets the row show an accurate label that the 4-value `status` can't carry.
     */
    scanState?: string;
    /**
     * `type === 'scan'` only: the results page showing this scan is mounted and
     * polls it itself (`useScanBackgroundTask`), so the app-root tracker leaves
     * it alone until the page releases it (one poller per scan).
     */
    ownedByPage?: boolean;
}

/**
 * Payload for `upsertScanTask`. Built by `buildScanTaskUpsert` (see scanTask.ts).
 * Kept here (not imported from scanTask.ts) so the slice has no import cycle.
 */
export interface ScanTaskUpsert {
    id: string;
    projectId?: string;
    status: AsyncTaskStatus;
    scanState?: string;
    processed: number;
    total: number;
    /** Set by the results page that follows the scan; left as is when absent. */
    ownedByPage?: boolean;
}

export interface BackgroundTasksState {
    tasks: AsyncTask[];
    collapsed: boolean;
    open: boolean;
}

const initialState: BackgroundTasksState = {
    tasks: [],
    collapsed: false,
    open: false,
};

const TERMINAL_STATUSES: AsyncTaskStatus[] = ['completed', 'failed'];

const backgroundTasksSlice = createSlice({
    name: 'backgroundTasks',
    initialState,
    reducers: {
        addTask(state, action: PayloadAction<AsyncTask>) {
            const idx = state.tasks.findIndex((t) => t.id === action.payload.id);
            if (idx !== -1) {
                state.tasks[idx] = action.payload;
            } else {
                state.tasks.unshift(action.payload);
            }
            state.open = true;
            state.collapsed = false;
        },
        updateProgress(
            state,
            action: PayloadAction<{
                id: string;
                processed: number;
                succeeded?: number;
                failed?: number;
                status?: AsyncTaskStatus;
            }>,
        ) {
            const task = state.tasks.find((t) => t.id === action.payload.id);
            if (!task) return;
            task.processed = action.payload.processed;
            if (action.payload.succeeded !== undefined) {
                task.succeeded = action.payload.succeeded;
            }
            if (action.payload.failed !== undefined) {
                task.failed = action.payload.failed;
            }
            if (action.payload.status !== undefined) {
                task.status = action.payload.status;
            }
        },
        completeTask(
            state,
            action: PayloadAction<{
                id: string;
                status: AsyncTaskStatus;
                succeeded?: number;
                failed?: number;
                error?: string;
                summary?: string;
                resultUrl?: string;
            }>,
        ) {
            const task = state.tasks.find((t) => t.id === action.payload.id);
            if (!task) return;
            task.status = action.payload.status;
            if (action.payload.succeeded !== undefined) {
                task.succeeded = action.payload.succeeded;
            }
            if (action.payload.failed !== undefined) {
                task.failed = action.payload.failed;
            }
            if (action.payload.error !== undefined) {
                task.error = action.payload.error;
            }
            if (action.payload.summary !== undefined) {
                task.summary = action.payload.summary;
            }
            if (action.payload.resultUrl !== undefined) {
                task.resultUrl = action.payload.resultUrl;
            }
        },
        /**
         * Register-or-update a scan as a background task.
         *
         * Unlike `addTask`, this NEVER re-opens / un-collapses the panel for an
         * already-tracked scan — progress ticks (and re-mounts when navigating
         * between result tabs) must not nag the user by re-popping the panel.
         * A brand-new ACTIVE scan does open the panel (the user just launched
         * it). An already-terminal scan that isn't tracked is ignored, so
         * opening a results page with an old finished scan never spawns a row.
         */
        upsertScanTask(state, action: PayloadAction<ScanTaskUpsert>) {
            const p = action.payload;
            const existing = state.tasks.find((t) => t.id === p.id);
            if (existing) {
                existing.type = 'scan';
                existing.status = p.status;
                existing.scanState = p.scanState;
                existing.processed = p.processed;
                existing.total = p.total;
                if (p.projectId !== undefined) existing.projectId = p.projectId;
                if (p.ownedByPage !== undefined) existing.ownedByPage = p.ownedByPage;
                return;
            }
            const isActive = p.status === 'queued' || p.status === 'running';
            if (!isActive) return; // don't materialise a finished, untracked scan
            state.tasks.unshift({
                id: p.id,
                type: 'scan',
                projectId: p.projectId,
                status: p.status,
                scanState: p.scanState,
                total: p.total,
                processed: p.processed,
                ...(p.ownedByPage !== undefined ? { ownedByPage: p.ownedByPage } : {}),
            });
            state.open = true;
            state.collapsed = false;
        },
        /**
         * The results page that followed this scan is gone (unmounted, or it
         * moved to another scan): hand the scan back to the app-root tracker,
         * which keeps it advancing from any route.
         */
        releaseScanTask(state, action: PayloadAction<string>) {
            const task = state.tasks.find((t) => t.id === action.payload);
            if (task) task.ownedByPage = false;
        },
        dismissTask(state, action: PayloadAction<string>) {
            state.tasks = state.tasks.filter((t) => t.id !== action.payload);
            if (state.tasks.length === 0) {
                state.open = false;
            }
        },
        setCollapsed(state, action: PayloadAction<boolean>) {
            state.collapsed = action.payload;
        },
        closeContainer(state) {
            state.open = false;
            // Once the panel is hidden, drop successfully-completed tasks — no
            // need to keep them in history. Failed tasks are kept so the user
            // can still see what went wrong.
            state.tasks = state.tasks.filter((t) => t.status !== 'completed');
        },
        hydrate(state, action: PayloadAction<AsyncTask[]>) {
            // `/me/async-tasks` is the canonical source for server-backed tasks
            // (vuln_batch_update, autofix, sca_autofix, report_generation) but
            // NEVER includes client-tracked `scan` tasks (those live only in the
            // store via upsertScanTask + useActiveScanTasksTracker). A blind
            // replace here would wipe any in-flight scan row and — because
            // selectActiveScanTasks would then go empty — permanently stall its
            // global poller. Preserve scan tasks that the payload doesn't carry.
            const payloadIds = new Set(action.payload.map((t) => t.id));
            const preservedScans = state.tasks.filter(
                (t) => t.type === 'scan' && !payloadIds.has(t.id),
            );
            state.tasks = [...action.payload, ...preservedScans];
            if (state.tasks.length > 0) {
                state.open = true;
            }
        },
    },
});

export const {
    addTask,
    updateProgress,
    completeTask,
    upsertScanTask,
    releaseScanTask,
    dismissTask,
    setCollapsed,
    closeContainer,
    hydrate,
} = backgroundTasksSlice.actions;

type RootSlice = { backgroundTasks: BackgroundTasksState };

export const selectBackgroundTasks = (s: RootSlice) => s.backgroundTasks.tasks;

/**
 * Whether the background-tasks dropdown is on screen: at least one task, the
 * container open and not collapsed to its header pill. The dropdown renders on
 * this, and the app's toasts move aside while it holds.
 */
export const selectTasksPanelShown = (s: RootSlice): boolean =>
    s.backgroundTasks.tasks.length > 0 && s.backgroundTasks.open && !s.backgroundTasks.collapsed;

const isActiveTask = (t: AsyncTask) => t.status === 'queued' || t.status === 'running';

/**
 * Memoized: the same array comes back until `tasks` itself changes. App reads
 * it at its root (`useBackgroundTasks`), and a new array on every call made
 * App re-render on every Redux action, each Cybe Chat token included.
 */
export const selectActiveTasks = createSelector(
    [(s: RootSlice) => s.backgroundTasks.tasks],
    (tasks) => tasks.filter(isActiveTask),
);

/**
 * Active (queued/running) scan-type tasks. Drives the global scan poller
 * (`useActiveScanTasksTracker`) which advances scan progress regardless of the
 * page the user is on. Memoized for the same reason as `selectActiveTasks`.
 */
export const selectActiveScanTasks = createSelector(
    [(s: RootSlice) => s.backgroundTasks.tasks],
    (tasks) => tasks.filter((t) => t.type === 'scan' && isActiveTask(t)),
);

/**
 * Select a single task by id (returns `undefined` if absent). Used by
 * AutofixPage to react to its SCA-autofix tracker task (completion → fetch
 * detailed result + open modal; failure → toast).
 */
export const selectBackgroundTaskById =
    (id: string) =>
    (s: RootSlice): AsyncTask | undefined =>
        s.backgroundTasks.tasks.find((t) => t.id === id);

export const selectAllTerminal = (s: RootSlice): boolean => {
    const tasks = s.backgroundTasks.tasks;
    if (tasks.length === 0) return false;
    return tasks.every((t) => TERMINAL_STATUSES.includes(t.status));
};

export const selectAggregatePercent = (s: RootSlice): number => {
    const tasks = s.backgroundTasks.tasks;
    const totalSum = tasks.reduce((acc, t) => acc + t.total, 0);
    if (totalSum === 0) return 0;
    const processedSum = tasks.reduce((acc, t) => acc + t.processed, 0);
    return Math.round((processedSum / totalSum) * 100);
};

export default backgroundTasksSlice.reducer;
