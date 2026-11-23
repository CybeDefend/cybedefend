// src/modules/policy/policy.service.ts

import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { Span } from 'nestjs-otel';

import {
  POLICY_SERVICE_NAME,
  POLICY_EVALUATION_SERVICE_NAME,
  POLICY_VIOLATION_SERVICE_NAME,
  PolicyServiceClient,
  PolicyEvaluationServiceClient,
  PolicyViolationServiceClient,
} from '@grpc/policy-management/policy_management';

import {
  CreatePolicyRequest,
  UpdatePolicyRequest,
  GetPolicyRequest,
  ListPoliciesRequest,
  DeletePolicyRequest,
  TogglePolicyRequest,
  GetEffectivePolicyRequest,
  ValidatePolicyRequest,
  ExportPolicyYamlRequest,
  PolicyResponse,
  ListPoliciesResponse,
  DeletePolicyResponse,
  TogglePolicyResponse,
  EffectivePolicyResponse,
  ValidatePolicyResponse,
  ExportPolicyYamlResponse,
} from '@grpc/policy-management/policy';

import {
  TriggerEvaluationRequest,
  GetEvaluationStatusRequest,
  GetEvaluationStatusByScanIdRequest,
  GetComplianceResultRequest,
  GetComplianceHistoryRequest,
  DryRunEvaluationRequest,
  TriggerEvaluationResponse,
  GetEvaluationStatusResponse,
  GetEvaluationStatusByScanIdResponse,
  GetComplianceResultResponse,
  GetComplianceHistoryResponse,
  DryRunEvaluationResponse,
} from '@grpc/policy-management/evaluation';

import {
  GetScanViolationsRequest,
  GetProjectViolationsRequest,
  GetViolationStatsRequest,
  GetOrganizationComplianceOverviewRequest,
  GetScanViolationsResponse,
  GetProjectViolationsResponse,
  GetViolationStatsResponse,
  GetOrganizationComplianceOverviewResponse,
} from '@grpc/policy-management/violation';

import { safeGrpcCall } from '@grpc/wrapper-grpc';
import { wrapGrpcClientWithTracing } from '@grpc/traced-grpc-client';

@Injectable()
export class PolicyService implements OnModuleInit {
  private policyServiceClient!: PolicyServiceClient;
  private evaluationServiceClient!: PolicyEvaluationServiceClient;
  private violationServiceClient!: PolicyViolationServiceClient;

  constructor(
    @Inject('POLICY_MANAGEMENT_SERVICE')
    private readonly client: ClientGrpc,
  ) {}

  onModuleInit() {
    this.policyServiceClient = wrapGrpcClientWithTracing(
      this.client.getService<PolicyServiceClient>(POLICY_SERVICE_NAME),
    );
    this.evaluationServiceClient = wrapGrpcClientWithTracing(
      this.client.getService<PolicyEvaluationServiceClient>(
        POLICY_EVALUATION_SERVICE_NAME,
      ),
    );
    this.violationServiceClient = wrapGrpcClientWithTracing(
      this.client.getService<PolicyViolationServiceClient>(
        POLICY_VIOLATION_SERVICE_NAME,
      ),
    );
  }

  // ============================================================================
  // Policy CRUD Operations
  // ============================================================================

  @Span()
  createPolicy(data: CreatePolicyRequest): Promise<PolicyResponse> {
    return safeGrpcCall(this.policyServiceClient.createPolicy(data));
  }

  @Span()
  updatePolicy(data: UpdatePolicyRequest): Promise<PolicyResponse> {
    return safeGrpcCall(this.policyServiceClient.updatePolicy(data));
  }

  @Span()
  getPolicy(data: GetPolicyRequest): Promise<PolicyResponse> {
    return safeGrpcCall(this.policyServiceClient.getPolicy(data));
  }

  @Span()
  listPolicies(data: ListPoliciesRequest): Promise<ListPoliciesResponse> {
    return safeGrpcCall(this.policyServiceClient.listPolicies(data));
  }

  @Span()
  deletePolicy(data: DeletePolicyRequest): Promise<DeletePolicyResponse> {
    return safeGrpcCall(this.policyServiceClient.deletePolicy(data));
  }

  @Span()
  togglePolicy(data: TogglePolicyRequest): Promise<TogglePolicyResponse> {
    return safeGrpcCall(this.policyServiceClient.togglePolicy(data));
  }

  @Span()
  getEffectivePolicy(
    data: GetEffectivePolicyRequest,
  ): Promise<EffectivePolicyResponse> {
    return safeGrpcCall(this.policyServiceClient.getEffectivePolicy(data));
  }

  @Span()
  validatePolicy(data: ValidatePolicyRequest): Promise<ValidatePolicyResponse> {
    return safeGrpcCall(this.policyServiceClient.validatePolicy(data));
  }

  @Span()
  exportPolicyYaml(
    data: ExportPolicyYamlRequest,
  ): Promise<ExportPolicyYamlResponse> {
    return safeGrpcCall(this.policyServiceClient.exportPolicyYaml(data));
  }

  // ============================================================================
  // Policy Evaluation Operations
  // ============================================================================

  @Span()
  triggerEvaluation(
    data: TriggerEvaluationRequest,
  ): Promise<TriggerEvaluationResponse> {
    return safeGrpcCall(this.evaluationServiceClient.triggerEvaluation(data));
  }

  @Span()
  getEvaluationStatus(
    data: GetEvaluationStatusRequest,
  ): Promise<GetEvaluationStatusResponse> {
    return safeGrpcCall(this.evaluationServiceClient.getEvaluationStatus(data));
  }

  @Span()
  getEvaluationStatusByScanId(
    data: GetEvaluationStatusByScanIdRequest,
  ): Promise<GetEvaluationStatusByScanIdResponse> {
    return safeGrpcCall(
      this.evaluationServiceClient.getEvaluationStatusByScanId(data),
    );
  }

  @Span()
  getComplianceResult(
    data: GetComplianceResultRequest,
  ): Promise<GetComplianceResultResponse> {
    return safeGrpcCall(this.evaluationServiceClient.getComplianceResult(data));
  }

  @Span()
  getComplianceHistory(
    data: GetComplianceHistoryRequest,
  ): Promise<GetComplianceHistoryResponse> {
    return safeGrpcCall(
      this.evaluationServiceClient.getComplianceHistory(data),
    );
  }

  @Span()
  dryRunEvaluation(
    data: DryRunEvaluationRequest,
  ): Promise<DryRunEvaluationResponse> {
    return safeGrpcCall(this.evaluationServiceClient.dryRunEvaluation(data));
  }

  // ============================================================================
  // Policy Violation Operations
  // ============================================================================

  @Span()
  getScanViolations(
    data: GetScanViolationsRequest,
  ): Promise<GetScanViolationsResponse> {
    return safeGrpcCall(this.violationServiceClient.getScanViolations(data));
  }

  @Span()
  getProjectViolations(
    data: GetProjectViolationsRequest,
  ): Promise<GetProjectViolationsResponse> {
    return safeGrpcCall(this.violationServiceClient.getProjectViolations(data));
  }

  @Span()
  getViolationStats(
    data: GetViolationStatsRequest,
  ): Promise<GetViolationStatsResponse> {
    return safeGrpcCall(this.violationServiceClient.getViolationStats(data));
  }

  @Span()
  getOrganizationComplianceOverview(
    data: GetOrganizationComplianceOverviewRequest,
  ): Promise<GetOrganizationComplianceOverviewResponse> {
    return safeGrpcCall(
      this.violationServiceClient.getOrganizationComplianceOverview(data),
    );
  }
}
