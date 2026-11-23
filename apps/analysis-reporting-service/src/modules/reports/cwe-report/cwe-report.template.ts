// cwe-report.template.ts
//
// HTML rendering of the CWE Top 25 report (PDF and dashboard preview),
// assembled with the shared components (shared/report-layout, report-charts…).
// Every figure covers the Top 25 scope and the OPEN findings; the project total
// is shown apart, labelled as such, and triaged findings appear only in the
// closing section.

import { escapeHtml } from '../../../core/utils/html-escape';
import {
  NO_REPORT_ANALYSIS,
  type ReportAnalysisBrief,
  type ReportAnalysisParts,
  type ReportAnalysisRenderer,
  type ReportAnalysisSource,
} from '../../../edition/ports/report-analysis.port';
import { donutChart, horizontalBars } from '../shared/report-charts';
import {
  comparePackageVersions,
  groupBy,
  formatReportDate,
  highestPackageVersion,
  isActiveState,
  redactSecrets,
} from '../shared/report-findings';
import {
  aboutSection,
  CoverMeta,
  coverMetaHeight,
  dataTable,
  emptyState,
  idText,
  keyFacts,
  kpiTiles,
  packageChip,
  pathText,
  renderCover,
  renderReportDocument,
  sectionHead,
  stateLabel,
  TableColumn,
  verdictPill,
} from '../shared/report-layout';
import {
  clampMarkdown,
  curlyApostrophesHtml,
  markdownToHtml,
  plainText,
} from '../shared/report-markdown';
import {
  COLORS,
  LONG_ID_CHARS,
  MONO_STACK,
  VERSION_WHOLE_CHARS,
  breakableId,
  idPieces,
  isLongId,
  joinShortPieces,
  piecesHtml,
  severityBadge,
  severityColors,
  severityLabel,
  typeBadge,
  versionChip,
  versionColumnChars,
  versionPieces,
} from '../shared/report-styles';
import { CWE_TOP_25_2024_DATA, CweData } from './constants/cwe-data.constants';
import {
  CweReportData,
  FindingType,
  MappedVulnerability,
  ScanMetadata,
} from './cwe-report.types';

const TITLE = 'CWE Top 25 report';
const EDITION = '2024';
const TOP25_SIZE = 25;

type Severity = 'critical' | 'high' | 'medium' | 'low' | 'unknown';
const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low'];
const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  unknown: 4,
};
const STATE_RANK: Record<string, number> = {
  confirmed: 0,
  to_verify: 1,
  proposed_not_exploitable: 2,
};
const TYPE_NAMES: Record<FindingType, string> = {
  sast: 'code (SAST)',
  iac: 'infrastructure (IaC)',
  sca: 'dependencies (SCA)',
  container: 'container images',
};
const SCOPE_LABELS: Record<FindingType, string> = {
  sast: 'SAST',
  iac: 'IaC',
  sca: 'SCA',
  container: 'Container',
};
/** An open state in words, in a sentence (« still to be verified »). */
const STATE_WORDS: Record<string, string> = {
  to_verify: 'still to be verified',
  confirmed: 'confirmed',
  proposed_not_exploitable: 'proposed as not exploitable',
  ignored: 'ignored',
  resolved: 'resolved',
  not_exploitable: 'judged not exploitable',
};
/** Width of the severity column, shared by every findings table. */
const SEVERITY_COL = 84;
/** Locations or versions shown at most in a row of the triaged list. */
const MAX_LISTED = 6;
/** Advisories of a triaged row each named by its title; beyond that, only the
 * critical ones are, the others by their identifier. */
const MAX_TITLED = 4;
/** Mono characters a chip (tag included) fits in the Package column of the
 * triaged list at 28 %; beyond that, the column goes to 32 %. */
const PACKAGE_CHARS = 27;
/** Width of a « dev » tag, in mono characters. */
const DEV_TAG_CHARS = 5;
/** Maximum length of a finding description, a reasoning. */
const DESCRIPTION_MAX = 600;
const REASON_MAX = 300;
/** Marks a shortened text (same mark as the other reports). */
const ELISION = '[&#8230;]';
/** Non-breaking space: joins two words a line end must not separate. */
const NBSP = '\u00a0';
/** Separator of an identifier line: breakable before, never after, so that a
 * line never ends on « · ». */
const ID_SEP = ` ·${NBSP}`;
/** A MITRE title of this length fits on one line. */
const SHORT_TITLE = 45;

/** Title of the document and of the running footer. */
export function cweReportTitle(meta: ScanMetadata): string {
  return `${TITLE} · ${meta.projectName || meta.projectId}`;
}

// ── helpers ────────────────────────────────────────────────────────────────

const severityOf = (v: MappedVulnerability): Severity => {
  const key = String(v.severity ?? '').toLowerCase();
  return (SEVERITIES as string[]).includes(key) ? (key as Severity) : 'unknown';
};
const stateOf = (v: MappedVulnerability) => String(v.state ?? '').toLowerCase();
const stateWords = (state: string) =>
  STATE_WORDS[state] ?? state.replace(/_/g, ' ');
/** `stateWords` as HTML: a state outside the table is stored data, printed raw. */
const stateHtml = (state: string) => escapeHtml(stateWords(state));
const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;
/** « a, b and c ». */
const listJoin = (items: string[]) =>
  items.length > 1
    ? `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
    : (items[0] ?? '');
/** Identifier in code font in a sentence or an identifier line: short, in one
 * piece; long (scoped package, prerelease version), breakable before its
 * separators rather than overflowing the cell. `tail` (a comma) stays attached
 * to its end. */
const monoText = (value: string | undefined | null, tail = '') => {
  const raw = redactSecrets(String(value ?? ''));
  return isLongId(raw)
    ? `<span class="mono is-long">${breakableId(raw)}${tail}</span>`
    : `<span class="mono">${escapeHtml(raw)}${tail}</span>`;
};
/** `name@version`, the name alone, or the version alone (empty name). */
const refText = (name: string | null | undefined, version?: string | null) =>
  [name ?? '', version ?? ''].filter(Boolean).join('@');
/** Package reference (refText) as escaped HTML, secrets masked. When long, its
 * name breaks before its separators (a short name never does) and its version
 * stays atomic: broken only between its parts (versionPieces), never inside
 * its revision nor between two digits. A masked secret breaks like an
 * identifier. */
const packageRefHtml = (
  name: string | null | undefined,
  version?: string | null,
): string => {
  const raw = refText(name, version);
  const shown = redactSecrets(raw);
  if (!isLongId(shown)) return escapeHtml(shown);
  if (shown !== raw || !version) return breakableId(shown);
  const parts = versionPieces(version);
  return piecesHtml(
    joinShortPieces(
      name
        ? [
            ...(isLongId(name) ? idPieces(name) : [name]),
            `@${parts[0]}`,
            ...parts.slice(1),
          ]
        : parts,
    ),
  );
};
/** A package reference in code font, like monoText: `tail` (a comma) stays
 * attached to its end. */
const packageText = (
  name: string | null | undefined,
  version?: string | null,
  tail = '',
) => {
  const long = isLongId(redactSecrets(refText(name, version)));
  return `<span class="mono${long ? ' is-long' : ''}">${packageRefHtml(name, version)}${tail}</span>`;
};
/** Apostrophe between two letters, outside `code`: the curly one (’) of the
 * report's texts, of the Cybe Analysis boxes and of the other reports of the
 * family. */
const curly = (raw: string): string =>
  raw
    .split(/(`[^`]+`)/)
    .map((part, i) =>
      i % 2 ? part : part.replace(/(?<=[A-Za-z])'(?=[A-Za-z])/g, '\u2019'),
    )
    .join('');
/** Words of a text, escaped; a long word (scoped package, path, method name)
 * breaks before its separators (breakableId), never after a hyphen that would
 * read as hyphenation. */
const breakableWords = (raw: string) =>
  raw
    .split(/(\s+)/)
    .map((word) => breakableId(word))
    .join('');
/** Title of a finding: secrets masked, curly apostrophes, escaped, `code`
 * rendered as code; a long identifier breaks there as elsewhere. */
const title = (value: string | undefined | null) =>
  curly(redactSecrets(String(value ?? '')))
    .split(/(`[^`]+`)/)
    .map((part, i) =>
      i % 2
        ? `<code class="code-inline">${breakableId(part.slice(1, -1))}</code>`
        : breakableWords(part),
    )
    .join('');
/** Title as plain text (continuation row, escaped by dataTable). */
const plainTitle = (value: string | undefined | null) =>
  curly(redactSecrets(String(value ?? ''))).replace(/`/g, '');
const reference = (cwe: CweData): CweData =>
  CWE_TOP_25_2024_DATA[cwe.id] ?? cwe;
/** Plain name (« Path traversal »); failing that, the MITRE parenthesis. */
const shortName = (cwe: CweData) =>
  cwe.shortName ?? cwe.name.match(/\('([^']+)'\)\s*$/)?.[1] ?? cwe.name;
/** « #24 · CWE-400 · Resource exhaustion »: the reminder of a weakness. */
const weaknessLabel = (cwe: CweData) =>
  `#${cwe.rank} · ${cwe.id} · ${escapeHtml(shortName(cwe))}`;
/** Kicker of a weakness, above its MITRE title: the plain name appears only
 * when it says something else (« Out-of-bounds write » would repeat «
 * Out-of-bounds Write », « CSRF » would repeat « Cross-Site Request Forgery
 * (CSRF) »); it stays above a long title, where it helps. */
const eyebrowLabel = (cwe: CweData) => {
  const name = cwe.name.toLowerCase();
  const plain = shortName(cwe).toLowerCase();
  return name === plain ||
    (cwe.name.length <= SHORT_TITLE && name.includes(plain))
    ? `#${cwe.rank} · ${cwe.id}`
    : weaknessLabel(cwe);
};
/** Top 25 identifiers of a finding, in ranking order. */
const top25Of = (v: MappedVulnerability): string[] =>
  (v.cwe ?? [])
    .filter((id) => CWE_TOP_25_2024_DATA[id])
    .sort(
      (a, b) => CWE_TOP_25_2024_DATA[a].rank - CWE_TOP_25_2024_DATA[b].rank,
    );
const maxSeverity = (items: MappedVulnerability[]): Severity =>
  items.reduce<Severity>(
    (best, v) =>
      SEVERITY_RANK[severityOf(v)] < SEVERITY_RANK[best] ? severityOf(v) : best,
    'unknown',
  );
/** « 4 high, 1 medium ». */
const severityBreakdown = (items: MappedVulnerability[]) =>
  [...SEVERITIES, 'unknown' as Severity]
    .map((s) => ({ s, n: items.filter((v) => severityOf(v) === s).length }))
    .filter(({ n }) => n > 0)
    .map(({ s, n }) => `${n} ${s}`)
    .join(', ');
const lineOf = (line?: string): string => {
  const [start, end] = String(line ?? '')
    .split('-')
    .map((n) => Number.parseInt(n, 10));
  if (!start) return '';
  return end && end !== start ? `:${start}–${end}` : `:${start}`;
};
const startOf = (line?: string) =>
  Number.parseInt(String(line ?? '').split('-')[0], 10) || 0;
const hasAnalysis = (v: MappedVulnerability) =>
  ['agent', 'manual'].includes(String(v.exploitability?.source ?? ''));
const isExploited = (v: MappedVulnerability) =>
  hasAnalysis(v) &&
  ['proven', 'actively_exploited'].includes(
    String(v.exploitability?.verdict ?? ''),
  );
const scorePct = (score?: number | null) =>
  typeof score === 'number' && score >= 0
    ? `${Math.round(Math.min(score, 1) * 100)}%`
    : '';
const isAdvisory = (v: MappedVulnerability) =>
  v.type === 'sca' || v.type === 'container';
const packageOf = (v: MappedVulnerability) =>
  redactSecrets(
    `${v.packageName ?? 'package'}${v.packageVersion ? `@${v.packageVersion}` : ''}`,
  );
const advisoryKey = (v: MappedVulnerability) => v.advisoryId || v.cve || v.name;
/** Order of a package's versions: the epoch first, then dpkg or semver (a
 * prerelease before its final version). */
const byVersion = (a: string, b: string) => comparePackageVersions(a, b);
const versionsOf = (items: MappedVulnerability[]): string[] =>
  Array.from(new Set(items.map((v) => v.packageVersion).filter(Boolean))).sort(
    byVersion,
  );
/**
 * « ignored for name@1.0, 1.2 »: the versions of one package, named once, in
 * mono like the chips; breakable only after a comma, never between the words
 * that introduce it (`lead`, optional) and the first reference, nor before the
 * last one (a version alone at the start of a line).
 */
const packageVersions = (lead: string, items: MappedVulnerability[]) => {
  const parts = groupBy(items, (v) => v.packageName ?? 'package').flatMap(
    ({ key, items: list }, p, all) => {
      const [head, ...rest] = versionsOf(list);
      // The name with the first version, then the other versions alone.
      const refs: [string, string | undefined][] = [
        [key, head],
        ...rest.map((version): [string, string] => ['', version]),
      ];
      const end = p < all.length - 1 ? ';' : '';
      return refs.map(([name, version], i) =>
        packageText(name, version, i < refs.length - 1 ? ',' : end),
      );
    },
  );
  if (lead) parts[0] = `<span class="keep">${lead} ${parts[0]}</span>`;
  const last = parts.pop();
  return parts.length ? `${parts.join(' ')}${NBSP}${last}` : last;
};
/** « CWE-77, CWE-94 » in mono, as in the ranking. */
const cweIds = (ids: string[]) =>
  ids.map((id) => `<span class="mono">${escapeHtml(id)}</span>`).join(', ');

const tag = (label: string) => ` <span class="tag">${label}</span>`;
/** Legend of the « dev » tag of package chips. */
const DEV_LEGEND =
  '<span class="tag">dev</span>: development dependency, not shipped to production.';
/** A triaged finding listed at the end of the report: critical or high. */
const isListedTriage = (v: MappedVulnerability) =>
  ['critical', 'high'].includes(severityOf(v));

/** Identifier line under a title: advisories, weaknesses, cross-references;
 * `suffix` (a tag) ends it. */
const idLine = (parts: string[], suffix = '') => {
  const kept = parts.filter(Boolean);
  return kept.length || suffix
    ? `<div class="adv-ids">${kept.join(ID_SEP)}${suffix}</div>`
    : '';
};

/**
 * Markdown shortened to `max` characters; a cut is marked, as in the other
 * reports. Its apostrophes are curly, like those of the titles.
 */
function clampedHtml(md: string, max: number, untrusted = false): string {
  const clamped = clampMarkdown(md, max);
  const html = curlyApostrophesHtml(
    markdownToHtml(clamped.text, { untrusted }),
  );
  if (!clamped.truncated || clamped.text.endsWith('…')) return html;
  const mark = `<span class="elided"> ${ELISION}</span>`;
  const closing = /(<\/li><\/[ou]l>|<\/p>|<\/h4>|<\/div>)$/;
  return closing.test(html)
    ? html.replace(closing, `${mark}$1`)
    : `${html}<p class="md-p elided">${ELISION}</p>`;
}

/** Trend arrow in CSS: the embedded Latin fonts have no triangle (▲ fell back
 * to FreeSans, embedded as Type 3). */
const arrow = (dir: 'up' | 'down', label: string | number) =>
  `<span class="trend trend-${dir}"><span class="tri"></span>${label}</span>`;

function trend(cwe: CweData): string {
  if (cwe.trend === 'up' || cwe.trend === 'down')
    return arrow(cwe.trend, Math.abs(cwe.trendChange));
  return '<span class="trend trend-flat">—</span>';
}

function countPill(n: number, severity: Severity): string {
  if (n === 0) return '<span class="count-zero">0</span>';
  const c = severityColors(severity);
  return `<span class="count-pill" style="background: ${c.bg}; color: ${c.fg};">${n}</span>`;
}

// ── model ──────────────────────────────────────────────────────────────────

interface Category {
  cwe: CweData;
  open: MappedVulnerability[];
  triaged: MappedVulnerability[];
}

interface Model {
  data: CweReportData;
  detailed: boolean;
  /** The rendering is the dashboard preview (HTML format), not the PDF. */
  preview: boolean;
  categories: Category[];
  open: MappedVulnerability[];
  triaged: MappedVulnerability[];
  projectOpen: number;
  /** First folder common to every path (repository root), or ''. */
  prefix: string;
  /** Single manifest of the dependencies shown (named once), or ''. */
  manifest: string;
  /** Single image of the open image findings (named once), or ''. */
  image: string;
  /** At least one open finding has an analysis (agent or review): every
   * occurrence table then keeps the same Verdict column. */
  analysed: boolean;
  /** State shared by every open dependency finding, otherwise ''. */
  advisoryState: string;
  /** « Cybe Analysis » boxes and triage lines printed (detailed report): page 1
   * and « About » count them. */
  cybe: CybeTally;
  /** Prints the analyses the findings carry (none without an extension). */
  analysis: ReportAnalysisRenderer;
}

interface CybeTally {
  /** Distinct open findings under a box: a finding ranked under two weaknesses
   * has a box under each, counted once. */
  covered: number;
  /** At least one triage line is printed. */
  triage: boolean;
  /** At least one box links to the full analysis in CybeDefend. */
  links: boolean;
  /** What each box shows, and what at least one shows. Page 1 promises only
   * what all of them show; About says the rest « when » the analysis gives it. */
  every: ReportAnalysisParts;
  some: ReportAnalysisParts;
  /** A box gives the verdict of its analysis, its finding showing none from the
   * agent. */
  analysisVerdict: boolean;
}

function uniqueById(items: MappedVulnerability[]): MappedVulnerability[] {
  return Array.from(new Map(items.map((v) => [v.id, v])).values());
}

function commonRoot(paths: string[]): string {
  const roots = new Set(
    paths.map((p) => (p.includes('/') ? p.split('/')[0] : '')),
  );
  const [root] = Array.from(roots);
  return roots.size === 1 && root ? `${root}/` : '';
}

function buildModel(
  data: CweReportData,
  detailed: boolean,
  preview: boolean,
  analysis: ReportAnalysisRenderer,
): Model {
  const categories = (data.cweCategories ?? [])
    .map((c) => ({
      cwe: reference(c.cweData),
      open: c.vulnerabilities.filter((v) => isActiveState(v.state)),
      triaged: c.vulnerabilities.filter((v) => !isActiveState(v.state)),
    }))
    .sort((a, b) => a.cwe.rank - b.cwe.rank);
  const open = uniqueById(categories.flatMap((c) => c.open));
  const triaged = uniqueById(categories.flatMap((c) => c.triaged));
  const paths = [...open, ...triaged]
    .flatMap((v) => [v.path, v.manifest])
    .filter(Boolean);
  const prefix = paths.length ? commonRoot(paths) : '';
  const manifests = new Set(
    open.filter((v) => v.type === 'sca').map((v) => v.manifest ?? ''),
  );
  const [only] = Array.from(manifests);
  const images = new Set(
    open.filter((v) => v.type === 'container').map((v) => v.image ?? ''),
  );
  const [image] = Array.from(images);
  const advisoryStates = new Set(open.filter(isAdvisory).map(stateOf));
  const model: Model = {
    data,
    detailed,
    preview,
    categories,
    open,
    triaged,
    projectOpen:
      data.summary?.openFindings ??
      (data.vulnerabilities ?? []).filter((v) => isActiveState(v.state)).length,
    prefix,
    manifest: manifests.size === 1 && only ? stripPrefix(prefix, only) : '',
    image: images.size === 1 && image ? image : '',
    analysed: open.some(hasAnalysis),
    advisoryState:
      advisoryStates.size === 1 ? Array.from(advisoryStates)[0] : '',
    cybe: {
      covered: 0,
      triage: false,
      links: false,
      every: analysis.noBriefParts,
      some: analysis.noBriefParts,
      analysisVerdict: false,
    },
    analysis,
  };
  // The summary (without reasoning) prints no analysis.
  if (detailed) model.cybe = cybeTally(model);
  return model;
}

const stripPrefix = (prefix: string, path: string) =>
  prefix && path.startsWith(prefix) ? path.slice(prefix.length) : path;
const relative = (m: Model, path: string) => stripPrefix(m.prefix, path);

// ── grouping ───────────────────────────────────────────────────────────────

interface Group {
  type: FindingType;
  title: string;
  description: string;
  severity: Severity;
  items: MappedVulnerability[];
}

/** A package row of an advisory table: package, version, image. */
const packageLineKey = (v: MappedVulnerability) =>
  `${v.packageName}@${v.packageVersion}|${v.image ?? ''}`;
/** The package versions an advisory group affects. */
const packageSet = (items: MappedVulnerability[]) =>
  Array.from(new Set(items.map(packageLineKey)))
    .sort()
    .join(',');
const lowerTitle = (g: Group) => String(g.title ?? '').toLowerCase();
/** First package (alphabetical order) of an advisory group; '' for a code
 * finding. */
const leadPackage = (g: Group) =>
  isAdvisory(g.items[0])
    ? (g.items.map((v) => String(v.packageName ?? '')).sort()[0] ?? '')
    : '';

/**
 * Identical findings grouped: same rule (title, severity, description) for
 * code; same advisory for dependencies, then the advisories a reader cannot
 * tell apart (same title, case ignored, same severity, same package versions)
 * merged: each package row then counts as one finding per identifier.
 * Advisories of the same title that affect other versions stay on separate,
 * adjacent rows.
 */
function groupFindings(items: MappedVulnerability[]): Group[] {
  const groups = groupBy(items, (v) =>
    isAdvisory(v)
      ? `${v.type}|${advisoryKey(v)}`
      : `${v.type}|${v.name}|${severityOf(v)}|${v.description}`,
  ).map(({ items: list }) => ({
    type: list[0].type,
    title: list[0].name,
    description: list[0].description,
    severity: maxSeverity(list),
    items: list,
  }));
  const merged = groupBy(groups, (g) =>
    isAdvisory(g.items[0])
      ? `${g.type}|${lowerTitle(g)}|${g.severity}|${packageSet(g.items)}`
      : `${g.type}|${g.title}|${g.severity}|${g.description}`,
  ).map(({ items: same }) => ({
    ...same[0],
    items: same.flatMap((g) => g.items),
  }));
  // Within a severity, the advisories of one package follow each other (what to
  // upgrade reads at a glance); rows of the same title stay adjacent, weighed
  // together.
  const familyOf = (g: Group) => `${g.type}|${g.severity}|${lowerTitle(g)}`;
  const family = new Map<string, number>();
  for (const g of merged)
    family.set(familyOf(g), (family.get(familyOf(g)) ?? 0) + g.items.length);
  return merged.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      leadPackage(a).localeCompare(leadPackage(b)) ||
      family.get(familyOf(b)) - family.get(familyOf(a)) ||
      lowerTitle(a).localeCompare(lowerTitle(b)) ||
      b.items.length - a.items.length,
  );
}

