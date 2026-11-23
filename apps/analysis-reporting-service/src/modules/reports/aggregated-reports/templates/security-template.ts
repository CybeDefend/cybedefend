// security-template.ts
//
// Aggregated OWASP Top 10 (2021) and CWE Top 25 (2024) reports: the open
// findings of several projects mapped to a reference list. Same presentation
// for both lists, only the reference data differs (see `FRAMEWORKS`).
//
// Content rules :
//  - figures count OPEN findings only; triaged ones (ignored, resolved, not
//    exploitable) are counted apart at the end, and only the critical and
//    high ones are listed there;
//  - OWASP follows the per-project OWASP report: one category per finding,
//    dependencies and container packages in A06, the others "not mapped" and
//    still counted; CWE counts the findings of the Top 25 and says how many
//    open findings carry no Top 25 weakness;
//  - every figure reconciles with the rows listed: each row has one severity
//    and says how many findings it stands for;
//  - identical findings are merged: a rule at one severity is one row, with
//    the lead sentence of its description, the files it was found in (their
//    lines, how many findings on a line) and the projects concerned; a
//    vulnerable package is one row with its versions in use and all their
//    advisories;
//  - paths are shown as scanned: one file reads the same in every row;
//  - the reference text is condensed and shown for categories with findings
//    only; the full list appears in the matrix.

import { escapeHtml } from '../../../../core/utils/html-escape';
import {
  aboutSection,
  dataTable,
  emptyState,
  kpiTiles,
  packageChip,
  pathText,
  renderCover,
  renderReportDocument,
  sectionHead,
  stateLabel,
  TableColumn,
} from '../../shared/report-layout';
import {
  breakableId,
  COLORS,
  FONT_STACK,
  idPieces,
  isLongId,
  joinShortPieces,
  LONG_ID_CHARS,
  severityBadge,
  severityColors,
  severityLabel,
  typeBadge,
  versionChip,
} from '../../shared/report-styles';
import { donutChart } from '../../shared/report-charts';
import { clampMarkdown, markdownToHtml } from '../../shared/report-markdown';
import {
  groupBy,
  highestPackageVersion,
  isActiveState,
  isDuplicateAdvisory,
  isPrereleaseVersion,
  isWithdrawnAdvisory,
  redactSecrets,
} from '../../shared/report-findings';
import { OWASP_TOP_10_2021_DATA } from '../../owasp-report/constants/owasp-data.constants';
import { CWE_TOP_25_2024_DATA } from '../../cwe-report/constants/cwe-data.constants';
import {
  AGGREGATED_CSS,
  AGGREGATED_SCREEN_CSS,
  AggregatedReportOptions,
  aggregatedCoverMeta,
  chartPanel,
  columnWidth,
  countCell,
  countTextPx,
  edgeUnitsJoined,
  EMPTY,
  emptySeverityCounts,
  flowingTable,
  fmt,
  inlineList,
  keepTogether,
  listEntry,
  normSeverity,
  plural,
  projectName,
  projectNames,
  projectRows,
  rowCount,
  safe,
  scopeEyebrow,
  Severity,
  SEVERITY_RANK,
  sharedBranch,
  splitBars,
  summaryFacts,
  TableRow,
  tableTitle,
  versionItem,
  versionPartChars,
  versionsShare,
  WHOLE_TABLE,
  wholeName,
  byVersion,
} from './aggregated-common';

// ── Reference lists ─────────────────────────────────────────────────────────

interface FrameworkCategory {
  id: string;
  /** Category title. */
  title: string;
  /** Sur-titre of the category (code, rank). */
  eyebrow: string;
  /** MITRE rank (CWE only). */
  rank?: number;
  /** Condensed reference description (HTML). */
  descriptionHtml: string;
  /** « How to prevent » measures and the source link (HTML). */
  preventionHtml: string;
}

interface Framework {
  key: 'owasp' | 'cwe';
  /** `OWASP Top 10` / `CWE Top 25`. */
  name: string;
  reportTitle: string;
  eyebrowEdition: string;
  /** `category` / `weakness`. */
  noun: string;
  nouns: string;
  subtitle: (projects: number) => string;
  categories: FrameworkCategory[];
  /** Id of a category object returned by the aggregation. */
  idOf: (category: any) => string;
  /**
   * OWASP counts an open finding outside the list as "not mapped"; CWE keeps
   * the figures to the Top 25 and only says how many fall outside.
   */
  countsUnmapped: boolean;
  /** Mapping rules, for the closing section. */
  aboutText: string;
}

