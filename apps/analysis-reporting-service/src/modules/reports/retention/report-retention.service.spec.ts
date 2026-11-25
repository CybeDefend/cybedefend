import { ReportRetentionService } from './report-retention.service';
import type { AnalysisReportingEntitlementsPort } from 'src/edition/ports/entitlements.port';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('ReportRetentionService.computeExpiresAt', () => {
  const NOW = Date.UTC(2026, 0, 1, 12, 0, 0); // fixed clock

  const makeService = (overrides: {
    entitlements?: any;
    entitlementsError?: boolean;
    orgId?: string | null;
  }) => {
    const entitlements = {
      getEntitlements: jest.fn(() =>
        overrides.entitlementsError
          ? Promise.reject(new Error('billing down'))
          : Promise.resolve(overrides.entitlements),
      ),
    };
    const projectOrgResolver = {
      resolveOrgId: jest
        .fn()
        .mockResolvedValue(
          overrides.orgId === undefined ? 'org-1' : overrides.orgId,
        ),
    } as any;
    const logger = { warn: jest.fn(), log: jest.fn(), error: jest.fn() } as any;
    const svc = new ReportRetentionService(
      entitlements as unknown as AnalysisReportingEntitlementsPort,
      projectOrgResolver,
      {} as any, // generatedRepo (unused here)
      {} as any, // aggregatedRepo (unused here)
      {} as any, // reportUpload (unused here)
      logger,
    );
    return { svc, entitlements, projectOrgResolver };
  };

  it('computeExpiresAt: retentionDays > 0 → now + days', () => {
    const { svc } = makeService({});
    expect(svc.computeExpiresAt(90, NOW)?.getTime()).toBe(NOW + 90 * DAY_MS);
  });

  it('computeExpiresAt: -1 (unlimited) → null', () => {
    const { svc } = makeService({});
    expect(svc.computeExpiresAt(-1, NOW)).toBeNull();
  });

  it('computeExpiresAt: 0 → null (never-expire, fail-safe; NOT immediate expiry)', () => {
    const { svc } = makeService({});
    // A stray 0 override must not make every report expire at `now` (which the
    // periodic purge would then delete). Symmetric with the quota `max <= 0` guard.
    expect(svc.computeExpiresAt(0, NOW)).toBeNull();
  });

  it('computeExpiresAt: null (entitlements unavailable) → null (fail-open keep)', () => {
    const { svc } = makeService({});
    expect(svc.computeExpiresAt(null, NOW)).toBeNull();
  });

  it('computeExpiresAtForOrg: reads reportRetentionDays from entitlements', async () => {
    const { svc, entitlements } = makeService({
      entitlements: { reportRetentionDays: 90, maxStoredReports: 500 },
    });
    const exp = await svc.computeExpiresAtForOrg('org-1', NOW);
    expect(exp?.getTime()).toBe(NOW + 90 * DAY_MS);
    expect(entitlements.getEntitlements).toHaveBeenCalledWith('org-1');
  });

  it('computeExpiresAtForOrg: billing failure → null (never wrongly purge)', async () => {
    const { svc } = makeService({ entitlementsError: true });
    expect(await svc.computeExpiresAtForOrg('org-1', NOW)).toBeNull();
  });

  it('computeExpiresAtForOrg: null orgId → null (no billing call)', async () => {
    const { svc, entitlements } = makeService({});
    expect(await svc.computeExpiresAtForOrg(null, NOW)).toBeNull();
    expect(entitlements.getEntitlements).not.toHaveBeenCalled();
  });

  it('computeExpiresAtForProject: resolves orgId then computes expiry', async () => {
    const { svc } = makeService({
      orgId: 'org-7',
      entitlements: { reportRetentionDays: 365, maxStoredReports: 1000 },
    });
    const res = await svc.computeExpiresAtForProject('proj-1', NOW);
    expect(res.organizationId).toBe('org-7');
    expect(res.expiresAt?.getTime()).toBe(NOW + 365 * DAY_MS);
  });
});

