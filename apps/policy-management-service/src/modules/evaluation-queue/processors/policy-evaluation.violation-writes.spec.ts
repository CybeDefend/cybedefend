import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { of } from 'rxjs';
import type { Job } from 'bullmq';
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
import { PolicyService } from '@modules/policy/policy.service';

/**
 * One evaluation writes each violation row once, however many findings break
 * its rule: a large result set must not cost a write (and a rewrite of the
 * whole affected list) per finding. The stored row is the one the per-finding
 * writes used to leave.
 */
describe('PolicyEvaluationProcessor — one write per violation row', () => {
  const blockHigh: PolicyRule = {
    id: 'rule-high',
    name: 'Block high and above',
    isEnabled: true,
    action: ViolationAction.BLOCK,
    type: RuleType.SEVERITY,
    operator: RuleOperator.GTE,
    value: 'HIGH',
  };
  const warnSast: PolicyRule = {
    id: 'rule-sast',
    name: 'Warn on code findings',
    isEnabled: true,
    action: ViolationAction.WARN,
    type: RuleType.SCANNER_TYPE,
    operator: RuleOperator.EQUALS,
    value: 'SAST',
  };

  const sast = (i: number) => ({
    base: {
      id: `v${i}`,
      currentSeverity: 'HIGH',
      currentState: 'to_verify',
      branch: 'main',
      path: `src/file${i}.ts`,
      vulnerableStartLine: i,
      vulnerability: { name: `Finding ${i}` },
    },
  });

  /** A repository kept in memory, counting what reaches the database. */
  class MemoryViolations {
    rows: PolicyViolation[] = [];
    writes = 0;
    reads = 0;
    private nextId = 1;

    find = jest.fn(async ({ where }: { where: Partial<PolicyViolation> }) => {
      this.reads++;
      return this.rows
        .filter((r) => r.projectId === where.projectId)
        .map((r) => structuredClone(r));
    });

    findOne = jest.fn(
      async ({ where }: { where: Partial<PolicyViolation> }) => {
        this.reads++;
        const row = this.rows.find(
          (r) =>
            r.policyId === where.policyId &&
            r.projectId === where.projectId &&
            r.ruleId === where.ruleId,
        );
        return row ? structuredClone(row) : null;
      },
    );

    create = jest.fn((v: Partial<PolicyViolation>) => ({ ...v }));

    save = jest.fn(async (v: PolicyViolation) => {
      this.writes++;
      const row = { ...structuredClone(v), id: `row-${this.nextId++}` };
      this.rows.push(row);
      return row;
    });

    update = jest.fn(
      async (criteria: { id: string }, patch: Partial<PolicyViolation>) => {
        this.writes++;
        const row = this.rows.find((r) => r.id === criteria.id);
        if (row) Object.assign(row, structuredClone(patch));
      },
    );

    /** The lock is taken in a transaction; in memory it is a no-op. */
    locks = 0;
    manager = {
      transaction: async (
        work: (em: unknown) => Promise<unknown>,
      ): Promise<unknown> =>
        work({
          query: async () => {
            this.locks++;
            return [];
          },
          getRepository: () => this,
        }),
    };

    delete = jest.fn(async (ids: string[]) => {
      this.writes++;
      this.rows = this.rows.filter((r) => !ids.includes(r.id));
    });
  }

  let processor: PolicyEvaluationProcessor;
  let violations: MemoryViolations;

  const build = async (findings: Record<string, unknown>[]) => {
    violations = new MemoryViolations();
    const empty = () => of({ vulnerabilities: [] });
    const resultService = {
      getScanQueueStatus: jest.fn(() => of({ isProcessingComplete: true })),
      getProjectSastVulnerabilities: jest.fn(() =>
        of({ vulnerabilities: findings }),
      ),
      getProjectIacVulnerabilities: jest.fn(empty),
      getProjectScaVulnerabilities: jest.fn(empty),
      getProjectSecretVulnerabilities: jest.fn(empty),
      getProjectCicdVulnerabilities: jest.fn(empty),
      getProjectContainerVulnerabilities: jest.fn(() =>
        of({ page: 1, totalPages: 1, vulnerabilities: [] }),
      ),
    };
    const policy = {
      id: 'policy-1',
      rules: { rules: [blockHigh, warnSast] },
    } as unknown as SecurityPolicy;
    const module = await Test.createTestingModule({
      providers: [
        PolicyEvaluationProcessor,
        {
          provide: PolicyService,
          useValue: {
            getEffectivePolicy: jest.fn(async () => ({
              effectiveConfig: { rules: [blockHigh, warnSast], exclusions: [] },
              appliedPolicies: [policy],
            })),
          },
        },
        {
          provide: getRepositoryToken(PolicyEvaluation),
          useValue: { update: jest.fn().mockResolvedValue(undefined) },
        },
        { provide: getRepositoryToken(PolicyViolation), useValue: violations },
        { provide: getRepositoryToken(SecurityPolicy), useValue: {} },
        {
          provide: 'ANALYSIS_REPORTING_SERVICE',
          useValue: { getService: jest.fn(() => resultService) },
        },
      ],
    }).compile();
    processor = module.get(PolicyEvaluationProcessor);
    processor.onModuleInit();
  };

  const run = () =>
    processor.process({
      id: 'job-1',
      data: {
        evaluationId: 'eval-1',
        scanId: 'scan-2',
        projectId: 'proj-1',
        organizationId: 'org-1',
        triggeredBy: '',
        branch: 'main',
      },
      updateProgress: jest.fn().mockResolvedValue(undefined),
    } as unknown as Job<PolicyEvaluationJobData>);

  const affected = (i: number) => ({
    id: `v${i}`,
    name: `Finding ${i}`,
    severity: 'HIGH',
    cvssScore: undefined,
    cwe: undefined,
    owaspTop10: undefined,
    filePath: `src/file${i}.ts`,
    startLine: i,
    endLine: i,
    vulnerabilityType: 'sast',
    branch: 'main',
    packageName: undefined,
    packageVersion: undefined,
    artifactName: undefined,
  });

  it.each([10, 200])(
    'writes each violation row once over %i findings',
    async (n) => {
      await build(Array.from({ length: n }, (_, i) => sast(i + 1)));
      await run();

      // Two rules broken: two rows, one write each, under one project lock.
      expect(violations.locks).toBe(1);
      expect(violations.rows).toHaveLength(2);
      expect(violations.writes).toBe(2);
      // One read of the stored rows, one more for the stale-row cleanup.
      expect(violations.reads).toBeLessThanOrEqual(2);
      for (const row of violations.rows) {
        expect(row.affectedVulnerabilitiesCount).toBe(n);
        expect(row.violationDetails.affectedVulnerabilities).toHaveLength(n);
      }
    },
  );

  it('stores a new row as the per-finding writes did', async () => {
    await build([sast(1), sast(2), sast(3)]);
    await run();

    // updatedAt is set by the database on insert, by the code on update.
    const row: Partial<PolicyViolation> = {
      ...violations.rows.find((r) => r.ruleId === 'rule-high')!,
    };
    delete row.updatedAt;
    expect(row).toEqual({
      id: expect.any(String),
      policyId: 'policy-1',
      projectId: 'proj-1',
      scanId: 'scan-2',
      organizationId: 'org-1',
      ruleId: 'rule-high',
      ruleName: 'Block high and above',
      actionTaken: ViolationAction.BLOCK,
      violationDetails: {
        rule: {
          id: 'rule-high',
          name: 'Block high and above',
          description: undefined,
          type: RuleType.SEVERITY,
          action: ViolationAction.BLOCK,
          operator: RuleOperator.GTE,
          value: 'HIGH',
        },
        affectedVulnerabilities: [affected(1), affected(2), affected(3)],
      },
      // The per-finding writes counted 1 on insert, then +1 per added finding.
      affectedVulnerabilitiesCount: 3,
    });
  });

  it('updates a stored row as the per-finding writes did', async () => {
    await build([sast(1), sast(2), sast(3)]);
    const stale = { ...affected(1), name: 'Old name' };
    const otherBranch = { ...affected(9), branch: 'develop' };
    violations.rows.push({
      id: 'row-existing',
      policyId: 'policy-1',
      projectId: 'proj-1',
      scanId: 'scan-1',
      organizationId: 'org-1',
      ruleId: 'rule-high',
      ruleName: 'Block high and above',
      actionTaken: ViolationAction.BLOCK,
      violationDetails: {
        rule: { id: 'rule-high', name: 'Block high and above' },
        affectedVulnerabilities: [stale, otherBranch],
      },
      affectedVulnerabilitiesCount: 2,
    } as PolicyViolation);

    await run();

    const row = violations.rows.find((r) => r.id === 'row-existing')!;
    expect(row.scanId).toBe('scan-2');
    // The finding already listed is refreshed in place, the others appended
    // in order, and the finding of another branch is kept.
    expect(row.violationDetails.affectedVulnerabilities).toEqual([
      affected(1),
      otherBranch,
      affected(2),
      affected(3),
    ]);
    expect(row.affectedVulnerabilitiesCount).toBe(4);
    expect(row.violationDetails.rule).toEqual(
      expect.objectContaining({ operator: RuleOperator.GTE, value: 'HIGH' }),
    );
    expect(Object.prototype.toString.call(row.updatedAt)).toBe('[object Date]');
    // One write for the stored row, one for the new code-findings row.
    expect(violations.writes).toBe(2);
  });
});