/** Straight apostrophes of the reference texts made typographic. */
const typographic = (s: string): string =>
  s.replace(/(\w)'(\w)/g, '$1’$2').replace(/'([^']+)'/g, '‘$1’');

/** OWASP reference text: the shared condensed brief, key measures, link. */
function owaspFramework(): Framework {
  const categories = Object.values(OWASP_TOP_10_2021_DATA)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map<FrameworkCategory>((c) => ({
      id: c.id,
      title: c.title,
      eyebrow: c.code,
      descriptionHtml: `<p>${escapeHtml(typographic(c.brief))}</p>`,
      // The OWASP address is long: the link reads the category code.
      preventionHtml: preventionHtml(
        c.keyPrevention,
        'OWASP reference',
        c.url,
        c.code,
      ),
    }));
  return {
    key: 'owasp',
    name: 'OWASP Top 10',
    reportTitle: 'OWASP Top 10 report',
    eyebrowEdition: 'OWASP Top 10 · 2021',
    noun: 'category',
    nouns: 'categories',
    subtitle: (n) =>
      `Open findings of ${plural(n, 'project')} mapped to the OWASP Top 10 (2021 edition)`,
    categories,
    idOf: (c) => c?.categoryData?.id,
    countsUnmapped: true,
    aboutText:
      'Each finding is placed in exactly one OWASP Top 10 2021 category, as in the per-project OWASP report: vulnerable dependencies and container packages belong to A06 (Vulnerable and Outdated Components); any other finding goes to the category set by its detection rule, otherwise to the category whose official CWE list contains its CWE. Findings that match neither rule are reported as not mapped and count in the totals.',
  };
}

/**
 * Prevention measures of a reference, and its source link, named by `label`
 * or else by its address.
 */
function preventionHtml(
  measures: readonly string[] | undefined,
  source: string,
  url: string,
  label?: string,
): string {
  const list = (measures ?? []).filter(Boolean);
  // The source link shares the line of the measures' label.
  const link = `<span class="ref-link">${escapeHtml(source)}: <a href="${escapeHtml(url)}">${escapeHtml(label ?? readableUrl(url))}</a></span>`;
  return `<div class="ref-title"><span>${list.length ? 'How to prevent' : ''}</span>${link}</div>${
    list.length
      ? `<ul>${list
          .map((m) => `<li>${escapeHtml(typographic(m))}</li>`)
          .join('')}</ul>`
      : ''
  }`;
}

/** URL as a reader types it: no scheme, no percent-encoding (`(SSRF)`). */
function readableUrl(url: string): string {
  const bare = url.replace(/^https?:\/\//, '');
  try {
    return decodeURI(bare);
  } catch {
    return bare;
  }
}

function trendText(trend: string, change: number): string {
  if (trend === 'up') return `up ${plural(Math.abs(change), 'place')}`;
  if (trend === 'down') return `down ${plural(Math.abs(change), 'place')}`;
  return 'stable';
}

/**
 * Plain words for the weaknesses MITRE names by an acronym, and for the ones
 * whose short name would read as a practice (« Input validation »).
 */
const CWE_PLAIN_NAMES: Record<string, string> = {
  // With the acronym of the official name, which then says nothing more.
  'CWE-352': 'Cross-site request forgery (CSRF)',
  'CWE-918': 'Server-side request forgery (SSRF)',
  'CWE-20': 'Improper input validation',
  'CWE-269': 'Improper privilege management',
};

/** Plain-words name of a weakness (`SQL injection`). */
const cweShortName = (c: {
  id: string;
  name: string;
  shortName?: string;
}): string => CWE_PLAIN_NAMES[c.id] ?? c.shortName ?? c.name;

function cweFramework(): Framework {
  const categories = Object.values(CWE_TOP_25_2024_DATA)
    .sort((a, b) => a.rank - b.rank)
    .map<FrameworkCategory>((c) => {
      const number = c.id.replace(/^CWE-/, '');
      const short = cweShortName(c);
      // The official name on its own line, then the statistics, each whole:
      // a separator never ends or starts a line. The 2024 rank heads the
      // section: the line gives last year's.
      const name =
        short.toLowerCase() === c.name.toLowerCase()
          ? ''
          : `<span class="ref-name">${escapeHtml(typographic(c.name))}</span>`;
      const stats = [
        `<span class="nw">${escapeHtml(`#${c.rankLastYear} in 2023 (${trendText(c.trend, c.trendChange)})`)}</span>`,
        `<span class="nw">${escapeHtml(
          c.kevCount > 0
            ? `${plural(c.kevCount, 'known exploited CVE')} (CISA KEV)`
            : 'no known exploited CVE (CISA KEV)',
        )}</span>`,
      ].join(' <span class="sep">&middot;</span> ');
      return {
        id: c.id,
        title: short,
        eyebrow: `${c.id} · Rank ${c.rank}`,
        rank: c.rank,
        descriptionHtml: `<p class="ref-meta">${name}<span class="ref-stats">${stats}</span></p><p>${escapeHtml(typographic(clampMarkdown(c.description, 400).text))}</p>`,
        preventionHtml: preventionHtml(
          c.mitigations,
          'MITRE reference',
          `https://cwe.mitre.org/data/definitions/${number}.html`,
        ),
      };
    });
  return {
    key: 'cwe',
    name: 'CWE Top 25',
    reportTitle: 'CWE Top 25 report',
    eyebrowEdition: 'CWE Top 25 · 2024',
    noun: 'weakness',
    nouns: 'weaknesses',
    subtitle: (n) =>
      `Open findings of ${plural(n, 'project')} mapped to the 2024 CWE Top 25 Most Dangerous Software Weaknesses`,
    categories,
    idOf: (c) => c?.cweData?.id,
    countsUnmapped: false,
    aboutText:
      'Code findings are mapped through the CWE identifiers of their rule, and dependency and container advisories through those of their advisory (GHSA, NVD), as in the per-project CWE report; an advisory that names no CWE falls outside this list. A finding counts only when its rule or advisory names one of the 25 identifiers exactly: related weaknesses are not folded in (CWE-95 is not counted under CWE-94, nor CWE-770 under CWE-400). A finding matching several weaknesses counts once in the totals.',
  };
}

/** Pseudo-category of the open OWASP findings outside the Top 10. */
const NOT_MAPPED: FrameworkCategory = {
  id: 'none',
  title: 'Not mapped to the OWASP Top 10',
  eyebrow: 'Outside the Top 10',
  descriptionHtml: '',
  preventionHtml: '',
};

// ── Model ───────────────────────────────────────────────────────────────────

interface Finding {
  id: string;
  type: string;
  name: string;
  description: string;
  severity: Severity;
  state: string;
  open: boolean;
  /** Path as scanned, shown as such. */
  path: string;
  line: string;
  packageName: string;
  packageVersion: string;
  fixedVersion: string;
  advisory: string;
  /** Advisory withdrawn by its publisher: counted, flagged, never a fix. */
  withdrawn: boolean;
  /** Withdrawn as a duplicate of another advisory. */
  duplicate: boolean;
  /** Image a container finding was found in ('' otherwise). */
  image: string;
  projectKey: string;
  projectName: string;
  branch: string;
}

const isDependency = (f: Finding) => f.type === 'sca' || f.type === 'container';

function toFinding(raw: any, index: number): Finding {
  const path = String(raw?.path ?? '');
  const type = String(raw?.type ?? '').toLowerCase();
  const name = String(raw?.name ?? 'Unknown');
  const description = String(raw?.description ?? '');
  // An advisory: withdrawn per its OSV record, else per its title or text,
  // as in the per-project reports.
  const advisory = type === 'sca' || type === 'container';
  const withdrawn =
    advisory &&
    (raw?.withdrawn === true || isWithdrawnAdvisory(name, description));
  return {
    id: String(raw?.id ?? `row-${index}`),
    type,
    name,
    description,
    severity: normSeverity(raw?.severity),
    state: String(raw?.state ?? '').toLowerCase(),
    open: isActiveState(raw?.state),
    path,
    line: String(raw?.line ?? '')
      .replace(/^(\d+)-\1$/, '$1')
      .replace(/^(?:undefined|null|0)(?:-.*)?$/, '')
      .replace(/^(\d+)-(\d+)$/, '$1–$2'),
    packageName: String(raw?.packageName ?? ''),
    packageVersion: String(raw?.packageVersion ?? ''),
    fixedVersion: String(raw?.fixedVersion ?? ''),
    advisory: String(raw?.cve || raw?.advisoryId || raw?.name || ''),
    withdrawn,
    duplicate: withdrawn && isDuplicateAdvisory(name, description),
    image: type === 'container' ? String(raw?.image ?? '') : '',
    projectKey: String(raw?.projectId || raw?.projectName || ''),
    projectName: String(raw?.projectName ?? ''),
    branch: String(raw?.branch ?? ''),
  };
}

interface CategoryModel {
  cat: FrameworkCategory;
  open: Finding[];
  triaged: Finding[];
  bySeverity: Record<Severity, number>;
  projects: Set<string>;
}

interface ProjectModel {
  key: string;
  name: string;
  team: string;
  branches: Set<string>;
  bySeverity: Record<Severity, number>;
  open: number;
  triaged: number;
  perCategory: Map<string, number>;
}

interface SecurityModel {
  categories: CategoryModel[];
  /** OWASP: open or triaged findings outside the Top 10 (counted). */
  unmapped: CategoryModel | null;
  /** Open findings counted in the figures. */
  open: Finding[];
  triaged: Finding[];
  bySeverity: Record<Severity, number>;
  /** CWE: open findings outside the Top 25 (not counted). */
  outside: Finding[];
  projects: ProjectModel[];
  branches: string[];
  /** Container findings scanned from an image, without a branch. */
  images: boolean;
  categoriesOf: Map<string, string[]>;
  /** Reference texts shown (the summary variant drops them). */
  detailed: boolean;
}

function categoryModel(
  cat: FrameworkCategory,
  findings: Finding[],
): CategoryModel {
  const open = findings.filter((f) => f.open);
  const bySeverity = emptySeverityCounts();
  for (const f of open) bySeverity[f.severity]++;
  return {
    cat,
    open,
    triaged: findings.filter((f) => !f.open),
    bySeverity,
    projects: new Set(open.map((f) => f.projectKey)),
  };
}

function buildModel(
  framework: Framework,
  data: any,
  detailed: boolean,
): SecurityModel {
  const byId = new Map<string, any>();
  for (const c of data?.categories ?? []) byId.set(framework.idOf(c), c);

  const listed = new Map<string, Finding>();
  const categoriesOf = new Map<string, string[]>();
  let index = 0;
  const categories = framework.categories.map<CategoryModel>((cat) => {
    const seen = new Set<string>();
    const findings: Finding[] = [];
    for (const raw of byId.get(cat.id)?.vulnerabilities ?? []) {
      const f = listed.get(String(raw?.id)) ?? toFinding(raw, index++);
      if (seen.has(f.id)) continue;
      seen.add(f.id);
      findings.push(f);
      listed.set(f.id, f);
      categoriesOf.set(f.id, [...(categoriesOf.get(f.id) ?? []), cat.id]);
    }
    return categoryModel(cat, findings);
  });

  const others = (data?.vulnerabilities ?? [])
    .map((raw: any, i: number) => toFinding(raw, i))
    .filter((f: Finding) => !listed.has(f.id));
  const unmapped = framework.countsUnmapped
    ? categoryModel(NOT_MAPPED, others)
    : null;
  if (unmapped) {
    for (const f of others) categoriesOf.set(f.id, [NOT_MAPPED.id]);
  }
  const counted = [...listed.values(), ...(unmapped ? others : [])];
  const open = counted.filter((f) => f.open);
  const triaged = counted.filter((f) => !f.open);
  const outside = unmapped ? [] : others.filter((f: Finding) => f.open);

  const bySeverity = emptySeverityCounts();
  for (const f of open) bySeverity[f.severity]++;

  // Every project in scope, with or without findings.
  const projects = new Map<string, ProjectModel>();
  const project = (key: string, name: string, team = ''): ProjectModel => {
    let p = projects.get(key);
    if (!p) {
      p = {
        key,
        name,
        team,
        branches: new Set(),
        bySeverity: emptySeverityCounts(),
        open: 0,
        triaged: 0,
        perCategory: new Map(),
      };
      projects.set(key, p);
    }
    return p;
  };
  for (const meta of data?.projectsMetadata ?? []) {
    project(String(meta.id || meta.name), meta.name ?? '', meta.teamName ?? '');
  }
  const branches = new Set<string>();
  for (const f of counted) {
    const p = project(f.projectKey, f.projectName);
    if (!p.name) p.name = f.projectName;
    if (f.branch) p.branches.add(f.branch);
    branches.add(f.branch);
    if (f.open) {
      p.open++;
      p.bySeverity[f.severity]++;
      for (const id of categoriesOf.get(f.id) ?? []) {
        p.perCategory.set(id, (p.perCategory.get(id) ?? 0) + 1);
      }
    } else {
      p.triaged++;
    }
  }
  for (const f of outside) branches.add(f.branch);

  const ordered = Array.from(projects.values()).sort(
    (a, b) =>
      b.bySeverity.critical - a.bySeverity.critical ||
      b.bySeverity.high - a.bySeverity.high ||
      b.open - a.open ||
      a.name.localeCompare(b.name),
  );

  return {
    categories,
    unmapped,
    open,
    triaged,
    bySeverity,
    outside,
    projects: ordered,
    branches: Array.from(branches).sort(),
    // Same scope as the branches: the findings outside the list count too.
    images: [...counted, ...outside].some(
      (f) => f.type === 'container' && !f.branch,
    ),
    categoriesOf,
    detailed,
  };
}

// ── Rendering helpers ───────────────────────────────────────────────────────

const SEVERITY_ORDER: Severity[] = [
  'critical',
  'high',
  'medium',
  'low',
  'unknown',
];

/** Severity tiles and donut: Unknown only when some finding needs it. */
function severityKeys(counts: Record<Severity, number>): Severity[] {
  return SEVERITY_ORDER.filter((s) => s !== 'unknown' || counts.unknown > 0);
}

/**
 * Severity columns of a table: the severities some of its findings have,
 * never a column of dashes (the tiles above still show a greyed 0).
 */
function columnKeys(counts: Record<Severity, number>): Severity[] {
  return SEVERITY_ORDER.filter((s) => counts[s] > 0);
}

// Each column as wide as its header (9.5px capitals) and the cell padding
// need: a header never runs past its column.
const SEVERITY_WIDTHS: Record<Severity, string> = {
  critical: '10%',
  high: '6.6%',
  medium: '8.8%',
  low: '6.2%',
  unknown: '10%',
};

// The matrix's count columns: header width plus 10px (no left padding).
const MATRIX_SEVERITY_WIDTHS: Record<Severity, string> = {
  critical: '8.6%',
  high: '5.4%',
  medium: '7.6%',
  low: '4.7%',
  unknown: '8.4%',
};

/** A count of a column and whether it is set in semibold (a total). */
interface CountText {
  text: string;
  bold: boolean;
}

/** Counts of a column: the rows' `counts`, then the total row's (semibold). */
const countTexts = (
  counts: number[],
  total: number | string,
  bold = false,
): CountText[] => [
  ...counts.filter(Boolean).map((n) => ({ text: fmt(n), bold })),
  { text: typeof total === 'number' ? fmt(total) : total, bold: true },
];

/**
 * The room (px) a count column needs: its widest count on one line (in a
 * `box` of `box.min` px at least, `box.pad` px of padding, for a shaded
 * count of the heat map), and the cell's padding (`pad`). A count never
 * breaks between two digits (« 1,26 / 8 »): a column sized on its header
 * widens rather than break it (columnWidth).
 */
function countFloor(
  counts: CountText[],
  pad: number,
  box?: { min: number; pad: number },
): number {
  const widths = counts.map((c) => {
    const w = countTextPx(c.text, c.bold);
    return box ? Math.max(box.min, w + box.pad) : w;
  });
  return Math.max(0, ...widths) + pad;
}

// Padding of a count cell: both sides in the projects and triaged tables,
// the right one only in the matrix (SECURITY_CSS).
const COUNT_PAD = 16;
const MATRIX_COUNT_PAD = 8;

/** A count column: its share, and never narrower than its widest count. */
const countColumn = (
  label: string,
  width: string,
  counts: CountText[],
  pad: number,
  className?: string,
): TableColumn => ({
  label,
  width: columnWidth(parseFloat(width), { min: countFloor(counts, pad) }),
  align: 'right',
  ...(className ? { className } : {}),
});

const categoryLabel = (c: FrameworkCategory): string =>
  c.id === NOT_MAPPED.id ? c.title : `${c.id} ${c.title}`;

// A finding without a severity reads « Unrated » (shared label).
const sevName = (s: Severity): string => severityLabel(s);
const sevBadge = (s: Severity): string => severityBadge(s);

/** `18 critical, 27 high, 7 medium`. */
function severityBreakdown(counts: Record<Severity, number>): string {
  return SEVERITY_ORDER.filter((s) => counts[s] > 0)
    .map((s) => `${fmt(counts[s])} ${sevName(s).toLowerCase()}`)
    .join(', ');
}

function severitySummary(counts: Record<Severity, number>): string {
  return SEVERITY_ORDER.filter((s) => counts[s] > 0)
    .map((s) => `<span class="sev">${sevBadge(s)}${fmt(counts[s])}</span>`)
    .join('');
}

/** Most severe of a list of findings. */
const highest = (findings: Finding[]): Severity =>
  findings.reduce<Severity>(
    (s, f) => (SEVERITY_RANK[f.severity] < SEVERITY_RANK[s] ? f.severity : s),
    'unknown',
  );

// Words that open the phrase after the noun group of a rule title
// (« …Forgery via Unvalidated URL », « …HTTP Instead of HTTPS… »), and the
// participles that open what the subject does, lacks or leads to (« …XML
// Parsing Leading to XXE », « S3 Bucket Missing Access Logging… »). « of »
// and « to » are left out: they sit inside the group more often than not
// (« Use of », « Access to »).
const PHRASE_WORD =
  /^(?:via|in|for|on|with|without|using|through|within|from|into|inside|across|over|under|instead|leading|causing|allowing|resulting|missing|lacking|running)$/i;

// Verbs that end the subject of a rule title (« IAM Policies Allow /
// Unconstrained Permissions Management »): the object follows them.
const SUBJECT_VERB =
  /^(?:allows?|grants?|exposes?|enables?|permits?|leaks?|disables?)$/i;

// What goes wrong, at the end of a title with neither phrase nor verb
// (« Host PID Namespace Sharing Privilege Escalation »): the line breaks
// before the last two words, never inside the subject.
const RESULT_NOUN =
  /^(?:escalation|misconfiguration|vulnerability|exposure|injection|exfiltration)$/i;

/**
 * Characters of an 11px rule title on a line of a Rule column `pct` % of
 * the table (about 6.1px a character, the cell padding left out).
 */
const titleChars = (pct: number): number =>
  Math.floor(((TABLE_PX * pct) / 100 - 16) / 6.1);

/**
 * Rule title: a command-line option (`--no-install-recommends`) stays
 * whole, a product name with a number stays with its noun (« S3 Bucket »),
 * a compound preposition stays whole (« Instead of »), and so do a kind of
 * access (« Public Read Access ») and « as » with its word (« as Root »).
 * A title whose noun group is followed by a phrase (« Server-Side Request
 * Forgery via Unvalidated URL »), whose subject ends on a verb (« IAM
 * Policies Allow Unconstrained… »), or else that ends on what goes wrong
 * (« …Sharing Privilege Escalation »), is set in two parts, when each fits
 * a line of `chars` characters: a title too long for one line then breaks
 * between them, never inside a group (« Server-Side Request / Forgery
 * via… »), and never leaves one word alone.
 */
function ruleName(name: string, chars: number): string {
  // Words held together by a no-break space: one unit when cutting.
  const glued = redactSecrets(name)
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\b([A-Z][A-Z0-9]*\d) (?=[A-Za-z])/g, '$1 ')
    .replace(/\b(instead|because|due|prior) (of|to)\b/gi, '$1 $2')
    .replace(
      /\b(?:(public|private|anonymous) )?(read|write|admin|root) (access)\b/gi,
      (_m, kind: string | undefined, right: string, access: string) =>
        `${kind ? `${kind} ` : ''}${right} ${access}`,
    )
    .replace(/\b(as) (?=\w)/gi, '$1 ');
  // The escaping writes a no-break space as `&#160;`.
  const part = (units: string[]) =>
    safe(units.join(' '))
      .replace(/(^|\s)(--?[\w-]+)/g, '$1<span class="nw">$2</span>')
      .replace(/&#160;/g, '&nbsp;');
  const units = glued.split(' ');
  const words = (list: string[]) => list.join(' ').split(/[  ]/).length;
  const firstWord = (unit: string) => unit.split(' ')[0];
  // Two parts, each whole on a line of `chars`, neither a word alone.
  const split = (cut: number): string | null => {
    const head = units.slice(0, cut);
    const tail = units.slice(cut);
    if (words(head) < 2 || words(tail) < 2) return null;
    if (head.join(' ').length > chars || tail.join(' ').length > chars) {
      return null;
    }
    return `<span class="name"><span class="ph">${part(head)}</span> <span class="ph">${part(tail)}</span></span>`;
  };
  let phrase = false;
  for (let k = 1; k < units.length; k++) {
    // The second part opens on the phrase word, or right after the verb.
    const word = firstWord(units[k]);
    const cut = PHRASE_WORD.test(word)
      ? k
      : SUBJECT_VERB.test(word)
        ? k + 1
        : 0;
    if (!cut) continue;
    phrase = true;
    // A head too long for a line only grows further on.
    if (units.slice(0, cut).join(' ').length > chars) break;
    const set = split(cut);
    if (set) return set;
  }
  if (
    !phrase &&
    units.length > 2 &&
    RESULT_NOUN.test(units[units.length - 1])
  ) {
    const set = split(units.length - 2);
    if (set) return set;
  }
  return `<span class="name">${part(units)}</span>`;
}

/**
 * Rule or package cell: its label, then its scanner chip and projects on the
 * line below (the chip there leaves the label the whole column).
 */
const labelled = (label: string, type: string, sub: string): string =>
  `${label}<span class="sub typed">${typeBadge(type)}<span class="who">${sub}</span></span>`;

const OPEN_WORDS: Record<string, string> = {
  sast: 'code',
  iac: 'infrastructure',
  sca: 'dependency',
  container: 'container',
  secret: 'secret',
  cicd: 'CI/CD',
};

/** First letter in upper case (`code and infrastructure` → `Code…`). */
const capitalize = (text: string): string =>
  text.charAt(0).toUpperCase() + text.slice(1);

/** `a, b and c`. */
const andList = (items: string[]): string =>
  items.length <= 1
    ? items.join('')
    : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

// ── Executive summary ───────────────────────────────────────────────────────

/**
 * The top five share one scale while the smallest total is at least this
 * share of the largest; below, each bar shows its own severity mix.
 */
const SHARED_SCALE_RATIO = 0.25;

/** Upgrades named by the summary at most. */
const MAX_UPGRADES = 5;

/**
 * What one upgrade is: the rows of a package name, whatever their scanner
 * and image (upgrading form-data means upgrading it in the manifests and in
 * the image alike), and the container packages that share an advisory,
 * built from the same source (an advisory open in imagemagick and in
 * libmagickcore-6.q16-6, in one image or two, closes only when all are
 * upgraded: the source package is).
 */
function upgradeUnits(groups: PackageGroup[]): PackageGroup[][] {
  const parent = groups.map((_, i) => i);
  const root = (i: number): number =>
    parent[i] === i ? i : (parent[i] = root(parent[i]));
  const join = (a: number, b: number) => {
    parent[root(a)] = root(b);
  };
  const first = new Map<string, number>();
  groups.forEach((g, i) => {
    const keys = [
      `name\u0000${g.name}`,
      ...(g.type === 'container'
        ? liveAdvisories(g).map((id) => `advisory\u0000${id}`)
        : []),
    ];
    for (const key of keys) {
      const known = first.get(key);
      if (known === undefined) first.set(key, i);
      else join(i, known);
    }
  });
  const units = new Map<number, PackageGroup[]>();
  groups.forEach((g, i) => {
    const r = root(i);
    units.set(r, [...(units.get(r) ?? []), g]);
  });
  return Array.from(units.values());
}

/** Advisories of a package group that are not withdrawn. */
const liveAdvisories = (g: PackageGroup): string[] =>
  Array.from(g.advisories.keys()).filter((id) => !g.withdrawn.has(id));

/**
 * `imagemagick (and 2 related packages)`: the shortest name of an upgrade
 * (the source package, as a rule), the others counted, in parentheses: a
 * list of upgrades still reads as one. A long name (a scoped package)
 * breaks before its separators.
 */
function upgradeName(unit: PackageGroup[]): string {
  const names = Array.from(new Set(unit.map((g) => g.name))).sort(
    (a, b) => a.length - b.length || a.localeCompare(b),
  );
  const name = isLongId(names[0]) ? wholeName(names[0]) : safe(names[0]);
  const others = names.length - 1;
  return others ? `${name} (and ${plural(others, 'related package')})` : name;
}

/**
 * Upgrades that close the most advisories. An advisory is closed only by
 * upgrading every package it is open in, each to a version that fixes it:
 * one left open elsewhere (another image, a package without a fix) is not
 * closed, and one open in two upgraded packages counts once. Upgrades are
 * chosen one at a time, each the one that closes the most advisories more.
 */
function bestUpgrades(model: SecurityModel): {
  names: string[];
  closes: number;
  critical: number;
} | null {
  const units = upgradeUnits(groupPackages(model.open.filter(isDependency)));
  const unitOf = new Map<PackageGroup, number>();
  units.forEach((unit, u) => unit.forEach((g) => unitOf.set(g, u)));
  // Each live advisory: the upgrades it is open in, whether each of its
  // packages has a fix for it, its most severe rating.
  const advisories = new Map<
    string,
    { units: Set<number>; fixable: boolean; severity: Severity }
  >();
  for (const [g, u] of unitOf) {
    for (const id of liveAdvisories(g)) {
      const a = advisories.get(id) ?? {
        units: new Set<number>(),
        fixable: true,
        severity: 'unknown' as Severity,
      };
      a.units.add(u);
      a.fixable = a.fixable && g.fixed.has(id);
      const severity = g.advisories.get(id);
      if (SEVERITY_RANK[severity] < SEVERITY_RANK[a.severity]) {
        a.severity = severity;
      }
      advisories.set(id, a);
    }
  }
  const chosen = new Set<number>();
  const closed = new Set<string>();
  // Advisories closed by adding upgrade `u` to those chosen.
  const gain = (u: number): string[] =>
    Array.from(advisories)
      .filter(
        ([id, a]) =>
          !closed.has(id) &&
          a.fixable &&
          a.units.has(u) &&
          Array.from(a.units).every((v) => v === u || chosen.has(v)),
      )
      .map(([id]) => id);
  const critical = (ids: string[]) =>
    ids.filter((id) => advisories.get(id).severity === 'critical').length;
  const size = (u: number) =>
    new Set(units[u].flatMap((g) => liveAdvisories(g))).size;
  // The upgrade that closes the most advisories more, then the most
  // critical ones, then the one with the most advisories, then by name.
  const better = (
    a: { u: number; ids: string[] },
    b: { u: number; ids: string[] },
  ): boolean =>
    (a.ids.length - b.ids.length ||
      critical(a.ids) - critical(b.ids) ||
      size(a.u) - size(b.u) ||
      upgradeName(units[b.u]).localeCompare(upgradeName(units[a.u]))) > 0;
  const order: number[] = [];
  while (order.length < MAX_UPGRADES) {
    let best: { u: number; ids: string[] } | null = null;
    for (let u = 0; u < units.length; u++) {
      if (chosen.has(u)) continue;
      const candidate = { u, ids: gain(u) };
      if (candidate.ids.length && (!best || better(candidate, best))) {
        best = candidate;
      }
    }
    if (!best) break;
    chosen.add(best.u);
    order.push(best.u);
    best.ids.forEach((id) => closed.add(id));
  }
  if (closed.size < 2) return null;
  return {
    names: order.map((u) => upgradeName(units[u])),
    closes: closed.size,
    critical: critical(Array.from(closed)),
  };
}

/**
 * « 8 open findings come from 4 withdrawn advisories (2 duplicates), flagged
 * in A06 and still counted. »: one advisory gives a finding per project and
 * version, so both are counted.
 */
function withdrawnFact(model: SecurityModel): string {
  const withdrawn = model.open.filter((f) => f.withdrawn);
  const n = withdrawn.length;
  if (!n) return '';
  const advisories = new Set(withdrawn.map((f) => f.advisory)).size;
  const duplicates = new Set(
    withdrawn.filter((f) => f.duplicate).map((f) => f.advisory),
  ).size;
  const aside = !duplicates
    ? ''
    : duplicates === advisories
      ? advisories === 1
        ? ' (a duplicate)'
        : advisories === 2
          ? ' (both duplicates)'
          : ' (all duplicates)'
      : ` (${plural(duplicates, 'duplicate')})`;
  const where = andList(
    Array.from(
      new Set(withdrawn.flatMap((f) => model.categoriesOf.get(f.id) ?? [])),
    ).map((id) =>
      id === NOT_MAPPED.id
        ? 'Not mapped'
        : `<span class="code">${escapeHtml(id)}</span>`,
    ),
  );
  const source =
    advisories === 1
      ? n === 1
        ? 'a withdrawn advisory'
        : '1 withdrawn advisory'
      : `${fmt(advisories)} withdrawn advisories`;
  return n === 1
    ? `1 open finding comes from ${source}${aside}, flagged in ${where} and still counted.`
    : `${fmt(n)} open findings come from ${source}${aside}, flagged in ${where} and still counted.`;
}

function renderSummary(framework: Framework, model: SecurityModel): string {
  const total = model.open.length;
  const hit = model.categories.filter((c) => c.open.length > 0);
  // The tiles add up to the total: an Unknown tile only when needed.
  const tiles = [
    { label: 'Open findings', value: fmt(total) },
    ...severityKeys(model.bySeverity).map((s) => ({
      label: sevName(s),
      value: fmt(model.bySeverity[s]),
      severity: s,
    })),
  ];

  const donut = donutChart(
    severityKeys(model.bySeverity).map((s) => ({
      label: sevName(s),
      value: model.bySeverity[s],
      color: severityColors(s).solid,
    })),
    { centerLabel: 'open' },
  );
  const ranked = [...hit].sort((a, b) => b.open.length - a.open.length);
  const top = ranked.slice(0, 5);
  const rest = ranked.slice(5);
  // The line under the bars accounts for every open finding.
  const unmappedOpen = model.unmapped?.open.length ?? 0;
  const restLine = [
    rest.length
      ? `+${plural(rest.length, `more ${framework.noun}`, `more ${framework.nouns}`)} &middot; ${plural(
          rest.reduce((n, c) => n + c.open.length, 0),
          'finding',
        )}`
      : '',
    unmappedOpen ? `${fmt(unmappedOpen)} not mapped` : '',
  ]
    .filter(Boolean)
    .join(' &middot; ');
  // The severity colours are the donut's, whose legend is beside. Totals
  // too far apart for one scale (A06 at 653, the next at 52) would leave the
  // other bars stubs whose mix no one can read: each bar then spans the
  // track, its total written beside.
  const totals = top.map((c) => c.open.length);
  const comparable =
    Math.min(...totals) >= SHARED_SCALE_RATIO * Math.max(...totals);
  // Bars of one length would read as equal volumes: how to read them comes
  // before them, the count of the others after them.
  const mix = `${
    comparable
      ? ''
      : '<p class="small split-note">Each bar shows the severity mix of its category.</p>'
  }${splitBars(
    top.map((c) => ({
      id: c.cat.id,
      label: c.cat.title,
      parts: SEVERITY_ORDER.map((s) => ({
        label: sevName(s),
        value: c.bySeverity[s],
        color: severityColors(s).solid,
      })),
    })),
    { scale: comparable ? 'shared' : 'row' },
  )}${restLine ? `<p class="small split-more">${restLine}</p>` : ''}`;

  const facts: string[] = [];
  // The bars already rank the categories: the first fact says where the
  // critical findings are.
  const mostCritical = [
    ...hit,
    ...(model.unmapped && model.unmapped.open.length ? [model.unmapped] : []),
  ]
    .filter((c) => c.bySeverity.critical > 0)
    .sort(
      (a, b) =>
        b.bySeverity.critical - a.bySeverity.critical ||
        b.open.length - a.open.length,
    )[0];
  if (mostCritical) {
    // The id set as in the bars beside.
    const cat = mostCritical.cat;
    const label =
      cat.id === NOT_MAPPED.id
        ? escapeHtml(cat.title)
        : `<span class="code">${escapeHtml(cat.id)}</span> ${escapeHtml(cat.title)}`;
    facts.push(
      `${label} has the most critical findings: ${fmt(mostCritical.bySeverity.critical)} of its ${plural(mostCritical.open.length, 'open finding')}.`,
    );
  }
  const upgrade = bestUpgrades(model);
  if (upgrade) {
    facts.push(
      `Upgrading ${andList(upgrade.names)} closes ${plural(upgrade.closes, 'advisory', 'advisories')}${upgrade.critical ? `, ${fmt(upgrade.critical)} of them critical` : ''}.`,
    );
  } else if (total > 0) {
    const critical = model.open.filter((f) => f.severity === 'critical');
    const confirmed = critical.filter((f) => f.state === 'confirmed').length;
    facts.push(
      critical.length
        ? `${plural(critical.length, 'critical finding')}, ${fmt(confirmed)} of them confirmed after review.`
        : 'No critical finding is open.',
    );
  }
  // The projects table below ranks the projects: the fact says how much of
  // the most severe findings the first one holds.
  const exposed = model.projects.find((p) => p.open > 0);
  if (exposed && model.projects.filter((p) => p.open > 0).length > 1) {
    const worst: Severity = exposed.bySeverity.critical ? 'critical' : 'high';
    const held = exposed.bySeverity[worst];
    // Opened on the figures: a project name in lower case never starts a
    // sentence.
    if (held > 0) {
      facts.push(
        `Of the ${fmt(model.bySeverity[worst])} ${worst} findings, ${fmt(held)} (${Math.round((held / model.bySeverity[worst]) * 100)}%) are in ${projectName(exposed.name)}.`,
      );
    }
  }
  if (model.unmapped && model.unmapped.open.length > 0) {
    const n = model.unmapped.open.length;
    facts.push(
      `${plural(n, 'open finding')} (${severityBreakdown(model.unmapped.bySeverity)}) ${n === 1 ? 'matches' : 'match'} no ${framework.name} category; ${n === 1 ? 'it is' : 'they are'} listed under Not mapped.`,
    );
  }
  const withdrawn = withdrawnFact(model);
  if (withdrawn) facts.push(withdrawn);
  if (model.outside.length > 0) {
    const n = model.outside.length;
    facts.push(
      n === 1
        ? `1 other open finding (${OPEN_WORDS[model.outside[0].type] ?? safe(model.outside[0].type)}) carries no Top 25 weakness.`
        : `${fmt(n)} other open findings carry no Top 25 weakness: ${families(model.outside).join(', ')}.`,
    );
  }

  const aside = `${plural(total, 'open finding')} · ${fmt(model.triaged.length)} triaged, excluded`;
  const mixTitle = `${top.length < ranked.length || ranked.length === 5 ? 'Top 5 ' : ''}${framework.nouns} by open findings`;
  return `<section class="section">
${sectionHead({ title: 'Executive summary', aside })}
${kpiTiles(tiles, { leadWidth: 1.6 })}
${
  total > 0
    ? `<div class="grid-2 summary-charts">
  ${chartPanel('Open findings by severity', donut)}
  ${chartPanel(`${mixTitle.charAt(0).toUpperCase()}${mixTitle.slice(1)}`, mix)}
</div>`
    : `<div class="summary-charts">${emptyState(`No open finding maps to the ${framework.name}.`)}</div>`
}
${summaryFacts(facts)}
</section>`;
}

// ── Projects and matrix ─────────────────────────────────────────────────────

function renderProjects(model: SecurityModel): string {
  const keys = columnKeys(model.bySeverity);
  // A branch every project shares is named on the cover only.
  const oneBranch = sharedBranch(model.projects.map((p) => p.branches));
  const rows: TableRow[] = model.projects.flatMap((p) =>
    projectRows(
      { name: p.name, team: p.team, branches: oneBranch ? [] : p.branches },
      [
        ...keys.map((k) => countCell(p.bySeverity[k])),
        p.open ? `<strong>${fmt(p.open)}</strong>` : countCell(0),
        countCell(p.triaged),
      ],
    ),
  );
  rows.push([
    'Total',
    ...keys.map((k) => countCell(model.bySeverity[k])),
    countCell(model.open.length),
    countCell(model.triaged.length),
  ]);
  // A table of a few projects is kept whole; a longer one flows rather
  // than leave the page before it blank, its first and last projects never
  // alone on a page.
  const flows = rowCount(rows) > WHOLE_TABLE;
  const projects = model.projects;
  const table = dataTable({
    className: 'compact counts',
    columns: [
      { label: 'Project' },
      ...keys.map((k) =>
        countColumn(
          sevName(k),
          SEVERITY_WIDTHS[k],
          countTexts(
            projects.map((p) => p.bySeverity[k]),
            model.bySeverity[k],
          ),
          COUNT_PAD,
        ),
      ),
      countColumn(
        'Open',
        '8%',
        countTexts(
          projects.map((p) => p.open),
          model.open.length,
          true,
        ),
        COUNT_PAD,
      ),
      countColumn(
        'Triaged',
        '9%',
        countTexts(
          projects.map((p) => p.triaged),
          model.triaged.length,
        ),
        COUNT_PAD,
      ),
    ],
    rows,
    rowClasses: rows.map((_, i) => (i === rows.length - 1 ? 'total-row' : '')),
    joinPrevious: flows ? edgeUnitsJoined(rows) : undefined,
  });
  // No context row on the page it continues on: the matrix after it is kept
  // whole, and the row's 16 px sent it to the next page.
  return `<section class="section">
${sectionHead({ title: 'Projects', aside: plural(model.projects.length, 'project') })}
${keepTogether(table, rowCount(rows), WHOLE_TABLE)}
</section>`;
}

/**
 * Heat step of a count (1 to 5, on a log scale up to the largest). A dash
 * and a total sit in the same box, unshaded: a column's digits end at one
 * place.
 */
const heatBox = (html: string): string => `<span class="heat">${html}</span>`;

// The box of a count of the heat map (SECURITY_CSS: 26px at least, 5px of
// padding each side) and its cell's padding (2px left, 6px right).
const HEAT_BOX_MIN = 26;
const HEAT_BOX_PAD = 10;
const HEAT_CELL_PAD = 8;

/**
 * A project of the heat map. A long name (over LONG_ID_CHARS) breaks before
 * its separators; a short one is its words, each one a unit that a preview
 * narrower than the page keeps whole (SCREEN_CSS): the table, sized there on
 * its content, gives the Project column its longest word at least. At
 * 850 px, the count columns widened to their counts had taken the room of
 * the names (« ml- / recommender », « customer- / portal »).
 */
function heatName(name: string): string {
  const raw = redactSecrets(name);
  if (isLongId(raw)) return breakableId(raw);
  return raw
    .split(/(\s+)/)
    .map((part) =>
      part.trim() ? `<span class="word">${escapeHtml(part)}</span>` : part,
    )
    .join('');
}

function heatCell(n: number, max: number): string {
  if (!n) return heatBox(countCell(0));
  const level =
    max <= 1 ? 5 : 1 + Math.round((4 * Math.log(n)) / Math.log(max));
  return `<span class="heat heat-${Math.min(5, Math.max(1, level))}">${fmt(n)}</span>`;
}

function renderMatrix(framework: Framework, model: SecurityModel): string {
  const nProjects = model.projects.length;
  const keys = columnKeys(model.bySeverity);
  const cwe = framework.key === 'cwe';
  const list = [
    ...model.categories,
    ...(model.unmapped &&
    (model.unmapped.open.length || model.unmapped.triaged.length)
      ? [model.unmapped]
      : []),
  ];
  // The row outside the list has no code: its title takes the whole cell.
  const label = (c: FrameworkCategory) =>
    `<div class="cat-label">${c.id === NOT_MAPPED.id ? '' : `<span class="code">${escapeHtml(c.id)}</span>`}<span class="name">${escapeHtml(c.title)}</span></div>`;
  const rows = list.map((c) => {
    const empty = c.open.length === 0;
    // No project has open findings: a dash, like every empty count (a
    // category whose findings were all triaged was still detected).
    const projects = !empty
      ? `${fmt(c.projects.size)} of ${fmt(nProjects)}`
      : countCell(0);
    return [
      ...(cwe ? [c.cat.rank ? String(c.cat.rank) : ''] : []),
      label(c.cat),
      ...keys.map((k) => countCell(c.bySeverity[k])),
      empty ? countCell(0) : `<strong>${fmt(c.open.length)}</strong>`,
      countCell(c.triaged.length),
      projects,
    ];
  });
  const withOpen = new Set(model.open.map((f) => f.projectKey)).size;
  rows.push([
    ...(cwe ? [''] : []),
    'Total',
    ...keys.map((k) => countCell(model.bySeverity[k])),
    countCell(model.open.length),
    countCell(model.triaged.length),
    `${fmt(withOpen)} of ${fmt(nProjects)}`,
  ]);
  // Greyed: never detected. A category with triaged findings only was: in
  // plain text, the bold kept for the categories with open findings.
  const rowClasses = [
    ...list.map((c) =>
      c.open.length > 0 ? '' : c.triaged.length > 0 ? 'is-triaged' : 'is-empty',
    ),
    'total-row',
  ];
  // The count columns take the width of their header and its right padding
  // (no left padding, see SECURITY_CSS): the category name keeps one line.
  const projectsOf = (c: CategoryModel) =>
    `${fmt(c.projects.size)} of ${fmt(nProjects)}`;
  const table = dataTable({
    className: `compact counts matrix matrix-${framework.key}`,
    columns: [
      ...(cwe ? [{ label: '#', width: '4.5%', align: 'right' as const }] : []),
      { label: cwe ? 'Weakness' : 'Category' },
      ...keys.map((k) =>
        countColumn(
          sevName(k),
          MATRIX_SEVERITY_WIDTHS[k],
          countTexts(
            list.map((c) => c.bySeverity[k]),
            model.bySeverity[k],
          ),
          MATRIX_COUNT_PAD,
        ),
      ),
      countColumn(
        'Open',
        '5.6%',
        countTexts(
          list.map((c) => c.open.length),
          model.open.length,
          true,
        ),
        MATRIX_COUNT_PAD,
      ),
      countColumn(
        'Triaged',
        '8.2%',
        countTexts(
          list.map((c) => c.triaged.length),
          model.triaged.length,
        ),
        MATRIX_COUNT_PAD,
      ),
      countColumn(
        'Projects',
        '9.6%',
        [
          ...list
            .filter((c) => c.open.length)
            .map((c) => ({ text: projectsOf(c), bold: false })),
          { text: `${fmt(withOpen)} of ${fmt(nProjects)}`, bold: true },
        ],
        MATRIX_COUNT_PAD,
        'nowrap',
      ),
    ],
    rows,
    rowClasses,
  });

  // Project × category breakdown: only for the ten OWASP categories (25 CWE
  // columns would not fit a page).
  let heatmap = '';
  if (!cwe && model.open.length > 0) {
    const cats = list.filter((c) => c.cat.id !== NOT_MAPPED.id);
    const other = list.some((c) => c.cat.id === NOT_MAPPED.id);
    const max = Math.max(
      1,
      ...model.projects.flatMap((p) => Array.from(p.perCategory.values())),
    );
    const heatRows = model.projects.map((p) => [
      `<span class="name">${heatName(p.name)}</span>`,
      ...cats.map((c) => heatCell(p.perCategory.get(c.cat.id) ?? 0, max)),
      ...(other ? [heatCell(p.perCategory.get(NOT_MAPPED.id) ?? 0, max)] : []),
      p.open ? `<strong>${fmt(p.open)}</strong>` : countCell(0),
    ]);
    heatRows.push([
      'Total',
      ...cats.map((c) => heatBox(countCell(c.open.length))),
      ...(other ? [heatBox(countCell(model.unmapped?.open.length))] : []),
      countCell(model.open.length),
    ]);
    // A long project name ran six lines beside rows of one: the counts then
    // take the width of their counts, « Not mapped » two lines, the name the
    // rest.
    const long = model.projects.some((p) => isLongId(p.name));
    // A shaded count is a box of 26px at least, 5px of padding each side;
    // its cell has 2px of padding on the left, 6px on the right.
    const heatColumn = (
      label: string,
      pct: number,
      id: string,
      total: number,
      className?: string,
    ): TableColumn => ({
      label,
      width: columnWidth(pct, {
        min: countFloor(
          countTexts(
            model.projects.map((p) => p.perCategory.get(id) ?? 0),
            total,
          ),
          HEAT_CELL_PAD,
          { min: HEAT_BOX_MIN, pad: HEAT_BOX_PAD },
        ),
      }),
      align: 'right',
      ...(className ? { className } : {}),
    });
    const heatTable = dataTable({
      className: 'compact counts heatmap',
      columns: [
        { label: 'Project' },
        ...cats.map((c) =>
          heatColumn(c.cat.id, long ? 5.6 : 6.2, c.cat.id, c.open.length),
        ),
        ...(other
          ? [
              heatColumn(
                'Not mapped',
                long ? 7.5 : 11.5,
                NOT_MAPPED.id,
                model.unmapped?.open.length ?? 0,
                long ? 'two-line' : undefined,
              ),
            ]
          : []),
        countColumn(
          'Total',
          '7.5%',
          countTexts(
            model.projects.map((p) => p.open),
            model.open.length,
            true,
          ),
          HEAT_CELL_PAD,
        ),
      ],
      rows: heatRows,
      rowClasses: heatRows.map((_, i) =>
        i === heatRows.length - 1 ? 'total-row' : '',
      ),
    });
    // The title travels with its table: never alone at the foot of a page.
    heatmap = keepTogether(
      `<div class="table-title">Open findings per project and category</div>${heatTable}`,
      heatRows.length,
    );
  }

  const detected = model.categories.filter((c) => c.open.length > 0).length;
  // The whole list (25 weaknesses at most) always fits on one page, with
  // the note that explains its last column.
  const matrixBlock = keepTogether(
    `${table}<p class="small table-note">Projects: how many of the projects in scope have open findings in the ${framework.noun}.</p>`,
    rows.length,
    27,
  );
  return `<section class="section">
${sectionHead({ title: `${framework.name} at a glance`, aside: `${fmt(detected)} of ${fmt(framework.categories.length)} ${framework.nouns} with open findings` })}
${matrixBlock}
${heatmap}
</section>`;
}

// ── Code findings ───────────────────────────────────────────────────────────

/**
 * Width of the Location column of the findings and triaged tables (%): the
 * same in both, so a rule title and a path break the same way in both.
 */
const LOCATION_WIDTH = 31;

// Other columns of the findings tables (%); the Rule column takes the rest.
// The State column holds « Confirmed 12 » on one line; the Count column its
// header only (no left padding, see SECURITY_CSS).
const SEVERITY_COLUMN = 11;
const STATE_COLUMN = 13.5;
const COUNT_COLUMN = 6.8;
const CODE_RULE_WIDTH =
  100 - SEVERITY_COLUMN - LOCATION_WIDTH - STATE_COLUMN - COUNT_COLUMN;

/** Lines listed per file of a medium or low row; the others are counted. */
const MAX_LINES = 6;

/** Files listed per medium or low row; the others are counted. */
const MAX_FILES = 3;

/**
 * Locations listed: all of a critical or high row, whose list is
 * exhaustive; `max` of another row, unless a single one is left over, which
 * is shown rather than counted (« +1 more » takes the same room).
 */
const listed = <T>(items: T[], max: number, exhaustive: boolean): T[] =>
  exhaustive || items.length <= max + 1 ? items : items.slice(0, max);

/** Length of the lead sentences of a rule description (two lines at most). */
const DESCRIPTION_CHARS = 220;

/** A first sentence this long (three lines) is still given whole. */
const LEAD_SENTENCE_MAX = 320;

// A sentence cut short never ends on a word that announces more.
const DANGLING_WORD =
  /[\s,;:]+(?:and|or|of|to|the|a|an|in|on|for|with|by|as|such|like|from|at|that|which|when|without|into|its|their)…$/i;

/**
 * A sentence too long to give whole, cut after its last whole clause that
 * fits (a comma or semicolon outside parentheses and code), so it never
 * stops on an adjective (« …all sensitive… »); a word boundary otherwise.
 */
function clauseCut(sentence: string, max: number): string {
  let depth = 0;
  let code = false;
  let end = -1;
  for (let i = 0; i < Math.min(sentence.length, max); i++) {
    const c = sentence.charAt(i);
    if (c === '`') code = !code;
    else if (!code && c === '(') depth++;
    else if (!code && c === ')') depth = Math.max(0, depth - 1);
    else if (!code && depth === 0 && /[,;]/.test(c) && sentence[i + 1] === ' ')
      end = i;
  }
  let text =
    end >= max * 0.4
      ? `${sentence.slice(0, end)}…`
      : clampMarkdown(sentence, max).text;
  while (DANGLING_WORD.test(text)) text = text.replace(DANGLING_WORD, '…');
  return text;
}

interface LineGroup {
  /** `12`, `84–93`, or '' for findings without a line. */
  raw: string;
  /** Findings of one project on that line, or within that range (most). */
  count: number;
}

/**
 * Lines of the findings of one file, in reading order: a line or range
 * already covered by a wider range is folded into it, and each kept line
 * says how many findings one project has there (`1–45 ×3`); the same line
 * in two projects is two findings, one each, and needs no mark.
 */
function mergeLines(findings: Finding[]): LineGroup[] {
  const lines = findings.map((f) => f.line);
  const parse = (raw: string) => {
    const m = /^(\d+)(?:–(\d+))?$/.exec(raw);
    return m
      ? { raw, start: Number(m[1]), end: Number(m[2] ?? m[1]) }
      : { raw, start: Number.MAX_SAFE_INTEGER, end: 0 };
  };
  const parsed = Array.from(new Set(lines.filter(Boolean)))
    .map(parse)
    .sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: (ReturnType<typeof parse> & {
    perProject: Map<string, number>;
  })[] = [];
  let reach = -1;
  for (const l of parsed) {
    if (l.start !== Number.MAX_SAFE_INTEGER && l.end <= reach) continue;
    kept.push({ ...l, perProject: new Map() });
    reach = Math.max(reach, l.end);
  }
  const unlined = new Map<string, number>();
  const add = (map: Map<string, number>, key: string) =>
    map.set(key, (map.get(key) ?? 0) + 1);
  for (const f of findings) {
    if (!f.line) {
      add(unlined, f.projectKey);
      continue;
    }
    const l = parse(f.line);
    const into =
      kept.find((k) => k.raw === f.line) ??
      kept.find(
        (k) =>
          k.start !== Number.MAX_SAFE_INTEGER &&
          k.start <= l.start &&
          l.end <= k.end,
      );
    if (into) add(into.perProject, f.projectKey);
  }
  const most = (map: Map<string, number>) =>
    Math.max(0, ...Array.from(map.values()));
  const groups: LineGroup[] = kept.map((k) => ({
    raw: k.raw,
    count: most(k.perProject),
  }));
  if (unlined.size) groups.push({ raw: '', count: most(unlined) });
  return groups;
}

/** `×3` after a line holding several findings. */
const multiplicity = (n: number): string =>
  n > 1 ? ` <span class="mult">×${fmt(n)}</span>` : '';

const nowrap = (html: string): string => `<span class="nw">${html}</span>`;

/**
 * An unbreakable piece of a location as the reader sees it: a folder, the
 * name of a file with its colon, one of its lines, the count of the lines
 * left out. A space separates it from the piece before (`space`), else the
 * line may break right before it (after a `/` or a `:`); no line starts
 * with a `glued` piece (the lines of a file, kept whole when they fit a
 * line). A `loose` piece, longer than a line, breaks before its separators
 * (`breakableId`), between the words of a camel-case name, anywhere as a
 * last resort.
 */
interface LocationRun {
  html: string;
  /** Characters of 10px monospace. */
  length: number;
  kind: 'folder' | 'file' | 'lines' | 'more';
  space: boolean;
  glued?: boolean;
  loose?: boolean;
}

/**
 * Folders of a path (`app/views`): a line may break before each `/`, which
 * opens the next line (Chicago, as `pathText` breaks a path in the other
 * reports); a folder of a group keeps its trailing `/` (`app/views/`, a
 * tree notation, not a cut). A folder never breaks at a hyphen, unless it
 * is longer than the lines it may go on (`room` characters, the narrowest).
 */
function folderRuns(folders: string, room: number): LocationRun[] {
  const trailing = folders.endsWith('/') ? '/' : '';
  const parts = joinShortPieces(
    folders.slice(0, folders.length - trailing.length).split(/(?=\/)/),
  );
  return parts.map((part, i) => {
    const run = i === parts.length - 1 ? `${part}${trailing}` : part;
    const loose = overLine(run.length, room);
    return {
      html: loose ? breakableId(run) : previewBreaks(run),
      length: run.length,
      kind: 'folder' as const,
      space: false,
      loose,
    };
  });
}

// A4 PDF: a table is 675px wide; 10px monospace is 6px a character, and
// the cell padding is 2 x 8px.
const TABLE_PX = 675;
const MONO_PX = 6;

/** Characters on a line of a Location cell `pct` wide, `indent` px in. */
const lineChars = (pct: number, indent: number): number =>
  Math.floor(((TABLE_PX * pct) / 100 - 16 - indent) / MONO_PX);

/**
 * Whether a piece of `length` characters is longer than a line of `room`
 * (lineChars): the rooms count a table of 675px, the PDF's is 688px, so one
 * character more fits every indented line. Only such a piece breaks.
 */
const overLine = (length: number, room: number): boolean => length > room + 1;

/** A line item shorter than this (`42`, `4,`) never opens a line alone. */
const LINE_FRAGMENT = 3;

/**
 * A file name and its lines (`docker-compose.yml:84–93`). The line may
 * break after the colon, which stays with the name; the lines stay whole
 * when they fit a line of `room` characters (the narrowest they may go on),
 * and break between two of them otherwise. A name longer than the line it
 * may go on (`nameRoom` characters: the one it opens, for a file of a
 * folder) breaks before its separators and carries its first lines on its
 * last part, as a name followed by a fragment (`:42`) does: never a line
 * opening on the lines alone.
 */
function fileRuns(
  file: string,
  groups: LineGroup[],
  exhaustive: boolean,
  room: number,
  nameRoom = room,
): LocationRun[] {
  // Digits and an en dash: escaped piecewise so the dash stays literal.
  const lineHtml = (line: string) =>
    line
      .split('–')
      .map((n) => escapeHtml(n))
      .join('–');
  const lined = groups.filter((g) => g.raw);
  const unlined = groups.find((g) => !g.raw)?.count ?? 0;
  const shown = listed(lined, MAX_LINES, exhaustive);
  const hidden = lined.length - shown.length;
  const name = (loose: boolean) =>
    loose ? breakableId(file) : previewBreaks(file);
  // A name longer than its line is a block of its own: its wrapped lines go
  // one step further in than the lines of its path, never read as another
  // file (the indent of a file listed under its folder).
  const block = (loose: boolean, html: string) =>
    loose ? `<span class="loc-name">${html}</span>` : html;
  const more: LocationRun[] = hidden
    ? [
        {
          html: `<span class="more">+${fmt(hidden)} more</span>`,
          length: `+${fmt(hidden)} more`.length,
          kind: 'more',
          space: true,
        },
      ]
    : [];
  const mark = (n: number) => (n > 1 ? `×${fmt(n)}`.length + 1 : 0);
  if (!shown.length) {
    const length = file.length + mark(unlined);
    const loose = overLine(length, nameRoom);
    return [
      {
        html: block(loose, `${name(loose)}${multiplicity(unlined)}`),
        length,
        kind: 'file',
        space: false,
        loose,
      },
    ];
  }
  const items = shown.map((g, i) => {
    const comma = i < shown.length - 1 ? ',' : '';
    return {
      html: `${lineHtml(g.raw)}${multiplicity(g.count)}${comma}`,
      length: g.raw.length + mark(g.count) + comma.length,
    };
  });
  // The first lines join the name: after a name too long for its line, or
  // when they are a fragment (`42`, a list is none). The name then breaks
  // if both do not fit.
  const fragment = items.length === 1 && items[0].length < LINE_FRAGMENT;
  const carried =
    overLine(file.length + 1, nameRoom) || fragment ? items.shift() : undefined;
  const length = file.length + 1 + (carried?.length ?? 0);
  const loose = overLine(length, nameRoom);
  const whole =
    items.reduce((n, item) => n + item.length, 0) + items.length - 1 <= room;
  return [
    {
      // A name broken before its separators keeps its colon and its first
      // lines on its last part (« .java:1287–1293 », never « 1287– | 1293 »).
      html: block(
        loose,
        loose
          ? `${name(loose)}<span class="nw">:${carried?.html ?? ''}</span>`
          : `${name(loose)}:${carried?.html ?? ''}`,
      ),
      length,
      kind: 'file',
      space: false,
      loose,
    },
    ...items.map<LocationRun>((item, i) => ({
      ...item,
      kind: 'lines',
      space: i > 0 || !!carried,
      glued: i > 0 && whole,
    })),
    ...more,
  ];
}

/** Length of runs laid on one line, with the spaces between them. */
const runsLength = (runs: LocationRun[]): number =>
  runs.reduce((n, run, i) => n + (i > 0 && run.space ? 1 : 0) + run.length, 0);

// Cost of a line that is a folder alone (« docker/ ») or the lines of a
// file alone (« 84–93 ») after the first one: a layout of as many lines
// avoids it whenever it can.
const LONE_LINE = 1000;

// Cost of a folder sent to the next line while it fitted on its line
// (« aibom-fullscan-test-project/ » then « k8s/deployment.yaml: »): as
// many folders as fit stay on the first lines, so a path breaks the same
// way in every row of a table.
const FOLDER_PUSHED = 600;

/**
 * A location laid out on the lines of its cell (`first` characters on the
 * first line, `next` on the others): as few lines as the browser would
 * need, and among them the layout that keeps as many folders as fit on the
 * first lines, fills the lines most evenly and leaves neither a folder nor
 * the lines of a file alone on a line. Each line is one unbreakable span;
 * the browser only breaks between them.
 */
function locationLines(
  runs: LocationRun[],
  first: number,
  next: number,
): LocationRun[][] {
  const n = runs.length;
  // Length of the run at `j` and of the glued runs that follow it.
  const unit = (j: number): number => {
    let end = j + 1;
    while (end < n && runs[end].glued) end++;
    return runsLength(runs.slice(j, end));
  };
  // best[i]: the layout of runs i… on lines, the first one starting at i.
  const best: ({ lines: number; cost: number; end: number } | null)[] = [];
  best[n] = { lines: 0, cost: 0, end: n };
  for (let i = n - 1; i >= 0; i--) {
    best[i] = null;
    if (i > 0 && runs[i].glued) continue;
    const room = i === 0 ? first : next;
    let length = 0;
    for (let j = i + 1; j <= n; j++) {
      const run = runs[j - 1];
      length += (j - 1 > i && run.space ? 1 : 0) + run.length;
      const alone = j === i + 1;
      if (length > room && !alone) break;
      const rest = best[j];
      if (j < n && (runs[j].glued || !rest)) continue;
      const lone =
        i > 0 &&
        ((alone && run.kind === 'folder') ||
          (runs[i].kind === 'lines' && runs[i - 1].kind === 'file'));
      const pushed =
        j < n && runs[j].kind === 'folder' && length + unit(j) <= room;
      const lines =
        (alone && run.loose ? Math.ceil(length / room) : 1) + rest.lines;
      const cost =
        (j < n ? (room - Math.min(length, room)) ** 2 : 0) +
        (lone ? LONE_LINE : 0) +
        (pushed ? FOLDER_PUSHED : 0) +
        rest.cost;
      const current = best[i];
      if (
        !current ||
        lines < current.lines ||
        (lines === current.lines && cost < current.cost)
      ) {
        best[i] = { lines, cost, end: j };
      }
    }
  }
  const lines: LocationRun[][] = [];
  for (let i = 0; i < n; i = best[i].end)
    lines.push(runs.slice(i, best[i].end));
  return lines;
}

/**
 * Lines a location takes (locationLines): one per line, a piece longer than
 * its line (`loose`, alone on it) as many as it fills.
 */
const lineCount = (
  lines: LocationRun[][],
  first: number,
  next: number,
): number =>
  lines.reduce(
    (n, line, k) =>
      n +
      (line.length === 1 && line[0].loose
        ? Math.ceil(line[0].length / (k === 0 ? first : next))
        : 1),
    0,
  );

// A break between two runs of a line, or before a separator of a run, that
// only a preview narrower than the page shows (`.locs wbr.lw`, hidden
// elsewhere: a hidden <wbr> breaks nothing, a visible one breaks even a
// nowrap line, which the browser never breaks after a hyphen).
const LINE_BREAK = '<wbr class="lw">';

/**
 * A run that holds its line of the PDF, escaped, with the breaks a narrower
 * preview may take: before each separator (a hyphen, a dot, an underscore),
 * as breakableId breaks an identifier, never a piece of less than three
 * characters.
 */
const previewBreaks = (text: string): string =>
  joinShortPieces(text.split(/(?=[-._@+~])/))
    .map(escapeHtml)
    .join(LINE_BREAK);

/**
 * Lines of a location, each one unbreakable (see locationLines) in the PDF;
 * in a preview narrower than the page, breakable between two of its runs
 * (before a « / », after a comma of a list of lines) and before a separator
 * of a run only (previewBreaks).
 */
function linesHtml(lines: LocationRun[][]): string {
  return lines
    .map((line, k) => {
      const text = line
        .map(
          (run, i) =>
            `${i > 0 ? `${run.space ? ' ' : ''}${LINE_BREAK}` : ''}${run.html}`,
        )
        .join('');
      const before = k === 0 ? '' : line[0].space ? ' ' : '<wbr>';
      return `${before}${line.some((run) => run.loose) ? text : nowrap(text)}`;
    })
    .join('');
}

/** Folders of a path, with their trailing `/` ('' for a file at the root). */
const folderOf = (path: string): string =>
  path.slice(0, path.lastIndexOf('/') + 1);

/**
 * Locations of a row: the files with most findings first, every one of a
 * critical or high row, `MAX_FILES` of another and the others counted. Files
 * of one folder share a line naming it, then each file on its own indented
 * line, in alphabetical order; a wrapped path is indented under its first
 * line (a wrapped folder too, its files one step further). In a row of
 * several projects, a file found in only some of them is followed by their
 * names, on a line of their own; the files of a folder all found in the
 * same ones name them once, under the folder, before its files (the column
 * is `width` % of the table).
 */
function locationsCell(
  findings: Finding[],
  rowProjects: string[],
  width: number,
): string {
  // A row has one severity.
  const exhaustive = findings.some(
    (f) => SEVERITY_RANK[f.severity] <= SEVERITY_RANK.high,
  );
  const files = groupBy(
    findings.filter((f) => f.path),
    (f) => f.path,
  ).sort(
    (a, b) => b.items.length - a.items.length || a.key.localeCompare(b.key),
  );
  if (!files.length) return EMPTY;
  const shown = listed(files, MAX_FILES, exhaustive);
  const more = files.length - shown.length;
  // The projects of some findings, when they are not all the row's.
  const ownProjects = (items: Finding[]): string[] => {
    if (rowProjects.length < 2) return [];
    const own = Array.from(new Set(items.map((f) => f.projectName))).sort();
    return own.length >= rowProjects.length ? [] : own;
  };
  // A location and the projects it was found in: always under it, on a
  // line of their own, in words that never read as one more location. One
  // form in every row (names after the lines of a file when they fit, under
  // it otherwise, read as two notations), and never is the location broken
  // to make room for them.
  const entry = (
    className: string,
    lines: LocationRun[][],
    own: string[],
  ): string => {
    const note = own.length
      ? `<div class="loc-note">only in ${andList(own.map((name) => projectName(name)))}</div>`
      : '';
    return `<div class="${className}"><span class="path">${linesHtml(lines)}</span>${note}</div>`;
  };
  const blocks = groupBy(shown, (file) => folderOf(redactSecrets(file.key)));
  const html = blocks
    .map(({ key: folder, items }) => {
      if (items.length > 1 && folder) {
        // The number of findings of a file is not shown: within a folder,
        // the files read in alphabetical order.
        const files = [...items].sort((a, b) => a.key.localeCompare(b.key));
        const owns = files.map((file) => ownProjects(file.items));
        const same = owns.every(
          (o) => o.join('\u0000') === owns[0].join('\u0000'),
        );
        // A folder too long for its line wraps like a path, indented under
        // its first line, and its files one step further: the cell reads as
        // a tree, never as two folders side by side.
        const dir = locationLines(
          folderRuns(folder, lineChars(width, 10)),
          lineChars(width, 0),
          lineChars(width, 10),
        );
        const deep = dir.length > 1 ? 10 : 0;
        const next = lineChars(width, 20 + deep);
        return `${entry(deep ? 'loc-dir wraps' : 'loc-dir', dir, same ? owns[0] : [])}${files
          .map((file, k) => {
            const path = redactSecrets(file.key);
            return entry(
              deep ? 'loc in-dir deep' : 'loc in-dir',
              locationLines(
                fileRuns(
                  path.slice(folder.length),
                  mergeLines(file.items),
                  exhaustive,
                  next,
                  lineChars(width, 10 + deep),
                ),
                lineChars(width, 10 + deep),
                next,
              ),
              same ? [] : owns[k],
            );
          })
          .join('')}`;
      }
      return items
        .map((file) => {
          const path = redactSecrets(file.key);
          const first = lineChars(width, 0);
          const next = lineChars(width, 10);
          // `room`: the characters of an indented line.
          const layout = (cut: number, room: number) =>
            locationLines(
              [
                ...folderRuns(path.slice(0, cut), next),
                ...fileRuns(
                  path.slice(cut),
                  mergeLines(file.items),
                  exhaustive,
                  next,
                ),
              ],
              first,
              room,
            );
          // The slash before the file opens its line: it goes with the
          // file, unless the file and its lines then need a line more
          // (« /PlaywrightTraceViewer.tsx: » then « 84–93 » alone): it then
          // closes the folder, as a folder of a group does, the lines of the
          // file on the line of its name when they fit the printed line (one
          // character more than the model's, see overLine).
          const folder = folderOf(path).length;
          const opening = layout(Math.max(0, folder - 1), next);
          const closing = folder > 1 ? layout(folder, next + 1) : opening;
          return entry(
            'loc',
            lineCount(closing, first, next + 1) <
              lineCount(opening, first, next)
              ? closing
              : opening,
            ownProjects(file.items),
          );
        })
        .join('');
    })
    .join('');
  return `<div class="locs">${html}${more ? `<div class="more">+${plural(more, 'more file')}</div>` : ''}</div>`;
}

// A state label of the text face (11px, regular), px, as the production
// image sets it; another state, about 6.5px a character.
const STATE_LABEL_PX: Record<string, number> = {
  confirmed: 53,
  to_verify: 43.3,
  ignored: 39.4,
  resolved: 46.6,
  not_exploitable: 76.9,
};
// Before the label, its dot (6px) and the gap after it (5px); after it,
// the gap before its count (5px) and 6.2px a digit (10px tabular figures).
const STATE_DOT_PX = 11;
const STATE_GAP_PX = 5;
const STATE_DIGIT_PX = 6.2;

/**
 * The room (px) a State column needs: its widest state, with its count
 * when a row has several (stateCell), and the cell padding. In a
 * sheet narrower than the page, « Confirmed 6 » ran past its column up to
 * the count of the next one: « Confirmed 69 » for 6 and 9.
 */
function stateFloor(rows: string[][]): number {
  const width = (states: string[]) => {
    const groups = groupBy(states, (s) => s);
    return Math.max(
      ...groups.map(
        (g) =>
          STATE_DOT_PX +
          (STATE_LABEL_PX[g.key] ?? g.key.length * 6.5) +
          (groups.length > 1
            ? STATE_GAP_PX + fmt(g.items.length).length * STATE_DIGIT_PX
            : 0),
      ),
    );
  };
  return Math.max(0, ...rows.map(width)) + COUNT_PAD;
}

// « COUNT », 9.5px semibold capitals: its column holds it (no left padding).
const COUNT_HEADER_PX = 35.6;

/** The room (px) a Count column needs: its header, its widest count. */
const countHeaderFloor = (counts: number[]): number =>
  Math.max(COUNT_HEADER_PX, ...counts.map((n) => countTextPx(fmt(n)))) +
  MATRIX_COUNT_PAD;

/** Open states in reading order: what is settled first. */
const OPEN_STATES = ['confirmed', 'to_verify'];
const openStateRank = (state: string): number =>
  OPEN_STATES.indexOf(state) + 1 || OPEN_STATES.length + 1;

/**
 * States of a row, always in the same order; with several, each says how
 * many of the row's findings it holds (« Confirmed 6 », « To verify 3 »).
 */
function stateCell(states: string[]): string {
  const groups = groupBy(states, (s) => s).sort(
    (a, b) =>
      openStateRank(a.key) - openStateRank(b.key) || a.key.localeCompare(b.key),
  );
  if (groups.length === 1) return stateLabel(groups[0].key);
  return groups
    .map(
      (g) =>
        `<div class="state-line">${stateLabel(g.key)}<span class="state-n">${fmt(g.items.length)}</span></div>`,
    )
    .join('');
}

/**
 * Markdown backslash escapes outside code (`NO\_PROXY`, `**\***`), which the
 * shared renderer would print: a literal `*` becomes code (it is a
 * wildcard), the other escaped characters plain text.
 */
function unescapeMarkdown(text: string): string {
  return text
    .split(/(`[^`]*`)/)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part.replace(/\\\*/g, '`*`').replace(/\\([_#[\]()`])/g, '$1'),
    )
    .join('');
}

