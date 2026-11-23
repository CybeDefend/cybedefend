import { createHash } from 'crypto';
import {
  CodeStructure,
  RuleMetadata,
  VulnerabilityDtoRequest,
} from '@grpc/analysis-reporting/result';
import {
  ImportType,
  ResultKind,
  resultKindOf,
  typeTakesKind,
} from './result-kind';
import {
  SarifArtifactLocation,
  SarifResult,
  SarifRunHeader,
  SarifRule,
  SarifTool,
} from './sarif.types';

/**
 * The SARIF result mapper: one result
 * becomes one `VulnerabilityDtoRequest`, or a counted skip. `RuleMetadata` is
 * attached so the catalogue fallback can create a local rule row
 * for a (tool, rule) the catalogue does not know.
 */

export type ImportCategory = 'sast' | 'iac' | 'secret' | 'cicd';
export type ImportSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface RuleIndex {
  byId: Map<string, SarifRule>;
  driver: SarifRule[];
  extensions: SarifRule[][];
}

export type MapOutcome =
  | { kind: 'mapped'; dto: VulnerabilityDtoRequest }
  | {
      kind: 'skipped';
      reason:
        | 'suppressed'
        | 'not_a_failure'
        | 'no_rule_id'
        | 'no_location'
        | 'invalid_path';
    }
  | { kind: 'skipped'; reason: 'kind_mismatch'; resultKind: ResultKind };

const MAX_TOOL_NAME = 64;
const MAX_RULE_ID = 255;
const MAX_NAME = 255;
const MAX_SHORT_DESCRIPTION = 1000;
const MAX_FULL_DESCRIPTION = 10000;
const MAX_HELP_MARKDOWN = 20000;
const MAX_DESCRIPTION = 10000;
const MAX_TAGS = 10;
const MAX_SNIPPET_LINES = 50;
const MAX_SNIPPET_LINE = 1000;
const MAX_URI_BASE_DEPTH = 5;

const cut = (value: string | undefined, max: number): string =>
  (value ?? '').slice(0, max);

/** Lower-case, `[a-z0-9._-]` only, runs of `-` collapsed, trimmed, cut at 64. */
export function sanitizeToolName(name: string | undefined): string {
  const cleaned = (name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_TOOL_NAME);
  return cleaned === '' ? 'sarif' : cleaned;
}

export function buildRuleIndex(tool: SarifTool): RuleIndex {
  const driver = tool.driver?.rules ?? [];
  const extensions = (tool.extensions ?? []).map(
    (component) => component.rules ?? [],
  );
  const byId = new Map<string, SarifRule>();
  for (const rule of [...driver, ...extensions.flat()]) {
    if (rule.id !== undefined && !byId.has(rule.id)) byId.set(rule.id, rule);
  }
  return { byId, driver, extensions };
}

const levelSeverity = (level: string | undefined): ImportSeverity => {
  switch (level?.toLowerCase()) {
    case 'error':
      return 'high';
    case 'note':
    case 'none':
      return 'low';
    default:
      // 'warning', absent and anything else: the SARIF default level
      return 'medium';
  }
};

/**
 * `properties['security-severity']` alone: a number or numeric string maps
 * ≥ 9 critical, ≥ 7 high, ≥ 4 medium, > 0 low. `0`, a negative or an
 * unparseable value returns null so the caller falls through to `level`.
 */
export const securitySeverityOf = (
  properties: Record<string, unknown> | undefined,
): ImportSeverity | null => {
  const value = properties?.['security-severity'];
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const score = Number(value);
  if (!Number.isFinite(score) || score <= 0) return null;
  if (score >= 9) return 'critical';
  if (score >= 7) return 'high';
  if (score >= 4) return 'medium';
  return 'low';
};

export function severityOf(
  properties: Record<string, unknown> | undefined,
  level: string | undefined,
): ImportSeverity {
  return securitySeverityOf(properties) ?? levelSeverity(level);
}

const tagStrings = (tags: unknown): string[] =>
  Array.isArray(tags)
    ? tags.filter((tag): tag is string => typeof tag === 'string')
    : [];

/**
 * What a property bag says of its CWEs: its `tags`, then its `cwe` (a string
 * or an array of strings, as some tools write it outside the tags).
 */
const cweCandidatesOf = (
  properties: Record<string, unknown> | undefined,
): string[] => {
  const cwe = properties?.cwe;
  return [
    ...tagStrings(properties?.tags),
    ...tagStrings(typeof cwe === 'string' ? [cwe] : cwe),
  ];
};

/**
 * `CWE-<n>` alone or followed by a colon or a space and its title (Semgrep
 * writes `CWE-89: Improper Neutralization …`), or CodeQL's
 * `external/cwe/cwe-<n>`. A tag that only mentions a CWE in prose is not one.
 */
