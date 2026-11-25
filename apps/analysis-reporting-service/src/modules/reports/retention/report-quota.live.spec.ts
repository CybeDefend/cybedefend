import { randomUUID } from 'node:crypto';
import { status } from '@grpc/grpc-js';
import { DataSource, Repository } from 'typeorm';
import Redis from 'ioredis';
import {
  createLiveDatabase,
  liveEnabled,
  type LiveDatabase,
} from '../../../core/db/live-database';
import { GeneratedReport } from '../../../entities/generated-report.entity';
import { AggregatedReport } from '../../../entities/aggregated-report.entity';
import type { AnalysisReportingEntitlementsPort } from '../../../edition/ports/entitlements.port';
import { ProjectReportEnqueuer } from '../shared/project-report-enqueuer.service';
import {
  DEFAULT_MAX_IN_FLIGHT_REPORTS_PER_ORG,
  ReportQuotaService,
} from './report-quota.service';
import { ReportRetentionService } from './report-retention.service';

/**
 * LIVE spec: report admission on both engines. The report workers are shared
 * by every organization, so one organization may only have a few reports
 * waiting or rendering at once, and a report holds a stored-report slot from
 * the moment it is queued.
 *
 * It also needs a Redis (RESULTS_IMPORT_REDIS_URL, default
 * redis://127.0.0.1:6379) for the admission lock.
 *
 *   AR_REPORT_QUOTA_LIVE=1 LIVE_DB_TYPE=mysql \
 *     AR_REPORT_QUOTA_MYSQL_URL=mysql://root:password@127.0.0.1:3308 \
 *     pnpm exec jest --ci --runInBand --testPathPatterns=report-quota.live
 *   AR_REPORT_QUOTA_LIVE=1 LIVE_DB_TYPE=postgres DB_TYPE=postgres \
 *     AR_REPORT_QUOTA_PG_URL=postgres://postgres:postgres@127.0.0.1:5432 \
 *     pnpm exec jest --ci --runInBand --testPathPatterns=report-quota.live
 */
const LIVE = liveEnabled('AR_REPORT_QUOTA');
const describeLive = LIVE ? describe : describe.skip;

