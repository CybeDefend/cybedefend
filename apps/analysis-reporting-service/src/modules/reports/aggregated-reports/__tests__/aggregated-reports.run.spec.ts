import { AggregatedReportsService } from '../aggregated-reports.service';
import { AggregatedReportJobData } from '../../../scan-queue/scan-queue.service';

const baseJob: AggregatedReportJobData = {
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

function make() {
  const repo = { update: jest.fn().mockResolvedValue(undefined) };
  const agg = {
    getOrganizationProjects: jest.fn().mockResolvedValue(['p1', 'p2']),
    getOrganizationMetadata: jest.fn().mockResolvedValue({ name: 'Org' }),
    aggregateVulnerabilities: jest.fn().mockResolvedValue({
      summary: {},
      categories: [],
      vulnerabilities: [],
      projectsMetadata: [],
      projectBranchesMetadata: [],
    }),
    aggregateLicenseData: jest.fn().mockResolvedValue({
      summary: {},
      licenseCategories: {},
      packages: [{ packageName: 'a' }],
      projectRows: [{ projectName: 'P' }],
      projectsMetadata: [],
    }),
  };
  const builder = {
    buildReport: jest.fn().mockResolvedValue({
      content: Buffer.from('x'),
      filename: 'f.pdf',
      contentType: 'application/pdf',
    }),
  };
  const upload = {
    uploadReport: jest.fn().mockResolvedValue({
      objectPath: 'reports/org-1/abc.pdf',
      filename: 'f.pdf',
      contentType: 'application/pdf',
      downloadUrl: 'u',
      expiresAtMs: 1,
    }),
  };
  const realtime = { publish: jest.fn().mockResolvedValue(undefined) };
  const svc = new AggregatedReportsService(
    repo as any,
    agg as any,
    builder as any,
    upload as any,
    { log: jest.fn(), error: jest.fn(), warn: jest.fn() } as any,
    realtime as any,
  );
  return { svc, repo, upload, realtime, builder, agg };
}

describe('AggregatedReportsService.runAggregatedReport', () => {
  it('aggregates, builds, uploads under tenantKey, marks ready and publishes', async () => {
    const { svc, repo, upload, realtime } = make();
    await svc.runAggregatedReport(baseJob);
    expect(upload.uploadReport).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'org-1' }),
    );
    expect(repo.update).toHaveBeenCalledWith(
      'r1',
      expect.objectContaining({
        status: 'ready',
        objectPath: 'reports/org-1/abc.pdf',
      }),
    );
    expect(realtime.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'AGGREGATED_REPORT_READY',
        scope: expect.objectContaining({ organizationId: 'org-1' }),
      }),
    );
  });

  it('hands the branch filter to the report builder (shown on the cover)', async () => {
    const { svc, builder } = make();
    await svc.runAggregatedReport({ ...baseJob, branchFilter: 'reference' });
    expect(builder.buildReport).toHaveBeenCalledWith(
      expect.objectContaining({
        aggregatedData: expect.objectContaining({ branchFilter: 'reference' }),
      }),
    );
  });

  it('hands the per-package license inventory and per-project rows to the builder', async () => {
    const { svc, builder } = make();
    await svc.runAggregatedReport({ ...baseJob, reportType: 'license' });
    expect(builder.buildReport).toHaveBeenCalledWith(
      expect.objectContaining({
        aggregatedData: expect.objectContaining({
          packages: [{ packageName: 'a' }],
          projectRows: [{ projectName: 'P' }],
          branchFilter: 'all',
        }),
      }),
    );
  });

  it('marks failed + publishes failure when the build throws', async () => {
    const { svc, repo, realtime, builder } = make();
    builder.buildReport.mockRejectedValue(new Error('render boom'));
    await svc.runAggregatedReport(baseJob);
    expect(repo.update).toHaveBeenCalledWith(
      'r1',
      expect.objectContaining({ status: 'failed' }),
    );
    expect(realtime.publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'AGGREGATED_REPORT_READY' }),
    );
  });
});

describe('AggregatedReportsService.markFailedFromQueue', () => {
  it('fails a still-queued row and publishes AGGREGATED_REPORT_READY(failed)', async () => {
    const { svc, repo, realtime } = make();
    repo.update.mockResolvedValueOnce({ affected: 1 });

    await svc.markFailedFromQueue(
      baseJob,
      'job stalled more than allowable limit',
    );

    expect(repo.update).toHaveBeenCalledWith(
      { id: 'r1', status: 'queued' },
      { status: 'failed', error: 'job stalled more than allowable limit' },
    );
    expect(realtime.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'AGGREGATED_REPORT_READY',
        scope: expect.objectContaining({ organizationId: 'org-1' }),
        payload: {
          aggregatedReportReady: expect.objectContaining({
            reportId: 'r1',
            status: 'failed',
          }),
        },
      }),
    );
  });

  it('does not publish when the row is already terminal (ready/failed)', async () => {
    const { svc, repo, realtime } = make();
    repo.update.mockResolvedValueOnce({ affected: 0 });

    await svc.markFailedFromQueue(baseJob, 'stalled');

    expect(realtime.publish).not.toHaveBeenCalled();
  });
});
