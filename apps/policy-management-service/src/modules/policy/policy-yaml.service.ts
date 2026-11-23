import { Injectable, Logger } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { status as GrpcStatus } from '@grpc/grpc-js';
import * as YAML from 'yaml';
import {
  SecurityPolicy,
  PolicyConfig,
  PolicyRule,
  PolicyExclusion,
  ViolationAction,
  RuleType,
  RuleOperator,
  PolicyScope,
} from '@entities/security-policy.entity';
import { normalizeSeverity } from './severity';

/**
 * Complete YAML representation of a policy (user-friendly format)
 * This is the full policy definition including metadata
 */
export interface PolicyFullYaml {
  version: string;
  name: string;
  description?: string;
  scope: string;
  priority: number;
  enabled: boolean;
  projectIds?: string[];
  teamIds?: string[];
  rules: PolicyRuleYaml[];
  exclusions?: PolicyExclusionYaml[];
}

/**
 * YAML representation of an exclusion
 */
interface PolicyExclusionYaml {
  pattern: string;
  reason: string;
  expirationDate?: string;
}

/**
 * YAML representation of a rule
 */
interface PolicyRuleYaml {
  name: string;
  description?: string;
  isEnabled?: boolean;
  action: string;
  type: string;
  operator?: string;
  value?: unknown;
  criteria?: PolicyRuleYaml[];
}

/**
 * Parsed policy data from YAML
 */
export interface ParsedPolicyYaml {
  name: string;
  description?: string;
  scope: PolicyScope;
  priority: number;
  isEnabled: boolean;
  projectIds: string[];
  teamIds: string[];
  config: PolicyConfig;
}

/**
 * Validation limits
 *
 * MAX_CRITERIA_DEPTH: maximum depth of nested composite_and / composite_or
 *   criteria. Without this guard a single rule can chain hundreds of levels
 *   of `composite_and.criteria`, persists fine, then blows the BullMQ
 *   worker stack at evaluation time when `evaluateRule` recurses for every
 *   vulnerability.
 *   Depth 0 = the top-level rule itself. A depth of 8 still admits a
 *   reasonable composite tree (e.g. (sev AND (cwe OR (scanner AND ...))))
 *   while keeping the recursion bounded.
 */
/**
 * Policy format versions this service reads. YAML may give the version as a
 * string ('1.0') or a number (1.0, parsed as 1).
 */
const SUPPORTED_VERSIONS = ['1', '1.0'];

const POLICY_LIMITS = {
  // The priority column is a 32-bit signed integer.
  MIN_PRIORITY: -2147483648,
  MAX_PRIORITY: 2147483647,
  MIN_RULES: 1,
  MAX_RULES: 15,
  MAX_EXCLUSIONS: 30,
  MAX_CRITERIA_DEPTH: 8,
};

/**
 * Service for converting policies to/from YAML format
 */
@Injectable()
export class PolicyYamlService {
  private readonly logger = new Logger(PolicyYamlService.name);

  /**
   * Convert a security policy to YAML format
   */
  exportToYaml(policy: SecurityPolicy): string {
    const yamlObj: PolicyFullYaml = {
      version: '1.0',
      name: policy.name,
      scope: policy.scope,
      priority: policy.priority,
      enabled: policy.isEnabled,
      rules: [],
    };

    // Add description if present
    if (policy.description) {
      yamlObj.description = policy.description;
    }

    // Add target IDs based on scope
    if (policy.scope === PolicyScope.PROJECT && policy.projectIds?.length > 0) {
      yamlObj.projectIds = policy.projectIds;
    } else if (
      policy.scope === PolicyScope.TEAM &&
      policy.teamIds?.length > 0
    ) {
      yamlObj.teamIds = policy.teamIds;
    }

    // Add exclusions if present
    if (policy.exclusions && policy.exclusions.length > 0) {
      yamlObj.exclusions = policy.exclusions.map((exc) =>
        this.exclusionToYaml(exc),
      );
    }

    // Add rules
    if (policy.rules && policy.rules.rules) {
      yamlObj.rules = policy.rules.rules.map((rule) => this.ruleToYaml(rule));
    }

    // Generate YAML
    return YAML.stringify(yamlObj, {
      indent: 2,
      lineWidth: 120,
    });
  }

