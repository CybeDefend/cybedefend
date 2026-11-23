import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import backgroundTasksReducer from '@/server/store/backgroundTasksSlice';
import { useScanBackgroundTask } from './useScanBackgroundTask';
import type { ScanLike } from '@/server/store/scanTask';

const buildStore = () =>
    configureStore({ reducer: { backgroundTasks: backgroundTasksReducer } });

const renderWithStore = (initialScan: ScanLike | null) => {
    const store = buildStore();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
        <Provider store={store}>{children}</Provider>
    );
    const view = renderHook(({ scan }: { scan: ScanLike | null }) => useScanBackgroundTask(scan), {
        wrapper,
        initialProps: { scan: initialScan },
    });
    return { store, ...view };
};

describe('useScanBackgroundTask', () => {
    it('does nothing when there is no scan', () => {
        const { store } = renderWithStore(null);
        expect(store.getState().backgroundTasks.tasks).toHaveLength(0);
        expect(store.getState().backgroundTasks.open).toBe(false);
    });

    it('registers an active scan as a scan-type task and opens the panel', () => {
        const { store } = renderWithStore({
            id: 'scan-1',
            projectId: 'proj-1',
            state: 'waiting_for_file',
            progress: 0,
        });
        const tasks = store.getState().backgroundTasks.tasks;
        expect(tasks).toHaveLength(1);
        expect(tasks[0]).toMatchObject({ id: 'scan-1', type: 'scan', status: 'queued' });
        expect(store.getState().backgroundTasks.open).toBe(true);
    });

    it('updates progress on the same task when the scan advances', () => {
        const { store, rerender } = renderWithStore({
            id: 'scan-1',
            projectId: 'proj-1',
            state: 'running',
            progress: 20,
        });
        rerender({ scan: { id: 'scan-1', projectId: 'proj-1', state: 'running', progress: 80 } });
        const tasks = store.getState().backgroundTasks.tasks;
        expect(tasks).toHaveLength(1);
        expect(tasks[0].processed).toBe(80);
    });

    // While the page is up it polls the scan itself, so the
    // app-root tracker must leave it alone; once it is gone the tracker takes
    // the scan back (progress keeps moving on any route).
    it('marks the scan as followed by the page while it is mounted', () => {
        const { store } = renderWithStore({ id: 'scan-1', projectId: 'proj-1', state: 'running', progress: 20 });
        expect(store.getState().backgroundTasks.tasks[0].ownedByPage).toBe(true);
    });

    it('hands the scan back to the tracker when the page goes away', () => {
        const { store, unmount } = renderWithStore({ id: 'scan-1', projectId: 'proj-1', state: 'running', progress: 20 });
        unmount();
        expect(store.getState().backgroundTasks.tasks[0]).toMatchObject({ id: 'scan-1', ownedByPage: false, status: 'running' });
    });

    it('hands the previous scan back when the page moves to another one', () => {
        const { store, rerender } = renderWithStore({ id: 'scan-1', projectId: 'proj-1', state: 'running', progress: 20 });
        rerender({ scan: { id: 'scan-2', projectId: 'proj-1', state: 'running', progress: 5 } });
        const byId = Object.fromEntries(store.getState().backgroundTasks.tasks.map((t) => [t.id, t.ownedByPage]));
        expect(byId).toEqual({ 'scan-1': false, 'scan-2': true });
    });

    it('keeps the scan through its progress ticks, without letting go of it in between', () => {
        const { store, rerender } = renderWithStore({ id: 'scan-1', projectId: 'proj-1', state: 'running', progress: 20 });
        const seen: Array<boolean | undefined> = [];
        const unsubscribe = store.subscribe(() => seen.push(store.getState().backgroundTasks.tasks[0]?.ownedByPage));
        rerender({ scan: { id: 'scan-1', projectId: 'proj-1', state: 'running', progress: 40 } });
        rerender({ scan: { id: 'scan-1', projectId: 'proj-1', state: 'running', progress: 60 } });
        unsubscribe();
        expect(seen.length).toBeGreaterThan(0);
        expect(seen.every((owned) => owned === true)).toBe(true);
    });

    it('lets go of the scan when the page stops showing one', () => {
        const { store, rerender } = renderWithStore({ id: 'scan-1', projectId: 'proj-1', state: 'running', progress: 20 });
        rerender({ scan: null });
        expect(store.getState().backgroundTasks.tasks[0].ownedByPage).toBe(false);
    });

    it('does not register a scan that is already terminal when first seen', () => {
        const { store } = renderWithStore({
            id: 'scan-old',
            projectId: 'proj-1',
            state: 'completed',
            progress: 100,
        });
        expect(store.getState().backgroundTasks.tasks).toHaveLength(0);
        expect(store.getState().backgroundTasks.open).toBe(false);
    });
});
