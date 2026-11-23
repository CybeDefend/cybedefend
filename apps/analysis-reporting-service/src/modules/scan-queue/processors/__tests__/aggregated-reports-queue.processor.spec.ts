import { AggregatedReportsQueueProcessor } from '../aggregated-reports-queue.processor';
import { AggregatedReportJobData } from '../../scan-queue.service';

describe('AggregatedReportsQueueProcessor', () => {
  const jobData: AggregatedReportJobData = {
    reportId: 'r1',
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

  it('delegates the job to runAggregatedReport', async () => {
    const run = jest.fn().mockResolvedValue(undefined);
    const proc = new AggregatedReportsQueueProcessor(
      { runAggregatedReport: run } as any,
      { findOne: jest.fn().mockResolvedValue(null) } as any,
      { update: jest.fn(), markTerminal: jest.fn() } as any,
      { publish: jest.fn() } as any,
    );
    await proc.process({ id: '1', data: jobData } as any);
    expect(run).toHaveBeenCalledWith(jobData);
  });

  it('swallows errors (terminal failure) and does not re-throw', async () => {
    const run = jest.fn().mockRejectedValue(new Error('boom'));
    const proc = new AggregatedReportsQueueProcessor(
      { runAggregatedReport: run } as any,
      { findOne: jest.fn().mockResolvedValue(null) } as any,
      { update: jest.fn(), markTerminal: jest.fn() } as any,
      { publish: jest.fn() } as any,
    );
    await expect(
      proc.process({ id: '1', data: jobData } as any),
    ).resolves.toBeUndefined();
  });
});