const CWE_TAG = /^(?:CWE-(\d+)(?=$|[:\s])|external\/cwe\/cwe-(\d+)$)/i;
const OWASP_TAG = /\bA(0[1-9]|10):2021\b/gi;

const cweIdsOfTags = (tags: string[]): string[] => {
  const cwe: string[] = [];
  for (const tag of tags) {
    const cweMatch = CWE_TAG.exec(tag);
    if (cweMatch) {
      const cweId = `CWE-${Number(cweMatch[1] ?? cweMatch[2])}`;
      if (!cwe.includes(cweId) && cwe.length < MAX_TAGS) cwe.push(cweId);
    }
  }
  return cwe;
};

/**
 * The CWE tags of a rule and a result, rule first, as `CWE-<n>` without
 * leading zeros, at most 10 (the tag rule of `ruleMetadataOf`).
 */
export function cweTagsOf(
  rule: SarifRule | undefined,
  result: SarifResult,
): string[] {
  return cweIdsOfTags([
    ...cweCandidatesOf(rule?.properties),
    ...cweCandidatesOf(result?.properties),
  ]);
}

/**
 * The rule metadata carried to the catalogue fallback. `severity` is the
 * mapped severity of the result being mapped (the import worker replaces it
 * with the first result's of the same (tool, rule)). Tags are read from the rule; the
 * caller merges the result's tags into the rule's before calling.
 */
export function ruleMetadataOf(
  rule: SarifRule | undefined,
  ruleId: string,
  toolName: string,
  severity: ImportSeverity,
): RuleMetadata {
  const cwe = cweIdsOfTags(cweCandidatesOf(rule?.properties));
  const owaspTop10: string[] = [];
  for (const tag of tagStrings(rule?.properties?.tags)) {
    for (const owaspMatch of tag.matchAll(OWASP_TAG)) {
      const label = `A${owaspMatch[1]}:2021`;
      if (!owaspTop10.includes(label) && owaspTop10.length < MAX_TAGS) {
        owaspTop10.push(label);
      }
    }
  }

  let helpUri = '';
  if (rule?.helpUri) {
    try {
      if (new URL(rule.helpUri).protocol === 'https:') helpUri = rule.helpUri;
    } catch {
      helpUri = '';
    }
  }

  return {
    toolName,
    ruleId: cut(ruleId, MAX_RULE_ID),
    name: cut(rule?.name ?? rule?.shortDescription?.text ?? ruleId, MAX_NAME),
    shortDescription: cut(rule?.shortDescription?.text, MAX_SHORT_DESCRIPTION),
    fullDescription: cut(rule?.fullDescription?.text, MAX_FULL_DESCRIPTION),
    helpMarkdown: cut(
      rule?.help?.markdown ?? rule?.help?.text,
      MAX_HELP_MARKDOWN,
    ),
    cwe,
    severity,
    helpUri,
    owaspTop10,
  };
}

const ABSOLUTE_URI = /^[A-Za-z][A-Za-z0-9+.-]*:/;

/**
 * A base URI with a scheme or a leading `/` is the checkout root: it is not
 * prepended and the walk stops there.
 */
const isAbsoluteBase = (uri: string): boolean =>
  uri.startsWith('/') || ABSOLUTE_URI.test(uri);

/**
 * Resolves `artifactLocation` to a repository-relative path, or null when the
 * path is unusable (`..` segment, empty, malformed percent-encoding).
 */
export function resolveResultPath(
  location: SarifArtifactLocation | undefined,
  header: SarifRunHeader,
): string | null {
  let loc = location;
  if (loc && typeof loc.index === 'number') {
    const artifact = header.artifacts[loc.index];
    if (artifact) loc = artifact;
  }

  let prefix = '';
  let current: SarifArtifactLocation | undefined = loc;
  let depth = 0;
  while (current?.uriBaseId !== undefined && depth < MAX_URI_BASE_DEPTH) {
    const base = header.originalUriBaseIds[current.uriBaseId];
    if (!base || typeof base.uri !== 'string' || isAbsoluteBase(base.uri)) {
      break;
    }
    prefix = base.uri + prefix;
    current = base;
    depth += 1;
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(prefix + (loc?.uri ?? ''));
  } catch {
    return null;
  }
  let path = decoded.replace(/\\/g, '/');
  if (path.startsWith('file://')) path = path.slice('file://'.length);
  if (path.startsWith('./')) path = path.slice(2);
  if (path.startsWith('/')) {
    path = path.slice(1);
  } else {
    const drive = /^[A-Za-z]:\//.exec(path);
    if (drive) path = path.slice(drive[0].length);
  }
  if (path === '') return null;
  if (path.split('/').includes('..')) return null;
  return path;
}

