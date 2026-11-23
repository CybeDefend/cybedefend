import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import backgroundTasksReducer, {
    addTask,
    completeTask,
    dismissTask,
    setCollapsed,
    closeContainer,
    AsyncTask,
} from '@/server/store/backgroundTasksSlice';

// The dismiss × now persists server-side via dismissBackgroundTask → DELETE
// /me/async-tasks/:id. Stub the network call so the integration test stays
// hermetic; the optimistic local removal still happens synchronously.
const deleteMyAsyncTask = vi.fn().mockResolvedValue(undefined);
vi.mock('@/server/services/asyncTasksService', () => ({
    deleteMyAsyncTask: (id: string) => deleteMyAsyncTask(id),
    getMyAsyncTasks: vi.fn().mockResolvedValue([]),
}));

// Mock react-i18next — same pattern as GlobalChatDrawer.test.tsx
vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

import { BackgroundTasksPanel } from './BackgroundTasksPanel';

// ── helpers ─────────────────────────────────────────────────────────────────

const buildStore = (preloadedState?: any) =>
    configureStore({
        reducer: { backgroundTasks: backgroundTasksReducer },
        preloadedState,
    });

const renderPanel = (preloadedState?: any) => {
    const store = buildStore(preloadedState);
    const utils = render(
        <Provider store={store}>
            <BackgroundTasksPanel />
        </Provider>,
    );
    return { store, ...utils };
};

const runningTask = (id = 'task-1'): AsyncTask => ({
    id,
    type: 'vuln_batch_update',
    status: 'running',
    total: 100,
    processed: 45,
    succeeded: 45,
});

const completedTask = (id = 'task-1'): AsyncTask => ({
    id,
    type: 'vuln_batch_update',
    status: 'completed',
    total: 100,
    processed: 100,
    succeeded: 95,
    failed: 5,
});

const failedTask = (id = 'task-1'): AsyncTask => ({
    id,
    type: 'vuln_batch_update',
    status: 'failed',
    total: 100,
    processed: 50,
    error: 'Something went wrong',
});

// ── tests ────────────────────────────────────────────────────────────────────