describeLive('report admission on both engines', () => {
  jest.setTimeout(120_000);
  const HOOK_TIMEOUT = 240_000;
  let live: LiveDatabase;
  let ds: DataSource;
  let generatedRepo: Repository<GeneratedReport>;
  let aggregatedRepo: Repository<AggregatedReport>;
  let maxStoredReports = 500;
  /** project id → org id, as global-management would answer. */
  const projectOrg = new Map<string, string>();
  const addReportJob = jest.fn().mockResolvedValue('job');
  let enqueuer: ProjectReportEnqueuer;

  const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
  // The instance's Redis, for the admission lock (the db-engines job sets
  // RESULTS_IMPORT_REDIS_URL). Opened in beforeAll, never at collection: the
  // body of a skipped describe still runs, and an open client would keep
  // the test process alive.
  let redis: Redis | undefined;

  beforeAll(async () => {
    redis = new Redis(
      process.env.RESULTS_IMPORT_REDIS_URL ?? 'redis://127.0.0.1:6379',
      { lazyConnect: true, maxRetriesPerRequest: 1 },
    );
    await redis.connect();
    live = await createLiveDatabase({
      prefix: 'ar_report_quota',
      envPrefix: 'AR_REPORT_QUOTA',
      migrations: 'track',
    });
    ds = live.dataSource;
    generatedRepo = ds.getRepository(GeneratedReport);
    aggregatedRepo = ds.getRepository(AggregatedReport);
    const entitlements = {
      getEntitlements: async () => ({
        maxStoredReports,
        reportRetentionDays: -1,
      }),
    } as unknown as AnalysisReportingEntitlementsPort;
    const resolver = {
      resolveOrgId: async (projectId: string) =>
        projectOrg.get(projectId) ?? null,
    };
    const quota = new ReportQuotaService(
      entitlements,
      generatedRepo,
      aggregatedRepo,
      resolver as never,
      logger as never,
      { getRedisClient: async () => redis as Redis },
    );
    const retention = new ReportRetentionService(
      entitlements,
      resolver as never,
      generatedRepo,
      aggregatedRepo,
      {} as never,
      logger as never,
    );
    enqueuer = new ProjectReportEnqueuer(
      generatedRepo,
      { addReportJob } as never,
      { create: jest.fn(), delete: jest.fn() } as never,
      retention,
      quota,
      logger as never,
    );
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await redis?.quit().catch(() => redis?.disconnect());
    await live?.drop();
  }, HOOK_TIMEOUT);

  beforeEach(() => {
    maxStoredReports = 500;
    addReportJob.mockClear();
  });

  const newProject = (orgId: string): string => {
    const projectId = randomUUID();
    projectOrg.set(projectId, orgId);
    return projectId;
  };

  const enqueue = (projectId: string) =>
    enqueuer.enqueue({
      kind: 'owasp',
      projectId,
      format: 'pdf',
      detailed: false,
    });

  const queuedRowsOf = (organizationId: string) =>
    generatedRepo.countBy({ organizationId, status: 'queued' });

  const seedGenerated = (
    organizationId: string,
    statusValue: 'queued' | 'ready',
  ) =>
    generatedRepo.save(
      generatedRepo.create({
        id: randomUUID(),
        kind: 'owasp',
        projectId: randomUUID(),
        organizationId,
        format: 'pdf',
        detailed: false,
        status: statusValue,
        expiresAt: null,
      }),
    );

  it('a burst from one organization is refused beyond the cap, another organization is still accepted', async () => {
    for (let round = 0; round < 8; round += 1) {
      const orgA = randomUUID();
      const orgB = randomUUID();
      const projectA = newProject(orgA);
      addReportJob.mockClear();

      const results = await Promise.allSettled(
        Array.from({ length: 12 }, () => enqueue(projectA)),
      );
      const admitted = results.filter((r) => r.status === 'fulfilled');
      const refused = results.filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
      );

      // Exactly the cap: the earliest requests are admitted, never all
      // refused, never one too many.
      expect(admitted.length).toBe(DEFAULT_MAX_IN_FLIGHT_REPORTS_PER_ORG);
      for (const r of refused) {
        expect(r.reason).toMatchObject({
          error: { code: status.RESOURCE_EXHAUSTED },
        });
      }
      // A refused request leaves no row and enqueues no job.
      await expect(queuedRowsOf(orgA)).resolves.toBe(admitted.length);
      expect(addReportJob).toHaveBeenCalledTimes(admitted.length);

      // Fill the cap sequentially, then one more is refused.
      for (
        let i = admitted.length;
        i < DEFAULT_MAX_IN_FLIGHT_REPORTS_PER_ORG;
        i += 1
      ) {
        await enqueue(projectA);
      }
      await expect(enqueue(projectA)).rejects.toMatchObject({
        error: { code: status.RESOURCE_EXHAUSTED },
      });

      // The other organization is not affected.
      await expect(enqueue(newProject(orgB))).resolves.toEqual(
        expect.any(String),
      );
      await expect(queuedRowsOf(orgB)).resolves.toBe(1);
    }
  });

  it('as many concurrent requests as the cap are all accepted', async () => {
    for (let round = 0; round < 8; round += 1) {
      const project = newProject(randomUUID());
      const results = await Promise.allSettled(
        Array.from({ length: DEFAULT_MAX_IN_FLIGHT_REPORTS_PER_ORG }, () =>
          enqueue(project),
        ),
      );
      expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    }
  });

  it('a queued report older than the stale threshold no longer holds an in-flight slot', async () => {
    const org = randomUUID();
    for (let i = 0; i < DEFAULT_MAX_IN_FLIGHT_REPORTS_PER_ORG; i += 1) {
      const row = await seedGenerated(org, 'queued');
      // Its job was lost two hours ago: the worker will never settle it.
      await generatedRepo.update(row.id, {
        createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      });
    }

    await expect(enqueue(newProject(org))).resolves.toEqual(expect.any(String));
  });

  it('reports of both tables share the in-flight cap', async () => {
    const org = randomUUID();
    await seedGenerated(org, 'queued');
    await seedGenerated(org, 'queued');
    await aggregatedRepo.save(
      aggregatedRepo.create({
        id: randomUUID(),
        scopeType: 'organization',
        scopeId: org,
        organizationId: org,
        reportType: 'owasp',
        format: 'pdf',
        status: 'queued',
        expiresAt: null,
      }),
    );

    await expect(enqueue(newProject(org))).rejects.toMatchObject({
      error: { code: status.RESOURCE_EXHAUSTED },
    });
    expect(addReportJob).not.toHaveBeenCalled();
  });

  it('a queued report holds a stored-report slot', async () => {
    const org = randomUUID();
    maxStoredReports = 2;
    await seedGenerated(org, 'ready');
    await seedGenerated(org, 'queued');

    await expect(enqueue(newProject(org))).rejects.toMatchObject({
      error: { code: status.RESOURCE_EXHAUSTED },
    });
    expect(addReportJob).not.toHaveBeenCalled();
  });

  it('a finished report frees its in-flight slot', async () => {
    const org = randomUUID();
    const project = newProject(org);
    const ids: string[] = [];
    for (let i = 0; i < DEFAULT_MAX_IN_FLIGHT_REPORTS_PER_ORG; i += 1) {
      ids.push(await enqueue(project));
    }
    await expect(enqueue(project)).rejects.toMatchObject({
      error: { code: status.RESOURCE_EXHAUSTED },
    });

    await generatedRepo.update(ids[0], { status: 'ready' });
    await expect(enqueue(project)).resolves.toEqual(expect.any(String));
  });
});