const stateRank = (v: MappedVulnerability) => STATE_RANK[stateOf(v)] ?? 3;
const compareOccurrences = (a: MappedVulnerability, b: MappedVulnerability) =>
  stateRank(a) - stateRank(b) ||
  String(a.path ?? a.packageName ?? '').localeCompare(
    String(b.path ?? b.packageName ?? ''),
  ) ||
  byVersion(String(a.packageVersion ?? ''), String(b.packageVersion ?? '')) ||
  startOf(a.line) - startOf(b.line);

// ── cover & executive summary ──────────────────────────────────────────────

const scanMetaOf = (m: Model): ScanMetadata =>
  m.data.scanMetadata ?? { projectId: m.data.projectId };

/** Cover metadata: project, branch, date, scope. */
function coverMeta(m: Model, meta: ScanMetadata): CoverMeta[] {
  const scanned = (Object.keys(SCOPE_LABELS) as FindingType[]).filter(
    (t) => (m.data.summary?.byType?.[t] ?? 0) > 0,
  );
  return [
    {
      label: 'Project',
      value: meta.projectName || meta.projectId,
      sub: meta.projectName ? meta.projectId : undefined,
    },
    { label: 'Branch', value: meta.branch || 'All branches' },
    { label: 'Generated', value: formatReportDate(m.data.generatedAt) },
    {
      label: 'Scope',
      value: (scanned.length
        ? scanned
        : (Object.keys(SCOPE_LABELS) as FindingType[])
      )
        .map((t) => SCOPE_LABELS[t])
        .join(', '),
    },
  ];
}

function cover(m: Model): string {
  return renderCover({
    eyebrow: `CWE Top 25 · ${EDITION}`,
    title: TITLE,
    subtitle:
      'Open findings mapped to MITRE\u2019s list of the 25 most dangerous software weaknesses',
    meta: coverMeta(m, scanMetaOf(m)),
  });
}

/** Bars of the weakness chart, at most and at least. */
const BARS = 8;
const MIN_BARS = 4;
/** Height (px) of a bar, measured in the PDF. */
const BAR_PX = 23.5;
/** Line of a key finding: width of its text in the panel and height (px). */
const FACT_WIDTH_PX = 641;
const FACT_LINE_PX = 17.25;

/** Displayed text of each `<span class="…">` of a class, its nested spans
 * included. */
function spanTexts(html: string, className: string): string[] {
  const open = `<span class="${className}">`;
  const texts: string[] = [];
  for (let at = html.indexOf(open); at >= 0; at = html.indexOf(open, at + 1)) {
    const tags = /<\/?span\b[^>]*>/g;
    tags.lastIndex = at + open.length;
    let depth = 1;
    let end = html.length;
    for (let tag = tags.exec(html); tag; tag = tags.exec(html)) {
      depth += tag[0].startsWith('</') ? -1 : 1;
      if (!depth) {
        end = tag.index;
        break;
      }
    }
    texts.push(shownText(html.slice(at + open.length, end)));
  }
  return texts;
}

/**
 * What long identifiers add to page 1 (px): the cover grid taller than for a
 * project and a branch with short names (coverMetaHeight), and one line per
 * key finding that cites a long identifier (package, file) for its characters
 * beyond LONG_ID_CHARS.
 */
function identifierGrowth(m: Model, facts: string[]): number {
  const meta = scanMetaOf(m);
  const cover =
    coverMetaHeight(coverMeta(m, meta)) -
    coverMetaHeight(
      coverMeta(m, {
        ...meta,
        projectName: meta.projectName && 'project',
        branch: meta.branch && 'main',
      }),
    );
  const factLines = facts.reduce((lines, fact) => {
    const extra = [
      ...spanTexts(fact, 'mono is-long'),
      ...spanTexts(fact, 'path'),
    ].reduce(
      (px, id) => px + Math.max(0, id.length - LONG_ID_CHARS) * CHIP_CHAR_PX,
      0,
    );
    return lines + Math.ceil(extra / FACT_WIDTH_PX);
  }, 0);
  return Math.max(0, cover) + factLines * FACT_LINE_PX;
}

const weaknessName = (c: Category) =>
  `#${c.cwe.rank} ${cweIds([c.cwe.id])} ${escapeHtml(shortName(c.cwe))} (${plural(c.open.length, 'finding')})`;

/** Path a key finding cites in full: beyond it (a path that would take half a
 * line of the panel), it cites its file alone, the full path being in the
 * Location table. */
const FACT_PATH_CHARS = 48;

/** `contributions.js:32` in a key finding: a short path keeps its markup; a
 * longer one flows in the sentence, breakable before its separators, with no
 * inline block that Chromium would separate from the parentheses around it. */
const factLocation = (m: Model, v: MappedVulnerability) => {
  const path = redactSecrets(relative(m, v.path ?? ''));
  const cited =
    path.length > FACT_PATH_CHARS
      ? path.slice(path.lastIndexOf('/') + 1)
      : path;
  const place = isLongId(cited)
    ? `<span class="path">${breakableId(cited)}</span>`
    : pathText(cited);
  return `${place}<span class="loc-line">${lineOf(v.line)}</span>`;
};

/** « Arbitrary Code Execution in underscore (underscore@1.9.1) »: package or
 * location in mono, as in the tables. */
const findingName = (m: Model, v: MappedVulnerability) =>
  `${title(v.name)} (${isAdvisory(v) ? packageText(v.packageName ?? 'package', v.packageVersion) : factLocation(m, v)})`;

/** Analysis verdicts kept, in words, and the findings named when they are few. */
function exploitedWords(m: Model, items: MappedVulnerability[]): string {
  const verdicts = new Set(items.map((v) => v.exploitability.verdict));
  const words =
    verdicts.size > 1
      ? 'proven or actively exploited'
      : verdicts.has('actively_exploited')
        ? 'actively exploited'
        : 'proven exploitable';
  const names =
    items.length <= 2
      ? `: ${items.map((v) => findingName(m, v)).join('; ')}`
      : '';
  return `${words}${names}`;
}

/** State in words of the findings of the worst severity. */
function worstStates(items: MappedVulnerability[]): string {
  const confirmed = items.filter((v) => stateOf(v) === 'confirmed').length;
  if (confirmed === items.length)
    return items.length > 1 ? 'all confirmed' : 'confirmed';
  if (confirmed) return `${confirmed} of them confirmed`;
  if (items.every((v) => stateOf(v) === 'to_verify'))
    return items.length > 1
      ? 'all still to be verified'
      : 'still to be verified';
  return 'none confirmed yet';
}

/** Findings confirmed in review under the worst severity, named. */
function confirmedFact(m: Model, worst: Severity): string {
  const lower = m.open.filter(
    (v) => stateOf(v) === 'confirmed' && severityOf(v) !== worst,
  );
  if (!lower.length) return '';
  const all = groupFindings(lower);
  const groups = all.slice(0, 3);
  // Once one name carries a count, all of them do: « X and Y (2 occurrences) »
  // would read as two occurrences each.
  const counted = groups.some((g) => g.items.length > 1);
  const names = groups.map(
    (g) =>
      `${title(g.title)}${counted ? ` (${plural(g.items.length, 'occurrence')})` : ''}`,
  );
  const rest = all.length - names.length;
  const atWorst = m.open.some(
    (v) => stateOf(v) === 'confirmed' && severityOf(v) === worst,
  );
  const who = atWorst
    ? `${plural(lower.length, 'lower-severity finding')} also confirmed by review`
    : `${plural(lower.length, 'finding')} confirmed by review`;
  return `${who} (${severityBreakdown(lower)}): ${listJoin([...names, ...(rest ? [`${rest} more`] : [])])}.`;
}

