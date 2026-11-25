import { randomUUID } from 'node:crypto';
import { DataSource, Repository } from 'typeorm';
import { of } from 'rxjs';
import type { Job } from 'bullmq';
import type { ClientGrpc } from '@nestjs/microservices';
import { PolicyEvaluationProcessor } from './policy-evaluation.processor';
import type { PolicyEvaluationJobData } from '../evaluation-queue.service';
import { PolicyEvaluation } from '@entities/policy-evaluation.entity';
import { PolicyViolation } from '@entities/policy-violation.entity';
import {
  PolicyRule,
  RuleOperator,
  RuleType,
  SecurityPolicy,
  ViolationAction,
} from '@entities/security-policy.entity';
import type { PolicyService } from '@modules/policy/policy.service';
import { InitialSchema1736900000000 } from '@core/migrations/1736900000000-InitialSchema';
import { RemoveViolationTeamId1737020000000 } from '@core/migrations/1737020000000-RemoveViolationTeamId';
import { AddViolationAcknowledgeFields1737100000000 } from '@core/migrations/1737100000000-AddViolationAcknowledgeFields';
import { RemoveViolationAcknowledgeFields1737200000000 } from '@core/migrations/1737200000000-RemoveViolationAcknowledgeFields';
import { AddPerformanceIndexes1737300000000 } from '@core/migrations/1737300000000-AddPerformanceIndexes';

/**
 * Against a real Postgres: two evaluations of one project that finish at the
 * same time (two branches scanned together, jobs on several workers) both
 * read, then rewrite, the project's violation rows. They run one after the
 * other for that project, so neither overwrites what the other appended and
 * no second row is created for the same rule.
 *
 * Skipped by default. Against the local docker-compose Postgres of the policy
 * service (port 5433):
 *
 *   POLICY_VIOLATION_WRITES_PG_LIVE=1 pnpm exec jest concurrent-writes.live
 *
 * POLICY_LIVE_DB_HOST / _PORT / _USER / _PASSWORD / _ADMIN_DB override the
 * connection, as for the other live specs of this service.
 */
const LIVE = process.env.POLICY_VIOLATION_WRITES_PG_LIVE === '1';
const describeLive = LIVE ? describe : describe.skip;

describeLive(
  'PolicyEvaluationProcessor concurrent evaluations of one project (live)',
  () => {
    const connection = {
      type: 'postgres' as const,
      host: process.env.POLICY_LIVE_DB_HOST || '127.0.0.1',
      port: Number(process.env.POLICY_LIVE_DB_PORT || 5433),
      username: process.env.POLICY_LIVE_DB_USER || 'policyuser',
      password: process.env.POLICY_LIVE_DB_PASSWORD || 'policypassword',
    };
    const database = `violation_race_live_${Date.now()}_${process.pid}`;
    const org = randomUUID();
    const policyId = randomUUID();
    const perBranch = 40;

    const rule: PolicyRule = {
      id: 'rule-high',
      name: 'Block high and above',
      isEnabled: true,
      action: ViolationAction.BLOCK,
      type: RuleType.SEVERITY,
      operator: RuleOperator.GTE,
      value: 'HIGH',
    };

    let admin: DataSource;
    let db: DataSource;

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
        extra: { max: 10 },
      }).initialize();
      await db.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
      await db.runMigrations();
      await db.query(
        `INSERT INTO security_policies (id, scope, "organizationId", name, "isEnabled")
       VALUES ($1, 'ORGANIZATION', $2, 'p1', true)`,
        [policyId, org],
      );
    });

    afterAll(async () => {
      await db?.destroy();
      if (admin?.isInitialized) {
        await admin.query(`DROP DATABASE IF EXISTS "${database}"`);
        await admin.destroy();
      }
    });

    /** One processor, as one worker would hold, reading one branch's findings. */
    const worker = (branch: string) => {
      const findings = Array.from({ length: perBranch }, (_, i) => ({
        base: {
          id: `${branch}-v${i}`,
          currentSeverity: 'HIGH',
          currentState: 'to_verify',
          branch,
          path: `src/${branch}/file${i}.ts`,
          vulnerability: { name: `Finding ${i}` },
        },
      }));
      const empty = () => of({ vulnerabilities: [] });
      const resultService = {
        getScanQueueStatus: () => of({ isProcessingComplete: true }),
        getProjectSastVulnerabilities: () => of({ vulnerabilities: findings }),
        getProjectIacVulnerabilities: empty,
        getProjectScaVulnerabilities: empty,
        getProjectSecretVulnerabilities: empty,
        getProjectCicdVulnerabilities: empty,
        getProjectContainerVulnerabilities: () =>
          of({ page: 1, totalPages: 1, vulnerabilities: [] }),
      };
      const processor = new PolicyEvaluationProcessor(
        {
          update: async () => undefined,
        } as unknown as Repository<PolicyEvaluation>,
        db.getRepository(PolicyViolation),
        {} as Repository<SecurityPolicy>,
        {
          getEffectivePolicy: async () => ({
            effectiveConfig: { rules: [rule], exclusions: [] },
            appliedPolicies: [{ id: policyId, rules: { rules: [rule] } }],
          }),
        } as unknown as PolicyService,
        { getService: () => resultService } as unknown as ClientGrpc,
      );
      processor.onModuleInit();
      return (projectId: string) =>
        processor.process({
          id: `job-${branch}`,
          data: {
            evaluationId: randomUUID(),
            scanId: randomUUID(),
            projectId,
            organizationId: org,
            triggeredBy: '',
            branch,
          },
          updateProgress: async () => undefined,
        } as unknown as Job<PolicyEvaluationJobData>);
    };

    it('keeps every finding of two evaluations run together, 20 rounds', async () => {
      const onBase = worker('release');
      const onMain = worker('main');
      const onFeature = worker('feature');
      const lost: string[] = [];
      for (let round = 0; round < 20; round++) {
        const projectId = randomUUID();
        // Odd rounds start from a stored row both evaluations then rewrite;
        // even rounds have both evaluations create it.
        const expected = round % 2 === 1 ? 3 * perBranch : 2 * perBranch;
        if (round % 2 === 1) await onBase(projectId);
        await Promise.all([onMain(projectId), onFeature(projectId)]);
        const rows = await db
          .getRepository(PolicyViolation)
          .find({ where: { projectId } });
        const ids = rows.flatMap((r) =>
          r.violationDetails.affectedVulnerabilities.map((v) => v.id),
        );
        if (rows.length !== 1 || new Set(ids).size !== expected) {
          lost.push(
            `round ${round}: ${rows.length} rows, ${new Set(ids).size} findings`,
          );
        } else {
          expect(rows[0].affectedVulnerabilitiesCount).toBe(expected);
        }
      }
      expect(lost).toEqual([]);
    }, 120_000);
  },
);
