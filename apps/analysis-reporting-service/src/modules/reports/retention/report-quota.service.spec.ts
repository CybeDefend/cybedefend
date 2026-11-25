import { status } from '@grpc/grpc-js';
import { In, LessThanOrEqual } from 'typeorm';
import {
  DEFAULT_MAX_IN_FLIGHT_REPORTS_PER_ORG,
  maxInFlightReportsPerOrg,
  ReportQuotaService,
} from './report-quota.service';
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

  it('counts queued and ready reports for the org (generated + aggregated, expiry-aware)', async () => {
    const { svc, generatedRepo, aggregatedRepo } = build({
      max: 500,
      gCount: 1,
      aCount: 1,
    });
    await svc.assertWithinQuotaForOrg('org-1');
    for (const repo of [generatedRepo, aggregatedRepo]) {
      const where = repo.count.mock.calls[0][0].where;
      expect(Array.isArray(where)).toBe(true); // (expiresAt IS NULL) OR (> now)
      expect(where[0]).toMatchObject({
        organizationId: 'org-1',
        status: In(['queued', 'ready']),
      });
    }
  });

  describe('admitQueuedReport', () => {
    const counting = (generated: number[], aggregated: number[]) => {
      const built = build({});
      built.generatedRepo.count = jest.fn(() =>
        Promise.resolve(generated.shift() ?? 0),
      );
      built.aggregatedRepo.count = jest.fn(() =>
        Promise.resolve(aggregated.shift() ?? 0),
      );
      return built;
    };

    it('inserts the row when the org is below the cap', async () => {
      const { svc } = counting([1, 2], [1, 1]);
      const insert = jest.fn().mockResolvedValue(undefined);
      const remove = jest.fn().mockResolvedValue(undefined);
      await svc.admitQueuedReport('org-1', insert, remove);
      expect(insert).toHaveBeenCalledTimes(1);
      expect(remove).not.toHaveBeenCalled();
    });

    it('refuses before inserting when the org is at the cap', async () => {
      const { svc } = counting([2], [1]);
      const insert = jest.fn();
      await expect(
        svc.admitQueuedReport('org-1', insert, jest.fn()),
      ).rejects.toMatchObject({ error: { code: status.RESOURCE_EXHAUSTED } });
      expect(insert).not.toHaveBeenCalled();
    });

    it('removes its own row and refuses when a concurrent insert went past the cap', async () => {
      const { svc } = counting([1, 3], [1, 1]);
      const insert = jest.fn().mockResolvedValue(undefined);
      const remove = jest.fn().mockResolvedValue(undefined);
      await expect(
        svc.admitQueuedReport('org-1', insert, remove),
      ).rejects.toMatchObject({ error: { code: status.RESOURCE_EXHAUSTED } });
      expect(remove).toHaveBeenCalledTimes(1);
    });

    it('counts the recent queued rows of the org, then ranks its own row by id', async () => {
      const { svc, generatedRepo, aggregatedRepo } = counting([0, 1], [0, 0]);
      const insert = jest.fn().mockResolvedValue(undefined);
      const id = await svc.admitQueuedReport('org-1', insert, jest.fn());

      expect(insert).toHaveBeenCalledWith(id);
      for (const repo of [generatedRepo, aggregatedRepo]) {
        const [first, second] = repo.count.mock.calls.map(
          (c: any[]) => c[0].where,
        );
        expect(first).toMatchObject({
          organizationId: 'org-1',
          status: 'queued',
        });
        // A queued row older than the stale threshold is not in flight.
        expect(first.createdAt).toBeDefined();
        expect(first.id).toBeUndefined();
        // The rank: the rows up to the new report's id.
        expect(second.id).toEqual(LessThanOrEqual(id));
      }
    });

    it('returns time-ordered ids', async () => {
      const { svc } = counting([], []);
      const a = await svc.admitQueuedReport(null, jest.fn(), jest.fn());
      const b = await svc.admitQueuedReport(null, jest.fn(), jest.fn());
      expect(a < b).toBe(true);
    });

    it('applies no cap without an org', async () => {
      const { svc, generatedRepo } = counting([], []);
      const insert = jest.fn().mockResolvedValue(undefined);
      await svc.admitQueuedReport(null, insert, jest.fn());
      expect(insert).toHaveBeenCalledTimes(1);
      expect(generatedRepo.count).not.toHaveBeenCalled();
    });
  });

  describe('maxInFlightReportsPerOrg', () => {
    it('defaults to 3 and reads a positive integer override', () => {
      expect(DEFAULT_MAX_IN_FLIGHT_REPORTS_PER_ORG).toBe(3);
      expect(maxInFlightReportsPerOrg({})).toBe(3);
      expect(
        maxInFlightReportsPerOrg({ REPORTS_MAX_IN_FLIGHT_PER_ORG: '5' }),
      ).toBe(5);
      for (const bad of ['0', '-1', 'x', '2.5', '']) {
        expect(
          maxInFlightReportsPerOrg({ REPORTS_MAX_IN_FLIGHT_PER_ORG: bad }),
        ).toBe(3);
      }
    });
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