/** Sources of the findings and share of development dependencies. */
function sourceFact(m: Model): string {
  const byType = (Object.keys(TYPE_NAMES) as FindingType[])
    .map((t) => ({ t, n: m.open.filter((v) => v.type === t).length }))
    .filter((x) => x.n > 0);
  const deps = m.open.filter((v) => v.type === 'sca');
  const dev = deps.filter((v) => v.devDependency).length;
  const devWords = !dev
    ? ''
    : dev === deps.length
      ? `all ${plural(deps.length, 'dependency finding')} ${deps.length === 1 ? 'is in a development dependency' : 'are in development dependencies'}, not shipped to production`
      : `${dev} of the ${deps.length} dependency findings ${dev === 1 ? 'is in a development dependency' : 'are in development dependencies'}, not shipped to production`;
  if (byType.length > 1) {
    const sources = `By source: ${listJoin(byType.map((x) => `${x.n} from ${TYPE_NAMES[x.t]}`))}`;
    return `${sources}${devWords ? `; ${devWords}` : ''}.`;
  }
  return devWords
    ? `${devWords.charAt(0).toUpperCase()}${devWords.slice(1)}.`
    : '';
}

function facts(m: Model): string[] {
  const out: string[] = [];
  const hit = m.categories.filter((c) => c.open.length > 0);
  const top = hit[0];
  const frequent = [...hit].sort(
    (a, b) => b.open.length - a.open.length || a.cwe.rank - b.cwe.rank,
  )[0];
  out.push(
    `Highest-ranked weakness found: ${weaknessName(top)}${frequent !== top && frequent.open.length > top.open.length ? `; most frequent: ${weaknessName(frequent)}` : ''}.`,
  );

  const worst = SEVERITIES.find((s) => m.open.some((v) => severityOf(v) === s));
  if (worst) {
    const items = m.open.filter((v) => severityOf(v) === worst);
    const hot = items.filter(isExploited);
    const rated = hot.length
      ? `; AI analysis rates ${hot.length === 1 && items.length === 1 ? 'it' : `${hot.length} of them`} ${exploitedWords(m, hot)}`
      : '';
    out.push(
      `${plural(items.length, `${worst} finding`)}, ${worstStates(items)}${rated}.`,
    );
    const confirmed = confirmedFact(m, worst);
    if (confirmed) out.push(confirmed);
  }
  const others = m.open
    .filter(isExploited)
    .filter((v) => severityOf(v) !== worst);
  if (others.length) {
    out.push(
      `AI analysis also rates ${plural(others.length, 'other finding')} ${exploitedWords(m, others)}.`,
    );
  }
  const source = sourceFact(m);
  if (source) out.push(source);
  // The boxes are counted in the AI key finding, without one more bullet;
  // beyond four key findings, the sentence would overflow page 1. No number of
  // the key findings is in bold: it would outweigh the criticals it follows.
  const briefs = m.cybe.covered;
  if (briefs > 0 && out.length <= 4) {
    const rated = out.findIndex((f) => f.includes('AI analysis rates'));
    const at =
      rated >= 0
        ? rated
        : out.findIndex((f) => f.includes('AI analysis also rates'));
    if (at >= 0)
      out[at] +=
        ` ${briefs} open finding${briefs === 1 ? ' carries' : 's carry'} a Cybe Analysis brief${m.analysis.briefContent(m.cybe.every)}.`;
  }
  return out;
}

const UNMAPPED_NAMES: Record<FindingType, string> = {
  sast: 'code',
  iac: 'infrastructure',
  sca: 'dependency',
  container: 'container',
};

/**
 * The project scope, apart from the tiles (which count only the Top 25): open
 * findings, Top 25 share, other CWEs, findings without CWE, triaged excluded.
 */
function scopeNote(m: Model): string {
  const openAll = (m.data.vulnerabilities ?? []).filter((v) =>
    isActiveState(v.state),
  );
  const others = openAll.filter(
    (v) => (v.cwe ?? []).length && !top25Of(v).length,
  ).length;
  const unmapped = openAll.filter((v) => !(v.cwe ?? []).length);
  const sentences = [
    `<strong>Whole project</strong> · ${plural(m.projectOpen, 'open finding')} across all scan types.`,
  ];
  if (m.projectOpen) {
    const share = (m.open.length / m.projectOpen) * 100;
    const pct = share > 0 && share < 1 ? '&lt;1%' : `${Math.round(share)}%`;
    const elsewhere = others ? `, ${others} to other CWEs` : '';
    sentences.push(
      m.open.length
        ? `${m.open.length} of them (${pct}) ${m.open.length === 1 ? 'maps' : 'map'} to a Top 25 weakness${elsewhere}.`
        : `None of them maps to a Top 25 weakness${others ? `; ${others} map to other CWEs` : ''}.`,
    );
  }
  if (unmapped.length) {
    const byType = (Object.keys(UNMAPPED_NAMES) as FindingType[])
      .map((t) => ({ t, n: unmapped.filter((v) => v.type === t).length }))
      .filter((x) => x.n > 0)
      .sort((a, b) => b.n - a.n)
      .map((x) => `${x.n} ${UNMAPPED_NAMES[x.t]}`)
      .join(', ');
    sentences.push(
      `${unmapped.length} ${unmapped.length === 1 ? 'carries' : 'carry'} no CWE identifier (${byType}) and cannot be classified.`,
    );
  }
  if (m.triaged.length) {
    // The end of the report lists only the critical and high triaged findings.
    const listed = m.triaged.filter(isListedTriage).length;
    const where =
      listed === m.triaged.length
        ? ' and listed at the end'
        : listed
          ? '; the critical and high ones are listed at the end'
          : ' and counted at the end';
    sentences.push(
      `${m.triaged.length === 1 ? '1 triaged Top 25 finding is' : `${m.triaged.length} triaged Top 25 findings are`} excluded from all figures${where}.`,
    );
  }
  return `<p class="scope-note">${sentences.join(' ')}</p>`;
}

/** Findings counted under several weaknesses: why the bars total more than the
 * tile. */
function multiMappedNote(m: Model): string {
  const multi = m.open.filter((v) => top25Of(v).length > 1);
  if (!multi.length) return '';
  const two = multi.every((v) => top25Of(v).length === 2);
  return multi.length === 1
    ? `1 finding maps to ${two ? 'two' : 'several'} weaknesses and counts in each bar.`
    : `${multi.length} findings map to ${two ? 'two' : 'several'} weaknesses and count in each bar.`;
}

function summarySection(m: Model): string {
  const counts = Object.fromEntries(
    [...SEVERITIES, 'unknown'].map((s) => [
      s,
      m.open.filter((v) => severityOf(v) === s).length,
    ]),
  ) as Record<Severity, number>;
  const affected = m.categories.filter((c) => c.open.length > 0);
  const tiles = kpiTiles(
    [
      {
        label: 'Top 25 findings',
        value: m.open.length,
        caption: `in ${affected.length} of ${TOP25_SIZE} weaknesses`,
      },
      ...SEVERITIES.map((s) => ({
        label: severityLabel(s),
        value: counts[s],
        severity: s,
      })),
      ...(counts.unknown > 0
        ? [
            {
              label: severityLabel('unknown'),
              value: counts.unknown,
              severity: 'unknown',
            },
          ]
        : []),
    ],
    { leadWidth: 1.6 },
  );

  // Long identifiers lengthen page 1 (cover, key findings): the chart gives
  // that room back, bar by bar, so that the key findings do not move alone to
  // page 2; the coverage table lists every weakness.
  const keyFactList = m.open.length ? facts(m) : [];
  const barCount = Math.max(
    MIN_BARS,
    BARS - Math.ceil(identifierGrowth(m, keyFactList) / BAR_PX),
  );
  const more =
    affected.length > barCount
      ? `${affected.length - barCount} more in the coverage table.`
      : '';
  const notes = [more, multiMappedNote(m)].filter(Boolean).join(' ');
  const bars = horizontalBars(
    [...affected]
      .sort((a, b) => b.open.length - a.open.length || a.cwe.rank - b.cwe.rank)
      .slice(0, barCount)
      .map((c) => ({
        id: c.cwe.id,
        label: shortName(c.cwe),
        value: c.open.length,
        color: COLORS.accent,
      })),
    { labelWidth: '186px' },
  );

  const body = m.open.length
    ? `<div class="grid-2 charts">
  <div class="panel"><div class="panel-title">Top 25 findings by severity</div>${donutChart(
    [...SEVERITIES, ...(counts.unknown ? ['unknown' as Severity] : [])].map(
      (s) => ({
        label: severityLabel(s),
        value: counts[s],
        color: severityColors(s).solid,
      }),
    ),
    { centerLabel: 'findings' },
  )}</div>
  <div class="panel"><div class="panel-title">Weaknesses found</div>${bars}${notes ? `<p class="small panel-note">${notes}</p>` : ''}</div>
</div>
${keyFacts('Key facts', keyFactList)}`
    : emptyState(
        'No CWE Top 25 weakness was found in the open findings of this project.',
      );

  return `<section class="section summary" id="summary">
${sectionHead({ eyebrow: 'Overview', title: 'Executive summary' })}
${tiles}
${scopeNote(m)}
${body}
</section>`;
}

// ── coverage table ─────────────────────────────────────────────────────────

function coverageSection(m: Model): string {
  const byId = new Map(m.categories.map((c) => [c.cwe.id, c]));
  const rows = Object.values(CWE_TOP_25_2024_DATA)
    .sort((a, b) => a.rank - b.rank)
    .map((cwe) => {
      const open = byId.get(cwe.id)?.open ?? [];
      return [
        `<span class="num">${cwe.rank}</span>`,
        `<span class="mono cwe-id">${cwe.id}</span>`,
        `<span class="weakness">${escapeHtml(cwe.name)}</span>`,
        countPill(open.length, maxSeverity(open)),
        trend(cwe),
        `<span class="num">${cwe.kevCount}</span>`,
      ];
    });
  const columns: TableColumn[] = [
    { label: 'Rank', width: '7%', align: 'right' },
    { label: 'CWE', width: '11%', className: 'nowrap' },
    { label: 'Weakness' },
    { label: 'Findings', width: '11%', align: 'right' },
    { label: 'vs 2023', width: '10%', align: 'right', className: 'nowrap' },
    { label: 'KEV', width: '7%', align: 'right' },
  ];
  const found = m.categories.filter((c) => c.open.length > 0).length;
  // With findings, the summary fills page 1: the table starts on a page of its
  // own, never split across two pages.
  const cls = m.open.length ? 'section page-start' : 'section';
  return `<section class="${cls}" id="coverage">
${sectionHead({ eyebrow: 'Ranking', title: 'Top 25 coverage', aside: `${found} of ${TOP25_SIZE} weaknesses found` })}
${dataTable({ columns, rows, className: 'coverage' })}
<p class="table-note"><strong>Findings</strong>: open findings mapped to the weakness, tinted by their highest severity; a finding mapped to two weaknesses counts in both. <strong>vs&nbsp;2023</strong>: move in MITRE\u2019s ranking since the 2023 list, ${arrow('up', 'climbed')} (more dangerous), ${arrow('down', 'fell')} or <span class="trend trend-flat">—</span> unchanged. <strong>KEV</strong>: CVEs of the weakness listed in CISA\u2019s Known Exploited Vulnerabilities catalog. Rank, vs&nbsp;2023 and KEV are MITRE and CISA reference data, not results of this project.</p>
</section>`;
}

// ── findings by weakness ───────────────────────────────────────────────────

/** `routes/a.js:32`: relative path breakable at each `/`, then the line. A long
 * file name is an inline block (pathText) that Chromium would separate from
 * what follows: its line number goes inside it, rather than opening the next
 * line alone. */
const codeLocation = (m: Model, v: MappedVulnerability) => {
  const path = redactSecrets(relative(m, v.path ?? ''));
  const line = lineOf(v.line);
  const file = joinShortPieces(path.split(/(?=\/)/)).pop() ?? '';
  return line && isLongId(path) && isLongId(file)
    ? pathText(path, { after: line })
    : `${pathText(path)}<span class="loc-line">${line}</span>`;
};

/** « also under CWE-94 »: the other Top 25 weaknesses of the findings. */
function alsoUnder(items: MappedVulnerability[], cwe: CweData): string {
  const others = Array.from(
    new Set(items.flatMap(top25Of).filter((id) => id !== cwe.id)),
  );
  return others.length ? `also under ${cweIds(others)}` : '';
}

const analyst = (v: MappedVulnerability) =>
  v.exploitability.source === 'manual' ? 'Reviewer' : 'AI analysis';

const reasonHtml = (v: MappedVulnerability) =>
  v.exploitability?.reason
    ? `<span class="ai-reason">${clampedHtml(v.exploitability.reason, REASON_MAX, true)}</span>`
    : '';

/** Verdict (shared pill) and confidence. */
function verdict(v: MappedVulnerability): string {
  if (!hasAnalysis(v)) return '<span class="muted">—</span>';
  const score = scorePct(v.exploitability.score);
  return `${verdictPill(v.exploitability.verdict)}${score ? `<span class="score num">${score}</span>` : ''}`;
}

/** Reasoning of an occurrence, full width under its row. */
function occurrenceNote(v: MappedVulnerability): string {
  if (!hasAnalysis(v) || !v.exploitability.reason) return '';
  return `<div class="ai-note"><span class="ai-who">${analyst(v)}</span>${reasonHtml(v)}</div>`;
}

type Row = string[] | { full: string; className?: string; attach?: boolean };

// ── Cybe Analysis ──────────────────────────────────────────────────────────

/** Location of an occurrence as the report prints it
 * (`app/routes/contributions.js:32`, `bson@1.0.9`). */
const printedLocation = (m: Model, v: MappedVulnerability) =>
  isAdvisory(v)
    ? packageOf(v)
    : `${redactSecrets(relative(m, v.path ?? ''))}${lineOf(v.line)}`;

/** What the report already prints of a block: title, description, locations or
 * packages, identifiers. The brief does not repeat it. */
function knownOf(
  m: Model,
  block: { title: string; description: string; items: MappedVulnerability[] },
): string {
  return plainText(
    [
      block.title,
      block.description,
      ...block.items.map((v) => printedLocation(m, v)),
      ...block.items.flatMap((v) => [v.advisoryId, v.cve, ...(v.cwe ?? [])]),
    ]
      .filter(Boolean)
      .join('\n'),
  );
}

/** Occurrences of a block that carry a recognised Cybe Analysis, in print
 * order. */
function analysedIn(m: Model, items: MappedVulnerability[]) {
  return items
    .map((v) => ({
      v,
      source: m.analysis.briefSource(v, printedLocation(m, v)),
    }))
    .filter(
      (x): x is { v: MappedVulnerability; source: ReportAnalysisSource } =>
        Boolean(x.source),
    );
}

