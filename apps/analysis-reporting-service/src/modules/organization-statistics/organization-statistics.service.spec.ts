import { of } from 'rxjs';
import {
  OrganizationStatisticsService,
  statsRecordFromMainStatistics,
  mainStatisticsFromRecord,
} from './organization-statistics.service';

function makeService() {
  const repo = {
    markDirty: jest.fn().mockResolvedValue(undefined),
    markDirtyIfPresent: jest.fn().mockResolvedValue(true),
    findByOrgId: jest.fn(),
    readTimings: jest.fn(),
    finishCompute: jest.fn(),
    saveInitial: jest.fn().mockResolvedValue(undefined),
  };
  const enqueuer = { enqueueDrain: jest.fn().mockResolvedValue(undefined) };
  const orgClient = { getOrganizationIdByProjectId: jest.fn() };
  const projectClient = { getOrganizationProjectIds: jest.fn() };
  const gmClient = {
    getService: jest.fn((name: string) =>
      name === 'ProjectService' ? projectClient : orgClient,
    ),
  };
  const svc = new OrganizationStatisticsService(
    gmClient as any,
    repo as any,
    enqueuer as any,
  );
  svc.onModuleInit();
  return { svc, repo, enqueuer, orgClient, projectClient };
}

describe('OrganizationStatisticsService', () => {
  describe('markDirtyForProject', () => {
    it('resolves the org, marks dirty, and schedules the debounced drain', async () => {
      const { svc, repo, enqueuer, orgClient } = makeService();
      orgClient.getOrganizationIdByProjectId.mockReturnValue(
        of({ organizationId: 'org-1' }),
      );

      await svc.markDirtyForProject('p1');

      expect(repo.markDirty).toHaveBeenCalledWith('org-1');
      expect(enqueuer.enqueueDrain).toHaveBeenCalledWith('org-1', 3000);
    });

    it('caches projectId -> orgId (resolves once across calls)', async () => {
      const { svc, orgClient } = makeService();
      orgClient.getOrganizationIdByProjectId.mockReturnValue(
        of({ organizationId: 'org-1' }),
      );

      await svc.markDirtyForProject('p1');
      await svc.markDirtyForProject('p1');

      expect(orgClient.getOrganizationIdByProjectId).toHaveBeenCalledTimes(1);
    });

    it('never throws when the org cannot be resolved (best-effort)', async () => {
      const { svc, repo, orgClient } = makeService();
      orgClient.getOrganizationIdByProjectId.mockReturnValue(of({}));

      await expect(svc.markDirtyForProject('p1')).resolves.toBeUndefined();
      expect(repo.markDirty).not.toHaveBeenCalled();
    });
  });

  describe('markDirtyIfPresent (data purge)', () => {
    it('marks and schedules the drain when the row exists', async () => {
      const { svc, repo, enqueuer } = makeService();
      repo.markDirtyIfPresent.mockResolvedValue(true);

      await svc.markDirtyIfPresent('org-1');

      expect(repo.markDirtyIfPresent).toHaveBeenCalledWith('org-1');
      expect(repo.markDirty).not.toHaveBeenCalled();
      expect(enqueuer.enqueueDrain).toHaveBeenCalledWith('org-1', 3000);
    });

    it('never inserts a row nor schedules a drain for an organization without one', async () => {
      const { svc, repo, enqueuer } = makeService();
      repo.markDirtyIfPresent.mockResolvedValue(false);

      await svc.markDirtyIfPresent('org-1');

      expect(repo.markDirty).not.toHaveBeenCalled();
      expect(enqueuer.enqueueDrain).not.toHaveBeenCalled();
    });

    it('propagates a failure (the purge logs it)', async () => {
      const { svc, repo } = makeService();
      repo.markDirtyIfPresent.mockRejectedValue(new Error('db down'));
      await expect(svc.markDirtyIfPresent('org-1')).rejects.toThrow('db down');
    });
  });

  describe('readPersisted', () => {
    it('maps a persisted row into the gRPC response', async () => {
      const { svc, repo } = makeService();
      repo.findByOrgId.mockResolvedValue({
        stats: { criticalIssues: 5, highIssues: 2 },
      });

      const res = await svc.readPersisted('org-1');

      expect(res?.criticalIssues).toBe(5);
      expect(res?.highIssues).toBe(2);
    });

    it('returns null when the org has no persisted stats yet', async () => {
      const { svc, repo } = makeService();
      repo.findByOrgId.mockResolvedValue(null);
      expect(await svc.readPersisted('org-1')).toBeNull();

      repo.findByOrgId.mockResolvedValue({ stats: null });
      expect(await svc.readPersisted('org-1')).toBeNull();
    });
  });

  describe('resolveProjectIds', () => {
    it('returns the system-scope project IDs of the org', async () => {
      const { svc, projectClient } = makeService();
      projectClient.getOrganizationProjectIds.mockReturnValue(
        of({ projectIds: ['a', 'b'] }),
      );
      expect(await svc.resolveProjectIds('org-1')).toEqual(['a', 'b']);
    });
  });
});

describe('org-statistics pure mappers', () => {
  it('statsRecordFromMainStatistics zero-fills every KPI key', () => {
    const rec = statsRecordFromMainStatistics({ criticalIssues: 7 } as any);
    expect(rec.criticalIssues).toBe(7);
    expect(rec.highIssues).toBe(0);
    expect(rec.agentTriageCount).toBe(0);
  });

  it('mainStatisticsFromRecord round-trips and zero-fills missing keys', () => {
    const res = mainStatisticsFromRecord({ criticalIssues: 7 });
    expect(res.criticalIssues).toBe(7);
    expect(res.lowIssues).toBe(0);
    expect((res as any).projectIds).toEqual([]);
  });
});
