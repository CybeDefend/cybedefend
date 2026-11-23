import type {
  VulnerabilitySastIacResponse,
  VulnerabilitySca,
  ContainerVulnerabilityDetection,
  DataFlowItem,
} from '@grpc/analysis-reporting/result';
import { McpVulnerabilityListItemDto } from './dto/response/mcp-vulnerability-list-response.dto';
import { McpVulnerabilityDetailDto } from './dto/response/mcp-vulnerability-detail-response.dto';

/** Caps for the slim detail payload. */
export const MCP_DETAIL_TEXT_MAX = 800;
export const MCP_DETAIL_SNIPPET_MAX = 1200;
export const MCP_DETAIL_DATAFLOW_MAX_STEPS = 12;
export const MCP_DETAIL_REFERENCES_MAX = 10;
/** Cap the SCA autofix dependency/import chain on the slim detail. */
export const MCP_DETAIL_DEPENDENCY_PATH_MAX = 8;

/** Structural view of a base-family detail item (sast/iac/cicd/secret). */
type BaseFamilyDetail = {
  base?: VulnerabilitySastIacResponse;
  dataFlowItems?: DataFlowItem[];
};

/**
 * Default and hard-max page size for the MCP-only list endpoints.
 * The dashboard endpoints leave page size uncapped (a deliberate product
 * choice); the MCP surface must bound it so an LLM cannot request thousands
 * of items in one call and blow its context window.
 */
export const MCP_LIST_DEFAULT_PAGE_SIZE = 20;
export const MCP_LIST_MAX_PAGE_SIZE = 50;

/**
 * Clamp a caller-supplied page size into the MCP-allowed range. Falsy / <1
 * falls back to the default; anything above the max is capped.
 */
export function clampMcpPageSize(requested?: number): number {
  if (!requested || requested < 1) {
    return MCP_LIST_DEFAULT_PAGE_SIZE;
  }
  return Math.min(requested, MCP_LIST_MAX_PAGE_SIZE);
}

/** Drop empty strings so optional fields are simply absent in the JSON. */
function orUndefined(value: string | undefined): string | undefined {
  return value ? value : undefined;
}

/**
 * Map a SAST/IaC/CICD/secret/container base item into the slim MCP shape.
 */
export function toSlimBaseFamilyItem(
  base: VulnerabilitySastIacResponse | undefined,
  scanner: string,
): McpVulnerabilityListItemDto {
  // `base` is `optional` in the proto contract, and `toSlimBaseFamilyDetail`
  // spreads this helper after its own `base?.` guards — so it must be null-safe
  // too (mirrors the defensive style of `toSlimScaItem`). Without this guard a
  // single base-less item would throw a TypeError and 500 the whole endpoint.
  const meta = base?.vulnerability;
  return {
    id: base?.id ?? '',
    scanner,
    title: meta?.name ?? '',
    shortDescription: orUndefined(meta?.shortDescription),
    severity: base?.currentSeverity ?? '',
    priority: orUndefined(base?.currentPriority),
    state: base?.currentState ?? '',
    priorityScore: base?.priorityScore,
    exploitabilityVerdict: orUndefined(base?.exploitabilityVerdict),
    cwe: meta?.cwe ?? [],
    language: orUndefined(base?.language),
    hasAutofix: base?.hasCybeAutofix ?? false,
    hasCybeAnalysis: base?.hasCybeAnalysis ?? false,
    path: orUndefined(base?.path),
    startLine: base?.vulnerableStartLine,
    endLine: base?.vulnerableEndLine,
    // The id a `cybedefend-ignore[...]` directive lists, secret findings
    // included (a directive silences those too).
    ruleCode: orUndefined(meta?.code),
    // Set only on findings imported from a SARIF file: the user's own tool's
    // rule id, so an agent can match the finding against that file.
    scannerRuleId: orUndefined(base?.scannerRuleId),
  };
}

/**
 * The advisory id of an SCA finding (OSV id, else GHSA id), omitted when it
 * only repeats the CVE already carried by `cve`.
 */
