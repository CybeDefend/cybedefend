import { AggregatedReportsService } from '../aggregated-reports.service';

function make(row: any) {
  const repo = { findOne: jest.fn().mockResolvedValue(row) };
  const upload = {
    signExisting: jest
      .fn()
      .mockResolvedValue({ downloadUrl: 'fresh', expiresAtMs: 999 }),
  };
  const svc = new AggregatedReportsService(
    repo as any,
    {} as any,
    {} as any,
    upload as any,
    { error: jest.fn() } as any,
    {} as any,
  );
  return { svc, upload };
}

describe('getGeneratedAggregatedReport', () => {
  it('signs a fresh URL when ready and scope matches', async () => {
    const { svc, upload } = make({
      id: 'r1',
      status: 'ready',
      reportType: 'owasp',
      scopeType: 'organization',
      scopeId: 'org-1',
      organizationId: 'org-1',
      format: 'pdf',
      filename: 'f.pdf',
      contentType: 'application/pdf',
      objectPath: 'reports/org-1/abc.pdf',
    });
    const res = await svc.getGeneratedAggregatedReport({
      scopeType: 'organization',
      scopeId: 'org-1',
      reportId: 'r1',
      organizationId: 'org-1',
    } as any);
    expect(upload.signExisting).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'org-1',
        objectPath: 'reports/org-1/abc.pdf',
      }),
    );
    expect(res.downloadUrl).toBe('fresh');
    expect(res.status).toBe('ready');
  });

  it('returns the error when failed', async () => {
    const { svc } = make({
      id: 'r1',
      status: 'failed',
      reportType: 'owasp',
      scopeType: 'organization',
      scopeId: 'org-1',
      organizationId: 'org-1',
      error: 'boom',
      format: 'pdf',
    });
    const res = await svc.getGeneratedAggregatedReport({
      scopeType: 'organization',
      scopeId: 'org-1',
      reportId: 'r1',
      organizationId: 'org-1',
    } as any);
    expect(res.status).toBe('failed');
    expect(res.error).toBe('boom');
  });

  it('throws NOT_FOUND when the row scope does not match', async () => {
    const { svc } = make({
      id: 'r1',
      status: 'ready',
      scopeType: 'organization',
      scopeId: 'org-1',
      organizationId: 'org-OTHER',
      objectPath: 'reports/org-OTHER/x.pdf',
      format: 'pdf',
    });
    await expect(
      svc.getGeneratedAggregatedReport({
        scopeType: 'organization',
        scopeId: 'org-1',
        reportId: 'r1',
        organizationId: 'org-1',
      } as any),
    ).rejects.toBeDefined();
  });
});

// A closed aggregated report (the EU AI Act one) is a kind an ee
// module registers under AGGREGATED_REPORT_KINDS; the service hands it the
// scope and builds what its generateData returns.
describe('aggregated report kinds', () => {
  it('serves a registered kind through its generateData', async () => {
    const kindData = {
      scopeType: 'organization',
      scopeName: 'Org',
      scopeId: 'org-1',
      reportType: 'custom-kind',
      generatedAt: '2026-11-03T00:00:00.000Z',
      projectsCount: 2,
      projectIds: ['p1', 'p2'],
      branchFilter: 'reference',
      summary: { total: 1 },
      categories: [],
      vulnerabilities: [],
      projectsMetadata: [],
      projectBranchesMetadata: [],
    };
    const kind = {
      reportType: 'custom-kind',
      title: 'Custom kind report',
      generateData: jest.fn().mockResolvedValue(kindData),
      render: jest.fn(),
    };
    const agg = {
      getOrganizationProjects: jest.fn().mockResolvedValue(['p1', 'p2']),
      getOrganizationMetadata: jest.fn().mockResolvedValue({ name: 'Org' }),
      aggregateVulnerabilities: jest.fn(),
      aggregateLicenseData: jest.fn(),
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
    const svc = new AggregatedReportsService(
      { update: jest.fn().mockResolvedValue(undefined) } as any,
      agg as any,
      builder as any,
      upload as any,
      { log: jest.fn(), error: jest.fn(), warn: jest.fn() } as any,
      { publish: jest.fn().mockResolvedValue(undefined) } as any,
      [kind],
    );

    await svc.runAggregatedReport({
      reportId: 'r1',
      scopeType: 'organization',
      scopeId: 'org-1',
      organizationId: 'org-1',
      reportType: 'custom-kind',
      format: 'pdf',
      detailed: true,
      branchFilter: 'reference',
      projectBranchSelections: [],
      userId: 'u1',
    });

    expect(kind.generateData).toHaveBeenCalledWith({
      scopeType: 'organization',
      scopeId: 'org-1',
      scopeName: 'Org',
      projectIds: ['p1', 'p2'],
      branchFilter: 'reference',
      projectBranchSelections: [],
    });
    expect(agg.aggregateVulnerabilities).not.toHaveBeenCalled();
    expect(builder.buildReport).toHaveBeenCalledWith(
      expect.objectContaining({
        reportType: 'custom-kind',
        aggregatedData: kindData,
      }),
    );
  });
});
