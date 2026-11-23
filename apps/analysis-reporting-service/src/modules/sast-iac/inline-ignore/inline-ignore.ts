/**
 * `cybedefend-ignore` is decided by the platform.
 *
 * The scanner no longer drops an issue carrying a directive: it attaches the
 * directive(s) it read (reported line, then the line above) and
 * analysis-reporting decides against the catalogue rule the issue resolves to.
 * A directive names catalogue codes `CD-<TYPE>-<NNNN>`; scanner rule ids (KICS
 * UUIDs, `CKV_…`, `BC_…`, dotted Opengrep ids, Gitleaks rule ids) are no
 * longer honoured.
 *
 * Every finding follows the same rules, secrets included (a Gitleaks finding,
 * or one resolved to a rule raised as a secret): the bare form covers every
 * rule of its line, a scoped directive the rules whose code it lists.
 */

import { InlineIgnoreDirective } from '@grpc/analysis-reporting/result';

/** Longest string worth checking; nothing longer is a code. */
const MAX_RULE_CODE_LENGTH = 64;

/**
 * `CD-<TYPE>-<NNNN>`, case-insensitive. Anchored, no nested quantifier: the
 * `-` after `[A-Z]+` cannot be consumed by it, so matching is linear.
 */
const RULE_CODE_PATTERN = /^CD-[A-Z]+-\d{4,}$/i;

/**
 * Canonical form of a catalogue code (trimmed, upper-cased), or `null` when the
 * input is not one.
 *
 * The pattern is checked BEFORE upper-casing: `toUpperCase` maps a few
 * non-ASCII letters onto ASCII ones (`'ı'` → `'I'`), so the other order would
 * accept a look-alike. A code is ASCII.
 */
export function normalizeRuleCode(
  raw: string | null | undefined,
): string | null {
  if (typeof raw !== 'string') return null;
  const candidate = raw.trim();
  if (
    candidate.length > MAX_RULE_CODE_LENGTH ||
    !RULE_CODE_PATTERN.test(candidate)
  ) {
    return null;
  }
  return candidate.toUpperCase();
}

type Directives = ReadonlyArray<InlineIgnoreDirective> | null | undefined;

const hasBareDirective = (
  directives: ReadonlyArray<InlineIgnoreDirective>,
): boolean => directives.some((d) => d?.allRules === true);

/** The well-formed codes the directives list, normalised. */
const listedCodes = (
  directives: ReadonlyArray<InlineIgnoreDirective>,
): string[] =>
  directives
    .flatMap((d) => (Array.isArray(d?.codes) ? d.codes : []))
    .map((listed) => normalizeRuleCode(listed))
    .filter((code): code is string => code !== null);

/** What the decision needs of the catalogue rule an issue resolves to. */
export interface InlineIgnoreRule {
  /** `CD-<TYPE>-<NNNN>`, or null when the catalogue row carries none. */
  code?: string | null;
}

/**
 * Whether the directives attached to an issue neutralise it: a bare directive
 * covers every rule of its line; a scoped one covers the rules whose catalogue
 * code it lists. A rule without a catalogue code — some Gitleaks rules have
 * none — or an issue without a correspondance row can only be neutralised by
 * the bare form, and a listed id that is not a code (a scanner rule id)
 * matches nothing. The scanner and the rule's family play no part: a secret
 * is decided like any other finding.
 *
 * @param rule - The catalogue rule the issue resolves to; null or undefined
 *   when its rule id has no correspondance row.
 */
export function isNeutralizedByInlineIgnore(
  directives: Directives,
  rule: InlineIgnoreRule | null | undefined,
): boolean {
  if (!Array.isArray(directives) || directives.length === 0) return false;
  if (hasBareDirective(directives)) return true;
  const code = normalizeRuleCode(rule?.code);
  return code !== null && listedCodes(directives).includes(code);
}

/**
 * Whether deciding these directives requires the catalogue rule the issue
 * resolves to: only a listed code does, since only the rule's code can match
 * it. The bare form neutralises whatever the resolution, so it is decided
 * without the catalogue — for every scanner, Gitleaks included. When this is
 * false, `isNeutralizedByInlineIgnore` gives the same answer for every
 * resolution, so an issue can be decided while the catalogue is unreadable.
 */
export function inlineIgnoreNeedsCatalogRule(directives: Directives): boolean {
  if (!Array.isArray(directives) || hasBareDirective(directives)) return false;
  return listedCodes(directives).length > 0;
}

/**
 * A secret finding: reported by the secret scanner, or resolved to a rule
 * raised as a secret (`correspondance_table.vulnerabilityType`, some SAST
 * rules detect hard-coded credentials). It plays no part in the decision; a
 * secret a directive silences is audited.
 */
export function isSecretFinding(
  scannerNameLowerCase: string,
  rule: { vulnerabilityType?: string | null } | null | undefined,
): boolean {
  return (
    (scannerNameLowerCase ?? '').trim().toLowerCase() === 'gitleaks' ||
    (rule?.vulnerabilityType ?? '').trim().toLowerCase() === 'secret'
  );
}

/** The form that silenced an issue: bare when one of its directives is. */
export function neutralisingForm(directives: Directives): 'bare' | 'scoped' {
  return Array.isArray(directives) && hasBareDirective(directives)
    ? 'bare'
    : 'scoped';
}