describe('BackgroundTasksPanel', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.runOnlyPendingTimers();
        vi.useRealTimers();
    });

    // ── visibility ────────────────────────────────────────────────────────────

    it('renders nothing when there are no tasks', () => {
        renderPanel();
        expect(screen.queryByText('Background tasks')).toBeNull();
    });

    it('renders nothing when tasks exist but open=false', () => {
        renderPanel({
            backgroundTasks: {
                tasks: [runningTask()],
                collapsed: false,
                open: false,
            },
        });
        expect(screen.queryByText('Background tasks')).toBeNull();
    });

    it('renders the panel when tasks exist and open=true', () => {
        const { store } = renderPanel();
        act(() => { store.dispatch(addTask(runningTask())); });
        // Title is in a span with sibling text nodes; use partial match
        expect(screen.getByText(/Background tasks/)).toBeInTheDocument();
    });

    // ── task rows ─────────────────────────────────────────────────────────────

    it('renders one row per task with label and progress', () => {
        const { store } = renderPanel();
        act(() => {
            store.dispatch(addTask(runningTask('t1')));
            store.dispatch(addTask({ ...runningTask('t2'), processed: 20, total: 100 }));
        });
        // Both tasks render their label
        expect(screen.getAllByText('Updating vulnerabilities')).toHaveLength(2);
    });

    it('shows processed/total progress text for a running task', () => {
        const { store } = renderPanel();
        act(() => { store.dispatch(addTask(runningTask())); });
        // 45% shown
        expect(screen.getByText(/45%/)).toBeInTheDocument();
    });

    it('shows updated and failed summary counts for a completed task', () => {
        const { store } = renderPanel();
        act(() => { store.dispatch(addTask(completedTask())); });
        // 95 updated, 5 failed
        expect(screen.getByText(/95 updated/)).toBeInTheDocument();
        expect(screen.getByText(/5 failed/)).toBeInTheDocument();
    });

    it('shows error message for a failed task', () => {
        const { store } = renderPanel();
        act(() => { store.dispatch(addTask(failedTask())); });
        expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    });

    it('falls back to "Failed" text when error is undefined', () => {
        const { store } = renderPanel();
        act(() => {
            store.dispatch(addTask({ ...failedTask(), error: undefined }));
        });
        expect(screen.getByText('Failed')).toBeInTheDocument();
    });

    // ── dismiss ───────────────────────────────────────────────────────────────

    it('clicking dismiss removes the task row and persists the delete server-side', () => {
        deleteMyAsyncTask.mockClear();
        const { store } = renderPanel();
        act(() => { store.dispatch(addTask(runningTask('task-dim'))); });
        expect(screen.getByText('Updating vulnerabilities')).toBeInTheDocument();

        const dismissBtn = screen.getByRole('button', { name: /dismiss task/i });
        fireEvent.click(dismissBtn);

        // Optimistic local removal …
        expect(screen.queryByText('Updating vulnerabilities')).toBeNull();
        const state = store.getState().backgroundTasks;
        expect(state.tasks.find((t) => t.id === 'task-dim')).toBeUndefined();
        // … plus the persisted DELETE so it doesn't reappear on reload.
        expect(deleteMyAsyncTask).toHaveBeenCalledWith('task-dim');
    });

    // ── close button (collapses to the header pill) ─────────────────────────────
    // Closing the big rectangle must NOT remove the header
    // pill (next to the language switcher). The single close button only
    // collapses the dropdown back to the pill, which stays while a task exists.

    it('close button is enabled even while an active task exists', () => {
        const { store } = renderPanel();
        act(() => { store.dispatch(addTask(runningTask())); });
        const closeBtn = screen.getByRole('button', { name: /close tasks panel/i });
        expect(closeBtn).not.toBeDisabled();
    });

    it('clicking close collapses to the pill without removing it (open stays true)', () => {
        const { store } = renderPanel();
        act(() => { store.dispatch(addTask(runningTask())); });
        expect(screen.getByText(/Background tasks/)).toBeInTheDocument();

        const closeBtn = screen.getByRole('button', { name: /close tasks panel/i });
        fireEvent.click(closeBtn);

        // The expanded dropdown is gone…
        expect(screen.queryByText(/Background tasks/)).toBeNull();
        const state = store.getState().backgroundTasks;
        // …but it only collapsed: open stays true so the header pill remains,
        // and the task is preserved (the pill shows the count).
        expect(state.collapsed).toBe(true);
        expect(state.open).toBe(true);
        expect(state.tasks).toHaveLength(1);
    });

    it('has no separate collapse chevron — the close button is the only control', () => {
        const { store } = renderPanel();
        act(() => { store.dispatch(addTask(runningTask())); });
        expect(
            screen.queryByRole('button', { name: /collapse tasks panel/i }),
        ).toBeNull();
    });

    it('renders nothing when collapsed (header pill represents the collapsed state)', () => {
        renderPanel({
            backgroundTasks: {
                tasks: [runningTask()],
                collapsed: true,
                open: true,
            },
        });
        expect(screen.queryByText(/Background tasks/)).toBeNull();
    });

    // ── auto-close ────────────────────────────────────────────────────────────

    it('dispatches closeContainer after 4 s when all tasks are terminal', () => {
        const { store } = renderPanel();
        act(() => { store.dispatch(addTask(completedTask())); });

        expect(store.getState().backgroundTasks.open).toBe(true);

        act(() => { vi.advanceTimersByTime(4000); });

        expect(store.getState().backgroundTasks.open).toBe(false);
    });

    it('does NOT auto-close while an active task exists', () => {
        const { store } = renderPanel();
        act(() => { store.dispatch(addTask(runningTask())); });

        act(() => { vi.advanceTimersByTime(10000); });

        expect(store.getState().backgroundTasks.open).toBe(true);
    });

    it('cancels the auto-close timer when a new active task appears', () => {
        const { store } = renderPanel();
        // Start with a completed task → timer begins
        act(() => { store.dispatch(addTask(completedTask('c1'))); });

        // Advance only partially
        act(() => { vi.advanceTimersByTime(2000); });

        // Add a new running task — allTerminal flips false, timer must cancel
        act(() => { store.dispatch(addTask(runningTask('r1'))); });

        // Advance past original 4 s deadline
        act(() => { vi.advanceTimersByTime(3000); });

        // Panel must still be open
        expect(store.getState().backgroundTasks.open).toBe(true);
    });
});
