/**
 * License categorization and risk assessment for SCA packages.
 *
 * Categorizes SPDX license identifiers into risk levels:
 * - PERMISSIVE: No restrictions, freely usable
 * - WEAK_COPYLEFT: Constraints if the library is modified
 * - STRONG_COPYLEFT: Viral — project must adopt same license
 * - UNKNOWN: Could not be normalized to a known SPDX identifier
 */

export enum LicenseCategory {
  PERMISSIVE = 'PERMISSIVE',
  WEAK_COPYLEFT = 'WEAK_COPYLEFT',
  STRONG_COPYLEFT = 'STRONG_COPYLEFT',
  UNKNOWN = 'UNKNOWN',
}

export enum LicenseRisk {
  NONE = 'NONE',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  UNKNOWN = 'UNKNOWN',
}

export interface LicenseInfo {
  spdxId: string;
  name: string;
  category: LicenseCategory;
  risk: LicenseRisk;
  riskDescription: string;
}

const PERMISSIVE_LICENSES: Record<string, string> = {
  MIT: 'MIT License',
  'MIT-0': 'MIT No Attribution',
  ISC: 'ISC License',
  'BSD-2-Clause': 'BSD 2-Clause "Simplified"',
  'BSD-3-Clause': 'BSD 3-Clause "New"',
  'BSD-3-Clause-Clear': 'BSD 3-Clause Clear',
  'BSD-1-Clause': 'BSD 1-Clause',
  'Apache-1.0': 'Apache License 1.0',
  'Apache-1.1': 'Apache License 1.1',
  'Apache-2.0': 'Apache License 2.0',
  Unlicense: 'The Unlicense',
  'CC0-1.0': 'Creative Commons Zero 1.0',
  'CC-BY-3.0': 'Creative Commons Attribution 3.0',
  'CC-BY-4.0': 'Creative Commons Attribution 4.0',
  WTFPL: 'Do What The F*ck You Want To Public License',
  Zlib: 'zlib License',
  '0BSD': 'BSD Zero Clause',
  'BSL-1.0': 'Boost Software License 1.0',
  'PSF-2.0': 'Python Software Foundation License 2.0',
  'Python-2.0': 'Python License 2.0',
  PostgreSQL: 'PostgreSQL License',
  'BlueOak-1.0.0': 'Blue Oak Model License 1.0.0',
  'Artistic-1.0': 'Artistic License 1.0',
  'Artistic-2.0': 'Artistic License 2.0',
  'OFL-1.0': 'SIL Open Font License 1.0',
  'OFL-1.1': 'SIL Open Font License 1.1',
  'AFL-2.0': 'Academic Free License 2.0',
  'AFL-2.1': 'Academic Free License 2.1',
  'AFL-3.0': 'Academic Free License 3.0',
  NCSA: 'University of Illinois/NCSA Open Source License',
  'MS-PL': 'Microsoft Public License',
  JSON: 'JSON License',
  HPND: 'Historical Permission Notice and Disclaimer',
  'BSD-4-Clause': 'BSD 4-Clause "Original"',
  Ruby: 'Ruby License',
  W3C: 'W3C Software Notice and License',
  'PHP-3.0': 'PHP License v3.0',
  'PHP-3.01': 'PHP License v3.01',
  'Ruby-1.8': 'Ruby License 1.8',
  PRAWN: 'Prawn License',
  'Hippocratic-2.1': 'Hippocratic License 2.1',
};