// Writing instructions of the catalogue generator, left in some rule
// descriptions (« The tone must be neutral… »): never shown.
const WRITING_INSTRUCTIONS =
  /\b(?:the tone must be|use markdown for readability|a detailed, technical explanation of the vulnerability|do not mention cwe)\b/i;

// A line that opens a list item or a labelled line (« **Root Cause:** »).
const LIST_LINE = /^\s*(?:[-*+]|\d+\.)\s/;
const LABEL_LINE = /^\s*\*\*[^*\n]{1,40}?(?::\*\*|\*\*\s*:)/;
// A label alone on its line (« **Overview** »).
const LABEL_ONLY = /^\s*\*\*[^*\n]{1,40}\*\*\s*:?\s*$/;

/**
 * Sentences of a prose line: a stop followed by a space and a capital (or
 * code) ends one, never the dot of `requests.get()` or of « e.g. ».
 */
const sentencesOf = (text: string): string[] =>
  text.split(/(?<=[.!?])\s+(?=[A-Z`*"'(\d])/);

/**
 * First letter in upper case, unless the text opens on code or an
 * identifier (`sqlalchemy.text`, `eval()`).
 */
function capitalized(text: string): string {
  const m = /^([a-z][a-z]*)(?=[\s,;:]|$)/.exec(text);
  return m ? `${m[1].charAt(0).toUpperCase()}${text.slice(1)}` : text;
}

// A label inside a line (« …clear text. **Mechanism**: Any data… »).
const INLINE_LABEL = /\s\*\*[^*\n]{1,40}?(?::\*\*|\*\*\s*:)/;

/** The scanner's bold marks outside code: they would compete with the title. */
const withoutBold = (text: string): string =>
  text
    .split(/(`[^`]*`)/)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(/\*\*/g, '')))
    .join('');

