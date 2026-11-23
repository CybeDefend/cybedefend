import { PolicyScope } from '@grpc/policy-management/policy_types';
import { PolicyScopeDto, ScannerTypeEnum } from '../dto/body';
import { EvaluationStatusEnum } from '../dto/response';

/**
 * Map scope enum to proto value. The proto enum starts with
 * POLICY_SCOPE_UNSPECIFIED = 0: the former 0/1/2 sent ORGANIZATION as
 * « unspecified », TEAM as ORGANIZATION and PROJECT as TEAM.
 */
export function scopeToProto(scope: PolicyScopeDto): PolicyScope {
  switch (scope) {
    case PolicyScopeDto.ORGANIZATION:
      return PolicyScope.POLICY_SCOPE_ORGANIZATION;
    case PolicyScopeDto.TEAM:
      return PolicyScope.POLICY_SCOPE_TEAM;
    case PolicyScopeDto.PROJECT:
      return PolicyScope.POLICY_SCOPE_PROJECT;
    default:
      return PolicyScope.POLICY_SCOPE_PROJECT;
  }
}

/**
 * Map proto value to scope string (handles both numeric and string enums)
 */
export function scopeFromProto(scope: number | string): string {
  // With enums: String in gRPC loader, enums come as strings
  if (typeof scope === 'string') {
    const upper = scope.toUpperCase();
    if (upper === 'ORGANIZATION' || upper === 'POLICY_SCOPE_ORGANIZATION') {
      return 'ORGANIZATION';
    }
    if (upper === 'TEAM' || upper === 'POLICY_SCOPE_TEAM') {
      return 'TEAM';
    }
    if (upper === 'PROJECT' || upper === 'POLICY_SCOPE_PROJECT') {
      return 'PROJECT';
    }
    return 'PROJECT';
  }
  // Fallback for numeric enums
  switch (scope) {
    case 0:
      return 'ORGANIZATION';
    case 1:
      return 'TEAM';
    case 2:
      return 'PROJECT';
    default:
      return 'PROJECT';
  }
}

/**
 * Map scanner type string to proto enum value (matches ScannerType in policy_types.proto)
 */
export function scannerTypeToProto(
  scannerType: ScannerTypeEnum | string,
): number {
  switch (scannerType.toLowerCase()) {
    case 'sast':
      return 1; // SCANNER_TYPE_SAST
    case 'sca':
      return 2; // SCANNER_TYPE_SCA
    case 'iac':
      return 3; // SCANNER_TYPE_IAC
    case 'container':
      return 4; // SCANNER_TYPE_CONTAINER
    case 'secret':
      return 5; // SCANNER_TYPE_SECRET
    case 'cicd':
      return 6; // SCANNER_TYPE_CICD
    default:
      return 0; // SCANNER_TYPE_UNSPECIFIED
  }
}

/**
 * Map proto enum value to scanner type string (matches ScannerType in policy_types.proto)
 */
export function scannerTypeFromProto(value: number): string {
  switch (value) {
    case 1:
      return 'sast';
    case 2:
      return 'sca';
    case 3:
      return 'iac';
    case 4:
      return 'container';
    case 5:
      return 'secret';
    case 6:
      return 'cicd';
    default:
      return 'unknown';
  }
}

/**
 * Map evaluation status proto value to enum (handles both numeric and string enums)
 * With enums: String in gRPC loader, enums come as strings like "EVALUATION_STATUS_COMPLETED"
 */
export function evaluationStatusFromProto(
  status: number | string,
): EvaluationStatusEnum {
  // Handle string enum values from gRPC loader with enums: String
  if (typeof status === 'string') {
    const upper = status.toUpperCase();
    if (upper === 'COMPLETED' || upper === 'EVALUATION_STATUS_COMPLETED') {
      return EvaluationStatusEnum.COMPLETED;
    }
    if (upper === 'IN_PROGRESS' || upper === 'EVALUATION_STATUS_IN_PROGRESS') {
      return EvaluationStatusEnum.IN_PROGRESS;
    }
    if (upper === 'FAILED' || upper === 'EVALUATION_STATUS_FAILED') {
      return EvaluationStatusEnum.FAILED;
    }
    if (upper === 'NOT_STARTED' || upper === 'EVALUATION_STATUS_NOT_STARTED') {
      return EvaluationStatusEnum.NOT_STARTED;
    }
    if (upper === 'PENDING' || upper === 'EVALUATION_STATUS_PENDING') {
      return EvaluationStatusEnum.PENDING;
    }
    // Default for unrecognized string values
    return EvaluationStatusEnum.PENDING;
  }

  // Handle numeric enum values (fallback)
  switch (status) {
    case 0:
      return EvaluationStatusEnum.PENDING;
    case 1:
      return EvaluationStatusEnum.PENDING;
    case 2:
      return EvaluationStatusEnum.IN_PROGRESS;
    case 3:
      return EvaluationStatusEnum.COMPLETED;
    case 4:
      return EvaluationStatusEnum.FAILED;
    case 5:
      return EvaluationStatusEnum.NOT_STARTED;
    default:
      return EvaluationStatusEnum.PENDING;
  }
}
