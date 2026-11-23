import { Job } from 'bullmq';
import { CvssRecalculationQueueProcessor } from './cvss-recalculation-queue.processor';
import {
  ProjectEnvironmentEnum,
  InternetExposureEnum,
  DataClassificationEnum,
  BusinessCriticalityEnum,
  UserBaseSizeEnum,
  NetworkSegmentationEnum,
  ProjectSecurityContext,
} from '@grpc/global-management/project';

describe('CvssRecalculationQueueProcessor', () => {
  let processor: CvssRecalculationQueueProcessor;
  let cvssRecalculationProcessor: {
    recalculateForProject: jest.Mock;
    recomputePrioritiesForProject: jest.Mock;
    refreshCvssFromOsv: jest.Mock;
  };
  let resultService: {
    getSecurityContextCached: jest.Mock;
    invalidateSecurityContextCache: jest.Mock;
  };
  let cyberiskEnqueuer: {
    enqueue: jest.Mock;
  };

  const mockSecurityContext: ProjectSecurityContext = {
    id: 'ctx-1',
    projectId: 'project-1',
    environment: ProjectEnvironmentEnum.PROJECT_ENVIRONMENT_PRODUCTION,
    internetExposure: InternetExposureEnum.INTERNET_EXPOSURE_PUBLIC,
    deploymentType: 0,
    dataClassification: DataClassificationEnum.DATA_CLASSIFICATION_CONFIDENTIAL,
    handlesPii: true,
    handlesPaymentData: false,
    businessCriticality: BusinessCriticalityEnum.BUSINESS_CRITICALITY_HIGH,
    userBaseSize: UserBaseSizeEnum.USER_BASE_SIZE_LARGE,
    complianceFrameworks: [],
    safetyCritical: false,
    networkSegmentation: NetworkSegmentationEnum.NETWORK_SEGMENTATION_SEGMENTED,
    isCustomized: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };

  beforeEach(() => {
    cvssRecalculationProcessor = {
      recalculateForProject: jest.fn().mockResolvedValue(42),
      recomputePrioritiesForProject: jest.fn().mockResolvedValue(10),
      refreshCvssFromOsv: jest.fn().mockResolvedValue(3),
    };

    resultService = {
      invalidateSecurityContextCache: jest.fn(),
      getSecurityContextCached: jest
        .fn()
        .mockResolvedValue(mockSecurityContext),
    };

    cyberiskEnqueuer = {
      enqueue: jest.fn().mockResolvedValue(undefined),
    };

    processor = new CvssRecalculationQueueProcessor(
      cvssRecalculationProcessor as any,
      resultService as any,
      cyberiskEnqueuer as any,
    );
  });

  function makeJob(data: Record<string, any>, id = 'job-1'): Job<any> {
    return { id, data } as unknown as Job<any>;
  }

  describe('context_change trigger', () => {
    it('should fetch security context and call recalculateForProject with string fields', async () => {
      const job = makeJob({
        projectId: 'project-1',
        trigger: 'context_change',
      });

      await processor.process(job);

      expect(resultService.invalidateSecurityContextCache).toHaveBeenCalledWith(
        'project-1',
      );
      expect(resultService.getSecurityContextCached).toHaveBeenCalledWith(
        'project-1',
      );
      expect(
        cvssRecalculationProcessor.recalculateForProject,
      ).toHaveBeenCalledWith('project-1', {
        environment: 'production',
        internetExposure: 'public',
        dataClassification: 'confidential',
        businessCriticality: 'high',
        networkSegmentation: 'segmented',
        handlesPii: true,
        handlesPaymentData: false,
        safetyCritical: false,
      });
      expect(cyberiskEnqueuer.enqueue).toHaveBeenCalledWith(
        'project-1',
        'security_context_update',
      );
    });

    it('should convert all enum values correctly', async () => {
      const ctx: ProjectSecurityContext = {
        ...mockSecurityContext,
        environment: ProjectEnvironmentEnum.PROJECT_ENVIRONMENT_STAGING,
        internetExposure: InternetExposureEnum.INTERNET_EXPOSURE_AIRGAPPED,
        dataClassification:
          DataClassificationEnum.DATA_CLASSIFICATION_REGULATED,
        businessCriticality:
          BusinessCriticalityEnum.BUSINESS_CRITICALITY_MISSION_CRITICAL,
        userBaseSize: UserBaseSizeEnum.USER_BASE_SIZE_SMALL,
        networkSegmentation:
          NetworkSegmentationEnum.NETWORK_SEGMENTATION_MICROSEGMENTED,
      };
      resultService.getSecurityContextCached.mockResolvedValue(ctx);

      const job = makeJob({
        projectId: 'project-1',
        trigger: 'context_change',
      });

      await processor.process(job);

      expect(
        cvssRecalculationProcessor.recalculateForProject,
      ).toHaveBeenCalledWith('project-1', {
        environment: 'staging',
        internetExposure: 'airgapped',
        dataClassification: 'regulated',
        businessCriticality: 'mission_critical',
        networkSegmentation: 'microsegmented',
        handlesPii: true,
        handlesPaymentData: false,
        safetyCritical: false,
      });
    });

    it('should use unspecified defaults for unknown enum values', async () => {
      const ctx: ProjectSecurityContext = {
        ...mockSecurityContext,
        environment: ProjectEnvironmentEnum.PROJECT_ENVIRONMENT_UNSPECIFIED,
        internetExposure: InternetExposureEnum.INTERNET_EXPOSURE_UNSPECIFIED,
        dataClassification:
          DataClassificationEnum.DATA_CLASSIFICATION_UNSPECIFIED,
        businessCriticality:
          BusinessCriticalityEnum.BUSINESS_CRITICALITY_UNSPECIFIED,
        userBaseSize: UserBaseSizeEnum.USER_BASE_SIZE_UNSPECIFIED,
        networkSegmentation:
          NetworkSegmentationEnum.NETWORK_SEGMENTATION_UNSPECIFIED,
      };
      resultService.getSecurityContextCached.mockResolvedValue(ctx);

      const job = makeJob({
        projectId: 'project-1',
        trigger: 'context_change',
      });

      await processor.process(job);

      expect(
        cvssRecalculationProcessor.recalculateForProject,
      ).toHaveBeenCalledWith('project-1', {
        environment: 'unspecified',
        internetExposure: 'unspecified',
        dataClassification: 'unspecified',
        businessCriticality: 'unspecified',
        networkSegmentation: 'unspecified',
        handlesPii: true,
        handlesPaymentData: false,
        safetyCritical: false,
      });
    });

    it('should map UNRECOGNIZED enum values (-1) to unspecified', async () => {
      resultService.getSecurityContextCached.mockResolvedValue({
        ...mockSecurityContext,
        environment: -1,
        internetExposure: -1,
        dataClassification: -1,
        businessCriticality: -1,
        userBaseSize: -1,
        networkSegmentation: -1,
        handlesPii: false,
        handlesPaymentData: false,
        safetyCritical: false,
      });

      const job = makeJob({
        projectId: 'project-1',
        trigger: 'context_change',
      });

      await processor.process(job);

      expect(
        cvssRecalculationProcessor.recalculateForProject,
      ).toHaveBeenCalledWith(
        'project-1',
        expect.objectContaining({
          environment: 'unspecified',
          internetExposure: 'unspecified',
          dataClassification: 'unspecified',
          businessCriticality: 'unspecified',
          networkSegmentation: 'unspecified',
        }),
      );
    });
  });

  describe('priority_recompute trigger', () => {
    it('should call recomputePrioritiesForProject with numeric businessCriticality and dataClassification', async () => {
      const job = makeJob({
        projectId: 'project-1',
        trigger: 'priority_recompute',
      });

      await processor.process(job);

      expect(resultService.invalidateSecurityContextCache).toHaveBeenCalledWith(
        'project-1',
      );
      expect(resultService.getSecurityContextCached).toHaveBeenCalledWith(
        'project-1',
      );
      expect(
        cvssRecalculationProcessor.recomputePrioritiesForProject,
      ).toHaveBeenCalledWith(
        'project-1',
        BusinessCriticalityEnum.BUSINESS_CRITICALITY_HIGH,
        DataClassificationEnum.DATA_CLASSIFICATION_CONFIDENTIAL,
      );
      expect(
        cvssRecalculationProcessor.recalculateForProject,
      ).not.toHaveBeenCalled();
    });

    it('should use 0 defaults when security context is null', async () => {
      resultService.getSecurityContextCached.mockResolvedValue(null);

      const job = makeJob({
        projectId: 'project-1',
        trigger: 'priority_recompute',
      });

      await processor.process(job);

      expect(
        cvssRecalculationProcessor.recomputePrioritiesForProject,
      ).toHaveBeenCalledWith('project-1', 0, 0);
    });
  });

  describe('osv_severity_change trigger', () => {
    it('calls refreshCvssFromOsv with the changed OSV ids and the scoring context', async () => {
      const job = makeJob({
        projectId: 'project-1',
        trigger: 'osv_severity_change',
        osvIds: ['CVE-1', 'CVE-2'],
      });

      await processor.process(job);

      expect(
        cvssRecalculationProcessor.refreshCvssFromOsv,
      ).toHaveBeenCalledWith(
        'project-1',
        ['CVE-1', 'CVE-2'],
        expect.objectContaining({
          environment: 'production',
          businessCriticality: 'high',
        }),
      );
      expect(
        cvssRecalculationProcessor.recalculateForProject,
      ).not.toHaveBeenCalled();
      expect(cyberiskEnqueuer.enqueue).toHaveBeenCalledWith(
        'project-1',
        'security_context_update',
      );
    });

    it('skips refreshCvssFromOsv when the security context is null', async () => {
      resultService.getSecurityContextCached.mockResolvedValue(null);

      const job = makeJob({
        projectId: 'project-1',
        trigger: 'osv_severity_change',
        osvIds: ['CVE-1'],
      });

      await processor.process(job);

      expect(
        cvssRecalculationProcessor.refreshCvssFromOsv,
      ).not.toHaveBeenCalled();
    });
  });

  describe('unknown trigger', () => {
    it('should default to recalculateForProject', async () => {
      const job = makeJob({
        projectId: 'project-1',
        trigger: 'some_unknown_trigger',
      });

      await processor.process(job);

      expect(
        cvssRecalculationProcessor.recalculateForProject,
      ).toHaveBeenCalled();
      expect(
        cvssRecalculationProcessor.recomputePrioritiesForProject,
      ).not.toHaveBeenCalled();
    });

    it('should default to recalculateForProject when trigger is undefined', async () => {
      const job = makeJob({
        projectId: 'project-1',
      });

      await processor.process(job);

      expect(
        cvssRecalculationProcessor.recalculateForProject,
      ).toHaveBeenCalled();
    });
  });

  describe('null SecurityContext handling', () => {
    it('should skip recalculateForProject when context is null for context_change', async () => {
      resultService.getSecurityContextCached.mockResolvedValue(null);

      const job = makeJob({
        projectId: 'project-1',
        trigger: 'context_change',
      });

      await processor.process(job);

      expect(
        cvssRecalculationProcessor.recalculateForProject,
      ).not.toHaveBeenCalled();
    });

    it('should skip recalculateForProject when context is null for unknown trigger', async () => {
      resultService.getSecurityContextCached.mockResolvedValue(null);

      const job = makeJob({
        projectId: 'project-1',
        trigger: 'unknown',
      });

      await processor.process(job);

      expect(
        cvssRecalculationProcessor.recalculateForProject,
      ).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should re-throw errors for BullMQ retry', async () => {
      const error = new Error('DB connection lost');
      resultService.getSecurityContextCached.mockRejectedValue(error);

      const job = makeJob({
        projectId: 'project-1',
        trigger: 'context_change',
      });

      await expect(processor.process(job)).rejects.toThrow(
        'DB connection lost',
      );
    });

    it('should re-throw when recalculateForProject fails', async () => {
      const error = new Error('Batch save failed');
      cvssRecalculationProcessor.recalculateForProject.mockRejectedValue(error);

      const job = makeJob({
        projectId: 'project-1',
        trigger: 'context_change',
      });

      await expect(processor.process(job)).rejects.toThrow('Batch save failed');
    });

    it('should re-throw when recomputePrioritiesForProject fails', async () => {
      const error = new Error('Priority compute failed');
      cvssRecalculationProcessor.recomputePrioritiesForProject.mockRejectedValue(
        error,
      );

      const job = makeJob({
        projectId: 'project-1',
        trigger: 'priority_recompute',
      });

      await expect(processor.process(job)).rejects.toThrow(
        'Priority compute failed',
      );
    });
  });
});
