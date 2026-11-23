import {
  ScanQueueService,
  AggregatedReportJobData,
} from '../scan-queue.service';
import { QUEUE_NAMES } from '../queue-names';

describe('ScanQueueService.addAggregatedReportJob', () => {
  it('enqueues an aggregated report job with a stable jobId and attempts=1', async () => {
    const add = jest.fn().mockResolvedValue(undefined);
    // Only the aggregated queue is exercised here.
    const svc = new (ScanQueueService as any)();
    (svc as any).aggregatedReportsQueue = { add };

    const data: AggregatedReportJobData = {
      reportId: '01HZX',
      scopeType: 'organization',
      scopeId: 'org-1',
      organizationId: 'org-1',
      reportType: 'owasp',
      format: 'pdf',
      detailed: true,
      branchFilter: 'all',
      projectBranchSelections: [],
      userId: 'user-1',
    };
    await svc.addAggregatedReportJob(data);

    expect(QUEUE_NAMES.AGGREGATED_REPORTS).toBe('aggregated-reports-queue');
    expect(add).toHaveBeenCalledWith(
      'aggregated-report',
      data,
      expect.objectContaining({
        jobId: 'aggregated-report-01HZX',
        attempts: 1,
      }),
    );
  });
});
