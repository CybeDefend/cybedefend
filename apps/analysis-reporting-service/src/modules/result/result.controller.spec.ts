import { ResultController } from './result.controller';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { DataPurgeService } from '../data-purge/data-purge.service';
import { ProjectReportEnqueuer } from '../reports/shared/project-report-enqueuer.service';
import { ScannerCallGuard } from '../../core/scanner-auth/scanner-call.guard';

/**
 * Focused spec for ResultController.notifySecurityContextUpdated. The
 * controller has many dependencies but this RPC only touches the result
 * cache invalidator, the CVSS recalc queue, and the logger — so we stub
 * only what's needed and instantiate the controller via Object.create()
 * to bypass NestJS DI for this unit test.
 */
function makeController(
  invalidateSecurityContextCache: jest.Mock,
  cvssRecalcQueueAdd: jest.Mock,
): any {
  const controller = Object.create(ResultController.prototype);
  Object.assign(controller, {
    resultService: { invalidateSecurityContextCache },
    cvssRecalcQueue: { add: cvssRecalcQueueAdd },
    cyberiskEnqueuer: { enqueue: jest.fn().mockResolvedValue(undefined) },
    organizationStatisticsService: {
      markDirtyForProject: jest.fn().mockResolvedValue(undefined),
    },
    logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
  });
  return controller;
}

describe('ResultController.notifySecurityContextUpdated', () => {
  it('enqueues a recalculate job with a deterministic jobId per project', async () => {
    const invalidate = jest.fn();
    const add = jest.fn().mockResolvedValue({ id: 'job-1' });
    const controller = makeController(invalidate, add);

    await controller.notifySecurityContextUpdated({ projectId: 'proj-1' });

    expect(invalidate).toHaveBeenCalledWith('proj-1');
    expect(add).toHaveBeenCalledTimes(1);
    const [name, payload, opts] = add.mock.calls[0];
    expect(name).toBe('recalculate');
    expect(payload).toEqual({
      projectId: 'proj-1',
      trigger: 'context_change',
    });
    expect(opts.jobId).toBe('cvss-recalc:proj-1:context-change');
  });

  it('configures retries with exponential backoff and immediate cleanup', async () => {
    const add = jest.fn().mockResolvedValue({ id: 'job-1' });
    const controller = makeController(jest.fn(), add);

    await controller.notifySecurityContextUpdated({ projectId: 'proj-1' });

    const [, , opts] = add.mock.calls[0];
    expect(opts.attempts).toBe(3);
    expect(opts.backoff).toEqual({ type: 'exponential', delay: 5000 });
    expect(opts.removeOnComplete).toBe(true);
  });

  it('collapses spam-clicks of "Save security context" via the deterministic jobId', async () => {
    const add = jest.fn().mockResolvedValue({ id: 'job-1' });
    const controller = makeController(jest.fn(), add);

    await controller.notifySecurityContextUpdated({ projectId: 'proj-1' });
    await controller.notifySecurityContextUpdated({ projectId: 'proj-1' });

    expect(add).toHaveBeenCalledTimes(2);
    expect(add.mock.calls[0][2].jobId).toBe(
      'cvss-recalc:proj-1:context-change',
    );
    expect(add.mock.calls[1][2].jobId).toBe(
      'cvss-recalc:proj-1:context-change',
    );
  });

  it('uses a distinct jobId per project so independent saves do not collide', async () => {
    const add = jest.fn().mockResolvedValue({ id: 'job-1' });
    const controller = makeController(jest.fn(), add);

    await controller.notifySecurityContextUpdated({ projectId: 'proj-1' });
    await controller.notifySecurityContextUpdated({ projectId: 'proj-2' });

    expect(add.mock.calls[0][2].jobId).toBe(
      'cvss-recalc:proj-1:context-change',
    );
    expect(add.mock.calls[1][2].jobId).toBe(
      'cvss-recalc:proj-2:context-change',
    );
  });

  // The cyberisk recompute must NOT depend on the CVSS worker job
  // being consumed successfully (which can early-return on a null context or
  // throw on a recalc error). Enqueue it directly here, mirroring scan_complete,
  // so a security-context change always recomputes the score.
  it('enqueues a cyberisk recompute directly with the security_context_update trigger', async () => {
    const add = jest.fn().mockResolvedValue({ id: 'job-1' });
    const controller = makeController(jest.fn(), add);

    await controller.notifySecurityContextUpdated({ projectId: 'proj-1' });

    expect(controller.cyberiskEnqueuer.enqueue).toHaveBeenCalledWith(
      'proj-1',
      'security_context_update',
    );
  });
});

/**
 * Spec for ResultController.recomputeCyberRisk. This RPC only delegates to the
 * CyberiskRecomputeEnqueuer, so we stub just that dependency and instantiate
 * the controller via Object.create() to bypass NestJS DI.
 */
function makeRecomputeController(enqueue: jest.Mock): any {
  const controller = Object.create(ResultController.prototype);
  Object.assign(controller, {
    cyberiskEnqueuer: { enqueue },
    organizationStatisticsService: {
      markDirtyForProject: jest.fn().mockResolvedValue(undefined),
    },
    logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
  });
  return controller;
}

describe('ResultController.recomputeCyberRisk', () => {
  it('defaults to the "manual" trigger and enqueues, returning { enqueued: true }', async () => {
    const enqueue = jest.fn().mockResolvedValue(undefined);
    const controller = makeRecomputeController(enqueue);

    const result = await controller.recomputeCyberRisk({
      projectId: 'proj-1',
      trigger: 'something-else',
    });

    expect(enqueue).toHaveBeenCalledWith('proj-1', 'manual');
    expect(result).toEqual({ enqueued: true });
  });

  it('forwards the "backfill" trigger and enqueues, returning { enqueued: true }', async () => {
    const enqueue = jest.fn().mockResolvedValue(undefined);
    const controller = makeRecomputeController(enqueue);

    const result = await controller.recomputeCyberRisk({
      projectId: 'proj-2',
      trigger: 'backfill',
    });

    expect(enqueue).toHaveBeenCalledWith('proj-2', 'backfill');
    expect(result).toEqual({ enqueued: true });
  });

  // Global-management fires this RPC with the dedicated
  // 'reference_branch_update' trigger when a project's reference branch changes;
  // it must be forwarded verbatim (not collapsed to 'manual') for observability.
  it('forwards the "reference_branch_update" trigger and enqueues', async () => {
    const enqueue = jest.fn().mockResolvedValue(undefined);
    const controller = makeRecomputeController(enqueue);

    const result = await controller.recomputeCyberRisk({
      projectId: 'proj-3',
      trigger: 'reference_branch_update',
    });

    expect(enqueue).toHaveBeenCalledWith('proj-3', 'reference_branch_update');
    expect(result).toEqual({ enqueued: true });
  });
});

describe('ResultController.backfillCyberRisk', () => {
  it('enqueues a backfill recompute for every project and returns the count', async () => {
    const enqueue = jest.fn().mockResolvedValue(undefined);
    const controller = makeRecomputeController(enqueue);

    const result = await controller.backfillCyberRisk({
      projectIds: ['a', 'b', 'c'],
    });

    expect(enqueue).toHaveBeenCalledWith('a', 'backfill');
    expect(enqueue).toHaveBeenCalledWith('b', 'backfill');
    expect(enqueue).toHaveBeenCalledWith('c', 'backfill');
    expect(enqueue).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ enqueued: 3 });
  });

  it('returns { enqueued: 0 } for an empty project list', async () => {
    const enqueue = jest.fn().mockResolvedValue(undefined);
    const controller = makeRecomputeController(enqueue);

    const result = await controller.backfillCyberRisk({ projectIds: [] });

    expect(enqueue).not.toHaveBeenCalled();
    expect(result).toEqual({ enqueued: 0 });
  });
});

