import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindOptionsWhere, ILike } from 'typeorm';
import type { ClientGrpc } from '@nestjs/microservices';
import { RpcException } from '@nestjs/microservices';
import { status as GrpcStatus } from '@grpc/grpc-js';
import {
  SecurityPolicy,
  PolicyScope,
  PolicyConfig,
  PolicyRule,
  RuleType,
} from '@entities/security-policy.entity';
import { ParsedPolicyYaml, PolicyYamlService } from './policy-yaml.service';
import { PolicyValidationService } from './policy-validation.service';
import { safeGrpcCall } from '@core/grpc/wrapper-grpc.module';
import { wrapGrpcClientWithTracing } from '@core/grpc/traced-grpc-client';
import {
  ProjectServiceClient,
  PROJECT_SERVICE_NAME,
  OrganizationServiceClient,
  ORGANIZATION_SERVICE_NAME,
  TeamServiceClient,
  TEAM_SERVICE_NAME,
} from '@core/grpc/global-management/global_management';

/**
 * Request DTO for creating a policy from YAML
 */
export interface CreatePolicyFromYamlDto {
  organizationId: string;
  yamlContent: string;
  createdBy: string;
}

/**
 * Request DTO for updating a policy from YAML
 */
export interface UpdatePolicyFromYamlDto {
  policyId: string;
  organizationId: string;
  yamlContent: string;
  updatedBy: string;
}

/**
 * Request DTO for listing policies
 */
export interface ListPoliciesDto {
  organizationId: string;
  scope?: PolicyScope;
  isEnabled?: boolean;
  page: number;
  pageSize: number;
  search?: string;
}

/**
 * The organization and team a project belongs to, as global-management
 * resolves them.
 */
export interface ProjectHierarchy {
  organizationId: string;
  /** null for a project that has no team. */
  teamId: string | null;
}

/**
 * The merged policy of a project, and the hierarchy it was merged for.
 */
export interface EffectivePolicy {
  effectiveConfig: PolicyConfig;
  appliedPolicies: SecurityPolicy[];
  hierarchy: ProjectHierarchy;
}

/**
 * Policy service - handles CRUD operations for security policies.
 */
@Injectable()
export class PolicyService implements OnModuleInit {
  private readonly logger = new Logger(PolicyService.name);
  private projectService: ProjectServiceClient;
  private organizationService: OrganizationServiceClient;
  private teamService: TeamServiceClient;

  constructor(
    @InjectRepository(SecurityPolicy)
    private readonly policyRepository: Repository<SecurityPolicy>,
    private readonly yamlService: PolicyYamlService,
    private readonly validationService: PolicyValidationService,
    @Inject('GLOBAL_MANAGEMENT_SERVICE')
    private readonly globalManagementClient: ClientGrpc,
  ) {}

  onModuleInit() {
    this.projectService = wrapGrpcClientWithTracing(
      this.globalManagementClient.getService<ProjectServiceClient>(
        PROJECT_SERVICE_NAME,
      ),
    );
    this.organizationService = wrapGrpcClientWithTracing(
      this.globalManagementClient.getService<OrganizationServiceClient>(
        ORGANIZATION_SERVICE_NAME,
      ),
    );
    this.teamService = wrapGrpcClientWithTracing(
      this.globalManagementClient.getService<TeamServiceClient>(
        TEAM_SERVICE_NAME,
      ),
    );
  }

