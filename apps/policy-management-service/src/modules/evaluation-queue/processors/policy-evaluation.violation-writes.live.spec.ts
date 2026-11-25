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
 * Against a real Postgres: one evaluation over many findings writes each
 * violation row once, and the stored jsonb row lists every finding, keeps the
 * findings of other branches and counts what was added.
 *
 * Skipped by default. Against the local docker-compose Postgres of the policy
 * service (port 5433):
 *
 *   POLICY_VIOLATION_WRITES_PG_LIVE=1 pnpm exec jest violation-writes.live
 *
 * POLICY_LIVE_DB_HOST / _PORT / _USER / _PASSWORD / _ADMIN_DB override the
 * connection. The admin database is only used to CREATE and DROP the
 * throwaway one.
 */
const LIVE = process.env.POLICY_VIOLATION_WRITES_PG_LIVE === '1';
const describeLive = LIVE ? describe : describe.skip;

describeLive(
  'PolicyEvaluationProcessor violation writes on Postgres (live)',
  () => {
    const connection = {
      type: 'postgres' as const,
      host: process.env.POLICY_LIVE_DB_HOST || '127.0.0.1',
      port: Number(process.env.POLICY_LIVE_DB_PORT || 5433),
      username: process.env.POLICY_LIVE_DB_USER || 'policyuser',
      password: process.env.POLICY_LIVE_DB_PASSWORD || 'policypassword',
    };
    const database = `violation_writes_live_${Date.now()}_${process.pid}`;
    const org = randomUUID();
    const projectId = randomUUID();
    const policyId = randomUUID();
    const n = 300;

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
    let violations: Repository<PolicyViolation>;
    let writes: number;

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
        // Counts the statements that write a violation row, whichever
        // repository or transaction sends them.
        logging: ['query'],
        logger: {
          logQuery: (query: string) => {
            if (
              /^\s*(INSERT INTO|UPDATE|DELETE FROM) "policy_violations"/.test(
                query,
              )
            ) {
              writes++;
            }
          },
          logQueryError: () => undefined,
          logQuerySlow: () => undefined,
          logSchemaBuild: () => undefined,
          logMigration: () => undefined,
          log: () => undefined,
        },
      }).initialize();
      await db.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
      await db.runMigrations();
      await db.query(
        `INSERT INTO security_policies (id, scope, "organizationId", name, "isEnabled")
       VALUES ($1, 'ORGANIZATION', $2, 'p1', true)`,
        [policyId, org],
      );
      violations = db.getRepository(PolicyViolation);
    });

    afterAll(async () => {
      await db?.destroy();
      if (admin?.isInitialized) {
        await admin.query(`DROP DATABASE IF EXISTS "${database}"`);
        await admin.destroy();
      }
    });

    const finding = (i: number) => ({
      base: {
        id: `v${i}`,
        currentSeverity: 'HIGH',
        currentState: 'to_verify',
        branch: 'main',
        path: `src/file${i}.ts`,
        vulnerability: { name: `Finding ${i}` },
      },
    });

    const evaluate = async (scanId: string) => {
      const empty = () => of({ vulnerabilities: [] });
      const resultService = {
        getScanQueueStatus: () => of({ isProcessingComplete: true }),
        getProjectSastVulnerabilities: () =>
          of({
            vulnerabilities: Array.from({ length: n }, (_, i) =>
              finding(i + 1),
            ),
          }),
        getProjectIacVulnerabilities: empty,
        getProjectScaVulnerabilities: empty,
        getProjectSecretVulnerabilities: empty,
        getProjectCicdVulnerabilities: empty,
        getProjectContainerVulnerabilities: () =>
          of({ page: 1, totalPages: 1, vulnerabilities: [] }),
      };
      writes = 0;
      const policy = { id: policyId, rules: { rules: [rule] } };
      const processor = new PolicyEvaluationProcessor(
        {
          update: async () => undefined,
        } as unknown as Repository<PolicyEvaluation>,
        violations,
        {} as Repository<SecurityPolicy>,
        {
          getEffectivePolicy: async () => ({
            effectiveConfig: { rules: [rule], exclusions: [] },
            appliedPolicies: [policy],
          }),
        } as unknown as PolicyService,
        { getService: () => resultService } as unknown as ClientGrpc,
      );
      processor.onModuleInit();
      await processor.process({
        id: 'job-1',
        data: {
          evaluationId: randomUUID(),
          scanId,
          projectId,
          organizationId: org,
          triggeredBy: '',
          branch: 'main',
        },
        updateProgress: async () => undefined,
      } as unknown as Job<PolicyEvaluationJobData>);
    };

    it('inserts the row of a newly broken rule in one write', async () => {
      await evaluate(randomUUID());

      const rows = await violations.find({ where: { projectId } });
      expect(rows).toHaveLength(1);
      expect(writes).toBe(1);
      expect(rows[0].affectedVulnerabilitiesCount).toBe(n);
      expect(
        rows[0].violationDetails.affectedVulnerabilities.map((v) => v.id),
      ).toEqual(Array.from({ length: n }, (_, i) => `v${i + 1}`));
    });

    it('updates the stored row in one write, keeping other branches', async () => {
      const [row] = await violations.find({ where: { projectId } });
      const otherBranch = {
        id: 'v-develop',
        name: 'Only on develop',
        severity: 'HIGH',
        vulnerabilityType: 'sast',
        branch: 'develop',
      };
      await violations.update(
        { id: row.id },
        {
          violationDetails: {
            ...row.violationDetails,
            affectedVulnerabilities: [
              otherBranch,
              ...row.violationDetails.affectedVulnerabilities.slice(0, 10),
            ],
          },
          affectedVulnerabilitiesCount: 11,
        },
      );

      const scanId = randomUUID();
      await evaluate(scanId);

      const [updated] = await violations.find({ where: { projectId } });
      expect(writes).toBe(1);
      expect(updated.scanId).toBe(scanId);
      const ids = updated.violationDetails.affectedVulnerabilities.map(
        (v) => v.id,
      );
      expect(ids[0]).toBe('v-develop');
      expect(ids).toHaveLength(n + 1);
      // Ten findings were listed already, the others are appended and counted.
      expect(updated.affectedVulnerabilitiesCount).toBe(11 + (n - 10));
    });
  },
);