const WEAK_COPYLEFT_LICENSES: Record<string, string> = {
  'LGPL-2.0-only': 'GNU Lesser General Public License v2.0 only',
  'LGPL-2.0-or-later': 'GNU Lesser General Public License v2.0 or later',
  'LGPL-2.1-only': 'GNU Lesser General Public License v2.1 only',
  'LGPL-2.1-or-later': 'GNU Lesser General Public License v2.1 or later',
  'LGPL-3.0-only': 'GNU Lesser General Public License v3.0 only',
  'LGPL-3.0-or-later': 'GNU Lesser General Public License v3.0 or later',
  'MPL-1.0': 'Mozilla Public License 1.0',
  'MPL-1.1': 'Mozilla Public License 1.1',
  'MPL-2.0': 'Mozilla Public License 2.0',
  'EPL-1.0': 'Eclipse Public License 1.0',
  'EPL-2.0': 'Eclipse Public License 2.0',
  'CDDL-1.0': 'Common Development and Distribution License 1.0',
  'CDDL-1.1': 'Common Development and Distribution License 1.1',
  'CPL-1.0': 'Common Public License 1.0',
  'EUPL-1.1': 'European Union Public License 1.1',
  'EUPL-1.2': 'European Union Public License 1.2',
  'OSL-2.0': 'Open Software License 2.0',
  'OSL-2.1': 'Open Software License 2.1',
  'OSL-3.0': 'Open Software License 3.0',
  'MS-RL': 'Microsoft Reciprocal License',
  'BUSL-1.1': 'Business Source License 1.1',
  'CC-BY-SA-4.0': 'Creative Commons Attribution ShareAlike 4.0',
};

const STRONG_COPYLEFT_LICENSES: Record<string, string> = {
  'GPL-2.0-only': 'GNU General Public License v2.0 only',
  'GPL-2.0-or-later': 'GNU General Public License v2.0 or later',
  'GPL-3.0-only': 'GNU General Public License v3.0 only',
  'GPL-3.0-or-later': 'GNU General Public License v3.0 or later',
  'AGPL-3.0-only': 'GNU Affero General Public License v3.0 only',
  'AGPL-3.0-or-later': 'GNU Affero General Public License v3.0 or later',
  'SSPL-1.0': 'Server Side Public License v1',
};

/** All known licenses indexed by SPDX ID */
const ALL_LICENSES = new Map<
  string,
  { name: string; category: LicenseCategory }
>();

for (const [id, name] of Object.entries(PERMISSIVE_LICENSES)) {
  ALL_LICENSES.set(id, { name, category: LicenseCategory.PERMISSIVE });
}
for (const [id, name] of Object.entries(WEAK_COPYLEFT_LICENSES)) {
  ALL_LICENSES.set(id, { name, category: LicenseCategory.WEAK_COPYLEFT });
}
for (const [id, name] of Object.entries(STRONG_COPYLEFT_LICENSES)) {
  ALL_LICENSES.set(id, { name, category: LicenseCategory.STRONG_COPYLEFT });
}

const RISK_BY_CATEGORY: Record<LicenseCategory, LicenseRisk> = {
  [LicenseCategory.PERMISSIVE]: LicenseRisk.NONE,
  [LicenseCategory.WEAK_COPYLEFT]: LicenseRisk.MEDIUM,
  [LicenseCategory.STRONG_COPYLEFT]: LicenseRisk.HIGH,
  [LicenseCategory.UNKNOWN]: LicenseRisk.UNKNOWN,
};

const RISK_DESCRIPTION: Record<LicenseCategory, string> = {
  [LicenseCategory.PERMISSIVE]:
    'Freely usable with no significant restrictions.',
  [LicenseCategory.WEAK_COPYLEFT]:
    'Constraints apply if the library itself is modified. Linking/using as a dependency is generally fine.',
  [LicenseCategory.STRONG_COPYLEFT]:
    'Viral license — your project may need to adopt the same license. High compliance risk.',
  [LicenseCategory.UNKNOWN]:
    'License could not be resolved. Manual review required.',
};

/**
 * Get full license info for a single SPDX identifier.
 * Optionally accepts organization-level overrides.
 */
