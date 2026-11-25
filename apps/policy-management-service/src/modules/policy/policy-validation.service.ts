import { Injectable, Logger } from '@nestjs/common';
import {
  PolicyConfig,
  PolicyRule,
  PolicyExclusion,
  RuleType,
  RuleOperator,
  ViolationAction,
} from '@entities/security-policy.entity';
import {
  SEVERITY_LEVELS,
  isSeverityLevel,
  normalizeSeverity,
} from './severity';
import { globPatternError } from '@modules/evaluation/safe-glob';

/**
 * Validation result structure
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Service for validating policy configurations
 */
@Injectable()
export class PolicyValidationService {
  private readonly logger = new Logger(PolicyValidationService.name);

  /**
   * Valid severity values
   */
  private readonly validSeverities: readonly string[] = SEVERITY_LEVELS;

  /**
   * Valid scanner types
   */
  private readonly validScannerTypes = [
    'SAST',
    'SCA',
    'IAC',
    'CONTAINER',
    'SECRET',
    'CICD',
  ];

  /**
   * Valid license types
   */
  private readonly validLicenseTypes = [
    'PERMISSIVE',
    'WEAK_COPYLEFT',
    'STRONG_COPYLEFT',
    'UNKNOWN',
  ];

  /**
   * Valid rule types
   */
  private readonly validRuleTypes = Object.values(RuleType);

  /**
   * Valid rule operators
   */
  private readonly validOperators = Object.values(RuleOperator);

  /**
   * Valid actions
   */
  private readonly validActions = Object.values(ViolationAction);

  /**
   * Validate a policy configuration
   */
  validate(
    configJson: string,
    options: { storedPatterns?: ReadonlySet<string> } = {},
  ): ValidationResult {
    // validate() runs synchronously to the end: the set cannot leak into
    // another call.
    this.keptPatterns = options.storedPatterns ?? new Set();
    try {
      return this.validateConfig(configJson);
    } finally {
      this.keptPatterns = new Set();
    }
  }

  /** Glob patterns the policy held before this update. */
  private keptPatterns: ReadonlySet<string> = new Set();

  private validateConfig(configJson: string): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    let config: PolicyConfig;
    try {
      config = JSON.parse(configJson);
    } catch {
      return {
        valid: false,
        errors: ['Invalid JSON format'],
        warnings: [],
      };
    }

    // Normalize values to uppercase for case-insensitive validation
    this.normalizeConfig(config);

    // Validate rules array
    if (!config.rules) {
      errors.push("Policy must have a 'rules' array");
    } else if (!Array.isArray(config.rules)) {
      errors.push("'rules' must be an array");
    } else {
      config.rules.forEach((rule, index) => {
        this.validateRule(rule, `rules[${index}]`, errors, warnings);
      });

      if (config.rules.length === 0) {
        warnings.push('Policy has no rules defined');
      }
    }