  /**
   * Create a new security policy from YAML content
   */
  async createPolicyFromYaml(
    dto: CreatePolicyFromYamlDto,
  ): Promise<SecurityPolicy> {
    this.logger.log(`Creating policy for organization: ${dto.organizationId}`);

    // Parse and validate YAML content
    const parsed = this.parseAndValidate(dto.yamlContent);

    // Validate that projects/teams belong to the organization
    await this.validateTargetOwnership(
      parsed.scope,
      dto.organizationId,
      parsed.projectIds,
      parsed.teamIds,
    );

    // Check if a policy with the same name exists for this organization
    const existing = await this.policyRepository.findOne({
      where: {
        organizationId: dto.organizationId,
        name: parsed.name,
      },
    });

    if (existing) {
      throw new RpcException({
        code: GrpcStatus.ALREADY_EXISTS,
        message: `A policy with name "${parsed.name}" already exists for this organization`,
      });
    }

    // For ORGANIZATION scope, check that only one active policy exists per org
    if (parsed.scope === PolicyScope.ORGANIZATION && parsed.isEnabled) {
      const existingOrgPolicy = await this.policyRepository.findOne({
        where: {
          scope: PolicyScope.ORGANIZATION,
          organizationId: dto.organizationId,
          isEnabled: true,
        },
      });

      if (existingOrgPolicy) {
        throw new RpcException({
          code: GrpcStatus.FAILED_PRECONDITION,
          message:
            'Only one active organization-level policy is allowed. Disable the existing policy first or set enabled to false for the new one.',
        });
      }
    }

    const policy = this.policyRepository.create({
      scope: parsed.scope,
      organizationId: dto.organizationId,
      projectIds: parsed.projectIds,
      teamIds: parsed.teamIds,
      name: parsed.name,
      description: parsed.description || null,
      priority: parsed.priority,
      rules: parsed.config,
      exclusions: parsed.config.exclusions || [],
      isEnabled: parsed.isEnabled,
      createdBy: dto.createdBy,
      updatedBy: dto.createdBy,
    });

    const saved = await this.policyRepository.save(policy);
    this.logger.log(`Policy created: ${saved.id}`);
    return saved;
  }

  /**
   * Parse a policy and run the rule validation of the validate route on it.
   * A rule whose value can never match (an unknown severity, a CVSS score
   * outside 0-10, a negative age...) is refused here rather than stored,
   * because the policy would otherwise report every project as compliant.
   */
  private parseAndValidate(
    yamlContent: string,
    stored?: SecurityPolicy,
  ): ParsedPolicyYaml {
    const parsed = this.yamlService.parseFullYaml(yamlContent);
    const result = this.validationService.validate(
      JSON.stringify(parsed.config),
      { storedPatterns: stored ? storedGlobPatterns(stored) : undefined },
    );
    if (!result.valid) {
      throw new RpcException({
        code: GrpcStatus.INVALID_ARGUMENT,
        message: `Invalid policy: ${result.errors.join('; ')}`,
      });
    }
    for (const warning of result.warnings) {
      this.logger.warn(`Policy ${stored?.id ?? '(new)'}: ${warning}`);
    }
    return parsed;
  }

  /**
   * Update an existing policy from YAML content
   */
  async updatePolicyFromYaml(
    dto: UpdatePolicyFromYamlDto,
  ): Promise<SecurityPolicy> {
    this.logger.log(`Updating policy: ${dto.policyId}`);

    // Scope the lookup by organization to prevent cross-tenant writes (BOLA).
    const policy = await this.policyRepository.findOne({
      where: { id: dto.policyId, organizationId: dto.organizationId },
    });

    if (!policy) {
      throw new RpcException({
        code: GrpcStatus.NOT_FOUND,
        message: `Policy not found: ${dto.policyId}`,
      });
    }

    // Parse and validate YAML content. A glob pattern the policy already
    // holds does not block the update; a new or changed one is checked.
    const parsed = this.parseAndValidate(dto.yamlContent, policy);

    // Validate that projects/teams belong to the organization
    await this.validateTargetOwnership(
      parsed.scope,
      policy.organizationId,
      parsed.projectIds,
      parsed.teamIds,
    );

    // Check if name changed and conflicts with existing
    if (parsed.name !== policy.name) {
      const existing = await this.policyRepository.findOne({
        where: {
          organizationId: policy.organizationId,
          name: parsed.name,
        },
      });

      if (existing && existing.id !== policy.id) {
        throw new RpcException({
          code: GrpcStatus.ALREADY_EXISTS,
          message: `A policy with name "${parsed.name}" already exists for this organization`,
        });
      }
    }

    // For ORGANIZATION scope, ensure only one active policy
    if (
      parsed.isEnabled &&
      parsed.scope === PolicyScope.ORGANIZATION &&
      !policy.isEnabled
    ) {
      const existingActiveOrgPolicy = await this.policyRepository.findOne({
        where: {
          scope: PolicyScope.ORGANIZATION,
          organizationId: policy.organizationId,
          isEnabled: true,
        },
      });

      if (existingActiveOrgPolicy && existingActiveOrgPolicy.id !== policy.id) {
        throw new RpcException({
          code: GrpcStatus.FAILED_PRECONDITION,
          message:
            'Only one active organization-level policy is allowed. Disable the existing policy first.',
        });
      }
    }

    // Update policy
    policy.scope = parsed.scope;
    policy.projectIds = parsed.projectIds;
    policy.teamIds = parsed.teamIds;
    policy.name = parsed.name;
    policy.description = parsed.description || null;
    policy.priority = parsed.priority;
    policy.rules = parsed.config;
    policy.exclusions = parsed.config.exclusions || [];
    policy.isEnabled = parsed.isEnabled;
    policy.updatedBy = dto.updatedBy;

    const saved = await this.policyRepository.save(policy);
    this.logger.log(`Policy updated: ${saved.id}`);
    return saved;
  }

