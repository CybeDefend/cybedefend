import { Controller, Logger } from '@nestjs/common';
import { PolicyService } from './policy.service';
import { PolicyValidationService } from './policy-validation.service';
import { PolicyYamlService } from './policy-yaml.service';
import {
  SecurityPolicy as SecurityPolicyEntity,
  PolicyScope,
} from '@entities/security-policy.entity';
import {
  PolicyServiceController,
  PolicyServiceControllerMethods,
} from '@core/grpc/policy-management/policy_management';
import {
  CountPoliciesForOrgRequest,
  CountPoliciesForOrgResponse,
  CreatePolicyRequest,
  DeleteAllPoliciesForOrgRequest,
  DeleteAllPoliciesForOrgResponse,
  DeletePolicyRequest,
  DeletePolicyResponse,
  EffectivePolicyResponse,
  ExportPolicyYamlRequest,
  ExportPolicyYamlResponse,
  GetEffectivePolicyRequest,
  GetPolicyRequest,
  ListPoliciesRequest,
  ListPoliciesResponse,
  PolicyResponse,
  TogglePolicyRequest,
  TogglePolicyResponse,
  UpdatePolicyRequest,
  ValidatePolicyRequest,
  ValidatePolicyResponse,
} from '@core/grpc/policy-management/policy';
import {
  PolicyScope as ProtoPolicyScope,
  SecurityPolicy as SecurityPolicyProto,
} from '@core/grpc/policy-management/policy_types';

/**
 * Map entity scope to proto enum
 */
function entityScopeToProto(scope: PolicyScope): number {
  switch (scope) {
    case PolicyScope.ORGANIZATION:
      return 1;
    case PolicyScope.TEAM:
      return 2;
    case PolicyScope.PROJECT:
      return 3;
    default:
      return 3;
  }
}

/**
 * Map the scope a request filters on to the entity enum, or undefined when it
 * filters on none. The gRPC loader (main.ts, `enums: String`) delivers an
 * enum as its NAME ('POLICY_SCOPE_TEAM'), never as a number: matching numbers
 * only filtered every scope as PROJECT. The numbers stay for in-process
 * callers that build the request themselves.
 */
function protoScopeToEntity(
  scope: ProtoPolicyScope | string | undefined,
): PolicyScope | undefined {
  switch (scope) {
    case ProtoPolicyScope.POLICY_SCOPE_ORGANIZATION:
    case 'POLICY_SCOPE_ORGANIZATION':
      return PolicyScope.ORGANIZATION;
    case ProtoPolicyScope.POLICY_SCOPE_TEAM:
    case 'POLICY_SCOPE_TEAM':
      return PolicyScope.TEAM;
    case ProtoPolicyScope.POLICY_SCOPE_PROJECT:
    case 'POLICY_SCOPE_PROJECT':
      return PolicyScope.PROJECT;
    default:
      return undefined;
  }
}

/**
 * Convert entity to proto response
 */
function policyToProto(policy: SecurityPolicyEntity): SecurityPolicyProto {
  return {
    id: policy.id,
    scope: entityScopeToProto(policy.scope),
    organizationId: policy.organizationId,
    projectIds: policy.projectIds || [],
    teamIds: policy.teamIds || [],
    name: policy.name,
    description: policy.description || '',
    priority: policy.priority,
    configJson: JSON.stringify({
      rules: policy.rules?.rules || [],
      exclusions: policy.exclusions || [],
    }),
    isEnabled: policy.isEnabled,
    createdAt: policy.createdAt.getTime(),
    updatedAt: policy.updatedAt.getTime(),
    createdBy: policy.createdBy || '',
    updatedBy: policy.updatedBy || '',
  };
}

/**
 * gRPC controller for Policy CRUD operations
 */
@Controller()
@PolicyServiceControllerMethods()
export class PolicyController implements PolicyServiceController {
  private readonly logger = new Logger(PolicyController.name);

  constructor(
    private readonly policyService: PolicyService,
    private readonly validationService: PolicyValidationService,
    private readonly yamlService: PolicyYamlService,
  ) {}

  /**
   * Create a new security policy from YAML content
   */
  async createPolicy(data: CreatePolicyRequest): Promise<PolicyResponse> {
    this.logger.log(`CreatePolicy for organization: ${data.organizationId}`);

    const policy = await this.policyService.createPolicyFromYaml({
      organizationId: data.organizationId,
      yamlContent: data.yamlContent,
      createdBy: data.createdBy,
    });

    return { policy: policyToProto(policy) };
  }