/** The paragraph right after `paragraph` in `paragraphs`, if any. */
function nextParagraph(
  paragraphs: string[],
  paragraph: string,
): string | undefined {
  const i = paragraphs.indexOf(paragraph);
  return i >= 0 ? paragraphs[i + 1] : undefined;
}

// First words that never name anything: lower case after a colon.
const DETERMINER =
  /^(?:A|An|The|This|These|That|Those|Any|Each|Every|Some|No|Its|Their|It|They)\b/;

/**
 * A list item that is a sentence (« A container can use all available CPU
 * cycles… »), without its marker, label or bold, ready to follow a colon;
 * '' for an item that is no sentence (« **Modify** files »).
 */
function listItemSentence(line: string): string {
  const item = withoutBold(
    unescapeMarkdown(
      line
        .replace(LIST_LINE, '')
        .replace(/^\*\*[^*\n]{1,40}?(?::\*\*|\*\*\s*:)\s*/, ''),
    ),
  ).trim();
  const sentence =
    /^[A-Z][a-z]*\b/.test(item) &&
    /[.!]$/.test(item) &&
    item.split(/\s+/).length >= 4;
  if (!sentence) return '';
  return DETERMINER.test(item)
    ? `${item.charAt(0).toLowerCase()}${item.slice(1)}`
    : item;
}

