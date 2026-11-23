import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import type { ClientGrpc } from '@nestjs/microservices';
import { of } from 'rxjs';
import { ViolationService } from './violation.service';
import { PolicyService } from '../policy/policy.service';
import { PolicyViolation } from '@entities/policy-violation.entity';
import { PolicyEvaluation } from '@entities/policy-evaluation.entity';
import { SecurityPolicy } from '@entities/security-policy.entity';
import { InitialSchema1736900000000 } from '@core/migrations/1736900000000-InitialSchema';
import { RemoveViolationTeamId1737020000000 } from '@core/migrations/1737020000000-RemoveViolationTeamId';
import { AddViolationAcknowledgeFields1737100000000 } from '@core/migrations/1737100000000-AddViolationAcknowledgeFields';
import { RemoveViolationAcknowledgeFields1737200000000 } from '@core/migrations/1737200000000-RemoveViolationAcknowledgeFields';
import { AddPerformanceIndexes1737300000000 } from '@core/migrations/1737300000000-AddPerformanceIndexes';

/**
 * Against a real Postgres: the violation stats and the
 * organization compliance overview run their SQL (GROUP BY, DISTINCT ON,
 * `= ANY(CAST(... AS uuid[]))`, the EXISTS of the trend, the time bounds) on a
 * throwaway database built by the service's own migrations, then dropped.
 *
 * Skipped by default. Against the local docker-compose Postgres of the policy
 * service (port 5433):
 *
 *   POLICY_COMPLIANCE_PG_LIVE=1 pnpm exec jest violation.compliance.live
 *
 * POLICY_LIVE_DB_HOST / _PORT / _USER / _PASSWORD / _ADMIN_DB override the
 * connection. The admin database is only used to CREATE and DROP the
 * throwaway one; nothing is written to it.
 */
const LIVE = process.env.POLICY_COMPLIANCE_PG_LIVE === '1';
const describeLive = LIVE ? describe : describe.skip;

