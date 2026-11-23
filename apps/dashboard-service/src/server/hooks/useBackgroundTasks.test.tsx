import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { Provider } from 'react-redux';
import { configureStore, createSlice } from '@reduxjs/toolkit';
import backgroundTasksReducer, {
    AsyncTask,
    addTask,
    selectActiveTasks,
} from '../store/backgroundTasksSlice';

// ------------------------------------------------------------------ //
// Hoisted mocks (vi.hoisted runs before imports)
// ------------------------------------------------------------------ //
const { openStreamMock } = vi.hoisted(() => ({
    openStreamMock: vi.fn(),
}));

vi.mock('../services/realtimeStream', () => ({
    openStream: openStreamMock,
    // Make handler-shape imports no-ops
    __resetConnectionsForTests: vi.fn(),
}));

vi.mock('../services/asyncTasksService', () => ({
    getMyAsyncTasks: vi.fn(),
}));

vi.mock('../services/resultService', () => ({
    batchUpdateVulnerabilities: vi.fn(),
}));

vi.mock('@/utils/function/region', () => ({
    getRegionConfig: () => ({ apiUrl: 'https://api' }),
}));

// Import AFTER mocks are set up
import { useBackgroundTasks } from './useBackgroundTasks';
import { startBatchUpdate } from '../store/backgroundTasksThunks';
import { getMyAsyncTasks } from '../services/asyncTasksService';
import { batchUpdateVulnerabilities } from '../services/resultService';

const mockedGetMyAsyncTasks = getMyAsyncTasks as ReturnType<typeof vi.fn>;
const mockedBatchUpdate = batchUpdateVulnerabilities as ReturnType<typeof vi.fn>;

// ------------------------------------------------------------------ //
// Store helpers
// ------------------------------------------------------------------ //

