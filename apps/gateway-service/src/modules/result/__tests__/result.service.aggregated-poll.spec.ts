import { ResultService } from '../result.service';
import { of } from 'rxjs';

describe('ResultService.getGeneratedAggregatedReport', () => {
  it('calls the gRPC client with the scope request and returns its response', async () => {
    const client = {
      getGeneratedAggregatedReport: jest
        .fn()
        .mockReturnValue(of({ reportId: 'r1', status: 'ready' })),
    };
    const svc = new ResultService({} as any, {} as any, {} as any, {} as any);
    (svc as any).resultServiceClient = client;
    const res = await svc.getGeneratedAggregatedReport(
      'organization',
      'org-1',
      'r1',
      'org-1',
    );
    expect(client.getGeneratedAggregatedReport).toHaveBeenCalledWith(
      expect.objectContaining({
        scopeType: 'organization',
        scopeId: 'org-1',
        reportId: 'r1',
        organizationId: 'org-1',
      }),
    );
    expect(res.status).toBe('ready');
  });

  it('passes empty organizationId for team scope', async () => {
    const client = {
      getGeneratedAggregatedReport: jest
        .fn()
        .mockReturnValue(of({ reportId: 'r2', status: 'queued' })),
    };
    const svc = new ResultService({} as any, {} as any, {} as any, {} as any);
    (svc as any).resultServiceClient = client;
    await svc.getGeneratedAggregatedReport('team', 'team-1', 'r2', '');
    expect(client.getGeneratedAggregatedReport).toHaveBeenCalledWith(
      expect.objectContaining({
        scopeType: 'team',
        scopeId: 'team-1',
        reportId: 'r2',
        organizationId: '',
      }),
    );
  });
});