describeLive('ViolationService on Postgres (live)', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const connection = {
    type: 'postgres' as const,
    host: process.env.POLICY_LIVE_DB_HOST || '127.0.0.1',
    port: Number(process.env.POLICY_LIVE_DB_PORT || 5433),
    username: process.env.POLICY_LIVE_DB_USER || 'policyuser',
    password: process.env.POLICY_LIVE_DB_PASSWORD || 'policypassword',
  };
  const database = `l20_compliance_live_${Date.now()}_${process.pid}`;

  const org = randomUUID();
  const otherOrg = randomUUID();
  const userId = randomUUID();
  const policyId = randomUUID();
  const otherPolicyId = randomUUID();
  // Readable: A compliant, B and C non-compliant, D pending, P evaluated once,
  // 200 days ago. H belongs to the organization but this user may not read it.
  const ids = {
    a: randomUUID(),
    b: randomUUID(),
    c: randomUUID(),
    d: randomUUID(),
    p: randomUUID(),
    h: randomUUID(),
    x: randomUUID(),
  };
  const scans = {
    a1: randomUUID(),
    b200: randomUUID(),
    b2: randomUUID(),
    c3: randomUUID(),
    d0: randomUUID(),
    p200: randomUUID(),
    h1: randomUUID(),
    x1: randomUUID(),
  };
  const readable = [
    { projectId: ids.a, name: 'Alpha', teamId: 'team-1' },
    { projectId: ids.b, name: 'Bravo', teamId: 'team-1' },
    { projectId: ids.c, name: 'Charlie', teamId: 'team-2' },
    { projectId: ids.d, name: 'Delta', teamId: '' },
    { projectId: ids.p, name: 'Papa', teamId: 'team-2' },
  ];

  let admin: DataSource;
  let db: DataSource;
  let service: ViolationService;
  let bLastEvaluation: Date;

  const ago = (days: number) => new Date(Date.now() - days * DAY);

  const insertEvaluation = (
    projectId: string,
    scanId: string,
    status: string,
    createdAt: Date,
    organizationId = org,
  ) =>
    db.query(
      `INSERT INTO policy_evaluations ("scanId", "projectId", "organizationId", status, "resultDetails", "createdAt")
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        scanId,
        projectId,
        organizationId,
        status,
        JSON.stringify({ violations: [{ big: 'x'.repeat(2000) }] }),
        createdAt,
      ],
    );

  const insertViolations = (
    n: number,
    projectId: string,
    scanId: string,
    actionTaken: 'BLOCK' | 'WARN',
    { createdAt = ago(1), organizationId = org, policy = policyId } = {},
  ) =>
    Promise.all(
      Array.from({ length: n }, (_, i) =>
        db.query(
          `INSERT INTO policy_violations ("policyId", "projectId", "scanId", "organizationId", "ruleId", "ruleName", "actionTaken", "violationDetails", "createdAt")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            policy,
            projectId,
            scanId,
            organizationId,
            `rule-${i % 2}`,
            `Rule ${i % 2}`,
            actionTaken,
            JSON.stringify({
              affectedVulnerabilities: Array.from({ length: 50 }, (_, k) => ({
                id: `v-${k}`,
                name: 'x'.repeat(100),
              })),
            }),
            createdAt,
          ],
        ),
      ),
    );

  beforeAll(async () => {
    admin = await new DataSource({
      ...connection,
      database: process.env.POLICY_LIVE_ADMIN_DB || 'cybedefend_policy',
    }).initialize();
    await admin.query(`CREATE DATABASE "${database}"`);

    db = await new DataSource({
      ...connection,
      database,
      entities: [SecurityPolicy, PolicyViolation, PolicyEvaluation],
      migrations: [
        InitialSchema1736900000000,
        RemoveViolationTeamId1737020000000,
        AddViolationAcknowledgeFields1737100000000,
        RemoveViolationAcknowledgeFields1737200000000,
        AddPerformanceIndexes1737300000000,
      ],
      synchronize: false,
    }).initialize();
    await db.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    await db.runMigrations();

    for (const [id, organizationId] of [
      [policyId, org],
      [otherPolicyId, otherOrg],
    ]) {
      await db.query(
        `INSERT INTO security_policies (id, scope, "organizationId", name, "isEnabled")
         VALUES ($1, 'ORGANIZATION', $2, $3, true)`,
        [id, organizationId, `policy-${id}`],
      );
    }

    await insertEvaluation(ids.a, scans.a1, 'COMPLETED', ago(1));
    await insertEvaluation(ids.b, scans.b200, 'COMPLETED', ago(200));
    bLastEvaluation = ago(2);
    await insertEvaluation(ids.b, scans.b2, 'COMPLETED', bLastEvaluation);
    await insertEvaluation(ids.c, scans.c3, 'COMPLETED', ago(3));
    await insertEvaluation(ids.d, scans.d0, 'IN_PROGRESS', ago(0.01));
    await insertEvaluation(ids.p, scans.p200, 'COMPLETED', ago(200));
    await insertEvaluation(ids.h, scans.h1, 'COMPLETED', ago(1));
    await insertEvaluation(ids.x, scans.x1, 'COMPLETED', ago(1), otherOrg);

    await insertViolations(5, ids.b, scans.b2, 'BLOCK');
    await insertViolations(1, ids.b, scans.b2, 'WARN');
    // An older WARN, outside a 10-day date filter.
    await insertViolations(1, ids.b, scans.b2, 'WARN', { createdAt: ago(100) });
    await insertViolations(2, ids.c, scans.c3, 'BLOCK');
    await insertViolations(4, ids.h, scans.h1, 'BLOCK');
    await insertViolations(3, ids.x, scans.x1, 'BLOCK', {
      organizationId: otherOrg,
      policy: otherPolicyId,
    });

    const globalManagement = {
      getService: () => ({
        getReadableProjectsInOrganization: () => of({ projects: readable }),
      }),
    } as unknown as ClientGrpc;
    const policyService = {
      getEffectivePolicy: async () => ({
        effectiveConfig: { rules: [], exclusions: [] },
        appliedPolicies: [{ id: policyId }],
      }),
    } as unknown as PolicyService;

    service = new ViolationService(
      db.getRepository(PolicyViolation),
      db.getRepository(PolicyEvaluation),
      db.getRepository(SecurityPolicy),
      policyService,
      globalManagement,
    );
    service.onModuleInit();
  }, 120_000);

  afterAll(async () => {
    await db?.destroy();
    if (admin?.isInitialized) {
      await admin.query(`DROP DATABASE IF EXISTS "${database}"`);
      await admin.destroy();
    }
  });

  describe('getViolationStats', () => {
    it('counts with GROUP BY and reads the status from the evaluations', async () => {
      await expect(service.getViolationStats(ids.b)).resolves.toEqual({
        totalViolations: 7,
        blockedCount: 5,
        warnedCount: 2,
        applicablePoliciesCount: 1,
        complianceStatus: 'Non-Compliant',
      });
      await expect(service.getViolationStats(ids.a)).resolves.toEqual(
        expect.objectContaining({
          totalViolations: 0,
          complianceStatus: 'Compliant',
        }),
      );
      await expect(service.getViolationStats(ids.d)).resolves.toEqual(
        expect.objectContaining({ complianceStatus: 'Pending' }),
      );
      await expect(service.getViolationStats(randomUUID())).resolves.toEqual(
        expect.objectContaining({
          totalViolations: 0,
          complianceStatus: 'Pending',
        }),
      );
    });

    it('applies the organization and date filters', async () => {
      await expect(
        service.getViolationStats(ids.b, {
          organizationId: org,
          fromDate: ago(10).getTime(),
          toDate: Date.now(),
        }),
      ).resolves.toEqual(
        expect.objectContaining({
          totalViolations: 6,
          blockedCount: 5,
          warnedCount: 1,
        }),
      );
      await expect(
        service.getViolationStats(ids.b, { organizationId: otherOrg }),
      ).resolves.toEqual(expect.objectContaining({ totalViolations: 0 }));
    });
  });

  describe('getOrganizationComplianceOverview', () => {
    const overview = (options: Record<string, unknown> = {}) =>
      service.getOrganizationComplianceOverview({
        organizationId: org,
        userId,
        page: 1,
        pageSize: 20,
        ...options,
      });

    it('aggregates the readable projects only, then sorts and paginates them all', async () => {
      const result = await overview({ pageSize: 2 });

      expect(result.projects.map((p) => p.projectName)).toEqual([
        'Bravo',
        'Charlie',
      ]);
      expect(result.total).toBe(5);
      expect(result.stats).toEqual({
        totalProjects: 5,
        compliantProjects: 2,
        nonCompliantProjects: 2,
        pendingProjects: 1,
        totalViolations: 9,
        totalBlocked: 7,
        totalWarned: 2,
        activePoliciesCount: 1,
        complianceRate: 50,
      });
      expect(
        result.violationBreakdown.reduce((sum, row) => sum + row.count, 0),
      ).toBe(9);

      const bravo = result.projects[0];
      expect(bravo).toEqual(
        expect.objectContaining({
          projectId: ids.b,
          complianceStatus: 'Non-Compliant',
          totalViolations: 7,
          blockedCount: 5,
          warnedCount: 2,
          lastScanId: scans.b2,
          teamIds: ['team-1'],
        }),
      );
      expect(bravo.lastEvaluatedAt).toBe(bLastEvaluation.getTime());
    });

    it('filters before it paginates and counts what it filtered', async () => {
      const nonCompliant = await overview({
        complianceStatusFilter: 'Non-Compliant',
        page: 2,
        pageSize: 1,
      });
      expect(nonCompliant.projects.map((p) => p.projectName)).toEqual([
        'Charlie',
      ]);
      expect(nonCompliant.total).toBe(2);

      const pending = await overview({ complianceStatusFilter: 'Pending' });
      expect(pending.projects.map((p) => p.projectName)).toEqual(['Delta']);
      expect(pending.projects[0].teamIds).toEqual([]);

      const byName = await overview({ search: 'PA', sortBy: 'projectName' });
      expect(byName.projects.map((p) => p.projectName)).toEqual(['Papa']);
      expect(byName.total).toBe(1);
    });

    it('starts each project of the trend from its last evaluation before the window', async () => {
      const { trend } = await overview();

      expect(trend.length).toBeGreaterThanOrEqual(30);
      // First day: Papa (evaluated once, 200 days ago) and Bravo (compliant
      // 200 days ago, re-evaluated with BLOCK violations 2 days ago).
      expect(trend[0]).toEqual(
        expect.objectContaining({
          compliantCount: 2,
          nonCompliantCount: 0,
          pendingCount: 3,
        }),
      );
      // Today: Alpha and Papa compliant, Bravo and Charlie not, Delta pending.
      expect(trend[trend.length - 1]).toEqual(
        expect.objectContaining({
          compliantCount: 2,
          nonCompliantCount: 2,
          pendingCount: 1,
          complianceRate: 40,
        }),
      );
      for (const point of trend) {
        expect(
          point.compliantCount + point.nonCompliantCount + point.pendingCount,
        ).toBe(5);
        // Papa never drops out of the trend.
        expect(point.compliantCount).toBeGreaterThanOrEqual(1);
      }
    });

    it('aggregates the weekly and monthly trends from the same points', async () => {
      const weekly = await overview({ timeframe: 'week' });
      const monthly = await overview({ timeframe: 'month' });

      // A point every 2 (week) or 7 (month) days from the window start: the
      // last one may precede the evaluations of the last days, so only the
      // invariants are checked here.
      for (const trend of [weekly.trend, monthly.trend]) {
        expect(trend.length).toBeGreaterThan(0);
        for (const point of trend) {
          expect(
            point.compliantCount + point.nonCompliantCount + point.pendingCount,
          ).toBe(5);
          expect(point.compliantCount).toBeGreaterThanOrEqual(1);
        }
      }
    });
  });
});
