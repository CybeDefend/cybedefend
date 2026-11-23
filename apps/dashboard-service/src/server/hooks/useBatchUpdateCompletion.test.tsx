import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { Provider } from 'react-redux';
import { configureStore, createSlice } from '@reduxjs/toolkit';
import backgroundTasksReducer, {
    AsyncTask,
    addTask,
    completeTask,
    selectBackgroundTasks,
} from '../store/backgroundTasksSlice';

import { useBatchUpdateCompletion } from './useBatchUpdateCompletion';

// ------------------------------------------------------------------ //
// Store helpers
// ------------------------------------------------------------------ //

const makeStore = () =>
    configureStore({
        reducer: {
            backgroundTasks: backgroundTasksReducer,
        },
    });

type TestStore = ReturnType<typeof makeStore>;

const wrapper =
    (store: TestStore) =>
    ({ children }: { children: React.ReactNode }) => (
        <Provider store={store}>{children}</Provider>
    );

const makeTask = (overrides: Partial<AsyncTask> = {}): AsyncTask => ({
    id: 'task-1',
    type: 'vuln_batch_update',
    projectId: 'project-123',
    status: 'queued',
    total: 10,
    processed: 0,
    ...overrides,
});

// ------------------------------------------------------------------ //
// Tests
// ------------------------------------------------------------------ //

describe('useBatchUpdateCompletion', () => {
    describe('fires onComplete when a task transitions to terminal', () => {
        it('fires when a vuln_batch_update task for the projectId transitions queued→completed', () => {
            const store = makeStore();
            const onComplete = vi.fn();

            // Add an active task first
            store.dispatch(addTask(makeTask({ id: 'task-1', status: 'queued' })));

            renderHook(() => useBatchUpdateCompletion('project-123', onComplete), {
                wrapper: wrapper(store),
            });

            // Not fired yet (task is still queued)
            expect(onComplete).not.toHaveBeenCalled();

            // Complete the task
            act(() => {
                store.dispatch(completeTask({ id: 'task-1', status: 'completed', succeeded: 10 }));
            });

            expect(onComplete).toHaveBeenCalledTimes(1);
        });

        it('fires when a task transitions to failed', () => {
            const store = makeStore();
            const onComplete = vi.fn();

            store.dispatch(addTask(makeTask({ id: 'task-fail', status: 'queued' })));

            renderHook(() => useBatchUpdateCompletion('project-123', onComplete), {
                wrapper: wrapper(store),
            });

            expect(onComplete).not.toHaveBeenCalled();

            act(() => {
                store.dispatch(completeTask({ id: 'task-fail', status: 'failed', error: 'oops' }));
            });

            expect(onComplete).toHaveBeenCalledTimes(1);
        });
    });

    describe('does NOT fire for irrelevant tasks', () => {
        it('does not fire for a task with a different projectId', () => {
            const store = makeStore();
            const onComplete = vi.fn();

            store.dispatch(addTask(makeTask({ id: 'task-other', projectId: 'other-project', status: 'queued' })));

            renderHook(() => useBatchUpdateCompletion('project-123', onComplete), {
                wrapper: wrapper(store),
            });

            act(() => {
                store.dispatch(completeTask({ id: 'task-other', status: 'completed' }));
            });

            expect(onComplete).not.toHaveBeenCalled();
        });

        it('does not fire for a task with a different type', () => {
            const store = makeStore();
            const onComplete = vi.fn();

            store.dispatch(
                addTask(makeTask({ id: 'task-other-type', type: 'some_other_task', projectId: 'project-123', status: 'queued' })),
            );

            renderHook(() => useBatchUpdateCompletion('project-123', onComplete), {
                wrapper: wrapper(store),
            });

            act(() => {
                store.dispatch(completeTask({ id: 'task-other-type', status: 'completed' }));
            });

            expect(onComplete).not.toHaveBeenCalled();
        });
    });

    describe('seed: does NOT fire for tasks already terminal on first render', () => {
        it('does not fire for a task that was already completed when the hook first ran', () => {
            const store = makeStore();
            const onComplete = vi.fn();

            // Pre-seed the store with an already-terminal task BEFORE the hook mounts
            store.dispatch(addTask(makeTask({ id: 'already-done', status: 'completed' })));

            renderHook(() => useBatchUpdateCompletion('project-123', onComplete), {
                wrapper: wrapper(store),
            });

            // Should NOT fire — task was already terminal on mount
            expect(onComplete).not.toHaveBeenCalled();
        });

        it('does not fire for a task already failed on mount', () => {
            const store = makeStore();
            const onComplete = vi.fn();

            store.dispatch(addTask(makeTask({ id: 'already-failed', status: 'failed' })));

            renderHook(() => useBatchUpdateCompletion('project-123', onComplete), {
                wrapper: wrapper(store),
            });

            expect(onComplete).not.toHaveBeenCalled();
        });
    });

    describe('fires only ONCE per task id', () => {
        it('does not fire again on re-renders after a task already completed', () => {
            const store = makeStore();
            const onComplete = vi.fn();

            store.dispatch(addTask(makeTask({ id: 'task-once', status: 'queued' })));

            const { rerender } = renderHook(() => useBatchUpdateCompletion('project-123', onComplete), {
                wrapper: wrapper(store),
            });

            act(() => {
                store.dispatch(completeTask({ id: 'task-once', status: 'completed' }));
            });

            expect(onComplete).toHaveBeenCalledTimes(1);

            // Re-render multiple times
            rerender();
            rerender();
            rerender();

            // Still only once
            expect(onComplete).toHaveBeenCalledTimes(1);
        });
    });

    describe('callback ref stability', () => {
        it('always calls the latest onComplete callback even if the reference changes between renders', () => {
            const store = makeStore();
            const firstCallback = vi.fn();
            const secondCallback = vi.fn();

            store.dispatch(addTask(makeTask({ id: 'task-cb', status: 'queued' })));

            let currentCallback = firstCallback;
            const { rerender } = renderHook(
                () => useBatchUpdateCompletion('project-123', currentCallback),
                { wrapper: wrapper(store) },
            );

            // Swap the callback before the task completes
            currentCallback = secondCallback;
            rerender();

            act(() => {
                store.dispatch(completeTask({ id: 'task-cb', status: 'completed' }));
            });

            expect(firstCallback).not.toHaveBeenCalled();
            expect(secondCallback).toHaveBeenCalledTimes(1);
        });
    });

    describe('no-op when projectId is undefined', () => {
        it('does not fire when projectId is undefined, even if a task completes', () => {
            const store = makeStore();
            const onComplete = vi.fn();

            store.dispatch(addTask(makeTask({ id: 'task-undef', status: 'queued' })));

            renderHook(() => useBatchUpdateCompletion(undefined, onComplete), {
                wrapper: wrapper(store),
            });

            act(() => {
                store.dispatch(completeTask({ id: 'task-undef', status: 'completed' }));
            });

            expect(onComplete).not.toHaveBeenCalled();
        });
    });
});
