import { status } from '@grpc/grpc-js';
import { ReportQuotaService } from './report-quota.service';
import type { AnalysisReportingEntitlementsPort } from 'src/edition/ports/entitlements.port';

describe('ReportQuotaService', () => {
  const build = (over: {
    max?: number;
    entError?: boolean;
    gCount?: number;
    aCount?: number;
    orgId?: string | null;
  }) => {
    const entitlements = {
      getEntitlements: jest.fn(() =>
        over.entError
          ? Promise.reject(new Error('billing down'))
          : Promise.resolve({ maxStoredReports: over.max }),
      ),
    };
    const generatedRepo = {
      count: jest.fn().mockResolvedValue(over.gCount ?? 0),
    } as any;
    const aggregatedRepo = {
      count: jest.fn().mockResolvedValue(over.aCount ?? 0),
    } as any;
    const projectOrgResolver = {
      resolveOrgId: jest
        .fn()
        .mockResolvedValue(over.orgId === undefined ? 'org-1' : over.orgId),
    } as any;
    const logger = { warn: jest.fn(), log: jest.fn(), error: jest.fn() } as any;
    const svc = new ReportQuotaService(
      entitlements as unknown as AnalysisReportingEntitlementsPort,
      generatedRepo,
      aggregatedRepo,
      projectOrgResolver,
      logger,
    );
    return { svc, entitlements, generatedRepo, aggregatedRepo };
  };

  it('throws RESOURCE_EXHAUSTED when stored count >= max', async () => {
    const { svc } = build({ max: 500, gCount: 480, aCount: 20 }); // 500 >= 500
    await expect(svc.assertWithinQuotaForOrg('org-1')).rejects.toMatchObject({
      error: { code: status.RESOURCE_EXHAUSTED },
    });
  });

  it('passes when stored count is below max', async () => {
    const { svc } = build({ max: 500, gCount: 100, aCount: 50 });
    await expect(svc.assertWithinQuotaForOrg('org-1')).resolves.toBeUndefined();
  });

  it('unlimited (-1) never throws and skips counting', async () => {
    const { svc, generatedRepo } = build({ max: -1 });
    await svc.assertWithinQuotaForOrg('org-1');
    expect(generatedRepo.count).not.toHaveBeenCalled();
  });

  it('a 0 limit is treated as "not enforced" (never blocks all generation)', async () => {
    // No plan produces 0 (floor is 500) but a stray 0 override must not make
    // `count >= max` always-true and block every report. Fail-open like -1/null.
    const { svc, generatedRepo } = build({ max: 0, gCount: 5, aCount: 3 });
    await expect(svc.assertWithinQuotaForOrg('org-1')).resolves.toBeUndefined();
    expect(generatedRepo.count).not.toHaveBeenCalled();
  });

  it('billing failure → fail-open (allow generation)', async () => {
    const { svc } = build({ entError: true });
    await expect(svc.assertWithinQuotaForOrg('org-1')).resolves.toBeUndefined();
  });

  it('null orgId → allow (no billing call)', async () => {
    const { svc, entitlements } = build({});
    await svc.assertWithinQuotaForOrg(null);
    expect(entitlements.getEntitlements).not.toHaveBeenCalled();
  });

  it('counts only ready reports for the org (generated + aggregated, expiry-aware)', async () => {
    const { svc, generatedRepo, aggregatedRepo } = build({
      max: 500,
      gCount: 1,
      aCount: 1,
    });
    await svc.assertWithinQuotaForOrg('org-1');
    const gWhere = generatedRepo.count.mock.calls[0][0].where;
    expect(Array.isArray(gWhere)).toBe(true); // (expiresAt IS NULL) OR (> now)
    expect(gWhere[0]).toMatchObject({
      organizationId: 'org-1',
      status: 'ready',
    });
    expect(aggregatedRepo.count).toHaveBeenCalled();
  });

  it('assertWithinQuotaForProject resolves org then enforces', async () => {
    const { svc } = build({ orgId: 'org-9', max: 1, gCount: 1, aCount: 0 });
    await expect(svc.assertWithinQuotaForProject('p1')).rejects.toMatchObject({
      error: { code: status.RESOURCE_EXHAUSTED },
    });
  });

  it('getUsageForOrg returns the shared used (generated + aggregated) + limit', async () => {
    const { svc } = build({ max: 500, gCount: 18, aCount: 6 });
    await expect(svc.getUsageForOrg('org-1')).resolves.toEqual({
      used: 24,
      limit: 500,
    });
  });

  it('getUsageForOrg reports limit -1 when billing is unavailable', async () => {
    const { svc } = build({ entError: true, gCount: 3, aCount: 0 });
    await expect(svc.getUsageForOrg('org-1')).resolves.toEqual({
      used: 3,
      limit: -1,
    });
  });

  it('getUsageForProject resolves the project org → same shared usage', async () => {
    const { svc } = build({ orgId: 'org-9', max: 1000, gCount: 4, aCount: 5 });
    await expect(svc.getUsageForProject('p1')).resolves.toEqual({
      used: 9,
      limit: 1000,
    });
  });
});
