import { OrganizationOverviewFilter } from '@grpc/analysis-reporting/result';
import { OrganizationOverviewService } from './organization-overview.service';
import { OverviewCacheService } from './overview-cache.service';
import { ScanQueueService } from '../scan-queue/scan-queue.service';

/**
 * The organization overview blocks are cached for a short while. The cache
 * entry must follow the projects the caller may read at the time of the
 * call: a member who lost access to a project must not be served counts
 * computed while that project was still readable, and an unchanged caller
 * still reuses its entry.
 */
describe('organization overview cache follows the readable projects', () => {
  type Readable = { projectId: string; teamId: string }[];
  let readable: Readable;
  let service: OrganizationOverviewService;
  let severityComputations: number;
  let stateComputations: number;
  let overTimeComputations: number;

  beforeEach(() => {
    const store = new Map<string, string>();
    const redis = {
      get: jest.fn((k: string) => Promise.resolve(store.get(k) ?? null)),
      set: jest.fn((k: string, v: string) => {
        store.set(k, v);
        return Promise.resolve('OK');
      }),
    };
    const cache = new OverviewCacheService({
      getRedisClient: async () => redis,
    } as unknown as ScanQueueService);

    readable = [];
    severityComputations = 0;
    stateComputations = 0;
    overTimeComputations = 0;
    service = Object.create(
      OrganizationOverviewService.prototype,
    ) as OrganizationOverviewService;
    const internals = service as unknown as Record<string, unknown>;
    internals.overviewCache = cache;
    // What global-management answers for the caller right now.
    internals.fetchOrganizationProjects = async () =>
      readable.map((p) => ({ ...p, name: p.projectId, teamName: p.teamId }));
    // One finding per readable project: the count shows the scope used.
    internals.aggregateSeverityByProjects = async (ctx: {
      projectIds: string[];
    }) => {
      severityComputations += 1;
      return [{ severity: 'HIGH', count: ctx.projectIds.length }];
    };
    internals.aggregateStateByProjects = async (ctx: {
      projectIds: string[];
    }) => {
      stateComputations += 1;
      return [{ state: 'to_verify', count: ctx.projectIds.length }];
    };
    internals.aggregateVulnerabilitiesOverTime = async (ctx: {
      projectIds: string[];
    }) => {
      overTimeComputations += 1;
      return [{ date: '2026-01-01', count: ctx.projectIds.length }];
    };
  });

  const filter = (userId: string): OrganizationOverviewFilter =>
    ({
      organizationId: 'org-1',
      userId,
      projectIds: [],
      teamIds: [],
      severityFilter: [],
      statusFilter: [],
      analysisTypes: [],
      branches: [],
    }) as unknown as OrganizationOverviewFilter;

  const severityCount = async (userId: string) =>
    (
      await service.getOrganizationSeverityDistribution({
        filter: filter(userId),
      })
    ).totalBySeverity[0]?.count;

  it('a member who lost a project gets counts without it at once', async () => {
    readable = [
      { projectId: 'p1', teamId: 't1' },
      { projectId: 'p2', teamId: 't1' },
      { projectId: 'p3', teamId: 't2' },
    ];
    expect(await severityCount('user-A')).toBe(3);

    readable = readable.filter((p) => p.projectId !== 'p3');
    expect(await severityCount('user-A')).toBe(2);
  });

  it('the state and over-time blocks follow the readable projects too', async () => {
    readable = [
      { projectId: 'p1', teamId: 't1' },
      { projectId: 'p2', teamId: 't1' },
    ];
    const state = () =>
      service.getOrganizationStateDistribution({ filter: filter('user-A') });
    const overTime = () =>
      service.getOrganizationVulnerabilitiesOverTime({
        filter: filter('user-A'),
        trendPeriodDays: 30,
      } as never);
    await state();
    await overTime();

    readable = [{ projectId: 'p1', teamId: 't1' }];
    expect((await state()).totalByState[0].count).toBe(1);
    expect((await overTime()).vulnerabilitiesOverTime[0].count).toBe(1);
    expect(stateComputations).toBe(2);
    expect(overTimeComputations).toBe(2);
  });

  it('an unchanged caller reuses its own entry', async () => {
    readable = [
      { projectId: 'p1', teamId: 't1' },
      { projectId: 'p2', teamId: 't1' },
    ];
    await severityCount('user-A');
    readable = [...readable].reverse();
    expect(await severityCount('user-A')).toBe(2);
    expect(severityComputations).toBe(1);
  });
});
