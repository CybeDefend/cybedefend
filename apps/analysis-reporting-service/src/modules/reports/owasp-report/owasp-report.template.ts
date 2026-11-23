// owasp-report.template.ts
//
// HTML of the per-project OWASP Top 10 2021 report (PDF and dashboard
// preview), built on the shared report design system. The figures count OPEN
// findings only; triaged findings are counted at the end, outside the figures,
// and only the critical and high ones are listed.
// Every finding sits in exactly one category (or in "not mapped"), so the
// category table adds up to the headline total.

import { escapeHtml } from '../../../core/utils/html-escape';
import {
  OWASP_TOP_10_2021_DATA,
  OwaspCategoryData,
} from './constants/owasp-data.constants';
import {
  MappedVulnerability,
  OwaspExploitability,
  OwaspReportData,
  ScanMetadata,
} from './owasp-report.types';
import {
  aboutSection,
  arrowIcon,
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
  verdictPill,
} from '../shared/report-layout';
import {
  COLORS,
  IdPunctuation,
  LONG_ID_CHARS,
  MONO_STACK,
  breakableId,
  breakableVersion,
  idBox,
  idPieces,
  isLongId,
  joinShortPieces,
  severityBadge,
  severityColors,
  severityLabel,
  typeBadge,
  versionChip,
  versionColumnChars,
  versionPieces,
} from '../shared/report-styles';
import { ChartDatum, horizontalBars } from '../shared/report-charts';
import {
  clampMarkdown,
  curlyApostrophesHtml,
  markdownToHtml,
  plainText,
} from '../shared/report-markdown';
import {
  comparePackageVersions,
  formatReportDate,
  groupBy,
  isActiveState,
  redactSecrets,
} from '../shared/report-findings';
import {
  NO_REPORT_ANALYSIS,
  type ReportAnalysisBrief,
  type ReportAnalysisBriefOptions,
  type ReportAnalysisRenderer,
  type ReportAnalysisSource,
} from '../../../edition/ports/report-analysis.port';

export interface OwaspRenderOptions {
  forPdf: boolean;
  /** Adds the condensed OWASP reference text and the finding descriptions. */
  detailed: boolean;
  /** Prints the analyses the findings carry; none when absent. */
  analysis?: ReportAnalysisRenderer;
}

const REPORT_TITLE = 'OWASP Top 10 report';
const DESCRIPTION_MAX = 600;
const REASON_MAX = 300;
const LOCATIONS_MAX = 6;
const TOP_FINDINGS = 5;
/** Rows a table of occurrences keeps with the brief that covers them all. */
const JOINED_ROWS_MAX = 3;
/** A title in a table cell is cut only past three lines. */
const TITLE_MAX = 180;
/** A container CVE's summary, under its ids: whole sentences, four lines. */
const SUMMARY_MAX = 250;
/** Every severity column has this width, so badges line up across tables. */
const SEVERITY_COL = '88px';
/**
 * A state column holds the longest word of a state and its dot (« Not
 * exploitable » wraps between its words), whatever the table.
 */
const STATE_COL = '13%';
/**
 * A state column below 950px in the dashboard preview (OWASP_PREVIEW_CSS):
 * « exploitable », the widest word of a state, with its dot and their gap
 * (67px in Rubik 11px, measured in the PDF), and the padding of its cell.
 * A share of the narrower text column held less: at a window of 700px,
 * « Confirmed » read « Confir » / « med ».
 */
const STATE_COL_PX = 88;
/**
 * The width of a state column, `share` of the text column; in the preview,
 * a custom property, STATE_COL_PX below 950px.
 */
const stateWidth = (share: string, forPdf: boolean): string =>
  forPdf ? share : `var(--state-col, ${share})`;
/** Text column of a PDF page (A4 within its margins), CSS px. */
const PAGE_PX = 688;
/**
 * Text column of the dashboard preview in its modal, CSS px: an iframe of
 * 840px, its scrollbar (15px) included, less the margins of the page
 * (2 × 16px), the page zoomed by 1.13, less its padding (2 × 53px). Below
 * 950px, the A06 tables take the widths computed for it (OWASP_PREVIEW_CSS).
 */
const PREVIEW_PAGE_PX = (840 - 15 - 32) / 1.13 - 106;
/** JetBrains Mono at 10px: every glyph is 6px wide. */
const MONO_CHAR_PX = 6;

const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;
type SeverityKey = (typeof SEVERITIES)[number] | 'unknown';
const SEVERITY_RANK: Record<SeverityKey, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  unknown: 4,
};
/** Verdicts that make a finding exploitable, from an agent or a reviewer. */
const EXPLOITABLE = new Set(['proven', 'actively_exploited', 'malicious']);
const ANALYSED_BY = new Set(['agent', 'manual']);
/** Strongest verdict first. */
const VERDICT_RANK: Record<string, number> = {
  actively_exploited: 0,
  malicious: 0,
  proven: 1,
  theoretical: 2,
  not_exploitable: 3,
};

/** Scanner families, in the order the report names them. */
const FAMILIES = [
  ['sast', 'SAST'],
  ['iac', 'IaC'],
  ['sca', 'SCA'],
  ['container', 'Container'],
] as const;

/** Short category names, for the summary chart. */
const SHORT_TITLES: Record<string, string> = {
  A01: 'Access control',
  A02: 'Cryptography',
  A03: 'Injection',
  A04: 'Insecure design',
  A05: 'Misconfiguration',
  A06: 'Vulnerable components',
  A07: 'Authentication',
  A08: 'Data integrity',
  A09: 'Logging, monitoring',
  A10: 'SSRF',
};

const DASH = '&#8211;';
const MIDDOT = '&#183;';
const NBSP = '&#160;';
const ELISION = '[&#8230;]';
/** The one mark of a shortened text, in titles, summaries and descriptions. */
const ELIDED = `<span class="elided">${ELISION}</span>`;

interface CategoryModel {
  data: OwaspCategoryData;
  open: MappedVulnerability[];
}

interface ReportModel {
  open: MappedVulnerability[];
  triaged: MappedVulnerability[];
  /** Finding id → OWASP category id (A01…A10). */
  categoryOf: Map<string, string>;
  /** The ten categories, A01 → A10, with their open findings. */
  categories: CategoryModel[];
  /** Open findings outside the Top 10. */
  unmapped: MappedVulnerability[];
}

type TableRow =
  | string[]
  | { full: string; className?: string; attach?: boolean };

// ── helpers ─────────────────────────────────────────────────────────────────

const severityKey = (severity: string): SeverityKey => {
  const key = String(severity ?? '')
    .trim()
    .toLowerCase();
  return (SEVERITIES as readonly string[]).includes(key)
    ? (key as SeverityKey)
    : 'unknown';
};

const stateKey = (state: string): string => String(state ?? '').toLowerCase();

const stateRank = (state: string): number => {
  const key = stateKey(state);
  if (key === 'confirmed') return 0;
  if (key === 'to_verify') return 1;
  return 2;
};

/** Distinct states of a list, most pressing first. */
const statesOf = (items: MappedVulnerability[]): string[] =>
  Array.from(new Set(items.map((v) => stateKey(v.state)))).sort(
    (a, b) => stateRank(a) - stateRank(b) || a.localeCompare(b),
  );

/** `not_exploitable` → `not exploitable`. */
const humanState = (state: string): string =>
  stateKey(state).replace(/_/g, ' ');

/**
 * Free text from the data: secrets masked, and punctuation the embedded
 * (latin) fonts lack mapped to what they have, so no glyph falls back to a
 * Type 3 font.
 */
const plain = (value: unknown): string =>
  redactSecrets(String(value ?? ''))
    .replace(/[‐‑]/g, '-')
    .replace(/→/g, '->');

const text = (value: unknown): string => escapeHtml(plain(value));

/**
 * Cuts a title after its last full sentence that fits, else on a word
 * boundary, never inside a parenthesis it opened.
 */
const clip = (value: string, max: number): { text: string; cut: boolean } => {
  const s = String(value ?? '').trim();
  if (s.length <= max) return { text: s, cut: false };
  const cut = s.slice(0, max + 1);
  const sentences = [...cut.matchAll(/[.!?](?=\s)/g)].map((m) => m.index);
  const sentenceEnd = sentences.length ? sentences[sentences.length - 1] : -1;
  if (sentenceEnd >= max / 2) {
    return { text: cut.slice(0, sentenceEnd + 1), cut: true };
  }
  const boundary = cut.lastIndexOf(' ');
  let kept = boundary > max / 2 ? cut.slice(0, boundary) : cut;
  const open = kept.lastIndexOf('(');
  if (open > kept.lastIndexOf(')') && open > max / 2) {
    kept = kept.slice(0, open);
  }
  return { text: kept.replace(/[\s,;:.(]+$/, ''), cut: true };
};

/** A sentence ends on a stop followed by a space and a capital or a digit. */
const SENTENCE_BREAK = /(?<=[.!?])\s+(?=[A-Z0-9"'(`*_])/;

/**
 * The whole sentences of `text` that fit in `max` characters. A sentence
 * without its stop (a text cut short at the source) is never kept.
 */
const wholeSentences = (text: string, max: number): string[] => {
  const kept: string[] = [];
  let length = 0;
  for (const sentence of text.split(SENTENCE_BREAK)) {
    const added = (kept.length ? 1 : 0) + sentence.length;
    if (!/[.!?]$/.test(sentence) || length + added > max) break;
    kept.push(sentence);
    length += added;
  }
  return kept;
};

/** A word of a title with hyphens (`form-data`, `CVE-2026-1`, `3.5.5-r0`). */
const HYPHENATED = /(@?)([A-Za-z0-9_.]+(?:-[A-Za-z0-9_.]+)+)/g;

/**
 * A word of a title with hyphens or slashes (a scoped package, a path), the
 * parenthesis before it and the punctuation after it.
 */
const COMPOUND = /(\(?)(@?[A-Za-z0-9_.]+(?:[-/][A-Za-z0-9_.]+)+)([,;:!?)]*)/g;

/** Hyphenated words kept whole: `form-data`, the « @ » of `@nest-js` outside. */
const nobrHyphenated = (text: string): string =>
  text.replace(
    HYPHENATED,
    (_word: string, at: string, word: string) =>
      `${at}<span class="nobr">${word}</span>`,
  );

/**
 * A long word of a title with hyphens or slashes (`@scope/package-name`),
 * cut before each « / », the line then opening on it (a part of fewer than
 * three characters stays with its neighbour). A long part is an identifier
 * in a box, whole while it fits on a line, else cut before its separators;
 * a short one never breaks. The punctuation around the word stays with it.
 */
function compoundHtml(word: string, open: string, close: string): string {
  const parts = joinShortPieces(word.split(/(?=\/)/));
  const last = parts.length - 1;
  return parts
    .map((part, i) => {
      const before = i === 0 ? open : '';
      const after = i === last ? close : '';
      return isLongId(part)
        ? idBox(breakableId(part), { before, after })
        : `${before}<span class="nobr">${part}</span>${after}`;
    })
    .join('<wbr>');
}

/**
 * Hyphenated words (`form-data`, `CVE-2026-1`, `3.5.5-r0`) never wrap at a
 * hyphen: only the text between tags is touched. A long one, with the `/`
 * of a scope or a path it runs into, is an identifier (see compoundHtml),
 * never out of its cell.
 */
const keepHyphenated = (html: string): string =>
  html
    .split(/(<[^>]+>)/)
    .map((part) =>
      part.startsWith('<')
        ? part
        : part.replace(
            COMPOUND,
            (match: string, open: string, word: string, close: string) =>
              isLongId(word)
                ? compoundHtml(word, open, close)
                : nobrHyphenated(match),
          ),
    )
    .join('');

/** Plain text escaped, its `inline code` shown as code, a stray backtick dropped. */
const inlineHtml = (value: string): string =>
  curlyApostrophesHtml(
    keepHyphenated(
      escapeHtml(value)
        .replace(/`([^`]+)`/g, '<code class="code-inline">$1</code>')
        .replace(/`/g, ''),
    ),
  );

/**
 * A title as a heading reads: without the lone full stop some sources end it
 * with (never an ellipsis).
 */
const headingText = (value: unknown): string =>
  plain(value)
    .trim()
    .replace(/(?<!\.)\.$/, '');

/** A rule or advisory title; past `max` characters it is cut and marked. */
const titleText = (value: unknown, max?: number): string => {
  const raw = headingText(value);
  const shown = max ? clip(raw, max) : { text: raw, cut: false };
  return `${inlineHtml(shown.text)}${shown.cut ? ` ${ELIDED}` : ''}`;
};

/**
 * The summary of a container CVE, under its ids: the whole sentences of its
 * first paragraph that fit, without the « Issue summary: » label; what is
 * left out is marked.
 */
function summaryHtml(value: string): string {
  const text = plain(value)
    .replace(/^\s*Issue summary:\s*/i, '')
    .trim();
  if (!text) return '';
  const [first, ...rest] = text.split(/\n\s*\n/);
  const paragraph = first.replace(/\s+/g, ' ').trim();
  const sentences = wholeSentences(paragraph, SUMMARY_MAX);
  let shown = sentences.join(' ');
  if (!sentences.length) {
    // One sentence too long, or no stop at all: cut on a word.
    const cut = paragraph.slice(0, SUMMARY_MAX + 1);
    const boundary = cut.lastIndexOf(' ');
    shown =
      paragraph.length <= SUMMARY_MAX
        ? paragraph
        : cut.slice(0, boundary > 0 ? boundary : SUMMARY_MAX);
    shown = shown.replace(/[\s,;:]+$/, '');
  }
  const cut = shown !== paragraph || rest.some((p) => p.trim());
  return `${inlineHtml(shown)}${cut ? ` ${ELIDED}` : ''}`;
}

const plural = (n: number, word: string, many = `${word}s`): string =>
  `${n} ${n === 1 ? word : many}`;

const listWords = (items: string[]): string =>
  items.length <= 1
    ? (items[0] ?? '')
    : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

const countKeys = (keys: SeverityKey[]): Record<SeverityKey, number> => {
  const counts = { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 };
  for (const key of keys) counts[key] += 1;
  return counts;
};

const countSeverities = (
  items: MappedVulnerability[],
): Record<SeverityKey, number> =>
  countKeys(items.map((v) => severityKey(v.severity)));

/** Severity columns of a count table: « Unrated » only when needed. */
const severityColumns = (items: MappedVulnerability[]): SeverityKey[] => [
  ...SEVERITIES,
  ...(items.some((v) => severityKey(v.severity) === 'unknown')
    ? (['unknown'] as const)
    : []),
];

/** A count in a table; zero reads as a light dash. */
const countCell = (n: number, strong = false): string =>
  n
    ? strong
      ? `<strong>${n}</strong>`
      : String(n)
    : `<span class="zero">${DASH}</span>`;

/** Severity badge; a finding without a rating reads « Unrated ». */
const badge = (severity: string): string =>
  severityBadge(severityKey(severity));

const severityName = (key: SeverityKey): string => severityLabel(key);

/** Severity counts with their colour dot (`● 1 critical  ● 3 high`). */
const severityDots = (counts: Record<SeverityKey, number>): string =>
  [...SEVERITIES, 'unknown' as const]
    .filter((k) => counts[k])
    .map(
      (k) =>
        `<span class="sev-count"><span class="sev-dot" style="background: ${severityColors(k).solid};"></span>${counts[k]} ${severityName(k).toLowerCase()}</span>`,
    )
    .join('');

/**
 * Orders the versions of a package: semver for a language package, dpkg
 * order for an image one (`-r9` before `-r10`, never read as semver
 * pre-releases; the epoch of a Debian version first, never as its major).
 */
const compareVersions = comparePackageVersions;

/** `78-102` → `78–102`, `33-33` → `33`. */
const lineLabel = (line?: string): string => {
  const [start, end] = String(line ?? '').split('-');
  if (!start || start === '0') return '';
  return !end || end === start ? start : `${start}–${end}`;
};

const packageLabel = (v: MappedVulnerability): string => {
  const name = v.packageName || 'unknown package';
  return v.packageVersion ? `${name}@${v.packageVersion}` : name;
};

const isDependency = (v: MappedVulnerability): boolean =>
  v.type === 'sca' || v.type === 'container';

/** `path:line` of a code finding (plain text). */
const placeOf = (v: MappedVulnerability): string => {
  const line = lineLabel(v.line);
  const path = plain(v.path || '');
  return line ? `${path}:${line}` : path;
};

/**
 * A version in running text. A short one never breaks (never at its
 * hyphen). A long one (an epoch, a prerelease with a commit hash) is one
 * identifier, as idText names it, whole while it fits on a line, else cut
 * only between its parts (versionPieces): never in a Debian revision nor
 * between two digits. `punctuation`: what borders it, never parted from it.
 */
const versionText = (
  version: string,
  punctuation: IdPunctuation = {},
): string =>
  isLongId(version)
    ? idBox(
        `<span class="id-text is-long">${breakableVersion(version)}</span>`,
        punctuation,
      )
    : `${escapeHtml(punctuation.before ?? '')}${keepHyphenated(escapeHtml(version))}${escapeHtml(punctuation.after ?? '')}`;

/**
 * Installed versions, separated by commas, each comma kept with the version
 * it follows (see versionText).
 */
const versionsHtml = (versions: string[]): string =>
  versions
    .map((version, i) =>
      versionText(plain(version), {
        after: i < versions.length - 1 ? ',' : '',
      }),
    )
    .join(' ');

/**
 * An image reference (`alpine:latest`, a private registry, a digest): an
 * identifier, cut after its separators rather than mid-word when it does
 * not fit on a line.
 */
const imageRef = (image: string): string => idText(plain(image));

/**
 * « in <image> »: the word joined to the image by a no-break space (in its
 * box when the image is long), so that « in » never ends a line alone.
 */
const inImage = (image: string): string =>
  idText(plain(image), { before: 'in\u00a0' });

/** An advisory id in monospace; a long one may wrap as an identifier. */
const advisoryIdHtml = (id: string): string => {
  const shown = plain(id);
  return isLongId(shown)
    ? idText(shown)
    : `<span class="mono">${escapeHtml(shown)}</span>`;
};

/**
 * A package and its installed versions, one form whatever their number and
 * wherever it is named: the package chip, then its versions, which may wrap.
 * `brief` names only the lowest of more than two, and how many more there
 * are.
 */
const packageRef = (
  name: string,
  versions: string[],
  brief = false,
): string => {
  const shown = brief && versions.length > 2 ? versions.slice(0, 1) : versions;
  const more = versions.length - shown.length;
  return `${packageChip(plain(name))}${shown.length ? ` <span class="versions">${versionsHtml(shown)}</span>` : ''}${more ? `<span class="more">+${more} versions</span>` : ''}`;
};

/** An installed package, as the A06 tables name it. */
const packageOf = (v: MappedVulnerability): string =>
  packageRef(
    v.packageName || 'unknown package',
    v.packageVersion ? [v.packageVersion] : [],
  );

/**
 * Where a finding is: `path:line` for code, in the mono path style; its
 * package and version for a dependency.
 */
const location = (v: MappedVulnerability): string =>
  isDependency(v) ? packageOf(v) : pathText(placeOf(v));

/** The image of a container finding, after its package: which to rebuild. */
const imageOf = (v: MappedVulnerability): string =>
  v.type === 'container' && v.imageName
    ? `<span class="plan-image"> ${inImage(v.imageName)}</span>`
    : '';

const versionsOf = (items: MappedVulnerability[]): string[] =>
  Array.from(new Set(items.map((v) => v.packageVersion).filter(Boolean))).sort(
    compareVersions,
  );

const cweLabel = (cwe: string): string =>
  String(cwe).startsWith('CWE-') ? String(cwe) : `CWE-${cwe}`;

// ── descriptions ────────────────────────────────────────────────────────────

/**
 * « (e.g., in **test1**) »: the shared Markdown drops the references of a
 * description to its rule's test fixtures, but not in bold.
 */
const BOLD_FIXTURE_ASIDE = /\s*\((?:see|e\.g\.,?\s*in)\s+\*\*test\d+\*\*\)/gi;

/**
 * Catalogue descriptions, made uniform: `**Label**:` carries its colon in
 * bold like `**Label:**`, and the fixture asides the shared Markdown misses
 * are dropped.
 */
const normalizeDescription = (md: string): string =>
  String(md ?? '')
    .replace(BOLD_FIXTURE_ASIDE, '')
    .replace(/\*\*([^*\n]+?)\*\*:/g, '**$1:**');

/** Inline code right before a punctuation mark sits tight against it. */
const tightCode = (html: string): string =>
  html.replace(
    /<code class="code-inline">((?:(?!<\/code>)[\s\S])*)<\/code>(?=(?:<\/strong>|<\/em>)?[:;,.!?)])/g,
    '<code class="code-inline is-tight">$1</code>',
  );

