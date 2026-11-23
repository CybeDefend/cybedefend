/**
 * Agent vulnerability categories definitions used for SAST AI agent filtering.
 * These keys MUST match backend identifiers after normalization (UPPER_SNAKE_CASE / trimmed) once mapped.
 * UI internal name is kept in lower snake case; transformation to backend format occurs before PATCH.
 */
export interface AgentCategoryDefinition {
  name: string; // key used in i18n path and local state (lower snake case)
  displayNameKey: string; // i18n key for display name
  shortDescKey: string; // i18n key for short description
}

/**
 * SAST vulnerability categories for code analysis
 */
export const AGENT_CATEGORIES_SAST: AgentCategoryDefinition[] = [
  {
    name: 'sql_injection',
    displayNameKey: 'vulnerability_categories.sql_injection.displayName',
    shortDescKey: 'vulnerability_categories.sql_injection.shortDesc',
  },
  {
    name: 'path_and_file_manipulation',
    displayNameKey: 'vulnerability_categories.path_and_file_manipulation.displayName',
    shortDescKey: 'vulnerability_categories.path_and_file_manipulation.shortDesc',
  },
  {
    name: 'redos',
    displayNameKey: 'vulnerability_categories.redos.displayName',
    shortDescKey: 'vulnerability_categories.redos.shortDesc',
  },
  {
    name: 'xss',
    displayNameKey: 'vulnerability_categories.xss.displayName',
    shortDescKey: 'vulnerability_categories.xss.shortDesc',
  },
  {
    name: 'ldap_injection',
    displayNameKey: 'vulnerability_categories.ldap_injection.displayName',
    shortDescKey: 'vulnerability_categories.ldap_injection.shortDesc',
  },
  {
    name: 'code_injection',
    displayNameKey: 'vulnerability_categories.code_injection.displayName',
    shortDescKey: 'vulnerability_categories.code_injection.shortDesc',
  },
  {
    name: 'xxe',
    displayNameKey: 'vulnerability_categories.xxe.displayName',
    shortDescKey: 'vulnerability_categories.xxe.shortDesc',
  },
  {
    name: 'ssrf',
    displayNameKey: 'vulnerability_categories.ssrf.displayName',
    shortDescKey: 'vulnerability_categories.ssrf.shortDesc',
  },
  {
    name: 'nosql_injection',
    displayNameKey: 'vulnerability_categories.nosql_injection.displayName',
    shortDescKey: 'vulnerability_categories.nosql_injection.shortDesc',
  },
  {
    name: 'unsafe_deserialization',
    displayNameKey: 'vulnerability_categories.unsafe_deserialization.displayName',
    shortDescKey: 'vulnerability_categories.unsafe_deserialization.shortDesc',
  },
  {
    name: 'open_redirect',
    displayNameKey: 'vulnerability_categories.open_redirect.displayName',
    shortDescKey: 'vulnerability_categories.open_redirect.shortDesc',
  },
  {
    name: 'os_command_injection',
    displayNameKey: 'vulnerability_categories.os_command_injection.displayName',
    shortDescKey: 'vulnerability_categories.os_command_injection.shortDesc',
  },
  {
    name: 'cicd_security',
    displayNameKey: 'vulnerability_categories.cicd_security.displayName',
    shortDescKey: 'vulnerability_categories.cicd_security.shortDesc',
  },
];

/**
 * IAC (Infrastructure as Code) vulnerability categories for Kubernetes/container misconfigurations
 */
export const AGENT_CATEGORIES_IAC: AgentCategoryDefinition[] = [
  {
    name: 'volume_mounts',
    displayNameKey: 'vulnerability_categories.volume_mounts.displayName',
    shortDescKey: 'vulnerability_categories.volume_mounts.shortDesc',
  },
  {
    name: 'service_account',
    displayNameKey: 'vulnerability_categories.service_account.displayName',
    shortDescKey: 'vulnerability_categories.service_account.shortDesc',
  },
  {
    name: 'security_context',
    displayNameKey: 'vulnerability_categories.security_context.displayName',
    shortDescKey: 'vulnerability_categories.security_context.shortDesc',
  },
  {
    name: 'liveness',
    displayNameKey: 'vulnerability_categories.liveness.displayName',
    shortDescKey: 'vulnerability_categories.liveness.shortDesc',
  },
  {
    name: 'resource_limits',
    displayNameKey: 'vulnerability_categories.resource_limits.displayName',
    shortDescKey: 'vulnerability_categories.resource_limits.shortDesc',
  },
];

/**
 * CICD (CI/CD Pipeline) vulnerability categories — single category encompassing all CICD vulnerabilities
 */
export const AGENT_CATEGORIES_CICD: AgentCategoryDefinition[] = [
  {
    name: 'cicd_security',
    displayNameKey: 'vulnerability_categories.cicd_security.displayName',
    shortDescKey: 'vulnerability_categories.cicd_security.shortDesc',
  },
];

/**
 * CICD category names — used to split selected categories in the SAST modal
 * between agentCategoriesSast and agentCategoriesCicd backend fields.
 */
export const CICD_CATEGORY_NAMES = new Set(AGENT_CATEGORIES_CICD.map(c => c.name));

/**
 * Legacy export for backward compatibility - points to SAST categories
 * @deprecated Use AGENT_CATEGORIES_SAST or AGENT_CATEGORIES_IAC instead
 */
export const AGENT_CATEGORIES = AGENT_CATEGORIES_SAST;

/**
 * Helper to transform UI category names to backend identifiers.
 * Backend expects uppercase snake case, we also trim and deduplicate.
 */
export function toBackendAgentCategories(selected: string[]): string[] {
  return Array.from(new Set(selected.map(c => c.trim()).filter(Boolean)))
    .map(c => c.toUpperCase());
}

/**
 * Helper to map backend returned identifiers (UPPER_SNAKE) back to UI (lower snake).
 */
export function fromBackendAgentCategories(returned?: string[]): string[] | undefined {
  if (!returned) return undefined;
  return returned.map(c => c.trim().toLowerCase());
}