/** The box of a rule or advisory block, and what it covers. */
interface CybePlan {
  brief: ReportAnalysisBrief;
  /** Occurrences whose box replaces the agent's note; the note of a manual
   * review stays, printed before the box. */
  covered: Set<MappedVulnerability>;
  /** Detections under the box (the count of page 1 and of « About »). */
  ids: string[];
  /** Occurrence after which the box is printed: the last one analysed. */
  last: MappedVulnerability;
  /** Its head carries the verdict of its analysis: no occurrence shows one from
   * the agent. */
  analysisVerdict: boolean;
}

/**
 * One box per block: it covers every analysed occurrence of the block. Nothing
 * in the summary, nor without a recognised analysis, nor when the analysis has
 * neither « Why it matters » nor a step: the block then keeps its short notes.
 * Advisory: compact variant, scope in packages, verdict in the head (advisory
 * rows have no Verdict column). Code: the head carries the verdict only when
 * the Verdict column does not show it. The shared base does the rest, as for
 * the other reports: a WHY that does not repeat the facts printed under it, at
 * full budget even when compact (the sentence that tempers bson, « not code
 * execution », is not dropped), the most exposed reach of the occurrences,
 * with no « Consider… » step that repeats another one. `estimatedHeight` is
 * not read back: the tables of this report paginate by row group (tbody.unit).
 */
function cybePlan(m: Model, g: Group, advisory: boolean): CybePlan | null {
  if (!m.detailed) return null;
  const items = [...g.items].sort(compareOccurrences);
  const found = analysedIn(m, items);
  if (!found.length) return null;
  const covered = found
    .map((x) => x.v)
    .filter((v) => v.exploitability?.source !== 'manual');
  const brief = m.analysis.buildBrief(
    found.map((x) => x.source),
    {
      title: redactSecrets(g.title),
      known: knownOf(m, { ...g, items }),
      occurrences: items.length,
      unit: advisory ? 'package' : 'occurrence',
      compact: advisory,
      withPill: advisory || !(m.analysed && covered.every(hasAnalysis)),
    },
  );
  if (!brief) return null;
  return {
    brief,
    covered: new Set(covered),
    ids: found.map((x) => x.v.id),
    last: found[found.length - 1].v,
    analysisVerdict: !!brief.pill && found.every((x) => !x.source.agentVerdict),
  };
}

/** Full-width row of the box, in the unbreakable row group of the last analysed
 * occurrence. */
const cybeRow = (m: Model, plan: CybePlan, advisory: boolean): Row => ({
  full: m.analysis.card(plan.brief, {
    compact: advisory,
    confidenceWord: false,
  }),
  className: advisory ? 'adv-note ca-row' : 'ca-row',
  attach: true,
});

const timeOf = (s: ReportAnalysisSource) => {
  const t = Date.parse(s.pinned.date);
  return Number.isNaN(t) ? -Infinity : t;
};

/**
 * Why a critical or high finding was dismissed, under its row in the triaged
 * list: the most recent analysis of the row. A package row that carries
 * several advisories names the one that was analysed.
 */
function triageLine(m: Model, items: MappedVulnerability[]): string {
  if (!m.detailed) return '';
  const found = analysedIn(m, items);
  if (!found.length) return '';
  const pick = found.reduce((a, x) =>
    timeOf(x.source) > timeOf(a.source) ? x : a,
  );
  const scopeId =
    isAdvisory(pick.v) && new Set(items.map(advisoryKey)).size > 1
      ? advisoryKey(pick.v)
      : null;
  const line = m.analysis.buildTriageLine([pick.source], {
    scopeId,
    title: redactSecrets(pick.v.name),
    known: knownOf(m, {
      title: pick.v.name,
      description: pick.v.description,
      items,
    }),
  });
  return line ? m.analysis.triageLineHtml(line, scopeId) : '';
}

/** Grouped code findings of a weakness, then one advisory table per family
 * (dependencies, images). */
function weaknessGroups(c: Category): { code: Group[]; advisories: Group[][] } {
  return {
    code: groupFindings(c.open.filter((v) => !isAdvisory(v))),
    advisories: (['sca', 'container'] as FindingType[])
      .map((t) => groupFindings(c.open.filter((v) => v.type === t)))
      .filter((groups) => groups.length),
  };
}

/** What the report prints of analyses: the boxes of each weakness (a finding
 * ranked under two weaknesses counts once), and the triage lines. */
function cybeTally(m: Model): CybeTally {
  const covered = new Set<string>();
  const briefs: ReportAnalysisBrief[] = [];
  let analysisVerdict = false;
  for (const c of m.categories.filter((x) => x.open.length > 0)) {
    const { code, advisories } = weaknessGroups(c);
    const plans = [
      ...code.map((g) => cybePlan(m, g, false)),
      ...advisories.flat().map((g) => cybePlan(m, g, true)),
    ].filter(Boolean);
    for (const plan of plans) {
      plan.ids.forEach((id) => covered.add(id));
      briefs.push(plan.brief);
      analysisVerdict = analysisVerdict || plan.analysisVerdict;
    }
  }
  return {
    covered: covered.size,
    links: briefs.some((b) => !!b.url),
    triage: listedTriagedRows(m).some((r) => !!triageLine(m, r.items)),
    every: m.analysis.briefParts(briefs, 'every'),
    some: m.analysis.briefParts(briefs, 'some'),
    analysisVerdict,
  };
}

/** Occurrences of a code finding: location, state, verdict. */
function occurrenceTable(m: Model, cwe: CweData, g: Group): string {
  const items = [...g.items].sort(compareOccurrences);
  const plan = cybePlan(m, g, false);
  const columns: TableColumn[] = [
    { label: 'Location' },
    { label: 'State', width: stateColumn(items.map(stateOf), 0.14).width },
    ...(m.analysed ? [{ label: 'Verdict', width: '19%' }] : []),
  ];
  const rows: Row[] = [];
  for (const v of items) {
    rows.push([
      codeLocation(m, v),
      stateLabel(v.state),
      ...(m.analysed ? [verdict(v)] : []),
    ]);
    const note = m.detailed && !plan?.covered.has(v) ? occurrenceNote(v) : '';
    if (note) rows.push({ full: note, attach: true });
    if (v === plan?.last) rows.push(cybeRow(m, plan, false));
  }
  return dataTable({
    columns,
    rows,
    className: 'occurrences',
    continuation: `${cwe.id} · ${plainTitle(g.title)} (continued)`,
  });
}

/**
 * Identical code findings: one description, their occurrences. The description
 * flows freely from one page to the next (its last lines stay with the table);
 * a small empty block covers the table's continuation row (a block that covers
 * it never breaks).
 */
function groupBlock(m: Model, cwe: CweData, g: Group): string {
  const also = alsoUnder(g.items, cwe);
  const description =
    m.detailed && g.description
      ? `<div class="fgroup-desc">${clampedHtml(g.description, DESCRIPTION_MAX)}</div>
<div class="cont-cover desc-cover"></div>`
      : '';
  return `<div class="fgroup">
<div class="fgroup-head${description ? '' : ' cont-cover'}">${severityBadge(g.severity)}<span class="fgroup-title">${title(g.title)}</span>${typeBadge(g.type)}<span class="fgroup-count">${plural(g.items.length, 'occurrence')}</span>${also ? `<span class="fgroup-count">${also}</span>` : ''}</div>
${description}
${occurrenceTable(m, cwe, g)}
</div>`;
}

/** Stacked cells; `heights` (in chip lines) aligns each line with its
 * neighbours in the other columns when a chip wraps, in the PDF; `narrow`, in
 * a narrower preview (see PREVIEW_PAGE_PX), when it differs there. */
const lines = (
  cells: string[],
  heights: number[] = [],
  narrow: number[] = [],
) =>
  cells
    .map((c, i) => {
      const h = heights[i] ?? 1;
      const n = narrow[i] ?? h;
      const style = [
        h > 1 ? `--lines: ${h}` : '',
        n !== h ? `--lines-narrow: ${n}` : '',
      ].filter(Boolean);
      return `<div class="line"${style.length ? ` style="${style.join('; ')}"` : ''}>${c}</div>`;
    })
    .join('');

/**
 * « ignored for underscore@1.8.3 »: the same advisories triaged for other
 * versions (triage applies to one package version).
 */
function triagedElsewhere(m: Model, g: Group): string {
  const ids = new Set(g.items.map(advisoryKey));
  const same = m.triaged.filter(
    (v) => v.type === g.type && ids.has(advisoryKey(v)),
  );
  if (!same.length) return '';
  const states = new Set(same.map(stateOf));
  const words = states.size === 1 ? stateHtml(stateOf(same[0])) : 'triaged';
  return packageVersions(`${words} for`, same);
}

/**
 * Analyses (agent or review) of an advisory, full width under its row:
 * verdicts are rare on dependencies, a dedicated column would be almost empty.
 * Several packages: each note names its own. A package covered by the row's
 * box has no note of its own.
 */
function advisoryNotes(
  m: Model,
  items: MappedVulnerability[],
  covered?: Set<MappedVulnerability>,
): Row[] {
  const noted = items.filter((v) => hasAnalysis(v) && !covered?.has(v));
  return noted.map((v) => {
    const who =
      items.length > 1
        ? `<span class="ai-pkg">${packageRefHtml(v.packageName ?? 'package', v.packageVersion)}</span>`
        : '';
    const reason = m.detailed ? reasonHtml(v) : '';
    return {
      full: `<div class="ai-note"><span class="ai-who">${analyst(v)}</span>${who}${verdict(v)}${reason ? `<span class="ai-sep">&#183;</span>${reason}` : ''}</div>`,
      className: 'adv-note',
      attach: true,
    };
  });
}

/** One line per package and version: the fixed version that closes every merged
 * advisory of the row (the epoch of a Debian version is never read as a major
 * version). */
function packageLines(items: MappedVulnerability[]) {
  return groupBy(items, packageLineKey).map(({ items: list }) => ({
    v: list[0],
    fixed: highestPackageVersion(list.map((i) => i.fixedVersion)),
  }));
}

// ── columns of a table of advisories ───────────────────────────────────────

/** Text column of a page (A4 within the PDF margins, and the preview), in CSS
 * px. */
const PAGE_PX = 688;
/** Text column of a dashboard preview narrower than the PDF: an 850 px iframe
 * (the modal), scroll bar included, i.e. (850 − 15 − 2 × 16) / 1.13 − 2 × 53
 * px. Its % columns are all the narrower there; below 950 px, the CSS aligns
 * the package rows on their height at this width. */
const PREVIEW_PAGE_PX = (850 - 15 - 32) / 1.13 - 106;
/** Preview window (px, its scroll bar included) whose text column is `text` px:
 * the sheet zoomed at 1.13, its margins (2 × 53 px), those of the page (2 × 16
 * px) and the bar (15 px). */
const previewWindow = (text: number) =>
  Math.ceil((text + 106) * 1.13 + 32 + 15);
/** Code chip: JetBrains Mono 10 px (6 px per character), 5 px of padding on
 * each side, 17 px per line (line height 1.7). */
const CHIP_CHAR_PX = 6;
const CHIP_PADDING_PX = 10;
const CHIP_LINE_PX = 17;
/** Padding of a cell (10 px on each side), and a margin for glyph rounding. */
const CELL_PADDING_PX = 20;
const FIT_SLACK_PX = 4;
/** « No fix » (Rubik 11 px, 28.4 px measured in the PDF) and the padding of its
 * cell: what Fixed in keeps at least in the narrow preview. */
const NO_FIX_PX = 50;
/** Page shares of the columns of an advisory table: Package and Fixed in widen
 * only beyond them, for chips that do not fit. */
const COLUMN_SHARE = {
  package: 0.26,
  packageWithState: 0.23,
  fixed: 0.12,
  state: 0.13,
};
/** Page share the Advisory column (title, identifiers, image) keeps when
 * Package and Fixed in widen. */
const ADVISORY_MIN = 0.36;
/** Share it never goes below, even for a shorter table (package chips taller
 * than its cell). */
const ADVISORY_FLOOR = 0.3;
/** Width (px) it does not go below even to fit a whole version: one line for an
 * identifier of LONG_ID_CHARS characters (its longest unbreakable piece, when
 * wider, raises it). Below that, the table no longer fits. */
const ADVISORY_HOLD_PX =
  LONG_ID_CHARS * CHIP_CHAR_PX + CELL_PADDING_PX + FIT_SLACK_PX;
/** Advisory cell, measured in the PDF: width of a space and of another
 * character (title in Rubik 11 px, weight 500; identifier line at 10 px, its
 * text in Rubik, its identifiers in code like a long reference on its line:
 * CHIP_CHAR_PX), height of a line (line height 1.5). */
const TITLE_CHAR_PX = 5.85;
const TITLE_SPACE_PX = 2.75;
const TITLE_LINE_PX = 16.5;
const IDS_TEXT_PX = 4.6;
const IDS_SPACE_PX = 2.45;
const IDS_LINE_PX = 15;
/** Gap between two stacked package rows. */
const LINE_GAP_PX = 3;

/** Width (px) of a state as stateLabel prints it (pill, gap and label in Rubik
 * 11 px), measured in the PDF. */
const STATE_LABEL_PX: Record<string, number> = {
  to_verify: 54.3,
  confirmed: 64,
  proposed_not_exploitable: 138.2,
  ignored: 50.4,
  resolved: 57.5,
  not_exploitable: 87.9,
};
/** Another state: estimated generously (pill and gap, 6.3 px per character). */
const stateLabelPx = (state: string) =>
  STATE_LABEL_PX[state] ?? 11 + state.length * 6.3;
/** State column of the triaged list, in px. */
const TRIAGED_STATE_PX = 96;

/**
 * State column: its page share (`share`, or `width` when given) as long as it
 * fits the longest of its labels, otherwise the width of that label («
 * Proposed not exploitable »): a state never overflows into the next column
 * (it is unbreakable, like every pill).
 */
function stateColumn(
  states: string[],
  share: number,
  width = `${Math.round(share * 100)}%`,
): { width: string; px: number } {
  const need = Math.ceil(
    widest(states.map(stateLabelPx)) + CELL_PADDING_PX + FIT_SLACK_PX,
  );
  return need <= share * PAGE_PX
    ? { width, px: share * PAGE_PX }
    : { width: `${need}px`, px: need };
}

/**
 * A part of a chip as the shared base marks it up (`packageChip`,
 * `versionChip`): one `seg` of a package chip, or the whole chip; its pieces
 * between two break points, in characters. A long part of a package chip is an
 * inline block: once broken, it takes the full width of the chip. An
 * unbreakable (short) part must never be wider than its column.
 */
interface ChipPart {
  pieces: number[];
  block: boolean;
  unbreakable: boolean;
  /** Part that carries a version (atomic), in characters: what its column fits
   * to keep it on one line (`whole`, versionColumnChars), and, when the table
   * does not allow it, its longest part (`part`), so that it breaks only
   * between its parts; 0: a part longer than VERSION_WHOLE_CHARS, which no
   * column fits. */
  hold?: { whole: number; part: number };
}

/** Displayed text of an HTML fragment, to measure it (an entity counts as one
 * character). */
