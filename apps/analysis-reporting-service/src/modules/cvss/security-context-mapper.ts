import { SecurityContextForScoring } from './cvss-calculator.service';
import {
  ProjectSecurityContext,
  ProjectEnvironmentEnum,
  InternetExposureEnum,
  DataClassificationEnum,
  BusinessCriticalityEnum,
  NetworkSegmentationEnum,
} from '@grpc/global-management/project';

/**
 * Convert ProjectSecurityContext (numeric gRPC enums) to SecurityContextForScoring (string fields).
 *
 * The gRPC loader is configured with `enums: String`, so enum values may arrive
 * as string names (e.g. "PROJECT_ENVIRONMENT_PRODUCTION") or numbers.
 * Maps support both formats for robustness.
 */
export function mapProjectContextToScoringContext(
  ctx: ProjectSecurityContext,
): SecurityContextForScoring {
  return {
    environment: mapEnvironment(ctx.environment),
    internetExposure: mapInternetExposure(ctx.internetExposure),
    dataClassification: mapDataClassification(ctx.dataClassification),
    businessCriticality: mapBusinessCriticality(ctx.businessCriticality),
    networkSegmentation: mapNetworkSegmentation(ctx.networkSegmentation),
    handlesPii: ctx.handlesPii,
    handlesPaymentData: ctx.handlesPaymentData,
    safetyCritical: ctx.safetyCritical,
  };
}

function mapEnvironment(value: ProjectEnvironmentEnum | string): string {
  const map: Record<string | number, string> = {
    [ProjectEnvironmentEnum.PROJECT_ENVIRONMENT_PRODUCTION]: 'production',
    PROJECT_ENVIRONMENT_PRODUCTION: 'production',
    [ProjectEnvironmentEnum.PROJECT_ENVIRONMENT_STAGING]: 'staging',
    PROJECT_ENVIRONMENT_STAGING: 'staging',
    [ProjectEnvironmentEnum.PROJECT_ENVIRONMENT_DEVELOPMENT]: 'development',
    PROJECT_ENVIRONMENT_DEVELOPMENT: 'development',
  };
  return map[value] ?? 'unspecified';
}

function mapInternetExposure(value: InternetExposureEnum | string): string {
  const map: Record<string | number, string> = {
    [InternetExposureEnum.INTERNET_EXPOSURE_PUBLIC]: 'public',
    INTERNET_EXPOSURE_PUBLIC: 'public',
    [InternetExposureEnum.INTERNET_EXPOSURE_INTERNAL]: 'internal',
    INTERNET_EXPOSURE_INTERNAL: 'internal',
    [InternetExposureEnum.INTERNET_EXPOSURE_AIRGAPPED]: 'airgapped',
    INTERNET_EXPOSURE_AIRGAPPED: 'airgapped',
  };
  return map[value] ?? 'unspecified';
}

function mapDataClassification(value: DataClassificationEnum | string): string {
  const map: Record<string | number, string> = {
    [DataClassificationEnum.DATA_CLASSIFICATION_PUBLIC]: 'public',
    DATA_CLASSIFICATION_PUBLIC: 'public',
    [DataClassificationEnum.DATA_CLASSIFICATION_INTERNAL]: 'internal',
    DATA_CLASSIFICATION_INTERNAL: 'internal',
    [DataClassificationEnum.DATA_CLASSIFICATION_CONFIDENTIAL]: 'confidential',
    DATA_CLASSIFICATION_CONFIDENTIAL: 'confidential',
    [DataClassificationEnum.DATA_CLASSIFICATION_REGULATED]: 'regulated',
    DATA_CLASSIFICATION_REGULATED: 'regulated',
  };
  return map[value] ?? 'unspecified';
}

function mapBusinessCriticality(
  value: BusinessCriticalityEnum | string,
): string {
  const map: Record<string | number, string> = {
    [BusinessCriticalityEnum.BUSINESS_CRITICALITY_LOW]: 'low',
    BUSINESS_CRITICALITY_LOW: 'low',
    [BusinessCriticalityEnum.BUSINESS_CRITICALITY_MEDIUM]: 'medium',
    BUSINESS_CRITICALITY_MEDIUM: 'medium',
    [BusinessCriticalityEnum.BUSINESS_CRITICALITY_HIGH]: 'high',
    BUSINESS_CRITICALITY_HIGH: 'high',
    [BusinessCriticalityEnum.BUSINESS_CRITICALITY_MISSION_CRITICAL]:
      'mission_critical',
    BUSINESS_CRITICALITY_MISSION_CRITICAL: 'mission_critical',
  };
  return map[value] ?? 'unspecified';
}

function mapNetworkSegmentation(
  value: NetworkSegmentationEnum | string,
): string {
  const map: Record<string | number, string> = {
    [NetworkSegmentationEnum.NETWORK_SEGMENTATION_FLAT]: 'flat',
    NETWORK_SEGMENTATION_FLAT: 'flat',
    [NetworkSegmentationEnum.NETWORK_SEGMENTATION_SEGMENTED]: 'segmented',
    NETWORK_SEGMENTATION_SEGMENTED: 'segmented',
    [NetworkSegmentationEnum.NETWORK_SEGMENTATION_MICROSEGMENTED]:
      'microsegmented',
    NETWORK_SEGMENTATION_MICROSEGMENTED: 'microsegmented',
  };
  return map[value] ?? 'unspecified';
}
