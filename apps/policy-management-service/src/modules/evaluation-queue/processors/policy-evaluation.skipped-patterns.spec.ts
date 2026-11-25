import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Logger } from '@nestjs/common';
import { of } from 'rxjs';
import type { Job } from 'bullmq';
import { PolicyEvaluationProcessor } from './policy-evaluation.processor';
import type { PolicyEvaluationJobData } from '../evaluation-queue.service';
import {
  PolicyEvaluation,
  ComplianceResultDetails,
} from '@entities/policy-evaluation.entity';
import { PolicyViolation } from '@entities/policy-violation.entity';
import {
  PolicyExclusion,
  PolicyRule,
  RuleOperator,
  RuleType,
  SecurityPolicy,
  ViolationAction,
} from '@entities/security-policy.entity';
import { PolicyService } from '@modules/policy/policy.service';
import { MAX_GLOB_SUBJECT_LENGTH } from '@modules/evaluation/safe-glob';

/**
 * A stored pattern that cannot be matched in bounded time, or a path too long
 * to match, is skipped. A skip makes the gate stricter (the exclusion does
 * not hide the finding; a negative branch rule applies), and the evaluation
 * result records which pattern of which policy was skipped and why, so the
 * change is never silent.
 */
describe('PolicyEvaluationProcessor — skipped patterns are recorded in the result', () => {
  const unsupported = '(a)\\1';
  const longPath = `src/${'a'.repeat(MAX_GLOB_SUBJECT_LENGTH)}.ts`;

  const blockHigh: PolicyRule = {
    id: 'rule-high',
    name: 'Block high and above',
    isEnabled: true,
    action: ViolationAction.BLOCK,
    type: RuleType.SEVERITY,
    operator: RuleOperator.GTE,
    value: 'HIGH',
  };
  const notReleaseBranches: PolicyRule = {
    id: 'rule-branch',
    name: 'Warn outside release branches',
    isEnabled: true,
    action: ViolationAction.WARN,
    type: RuleType.BRANCH,
    operator: RuleOperator.NOT_IN,
    value: ['main', '(r)\\1'],
  };
  const exclusions: PolicyExclusion[] = [
    { pattern: unsupported, reason: 'old pattern' },
    { pattern: 'src/**', reason: 'all sources' },
  ];

  const finding = (id: string, path: string) => ({
    base: {
      id,
      currentSeverity: 'HIGH',
      currentState: 'to_verify',
      branch: 'feature',
      path,
      vulnerability: { name: id },
    },
  });

  let processor: PolicyEvaluationProcessor;
  let evaluationUpdates: { resultDetails?: ComplianceResultDetails }[];

  beforeEach(async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    evaluationUpdates = [];
    const empty = () => of({ vulnerabilities: [] });
    const resultService = {
      getScanQueueStatus: jest.fn(() => of({ isProcessingComplete: true })),
      getProjectSastVulnerabilities: jest.fn(() =>
        of({
          vulnerabilities: [
            finding('short', 'lib/a.ts'),
            finding('long', longPath),
          ],
        }),
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
      name: 'Legacy policy',
      rules: { rules: [blockHigh, notReleaseBranches], exclusions },
      exclusions,
    } as unknown as SecurityPolicy;
    const violations = {
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((v: unknown) => v),
      save: jest.fn(async (v: unknown) => v),
      update: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    const module = await Test.createTestingModule({
      providers: [
        PolicyEvaluationProcessor,
        {
          provide: PolicyService,
          useValue: {
            getEffectivePolicy: jest.fn(async () => ({
              effectiveConfig: {
                rules: [blockHigh, notReleaseBranches],
                exclusions,
              },
              appliedPolicies: [policy],
            })),
          },
        },
        {
          provide: getRepositoryToken(PolicyEvaluation),
          useValue: {
            update: jest.fn(async (_criteria: unknown, patch: object) => {
              evaluationUpdates.push(patch);
            }),
          },
        },
        {
          provide: getRepositoryToken(PolicyViolation),
          useValue: {
            ...violations,
            manager: {
              transaction: async (
                work: (em: unknown) => Promise<unknown>,
              ): Promise<unknown> =>
                work({
                  query: async () => [],
                  getRepository: () => violations,
                }),
            },
          },
        },
        { provide: getRepositoryToken(SecurityPolicy), useValue: {} },
        {
          provide: 'ANALYSIS_REPORTING_SERVICE',
          useValue: { getService: jest.fn(() => resultService) },
        },
      ],
    }).compile();
    processor = module.get(PolicyEvaluationProcessor);
    processor.onModuleInit();
  });

  afterEach(() => jest.restoreAllMocks());

  const run = () =>
    processor.process({
      id: 'job-1',
      data: {
        evaluationId: 'eval-1',
        scanId: 'scan-1',
        projectId: 'proj-1',
        organizationId: 'org-1',
        triggeredBy: '',
        branch: 'feature',
      },
      updateProgress: jest.fn().mockResolvedValue(undefined),
    } as unknown as Job<PolicyEvaluationJobData>);

  const stored = (): ComplianceResultDetails =>
    evaluationUpdates.find((u) => u.resultDetails)!.resultDetails!;

  it('records the unsupported exclusion pattern, its policy and the reason', async () => {
    await run();
    expect(stored().warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          policyId: 'policy-1',
          policyName: 'Legacy policy',
          pattern: unsupported,
          reason: expect.stringContaining('back references'),
        }),
      ]),
    );
  });

  it('records the unsupported branch pattern of a rule', async () => {
    await run();
    expect(stored().warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          policyId: 'policy-1',
          ruleId: 'rule-branch',
          pattern: '(r)\\1',
          reason: expect.stringContaining('back references'),
        }),
      ]),
    );
  });

  it('records a path too long to match, and does not hide its finding', async () => {
    await run();
    const details = stored();
    expect(details.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          policyId: 'policy-1',
          pattern: 'src/**',
          reason: expect.stringContaining(
            `longer than ${MAX_GLOB_SUBJECT_LENGTH} characters`,
          ),
        }),
      ]),
    );
    // lib/a.ts is outside src/**: it counts. The long path under src/ is not
    // hidden, since it could not be matched: it counts too.
    const ids = details.violations
      .filter((v) => v.ruleId === 'rule-high')
      .flatMap((v) => v.affectedVulnerabilityIds)
      .sort();
    expect(ids).toEqual(['long', 'short']);
  });

  it('records each skip once, however many findings it concerns', async () => {
    await run();
    const keys = stored().warnings!.map(
      (w) => `${w.policyId}|${w.ruleId ?? ''}|${w.pattern}|${w.reason}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
  });
});