const shownText = (html: string) =>
  html.replace(/<[^>]*>/g, '').replace(/&#?\w+;/g, '_');
const shownChars = (html: string) => shownText(html).length;

/** What a column fits of a version (see ChipPart.hold); `prefix`: the at sign
 * that opens it in a package chip. */
function versionHold(version: string, prefix = 0): ChipPart['hold'] {
  const holdable = (chars: number) =>
    chars <= VERSION_WHOLE_CHARS ? chars + prefix : 0;
  return {
    whole: holdable(versionColumnChars([version])),
    part: holdable(widest(versionPieces(version).map((p) => p.length))),
  };
}

/** Parts of a chip. `version`: the one it carries, in its last part (`@version`
 * of a package chip) or whole (fixed version). */
function chipParts(html: string, version?: string): ChipPart[] {
  const segs = Array.from(
    html.matchAll(/<span class="seg( is-long)?">(.*?)<\/span>/g),
  );
  const parts = segs.length
    ? segs.map((m) => ({ long: !!m[1], inner: m[2] }))
    : [
        {
          long: /code-chip (is-long|version)/.test(html),
          inner: html.replace(/^<span[^>]*>|<\/span>$/g, ''),
        },
      ];
  return parts.map(({ long, inner }, i) => {
    const part: ChipPart = {
      pieces: inner.split('<wbr>').map(shownChars),
      block: long && segs.length > 0,
      unbreakable: !long,
    };
    const last = i === parts.length - 1;
    if (version && last && !segs.length) part.hold = versionHold(version);
    if (version && last && shownText(inner) === `@${version}`)
      part.hold = versionHold(version, 1);
    return part;
  });
}

const widthOf = (part: ChipPart) => part.pieces.reduce((a, b) => a + b, 0);
const widest = (values: number[]) => Math.max(0, ...values);
/** Characters of a short chip (unbreakable, it never breaks); 0 for a long
 * chip, which breaks between its parts. */
const shortChipChars = (chip: ChipPart[]) =>
  chip.every((p) => p.unbreakable)
    ? chip.reduce((n, p) => n + widthOf(p), 0)
    : 0;

/** A run of pieces in `room` characters: broken at the last break point that
 * fits, a piece longer than a line anywhere. */
function wrap(pieces: number[], room: number): { lines: number; last: number } {
  let lines = 1;
  let used = 0;
  for (const piece of pieces) {
    if (used > 0 && used + piece > room) {
      lines += 1;
      used = 0;
    }
    used += piece;
    while (used > room) {
      lines += 1;
      used -= room;
    }
  }
  return { lines, last: used };
}

/** Lines a chip takes in `room` characters, and the length of the last one: a
 * part that does not fit after the previous one wraps, then breaks at its
 * break points when it is wider than a line. */
function chipLines(
  parts: ChipPart[],
  room: number,
): { lines: number; last: number } {
  let lines = 1;
  let used = 0;
  for (const part of parts) {
    const width = widthOf(part);
    if (used + width <= room) {
      used += width;
      continue;
    }
    if (used > 0) {
      lines += 1;
      used = 0;
    }
    if (width <= room) {
      used = width;
      continue;
    }
    const inner = wrap(part.pieces, room);
    lines += inner.lines - 1;
    used = part.block ? room : inner.last;
  }
  return { lines, last: used };
}

/** A package row of an advisory table: its chip, its « dev » tag, its fixed
 * version (null: none). */
interface PackageFit {
  chip: ChipPart[];
  dev: boolean;
  fixed: ChipPart[] | null;
}

/** Chip lines of a package row: its chip (its « dev » tag goes below when it
 * does not fit to its right) and its fixed version. */
function lineFit(line: PackageFit, pkgRoom: number, fixedRoom: number) {
  const chip = chipLines(line.chip, pkgRoom);
  const pkg = !line.dev
    ? chip.lines
    : chip.lines === 1 && chip.last + DEV_TAG_CHARS <= pkgRoom
      ? 1
      : chip.lines + 1;
  const fixed = line.fixed ? chipLines(line.fixed, fixedRoom).lines : 1;
  return { pkg, fixed };
}

/** Height of a package row, in chip lines: the taller of its chip and its fixed
 * version. */
function lineHeight(line: PackageFit, pkgRoom: number, fixedRoom: number) {
  const { pkg, fixed } = lineFit(line, pkgRoom, fixedRoom);
  return Math.max(pkg, fixed);
}

/** A piece of text of a cell and the width of its characters. */
interface TextRun {
  text: string;
  char: number;
}

/** What the Advisory cell of a row prints, as text: its title ('' for a
 * sub-row), its identifier line, its long references (one code line each), and
 * the width (px) of the longest unbreakable piece of its identifier line
 * (nowrapPx). */
interface AdvisoryText {
  title: string;
  ids: TextRun[];
  where: string[];
  nowrap: number;
}

/** Pieces of an identifier line: its identifiers in code (.mono), the rest as
 * text. */
const idLineRuns = (html: string): TextRun[] =>
  html.split(/(<span class="mono[^"]*">[\s\S]*?<\/span>)/).map((part, i) => ({
    text: shownText(part),
    char: i % 2 ? CHIP_CHAR_PX : IDS_TEXT_PX,
  }));

/** Width (px) of the longest unbreakable piece of an identifier line: a short
 * identifier (`.mono`), or a cross-reference kept in one piece (`.keep`, «
 * ignored for name@1.0 ») up to the first break point of its reference. */
function nowrapPx(html: string): number {
  const keeps = Array.from(
    html.matchAll(
      /<span class="keep">([^<]*)<span class="mono( is-long)?">([\s\S]*?)<\/span>/g,
    ),
    ([, lead, long, ref]) =>
      shownChars(lead) * IDS_TEXT_PX +
      shownChars(long ? ref.split('<wbr>')[0] : ref) * CHIP_CHAR_PX,
  );
  const ids = Array.from(
    html.matchAll(/<span class="mono">([^<]*)<\/span>/g),
    ([, id]) => shownChars(id) * CHIP_CHAR_PX,
  );
  return widest([...keeps, ...ids]);
}

/** A row of an advisory table: its Advisory cell and its package rows. */
interface AdvisoryRowFit {
  text: AdvisoryText;
  packages: PackageFit[];
}

/** Lines of a text in `room` px, broken between its words; a long word at its
 * break points (breakableId), as a last resort anywhere. */
function textLines(runs: TextRun[], room: number, space: number): number {
  let lines = 0;
  let used = 0;
  let spaced = false;
  for (const run of runs) {
    for (const token of run.text.split(/(\s+)/).filter(Boolean)) {
      if (/^\s+$/.test(token)) {
        spaced = true;
        continue;
      }
      idPieces(token).forEach((piece, i) => {
        const gap = i === 0 && spaced && used > 0 ? space : 0;
        const width = piece.length * run.char;
        lines = Math.max(lines, 1);
        if (used > 0 && used + gap + width > room) {
          lines += 1;
          used = 0;
        } else {
          used += gap;
        }
        used += width;
        while (used > room) {
          lines += 1;
          used -= room;
        }
      });
      spaced = false;
    }
  }
  return lines;
}

/** Height (px) of the Advisory cell in a column of `px`. */
function advisoryHeight(text: AdvisoryText, px: number): number {
  const room = px - CELL_PADDING_PX;
  const where = text.where.reduce(
    (n, w) =>
      n +
      wrap(
        idPieces(w).map((p) => p.length),
        Math.max(1, Math.floor(room / CHIP_CHAR_PX)),
      ).lines,
    0,
  );
  const title = textLines(
    [{ text: text.title, char: TITLE_CHAR_PX }],
    room,
    TITLE_SPACE_PX,
  );
  const ids = textLines(text.ids, room, IDS_SPACE_PX);
  return title * TITLE_LINE_PX + (ids + where) * IDS_LINE_PX;
}

/** Compares two sort keys, element by element. */
const lessThan = (a: number[], b: number[]) => {
  const i = a.findIndex((x, k) => x !== b[k]);
  return i >= 0 && a[i] < b[i];
};

/** Width (px) of a column that fits `room` chip characters, never below its
 * default share, rounded like the printed share. */
const columnPx = (room: number, share: number) => {
  const px =
    room * CHIP_CHAR_PX + CHIP_PADDING_PX + CELL_PADDING_PX + FIT_SLACK_PX;
  return px <= share * PAGE_PX
    ? share * PAGE_PX
    : (Math.ceil((px / PAGE_PX) * 1000) / 1000) * PAGE_PX;
};
/** Chip characters a column of `px` fits. */
const chipRoom = (px: number) =>
  Math.floor(
    (px - CHIP_PADDING_PX - CELL_PADDING_PX - FIT_SLACK_PX) / CHIP_CHAR_PX,
  );
const shareOf = (px: number, share: number) =>
  px <= share * PAGE_PX
    ? `${Math.round(share * 100)}%`
    : `${Math.round((px / PAGE_PX) * 1000) / 10}%`;

interface AdvisoryColumns {
  packageWidth: string;
  fixedWidth: string;
  /** Width (px) Fixed in does not go below in a preview narrower than the PDF
   * (its short chips whole; at most the PDF's), and the window (px) below
   * which its share no longer gives it; null without a short chip, and in the
   * PDF. */
  fixedNarrow: { px: number; below: number } | null;
  /** Height of a package row, the same in every column: in the PDF, and in a
   * narrower preview (PREVIEW_PAGE_PX). */
  heightOf: (line: PackageFit) => number;
  narrowHeightOf: (line: PackageFit) => number;
}

/**
 * Widths of Package and Fixed in of an advisory table. Their chips fit on one
 * line: each column takes the width of the longest one (never less than its
 * default share), as long as the Advisory column keeps its share
 * (`ADVISORY_MIN`). Otherwise, the two widths that give the shortest table,
 * the height of each row being that of its tallest cell (Advisory included,
 * estimated): at equal height, those that leave Advisory its share, then those
 * that break the chips into the fewest lines (the room a taller cell leaves
 * free widens a long fixed version), then the widest Advisory column, never
 * below `ADVISORY_FLOOR`. A chip that is too long wraps between its parts
 * (name, version), then before its separators, never in the middle of a short
 * part. A version is atomic: each column first fits its whole versions (up to
 * VERSION_WHOLE_CHARS characters), even if that takes Advisory below its
 * share, as long as Advisory fits its longest unbreakable piece
 * (`ADVISORY_HOLD_PX` at least). Each package row then takes the height of its
 * tallest cell, so that a fixed version stays level with its package.
 */
function advisoryColumns(
  rows: AdvisoryRowFit[],
  statePx: number,
  preview: boolean,
): AdvisoryColumns {
  const fits = rows.flatMap((r) => r.packages);
  const pkgShare = statePx
    ? COLUMN_SHARE.packageWithState
    : COLUMN_SHARE.package;
  const fixedShare = COLUMN_SHARE.fixed;
  const floor = (share: number, chips: ChipPart[][]) =>
    Math.max(
      chipRoom(share * PAGE_PX),
      widest(
        chips
          .flat()
          .filter((p) => p.unbreakable)
          .map(widthOf),
      ),
    );
  const pkgChips = fits.map((f) => f.chip);
  const fixedChips = fits.map((f) => f.fixed).filter(Boolean);
  const total = (p: number, f: number) =>
    columnPx(p, pkgShare) + columnPx(f, fixedShare);
  /** Room of Package and Fixed in when Advisory keeps `share` of the page. */
  const budget = (share: number) =>
    PAGE_PX * (1 - share) - statePx - SEVERITY_COL;
  // A version is atomic: each column fits its whole versions
  // (versionColumnChars) as long as the table fits, that is as long as the
  // Advisory column fits its longest unbreakable piece. Otherwise, Fixed in
  // first (the version to install), then the longest parts of the versions,
  // which then break only between them.
  const hard = {
    p: floor(pkgShare, pkgChips),
    f: floor(fixedShare, fixedChips),
  };
  const holdOf = (chips: ChipPart[][], key: 'whole' | 'part') =>
    widest(chips.flat().map((part) => part.hold?.[key] ?? 0));
  type Hold = 'whole' | 'part';
  const at = (pkg: Hold, fixed: Hold) => ({
    p: Math.max(hard.p, holdOf(pkgChips, pkg)),
    f: Math.max(hard.f, holdOf(fixedChips, fixed)),
  });
  const advisoryMin = Math.max(
    ADVISORY_HOLD_PX,
    ...rows.map((r) => r.text.nowrap + CELL_PADDING_PX + FIT_SLACK_PX),
  );
  const holds = ({ p, f }: { p: number; f: number }) =>
    total(p, f) <= PAGE_PX - SEVERITY_COL - statePx - advisoryMin;
  const { p: pkgFloor, f: fixedFloor } =
    [
      at('whole', 'whole'),
      at('part', 'whole'),
      at('whole', 'part'),
      at('part', 'part'),
    ].find(holds) ?? hard;
  // Versions that already take Advisory below its floor share: the widths are
  // searched down to its minimum (a version broken between its parts into the
  // fewest lines).
  const limit =
    (pkgFloor > hard.p || fixedFloor > hard.f) &&
    total(pkgFloor, fixedFloor) > budget(ADVISORY_FLOOR)
      ? PAGE_PX - SEVERITY_COL - statePx - advisoryMin
      : budget(ADVISORY_FLOOR);
  const pkgWant = Math.max(
    pkgFloor,
    widest(
      fits.map(
        (f) =>
          f.chip.reduce((n, p) => n + widthOf(p), 0) +
          (f.dev ? DEV_TAG_CHARS : 0),
      ),
    ),
  );
  const fixedWant = Math.max(
    fixedFloor,
    widest(fixedChips.map((c) => c.reduce((n, p) => n + widthOf(p), 0))),
  );
  let best = { p: pkgFloor, f: fixedFloor };
  if (total(pkgWant, fixedWant) <= budget(ADVISORY_MIN)) {
    best = { p: pkgWant, f: fixedWant };
  } else {
    // Height of each Advisory cell, per column width.
    const advisory = rows.map(() => new Map<number, number>());
    let bestKey = [Infinity];
    for (let p = pkgFloor; p <= pkgWant; p += 1) {
      for (let f = fixedFloor; f <= fixedWant; f += 1) {
        const px = total(p, f);
        if (px > limit && (p > pkgFloor || f > fixedFloor)) break;
        const advisoryPx = Math.round(PAGE_PX - SEVERITY_COL - statePx - px);
        let height = 0;
        let chipLineCount = 0;
        rows.forEach((row, r) => {
          let block = -LINE_GAP_PX;
          for (const line of row.packages) {
            const fit = lineFit(line, p, f);
            block += Math.max(fit.pkg, fit.fixed) * CHIP_LINE_PX + LINE_GAP_PX;
            chipLineCount += fit.pkg + fit.fixed;
          }
          if (!advisory[r].has(advisoryPx))
            advisory[r].set(advisoryPx, advisoryHeight(row.text, advisoryPx));
          height += Math.max(block, advisory[r].get(advisoryPx));
        });
        // Advisory gives up its share only for a table shorter by at least one
        // chip line.
        const narrow = px > budget(ADVISORY_MIN) ? 1 : 0;
        const key = [height + narrow * CHIP_LINE_PX, narrow, chipLineCount, px];
        if (lessThan(key, bestKey)) {
          bestKey = key;
          best = { p, f };
        }
      }
    }
  }
  // Chip characters a column fits in the narrow preview, without the PDF margin
  // (FIT_SLACK_PX): a chip that just fits there does not reserve an empty line
  // for every other one of its row.
  const narrow = (px: number) =>
    Math.floor(
      ((px * PREVIEW_PAGE_PX) / PAGE_PX - CHIP_PADDING_PX - CELL_PADDING_PX) /
        CHIP_CHAR_PX,
    );
  // In the narrow preview, Fixed in keeps the pixels of its longest short
  // version, whole (it never breaks), at most the PDF's. A long version keeps
  // its share: held in pixels, it left only 42 px to the Advisory column at 700
  // px.
  const fixedRoom = Math.min(
    chipRoom(columnPx(best.f, fixedShare)),
    widest(fixedChips.map(shortChipChars)),
  );
  const fixedPx = columnPx(best.f, fixedShare);
  const fixedLeast = Math.max(
    NO_FIX_PX,
    fixedRoom * CHIP_CHAR_PX + CHIP_PADDING_PX + CELL_PADDING_PX + FIT_SLACK_PX,
  );
  const fixedNarrow =
    preview && fixedRoom > 0
      ? {
          px: fixedLeast,
          below: previewWindow((fixedLeast * PAGE_PX) / fixedPx),
        }
      : null;
  return {
    packageWidth: shareOf(columnPx(best.p, pkgShare), pkgShare),
    fixedWidth: shareOf(fixedPx, fixedShare),
    fixedNarrow,
    heightOf: (line) => lineHeight(line, best.p, best.f),
    narrowHeightOf: (line) => {
      const fit = lineFit(
        line,
        narrow(columnPx(best.p, pkgShare)),
        // In the preview, Fixed in does not go below fixedLeast.
        fixedNarrow === null
          ? narrow(fixedPx)
          : Math.max(narrow(fixedPx), fixedRoom),
      );
      // Package and Fixed in that take the same height on their own stay
      // aligned; a state always fits on one line.
      return fit.pkg === fit.fixed && !statePx
        ? lineHeight(line, best.p, best.f)
        : Math.max(fit.pkg, fit.fixed);
    },
  };
}

