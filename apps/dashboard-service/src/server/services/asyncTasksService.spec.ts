import { vi, describe, it, expect, beforeEach } from 'vitest';

const mockGet = vi.fn();
vi.mock('../api/gatewayAPI', () => ({
    default: {
        get: (...a: any[]) => mockGet(...a),
    },
}));

import { mapAsyncTaskDto, getMyAsyncTasks } from './asyncTasksService';
import type { AsyncTask } from '../store/backgroundTasksSlice';

describe('asyncTasksService', () => {
    beforeEach(() => {
        mockGet.mockReset();
    });

    describe('mapAsyncTaskDto', () => {
        it('maps taskId to id and copies all relevant fields', () => {
            const dto = {
                taskId: 'abc-123',
                type: 'vuln_batch_update',
                status: 'running' as const,
                total: 50,
                processed: 20,
                succeeded: 18,
                failed: 2,
                projectId: 'proj-1',
                organizationId: 'org-1',
                userId: 'user-1',
                createdAt: '2026-06-01T00:00:00Z',
                updatedAt: '2026-06-01T00:01:00Z',
                error: undefined,
            };
            const result: AsyncTask = mapAsyncTaskDto(dto);
            expect(result.id).toBe('abc-123');
            expect(result.type).toBe('vuln_batch_update');
            expect(result.status).toBe('running');
            expect(result.total).toBe(50);
            expect(result.processed).toBe(20);
            expect(result.succeeded).toBe(18);
            expect(result.failed).toBe(2);
            expect(result.projectId).toBe('proj-1');
            expect(result.error).toBeUndefined();
        });

        it('ignores organizationId, userId, createdAt, updatedAt', () => {
            const dto = {
                taskId: 't1',
                type: 'vuln_batch_update',
                status: 'queued' as const,
                total: 10,
                processed: 0,
                organizationId: 'org-x',
                userId: 'u-x',
                createdAt: 'iso',
                updatedAt: 'iso',
            };
            const result = mapAsyncTaskDto(dto);
            expect((result as any).organizationId).toBeUndefined();
            expect((result as any).userId).toBeUndefined();
            expect((result as any).createdAt).toBeUndefined();
            expect((result as any).updatedAt).toBeUndefined();
        });

        it('maps error string', () => {
            const dto = {
                taskId: 't1',
                type: 'vuln_batch_update',
                status: 'failed' as const,
                total: 5,
                processed: 3,
                error: 'something went wrong',
            };
            const result = mapAsyncTaskDto(dto);
            expect(result.error).toBe('something went wrong');
        });

        it('carries resultUrl when present on the dto', () => {
            const dto = {
                taskId: 't1',
                type: 'autofix',
                status: 'completed' as const,
                total: 1,
                processed: 1,
                resultUrl: 'https://github.com/org/repo/pull/42',
            };
            const result = mapAsyncTaskDto(dto);
            expect(result.resultUrl).toBe('https://github.com/org/repo/pull/42');
        });

        it('omits resultUrl when absent from the dto', () => {
            const dto = {
                taskId: 't1',
                type: 'autofix',
                status: 'completed' as const,
                total: 1,
                processed: 1,
            };
            const result = mapAsyncTaskDto(dto);
            expect((result as any).resultUrl).toBeUndefined();
        });
    });

    describe('getMyAsyncTasks', () => {
        it('GETs /me/async-tasks and maps each dto', async () => {
            const dtos = [
                {
                    taskId: 't1',
                    type: 'vuln_batch_update',
                    status: 'completed',
                    total: 10,
                    processed: 10,
                    succeeded: 10,
                    failed: 0,
                    projectId: 'p1',
                },
                {
                    taskId: 't2',
                    type: 'vuln_batch_update',
                    status: 'queued',
                    total: 5,
                    processed: 0,
                    projectId: 'p2',
                },
            ];
            mockGet.mockResolvedValueOnce({ data: { tasks: dtos } });

            const tasks = await getMyAsyncTasks();

            expect(mockGet).toHaveBeenCalledWith('/me/async-tasks');
            expect(tasks).toHaveLength(2);
            expect(tasks[0].id).toBe('t1');
            expect(tasks[0].status).toBe('completed');
            expect(tasks[1].id).toBe('t2');
            expect(tasks[1].projectId).toBe('p2');
        });

        it('propagates thrown errors', async () => {
            mockGet.mockRejectedValueOnce({ response: { data: { message: 'unauthorized' } } });
            await expect(getMyAsyncTasks()).rejects.toMatchObject({ message: 'unauthorized' });
        });
    });
});