export function getLicenseInfo(
  spdxId: string,
  overrides?: Map<string, LicenseCategory>,
): LicenseInfo {
  if (spdxId === 'UNKNOWN') {
    return {
      spdxId: 'UNKNOWN',
      name: 'Unknown — License not found',
      category: LicenseCategory.UNKNOWN,
      risk: LicenseRisk.UNKNOWN,
      riskDescription: RISK_DESCRIPTION[LicenseCategory.UNKNOWN],
    };
  }

  const known = ALL_LICENSES.get(spdxId);
  const overriddenCategory = overrides?.get(spdxId);

  if (known) {
    const category = overriddenCategory ?? known.category;
    return {
      spdxId,
      name: known.name,
      category,
      risk: RISK_BY_CATEGORY[category],
      riskDescription: RISK_DESCRIPTION[category],
    };
  }

  // Fallback: try pattern matching for known families
  const defaultCategory = categorizeBySpdxPattern(spdxId);
  const category = overriddenCategory ?? defaultCategory;
  return {
    spdxId,
    name: spdxId,
    category,
    risk: RISK_BY_CATEGORY[category],
    riskDescription: RISK_DESCRIPTION[category],
  };
}

/**
 * Categorize a license by SPDX ID pattern when not in the known list.
 */
function categorizeBySpdxPattern(spdxId: string): LicenseCategory {
  const upper = spdxId.toUpperCase();
  if (
    upper.startsWith('GPL-') ||
    upper.startsWith('AGPL-') ||
    upper.startsWith('SSPL-')
  ) {
    return LicenseCategory.STRONG_COPYLEFT;
  }
  if (
    upper.startsWith('LGPL-') ||
    upper.startsWith('MPL-') ||
    upper.startsWith('EPL-') ||
    upper.startsWith('CDDL-') ||
    upper.startsWith('EUPL-') ||
    upper.startsWith('OSL-') ||
    upper.startsWith('BUSL-') ||
    upper.startsWith('CC-BY-SA')
  ) {
    return LicenseCategory.WEAK_COPYLEFT;
  }
  if (
    upper.startsWith('BSD-') ||
    upper.startsWith('APACHE-') ||
    upper.startsWith('CC0-') ||
    (upper.startsWith('CC-BY-') &&
      !upper.includes('-SA') &&
      !upper.includes('-NC') &&
      !upper.includes('-ND')) ||
    upper.startsWith('AFL-') ||
    upper.startsWith('PHP-') ||
    upper === 'MIT'
  ) {
    return LicenseCategory.PERMISSIVE;
  }
  return LicenseCategory.UNKNOWN;
}

/**
 * Determine the highest risk category from a list of licenses.
 * Used to compute the overall risk level for a package.
 * When an SPDX expression is provided, OR/AND semantics are respected.
 */
export function getHighestRiskCategory(
  licenses: string[],
  overrides?: Map<string, LicenseCategory>,
  expression?: string,
): LicenseCategory {
  if (expression) {
    try {
      // Lazy require to avoid circular dependency with spdx-expression.utils
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const spdx = require('./spdx-expression.utils');
      return spdx.getRiskFromExpression(expression, overrides);
    } catch {
      // Fall back to current behavior if expression parsing fails
    }
  }

  if (!licenses || licenses.length === 0) return LicenseCategory.UNKNOWN;

  let highest = LicenseCategory.PERMISSIVE;
  const riskOrder = [
    LicenseCategory.PERMISSIVE,
    LicenseCategory.WEAK_COPYLEFT,
    LicenseCategory.STRONG_COPYLEFT,
    LicenseCategory.UNKNOWN,
  ];

  for (const lic of licenses) {
    const info = getLicenseInfo(lic, overrides);
    if (riskOrder.indexOf(info.category) > riskOrder.indexOf(highest)) {
      highest = info.category;
    }
  }

  return highest;
}

/**
 * Returns all known licenses with their default categories.
 */
export function getAllKnownLicenses(): Array<{
  spdxId: string;
  name: string;
  defaultCategory: LicenseCategory;
}> {
  const result: Array<{
    spdxId: string;
    name: string;
    defaultCategory: LicenseCategory;
  }> = [];
  for (const [spdxId, { name, category }] of ALL_LICENSES.entries()) {
    result.push({ spdxId, name, defaultCategory: category });
  }
  return result;
}