  /**
   * Parse complete YAML content to ParsedPolicyYaml
   * This is the main entry point for policy creation/update
   */
  parseFullYaml(yamlContent: string): ParsedPolicyYaml {
    let parsed: PolicyFullYaml;
    try {
      parsed = YAML.parse(yamlContent);
    } catch (error) {
      throw new RpcException({
        code: GrpcStatus.INVALID_ARGUMENT,
        message: `Invalid YAML format: ${(error as Error).message}`,
      });
    }

    if (!parsed || typeof parsed !== 'object') {
      throw new RpcException({
        code: GrpcStatus.INVALID_ARGUMENT,
        message: 'YAML content must be an object',
      });
    }

    if (
      parsed.version !== undefined &&
      parsed.version !== null &&
      !SUPPORTED_VERSIONS.includes(String(parsed.version))
    ) {
      throw new RpcException({
        code: GrpcStatus.INVALID_ARGUMENT,
        message: `version '${String(parsed.version)}' is not supported (use '1.0')`,
      });
    }

    // Validate required fields
    if (!parsed.name || typeof parsed.name !== 'string') {
      throw new RpcException({
        code: GrpcStatus.INVALID_ARGUMENT,
        message: "YAML must contain a 'name' string field",
      });
    }

    if (!parsed.scope || typeof parsed.scope !== 'string') {
      throw new RpcException({
        code: GrpcStatus.INVALID_ARGUMENT,
        message:
          "YAML must contain a 'scope' field (ORGANIZATION, TEAM, or PROJECT)",
      });
    }

    // Validate scope
    const scopeUpper = parsed.scope.toUpperCase();
    if (!Object.values(PolicyScope).includes(scopeUpper as PolicyScope)) {
      throw new RpcException({
        code: GrpcStatus.INVALID_ARGUMENT,
        message: `Invalid scope '${parsed.scope}'. Must be ORGANIZATION, TEAM, or PROJECT`,
      });
    }
    const scope = scopeUpper as PolicyScope;

    // Validate rules array
    if (!parsed.rules || !Array.isArray(parsed.rules)) {
      throw new RpcException({
        code: GrpcStatus.INVALID_ARGUMENT,
        message: "YAML must contain a 'rules' array",
      });
    }

    // Validate rules count
    if (parsed.rules.length < POLICY_LIMITS.MIN_RULES) {
      throw new RpcException({
        code: GrpcStatus.INVALID_ARGUMENT,
        message: `Policy must have at least ${POLICY_LIMITS.MIN_RULES} rule(s)`,
      });
    }

    if (parsed.rules.length > POLICY_LIMITS.MAX_RULES) {
      throw new RpcException({
        code: GrpcStatus.INVALID_ARGUMENT,
        message: `Policy cannot have more than ${POLICY_LIMITS.MAX_RULES} rules (got ${parsed.rules.length})`,
      });
    }

    // Validate exclusions count if present
    if (parsed.exclusions && Array.isArray(parsed.exclusions)) {
      if (parsed.exclusions.length > POLICY_LIMITS.MAX_EXCLUSIONS) {
        throw new RpcException({
          code: GrpcStatus.INVALID_ARGUMENT,
          message: `Policy cannot have more than ${POLICY_LIMITS.MAX_EXCLUSIONS} exclusions (got ${parsed.exclusions.length})`,
        });
      }
    }

    // Validate target IDs based on scope
    let projectIds: string[] = [];
    let teamIds: string[] = [];

    if (scope === PolicyScope.PROJECT) {
      if (
        !parsed.projectIds ||
        !Array.isArray(parsed.projectIds) ||
        parsed.projectIds.length === 0
      ) {
        throw new RpcException({
          code: GrpcStatus.INVALID_ARGUMENT,
          message:
            "PROJECT scope requires at least one projectId in 'projectIds' array",
        });
      }
      projectIds = this.validateUuidArray(parsed.projectIds, 'projectIds');
    } else if (scope === PolicyScope.TEAM) {
      if (
        !parsed.teamIds ||
        !Array.isArray(parsed.teamIds) ||
        parsed.teamIds.length === 0
      ) {
        throw new RpcException({
          code: GrpcStatus.INVALID_ARGUMENT,
          message: "TEAM scope requires at least one teamId in 'teamIds' array",
        });
      }
      teamIds = this.validateUuidArray(parsed.teamIds, 'teamIds');
    }
    // Targets of another scope would be dropped silently: refuse them.
    if (scope !== PolicyScope.PROJECT && this.isNonEmpty(parsed.projectIds)) {
      throw new RpcException({
        code: GrpcStatus.INVALID_ARGUMENT,
        message: `projectIds is only allowed with PROJECT scope (scope is ${scope})`,
      });
    }
    if (scope !== PolicyScope.TEAM && this.isNonEmpty(parsed.teamIds)) {
      throw new RpcException({
        code: GrpcStatus.INVALID_ARGUMENT,
        message: `teamIds is only allowed with TEAM scope (scope is ${scope})`,
      });
    }

    const priority = this.parsePriority(parsed.priority);

    // Parse rules
    const config: PolicyConfig = {
      rules: parsed.rules.map((rule, index) =>
        this.yamlToRule(rule, `rules[${index}]`),
      ),
      exclusions: [],
    };

    // Parse exclusions if present
    if (parsed.exclusions && Array.isArray(parsed.exclusions)) {
      config.exclusions = parsed.exclusions.map((exc, index) =>
        this.yamlToExclusion(exc, `exclusions[${index}]`),
      );
    }

    return {
      name: parsed.name.trim(),
      description: parsed.description?.trim(),
      scope,
      priority,
      isEnabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : true,
      projectIds,
      teamIds,
      config,
    };
  }

