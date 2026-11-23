import gatewayAPI from '../api/gatewayAPI';
import type { AsyncTask } from '../store/backgroundTasksSlice';

/**
 * Backend DTO shape returned by GET /me/async-tasks.
 * Fields not carried forward to the frontend model are annotated.
 */
export interface AsyncTaskDto {
    taskId: string;
    type: string;
    status: 'queued' | 'running' | 'completed' | 'failed';
    total: number;
    processed: number;
    succeeded?: number;
    failed?: number;
    projectId?: string;
    /** PR/MR URL set by a fix task on completion (the closed AutoFix area enqueues them). */
    resultUrl?: string;
    // not mapped to frontend model:
    organizationId?: string;
    userId?: string;
    createdAt?: string;
    updatedAt?: string;
    error?: string;
}

/**
 * Map a single backend AsyncTaskDto to the frontend AsyncTask shape.
 * Exported so it can be unit-tested independently.
 */
export function mapAsyncTaskDto(dto: AsyncTaskDto): AsyncTask {
    return {
        id: dto.taskId,
        type: dto.type,
        status: dto.status,
        total: dto.total,
        processed: dto.processed,
        ...(dto.succeeded !== undefined && { succeeded: dto.succeeded }),
        ...(dto.failed !== undefined && { failed: dto.failed }),
        ...(dto.projectId !== undefined && { projectId: dto.projectId }),
        ...(dto.error !== undefined && { error: dto.error }),
        ...(dto.resultUrl !== undefined && { resultUrl: dto.resultUrl }),
    };
}

/**
 * Fetch the current user's async tasks for rehydration on app load.
 * GET /me/async-tasks → { tasks: AsyncTaskDto[] }
 */
export async function getMyAsyncTasks(): Promise<AsyncTask[]> {
    try {
        const response = await gatewayAPI.get('/me/async-tasks');
        const { tasks }: { tasks: AsyncTaskDto[] } = response.data;
        return tasks.map(mapAsyncTaskDto);
    } catch (error: any) {
        throw error.response?.data || error;
    }
}

/**
 * Persistently dismiss one of the current user's async tasks so it does not
 * reappear on the next rehydration (page reload).
 * DELETE /me/async-tasks/:taskId
 */
export async function deleteMyAsyncTask(taskId: string): Promise<void> {
    try {
        await gatewayAPI.delete(`/me/async-tasks/${taskId}`);
    } catch (error: any) {
        throw error.response?.data || error;
    }
}