    // Validate exclusions if present
    if (config.exclusions) {
      if (!Array.isArray(config.exclusions)) {
        errors.push("'exclusions' must be an array");
      } else {
        config.exclusions.forEach((exclusion, index) => {
          this.validateExclusion(
            exclusion,
            `exclusions[${index}]`,
            errors,
            warnings,
          );
        });
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Validate a single rule
   */
  private validateRule(
    rule: PolicyRule,
    path: string,
    errors: string[],
    warnings: string[],
  ): void {
    // Required fields
    if (!rule.name || typeof rule.name !== 'string') {
      errors.push(`${path}.name is required and must be a string`);
    }

    if (rule.isEnabled === undefined) {
      warnings.push(`${path}.isEnabled not specified, defaulting to true`);
    }

    if (!rule.action) {
      errors.push(`${path}.action is required`);
    } else if (!this.validActions.includes(rule.action)) {
      errors.push(
        `${path}.action must be one of: ${this.validActions.join(', ')}`,
      );
    }

    if (!rule.type) {
      errors.push(`${path}.type is required`);
    } else if (!this.validRuleTypes.includes(rule.type)) {
      errors.push(
        `${path}.type must be one of: ${this.validRuleTypes.join(', ')}`,
      );
    }

    // Validate composite rules
    if (
      rule.type === RuleType.COMPOSITE_AND ||
      rule.type === RuleType.COMPOSITE_OR
    ) {
      if (!rule.criteria || !Array.isArray(rule.criteria)) {
        errors.push(
          `${path}.criteria is required for composite rules and must be an array`,
        );
      } else if (rule.criteria.length < 2) {
        warnings.push(
          `${path}.criteria should have at least 2 sub-rules for composite rules`,
        );
      } else {
        rule.criteria.forEach((subRule, index) => {
          this.validateRule(
            subRule,
            `${path}.criteria[${index}]`,
            errors,
            warnings,
          );
        });
      }
    } else {
      // Non-composite rules need operator and value
      if (!rule.operator) {
        errors.push(`${path}.operator is required for non-composite rules`);
      } else if (!this.validOperators.includes(rule.operator)) {
        errors.push(
          `${path}.operator must be one of: ${this.validOperators.join(', ')}`,
        );
      }

      if (rule.value === undefined) {
        errors.push(`${path}.value is required for non-composite rules`);
      }

      // Type-specific value validation
      this.validateRuleValue(rule, path, errors, warnings);
    }
  }

  /**
   * Validate rule value based on rule type
   */
  private validateRuleValue(
    rule: PolicyRule,
    path: string,
    errors: string[],
    warnings: string[],
  ): void {
    switch (rule.type) {
      case RuleType.SEVERITY:
        if (
          rule.operator === RuleOperator.IN ||
          rule.operator === RuleOperator.NOT_IN
        ) {
          if (!Array.isArray(rule.value)) {
            errors.push(
              `${path}.value must be an array for 'in'/'not_in' operators`,
            );
          } else {
            (rule.value as string[]).forEach((v, i) => {
              if (!isSeverityLevel(v)) {
                errors.push(
                  `${path}.value[${i}] "${v}" is not a recognized severity. Valid: ${this.validSeverities.join(', ')}`,
                );
              }
            });
          }
        } else if (typeof rule.value !== 'string') {
          errors.push(`${path}.value must be a string for severity comparison`);
        } else if (!isSeverityLevel(rule.value)) {
          // A rule naming an unknown severity can never match a finding.
          errors.push(
            `${path}.value "${rule.value}" is not a recognized severity. Valid: ${this.validSeverities.join(', ')}`,
          );
        }
        break;

      case RuleType.CVSS_SCORE:
        if (typeof rule.value !== 'number') {
          errors.push(`${path}.value must be a number for CVSS score rules`);
        } else if (rule.value < 0 || rule.value > 10) {
          errors.push(`${path}.value for CVSS must be between 0 and 10`);
        }
        break;

      case RuleType.CWE_CHECK:
        if (
          rule.operator === RuleOperator.IN ||
          rule.operator === RuleOperator.NOT_IN
        ) {
          if (!Array.isArray(rule.value)) {
            errors.push(`${path}.value must be an array of CWE IDs`);
          } else {
            (rule.value as string[]).forEach((v, i) => {
              if (!v.startsWith('CWE-') && !/^\d+$/.test(v)) {
                warnings.push(
                  `${path}.value[${i}] "${v}" does not look like a valid CWE ID (e.g., "CWE-89" or "89")`,
                );
              }
            });
          }
        }
        break;

      case RuleType.SCANNER_TYPE:
        if (
          rule.operator === RuleOperator.IN ||
          rule.operator === RuleOperator.NOT_IN
        ) {
          if (!Array.isArray(rule.value)) {
            errors.push(`${path}.value must be an array of scanner types`);
          } else {
            (rule.value as string[]).forEach((v, i) => {
              if (!this.validScannerTypes.includes(v)) {
                warnings.push(
                  `${path}.value[${i}] "${v}" is not a recognized scanner type. Valid: ${this.validScannerTypes.join(', ')}`,
                );
              }
            });
          }
        }
        break;

      case RuleType.VULNERABILITY_AGE_DAYS:
        if (typeof rule.value !== 'number' || rule.value < 0) {
          errors.push(
            `${path}.value must be a non-negative number for age rules`,
          );
        }
        break;

      case RuleType.IS_NEW_VULNERABILITY:
        if (typeof rule.value !== 'boolean') {
          errors.push(
            `${path}.value must be a boolean for is_new_vulnerability rules`,
          );
        }
        break;

      case RuleType.OWASP_CATEGORY:
        // OWASP categories are flexible strings like "A03:2021-Injection"
        if (typeof rule.value !== 'string' && !Array.isArray(rule.value)) {
          errors.push(
            `${path}.value must be a string or array for OWASP category rules`,
          );
        }
        break;

      case RuleType.LICENSE_CHECK:
        if (
          rule.operator === RuleOperator.IN ||
          rule.operator === RuleOperator.NOT_IN
        ) {
          if (!Array.isArray(rule.value)) {
            errors.push(`${path}.value must be an array of license types`);
          } else {
            (rule.value as string[]).forEach((v, i) => {
              if (!this.validLicenseTypes.includes(v)) {
                warnings.push(
                  `${path}.value[${i}] "${v}" is not a recognized license type. Valid: ${this.validLicenseTypes.join(', ')}`,
                );
              }
            });
          }
        } else if (typeof rule.value !== 'string') {
          errors.push(
            `${path}.value must be a string for license type comparison`,
          );
        } else if (!this.validLicenseTypes.includes(rule.value)) {
          warnings.push(
            `${path}.value "${rule.value}" is not a recognized license type`,
          );
        }
        break;

      case RuleType.LICENSE_NAME_CHECK:
        if (
          rule.operator === RuleOperator.IN ||
          rule.operator === RuleOperator.NOT_IN
        ) {
          if (!Array.isArray(rule.value)) {
            errors.push(
              `${path}.value must be an array of SPDX license identifiers`,
            );
          } else {
            (rule.value as string[]).forEach((v, i) => {
              if (typeof v !== 'string' || v.trim() === '') {
                errors.push(
                  `${path}.value[${i}] must be a non-empty SPDX license identifier`,
                );
              }
            });
          }
        } else if (
          typeof rule.value !== 'string' ||
          (rule.value as string).trim() === ''
        ) {
          errors.push(
            `${path}.value must be a non-empty SPDX license identifier (e.g. "MIT", "GPL-3.0-only")`,
          );
        }
        break;

      case RuleType.BRANCH:
        // Branch patterns can be exact names or glob patterns like "feature/*", "release-*"
        if (
          rule.operator === RuleOperator.IN ||
          rule.operator === RuleOperator.NOT_IN
        ) {
          if (!Array.isArray(rule.value)) {
            errors.push(`${path}.value must be an array of branch patterns`);
          } else {
            (rule.value as string[]).forEach((v, i) => {
              if (typeof v !== 'string' || v.trim() === '') {
                errors.push(
                  `${path}.value[${i}] must be a non-empty string (branch name or glob pattern)`,
                );
              } else {
                this.validateGlob(v, `${path}.value[${i}]`, errors, warnings);
              }
            });
          }
        } else if (
          rule.operator === RuleOperator.EQUALS ||
          rule.operator === RuleOperator.NOT_EQUALS
        ) {
          if (typeof rule.value !== 'string' || rule.value.trim() === '') {
            errors.push(
              `${path}.value must be a non-empty string (branch name or glob pattern)`,
            );
          } else {
            this.validateGlob(rule.value, `${path}.value`, errors, warnings);
          }
        } else {
          errors.push(
            `${path}.operator for branch rules must be one of: equals, not_equals, in, not_in`,
          );
        }
        break;
    }
  }

  /**
   * Validate a single exclusion
   */
  private validateExclusion(
    exclusion: PolicyExclusion,
    path: string,
    errors: string[],
    warnings: string[],
  ): void {
    if (!exclusion.pattern || typeof exclusion.pattern !== 'string') {
      errors.push(`${path}.pattern is required and must be a string`);
    } else {
      this.validateGlob(exclusion.pattern, `${path}.pattern`, errors, warnings);
      if (exclusion.pattern.includes('**/**/**')) {
        warnings.push(`${path}.pattern contains redundant wildcards`);
      }
    }

    if (!exclusion.reason || typeof exclusion.reason !== 'string') {
      errors.push(`${path}.reason is required and must be a string`);
    }

    if (exclusion.expirationDate) {
      const date = new Date(exclusion.expirationDate);
      if (isNaN(date.getTime())) {
        errors.push(
          `${path}.expirationDate must be a valid ISO 8601 date string`,
        );
      } else if (date < new Date()) {
        warnings.push(`${path}.expirationDate is in the past`);
      }
    }
  }

  /**
   * A glob is matched against every finding of every evaluation: only the
   * syntax the evaluation supports, within its length and wildcard caps, is
   * accepted. A pattern the policy already held is kept with a warning, so an
   * update is never refused for a pattern it does not add or change.
   */
  private validateGlob(
    pattern: string,
    path: string,
    errors: string[],
    warnings: string[],
  ): void {
    const reason = globPatternError(pattern);
    if (reason === null) return;
    if (this.keptPatterns.has(pattern)) {
      warnings.push(
        `${path} is kept as stored, but is not a supported glob pattern: ${reason}`,
      );
    } else {
      errors.push(`${path} is not a supported glob pattern: ${reason}`);
    }
  }

  /**
   * Normalize config values to uppercase for case-insensitive validation
   */
  private normalizeConfig(config: PolicyConfig): void {
    if (config.rules && Array.isArray(config.rules)) {
      config.rules.forEach((rule) => this.normalizeRule(rule));
    }
  }

  /**
   * Normalize a single rule's values to uppercase
   */
  private normalizeRule(rule: PolicyRule): void {
    // Normalize action to uppercase
    if (rule.action && typeof rule.action === 'string') {
      rule.action = rule.action.toUpperCase() as ViolationAction;
    }

    // Normalize type to lowercase (enum values are lowercase)
    if (rule.type && typeof rule.type === 'string') {
      rule.type = rule.type.toLowerCase() as RuleType;
    }

    // Normalize operator to lowercase (enum values are lowercase)
    if (rule.operator && typeof rule.operator === 'string') {
      rule.operator = rule.operator.toLowerCase() as RuleOperator;
    }

    // Normalize value based on type
    if (rule.type === RuleType.SEVERITY) {
      if (typeof rule.value === 'string') {
        rule.value = normalizeSeverity(rule.value) as string;
      } else if (Array.isArray(rule.value)) {
        rule.value = rule.value.map((v) =>
          typeof v === 'string' ? (normalizeSeverity(v) as string) : String(v),
        );
      }
    }

    if (rule.type === RuleType.SCANNER_TYPE) {
      if (typeof rule.value === 'string') {
        rule.value = rule.value.toUpperCase();
      } else if (Array.isArray(rule.value)) {
        rule.value = rule.value.map((v) =>
          typeof v === 'string' ? v.toUpperCase() : String(v),
        );
      }
    }

    if (rule.type === RuleType.LICENSE_CHECK) {
      if (typeof rule.value === 'string') {
        rule.value = rule.value.toUpperCase();
      } else if (Array.isArray(rule.value)) {
        rule.value = rule.value.map((v) =>
          typeof v === 'string' ? v.toUpperCase() : String(v),
        );
      }
    }

    if (rule.type === RuleType.LICENSE_NAME_CHECK) {
      if (typeof rule.value === 'string') {
        rule.value = rule.value.trim();
      } else if (Array.isArray(rule.value)) {
        rule.value = rule.value.map((v) =>
          typeof v === 'string' ? v.trim() : String(v),
        );
      }
    }

    // Recursively normalize composite rule criteria
    if (
      (rule.type === RuleType.COMPOSITE_AND ||
        rule.type === RuleType.COMPOSITE_OR) &&
      rule.criteria &&
      Array.isArray(rule.criteria)
    ) {
      rule.criteria.forEach((subRule) => this.normalizeRule(subRule));
    }
  }
}