  private isNonEmpty(value: unknown): boolean {
    return Array.isArray(value) ? value.length > 0 : value != null;
  }

  /**
   * Priority defaults to 50 when absent. A given priority must be an integer
   * that fits the 32-bit column, or the database refuses the row.
   */
  private parsePriority(value: unknown): number {
    if (value === undefined || value === null) {
      return 50;
    }
    if (
      typeof value !== 'number' ||
      !Number.isInteger(value) ||
      value < POLICY_LIMITS.MIN_PRIORITY ||
      value > POLICY_LIMITS.MAX_PRIORITY
    ) {
      throw new RpcException({
        code: GrpcStatus.INVALID_ARGUMENT,
        message: `priority must be an integer between ${POLICY_LIMITS.MIN_PRIORITY} and ${POLICY_LIMITS.MAX_PRIORITY}`,
      });
    }
    return value;
  }

  /**
   * Parse YAML content to PolicyConfig only (for backward compatibility)
   */
  parseYaml(yamlContent: string): PolicyConfig {
    const parsed = this.parseFullYaml(yamlContent);
    return parsed.config;
  }

  /**
   * Validate array of UUIDs
   */
  private validateUuidArray(arr: unknown[], fieldName: string): string[] {
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const result: string[] = [];

    for (let i = 0; i < arr.length; i++) {
      const item = arr[i];
      if (typeof item !== 'string' || !uuidRegex.test(item)) {
        throw new RpcException({
          code: GrpcStatus.INVALID_ARGUMENT,
          message: `${fieldName}[${i}] must be a valid UUID`,
        });
      }
      result.push(item.toLowerCase());
    }

    return result;
  }