/**
 * Lead sentence of a rule description: the first paragraph of prose
 * (headings, lists, code and writing instructions left out), or else the
 * first item of its list, without the label that opens it (« **Root
 * cause:** ») and up to the next label or list, in whole sentences, two
 * lines at most; a first sentence of up to three lines is given whole. The
 * per-project reports give the description in full.
 */
function ruleSummary(description: string): string {
  const paragraphs = String(description ?? '')
    .split(/\n\s*\n/)
    .map((p) =>
      p
        .split('\n')
        .filter((line, i) => i > 0 || !LABEL_ONLY.test(line))
        .join('\n')
        .trim(),
    )
    .filter(
      (p) =>
        p &&
        !/^#{1,6}\s/.test(p) &&
        !p.startsWith('```') &&
        !p.startsWith('>') &&
        !WRITING_INSTRUCTIONS.test(p),
    );
  // A description written as a list only: its first item.
  const prose =
    paragraphs.find((p) => !LIST_LINE.test(p)) ??
    paragraphs[0]?.replace(LIST_LINE, '');
  if (!prose) return '';
  // The paragraph up to its first list item or next labelled line.
  const lines = prose.split('\n');
  const stop = lines.findIndex(
    (line, i) => i > 0 && (LIST_LINE.test(line) || LABEL_LINE.test(line)),
  );
  const joined = (stop > 0 ? lines.slice(0, stop) : lines)
    .join(' ')
    .replace(/^\*\*[^*\n]{1,40}?(?::\*\*|\*\*\s*:)\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
  // A label further in the line opens another part: the lead ends there.
  const label = joined.search(INLINE_LABEL);
  const body = withoutBold(
    unescapeMarkdown(label > 0 ? joined.slice(0, label) : joined),
  );
  // Whole sentences while they fit; a first sentence too long is cut.
  const sentences = sentencesOf(body);
  let text = '';
  for (const sentence of sentences) {
    const next = text ? `${text} ${sentence}` : sentence;
    if (next.length > DESCRIPTION_CHARS) break;
    text = next;
  }
  if (!text) {
    const first = sentences[0] ?? body;
    text =
      first.length <= LEAD_SENTENCE_MAX
        ? first
        : clauseCut(first, LEAD_SENTENCE_MAX);
  }
  // A sentence that announces a list (« When limits are not set: ») is
  // given with the first item when that item is a sentence that fits (the
  // announced list often holds the risk); otherwise the lead ends before it.
  if (/:\s*$/.test(text)) {
    const listed = stop > 0 ? lines[stop] : nextParagraph(paragraphs, prose);
    const item = LIST_LINE.test(listed ?? '')
      ? listItemSentence(listed.split('\n')[0])
      : '';
    const both = `${text.trim()} ${item}`;
    if (item && both.length <= DESCRIPTION_CHARS) {
      text = both;
    } else {
      const end = text.lastIndexOf('. ');
      text = end > 0 ? text.slice(0, end + 1) : text.replace(/:\s*$/, '.');
    }
  }
  // Bold text cut short never leaves its opening marks.
  if ((text.match(/\*\*/g)?.length ?? 0) % 2 === 1) {
    const i = text.lastIndexOf('**');
    text = `${text.slice(0, i)}${text.slice(i + 2)}`;
  }
  return capitalized(text);
}

/**
 * Characters of 10px text on a line of the Rule column after the scanner
 * chip: the projects a pointer names stay together up to this length.
 */
const REF_NAMES_CHARS = 36;

/** Findings of one rule at one severity, whatever their projects. */
interface RuleRow {
  first: Finding;
  all: Finding[];
  projects: string[];
}

function ruleRows(findings: Finding[]): RuleRow[] {
  return groupBy(findings, (f) =>
    [f.type, f.name, f.severity].join('\u0000'),
  ).map(({ items }) => ({
    first: items[0],
    all: items,
    projects: Array.from(new Set(items.map((f) => f.projectName))).sort(),
  }));
}

const bySeverityThenName = (a: RuleRow, b: RuleRow): number =>
  SEVERITY_RANK[a.first.severity] - SEVERITY_RANK[b.first.severity] ||
  a.first.name.localeCompare(b.first.name) ||
  a.first.type.localeCompare(b.first.type);

/**
 * Code findings, one row per rule and severity: the same code scanned in
 * several projects is one row naming them; the files of a rule are listed
 * together, each with its lines, and the row says how many findings it
 * stands for. Only a critical or high rule carries the lead sentence of its
 * description on a line attached below, once: a rule rated differently in
 * two projects gives it under its most severe row, and its other critical
 * or high row says so (a high row without a description would read like a
 * medium one). A medium or low rule stays one compact row (as in the
 * scanner report), never described, never pointing to a description.
 */
function codeFindingsTable(
  findings: Finding[],
  continuation: string,
  named = false,
  print = true,
): string {
  const rules = ruleRows(findings).sort(bySeverityThenName);
  const rows: (string[] | { full: string; attach: boolean })[] = [];
  // The row each description was given under: its severity, its projects.
  const described = new Map<string, RuleRow>();
  for (const row of rules) {
    const severe = ['critical', 'high'].includes(
      String(row.first.severity ?? '').toLowerCase(),
    );
    const summary = severe ? ruleSummary(row.first.description) : '';
    const key = [row.first.type, row.first.name, summary].join('\u0000');
    const above = summary ? described.get(key) : undefined;
    // Where to look: above (often a page before), in the row of the
    // projects it names, as that row names them. On a line of its own
    // under the projects: always in the same place. The names stay
    // together when they fit a line, the line breaking before the
    // parenthesis; otherwise after a comma, never past the column.
    const names = above?.projects ?? [];
    const namesText = `(${names.join(', ')})`;
    // Each name whole, its comma with it. Names that fit a line together
    // are one run of text in the PDF; in the preview, each whole on one
    // line (`ref-names`) that a sheet narrower than the page may break
    // between two names only.
    const namesHtml = `(${names
      .map((name, i) => wholeName(name, i < names.length - 1 ? ',' : ')'))
      .join(' ')}`;
    const ref = above
      ? `<span class="rule-ref own">see its ${sevName(above.first.severity).toLowerCase()} row above ${
          namesText.length > REF_NAMES_CHARS
            ? namesHtml
            : print
              ? nowrap(safe(namesText))
              : `<span class="nw ref-names">${namesHtml}</span>`
        }</span>`
      : '';
    rows.push([
      sevBadge(row.first.severity),
      labelled(
        ruleName(row.first.name, titleChars(CODE_RULE_WIDTH)),
        row.first.type,
        `${projectNames(row.projects)}${ref}`,
      ),
      locationsCell(row.all, row.projects, LOCATION_WIDTH),
      stateCell(row.all.map((x) => x.state)),
      fmt(row.all.length),
    ]);
    if (!summary || above) continue;
    described.set(key, row);
    rows.push({
      full: `<div class="rule-desc">${markdownToHtml(summary)}</div>`,
      attach: true,
    });
  }
  return flowingTable({
    className: 'compact code-table',
    columns: stateAndCountColumns(rules),
    rows,
    count: rules.length,
    continuation,
    named,
  });
}

/**
 * Columns of a table of code findings (open or triaged): the State and
 * Count columns never narrower than their widest state and count, in a
 * preview narrower than the page as in the PDF; a state's count never runs
 * up to the Count column's (« Confirmed 69 » for 6 and 9).
 */
const stateAndCountColumns = (rules: RuleRow[]): TableColumn[] => [
  { label: 'Severity', width: `${SEVERITY_COLUMN}%` },
  { label: 'Rule' },
  { label: 'Location', width: `${LOCATION_WIDTH}%` },
  {
    label: 'State',
    width: columnWidth(STATE_COLUMN, {
      min: stateFloor(rules.map((r) => r.all.map((f) => f.state))),
    }),
  },
  {
    label: 'Count',
    width: columnWidth(COUNT_COLUMN, {
      min: countHeaderFloor(rules.map((r) => r.all.length)),
    }),
    align: 'right',
  },
];

// ── Vulnerable packages ─────────────────────────────────────────────────────

interface PackageGroup {
  type: string;
  name: string;
  versions: Set<string>;
  severity: Severity;
  advisories: Map<string, Severity>;
  /** Advisories withdrawn by their publisher, duplicates included. */
  withdrawn: Set<string>;
  /** Those withdrawn as duplicates of another advisory. */
  duplicates: Set<string>;
  /** Other advisories with a published fix. */
  fixed: Set<string>;
  /** Their fixed versions. */
  fixes: string[];
  projects: Set<string>;
  /** Image a container package was found in ('' when unknown). */
  image: string;
  count: number;
}

/**
 * Vulnerable packages, one per scanner type and package name, and per image
 * for a container package: the same name in a Debian and an Ubuntu image
 * are two packages, each with its own fix (one « Fixed in » named a Debian
 * version for the Ubuntu image). A withdrawn advisory counts like any other
 * (as on the dashboard) but never sets the fixed version; one id reported by
 * a withdrawn and a live record is live.
 */
function groupPackages(findings: Finding[]): PackageGroup[] {
  const groups = new Map<string, PackageGroup>();
  const live = new Map<PackageGroup, Set<string>>();
  for (const f of findings) {
    const key = [f.type, f.packageName, f.image].join('\u0000');
    let g = groups.get(key);
    if (!g) {
      g = {
        type: f.type,
        name: f.packageName || f.name,
        versions: new Set(),
        severity: f.severity,
        advisories: new Map(),
        withdrawn: new Set(),
        duplicates: new Set(),
        fixed: new Set(),
        fixes: [],
        projects: new Set(),
        image: f.image,
        count: 0,
      };
      groups.set(key, g);
      live.set(g, new Set());
    }
    g.count++;
    if (f.packageVersion && f.packageVersion !== 'Unknown') {
      g.versions.add(f.packageVersion);
    }
    if (SEVERITY_RANK[f.severity] < SEVERITY_RANK[g.severity]) {
      g.severity = f.severity;
    }
    const known = g.advisories.get(f.advisory);
    if (!known || SEVERITY_RANK[f.severity] < SEVERITY_RANK[known]) {
      g.advisories.set(f.advisory, f.severity);
    }
    if (f.withdrawn) {
      g.withdrawn.add(f.advisory);
      if (f.duplicate) g.duplicates.add(f.advisory);
    } else {
      live.get(g).add(f.advisory);
      if (f.fixedVersion) {
        g.fixes.push(f.fixedVersion);
        g.fixed.add(f.advisory);
      }
    }
    if (f.projectName) g.projects.add(f.projectName);
  }
  for (const [g, ids] of live) ids.forEach((id) => g.withdrawn.delete(id));
  return Array.from(groups.values()).sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      b.advisories.size - a.advisories.size ||
      a.name.localeCompare(b.name),
  );
}

