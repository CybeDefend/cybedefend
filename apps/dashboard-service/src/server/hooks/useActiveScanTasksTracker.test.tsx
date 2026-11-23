import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import backgroundTasksReducer, {
    upsertScanTask,
    releaseScanTask,
} from '@/server/store/backgroundTasksSlice';
import { mockTabVisibility } from '@/test/tabVisibility';

// Mock the scan service BEFORE importing the hook.
const { getScanByIdMock } = vi.hoisted(() => ({ getScanByIdMock: vi.fn() }));
vi.mock('@/server/services/scanService', () => ({
    default: { getScanById: getScanByIdMock },
}));

import {
    useActiveScanTasksTracker,
    SCAN_POLL_INTERVAL_MS,
} from './useActiveScanTasksTracker';

const buildStore = (preloaded?: any) =>
    configureStore({
        reducer: { backgroundTasks: backgroundTasksReducer },
        preloadedState: preloaded,
    });

const renderTracker = (store: ReturnType<typeof buildStore>) => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
        <Provider store={store}>{children}</Provider>
    );
    return renderHook(() => useActiveScanTasksTracker(), { wrapper });
};

const running = (id = 'scan-1', extra: { ownedByPage?: boolean } = {}) =>
    upsertScanTask({
        id,
        projectId: 'proj-1',
        status: 'running',
        scanState: 'running',
        processed: 10,
        total: 100,
        ...extra,
    });

const scanState = (state: string, progress: number) => ({
    id: 'scan-1',
    projectId: 'proj-1',
    state,
    progress,
});

/** Let the poll's promises settle. */
const settle = () =>
    act(async () => {
        await Promise.resolve();
        await Promise.resolve();
    });

const advance = (ms: number) =>
    act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
    });

let tab: ReturnType<typeof mockTabVisibility>;