  /**
   * Validate that projects/teams belong to the organization.
   * Uses bulk validation endpoints for optimal performance (single SQL query).
   */
  private async validateTargetOwnership(
    scope: PolicyScope,
    organizationId: string,
    projectIds: string[],
    teamIds: string[],
  ): Promise<void> {
    if (scope === PolicyScope.PROJECT && projectIds.length > 0) {
      const response = await safeGrpcCall(
        this.projectService.validateProjectsInOrganization({
          projectIds,
          organizationId,
        }),
      );

      if (response.notFoundIds && response.notFoundIds.length > 0) {
        throw new RpcException({
          code: GrpcStatus.NOT_FOUND,
          message: `Project(s) not found: ${response.notFoundIds.join(', ')}`,
        });
      }

      if (response.invalidIds && response.invalidIds.length > 0) {
        throw new RpcException({
          code: GrpcStatus.PERMISSION_DENIED,
          message: `Project(s) do not belong to the organization: ${response.invalidIds.join(', ')}`,
        });
      }
    } else if (scope === PolicyScope.TEAM && teamIds.length > 0) {
      const response = await safeGrpcCall(
        this.teamService.validateTeamsInOrganization({
          teamIds,
          organizationId,
        }),
      );

      if (response.notFoundIds && response.notFoundIds.length > 0) {
        throw new RpcException({
          code: GrpcStatus.NOT_FOUND,
          message: `Team(s) not found in organization: ${response.notFoundIds.join(', ')}`,
        });
      }
    }
    // For ORGANIZATION scope, no validation needed
  }

  /**
   * Get a policy by ID, ensuring it belongs to the organization
   */
  async getPolicyForOrganization(
    policyId: string,
    organizationId: string,
  ): Promise<SecurityPolicy> {
    const policy = await this.policyRepository.findOne({
      where: { id: policyId, organizationId },
    });

    if (!policy) {
      throw new RpcException({
        code: GrpcStatus.NOT_FOUND,
        message: `Policy not found: ${policyId}`,
      });
    }

    return policy;
  }

