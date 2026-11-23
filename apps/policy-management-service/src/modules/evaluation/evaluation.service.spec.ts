import { Test, TestingModule } from '@nestjs/testing';
import { Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EvaluationService } from './evaluation.service';
import {
  PolicyEvaluation,
  EvaluationStatus,
} from '@entities/policy-evaluation.entity';
import { EvaluationQueueService } from '@modules/evaluation-queue/evaluation-queue.service';
import { PolicyService } from '@modules/policy/policy.service';

/**
 * Regression coverage for the QueryFailedError ("invalid input syntax for
 * type uuid") that surfaced when the analysis-reporting OSV-sync cron sent
 * triggeredBy='osv-sync-cron' through the TriggerEvaluation gRPC method.
 *
 * The policy_evaluations.triggeredBy column is `uuid NULL`. Any caller —
 * cron, future system actor, malformed input — that supplies a non-UUID
 * string must be coerced to NULL at the service boundary so the INSERT
 * cannot crash the policy-management-service.
 */
describe('EvaluationService - triggeredBy UUID coercion', () => {
  let service: EvaluationService;
  let evaluationRepo: jest.Mocked<Repository<PolicyEvaluation>>;
  let queueService: { addEvaluationJob: jest.Mock };
  let policyService: { getEffectivePolicy: jest.Mock };

  const VALID_PROJECT_ID = '18ecb492-7b46-4ab7-813f-c486084ddd95';
  const VALID_SCAN_ID = '7cece1f1-6c12-48ff-9e08-bcf1185c74dd';
  const VALID_ORG_ID = 'e8af4ad0-7120-428d-b73d-ccbf728e27fe';
  const VALID_USER_ID = 'a3c1d8f2-9b4e-4a7c-8d5e-1f2b3c4d5e6f';

  beforeEach(async () => {
    evaluationRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((entity) => entity),
      save: jest.fn((entity) =>
        Promise.resolve({ ...entity, id: 'eval-uuid' }),
      ),
    } as unknown as jest.Mocked<Repository<PolicyEvaluation>>;

    queueService = {
      addEvaluationJob: jest.fn().mockResolvedValue('job-1'),
    };
    policyService = {
      getEffectivePolicy: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EvaluationService,
        {
          provide: getRepositoryToken(PolicyEvaluation),
          useValue: evaluationRepo,
        },
        { provide: EvaluationQueueService, useValue: queueService },
        { provide: PolicyService, useValue: policyService },
      ],
    }).compile();

    service = module.get(EvaluationService);
  });

  describe('triggerEvaluation (no policies applied path)', () => {
    beforeEach(() => {
      policyService.getEffectivePolicy.mockResolvedValue({
        appliedPolicies: [],
      });
    });

    it('coerces a non-UUID triggeredBy (e.g. "osv-sync-cron") to null before persisting', async () => {
      await service.triggerEvaluation({
        scanId: VALID_SCAN_ID,
        projectId: VALID_PROJECT_ID,
        organizationId: VALID_ORG_ID,
        triggeredBy: 'osv-sync-cron',
      });

      expect(evaluationRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ triggeredBy: null }),
      );
      expect(evaluationRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ triggeredBy: null }),
      );
    });

    it('preserves a valid UUID triggeredBy', async () => {
      await service.triggerEvaluation({
        scanId: VALID_SCAN_ID,
        projectId: VALID_PROJECT_ID,
        organizationId: VALID_ORG_ID,
        triggeredBy: VALID_USER_ID,
      });

      expect(evaluationRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ triggeredBy: VALID_USER_ID }),
      );
    });

    it('coerces an empty string triggeredBy to null', async () => {
      await service.triggerEvaluation({
        scanId: VALID_SCAN_ID,
        projectId: VALID_PROJECT_ID,
        organizationId: VALID_ORG_ID,
        triggeredBy: '',
      });

      expect(evaluationRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ triggeredBy: null }),
      );
    });
  });

  describe('triggerEvaluation (queued path)', () => {
    beforeEach(() => {
      policyService.getEffectivePolicy.mockResolvedValue({
        appliedPolicies: [{ id: 'p1' }],
      });
    });

    it('coerces a non-UUID triggeredBy to null on the queued path too', async () => {
      await service.triggerEvaluation({
        scanId: VALID_SCAN_ID,
        projectId: VALID_PROJECT_ID,
        organizationId: VALID_ORG_ID,
        triggeredBy: 'osv-sync-cron',
      });

      expect(evaluationRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          triggeredBy: null,
          status: EvaluationStatus.PENDING,
        }),
      );
    });
  });

  // The trigger resolves the project's hierarchy in
  // global-management to know whether any policy applies; the job carries it so
  // the processor does not resolve it a second time. It is the hierarchy
  // global-management answered, never the organization or team of the request.
  describe('triggerEvaluation hands the job the hierarchy it resolved', () => {
    it('queues the organization and team resolved from global-management', async () => {
      policyService.getEffectivePolicy.mockResolvedValue({
        appliedPolicies: [{ id: 'p1' }],
        hierarchy: { organizationId: 'org-from-gm', teamId: 'team-from-gm' },
      });

      await service.triggerEvaluation({
        scanId: VALID_SCAN_ID,
        projectId: VALID_PROJECT_ID,
        organizationId: VALID_ORG_ID,
        teamId: 'team-from-request',
        triggeredBy: '',
      });

      expect(policyService.getEffectivePolicy).toHaveBeenCalledTimes(1);
      expect(queueService.addEvaluationJob).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: VALID_PROJECT_ID,
          hierarchy: { organizationId: 'org-from-gm', teamId: 'team-from-gm' },
        }),
      );
    });

    it('queues a project without a team as such', async () => {
      policyService.getEffectivePolicy.mockResolvedValue({
        appliedPolicies: [{ id: 'p1' }],
        hierarchy: { organizationId: 'org-from-gm', teamId: null },
      });

      await service.triggerEvaluation({
        scanId: VALID_SCAN_ID,
        projectId: VALID_PROJECT_ID,
        organizationId: VALID_ORG_ID,
        triggeredBy: '',
      });

      expect(queueService.addEvaluationJob).toHaveBeenCalledWith(
        expect.objectContaining({
          hierarchy: { organizationId: 'org-from-gm', teamId: null },
        }),
      );
    });
  });

  describe('triggerOsvBasedEvaluation', () => {
    it('coerces a non-UUID triggeredBy to null when creating evaluations for affected projects', async () => {
      evaluationRepo.findOne = jest.fn().mockResolvedValue({
        organizationId: VALID_ORG_ID,
        teamId: null,
      });

      await service.triggerOsvBasedEvaluation(
        [VALID_PROJECT_ID],
        'osv-sync-cron',
      );

      expect(evaluationRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ triggeredBy: null }),
      );
    });
  });
});