function advisoryIdOf(
  meta: VulnerabilitySca['metadata'] | undefined,
): string | undefined {
  const id = orUndefined(meta?.id) ?? orUndefined(meta?.ghsaId);
  return id && id !== meta?.cve ? id : undefined;
}

/**
 * Map an SCA vulnerability item into the slim MCP shape. SCA has no source
 * region, so it carries package coordinates + CVE instead of path/lines.
 */
export function toSlimScaItem(
  v: VulnerabilitySca,
): McpVulnerabilityListItemDto {
  const base = v.base;
  const meta = v.metadata;
  const lib = v.library;
  const autofix = (v.autofixRecords ?? [])[0];
  const title =
    orUndefined(meta?.summary) ??
    (lib ? `${lib.packageName}@${lib.packageVersion}` : '');
  return {
    id: base?.id ?? '',
    scanner: 'sca',
    title,
    // SCA has no short-description distinct from `summary`, which already feeds
    // `title`. Emitting it again would ship the same string twice per item,
    // against the MCP surface's token-reduction goal — so it is intentionally omitted.
    shortDescription: undefined,
    severity: base?.currentSeverity ?? '',
    priority: orUndefined(base?.currentPriority),
    state: base?.currentState ?? '',
    priorityScore: v.priorityScore ?? base?.priorityScore,
    exploitabilityVerdict: orUndefined(v.exploitabilityVerdict),
    cwe: (meta?.cwes ?? []).map((c) => c.cweId).filter(Boolean),
    language: orUndefined(base?.language),
    hasAutofix: v.hasAutofix ?? false,
    hasCybeAnalysis: v.hasCybeAnalysis ?? false,
    packageName: orUndefined(lib?.packageName),
    packageVersion: orUndefined(lib?.packageVersion),
    cve: orUndefined(meta?.cve),
    advisoryId: advisoryIdOf(meta),
    // Cheap triage hint — which version to bump to when an autofix
    // record exists. Full upgrade guidance lives on the detail endpoint.
    recommendedFixVersion: orUndefined(autofix?.recommendedProposedVersion),
    // Only surface the malware flag when true (slim payload).
    isMalware: v.isMalware ? true : undefined,
  };
}

/**
 * Map a container image vulnerability into the slim MCP shape. Container has
 * its own detection shape (no shared `base`): the OS-package CVE lives under
 * `vuln`, the affected package under `package`. The long OSV `description` and
 * the (often hundreds of) `references` are dropped here — they belong to the
 * detail endpoint.
 */
export function toSlimContainerItem(
  d: ContainerVulnerabilityDetection,
): McpVulnerabilityListItemDto {
  const vuln = d.vuln;
  const pkg = d.package;
  return {
    id: d.id,
    scanner: 'container',
    title: orUndefined(vuln?.title) ?? d.vulnerabilityIdentifier ?? '',
    shortDescription: undefined,
    severity: d.currentSeverity,
    priority: orUndefined(d.currentPriority),
    state: d.currentState,
    priorityScore: d.priorityScore,
    exploitabilityVerdict: orUndefined(d.exploitabilityVerdict),
    cwe: vuln?.cweIds ?? [],
    language: undefined,
    // Container detections expose no autofix/agent flags; derive analysis from
    // the exploitability source the agent stamps when it scores the finding.
    hasAutofix: false,
    hasCybeAnalysis: d.exploitabilitySource === 'agent',
    packageName: orUndefined(pkg?.name),
    packageVersion: orUndefined(pkg?.version),
    cve: orUndefined(d.vulnerabilityIdentifier),
  };
}

/** Clip a string to `max` chars with a marker; empty/undefined → undefined. */
export function truncateText(
  value: string | undefined,
  max = MCP_DETAIL_TEXT_MAX,
): string | undefined {
  if (!value) return undefined;
  // Slice on code POINTS, not UTF-16 code units, so an emoji / astral-plane
  // character straddling the cap is never split into a lone surrogate (which
  // would serialise as a stray `�` right before the marker).
  const chars = [...value];
  return chars.length > max
    ? `${chars.slice(0, max).join('')}… [truncated]`
    : value;
}