  /**
   * List policies with filtering and pagination
   */
  async listPolicies(dto: ListPoliciesDto): Promise<{
    policies: SecurityPolicy[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const where: FindOptionsWhere<SecurityPolicy> = {
      organizationId: dto.organizationId,
    };

    if (dto.scope) {
      where.scope = dto.scope;
    }

    if (dto.isEnabled !== undefined) {
      where.isEnabled = dto.isEnabled;
    }

    if (dto.search) {
      where.name = ILike(`%${dto.search}%`);
    }

    const page = Math.max(1, dto.page);
    const pageSize = Math.min(100, Math.max(1, dto.pageSize));

    const [policies, total] = await this.policyRepository.findAndCount({
      where,
      order: { priority: 'ASC', createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    return { policies, total, page, pageSize };
  }

  /**
   * Count all policies belonging to an organization.
   * Used by a closed extension to compute deletion previews.
   */
  async countPoliciesForOrg(organizationId: string): Promise<number> {
    return this.policyRepository.count({ where: { organizationId } });
  }

  /**
   * Delete all policies belonging to an organization.
   * Used by a closed extension.
   * Returns the number of rows actually deleted.
   */
  async deleteAllPoliciesForOrg(organizationId: string): Promise<number> {
    const result = await this.policyRepository.delete({ organizationId });
    const affected = result.affected ?? 0;
    this.logger.log(
      `Deleted ${affected} policies for organization ${organizationId}`,
    );
    return affected;
  }

  /**
   * Delete a policy
   */
  async deletePolicy(
    policyId: string,
    organizationId: string,
    deletedBy: string,
  ): Promise<{ success: boolean; message: string }> {
    this.logger.log(`Deleting policy: ${policyId} by user: ${deletedBy}`);

    const policy = await this.policyRepository.findOne({
      where: { id: policyId, organizationId },
    });

    if (!policy) {
      throw new RpcException({
        code: GrpcStatus.NOT_FOUND,
        message: `Policy not found: ${policyId}`,
      });
    }

    await this.policyRepository.remove(policy);
    this.logger.log(`Policy deleted: ${policyId}`);

    return {
      success: true,
      message: `Policy "${policy.name}" deleted successfully`,
    };
  }

  /**
   * Toggle policy enabled/disabled state
   */
  async togglePolicy(
    policyId: string,
    organizationId: string,
    isEnabled: boolean,
    updatedBy: string,
  ): Promise<{ success: boolean; message: string; policy: SecurityPolicy }> {
    this.logger.log(
      `Toggling policy: ${policyId} to ${isEnabled ? 'enabled' : 'disabled'} by user: ${updatedBy}`,
    );

    const policy = await this.policyRepository.findOne({
      where: { id: policyId, organizationId },
    });

    if (!policy) {
      throw new RpcException({
        code: GrpcStatus.NOT_FOUND,
        message: `Policy not found: ${policyId}`,
      });
    }

    // For ORGANIZATION scope, ensure only one active policy when enabling
    if (isEnabled && policy.scope === PolicyScope.ORGANIZATION) {
      const existingActiveOrgPolicy = await this.policyRepository.findOne({
        where: {
          scope: PolicyScope.ORGANIZATION,
          organizationId,
          isEnabled: true,
        },
      });

      if (existingActiveOrgPolicy && existingActiveOrgPolicy.id !== policy.id) {
        throw new RpcException({
          code: GrpcStatus.FAILED_PRECONDITION,
          message:
            'Only one active organization-level policy is allowed. Disable the existing policy first.',
        });
      }
    }

    policy.isEnabled = isEnabled;
    policy.updatedBy = updatedBy;

    const saved = await this.policyRepository.save(policy);
    this.logger.log(
      `Policy ${policyId} toggled to ${isEnabled ? 'enabled' : 'disabled'}`,
    );

    return {
      success: true,
      message: `Policy "${policy.name}" ${isEnabled ? 'enabled' : 'disabled'} successfully`,
      policy: saved,
    };
  }

  /**
   * Get effective (merged) policy for a project
   * Merges policies in order: Organization > Team > Project
   * Each level can add rules but cannot disable parent rules
   *
   * Note: teamId and organizationId are ALWAYS resolved from the project info
   * via gRPC calls - they should not be passed from the gateway.
   */
  async getEffectivePolicy(projectId: string): Promise<EffectivePolicy> {
    // ALWAYS resolve teamId and organizationId from project info via gRPC
    let resolvedTeamId: string | undefined;
    let resolvedOrganizationId: string | undefined;

    try {
      // 1. Get organizationId from projectId directly
      this.logger.debug(`Fetching organizationId for project ${projectId}`);
      const orgResponse = await safeGrpcCall(
        this.organizationService.getOrganizationIdByProjectId({ projectId }),
      );
      resolvedOrganizationId = orgResponse.organizationId;
      this.logger.debug(`Resolved organizationId: ${resolvedOrganizationId}`);

      // 2. The project's team. GetOrganizationIdByProjectId
      // returns it from the same query. A global-management that predates the
      // field omits it: read it from the project, with the lean read (the
      // full one also counted the project's vulnerabilities).
      resolvedTeamId = orgResponse.teamId || undefined;
      if (!resolvedTeamId) {
        this.logger.debug(`Fetching project info for ${projectId}`);
        const projectResponse = await safeGrpcCall(
          this.projectService.get({
            projectId,
            skipVulnerabilityStats: true,
            skipIntegrationStatus: true,
            skipSecurityContext: true,
          }),
        );
        // Response is flat - access teamId directly (not projectResponse.project.teamId)
        resolvedTeamId = projectResponse?.teamId || undefined;
      }
      if (resolvedTeamId) {
        this.logger.debug(`Resolved teamId: ${resolvedTeamId}`);
      }
    } catch (error) {
      this.logger.error(
        `Could not fetch project/org info for ${projectId}: ${error}`,
      );
      throw new RpcException({
        code: GrpcStatus.NOT_FOUND,
        message: `Could not resolve project hierarchy for ${projectId}`,
      });
    }

    if (!resolvedOrganizationId) {
      throw new RpcException({
        code: GrpcStatus.NOT_FOUND,
        message: `Could not resolve organization for project ${projectId}`,
      });
    }

    this.logger.log(
      `GetEffectivePolicy: projectId=${projectId}, teamId=${resolvedTeamId}, orgId=${resolvedOrganizationId}`,
    );

    return this.getEffectivePolicyForHierarchy(projectId, {
      organizationId: resolvedOrganizationId,
      teamId: resolvedTeamId ?? null,
    });
  }

  /**
   * Effective policy of a project whose hierarchy is already resolved.
   *
   * The job carries the hierarchy the trigger resolved, so an evaluation does
   * not resolve it a second time when the job runs. The hierarchy decides which organization and team policies
   * apply, so it must be the one global-management answered (as returned by
   * getEffectivePolicy), never an organization or team taken from a request.
   */
  async getEffectivePolicyForHierarchy(
    projectId: string,
    hierarchy: ProjectHierarchy,
  ): Promise<EffectivePolicy> {
    const appliedPolicies: SecurityPolicy[] = [];
    const allRules: PolicyConfig['rules'] = [];
    const allExclusions: PolicyConfig['exclusions'] = [];
    const resolvedOrganizationId = hierarchy.organizationId;
    const resolvedTeamId = hierarchy.teamId || undefined;

    // 1. Get organization-level policies (ALL org policies apply to all projects)
    const orgPolicies = await this.policyRepository.find({
      where: {
        scope: PolicyScope.ORGANIZATION,
        organizationId: resolvedOrganizationId,
        isEnabled: true,
      },
      order: { priority: 'ASC' },
    });

    this.logger.debug(`Found ${orgPolicies.length} org-level policies`);
    for (const orgPolicy of orgPolicies) {
      appliedPolicies.push(orgPolicy);
      allRules.push(...(orgPolicy.rules.rules || []));
      allExclusions.push(...(orgPolicy.exclusions || []));
    }

    // 2. Get team-level policies (if team ID resolved)
    if (resolvedTeamId) {
      // Find policies where teamIds array contains this team
      const teamPolicies = await this.policyRepository
        .createQueryBuilder('policy')
        .where('policy.scope = :scope', { scope: PolicyScope.TEAM })
        .andWhere('policy.organizationId = :organizationId', {
          organizationId: resolvedOrganizationId,
        })
        .andWhere('policy.isEnabled = true')
        .andWhere('policy.teamIds @> :teamIds', {
          teamIds: JSON.stringify([resolvedTeamId]),
        })
        .orderBy('policy.priority', 'ASC')
        .getMany();

      this.logger.debug(
        `Found ${teamPolicies.length} team-level policies for team ${resolvedTeamId}`,
      );
      for (const policy of teamPolicies) {
        appliedPolicies.push(policy);
        allRules.push(...(policy.rules.rules || []));
        allExclusions.push(...(policy.exclusions || []));
      }
    }

    // 3. Get project-level policies
    // Find policies where projectIds array contains this project
    const projectPolicies = await this.policyRepository
      .createQueryBuilder('policy')
      .where('policy.scope = :scope', { scope: PolicyScope.PROJECT })
      .andWhere('policy.organizationId = :organizationId', {
        organizationId: resolvedOrganizationId,
      })
      .andWhere('policy.isEnabled = true')
      .andWhere('policy.projectIds @> :projectIds', {
        projectIds: JSON.stringify([projectId]),
      })
      .orderBy('policy.priority', 'ASC')
      .getMany();

    this.logger.debug(
      `Found ${projectPolicies.length} project-level policies for project ${projectId}`,
    );

    for (const policy of projectPolicies) {
      appliedPolicies.push(policy);
      allRules.push(...(policy.rules.rules || []));
      allExclusions.push(...(policy.exclusions || []));
    }

    // Merge and deduplicate exclusions by pattern
    const uniqueExclusions = this.deduplicateExclusions(allExclusions);

    const effectiveConfig: PolicyConfig = {
      rules: allRules,
      exclusions: uniqueExclusions,
    };

    return { effectiveConfig, appliedPolicies, hierarchy };
  }

  /**
   * Get policies that apply to a specific target (project or team)
   */
  async getPoliciesForProject(
    projectId: string,
    organizationId: string,
  ): Promise<SecurityPolicy[]> {
    return this.policyRepository
      .createQueryBuilder('policy')
      .where('policy.scope = :scope', { scope: PolicyScope.PROJECT })
      .andWhere('policy.organizationId = :organizationId', { organizationId })
      .andWhere('policy.isEnabled = true')
      .andWhere('policy.projectIds @> :projectIds', {
        projectIds: JSON.stringify([projectId]),
      })
      .orderBy('policy.priority', 'ASC')
      .getMany();
  }

  /**
   * Get policies that apply to a specific team
   */
  async getPoliciesForTeam(
    teamId: string,
    organizationId: string,
  ): Promise<SecurityPolicy[]> {
    return this.policyRepository
      .createQueryBuilder('policy')
      .where('policy.scope = :scope', { scope: PolicyScope.TEAM })
      .andWhere('policy.organizationId = :organizationId', { organizationId })
      .andWhere('policy.isEnabled = true')
      .andWhere('policy.teamIds @> :teamIds', {
        teamIds: JSON.stringify([teamId]),
      })
      .orderBy('policy.priority', 'ASC')
      .getMany();
  }

  /**
   * Deduplicate exclusions by pattern
   */
  private deduplicateExclusions(
    exclusions: PolicyConfig['exclusions'],
  ): PolicyConfig['exclusions'] {
    if (!exclusions) return [];

    const seen = new Map<string, (typeof exclusions)[0]>();
    for (const exclusion of exclusions) {
      const key = exclusion.pattern;
      if (!seen.has(key)) {
        seen.set(key, exclusion);
      }
    }

    return Array.from(seen.values());
  }
}

/**
 * The glob patterns a stored policy holds: its exclusion patterns and the
 * values of its branch rules, composite rules included.
 */
function storedGlobPatterns(policy: SecurityPolicy): Set<string> {
  const patterns = new Set<string>();
  const exclusions = [
    ...(policy.exclusions || []),
    ...(policy.rules?.exclusions || []),
  ];
  for (const exclusion of exclusions) {
    if (typeof exclusion?.pattern === 'string') patterns.add(exclusion.pattern);
  }
  const visit = (rules: PolicyRule[] | undefined): void => {
    for (const rule of rules || []) {
      if (String(rule?.type).toLowerCase() === RuleType.BRANCH) {
        const values = Array.isArray(rule.value) ? rule.value : [rule.value];
        for (const value of values) {
          if (typeof value === 'string') patterns.add(value);
        }
      }
      visit(rule?.criteria);
    }
  };
  visit(policy.rules?.rules);
  return patterns;
}
