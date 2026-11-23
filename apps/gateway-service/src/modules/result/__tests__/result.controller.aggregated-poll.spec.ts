import { ResultController } from '../result.controller';

describe('aggregated report poll routes', () => {
  let resultService: { getGeneratedAggregatedReport: jest.Mock };
  let ctrl: ResultController;

  beforeEach(() => {
    resultService = {
      getGeneratedAggregatedReport: jest
        .fn()
        .mockResolvedValue({ status: 'ready' }),
    };
    // Instantiate with resultService + a logger stub (the poll handlers log an
    // audit line); remaining deps are unused in these tests.
    ctrl = new ResultController(
      resultService as any,
      { log: jest.fn() } as any,
      undefined as any,
      undefined as any,
    );
  });

  it('org route delegates with organization scope', async () => {
    const req = { user: { sub: 'u1' } };
    const res = await ctrl.getGeneratedOrganizationReport(
      req as any,
      'org-1',
      'r1',
    );
    expect(resultService.getGeneratedAggregatedReport).toHaveBeenCalledWith(
      'organization',
      'org-1',
      'r1',
      'org-1',
    );
    expect(res).toEqual({ status: 'ready' });
  });

  it('team route delegates with team scope and empty organizationId', async () => {
    const req = { user: { sub: 'u1' } };
    const res = await ctrl.getGeneratedTeamReport(req as any, 'team-1', 'r2');
    expect(resultService.getGeneratedAggregatedReport).toHaveBeenCalledWith(
      'team',
      'team-1',
      'r2',
      '',
    );
    expect(res).toEqual({ status: 'ready' });
  });
});