/**
 * Versions in version order (`0.1.9, 0.1.10`; a pre-release before its
 * release, an epoch before a higher major).
 */
const sortedVersions = (versions: Iterable<string>): string[] =>
  Array.from(new Set(versions)).sort(byVersion);

/**
 * Versions, each one whole, a line breaking only after a comma (a long one
 * breaks before its separators when it does not fit a line).
 */
const versionsHtml = (versions: Iterable<string>): string => {
  const list = sortedVersions(versions);
  return list.map((v, i) => versionItem(v, i < list.length - 1)).join(' ');
};

/** Width of the Package column of the vulnerable packages (%). */
const PACKAGE_WIDTH = 34;

/**
 * Whether a part of a package name (its scope, its name after the `/`) is
 * longer than a line of its chip in a Package column `pct` % wide (the
 * hanging indent and the chip's padding left out).
 */
const partOverLine = (name: string, pct: number): boolean =>
  joinShortPieces(name.split(/(?=\/)/)).some((part) =>
    overLine(part.length, lineChars(pct, 20)),
  );

/**
 * `form-data 1.0.1, 2.0.0`: the shared package chip (breakable after a
 * scope only), then the versions in use. The first version stays on the
 * line of the end of the name when both fit a line of the column (`pct` %
 * wide; never a version alone under `@opentelemetry/exporter-prometheus`);
 * otherwise it may go to the next line rather than overflow the column. A
 * part of the name longer than a line flows in the chip (`flows`), broken
 * before its separators; a shorter one moves to the next line whole.
 */
const packageLabel = (
  name: string,
  versions: Iterable<string>,
  pct: number,
): string => {
  const shown = redactSecrets(name);
  const list = versionsHtml(versions);
  const flows = partOverLine(shown, pct);
  const cls = `pkg-head${flows ? ' flows' : ''}`;
  if (!list) {
    return flows
      ? `<div class="${cls}">${packageChip(shown)}</div>`
      : packageChip(shown);
  }
  // A line of versions sent to the next line is indented under the name.
  // The no-break space that keeps the first version on the line of the end
  // of the name is the PDF's: in a preview narrower than the page, a plain
  // space takes its place (`.unglue`), and the version goes to the next
  // line rather than run past the column.
  const glue = gluesFirstVersion(shown, versions, pct)
    ? '<span class="glue">&nbsp;</span><span class="unglue"> </span>'
    : ' ';
  return `<div class="${cls}">${packageChip(shown)}${glue}<span class="versions mono">${list}</span></div>`;
};

/**
 * Whether the first version of a package stays on the line of the end of
 * its name (a no-break space): when both fit a line of its column (`pct` %
 * wide; the chip's padding takes about one character).
 */
function gluesFirstVersion(
  shown: string,
  versions: Iterable<string>,
  pct: number,
): boolean {
  const end = shown.split('/').pop() ?? '';
  const first = sortedVersions(versions)[0] ?? '';
  return !!first && end.length + 1 + first.length <= lineChars(pct, 8);
}

// A chip's padding (5px each side), the hanging indent of a wrapped line of
// a package (10px), a cell's padding (8px each side).
const CHIP_PAD_PX = 10;
const HANG_PX = 10;
const CELL_PAD_PX = 16;

// « advisories » and the no-break space before it (11px, regular).
const ADVISORIES_WORD_PX = 54.7;

/**
 * The room (px) the Advisories column needs in the preview: its count of
 * advisories on one line (« 42 advisories », a count and its noun never
 * part, a word never breaks), and the cell's padding. The column takes
 * what the others leave: their floors left it too little.
 */
const advisoriesFloor = (groups: PackageGroup[]): number =>
  Math.max(0, ...groups.map((g) => countTextPx(fmt(g.advisories.size)))) +
  ADVISORIES_WORD_PX +
  CELL_PAD_PX;

/**
 * The parts of a package chip that never break (packageChip): each part of
 * a name up to LONG_ID_CHARS after a « / » (after the scope of a short
 * name, npm's included), a longer one between its separators.
 */
function chipParts(name: string): string[] {
  if (!isLongId(name)) return name.split(/(?<=\/)/u).filter(Boolean);
  const scope = new RegExp(`^@[^/]{1,${LONG_ID_CHARS - 1}}/`, 'u').exec(
    name,
  )?.[0];
  const rest = name.slice(scope?.length ?? 0);
  return joinShortPieces([
    scope ?? '',
    ...(rest ? rest.split(/(?=\/)/u) : []),
  ]).flatMap((seg) => (isLongId(seg) ? idPieces(seg) : [seg]));
}

/**
 * The room (px) a Package column needs in the preview: the widest part of
 * a package chip that never breaks, and the widest version in use (its
 * first one is never kept on the line of the name there, see
 * packageLabel); each with the chip's padding where it ends or opens the
 * chip, the hanging indent of a wrapped line, and the cell's padding.
 * « libmagickcore-6-headers » ran 20px past its column in a preview of
 * 700px.
 */
function packageFloor(g: PackageGroup): number {
  const parts = chipParts(redactSecrets(g.name));
  const versions = sortedVersions(
    Array.from(g.versions, (v) => redactSecrets(v)),
  );
  const withComma = (v: string, i: number) =>
    versionPartChars(v) + (i < versions.length - 1 ? 1 : 0);
  const widths = parts.map(
    (part, i) =>
      part.length * MONO_PX +
      (i === 0 ? CHIP_PAD_PX / 2 : HANG_PX) +
      (i === parts.length - 1 ? CHIP_PAD_PX / 2 : 0),
  );
  const versionWidths = versions.map(
    (v, i) => HANG_PX + withComma(v, i) * MONO_PX,
  );
  return Math.max(0, ...widths, ...versionWidths) + CELL_PAD_PX;
}

/**
 * The room (px) the Fixed in column needs in the preview: its widest chip
 * on one line (a short version whole, a long one its widest part), in its
 * padding and the cell's. « 1.2.5-r23 » broke after its hyphen.
 */
function fixFloor(groups: PackageGroup[]): number {
  const fixes = groups.map(bestFix).filter(Boolean);
  if (!fixes.length) return 0;
  return (
    Math.max(...fixes.map((v) => versionPartChars(v) * MONO_PX)) +
    CHIP_PAD_PX +
    CELL_PAD_PX
  );
}

/**
 * Version shown as the fix of a package ('' without any), secrets masked:
 * the highest one, the final release rather than its pre-release (`1.0.10`
 * over `1.0.10rc1`), the epoch of a Debian version never read as its major
 * one.
 */
const bestFix = (g: PackageGroup): string =>
  g.fixes.length
    ? redactSecrets(highestPackageVersion(g.fixes) ?? g.fixes[0])
    : '';

/**
 * Lowest version that fixes every advisory with a published fix, withdrawn
 * ones left out; the other advisories without one are counted under it ("No
 * fix" when none has one, as in the dashboard, "Withdrawn only" when every
 * advisory was withdrawn).
 */
function fixCell(g: PackageGroup): string {
  const unfixed = g.advisories.size - g.withdrawn.size - g.fixed.size;
  if (g.fixes.length === 0) {
    return `<span class="muted">${g.withdrawn.size === g.advisories.size ? 'Withdrawn only' : 'No fix'}</span>`;
  }
  const best = bestFix(g);
  // One chip, atomic: a Debian version never breaks in its revision, and
  // never reads as two versions (dependencyWidths holds it whole).
  return `${versionChip(best)}${
    isPrereleaseVersion(best) ? '<span class="sub">Pre-release</span>' : ''
  }${unfixed > 0 ? `<span class="sub">${fmt(unfixed)} unfixed</span>` : ''}`;
}

/**
 * Advisory ids named per package: the three most severe live ones and the
 * count of the other live ones, then every withdrawn one, tagged as in the
 * per-project reports (« Duplicate » when it repeats another advisory): the
 * count never reads as one more withdrawn advisory.
 */
const MAX_ADVISORY_IDS = 3;

function advisoriesCell(g: PackageGroup): string {
  const bySeverity = (a: [string, Severity], b: [string, Severity]) =>
    SEVERITY_RANK[a[1]] - SEVERITY_RANK[b[1]] || a[0].localeCompare(b[0]);
  const all = Array.from(g.advisories);
  const live = all.filter(([id]) => !g.withdrawn.has(id)).sort(bySeverity);
  const withdrawn = all.filter(([id]) => g.withdrawn.has(id)).sort(bySeverity);
  const counts = emptySeverityCounts();
  for (const [, s] of all) counts[s]++;
  const ids = (list: [string, Severity][]) =>
    list
      .map(([id, severity]) => {
        const tag = g.withdrawn.has(id)
          ? `<span class="tag">${g.duplicates.has(id) ? 'Duplicate' : 'Withdrawn'}</span>`
          : '';
        // The dot and the id never part; the tag goes under them when the
        // column cannot hold all three on a line.
        return `<span class="adv"><span class="nw"><i style="background: ${severityColors(severity).solid};"></i>${safe(id)}</span>${tag ? `<wbr>${tag}` : ''}</span>`;
      })
      .join('');
  const unnamed = live.length - Math.min(live.length, MAX_ADVISORY_IDS);
  const more = unnamed ? `<span class="more">+${fmt(unnamed)} more</span>` : '';
  // The severities in one block, moved to the next line whole, broken
  // between two counts only when longer than a line of the column.
  const breakdown = SEVERITY_ORDER.filter((s) => counts[s] > 0).map(
    (s, i, present) =>
      `<span class="nw">${i === 0 ? '(' : ''}${fmt(counts[s])} ${sevName(s).toLowerCase()}${i < present.length - 1 ? ',' : ')'}</span>`,
  );
  return `<div class="adv-count">${plural(all.length, 'advisory', 'advisories')}${all.length > 1 ? ` <span class="muted breakdown">${breakdown.join(' ')}</span>` : ''}</div><div class="adv-ids mono">${ids(live.slice(0, MAX_ADVISORY_IDS))}${more}${ids(withdrawn)}</div>`;
}

/**
 * Bounds of the Fixed in column (%). Up to `wide` it takes nothing from the
 * other columns; wider, it takes a point from the Count column and the rest
 * from the Package column, down to that column's floor, then from the
 * Advisories column, down to its own.
 */
const FIXED_IN_WIDTH = { min: 12, wide: 16 };
// Floors of the Package and Advisories columns (%): a package chip's parts
// flow in the first, an advisory id (19 characters) holds in the second.
const PACKAGE_MIN = 26;
const ADVISORIES_MIN = 22;
// Fixed columns of the vulnerable packages: severity, and count when the
// Fixed in column widens.
const SEVERITY_WIDTH = 11;
const NARROW_COUNT = 7;
// A version's line: the chip's padding (2 x 5px) or the hanging indent of
// the versions under a package (10px), and the cell's padding (2 x 8px).
const VERSION_LINE_PX = 10 + 16;

/**
 * Widths of the Package, Fixed in and Count columns (%). A version is
 * atomic: the Fixed in column holds every fixed version whole (a Debian
 * version with an epoch, 29 characters), and the Package column every
 * installed one, as long as the Advisories column keeps its floor; a
 * version they cannot hold breaks between its parts. Past its `wide` bound,
 * Fixed in takes a point from the Count column (its header then without
 * left padding) and the rest from the Package column, down to its floor.
 */
function dependencyWidths(
  fixes: string[],
  installed: string[],
): {
  pkg: number;
  fixed: number;
  count: number;
} {
  const room = 100 - SEVERITY_WIDTH - NARROW_COUNT - ADVISORIES_MIN;
  const pkgFloor = Math.max(
    PACKAGE_MIN,
    versionsShare(installed, room - FIXED_IN_WIDTH.min, VERSION_LINE_PX),
  );
  const fixed = Math.max(
    FIXED_IN_WIDTH.min,
    versionsShare(fixes, room - pkgFloor, VERSION_LINE_PX),
  );
  const extra = Math.max(0, fixed - FIXED_IN_WIDTH.wide);
  return {
    pkg: Math.max(pkgFloor, PACKAGE_WIDTH - Math.max(0, extra - 1)),
    fixed,
    count: extra ? NARROW_COUNT : 8,
  };
}

/**
 * The image of the container packages below it (which image to rebuild),
 * named once, across the table, as a path: broken before its « / », a digest
 * in balanced lines (in the Package column of every row, it ran six to nine
 * lines). Then the projects its packages were found in, when they all share
 * them: the rows it covers then name neither (only a package found in other
 * projects names its own).
 */
function imageHead(image: string, projects: string[]): string {
  const who = projects.length
    ? `<span class="inline-sep">&nbsp;&middot;</span> <span class="image-who">${projectNames(projects)}</span>`
    : '';
  return `<div class="image-head"><span class="image-label">Image</span> ${pathText(redactSecrets(image))}${who}</div>`;
}

/** Whether two sets of names hold the same names. */
const sameNames = (a: Set<string>, b: Set<string>): boolean =>
  a.size === b.size && Array.from(a).every((name) => b.has(name));

/**
 * The packages of an image in the PDF: a table of their own, with the
 * columns of the table around it (the stack reads as one table), in one row
 * of it. Its header is the line naming the image and its projects, alone:
 * Chromium repeats a table's header at the head of every page the table
 * continues on, here under the header of the table around it. A line named
 * once, in a row, left the packages sent to the next page with neither
 * image nor project (an Ubuntu image counts more packages in one weakness
 * than a page holds).
 */
function imageTable(
  columns: TableColumn[],
  head: string,
  rows: string[][],
  rowClasses: string[],
): string {
  return dataTable({
    className: 'compact dep-table image-table',
    columns,
    rows,
    rowClasses,
  }).replace(
    /<thead>[\s\S]*?<\/thead>/,
    () =>
      `<thead><tr class="image-row"><td colspan="${columns.length}">${head}</td></tr></thead>`,
  );
}

function dependencyTable(
  findings: Finding[],
  continuation: string,
  named = false,
  print = false,
): string {
  const groups = groupPackages(findings);
  const widths = dependencyWidths(
    groups.map(bestFix),
    groups.flatMap((g) => Array.from(g.versions, redactSecrets)),
  );
  // The packages of an image of one severity together, under a line naming
  // the image, at the place of the first of them: the table stays in
  // severity order (drawn at the place of its most severe package, an
  // image sent its HIGH packages before critical ones). Any other package a
  // row of its own, under no image line.
  const blocks: { image: string; groups: PackageGroup[] }[] = [];
  const byImage = new Map<string, PackageGroup[]>();
  for (const g of groups) {
    const image = g.type === 'container' ? g.image : '';
    const key = [g.severity, image].join('\u0000');
    const known = image ? byImage.get(key) : undefined;
    if (known) {
      known.push(g);
      continue;
    }
    const block = { image, groups: [g] };
    if (image) byImage.set(key, block.groups);
    blocks.push(block);
  }
  // The package column holds the longest name segment in use
  // (« auto-instrumentations-node ») with its version and padding.
  // In a preview narrower than the page, the Package and Fixed in columns
  // keep the room of their widest part that never breaks; narrower still,
  // that room only, the Advisories column taking the rest (the shares that
  // hold an epoch version whole in the PDF left it too little).
  const columns: TableColumn[] = [
    { label: 'Severity', width: '11%' },
    {
      label: 'Package',
      width: columnWidth(widths.pkg, {
        preview: Math.max(0, ...groups.map(packageFloor)),
        yields: true,
      }),
    },
    // The flexible column, never narrower than its count of advisories.
    {
      label: 'Advisories',
      width: `auto; --preview-min: ${Math.ceil(advisoriesFloor(groups))}px`,
    },
    {
      label: 'Fixed in',
      width: columnWidth(widths.fixed, {
        preview: fixFloor(groups),
        yields: true,
      }),
    },
    { label: 'Count', width: `${widths.count}%`, align: 'right' },
  ];
  const rows: (string[] | { full: string; className: string })[] = [];
  const joinPrevious: boolean[] = [];
  // The rows of an image line, ruled up to the last one, which closes it.
  const rowClasses: string[] = [];
  for (const block of blocks) {
    const shared = new Set(block.groups.flatMap((g) => Array.from(g.projects)));
    const cells = block.groups.map((g) => {
      const own = !block.image || !sameNames(g.projects, shared);
      return [
        sevBadge(g.severity),
        labelled(
          packageLabel(g.name, g.versions, widths.pkg),
          g.type,
          // Its projects, unless they are the image's: the line above names
          // them, and the image, for all its rows, which never repeat it (an
          // Azure ML repository, 32 hexadecimal digits, ran three lines on
          // every row).
          own ? projectNames(g.projects) : '',
        ),
        advisoriesCell(g),
        fixCell(g),
        fmt(g.count),
      ];
    });
    const classes = block.groups.map((_, i) =>
      block.image
        ? `in-image${i === block.groups.length - 1 ? ' image-end' : ''}`
        : '',
    );
    const head = block.image ? imageHead(block.image, Array.from(shared)) : '';
    // The PDF, in pages: the line heads a table of the image's packages,
    // repeated on every page they continue on. The preview, one page: a
    // row of the table, joined to the first package.
    if (head && print) {
      rows.push({
        full: imageTable(columns, head, cells, classes),
        className: 'image-block',
      });
      joinPrevious.push(false);
      rowClasses.push('');
      continue;
    }
    if (head) {
      rows.push({ full: head, className: 'image-row' });
      joinPrevious.push(false);
      rowClasses.push('');
    }
    cells.forEach((row, i) => {
      rows.push(row);
      joinPrevious.push(!!head && i === 0);
      rowClasses.push(classes[i]);
    });
  }
  return flowingTable({
    className: 'compact dep-table',
    columns,
    rows,
    rowClasses,
    joinPrevious,
    count: groups.length,
    continuation,
    named,
  });
}