/**
 * Findings of an advisory table, in the weakness's unit (one finding per
 * advisory and package version): « 11 findings in 10 advisories », « 3
 * findings, one per advisory ».
 */
function advisoryCount(items: MappedVulnerability[]): string {
  const advisories = new Set(items.map(advisoryKey)).size;
  if (items.length === advisories)
    return items.length === 1
      ? '1 finding'
      : `${items.length} findings, one per advisory`;
  return `${plural(items.length, 'finding')} in ${plural(advisories, 'advisory', 'advisories')}`;
}

/**
 * Dependency (or image) advisories of a weakness: a compact table, one row per
 * advisory (title, identifiers, manifest or image), its packages and their
 * fixed version. The advisory's text is not repeated: the weakness is
 * described above, the title is enough to qualify it. Adjacent advisories with
 * the same title (case ignored) say it once: the following ones are sub-rows
 * attached to the first one (no rule, never separated by a page break), which
 * do not look like a duplicate.
 */
function advisoryBlock(m: Model, cwe: CweData, groups: Group[]): string {
  const showState = !m.advisoryState;
  // Each advisory is measured first (its chips, the text of its Advisory cell):
  // they set the widths of Package and Fixed in, and the height of each package
  // row. An advisory that follows a box repeats its title: as a sub-row under
  // the box, it would no longer read as the continuation of the title row.
  let afterBrief = false;
  const blocks = groups.map((g, i) => {
    const items = [...g.items].sort(compareOccurrences);
    const sameTitle =
      i > 0 && !afterBrief && lowerTitle(groups[i - 1]) === lowerTitle(g);
    const plan = cybePlan(m, g, true);
    afterBrief = !!plan;
    const pkgs = packageLines(items).map(({ v, fixed }) => {
      const version = v.packageVersion
        ? redactSecrets(v.packageVersion)
        : undefined;
      const chip = packageChip(
        redactSecrets(v.packageName ?? 'package'),
        version,
      );
      // An atomic fixed version: a single chip, broken only between its parts
      // when its column cannot fit it whole.
      const fixedVersion = fixed ? redactSecrets(fixed) : '';
      const fixedChip = fixedVersion ? versionChip(fixedVersion) : '';
      return {
        v,
        chip,
        fixedChip,
        fit: {
          chip: chipParts(chip, version),
          dev: !!v.devDependency,
          fixed: fixedChip ? chipParts(fixedChip, fixedVersion) : null,
        },
      };
    });
    // The manifest or the image the conventions name is not repeated.
    const where = Array.from(
      new Set(
        items
          .map((v) =>
            redactSecrets(
              v.type === 'sca' ? relative(m, v.manifest ?? '') : v.image,
            ),
          )
          .filter(
            (w) =>
              w &&
              w !== redactSecrets(m.manifest) &&
              w !== redactSecrets(m.image),
          ),
      ),
    );
    const advisoryIds = Array.from(
      new Set(items.map((v) => v.advisoryId).filter(Boolean)),
    );
    const cves = Array.from(
      new Set(
        items.map((v) => v.cve).filter((c) => c && !advisoryIds.includes(c)),
      ),
    );
    // An identifier that serves as the title (a CVE without a title) is not
    // repeated under it.
    const named = sameTitle ? '' : String(g.title ?? '').toLowerCase();
    const idList = [
      ...[...advisoryIds, ...cves].filter((id) => id.toLowerCase() !== named),
      ...where.filter((w) => !isLongId(w)),
    ];
    const ids = idList.map((id) => monoText(id));
    // A long image reference or manifest: a line of its own, in one piece if it
    // fits, otherwise broken before its separators. Attached to « · » in the
    // identifier line, it would overflow it.
    const longWhere = where.filter((w) => isLongId(w));
    const whereLines = longWhere
      .map((w) => `<div class="adv-ids adv-where">${idText(w)}</div>`)
      .join('');
    // Two cross-references follow each other on one line: « ; » rather than « ·
    // », whose possible break (before the dot) would open the next line on « ·
    // ignored for », read as a bullet.
    const refs = [alsoUnder(items, cwe), triagedElsewhere(m, g)]
      .filter(Boolean)
      .join('; ');
    const withdrawn = items.some((v) => v.withdrawn) ? tag('withdrawn') : '';
    // Sub-row of a same title: the identifier opens the cell and carries the
    // advisory's tag.
    const idsLine = sameTitle
      ? idLine([...ids, refs], withdrawn)
      : idLine([...ids, refs]);
    const advisory = sameTitle
      ? `${idsLine}${whereLines}`
      : `<div class="adv-title">${title(g.title)}${withdrawn}</div>${idsLine}${whereLines}`;
    const fit: AdvisoryRowFit = {
      text: {
        title: sameTitle
          ? ''
          : `${plainTitle(g.title)}${withdrawn ? ' withdrawn' : ''}`,
        ids: idLineRuns(idsLine),
        where: longWhere,
        nowrap: nowrapPx(idsLine),
      },
      packages: pkgs.map((p) => p.fit),
    };
    return { g, items, pkgs, plan, sameTitle, advisory, fit };
  });
  const state = showState
    ? stateColumn(
        groups.flatMap((g) => g.items).map(stateOf),
        COLUMN_SHARE.state,
      )
    : null;
  const columns = advisoryColumns(
    blocks.map((b) => b.fit),
    state?.px ?? 0,
    m.preview,
  );
  const rows: Row[] = [];
  const joinPrevious: boolean[] = [];
  const rowClasses: string[] = [];
  for (const { g, items, pkgs, plan, sameTitle, advisory } of blocks) {
    rowClasses[rows.length] = sameTitle ? 'same-title' : '';
    joinPrevious[rows.length] = sameTitle;
    const heights = pkgs.map((p) => columns.heightOf(p.fit));
    const narrow = pkgs.map((p) => columns.narrowHeightOf(p.fit));
    rows.push([
      severityBadge(g.severity),
      advisory,
      lines(
        pkgs.map((p) => `${p.chip}${p.v.devDependency ? tag('dev') : ''}`),
        heights,
        narrow,
      ),
      lines(
        pkgs.map((p) => p.fixedChip || '<span class="muted">No fix</span>'),
        heights,
        narrow,
      ),
      ...(showState
        ? [
            lines(
              pkgs.map((p) => stateLabel(p.v.state)),
              heights,
              narrow,
            ),
          ]
        : []),
    ]);
    // The box follows the row and the notes of the packages it does not cover.
    rows.push(...advisoryNotes(m, items, plan?.covered));
    if (plan) rows.push(cybeRow(m, plan, true));
  }
  const label =
    groups[0].type === 'container'
      ? 'Vulnerable image packages'
      : 'Vulnerable dependencies';
  // Dashboard preview: below the window where its share no longer fits its
  // chips, Fixed in takes their pixels (fixedBreakpointsCss); the PDF keeps its
  // widths and its markup.
  const narrow = columns.fixedNarrow;
  return `<div class="adv-block${narrow ? ` fix-below-${narrow.below}" style="--adv-fixed-narrow: ${narrow.px}px` : ''}">
<div class="cwe-label adv-label cont-cover">${label} · ${advisoryCount(groups.flatMap((g) => g.items))}</div>
${dataTable({
  columns: [
    { label: 'Severity', width: `${SEVERITY_COL}px` },
    { label: 'Advisory' },
    { label: 'Package', width: columns.packageWidth },
    {
      label: 'Fixed in',
      width: narrow
        ? `var(--adv-fixed, ${columns.fixedWidth})`
        : columns.fixedWidth,
    },
    ...(state ? [{ label: 'State', width: state.width }] : []),
  ],
  rows,
  rowClasses,
  joinPrevious,
  className: 'advisories',
  continuation: `${cwe.id} · ${label} (continued)`,
})}
</div>`;
}

function weaknessBlock(m: Model, c: Category): string {
  const cwe = c.cwe;
  const previous =
    cwe.trend === 'stable'
      ? `unchanged since 2023`
      : `${cwe.trend === 'up' ? 'up' : 'down'} from #${cwe.rankLastYear} in 2023`;
  const kev = cwe.kevCount ? plural(cwe.kevCount, 'KEV CVE') : 'no KEV CVE';
  const about = m.detailed
    ? `<div class="cwe-about">
  <div class="cwe-desc">${clampedHtml(cwe.description, 400)}</div>
  ${cwe.mitigations?.length ? `<div class="cwe-prevent"><div class="cwe-label">How to prevent</div><ul>${cwe.mitigations.map((i) => `<li>${escapeHtml(curly(i))}</li>`).join('')}</ul></div>` : ''}
</div>`
    : '';
  const groups = weaknessGroups(c);
  const code = groups.code.map((g) => groupBlock(m, cwe, g));
  const advisories = groups.advisories.map((list) =>
    advisoryBlock(m, cwe, list),
  );
  // Reminder of the weakness between two blocks: hidden under the previous
  // block on the same page, it appears only at the top of a page. The reference
  // box stays with the start of the first block.
  const recall = `<div class="cwe-cont" aria-hidden="true">${weaknessLabel(cwe)} (continued)</div>`;
  return `<div class="cwe-block">
<div class="cwe-head">
  <div class="cwe-head-main"><div class="cwe-eyebrow">${eyebrowLabel(cwe)}</div><h3 class="cwe-title">${escapeHtml(cwe.name)}</h3></div>
  <div class="cwe-aside"><span class="cwe-count">${plural(c.open.length, 'finding')}</span><span class="cwe-ref">Rank ${previous} · ${kev}</span></div>
</div>
${about}
${[...code, ...advisories].join(`\n${recall}\n`)}
</div>`;
}

function findingsSection(m: Model): string {
  const hit = m.categories.filter((c) => c.open.length > 0);
  if (!hit.length) return '';
  const hasAdvisories = m.open.some(isAdvisory);
  const conventions = [
    // The final period stays with the path or the image it follows.
    m.prefix
      ? `Paths are relative to ${pathText(redactSecrets(m.prefix), { keep: true, after: '.' })}`
      : '',
    m.manifest
      ? `Dependency findings come from ${pathText(redactSecrets(m.manifest), { keep: true, after: '.' })}`
      : '',
    m.image
      ? `Container findings come from the image ${idText(redactSecrets(m.image), { after: '.' })}`
      : '',
    m.analysed
      ? '<strong>State</strong>: review status. <strong>Verdict</strong>: exploitability assessed by CybeDefend\u2019s AI analysis or a reviewer, with its confidence.'
      : '',
    hasAdvisories && m.advisoryState
      ? `All ${m.open.some((v) => v.type === 'container') ? 'dependency and image' : 'dependency'} findings are ${stateHtml(m.advisoryState)}.`
      : '',
    // The « dev » tag also appears on the chips of the listed triaged findings.
    [...m.open, ...m.triaged.filter(isListedTriage)].some(
      (v) => v.devDependency,
    )
      ? DEV_LEGEND
      : '',
  ]
    .filter(Boolean)
    .join(' ');
  const triaged = m.triaged.length
    ? ` · ${m.triaged.length} triaged, excluded`
    : '';
  return `<section class="section" id="findings">
${sectionHead({ eyebrow: 'Details', title: 'Findings by weakness', aside: `${plural(m.open.length, 'open finding')}${triaged}` })}
<p class="section-intro">Weaknesses found in the project, in Top 25 rank order; within each, code and infrastructure findings first, then vulnerable dependencies. Identical findings are grouped under one description; a finding mapped to several weaknesses is listed under each.</p>
${conventions ? `<p class="conventions">${conventions}</p>` : ''}
${hit.map((c) => weaknessBlock(m, c)).join('\n')}
</section>`;
}

// ── triaged findings ───────────────────────────────────────────────────────

/** Triaged counts: one row per state, one column per severity. */
function triageCounts(m: Model): string {
  const severities: Severity[] = [
    ...SEVERITIES,
    ...(m.triaged.some((v) => severityOf(v) === 'unknown')
      ? ['unknown' as Severity]
      : []),
  ];
  const cell = (n: number) =>
    `<span class="num${n ? '' : ' zero'}">${n}</span>`;
  const row = (label: string, items: MappedVulnerability[]) => [
    label,
    ...severities.map((s) =>
      cell(items.filter((v) => severityOf(v) === s).length),
    ),
    cell(items.length),
  ];
  const byState = groupBy(m.triaged, stateOf).sort(
    (a, b) => b.items.length - a.items.length,
  );
  const rows = byState.map((s) => row(stateLabel(s.key), s.items));
  const withTotal = byState.length > 1;
  if (withTotal) rows.push(row('Total', m.triaged));
  return dataTable({
    columns: [
      { label: 'State' },
      ...severities.map((s) => ({
        label: severityLabel(s),
        width: '13%',
        align: 'right' as const,
      })),
      { label: 'Total', width: '13%', align: 'right' },
    ],
    rows,
    rowClasses: withTotal ? [...byState.map(() => ''), 'total'] : undefined,
    className: 'triage-counts',
  });
}

interface TriagedRow {
  severity: Severity;
  weight: number;
  name: string;
  state: string;
  cells: string[];
  /** The findings the row stands for. */
  items: MappedVulnerability[];
}

/** « and 2 more », never broken across two lines. */
const andMore = (n: number) => `<span class="keep">and ${n} more</span>`;

/** « a, b, c and 2 more »: a capped list. */
const capped = (items: string[], sep = ', ') =>
  items.length > MAX_LISTED
    ? `${items.slice(0, MAX_LISTED).join(sep)} ${andMore(items.length - MAX_LISTED)}`
    : items.join(sep);