describe('useActiveScanTasksTracker', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        getScanByIdMock.mockReset();
        tab = mockTabVisibility();
    });

    afterEach(() => {
        vi.runOnlyPendingTimers();
        vi.useRealTimers();
        tab.restore();
    });

    it('does not poll when there are no active scan tasks', async () => {
        const store = buildStore();
        renderTracker(store);
        await act(async () => {
            await Promise.resolve();
        });
        expect(getScanByIdMock).not.toHaveBeenCalled();
    });

    it('polls getScanById immediately for an active scan task', async () => {
        const store = buildStore();
        getScanByIdMock.mockResolvedValue({
            id: 'scan-1',
            projectId: 'proj-1',
            state: 'running',
            progress: 55,
        });
        // seed an active scan task
        store.dispatch(
            upsertScanTask({
                id: 'scan-1',
                projectId: 'proj-1',
                status: 'running',
                scanState: 'running',
                processed: 10,
                total: 100,
            }),
        );

        renderTracker(store);
        await act(async () => {
            await Promise.resolve();
        });

        expect(getScanByIdMock).toHaveBeenCalledWith('proj-1', 'scan-1');
        expect(store.getState().backgroundTasks.tasks[0].processed).toBe(55);
    });

    it('completes the scan task and stops polling once it reaches a terminal state', async () => {
        const store = buildStore();
        getScanByIdMock.mockResolvedValue({
            id: 'scan-1',
            projectId: 'proj-1',
            state: 'completed',
            progress: 100,
        });
        store.dispatch(
            upsertScanTask({
                id: 'scan-1',
                projectId: 'proj-1',
                status: 'running',
                scanState: 'running',
                processed: 10,
                total: 100,
            }),
        );

        renderTracker(store);
        await act(async () => {
            await Promise.resolve();
        });

        expect(store.getState().backgroundTasks.tasks[0].status).toBe('completed');

        const callsAfterComplete = getScanByIdMock.mock.calls.length;
        // Advance several intervals — no more polling now that it is terminal.
        await act(async () => {
            vi.advanceTimersByTime(SCAN_POLL_INTERVAL_MS * 3);
            await Promise.resolve();
        });
        expect(getScanByIdMock.mock.calls.length).toBe(callsAfterComplete);
    });

    // ─── one poller per scan, nothing in a hidden tab ──────────

    it('polls every 15 s', async () => {
        const store = buildStore();
        getScanByIdMock.mockResolvedValue(scanState('running', 20));
        store.dispatch(running());
        renderTracker(store);
        await settle();
        expect(getScanByIdMock).toHaveBeenCalledTimes(1);

        await advance(SCAN_POLL_INTERVAL_MS - 1);
        expect(getScanByIdMock).toHaveBeenCalledTimes(1);
        await advance(1);
        expect(getScanByIdMock).toHaveBeenCalledTimes(2);
        expect(SCAN_POLL_INTERVAL_MS).toBe(15_000);
    });

    it('asks nothing in a hidden tab, then asks once as soon as it is shown again', async () => {
        const store = buildStore();
        getScanByIdMock.mockResolvedValue(scanState('running', 20));
        store.dispatch(running());
        tab.startHidden();
        renderTracker(store);
        await settle();

        await advance(60_000);
        expect(getScanByIdMock).not.toHaveBeenCalled();

        tab.show();
        await settle();
        expect(getScanByIdMock).toHaveBeenCalledTimes(1);
        expect(store.getState().backgroundTasks.tasks[0].processed).toBe(20);
    });

    it('stops asking when the tab is hidden mid-scan', async () => {
        const store = buildStore();
        getScanByIdMock.mockResolvedValue(scanState('running', 20));
        store.dispatch(running());
        renderTracker(store);
        await settle();
        expect(getScanByIdMock).toHaveBeenCalledTimes(1);

        tab.hide();
        await advance(60_000);
        expect(getScanByIdMock).toHaveBeenCalledTimes(1);
    });

    it('leaves alone a scan its results page is following', async () => {
        const store = buildStore();
        getScanByIdMock.mockResolvedValue(scanState('running', 20));
        store.dispatch(running('scan-1', { ownedByPage: true }));
        renderTracker(store);
        await settle();
        await advance(60_000);
        expect(getScanByIdMock).not.toHaveBeenCalled();
    });

    it('polls only the scans no page is following', async () => {
        const store = buildStore();
        getScanByIdMock.mockImplementation(async (_p: string, id: string) => ({ ...scanState('running', 20), id }));
        store.dispatch(running('scan-1', { ownedByPage: true }));
        store.dispatch(running('scan-2'));
        renderTracker(store);
        await settle();
        expect(getScanByIdMock.mock.calls.map((c) => c[1])).toEqual(['scan-2']);
    });

    // End of scan without SSE: the user leaves the results page,
    // the tracker takes the scan back and sees it finish on its own polls.
    it('takes a scan back when its page lets go of it, and sees it finish', async () => {
        const store = buildStore();
        getScanByIdMock.mockResolvedValue(scanState('running', 50));
        store.dispatch(running('scan-1', { ownedByPage: true }));
        renderTracker(store);
        await settle();
        expect(getScanByIdMock).not.toHaveBeenCalled();

        // The page unmounts; the timer is not restarted, so no burst: the scan
        // is read at the next tick.
        store.dispatch(releaseScanTask('scan-1'));
        await settle();
        await advance(SCAN_POLL_INTERVAL_MS);
        expect(getScanByIdMock).toHaveBeenCalledTimes(1);
        expect(store.getState().backgroundTasks.tasks[0].processed).toBe(50);

        getScanByIdMock.mockResolvedValue(scanState('completed', 100));
        await advance(SCAN_POLL_INTERVAL_MS);
        expect(store.getState().backgroundTasks.tasks[0]).toMatchObject({ status: 'completed', processed: 100 });

        const calls = getScanByIdMock.mock.calls.length;
        await advance(SCAN_POLL_INTERVAL_MS * 3);
        expect(getScanByIdMock.mock.calls.length).toBe(calls);
    });

    it('stops following a scan the API no longer knows (404)', async () => {
        const store = buildStore();
        getScanByIdMock.mockRejectedValue({ response: { status: 404 } });
        store.dispatch(running());
        renderTracker(store);
        await settle();
        expect(getScanByIdMock).toHaveBeenCalledTimes(1);

        await advance(60_000);
        expect(getScanByIdMock).toHaveBeenCalledTimes(1);
        expect(store.getState().backgroundTasks.tasks).toHaveLength(0);
    });

    it('keeps trying through a transient failure', async () => {
        const store = buildStore();
        getScanByIdMock
            .mockRejectedValueOnce({ response: { status: 503 } })
            .mockRejectedValueOnce(new Error('Network Error'))
            .mockResolvedValue(scanState('running', 70));
        store.dispatch(running());
        renderTracker(store);
        await settle();
        await advance(SCAN_POLL_INTERVAL_MS * 2);
        expect(getScanByIdMock).toHaveBeenCalledTimes(3);
        expect(store.getState().backgroundTasks.tasks[0].processed).toBe(70);
    });
});
