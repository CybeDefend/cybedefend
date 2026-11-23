// report-styles.ts
//
// Single source of truth for the style of the HTML/PDF reports. Every
// template (scanner-type, OWASP, CWE, EU AI Act, aggregated) uses this module
// and the components of report-layout.ts instead of hard-coding its own style.
//
// Principles:
//  - Embedded fonts (report-fonts.ts): the server image has only FreeSans /
//    FreeMono, which gave a « system document » look.
//  - One typographic scale, one badge geometry, readable severity colour
//    pairs (contrast ≥ 4.5:1, checked by a test).
//  - « Open » layout: no boxed section. A border cut by a page break leaves a
//    frame open at the top or bottom of a page; only small blocks (tiles,
//    callouts, rows) have a background or a frame, and those never break
//    (`break-inside: avoid`).
//  - The break rules live in the BASE CSS, never under `@media print`: the
//    dashboard preview (iframe, screen media) shows the same thing as the
//    PDF. Large tables flow over several pages, header repeated, rows
//    protected.
//  - `forPdf` only changes the page frame (centred, enlarged sheet on screen,
//    Puppeteer margins in the PDF), never the palette or the scale: a larger
//    body on screen only flattened the hierarchy (text as large as a finding
//    title, larger than the tables).

import { escapeHtml } from '../../../core/utils/html-escape';
import { getReportFontFaceCss } from './report-fonts';
import { REPORT_CHARTS_CSS } from './report-charts';
import { isDistroVersion } from './report-findings';

type SeverityColors = { solid: string; bg: string; fg: string };

/** Canonical palette. */
export const COLORS = {
  accent: '#7845FF',
  accentSoft: '#F3EEFF',
  dark: '#281434',
  text: '#3a3444',
  textSecondary: '#5b5566',
  textMuted: '#736c7f',
  border: '#e7e3ee',
  rule: '#efebf4',
  pageBgBrowser: '#f4f2f7',
  pageBgPdf: '#ffffff',
  tableHead: '#f4f1fa',
  chipBg: '#f1eef6',
  subtleBg: '#faf9fc',
  success: '#067647',
  severity: {
    critical: { solid: '#d92d20', bg: '#fee4e2', fg: '#b42318' },
    high: { solid: '#f2641b', bg: '#ffead5', fg: '#b93815' },
    medium: { solid: '#e8a50c', bg: '#fef3c7', fg: '#93530a' },
    low: { solid: '#2e90fa', bg: '#dbeafe', fg: '#175cd3' },
    unknown: { solid: '#98a2b3', bg: '#f2f4f7', fg: '#475467' },
  } as Record<
    'critical' | 'high' | 'medium' | 'low' | 'unknown',
    SeverityColors
  >,
} as const;

export const FONT_STACK =
  "'Rubik', 'FreeSans', 'Helvetica Neue', Arial, sans-serif";
export const MONO_STACK = "'JetBrains Mono', 'FreeMono', Menlo, monospace";

/** Typographic scale, the same for the PDF and the preview. */
export const TYPE_SCALE = {
  body: '11.5px',
  h1: '26px',
  h2: '17px',
  h3: '13px',
  th: '9.5px',
  td: '11px',
  small: '10px',
  code: '10px',
} as const;

export const SPACING = {
  sectionGap: '30px',
  block: '14px',
  cell: '7px 10px',
} as const;

export const RADIUS = {
  cover: '14px',
  card: '10px',
  badge: '4px',
  chip: '4px',
} as const;

// A finding without a severity is called « Unrated » in every report.
const UNRATED = new Set(['', 'unknown', 'none', 'unrated']);