/**
 * When a description is shortened, the room left by its last whole block is
 * filled with the whole sentences of the next paragraph that fit.
 */
function fillWithSentences(source: string, kept: string): string {
  if (source.includes('```')) return kept;
  const blocks = source
    .trim()
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);
  const next = blocks[kept.split(/\n\s*\n/).length];
  // A plain paragraph only: never part of a list, a heading or a quote.
  if (!next || next.includes('\n') || /^(?:[-*+>#]|\d+\.)\s/.test(next)) {
    return kept;
  }
  const sentences = wholeSentences(next, DESCRIPTION_MAX - kept.length - 2);
  return sentences.length ? `${kept}\n\n${sentences.join(' ')}` : kept;
}

/**
 * Markdown shortened to `max` characters, rendered; a cut is marked once,
 * at the end of the last block.
 */
function clampedHtml(
  md: string,
  max: number,
  fill = false,
  untrusted = false,
): string {
  const clamped = clampMarkdown(md, max);
  let kept = clamped.text;
  // A first paragraph cut on a word ends on « … »: the mark replaces it.
  const onWord = kept.endsWith('…');
  if (onWord) kept = kept.slice(0, -1).trimEnd();
  if (clamped.truncated && fill && !onWord) kept = fillWithSentences(md, kept);
  const html = tightCode(
    curlyApostrophesHtml(markdownToHtml(kept, { untrusted })),
  );
  if (!clamped.truncated) return html;
  const mark = ` ${ELIDED}`;
  const closing = /(<\/li><\/[ou]l>|<\/p>|<\/h4>|<\/div>)$/;
  return closing.test(html)
    ? html.replace(closing, `${mark}$1`)
    : `${html}<p class="md-p">${ELIDED}</p>`;
}

/** A description, shortened to its first paragraphs; a cut is marked. */
const descriptionHtml = (md: string): string =>
  clampedHtml(normalizeDescription(md), DESCRIPTION_MAX, true);

/** Where each top-level block of rendered Markdown starts. */
const MD_BLOCK =
  /<(?:p class="md-p|[ou]l class="md-list|h4 class="md-h|div class="md-quote|pre class="code-block)/g;

/** Rendered Markdown split before its last top-level block. */
function splitLastBlock(html: string): { head: string; tail: string } {
  let last = -1;
  for (const m of html.matchAll(MD_BLOCK)) last = m.index;
  return last < 0
    ? { head: '', tail: html }
    : { head: html.slice(0, last), tail: html.slice(last) };
}

// ── AI analysis ─────────────────────────────────────────────────────────────
// Two forms only: a one-line note under a single occurrence (or an advisory),
// and, in a table of occurrences, an AI analysis column with each reasoning on
// a full-width line under its row (once under the table when all share it).

/** The assessment of an agent or a reviewer (a static heuristic is not shown). */
const analysisOf = (v: MappedVulnerability): OwaspExploitability | null =>
  v.exploitability && ANALYSED_BY.has(v.exploitability.source)
    ? v.exploitability
    : null;

const isExploitable = (v: MappedVulnerability): boolean =>
  EXPLOITABLE.has(analysisOf(v)?.verdict ?? '');

const verdictKey = (verdict: string): string =>
  String(verdict ?? '').toLowerCase();

/** The strongest assessment among occurrences, the most confident on a tie. */
const strongestAnalysis = (
  items: MappedVulnerability[],
): OwaspExploitability | null =>
  items
    .map(analysisOf)
    .filter(Boolean)
    .sort(
      (a, b) =>
        (VERDICT_RANK[verdictKey(a.verdict)] ?? 9) -
          (VERDICT_RANK[verdictKey(b.verdict)] ?? 9) ||
        (b.score ?? 0) - (a.score ?? 0),
    )[0] ?? null;

/** An occurrence the assessment speaks for: an analyst gave it that verdict. */
const carries = (v: MappedVulnerability, e: OwaspExploitability): boolean => {
  const own = analysisOf(v);
  return !!own && verdictKey(own.verdict) === verdictKey(e.verdict);
};

/**
 * The packages of an advisory its assessment speaks for, or none when it
 * speaks for all of them: a verdict on one installed version says nothing of
 * the others. A package is named as in the title, its version added only
 * when the advisory has several of it, its image when it spans several.
 */
function assessedPackages(
  items: MappedVulnerability[],
  e: OwaspExploitability,
): string[] {
  const images = new Set(items.map((v) => v.imageName).filter(Boolean));
  const versions = (name: string): number =>
    versionsOf(items.filter((v) => v.packageName === name)).length;
  const label = (v: MappedVulnerability): string => {
    const name = v.packageName || 'unknown package';
    const image =
      images.size > 1 && v.imageName ? ` ${inImage(v.imageName)}` : '';
    const ref =
      versions(v.packageName) > 1 ? packageOf(v) : packageRef(name, []);
    return `${ref}${image}`;
  };
  const named = new Set(
    items
      .filter((v) => carries(v, e))
      .sort((a, b) => packageLabel(a).localeCompare(packageLabel(b)))
      .map(label),
  );
  return named.size < new Set(items.map(label)).size ? Array.from(named) : [];
}

const analyst = (e: OwaspExploitability): string =>
  e.source === 'manual' ? 'Reviewer' : 'AI analysis';

/** A reasoning (the agent's, an LLM's, or a reviewer's): masked, no link. */
const reasonHtml = (reason: string): string =>
  clampedHtml(reason, REASON_MAX, false, true);

const confidenceOf = (e: OwaspExploitability): string =>
  typeof e.score === 'number'
    ? `<span class="ai-conf">${Math.round(e.score * 100)}% confidence</span>`
    : '';

/**
 * Who, the packages it covers when not all, verdict and confidence, then the
 * reasoning in a column of its own, so a wrapped line starts under the
 * reasoning, not under the head.
 */
function aiNote(
  e: OwaspExploitability,
  packages: string[] = [],
  className = '',
): string {
  const reason = e.reason
    ? `<div class="ai-reason">${reasonHtml(e.reason)}</div>`
    : '';
  const scope = packages.length
    ? `<span class="ai-sep">${MIDDOT}</span><span class="ai-scope">${listWords(packages)}</span>`
    : '';
  return `<div class="ai-note has-head${className ? ` ${className}` : ''}"><span class="ai-head"><span class="ai-who">${escapeHtml(analyst(e))}</span>${scope}${verdictPill(e.verdict)}${confidenceOf(e)}</span>${reason}</div>`;
}

/** A confidence as it is printed, so two scores that read the same compare equal. */
const shownScore = (e: OwaspExploitability): number | null =>
  typeof e.score === 'number' ? Math.round(e.score * 100) : null;

/**
 * An occurrence whose own assessment reads exactly as `e` once printed: same
 * analyst, verdict and confidence.
 */
const readsAs = (v: MappedVulnerability, e: OwaspExploitability): boolean => {
  const own = analysisOf(v);
  return (
    !!own &&
    own.source === e.source &&
    verdictKey(own.verdict) === verdictKey(e.verdict) &&
    shownScore(own) === shownScore(e)
  );
};

/** No occurrence under a Cybe Analysis brief. */
const NONE_COVERED: ReadonlySet<MappedVulnerability> = new Set();

/**
 * The reasoning an occurrence's own note gives: none under a Cybe Analysis
 * brief, which says it instead.
 */
const ownReason = (
  v: MappedVulnerability,
  covered: ReadonlySet<MappedVulnerability>,
): string => (covered.has(v) ? '' : (analysisOf(v)?.reason ?? ''));

/**
 * The assessment every occurrence shares (same analyst, verdict, confidence
 * and reasoning), which one note under the finding states for all of them:
 * null when none is analysed, undefined when they differ or only some are.
 * The reasoning of an occurrence a brief covers counts as none.
 */
function sharedAnalysis(
  rows: MappedVulnerability[],
  covered: ReadonlySet<MappedVulnerability> = NONE_COVERED,
): OwaspExploitability | null | undefined {
  const notes = rows.map(analysisOf);
  if (notes.every((e) => !e)) return null;
  const [first] = notes;
  const reason = ownReason(rows[0], covered);
  const same = (e: OwaspExploitability | null, i: number): boolean =>
    !!e &&
    !!first &&
    e.source === first.source &&
    verdictKey(e.verdict) === verdictKey(first.verdict) &&
    shownScore(e) === shownScore(first) &&
    ownReason(rows[i], covered) === reason;
  if (!notes.every(same)) return undefined;
  return reason === (first.reason ?? '')
    ? first
    : { ...first, reason: reason || null };
}

/** Verdict and confidence of one finding, for an AI verdict column. */
const verdictCell = (e: OwaspExploitability | null): string => {
  if (!e) return `<span class="zero">${DASH}</span>`;
  const reviewer =
    e.source === 'manual' ? '<span class="ai-conf">Reviewer</span>' : '';
  return `<span class="ai-cell">${verdictPill(e.verdict)}${confidenceOf(e)}${reviewer}</span>`;
};

/**
 * AI analysis of a table of occurrences: a verdict column when any is
 * analysed, each reasoning under its row (printed once), or once under the
 * table when every analysed occurrence gives the same one. The reasoning of
 * an occurrence a Cybe Analysis brief covers is the brief's: the verdict
 * column keeps its verdict, and a reasoning the others share is said for
 * them only.
 */
function occurrenceNotes(
  rows: MappedVulnerability[],
  covered: ReadonlySet<MappedVulnerability> = NONE_COVERED,
): {
  column: string[] | null;
  reasons: string[];
  after: string;
} {
  const notes = rows.map(analysisOf);
  if (!notes.some(Boolean)) {
    return { column: null, reasons: rows.map(() => ''), after: '' };
  }
  const column = notes.map(verdictCell);
  const own = rows.filter((v) => analysisOf(v) && !covered.has(v));
  const reason = own.length ? ownReason(own[0], covered) : '';
  if (
    own.length > 1 &&
    reason &&
    own.every((v) => ownReason(v, covered) === reason)
  ) {
    const who = covered.size
      ? 'Other analysed occurrences:'
      : 'All analysed occurrences:';
    return {
      column,
      reasons: rows.map(() => ''),
      after: `<div class="ai-note has-head ai-after"><span class="ai-head"><span class="ai-who">${who}</span></span><div class="ai-reason">${reasonHtml(reason)}</div></div>`,
    };
  }
  const seen = new Set<string>();
  return {
    column,
    after: '',
    reasons: rows.map((v) => {
      const text = ownReason(v, covered);
      if (!text || seen.has(text)) return '';
      seen.add(text);
      return `<div class="ai-note">${reasonHtml(text)}</div>`;
    }),
  };
}

// ── Cybe Analysis ───────────────────────────────────────────────────────────
// A finding the agent analysed in depth carries a brief (why it matters, how
// to fix) in place of its short AI note: one per rule or advisory, covering
// every analysed occurrence of it. Detailed report only.

/** What the briefs of a report printed, for About and the styles. */
interface CybeTally {
  /** Open detections a printed brief speaks for. */
  briefed: Set<string>;
  /** The briefs printed, for what About says they show. */
  briefs: ReportAnalysisBrief[];
  /** Occurrences whose short AI note a printed brief replaces. */
  covered: Set<MappedVulnerability>;
  /** A printed brief links to the full analysis in CybeDefend. */
  links: boolean;
  /** A triaged finding shows why its analysis dismissed it. */
  triage: boolean;
  /**
   * The head of a printed brief carries the verdict of its analysis: its
   * finding shows no AI verdict of the agent (a static one is not shown).
   */
  analysisVerdict: boolean;
  /**
   * The first finding of a category may break before the last block of its
   * description, the next page naming it as it names a brief: only once a
   * brief or a triage line is known to print, since their styles do it.
   */
  leadBreaks: boolean;
  /** Prints the analyses the findings carry (none without an extension). */
  analysis: ReportAnalysisRenderer;
}

const newTally = (
  analysis: ReportAnalysisRenderer,
  leadBreaks = false,
): CybeTally => ({
  briefed: new Set(),
  briefs: [],
  covered: new Set(),
  links: false,
  triage: false,
  analysisVerdict: false,
  leadBreaks,
  analysis,
});

/** A brief or a triage line was printed: the report carries their styles. */
const printsCybe = (tally: CybeTally | null): boolean =>
  !!tally && (tally.briefed.size > 0 || tally.triage);

/** The brief of a block of occurrences, and the notes it replaces. */
interface CybePlan {
  sources: ReportAnalysisSource[];
  /** Occurrences with a recognised analysis, in the order of the block. */
  analysed: MappedVulnerability[];
  /** Those whose short note the brief replaces: never a reviewer's. */
  covered: Set<MappedVulnerability>;
  opts: Omit<ReportAnalysisBriefOptions, 'withPill'>;
}

/** What the report already prints of a finding, so a brief does not repeat it. */
const knownText = (parts: unknown[]): string =>
  plainText(
    parts
      .filter(Boolean)
      .map((p) => plain(p))
      .join('\n'),
  );

/**
 * The brief of a block, or null when none of its occurrences has an analysis
 * with something to show: their short notes then stay as they are.
 */
function cybePlan(
  analysis: ReportAnalysisRenderer,
  items: MappedVulnerability[],
  where: (v: MappedVulnerability) => string,
  opts: Omit<ReportAnalysisBriefOptions, 'withPill'>,
): CybePlan | null {
  const pairs = items
    .map((v) => ({ v, source: analysis.briefSource(v, where(v)) }))
    .filter((p) => p.source);
  if (!pairs.length) return null;
  const sources = pairs.map((p) => p.source);
  if (!analysis.buildBrief(sources, { ...opts, withPill: false })) return null;
  return {
    sources,
    analysed: pairs.map((p) => p.v),
    covered: new Set(
      pairs
        .filter((p) => p.v.exploitability?.source !== 'manual')
        .map((p) => p.v),
    ),
    opts,
  };
}

/**
 * The brief, counted for About. `withPill`: its head carries the verdict,
 * which no note or column of the block shows any more.
 */
function printBrief(
  tally: CybeTally,
  plan: CybePlan,
  withPill: boolean,
): string {
  const brief = tally.analysis.buildBrief(plan.sources, {
    ...plan.opts,
    withPill,
  });
  tally.briefs.push(brief);
  for (const v of plan.analysed) tally.briefed.add(v.id);
  for (const v of plan.covered) tally.covered.add(v);
  tally.links = tally.links || !!brief.url;
  tally.analysisVerdict =
    tally.analysisVerdict ||
    (!!brief.pill && plan.sources.every((s) => !s.agentVerdict));
  return tally.analysis.card(brief, {
    compact: plan.opts.compact,
    confidenceWord: true,
  });
}

/** The file and line of a code finding, as a brief names a source. */
const shortPlace = (v: MappedVulnerability): string =>
  placeOf(v).split('/').pop() ?? '';

/**
 * Why a triaged code finding was dismissed, under its row: from its most
 * recent analysis, whose location is named when the row lists several.
 */
function triageNote(list: MappedVulnerability[], tally: CybeTally): string {
  const first = list[0];
  const sources = list
    .map((v) => tally.analysis.briefSource(v, placeOf(v)))
    .filter(Boolean);
  if (!sources.length) return '';
  const time = (s: ReportAnalysisSource) => Date.parse(s.pinned.date) || 0;
  const latest = sources.reduce((a, s) => (time(s) > time(a) ? s : a));
  const line = tally.analysis.buildTriageLine([latest], {
    scopeId: null,
    title: headingText(first.name),
    known: knownText([
      headingText(first.name),
      first.description,
      ...list.map(placeOf),
      ...(first.cwe ?? []).map(cweLabel),
    ]),
  });
  if (!line) return '';
  tally.triage = true;
  const at = list.find((v) => v.id === latest.id);
  return tally.analysis.triageLineHtml(
    line,
    list.length > 1 ? shortPlace(at) : null,
  );
}

/**
 * The « Cybe Analysis » entry of About, when a brief or a triage line is
 * printed: the text the three reports share.
 */
function cybeAbout(
  tally: CybeTally | null,
): { title: string; html: string } | null {
  if (!tally) return null;
  const html = tally.analysis.aboutParagraph({
    covered: tally.briefed.size,
    triage: tally.triage,
    links: tally.links,
    every: tally.analysis.briefParts(tally.briefs, 'every'),
    some: tally.analysis.briefParts(tally.briefs, 'some'),
    analysisVerdict: tally.analysisVerdict,
    // The triaged packages are listed without a line (see triageNote).
    triageCodeOnly: true,
  });
  return html ? { title: 'Cybe Analysis', html } : null;
}

// ── grouping and ordering ───────────────────────────────────────────────────

const worstSeverity = (items: MappedVulnerability[]): SeverityKey =>
  items
    .map((v) => severityKey(v.severity))
    .sort((a, b) => SEVERITY_RANK[a] - SEVERITY_RANK[b])[0] ?? 'unknown';

const bestState = (items: MappedVulnerability[]): number =>
  Math.min(...items.map((v) => stateRank(v.state)));

/**
 * Identical findings share one entry: same rule, description, severity and
 * scanner for code; same advisory (SCA) or CVE (container) for dependencies.
 */
const groupKey = (v: MappedVulnerability): string =>
  isDependency(v)
    ? `${v.type}\u0000${(v.type === 'sca' && v.advisoryId) || v.name}`
    : [
        v.type,
        severityKey(v.severity),
        String(v.name ?? '')
          .trim()
          .toLowerCase(),
        String(v.description ?? '').trim(),
      ].join('\u0000');

/** « Withdrawn Advisory: », « Duplicate Advisory: », « Withdrawn: ». */
const ADVISORY_FLAG = /^\s*(withdrawn|duplicate)(?:\s+advisory)?\s*:\s*/i;
/**
 * A description that opens on the withdrawal (« ## Withdrawn Advisory »,
 * « **Withdrawn** », « Withdrawn, accidental duplicate publish. »).
 */
const WITHDRAWN_TEXT =
  /^\s*(?:#{1,6}\s*|\*\*)?(?:withdrawn\b|duplicate advisory\b)|\bthis advisory has been withdrawn\b/im;

/**
 * An advisory its publisher withdrew: from the OSV record, else from its
 * title or text. Still counted, like on the dashboard.
 */
const isWithdrawn = (v: MappedVulnerability): boolean =>
  isDependency(v) &&
  (v.withdrawn === true ||
    ADVISORY_FLAG.test(v.name ?? '') ||
    WITHDRAWN_TEXT.test(v.description ?? ''));

/**
 * A withdrawal that says the advisory repeats another one (« Duplicate
 * Advisory: », « withdrawn because it is a duplicate of GHSA-… »,
 * « Withdrawn, accidental duplicate publish »).
 */
const DUPLICATE_TEXT =
  /^\s*(?:#{1,6}\s*)?duplicate advisory\b|\b(?:withdrawn|accidental)\b[^\n]*\bduplicate\b/im;
const DUPLICATE_OF =
  /\bduplicate of\s+((?:GHSA|CVE|PYSEC|GO|RUSTSEC|OSV)-[A-Za-z0-9-]+)/i;

const isDuplicate = (v: MappedVulnerability): boolean =>
  isWithdrawn(v) &&
  (/^\s*duplicate\b/i.test(v.name ?? '') ||
    DUPLICATE_TEXT.test(v.description ?? ''));

/**
 * « (2 as duplicates) », « as a duplicate » when every one is; the
 * parenthesis never parts at a line end.
 */
function duplicatesNote(withdrawn: number, duplicates: number): string {
  if (!duplicates) return '';
  const as = duplicates === 1 ? 'as a duplicate' : 'as duplicates';
  if (duplicates === withdrawn) return ` ${as}`;
  return ` (${[duplicates, ...as.split(' ')].join(NBSP)})`;
}

/**
 * « come from withdrawn advisories (2 as duplicates) », « comes from an
 * advisory withdrawn as a duplicate »: the words of the summary.
 */
function withdrawnFrom(withdrawn: number, duplicates: number): string {
  const one = withdrawn === 1;
  const verb = one ? 'comes from' : 'come from';
  if (duplicates && duplicates === withdrawn) {
    return `${verb} ${one ? 'an advisory' : 'advisories'} withdrawn${duplicatesNote(withdrawn, duplicates)}`;
  }
  return `${verb} ${one ? 'a withdrawn advisory' : 'withdrawn advisories'}${duplicatesNote(withdrawn, duplicates)}`;
}

/**
 * « 6 from withdrawn advisories, 2 of them duplicates, still counted »: the
 * same words inside a parenthesis, which holds no other one; a count never
 * ends a line.
 */
function withdrawnAside(withdrawn: number, duplicates: number): string {
  const one = withdrawn === 1;
  const from = `${withdrawn}${NBSP}from`;
  if (duplicates && duplicates === withdrawn) {
    return `${from} ${one ? 'an advisory' : 'advisories'} withdrawn ${one ? 'as a duplicate' : 'as duplicates'}, still counted`;
  }
  const also = duplicates
    ? `, ${duplicates}${NBSP}of them ${duplicates === 1 ? 'a duplicate' : 'duplicates'}`
    : '';
  return `${from} ${one ? 'a withdrawn advisory' : 'withdrawn advisories'}${also}, still counted`;
}

/**
 * Headline of a group of occurrences. An advisory keeps its title, without the
 * « Withdrawn Advisory: » prefix; a container CVE is titled by its id and
 * packages (counted when naming them all would cut the title), its summary
 * set apart. A withdrawn advisory, duplicates included, is flagged the same
 * way.
 */
function headline(items: MappedVulnerability[]): {
  title: string;
  summary: string;
  withdrawn: boolean;
} {
  const first = items[0];
  const withdrawn = items.some(isWithdrawn);
  if (first.type === 'container') {
    const names = Array.from(
      new Set(items.map((v) => v.packageName).filter(Boolean)),
    ).sort();
    const id = String(first.name ?? '').trim();
    const all = listWords(names);
    const packages =
      names.length > 2 && `${id} in ${all}`.length > TITLE_MAX
        ? `${names[0]} and ${names.length - 1} other packages`
        : all;
    const title =
      id && packages
        ? `${id} in ${packages}`
        : id || (packages ? `Vulnerability in ${packages}` : '');
    return { title, summary: String(first.description ?? ''), withdrawn };
  }
  const name = String(first.name ?? '');
  const prefix = isDependency(first) ? ADVISORY_FLAG.exec(name) : null;
  return {
    title: prefix ? name.slice(prefix[0].length) : name,
    summary: '',
    withdrawn: withdrawn || !!prefix,
  };
}

const groupTitle = (items: MappedVulnerability[]): string =>
  headline(items).title;

/**
 * Most severe first; at equal severity, a live advisory before a withdrawn
 * one (an original before the duplicate that repeats it), then what an
 * analyst proved exploitable, then what was confirmed, then the most frequent.
 */
const sortGroups = <T extends { items: MappedVulnerability[] }>(
  groups: T[],
): T[] =>
  [...groups].sort(
    (a, b) =>
      SEVERITY_RANK[worstSeverity(a.items)] -
        SEVERITY_RANK[worstSeverity(b.items)] ||
      Number(a.items.some(isWithdrawn)) - Number(b.items.some(isWithdrawn)) ||
      Number(b.items.some(isExploitable)) -
        Number(a.items.some(isExploitable)) ||
      bestState(a.items) - bestState(b.items) ||
      b.items.length - a.items.length ||
      groupTitle(a.items).localeCompare(groupTitle(b.items)),
  );

const byLocation = (a: MappedVulnerability, b: MappedVulnerability): number =>
  stateRank(a.state) - stateRank(b.state) ||
  String(a.path ?? a.packageName ?? '').localeCompare(
    String(b.path ?? b.packageName ?? ''),
  ) ||
  (parseInt(a.line ?? '', 10) || 0) - (parseInt(b.line ?? '', 10) || 0) ||
  compareVersions(
    String(a.packageVersion ?? ''),
    String(b.packageVersion ?? ''),
  );

// ── model ───────────────────────────────────────────────────────────────────

/**
 * A reasoning the agent gives word for word for several distinct findings:
 * reproduced as given under each of them, and said once, in the About section.
 * A reasoning a Cybe Analysis brief took over is not printed.
 */
function repeatsReasons(
  open: MappedVulnerability[],
  covered: ReadonlySet<MappedVulnerability> = NONE_COVERED,
): boolean {
  const findings = new Map<string, Set<string>>();
  for (const v of open) {
    const reason = ownReason(v, covered);
    if (!reason) continue;
    const keys = findings.get(reason) ?? new Set<string>();
    keys.add(groupKey(v));
    findings.set(reason, keys);
  }
  return Array.from(findings.values()).some((keys) => keys.size > 1);
}

function buildModel(data: OwaspReportData): ReportModel {
  const categoryOf = new Map<string, string>();
  for (const category of data.owaspCategories ?? []) {
    for (const v of category.vulnerabilities ?? []) {
      if (!categoryOf.has(v.id)) categoryOf.set(v.id, category.categoryData.id);
    }
  }
  const all = data.vulnerabilities ?? [];
  const open = all.filter((v) => isActiveState(v.state));
  return {
    open,
    triaged: all.filter((v) => !isActiveState(v.state)),
    categoryOf,
    categories: Object.values(OWASP_TOP_10_2021_DATA).map((c) => ({
      data: c,
      open: open.filter((v) => categoryOf.get(v.id) === c.id),
    })),
    unmapped: open.filter((v) => !categoryOf.has(v.id)),
  };
}

// ── document parts ──────────────────────────────────────────────────────────

export function owaspReportTitle(data: OwaspReportData): string {
  const name = data.scanMetadata?.projectName || data.projectId;
  return `${REPORT_TITLE} · ${name}`;
}

/** Families that reported findings (all four when none did). */
function scopeOf(data: OwaspReportData): string {
  const byType = data.summary?.byType;
  const reported = FAMILIES.filter(([key]) => (byType?.[key] ?? 0) > 0);
  return (reported.length ? reported : FAMILIES)
    .map(([, label]) => label)
    .join(', ');
}

function renderCoverBlock(data: OwaspReportData): string {
  const meta: Partial<ScanMetadata> = data.scanMetadata ?? {};
  const name = meta.projectName;
  return renderCover({
    eyebrow: 'OWASP Top 10 · 2021',
    title: REPORT_TITLE,
    subtitle:
      'Automated security findings mapped to the OWASP Top 10 2021 categories.',
    meta: [
      {
        label: 'Project',
        value: name || data.projectId,
        sub: name ? data.projectId : undefined,
      },
      { label: 'Branch', value: meta.branch || 'All branches' },
      { label: 'Generated', value: formatReportDate(data.generatedAt) },
      { label: 'Scope', value: scopeOf(data) },
    ],
  });
}

/**
 * What names a finding in a sentence, in one piece: its package and version
 * (a chip in running text would part from the punctuation after it), else
 * its location. A long reference names its package, then its version apart,
 * cut only between its parts (versionPieces), never in its revision. `after`:
 * the punctuation that follows it, never parted from it.
 */
function findingRef(v: MappedVulnerability, after = ''): string {
  if (!isDependency(v)) return pathText(placeOf(v), { keep: true, after });
  const name = plain(v.packageName || 'unknown package');
  const version = plain(v.packageVersion ?? '');
  const whole = [name, version].filter(Boolean).join(' ');
  if (!version || !isLongId(whole)) {
    return pathText(whole, { keep: true, after });
  }
  const shown = isLongId(version)
    ? idBox(
        `<span class="path keep is-long">${breakableVersion(version)}</span>`,
        { after },
      )
    : pathText(version, { keep: true, after });
  return `${pathText(name, { keep: true })} ${shown}`;
}

/** Packages a key fact names one by one; past that, it counts them. */
const NAMED_PACKAGES = 4;

/**
 * The upgrades that resolve the most severe open dependency findings
 * (critical, else high), named in the order of the upgrade plan: a finding
 * is resolved when its advisory is live and has a fixed version, which the
 * plan's target never falls below.
 */
function remediationFact(m: ReportModel): string {
  const deps = m.open.filter(isDependency);
  const level = (['critical', 'high'] as const).find((k) =>
    deps.some((v) => severityKey(v.severity) === k),
  );
  if (!level) return '';
  const resolved = deps.filter(
    (v) =>
      severityKey(v.severity) === level && !isWithdrawn(v) && !!v.fixedVersion,
  );
  if (!resolved.length) return '';
  const rows = upgradePlan(deps).filter((p) =>
    p.items.some((v) => resolved.includes(v)),
  );
  const names = Array.from(
    new Set(rows.map((p) => p.first.packageName || 'unknown package')),
  );
  const who =
    rows.length <= NAMED_PACKAGES
      ? listWords(names.map((n) => pathText(plain(n), { keep: true })))
      : `<strong>${rows.length}</strong> packages of the A06 upgrade plan`;
  const total = m.open.filter((v) => severityKey(v.severity) === level).length;
  const what =
    resolved.length < total
      ? `<strong>${resolved.length}</strong> of the <strong>${total}</strong> ${level} findings`
      : total === 1
        ? `the only ${level} finding`
        : total === 2
          ? `both ${level} findings`
          : `all <strong>${total}</strong> ${level} findings`;
  return `Upgrading ${who} would resolve ${what}.`;
}

/**
 * Two to four facts, in this order: where the findings are (with the
 * withdrawn advisories when they all sit there), how severe, how exploitable,
 * which upgrades resolve the worst; the withdrawn advisories last when
 * another category leads, and left to A06 when there is no room.
 */
function summaryFacts(m: ReportModel): string[] {
  const facts: string[] = [];
  const total = m.open.length;
  const withdrawn = m.open.filter(isWithdrawn).length;
  // The duplicates are among the withdrawn, said as in A06.
  const duplicates = m.open.filter(isDuplicate).length;
  let withdrawnSaid = !withdrawn;
  const ranked = m.categories
    .filter((c) => c.open.length)
    .sort((a, b) => b.open.length - a.open.length);
  if (ranked.length) {
    const top = ranked[0];
    const share = Math.round((top.open.length / total) * 100);
    const deps = top.open.filter((v) => v.type === 'sca');
    const images = top.open.filter((v) => v.type === 'container');
    const here =
      withdrawn > 0 && top.open.filter(isWithdrawn).length === withdrawn;
    withdrawnSaid = withdrawnSaid || here;
    // The withdrawn advisories are said beside the part they all belong to,
    // else after the whole.
    const aside = (part: MappedVulnerability[]): string =>
      here && part.filter(isWithdrawn).length === withdrawn
        ? ` (${withdrawnAside(withdrawn, duplicates)})`
        : '';
    const inPart = here && !!(aside(deps) || aside(images));
    const after =
      here && (!deps.length || !images.length || !inPart)
        ? `; ${withdrawn} of them ${withdrawnFrom(withdrawn, duplicates)}, still counted`
        : '';
    // The split between dependencies and images says more than the name of
    // the category, which the chart beside already gives.
    const where =
      deps.length && images.length
        ? `: ${deps.length} in dependencies${aside(deps)} and ${images.length} in container images${aside(images)}`
        : ` ${escapeHtml(top.data.title)}`;
    facts.push(
      `<strong>${top.open.length}</strong> of the <strong>${total}</strong> open findings (${share}%) fall under ${top.data.id}${where}${after}.`,
    );
  }

  const severity = countSeverities(m.open);
  const severe = severity.critical + severity.high;
  if (severe) {
    const confirmed = m.open.filter(
      (v) =>
        stateKey(v.state) === 'confirmed' &&
        SEVERITY_RANK[severityKey(v.severity)] <= SEVERITY_RANK.high,
    ).length;
    const status = confirmed
      ? `${confirmed} of them ${confirmed === 1 ? 'is' : 'are'} confirmed`
      : 'none of them is confirmed yet';
    facts.push(
      `<strong>${severe}</strong> critical or high ${severe === 1 ? 'finding is' : 'findings are'} open (${severity.critical}${NBSP}critical, ${severity.high}${NBSP}high); ${status}.`,
    );
  } else {
    facts.push('No critical or high-severity finding is open.');
  }

  const exploitable = m.open.filter(isExploitable);
  if (exploitable.length) {
    const byReviewer = exploitable.some(
      (v) => analysisOf(v)?.source === 'manual',
    );
    const active = exploitable.filter(
      (v) => verdictKey(analysisOf(v).verdict) === 'actively_exploited',
    );
    // The full stop closes the sentence, with the finding it names last.
    const activeText =
      active.length === 1
        ? `; <strong>1</strong> is actively exploited: ${findingRef(active[0], '.')}`
        : active.length
          ? `; <strong>${active.length}</strong> are actively exploited.`
          : '.';
    facts.push(
      `<strong>${exploitable.length}</strong> open ${exploitable.length === 1 ? 'finding was' : 'findings were'} rated proven or actively exploited by the AI analysis${byReviewer ? ' or a reviewer' : ''}${activeText}`,
    );
  }

  const remediation = remediationFact(m);
  if (remediation) facts.push(remediation);

  if (!withdrawnSaid) {
    facts.push(
      `<strong>${withdrawn}</strong> open ${withdrawn === 1 ? 'finding' : 'findings'} ${withdrawnFrom(withdrawn, duplicates)}, flagged in A06 and still counted.`,
    );
  }
  // Which categories have findings, and how many fall outside the Top 10, is
  // what the chart beside shows: no fact repeats it.
  return facts.slice(0, 4);
}

/** Open findings per category with findings, then those outside the Top 10. */
function categoryChart(m: ReportModel): string {
  const bars: ChartDatum[] = m.categories
    .filter((c) => c.open.length)
    .map((c) => ({
      id: c.data.id,
      label: SHORT_TITLES[c.data.id] ?? c.data.title,
      value: c.open.length,
      color: COLORS.accent,
    }));
  if (m.unmapped.length) {
    bars.push({
      label: 'Not mapped',
      value: m.unmapped.length,
      color: '#b8b2c2',
    });
  }
  return horizontalBars(bars, { labelWidth: '148px' });
}

function renderSummary(m: ReportModel, forPdf: boolean): string {
  const severity = countSeverities(m.open);
  const aside = `${plural(m.open.length, 'open finding')}${m.triaged.length ? ` · ${m.triaged.length} triaged, excluded` : ''}`;
  const keys = severityColumns(m.open);
  // The total tile is wider, so its label stays on one line.
  const kpis = kpiTiles(
    [
      { label: 'Open findings', value: m.open.length },
      ...keys.map((key) => ({
        label: severityName(key),
        value: severity[key],
        severity: key,
      })),
    ],
    { leadWidth: 1.6 },
  );
  if (!m.open.length) {
    return `<section class="section" id="owasp-summary">
${sectionHead({ eyebrow: 'Overview', title: 'Executive summary', aside })}
${kpis}
<div class="summary-empty">${emptyState('No open finding is mapped to the OWASP Top 10.')}</div>
</section>`;
  }

  return `<section class="section" id="owasp-summary">
${sectionHead({ eyebrow: 'Overview', title: 'Executive summary', aside })}
${kpis}
<div class="grid-2 summary-charts">
  <div class="panel"><div class="panel-title">Open findings by category</div>${categoryChart(m)}</div>
  ${keyFacts('Key facts', summaryFacts(m))}
</div>
${renderTopFindings(m, forPdf)}
</section>`;
}

/**
 * What the other occurrences of a group are, beside the one named: other
 * locations of a code finding (« +1 more »), other versions of the package
 * named (« +1 version », as in the triaged packages), or other packages of an
 * advisory.
 */
function moreLabel(
  first: MappedVulnerability,
  items: MappedVulnerability[],
): string {
  const others = items.filter((v) => v !== first);
  if (!others.length) return '';
  const count = (n: number, noun: string) =>
    `<span class="more">+${n} ${noun ? (n === 1 ? noun : `${noun}s`) : 'more'}</span>`;
  if (!isDependency(first)) return count(others.length, '');
  const same = others.filter((v) => v.packageName === first.packageName);
  const versions = new Set(
    same.map((v) => v.packageVersion).filter((x) => x !== first.packageVersion),
  );
  const packages = new Set(
    others.filter((v) => !same.includes(v)).map((v) => v.packageName),
  );
  if (!packages.size && versions.size === others.length) {
    return count(versions.size, 'version');
  }
  if (!same.length && packages.size === others.length) {
    return count(packages.size, 'package');
  }
  return count(others.length, 'occurrence');
}

/**
 * The five most severe open entries (a group counts once): title, then its
 * category and location; the state and the AI verdict in columns of their
 * own (the verdict only when one of them was analysed).
 */
function renderTopFindings(m: ReportModel, forPdf: boolean): string {
  const top = sortGroups(groupBy(m.open, groupKey)).slice(0, TOP_FINDINGS);
  const analysed = top.some(({ items }) => strongestAnalysis(items));
  const rows = top.map(({ items }) => {
    const analysis = strongestAnalysis(items);
    const sorted = [...items].sort(byLocation);
    // The location named beside a verdict is one it was given for, with the
    // confidence shown.
    const first =
      (analysis && sorted.find((v) => readsAs(v, analysis))) || sorted[0];
    const category = m.categoryOf.get(first.id);
    const more = moreLabel(first, items);
    const code = category
      ? `<a class="cat-code" href="#owasp-${category.toLowerCase()}">${category}</a>`
      : `<span class="cat-code zero">${DASH}</span>`;
    // A long package chip is a block of several lines: the code sits beside
    // its first.
    const longChip =
      isDependency(first) && isLongId(plain(first.packageName ?? ''));
    return [
      badge(worstSeverity(items)),
      `<div class="top-title">${titleText(groupTitle(items), TITLE_MAX)}</div><div class="top-sub${longChip ? ' is-long' : ''}">${code}<span class="top-where">${location(first)}${imageOf(first)}${more}</span></div>`,
      stateLabel(first.state),
      ...(analysed ? [verdictCell(analysis)] : []),
    ];
  });
  return `<div class="top-findings">
<h3>Most severe open findings</h3>
${dataTable({
  columns: [
    { label: 'Severity', width: SEVERITY_COL },
    { label: 'Finding' },
    { label: 'State', width: stateWidth('14%', forPdf) },
    ...(analysed ? [{ label: 'AI verdict', width: '22%' }] : []),
  ],
  rows,
  className: 'top-table',
})}
</div>`;
}

function renderCategoryTable(m: ReportModel): string {
  const keys = severityColumns(m.open);
  const row = (label: string, items: MappedVulnerability[]) => {
    const severity = countSeverities(items);
    return [
      label,
      ...keys.map((k) => countCell(severity[k])),
      countCell(items.length, true),
    ];
  };
  // Only a category with open findings has a section to link to.
  const rows = m.categories.map((c) =>
    row(
      c.open.length
        ? `<a class="cat-code" href="#owasp-${c.data.id.toLowerCase()}">${c.data.id}</a><span class="cat-name">${escapeHtml(c.data.title)}</span>`
        : `<span class="cat-code is-empty">${c.data.id}</span><span class="cat-name is-empty">${escapeHtml(c.data.title)}</span>`,
      c.open,
    ),
  );
  rows.push(
    row(
      `<span class="cat-code zero">${DASH}</span><span class="cat-name is-other">${m.unmapped.length ? '<a href="#owasp-unmapped">Not mapped to the OWASP Top 10</a>' : 'Not mapped to the OWASP Top 10'}</span>`,
      m.unmapped,
    ),
  );
  const totals = countSeverities(m.open);
  rows.push([
    '<strong>Total</strong>',
    ...keys.map((k) => countCell(totals[k], true)),
    `<strong>${m.open.length}</strong>`,
  ]);
  const table = dataTable({
    columns: [
      { label: 'Category' },
      ...keys.map((k) => ({
        label: severityName(k),
        width: '9.5%',
        align: 'right' as const,
      })),
      { label: 'Total', width: '9%', align: 'right' as const },
    ],
    rows,
    rowClasses: rows.map((_, i) => (i === rows.length - 1 ? 'total' : '')),
    className: 'cat-table',
  });
  return `<section class="section" id="owasp-categories">
${sectionHead({ eyebrow: 'OWASP Top 10 · 2021', title: 'Findings by category', aside: plural(m.open.length, 'open finding') })}
${table}
<p class="table-note">Open findings only. A category without findings means that no automated check reported one, not that the risk is absent.</p>
</section>`;
}

/** A finding title as plain text, for a continuation line. */
const plainTitle = (value: unknown): string => {
  const shown = clip(headingText(value).replace(/`/g, ''), 90);
  return shown.cut ? `${shown.text}…` : shown.text;
};

/** The 2021 category the detection rule sets, if any. */
const ruleCategory = (v: MappedVulnerability): string | null => {
  for (const ref of v.owaspTop10 ?? []) {
    const match = /^(A\d{2}):2021/.exec(String(ref).trim());
    if (match) return match[1];
  }
  return null;
};

/**
 * Code findings placed in a category by their rule's label while none of
 * their CWEs is on the category's official list: said once, in the head.
 */
function ruleNote(code: MappedVulnerability[], ref: OwaspCategoryData): string {
  const byRule = code.filter(
    (v) =>
      ruleCategory(v) === ref.id &&
      !(v.cwe ?? []).some((c) => ref.mappedCwes.includes(cweLabel(c))),
  ).length;
  if (!byRule) return '';
  const list = `the official ${ref.id} list.`;
  if (byRule === 1 && code.length === 1) {
    return `Its detection rule assigns this finding to ${ref.id}, although its CWE is not on ${list}`;
  }
  if (byRule === code.length) {
    return `Their detection rules assign these ${byRule} findings to ${ref.id}, although their CWEs are not on ${list}`;
  }
  return byRule === 1
    ? `The detection rule of 1 of these findings assigns it to ${ref.id}, although its CWE is not on ${list}`
    : `The detection rules of ${byRule} of these findings assign them to ${ref.id}, although their CWEs are not on ${list}`;
}

/** Code reported by several rules, so the counts are not read as distinct flaws. */
function overlapNote(code: MappedVulnerability[]): string {
  const groups = groupBy(code, groupKey);
  if (groups.length < 2) return '';
  const places = new Map<
    string,
    { path: string; line: string; rules: Set<number> }
  >();
  groups.forEach(({ items }, g) => {
    for (const v of items) {
      const path = plain(v.path || '');
      if (!path) continue;
      const line = lineLabel(v.line);
      const key = `${path}\u0000${line}`;
      const place = places.get(key) ?? { path, line, rules: new Set<number>() };
      place.rules.add(g);
      places.set(key, place);
    }
  });
  const shared = Array.from(places.values()).filter((p) => p.rules.size > 1);
  if (!shared.length) return '';
  // A path cited in a sentence stays in one piece.
  const at = (p: { path: string; line: string }) =>
    pathText(p.line ? `${p.path}:${p.line}` : p.path, { keep: true });
  if (places.size === 1) {
    return `All ${code.length} findings below point to the same code: ${at(shared[0])}.`;
  }
  // The lines of one file are named once, in order.
  const files = groupBy(shared, (p) => p.path).map(({ key, items }) => {
    const sorted = [...items].sort(
      (a, b) => (parseInt(a.line, 10) || 0) - (parseInt(b.line, 10) || 0),
    );
    const counts = new Set(sorted.map((p) => p.rules.size));
    if (sorted.length > 1 && counts.size === 1 && sorted.every((p) => p.line)) {
      return `${pathText(key, { keep: true })}, lines ${escapeHtml(listWords(sorted.map((p) => p.line)))} (${sorted[0].rules.size} rules each)`;
    }
    return sorted.map((p) => `${at(p)} (${p.rules.size} rules)`).join(', ');
  });
  const more = files.length > 3 ? ` and ${files.length - 3} more files` : '';
  return `Some locations are reported by more than one rule: ${files.slice(0, 3).join(', ')}${more}.`;
}

/** Files whose occurrences one line can still name. */
const INLINE_FILES = 2;

/** Characters of an HTML fragment as it reads, an entity counting as one. */
const visibleChars = (html: string): number =>
  html.replace(/<[^>]+>/g, '').replace(/&[^;]+;/g, '_').length;

/** Padding of a chip and the gap after it, px. */
const META_CHIP_PX = 18;
/** A « · » between two items and its margins, px. */
const META_SEP_PX = 17;
/** The dot of a state and its gap, px. */
const META_DOT_PX = 11;

/**
 * The scanner line holds its chips, the location and the state on one line
 * of the page: estimated at 6px a character (JetBrains Mono at 10px; Rubik
 * runs narrower), each chip padded.
 */
function fitsMetaLine(chips: string, where: string, state: string): boolean {
  const count = (chips.match(/<span class="chip/g) ?? []).length;
  const px =
    (visibleChars(chips) + visibleChars(where) + visibleChars(state)) *
      MONO_CHAR_PX +
    count * META_CHIP_PX +
    META_SEP_PX * (state ? 2 : 1) +
    (state ? META_DOT_PX : 0);
  return px <= PAGE_PX;
}

/**
 * The places of identical occurrences in one line, file by file, its lines
 * in order (`compose.yml, lines 4 and 13; server.js:78–102`); null when they
 * are too many for a line, or when two of them would read the same.
 */
function placesLine(rows: MappedVulnerability[]): string | null {
  if (rows.length > LOCATIONS_MAX) return null;
  if (new Set(rows.map(placeOf)).size < rows.length) return null;
  const files = groupBy(rows, (v) => plain(v.path || ''));
  if (files.length > INLINE_FILES) return null;
  const parts = files.map(({ key, items }) => {
    if (items.length === 1) return location(items[0]);
    const lines = items.map((v) => lineLabel(v.line));
    if (!lines.every(Boolean)) return null;
    return `${pathText(key)}, lines ${escapeHtml(listWords(lines))}`;
  });
  return parts.every(Boolean) ? parts.join('; ') : null;
}

/**
 * The first finding under its category head, when it may break: its parts
 * (the head of the finding, its last block, its brief) are the row groups of
 * a one-column table, each kept whole, whose header row names the finding at
 * the top of the next page. On the first page, the category head covers that
 * row with its bottom padding, never with a line of text. A table for the
 * layout only (role="presentation"): the tagged PDF and a screen reader see
 * the heading and paragraphs of a finding, not a table of two or three rows.
 */
function leadTable(label: string, parts: string[]): string {
  const rows = parts
    .filter(Boolean)
    .map((part) => `<tbody><tr><td>${part}</td></tr></tbody>`)
    .join('');
  return `<table class="lead-table has-cont fixed" role="presentation"><thead><tr class="cont-row" aria-hidden="true"><th>${escapeHtml(label)}</th></tr></thead>${rows}</table>`;
}

/**
 * One code finding: its title and scanner line, the description, then where
 * it occurs. Occurrences that differ in nothing but their place (one state,
 * one verdict or none) are named on the scanner line when they fit, like a
 * single one; otherwise they get a table that repeats the finding title when
 * it continues on the next page. `opensCategory`: the first finding under its
 * category head.
 */
function renderCodeFinding(
  occurrences: MappedVulnerability[],
  detailed: boolean,
  section: string,
  tally: CybeTally | null,
  forPdf: boolean,
  opensCategory = false,
): string {
  const first = occurrences[0];
  const rows = [...occurrences].sort(byLocation);
  const plan = tally
    ? cybePlan(tally.analysis, rows, placeOf, {
        title: headingText(first.name),
        known: knownText([
          headingText(first.name),
          first.description,
          ...rows.map(placeOf),
          ...(first.cwe ?? []).map(cweLabel),
        ]),
        occurrences: rows.length,
        unit: 'occurrence',
        compact: false,
      })
    : null;
  const covered = plan?.covered ?? NONE_COVERED;
  const states = statesOf(rows);
  const shared = sharedAnalysis(rows, covered);
  const inline =
    states.length === 1 && shared !== undefined ? placesLine(rows) : null;
  const cwes = (first.cwe ?? [])
    .slice(0, 2)
    .map((c) => `<span class="chip mono">${escapeHtml(cweLabel(c))}</span>`)
    .join('');
  const where =
    inline ??
    `<span class="finding-count">${plural(rows.length, 'occurrence')}</span>`;
  const chips = `${typeBadge(first.type)}${cwes}`;
  const state = states.length === 1 ? stateLabel(states[0]) : '';
  const stateItem = state ? `<span class="meta-item">${state}</span>` : '';
  // A location too long for the line opens a line of its own, after the
  // state: never a « · » at the start of a line, nor the state alone.
  const long = !fitsMetaLine(chips, where, state);
  const meta = (cover = false) =>
    `<div class="finding-meta${long ? ' is-long' : ''}${cover ? ' ca-cover' : ''}"><span class="meta-chips">${chips}</span>${
      long
        ? `${stateItem}<span class="meta-where">${where}</span>`
        : `<span class="meta-item">${where}</span>${stateItem}`
    }</div>`;
  const title = `<h3 class="finding-title">${badge(first.severity)}<span>${titleText(first.name)}</span></h3>`;
  const desc =
    detailed && first.description ? descriptionHtml(first.description) : '';

  if (inline) {
    const label = `${section} · ${plainTitle(first.name)} (continued)`;
    // A note the brief does not replace (a reviewer's) stays, and keeps the
    // verdict; otherwise the brief's head takes it over.
    const kept =
      !!plan && !!shared && rows.some((v) => analysisOf(v) && !covered.has(v));
    const card = plan ? printBrief(tally, plan, !kept) : '';
    // Under its category head, a finding may break before the last block of
    // its description, and before its brief: the next page names it.
    const { head: early, tail: last } =
      opensCategory && tally?.leadBreaks
        ? splitLastBlock(desc)
        : { head: '', tail: desc };
    if (early) {
      return `<div class="finding">
  ${leadTable(label, [
    `${title}${meta()}<div class="finding-desc">${early}</div>`,
    `<div class="finding-desc desc-tail">${last}</div>${shared && (!plan || kept) ? aiNote(shared) : ''}`,
    card,
  ])}
</div>`;
    }
    const lastBlock = (cover: boolean) =>
      last
        ? `<div class="finding-desc${cover ? ' ca-cover' : ''}">${last}</div>`
        : '';
    if (!plan) {
      return `<div class="finding">
  ${title}${meta()}${lastBlock(false)}${shared ? aiNote(shared) : ''}
</div>`;
    }
    // The last block above the brief covers its context line, which only
    // shows when the brief opens the next page.
    const head = kept
      ? `${lastBlock(false)}${aiNote(shared, [], 'ca-cover')}`
      : lastBlock(true);
    return `<div class="finding">
  ${title}${meta(!head)}${head}${tally.analysis.continuation(label)}${card}
</div>`;
  }

  // The last paragraph of the description covers the continuation row of the
  // table, which shows when the table opens a page; the paragraphs above
  // flow freely.
  const { head, tail } = splitLastBlock(desc);
  const lead = head ? `<div class="finding-desc">${head}</div>` : '';
  const cover = tail
    ? `<div class="finding-desc desc-tail cont-cover">${tail}</div>`
    : '<div class="cont-cover"></div>';

  const notes = occurrenceNotes(rows, covered);
  const withState = states.length > 1;
  // The brief rides in the group of rows of the last analysed occurrence,
  // after its note if a reviewer left one; its head carries the verdict when
  // an occurrence it covers has none in the column.
  const briefAt = plan
    ? Math.max(...plan.analysed.map((v) => rows.indexOf(v)))
    : -1;
  const card = plan
    ? printBrief(tally, plan, !Array.from(covered).every((v) => analysisOf(v)))
    : '';
  // A short table whose rows the brief all speaks for travels whole with it:
  // cut 1 + 1, the brief opened a page under one of the rows it covers.
  const whole =
    !!plan &&
    plan.analysed.length === rows.length &&
    rows.length <= JOINED_ROWS_MAX;
  const body: TableRow[] = [];
  const joined: boolean[] = [];
  rows.forEach((v, i) => {
    body.push([
      location(v),
      ...(notes.column ? [notes.column[i]] : []),
      ...(withState ? [stateLabel(v.state)] : []),
    ]);
    joined.push(whole && i > 0);
    if (notes.reasons[i]) {
      body.push({ full: notes.reasons[i], attach: true });
      joined.push(false);
    }
    if (i === briefAt) {
      body.push({ full: card, attach: true, className: 'ca-row' });
      joined.push(false);
    }
  });
  const table = dataTable({
    columns: [
      { label: 'Location' },
      ...(notes.column ? [{ label: 'AI verdict', width: '27%' }] : []),
      ...(withState
        ? [{ label: 'State', width: stateWidth('15%', forPdf) }]
        : []),
    ],
    rows: body,
    joinPrevious: joined,
    continuation: `${section} · ${plainTitle(first.name)} (continued)`,
    className: 'occ-table',
  });
  return `<div class="finding">
  ${title}${meta()}${lead}
  ${cover}${table}${notes.after}
</div>`;
}

/** Packages of a list of dependency findings (per image for containers). */
const byPackage = (items: MappedVulnerability[]) =>
  groupBy(items, (v) =>
    [v.type, v.imageName ?? '', v.packageName ?? ''].join('\u0000'),
  );

/** More findings of the worst severities first: critical, then high… */
const byCounts = (
  a: Record<SeverityKey, number>,
  b: Record<SeverityKey, number>,
): number =>
  [...SEVERITIES, 'unknown' as const].reduce(
    (order, key) => order || b[key] - a[key],
    0,
  );

interface PlanRow {
  first: MappedVulnerability;
  items: MappedVulnerability[];
  worst: SeverityKey;
  /** The verdict that moves the package up, shown on its row. */
  proof: OwaspExploitability | null;
  severity: Record<SeverityKey, number>;
  /** Highest fixed version among its live advisories. */
  target?: string;
  withdrawnOnly: boolean;
  withoutFix: number;
  versions: string[];
  /** Follows a package of the same image with the same advisories and fix. */
  twin: boolean;
}

/**
 * A container package that shares its image, installed versions, advisories
 * and fixed version with another one (libssl3 and libcrypto3, built from one
 * source): one rebuild fixes both.
 */
const twinKey = (p: PlanRow): string | null =>
  p.first.type === 'container'
    ? [
        p.first.imageName ?? '',
        p.versions.join(','),
        p.target ?? '',
        ...Array.from(new Set(p.items.map(groupKey))).sort(),
      ].join('\u0000')
    : null;

/**
 * Upgrade plan: one row per vulnerable package (per image for containers),
 * with the highest fixed version among its open advisories, in the order of
 * the risk: worst severity, a verdict that proves it exploitable, then the
 * number of critical, high, medium and low findings. A package of one image
 * that shares its advisories and fixed version with another follows it.
 */
function upgradePlan(items: MappedVulnerability[]): PlanRow[] {
  const packages = byPackage(items).map(({ items: list }): PlanRow => {
    // A withdrawn advisory never sets the target.
    const live = list.filter((v) => !isWithdrawn(v));
    const fixes = live
      .map((v) => v.fixedVersion)
      .filter(Boolean)
      .sort(compareVersions);
    return {
      first: list[0],
      items: list,
      worst: worstSeverity(list),
      proof: strongestAnalysis(list.filter(isExploitable)),
      severity: countSeverities(list),
      target: fixes[fixes.length - 1],
      withdrawnOnly: !live.length,
      withoutFix: groupBy(live, groupKey).filter(
        (a) => !a.items.some((v) => v.fixedVersion),
      ).length,
      versions: versionsOf(list),
      twin: false,
    };
  });
  const sorted = packages.sort(
    (a, b) =>
      SEVERITY_RANK[a.worst] - SEVERITY_RANK[b.worst] ||
      Number(!!b.proof) - Number(!!a.proof) ||
      byCounts(a.severity, b.severity) ||
      String(a.first.packageName).localeCompare(String(b.first.packageName)),
  );
  const placed = new Set<PlanRow>();
  const ordered: PlanRow[] = [];
  for (const p of sorted) {
    if (placed.has(p)) continue;
    const key = twinKey(p);
    const twins = key
      ? sorted.filter((q) => q !== p && !placed.has(q) && twinKey(q) === key)
      : [];
    [p, ...twins].forEach((q, i) => {
      placed.add(q);
      ordered.push({ ...q, twin: i > 0 });
    });
  }
  return ordered;
}

// A column of the upgrade plan widens to hold its identifiers, within bounds
// that leave « Open findings » its room. A short identifier never breaks, so
// the column holds it whole; a long one is held whole when it fits, else cut
// in two at a separator. A version is atomic: held whole up to
// VERSION_WHOLE_CHARS, else cut only between its parts (versionPieces). A
// hash wider than any column breaks anywhere, whatever the width: it widens
// nothing. The version to install is what the reader acts on, then the
// installed one it replaces: when the columns want more than the page has,
// the names of packages yield first, cut at their separators (a short one
// too). A name with no separator left to cut at is never cut before
// « Open findings » has given its room, down to its widest count (its
// verdict pill and its header then wrap between their words), a long name
// cut anywhere before a short one. Only then do the installed versions
// yield, then the image.

/** Padding of a cell, and a margin for the rounding of glyphs. */
const CELL_PX = 24;
/** Padding of a code chip. */
const CHIP_PX = 10;

/** A column that fits its identifiers: its share of the page (%), bounded. */
interface FittedColumn {
  min: number;
  max: number;
  /** Room around the text (a chip's padding), px. */
  pad: number;
}

/**
 * The upgrade plan: its widths while every identifier fits them, and the
 * most each column may take. Upgrade to may hold a Debian version with its
 * epoch (29 characters) on one line.
 */
const PLAN_COLUMNS: Record<'package' | 'installed' | 'target', FittedColumn> = {
  package: { min: 20, max: 26, pad: CHIP_PX },
  installed: { min: 27, max: 34, pad: 0 },
  target: { min: 17, max: 31, pad: CHIP_PX },
};

/**
 * What the three columns take in all, so that « Open findings » keeps a
 * verdict pill and a severity count on one line.
 */
const PLAN_SHARE = 81;

/**
 * « Open findings », measured in the PDF. A severity count (severityDots,
 * Rubik 10px): its square and their gap, a digit, a space, then its word.
 */
const COUNT_LEAD_PX = 12;
const COUNT_DIGIT_PX = 6.4;
const COUNT_SPACE_PX = 2.5;
const COUNT_WORD_PX: Record<SeverityKey, number> = {
  critical: 31.6,
  high: 20.6,
  medium: 37.8,
  low: 16.1,
  unknown: 36.8,
};
/** A verdict pill (verdictPill): on one line, and its longest word. */
const PILL_PX: Record<string, { line: number; word: number }> = {
  actively_exploited: { line: 95, word: 55.1 },
  malicious: { line: 55.2, word: 55.2 },
  proven: { line: 44.6, word: 44.6 },
};
/** The header « Open findings »: on one line, and its longer word. */
const OPEN_HEAD_PX = { line: 80.1, word: 49.4 };

/** What a row of the upgrade plan shows under « Open findings ». */
interface OpenCell {
  counts: Record<SeverityKey, number>;
  verdict?: string;
}

/**
 * The room « Open findings » needs, px, the padding of its cell included:
 * its header, its widest count and its verdict pills on one line (`line`);
 * at the least, its header and pills wrapping between their words
 * (`least`). A count never wraps.
 */
function openRoom(cells: OpenCell[]): { line: number; least: number } {
  const counts = cells.flatMap(({ counts: n }) =>
    (Object.keys(COUNT_WORD_PX) as SeverityKey[])
      .filter((k) => n[k])
      .map(
        (k) =>
          COUNT_LEAD_PX +
          String(n[k]).length * COUNT_DIGIT_PX +
          COUNT_SPACE_PX +
          COUNT_WORD_PX[k],
      ),
  );
  // Another verdict: as wide as the widest known.
  const pills = cells
    .filter((c) => c.verdict)
    .map((c) => PILL_PX[c.verdict] ?? PILL_PX.actively_exploited);
  const widest = Math.max(0, ...counts);
  return {
    line:
      Math.max(OPEN_HEAD_PX.line, widest, ...pills.map((p) => p.line)) +
      CELL_PX,
    least:
      Math.max(OPEN_HEAD_PX.word, widest, ...pills.map((p) => p.word)) +
      CELL_PX,
  };
}

/** A fix drawn after its arrow: the arrow and its margins, px. */
const ARROW_PX = 16;

/**
 * The package column of the advisories: 34% of the page, wider to hold a
 * version whole (up to VERSION_WHOLE_CHARS), the advisory keeping the rest.
 */
const ADVISORY_PACKAGES: FittedColumn = { min: 34, max: 40, pad: 0 };

/**
 * Monospace characters on one line of a column taking `share` % of a text
 * column `page` px wide (the PDF's by default).
 */
const charsIn = (share: number, pad: number, page = PAGE_PX): number =>
  ((share / 100) * page - CELL_PX - pad) / MONO_CHAR_PX;

/**
 * Share (%) of a text column `page` px wide that `px` takes, rounded up to a
 * whole percent (to a tenth first: float noise never adds a whole percent).
 */
const pageShare = (px: number, page: number): number =>
  Math.ceil(Math.round((px / page) * 1000) / 10);

/**
 * A column that holds versions, in a text column `page` px wide: in a
 * narrower one (the dashboard preview), it may take as many pixels as in the
 * PDF, so that a version the PDF holds whole stays whole there.
 */
const columnAt = (column: FittedColumn, page: number): FittedColumn => ({
  ...column,
  max: Math.max(column.max, Math.floor((column.max * PAGE_PX) / page)),
});

/**
 * Characters an identifier needs on one line of a column holding at most
 * `room`: all of them when it is short (it never breaks) or fits whole; else
 * the longer line of its best cut in two at a separator, else its longest
 * piece; 0 when even that does not fit.
 */
function idChars(id: string, room: number): number {
  if (!isLongId(id) || id.length <= room) return id.length;
  // The pieces the shared helper cuts it into.
  const pieces = idPieces(id).map((piece) => piece.length);
  const total = pieces.reduce((sum, n) => sum + n, 0);
  let before = 0;
  let halves = total;
  for (const n of pieces.slice(0, -1)) {
    before += n;
    halves = Math.min(halves, Math.max(before, total - before));
  }
  if (halves <= room) return halves;
  const longest = Math.max(...pieces);
  return longest <= room ? longest : 0;
}

/**
 * Characters a version needs on one line of a column holding at most
 * `room`: all of them while it is held whole (a short one never breaks),
 * else its longest part (versionPieces); 0 when even that does not fit.
 */
function versionChars(version: string, room: number): number {
  const whole = versionColumnChars([version]);
  if (!isLongId(version) || whole <= room) return whole;
  const longest = Math.max(
    ...versionPieces(version).map((piece) => piece.length),
  );
  return longest <= room ? longest : 0;
}

/**
 * Share (%) of a text column `page` px wide (the PDF's by default) that a
 * column holding its widest identifier takes, within its bounds, the
 * identifiers measured by `measure` (by default, a long one held whole or
 * cut in two).
 */
function fittedWidth(
  ids: string[],
  column: FittedColumn,
  measure: (id: string, room: number) => number = idChars,
  page = PAGE_PX,
): number {
  const room = charsIn(column.max, column.pad, page);
  const chars = Math.max(0, ...ids.map((id) => measure(id, room)));
  const whole = pageShare(chars * MONO_CHAR_PX + CELL_PX + column.pad, page);
  return Math.min(column.max, Math.max(column.min, whole));
}

/** A short npm scope (`@opentelemetry/`): its « / » closes it. */
const NPM_SCOPE_RE = new RegExp(`^@[^/]{1,${LONG_ID_CHARS - 1}}/`, 'u');

/**
 * The parts of a package chip, as packageChip cuts it: after each `/` of a
 * short name; before each `/` of a long one, but after that of a short npm
 * scope, which it closes.
 */
const chipParts = (name: string): string[] => {
  const shown = plain(name);
  if (!isLongId(shown)) return shown.split(/(?<=\/)/).filter(Boolean);
  const scope = NPM_SCOPE_RE.exec(shown)?.[0] ?? '';
  const rest = shown.slice(scope.length);
  return joinShortPieces([scope, ...(rest ? rest.split(/(?=\/)/) : [])]);
};

/** Before a run of these, a part of a name may be cut (Chicago). */
const NAME_CUT_RE = /(?<![-._+~])(?=[-._+~])/u;

/**
 * The pieces a part of a package name is cut into when its column cannot
 * hold it whole: a long one (> LONG_ID_CHARS) as breakableId cuts it, a
 * short one before its separators (`webpack` | `-dev` | `-middleware`).
 */
const namePieces = (part: string): string[] =>
  isLongId(part) ? idPieces(part) : joinShortPieces(part.split(NAME_CUT_RE));

/**
 * Characters a part of a package name needs at the least on one line of a
 * column holding at most `room`: its longest piece, never cut; 0 when even
 * that does not fit.
 */
function pieceChars(part: string, room: number): number {
  const longest = Math.max(...namePieces(part).map((piece) => piece.length));
  return longest <= room ? longest : 0;
}

/**
 * The chip of a package in the upgrade plan, its column holding `room`
 * characters: packageChip while the column holds each of its parts whole.
 * Else, drawn as packageChip draws it, a short part the column cannot hold
 * whole is cut before its separators into pieces that flow as the parts of
 * the chip (`@aws-sdk/client` / `-secrets-manager`), each never cut; a
 * piece wider than the column, in the last resort anywhere, rather than out
 * of its column.
 */
function planChip(name: string, room: number): string {
  const parts = chipParts(name);
  if (parts.every((part) => isLongId(part) || part.length <= room)) {
    return packageChip(name);
  }
  const segments = (part: string): string[] => {
    if (isLongId(part)) {
      return [`<span class="seg is-long">${breakableId(part)}</span>`];
    }
    const pieces = part.length <= room ? [part] : namePieces(part);
    return pieces.map(
      (piece) =>
        `<span class="seg${piece.length > room ? ' is-long' : ''}">${escapeHtml(piece)}</span>`,
    );
  };
  return `<span class="code-chip pkg">${parts.flatMap(segments).join('<wbr>')}</span>`;
}

/**
 * Twin packages whose shared installed versions, image or target hold a
 * long identifier: the image of four lines and the versions were repeated on
 * each of their rows.
 */
const sharesLongId = (p: PlanRow): boolean =>
  [...p.versions, p.first.imageName, p.target]
    .filter(Boolean)
    .some((id) => isLongId(plain(id)));

/**
 * Packages one row names in its cell; past them, the cell names the first
 * and counts the others, all listed on a full-width line under the row.
 */
const PACKAGES_IN_CELL = 3;

/** « +12 packages »: the other packages of a row, listed under it. */
const morePackages = (n: number): string =>
  `<span class="more">+${plural(n, 'package')}</span>`;

/** The packages of a row, their chips flowing on a full-width line. */
const packageList = (names: string[]): string =>
  `<div class="pkg-list"><span class="pkg-list-head">The ${plural(names.length, 'package')}:</span> ${names
    .map((name) => packageChip(name))
    .join(' ')}</div>`;

/** The packages of a line of the upgrade plan, in alphabetical order. */
const lineNames = (line: PlanRow[]): string[] =>
  line
    .map((q) => plain(q.first.packageName || 'unknown package'))
    .sort((a, b) => a.localeCompare(b));

/** The names a line of the upgrade plan shows in its package cell. */
const namesInCell = (line: PlanRow[]): string[] => {
  const names = lineNames(line);
  return names.length > PACKAGES_IN_CELL ? names.slice(0, 1) : names;
};

/**
 * The rows of the upgrade plan: a package, or a package and its twins when
 * they share a long identifier, which one row then names once.
 */
function planLines(plan: PlanRow[]): PlanRow[][] {
  const groups: PlanRow[][] = [];
  for (const p of plan) {
    if (p.twin && groups.length) groups[groups.length - 1].push(p);
    else groups.push([p]);
  }
  return groups.flatMap((group) =>
    group.length > 1 && sharesLongId(group[0])
      ? [group]
      : group.map((p) => [p]),
  );
}

/** Widths of the columns of the upgrade plan, % of a text column. */
interface PlanWidths {
  pkg: number;
  installed: number;
  target: number;
}

/**
 * The widths of the upgrade plan in a text column `page` px wide: the
 * version to install whole, then the installed versions whole; the package
 * column holds the longest piece of its names (at least its share), then a
 * long name cut anywhere, its short ones keeping their pieces. It takes that
 * room from « Open findings » (`open`, its room in px) while its verdict
 * pills stay on one line, then down to its widest count. A name is cut
 * anywhere only when even that leaves no room; the installed versions then
 * yield to the pieces of the names. The names then take what is left, cut
 * at their separators when they need more, and the image what they leave.
 */
function planWidths(
  plan: PlanRow[],
  parts: string[],
  page: number,
  open: { line: number; least: number },
): PlanWidths {
  const installedColumn = columnAt(PLAN_COLUMNS.installed, page);
  const packageColumn = columnAt(PLAN_COLUMNS.package, page);
  const target = fittedWidth(
    plan.filter((p) => p.target).map((p) => plain(p.target)),
    columnAt(PLAN_COLUMNS.target, page),
    versionChars,
    page,
  );
  const versions = fittedWidth(
    plan.flatMap((p) => p.versions.map(plain)),
    installedColumn,
    versionChars,
    page,
  );
  const images = fittedWidth(
    plan
      .map((p) => p.first.imageName)
      .filter(Boolean)
      .map(plain),
    installedColumn,
    idChars,
    page,
  );
  const least = fittedWidth(parts, packageColumn, pieceChars, page);
  // A long name cut anywhere: the pieces of the short ones only.
  const short = parts.filter((part) => !isLongId(part));
  const leastShort = short.length
    ? pageShare(
        Math.max(...short.map((part) => pieceChars(part, Infinity))) *
          MONO_CHAR_PX +
          CELL_PX +
          CHIP_PX,
        page,
      )
    : 0;
  // What the three columns may take: PLAN_SHARE, « Open findings » keeping
  // its pills on one line; then its whole room but that; then down to its
  // widest count.
  const lined = 100 - pageShare(open.line, page);
  const share = Math.min(PLAN_SHARE, lined);
  const wrapped = 100 - pageShare(open.least, page);
  const fits = (
    [
      [least, share],
      [least, lined],
      [leastShort, share],
      [leastShort, lined],
      [least, wrapped],
      [leastShort, wrapped],
    ] as const
  ).find(([names, most]) => target + versions + names <= most);
  const whole = fittedWidth(parts, packageColumn, idChars, page);
  if (fits) {
    const [names] = fits;
    // Only the room its names need, never more for an image.
    const room = Math.max(share, target + versions + names);
    const pkg = Math.min(whole, room - target - versions);
    const installed = Math.min(Math.max(versions, images), room - pkg - target);
    return { pkg, installed, target };
  }
  const held = Math.min(versions, share - target - least);
  const pkg = Math.min(whole, share - target - held);
  const installed = Math.min(Math.max(versions, images), share - pkg - target);
  return { pkg, installed, target };
}

/** A table of the A06 block, and what its block carries for the preview. */
interface DepsTable {
  html: string;
  /**
   * The widths its columns take in a narrower preview, as custom properties
   * of the block (`--narrow-…: n%`, see OWASP_PREVIEW_CSS).
   */
  narrow: string[];
}

/**
 * The width of a column of an A06 table (`wide` % of the PDF's text
 * column). In the preview, when the narrower text column (PREVIEW_PAGE_PX)
 * wants another share, the column reads it below 950px from the custom
 * property `--<name>` of its block, whose declaration joins `narrow`.
 */
function columnWidth(
  name: string,
  wide: number,
  preview: number | null,
  narrow: string[],
): string {
  if (preview === null || preview === wide) return `${wide}%`;
  narrow.push(`--narrow-${name}: ${preview}%`);
  return `var(--${name}, ${wide}%)`;
}

/**
 * The upgrade plan table. Counts are findings, so the rows add up to the
 * section figures. `forPdf` false: the dashboard preview, its columns also
 * sized for a narrower text column.
 */
function renderUpgradePlan(
  items: MappedVulnerability[],
  section: string,
  forPdf: boolean,
): DepsTable {
  const plan = upgradePlan(items);
  const lines = planLines(plan);
  const parts = lines.flatMap(namesInCell).flatMap(chipParts);
  // Twins share their image, versions, advisories and target: a row of
  // several counts the findings of all of them, and the strongest verdict.
  const cells = lines.map((line) => {
    const [p] = line;
    const found = line.flatMap((q) => q.items);
    return {
      counts: line.length > 1 ? countSeverities(found) : p.severity,
      proof:
        line.length > 1
          ? strongestAnalysis(found.filter(isExploitable))
          : p.proof,
    };
  });
  const open = openRoom(
    cells.map(({ counts, proof }) => ({ counts, verdict: proof?.verdict })),
  );
  const fit = planWidths(plan, parts, PAGE_PX, open);
  const preview = forPdf
    ? null
    : planWidths(plan, parts, PREVIEW_PAGE_PX, open);
  // A name is cut where the column of the PDF cannot hold it whole. In a
  // narrower preview, the plan lays out on its content (OWASP_PREVIEW_CSS):
  // its package column widens for a piece of a name, which never breaks.
  const room = charsIn(fit.pkg, CHIP_PX);
  const narrow: string[] = [];
  const widths = [
    columnWidth('plan-package', fit.pkg, preview?.pkg ?? null, narrow),
    columnWidth(
      'plan-installed',
      fit.installed,
      preview?.installed ?? null,
      narrow,
    ),
    columnWidth('plan-target', fit.target, preview?.target ?? null, narrow),
  ];
  const rows: TableRow[] = [];
  const joined: boolean[] = [];
  const classes: string[] = [];
  // A twin after the package it follows, each in its row.
  const twinAt = (i: number): boolean =>
    lines[i]?.length === 1 && lines[i][0].twin;
  lines.forEach((line, i) => {
    const [p] = line;
    const note = p.withoutFix
      ? `<div class="plan-note">${p.withoutFix === 1 ? '1 advisory has' : `${p.withoutFix} advisories have`} no fix</div>`
      : '';
    const fix = p.target
      ? `${versionChip(plain(p.target))}${note}`
      : `<span class="no-fix">${p.withdrawnOnly ? 'Withdrawn only' : 'No fix'}</span>`;
    const { counts, proof } = cells[i];
    const names = lineNames(line);
    const listed = names.length > PACKAGES_IN_CELL;
    rows.push([
      listed
        ? `${planChip(names[0], room)}${morePackages(names.length - 1)}`
        : names.map((name) => planChip(name, room)).join(' '),
      `<span class="versions">${versionsHtml(p.versions)}</span>${p.first.imageName ? `<span class="plan-image"> ${inImage(p.first.imageName)}</span>` : ''}`,
      fix,
      `<div class="sev-counts">${severityDots(counts)}${proof ? `<span class="plan-verdict">${verdictPill(proof.verdict)}</span>` : ''}</div>`,
    ]);
    // A twin and the package it follows: one group of rows, the rule
    // between them dropped.
    joined.push(twinAt(i));
    classes.push(
      [twinAt(i + 1) ? 'has-twin' : '', twinAt(i) ? 'twin' : '']
        .filter(Boolean)
        .join(' '),
    );
    if (listed) {
      rows.push({
        full: packageList(names),
        attach: true,
        className: 'pkg-list-row',
      });
      joined.push(false);
      classes.push('');
    }
  });
  const withdrawn = items.some(isWithdrawn)
    ? ' Withdrawn advisories never set the target.'
    : '';
  // The order is said, with the verdict that moves a package up when a row
  // shows one, and the twins that stay together when there are some.
  const proven = plan.some((p) => p.proof)
    ? ', then a finding rated proven or actively exploited (its verdict shown)'
    : '';
  const merged = lines.some((line) => line.length > 1)
    ? `, in one row counting the findings of all of them when their version or image name is long${lines.some((line) => line.length > PACKAGES_IN_CELL) ? ', their names listed under the row when they are more than three' : ''}`
    : '';
  const twins = plan.some((p) => p.twin)
    ? `; packages of one image that share their advisories and fixed version stay together${merged}`
    : '';
  const html = `<div class="table-head cont-cover">
  <h3>Upgrade plan</h3>
  <p class="table-intro">One row per vulnerable package, with the highest fixed version among its open advisories. Rows run by worst severity${proven}, then the number of findings at each severity, from critical down${twins}. Counts are open findings, one per advisory and installed version.${withdrawn}</p>
</div>
${dataTable({
  columns: [
    { label: 'Package', width: widths[0] },
    { label: 'Installed', width: widths[1] },
    { label: 'Upgrade to', width: widths[2] },
    { label: 'Open findings' },
  ],
  rows,
  joinPrevious: joined,
  rowClasses: classes,
  continuation: `${section} · Upgrade plan (continued)`,
  className: 'plan-table',
})}`;
  return { html, narrow };
}

/** Vulnerable dependencies, one row per advisory with its packages and fixes. */
function renderDependencyFindings(
  items: MappedVulnerability[],
  section: string,
  tally: CybeTally | null,
  forPdf: boolean,
): DepsTable {
  const groups = sortGroups(groupBy(items, groupKey));
  const states = statesOf(items);
  const withState = states.length > 1;
  const body: TableRow[] = [];
  for (const { items: occurrences } of groups) {
    const first = occurrences[0];
    const { title, summary, withdrawn } = headline(occurrences);
    const ids = [
      first.type === 'sca' ? (first.advisoryId ?? '') : '',
      first.cve && first.cve !== first.name ? first.cve : '',
    ].filter(Boolean);
    const images = Array.from(
      new Set(occurrences.map((v) => v.imageName).filter(Boolean)),
    );
    const cvss = Math.max(0, ...occurrences.map((v) => v.cvssScore ?? 0));
    const duplicate = occurrences.find(isDuplicate);
    const original = duplicate
      ? DUPLICATE_OF.exec(duplicate.description ?? '')?.[1]
      : undefined;
    const idLine = [
      typeBadge(first.type),
      withdrawn ? '<span class="chip flag">Withdrawn</span>' : '',
      ...ids.map(advisoryIdHtml),
      ...images.map(imageRef),
      cvss > 0 ? `<span class="cvss">CVSS ${cvss.toFixed(1)}</span>` : '',
    ].join('');
    // What a duplicate repeats has a line of its own, under the ids.
    const dupLine = duplicate
      ? `<div class="adv-dup">Duplicate of ${original ? `<span class="mono">${text(original)}</span>` : 'another advisory'}</div>`
      : '';
    const analysis = strongestAnalysis(occurrences);
    // The installed versions that one fixed version cures share a line.
    const sorted = [...occurrences].sort(
      (a, b) =>
        String(a.packageName ?? '').localeCompare(
          String(b.packageName ?? ''),
        ) ||
        compareVersions(
          String(a.packageVersion ?? ''),
          String(b.packageVersion ?? ''),
        ),
    );
    const entries = groupBy(sorted, (v) =>
      [v.packageName ?? '', v.fixedVersion ?? ''].join('\u0000'),
    ).map(({ items: list }) => ({
      name: list[0].packageName || 'unknown package',
      versions: versionsOf(list),
      fixed: list[0].fixedVersion,
    }));
    // Packages that share a long pair (an epoch, a prerelease with a hash)
    // share its line too: their names, then the pair, named once.
    const pair = (e: (typeof entries)[number]): string =>
      [...e.versions, e.fixed].some((v) => v && isLongId(plain(v)))
        ? [e.versions.join(','), e.fixed ?? ''].join('\u0000')
        : ['\u0001', e.name, e.fixed ?? ''].join('\u0000');
    // More than three packages that share a pair: the first named in the
    // cell, all of them listed under the row, from the advisory column on.
    const lists: string[] = [];
    const packages = groupBy(entries, pair)
      .map(({ items: set }) => {
        const [e] = set;
        const fix = e.fixed
          ? `<span class="fix">${arrowIcon()}${versionChip(plain(e.fixed))}</span>`
          : '<span class="no-fix">No fix</span>';
        if (set.length === 1) {
          return `<div class="pkg">${packageRef(e.name, e.versions)}${fix}</div>`;
        }
        const shown = set.map((x) => plain(x.name));
        const listed = shown.length > PACKAGES_IN_CELL;
        if (listed) lists.push(packageList(shown));
        const names = listed
          ? `${packageChip(shown[0])}${morePackages(shown.length - 1)}`
          : shown.map((name) => packageChip(name)).join(' ');
        const versions = e.versions.length
          ? `<span class="versions">${versionsHtml(e.versions)}</span>`
          : '';
        return `<div class="pkg pkg-set"><div class="pkg-names">${names}</div>${versions}${fix}</div>`;
      })
      .join('');
    const plan = tally
      ? cybePlan(tally.analysis, occurrences, (v) => plain(packageLabel(v)), {
          title: headingText(title),
          known: knownText([
            headingText(title),
            first.description,
            ...occurrences.map(packageLabel),
            ...ids,
            ...(first.cwe ?? []).map(cweLabel),
          ]),
          occurrences: occurrences.length,
          unit: 'package',
          compact: true,
        })
      : null;
    // A brief takes over the note when the verdict the note shows is one of
    // an installed version it covers.
    const briefed =
      !!plan &&
      occurrences.some(
        (v) => plan.covered.has(v) && analysisOf(v) === analysis,
      );
    // The note closes the advisory cell, right under the ids, whatever the
    // height of the package cell beside it.
    const note =
      analysis && !briefed
        ? aiNote(analysis, assessedPackages(occurrences, analysis), 'adv-note')
        : '';
    body.push([
      badge(worstSeverity(occurrences)),
      `<div class="adv-title">${titleText(title, TITLE_MAX)}</div><div class="adv-ids">${idLine}</div>${dupLine}${summary ? `<div class="adv-summary">${summaryHtml(summary)}</div>` : ''}${note}`,
      packages,
      ...(withState
        ? [
            statesOf(occurrences)
              .map((state) => `<div>${stateLabel(state)}</div>`)
              .join(''),
          ]
        : []),
    ]);
    for (const list of lists) {
      body.push({ full: list, attach: true, className: 'pkg-list-row' });
    }
    // The compact brief takes the full width under the advisory row.
    if (plan) {
      body.push({
        full: printBrief(tally, plan, true),
        attach: true,
        className: 'adv-note ca-row',
      });
    }
  }
  // The order of sortGroups, in words, naming only the criteria that apply.
  const order = [
    'Rows run by severity',
    items.some(isExploitable)
      ? ', then an advisory rated proven or actively exploited'
      : '',
    withState ? ', then a confirmed one' : '',
    ', then the number of findings',
    items.some(isWithdrawn)
      ? '; withdrawn advisories close their severity'
      : '',
  ].join('');
  const intro = `One row per advisory, with each affected package and its fixed version: ${plural(groups.length, 'advisory', 'advisories')} behind the ${plural(items.length, 'open finding')}${withState ? '' : `, all ${escapeHtml(humanState(states[0]))}`}. ${order}.`;
  // The column holds a version whole, installed or fixed (a chip after its
  // arrow), as long as the advisory keeps its room, in the PDF and in a
  // narrower preview.
  const installed = items
    .map((v) => plain(v.packageVersion ?? ''))
    .filter(Boolean);
  const fixes = items.map((v) => plain(v.fixedVersion ?? '')).filter(Boolean);
  const packageWidth = (page: number): number =>
    Math.max(
      fittedWidth(
        installed,
        columnAt(ADVISORY_PACKAGES, page),
        versionChars,
        page,
      ),
      fittedWidth(
        fixes,
        columnAt({ ...ADVISORY_PACKAGES, pad: CHIP_PX + ARROW_PX }, page),
        versionChars,
        page,
      ),
    );
  const narrow: string[] = [];
  const width = columnWidth(
    'advisory-packages',
    packageWidth(PAGE_PX),
    forPdf ? null : packageWidth(PREVIEW_PAGE_PX),
    narrow,
  );
  const html = `<div class="table-head cont-cover">
  <h3>Advisories</h3>
  <p class="table-intro">${intro}</p>
</div>
${dataTable({
  columns: [
    { label: 'Severity', width: SEVERITY_COL },
    { label: 'Advisory' },
    { label: 'Package and fixed version', width },
    ...(withState
      ? [{ label: 'State', width: stateWidth(STATE_COL, forPdf) }]
      : []),
  ],
  rows: body,
  continuation: `${section} · Advisories (continued)`,
  className: 'dep-table',
})}`;
  return { html, narrow };
}

function renderFindings(
  items: MappedVulnerability[],
  detailed: boolean,
  section: string,
  tally: CybeTally | null,
  forPdf: boolean,
): string {
  const code = items.filter((v) => !isDependency(v));
  const deps = items.filter(isDependency);
  const parts: string[] = sortGroups(groupBy(code, groupKey)).map(
    ({ items: occurrences }, i) =>
      renderCodeFinding(occurrences, detailed, section, tally, forPdf, i === 0),
  );
  if (deps.length) {
    const plan = renderUpgradePlan(deps, section, forPdf);
    const advisories = renderDependencyFindings(deps, section, tally, forPdf);
    // The widths of its tables in a narrower preview, when they differ.
    const narrow = [...plan.narrow, ...advisories.narrow];
    const style = narrow.length ? ` style="${narrow.join('; ')}"` : '';
    parts.push(
      `<div class="deps"${style}>${plan.html}${advisories.html}</div>`,
    );
  }
  return parts.join('\n');
}

/** How findings, advisories and packages relate, and the withdrawn ones. */
function dependencyNote(items: MappedVulnerability[]): string {
  const deps = items.filter(isDependency);
  if (!deps.length) return '';
  const advisories = groupBy(deps, groupKey).length;
  const packages = byPackage(deps).length;
  const lead =
    deps.length === items.length
      ? plural(deps.length, 'open finding')
      : `${deps.length} of them`;
  return `${lead} from ${plural(advisories, 'advisory', 'advisories')} in ${plural(packages, 'package')}.${withdrawnNote(deps)}`;
}

/** « 2 of them come from advisories their publisher later withdrew… ». */
function withdrawnNote(deps: MappedVulnerability[]): string {
  const withdrawn = deps.filter(isWithdrawn).length;
  if (!withdrawn) return '';
  const duplicates = duplicatesNote(withdrawn, deps.filter(isDuplicate).length);
  const all = withdrawn === deps.length;
  const one = withdrawn === 1;
  const who = all
    ? one
      ? 'It'
      : withdrawn === 2
        ? 'Both'
        : `All ${withdrawn}`
    : `${withdrawn} of them`;
  return one
    ? ` ${who} comes from an advisory its publisher later withdrew${duplicates}; it is flagged below and still counted.`
    : ` ${who} come from advisories their publisher later withdrew${duplicates}; they are flagged below and still counted.`;
}

function categoryHead(
  head: string,
  brief: string,
  items: MappedVulnerability[],
  notes: string[],
): string {
  const note = notes.filter(Boolean).join(' ');
  return `<div class="cat-head">
${head}
${brief}<div class="sev-line">${severityDots(countSeverities(items))}</div>${note ? `<p class="cat-note">${note}</p>` : ''}
</div>`;
}

function renderCategorySection(
  c: CategoryModel,
  detailed: boolean,
  tally: CybeTally | null,
  forPdf: boolean,
): string {
  const ref = c.data;
  const code = c.open.filter((v) => !isDependency(v));
  const brief = detailed
    ? `<p class="cat-brief">${escapeHtml(ref.brief)}</p>`
    : '';
  const prevention = detailed
    ? `<div class="prevent">
  <div class="panel-title">How to prevent ${MIDDOT} ${ref.id} ${escapeHtml(ref.title)}</div>
  <ul>${ref.keyPrevention.map((p) => `<li>${escapeHtml(p)}</li>`).join('')}</ul>
  <div class="prevent-ref">OWASP reference: <a href="${escapeHtml(ref.url)}">${escapeHtml(ref.url.replace(/^https:\/\//, ''))}</a></div>
</div>`
    : '';
  return `<section class="section owasp-cat" id="owasp-${ref.id.toLowerCase()}">
${categoryHead(
  sectionHead({
    eyebrow: ref.code,
    title: ref.title,
    aside: plural(c.open.length, 'open finding'),
  }),
  brief,
  c.open,
  [dependencyNote(c.open), ruleNote(code, ref), overlapNote(code)],
)}
${renderFindings(c.open, detailed, ref.id, tally, forPdf)}
${prevention}
</section>`;
}

function renderUnmapped(
  items: MappedVulnerability[],
  detailed: boolean,
  tally: CybeTally | null,
  forPdf: boolean,
): string {
  const code = items.filter((v) => !isDependency(v));
  return `<section class="section owasp-cat" id="owasp-unmapped">
${categoryHead(
  sectionHead({
    eyebrow: 'Outside the Top 10',
    title: 'Not mapped to the OWASP Top 10',
    aside: plural(items.length, 'open finding'),
  }),
  '<p class="cat-brief">Open findings whose detection rule and CWE match no 2021 category.</p>',
  items,
  [overlapNote(code)],
)}
${renderFindings(items, detailed, 'Not mapped', tally, forPdf)}
</section>`;
}

/** Locations of a triaged row, the first few only. */
const places = (items: string[]): string => {
  const more =
    items.length > LOCATIONS_MAX
      ? `<span class="more">+${items.length - LOCATIONS_MAX} more</span>`
      : '';
  return `<div class="places">${items.slice(0, LOCATIONS_MAX).join('')}${more}</div>`;
};

/**
 * Triaged code findings: one row per rule and state, with their locations,
 * and under it why its Cybe Analysis dismissed it.
 */
function triagedCodeTable(
  items: MappedVulnerability[],
  withState: boolean,
  tally: CybeTally | null,
  forPdf: boolean,
): string {
  const groups = groupBy(items, (v) =>
    [
      v.type,
      severityKey(v.severity),
      String(v.name ?? '')
        .trim()
        .toLowerCase(),
      stateKey(v.state),
    ].join('\u0000'),
  ).sort(
    (a, b) =>
      SEVERITY_RANK[worstSeverity(a.items)] -
        SEVERITY_RANK[worstSeverity(b.items)] ||
      b.items.length - a.items.length ||
      String(a.items[0].name).localeCompare(String(b.items[0].name)),
  );
  const rows: TableRow[] = [];
  for (const { items: list } of groups) {
    const first = list[0];
    const sorted = [...list].sort(byLocation);
    rows.push([
      badge(first.severity),
      `<span class="tri-title">${titleText(first.name, TITLE_MAX)}</span>`,
      places(sorted.map(location)),
      ...(withState ? [stateLabel(first.state)] : []),
    ]);
    const why = tally ? triageNote(sorted, tally) : '';
    if (why) rows.push({ full: why, attach: true, className: 'ca-tri-row' });
  }
  return dataTable({
    columns: [
      { label: 'Severity', width: SEVERITY_COL },
      { label: 'Finding' },
      { label: 'Location', width: withState ? '32%' : '38%' },
      ...(withState
        ? [{ label: 'State', width: stateWidth(STATE_COL, forPdf) }]
        : []),
    ],
    rows,
    continuation: 'Triaged findings · Code (continued)',
    className: 'triaged-table',
  });
}

/**
 * Triaged dependencies, one row per package (a package is usually ignored as
 * a whole) with its critical and high findings. The list reads top to bottom,
 * then on in the next column: in the PDF, one table runs down two columns,
 * its header repeated at the top of each and named on a next page; the
 * dashboard preview has no page to fill, so each column is a table of its
 * own, with its header.
 */
function triagedPackageTable(
  items: MappedVulnerability[],
  withState: boolean,
  forPdf: boolean,
): { count: number; html: string } {
  const rows = groupBy(items, (v) =>
    [
      v.type,
      v.imageName ?? '',
      v.packageName ?? '',
      withState ? stateKey(v.state) : '',
    ].join('\u0000'),
  )
    .map(({ items: list }) => {
      const first = list[0];
      const counts = countSeverities(list);
      const image = first.imageName
        ? `<span class="plan-image"> ${inImage(first.imageName)}</span>`
        : '';
      return {
        name: String(first.packageName ?? ''),
        counts,
        cells: [
          `${packageRef(first.packageName || 'unknown package', versionsOf(list), true)}${image}`,
          `<div class="sev-counts">${severityDots(counts)}</div>${withState ? `<div class="tri-state">${stateLabel(first.state)}</div>` : ''}`,
        ],
      };
    })
    .sort(
      (a, b) =>
        b.counts.critical - a.counts.critical ||
        b.counts.high - a.counts.high ||
        a.name.localeCompare(b.name),
    );
  const table = (list: typeof rows, continuation?: string) =>
    dataTable({
      columns: [{ label: 'Package', width: '60%' }, { label: 'Findings' }],
      rows: list.map((r) => r.cells),
      continuation,
      className: 'tri-packages',
    });
  const half = Math.ceil(rows.length / 2);
  return {
    count: rows.length,
    html: forPdf
      ? `<div class="tri-cols">${table(rows, 'Triaged findings · Dependencies (continued)')}</div>`
      : `<div class="tri-split">${[rows.slice(0, half), rows.slice(half)]
          .filter((list) => list.length)
          .map((list) => table(list))
          .join('')}</div>`,
  };
}

/** Order of the triage states in the counts table. */
const TRIAGE_ORDER = ['ignored', 'not_exploitable', 'resolved'];

/** Triaged findings per state and severity; a total row when states differ. */
function triagedCounts(items: MappedVulnerability[]): string {
  const keys = severityColumns(items);
  const states = groupBy(items, (v) => stateKey(v.state)).sort(
    (a, b) =>
      (TRIAGE_ORDER.indexOf(a.key) + 1 || TRIAGE_ORDER.length + 1) -
        (TRIAGE_ORDER.indexOf(b.key) + 1 || TRIAGE_ORDER.length + 1) ||
      a.key.localeCompare(b.key),
  );
  const row = (label: string, list: MappedVulnerability[], strong = false) => {
    const severity = countSeverities(list);
    return [
      label,
      ...keys.map((k) => countCell(severity[k], strong)),
      countCell(list.length, true),
    ];
  };
  // One state: its row already is the total.
  const withTotal = states.length > 1;
  return dataTable({
    columns: [
      { label: 'State' },
      ...keys.map((k) => ({
        label: severityName(k),
        width: '11%',
        align: 'right' as const,
      })),
      { label: 'Total', width: '11%', align: 'right' as const },
    ],
    rows: [
      ...states.map(({ key, items: list }) => row(stateLabel(key), list)),
      ...(withTotal ? [row('<strong>Total</strong>', items, true)] : []),
    ],
    rowClasses: withTotal
      ? [...states.map(() => ''), 'total']
      : states.map(() => ''),
    className: 'triaged-counts',
  });
}

/**
 * Triaged findings, outside the figures and kept short: the counts, then every
 * critical and high one without its description, under one heading: code
 * findings by rule, then dependencies by package.
 */
function renderTriaged(
  items: MappedVulnerability[],
  forPdf: boolean,
  tally: CybeTally | null,
): string {
  const severe = items.filter(
    (v) => SEVERITY_RANK[severityKey(v.severity)] <= SEVERITY_RANK.high,
  );
  const lower = items.length - severe.length;
  const code = severe.filter((v) => !isDependency(v));
  const deps = severe.filter(isDependency);
  const listed = statesOf(severe);
  // A state shared by every listed finding is named once, in the heading.
  const oneState = listed.length === 1;
  const heading = severe.length
    ? `<h3 class="triaged-title">Critical and high triaged findings${oneState ? `, all ${escapeHtml(humanState(listed[0]))}` : ''}</h3>`
    : '';
  // Both lists have a head of the same rank, which says what it holds.
  const listHead = (title: string, count: string, cover: boolean) =>
    `<div class="list-head${cover ? ' cont-cover' : ''}"><h4>${title}</h4><span class="list-count">${count}</span></div>`;
  const codeList = code.length
    ? `${listHead('Code', plural(code.length, 'finding'), true)}
${triagedCodeTable(code, !oneState, tally, forPdf)}`
    : '';
  const packages = deps.length
    ? triagedPackageTable(deps, !oneState, forPdf)
    : null;
  // In the PDF, the head covers the continuation row of both columns.
  const packageList = packages
    ? `${listHead('Dependencies', `${plural(packages.count, 'package')}, ${plural(deps.length, 'finding')}`, forPdf)}
${packages.html}`
    : '';
  const note = lower
    ? `<p class="table-note">${lower === 1 ? '1 lower-severity triaged finding is' : `${lower} lower-severity triaged findings are`} not listed.</p>`
    : '';
  return `<section class="section" id="owasp-triaged">
<div class="triaged-head">
${sectionHead({ eyebrow: 'Excluded from the figures', title: 'Triaged findings', aside: plural(items.length, 'finding') })}
<p class="section-intro">Findings reviewed as ignored, resolved or not exploitable. They are excluded from every figure in this report.</p>
${triagedCounts(items)}
</div>
${heading}${codeList}${packageList}
${note}
</section>`;
}

/**
 * What the « Reading this report » paragraph has to say about the verdicts
 * shown: a reviewer's, the static ones left out, a reasoning repeated.
 */
interface AboutFlags {
  detailed: boolean;
  reviewer: boolean;
  staticVerdicts: boolean;
  repeatedReasons: boolean;
  /** What the Cybe Analysis briefs printed; null in the summary variant. */
  cybe: CybeTally | null;
}

/** Read once every section is rendered: the briefs are counted as printed. */
function aboutFlags(
  m: ReportModel,
  detailed: boolean,
  cybe: CybeTally | null,
): AboutFlags {
  return {
    detailed,
    reviewer: m.open.some((v) => analysisOf(v)?.source === 'manual'),
    staticVerdicts: m.open.some((v) => v.exploitability?.source === 'static'),
    repeatedReasons: repeatsReasons(m.open, cybe?.covered),
    cybe,
  };
}

/** Licence notice of the OWASP text the category sections reproduce. */
const OWASP_TEXT_NOTICE =
  'Text from the OWASP Top 10:2021 (https://owasp.org/Top10/), © OWASP Foundation, licensed under CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/); adapted.';

function renderAbout(flags: AboutFlags): string {
  const { detailed } = flags;
  const grouping = detailed
    ? `Identical findings are grouped: their description is shown once, followed by their locations. A long text is shortened, the cut marked ${ELISION}.`
    : `Identical findings are grouped and listed with their locations. A long text is shortened, the cut marked ${ELISION}.`;
  const reference = detailed
    ? '; category descriptions and prevention measures are condensed from it'
    : '';
  const reading = [
    'The state is the triage status set by your team: To verify (not reviewed yet) or Confirmed (reviewed as a real issue).',
    `The AI verdict is the exploitability verdict of the CybeDefend agent (Theoretical, Proven or Actively exploited) with its confidence in that verdict${flags.reviewer ? '; a verdict marked Reviewer was set by hand' : ''}.`,
    'The two are independent: a confirmed finding can carry a theoretical verdict, and a finding still to verify can already be proven.',
    flags.staticVerdicts
      ? 'Verdicts set by static analysis alone, marked Static on the CybeDefend dashboard, are not shown.'
      : '',
    'An advisory shows the strongest verdict among its packages; when that verdict covers only some of them, its note names them.',
    flags.repeatedReasons
      ? 'The agent sometimes gives the same reasoning word for word for several findings; it is reproduced as given.'
      : '',
    'The severity of a container finding is the rating of the image distribution, which can differ from the CVSS base score shown next to it.',
  ].filter(Boolean);
  return aboutSection([
    {
      title: 'Methodology',
      html: `<p>Findings come from CybeDefend&#8217;s automated analysis of the source code (SAST), infrastructure as code (IaC), open-source dependencies (SCA) and container images. Each finding is placed in exactly one OWASP Top 10 2021 category: the category set by its detection rule, otherwise the category whose official CWE list contains its CWE. Vulnerable dependencies and container packages belong to A06 by definition. Findings that match neither rule are reported as not mapped.</p>`,
    },
    {
      title: 'What the figures count',
      html: `<p>Figures count open findings only (to verify or confirmed), one per advisory and installed package version for dependencies. Findings triaged as ignored, resolved or not exploitable are excluded from every figure; the end of the report counts them and lists the critical and high ones. Advisories their publisher withdrew, duplicates included, are flagged and still counted, as on the CybeDefend dashboard, but never set an upgrade target. ${grouping}</p>`,
    },
    {
      title: 'Reading this report',
      html: `<p>${reading.join(' ')}</p>`,
    },
    ...[cybeAbout(flags.cybe)].filter(Boolean),
    {
      title: 'The OWASP Top 10',
      html: `<p>The OWASP Top 10 is an awareness document on the most critical security risks to web applications, not a compliance standard. This report follows its 2021 edition (<a href="https://owasp.org/Top10/">owasp.org/Top10</a>)${reference}.</p><p class="small">${OWASP_TEXT_NOTICE}</p>`,
    },
    {
      title: 'Limitations',
      html: `<p>Automated detections may include false positives and should be verified before remediation. A category without findings means that no automated check reported one, not that the risk is absent: logging and monitoring failures (A09), for instance, are hard to detect by static analysis. This report is provided for information and remediation purposes and does not guarantee that the application is free of other vulnerabilities.</p>`,
    },
  ]);
}

// ── styles ──────────────────────────────────────────────────────────────────

const C = COLORS;

export const OWASP_REPORT_CSS = `
  .cat-code { display: inline-block; min-width: 30px; font-family: ${MONO_STACK}; font-size: 10px; color: ${C.accent}; }
  .more { margin-left: 6px; font-size: 10px; color: ${C.textMuted}; white-space: nowrap; }
  .nobr { white-space: nowrap; }
  /* Inline code sits tight against the punctuation mark that follows it. */
  .code-inline.is-tight { margin-right: -2px; }
  .elided { color: ${C.textMuted}; white-space: nowrap; }
  /* A finding title heading a table row: one weight, whatever the table. */
  .top-title, .dep-table .adv-title, .tri-title { color: ${C.dark}; font-weight: 500; }
  /* A state in a table cell wraps between its words (« Proposed not
     exploitable »), never inside one: its column holds the widest word of a
     state (STATE_COL_PX in the preview). Its dot stays on its first line,
     centred on it as on a state of one line, which keeps its place. */
  td .state { align-items: flex-start; white-space: normal; overflow-wrap: normal; }
  td .state .state-dot { margin-top: calc((1lh - 6px) / 2); }

  /* Executive summary */
  .summary-charts { margin-top: 12px; }
  .summary-empty { margin-top: 12px; }
  .top-findings { break-inside: avoid; }
  .top-findings h3 { margin-top: 20px; }
  .top-sub { display: flex; align-items: baseline; gap: 8px; margin-top: 2px; font-size: 10px; color: ${C.textMuted}; }
  /* The category code keeps its width beside a long location, which wraps. */
  .top-sub .cat-code { min-width: 0; flex: none; }
  /* Beside a long package chip, a block of several lines, the code sits on
     the line of its first: the top of the chip, on a line as tall. */
  .top-sub.is-long { align-items: flex-start; }
  .top-sub.is-long .cat-code { line-height: 1.7; }
  .top-table td { vertical-align: top; }
  /* The confidence always sits under the verdict, whatever its width. */
  .top-table .ai-cell { flex-direction: column; align-items: flex-start; }

  /* Findings by category */
  .cat-table { break-inside: avoid; }
  .cat-table th.right, .cat-table td.right, .triaged-counts th.right, .triaged-counts td.right { padding-left: 4px; }
  .cat-table td, .triaged-counts td { vertical-align: middle; }
  .cat-table .cat-name { margin-left: 6px; color: ${C.dark}; }
  .cat-table .cat-name.is-empty { color: ${C.textMuted}; }
  /* A category without open findings has no section: its code is no link. */
  .cat-code.is-empty { color: ${C.textMuted}; }
  .cat-table .cat-name.is-other { color: ${C.textSecondary}; font-style: italic; }
  .cat-table .cat-name a { color: inherit; }
  tr.total td { border-top: 1px solid ${C.border}; background: ${C.subtleBg}; }
  .zero { color: #c3bdcc; }
  .table-note { font-size: 10px; color: ${C.textMuted}; margin-top: 6px; }

  /* Category sections: the heading block stays whole and never ends a page;
     its first finding keeps its title and the start of its text with it. */
  .cat-head { break-inside: avoid; break-after: avoid; }
  .cat-brief { color: ${C.textSecondary}; margin-bottom: 6px; }
  .sev-line { font-size: 10px; color: ${C.textSecondary}; }
  .sev-line .sev-count + .sev-count { margin-left: 14px; }
  .cat-note { font-size: 10px; color: ${C.textMuted}; margin: 4px 0 0; }
  .sev-count { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
  .sev-dot { width: 7px; height: 7px; border-radius: 2px; flex: none; }

  /* A finding: its title and scanner line stay with the start of the text.
     The last paragraph (.desc-tail) covers the continuation row of the
     occurrence table; it may end a page, the table then opening the next one
     on that row, which names the finding. */
  .finding { margin-top: 20px; }
  /* Occurrences named on the scanner line, no table to name the finding again
     on the next page: the finding is one block. */
  .finding:not(:has(table)) { break-inside: avoid; }
  .cat-head + .finding, .cat-head + .deps { margin-top: 14px; }
  .finding-title { display: flex; align-items: center; gap: 8px; margin: 0; }
  .finding-meta { display: flex; flex-wrap: wrap; align-items: center; row-gap: 3px; margin-top: 5px; font-size: 10px; color: ${C.textMuted}; break-inside: avoid; break-after: avoid; }
  .meta-chips { display: inline-flex; gap: 6px; }
  .meta-item::before { content: '\\00b7'; margin: 0 7px; color: ${C.textMuted}; }
  /* A location too long for the line: a line of its own under the chips and
     the state, without a separator; its wrapped lines hang under its
     first. */
  .finding-meta .meta-where { flex-basis: 100%; min-width: 0; padding-left: 12px; text-indent: -12px; }
  .finding-meta .state { font-size: 10px; }
  .finding-desc { margin-top: 6px; color: ${C.textSecondary}; }
  .finding-desc.desc-tail { break-after: auto; }
  .finding-desc .md-p, .finding-desc li { orphans: 2; widows: 2; }
  .finding-desc .code-block { margin: 4px 0; }

  /* AI analysis: the head (who, verdict, confidence) in a column of its own,
     so a wrapped reasoning starts under its first line. The head takes what
     it needs, at most 60%: one naming several packages wraps between them
     rather than squeeze the reasoning. */
  .ai-note { margin-top: 4px; font-size: 10px; line-height: 1.5; color: ${C.textSecondary}; }
  .ai-note.has-head { display: grid; grid-template-columns: fit-content(60%) minmax(0, 1fr); column-gap: 8px; align-items: baseline; }
  /* As wide as « AI analysis Theoretical 100% confidence »: note after note,
     the reasoning starts at one abscissa, whatever the verdict. A label
     under a table (« All analysed occurrences: ») keeps its own width. */
  .ai-note.has-head:not(.ai-after) > .ai-head { min-width: 210px; }
  .ai-head { display: inline-flex; align-items: baseline; gap: 6px; white-space: nowrap; }
  .ai-who { font-weight: 500; }
  .ai-scope { white-space: normal; }
  .ai-conf { color: ${C.textMuted}; }
  .ai-reason .md-p { margin: 0; }
  .finding > .ai-note, .ai-after { margin-top: 6px; break-before: avoid; }
  .ai-cell { display: inline-flex; flex-wrap: wrap; align-items: baseline; gap: 2px 6px; font-size: 10px; }
  tr.note-row .ai-note { margin-top: 0; }
  /* Row after row, heads of different widths would start each reasoning at
     its own abscissa: in the advisories table, the reasoning takes the line
     under its head, in the advisory cell. */
  .dep-table .ai-note.has-head { display: block; margin-top: 4px; }
  .dep-table .ai-reason { margin-top: 1px; }

  /* A06: upgrade plan, then advisories. */
  .deps { margin-top: 20px; }
  .table-head h3 { margin: 18px 0 2px; }
  .deps > .table-head:first-child h3 { margin-top: 0; }
  .table-intro { font-size: 10px; color: ${C.textMuted}; margin: 0; }
  .plan-table td { vertical-align: middle; }
  /* Twin packages read as one entry: no rule between them. */
  .plan-table tr.has-twin td { border-bottom: none; padding-bottom: 3px; }
  .plan-table tr.twin td { padding-top: 3px; }
  .versions { font-family: ${MONO_STACK}; font-size: 10px; color: ${C.textSecondary}; }
  .plan-image { font-family: ${MONO_STACK}; font-size: 10px; color: ${C.textMuted}; }
  .plan-note { font-size: 10px; color: ${C.textMuted}; margin-top: 1px; }
  .sev-counts { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 12px; font-size: 10px; color: ${C.textSecondary}; }
  .no-fix { font-size: 10px; color: ${C.textMuted}; white-space: nowrap; }
  /* The verdict that moves a package up, at the right end of its cell, so
     the verdicts of the column line up. Where Open findings gives its room
     to a name or a version (planWidths), the pill and the header of the
     column wrap between their words. */
  .plan-verdict { margin-left: auto; }
  .plan-verdict .verdict { white-space: normal; }
  .plan-table tr:not(.cont-row) > th:last-child { white-space: normal; }

  /* Title, then ids, as for any advisory; a container CVE's summary under
     them. */
  .dep-table .adv-summary { margin-top: 3px; font-size: 10px; color: ${C.textSecondary}; }
  .dep-table .adv-ids { display: flex; flex-wrap: wrap; align-items: center; gap: 3px 8px; margin-top: 3px; font-size: 10px; color: ${C.textMuted}; }
  .dep-table .adv-ids .mono { font-size: 10px; }
  /* A withdrawn advisory: an open chip with a dashed outline, apart from the
     filled scanner chip beside it, without a severity colour. The outline
     takes no room, so both chips keep one height. */
  .chip.flag { background: #fff; color: ${C.textSecondary}; outline: 1px dashed #98a2b3; outline-offset: -1px; }
  .dep-table .adv-dup { margin-top: 2px; font-size: 10px; color: ${C.textMuted}; }
  .dep-table .adv-dup .mono { font-size: 10px; }
  /* Package, versions, then the fix: a long list of versions wraps like
     text, the arrow never apart from the fixed version. */
  .dep-table .pkg + .pkg { margin-top: 4px; }
  .dep-table .pkg .versions { margin-right: 3px; }
  .dep-table .fix { display: inline-flex; align-items: center; white-space: nowrap; }
  /* Beside a fixed version of several lines, the arrow keeps its width. */
  .dep-table .fix > .arrow { flex: none; }
  /* Packages that share a long pair: their names, then the pair once. */
  .dep-table .pkg-names { margin-bottom: 2px; }
  /* More than three packages on one row: the first in its cell, all of them
     on a full-width line under it, their chips flowing (under an advisory,
     from its column on). */
  .pkg-list { display: flex; flex-wrap: wrap; align-items: baseline; gap: 3px 6px; font-size: 10px; color: ${C.textMuted}; }
  .dep-table tr.pkg-list-row td { padding-left: calc(${SEVERITY_COL} + 10px); }
  .dep-table .no-fix { margin-left: 6px; }

  /* About may cross a page: it breaks between its paragraphs, never inside
     one (a four-line one was cut three to one). */
  .about p { break-inside: avoid; }

  .prevent { margin-top: 16px; padding: 10px 14px; background: ${C.subtleBg}; border: 1px solid ${C.border}; border-radius: 8px; break-inside: avoid; }
  .prevent .panel-title { margin-bottom: 5px; }
  .prevent ul { margin: 0 0 0 16px; }
  .prevent li { margin: 2px 0; color: ${C.text}; }
  .prevent-ref { margin-top: 6px; font-size: 10px; color: ${C.textMuted}; }

  /* Triaged findings: the heading, its intro and the counts stay together;
     one heading over two lists of the same rank. */
  .triaged-head { break-inside: avoid; }
  h3.triaged-title { margin: 20px 0 4px; }
  /* As tall as a continuation cover, so the row it hides sits under its
     bottom padding, never under its text. */
  .list-head { display: flex; align-items: baseline; gap: 8px; margin-top: 14px; padding-bottom: 16px; line-height: 1.25; break-after: avoid; }
  .list-head h4 { font-size: 11px; font-weight: 600; color: ${C.dark}; }
  .list-count { font-size: 10px; color: ${C.textMuted}; }
  /* A list head sits closer to its own table than to what is above it. */
  .triaged-table + .list-head { margin-top: 26px; }
  .places { display: flex; flex-wrap: wrap; gap: 2px 10px; }
  /* The package list runs down one column, then the next. Its header
     repeats at the top of each column, continuation row included: the
     columns rise under the list head, which hides that row in both columns
     of the first page. */
  .tri-cols { columns: 2; column-gap: 24px; margin-top: -16px; }
  .tri-cols table.has-cont { margin-top: 0; }
  /* Dashboard preview: one table per column, each with its header. */
  .tri-split { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 24px; align-items: start; }
  .tri-split table { margin-top: 0; }
  .tri-packages td { vertical-align: middle; padding-top: 5px; padding-bottom: 5px; }
  .tri-state { margin-top: 2px; font-size: 10px; }
`;

/** Cybe Analysis in this report, added with the shared styles of the brief. */
export const OWASP_CYBE_CSS = `
  /* A finding with its brief below may break before the brief only: its
     head (title, scanner line, description) stays whole, and the brief,
     named by its context line, opens the next page. */
  .finding:has(> .ca-card) { break-inside: auto; }
  .finding:has(> .ca-card) > .finding-desc { break-inside: avoid; }
  /* Briefs move the flow: held whole under its category head, the first
     finding of a category left up to 41% of a page blank. It may break
     before the last block of its description, and before its brief: its
     parts are the row groups of a one-column table (.lead-table), whose
     header row names the finding at the top of the next page. On the first
     page, that row hides under the category head: the 14px the head keeps
     above its first finding become its bottom padding, and the row is as
     tall, its text on the line of any other context row (only the room
     under it shrinks). Hidden under the last block, as a context line was,
     it cost 16px between two blocks, 6px anywhere else; hidden under a line
     of text, it would slip into a sentence of the text layer. */
  .cat-head:has(+ .finding > .lead-table) { position: relative; z-index: 1; background: #fff; padding-bottom: 14px; }
  .cat-head + .finding:has(> .lead-table) { margin-top: 0; }
  table.has-cont.lead-table { margin-top: -14px; }
  table.has-cont.lead-table .cont-row th { height: 14px; padding-bottom: 1px; }
  /* A cell draws no table: the finding reads as any other. */
  .lead-table > tbody > tr > td { padding: 0; border: none; font-size: inherit; color: inherit; overflow-wrap: inherit; }
  /* Rows are never cut (tr); the last one may open the next page. */
  .lead-table > tbody:last-child > tr:last-child { break-before: auto; }
  /* 6px between the two blocks, as between any two paragraphs … */
  .lead-table > tbody:first-of-type > tr > td { padding-bottom: 6px; }
  .lead-table > tbody:first-of-type .finding-desc > :last-child { margin-bottom: 0; }
  .lead-table .desc-tail, .lead-table .desc-tail > :first-child { margin-top: 0; }
  .lead-table .ai-note { margin-top: 6px; }
  /* … and 16px above the brief, as under any other finding. */
  .lead-table > tbody + tbody:not(:last-child) > tr > td { padding-bottom: 16px; }
  .lead-table .ca-card { margin-top: 0; }
  /* The context line of a brief starts 10px in, as the context row of a
     table: from one page to the next, « … (continued) » keeps one abscissa.
     Its first glyph also stays off the left edge of its cover, which the
     page clips (anti-aliased apart, the two left a grey speck). */
  .finding > .ca-cont { padding-left: 10px; }
  /* The compact brief of an advisory, on a full-width line under its row,
     starts at the advisory column. */
  .dep-table tr.adv-note td { padding-left: calc(${SEVERITY_COL} + 10px); }
  .dep-table tr.adv-note .ca-card { margin-top: 2px; }
  table.triaged-table tr.ca-tri-row td { padding: 0 10px 6px calc(${SEVERITY_COL} + 10px); }
`;

/** The dashboard preview only (the PDF never matches it). */
const OWASP_PREVIEW_CSS = `
  /* Below 950px, the zoomed page has a narrower text column
     (PREVIEW_PAGE_PX): the columns of an A06 block take the widths its
     block carries for it, those of the PDF when it carries none. In a
     narrower window still, a column of the upgrade plan or of the triaged
     packages never narrows below its content (its widest unbreakable chip,
     pill or count), and a state column keeps STATE_COL_PX. */
  @media screen and (max-width: 950px) {
    .deps { --plan-package: var(--narrow-plan-package); --plan-installed: var(--narrow-plan-installed); --plan-target: var(--narrow-plan-target); --advisory-packages: var(--narrow-advisory-packages); }
    .deps table.plan-table, .tri-split table.tri-packages { table-layout: auto; }
    .doc { --state-col: ${STATE_COL_PX}px; }
  }
`;

/** Full HTML document of the OWASP Top 10 report. */
export function renderOwaspReport(
  data: OwaspReportData,
  opts: OwaspRenderOptions,
): string {
  const m = buildModel(data);
  const sections = (tally: CybeTally | null): string[] => [
    ...m.categories
      .filter((c) => c.open.length)
      .map((c) => renderCategorySection(c, opts.detailed, tally, opts.forPdf)),
    m.unmapped.length
      ? renderUnmapped(m.unmapped, opts.detailed, tally, opts.forPdf)
      : '',
    m.triaged.length ? renderTriaged(m.triaged, opts.forPdf, tally) : '',
  ];
  // The Cybe Analysis briefs belong to the detailed report only. Once one is
  // known to print, the findings are drawn again with the first finding of
  // each category free to break before its last block (leadBreaks).
  const analysis = opts.analysis ?? NO_REPORT_ANALYSIS;
  let cybe = opts.detailed ? newTally(analysis) : null;
  let findings = sections(cybe);
  if (printsCybe(cybe)) {
    cybe = newTally(analysis, true);
    findings = sections(cybe);
  }
  const body = [
    renderCoverBlock(data),
    renderSummary(m, opts.forPdf),
    renderCategoryTable(m),
    ...findings,
    renderAbout(aboutFlags(m, opts.detailed, cybe)),
  ]
    .filter(Boolean)
    .join('\n');
  // Their styles only when one is printed, so a report without any is
  // unchanged.
  const css = printsCybe(cybe)
    ? `${OWASP_REPORT_CSS}${analysis.css}${OWASP_CYBE_CSS}`
    : OWASP_REPORT_CSS;
  // The preview also reads the widths of its narrower text column.
  return renderReportDocument({
    title: owaspReportTitle(data),
    forPdf: opts.forPdf,
    body,
    extraCss: opts.forPdf ? css : `${css}${OWASP_PREVIEW_CSS}`,
  });
}