  /**
   * Convert a rule to YAML format
   */
  private ruleToYaml(rule: PolicyRule): PolicyRuleYaml {
    const yaml: PolicyRuleYaml = {
      name: rule.name,
      type: rule.type,
      action: rule.action.toLowerCase(),
    };

    if (rule.description) {
      yaml.description = rule.description;
    }

    if (rule.isEnabled !== undefined && rule.isEnabled === false) {
      yaml.isEnabled = false;
    }

    if (rule.operator) {
      yaml.operator = rule.operator;
    }

    if (rule.value !== undefined) {
      yaml.value = rule.value;
    }

    if (rule.criteria && rule.criteria.length > 0) {
      yaml.criteria = rule.criteria.map((c) => this.ruleToYaml(c));
    }

    return yaml;
  }

  /**
   * Convert an exclusion to YAML format
   */
  private exclusionToYaml(exclusion: PolicyExclusion): PolicyExclusionYaml {
    const yaml: PolicyExclusionYaml = {
      pattern: exclusion.pattern,
      reason: exclusion.reason,
    };

    if (exclusion.expirationDate) {
      yaml.expirationDate = exclusion.expirationDate;
    }

    return yaml;
  }

  /**
   * Convert YAML rule to PolicyRule
   */
  private yamlToRule(yaml: PolicyRuleYaml, path: string): PolicyRule {
    if (!yaml.name) {
      throw new RpcException({
        code: GrpcStatus.INVALID_ARGUMENT,
        message: `${path}.name is required`,
      });
    }

    if (!yaml.action) {
      throw new RpcException({
        code: GrpcStatus.INVALID_ARGUMENT,
        message: `${path}.action is required`,
      });
    }

    if (!yaml.type) {
      throw new RpcException({
        code: GrpcStatus.INVALID_ARGUMENT,
        message: `${path}.type is required`,
      });
    }

    const action = yaml.action.toUpperCase() as ViolationAction;
    if (!Object.values(ViolationAction).includes(action)) {
      throw new RpcException({
        code: GrpcStatus.INVALID_ARGUMENT,
        message: `${path}.action must be WARN or BLOCK`,
      });
    }

    const type = yaml.type.toLowerCase() as RuleType;
    if (!Object.values(RuleType).includes(type)) {
      throw new RpcException({
        code: GrpcStatus.INVALID_ARGUMENT,
        message: `${path}.type '${yaml.type}' is not a valid rule type`,
      });
    }

    const rule: PolicyRule = {
      id: this.generateRuleId(),
      name: yaml.name,
      description: yaml.description,
      isEnabled: yaml.isEnabled ?? true,
      action,
      type,
    };

    if (yaml.operator) {
      const operator = yaml.operator.toLowerCase() as RuleOperator;
      if (!Object.values(RuleOperator).includes(operator)) {
        throw new RpcException({
          code: GrpcStatus.INVALID_ARGUMENT,
          message: `${path}.operator '${yaml.operator}' is not a valid operator`,
        });
      }
      rule.operator = operator;
    }

    if (yaml.value !== undefined) {
      // Normalize value based on rule type
      rule.value = this.normalizeRuleValue(
        yaml.value,
        type,
      ) as PolicyRule['value'];
    }

    if (yaml.criteria && Array.isArray(yaml.criteria)) {
      rule.criteria = yaml.criteria.map((c, i) =>
        this.yamlToCriterion(c, `${path}.criteria[${i}]`, 1),
      );
    }

    return rule;
  }

