import { PATH_METADATA } from '@nestjs/common/constants';
import { MeAsyncTasksController } from './me-async-tasks.controller';
import { MeAsyncTasksService } from './me-async-tasks.service';

describe('MeAsyncTasksController route path', () => {
  it('is registered at "me/async-tasks" (no v1 prefix — matches the dashboard call and the REST /me/* convention)', () => {
    // The gateway has no global prefix; v1/ is reserved for realtime SSE
    // controllers. The dashboard calls gatewayAPI.get("/me/async-tasks"), so a
    // "v1/me/async-tasks" controller path 404s the tracker rehydration GET.
    const path = Reflect.getMetadata(PATH_METADATA, MeAsyncTasksController);
    expect(path).toBe('me/async-tasks');
  });
});

describe('MeAsyncTasksController.listAsyncTasks', () => {
  let service: jest.Mocked<MeAsyncTasksService>;
  let controller: MeAsyncTasksController;

  beforeEach(() => {
    service = {
      listAsyncTasks: jest.fn(),
      deleteAsyncTask: jest.fn(),
    } as any;
    controller = new MeAsyncTasksController(service);
  });

  it('calls service.listAsyncTasks with req.user.sub and returns { tasks }', async () => {
    const tasks = [
      {
        taskId: 'task-1',
        type: 'vuln_batch_update',
        status: 'completed',
        total: 10,
        processed: 10,
        succeeded: 8,
        failed: 2,
        projectId: 'proj-1',
        organizationId: 'org-1',
        userId: 'user-abc',
        createdAt: 1700000000000,
        updatedAt: 1700000001000,
        error: '',
        resultUrl: '',
      },
    ];
    service.listAsyncTasks.mockResolvedValue(tasks);

    const req = { user: { sub: 'user-abc' } };
    const result = await controller.listAsyncTasks(req as any);

    expect(service.listAsyncTasks).toHaveBeenCalledWith('user-abc');
    expect(result).toEqual({ tasks });
  });

  it('carries resultUrl from completed autofix task through to the response', async () => {
    const tasks = [
      {
        taskId: 'task-autofix',
        type: 'autofix',
        status: 'completed',
        total: 3,
        processed: 3,
        succeeded: 3,
        failed: 0,
        projectId: 'proj-2',
        organizationId: 'org-2',
        userId: 'user-xyz',
        createdAt: 1700000000000,
        updatedAt: 1700000002000,
        error: '',
        resultUrl: 'https://github.com/org/repo/pull/99',
      },
    ];
    service.listAsyncTasks.mockResolvedValue(tasks);

    const req = { user: { sub: 'user-xyz' } };
    const result = await controller.listAsyncTasks(req as any);

    expect(result.tasks[0]).toMatchObject({
      taskId: 'task-autofix',
      resultUrl: 'https://github.com/org/repo/pull/99',
    });
  });

  it('deleteAsyncTask forwards req.user.sub + taskId to the service', async () => {
    service.deleteAsyncTask.mockResolvedValue(undefined);
    const req = { user: { sub: 'user-abc' } };

    const result = await controller.deleteAsyncTask(req as any, 'task-9');

    expect(service.deleteAsyncTask).toHaveBeenCalledWith('user-abc', 'task-9');
    expect(result).toEqual({ success: true });
  });

  it('returns empty tasks array when no tasks exist for the user', async () => {
    service.listAsyncTasks.mockResolvedValue([]);

    const req = { user: { sub: 'user-abc' } };
    const result = await controller.listAsyncTasks(req as any);

    expect(result).toEqual({ tasks: [] });
  });
});