/** « CWE-94, CWE-77 »: the Top 25 weaknesses of a row, by rank. */
const cweList = (items: MappedVulnerability[]) =>
  cweIds(
    Array.from(new Set(items.flatMap(top25Of))).sort(
      (a, b) => CWE_TOP_25_2024_DATA[a].rank - CWE_TOP_25_2024_DATA[b].rank,
    ),
  );

/** Triaged code findings: one row per rule and state, its locations. */
function codeRows(m: Model, items: MappedVulnerability[]): TriagedRow[] {
  return groupBy(items, (v) =>
    [
      v.type,
      String(v.name ?? '').toLowerCase(),
      severityOf(v),
      stateOf(v),
    ].join('|'),
  ).map(({ items: list }) => {
    const sorted = [...list].sort(compareOccurrences);
    const where = Array.from(new Set(sorted.map((v) => codeLocation(m, v))));
    return {
      severity: maxSeverity(list),
      weight: list.length,
      name: list[0].name,
      state: stateOf(list[0]),
      items: list,
      cells: [
        `<div class="triage-title">${title(list[0].name)}</div>${idLine([cweList(list)])}`,
        `<div class="places">${capped(where, ' ')}</div>`,
      ],
    };
  });
}

interface PackageAdvisory {
  key: string;
  severity: Severity;
  items: MappedVulnerability[];
}

/** Order of a list of identifiers without a title: severity, then alphabetical.
 * The number of findings of each advisory, which orders the named advisories,
 * is not shown there: an order it dictated would look random. */
const byId = (a: PackageAdvisory, b: PackageAdvisory) =>
  SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
  a.key.localeCompare(b.key);

/** A triaged advisory on a line of its own (its title, or « high: GHSA-a,
 * GHSA-b »): its following lines indented, so that the end of a broken title
 * does not read as the next entry. */
const advisoryEntry = (html: string) =>
  `<div class="adv-ids adv-entry">${html}</div>`;

/** « 17 findings in 10 advisories, all high », « 8 findings, one per advisory:
 * 2 critical, 6 high »: in the unit of the counts table. */
function triagedCount(items: MappedVulnerability[]): string {
  const split = [...SEVERITIES, 'unknown' as Severity]
    .map((s) => ({ s, n: items.filter((v) => severityOf(v) === s).length }))
    .filter(({ n }) => n > 0);
  const severities =
    split.length === 1
      ? `, ${items.length === 2 ? 'both' : 'all'} ${split[0].s}`
      : `: ${split.map(({ s, n }) => `${n} ${s}`).join(', ')}`;
  return `${advisoryCount(items)}${severities}`;
}

/** An advisory of a triaged row named by its title, on a line of its own: all
 * of them when they are few, otherwise the critical ones. */
const isNamed = (a: PackageAdvisory, advisories: PackageAdvisory[]) =>
  advisories.length <= MAX_TITLED || a.severity === 'critical';

/**
 * The advisories of a package, the most severe first, all of them (critical
 * and high triaged findings are listed without a cap). When few, one line
 * each, named by its title (« high: Command Injection in lodash (GHSA-35jh)
 * »): an identifier alone does not qualify it. Beyond MAX_TITLED, only the
 * critical ones keep their title; the others fit on one identifier line («
 * high: GHSA-c, GHSA-d, GHSA-e »), in alphabetical order (see byId). A
 * withdrawn advisory carries its tag where it is named. A severity label never
 * ends a line far from what it introduces, nor an identifier far from the
 * title it follows.
 */
function advisoryIds(advisories: PackageAdvisory[]): string[] {
  const mixed = new Set(advisories.map((a) => a.severity)).size > 1;
  const withdrawn = (a: PackageAdvisory) =>
    a.items.some((v) => v.withdrawn) ? tag('withdrawn') : '';
  return groupBy(advisories, (a) => a.severity).flatMap(
    ({ key, items: list }) => {
      if (isNamed(list[0], advisories))
        return list.map(
          (a) =>
            `${mixed ? `${key}:${NBSP}` : ''}<span class="adv-name">${title(a.items[0].name)}</span>${NBSP}(${monoText(a.key)})${withdrawn(a)}`,
        );
      const ids = [...list].sort(byId).map((a, i) => {
        const comma = i < list.length - 1 ? ',' : '';
        return withdrawn(a)
          ? `<span class="keep">${monoText(a.key)}${withdrawn(a)}${comma}</span>`
          : monoText(a.key, comma);
      });
      if (mixed) ids[0] = `<span class="keep">${key}: ${ids[0]}</span>`;
      return [ids.join(' ')];
    },
  );
}

/**
 * Triaged dependencies: one row per package and state (a package is usually
 * triaged as a whole), as in the other reports, its versions as chips as in
 * the weakness tables. One advisory (or advisories with the same title): title
 * and identifiers; several: their findings by severity, then their
 * identifiers.
 */
function packageRows(m: Model, items: MappedVulnerability[]): TriagedRow[] {
  return groupBy(items, (v) =>
    [v.type, v.image ?? '', v.packageName ?? '', stateOf(v)].join('|'),
  ).map(({ items: list }) => {
    const first = list[0];
    const advisories: PackageAdvisory[] = groupBy(list, advisoryKey)
      .map((a) => ({ ...a, severity: maxSeverity(a.items) }))
      .sort(
        (a, b) =>
          SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
          b.items.length - a.items.length ||
          a.key.localeCompare(b.key),
      );
    const titles = new Set(
      advisories.map((a) => String(a.items[0].name ?? '').toLowerCase()),
    );
    const single = titles.size === 1;
    const withdrawn = advisories.filter((a) =>
      a.items.some((v) => v.withdrawn),
    ).length;
    const finding = single
      ? `<div class="triage-title">${title(first.name)}${withdrawn ? tag('withdrawn') : ''}</div>`
      : `<div class="triage-title">${triagedCount(list)}${withdrawn ? `; ${withdrawn} withdrawn` : ''}</div>`;
    // The same advisories still open for other versions.
    const keys = new Set(advisories.map((a) => a.key));
    const stillOpen = m.open.filter(
      (v) =>
        v.type === first.type &&
        v.packageName === first.packageName &&
        keys.has(advisoryKey(v)),
    );
    const name = redactSecrets(first.packageName ?? 'package');
    const versions = versionsOf(list);
    // Version chips, tagged « dev » as in the weakness tables (which often
    // explains the triage).
    const chips = (versions.length ? versions : [undefined])
      .slice(0, MAX_LISTED)
      .map(
        (version) =>
          `${packageChip(name, version ? redactSecrets(version) : undefined)}${list.some((v) => (v.packageVersion || undefined) === version && v.devDependency) ? tag('dev') : ''}`,
      );
    const hidden = versions.length - chips.length;
    // Identifiers, then the row's weaknesses and versions still open: after
    // them when a single line carries every advisory, otherwise on a line of
    // their own (attached to the last advisory, they would seem to qualify it
    // alone).
    const ids = single
      ? [
          [...advisories]
            .sort(byId)
            .map((a) => monoText(a.key))
            .join(ID_SEP),
        ]
      : advisoryIds(advisories);
    const last = ids.length === 1 ? ids.pop() : '';
    return {
      severity: maxSeverity(list),
      weight: list.length,
      name: String(first.packageName ?? ''),
      state: stateOf(first),
      items: list,
      cells: [
        `${finding}${ids.map((l) => advisoryEntry(l)).join('')}${idLine([
          last,
          cweList(list),
          stillOpen.length ? packageVersions('still open for', stillOpen) : '',
        ])}`,
        // The image, under its chips, except the one the conventions name: a
        // long reference breaks before its separators.
        `${lines([...chips, ...(hidden > 0 ? [`<span class="muted">and ${hidden} more</span>`] : [])])}${first.image && first.image !== m.image ? `<div class="also-open">in ${breakableId(redactSecrets(first.image))}</div>` : ''}`,
      ],
    };
  });
}

/** Advisories triaged for one version and still open for another, and the
 * shared state of those triages (« ignored »), otherwise « triaged ». */
function splitAdvisories(m: Model): { count: number; words: string } {
  const open = new Set(m.open.filter(isAdvisory).map(advisoryKey));
  const split = m.triaged.filter(
    (v) => isAdvisory(v) && open.has(advisoryKey(v)),
  );
  const states = new Set(split.map(stateOf));
  return {
    count: new Set(split.map(advisoryKey)).size,
    words: states.size === 1 ? stateHtml(stateOf(split[0])) : 'triaged',
  };
}

/** Rows of the critical and high triaged findings, the most severe first. */
function listedTriagedRows(m: Model): TriagedRow[] {
  const listed = m.triaged.filter(isListedTriage);
  return [
    ...codeRows(
      m,
      listed.filter((v) => !isAdvisory(v)),
    ),
    ...packageRows(m, listed.filter(isAdvisory)),
  ].sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      b.weight - a.weight ||
      a.name.localeCompare(b.name),
  );
}

function triagedSection(m: Model): string {
  if (!m.triaged.length) return '';
  const listed = m.triaged.filter(isListedTriage);
  const unlisted = m.triaged.filter((v) => !isListedTriage(v));
  const rows = listedTriagedRows(m);
  // A single state for every row: the label says it, the column would repeat
  // the same word.
  const states = new Set(rows.map((r) => r.state));
  const withState = states.size > 1;
  const onlyState = !withState && rows.length ? rows[0].state : '';
  const labelText = 'Critical and high triaged findings';
  const allAdvisories = listed.every(isAdvisory);
  // A long chip and its « dev » tag: the column widens rather than leaving the
  // tag alone on the line.
  const packages = listed.filter(isAdvisory);
  const longest = widest(
    packages.map(
      (v) => packageOf(v).length + (v.devDependency ? DEV_TAG_CHARS : 0),
    ),
  );
  const share = allAdvisories && longest <= PACKAGE_CHARS ? 0.28 : 0.32;
  // A version is atomic: the column fits each one whole (its at sign included),
  // its longest part beyond VERSION_WHOLE_CHARS characters.
  const versionHolds = packages
    .map((v) => versionColumnChars([v.packageVersion]))
    .filter((chars) => chars <= VERSION_WHOLE_CHARS);
  const packageWidth = shareOf(
    columnPx(widest(versionHolds.map((chars) => chars + 1)), share),
    share,
  );
  const list = rows.length
    ? `<div class="cwe-label triage-label cont-cover">${labelText}${onlyState ? ` · all ${escapeHtml(stateWords(onlyState))}` : ''}</div>
${dataTable({
  columns: [
    { label: 'Severity', width: `${SEVERITY_COL}px` },
    { label: 'Finding' },
    // Stacked package chips, narrower than a file path.
    { label: allAdvisories ? 'Package' : 'Location', width: packageWidth },
    ...(withState
      ? [
          {
            label: 'State',
            width: stateColumn(
              rows.map((r) => r.state),
              TRIAGED_STATE_PX / PAGE_PX,
              `${TRIAGED_STATE_PX}px`,
            ).width,
          },
        ]
      : []),
  ],
  // Under an analysed row, why the finding was dismissed.
  rows: rows.flatMap((r): Row[] => {
    const cells = [
      severityBadge(r.severity),
      ...r.cells,
      ...(withState ? [stateLabel(r.state)] : []),
    ];
    const line = triageLine(m, r.items);
    return line
      ? [cells, { full: line, attach: true, className: 'ca-tri-row' }]
      : [cells];
  }),
  className: 'triaged',
  continuation: `${labelText} (continued)`,
})}`
    : '';
  const split = splitAdvisories(m);
  const intro = [
    'Top 25 findings that were ignored, resolved or judged not exploitable. They are excluded from every figure of this report.',
    split.count
      ? `Triage applies to a package version: ${split.count === 1 ? '1 advisory' : `${split.count} advisories`} ${split.words} for one version ${split.count === 1 ? 'is' : 'are'} still open for another.`
      : '',
  ]
    .filter(Boolean)
    .join(' ');
  // Withdrawn advisories are flagged by a tag only on the listed rows: those
  // that are not listed are named here, with the packages they affect, and
  // counted in findings like the rest of the sentence.
  const withdrawnItems = unlisted.filter((v) => v.withdrawn);
  const withdrawn = groupBy(withdrawnItems, advisoryKey).map(({ key, items }) =>
    packageVersions(`${monoText(key)} on`, items),
  );
  const withdrawnWords = withdrawn.length
    ? `, including ${plural(withdrawnItems.length, 'finding')} on ${withdrawn.length === 1 ? 'a withdrawn advisory' : 'withdrawn advisories'} (${capped(withdrawn, '; ')})`
    : '';
  // Without an open finding, there are no conventions above: the legend of the
  // « dev » tag of the chips comes here.
  const note = [
    unlisted.length
      ? `${unlisted.length === 1 ? '1 lower-severity triaged finding is' : `${unlisted.length} lower-severity triaged findings are`} not listed${withdrawnWords}.`
      : '',
    !m.open.length && listed.some((v) => v.devDependency) ? DEV_LEGEND : '',
  ]
    .filter(Boolean)
    .join(' ');
  return `<section class="section" id="triaged">
${sectionHead({ eyebrow: 'Triage', title: 'Triaged findings', aside: `${m.triaged.length} triaged, excluded from all figures` })}
<p class="section-intro">${intro}</p>
${triageCounts(m)}
${list}
${note ? `<p class="table-note">${note}</p>` : ''}
</section>`;
}

// ── about ──────────────────────────────────────────────────────────────────

function about(m: Model): string {
  // The rule on withdrawn advisories is stated only when the report counts
  // some.
  const withdrawn = [...m.open, ...m.triaged].some((v) => v.withdrawn)
    ? ' Withdrawn advisories stay counted and are flagged as withdrawn.'
    : '';
  return aboutSection([
    {
      title: 'Scope and method',
      html: `<p>Findings from the code (SAST), infrastructure (IaC), dependency (SCA) and container scans of the project are mapped to CWE identifiers: from the detection rule for code and infrastructure findings, and from the advisory (GitHub / NVD data in OSV) for dependency and container findings. A finding counts under every Top 25 weakness it maps to; totals count each finding once. Findings without a Top 25 CWE are out of scope. Ignored, resolved and not exploitable findings are excluded from every figure.${withdrawn}</p>`,
    },
    {
      title: 'Exploitability analysis',
      html: `<p>A verdict rates how practical exploiting a finding is: not exploitable, theoretical, proven or actively exploited, with the confidence of the assessment. Only verdicts from CybeDefend\u2019s AI analysis or from a reviewer are shown. Confirming a finding in review says the weakness is real; a confirmed finding can still be rated theoretical.</p>`,
    },
    ...cybeAbout(m),
    {
      title: `About the CWE Top 25 (${EDITION})`,
      html: `<p>MITRE ranks the Top 25 by the prevalence and severity of the CVEs published for each weakness in the NVD. The ranking, its change since 2023 and the KEV counts (CVEs listed in CISA\u2019s Known Exploited Vulnerabilities catalog) are reference data. Reference: <a href="https://cwe.mitre.org/top25/">cwe.mitre.org/top25</a>.</p>`,
    },
    {
      title: 'Limitations',
      html: `<p>Automated detection can report false positives and cannot prove that other weaknesses are absent. Verify each finding before remediation. This report is not a certification.</p>`,
    },
  ]);
}

