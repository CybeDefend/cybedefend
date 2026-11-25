import { Job } from 'bullmq';
import { ReportsQueueProcessor } from './reports-queue.processor';
import { ReportJobData } from '../scan-queue.service';

describe('ReportsQueueProcessor', () => {
  let processor: ReportsQueueProcessor;
  let reportRepo: { update: jest.Mock; findOne: jest.Mock };
  /** Report ids whose row the user deleted. */
  let deleted: Set<string>;
  let owaspReportService: { generateReport: jest.Mock };
  let cweReportService: { generateReport: jest.Mock };
  let reportUpload: { uploadReport: jest.Mock; deleteReport: jest.Mock };
  let realtime: { publish: jest.Mock };
  let orgResolver: { resolveOrgId: jest.Mock };
  let asyncTaskStore: { update: jest.Mock; markTerminal: jest.Mock };

  const uploaded = {
    downloadUrl: 'https://signed/get',
    expiresAtMs: Date.now() + 60_000,
    filename: 'report.pdf',
    contentType: 'application/pdf',
    objectPath: 'reports/p1/report.pdf',
  };

  beforeEach(() => {
    deleted = new Set();
    // Every row exists and is queued until a test deletes it.
    reportRepo = {
      findOne: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(
          deleted.has(where.id) ? null : { id: where.id, status: 'queued' },
        ),
      ),
      update: jest.fn((criteria: string | { id: string }) =>
        Promise.resolve({
          affected: deleted.has(
            typeof criteria === 'string' ? criteria : criteria.id,
          )
            ? 0
            : 1,
        }),
      ),
    };
    owaspReportService = {
      generateReport: jest.fn().mockResolvedValue({
        content: Buffer.from('%PDF owasp'),
        filename: 'owasp.pdf',
        contentType: 'application/pdf',
      }),
    };
    cweReportService = {
      generateReport: jest.fn().mockResolvedValue({
        content: Buffer.from('%PDF cwe'),
        filename: 'cwe.pdf',
        contentType: 'application/pdf',
      }),
    };
    reportUpload = {
      uploadReport: jest.fn().mockResolvedValue(uploaded),
      deleteReport: jest.fn().mockResolvedValue(undefined),
    };
    realtime = { publish: jest.fn().mockResolvedValue(undefined) };
    orgResolver = { resolveOrgId: jest.fn().mockResolvedValue('org-1') };
    asyncTaskStore = {
      update: jest.fn().mockResolvedValue(undefined),
      markTerminal: jest.fn().mockResolvedValue(undefined),
    };

    processor = new ReportsQueueProcessor(
      reportRepo as any,
      owaspReportService as any,
      cweReportService as any,
      reportUpload as any,
      realtime as any,
      orgResolver as any,
      asyncTaskStore as any,
    );
  });

  const job = (data: ReportJobData): Job<ReportJobData> =>
    ({ id: 'report-rep-1', data }) as unknown as Job<ReportJobData>;

  it('owasp: builds, uploads, marks ready, publishes REPORT_READY(ready)', async () => {
    await processor.process(
      job({
        reportId: 'rep-1',
        kind: 'owasp',
        projectId: 'p1',
        format: 'pdf',
        detailed: true,
        branch: 'main',
      }),
    );

    expect(owaspReportService.generateReport).toHaveBeenCalledWith(
      'p1',
      'pdf',
      true,
      'main',
    );
    expect(reportUpload.uploadReport).toHaveBeenCalledWith({
      projectId: 'p1',
      filename: 'owasp.pdf',
      contentType: 'application/pdf',
      buffer: expect.any(Buffer),
    });
    expect(reportRepo.update).toHaveBeenCalledWith(
      { id: 'rep-1', status: 'queued' },
      {
        objectPath: 'reports/p1/report.pdf',
        filename: 'report.pdf',
        contentType: 'application/pdf',
        status: 'ready',
      },
    );
    const env = realtime.publish.mock.calls[0][0];
    expect(env.type).toBe('REPORT_READY');
    expect(env.scope).toEqual({ projectId: 'p1', organizationId: 'org-1' });
    expect(env.payload.reportReady).toEqual({
      reportId: 'rep-1',
      projectId: 'p1',
      reportKind: 'owasp',
      status: 'ready',
    });
  });

  it('completes the async task with a dashboard deep-link resultUrl', async () => {
    await processor.process(
      job({
        reportId: 'rep-1',
        kind: 'owasp',
        projectId: 'p1',
        format: 'pdf',
        detailed: true,
        taskId: 't1',
        userId: 'u1',
      }),
    );

    expect(asyncTaskStore.update).toHaveBeenCalledWith('t1', {
      status: 'running',
    });
    expect(asyncTaskStore.markTerminal).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({
        status: 'completed',
        resultUrl: '/project/p1/reports?reportId=rep-1',
      }),
      expect.any(Number),
    );
    // resultUrl must be a relative deep-link, never a signed storage URL.
    const patch = asyncTaskStore.markTerminal.mock.calls[0][1] as {
      resultUrl: string;
    };
    expect(patch.resultUrl.startsWith('/')).toBe(true);
    // An ASYNC_TASK_COMPLETED event is published alongside REPORT_READY.
    const types = realtime.publish.mock.calls.map((c: any[]) => c[0].type);
    expect(types).toContain('REPORT_READY');
    expect(types).toContain('ASYNC_TASK_COMPLETED');
  });

  // Owasp and cwe stay inline; any other kind is served by the
  // generator an ee module registers under PROJECT_REPORT_GENERATORS.
  it('hands a non-core kind to its registered generator', async () => {
    const generator = {
      kind: 'eu_ai_act' as const,
      buildAndUpload: jest.fn().mockResolvedValue(uploaded),
    };
    const withGenerator = new ReportsQueueProcessor(
      reportRepo as any,
      owaspReportService as any,
      cweReportService as any,
      reportUpload as any,
      realtime as any,
      orgResolver as any,
      asyncTaskStore as any,
      [generator],
    );
    const data: ReportJobData = {
      reportId: 'rep-7',
      kind: 'eu_ai_act',
      projectId: 'p1',
      format: 'pdf',
      detailed: true,
    };

    await withGenerator.process(job(data));

    expect(generator.buildAndUpload).toHaveBeenCalledWith(data);
    expect(owaspReportService.generateReport).not.toHaveBeenCalled();
    expect(reportRepo.update).toHaveBeenCalledWith(
      { id: 'rep-7', status: 'queued' },
      {
        objectPath: 'reports/p1/report.pdf',
        filename: 'report.pdf',
        contentType: 'application/pdf',
        status: 'ready',
      },
    );
  });

  it('throws Unknown report kind when no generator serves it', async () => {
    const data: ReportJobData = {
      reportId: 'rep-8',
      kind: 'scanner_type',
      projectId: 'p1',
      format: 'pdf',
      detailed: true,
    };

    await expect(processor['buildAndUpload'](data)).rejects.toThrow(
      'Unknown report kind: scanner_type',
    );
    // Through process(), the job fails terminally with that message.
    await processor.process(job(data));
    expect(reportRepo.update).toHaveBeenCalledWith('rep-8', {
      status: 'failed',
      error: 'Unknown report kind: scanner_type',
    });
  });

  it('failure: marks failed + publishes REPORT_READY(failed), does not throw', async () => {
    owaspReportService.generateReport.mockRejectedValueOnce(
      new Error('puppeteer crashed'),
    );

    await expect(
      processor.process(
        job({
          reportId: 'rep-4',
          kind: 'owasp',
          projectId: 'p1',
          format: 'pdf',
          detailed: true,
        }),
      ),
    ).resolves.toBeUndefined();

    expect(reportRepo.update).toHaveBeenCalledWith('rep-4', {
      status: 'failed',
      error: 'puppeteer crashed',
    });
    const env = realtime.publish.mock.calls[0][0];
    expect(env.payload.reportReady.status).toBe('failed');
  });

  it('publishes with projectId-only scope when org resolution fails', async () => {
    orgResolver.resolveOrgId.mockRejectedValueOnce(new Error('no org'));

    await processor.process(
      job({
        reportId: 'rep-5',
        kind: 'cwe',
        projectId: 'p1',
        format: 'pdf',
        detailed: true,
      }),
    );

    const env = realtime.publish.mock.calls[0][0];
    expect(env.scope).toEqual({ projectId: 'p1' });
  });

  describe('a report deleted while its job waits or renders', () => {
    const owasp: ReportJobData = {
      reportId: 'rep-del',
      kind: 'owasp',
      projectId: 'p1',
      format: 'pdf',
      detailed: true,
      taskId: 't1',
      userId: 'u1',
    };
    const readyEvents = () =>
      realtime.publish.mock.calls.filter(
        (c: any[]) =>
          c[0].type === 'REPORT_READY' &&
          c[0].payload.reportReady.status === 'ready',
      );

    it('is not rendered when it was deleted before the job started', async () => {
      deleted.add('rep-del');

      await processor.process(job(owasp));

      expect(owaspReportService.generateReport).not.toHaveBeenCalled();
      expect(reportUpload.uploadReport).not.toHaveBeenCalled();
      expect(readyEvents()).toHaveLength(0);
      expect(asyncTaskStore.markTerminal).toHaveBeenCalledWith(
        't1',
        expect.objectContaining({ status: 'failed' }),
        expect.any(Number),
      );
    });

    it('is not rendered when it is no longer queued (already failed)', async () => {
      reportRepo.findOne.mockResolvedValueOnce({
        id: 'rep-del',
        status: 'failed',
      });

      await processor.process(job(owasp));

      expect(owaspReportService.generateReport).not.toHaveBeenCalled();
    });

    it('tells a report settled as timed out apart from a deleted one', async () => {
      reportRepo.findOne.mockResolvedValueOnce({
        id: 'rep-del',
        status: 'failed',
        error: 'Report generation timed out',
      });

      await processor.process(job(owasp));

      expect(asyncTaskStore.markTerminal).toHaveBeenCalledWith(
        't1',
        expect.objectContaining({
          status: 'failed',
          error: 'Report generation timed out',
        }),
        expect.any(Number),
      );
    });

    it('is not uploaded when it was deleted while rendering', async () => {
      owaspReportService.generateReport.mockImplementationOnce(async () => {
        deleted.add('rep-del');
        return {
          content: Buffer.from('%PDF'),
          filename: 'owasp.pdf',
          contentType: 'application/pdf',
        };
      });

      await processor.process(job(owasp));

      expect(owaspReportService.generateReport).toHaveBeenCalled();
      expect(reportUpload.uploadReport).not.toHaveBeenCalled();
      expect(readyEvents()).toHaveLength(0);
    });

    it('removes the uploaded file when it was deleted during the upload', async () => {
      reportUpload.uploadReport.mockImplementationOnce(async () => {
        deleted.add('rep-del');
        return uploaded;
      });

      await processor.process(job(owasp));

      expect(reportUpload.deleteReport).toHaveBeenCalledWith(
        'reports/p1/report.pdf',
        'p1',
      );
      expect(readyEvents()).toHaveLength(0);
    });

    it('does not run a registered generator for a deleted report', async () => {
      const generator = {
        kind: 'eu_ai_act' as const,
        buildAndUpload: jest.fn().mockResolvedValue(uploaded),
      };
      const withGenerator = new ReportsQueueProcessor(
        reportRepo as any,
        owaspReportService as any,
        cweReportService as any,
        reportUpload as any,
        realtime as any,
        orgResolver as any,
        asyncTaskStore as any,
        [generator],
      );
      deleted.add('rep-del');

      await withGenerator.process(job({ ...owasp, kind: 'eu_ai_act' }));

      expect(generator.buildAndUpload).not.toHaveBeenCalled();
    });
  });

  describe('stale sweep', () => {
    const queueWith = (states: Record<string, string>) => ({
      getJob: jest.fn(async (id: string) =>
        states[id] ? { getState: async () => states[id] } : undefined,
      ),
    });
    const withQueue = (queue: unknown) =>
      new ReportsQueueProcessor(
        reportRepo as any,
        owaspReportService as any,
        cweReportService as any,
        reportUpload as any,
        realtime as any,
        orgResolver as any,
        asyncTaskStore as any,
        undefined,
        queue as any,
      );

    it('its timer never keeps the process alive, and stops with the module', () => {
      const processorWithQueue = withQueue(queueWith({}));
      processorWithQueue.onModuleInit();
      const timer = (processorWithQueue as any).sweepTimer as NodeJS.Timeout;
      expect(timer.hasRef()).toBe(false);
      processorWithQueue.onModuleDestroy();
      expect((timer as any)._destroyed).toBe(true);
    });

    it('fails an old queued report whose job is gone, never one whose job still waits', async () => {
      const find = jest
        .fn()
        .mockResolvedValue([{ id: 'lost' }, { id: 'behind-backlog' }]);
      Object.assign(reportRepo, { find });
      const processorWithQueue = withQueue(
        queueWith({ 'report-behind-backlog': 'prioritized' }),
      );

      await processorWithQueue.sweepLostReports();

      expect(reportRepo.update).toHaveBeenCalledWith(
        { id: 'lost', status: 'queued' },
        { status: 'failed', error: 'Report generation timed out' },
      );
      expect(reportRepo.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ id: 'behind-backlog' }),
        expect.anything(),
      );
    });
  });

  describe('onFailed (queue-level failure, e.g. stall after a worker crash)', () => {
    const data: ReportJobData = {
      reportId: 'rep-6',
      kind: 'scanner_type',
      projectId: 'p1',
      format: 'pdf',
      detailed: true,
    };

    it('marks a still-queued report failed and publishes REPORT_READY(failed)', async () => {
      reportRepo.update.mockResolvedValueOnce({ affected: 1 });

      await processor.onFailed(
        job(data),
        new Error('job stalled more than allowable limit'),
      );

      expect(reportRepo.update).toHaveBeenCalledWith(
        { id: 'rep-6', status: 'queued' },
        { status: 'failed', error: 'job stalled more than allowable limit' },
      );
      const env = realtime.publish.mock.calls[0][0];
      expect(env.type).toBe('REPORT_READY');
      expect(env.payload.reportReady).toEqual({
        reportId: 'rep-6',
        projectId: 'p1',
        reportKind: 'scanner_type',
        status: 'failed',
      });
    });

    it('does not publish when the row is already terminal (ready/failed)', async () => {
      reportRepo.update.mockResolvedValueOnce({ affected: 0 });

      await processor.onFailed(
        job(data),
        new Error('job stalled more than allowable limit'),
      );

      expect(realtime.publish).not.toHaveBeenCalled();
    });

    it('ignores queue failures without a job payload', async () => {
      await processor.onFailed(undefined, new Error('boom'));

      expect(reportRepo.update).not.toHaveBeenCalled();
      expect(realtime.publish).not.toHaveBeenCalled();
    });

    it('never throws when the DB update fails', async () => {
      reportRepo.update.mockRejectedValueOnce(new Error('db down'));

      await expect(
        processor.onFailed(job(data), new Error('stalled')),
      ).resolves.toBeUndefined();

      expect(realtime.publish).not.toHaveBeenCalled();
    });
  });
});
