/**
 * Shared enums for policy entities
 * Extracted to avoid circular dependencies
 */

/**
 * Policy scope enumeration - defines at which level the policy applies
 */
export enum PolicyScope {
  ORGANIZATION = 'ORGANIZATION',
  TEAM = 'TEAM',
  PROJECT = 'PROJECT',
}

/**
 * Violation action enumeration
 */
export enum ViolationAction {
  WARN = 'WARN',
  BLOCK = 'BLOCK',
}

/**
 * Rule type enumeration for structured rule definitions
 */
export enum RuleType {
  SEVERITY = 'severity',
  CVSS_SCORE = 'cvss_score',
  CWE_CHECK = 'cwe_check',
  OWASP_CATEGORY = 'owasp_category',
  SCANNER_TYPE = 'scanner_type',
  VULNERABILITY_AGE_DAYS = 'vulnerability_age_days',
  IS_NEW_VULNERABILITY = 'is_new_vulnerability',
  BRANCH = 'branch',
  COMPOSITE_AND = 'composite_and',
  COMPOSITE_OR = 'composite_or',
  LICENSE_CHECK = 'license_check',
  LICENSE_NAME_CHECK = 'license_name_check',
}

/**
 * Rule operator enumeration
 */
export enum RuleOperator {
  EQUALS = 'equals',
  NOT_EQUALS = 'not_equals',
  GT = 'gt',
  GTE = 'gte',
  LT = 'lt',
  LTE = 'lte',
  IN = 'in',
  NOT_IN = 'not_in',
}
