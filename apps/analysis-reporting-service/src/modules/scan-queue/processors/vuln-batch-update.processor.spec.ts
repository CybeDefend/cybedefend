import { Job } from 'bullmq';
import { VulnBatchUpdateProcessor } from './vuln-batch-update.processor';
import { VulnBatchUpdateJobData } from '../scan-queue.service';

describe('VulnBatchUpdateProcessor', () => {
  let processor: VulnBatchUpdateProcessor;
  let store: {
    update: jest.Mock;
    get: jest.Mock;
    markTerminal: jest.Mock;
  };
  let resultService: { applyBatchUpdate: jest.Mock };
  let realtime: { publish: jest.Mock };
  let orgResolver: { resolveOrgId: jest.Mock };

  const TTL_MS = Number(process.env.ASYNC_TASK_TTL_MS) || 3_600_000;

  const baseData: VulnBatchUpdateJobData = {
    taskId: 'task-001',
    projectId: 'proj-abc',
    userId: 'user-xyz',
    items: Array.from({ length: 100 }, (_, i) => ({
      vulnerabilityId: `vuln-${i}`,
      status: 'to_verify',
    })),
  };

  beforeEach(() => {
    store = {
      update: jest.fn().mockResolvedValue(undefined),
      get: jest.fn().mockResolvedValue(null),
      markTerminal: jest.fn().mockResolvedValue(undefined),
    };

    // By default, applyBatchUpdate calls onProgress once per item (100 items)
    // and resolves with final counts.
    resultService = {
      applyBatchUpdate: jest
        .fn()
        .mockImplementation(
          async (
            _req: unknown,
            onProgress?: (p: {
              processed: number;
              succeeded: number;
              failed: number;
            }) => void | Promise<void>,
          ) => {
            for (let i = 1; i <= 100; i++) {
              await onProgress?.({
                processed: i,
                succeeded: i - 2 < 0 ? 0 : i - 2,
                failed: Math.min(i, 2),
              });
            }
            return {
              projectId: 'proj-abc',
              totalCount: 100,
              successCount: 98,
              failureCount: 2,
              results: [],
            };
          },
        ),
    };

    realtime = { publish: jest.fn().mockResolvedValue(undefined) };
    orgResolver = {
      resolveOrgId: jest.fn().mockResolvedValue('org-999'),
    };

    processor = new VulnBatchUpdateProcessor(
      store as any,
      resultService as any,
      realtime as any,
      orgResolver as any,
    );
  });

  const makeJob = (data: VulnBatchUpdateJobData): Job<VulnBatchUpdateJobData> =>
    ({ id: 'job-1', data }) as unknown as Job<VulnBatchUpdateJobData>;

  // ---------------------------------------------------------------------------
  // Happy path
  // ---------------------------------------------------------------------------

  it('marks the task running at the start of processing', async () => {
    await processor.process(makeJob(baseData));

    expect(store.update).toHaveBeenCalledWith('task-001', {
      status: 'running',
    });
  });

  it('calls applyBatchUpdate with the correct request shape', async () => {
    await processor.process(makeJob(baseData));

    expect(resultService.applyBatchUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'proj-abc',
        userId: 'user-xyz',
        items: baseData.items,
      }),
      expect.any(Function),
    );
  });

  it('publishes ASYNC_TASK_PROGRESS only on decile boundaries (≤10 progress events)', async () => {
    await processor.process(makeJob(baseData));

    const progressCalls = realtime.publish.mock.calls.filter(
      ([env]) => env.type === 'ASYNC_TASK_PROGRESS',
    );
    expect(progressCalls.length).toBeGreaterThan(0);
    expect(progressCalls.length).toBeLessThanOrEqual(10);
  });

  it('progress events carry increasing processed counts', async () => {
    await processor.process(makeJob(baseData));

    const progressCalls = realtime.publish.mock.calls
      .filter(([env]) => env.type === 'ASYNC_TASK_PROGRESS')
      .map(([env]) => env.payload.asyncTask.processed as number);

    for (let i = 1; i < progressCalls.length; i++) {
      expect(progressCalls[i]).toBeGreaterThan(progressCalls[i - 1]);
    }
  });

  it('publishes exactly one ASYNC_TASK_COMPLETED(completed) with correct counts', async () => {
    await processor.process(makeJob(baseData));

    const completedCalls = realtime.publish.mock.calls.filter(
      ([env]) => env.type === 'ASYNC_TASK_COMPLETED',
    );
    expect(completedCalls).toHaveLength(1);

    const env = completedCalls[0][0];
    expect(env.payload.asyncTask).toMatchObject({
      taskId: 'task-001',
      type: 'vuln_batch_update',
      status: 'completed',
      total: 100,
      processed: 100,
      succeeded: 98,
      failed: 2,
    });
  });

  it('calls markTerminal once with status completed and ttlMs', async () => {
    await processor.process(makeJob(baseData));

    expect(store.markTerminal).toHaveBeenCalledTimes(1);
    expect(store.markTerminal).toHaveBeenCalledWith(
      'task-001',
      expect.objectContaining({ status: 'completed' }),
      TTL_MS,
    );
  });

  it('scope carries jobId, userId, projectId and organizationId', async () => {
    await processor.process(makeJob(baseData));

    const completedEnv = realtime.publish.mock.calls.find(
      ([env]) => env.type === 'ASYNC_TASK_COMPLETED',
    )?.[0];

    expect(completedEnv.scope).toMatchObject({
      jobId: 'task-001',
      userId: 'user-xyz',
      projectId: 'proj-abc',
      organizationId: 'org-999',
    });
  });

  it('payload is under payload.asyncTask with correct shape', async () => {
    await processor.process(makeJob(baseData));

    const completedEnv = realtime.publish.mock.calls.find(
      ([env]) => env.type === 'ASYNC_TASK_COMPLETED',
    )?.[0];

    expect(completedEnv.payload).toHaveProperty('asyncTask');
    expect(completedEnv.payload.asyncTask).not.toHaveProperty('error');
  });

  it('publishes with projectId-only scope when org resolution fails', async () => {
    // Reject for all calls (there are 2 publish() calls in the success path:
    // one per progress decile boundary + one for COMPLETED).
    orgResolver.resolveOrgId.mockRejectedValue(new Error('grpc down'));

    await processor.process(makeJob(baseData));

    const completedEnv = realtime.publish.mock.calls.find(
      ([env]) => env.type === 'ASYNC_TASK_COMPLETED',
    )?.[0];

    expect(completedEnv.scope).not.toHaveProperty('organizationId');
    expect(completedEnv.scope).toMatchObject({
      jobId: 'task-001',
      userId: 'user-xyz',
      projectId: 'proj-abc',
    });
  });

  // ---------------------------------------------------------------------------
  // Failure path
  // ---------------------------------------------------------------------------

  it('failure: markTerminal(failed) + publishes ASYNC_TASK_COMPLETED(failed), does NOT throw', async () => {
    resultService.applyBatchUpdate.mockRejectedValueOnce(
      new Error('db connection lost'),
    );

    await expect(processor.process(makeJob(baseData))).resolves.toBeUndefined();

    expect(store.markTerminal).toHaveBeenCalledWith(
      'task-001',
      expect.objectContaining({
        status: 'failed',
        error: 'db connection lost',
      }),
      TTL_MS,
    );

    const completedCalls = realtime.publish.mock.calls.filter(
      ([env]) => env.type === 'ASYNC_TASK_COMPLETED',
    );
    expect(completedCalls).toHaveLength(1);
    expect(completedCalls[0][0].payload.asyncTask).toMatchObject({
      status: 'failed',
      error: 'db connection lost',
    });
  });

  it('failure: does not call markTerminal(completed) when applyBatchUpdate throws', async () => {
    resultService.applyBatchUpdate.mockRejectedValueOnce(new Error('boom'));

    await processor.process(makeJob(baseData));

    const completedCalls = realtime.publish.mock.calls.filter(
      ([env]) =>
        env.type === 'ASYNC_TASK_COMPLETED' &&
        env.payload.asyncTask.status === 'completed',
    );
    expect(completedCalls).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // onFailed (queue-level stall)
  // ---------------------------------------------------------------------------

  describe('onFailed (queue-level failure)', () => {
    it('flips a queued/running task to failed and publishes', async () => {
      store.get.mockResolvedValueOnce({
        taskId: 'task-001',
        status: 'running',
        userId: 'user-xyz',
        projectId: 'proj-abc',
        total: 100,
        processed: 40,
        succeeded: 38,
        failed: 2,
        type: 'vuln_batch_update',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      await processor.onFailed(
        makeJob(baseData),
        new Error('job stalled more than allowable limit'),
      );

      expect(store.markTerminal).toHaveBeenCalledWith(
        'task-001',
        expect.objectContaining({ status: 'failed' }),
        TTL_MS,
      );

      const env = realtime.publish.mock.calls[0][0];
      expect(env.type).toBe('ASYNC_TASK_COMPLETED');
      expect(env.payload.asyncTask.status).toBe('failed');
    });

    it('does not flip when the task is already terminal (completed)', async () => {
      store.get.mockResolvedValueOnce({
        taskId: 'task-001',
        status: 'completed',
        userId: 'user-xyz',
        projectId: 'proj-abc',
        total: 100,
        processed: 100,
        succeeded: 100,
        failed: 0,
        type: 'vuln_batch_update',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      await processor.onFailed(makeJob(baseData), new Error('late stall'));

      expect(store.markTerminal).not.toHaveBeenCalled();
      expect(realtime.publish).not.toHaveBeenCalled();
    });

    it('does nothing when no taskId in job data', async () => {
      const jobNoTask = makeJob({ ...baseData, taskId: '' });

      await processor.onFailed(jobNoTask, new Error('boom'));

      expect(store.get).not.toHaveBeenCalled();
      expect(realtime.publish).not.toHaveBeenCalled();
    });

    it('does nothing when job is undefined', async () => {
      await processor.onFailed(undefined, new Error('boom'));

      expect(store.get).not.toHaveBeenCalled();
      expect(realtime.publish).not.toHaveBeenCalled();
    });

    it('never throws when markTerminal fails', async () => {
      store.get.mockResolvedValueOnce({
        taskId: 'task-001',
        status: 'queued',
        userId: 'user-xyz',
        projectId: 'proj-abc',
        total: 10,
        processed: 0,
        succeeded: 0,
        failed: 0,
        type: 'vuln_batch_update',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      store.markTerminal.mockRejectedValueOnce(new Error('redis down'));

      await expect(
        processor.onFailed(makeJob(baseData), new Error('stalled')),
      ).resolves.toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Agent fields forwarded
  // ---------------------------------------------------------------------------

  it('forwards agent fields to applyBatchUpdate', async () => {
    const dataWithAgent: VulnBatchUpdateJobData = {
      ...baseData,
      agentToolCallId: 'tool-1',
      agentConversationId: 'conv-1',
      agentStreamId: 'stream-1',
    };

    await processor.process(makeJob(dataWithAgent));

    expect(resultService.applyBatchUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        agentToolCallId: 'tool-1',
        agentConversationId: 'conv-1',
        agentStreamId: 'stream-1',
      }),
      expect.any(Function),
    );
  });

  // ---------------------------------------------------------------------------
  // Decile throttle — single item (edge case)
  // ---------------------------------------------------------------------------

  it('single item: emits one progress publish and one completed publish', async () => {
    const singleItem: VulnBatchUpdateJobData = {
      ...baseData,
      items: [{ vulnerabilityId: 'vuln-only', status: 'resolved' }],
    };

    resultService.applyBatchUpdate.mockImplementationOnce(
      async (
        _req: unknown,
        onProgress?: (p: {
          processed: number;
          succeeded: number;
          failed: number;
        }) => void | Promise<void>,
      ) => {
        await onProgress?.({ processed: 1, succeeded: 1, failed: 0 });
        return {
          projectId: 'proj-abc',
          totalCount: 1,
          successCount: 1,
          failureCount: 0,
          results: [],
        };
      },
    );

    await processor.process(makeJob(singleItem));

    const progressCalls = realtime.publish.mock.calls.filter(
      ([env]) => env.type === 'ASYNC_TASK_PROGRESS',
    );
    const completedCalls = realtime.publish.mock.calls.filter(
      ([env]) => env.type === 'ASYNC_TASK_COMPLETED',
    );

    // decile math: processed=1, total=1 → floor(10/10 * 10) = 10 > lastDecile=0 → one publish
    expect(progressCalls).toHaveLength(1);
    expect(completedCalls).toHaveLength(1);
  });
});