  /**
   * Update an existing policy from YAML content
   */
  async updatePolicy(data: UpdatePolicyRequest): Promise<PolicyResponse> {
    this.logger.log(`UpdatePolicy: ${data.policyId}`);

    const policy = await this.policyService.updatePolicyFromYaml({
      policyId: data.policyId,
      organizationId: data.organizationId,
      yamlContent: data.yamlContent,
      updatedBy: data.updatedBy,
    });

    return { policy: policyToProto(policy) };
  }

  /**
   * Get a policy by ID
   */
  async getPolicy(data: GetPolicyRequest): Promise<PolicyResponse> {
    this.logger.log(`GetPolicy: ${data.policyId}`);

    const policy = await this.policyService.getPolicyForOrganization(
      data.policyId,
      data.organizationId,
    );
    return { policy: policyToProto(policy) };
  }

  /**
   * List policies with filtering
   */
  async listPolicies(data: ListPoliciesRequest): Promise<ListPoliciesResponse> {
    this.logger.log(`ListPolicies for organization: ${data.organizationId}`);

    const result = await this.policyService.listPolicies({
      organizationId: data.organizationId,
      scope: protoScopeToEntity(data.scope),
      isEnabled: data.isEnabled,
      page: data.page || 1,
      pageSize: data.pageSize || 20,
      search: data.search,
    });

    return {
      policies: result.policies.map(policyToProto),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    };
  }

  /**
   * Delete a policy
   */
  async deletePolicy(data: DeletePolicyRequest): Promise<DeletePolicyResponse> {
    this.logger.log(`DeletePolicy: ${data.policyId}`);

    return this.policyService.deletePolicy(
      data.policyId,
      data.organizationId,
      data.deletedBy,
    );
  }

  /**
   * Toggle policy enabled/disabled state
   */
  async togglePolicy(data: TogglePolicyRequest): Promise<TogglePolicyResponse> {
    this.logger.log(
      `TogglePolicy: ${data.policyId} -> ${data.isEnabled ? 'enabled' : 'disabled'}`,
    );

    const result = await this.policyService.togglePolicy(
      data.policyId,
      data.organizationId,
      data.isEnabled,
      data.updatedBy,
    );

    return {
      success: result.success,
      message: result.message,
      policy: policyToProto(result.policy),
    };
  }

  /**
   * Get effective (merged) policy for a project
   */
  async getEffectivePolicy(
    data: GetEffectivePolicyRequest,
  ): Promise<EffectivePolicyResponse> {
    this.logger.log(`GetEffectivePolicy: project=${data.projectId}`);

    const result = await this.policyService.getEffectivePolicy(data.projectId);

    return {
      effectiveConfigJson: JSON.stringify(result.effectiveConfig),
      appliedPolicies: result.appliedPolicies.map(policyToProto),
    };
  }

  /**
   * Validate policy YAML configuration
   */
  async validatePolicy(
    data: ValidatePolicyRequest,
  ): Promise<ValidatePolicyResponse> {
    this.logger.log('ValidatePolicy (YAML)');

    // First, try to parse the YAML to get the rules config
    try {
      const parsed = this.yamlService.parseFullYaml(data.yamlContent);
      // If parsing succeeds, validate the config JSON
      const configJson = JSON.stringify(parsed.config);
      return this.validationService.validate(configJson);
    } catch (error) {
      // If YAML parsing fails, return the error
      const message =
        error instanceof Error ? error.message : 'Invalid YAML format';
      return {
        valid: false,
        errors: [message],
        warnings: [],
      };
    }
  }

  /**
   * Export policy as YAML
   */
  async exportPolicyYaml(
    data: ExportPolicyYamlRequest,
  ): Promise<ExportPolicyYamlResponse> {
    this.logger.log(`ExportPolicyYaml: ${data.policyId}`);

    const policy = await this.policyService.getPolicyForOrganization(
      data.policyId,
      data.organizationId,
    );
    const yamlContent = this.yamlService.exportToYaml(policy);

    return { yamlContent };
  }

  /**
   * Count all policies for an organization (used by a closed extension).
   */
  async countPoliciesForOrg(
    data: CountPoliciesForOrgRequest,
  ): Promise<CountPoliciesForOrgResponse> {
    this.logger.log(`CountPoliciesForOrg: ${data.organizationId}`);
    const count = await this.policyService.countPoliciesForOrg(
      data.organizationId,
    );
    return { count };
  }

  /**
   * Delete all policies for an organization (used by a closed extension).
   * Destructive.
   */
  async deleteAllPoliciesForOrg(
    data: DeleteAllPoliciesForOrgRequest,
  ): Promise<DeleteAllPoliciesForOrgResponse> {
    this.logger.log(`DeleteAllPoliciesForOrg: ${data.organizationId}`);
    const deletedCount = await this.policyService.deleteAllPoliciesForOrg(
      data.organizationId,
    );
    return { deletedCount };
  }
}