/**
 * Slim detail for the base family (sast/iac/cicd/secret). Truncates the long
 * markdown, keeps the primary code snippet (truncated), caps the dataflow to
 * a handful of steps WITHOUT per-step code, and reduces autofix to a pointer.
 */
export function toSlimBaseFamilyDetail(
  vuln: BaseFamilyDetail,
  scanner: string,
): McpVulnerabilityDetailDto {
  const base = vuln.base;
  const meta = base?.vulnerability;
  const primarySnippet = (base?.codeSnippets ?? [])[0];
  const snippetText = primarySnippet
    ? (primarySnippet.code ?? []).map((l) => l.content).join('\n')
    : undefined;
  const autofix = (base?.autofixRecords ?? [])[0];
  const dataFlow = (vuln.dataFlowItems ?? [])
    .slice(0, MCP_DETAIL_DATAFLOW_MAX_STEPS)
    .map((step) => ({ path: step.path, line: step.line, order: step.order }));
  return {
    ...toSlimBaseFamilyItem(base, scanner),
    description: truncateText(meta?.description),
    howToPrevent: truncateText(meta?.howToPrevent),
    contextualExplanation: truncateText(base?.contextualExplanation),
    exploitabilityReason: truncateText(base?.exploitabilityReason),
    references: (meta?.references ?? [])
      .slice(0, MCP_DETAIL_REFERENCES_MAX)
      .map((r) => r.url)
      .filter(Boolean),
    codeSnippet: truncateText(snippetText, MCP_DETAIL_SNIPPET_MAX),
    dataFlow: dataFlow.length ? dataFlow : undefined,
    autofix: autofix
      ? {
          prUrl: orUndefined(autofix.prUrl),
          status: orUndefined(autofix.status),
          hasFullDiff: !!autofix.diff,
        }
      : undefined,
  };
}

/** Slim detail for SCA: truncates the OSV advisory body, caps references. */
export function toSlimScaDetail(
  v: VulnerabilitySca,
): McpVulnerabilityDetailDto {
  const meta = v.metadata;
  const lib = v.library;
  const autofix = (v.autofixRecords ?? [])[0];
  const dependencyPath = (lib?.path ?? []).slice(
    0,
    MCP_DETAIL_DEPENDENCY_PATH_MAX,
  );
  return {
    ...toSlimScaItem(v),
    description: truncateText(meta?.details),
    exploitabilityReason: truncateText(v.exploitabilityReason),
    references: (meta?.references ?? [])
      .slice(0, MCP_DETAIL_REFERENCES_MAX)
      .map((r) => r.url)
      .filter(Boolean),
    autofix: autofix
      ? {
          prUrl: orUndefined(autofix.prUrl),
          status: orUndefined(autofix.status),
          hasFullDiff: !!autofix.diff,
          // Actionable upgrade guidance (SCA autofix record + detected
          // library) so an agent can apply the dependency bump itself. Empty
          // proto3 scalars collapse to `undefined` and are dropped from JSON.
          recommendedVersion: orUndefined(autofix.recommendedProposedVersion),
          recommendedPackage: orUndefined(autofix.recommendedParentPackage),
          currentVersion: orUndefined(autofix.recommendedCurrentVersion),
          updateType: orUndefined(autofix.recommendedUpdateType),
          installCommand: orUndefined(autofix.installCommand),
          hasFixAvailable: autofix.hasFixAvailable,
          isTransitive: lib?.isTransitive,
          ecosystem: orUndefined(lib?.ecosystem),
          manifestFile: orUndefined(lib?.fileName),
          dependencyPath: dependencyPath.length ? dependencyPath : undefined,
        }
      : undefined,
  };
}

/** Slim detail for container: truncates the OSV description, caps references. */
export function toSlimContainerDetail(
  d: ContainerVulnerabilityDetection,
): McpVulnerabilityDetailDto {
  const vuln = d.vuln;
  return {
    ...toSlimContainerItem(d),
    description: truncateText(vuln?.description),
    exploitabilityReason: truncateText(d.exploitabilityReason),
    references: (vuln?.references ?? [])
      .slice(0, MCP_DETAIL_REFERENCES_MAX)
      .filter(Boolean),
    fixedVersion: orUndefined(d.fixedVersion),
  };
}