// ── Category detail ─────────────────────────────────────────────────────────

function renderCategory(
  c: CategoryModel,
  detailed: boolean,
  print: boolean,
): string {
  const code = c.open.filter((f) => !isDependency(f));
  const deps = c.open.filter(isDependency);
  // One package per row of its table: per image for a container package.
  const packages = new Set(
    deps.map((f) => [f.type, f.packageName, f.image].join('\u0000')),
  ).size;
  const label = categoryLabel(c.cat);
  // The number of projects (and of vulnerable packages) goes with the open
  // findings, never after the last severity count (« HIGH 6 4 projects »).
  const aside = [
    plural(c.open.length, 'open finding'),
    packages ? plural(packages, 'vulnerable package') : '',
    plural(c.projects.size, 'project'),
  ]
    .filter(Boolean)
    .join(' &middot; ');
  const head = `<div class="cat-title"><div><div class="eyebrow">${escapeHtml(c.cat.eyebrow)}</div><h3>${escapeHtml(c.cat.title)}</h3></div><div class="aside">${aside}</div></div>
<div class="cat-meta">${severitySummary(c.bySeverity)}</div>`;
  // One heading block (title, severities, reference text and measures, or
  // the introduction of the findings outside the list) that never splits,
  // hides the context row of the table below and travels with its first
  // rows: a blank at the foot of a page rather than a heading alone there.
  const intro =
    c.cat.id === NOT_MAPPED.id
      ? '<p class="cat-intro">Open findings whose rule and CWE match no OWASP Top 10 2021 category. They count in the totals above.</p>'
      : detailed
        ? `<div class="ref">${c.cat.descriptionHtml}${c.cat.preventionHtml}</div>`
        : '';
  // The first table is named even when short, kept whole with the heading:
  // its rows (every file of a critical rule) may still outgrow the page.
  // With vulnerable packages (A06), they come first: the bulk of the
  // category, right under its heading, continued like any category's table;
  // the other findings follow under a title, which reads the same on the
  // pages their table continues on (« code and name · table · continued »).
  // A context row never names a title the page before did not show.
  if (deps.length) {
    // Text: the context row escapes it, the title below gets it escaped.
    const others = `${label} · ${capitalize(andList(Array.from(new Set(code.map((f) => OPEN_WORDS[f.type] ?? redactSecrets(f.type))))))} findings`;
    const rules = ruleRows(code).length;
    return `<section class="cat">
<div class="cat-head cont-cover">${head}${intro}</div>
${dependencyTable(deps, `${label} · continued`, true, print)}
${
  code.length
    ? `${tableTitle(escapeHtml(others), `${plural(rules, 'rule')} · ${plural(code.length, 'finding')}`)}${codeFindingsTable(code, `${others} · continued`, false, print)}`
    : ''
}
</section>`;
  }
  return `<section class="cat">
<div class="cat-head cont-cover">${head}${intro}</div>
${codeFindingsTable(code, `${label} · continued`, true, print)}
</section>`;
}

function renderCategories(
  framework: Framework,
  model: SecurityModel,
  print: boolean,
): string {
  const list = [
    ...model.categories,
    ...(model.unmapped ? [model.unmapped] : []),
  ].filter((c) => c.open.length > 0);
  if (!list.length) return '';
  // The matrix above counts the categories: the chapter heading does not.
  // A chapter of its own, opening a page.
  return `<section class="section chapter">
${sectionHead({ title: `Findings by ${framework.noun}` })}
${list.map((c) => renderCategory(c, model.detailed, print)).join('\n')}
</section>`;
}

// ── Triaged findings ────────────────────────────────────────────────────────

/** A package row read from a finding whose package is gone. */
const isUnidentified = (f: Finding): boolean =>
  !f.packageName || f.packageName === 'Unknown';

/** Order of the triage states in the counts. */
const TRIAGE_ORDER = ['ignored', 'not_exploitable', 'resolved'];
const triageRank = (state: string): number =>
  TRIAGE_ORDER.indexOf(state) + 1 || TRIAGE_ORDER.length + 1;

const byTriageState = (findings: Finding[]) =>
  groupBy(findings, (f) => f.state).sort(
    (a, b) => triageRank(a.key) - triageRank(b.key),
  );

/** `594 ignored, 342 resolved`. */
function triageStates(findings: Finding[]): string {
  return byTriageState(findings)
    .map(
      (g) => `${fmt(g.items.length)} ${escapeHtml(g.key.replace(/_/g, ' '))}`,
    )
    .join(', ');
}

/** `resolved`, `ignored`, `marked not exploitable`. */
const TRIAGE_VERBS: Record<string, string> = {
  ignored: 'ignored',
  resolved: 'resolved',
  not_exploitable: 'marked not exploitable',
};

/**
 * `5 code, 6 infrastructure`: the families of some findings, as above; a
 * count never ends a line apart from its family.
 */
function families(findings: Finding[]): string[] {
  return groupBy(findings, (f) => f.type)
    .sort((a, b) => b.items.length - a.items.length)
    .map(
      (g) => `${fmt(g.items.length)}\u00a0${OPEN_WORDS[g.key] ?? safe(g.key)}`,
    );
}

/** `2 findings`, a count never ending a line apart from its noun. */
const counted = (n: number, one: string, many?: string): string =>
  plural(n, one, many).replace(' ', '\u00a0');

/**
 * `code`, `infrastructure`: the same families, uncounted, in that order
 * (text, escaped where it is shown).
 */
function familyWords(findings: Finding[]): string[] {
  return groupBy(findings, (f) => f.type)
    .sort((a, b) => b.items.length - a.items.length)
    .map((g) => OPEN_WORDS[g.key] ?? redactSecrets(g.key));
}

/**
 * Triaged findings per project (in the order of the projects table) and
 * severity, per state when several states are present (the project named
 * on its first row); a total row closes the table. A severity no triaged
 * finding has gets no column.
 */
function triagedCounts(model: SecurityModel): string {
  const counts = emptySeverityCounts();
  for (const f of model.triaged) counts[f.severity]++;
  const keys = columnKeys(counts);
  const withState = byTriageState(model.triaged).length > 1;
  const cells = (list: Finding[]): string[] => {
    const c = emptySeverityCounts();
    for (const f of list) c[f.severity]++;
    return [...keys.map((k) => countCell(c[k])), fmt(list.length)];
  };
  const byProject = groupBy(model.triaged, (f) => f.projectKey);
  const order = new Map(model.projects.map((p, i) => [p.key, i]));
  byProject.sort(
    (a, b) => (order.get(a.key) ?? 1e9) - (order.get(b.key) ?? 1e9),
  );
  const rows: string[][] = [];
  const rowClasses: string[] = [];
  const name = (list: Finding[]) =>
    `<span class="name">${breakableId(redactSecrets(list[0].projectName))}</span>`;
  for (const project of byProject) {
    if (!withState) {
      rows.push([name(project.items), ...cells(project.items)]);
      rowClasses.push('');
      continue;
    }
    byTriageState(project.items).forEach((state, i) => {
      rows.push([
        i === 0 ? name(project.items) : '',
        stateLabel(state.key),
        ...cells(state.items),
      ]);
      rowClasses.push(i === 0 ? '' : 'same-project');
    });
  }
  rows.push(['Total', ...(withState ? [''] : []), ...cells(model.triaged)]);
  rowClasses.push('total-row');
  // The counts of each row (a project, or a project in a state).
  const groups = byProject.flatMap((project) =>
    withState ? byTriageState(project.items) : [project],
  );
  const bySeverityOf = (list: Finding[], k: Severity) =>
    list.filter((f) => f.severity === k).length;
  const table = dataTable({
    className: 'compact counts triaged-counts',
    columns: [
      { label: 'Project' },
      ...(withState ? [{ label: 'State', width: '17%' }] : []),
      ...keys.map((k) =>
        countColumn(
          sevName(k),
          SEVERITY_WIDTHS[k],
          countTexts(
            groups.map((g) => bySeverityOf(g.items, k)),
            counts[k],
          ),
          COUNT_PAD,
        ),
      ),
      countColumn(
        'Total',
        '8%',
        countTexts(
          groups.map((g) => g.items.length),
          model.triaged.length,
        ),
        COUNT_PAD,
      ),
    ],
    rows,
    rowClasses,
  });
  return keepTogether(table, rows.length);
}

/**
 * Title of a list of the triaged findings, one level under the section
 * heading: never read as the context row of a table continued above. It
 * hides the context row of its own table (shared `continuation`).
 */
const listTitle = (title: string, detail = ''): string =>
  `<h3 class="list-title cont-cover">${escapeHtml(title)}${detail ? ` <span class="muted">&middot; ${detail}</span>` : ''}</h3>`;

/**
 * Triaged code findings, one row per rule and severity, as in the tables
 * above: a location triaged two ways is one row counting each state. The
 * category of a rule reads under it, beside its scanner chip (a column of
 * its own left the titles too little room).
 */
function triagedCodeList(
  model: SecurityModel,
  findings: Finding[],
  title: string,
): string {
  const rules = ruleRows(findings).sort(bySeverityThenName);
  const rows = rules.map((row) => {
    const categories = Array.from(
      new Set(row.all.flatMap((f) => model.categoriesOf.get(f.id) ?? [])),
    )
      .map((id) =>
        id === NOT_MAPPED.id
          ? 'not mapped'
          : `<span class="code nw">${escapeHtml(id)}</span>`,
      )
      .join(', ');
    return [
      sevBadge(row.first.severity),
      labelled(
        ruleName(row.first.name, titleChars(CODE_RULE_WIDTH)),
        row.first.type,
        `${categories} &middot; ${projectNames(row.projects)}`,
      ),
      locationsCell(row.all, row.projects, LOCATION_WIDTH),
      stateCell(row.all.map((f) => f.state)),
      fmt(row.all.length),
    ];
  });
  return `${listTitle(title)}${flowingTable({
    className: 'compact triaged-list',
    columns: stateAndCountColumns(rules),
    rows,
    count: rows.length,
    continuation: `${title} · continued`,
  })}`;
}

/**
 * Triaged packages, compact: one row per severity, scanner type and state,
 * every package of it listed with its versions, and the row counting its
 * packages, advisories and findings. The findings on packages the scans no
 * longer identify are counted per severity and state, never listed by id.
 */
function triagedPackageList(findings: Finding[], title: string): string {
  const order = (a: Finding, b: Finding) =>
    SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
    a.type.localeCompare(b.type) ||
    triageRank(a.state) - triageRank(b.state);
  const rows: string[][] = [];
  const identified = findings.filter((f) => !isUnidentified(f));
  const gone = findings.filter(isUnidentified);
  // A package is listed once per state, at its highest severity.
  const packages = groupBy(identified, (f) =>
    [f.type, f.packageName, f.state].join('\u0000'),
  ).map(({ items }) => ({ items, severity: highest(items) }));
  groupBy(packages, (p) =>
    [p.severity, p.items[0].type, p.items[0].state].join('\u0000'),
  )
    .sort((a, b) => order(a.items[0].items[0], b.items[0].items[0]))
    .forEach(({ items: group }) => {
      const sorted = [...group].sort((a, b) =>
        a.items[0].packageName.localeCompare(b.items[0].packageName),
      );
      const all = sorted.flatMap((p) => p.items);
      const advisories = new Set(
        all.map((f) => `${f.packageName}|${f.advisory}`),
      ).size;
      // A package is listed at its most severe advisory: the findings of
      // its other ones are counted by severity, never read as the row's.
      const counts = emptySeverityCounts();
      for (const f of all) counts[f.severity]++;
      const mixed = columnKeys(counts).length > 1;
      rows.push([
        sevBadge(group[0].severity),
        labelled(
          `<div class="pkg-list">${inlineList(
            sorted.map((p) =>
              listEntry(
                p.items[0].packageName,
                'pkg mono',
                sortedVersions(
                  p.items
                    .map((f) => f.packageVersion)
                    .filter((v) => v && v !== 'Unknown'),
                ),
              ),
            ),
          )}</div>`,
          all[0].type,
          `${counted(sorted.length, 'package')} &middot; ${counted(advisories, 'advisory', 'advisories')} &middot; ${counted(all.length, 'finding')}${
            mixed
              ? ` <span class="nw">(${severityBreakdown(counts)})</span>`
              : ''
          }`,
        ),
        stateLabel(all[0].state),
      ]);
    });
  groupBy(gone, (f) => [f.severity, f.type, f.state].join('\u0000'))
    .sort((a, b) => order(a.items[0], b.items[0]))
    .forEach(({ items }) => {
      const advisories = new Set(items.map((f) => f.advisory)).size;
      rows.push([
        sevBadge(items[0].severity),
        labelled(
          '<span class="muted">Packages no longer identified by the scans</span>',
          items[0].type,
          `${counted(advisories, 'advisory', 'advisories')} &middot; ${counted(items.length, 'finding')}`,
        ),
        stateLabel(items[0].state),
      ]);
    });
  // The rows count their packages, advisories and findings: the title does
  // not repeat them.
  return `${listTitle(title)}${flowingTable({
    className: 'compact triaged-packages',
    columns: [
      { label: 'Severity', width: '11%' },
      { label: 'Packages and versions' },
      { label: 'State', width: '12%' },
    ],
    rows,
    count: rows.length,
    continuation: `${title} · continued`,
  })}`;
}

/**
 * Triaged findings, excluded from the figures and kept short: the counts
 * per project, state and severity, then the critical and high ones only,
 * without descriptions.
 */
function renderTriaged(framework: Framework, model: SecurityModel): string {
  if (model.triaged.length === 0) return '';
  const severe = model.triaged.filter(
    (f) => SEVERITY_RANK[f.severity] <= SEVERITY_RANK.high,
  );
  const lower = model.triaged.length - severe.length;
  const code = severe.filter((f) => !isDependency(f));
  const deps = severe.filter(isDependency);
  const n = model.triaged.length;
  const states = byTriageState(model.triaged);
  // One state is said in the sentence (the counts then have no State
  // column); several are counted.
  const opening =
    states.length === 1
      ? `${plural(n, 'finding')} ${n === 1 ? 'was' : 'were'} ${TRIAGE_VERBS[states[0].key] ?? escapeHtml(states[0].key.replace(/_/g, ' '))} during triage`
      : `${plural(n, 'finding')} ${n === 1 ? 'was' : 'were'} closed during triage (${triageStates(model.triaged)})`;
  const kinds = families(severe);
  const listed = severe.length
    ? `; the ${severe.length === 1 ? 'critical or high one is' : `${fmt(severe.length)} critical and high ones are`} listed below${kinds.length > 1 ? ` (${kinds.join(', ')})` : ''}`
    : '';
  // The lists are titled short: the introduction counts them and names
  // their families. With two lists, each title names its families.
  const title = (findings: Finding[]) =>
    code.length && deps.length
      ? `Critical and high triaged ${andList(familyWords(findings))} findings`
      : 'Critical and high triaged findings';
  // Heading, introduction and counts open the section as one block; the
  // introduction gives the count, the heading does not repeat it.
  return `<section class="section">
<div class="avoid-break">
${sectionHead({ eyebrow: 'Excluded from the figures', title: 'Triaged findings' })}
<p class="section-intro">${opening}${listed}.</p>
${triagedCounts(model)}
</div>
${code.length ? triagedCodeList(model, code, title(code)) : ''}
${deps.length ? triagedPackageList(deps, title(deps)) : ''}
${lower ? `<p class="small table-note">${lower === 1 ? '1 lower-severity triaged finding is' : `${fmt(lower)} lower-severity triaged findings are`} not listed.</p>` : ''}
</section>`;
}

// ── About ───────────────────────────────────────────────────────────────────