describe('ResultController async report generation', () => {
  function makeReportController(overrides: Record<string, any> = {}): any {
    const controller = Object.create(ResultController.prototype);
    const addReportJob = jest.fn().mockResolvedValue('report-id');
    const repo = {
      create: jest.fn((x: any) => x),
      save: jest.fn().mockResolvedValue(undefined),
      findOne: jest.fn(),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
    };
    const reportUpload = {
      signExisting: jest.fn(),
      deleteReport: jest.fn().mockResolvedValue(undefined),
    };
    const reportRetention = {
      computeExpiresAtForProject: jest
        .fn()
        .mockResolvedValue({ organizationId: 'org-1', expiresAt: null }),
      computeExpiresAtForOrg: jest.fn().mockResolvedValue(null),
    };
    const reportQuota = {
      assertWithinQuotaForProject: jest.fn().mockResolvedValue(undefined),
      assertWithinQuotaForOrg: jest.fn().mockResolvedValue(undefined),
      getUsageForOrg: jest.fn().mockResolvedValue({ used: 7, limit: 500 }),
      getUsageForProject: jest.fn().mockResolvedValue({ used: 7, limit: 500 }),
    };
    const asyncTaskStore = {
      create: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    Object.assign(controller, {
      scanQueueService: { addReportJob },
      generatedReportRepo: repo,
      reportUpload,
      reportRetention,
      reportQuota,
      asyncTaskStore,
      logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
      ...overrides,
    });
    // enqueueReport moved to ProjectReportEnqueuer; it is built on
    // the controller's own (possibly overridden) collaborators.
    controller.projectReportEnqueuer = new ProjectReportEnqueuer(
      controller.generatedReportRepo,
      controller.scanQueueService,
      controller.asyncTaskStore,
      controller.reportRetention,
      controller.reportQuota,
      controller.logger,
    );
    return {
      controller,
      addReportJob,
      repo,
      reportUpload,
      reportRetention,
      reportQuota,
      asyncTaskStore,
    };
  }

  it('getReportUsage returns the org-wide shared usage for an organization', async () => {
    const { controller, reportQuota } = makeReportController();
    reportQuota.getUsageForOrg.mockResolvedValue({ used: 9, limit: 500 });

    const res = await controller.getReportUsage({ organizationId: 'org-1' });

    expect(reportQuota.getUsageForOrg).toHaveBeenCalledWith('org-1');
    expect(res).toEqual({ used: 9, limit: 500 });
  });

  it('getReportUsage resolves the org from a projectId (same shared pool)', async () => {
    const { controller, reportQuota } = makeReportController();
    reportQuota.getUsageForProject.mockResolvedValue({ used: 9, limit: 500 });

    const res = await controller.getReportUsage({ projectId: 'p1' });

    expect(reportQuota.getUsageForProject).toHaveBeenCalledWith('p1');
    expect(res).toEqual({ used: 9, limit: 500 });
  });

  it('getReportUsage rejects INVALID_ARGUMENT when neither id is given', async () => {
    const { controller } = makeReportController();
    await expect(controller.getReportUsage({})).rejects.toMatchObject({
      error: { code: status.INVALID_ARGUMENT },
    });
  });

  it('generateOwaspReport persists a queued row + enqueues a job, returns reportId/status', async () => {
    const { controller, addReportJob, repo } = makeReportController();

    const res = await controller.generateOwaspReport({
      projectId: 'p1',
      format: 'pdf',
      detailed: true,
      branch: 'main',
    });

    expect(res.status).toBe('queued');
    expect(typeof res.reportId).toBe('string');
    expect(res.reportId.length).toBeGreaterThan(0);
    expect(res.downloadUrl).toBe('');
    // The persisted row and the enqueued job share the same id + kind.
    expect(repo.save).toHaveBeenCalledTimes(1);
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        id: res.reportId,
        kind: 'owasp',
        projectId: 'p1',
        status: 'queued',
        branch: 'main',
      }),
    );
    expect(addReportJob).toHaveBeenCalledWith(
      expect.objectContaining({ reportId: res.reportId, kind: 'owasp' }),
    );
  });

  it('generateOwaspReport persists organizationId + expiresAt from plan retention', async () => {
    const expiry = new Date('2026-04-01T00:00:00.000Z');
    const reportRetention = {
      computeExpiresAtForProject: jest
        .fn()
        .mockResolvedValue({ organizationId: 'org-9', expiresAt: expiry }),
    };
    const { controller, repo } = makeReportController({ reportRetention });

    const res = await controller.generateOwaspReport({
      projectId: 'p1',
      format: 'pdf',
      detailed: true,
    });

    expect(reportRetention.computeExpiresAtForProject).toHaveBeenCalledWith(
      'p1',
    );
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        id: res.reportId,
        organizationId: 'org-9',
        expiresAt: expiry,
      }),
    );
  });

  it('generateOwaspReport with a userId creates a report_generation async task', async () => {
    const { controller, asyncTaskStore } = makeReportController();
    await controller.generateOwaspReport({
      projectId: 'p1',
      format: 'pdf',
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
    const { controller, asyncTaskStore } = makeReportController({
      scanQueueService: { addReportJob },
    });
    await expect(
      controller.generateOwaspReport({
        projectId: 'p1',
        format: 'pdf',
        userId: 'u1',
      }),
    ).rejects.toMatchObject({ error: { code: status.UNAVAILABLE } });
    expect(asyncTaskStore.delete).toHaveBeenCalled();
  });

  it('generateOwaspReport refuses (no row, no enqueue) when the org is over quota', async () => {
    const quotaErr = new RpcException({
      code: status.RESOURCE_EXHAUSTED,
      message: 'Report storage limit reached (500/500).',
    });
    const { controller, repo, addReportJob } = makeReportController({
      reportQuota: {
        assertWithinQuotaForProject: jest.fn().mockRejectedValue(quotaErr),
        assertWithinQuotaForOrg: jest.fn().mockResolvedValue(undefined),
      },
    });

    await expect(
      controller.generateOwaspReport({ projectId: 'p1', format: 'pdf' }),
    ).rejects.toBe(quotaErr);
    expect(repo.save).not.toHaveBeenCalled();
    expect(addReportJob).not.toHaveBeenCalled();
  });

  it('listGeneratedReports returns a paginated, newest-first, expiry-filtered page', async () => {
    const { controller, repo } = makeReportController();
    repo.findAndCount.mockResolvedValue([
      [
        {
          id: 'r1',
          kind: 'owasp',
          format: 'pdf',
          status: 'ready',
          filename: 'owasp.pdf',
          branch: 'main',
          createdAt: new Date('2026-03-01T00:00:00Z'),
          expiresAt: new Date('2026-06-01T00:00:00Z'),
        },
      ],
      1,
    ]);

    const res = await controller.listGeneratedReports({
      projectId: 'p1',
      page: 1,
      pageSize: 20,
    });

    expect(res.total).toBe(1);
    expect(res.items[0]).toMatchObject({ reportId: 'r1', kind: 'owasp' });
    const arg = repo.findAndCount.mock.calls[0][0];
    expect(arg.order).toEqual({ createdAt: 'DESC' });
    expect(Array.isArray(arg.where)).toBe(true); // expiry OR (null / > now)
    expect(arg.where[0]).toMatchObject({ projectId: 'p1' });
    expect(arg.take).toBe(20);
  });

  it('deleteGeneratedReport removes the GCS object then the row, frees the slot', async () => {
    const { controller, repo, reportUpload } = makeReportController({
      reportRetention: {},
      reportQuota: {},
    });
    repo.findOne.mockResolvedValue({
      id: 'r1',
      projectId: 'p1',
      objectPath: 'reports/p1/r1.pdf',
    });

    const res = await controller.deleteGeneratedReport({
      projectId: 'p1',
      reportId: 'r1',
    });

    expect(res.success).toBe(true);
    expect(reportUpload.deleteReport).toHaveBeenCalledWith(
      'reports/p1/r1.pdf',
      'p1',
    );
    expect(repo.delete).toHaveBeenCalledWith({ id: 'r1', projectId: 'p1' });
  });

  it('deleteGeneratedReport is NOT_FOUND for an unknown / other-project id', async () => {
    const { controller, repo, reportUpload } = makeReportController();
    repo.findOne.mockResolvedValue(null);

    await expect(
      controller.deleteGeneratedReport({ projectId: 'p1', reportId: 'nope' }),
    ).rejects.toMatchObject({ error: { code: status.NOT_FOUND } });
    expect(reportUpload.deleteReport).not.toHaveBeenCalled();
    expect(repo.delete).not.toHaveBeenCalled();
  });

  it('deleteGeneratedReport deletes the row even with no objectPath (never uploaded)', async () => {
    const { controller, repo, reportUpload } = makeReportController();
    repo.findOne.mockResolvedValue({
      id: 'r1',
      projectId: 'p1',
      objectPath: null,
    });

    const res = await controller.deleteGeneratedReport({
      projectId: 'p1',
      reportId: 'r1',
    });
    expect(res.success).toBe(true);
    expect(reportUpload.deleteReport).not.toHaveBeenCalled();
    expect(repo.delete).toHaveBeenCalledWith({ id: 'r1', projectId: 'p1' });
  });

  // The generateScannerReport case moved to a closed spec with the handler.

  it('getGeneratedReport returns a fresh signed URL when ready', async () => {
    const { controller, repo, reportUpload } = makeReportController();
    repo.findOne.mockResolvedValue({
      id: 'rep-1',
      projectId: 'p1',
      kind: 'owasp',
      format: 'pdf',
      filename: 'owasp.pdf',
      contentType: 'application/pdf',
      objectPath: 'reports/p1/owasp.pdf',
      status: 'ready',
      error: null,
    });
    reportUpload.signExisting.mockResolvedValue({
      downloadUrl: 'https://signed/fresh',
      expiresAtMs: 123,
    });

    const res = await controller.getGeneratedReport({
      projectId: 'p1',
      reportId: 'rep-1',
    });

    expect(reportUpload.signExisting).toHaveBeenCalledWith({
      projectId: 'p1',
      objectPath: 'reports/p1/owasp.pdf',
      filename: 'owasp.pdf',
    });
    expect(res).toMatchObject({
      reportId: 'rep-1',
      status: 'ready',
      downloadUrl: 'https://signed/fresh',
      expiresAtMs: 123,
    });
  });

  it('getGeneratedReport surfaces the error for a failed report (no signing)', async () => {
    const { controller, repo, reportUpload } = makeReportController();
    repo.findOne.mockResolvedValue({
      id: 'rep-2',
      projectId: 'p1',
      kind: 'cwe',
      format: 'pdf',
      filename: null,
      contentType: null,
      objectPath: null,
      status: 'failed',
      error: 'puppeteer crashed',
    });

    const res = await controller.getGeneratedReport({
      projectId: 'p1',
      reportId: 'rep-2',
    });

    expect(res.status).toBe('failed');
    expect(res.error).toBe('puppeteer crashed');
    expect(res.downloadUrl).toBe('');
    expect(reportUpload.signExisting).not.toHaveBeenCalled();
  });

  it('getGeneratedReport returns queued status without signing while in-flight', async () => {
    const { controller, repo, reportUpload } = makeReportController();
    repo.findOne.mockResolvedValue({
      id: 'rep-3',
      projectId: 'p1',
      kind: 'owasp',
      format: 'pdf',
      filename: null,
      contentType: null,
      objectPath: null,
      status: 'queued',
      error: null,
    });

    const res = await controller.getGeneratedReport({
      projectId: 'p1',
      reportId: 'rep-3',
    });

    expect(res.status).toBe('queued');
    expect(res.downloadUrl).toBe('');
    expect(reportUpload.signExisting).not.toHaveBeenCalled();
  });

  it('getGeneratedReport throws NOT_FOUND when the report is unknown', async () => {
    const { controller, repo } = makeReportController();
    repo.findOne.mockResolvedValue(null);

    await expect(
      controller.getGeneratedReport({ projectId: 'p1', reportId: 'nope' }),
    ).rejects.toMatchObject({ error: expect.objectContaining({ code: 5 }) });
  });

  // ----- M2: orphan GeneratedReport when addReportJob fails -----
  it('deletes the persisted GeneratedReport row when addReportJob throws (M2)', async () => {
    const { controller, repo, addReportJob } = makeReportController();
    // Spy on delete so the spec asserts the rollback explicitly.
    repo.delete = jest.fn().mockResolvedValue({ affected: 1, raw: {} });

    addReportJob.mockRejectedValueOnce(new Error('redis down'));

    await expect(
      controller.generateOwaspReport({
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

  // ----- getGeneratedReport cross-project objectPath defense -----
  it('refuses to sign a report whose objectPath does not start with reports/<projectId>/', async () => {
    const { controller, repo, reportUpload } = makeReportController();
    // Crafted row that somehow ended up in projectId=p1 but points to p2's object path.
    repo.findOne.mockResolvedValue({
      id: 'rep-x',
      projectId: 'p1',
      kind: 'owasp',
      format: 'pdf',
      filename: 'owasp.pdf',
      contentType: 'application/pdf',
      objectPath: 'reports/p2/owasp.pdf',
      status: 'ready',
      error: null,
    });

    await expect(
      controller.getGeneratedReport({ projectId: 'p1', reportId: 'rep-x' }),
    ).rejects.toMatchObject({
      // status.INTERNAL = 13
      error: expect.objectContaining({ code: 13 }),
    });
    expect(reportUpload.signExisting).not.toHaveBeenCalled();
  });
});

/**
 * Spec for ResultController.getScaFilterOptions. Only touches scaService, so
 * we stub just that dependency and instantiate via Object.create().
 */
function makeScaFilterController(getScaFilterOptions: jest.Mock): any {
  const controller = Object.create(ResultController.prototype);
  Object.assign(controller, {
    scaService: { getScaFilterOptions },
    logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
  });
  return controller;
}

describe('ResultController.getScaFilterOptions', () => {
  it('delegates to scaService.getScaFilterOptions and returns its result', async () => {
    const mockResponse = {
      ecosystems: ['npm'],
      fileNames: ['package.json'],
    };
    const getScaFilterOptions = jest.fn().mockResolvedValue(mockResponse);
    const controller = makeScaFilterController(getScaFilterOptions);

    const result = await controller.getScaFilterOptions({ projectId: 'p1' });

    expect(getScaFilterOptions).toHaveBeenCalledWith({ projectId: 'p1' });
    expect(result).toEqual(mockResponse);
  });

  it('rejects with INVALID_ARGUMENT when projectId is missing', async () => {
    const getScaFilterOptions = jest.fn();
    const controller = makeScaFilterController(getScaFilterOptions);

    await expect(
      controller.getScaFilterOptions({ projectId: '' }),
    ).rejects.toMatchObject({
      error: expect.objectContaining({ code: 3 }), // status.INVALID_ARGUMENT = 3
    });
    expect(getScaFilterOptions).not.toHaveBeenCalled();
  });
});

describe('ResultController aggregated report enqueue', () => {
  function makeAggController(overrides: Record<string, any> = {}): any {
    const controller = Object.create(ResultController.prototype);
    const addAggregatedReportJob = jest.fn().mockResolvedValue(undefined);
    const aggregatedReportRepo = {
      create: jest.fn((x: any) => x),
      save: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue({ affected: 1, raw: {} }),
      findOne: jest.fn(),
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
    };
    const reportUpload = {
      deleteReport: jest.fn().mockResolvedValue(undefined),
    };
    const validateBatchAccess = jest.fn().mockResolvedValue(undefined);
    const validateTeamAccess = jest.fn().mockResolvedValue(undefined);
    const getGeneratedAggregatedReport = jest.fn();
    const reportRetention = {
      computeExpiresAtForOrg: jest.fn().mockResolvedValue(null),
      computeExpiresAtForProject: jest
        .fn()
        .mockResolvedValue({ organizationId: null, expiresAt: null }),
    };
    const reportQuota = {
      assertWithinQuotaForProject: jest.fn().mockResolvedValue(undefined),
      assertWithinQuotaForOrg: jest.fn().mockResolvedValue(undefined),
      getUsageForOrg: jest.fn().mockResolvedValue({ used: 7, limit: 500 }),
      getUsageForProject: jest.fn().mockResolvedValue({ used: 7, limit: 500 }),
    };
    const asyncTaskStore = {
      create: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    Object.assign(controller, {
      scanQueueService: { addAggregatedReportJob },
      aggregatedReportRepo,
      aggregatedReportsService: {
        validateBatchAccess,
        validateTeamAccess,
        getGeneratedAggregatedReport,
      },
      reportRetention,
      reportQuota,
      reportUpload,
      asyncTaskStore,
      logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
      ...overrides,
    });
    return {
      controller,
      addAggregatedReportJob,
      aggregatedReportRepo,
      validateBatchAccess,
      validateTeamAccess,
      reportRetention,
      reportQuota,
      reportUpload,
      asyncTaskStore,
    };
  }

  it('generateOrganizationReport persists expiresAt from plan retention', async () => {
    const expiry = new Date('2026-09-01T00:00:00.000Z');
    const reportRetention = {
      computeExpiresAtForOrg: jest.fn().mockResolvedValue(expiry),
    };
    const { controller, aggregatedReportRepo } = makeAggController({
      reportRetention,
    });

    const res = await controller.generateOrganizationReport({
      organizationId: 'org-1',
      userId: 'u1',
      reportType: 'owasp',
      format: 'pdf',
      detailed: true,
    });

    expect(reportRetention.computeExpiresAtForOrg).toHaveBeenCalledWith(
      'org-1',
    );
    expect(aggregatedReportRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ id: res.reportId, expiresAt: expiry }),
    );
  });

  it('listAggregatedReports filters by organizationId for the org route', async () => {
    const { controller, aggregatedReportRepo } = makeAggController();
    aggregatedReportRepo.findAndCount.mockResolvedValue([
      [
        {
          id: 'a1',
          reportType: 'owasp',
          scopeType: 'organization',
          scopeId: 'org-1',
          format: 'pdf',
          status: 'ready',
          filename: 'org.pdf',
          createdAt: new Date('2026-03-01T00:00:00Z'),
          expiresAt: null,
        },
      ],
      1,
    ]);

    const res = await controller.listAggregatedReports({
      scopeType: 'organization',
      scopeId: 'org-1',
      organizationId: 'org-1',
      page: 1,
      pageSize: 20,
    });

    expect(res.total).toBe(1);
    expect(res.items[0]).toMatchObject({ reportId: 'a1', reportType: 'owasp' });
    const arg = aggregatedReportRepo.findAndCount.mock.calls[0][0];
    expect(arg.where[0]).toMatchObject({ organizationId: 'org-1' });
  });

  it('listAggregatedReports rejects a request with no scope', async () => {
    const { controller } = makeAggController();
    await expect(
      controller.listAggregatedReports({
        scopeType: '',
        scopeId: '',
        organizationId: '',
        page: 1,
        pageSize: 20,
      }),
    ).rejects.toMatchObject({ error: { code: status.INVALID_ARGUMENT } });
  });

  it('deleteAggregatedReport removes object + row when the org owns it', async () => {
    const { controller, aggregatedReportRepo, reportUpload } =
      makeAggController();
    aggregatedReportRepo.findOne.mockResolvedValue({
      id: 'a1',
      scopeType: 'organization',
      scopeId: 'org-1',
      organizationId: 'org-1',
      objectPath: 'reports/org-1/a1.pdf',
    });

    const res = await controller.deleteAggregatedReport({
      scopeType: 'organization',
      scopeId: 'org-1',
      organizationId: 'org-1',
      reportId: 'a1',
    });

    expect(res.success).toBe(true);
    expect(reportUpload.deleteReport).toHaveBeenCalledWith(
      'reports/org-1/a1.pdf',
      'org-1',
    );
    expect(aggregatedReportRepo.delete).toHaveBeenCalledWith({ id: 'a1' });
  });

  it('deleteAggregatedReport is NOT_FOUND when the report belongs to another org', async () => {
    const { controller, aggregatedReportRepo, reportUpload } =
      makeAggController();
    aggregatedReportRepo.findOne.mockResolvedValue({
      id: 'a1',
      scopeType: 'organization',
      scopeId: 'org-OTHER',
      organizationId: 'org-OTHER',
      objectPath: 'reports/org-OTHER/a1.pdf',
    });

    await expect(
      controller.deleteAggregatedReport({
        scopeType: 'organization',
        scopeId: 'org-1',
        organizationId: 'org-1',
        reportId: 'a1',
      }),
    ).rejects.toMatchObject({ error: { code: status.NOT_FOUND } });
    expect(reportUpload.deleteReport).not.toHaveBeenCalled();
    expect(aggregatedReportRepo.delete).not.toHaveBeenCalled();
  });

  // Team route: organizationId is falsy, so the scope fence relies solely on
  // scopeType+scopeId — the more IDOR-sensitive path.
  it('listAggregatedReports filters by scopeType+scopeId for the team route (organizationId falsy)', async () => {
    const { controller, aggregatedReportRepo } = makeAggController();
    aggregatedReportRepo.findAndCount.mockResolvedValue([
      [
        {
          id: 't1',
          reportType: 'owasp',
          scopeType: 'team',
          scopeId: 'team-1',
          format: 'pdf',
          status: 'ready',
          filename: 't.pdf',
          createdAt: new Date('2026-03-01T00:00:00Z'),
          expiresAt: null,
        },
      ],
      1,
    ]);

    const res = await controller.listAggregatedReports({
      scopeType: 'team',
      scopeId: 'team-1',
      organizationId: '',
      page: 1,
      pageSize: 20,
    });

    expect(res.total).toBe(1);
    expect(res.items[0]).toMatchObject({ reportId: 't1', scopeType: 'team' });
    const arg = aggregatedReportRepo.findAndCount.mock.calls[0][0];
    expect(arg.where[0]).toMatchObject({
      scopeType: 'team',
      scopeId: 'team-1',
    });
    // Must NOT fall back to an org filter when organizationId is absent.
    expect(arg.where[0].organizationId).toBeUndefined();
  });

  it('deleteAggregatedReport (team route, organizationId falsy) deletes when scopeType+scopeId match', async () => {
    const { controller, aggregatedReportRepo, reportUpload } =
      makeAggController();
    aggregatedReportRepo.findOne.mockResolvedValue({
      id: 't1',
      scopeType: 'team',
      scopeId: 'team-1',
      organizationId: 'org-1',
      objectPath: 'reports/org-1/t1.pdf',
    });

    const res = await controller.deleteAggregatedReport({
      scopeType: 'team',
      scopeId: 'team-1',
      organizationId: '',
      reportId: 't1',
    });

    expect(res.success).toBe(true);
    expect(reportUpload.deleteReport).toHaveBeenCalledWith(
      'reports/org-1/t1.pdf',
      'org-1',
    );
    expect(aggregatedReportRepo.delete).toHaveBeenCalledWith({ id: 't1' });
  });

  it('deleteAggregatedReport (team route) is NOT_FOUND when scopeId belongs to another team (IDOR fence)', async () => {
    const { controller, aggregatedReportRepo, reportUpload } =
      makeAggController();
    aggregatedReportRepo.findOne.mockResolvedValue({
      id: 't1',
      scopeType: 'team',
      scopeId: 'team-OTHER',
      organizationId: 'org-1',
      objectPath: 'reports/org-1/t1.pdf',
    });

    await expect(
      controller.deleteAggregatedReport({
        scopeType: 'team',
        scopeId: 'team-1',
        organizationId: '',
        reportId: 't1',
      }),
    ).rejects.toMatchObject({ error: { code: status.NOT_FOUND } });
    expect(reportUpload.deleteReport).not.toHaveBeenCalled();
    expect(aggregatedReportRepo.delete).not.toHaveBeenCalled();
  });

  it('generateOrganizationReport persists a queued row + enqueues a job, returns reportId/status', async () => {
    const { controller, addAggregatedReportJob, aggregatedReportRepo } =
      makeAggController();

    const res = await controller.generateOrganizationReport({
      organizationId: 'org-1',
      userId: 'u1',
      reportType: 'owasp',
      format: 'pdf',
      detailed: true,
    });

    expect(res.status).toBe('queued');
    expect(typeof res.reportId).toBe('string');
    expect(res.reportId.length).toBeGreaterThan(0);
    expect(res.downloadUrl).toBe('');
    expect(aggregatedReportRepo.save).toHaveBeenCalledTimes(1);
    expect(aggregatedReportRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        id: res.reportId,
        scopeType: 'organization',
        scopeId: 'org-1',
        organizationId: 'org-1',
        status: 'queued',
      }),
    );
    expect(addAggregatedReportJob).toHaveBeenCalledWith(
      expect.objectContaining({
        reportId: res.reportId,
        scopeType: 'organization',
        scopeId: 'org-1',
      }),
    );
  });

  it('generateTeamReport validates team↔org ownership before enqueue, then enqueues with scopeType=team', async () => {
    const {
      controller,
      addAggregatedReportJob,
      aggregatedReportRepo,
      validateTeamAccess,
    } = makeAggController();

    const res = await controller.generateTeamReport({
      teamId: 'team-1',
      organizationId: 'org-1',
      userId: 'u1',
      reportType: 'cwe',
      format: 'pdf',
    });

    // Anti-IDOR: the client-supplied org must be verified to own the team.
    expect(validateTeamAccess).toHaveBeenCalledWith('team-1', 'org-1');
    expect(res.status).toBe('queued');
    expect(aggregatedReportRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        scopeType: 'team',
        scopeId: 'team-1',
        organizationId: 'org-1',
      }),
    );
    expect(addAggregatedReportJob).toHaveBeenCalledWith(
      expect.objectContaining({ scopeType: 'team', scopeId: 'team-1' }),
    );
  });

  it('generateTeamReport fails fast (no enqueue) when the org does not own the team (spoofed organizationId)', async () => {
    const {
      controller,
      addAggregatedReportJob,
      aggregatedReportRepo,
      validateTeamAccess,
    } = makeAggController();
    validateTeamAccess.mockRejectedValueOnce({
      error: {
        code: 7,
        message: 'Team does not belong to the specified organization',
      },
    });

    await expect(
      controller.generateTeamReport({
        teamId: 'team-1',
        organizationId: 'victim-org',
        userId: 'u1',
        reportType: 'cwe',
        format: 'pdf',
      }),
    ).rejects.toMatchObject({ error: { code: 7 } });

    expect(validateTeamAccess).toHaveBeenCalledWith('team-1', 'victim-org');
    expect(aggregatedReportRepo.create).not.toHaveBeenCalled();
    expect(addAggregatedReportJob).not.toHaveBeenCalled();
  });

  it('generateBatchReport validates access before enqueue', async () => {
    const { controller, addAggregatedReportJob, validateBatchAccess } =
      makeAggController();

    const res = await controller.generateBatchReport({
      projectIds: ['p1', 'p2'],
      organizationId: 'org-1',
      userId: 'u1',
      reportType: 'owasp',
      format: 'pdf',
    });

    expect(validateBatchAccess).toHaveBeenCalledWith(
      ['p1', 'p2'],
      'org-1',
      'u1',
    );
    expect(res.status).toBe('queued');
    expect(addAggregatedReportJob).toHaveBeenCalledWith(
      expect.objectContaining({
        scopeType: 'batch',
        projectIds: ['p1', 'p2'],
      }),
    );
  });

  it('generateBatchReport fails fast (no enqueue) when access validation rejects', async () => {
    const { controller, addAggregatedReportJob, validateBatchAccess } =
      makeAggController();
    validateBatchAccess.mockRejectedValueOnce({
      error: { code: 7, message: 'denied' },
    });

    await expect(
      controller.generateBatchReport({
        projectIds: ['p1', 'p-other'],
        organizationId: 'org-1',
        userId: 'u1',
        reportType: 'owasp',
        format: 'pdf',
      }),
    ).rejects.toBeDefined();
    expect(addAggregatedReportJob).not.toHaveBeenCalled();
  });

  it('rolls back the queued row when addAggregatedReportJob throws (UNAVAILABLE)', async () => {
    const { controller, addAggregatedReportJob, aggregatedReportRepo } =
      makeAggController();
    addAggregatedReportJob.mockRejectedValueOnce(new Error('redis down'));

    await expect(
      controller.generateOrganizationReport({
        organizationId: 'org-1',
        userId: 'u1',
        reportType: 'owasp',
        format: 'pdf',
      }),
    ).rejects.toMatchObject({ error: expect.objectContaining({ code: 14 }) });

    expect(aggregatedReportRepo.save).toHaveBeenCalledTimes(1);
    expect(aggregatedReportRepo.delete).toHaveBeenCalledTimes(1);
    const savedId = (aggregatedReportRepo.save as jest.Mock).mock.calls[0][0]
      .id;
    expect((aggregatedReportRepo.delete as jest.Mock).mock.calls[0][0]).toEqual(
      { id: savedId },
    );
  });
});