const makeStore = (token: string | null = 'jwt') =>
    configureStore({
        reducer: {
            auth: createSlice({
                name: 'auth',
                initialState: { accessToken: token },
                reducers: {
                    set: (s, a: { payload: string | null }) => {
                        s.accessToken = a.payload;
                    },
                },
            }).reducer,
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
    status: 'queued',
    total: 10,
    processed: 0,
    ...overrides,
});

// ------------------------------------------------------------------ //
// openStream close mock factory
// ------------------------------------------------------------------ //
const makeClose = () => {
    const close = vi.fn();
    openStreamMock.mockReturnValueOnce({ close });
    return close;
};

// ------------------------------------------------------------------ //

beforeEach(() => {
    openStreamMock.mockReset();
    openStreamMock.mockReturnValue({ close: vi.fn() });
    mockedGetMyAsyncTasks.mockReset();
    mockedGetMyAsyncTasks.mockResolvedValue([]);
    mockedBatchUpdate.mockReset();
});

// ------------------------------------------------------------------ //
// Tests
// ------------------------------------------------------------------ //

describe('useBackgroundTasks', () => {
    describe('mount hydration', () => {
        it('dispatches hydrate with tasks from getMyAsyncTasks on mount', async () => {
            const tasks = [makeTask({ id: 'hydrated-1', status: 'queued' })];
            mockedGetMyAsyncTasks.mockResolvedValue(tasks);

            const store = makeStore();
            const { unmount } = renderHook(() => useBackgroundTasks(), {
                wrapper: wrapper(store),
            });

            // Wait for hydration promise to resolve
            await act(async () => {
                await Promise.resolve();
            });

            const state = store.getState().backgroundTasks.tasks;
            expect(state).toHaveLength(1);
            expect(state[0].id).toBe('hydrated-1');

            unmount();
        });

        it('swallows hydration errors (best-effort)', async () => {
            mockedGetMyAsyncTasks.mockRejectedValue(new Error('network'));

            const store = makeStore();
            // Should not throw
            const { unmount } = renderHook(() => useBackgroundTasks(), {
                wrapper: wrapper(store),
            });

            await act(async () => {
                await Promise.resolve();
            });

            // Store stays empty, no crash
            expect(store.getState().backgroundTasks.tasks).toHaveLength(0);
            unmount();
        });
    });

    describe('auth-gated hydration', () => {
        it('does NOT call getMyAsyncTasks while accessToken is null (avoids the 401 on refresh)', async () => {
            // On a hard refresh useBackgroundTasks mounts before Logto restores
            // the token; firing the GET with no Bearer header → 401.
            const store = makeStore(null);
            const { unmount } = renderHook(() => useBackgroundTasks(), {
                wrapper: wrapper(store),
            });

            await act(async () => {
                await Promise.resolve();
            });

            expect(mockedGetMyAsyncTasks).not.toHaveBeenCalled();
            unmount();
        });

        it('hydrates once the access token becomes available', async () => {
            const tasks = [makeTask({ id: 'late-hydrate', status: 'queued' })];
            mockedGetMyAsyncTasks.mockResolvedValue(tasks);

            const store = makeStore(null);
            const { unmount } = renderHook(() => useBackgroundTasks(), {
                wrapper: wrapper(store),
            });

            await act(async () => {
                await Promise.resolve();
            });
            expect(mockedGetMyAsyncTasks).not.toHaveBeenCalled();

            // Logto restores the token after refresh.
            await act(async () => {
                store.dispatch({ type: 'auth/set', payload: 'jwt' });
                await Promise.resolve();
            });

            expect(mockedGetMyAsyncTasks).toHaveBeenCalledTimes(1);
            expect(store.getState().backgroundTasks.tasks[0]?.id).toBe(
                'late-hydrate',
            );
            unmount();
        });

        it('does not re-hydrate on token rotation once already hydrated', async () => {
            mockedGetMyAsyncTasks.mockResolvedValue([]);

            const store = makeStore('jwt');
            const { unmount } = renderHook(() => useBackgroundTasks(), {
                wrapper: wrapper(store),
            });

            await act(async () => {
                await Promise.resolve();
            });
            expect(mockedGetMyAsyncTasks).toHaveBeenCalledTimes(1);

            // Token rotates (refresh-token rotation) — must NOT re-fetch.
            await act(async () => {
                store.dispatch({ type: 'auth/set', payload: 'jwt-2' });
                await Promise.resolve();
            });

            expect(mockedGetMyAsyncTasks).toHaveBeenCalledTimes(1);
            unmount();
        });

        it('retries hydration after a transient error when the token changes', async () => {
            // First attempt rejects, second resolves. The retry only happens
            // because the catch resets hydratedRef so the next token change
            // re-triggers the effect.
            mockedGetMyAsyncTasks
                .mockRejectedValueOnce(new Error('network'))
                .mockResolvedValue([
                    makeTask({ id: 'retry-task', status: 'queued' }),
                ]);

            const store = makeStore('jwt');
            const { unmount } = renderHook(() => useBackgroundTasks(), {
                wrapper: wrapper(store),
            });

            await act(async () => {
                await Promise.resolve();
            });
            // First attempt failed → store empty, hydratedRef reset to false.
            expect(mockedGetMyAsyncTasks).toHaveBeenCalledTimes(1);
            expect(store.getState().backgroundTasks.tasks).toHaveLength(0);

            // Token rotates after the error → effect re-runs and retries.
            await act(async () => {
                store.dispatch({ type: 'auth/set', payload: 'jwt-2' });
                await Promise.resolve();
            });

            expect(mockedGetMyAsyncTasks).toHaveBeenCalledTimes(2);
            expect(store.getState().backgroundTasks.tasks[0]?.id).toBe(
                'retry-task',
            );
            unmount();
        });
    });

    describe('stream lifecycle — active tasks', () => {
        it('opens a stream for each hydrated ACTIVE task', async () => {
            const tasks = [
                makeTask({ id: 'task-active-1', status: 'queued' }),
                makeTask({ id: 'task-active-2', status: 'running' }),
            ];
            mockedGetMyAsyncTasks.mockResolvedValue(tasks);

            const store = makeStore();
            renderHook(() => useBackgroundTasks(), { wrapper: wrapper(store) });

            await act(async () => {
                await Promise.resolve();
            });

            // One stream per active task
            expect(openStreamMock).toHaveBeenCalledTimes(2);
            const urls = openStreamMock.mock.calls.map((c: any[]) => c[0]);
            expect(urls).toContain('https://api/v1/realtime/tasks/task-active-1/stream');
            expect(urls).toContain('https://api/v1/realtime/tasks/task-active-2/stream');
        });

        it('does NOT open a stream for terminal (completed/failed) tasks on hydration', async () => {
            const tasks = [
                makeTask({ id: 'done', status: 'completed' }),
                makeTask({ id: 'err', status: 'failed' }),
            ];
            mockedGetMyAsyncTasks.mockResolvedValue(tasks);

            const store = makeStore();
            renderHook(() => useBackgroundTasks(), { wrapper: wrapper(store) });

            await act(async () => {
                await Promise.resolve();
            });

            expect(openStreamMock).not.toHaveBeenCalled();
        });

        it('does not double-open a stream for the same active task on re-render', async () => {
            const tasks = [makeTask({ id: 'task-1', status: 'queued' })];
            mockedGetMyAsyncTasks.mockResolvedValue(tasks);

            const store = makeStore();
            const { rerender } = renderHook(() => useBackgroundTasks(), {
                wrapper: wrapper(store),
            });

            await act(async () => {
                await Promise.resolve();
            });

            // Re-render (e.g. parent re-renders)
            rerender();

            // Still only one open call
            expect(openStreamMock).toHaveBeenCalledTimes(1);
        });

        it('opens a stream when a new task is added via addTask', async () => {
            mockedGetMyAsyncTasks.mockResolvedValue([]);

            const store = makeStore();
            renderHook(() => useBackgroundTasks(), { wrapper: wrapper(store) });

            await act(async () => {
                await Promise.resolve();
            });

            expect(openStreamMock).not.toHaveBeenCalled();

            // Dispatch addTask → should trigger stream open
            act(() => {
                store.dispatch(
                    addTask({ id: 'new-task', type: 'vuln_batch_update', status: 'queued', total: 5, processed: 0 }),
                );
            });

            expect(openStreamMock).toHaveBeenCalledTimes(1);
            const [url] = openStreamMock.mock.calls[0];
            expect(url).toBe('https://api/v1/realtime/tasks/new-task/stream');
        });
    });

    describe('SSE event handling', () => {
        it('dispatches updateProgress when ASYNC_TASK_PROGRESS fires', async () => {
            mockedGetMyAsyncTasks.mockResolvedValue([
                makeTask({ id: 'task-1', status: 'running', total: 10, processed: 0 }),
            ]);

            const store = makeStore();
            renderHook(() => useBackgroundTasks(), { wrapper: wrapper(store) });

            await act(async () => {
                await Promise.resolve();
            });

            // Grab the handlers passed to openStream for task-1
            const call = openStreamMock.mock.calls.find((c: any[]) =>
                c[0].includes('task-1'),
            );
            expect(call).toBeDefined();
            const handlers = call![1];

            // Fire the progress event
            act(() => {
                handlers.ASYNC_TASK_PROGRESS({
                    payload: {
                        asyncTask: {
                            taskId: 'task-1',
                            processed: 5,
                            succeeded: 4,
                            failed: 1,
                            status: 'running',
                        },
                    },
                });
            });

            const task = store.getState().backgroundTasks.tasks.find((t) => t.id === 'task-1');
            expect(task?.processed).toBe(5);
            expect(task?.succeeded).toBe(4);
            expect(task?.failed).toBe(1);
            expect(task?.status).toBe('running');
        });

        it('dispatches completeTask when ASYNC_TASK_COMPLETED fires', async () => {
            mockedGetMyAsyncTasks.mockResolvedValue([
                makeTask({ id: 'task-1', status: 'running', total: 10, processed: 0 }),
            ]);

            const store = makeStore();
            renderHook(() => useBackgroundTasks(), { wrapper: wrapper(store) });

            await act(async () => {
                await Promise.resolve();
            });

            const call = openStreamMock.mock.calls.find((c: any[]) =>
                c[0].includes('task-1'),
            );
            const handlers = call![1];

            act(() => {
                handlers.ASYNC_TASK_COMPLETED({
                    payload: {
                        asyncTask: {
                            taskId: 'task-1',
                            status: 'completed',
                            succeeded: 10,
                            failed: 0,
                        },
                    },
                });
            });

            const task = store.getState().backgroundTasks.tasks.find((t) => t.id === 'task-1');
            expect(task?.status).toBe('completed');
            expect(task?.succeeded).toBe(10);
        });

        it('dispatches completeTask WITH resultUrl when ASYNC_TASK_COMPLETED carries one', async () => {
            mockedGetMyAsyncTasks.mockResolvedValue([
                makeTask({ id: 'task-pr', status: 'running', total: 3, processed: 0 }),
            ]);

            const store = makeStore();
            renderHook(() => useBackgroundTasks(), { wrapper: wrapper(store) });

            await act(async () => {
                await Promise.resolve();
            });

            const call = openStreamMock.mock.calls.find((c: any[]) =>
                c[0].includes('task-pr'),
            );
            const handlers = call![1];

            act(() => {
                handlers.ASYNC_TASK_COMPLETED({
                    payload: {
                        asyncTask: {
                            taskId: 'task-pr',
                            status: 'completed',
                            succeeded: 3,
                            failed: 0,
                            resultUrl: 'https://github.com/org/repo/pull/42',
                        },
                    },
                });
            });

            const task = store.getState().backgroundTasks.tasks.find((t) => t.id === 'task-pr');
            expect(task?.status).toBe('completed');
            expect(task?.resultUrl).toBe('https://github.com/org/repo/pull/42');
        });

        it('dispatches completeTask WITHOUT resultUrl when the event omits it', async () => {
            mockedGetMyAsyncTasks.mockResolvedValue([
                makeTask({ id: 'task-no-pr', status: 'running', total: 5, processed: 0 }),
            ]);

            const store = makeStore();
            renderHook(() => useBackgroundTasks(), { wrapper: wrapper(store) });

            await act(async () => {
                await Promise.resolve();
            });

            const call = openStreamMock.mock.calls.find((c: any[]) =>
                c[0].includes('task-no-pr'),
            );
            const handlers = call![1];

            act(() => {
                handlers.ASYNC_TASK_COMPLETED({
                    payload: {
                        asyncTask: {
                            taskId: 'task-no-pr',
                            status: 'completed',
                            succeeded: 5,
                            failed: 0,
                            // no resultUrl
                        },
                    },
                });
            });

            const task = store.getState().backgroundTasks.tasks.find((t) => t.id === 'task-no-pr');
            expect(task?.status).toBe('completed');
            expect(task?.resultUrl).toBeUndefined();
        });

        it('closes the stream for a task when it transitions from active to terminal', async () => {
            const closeFn = vi.fn();
            openStreamMock.mockReturnValue({ close: closeFn });

            mockedGetMyAsyncTasks.mockResolvedValue([
                makeTask({ id: 'task-1', status: 'running', total: 10, processed: 0 }),
            ]);

            const store = makeStore();
            renderHook(() => useBackgroundTasks(), { wrapper: wrapper(store) });

            await act(async () => {
                await Promise.resolve();
            });

            expect(openStreamMock).toHaveBeenCalledTimes(1);

            // Fire completed event → task leaves active list → effect should close stream
            const call = openStreamMock.mock.calls.find((c: any[]) =>
                c[0].includes('task-1'),
            );
            const handlers = call![1];

            act(() => {
                handlers.ASYNC_TASK_COMPLETED({
                    payload: {
                        asyncTask: {
                            taskId: 'task-1',
                            status: 'completed',
                            succeeded: 10,
                            failed: 0,
                        },
                    },
                });
            });

            // Stream must be closed since task is no longer active
            expect(closeFn).toHaveBeenCalled();
        });
    });

    describe('unmount cleanup', () => {
        it('closes all open streams on unmount', async () => {
            const close1 = vi.fn();
            const close2 = vi.fn();
            openStreamMock
                .mockReturnValueOnce({ close: close1 })
                .mockReturnValueOnce({ close: close2 });

            mockedGetMyAsyncTasks.mockResolvedValue([
                makeTask({ id: 'task-1', status: 'queued' }),
                makeTask({ id: 'task-2', status: 'running' }),
            ]);

            const store = makeStore();
            const { unmount } = renderHook(() => useBackgroundTasks(), {
                wrapper: wrapper(store),
            });

            await act(async () => {
                await Promise.resolve();
            });

            expect(openStreamMock).toHaveBeenCalledTimes(2);

            unmount();

            expect(close1).toHaveBeenCalled();
            expect(close2).toHaveBeenCalled();
        });
    });

    describe('tokenProvider', () => {
        it('passes tokenProvider that reads access token from redux store', async () => {
            mockedGetMyAsyncTasks.mockResolvedValue([
                makeTask({ id: 'task-1', status: 'queued' }),
            ]);

            const store = makeStore('my-jwt-token');
            renderHook(() => useBackgroundTasks(), { wrapper: wrapper(store) });

            await act(async () => {
                await Promise.resolve();
            });

            expect(openStreamMock).toHaveBeenCalledTimes(1);
            const opts = openStreamMock.mock.calls[0][2];
            expect(opts.tokenProvider()).toBe('my-jwt-token');
        });

        it('passes a refreshToken so a reconnect does not replay an expired JWT', async () => {
            // The gateway ends every stream when the token it was opened with
            // expires. A task outliving its token must come back on a freshly
            // minted JWT, not on the stale redux snapshot.
            mockedGetMyAsyncTasks.mockResolvedValue([
                makeTask({ id: 'task-1', status: 'queued' }),
            ]);

            const store = makeStore('my-jwt-token');
            renderHook(() => useBackgroundTasks(), { wrapper: wrapper(store) });

            await act(async () => {
                await Promise.resolve();
            });

            const opts = openStreamMock.mock.calls[0][2];
            expect(typeof opts.refreshToken).toBe('function');
        });
    });
});

// ------------------------------------------------------------------ //
// startBatchUpdate thunk
// ------------------------------------------------------------------ //

describe('startBatchUpdate thunk', () => {
    it('calls batchUpdateVulnerabilities and dispatches addTask with returned taskId', async () => {
        mockedBatchUpdate.mockResolvedValue({
            taskId: 'server-task-id',
            status: 'queued',
            total: 20,
        });

        const store = makeStore();
        const taskId = await store.dispatch(
            startBatchUpdate('project-123', {
                items: [{ vulnerabilityId: 'v-1', status: 'fixed' }],
            }) as any,
        );

        expect(mockedBatchUpdate).toHaveBeenCalledWith('project-123', {
            items: [{ vulnerabilityId: 'v-1', status: 'fixed' }],
        });

        const tasks = store.getState().backgroundTasks.tasks;
        expect(tasks).toHaveLength(1);
        expect(tasks[0].id).toBe('server-task-id');
        expect(tasks[0].type).toBe('vuln_batch_update');
        expect(tasks[0].status).toBe('queued');
        expect(tasks[0].total).toBe(20);
        expect(tasks[0].processed).toBe(0);
        expect(tasks[0].projectId).toBe('project-123');

        // Should return taskId to caller
        expect(taskId).toBe('server-task-id');
    });

    it('propagates errors from batchUpdateVulnerabilities (does not swallow)', async () => {
        mockedBatchUpdate.mockRejectedValue(new Error('API error'));

        const store = makeStore();

        await expect(
            store.dispatch(
                startBatchUpdate('p-1', { items: [] }) as any,
            ),
        ).rejects.toThrow('API error');

        // No task was added to the store
        expect(store.getState().backgroundTasks.tasks).toHaveLength(0);
    });

    it('sets projectId on the dispatched addTask', async () => {
        mockedBatchUpdate.mockResolvedValue({
            taskId: 'tid',
            status: 'queued',
            total: 5,
        });

        const store = makeStore();
        await store.dispatch(startBatchUpdate('my-project', { items: [] }) as any);

        const task = store.getState().backgroundTasks.tasks[0];
        expect(task.projectId).toBe('my-project');
    });
});