function renderAbout(
  framework: Framework,
  model: SecurityModel,
  projects: number,
): string {
  const reference =
    framework.key === 'owasp'
      ? '<p>OWASP Top 10, 2021 edition, © OWASP Foundation, licensed under CC BY-SA 4.0 (<a href="https://owasp.org/Top10/">owasp.org/Top10</a>). Category definitions are summarised by CybeDefend.</p>'
      : '<p>2024 CWE Top 25 Most Dangerous Software Weaknesses, published by MITRE (<a href="https://cwe.mitre.org/top25/">cwe.mitre.org/top25</a>); CWE™ is a trademark of The MITRE Corporation. Ranks, trends and known exploited CVEs are MITRE statistics, not measurements of these projects.</p>';
  const withdrawn = model.open.some((f) => f.withdrawn)
    ? ' Advisories withdrawn by their publisher are tagged Withdrawn, or Duplicate when they repeat another one; they are always named and counted, as on the CybeDefend dashboard, and never set “Fixed in”.'
    : '';
  const packages = model.open.some(isDependency)
    ? [
        {
          title: 'Vulnerable packages',
          html: `<p>A vulnerable package is one row with its versions in use and all their advisories, the three most severe named, and takes the severity of its most severe advisory; its count covers every finding reported on those versions (one advisory can be reported by several sources, and once per project). “Fixed in” is the lowest version that fixes every advisory with a published fix; the advisories without one are counted as unfixed.${withdrawn}</p>`,
        },
      ]
    : [];
  return aboutSection([
    {
      title: 'Scope and method',
      html: `<p>This report aggregates the latest findings of ${plural(projects, 'project')}. ${framework.aboutText}</p><p>Figures count open findings (to verify or confirmed); findings closed during triage (ignored, resolved, not exploitable) are excluded from them, and the critical and high ones are listed at the end.</p>`,
    },
    {
      title: 'Reading the rows',
      html: '<p>Each row is one rule at one severity, with the files and lines where it was found (as scanned) and the projects concerned; when a row covers several projects, a file or folder found in only some of them is followed by “only in” and their names. Critical and high rows add the opening sentences of the rule’s description; a rule rated differently in two projects has one row per severity, and its description is given once, under the most severe row, which its other critical or high rows point to. The per-project reports give each description in full.</p><p>The Count column gives the number of findings a row stands for: ×3 marks three findings of one project on the same line or within the same range, and a row with several states counts each state.</p>',
    },
    ...packages,
    { title: 'Reference', html: reference },
    {
      title: 'Disclaimer',
      html: '<p>Automated analysis of the code as scanned: it does not guarantee the absence of other vulnerabilities, nor replace a manual security review.</p>',
    },
  ]);
}

const FRAMEWORKS: Record<'owasp' | 'cwe', () => Framework> = {
  owasp: owaspFramework,
  cwe: cweFramework,
};

export const SECURITY_REPORT_TITLES: Record<'owasp' | 'cwe', string> = {
  owasp: 'OWASP Top 10 report',
  cwe: 'CWE Top 25 report',
};

const SECURITY_CSS = `
  /* A count never breaks between two digits (« 1,26 / 8 »): its column is
     never narrower than its widest count (countFloor). */
  table.compact td.right { white-space: nowrap; }
  .cat-label { display: flex; gap: 8px; align-items: baseline; }
  .cat-label .code { flex: none; }
  .matrix-owasp .code { min-width: 26px; }
  .matrix th.right, .matrix td.right { padding-left: 0; }
  .matrix tr.is-triaged .name { font-weight: 400; }
  .heatmap td.right { padding-left: 2px; padding-right: 6px; }
  .heat { display: inline-block; min-width: 26px; padding: 0 5px; border-radius: 4px; text-align: right; }
  .heat-1 { background: rgba(120, 69, 255, 0.07); }
  .heat-2 { background: rgba(120, 69, 255, 0.15); }
  .heat-3 { background: rgba(120, 69, 255, 0.25); }
  .heat-4 { background: rgba(120, 69, 255, 0.38); }
  .heat-5 { background: rgba(120, 69, 255, 0.52); }
  /* How to read the bars of the summary, above them. */
  .split-note { margin: 0 0 8px; }
  /* An id in the key facts, set as in the bars beside. */
  .key-facts .code { font-size: 10px; font-weight: 400; color: ${COLORS.textMuted}; }

  /* The findings open a page. A category: one heading block (title,
     severities, reference text and measures), whole, that hides the context
     row of the table below and travels with its first rows; the row names
     the category on the pages the table continues on. */
  .chapter { break-before: page; }
  .cat { margin-top: 26px; }
  .section-head + .cat { margin-top: 0; }
  .cat-head { break-inside: avoid; break-after: avoid; }
  .cat-title { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; padding-bottom: 6px; margin-bottom: 8px; border-bottom: 1px solid ${COLORS.rule}; }
  .cat-title .eyebrow { font-size: 9.5px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: ${COLORS.accent}; margin-bottom: 2px; }
  .cat-title h3 { margin: 0; }
  .cat-title .aside { font-size: 11px; color: ${COLORS.textMuted}; white-space: nowrap; }
  .cat-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px; margin: 0 0 8px; font-size: 10px; color: ${COLORS.textSecondary}; }
  .cat-meta .sev { display: inline-flex; align-items: center; gap: 5px; }
  .cat-intro { font-size: 10px; color: ${COLORS.textSecondary}; margin: 0; }
  .ref { font-size: 10px; color: ${COLORS.textSecondary}; }
  .ref-meta { color: ${COLORS.textMuted}; }
  .ref-name, .ref-stats { display: block; }
  .ref-stats { white-space: nowrap; }
  .ref p { margin-bottom: 4px; }
  .ref-title { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; margin: 6px 0 2px; break-after: avoid; }
  .ref-title > span:first-child { font-size: 9.5px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: ${COLORS.textMuted}; }
  .ref ul { margin: 2px 0 0; padding: 0; }
  .ref li { margin: 1px 0; }
  /* The shared bullet sits on the middle of the letters of the key facts'
     11.5px text: on the 10px text of the measures, a little higher. */
  .ref li::before { top: 0.5em; }
  .ref .ref-link { color: ${COLORS.textMuted}; white-space: nowrap; }

  /* Locations: one file per line, a wrapped path indented under its first
     line, files of one folder indented under it (a wrapped folder like a
     path, its files one step further); a line holding several findings
     says how many. */
  .loc { padding-left: 10px; text-indent: -10px; }
  .locs wbr.lw { display: none; }
  /* A file name longer than its line: its wrapped lines one step further in
     than the lines of its path (which open on « / »), two when it opens the
     location (one step is the first line of a file under its folder). */
  .loc-name { display: inline-block; max-width: 100%; padding-left: 10px; text-indent: -10px; }
  .loc > .path > .loc-name:first-child { padding-left: 20px; text-indent: -20px; }
  .loc.in-dir { padding-left: 20px; }
  .loc-dir.wraps { padding-left: 10px; text-indent: -10px; }
  .loc.in-dir.deep { padding-left: 30px; }
  .locs > * + * { margin-top: 5px; }
  .locs > .in-dir { margin-top: 1px; }
  /* The projects of a file or folder, on a line of their own under it, in
     the text face: under a file where its wrapped lines go on, under a
     folder at the folder's indent (its files start one step further).
     Close under what it qualifies, apart from the location below. */
  .loc-note { font-family: ${FONT_STACK}; font-size: 10px; color: ${COLORS.textMuted}; text-indent: 0; line-height: 1.3; margin-top: -1px; padding-bottom: 3px; }
  .mult, .more { white-space: nowrap; font-family: ${FONT_STACK}; font-size: 10px; color: ${COLORS.textMuted}; }

  /* Several states in a row: each with its count, on one line. */
  .state-line { display: flex; align-items: baseline; gap: 5px; white-space: nowrap; }
  .state-line + .state-line { margin-top: 2px; }
  .state-n { font-size: 10px; color: ${COLORS.textMuted}; font-variant-numeric: tabular-nums; }
  .code-table th.right, .code-table td.right { padding-left: 0; }
  .triaged-list th.right, .triaged-list td.right { padding-left: 0; }

  /* Scanner chip, then the projects: a wrapped line aligns after the chip. */
  .sub.typed { display: flex; align-items: baseline; gap: 5px; }
  .sub.typed .chip { flex: none; }

  /* Lead sentence of a rule, under its row, aligned on the rule's column. */
  /* The Severity column is 11% of the table; the note cell is narrower by
     its padding (2 x 8px), hence the 1.76px. */
  .rule-desc { margin-left: calc(11% + 1.76px); font-size: 10px; line-height: 1.45; color: ${COLORS.textSecondary}; }
  /* A rule title wraps in balanced lines, never one word alone (Chromium
     balances the lines of a block only). */
  .code-table .name, .triaged-list .name { display: block; text-wrap: balance; }
  /* The two parts of a long title (noun group, then the phrase after it):
     a line breaks between them. */
  .name .ph { display: inline-block; text-wrap: balance; }
  /* The less severe row of a rule described above says so, under its
     projects. */
  .rule-ref { color: ${COLORS.textMuted}; }
  .rule-ref.own { display: block; }
  .rule-desc code { font-size: 9.5px; }
  /* No italic face is embedded: an emphasis of the scanner's text reads in
     the medium weight, never slanted by the browser. */
  .rule-desc em { font-style: normal; font-weight: 500; }

  /* Lists of the triaged findings: titled one level under the section. */
  .list-title { font-size: 13px; margin: 22px 0 0; }
  .list-title .muted { font-size: 11px; font-weight: 400; }

  /* Advisory ids of a vulnerable package. */
  .adv-count { color: ${COLORS.dark}; }
  .adv-count .breakdown { display: inline-block; max-width: 100%; }
  .adv-ids { margin-top: 3px; font-size: 10px; line-height: 1.55; color: ${COLORS.textSecondary}; }
  .adv { display: inline-block; max-width: 100%; margin-right: 8px; }
  .adv i { display: inline-block; width: 5px; height: 5px; border-radius: 50%; margin-right: 3px; vertical-align: 1.5px; }
  /* A withdrawn advisory: tagged after its id, as in the per-project reports. */
  .adv .tag { display: inline-block; margin-left: 4px; padding: 0 4px; border: 1px solid ${COLORS.border}; border-radius: 4px; font-family: ${FONT_STACK}; font-size: 9.5px; font-weight: 600; line-height: 1.4; letter-spacing: 0.04em; text-transform: uppercase; color: ${COLORS.textSecondary}; vertical-align: 0.5px; }
  .pkg-list { line-height: 1.55; }
  .dep-table .versions { margin-left: 1px; }
  /* The plain space that takes the place of the no-break space after a
     package in a preview narrower than the page (packageLabel). */
  .dep-table .unglue { display: none; }
  /* A package and its versions: a line of versions sent to the next line
     is indented under the name, as a wrapped path is. */
  .dep-table .pkg-head { padding-left: 10px; text-indent: -10px; }
  /* A scoped package wraps after its scope like text, one chip whose cut
     edges stay open (the shared slice: a pill per line read as several
     packages); its version follows the name on the same line. */
  .dep-table .code-chip.pkg { display: inline; }
  /* Its long part, a block within the line, moves to the next line whole
     and leaves the chip's padding (5px on each side of every line) inside
     the column. */
  .dep-table .code-chip.pkg .seg.is-long { max-width: calc(100% - 10px); }
  /* Longer than a line, it flows in the chip, broken before its
     separators: every line keeps the background (a block there left one
     bare and laid a bar the width of the column under the last). */
  .dep-table .pkg-head.flows .code-chip.pkg .seg.is-long { display: inline; max-width: none; }
  /* The count column has room for its header without a left padding (a
     wide Fixed in column takes a point from it). */
  .dep-table th.right, .dep-table td.right { padding-left: 0; }
  /* The image of the container packages below it, once, on the Package
     column (the Severity column is 11% of the table; the cell is narrower by
     its padding, 2 x 8px, hence the 1.76px), closed on its first package. */
  .dep-table tr.image-row td { padding-top: 7px; padding-bottom: 1px; border-bottom: none; }
  .image-head { margin-left: calc(11% + 1.76px); font-size: 10px; line-height: 1.45; color: ${COLORS.textMuted}; }
  .image-head .image-label { font-weight: 600; color: ${COLORS.textSecondary}; }
  .image-head .path { color: ${COLORS.dark}; }
  /* An image's rows, from the line naming it to its last package, ruled on
     their left edge: the rule stops on the last one, and a row under no
     rule (a dependency of a manifest) belongs to no image. Every cell of
     such a row is positioned, not only the one holding the rule: they
     paint in the order of any other row, the package after the severity
     (the first cell alone painted above the others, and a badge wider than
     its column in a narrow preview covered the start of the package name). */
  .dep-table tr.in-image td, .dep-table tr.image-row td { position: relative; }
  .dep-table tr.in-image td:first-child::before, .dep-table tr.image-row td::before { content: ''; position: absolute; left: 0; top: -1px; bottom: -1px; width: 2px; background: ${COLORS.textMuted}; }
  .dep-table tr.image-row td::before { top: 7px; }
  .dep-table tr.image-end td:first-child::before { bottom: 0; }
  /* In the PDF, the packages of an image form a table in one row of the
     table (imageTable): the row unpadded, that table flush with it, its
     header (the line naming the image, repeated on the pages its packages
     continue on) set as the line of the preview, without the header's
     background. The row's bottom border is the rule under the image's last
     package. That row breaks between two packages, as the table's own rows
     do: kept whole like any row, it left the foot of the page before it
     blank. */
  .dep-table tr.image-block { break-inside: auto; }
  /* Its first and last packages go to another page as in one table: the
     first with the line (its header), the others alone. The edges of a
     table, kept in pairs, sent the line and two packages to the next page. */
  table.image-table tbody:first-of-type > tr:first-child + tr, table.image-table tbody:last-child > tr:last-child { break-before: auto; }
  /* Nor is the row holding them tied to the row before or after it (the
     first and last rows of the category's table): Chromium, unable to break
     there, never breaks inside the row before it but before it, and an
     image that fitted the page went whole to the next one. */
  table.dep-table:not(.image-table) > tbody > tr.image-block, table.dep-table:not(.image-table) > tbody > tr.image-block + tr { break-before: auto; }
  .dep-table tr.image-block > td { padding: 0; }
  /* Each of its rows draws its own bottom rule: collapsed, the rule a row
     shares with the one above it, left on the page before, was drawn again
     under the repeated line. */
  table.image-table { margin-top: 0; border-collapse: separate; border-spacing: 0; }
  .dep-table thead tr.image-row { background: none; }
  /* The table's last row drops its rule, and a descendant selector reached
     every package of the image's table held in it: the packages of the last
     image of a table went without a rule. Only its last package does (two
     classes: that shared rule weighs two pseudo-classes). */
  table.dep-table.image-table > tbody > tr > td { border-bottom: 1px solid ${COLORS.rule}; }
  table.dep-table.image-table > tbody:last-child > tr:last-child > td { border-bottom: none; }
`;

/**
 * The dashboard preview narrower than the page (an iframe under 929px: the
 * sheet shrinks below the PDF's width): the lines of a location, laid out
 * for the PDF, may wrap between two of their runs (before a « / », after a
 * comma) or before a separator of a run, rather than run past their column;
 * never after a hyphen or inside a range, as the browser's own breaks did.
 */
const SCREEN_CSS = `
  @media (max-width: 928px) { .locs wbr.lw { display: inline; } }
  /* A table of counts sizes its columns on their headers and counts, its
     name column taking the rest: a header never runs into the next one, a
     count never breaks. Its headers are set closer: spaced as in the PDF,
     they took the room of three category names at 850 px. The heat map's
     headers of two words take two lines (« Not mapped »): on one line, that
     column left its project names too little under 850 px. */
  @media (max-width: 928px) {
    table.counts { table-layout: auto; }
    .dep-table .glue { display: none; }
    .dep-table .unglue { display: inline; }
    table.counts th { letter-spacing: 0.02em; }
    table.counts.heatmap th.right { white-space: normal; }
  }
  /* As long as the headers keep their size, each word of a project name of
     the heat map stays whole (heatName): its column is never narrower than
     its longest word. */
  @media (min-width: 821px) and (max-width: 928px) { .heatmap .name .word { white-space: nowrap; } }
  /* Narrower still, its headers are set smaller, the ones of two words on
     two lines, and the heat map's cells hold their box with less padding:
     the counts fit the sheet, the names keep their words. */
  @media (max-width: 820px) {
    table.counts th { font-size: 8.5px; }
    table.counts:not(.matrix) th.right { padding-left: 4px; }
    table.counts.heatmap th.right { padding-left: 2px; padding-right: 3px; }
    table.counts.heatmap td.right { padding-left: 1px; padding-right: 3px; }
    /* The projects a pointer to a row above names break after a comma
       there, never inside a name: kept on one line, they ran past a Rule
       column narrowed by the State and Count columns, and pushed the names
       before them out. */
    .rule-ref.own .ref-names { white-space: normal; }
  }
`;

/** Aggregated OWASP Top 10 / CWE Top 25 report (HTML document). */
export function renderSecurityReport(
  kind: 'owasp' | 'cwe',
  options: AggregatedReportOptions,
  forPdf: boolean,
): string {
  const framework = FRAMEWORKS[kind]();
  const data = options.aggregatedData ?? {};
  const model = buildModel(framework, data, options.detailed !== false);
  const nProjects = options.projectIds?.length ?? model.projects.length;

  const cover = renderCover({
    eyebrow: `${scopeEyebrow(options.scopeType)} · ${framework.eyebrowEdition}`,
    title: framework.reportTitle,
    subtitle: framework.subtitle(nProjects),
    meta: aggregatedCoverMeta(options, {
      branches: model.branches,
      unbranched: model.images ? 'container images' : undefined,
    }),
  });

  const body = [
    cover,
    renderSummary(framework, model),
    renderProjects(model),
    renderMatrix(framework, model),
    renderCategories(framework, model, forPdf),
    renderTriaged(framework, model),
    renderAbout(framework, model, nProjects),
  ].join('\n');

  return renderReportDocument({
    title: `${framework.reportTitle} · ${options.scopeName ?? ''}`,
    forPdf,
    body,
    // A forced page break keeps the margin above the chapter in the PDF: it
    // starts at the top like every other page. On screen it keeps its room.
    extraCss: `${AGGREGATED_CSS}${SECURITY_CSS}${forPdf ? '\n  .chapter { margin-top: 0; }\n' : `${AGGREGATED_SCREEN_CSS}${SCREEN_CSS}`}`,
  });
}