/** Readable label of a severity (« critical » → « Critical »). */
export function severityLabel(severity: string | null | undefined): string {
  const s = String(severity ?? '').trim();
  if (UNRATED.has(s.toLowerCase())) return 'Unrated';
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/** Colours of a severity (case-insensitive, neutral when unknown). */
export function severityColors(severity: string): SeverityColors {
  const key = String(severity ?? '').toLowerCase();
  return (
    (COLORS.severity as Record<string, SeverityColors>)[key] ??
    COLORS.severity.unknown
  );
}

/**
 * Canonical `<style>` shared by every report. `forPdf` only affects the page
 * frame.
 */
export function getReportBaseCss(forPdf: boolean): string {
  const C = COLORS;
  const frame = forPdf
    ? `body { background: ${C.pageBgPdf}; padding: 0; }
  .doc { width: 100%; }`
    : `body { background: ${C.pageBgBrowser}; padding: 32px 16px; }
  .doc { zoom: 1.13; max-width: 794px; margin: 0 auto; background: #fff; padding: 36px 53px; border-radius: 11px; box-shadow: 0 1px 3px rgba(40, 20, 52, 0.08), 0 8px 24px rgba(40, 20, 52, 0.06); }`;

  return `
  ${getReportFontFaceCss()}
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: ${FONT_STACK}; color: ${C.text}; font-size: ${TYPE_SCALE.body}; line-height: 1.5; -webkit-font-smoothing: antialiased; }
  ${frame}

  /* Headings: never orphaned at the bottom of a page. */
  h1, h2, h3, h4, .section-head, .eyebrow { break-after: avoid; }
  h1 { font-size: ${TYPE_SCALE.h1}; font-weight: 700; color: ${C.dark}; line-height: 1.2; }
  h2 { font-size: ${TYPE_SCALE.h2}; font-weight: 600; color: ${C.dark}; line-height: 1.3; }
  h3 { font-size: ${TYPE_SCALE.h3}; font-weight: 600; color: ${C.dark}; margin: 18px 0 8px; }
  p { margin: 0 0 8px; orphans: 3; widows: 3; }
  /* Never a single word on the last line of a paragraph. */
  p, li, .section-intro, .about p { text-wrap: pretty; }
  li { orphans: 3; widows: 3; }
  strong { font-weight: 600; color: ${C.dark}; }
  a { color: ${C.accent}; text-decoration: none; }
  .muted { color: ${C.textMuted}; }
  .small { font-size: ${TYPE_SCALE.small}; color: ${C.textMuted}; }
  .num { font-variant-numeric: tabular-nums; }

  /* « Open » section: heading + rule, never a frame. */
  .section { margin-top: ${SPACING.sectionGap}; }
  .section-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; padding-bottom: 8px; margin-bottom: ${SPACING.block}; border-bottom: 1px solid ${C.border}; break-inside: avoid; }
  .section-head .eyebrow { font-size: 9.5px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: ${C.accent}; margin-bottom: 3px; }
  .section-head .aside { font-size: 11px; color: ${C.textMuted}; white-space: nowrap; }
  .section-intro { color: ${C.textSecondary}; margin: -4px 0 ${SPACING.block}; }
  .subsection { margin-top: 22px; }

  /* Small blocks: background or frame, and never broken. */
  .panel { background: #fff; border: 1px solid ${C.border}; border-radius: ${RADIUS.card}; padding: 14px 16px; }
  .panel-title { font-size: 9.5px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: ${C.textMuted}; margin-bottom: 10px; }
  .panel, .kpi, .callout, .card, pre, tr, .badge, .chip, .ai-note, .avoid-break { break-inside: avoid; }
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
  .stack > * + * { margin-top: ${SPACING.block}; }

  /* Tables: light header repeated on every page, protected rows, words
     broken only when they do not fit in the cell. */
  table { width: 100%; border-collapse: collapse; margin-top: 4px; }
  table.fixed { table-layout: fixed; }
  thead { display: table-header-group; }
  thead tr { background: ${C.tableHead}; }
  th { color: ${C.textSecondary}; text-align: left; padding: ${SPACING.cell}; font-size: ${TYPE_SCALE.th}; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; white-space: nowrap; }
  td { padding: ${SPACING.cell}; border-bottom: 1px solid ${C.rule}; vertical-align: top; color: ${C.text}; font-size: ${TYPE_SCALE.td}; overflow-wrap: break-word; word-break: normal; }
  tbody:last-child > tr:last-child td { border-bottom: none; }
  /* Never a single row at the top or bottom of a page (first and last rows
     of the table, which may hold several row groups). */
  tbody:first-of-type > tr:first-child + tr,
  tbody:last-child > tr:last-child { break-before: avoid; }
  th.right, td.right { text-align: right; }
  th.center, td.center { text-align: center; }
  td .badge, td .chip, td .code-chip { white-space: nowrap; }
  td.nowrap { white-space: nowrap; }
  /* A short chip (version, CVE, short package name) never breaks, even in a
     fixed column: broken, « 1.2.5-r23 » ended its line on its hyphen and
     « 0.3.30 » read « 0.3.3 ». A column too narrow for it widens (template,
     measure of its content); only a long chip, a long version and a long
     part break. */
  /* A monospace identifier breaks anywhere rather than overflow its cell
     (the words of a sentence stay whole). */
  td .mono, td code, td .code-inline { overflow-wrap: anywhere; }

  /* Code. */
  pre, code, .mono, .code-block, .code-inline, .code-chip, .path { font-family: ${MONO_STACK}; }
  /* Only the 400/500 weights of the mono are embedded: never synthetic bold
     or italics (Chromium embeds them as Type 3). */
  pre, code, .mono, .code-block, .code-inline, .code-chip, .path { font-synthesis: none; }
  pre, .code-block { background: ${C.subtleBg}; border: 1px solid ${C.border}; border-radius: 6px; padding: 8px 10px; font-size: ${TYPE_SCALE.code}; line-height: 1.55; white-space: pre-wrap; overflow-wrap: anywhere; margin: 6px 0; color: ${C.text}; }
  code, .code-inline { background: ${C.chipBg}; padding: 0 2px; border-radius: 3px; font-size: 0.9em; line-height: 1; color: ${C.dark}; }
  .path { font-size: ${TYPE_SCALE.code}; color: ${C.textSecondary}; overflow-wrap: anywhere; }

  /* Single severity badge (the colour is the only variable). */
  .badge { display: inline-block; padding: 1px 7px; border-radius: ${RADIUS.badge}; font-size: 9px; font-weight: 600; line-height: 1.6; letter-spacing: 0.04em; text-transform: uppercase; white-space: nowrap; vertical-align: 1px; }
  /* Neutral chip (scanner type, category, CWE…) and code chip. */
  .chip { display: inline-block; padding: 0 6px; border-radius: ${RADIUS.chip}; background: ${C.chipBg}; color: ${C.textSecondary}; font-size: 9.5px; font-weight: 500; line-height: 1.7; white-space: nowrap; }
  /* Inline block: never broken while it fits on a line, without the
     negative indent of a summary line (its text would leave its margin).
     Made inline by a template and broken, it stays ONE chip: its cut edges
     stay open and straight (slice), never one rounded pill per line that
     would read as another identifier. */
  .code-chip { display: inline-block; font-size: ${TYPE_SCALE.code}; background: ${C.chipBg}; color: ${C.dark}; padding: 0 5px; border-radius: ${RADIUS.chip}; line-height: 1.7; white-space: nowrap; text-indent: 0; -webkit-box-decoration-break: slice; box-decoration-break: slice; }
  /* Long chip (codeChip): broken at its break points (<wbr>), in its own
     background, when it does not fit on a line. */
  .code-chip.is-long { max-width: 100%; white-space: normal; overflow-wrap: anywhere; }
  /* Long identifier and its punctuation (idBox): transparent inline block,
     in one piece while it fits on a line, otherwise broken at its break
     points, as a last resort anywhere; the punctuation around it stays with
     it. */
  .id-box { display: inline-block; max-width: 100%; white-space: normal; overflow-wrap: anywhere; text-indent: 0; }
  /* The long chip is inline there: broken, its background follows each line
     instead of covering the whole column. A line of JetBrains Mono content is
     1.3em: the padding gives it back the background height of a block chip
     (its line height), and one more pixel on each side joins one line's
     background to the next (a continuous chip). */
  .id-box > .code-chip.is-long { display: inline; padding: calc((1lh - 1.3em) / 2 + 1px) 5px; }
  /* Long version chip (versionChip): a single block, even in its box or in
     a template that makes its chips inline; broken between its parts when it
     does not fit on a line. */
  .code-chip.version { display: inline-block; max-width: 100%; white-space: normal; overflow-wrap: anywhere; }
  /* A hyphen or a question mark tied to the character after it
     (breakableId): Chromium would break after it. */
  nobr { white-space: nowrap; }
  /* Long hexadecimal run (digest, fingerprint, registry host): inline block,
     in one piece while it fits on a line, otherwise broken between two digits
     into balanced lines (of similar lengths); never a two-character
     remainder. In a chip (even in one of its parts, without background) or
     inline code, it keeps their background on all its lines; in inline code
     (line height 1), it takes back the text's line spacing. */
  .hex { display: inline-block; max-width: 100%; white-space: normal; word-break: break-all; text-wrap: balance; text-indent: 0; }
  .code-chip .hex { background: ${C.chipBg}; }
  code .hex, .code-inline .hex { background: inherit; line-height: 1.5; }

  /* Markdown (descriptions, reasoning). */
  .md-p { margin: 0 0 6px; }
  .md-p:last-child { margin-bottom: 0; }
  .md-h { font-size: 11px; font-weight: 600; color: ${C.dark}; margin: 10px 0 4px; }
  .md-list { margin: 4px 0 6px 18px; }
  .md-list li { margin: 2px 0; }
  .md-quote { border-left: 2px solid ${C.border}; padding-left: 8px; color: ${C.textMuted}; margin: 6px 0; }
  .md-url { overflow-wrap: anywhere; }

  ${REPORT_CHARTS_CSS}

  img, pre, table, svg { max-width: 100%; }
`;
}

function renderBadge(colors: SeverityColors, rawLabel: string): string {
  return `<span class="badge" style="background: ${colors.bg}; color: ${colors.fg};">${escapeHtml(rawLabel)}</span>`;
}

/** Severity badge — shared `.badge` geometry, readable colour pair. */
export function severityBadge(severity: string): string {
  return renderBadge(severityColors(severity), severityLabel(severity));
}

const TYPE_LABELS: Record<string, string> = {
  sast: 'SAST',
  sca: 'SCA',
  iac: 'IaC',
  container: 'Container',
  secret: 'Secrets',
  cicd: 'CI/CD',
  aibom: 'AI-BOM',
};

/**
 * Scanner type chip. NEUTRAL: the type is carried by its label, colour stays
 * reserved for severity.
 */
export function typeBadge(type: string): string {
  const label =
    TYPE_LABELS[String(type ?? '').toLowerCase()] ?? String(type ?? '');
  return `<span class="chip">${escapeHtml(label)}</span>`;
}

/**
 * Beyond this length an identifier (image reference, digest, Debian version
 * with epoch, scoped package) is « long »: it gets break points. Below it (a
 * version, a CVE, a package name) it wraps in one piece, with its original
 * markup.
 */
export const LONG_ID_CHARS = 24;

/** « Long » identifier in the sense of {@link LONG_ID_CHARS}. */
export const isLongId = (text: string | null | undefined): boolean =>
  String(text ?? '').length > LONG_ID_CHARS;

// Break rules (Chicago Manual of Style, applied to identifiers): break
// BEFORE a run of separators (the next line opens with it, never a line
// ending on a dash that would read as hyphenation), AFTER a run that carries
// « : » or « // » (`https://`, `8:`, `sha256:`).
const SEPARATOR_CHARS = '/.\\-_@+~?#%=&:';
const TOKEN_RE = new RegExp(
  `(\\s+)|([${SEPARATOR_CHARS}]+)|([^${SEPARATOR_CHARS}\\s]+)`,
  'gu',
);
const breaksAfter = (run: string): boolean =>
  run.includes(':') || run.includes('//');
// In a camelCase or PascalCase word longer than LONG_ID_CHARS characters: a
// lower-case → upper-case boundary (never inside an acronym).
const CAMEL_BOUNDARY_RE = /(?<=[a-z])(?=[A-Z])/u;
const ONLY_SEPARATORS = new RegExp(`^[${SEPARATOR_CHARS}]+$`, 'u');
// No fragment shorter than EDGE_MIN characters alone at a line end.
const EDGE_MIN = 3;
// Hexadecimal run longer than LONG_ID_CHARS characters, without a separator
// (sha256 digest, commit fingerprint, registry host): a block (see
// pieceHtml).
const HEX_RUN_RE = new RegExp(`[0-9a-f]{${LONG_ID_CHARS + 1},}`, 'iu');
const HEX_WORD_RE = /^[0-9a-f]+$/iu;

/**
 * The pieces of a long identifier between two break points, as text (their
 * concatenation gives back the identifier); a short identifier is a single
 * one. What breakableId returns, separated by `<wbr>`: what a template
 * measures to size a column, never breakableId's HTML (which carries other
 * tags).
 */
export function idPieces(text: string | null | undefined): string[] {
  const raw = String(text ?? '');
  if (!isLongId(raw)) return [raw];
  const pieces: string[] = [];
  let current = '';
  const cut = () => {
    if (current) pieces.push(current);
    current = '';
  };
  for (const [, space, run, word] of raw.matchAll(TOKEN_RE)) {
    if (space) {
      current += space;
    } else if (run) {
      if (breaksAfter(run)) {
        current += run;
        cut();
      } else {
        cut();
        current = run;
      }
    } else {
      // A hexadecimal run is not a camelCase word (see pieceHtml).
      const parts =
        word.length > LONG_ID_CHARS && !HEX_WORD_RE.test(word)
          ? word.split(CAMEL_BOUNDARY_RE)
          : [word];
      current += parts[0];
      for (const part of parts.slice(1)) {
        cut();
        current = part;
      }
    }
  }
  cut();
  return joinShortPieces(pieces);
}

/**
 * Pieces of an identifier with no fragment shorter than three characters
 * alone at a line end: a leading piece that is too short (`8:`, `@3`) or made
 * of separators joins the next one; any other piece that is too short (`.4`,
 * `:1`, `_k`) joins the previous one. Empty pieces disappear.
 */
export function joinShortPieces(parts: readonly string[]): string[] {
  const pieces = parts.filter(Boolean);
  while (
    pieces.length > 1 &&
    (pieces[0].length < EDGE_MIN || ONLY_SEPARATORS.test(pieces[0]))
  ) {
    pieces.splice(0, 2, pieces[0] + pieces[1]);
  }
  for (let i = 1; i < pieces.length; ) {
    if (pieces[i].length < EDGE_MIN) {
      pieces.splice(i - 1, 2, pieces[i - 1] + pieces[i]);
    } else {
      i += 1;
    }
  }
  return pieces;
}

// Chromium breaks on its own after a hyphen, an en dash or a question mark,
// whatever `<wbr>` precedes them: tied to the character after them (`<nobr>`,
// not a `<span>` that templates split), they open the line instead of ending
// it.
const NATIVE_BREAK_RE = /([-?–]+[^])/u;

const textHtml = (text: string): string =>
  text
    .split(NATIVE_BREAK_RE)
    .map((part, i) =>
      i % 2 ? `<nobr>${escapeHtml(part)}</nobr>` : escapeHtml(part),
    )
    .join('');

/**
 * A piece as HTML. A piece carrying a long hexadecimal run puts it in an
 * inline block (`.hex`): in one piece while it fits on a line, otherwise
 * broken between two of its characters into balanced lines (CSS); never at
 * the column edge, which left « 08 » alone on its line. Its breaks are not
 * break points of the identifier (no `<wbr>`): a column that can hold the
 * whole run holds it. The block opens on the separators before the run (the
 * line opens on them) and goes to the end of the piece (`:1` does not split
 * from it); a run stuck to a word takes the whole piece.
 */
const pieceHtml = (piece: string): string => {
  const hex = HEX_RUN_RE.exec(piece);
  if (!hex) return textHtml(piece);
  let start = hex.index;
  while (start > 0 && SEPARATOR_CHARS.includes(piece[start - 1])) start -= 1;
  if (start === hex.index) start = 0;
  return `${textHtml(piece.slice(0, start))}<span class="hex">${textHtml(piece.slice(start))}</span>`;
};

/**
 * Pieces of text (idPieces, versionPieces, or some of them) as escaped HTML,
 * separated by `<wbr>`: what breakableId returns, a hyphen or a question
 * mark tied to the character after it, a long hexadecimal run in its block
 * (see pieceHtml).
 */
export const piecesHtml = (pieces: readonly string[]): string =>
  pieces.map(pieceHtml).join('<wbr>');

/**
 * Long identifier (image reference, digest, path, version, scoped package,
 * camelCase name) as escaped HTML, breakable per the Chicago Manual of Style:
 * a `<wbr>` before each run of separators `/ . - _ @ + ~ ? # % = &`, after a
 * run carrying `:` or `//`, and in a word longer than LONG_ID_CHARS
 * characters between a lower-case and an upper-case letter; never at the
 * start (`@scope`, `/usr`, epoch `8:`), never a piece shorter than three
 * characters alone (`:1`, `.4`), never inside an HTML entity (each piece is
 * escaped after the split). A hyphen or a question mark stays tied to the
 * character after it (`<nobr>`). Neither `<wbr>` nor `<nobr>` adds a
 * character to copied or extracted text. A short identifier is only escaped.
 *
 * Without a container, the text flows like a sentence, and the punctuation
 * after it (or the opening mark before it) never detaches from it: no break
 * point separates them. A `white-space: nowrap` does not neutralise them:
 * Chromium breaks at a `<wbr>` even inside a `nowrap` element (measured in
 * the server image). For an identifier that must stay in one piece while it
 * fits on a line, see `idText` (report-layout.ts) or `codeChip`. To measure
 * its pieces: `idPieces`.
 */
export function breakableId(text: string | null | undefined): string {
  const raw = String(text ?? '');
  if (!isLongId(raw)) return escapeHtml(raw);
  return piecesHtml(idPieces(raw));
}

/**
 * Characters a column of identifiers must hold on one line so that none
 * breaks anywhere but at its break points: its longest piece (idPieces), a
 * short identifier whole. 0 without an identifier.
 */
export function idColumnChars(
  ids: readonly (string | null | undefined)[],
): number {
  return Math.max(
    0,
    ...ids.filter((id) => id != null).flatMap((id) => pieceLengths(id)),
  );
}

const pieceLengths = (id: string): number[] =>
  idPieces(id).map((piece) => piece.length);

/**
 * Beyond this length a version is « absurdly long » (fingerprinted
 * pre-release, Go pseudo-version): its column no longer holds it whole, it
 * breaks at its break points (versionPieces). Below it (a Debian version with
 * epoch, `8:6.9.11.60+dfsg-1.6ubuntu1.4`, 29 characters), the column carrying
 * it widens to hold it whole.
 */
export const VERSION_WHOLE_CHARS = 32;

/**
 * The parts of a package version, as text (their concatenation gives back the
 * version). A version is atomic: short (≤ LONG_ID_CHARS), it is a single
 * part. Long, it breaks only before a « + » (build metadata, `+dfsg` of a
 * Debian upstream version) or before each « - » of its pre-release
 * (`v0.0.0` | `-20240312152122` | `-5f08fbb34913`: the timestamp and the
 * fingerprint of a Go pseudo-version stay whole); a Debian or RPM version,
 * before the « - » of its revision, never inside its revision (`+esm1`,
 * `+deb11u5` belong to it). Never between two digits, never a piece shorter
 * than three characters.
 */
export function versionPieces(version: string | null | undefined): string[] {
  const raw = String(version ?? '');
  if (!isLongId(raw)) return [raw];
  const starts: number[] = [];
  if (isDistroVersion(raw)) {
    const revision = raw.lastIndexOf('-');
    const upstreamEnd = revision > 0 ? revision : raw.length;
    for (let i = 1; i < upstreamEnd; i += 1) {
      if (raw[i] === '+') starts.push(i);
    }
    if (revision > 0) starts.push(revision);
  } else {
    // A « - » of the build metadata (after the « + ») opens nothing.
    const build = raw.indexOf('+');
    const preEnd = build > 0 ? build : raw.length;
    for (let i = 1; i < preEnd; i += 1) {
      if (raw[i] === '-') starts.push(i);
    }
    if (build > 0) starts.push(build);
  }
  const bounds = [0, ...starts, raw.length];
  return joinShortPieces(
    bounds.slice(0, -1).map((start, i) => raw.slice(start, bounds[i + 1])),
  );
}

/**
 * A package version as escaped HTML, breakable only between its parts
 * (versionPieces); short, only escaped. See versionChip for a chip.
 */
export function breakableVersion(version: string | null | undefined): string {
  const raw = String(version ?? '');
  return isLongId(raw) ? piecesHtml(versionPieces(raw)) : escapeHtml(raw);
}

/**
 * Characters a column of versions (Fixed in, Installed, Upgrade to,
 * Versions) must hold on one line: a whole version up to
 * VERSION_WHOLE_CHARS characters, its longest part beyond. The template adds
 * the chip and cell margins. 0 without a version.
 */
export function versionColumnChars(
  versions: readonly (string | null | undefined)[],
): number {
  return Math.max(
    0,
    ...versions
      .filter((v) => v != null)
      .map((v) =>
        v.length <= VERSION_WHOLE_CHARS
          ? v.length
          : Math.max(...versionPieces(v).map((piece) => piece.length)),
      ),
  );
}

/** Punctuation around an identifier, kept with it (text). */
export interface IdPunctuation {
  /** Opening mark before it, without a space (« ( », « “ »). */
  before?: string;
  /** Punctuation after it, without a space (« , », « ): », « . »). */
  after?: string;
}

/**
 * Box of an identifier and its punctuation (`.id-box`): transparent inline
 * block, in one piece while it fits on a line, otherwise broken at its break
 * points. Chromium breaks between an inline block and the punctuation after
 * it: in the box, neither the closing mark starts a line alone nor the
 * opening mark stays alone at the end of one.
 */
export const idBox = (html: string, punctuation: IdPunctuation): string =>
  `<span class="id-box">${punctuated(html, punctuation)}</span>`;

// Hexadecimal block (pieceHtml) at the start or the end of a rendered
// identifier: its content has only text, `<wbr>` and `<nobr>`.
const HEX_HEAD_RE = /^((?:<span [^>]*>)*<span class="hex">)/u;
const HEX_TAIL_RE = /(<\/span>(?:<\/span>)*)$/u;
const endsInHex = (html: string): boolean =>
  /<span class="hex">(?:[^<]|<\/?(?:wbr|nobr)>)*<\/span>(?:<\/span>)*$/u.test(
    html,
  );

/**
 * A rendered identifier (breakableId, chip…) and the punctuation around it
 * (text). Chromium breaks between an inline block and the neighbouring
 * punctuation: a hexadecimal block (pieceHtml) at the start or the end of the
 * identifier takes it inside, never alone at the end or start of a line;
 * elsewhere, it sits beside it.
 */
export function punctuated(html: string, punctuation: IdPunctuation): string {
  const before = escapeHtml(punctuation.before ?? '');
  const after = escapeHtml(punctuation.after ?? '');
  let out = html;
  let head = before;
  let tail = after;
  if (before && HEX_HEAD_RE.test(out)) {
    out = out.replace(HEX_HEAD_RE, (open: string) => `${open}${before}`);
    head = '';
  }
  if (after && endsInHex(out)) {
    // The block's closing tag is the first of the trailing closing tags.
    out = out.replace(HEX_TAIL_RE, (close: string) => `${after}${close}`);
    tail = '';
  }
  return `${head}${out}${tail}`;
}

/**
 * Monospace chip for versions/branches/identifiers. Short, it is an inline
 * block in one piece. Long (Debian version with epoch, image reference), it is
 * an inline chip in a box (`idBox`): in one piece while it fits on a line,
 * otherwise broken at its break points, its background following each line.
 * `punctuation`: the punctuation around it, kept in the box; without it, a
 * short chip keeps its original markup.
 */
export function codeChip(text: string, punctuation?: IdPunctuation): string {
  const chip = `<span class="code-chip${isLongId(text) ? ' is-long' : ''}">${breakableId(text)}</span>`;
  return isLongId(text) || punctuation ? idBox(chip, punctuation ?? {}) : chip;
}

/**
 * Chip of a package version. Short (≤ LONG_ID_CHARS), it is codeChip, markup
 * included. Long, it is ONE chip (`.code-chip.version`, an inline block whose
 * background covers all its lines, never several pills that would read as
 * several versions): in one piece while it fits on a line, otherwise broken
 * between its parts (versionPieces); a part wider than the column, as a last
 * resort anywhere. The template sizes its column with versionColumnChars so
 * that this last resort is never used. `punctuation`: as codeChip, in the
 * box.
 */
export function versionChip(
  version: string,
  punctuation?: IdPunctuation,
): string {
  if (!isLongId(version)) return codeChip(version, punctuation);
  const chip = `<span class="code-chip version">${breakableVersion(version)}</span>`;
  return punctuation ? idBox(chip, punctuation) : chip;
}