describe('ReportRetentionService.purgeExpired', () => {
  // Extract the id list excluded by a `Not(In([...]))` where.id operator, so the
  // stateful mock can honour purgeRows' poison-row quarantine. Walk nested
  // TypeORM FindOperators (`.value`) down to the underlying array rather than
  // hard-coding the exact nesting depth.
  const excludedIds = (where: any): Set<string> => {
    let v: any = where?.id;
    for (
      let i = 0;
      v && typeof v === 'object' && !Array.isArray(v) && i < 5;
      i++
    ) {
      v = v.value;
    }
    return new Set<string>(Array.isArray(v) ? v : []);
  };

  const build = (over: {
    generated?: any[];
    aggregated?: any[];
    deleteReport?: jest.Mock;
  }) => {
    // Stateful repos: `delete` removes the row and `find` reflects deletions +
    // the Not(In(...)) exclusion, so purgeRows' drain-until-empty loop
    // terminates exactly like against a real DB.
    const state: Record<string, any[]> = {
      generated: [...(over.generated ?? [])],
      aggregated: [...(over.aggregated ?? [])],
    };
    const makeRepo = (key: string) => ({
      find: jest.fn(async ({ where, take }: any) => {
        const ex = excludedIds(where);
        return state[key].filter((r) => !ex.has(r.id)).slice(0, take ?? 500);
      }),
      delete: jest.fn(async ({ id }: any) => {
        state[key] = state[key].filter((r) => r.id !== id);
        return { affected: 1 };
      }),
    });
    const generatedRepo = makeRepo('generated');
    const aggregatedRepo = makeRepo('aggregated');
    const reportUpload = {
      deleteReport: over.deleteReport ?? jest.fn().mockResolvedValue(undefined),
    };
    const logger = { warn: jest.fn(), log: jest.fn(), error: jest.fn() } as any;
    const svc = new ReportRetentionService(
      {} as any, // entitlements (unused by purge/failStaleQueued)
      {} as any,
      generatedRepo as any,
      aggregatedRepo as any,
      reportUpload as any,
      logger,
    );
    return { svc, generatedRepo, aggregatedRepo, reportUpload };
  };

  it('deletes the GCS object then the row for each expired generated report', async () => {
    const { svc, generatedRepo, reportUpload } = build({
      generated: [
        { id: 'r1', projectId: 'p1', objectPath: 'reports/p1/r1.pdf' },
      ],
    });
    const res = await svc.purgeExpired();
    expect(reportUpload.deleteReport).toHaveBeenCalledWith(
      'reports/p1/r1.pdf',
      'p1',
    );
    expect(generatedRepo.delete).toHaveBeenCalledWith({ id: 'r1' });
    expect(res.generated).toBe(1);
  });

  it('keeps the row when the object delete fails (no orphan), excluded from count', async () => {
    const { svc, generatedRepo } = build({
      generated: [
        { id: 'r1', projectId: 'p1', objectPath: 'reports/p1/r1.pdf' },
      ],
      deleteReport: jest.fn().mockRejectedValue(new Error('gcs down')),
    });
    const res = await svc.purgeExpired();
    expect(generatedRepo.delete).not.toHaveBeenCalled();
    expect(res.generated).toBe(0);
  });

  it('deletes the row even when there is no objectPath (queued/failed, never uploaded)', async () => {
    const { svc, generatedRepo, reportUpload } = build({
      generated: [{ id: 'r1', projectId: 'p1', objectPath: null }],
    });
    const res = await svc.purgeExpired();
    expect(reportUpload.deleteReport).not.toHaveBeenCalled();
    expect(generatedRepo.delete).toHaveBeenCalledWith({ id: 'r1' });
    expect(res.generated).toBe(1);
  });

  it('purges expired aggregated reports using the path tenant segment', async () => {
    const { svc, aggregatedRepo, reportUpload } = build({
      aggregated: [
        {
          id: 'a1',
          organizationId: 'org-1',
          objectPath: 'reports/org-1/a1.pdf',
        },
      ],
    });
    const res = await svc.purgeExpired();
    expect(reportUpload.deleteReport).toHaveBeenCalledWith(
      'reports/org-1/a1.pdf',
      'org-1',
    );
    expect(aggregatedRepo.delete).toHaveBeenCalledWith({ id: 'a1' });
    expect(res.aggregated).toBe(1);
  });

  it('only selects rows whose expiresAt is in the past', async () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const { svc, generatedRepo } = build({});
    await svc.purgeExpired({ now });
    const arg = generatedRepo.find.mock.calls[0][0];
    expect(arg.where.expiresAt).toBeDefined();
    expect(arg.take).toBeGreaterThan(0);
  });

  it('a permanently-failing "poison" row never starves the rest of the batch', async () => {
    // batchSize=2 with 4 expired rows, the first of which always fails its
    // object delete. The old single-fetch loop would re-fetch the poison row in
    // the same window on every pass and could leave later rows unpurged; the
    // drain-until-empty loop quarantines the poison row and still purges all 3
    // healthy rows (and terminates).
    const deleteReport = jest.fn(async (path: string) => {
      if (path.includes('poison')) throw new Error('permanent gcs failure');
    });
    const { svc, generatedRepo } = build({
      generated: [
        { id: 'poison', projectId: 'p1', objectPath: 'reports/p1/poison.pdf' },
        { id: 'r2', projectId: 'p1', objectPath: 'reports/p1/r2.pdf' },
        { id: 'r3', projectId: 'p1', objectPath: 'reports/p1/r3.pdf' },
        { id: 'r4', projectId: 'p1', objectPath: 'reports/p1/r4.pdf' },
      ],
      deleteReport,
    });

    const res = await svc.purgeExpired({ batchSize: 2 });

    expect(res.generated).toBe(3);
    expect(
      generatedRepo.delete.mock.calls.map((c: any) => c[0].id).sort(),
    ).toEqual(['r2', 'r3', 'r4']);
    // The poison row was never deleted (kept for a future retry).
    expect(
      generatedRepo.delete.mock.calls.some((c: any) => c[0].id === 'poison'),
    ).toBe(false);
  });
});