  /**
   * Convert YAML criterion to PolicyRule (simplified - no name/action required)
   * Criteria are simple conditions within composite rules.
   *
   * @param depth current nesting depth (top-level rule = 0, its direct
   *   criteria = 1, etc). Depth is bounded by POLICY_LIMITS.MAX_CRITERIA_DEPTH
   *   so a policy cannot blow the BullMQ worker stack via recursive
   *   `evaluateRule` calls.
   */
  private yamlToCriterion(
    yaml: Partial<PolicyRuleYaml>,
    path: string,
    depth: number,
  ): PolicyRule {
    if (depth > POLICY_LIMITS.MAX_CRITERIA_DEPTH) {
      throw new RpcException({
        code: GrpcStatus.INVALID_ARGUMENT,
        message: `${path}: maximum criteria nesting depth (${POLICY_LIMITS.MAX_CRITERIA_DEPTH}) exceeded`,
      });
    }

    if (!yaml.type) {
      throw new RpcException({
        code: GrpcStatus.INVALID_ARGUMENT,
        message: `${path}.type is required`,
      });
    }

    const type = yaml.type.toLowerCase() as RuleType;
    if (!Object.values(RuleType).includes(type)) {
      throw new RpcException({
        code: GrpcStatus.INVALID_ARGUMENT,
        message: `${path}.type '${yaml.type}' is not a valid rule type`,
      });
    }

    // For criteria, action is inherited from parent rule (default to BLOCK for internal use)
    const action = yaml.action
      ? (yaml.action.toUpperCase() as ViolationAction)
      : ViolationAction.BLOCK;

    const criterion: PolicyRule = {
      id: this.generateRuleId(),
      name: yaml.name || `${type}_criterion`, // Auto-generate name if not provided
      description: yaml.description,
      isEnabled: yaml.isEnabled ?? true,
      action,
      type,
    };

    if (yaml.operator) {
      const operator = yaml.operator.toLowerCase() as RuleOperator;
      if (!Object.values(RuleOperator).includes(operator)) {
        throw new RpcException({
          code: GrpcStatus.INVALID_ARGUMENT,
          message: `${path}.operator '${yaml.operator}' is not a valid operator`,
        });
      }
      criterion.operator = operator;
    }

    if (yaml.value !== undefined) {
      criterion.value = this.normalizeRuleValue(
        yaml.value,
        type,
      ) as PolicyRule['value'];
    }

    // Criteria can also have nested criteria (for deeply nested composite rules)
    if (yaml.criteria && Array.isArray(yaml.criteria)) {
      criterion.criteria = yaml.criteria.map((c, i) =>
        this.yamlToCriterion(c, `${path}.criteria[${i}]`, depth + 1),
      );
    }

    return criterion;
  }

  /**
   * Convert YAML exclusion to PolicyExclusion
   */
  private yamlToExclusion(
    yaml: PolicyExclusionYaml,
    path: string,
  ): PolicyExclusion {
    if (!yaml.pattern) {
      throw new RpcException({
        code: GrpcStatus.INVALID_ARGUMENT,
        message: `${path}.pattern is required`,
      });
    }

    if (!yaml.reason) {
      throw new RpcException({
        code: GrpcStatus.INVALID_ARGUMENT,
        message: `${path}.reason is required`,
      });
    }

    return {
      id: this.generateRuleId(),
      pattern: yaml.pattern,
      reason: yaml.reason,
      expirationDate: yaml.expirationDate,
    };
  }

  /**
   * Generate a simple unique ID for rules
   */
  private generateRuleId(): string {
    return `rule-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Normalize rule value based on rule type
   * Converts string values to uppercase for severity and scanner_type
   */
  private normalizeRuleValue(value: unknown, type: RuleType): unknown {
    // Types that need uppercase values
    const uppercaseTypes: RuleType[] = [
      RuleType.SEVERITY,
      RuleType.SCANNER_TYPE,
    ];

    if (type === RuleType.SEVERITY) {
      // Stored as the evaluator compares it: trimmed and upper case.
      return Array.isArray(value)
        ? value.map(normalizeSeverity)
        : normalizeSeverity(value);
    }

    if (uppercaseTypes.includes(type)) {
      if (typeof value === 'string') {
        return value.toUpperCase();
      } else if (Array.isArray(value)) {
        return value.map((v) => (typeof v === 'string' ? v.toUpperCase() : v));
      }
    }

    return value;
  }
}
