import {
  CreateProjectSecurityContextInput,
  UpdateProjectSecurityContextRequest,
  ProjectEnvironmentEnum,
  InternetExposureEnum,
  DeploymentTypeEnum,
  DataClassificationEnum,
  BusinessCriticalityEnum,
  UserBaseSizeEnum,
  NetworkSegmentationEnum,
} from '@grpc/global-management/project';
import { ProjectSecurityContextUpdateDto } from '../dto/body/project-security-context-update.dto';

const ENVIRONMENT_STRING_TO_ENUM: Record<string, ProjectEnvironmentEnum> = {
  production: ProjectEnvironmentEnum.PROJECT_ENVIRONMENT_PRODUCTION,
  staging: ProjectEnvironmentEnum.PROJECT_ENVIRONMENT_STAGING,
  development: ProjectEnvironmentEnum.PROJECT_ENVIRONMENT_DEVELOPMENT,
};

const INTERNET_EXPOSURE_STRING_TO_ENUM: Record<string, InternetExposureEnum> = {
  public: InternetExposureEnum.INTERNET_EXPOSURE_PUBLIC,
  internal: InternetExposureEnum.INTERNET_EXPOSURE_INTERNAL,
  airgapped: InternetExposureEnum.INTERNET_EXPOSURE_AIRGAPPED,
};

const DEPLOYMENT_TYPE_STRING_TO_ENUM: Record<string, DeploymentTypeEnum> = {
  saas: DeploymentTypeEnum.DEPLOYMENT_TYPE_SAAS,
  onprem: DeploymentTypeEnum.DEPLOYMENT_TYPE_ONPREM,
  embedded: DeploymentTypeEnum.DEPLOYMENT_TYPE_EMBEDDED,
  mobile: DeploymentTypeEnum.DEPLOYMENT_TYPE_MOBILE,
};

const DATA_CLASSIFICATION_STRING_TO_ENUM: Record<
  string,
  DataClassificationEnum
> = {
  public: DataClassificationEnum.DATA_CLASSIFICATION_PUBLIC,
  internal: DataClassificationEnum.DATA_CLASSIFICATION_INTERNAL,
  confidential: DataClassificationEnum.DATA_CLASSIFICATION_CONFIDENTIAL,
  regulated: DataClassificationEnum.DATA_CLASSIFICATION_REGULATED,
};

const BUSINESS_CRITICALITY_STRING_TO_ENUM: Record<
  string,
  BusinessCriticalityEnum
> = {
  low: BusinessCriticalityEnum.BUSINESS_CRITICALITY_LOW,
  medium: BusinessCriticalityEnum.BUSINESS_CRITICALITY_MEDIUM,
  high: BusinessCriticalityEnum.BUSINESS_CRITICALITY_HIGH,
  mission_critical:
    BusinessCriticalityEnum.BUSINESS_CRITICALITY_MISSION_CRITICAL,
};

const USER_BASE_SIZE_STRING_TO_ENUM: Record<string, UserBaseSizeEnum> = {
  small: UserBaseSizeEnum.USER_BASE_SIZE_SMALL,
  medium: UserBaseSizeEnum.USER_BASE_SIZE_MEDIUM,
  large: UserBaseSizeEnum.USER_BASE_SIZE_LARGE,
};

const NETWORK_SEGMENTATION_STRING_TO_ENUM: Record<
  string,
  NetworkSegmentationEnum
> = {
  flat: NetworkSegmentationEnum.NETWORK_SEGMENTATION_FLAT,
  segmented: NetworkSegmentationEnum.NETWORK_SEGMENTATION_SEGMENTED,
  microsegmented: NetworkSegmentationEnum.NETWORK_SEGMENTATION_MICROSEGMENTED,
};

/**
 * Map the REST security context payload (strings) to the gRPC
 * CreateProjectSecurityContextInput (proto enum numbers). Only defined
 * fields are propagated — the backend applies defaults for the rest.
 */
export function mapSecurityContextBodyToCreateInput(
  body: ProjectSecurityContextUpdateDto,
): CreateProjectSecurityContextInput {
  const out: CreateProjectSecurityContextInput = {
    complianceFrameworks: [],
  };
  if (body.environment !== undefined) {
    out.environment = ENVIRONMENT_STRING_TO_ENUM[body.environment];
  }
  if (body.internetExposure !== undefined) {
    out.internetExposure =
      INTERNET_EXPOSURE_STRING_TO_ENUM[body.internetExposure];
  }
  if (body.deploymentType !== undefined) {
    out.deploymentType = DEPLOYMENT_TYPE_STRING_TO_ENUM[body.deploymentType];
  }
  if (body.dataClassification !== undefined) {
    out.dataClassification =
      DATA_CLASSIFICATION_STRING_TO_ENUM[body.dataClassification];
  }
  if (body.handlesPii !== undefined) {
    out.handlesPii = body.handlesPii;
  }
  if (body.handlesPaymentData !== undefined) {
    out.handlesPaymentData = body.handlesPaymentData;
  }
  if (body.businessCriticality !== undefined) {
    out.businessCriticality =
      BUSINESS_CRITICALITY_STRING_TO_ENUM[body.businessCriticality];
  }
  if (body.userBaseSize !== undefined) {
    out.userBaseSize = USER_BASE_SIZE_STRING_TO_ENUM[body.userBaseSize];
  }
  if (body.complianceFrameworks !== undefined) {
    out.complianceFrameworks = body.complianceFrameworks;
  }
  if (body.safetyCritical !== undefined) {
    out.safetyCritical = body.safetyCritical;
  }
  if (body.networkSegmentation !== undefined) {
    out.networkSegmentation =
      NETWORK_SEGMENTATION_STRING_TO_ENUM[body.networkSegmentation];
  }
  return out;
}

/**
 * Map the REST security context payload to the gRPC
 * UpdateProjectSecurityContextRequest (Create input + projectId).
 */
export function mapSecurityContextBodyToUpdateRequest(
  projectId: string,
  body: ProjectSecurityContextUpdateDto,
): UpdateProjectSecurityContextRequest {
  return {
    projectId,
    ...mapSecurityContextBodyToCreateInput(body),
  };
}
