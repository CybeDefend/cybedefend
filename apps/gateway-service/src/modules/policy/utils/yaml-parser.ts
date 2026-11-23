import { BadRequestException } from '@nestjs/common';
import * as YAML from 'yaml';

/**
 * Policy configuration structure (matches the proto/entity structure)
 */
export interface PolicyConfig {
  rules: PolicyRule[];
  exclusions?: PolicyExclusion[];
  notifications?: PolicyNotification[];
}

export interface PolicyRule {
  name: string;
  description?: string;
  isEnabled?: boolean;
  action: string;
  type: string;
  operator?: string;
  value?: unknown;
  criteria?: PolicyRule[];
}

export interface PolicyExclusion {
  pattern: string;
  reason: string;
  expirationDate?: string;
}

export interface PolicyNotification {
  enabled: boolean;
  channels: string[];
  severityThreshold?: string[];
  webhookUrl?: string;
  emailRecipients?: string[];
}

/**
 * Parse YAML content to policy configuration JSON
 *
 * @param yamlContent Raw YAML string
 * @returns Parsed PolicyConfig object
 * @throws BadRequestException if YAML is invalid
 */
export function parseYamlToConfig(yamlContent: string): PolicyConfig {
  if (!yamlContent || typeof yamlContent !== 'string') {
    throw new BadRequestException('YAML content is required');
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = YAML.parse(yamlContent);
  } catch (error) {
    throw new BadRequestException(
      `Invalid YAML format: ${(error as Error).message}`,
    );
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new BadRequestException('YAML content must be an object');
  }

  if (!parsed.rules || !Array.isArray(parsed.rules)) {
    throw new BadRequestException("YAML must contain a 'rules' array");
  }

  // Validate and transform rules
  const rules = (parsed.rules as Record<string, unknown>[]).map((rule, index) =>
    validateAndTransformRule(rule, `rules[${index}]`),
  );

  // Validate and transform exclusions
  let exclusions: PolicyExclusion[] = [];
  if (parsed.exclusions) {
    if (!Array.isArray(parsed.exclusions)) {
      throw new BadRequestException("'exclusions' must be an array");
    }
    exclusions = (parsed.exclusions as Record<string, unknown>[]).map(
      (exc, index) =>
        validateAndTransformExclusion(exc, `exclusions[${index}]`),
    );
  }

  return {
    rules,
    exclusions,
    notifications: [],
  };
}

/**
 * Validate and transform a rule from YAML format
 */
function validateAndTransformRule(
  rule: Record<string, unknown>,
  path: string,
): PolicyRule {
  if (!rule.name || typeof rule.name !== 'string') {
    throw new BadRequestException(
      `${path}.name is required and must be a string`,
    );
  }

  if (!rule.action || typeof rule.action !== 'string') {
    throw new BadRequestException(
      `${path}.action is required and must be a string`,
    );
  }

  const action = (rule.action as string).toUpperCase();
  if (!['BLOCK', 'WARN'].includes(action)) {
    throw new BadRequestException(`${path}.action must be 'BLOCK' or 'WARN'`);
  }

  if (!rule.type || typeof rule.type !== 'string') {
    throw new BadRequestException(
      `${path}.type is required and must be a string`,
    );
  }

  const transformed: PolicyRule = {
    name: rule.name as string,
    description: rule.description as string | undefined,
    isEnabled: rule.isEnabled !== false,
    action,
    type: (rule.type as string).toLowerCase(),
  };

  if (rule.operator) {
    transformed.operator = (rule.operator as string).toLowerCase();
  }

  if (rule.value !== undefined) {
    transformed.value = rule.value;
  }

  // Handle composite rules (criteria)
  if (rule.criteria && Array.isArray(rule.criteria)) {
    transformed.criteria = (rule.criteria as Record<string, unknown>[]).map(
      (c, i) => validateAndTransformRule(c, `${path}.criteria[${i}]`),
    );
  }

  return transformed;
}

/**
 * Validate and transform an exclusion from YAML format
 */
function validateAndTransformExclusion(
  exc: Record<string, unknown>,
  path: string,
): PolicyExclusion {
  if (!exc.pattern || typeof exc.pattern !== 'string') {
    throw new BadRequestException(
      `${path}.pattern is required and must be a string`,
    );
  }

  if (!exc.reason || typeof exc.reason !== 'string') {
    throw new BadRequestException(
      `${path}.reason is required and must be a string`,
    );
  }

  const transformed: PolicyExclusion = {
    pattern: exc.pattern as string,
    reason: exc.reason as string,
  };

  if (exc.expirationDate) {
    // Validate date format
    const date = new Date(exc.expirationDate as string);
    if (isNaN(date.getTime())) {
      throw new BadRequestException(
        `${path}.expirationDate must be a valid ISO 8601 date`,
      );
    }
    transformed.expirationDate = exc.expirationDate as string;
  }

  return transformed;
}

/**
 * Convert policy configuration to YAML string
 */
export function configToYaml(config: PolicyConfig): string {
  return YAML.stringify(config, {
    indent: 2,
    lineWidth: 120,
  });
}
