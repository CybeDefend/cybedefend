import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EvaluationService } from './evaluation.service';
import { EvaluationController } from './evaluation.controller';
import {
  PolicyEvaluation,
  EvaluationStatus,
} from '@entities/policy-evaluation.entity';
import { EvaluationQueueService } from '@modules/evaluation-queue/evaluation-queue.service';
import { PolicyService } from '@modules/policy/policy.service';
import { PolicyEvaluationProcessor } from '@modules/evaluation-queue/processors/policy-evaluation.processor';

/**
 * A violation is one broken rule of a policy, with every finding that breaks
 * it: that is the row the project's violation list, its statistics and the
 * organisation overview count. A scan's compliance result must count the same
 * thing, not one entry per (rule, finding) match, or the same scan shows
 * different totals on different screens.
 */
describe('Evaluation - scan violation counts', () => {
  const projectId = '18ecb492-7b46-4ab7-813f-c486084ddd95';
  const scanId = '7cece1f1-6c12-48ff-9e08-bcf1185c74dd';

  // One BLOCK rule broken by 2 findings, a WARN rule by 3, another WARN by 1:
  // 6 matches, 3 violations (1 blocking, 2 warning).
  const entry = (
    policyId: string,
    ruleId: string,
    action: string,
    vuln: string,
  ) => ({
    policyId,
    ruleId,
    ruleName: ruleId,
    action,
    details: {},
    affectedVulnerabilityIds: [vuln],
  });
  const violations = [
    entry('p-block', 'r-sev', 'BLOCK', 'v1'),
    entry('p-block', 'r-sev', 'BLOCK', 'v2'),
    entry('p-team', 'r-sast', 'WARN', 'v1'),
    entry('p-team', 'r-sast', 'WARN', 'v2'),
    entry('p-team', 'r-sast', 'WARN', 'v3'),
    entry('p-org', 'r-cwe', 'WARN', 'v3'),
  ];
  const evaluation = {
    id: 'e1',
    projectId,
    scanId,
    compliant: false,
    action: 'BLOCK',
    status: EvaluationStatus.COMPLETED,
    createdAt: new Date(),
    completedAt: new Date(),
    resultDetails: { violationCount: violations.length, violations },
  };

  let service: EvaluationService;
  let controller: EvaluationController;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [EvaluationController],
      providers: [
        EvaluationService,
        {
          provide: getRepositoryToken(PolicyEvaluation),
          useValue: {
            findOne: jest.fn().mockResolvedValue(evaluation),
            findAndCount: jest.fn().mockResolvedValue([[evaluation], 1]),
          },
        },
        { provide: EvaluationQueueService, useValue: {} },
        { provide: PolicyService, useValue: {} },
      ],
    }).compile();
    service = module.get(EvaluationService);
    controller = module.get(EvaluationController);
  });

  it('the compliance result counts violated rules', async () => {
    const response = await controller.getComplianceResult({
      scanId,
      projectId,
    } as never);
    expect(response.result!.violationCount).toBe(3);
    expect(response.result!.blockingViolationsCount).toBe(1);
    expect(response.result!.warningViolationsCount).toBe(2);
    expect(response.result!.breakingRulesCount).toBe(3);
  });

  it('the compliance history counts violated rules', async () => {
    const history = await service.getComplianceHistory(projectId);
    expect(history.results[0]).toMatchObject({
      violationCount: 3,
      blockingViolationsCount: 1,
      warningViolationsCount: 2,
      breakingRulesCount: 3,
    });
  });

  it('a rule id shared by two policies counts once per policy', async () => {
    evaluation.resultDetails.violations = [
      entry('p1', 'r', 'WARN', 'v1'),
      entry('p2', 'r', 'WARN', 'v1'),
    ];
    const response = await controller.getComplianceResult({
      scanId,
      projectId,
    } as never);
    evaluation.resultDetails.violations = violations;
    expect(response.result!.violationCount).toBe(2);
    expect(response.result!.warningViolationsCount).toBe(2);
  });

  it('violationCount and breakingRulesCount are the same count by definition', async () => {
    const response = await controller.getComplianceResult({
      scanId,
      projectId,
    } as never);
    expect(response.result!.violationCount).toBe(
      response.result!.blockingViolationsCount +
        response.result!.warningViolationsCount,
    );
    expect(response.result!.breakingRulesCount).toBe(
      response.result!.violationCount,
    );
  });

  it('the status messages give the same count as the compliance result', async () => {
    const byId = await service.getEvaluationStatus('e1');
    const byScan = await service.getEvaluationStatusByScanId(scanId, projectId);
    expect(byId.message).toBe('Found 3 violations');
    expect(byScan.message).toBe('Found 3 violations');
  });
});

describe('PolicyEvaluationProcessor - stored violation count', () => {
  it('stores the number of broken rules, not the number of matches', async () => {
    const update = jest.fn().mockResolvedValue(undefined);
    const processor = new PolicyEvaluationProcessor(
      { update } as never,
      null as never,
      null as never,
      null as never,
      null as never,
    );
    const matches = [
      {
        policyId: 'p',
        ruleId: 'r1',
        action: 'BLOCK',
        ruleName: 'r1',
        details: {},
        affectedVulnerabilityIds: ['v1'],
      },
      {
        policyId: 'p',
        ruleId: 'r1',
        action: 'BLOCK',
        ruleName: 'r1',
        details: {},
        affectedVulnerabilityIds: ['v2'],
      },
      {
        policyId: 'p',
        ruleId: 'r2',
        action: 'WARN',
        ruleName: 'r2',
        details: {},
        affectedVulnerabilityIds: ['v1'],
      },
    ];
    await (
      processor as unknown as {
        completeEvaluation: (id: string, result: unknown) => Promise<void>;
      }
    ).completeEvaluation('e1', {
      compliant: false,
      action: 'BLOCK',
      violations: matches,
    });
    expect(update.mock.calls[0][1].resultDetails.violationCount).toBe(2);
  });
});
