import { mapProjectContextToScoringContext } from './security-context-mapper';
import {
  ProjectSecurityContext,
  ProjectEnvironmentEnum,
  InternetExposureEnum,
  DataClassificationEnum,
  BusinessCriticalityEnum,
  UserBaseSizeEnum,
  NetworkSegmentationEnum,
} from '@grpc/global-management/project';

describe('mapProjectContextToScoringContext', () => {
  const baseCtx: ProjectSecurityContext = {
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

  it('does not include userBaseSize in the scoring context output (dead field)', () => {
    const out = mapProjectContextToScoringContext(baseCtx);
    expect(out).not.toHaveProperty('userBaseSize');
  });

  it('maps all string fields correctly for a production/public/confidential/high context', () => {
    const out = mapProjectContextToScoringContext(baseCtx);
    expect(out).toEqual({
      environment: 'production',
      internetExposure: 'public',
      dataClassification: 'confidential',
      businessCriticality: 'high',
      networkSegmentation: 'segmented',
      handlesPii: true,
      handlesPaymentData: false,
      safetyCritical: false,
    });
  });

  it("falls back to 'unspecified' for unknown/UNSPECIFIED enum values", () => {
    const out = mapProjectContextToScoringContext({
      ...baseCtx,
      environment: ProjectEnvironmentEnum.PROJECT_ENVIRONMENT_UNSPECIFIED,
      internetExposure: InternetExposureEnum.INTERNET_EXPOSURE_UNSPECIFIED,
      dataClassification:
        DataClassificationEnum.DATA_CLASSIFICATION_UNSPECIFIED,
      businessCriticality:
        BusinessCriticalityEnum.BUSINESS_CRITICALITY_UNSPECIFIED,
      networkSegmentation:
        NetworkSegmentationEnum.NETWORK_SEGMENTATION_UNSPECIFIED,
    });
    expect(out.environment).toBe('unspecified');
    expect(out.internetExposure).toBe('unspecified');
    expect(out.dataClassification).toBe('unspecified');
    expect(out.businessCriticality).toBe('unspecified');
    expect(out.networkSegmentation).toBe('unspecified');
    expect(out).not.toHaveProperty('userBaseSize');
  });
});