const lookupRule = (
  result: SarifResult,
  rules: RuleIndex,
): SarifRule | undefined => {
  const componentIndex = result.rule?.toolComponent?.index;
  const ruleIndex = result.rule?.index;
  if (typeof componentIndex === 'number' && typeof ruleIndex === 'number') {
    const found = rules.extensions[componentIndex]?.[ruleIndex];
    if (found) return found;
  }
  const index = result.ruleIndex ?? result.rule?.index;
  if (typeof index === 'number') {
    const found = rules.driver[index];
    if (found) return found;
  }
  const id = result.ruleId ?? result.rule?.id;
  if (typeof id === 'string') return rules.byId.get(id);
  return undefined;
};

/**
 * The rule lookup of a result: the rule found through the indexes or the id,
 * and the raw (uncut) rule id the result carries, if any.
 */
export function resolveRule(
  result: SarifResult,
  rules: RuleIndex,
): { rule?: SarifRule; ruleId?: string } {
  const rule = lookupRule(result, rules);
  const rawRuleId = result.ruleId ?? result.rule?.id ?? rule?.id;
  return {
    rule,
    ruleId: typeof rawRuleId === 'string' ? rawRuleId : undefined,
  };
}

export function mapSarifResult(
  result: SarifResult,
  header: SarifRunHeader,
  rules: RuleIndex,
  toolName: string,
  category: ImportType,
): MapOutcome {
  const { rule, ruleId: rawRuleId } = resolveRule(result, rules);
  // the kind check runs right after the rule lookup, before the suppressions:
  // a result whose kind another import type takes is skipped and counted
  const resultKind = resultKindOf(toolName, rule);
  if (resultKind !== null && !typeTakesKind(category, resultKind)) {
    return { kind: 'skipped', reason: 'kind_mismatch', resultKind };
  }
  const ruleId =
    typeof rawRuleId === 'string' ? rawRuleId.slice(0, MAX_RULE_ID) : '';
  if (ruleId === '') return { kind: 'skipped', reason: 'no_rule_id' };

  if (
    result.suppressions?.some(
      (suppression) =>
        suppression.status === undefined || suppression.status === 'accepted',
    )
  ) {
    return { kind: 'skipped', reason: 'suppressed' };
  }

  if (result.kind !== undefined && result.kind !== 'fail') {
    return { kind: 'skipped', reason: 'not_a_failure' };
  }

  const severity =
    securitySeverityOf(result.properties) ??
    securitySeverityOf(rule?.properties) ??
    severityOf(undefined, result.level ?? rule?.defaultConfiguration?.level);

  const physical = result.locations?.[0]?.physicalLocation;
  if (!physical) return { kind: 'skipped', reason: 'no_location' };
  const path = resolveResultPath(physical.artifactLocation, header);
  if (path === null) return { kind: 'skipped', reason: 'invalid_path' };

  const region = physical.region;
  const rawStart = region?.startLine;
  const startLine =
    typeof rawStart === 'number' && rawStart >= 1 ? Math.floor(rawStart) : 1;
  const rawEnd = region?.endLine;
  const endLine = typeof rawEnd === 'number' ? Math.floor(rawEnd) : startLine;

  const snippetText = region?.snippet?.text;
  const keptLines =
    typeof snippetText === 'string'
      ? snippetText
          .split('\n')
          .slice(0, MAX_SNIPPET_LINES)
          .map((line) => line.slice(0, MAX_SNIPPET_LINE))
      : [];
  const code: CodeStructure[] =
    category === 'secret'
      ? []
      : keptLines.map((content, i) => ({ line: startLine + i, content }));
  const fileHash = createHash('sha256')
    .update(`${path}:${keptLines.join('\n')}`)
    .digest('hex');

  // the rule's then the result's: tags, then CWEs written outside the tags
  // (`properties.cwe`), folded into the tags `ruleMetadataOf` reads
  const metaRule: SarifRule = {
    ...rule,
    properties: {
      ...rule?.properties,
      tags: [
        ...cweCandidatesOf(rule?.properties),
        ...cweCandidatesOf(result.properties),
      ],
      cwe: undefined,
    },
  };
  const metadata = ruleMetadataOf(metaRule, ruleId, toolName, severity);

  const dto: VulnerabilityDtoRequest = {
    ruleId,
    language: 'generic',
    cwe: metadata.cwe,
    owaspTop10: metadata.owaspTop10,
    name: metadata.name,
    description: cut(result.message?.text, MAX_DESCRIPTION),
    severity,
    confidence: '',
    path,
    fileHash,
    codeSnippet: {
      vulnerableStartLine: startLine,
      vulnerableEndLine: endLine,
      startLine,
      endLine: code.length > 0 ? startLine + code.length - 1 : startLine,
      code,
      language: 'generic',
      path,
    },
    dataFlow: [],
    inlineIgnores: [],
    ruleMetadata: metadata,
  };
  return { kind: 'mapped', dto };
}