// ---------------------------------------------------------------------------
// Async task RPCs: enqueueBatchUpdate / getAsyncTask / listAsyncTasks
// ---------------------------------------------------------------------------

function makeAsyncTaskController(overrides: Record<string, any> = {}): any {
  const controller = Object.create(ResultController.prototype);
  const addVulnBatchUpdateJob = jest.fn().mockResolvedValue('job-id-1');
  const storeCreate = jest.fn().mockResolvedValue(undefined);
  const storeGet = jest.fn().mockResolvedValue(null);
  const storeList = jest.fn().mockResolvedValue([]);
  const storeDelete = jest.fn().mockResolvedValue(undefined);
  Object.assign(controller, {
    scanQueueService: { addVulnBatchUpdateJob },
    asyncTaskStore: {
      create: storeCreate,
      get: storeGet,
      list: storeList,
      delete: storeDelete,
    },
    logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
    ...overrides,
  });
  return {
    controller,
    addVulnBatchUpdateJob,
    storeCreate,
    storeGet,
    storeList,
    storeDelete,
  };
}

const VALID_ITEMS = [
  { vulnerabilityId: 'v1', status: 'resolved' },
  { vulnerabilityId: 'v2', priority: 'low' },
];

describe('ResultController.enqueueBatchUpdate', () => {
  it('returns { taskId, total } and calls store.create + addVulnBatchUpdateJob', async () => {
    const { controller, addVulnBatchUpdateJob, storeCreate } =
      makeAsyncTaskController();

    const result = await controller.enqueueBatchUpdate({
      projectId: 'proj-1',
      userId: 'user-1',
      items: VALID_ITEMS,
    });

    expect(typeof result.taskId).toBe('string');
    expect(result.taskId.length).toBeGreaterThan(0);
    expect(result.total).toBe(2);

    expect(storeCreate).toHaveBeenCalledTimes(1);
    const createArg = storeCreate.mock.calls[0][0];
    expect(createArg.taskId).toBe(result.taskId);
    expect(createArg.type).toBe('vuln_batch_update');
    expect(createArg.status).toBe('queued');
    expect(createArg.total).toBe(2);
    expect(createArg.processed).toBe(0);
    expect(createArg.succeeded).toBe(0);
    expect(createArg.failed).toBe(0);
    expect(createArg.projectId).toBe('proj-1');
    expect(createArg.userId).toBe('user-1');
    expect(typeof createArg.createdAt).toBe('number');
    expect(typeof createArg.updatedAt).toBe('number');

    expect(addVulnBatchUpdateJob).toHaveBeenCalledTimes(1);
    const jobArg = addVulnBatchUpdateJob.mock.calls[0][0];
    expect(jobArg.taskId).toBe(result.taskId);
    expect(jobArg.projectId).toBe('proj-1');
    expect(jobArg.userId).toBe('user-1');
    expect(jobArg.items).toEqual([
      {
        vulnerabilityId: 'v1',
        status: 'resolved',
        priority: undefined,
        comment: undefined,
        dismissalReason: undefined,
      },
      {
        vulnerabilityId: 'v2',
        status: undefined,
        priority: 'low',
        comment: undefined,
        dismissalReason: undefined,
      },
    ]);
  });

  // The justification has to survive the hop into the
  // BullMQ job. The worker rebuilds each UpdateResultRequest from this payload
  // alone, and `assertDismissalReason` runs downstream of it: dropped here,
  // bulk dismissal becomes impossible rather than merely audited.
  it('carries the per-item dismissalReason into the queued job', async () => {
    const { controller, addVulnBatchUpdateJob } = makeAsyncTaskController();

    await controller.enqueueBatchUpdate({
      projectId: 'proj-1',
      userId: 'user-1',
      items: [
        {
          vulnerabilityId: 'v1',
          status: 'ignored',
          dismissalReason: 'accepted risk',
        },
      ],
    });

    expect(addVulnBatchUpdateJob.mock.calls[0][0].items).toEqual([
      expect.objectContaining({
        vulnerabilityId: 'v1',
        status: 'ignored',
        dismissalReason: 'accepted risk',
      }),
    ]);
  });

  it('rolls back store.create (calls store.delete) and throws UNAVAILABLE when addVulnBatchUpdateJob rejects', async () => {
    const { controller, addVulnBatchUpdateJob, storeDelete } =
      makeAsyncTaskController();
    addVulnBatchUpdateJob.mockRejectedValueOnce(new Error('redis down'));

    await expect(
      controller.enqueueBatchUpdate({
        projectId: 'proj-1',
        userId: 'user-1',
        items: VALID_ITEMS,
      }),
    ).rejects.toMatchObject({
      error: expect.objectContaining({ code: 14 }), // status.UNAVAILABLE
    });

    expect(storeDelete).toHaveBeenCalledTimes(1);
  });

  it('passes agentToolCallId/agentConversationId/agentStreamId to the job when present', async () => {
    const { controller, addVulnBatchUpdateJob } = makeAsyncTaskController();

    await controller.enqueueBatchUpdate({
      projectId: 'proj-1',
      userId: 'user-1',
      items: VALID_ITEMS,
      agentToolCallId: 'tc-1',
      agentConversationId: 'conv-1',
      agentStreamId: 'stream-1',
    });

    const jobArg = addVulnBatchUpdateJob.mock.calls[0][0];
    expect(jobArg.agentToolCallId).toBe('tc-1');
    expect(jobArg.agentConversationId).toBe('conv-1');
    expect(jobArg.agentStreamId).toBe('stream-1');
  });

  it('rejects with INVALID_ARGUMENT when projectId is missing', async () => {
    const { controller } = makeAsyncTaskController();

    await expect(
      controller.enqueueBatchUpdate({
        projectId: '',
        userId: 'user-1',
        items: VALID_ITEMS,
      }),
    ).rejects.toMatchObject({
      error: expect.objectContaining({ code: 3 }), // status.INVALID_ARGUMENT
    });
  });

  it('rejects with INVALID_ARGUMENT when userId is missing', async () => {
    const { controller } = makeAsyncTaskController();

    await expect(
      controller.enqueueBatchUpdate({
        projectId: 'proj-1',
        userId: '',
        items: VALID_ITEMS,
      }),
    ).rejects.toMatchObject({
      error: expect.objectContaining({ code: 3 }),
    });
  });

  it('rejects with INVALID_ARGUMENT when items is empty', async () => {
    const { controller } = makeAsyncTaskController();

    await expect(
      controller.enqueueBatchUpdate({
        projectId: 'proj-1',
        userId: 'user-1',
        items: [],
      }),
    ).rejects.toMatchObject({
      error: expect.objectContaining({ code: 3 }),
    });
  });

  it('rejects with INVALID_ARGUMENT when items.length > 100', async () => {
    const { controller } = makeAsyncTaskController();
    const tooMany = Array.from({ length: 101 }, (_, i) => ({
      vulnerabilityId: `v${i}`,
    }));

    await expect(
      controller.enqueueBatchUpdate({
        projectId: 'proj-1',
        userId: 'user-1',
        items: tooMany,
      }),
    ).rejects.toMatchObject({
      error: expect.objectContaining({ code: 3 }),
    });
  });
});

