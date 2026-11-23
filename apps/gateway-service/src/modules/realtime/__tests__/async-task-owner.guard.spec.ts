import {
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AsyncTaskOwnerGuard } from '../async-task-owner.guard';

const makeCtx = (
  params: Record<string, string>,
  userSub: string,
): ExecutionContext => {
  const req = { params, user: { sub: userSub } };
  return {
    switchToHttp: () => ({
      getRequest: () => req,
    }),
  } as unknown as ExecutionContext;
};

describe('AsyncTaskOwnerGuard', () => {
  let redis: { get: jest.Mock };
  let guard: AsyncTaskOwnerGuard;

  beforeEach(() => {
    redis = { get: jest.fn() };
    guard = new AsyncTaskOwnerGuard(redis as any);
  });

  it('returns true when the authenticated user owns the task', async () => {
    const task = { taskId: 'task-1', userId: 'user-abc', status: 'running' };
    redis.get.mockResolvedValue(JSON.stringify(task));

    const ctx = makeCtx({ taskId: 'task-1' }, 'user-abc');
    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);
    expect(redis.get).toHaveBeenCalledWith('cybe:asynctask:task-1');
  });

  it('throws ForbiddenException when the authenticated user is not the owner', async () => {
    const task = { taskId: 'task-1', userId: 'other-user', status: 'running' };
    redis.get.mockResolvedValue(JSON.stringify(task));

    const ctx = makeCtx({ taskId: 'task-1' }, 'user-abc');
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    await expect(guard.canActivate(ctx)).rejects.toThrow(
      'Not the owner of this task',
    );
  });

  it('throws NotFoundException when the task record does not exist in Redis', async () => {
    redis.get.mockResolvedValue(null);

    const ctx = makeCtx({ taskId: 'nonexistent-task' }, 'user-abc');
    await expect(guard.canActivate(ctx)).rejects.toThrow(NotFoundException);
    await expect(guard.canActivate(ctx)).rejects.toThrow(
      'Async task not found',
    );
  });
});