/** « Cybe Analysis » section, when the report prints a box or a triage line:
 * the text shared by the three reports. */
function cybeAbout(m: Model): { title: string; html: string }[] {
  const html = m.analysis.aboutParagraph(m.cybe);
  return html ? [{ title: 'Cybe Analysis', html }] : [];
}

// ── styles ─────────────────────────────────────────────────────────────────

// Sizes of the shared scale: body, td 11, th 9.5, small and code 10.
const C = COLORS;
const CWE_REPORT_CSS = `
  .page-start { break-before: page; }
  .scope-note { margin: 10px 0 0; color: ${C.textSecondary}; }
  .scope-note strong { font-weight: 600; }
  .grid-2.charts { margin-top: 14px; grid-template-columns: 0.9fr 1.1fr; }
  .charts .panel { display: flex; flex-direction: column; }
  .charts .donut { flex: 1; }
  .summary .hbar-label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  /* Identifiers of variable width (CWE-79, CWE-400): the names aligned. */
  .summary .hbar-id { display: inline-block; width: 48px; }
  .panel-note { margin: 10px 0 0; }
  .summary .key-facts { margin-top: 12px; }
  /* Package, location or CWE cited in a key finding: code size. */
  .key-facts .mono { font-size: 10px; white-space: nowrap; }
  /* Long package (monoText): breakable before its separators, never outside the
     panel. */
  .key-facts .mono.is-long { white-space: normal; }

  table.coverage td { padding-top: 5px; padding-bottom: 5px; }
  table.coverage .cwe-id { font-size: 10px; color: ${C.textSecondary}; }
  table.coverage tr:has(.count-pill) td { background: ${C.subtleBg}; }
  table.coverage tr:has(.count-pill) .weakness { color: ${C.dark}; font-weight: 500; }
  table.coverage tr:has(.count-pill) .cwe-id { color: ${C.dark}; }
  table.coverage tr:has(.count-zero) td { color: ${C.textMuted}; }
  table.coverage tr:has(.count-zero) .trend { color: inherit; }
  .count-pill, .count-zero { display: inline-block; min-width: 22px; padding: 0 6px; border-radius: 4px; font-size: 10px; line-height: 1.7; text-align: center; font-variant-numeric: tabular-nums; }
  .count-pill { font-weight: 600; }
  .count-zero { color: #b8b2c2; }
  .trend { font-size: 10px; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .trend-up { color: ${C.textSecondary}; }
  .trend-down, .trend-flat { color: ${C.textMuted}; }
  .tri { display: inline-block; width: 0; height: 0; margin-right: 3px; border-left: 3.5px solid transparent; border-right: 3.5px solid transparent; vertical-align: 1px; }
  .trend-up .tri { border-bottom: 6px solid currentColor; }
  .trend-down .tri { border-top: 6px solid currentColor; }
  .table-note .trend { font-size: inherit; }
  .table-note { margin: 10px 0 0; font-size: 10px; line-height: 1.5; color: ${C.textMuted}; }
  .table-note strong { color: ${C.textSecondary}; font-weight: 600; }

  .conventions { margin: -6px 0 0; font-size: 10px; color: ${C.textMuted}; }
  .conventions strong { color: ${C.textSecondary}; font-weight: 600; }
  .tag { display: inline-block; padding: 0 4px; border: 1px solid ${C.border}; border-radius: 3px; font-size: 9.5px; font-weight: 500; line-height: 1.45; color: ${C.textMuted}; white-space: nowrap; vertical-align: 1px; }
  .cwe-block { margin-top: 30px; }
  .section-intro + .cwe-block, .conventions + .cwe-block { margin-top: 18px; }
  /* Header as a 2 x 2 grid aligned on the baselines: the counter facing the
     kicker, the rank facing the last line of the title. */
  .cwe-head { display: grid; grid-template-columns: minmax(0, 1fr) auto; column-gap: 16px; align-items: baseline; break-inside: avoid; break-after: avoid; }
  .cwe-head-main, .cwe-aside { display: contents; }
  .cwe-eyebrow { grid-area: 1 / 1; font-size: 9.5px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: ${C.accent}; margin-bottom: 2px; }
  .cwe-title { grid-area: 2 / 1; align-self: last baseline; margin: 0; line-height: 1.35; text-wrap: balance; }
  .cwe-count { grid-area: 1 / 2; text-align: right; font-size: 11px; font-weight: 600; color: ${C.dark}; }
  .cwe-ref { grid-area: 2 / 2; align-self: last baseline; text-align: right; font-size: 9.5px; color: ${C.textMuted}; white-space: nowrap; }
  /* Title and reference box stay with the start of the first block (head, last
     lines of its description, first rows of the table): never a box alone at
     the bottom of a page. */
  .cwe-about { display: grid; grid-template-columns: 1fr 1.25fr; gap: 18px; margin-top: 10px; padding: 11px 14px; background: ${C.subtleBg}; border-radius: 8px; color: ${C.textSecondary}; break-inside: avoid; break-after: avoid; }
  .cwe-about code, .fgroup-desc code { white-space: nowrap; }
  /* Long code of a description (its .id-box): breakable at its break points
     when it does not fit on one line. */
  .cwe-about .id-box > code, .fgroup-desc .id-box > code { white-space: normal; }
  .cwe-label { font-size: 9.5px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: ${C.textMuted}; margin-bottom: 4px; }
  .cwe-prevent ul { margin: 0 0 0 14px; }
  .cwe-prevent li { margin: 0 0 3px; }
  /* Reminder of the weakness between two blocks: pulled up under the previous
     block (painted above it, opaque background); after a page break the
     negative margin is truncated and the reminder shows at the top of the page,
     in the same style as the continuation row of the shared tables. */
  .cwe-cont { height: 24px; margin-top: -14px; padding: 0 0 12px; line-height: 12px; font-size: 10px; font-weight: 600; color: ${C.dark}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; break-after: avoid; }
  /* The continuation row of a table starts from the same edge as this reminder,
     not from a cell's padding. */
  table.has-cont .cont-row th { padding: 0 0 3px; }
  .fgroup, .adv-block { position: relative; z-index: 1; background: #fff; }
  .fgroup { margin-top: 16px; }
  .adv-block { margin-top: 16px; }
  .cwe-about + .fgroup, .cwe-about + .adv-block { margin-top: 14px; }
  .cwe-cont + .fgroup { margin-top: 6px; }
  .cwe-cont + .adv-block { margin-top: 6px; }
  .adv-label, .triage-label { margin: 0; }

  .fgroup-head { display: flex; align-items: baseline; gap: 8px; break-inside: avoid; break-after: avoid; }
  .fgroup-title { flex: 1; min-width: 0; font-weight: 600; color: ${C.dark}; text-wrap: pretty; }
  .fgroup-head .chip { flex: none; }
  .fgroup-count { flex: none; font-size: 10px; color: ${C.textMuted}; white-space: nowrap; }
  /* The description breaks between two lines (orphans and widows: 3); its last
     lines stay with the table. The empty block that covers the continuation row
     moves up under the bottom of the description, painted above it: the visible
     gap before the table stays 8 px. */
  .fgroup-desc { position: relative; z-index: 2; margin-top: 5px; color: ${C.textSecondary}; break-after: avoid; break-inside: avoid; }
  .desc-cover { margin-top: 0; }
  /* Three lines minimum on each side of a break made paragraphs of 4-5 lines
     unbreakable: Chromium then broke them 3 + 1. */
  .fgroup-desc .md-p, .fgroup-desc li { orphans: 2; widows: 2; }
  .elided { color: ${C.textMuted}; white-space: nowrap; }
  /* A line range never breaks after its dash. */
  .loc-line { font-family: ${MONO_STACK}; font-size: 10px; color: ${C.textMuted}; white-space: nowrap; }
  .ai-note { font-size: 10px; line-height: 1.5; color: ${C.textSecondary}; }
  .ai-who { font-weight: 600; color: ${C.accent}; margin-right: 6px; }
  .ai-pkg { font-family: ${MONO_STACK}; margin-right: 6px; color: ${C.dark}; }
  .ai-reason, .ai-reason .md-p { display: inline; margin: 0; }
  .ai-sep { margin: 0 5px; color: ${C.textMuted}; }
  .score { margin-left: 5px; font-size: 10px; color: ${C.textSecondary}; }
  .ai-note .score { margin-right: 0; }
  table.advisories tr.adv-note td { padding-left: ${SEVERITY_COL + 10}px; }

  table.advisories td { padding-top: 5px; padding-bottom: 5px; }
  table.advisories .line + .line { margin-top: 3px; }
  /* A package row has the same height in every column (--lines: its tallest
     cell, in chip lines): a fixed version stays level with its package when one
     of the two chips wraps. */
  table.advisories .line { min-height: calc(${CHIP_LINE_PX}px * var(--lines, 1)); }
  /* Cell titles: never a single word on their last line. */
  .adv-title { font-weight: 500; color: ${C.dark}; text-wrap: pretty; }
  .adv-ids { margin-top: 1px; font-size: 10px; color: ${C.textMuted}; text-wrap: pretty; }
  .adv-ids .mono, .keep, .table-note .mono { white-space: nowrap; }
  /* Long reference of an identifier line or a note (monoText): breakable before
     its separators, even under a « keep ». */
  .table-note .mono.is-long, .adv-ids .mono.is-long { white-space: normal; }
  .adv-name { color: ${C.textSecondary}; }
  /* A triaged advisory on a line of its own: first line at the column edge, the
     following ones indented (hanging indent). A tag, an inline block, would
     inherit the negative indent and push its label out of the frame. */
  table.triaged .adv-entry { padding-left: 12px; text-indent: -12px; }
  table.triaged .adv-entry .tag { text-indent: 0; }
  /* Advisory with the same title as the row above: a sub-row of the same block,
     separated by a dotted rule from the Advisory column on (the severity column
     stays open under the shared title): the package chips of each advisory
     never stack into a single list. */
  table.advisories tr:has(+ tr.same-title) td { border-bottom: none; }
  table.advisories tr.same-title td { padding-top: 5px; }
  table.advisories tr.same-title td:not(:first-child) { border-top: 1px dashed ${C.border}; }
  tr.same-title .adv-ids { margin-top: 0; }

  table.triage-counts { width: 64%; margin-bottom: 18px; }
  table.triage-counts .zero { color: #b8b2c2; }
  table.triage-counts tr.total td { border-top: 1px solid ${C.border}; font-weight: 600; color: ${C.dark}; }
  table.triaged td { padding-top: 5px; padding-bottom: 5px; }
  .triage-title { color: ${C.text}; text-wrap: pretty; }
  table.triaged .line + .line { margin-top: 3px; }
  .also-open { margin-top: 1px; font-size: 10px; color: ${C.textMuted}; }
`;

/** Preview narrower than the PDF: package rows take their height at this width
 * (--lines-narrow), only in a report that has one (otherwise the document
 * stays as before, byte for byte). */
const CWE_NARROW_CSS = `
  @media screen and (max-width: 950px) { table.advisories .line { min-height: calc(${CHIP_LINE_PX}px * var(--lines-narrow, var(--lines, 1))); } }
`;

/** Dashboard preview only (never in the PDF): the bar panel never grows beyond
 * its share (its labels are shortened first); below 840 px, the two summary
 * panels stack. Side by side, each one kept the width of its content and the
 * bar panel overflowed the sheet. */
const CWE_PREVIEW_CSS = `
  @media screen { .grid-2.charts { grid-template-columns: 0.9fr minmax(0, 1.1fr); } .summary .hbar-label { flex-shrink: 1; min-width: 0; } }
  @media screen and (max-width: 840px) { .grid-2.charts { grid-template-columns: minmax(0, 1fr); } }
`;

/** Dashboard preview: below the window where its share of the narrower text
 * column no longer fits its chips (a short version never breaks), the Fixed in
 * column of a table takes their pixels (`--adv-fixed-narrow` of its block):
 * never narrower than its chips, never wider than its share above. One rule
 * per window. */
function fixedBreakpointsCss(body: string): string {
  const below = Array.from(
    new Set(
      Array.from(
        body.matchAll(/class="adv-block fix-below-(\d+)"/g),
        (m) => m[1],
      ),
    ),
  );
  return below
    .map(
      (px) =>
        `\n  @media screen and (max-width: ${px}px) { .fix-below-${px} { --adv-fixed: var(--adv-fixed-narrow); } }`,
    )
    .join('');
}

/** Cybe Analysis boxes in the report's tables: the box of an advisory aligns
 * with its notes, the reason of a triaged finding with the Finding column. */
const CWE_CYBE_CSS = `
  table.advisories tr.adv-note .ca-card { margin-top: 2px; }
  table.triaged tr.ca-tri-row td { padding: 0 10px 6px ${SEVERITY_COL + 10}px; }
  /* The Cybe Analysis section lengthens « About » (less than half a page): it
     stays whole, under the triaged findings if it fits, otherwise at the top of
     the next page, rather than ending the document on three sections a quarter
     of a page long. Never a forced break: it added an almost empty page
     whenever About fitted under the list. Its rule stays the one of every
     report, with or without a box: under the triaged findings, it separates it
     from the note above; at the top of a page, where Chromium truncates the
     margin (unforced break), it stays a thin line above the title, as in the
     other reports when their About opens a page. */
  section.about { break-inside: avoid; }
`;

// ── document ───────────────────────────────────────────────────────────────

/** Complete HTML document of the CWE Top 25 report. */
export function renderCweReport(
  data: CweReportData,
  opts: {
    detailed: boolean;
    forPdf: boolean;
    /** Prints the analyses the findings carry; none when absent. */
    analysis?: ReportAnalysisRenderer;
  },
): string {
  const m = buildModel(
    data,
    opts.detailed,
    !opts.forPdf,
    opts.analysis ?? NO_REPORT_ANALYSIS,
  );
  const meta = data.scanMetadata ?? { projectId: data.projectId };
  const body = [
    cover(m),
    summarySection(m),
    coverageSection(m),
    findingsSection(m),
    triagedSection(m),
    about(m),
  ]
    .filter(Boolean)
    .join('\n');
  return renderReportDocument({
    title: cweReportTitle(meta),
    forPdf: opts.forPdf,
    body: asciiOnly(body),
    // Without a printed analysis, the document stays as before, byte for byte.
    extraCss: [
      CWE_REPORT_CSS,
      m.cybe.covered || m.cybe.triage ? `${m.analysis.css}${CWE_CYBE_CSS}` : '',
      body.includes('--lines-narrow') ? CWE_NARROW_CSS : '',
      opts.forPdf ? '' : `${CWE_PREVIEW_CSS}${fixedBreakpointsCss(body)}`,
    ].join(''),
  });
}

/**
 * Same policy as `escapeHtml` for the template's own characters (·, —…): every
 * non-ASCII character travels as a numeric entity, since Puppeteer sometimes
 * ignores the declared charset (mojibake). The data are already escaped, hence
 * already ASCII.
 */
function asciiOnly(html: string): string {
  return html.replace(/[\u0080-￿]/g, (c) => `&#${c.charCodeAt(0)};`);
}
