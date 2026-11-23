import { vi, describe, it, expect, beforeEach } from 'vitest';

// The autofix thunks live in the closed tree, with their specs.

// ── mock resultService ────────────────────────────────────────────────────────
const mockBatchUpdateVulnerabilities = vi.fn();
vi.mock('../services/resultService', () => ({
    batchUpdateVulnerabilities: (...a: any[]) => mockBatchUpdateVulnerabilities(...a),
}));

// ── mock asyncTasksService ────────────────────────────────────────────────────
const mockGetMyAsyncTasks = vi.fn();
vi.mock('../services/asyncTasksService', () => ({
    getMyAsyncTasks: (...a: any[]) => mockGetMyAsyncTasks(...a),
}));

import { configureStore } from '@reduxjs/toolkit';
import backgroundTasksReducer from './backgroundTasksSlice';
import {
    startBatchUpdate,
    startReportGeneration,
} from './backgroundTasksThunks';

// ── helpers ───────────────────────────────────────────────────────────────────

const buildStore = () =>
    configureStore({ reducer: { backgroundTasks: backgroundTasksReducer } });

// ── tests ─────────────────────────────────────────────────────────────────────

describe('startBatchUpdate thunk (existing)', () => {
    beforeEach(() => {
        mockBatchUpdateVulnerabilities.mockReset();
    });

    it('POSTs via resultService and dispatches addTask with type vuln_batch_update', async () => {
        mockBatchUpdateVulnerabilities.mockResolvedValueOnce({ taskId: 'tu-1', total: 20 });
        const store = buildStore();
        const taskId = await store.dispatch(startBatchUpdate('proj-1', {} as any));
        expect(mockBatchUpdateVulnerabilities).toHaveBeenCalledWith('proj-1', {});
        expect(taskId).toBe('tu-1');
        const tasks = store.getState().backgroundTasks.tasks;
        expect(tasks).toHaveLength(1);
        expect(tasks[0]).toMatchObject({
            id: 'tu-1',
            type: 'vuln_batch_update',
            status: 'queued',
            total: 20,
            processed: 0,
            projectId: 'proj-1',
        });
    });
});

describe('startReportGeneration thunk', () => {
    beforeEach(() => {
        mockGetMyAsyncTasks.mockReset();
    });

    it('runs the generation then hydrates the widget with the report task', async () => {
        const generate = vi.fn().mockResolvedValue({ reportId: 'r1', status: 'queued' });
        mockGetMyAsyncTasks.mockResolvedValueOnce([
            {
                id: 'task-r1',
                type: 'report_generation',
                status: 'queued',
                total: 1,
                processed: 0,
            },
        ]);
        const store = buildStore();

        await store.dispatch(startReportGeneration(generate));

        expect(generate).toHaveBeenCalledTimes(1);
        const tasks = store.getState().backgroundTasks.tasks;
        expect(tasks).toHaveLength(1);
        expect(tasks[0]).toMatchObject({ id: 'task-r1', type: 'report_generation' });
    });

    it('propagates generation errors and does not hydrate', async () => {
        const generate = vi.fn().mockRejectedValue(new Error('quota'));
        const store = buildStore();

        await expect(
            store.dispatch(startReportGeneration(generate)),
        ).rejects.toThrow('quota');
        expect(mockGetMyAsyncTasks).not.toHaveBeenCalled();
    });
});

