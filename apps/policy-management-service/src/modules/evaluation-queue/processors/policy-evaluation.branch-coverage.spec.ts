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
 * The compliance gate reads the dependency findings of the scan's own branch
 * and the malware findings, under the same rules as every other finding.
 * A pull-request branch scanned in CI must be blocked by a vulnerable
 * dependency it introduces, and a malicious package must never pass.
 */
/** A violation repository that stores nothing, with its lock manager. */
const inMemoryViolations = () => {
  const repository = {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn((v: unknown) => v),
    save: jest.fn(async (v: unknown) => v),
    update: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
    manager: {
      transaction: async (
        work: (em: unknown) => Promise<unknown>,
      ): Promise<unknown> =>
        work({ query: async () => [], getRepository: () => repository }),
    },
  };
  return repository;
};

describe('PolicyEvaluationProcessor — dependency findings of the scan branch and malware', () => {
  type ScaRequest = {
    projectId: string;
    branch?: string;
    malwareOnly?: boolean;
  };

  const blockHigh: PolicyRule = {
    id: 'rule-high',
    name: 'Block high and above',
    isEnabled: true,
    action: ViolationAction.BLOCK,
    type: RuleType.SEVERITY,
    operator: RuleOperator.GTE,
    value: 'HIGH',
  };

  const scaFinding = (id: string, branch: string, severity: string) => ({
    base: {
      id,
      currentSeverity: severity,
      currentState: 'to_verify',
      branch,
    },
    library: { packageName: 'lodash', packageVersion: '4.17.20' },
    metadata: { summary: `Finding ${id}` },
  });

  let processor: PolicyEvaluationProcessor;
  let scaRequests: ScaRequest[];
  let completed: { compliant: boolean; action: ViolationAction | null }[];

  /** Each branch holds its own dependency findings; malware is listed apart. */
  const scaList = (req: ScaRequest) => {
    scaRequests.push(req);
    const branch = req.branch ?? 'main';
    if (req.malwareOnly) {
      return of({
        vulnerabilities:
          branch === 'main'
            ? [scaFinding('mal-main', 'main', 'CRITICAL')]
            : [scaFinding('mal-feature', branch, 'CRITICAL')],
      });
    }
    return of({
      vulnerabilities:
        branch === 'main'
          ? [scaFinding('sca-main', 'main', 'LOW')]
          : [scaFinding('sca-feature', branch, 'HIGH')],
    });
  };

  /**
   * The code, IaC, secret and CI/CD lists answer every branch when no branch
   * is named, and only the named branch otherwise. Each holds one HIGH
   * finding, on a branch no scan of these tests reads.
   */
  let listRequests: { method: string; req: ScaRequest }[];
  const otherBranchList = (method: string) =>
    jest.fn((req: ScaRequest) => {
      listRequests.push({ method, req });
      const all = [
        {
          base: {
            id: `${method}-stale`,
            currentSeverity: 'HIGH',
            currentState: 'to_verify',
            branch: 'stale-feature',
            vulnerability: { name: 'Only on another branch' },
          },
        },
      ];
      return of({
        vulnerabilities: req.branch
          ? all.filter((v) => v.base.branch === req.branch)
          : all,
      });
    });

  const build = async (
    options: { malwareOnMain?: boolean; codeFindings?: boolean } = {},
  ) => {
    scaRequests = [];
    listRequests = [];
    completed = [];
    const empty = () => of({ vulnerabilities: [] });
    const list = (method: string) =>
      options.codeFindings ? otherBranchList(method) : jest.fn(empty);
    const resultService = {
      getScanQueueStatus: jest.fn(() => of({ isProcessingComplete: true })),
      getProjectSastVulnerabilities: list('sast'),
      getProjectIacVulnerabilities: list('iac'),
      getProjectScaVulnerabilities: jest.fn((req: ScaRequest) =>
        options.malwareOnMain === false && req.malwareOnly
          ? of({ vulnerabilities: [] })
          : scaList(req),
      ),
      getProjectSecretVulnerabilities: list('secret'),
      getProjectCicdVulnerabilities: list('cicd'),
      getProjectContainerVulnerabilities: jest.fn(() =>
        of({ page: 1, totalPages: 1, vulnerabilities: [] }),
      ),
    };
    const policy = {
      id: 'policy-1',
      rules: { rules: [blockHigh] },
    } as unknown as SecurityPolicy;
    const module = await Test.createTestingModule({
      providers: [
        PolicyEvaluationProcessor,
        {
          provide: PolicyService,
          useValue: {
            getEffectivePolicy: jest.fn(async () => ({
              effectiveConfig: { rules: [blockHigh], exclusions: [] },
              appliedPolicies: [policy],
            })),
          },
        },
        {
          provide: getRepositoryToken(PolicyEvaluation),
          useValue: { update: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: getRepositoryToken(PolicyViolation),
          useValue: inMemoryViolations(),
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
    jest
      .spyOn(
        processor as unknown as {
          completeEvaluation: (
            id: string,
            r: { compliant: boolean; action: ViolationAction | null },
          ) => Promise<void>;
        },
        'completeEvaluation',
      )
      .mockImplementation(async (_id, result) => {
        completed.push(result);
      });
  };

  const run = (branch?: string) =>
    processor.process({
      id: 'job-1',
      data: {
        evaluationId: 'eval-1',
        scanId: 'scan-1',
        projectId: 'proj-1',
        organizationId: 'org-1',
        triggeredBy: '',
        branch,
      },
      updateProgress: jest.fn().mockResolvedValue(undefined),
    } as unknown as Job<PolicyEvaluationJobData>);

  it('blocks a vulnerable dependency found on the scanned pull-request branch', async () => {
    await build({ malwareOnMain: false });
    await run('feature/login');

    expect(scaRequests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ branch: 'feature/login' }),
      ]),
    );
    expect(completed).toEqual([
      expect.objectContaining({
        compliant: false,
        action: ViolationAction.BLOCK,
      }),
    ]);
  });

  it('blocks a malicious package under a severity rule', async () => {
    await build();
    await run('main');

    expect(scaRequests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ malwareOnly: true, branch: 'main' }),
      ]),
    );
    expect(completed).toEqual([
      expect.objectContaining({
        compliant: false,
        action: ViolationAction.BLOCK,
      }),
    ]);
  });

  it('reads the malware findings of the scanned branch', async () => {
    await build();
    await run('feature/login');

    expect(scaRequests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          malwareOnly: true,
          branch: 'feature/login',
        }),
      ]),
    );
  });

  it('does not count a code, IaC, secret or CI/CD finding of another branch', async () => {
    await build({ malwareOnMain: false, codeFindings: true });
    await run('feature/login');

    expect(listRequests.map((r) => r.method).sort()).toEqual([
      'cicd',
      'iac',
      'sast',
      'secret',
    ]);
    for (const { req } of listRequests) {
      expect(req).toEqual(expect.objectContaining({ branch: 'feature/login' }));
    }
    // The branch's own dependency finding is a violation; the findings that
    // only exist on another branch are not.
    expect(violatedIds()).toEqual(['sca-feature']);
  });

  it('still reads every branch of those lists for a scan with no branch', async () => {
    await build({ malwareOnMain: false, codeFindings: true });
    await run(undefined);

    for (const { req } of listRequests) {
      expect(req).not.toHaveProperty('branch');
    }
    // As before: the findings of every branch are read, and they block.
    expect(violatedIds()).toEqual([
      'cicd-stale',
      'iac-stale',
      'sast-stale',
      'secret-stale',
    ]);
  });

  const violatedIds = (): string[] =>
    (
      completed[0] as unknown as {
        violations: { affectedVulnerabilityIds: string[] }[];
      }
    ).violations
      .flatMap((v) => v.affectedVulnerabilityIds)
      .sort();

  it('keeps the default-branch evaluation unchanged when the job names no branch', async () => {
    await build({ malwareOnMain: false });
    await run(undefined);

    // No branch is sent: the list answers the default branch, as before.
    for (const req of scaRequests) {
      expect(req).not.toHaveProperty('branch');
    }
    // The default branch only holds a LOW dependency finding.
    expect(completed).toEqual([
      expect.objectContaining({ compliant: true, action: null }),
    ]);
  });
});
