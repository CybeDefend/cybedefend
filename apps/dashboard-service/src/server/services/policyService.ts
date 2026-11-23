// ============================================================================
// Policy Management Service
// ============================================================================

import gatewayAPI from '../api/gatewayAPI';
import {
  Policy,
  PolicyListResponse,
  CreatePolicyDto,
  UpdatePolicyDto,
  EffectivePolicyResponse,
  PolicyValidationResponse,
  ComplianceResult,
  ComplianceHistoryResponse,
  ViolationListResponse,
  ViolationStats,
  PolicyViolation,
  TriggerEvaluationResponse,
  EvaluationStatusResponse,
} from '../interfaces/Policy';

// ============================================================================
// Policy CRUD Operations
// ============================================================================

/**
 * Fetch paginated list of policies for an organization
 */
export const fetchPolicies = async (
  organizationId: string,
  params?: {
    scope?: string;
    targetId?: string;
    isEnabled?: boolean;
    page?: number;
    pageSize?: number;
    search?: string;
  }
): Promise<PolicyListResponse> => {
  const response = await gatewayAPI.get(
    `/organization/${organizationId}/policies`,
    { params }
  );
  return response.data;
};

/**
 * Fetch a single policy by ID
 */
export const fetchPolicy = async (
  organizationId: string,
  policyId: string
): Promise<Policy> => {
  const response = await gatewayAPI.get(
    `/organization/${organizationId}/policies/${policyId}`
  );
  return response.data;
};

/**
 * Create a new policy
 */
export const createPolicy = async (
  organizationId: string,
  data: CreatePolicyDto
): Promise<Policy> => {
  const response = await gatewayAPI.post(
    `/organization/${organizationId}/policies`,
    data
  );
  return response.data;
};

/**
 * Update an existing policy
 */
export const updatePolicy = async (
  organizationId: string,
  policyId: string,
  data: UpdatePolicyDto
): Promise<Policy> => {
  const response = await gatewayAPI.put(
    `/organization/${organizationId}/policies/${policyId}`,
    data
  );
  return response.data;
};

/**
 * Delete a policy
 */
export const deletePolicy = async (
  organizationId: string,
  policyId: string
): Promise<{ success: boolean; message: string }> => {
  const response = await gatewayAPI.delete(
    `/organization/${organizationId}/policies/${policyId}`
  );
  return response.data;
};

/**
 * Toggle a policy's enabled status
 */
export const togglePolicy = async (
  organizationId: string,
  policyId: string,
  isEnabled: boolean
): Promise<Policy> => {
  const response = await gatewayAPI.put(
    `/organization/${organizationId}/policies/${policyId}/toggle`,
    { isEnabled }
  );
  return response.data;
};

/**
 * Export a policy as YAML
 */
export const exportPolicyYaml = async (
  organizationId: string,
  policyId: string
): Promise<{ yamlContent: string }> => {
  const response = await gatewayAPI.get(
    `/organization/${organizationId}/policies/${policyId}/yaml`
  );
  return response.data;
};

/**
 * Validate a policy configuration without saving
 */
export const validatePolicyConfig = async (
  organizationId: string,
  yamlContent: string
): Promise<PolicyValidationResponse> => {
  const response = await gatewayAPI.post(
    `/organization/${organizationId}/policies/validate`,
    { yamlContent }
  );
  return response.data;
};

// ============================================================================
// Effective Policy
// ============================================================================

/**
 * Fetch the effective (merged) policies for a project
 */
export const fetchEffectivePolicy = async (
  projectId: string
): Promise<EffectivePolicyResponse> => {
  const response = await gatewayAPI.get(
    `/projects/${projectId}/effective-policies`
  );
  return response.data;
};

// ============================================================================
// Compliance & Evaluation
// ============================================================================

/**
 * Fetch the status of an evaluation
 */
export const fetchEvaluationStatus = async (
  projectId: string,
  scanId: string,
  evaluationId: string
): Promise<EvaluationStatusResponse> => {
  const response = await gatewayAPI.get(
    `/projects/${projectId}/scans/${scanId}/evaluate/${evaluationId}/status`
  );
  return response.data;
};

/**
 * Fetch the compliance result for a scan
 */
export const fetchComplianceResult = async (
  projectId: string,
  scanId: string,
  evaluationId?: string
): Promise<ComplianceResult> => {
  const response = await gatewayAPI.get(
    `/projects/${projectId}/scans/${scanId}/compliance`,
    { params: evaluationId ? { evaluationId } : undefined }
  );
  return response.data;
};

/**
 * Fetch compliance history for a project
 */
export const fetchComplianceHistory = async (
  projectId: string,
  params?: {
    page?: number;
    pageSize?: number;
    startDate?: string;
    endDate?: string;
  }
): Promise<ComplianceHistoryResponse> => {
  const response = await gatewayAPI.get(
    `/projects/${projectId}/compliance-history`,
    { params }
  );
  return response.data;
};

// ============================================================================
// Violations
// ============================================================================

/**
 * Fetch violations for a specific scan
 */
export const fetchScanViolations = async (
  projectId: string,
  scanId: string
): Promise<ViolationListResponse> => {
  const response = await gatewayAPI.get(
    `/projects/${projectId}/scans/${scanId}/violations`
  );
  return response.data;
};

/**
 * Fetch all violations for a project
 */
export const fetchProjectViolations = async (
  projectId: string,
  params?: {
    page?: number;
    limit?: number;
    acknowledged?: boolean;
    severity?: string[];
  }
): Promise<ViolationListResponse> => {
  const response = await gatewayAPI.get(
    `/projects/${projectId}/violations`,
    { params }
  );
  return response.data;
};

/**
 * Fetch violation statistics for a project
 */
export const fetchViolationStats = async (
  projectId: string,
  params?: { startDate?: string; endDate?: string }
): Promise<{ stats: ViolationStats }> => {
  const response = await gatewayAPI.get(
    `/projects/${projectId}/violation-stats`,
    { params }
  );
  return response.data;
};