// ---------------------------------------------------------------------------
// Deleting a project's detections must mark the org's persisted KPI
// cards dirty (markDirty by orgId) so the org-overview cards recompute. The
// cards are read O(1) from the persisted organization_statistics row, so
// without this trigger they keep the pre-deletion numbers forever (with the
// last project gone, no future scan event will ever re-dirty the org).
// Complete data deletion: the legacy delete, still called by an
// older global-management, now runs the whole project purge (DataPurgeService)
// until it is complete, secrets, CI/CD findings and reports included.
// ---------------------------------------------------------------------------
const DELETE_PROJECT_ID = '11111111-2222-4333-8444-555555555555';
const DELETE_ORG_ID = '66666666-7777-4888-9999-aaaaaaaaaaaa';

function makeDeleteController(overrides: Record<string, any> = {}): any {
  const controller = Object.create(ResultController.prototype);
  const purgeProject = jest
    .fn()
    .mockResolvedValue({ complete: true, deleted: {} });
  const markDirty = jest.fn().mockResolvedValue(undefined);
  Object.assign(controller, {
    dataPurgeService: { purgeProject },
    organizationStatisticsService: { markDirty },
    logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
    ...overrides,
  });
  return { controller, purgeProject, markDirty };
}

describe('ResultController.deleteProjectVulnerabilityDetections', () => {
  it('purges the project until complete', async () => {
    const { controller, purgeProject } = makeDeleteController();
    purgeProject
      .mockResolvedValueOnce({ complete: false, deleted: { x: 1000 } })
      .mockResolvedValueOnce({ complete: true, deleted: { x: 3 } });

    const res = await controller.deleteProjectVulnerabilityDetections({
      projectId: DELETE_PROJECT_ID,
      organizationId: DELETE_ORG_ID,
    });

    expect(purgeProject).toHaveBeenCalledTimes(2);
    expect(purgeProject).toHaveBeenCalledWith(
      DELETE_PROJECT_ID,
      DELETE_ORG_ID,
      Number.POSITIVE_INFINITY,
    );
    expect(res).toEqual({
      message: 'Project vulnerability detections deleted successfully',
    });
  });

  it('the legacy path marks the organization statistics dirty exactly once', async () => {
    // The real purge (DataPurgeService) marks dirty when it completes, with
    // the UPDATE-only mark; the controller must not mark a second time.
    const markDirty = jest.fn().mockResolvedValue(undefined);
    const markDirtyIfPresent = jest.fn().mockResolvedValue(undefined);
    const query = jest.fn().mockResolvedValue({ affectedRows: 0 });
    const redis = { del: jest.fn().mockResolvedValue(0) };
    const dataPurgeService = new DataPurgeService(
      { query } as any,
      { getRedisClient: jest.fn().mockResolvedValue(redis) } as any,
      { markDirty, markDirtyIfPresent } as any,
    );
    const { controller } = makeDeleteController({
      dataPurgeService,
      organizationStatisticsService: { markDirty, markDirtyIfPresent },
    });

    await controller.deleteProjectVulnerabilityDetections({
      projectId: DELETE_PROJECT_ID,
      organizationId: DELETE_ORG_ID,
    });

    expect(query).toHaveBeenCalled();
    expect(markDirtyIfPresent).toHaveBeenCalledTimes(1);
    expect(markDirtyIfPresent).toHaveBeenCalledWith(DELETE_ORG_ID);
    expect(markDirty).not.toHaveBeenCalled();
  });

  it('passes an empty organizationId through (back-compat with old callers)', async () => {
    const { controller, purgeProject, markDirty } = makeDeleteController();

    await controller.deleteProjectVulnerabilityDetections({
      projectId: DELETE_PROJECT_ID,
      organizationId: '',
    });

    expect(purgeProject).toHaveBeenCalledWith(
      DELETE_PROJECT_ID,
      '',
      Number.POSITIVE_INFINITY,
    );
    expect(markDirty).not.toHaveBeenCalled();
  });

  it('fails with INTERNAL when the purge fails', async () => {
    const { controller, purgeProject, markDirty } = makeDeleteController();
    purgeProject.mockRejectedValueOnce(new Error('Lock wait timeout'));

    await expect(
      controller.deleteProjectVulnerabilityDetections({
        projectId: DELETE_PROJECT_ID,
        organizationId: DELETE_ORG_ID,
      }),
    ).rejects.toMatchObject({ error: expect.objectContaining({ code: 13 }) });
    expect(markDirty).not.toHaveBeenCalled();
  });

  it('rejects with INVALID_ARGUMENT when projectId is missing (no delete, no dirty)', async () => {
    const { controller, purgeProject, markDirty } = makeDeleteController();

    await expect(
      controller.deleteProjectVulnerabilityDetections({
        projectId: '',
        organizationId: DELETE_ORG_ID,
      }),
    ).rejects.toMatchObject({ error: expect.objectContaining({ code: 3 }) });
    expect(purgeProject).not.toHaveBeenCalled();
    expect(markDirty).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// The org KPI cards are served O(1) from the persisted
// organization_statistics row. Freshness on project deletion is handled on the
// write path (deleteProjectVulnerabilityDetections → markDirty → debounced
// recompute that re-scopes to live projects). The read path never recomputes
// an organization with a persisted row for a caller who reads every project;
// resolving what the caller reads is the only global-management work it does.
// ---------------------------------------------------------------------------
function makeOrgStatsController(overrides: Record<string, any> = {}): any {
  const controller = Object.create(ResultController.prototype);
  const readPersisted = jest.fn();
  const resolveProjectIds = jest.fn();
  const saveInitial = jest.fn().mockResolvedValue(undefined);
  const getMainStatistics = jest.fn();
  const getReadableProjectIds = jest.fn();
  Object.assign(controller, {
    organizationStatisticsService: {
      readPersisted,
      resolveProjectIds,
      saveInitial,
    },
    resultService: { getMainStatistics },
    organizationOverviewService: { getReadableProjectIds },
    logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
    ...overrides,
  });
  return {
    controller,
    readPersisted,
    resolveProjectIds,
    saveInitial,
    getMainStatistics,
    getReadableProjectIds,
  };
}

describe('ResultController.getOrganizationStatistics (O(1) read)', () => {
  // These two cases send no userId: a request from a gateway older than the
  // caller-scoped contract still gets the organization row, as before.
  it('returns the persisted row verbatim with NO global-management round-trip (even when non-zero)', async () => {
    const { controller, readPersisted, resolveProjectIds, saveInitial } =
      makeOrgStatsController();
    const persisted = { projectIds: [], criticalIssues: 5, highIssues: 2 };
    readPersisted.mockResolvedValue(persisted);

    const res = await controller.getOrganizationStatistics({
      organizationId: 'org-1',
    });

    expect(res).toBe(persisted);
    // The hot path must stay O(1): no resolveProjectIds (GM gRPC), no write.
    expect(resolveProjectIds).not.toHaveBeenCalled();
    expect(saveInitial).not.toHaveBeenCalled();
  });

  it('cold row (never computed) still computes once and persists (unchanged path)', async () => {
    const {
      controller,
      readPersisted,
      resolveProjectIds,
      saveInitial,
      getMainStatistics,
    } = makeOrgStatsController();
    readPersisted.mockResolvedValue(null);
    resolveProjectIds.mockResolvedValue(['p1']);
    getMainStatistics.mockResolvedValue({
      projectIds: ['p1'],
      criticalIssues: 3,
    });

    const res = await controller.getOrganizationStatistics({
      organizationId: 'org-1',
    });

    expect(getMainStatistics).toHaveBeenCalledWith({ projectIds: ['p1'] });
    expect(res.criticalIssues).toBe(3);
    expect(saveInitial).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// The home KPI cards are figures about projects: a member reads only the
// projects of their teams, so the organization-wide row (computed over every
// project) is served only to a caller who reads every project; anyone else
// gets figures computed over their own readable projects, never persisted.
// ---------------------------------------------------------------------------
describe('ResultController.getOrganizationStatistics (scoped to the caller)', () => {
  it('administrator (reads every project): the persisted row, no recompute', async () => {
    const {
      controller,
      readPersisted,
      resolveProjectIds,
      saveInitial,
      getMainStatistics,
      getReadableProjectIds,
    } = makeOrgStatsController();
    const persisted = { projectIds: [], criticalIssues: 5, highIssues: 2 };
    readPersisted.mockResolvedValue(persisted);
    resolveProjectIds.mockResolvedValue(['p1', 'p2', 'p3']);
    getReadableProjectIds.mockResolvedValue(['p3', 'p1', 'p2']);

    const res = await controller.getOrganizationStatistics({
      organizationId: 'org-1',
      userId: 'admin',
    });

    expect(getReadableProjectIds).toHaveBeenCalledWith('org-1', 'admin');
    expect(res).toBe(persisted);
    expect(getMainStatistics).not.toHaveBeenCalled();
    expect(saveInitial).not.toHaveBeenCalled();
  });

  it("member of one team: computed over that team's projects only, nothing persisted", async () => {
    const {
      controller,
      readPersisted,
      resolveProjectIds,
      saveInitial,
      getMainStatistics,
      getReadableProjectIds,
    } = makeOrgStatsController();
    readPersisted.mockResolvedValue({
      projectIds: [],
      criticalIssues: 50,
      highIssues: 20,
    });
    resolveProjectIds.mockResolvedValue(['p1', 'p2', 'p3']);
    getReadableProjectIds.mockResolvedValue(['p2']);
    getMainStatistics.mockResolvedValue({
      projectIds: ['p2'],
      criticalIssues: 1,
      highIssues: 4,
    });

    const res = await controller.getOrganizationStatistics({
      organizationId: 'org-1',
      userId: 'dev',
    });

    expect(getReadableProjectIds).toHaveBeenCalledWith('org-1', 'dev');
    expect(getMainStatistics).toHaveBeenCalledWith({ projectIds: ['p2'] });
    expect(res.criticalIssues).toBe(1);
    expect(res.highIssues).toBe(4);
    expect(res.newIssues).toBe(0);
    // The ids of the readable projects are not echoed back.
    expect(res.projectIds).toEqual([]);
    expect(saveInitial).not.toHaveBeenCalled();
  });

  it('member with no readable project: zeros, nothing computed or persisted', async () => {
    const {
      controller,
      readPersisted,
      resolveProjectIds,
      saveInitial,
      getMainStatistics,
      getReadableProjectIds,
    } = makeOrgStatsController();
    readPersisted.mockResolvedValue({ projectIds: [], criticalIssues: 50 });
    resolveProjectIds.mockResolvedValue(['p1', 'p2']);
    getReadableProjectIds.mockResolvedValue([]);

    const res = await controller.getOrganizationStatistics({
      organizationId: 'org-1',
      userId: 'outsider',
    });

    expect(res.criticalIssues).toBe(0);
    expect(res.highIssues).toBe(0);
    expect(res.criticalRiskProjects).toBe(0);
    expect(getMainStatistics).not.toHaveBeenCalled();
    expect(saveInitial).not.toHaveBeenCalled();
  });

  it('administrator on a cold row: computes over every project and persists it (unchanged)', async () => {
    const {
      controller,
      readPersisted,
      resolveProjectIds,
      saveInitial,
      getMainStatistics,
      getReadableProjectIds,
    } = makeOrgStatsController();
    readPersisted.mockResolvedValue(null);
    resolveProjectIds.mockResolvedValue(['p1', 'p2']);
    getReadableProjectIds.mockResolvedValue(['p1', 'p2']);
    getMainStatistics.mockResolvedValue({
      projectIds: ['p1', 'p2'],
      criticalIssues: 3,
    });

    const res = await controller.getOrganizationStatistics({
      organizationId: 'org-1',
      userId: 'admin',
    });

    expect(getMainStatistics).toHaveBeenCalledWith({
      projectIds: ['p1', 'p2'],
    });
    expect(res.criticalIssues).toBe(3);
    expect(saveInitial).toHaveBeenCalledTimes(1);
    // The organization's project ids are resolved once, not again for the
    // cold compute.
    expect(resolveProjectIds).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// deleteAsyncTask — persisted dismiss of a background task (owner-checked)
// ---------------------------------------------------------------------------

describe('ResultController.deleteAsyncTask', () => {
  it('rejects INVALID_ARGUMENT when taskId or userId is missing', async () => {
    const { controller } = makeAsyncTaskController();
    await expect(
      controller.deleteAsyncTask({ userId: 'u1' }),
    ).rejects.toMatchObject({ error: { code: status.INVALID_ARGUMENT } });
  });

  it('is idempotent: an unknown task resolves { success: true } without deleting', async () => {
    const { controller, storeGet, storeDelete } = makeAsyncTaskController();
    storeGet.mockResolvedValue(null);
    const res = await controller.deleteAsyncTask({
      userId: 'u1',
      taskId: 't1',
    });
    expect(res).toEqual({ success: true });
    expect(storeDelete).not.toHaveBeenCalled();
  });

  it("refuses to delete another user's task (PERMISSION_DENIED)", async () => {
    const { controller, storeGet, storeDelete } = makeAsyncTaskController();
    storeGet.mockResolvedValue({ taskId: 't1', userId: 'owner' });
    await expect(
      controller.deleteAsyncTask({ userId: 'attacker', taskId: 't1' }),
    ).rejects.toMatchObject({ error: { code: status.PERMISSION_DENIED } });
    expect(storeDelete).not.toHaveBeenCalled();
  });

  it('deletes the task when the requester owns it', async () => {
    const { controller, storeGet, storeDelete } = makeAsyncTaskController();
    storeGet.mockResolvedValue({ taskId: 't1', userId: 'u1' });
    const res = await controller.deleteAsyncTask({
      userId: 'u1',
      taskId: 't1',
    });
    expect(res).toEqual({ success: true });
    expect(storeDelete).toHaveBeenCalledWith('t1');
  });
});

/**
 * Analysis-reporting alone creates a scan's issues.
 * security-scanning says when every container of a scan is closed
 * (NotifyScanEnded); its older pods still send CreateIssuesForScan while both
 * versions run, which now means the same thing.
 */
function makeScanEndController(onScanEnded: jest.Mock): any {
  const controller = Object.create(ResultController.prototype);
  Object.assign(controller, {
    scanCompleteNotificationService: { onScanEnded },
    logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
  });
  return controller;
}

describe('ResultController.notifyScanEnded', () => {
  it('evaluates the end of the scan and says what became of it', async () => {
    const onScanEnded = jest.fn().mockResolvedValue('waiting');
    const controller = makeScanEndController(onScanEnded);

    await expect(
      controller.notifyScanEnded({ scanId: 's1', projectId: 'p1' }),
    ).resolves.toEqual({ success: true, message: 'waiting' });
    expect(onScanEnded).toHaveBeenCalledWith('s1', 'p1');
  });

  it('answers UNAVAILABLE when the end could not be evaluated, so the caller retries', async () => {
    const controller = makeScanEndController(
      jest.fn().mockRejectedValue(new Error('scan s1 could not be read')),
    );

    const error = await controller
      .notifyScanEnded({ scanId: 's1', projectId: 'p1' })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RpcException);
    expect((error as RpcException).getError()).toEqual(
      expect.objectContaining({ code: status.UNAVAILABLE }),
    );
  });

  it('refuses a request without scan or project', async () => {
    const onScanEnded = jest.fn();
    const controller = makeScanEndController(onScanEnded);

    const error = await controller
      .notifyScanEnded({ scanId: 's1', projectId: '' })
      .catch((e: unknown) => e);

    expect((error as RpcException).getError()).toEqual(
      expect.objectContaining({ code: status.INVALID_ARGUMENT }),
    );
    expect(onScanEnded).not.toHaveBeenCalled();
  });
});

describe('ResultController.createIssuesForScan, from older security-scanning pods', () => {
  // Creating the issues here, as soon as the containers stopped, read
  // results still being ingested; the claim on the issue creation would then
  // keep the complete ones from being created by analysis-reporting's own
  // dispatch. It is the end-of-scan word of an older pod.
  it('evaluates the end of the scan instead of creating issues at once', async () => {
    const onScanEnded = jest.fn().mockResolvedValue('dispatched');
    const controller = makeScanEndController(onScanEnded);

    const res = await controller.createIssuesForScan({
      projectId: 'p1',
      scanId: 's1',
      organizationId: 'o1',
    });

    expect(onScanEnded).toHaveBeenCalledWith('s1', 'p1');
    expect(res).toEqual(
      expect.objectContaining({
        success: true,
        githubIssuesCreated: 0,
        gitlabIssuesCreated: 0,
      }),
    );
    expect(res.message).toContain('dispatched');
  });

  it('answers a failure without throwing when the end could not be evaluated', async () => {
    const controller = makeScanEndController(
      jest.fn().mockRejectedValue(new Error('scan s1 could not be read')),
    );

    const res = await controller.createIssuesForScan({
      projectId: 'p1',
      scanId: 's1',
    });

    expect(res).toEqual(
      expect.objectContaining({ success: false, githubIssuesCreated: 0 }),
    );
  });
});

describe('ResultController scanner result methods', () => {
  it.each(['addScaScanResult', 'addScanResult', 'addContainerScanResult'])(
    '%s is guarded by ScannerCallGuard',
    (method) => {
      const guards = Reflect.getMetadata(
        '__guards__',
        ResultController.prototype[method as keyof ResultController],
      );
      expect(guards).toContain(ScannerCallGuard);
    },
  );

  it('read methods are not guarded by ScannerCallGuard', () => {
    const guards =
      Reflect.getMetadata(
        '__guards__',
        ResultController.prototype.getVulnerabilitiesCount,
      ) ?? [];
    expect(guards).not.toContain(ScannerCallGuard);
  });
});
