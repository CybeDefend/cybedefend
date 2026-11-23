import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { ProjectReportEnqueuer } from './project-report-enqueuer.service';

/**
 * The project-report enqueue: the body ResultController.enqueueReport
 * had, now shared by every project-report handler, core or ee. The cases are
 * those of result.controller.spec.ts "async report generation" that exercised
 * enqueueReport through generateOwaspReport / generateScannerReport.
 */
describe('ProjectReportEnqueuer', () => {
  function makeEnqueuer(overrides: Record<string, any> = {}) {
    const addReportJob = jest.fn().mockResolvedValue('report-id');
    const repo = {
      create: jest.fn((x: any) => x),
      save: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const reportRetention = {
      computeExpiresAtForProject: jest
        .fn()
        .mockResolvedValue({ organizationId: 'org-1', expiresAt: null }),
    };
    const reportQuota = {
      assertWithinQuotaForProject: jest.fn().mockResolvedValue(undefined),
    };
    const asyncTaskStore = {
      create: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    const deps = {
      generatedReportRepo: repo,
      scanQueueService: { addReportJob },
      asyncTaskStore,
      reportRetention,
      reportQuota,
      logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
      ...overrides,
    };
    const enqueuer = new ProjectReportEnqueuer(
      deps.generatedReportRepo as any,
      deps.scanQueueService as any,
      deps.asyncTaskStore as any,
      deps.reportRetention as any,
      deps.reportQuota as any,
      deps.logger as any,
    );
    return {
      enqueuer,
      addReportJob,
      repo,
      reportRetention,
      reportQuota,
      asyncTaskStore,
    };
  }

  it('persists a queued row + enqueues a job, returns the reportId', async () => {
    const { enqueuer, addReportJob, repo } = makeEnqueuer();

    const reportId = await enqueuer.enqueue({
      kind: 'owasp',
      projectId: 'p1',
      format: 'pdf',
      detailed: true,
      branch: 'main',
    });

    expect(typeof reportId).toBe('string');
    expect(reportId.length).toBeGreaterThan(0);
    // The persisted row and the enqueued job share the same id + kind.
    expect(repo.save).toHaveBeenCalledTimes(1);
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        id: reportId,
        kind: 'owasp',
        projectId: 'p1',
        status: 'queued',
        branch: 'main',
      }),
    );
    expect(addReportJob).toHaveBeenCalledWith(
      expect.objectContaining({ reportId, kind: 'owasp' }),
    );
  });

  it('persists organizationId + expiresAt from plan retention', async () => {
    const expiry = new Date('2026-04-01T00:00:00.000Z');
    const reportRetention = {
      computeExpiresAtForProject: jest
        .fn()
        .mockResolvedValue({ organizationId: 'org-9', expiresAt: expiry }),
    };
    const { enqueuer, repo } = makeEnqueuer({ reportRetention });

    const reportId = await enqueuer.enqueue({
      kind: 'owasp',
      projectId: 'p1',
      format: 'pdf',
      detailed: true,
    });

    expect(reportRetention.computeExpiresAtForProject).toHaveBeenCalledWith(
      'p1',
    );
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        id: reportId,
        organizationId: 'org-9',
        expiresAt: expiry,
      }),
    );
  });

  it('with a userId creates a report_generation async task', async () => {
    const { enqueuer, asyncTaskStore } = makeEnqueuer();
    await enqueuer.enqueue({
      kind: 'owasp',
      projectId: 'p1',
      format: 'pdf',
      detailed: true,
      userId: 'u1',
    });
    expect(asyncTaskStore.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'report_generation',
        status: 'queued',
        userId: 'u1',
        projectId: 'p1',
      }),
    );
  });

  it('rolls back the async task when the report enqueue fails', async () => {
    const addReportJob = jest.fn().mockRejectedValue(new Error('redis down'));
    const { enqueuer, asyncTaskStore } = makeEnqueuer({
      scanQueueService: { addReportJob },
    });
    await expect(
      enqueuer.enqueue({
        kind: 'owasp',
        projectId: 'p1',
        format: 'pdf',
        detailed: true,
        userId: 'u1',
      }),
    ).rejects.toMatchObject({ error: { code: status.UNAVAILABLE } });
    expect(asyncTaskStore.delete).toHaveBeenCalled();
  });

  it('refuses (no row, no enqueue) when the org is over quota', async () => {
    const quotaErr = new RpcException({
      code: status.RESOURCE_EXHAUSTED,
      message: 'Report storage limit reached (500/500).',
    });
    const { enqueuer, repo, addReportJob } = makeEnqueuer({
      reportQuota: {
        assertWithinQuotaForProject: jest.fn().mockRejectedValue(quotaErr),
      },
    });

    await expect(
      enqueuer.enqueue({
        kind: 'owasp',
        projectId: 'p1',
        format: 'pdf',
        detailed: true,
      }),
    ).rejects.toBe(quotaErr);
    expect(repo.save).not.toHaveBeenCalled();
    expect(addReportJob).not.toHaveBeenCalled();
  });

  it('carries scannerTypes into the job', async () => {
    const { enqueuer, addReportJob } = makeEnqueuer();

    await enqueuer.enqueue({
      kind: 'scanner_type',
      projectId: 'p1',
      format: 'pdf',
      detailed: true,
      scannerTypes: ['sast', 'sca'],
    });

    expect(addReportJob).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'scanner_type',
        scannerTypes: ['sast', 'sca'],
      }),
    );
  });

  // ----- M2: orphan GeneratedReport when addReportJob fails -----
  it('deletes the persisted GeneratedReport row when addReportJob throws (M2)', async () => {
    const { enqueuer, repo, addReportJob } = makeEnqueuer();
    addReportJob.mockRejectedValueOnce(new Error('redis down'));

    await expect(
      enqueuer.enqueue({
        kind: 'owasp',
        projectId: 'p1',
        format: 'pdf',
        detailed: true,
        branch: 'main',
      }),
    ).rejects.toMatchObject({ error: expect.objectContaining({ code: 14 }) });

    // The row was created/saved first, then deleted on failure to enqueue.
    expect(repo.save).toHaveBeenCalledTimes(1);
    expect(repo.delete).toHaveBeenCalledTimes(1);
    const savedId = (repo.save as jest.Mock).mock.calls[0][0].id;
    expect((repo.delete as jest.Mock).mock.calls[0][0]).toEqual({
      id: savedId,
    });
  });
});
