import { Job } from 'bullmq';
import { AggregatedReportsQueueProcessor } from './aggregated-reports-queue.processor';
import { AggregatedReportJobData } from '../scan-queue.service';

describe('AggregatedReportsQueueProcessor', () => {
  let processor: AggregatedReportsQueueProcessor;
  let aggregatedReports: {
    runAggregatedReport: jest.Mock;
    markFailedFromQueue: jest.Mock;
  };
  let asyncTaskStore: { update: jest.Mock; markTerminal: jest.Mock };
  let realtime: { publish: jest.Mock };

  const data: AggregatedReportJobData = {
    reportId: 'agg-1',
    scopeType: 'organization',
    scopeId: 'org-1',
    organizationId: 'org-1',
    reportType: 'owasp',
    format: 'pdf',
    detailed: true,
    branchFilter: 'all',
    projectBranchSelections: [],
    userId: 'u1',
  };

  const job = (d: AggregatedReportJobData): Job<AggregatedReportJobData> =>
    ({
      id: 'aggregated-report-agg-1',
      data: d,
    }) as unknown as Job<AggregatedReportJobData>;

  beforeEach(() => {
    aggregatedReports = {
      runAggregatedReport: jest.fn().mockResolvedValue(undefined),
      markFailedFromQueue: jest.fn().mockResolvedValue(true),
    };
    asyncTaskStore = { update: jest.fn(), markTerminal: jest.fn() };
    realtime = { publish: jest.fn() };
    processor = new AggregatedReportsQueueProcessor(
      aggregatedReports as any,
      { findOne: jest.fn().mockResolvedValue(null) } as any,
      asyncTaskStore as any,
      realtime as any,
    );
  });

  it('process delegates to runAggregatedReport and swallows its errors', async () => {
    aggregatedReports.runAggregatedReport.mockRejectedValueOnce(
      new Error('boom'),
    );

    await expect(processor.process(job(data))).resolves.toBeUndefined();
    expect(aggregatedReports.runAggregatedReport).toHaveBeenCalledWith(data);
  });

  describe('onFailed (queue-level failure, e.g. stall after a worker crash)', () => {
    it('delegates the failure to the service with the queue error message', async () => {
      await processor.onFailed(
        job(data),
        new Error('job stalled more than allowable limit'),
      );

      expect(aggregatedReports.markFailedFromQueue).toHaveBeenCalledWith(
        data,
        'job stalled more than allowable limit',
      );
    });

    it('ignores queue failures without a job payload', async () => {
      await processor.onFailed(undefined, new Error('boom'));

      expect(aggregatedReports.markFailedFromQueue).not.toHaveBeenCalled();
    });

    it('never throws when the service rejects', async () => {
      aggregatedReports.markFailedFromQueue.mockRejectedValueOnce(
        new Error('db down'),
      );

      await expect(
        processor.onFailed(job(data), new Error('stalled')),
      ).resolves.toBeUndefined();
    });

    it('settles the widget task as failed only when it did the queued→failed transition', async () => {
      const dataWithTask = { ...data, taskId: 'task-1' };
      aggregatedReports.markFailedFromQueue.mockResolvedValueOnce(true);

      await processor.onFailed(job(dataWithTask), new Error('stalled'));

      expect(asyncTaskStore.markTerminal).toHaveBeenCalledWith(
        'task-1',
        expect.objectContaining({ status: 'failed' }),
        expect.any(Number),
      );
    });

    it('does NOT settle the widget task when the row was no longer queued (stall after a successful render)', async () => {
      // The job's process() already succeeded: the row is "ready" and the task
      // was marked "completed" by settleTask. markFailedFromQueue returns false
      // (the guarded queued→failed update matched nothing), so completeTask must
      // not run and clobber the completed task into a spurious failure.
      const dataWithTask = { ...data, taskId: 'task-1' };
      aggregatedReports.markFailedFromQueue.mockResolvedValueOnce(false);

      await processor.onFailed(job(dataWithTask), new Error('stalled'));

      expect(asyncTaskStore.markTerminal).not.toHaveBeenCalled();
      expect(realtime.publish).not.toHaveBeenCalled();
    });
  });

  describe('settleTask (post-render row read)', () => {
    const dataWithTask = { ...data, taskId: 'task-1' };

    it('marks the widget task completed with the deep-link when the row is ready', async () => {
      const proc = new AggregatedReportsQueueProcessor(
        aggregatedReports as any,
        { findOne: jest.fn().mockResolvedValue({ status: 'ready' }) } as any,
        asyncTaskStore as any,
        realtime as any,
      );

      await proc.process(job(dataWithTask));

      expect(asyncTaskStore.markTerminal).toHaveBeenCalledWith(
        'task-1',
        expect.objectContaining({
          status: 'completed',
          resultUrl: '/reports?reportId=agg-1',
        }),
        expect.any(Number),
      );
    });

    it('does NOT mark the task failed when the post-render row read throws (transient DB blip)', async () => {
      // The render already settled the row + fired its event before settleTask;
      // a transient read failure must not mislabel a generated report as failed.
      const proc = new AggregatedReportsQueueProcessor(
        aggregatedReports as any,
        {
          findOne: jest.fn().mockRejectedValue(new Error('pool exhausted')),
        } as any,
        asyncTaskStore as any,
        realtime as any,
      );

      await expect(proc.process(job(dataWithTask))).resolves.toBeUndefined();
      expect(asyncTaskStore.markTerminal).not.toHaveBeenCalled();
    });
  });
});
