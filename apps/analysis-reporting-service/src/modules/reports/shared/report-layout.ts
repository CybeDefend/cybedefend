// report-layout.ts
//
// Layout components shared by every report: document skeleton, cover,
// section titles, key-figure tiles, tables, state / verdict labels, callouts.
// The templates assemble these blocks instead of rewriting their HTML and
// inline styles, which keeps one visual family from one report to the next.
//
// Every text passed as a `string` parameter is escaped here, except the
// fields explicitly named `html` / the `dataTable` cells, which the caller
// builds from already escaped values.

import { escapeHtml } from '../../../core/utils/html-escape';
import { CYBEDEFEND_LOGO_BASE64, CYBEDEFEND_LOGO_MIME } from './logo-base64';
import {
  COLORS,
  IdPunctuation,
  LONG_ID_CHARS,
  MONO_STACK,
  breakableId,
  breakableVersion,
  getReportBaseCss,
  idBox,
  idPieces,
  isLongId,
  joinShortPieces,
  piecesHtml,
  punctuated,
  severityColors,
} from './report-styles';

const C = COLORS;

export const REPORT_LAYOUT_CSS = `
  /* Cover: brand band + document metadata. */
  .cover { background: linear-gradient(118deg, #281434 0%, #3b1d6b 52%, #6437e6 100%); color: #fff; border-radius: 14px; padding: 24px 28px 22px; break-inside: avoid; }
  .cover-top { display: flex; align-items: center; justify-content: space-between; }
  .cover-brand { display: flex; align-items: center; gap: 9px; font-size: 10.5px; font-weight: 600; letter-spacing: 0.16em; }
  .cover-brand img { width: 26px; height: 26px; background: #fff; border-radius: 6px; padding: 3px; }
  .cover-eyebrow { font-size: 9.5px; font-weight: 500; letter-spacing: 0.12em; text-transform: uppercase; color: rgba(255, 255, 255, 0.72); }
  .cover h1 { color: #fff; margin: 22px 0 4px; }
  .cover-subtitle { color: rgba(255, 255, 255, 0.8); font-size: 12px; margin: 0; }
  /* Tracks computed by renderCover from the content (--cover-columns). */
  .cover-meta { display: grid; grid-template-columns: var(--cover-columns); gap: 16px; margin-top: 18px; padding-top: 14px; border-top: 1px solid rgba(255, 255, 255, 0.18); }
  .cover-meta dt { font-size: 8.5px; font-weight: 500; letter-spacing: 0.1em; text-transform: uppercase; color: rgba(255, 255, 255, 0.62); margin-bottom: 2px; }
  .cover-meta dd { font-size: 11px; font-weight: 500; color: #fff; overflow-wrap: anywhere; }
  /* A short value fits on one line (dd.short), not its sub-line; a project's
     identifier breaks before its dashes (<wbr>, which Chromium honours even in
     nowrap) when its column cannot hold it: renderCover gives it the width of
     its font size (idFontPx). */
  .cover-meta dd .sub { display: block; font-size: 9px; font-weight: 400; color: rgba(255, 255, 255, 0.62); white-space: normal; text-wrap: pretty; }
  .cover-meta dd .sub.id { font-family: 'JetBrains Mono', 'FreeMono', monospace; font-size: 8px; color: rgba(255, 255, 255, 0.72); overflow-wrap: anywhere; white-space: inherit; }

  /* Key-figure tiles. */
  .kpis { display: grid; gap: 10px; }
  /* Accent edge painted as a background: a 3px border against the radius drew a crescent. */
  .kpi { background: linear-gradient(90deg, var(--kpi-accent, #fff) 0 4px, #fff 4px) no-repeat border-box; background-repeat: no-repeat; border: 1px solid ${C.border}; border-radius: 8px; padding: 10px 12px 9px 16px; }
  .kpi-value { font-size: 22px; font-weight: 600; line-height: 1.15; color: ${C.dark}; font-variant-numeric: tabular-nums; }
  .kpi-label { font-size: 9.5px; font-weight: 500; letter-spacing: 0.07em; text-transform: uppercase; color: ${C.textMuted}; margin-top: 3px; }
  .kpi-caption { font-size: 9.5px; color: ${C.textMuted}; margin-top: 1px; }
  .kpi.is-zero .kpi-value { color: #b8b2c2; }

  /* Finding state and exploitability pills. */
  .state { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; color: ${C.textSecondary}; }
  .state-dot { width: 6px; height: 6px; border-radius: 50%; flex: none; transform: translateY(-0.5px); }
  .state-dot.is-ring { background: transparent; border: 1.5px solid; }
  .verdict { display: inline-block; padding: 0 5px; border: 1px solid transparent; border-radius: 4px; font-size: 9.5px; font-weight: 600; line-height: 1.7; white-space: nowrap; }

  /* Callouts and empty state. */
  .callout { border-radius: 8px; padding: 10px 12px 10px 17px; font-size: 11px; background-repeat: no-repeat; }
  .callout p:last-child { margin-bottom: 0; }
  .callout-info { background: linear-gradient(90deg, ${C.accent} 0 3px, ${C.accentSoft} 3px); color: ${C.text}; }
  .callout-warning { background: linear-gradient(90deg, #e8a50c 0 3px, #fffaeb 3px); color: #5c3d0a; }
  .callout-success { background: linear-gradient(90deg, #12b76a 0 3px, #ecfdf3 3px); color: #054f31; }
  .callout-danger { background: linear-gradient(90deg, #d92d20 0 3px, #fef3f2 3px); color: #7a271a; }
  .callout-neutral { background: linear-gradient(90deg, ${C.border} 0 3px, ${C.subtleBg} 3px); color: ${C.textSecondary}; }
  .empty { display: flex; align-items: center; gap: 8px; padding: 12px 14px; border: 1px dashed ${C.border}; border-radius: 8px; color: ${C.textSecondary}; font-size: 11px; break-inside: avoid; }
  .empty svg { flex: none; }

  /* End of document. */
  /* A long entry breaks between its paragraphs (at least 3 lines on either
     side), never under its title: kept whole, it left the last page to the
     colophon alone. */
  .about { margin-top: 36px; padding-top: 14px; border-top: 1px solid ${C.border}; font-size: 10px; color: ${C.textMuted}; }
  .about h2 { font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: ${C.textSecondary}; margin-bottom: 8px; }
  .about h3 { font-size: 10.5px; margin: 10px 0 3px; color: ${C.textSecondary}; break-after: avoid; }
  .about p { margin-bottom: 4px; }
  .arrow { display: inline-block; vertical-align: 0; margin: 0 3px; color: ${C.textMuted}; }
  .cover-meta dd.short { white-space: nowrap; }
  /* Narrow preview (preview iframe): under 780 px, two columns, and a one-line
     value breaks at its spaces there rather than overflow; from 950 px (the
     preview becomes narrower than the PDF) for a cover whose one-line values
     would not fit on four columns (is-tight); under 840 px (the preview modal)
     for a cover whose project identifier would no longer fit whole on four
     columns at 780 px (is-snug). Two equal shares, or renderCover's tracks
     (--cover-narrow-columns) when the identifier must keep its line there.
     Never in the PDF. */
  @media screen and (max-width: 950px) { .cover-meta.is-tight { grid-template-columns: var(--cover-narrow-columns, repeat(2, minmax(0, 1fr))); } .cover-meta.is-tight dd.short { white-space: normal; } }
  @media screen and (max-width: 839px) { .cover-meta.is-snug { grid-template-columns: var(--cover-narrow-columns, repeat(2, minmax(0, 1fr))); } .cover-meta.is-snug dd.short { white-space: normal; } }
  @media screen and (max-width: 780px) { .cover-meta { grid-template-columns: var(--cover-narrow-columns, repeat(2, minmax(0, 1fr))); } .cover-meta dd.short { white-space: normal; } }
  /* Table that continues on the next page: the repeated header carries a
     context line (.cont-row) naming what the rows belong to. On the first
     page, the table moves up under the block before it (.cont-cover, painted
     above) by the exact height of that line, which therefore stays hidden
     under the block's bottom margin (never under a line of text, so that text
     extraction does not insert it into a sentence); after a break, the
     negative margin is truncated and the line appears. */
  .cont-cover { position: relative; z-index: 1; background: #fff; break-after: avoid; break-inside: avoid; margin-bottom: 0; padding-bottom: 16px; min-height: 16px; }
  table.has-cont { margin-top: -16px; }
  table.has-cont thead tr.cont-row { background: none; }
  table.has-cont .cont-row th { height: 16px; line-height: 13px; padding: 0 10px 3px; background: none; border-radius: 0; font-size: 10px; font-weight: 600; letter-spacing: 0; text-transform: none; color: ${C.dark}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; vertical-align: bottom; }
  .path .seg, .code-chip .seg, .path.keep { white-space: nowrap; }
  /* Long part of a chip (scoped name, Debian version with epoch) or of a path
     (directory, file): in one piece if it fits on a line, else broken at its
     separators, as a last resort anywhere. */
  .code-chip .seg.is-long { display: inline-block; max-width: 100%; white-space: normal; overflow-wrap: anywhere; text-indent: 0; }
  /* Long version of a package chip: a block in its part, which a template rule
     that flows the long parts does not touch; whole while it fits on a line,
     else broken between its parts. In a chip that wraps, it keeps the chip's
     background on every line (its part has none). */
  .code-chip .ver { display: inline-block; max-width: 100%; white-space: normal; overflow-wrap: anywhere; text-indent: 0; background: ${C.chipBg}; }
  .path .seg.is-long { display: inline-block; max-width: 100%; white-space: normal; overflow-wrap: anywhere; text-indent: 0; }
  /* Long path quoted in a sentence: inline in its box (.id-box, inline block),
     in one piece if it fits on a line, else broken at its separators. */
  .path.keep.is-long { white-space: normal; text-indent: 0; }
  /* Identifier outside a chip (idText): short, in one piece; long, inline in
     its box (.id-box), broken at its separators when it does not fit on a
     line. */
  .id-text { font-family: ${MONO_STACK}; font-synthesis: none; white-space: nowrap; }
  .id-text.is-long { white-space: normal; overflow-wrap: anywhere; }
  /* Full-width note attached to the row above: the row and its notes form a
     group (tbody.unit) never split across two pages. */
  tr.has-note td { border-bottom: none; padding-bottom: 3px; }
  tr.note-row td { padding-top: 0; }
  tr.note-row { break-before: avoid; }
  tbody.unit { break-inside: avoid; }
  /* Key findings: panel with violet bullets. */
  .key-facts ul { list-style: none; margin: 0; padding: 0; }
  .key-facts li { position: relative; padding-left: 13px; margin: 5px 0; text-wrap: pretty; }
  .key-facts li::before { content: ''; position: absolute; left: 1px; top: 0.6em; width: 5px; height: 5px; border-radius: 50%; background: ${C.accent}; }
  .code-chip.pkg { white-space: normal; }
  .footer { margin-top: 18px; font-size: 9.5px; color: ${C.textMuted}; text-align: center; }
`;

export interface ReportDocumentOptions {
  /** `<title>` of the document. */
  title: string;
  forPdf: boolean;
  /** HTML body already built (and escaped) by the template. */
  body: string;
  /** The report's own CSS, added after the common CSS. */
  extraCss?: string;
  /** End-of-document notice (text). */
  footerNote?: string;
}

/** Complete HTML skeleton of a report. No script: the dashboard preview is
 * a `sandbox=""` iframe. */
export function renderReportDocument(opts: ReportDocumentOptions): string {
  const note = opts.footerNote ?? 'Generated by CybeDefend';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(opts.title)}</title>
  <style>
${getReportBaseCss(opts.forPdf)}
${REPORT_LAYOUT_CSS}
${opts.extraCss ?? ''}
  </style>
</head>
<body>
<div class="doc">
${opts.body}
<div class="footer">${escapeHtml(note)}</div>
</div>
</body>
</html>`;
}

export interface CoverMeta {
  label: string;
  value: string;
  /** Discreet secondary line (e.g. a technical identifier). */
  sub?: string;
}

// A short value (a date, a name) fits on one line; long ones (a list of
// families) wrap.
const SHORT_VALUE = 24;

// Technical identifier (UUID, hex fingerprint): shown in mono.
const ID_LIKE = /^[0-9a-f]{8,}(?:-[0-9a-f]{4,})*$/i;

// ── Cover grid, measured on its content ────────────────────────────────────
//
// Without a script (the preview is a `sandbox=""` iframe), the column widths
// and the elision are decided here, on a model of the printed text: advance
// widths of the embedded fonts, breakableId breaks (idPieces) and spaces,
// greedy line filling like Chromium.

// Advance widths of Rubik in hundredths of an em, ASCII characters 32 to 126,
// measured in the runtime image: weight 500 (value, label) and 400
// (sub-line). Outside ASCII: 0.62 em.
const RUBIK_500 =
  '2327416964787223363645612648273166466263656263546662272950575056846969687062607073306563588171706670676461716782666663353135457437576157615837626326295527906259616142534362578256575338253856';
const RUBIK_400 =
  '2525377062766922343445622548253064435960625960516459262749574953836767676961586871276360567970686468666258706680636560333033437534556055605635606124265224896157606038513960558054555135233556';

interface CoverFont {
  /** Font size (px) and line height (px). */
  size: number;
  line: number;
  /** Rubik advance table; without it, JetBrains Mono (0.6 em). */
  advances?: string;
}

const VALUE_FONT: CoverFont = { size: 11, line: 16.5, advances: RUBIK_500 };
const SUB_FONT: CoverFont = { size: 9, line: 13.5, advances: RUBIK_400 };
// Project identifier (UUID): JetBrains Mono, 8 px (`.sub.id`), unless a
// template prints it larger (renderCover's `idFontPx` option).
const ID_FONT_PX = 8;
const idFont = (size: number): CoverFont => ({ size, line: size * 1.5 });
const LABEL_FONT: CoverFont = { size: 8.5, line: 12.75, advances: RUBIK_500 };
// Upper-case label, letter-spaced by 0.1 em, and its bottom margin.
const LABEL_TRACKING_PX = 0.85;
const LABEL_HEIGHT = LABEL_FONT.line + 2;

// Printed grid: the A4 text column (210 mm minus two 14 mm margins) minus the
// band's inset (2 × 28 px); gap between columns.
const COVER_GRID_PX = 631;
const COVER_GAP_PX = 16;
// Safety margin of the model (kerning, Chromium rounding): measured in the
// runtime image, it departs from Chromium by 1 % at most, 1.9 px on
// « feature/PLAT ».
const COVER_SLACK_PX = 3;
// Model error (1 %): without a margin, a value it estimates slightly too
// wide for the original grid may still fit there (« SAST, IaC, SCA,
// Container »: 136.2 px estimated, 135.3 measured, column of 135.8 px).
const MODEL_TOLERANCE = 1.01;
// A value never exceeds three lines: beyond, it is elided in its middle
// (« … »), whole in the `title` attribute.
const COVER_MAX_LINES = 3;
const ELISION = '…';
// Column weights of the original grid: the first (the project and its
// identifier) wider.
const FIRST_COLUMN_WEIGHT = 1.3;
// Narrower preview: under 780 px of iframe, the grid goes to two columns; a
// cover whose one-line values would not fit on four columns at that width
// (`is-tight`) goes there from 950 px, where the preview becomes narrower
// than the PDF. Preview grid at 780 px:
// (780 − 15 of scrollbar − 2 × 16) / 1.13 − 2 × 53 − 2 × 28.
const NARROW_GRID_PX = 486;
// The dashboard preview modal is 840 px wide: a cover whose four columns
// hold the whole project identifier there, but no longer at 780 px
// (`is-snug`), goes to two columns just below (839 px).
// Preview grid at 840 px: (840 − 15 − 2 × 16) / 1.13 − 2 × 53 − 2 × 28.
const SNUG_GRID_PX = 539;

const advance = (font: CoverFont, ch: string): number => {
  if (!font.advances) return 0.6;
  const code = ch.codePointAt(0) ?? 0;
  if (code < 32 || code > 126) return 0.62;
  const at = (code - 32) * 2;
  return Number(font.advances.slice(at, at + 2)) / 100;
};

const textPx = (text: string, font: CoverFont): number =>
  Array.from(text).reduce((w, ch) => w + advance(font, ch), 0) * font.size;

const labelPx = (label: string): number =>
  Array.from(label.toUpperCase()).length * LABEL_TRACKING_PX +
  textPx(label.toUpperCase(), LABEL_FONT);

/** An unbreakable piece of a cover text. */
interface CoverAtom {
  text: string;
  /** A space precedes it (else a `<wbr>`, or nothing at the head). */
  spaced: boolean;
  /** Piece of a long identifier (rendered like breakableId). */
  piece: boolean;
}

/** Value or sub-line of a cell, as it prints. */
interface CoverText {
  full: string;
  font: CoverFont;
  nowrap: boolean;
  /** Never elided: a short value, an identifier (UUID). */
  whole: boolean;
  /** A list (see LIST_SEPARATOR_RE): elided by whole items. */
  list: boolean;
  atoms: CoverAtom[];
  /** Characters kept of `full` (middle elision below). */
  keep: number;
}

// A sub-line separates the items of a list with « , » or « and » (« Scanned:
// a, b and container images », « a and b, plus unbranched scans »): a branch
// name has no space. A value (an organisation or project name) is never read
// as a list: it may carry « and ».
const LIST_SEPARATOR_RE = /(, | and )/u;

// The words of a text, cut at spaces; a word of more than LONG_ID_CHARS
// characters, at its break points (idPieces).
const coverAtoms = (text: string): CoverAtom[] =>
  text
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((word, w) =>
      (isLongId(word) ? idPieces(word) : [word]).map((piece, i) => ({
        text: piece,
        spaced: w > 0 && i === 0,
        piece: isLongId(word),
      })),
    );

const coverText = (
  full: string,
  font: CoverFont,
  opts: { nowrap?: boolean; whole?: boolean; list?: boolean } = {},
): CoverText => ({
  full,
  font,
  nowrap: !!opts.nowrap,
  whole: !!(opts.whole || opts.nowrap),
  list: !!opts.list,
  atoms: coverAtoms(full),
  keep: full.length,
});

/**
 * The elided text: at most `keep` characters of `full`. A list keeps its
 * first items whole (at least the first) and states the rest (« and 2
 * more »): never an elision in the middle of an item, which merged two
 * branches into a name that does not exist or made one disappear. A single
 * value, or a first item too long on its own, is elided in its middle
 * (« … »).
 */
function elided(text: CoverText, keep: number): CoverText {
  const parts = text.list ? text.full.split(LIST_SEPARATOR_RE) : [text.full];
  // Items at even ranks, separators at odd ranks.
  const count = (parts.length + 1) / 2;
  if (count < 2) return midElided(text, keep);
  let kept = 1;
  let head = parts[0];
  while (
    kept < count &&
    head.length + parts[2 * kept - 1].length + parts[2 * kept].length <= keep
  ) {
    head += parts[2 * kept - 1] + parts[2 * kept];
    kept += 1;
  }
  if (kept === count) return midElided(text, keep);
  const rest = coverAtoms(`and ${count - kept} more`).map((a) => ({
    ...a,
    spaced: true,
  }));
  const first =
    head.length > keep
      ? midElided({ ...text, full: head, list: false }, keep).atoms
      : coverAtoms(head);
  return {
    ...text,
    keep: Math.min(keep, head.length),
    atoms: [...first, ...rest],
  };
}

/**
 * The text elided in its middle: at most `keep` characters of `full`, the
 * head and the tail cut between two pieces (or two words), the head followed
 * by « … ».
 */
function midElided(text: CoverText, keep: number): CoverText {
  const atoms = coverAtoms(text.full);
  const total = atoms.reduce((n, a) => n + a.text.length, 0);
  if (keep >= total) return { ...text, atoms, keep: text.full.length };
  const headRoom = Math.ceil(keep / 2);
  const tailRoom = keep - headRoom;
  const head: CoverAtom[] = [];
  let used = 0;
  for (const atom of atoms) {
    if (used + atom.text.length > headRoom) break;
    head.push(atom);
    used += atom.text.length;
  }
  const tail: CoverAtom[] = [];
  used = 0;
  for (const atom of [...atoms].reverse()) {
    // At least one piece is missing between the head and the tail.
    if (
      used + atom.text.length > tailRoom ||
      tail.length + head.length >= atoms.length - 1
    ) {
      break;
    }
    tail.unshift(atom);
    used += atom.text.length;
  }
  // A first (or last) piece longer than its share: cut inside it.
  if (!head.length) {
    head.push({
      ...atoms[0],
      text: atoms[0].text.slice(0, Math.max(1, headRoom)),
    });
  }
  if (!tail.length) {
    const last = atoms[atoms.length - 1];
    tail.push({
      ...last,
      spaced: false,
      text: last.text.slice(-Math.max(1, tailRoom)),
    });
  }
  const end = head.length - 1;
  return {
    ...text,
    keep,
    atoms: [
      ...head.slice(0, end),
      { ...head[end], text: `${head[end].text}${ELISION}` },
      ...tail,
    ],
  };
}

/**
 * Lines a text takes in `width` px, filled like Chromium, minus the model's
 * margin (`slack`).
 */
function coverLines(
  text: CoverText,
  width: number,
  slack = COVER_SLACK_PX,
): number {
  const room = width - slack;
  if (room <= 0) return Infinity;
  // Unbreakable: one line (cellMin guarantees it fits).
  if (text.nowrap) return 1;
  const space = textPx(' ', text.font);
  let lines = 1;
  let used = 0;
  for (const atom of text.atoms) {
    const w = textPx(atom.text, text.font);
    const gap = atom.spaced && used > 0 ? space : 0;
    if (used > 0 && used + gap + w > room) {
      lines += 1;
      used = w;
    } else {
      used += gap + w;
    }
    // Wider than a line: broken anywhere (overflow-wrap).
    if (used > room) {
      lines += Math.ceil(used / room) - 1;
      used -= (Math.ceil(used / room) - 1) * room;
    }
  }
  return lines;
}

/** A cell of the grid: label, value, sub-line. */
interface CoverCell {
  meta: CoverMeta;
  weight: number;
  value: CoverText;
  sub: CoverText | null;
}

const cellTexts = (cell: CoverCell): CoverText[] =>
  cell.sub ? [cell.value, cell.sub] : [cell.value];

/**
 * Width under which a cell overflows or breaks anywhere; `wrapped`: in a
 * narrow preview, where its short values also break at their spaces.
 */
const cellMin = (
  cell: CoverCell,
  slack = COVER_SLACK_PX,
  wrapped = false,
): number =>
  Math.max(
    labelPx(cell.meta.label),
    ...cellTexts(cell).map((t) =>
      t.nowrap && !wrapped
        ? textPx(t.full, t.font)
        : Math.max(0, ...t.atoms.map((a) => textPx(a.text, t.font))),
    ),
  ) + slack;

/** Width of the project identifier (UUID) on one line; 0 without it. */
const idLinePx = (cell: CoverCell): number =>
  cell.sub && ID_LIKE.test(cell.sub.full)
    ? textPx(cell.sub.full, cell.sub.font) + COVER_SLACK_PX
    : 0;

const cellHeight = (
  cell: CoverCell,
  width: number,
  slack = COVER_SLACK_PX,
): number =>
  LABEL_HEIGHT +
  cellTexts(cell).reduce(
    (h, t) => h + coverLines(t, width, slack) * t.font.line,
    0,
  );

const cellFits = (
  cell: CoverCell,
  width: number,
  height: number,
  slack = COVER_SLACK_PX,
): boolean =>
  width >= cellMin(cell, slack) &&
  cellTexts(cell).every(
    (t) => coverLines(t, width, slack) <= COVER_MAX_LINES,
  ) &&
  cellHeight(cell, width, slack) <= height + 0.01;

/** Smallest width where the cell fits in `height` (Infinity: none). */
function cellNeed(cell: CoverCell, height: number, avail: number): number {
  let lo = cellMin(cell);
  if (lo > avail || !cellFits(cell, avail, height)) return Infinity;
  if (cellFits(cell, lo, height)) return lo;
  let hi = avail;
  while (hi - lo > 0.5) {
    const mid = (lo + hi) / 2;
    if (cellFits(cell, mid, height)) hi = mid;
    else lo = mid;
  }
  return hi;
}

// The possible heights of a cell: its label, one to three lines of value,
// and of sub-line.
const cellHeights = (cell: CoverCell): number[] => {
  const heights: number[] = [];
  for (let v = 1; v <= COVER_MAX_LINES; v += 1) {
    for (
      let s = cell.sub ? 1 : 0;
      s <= (cell.sub ? COVER_MAX_LINES : 0);
      s += 1
    ) {
      heights.push(
        LABEL_HEIGHT +
          v * cell.value.font.line +
          (cell.sub ? s * cell.sub.font.line : 0),
      );
    }
  }
  return heights;
};

/**
 * The lowest grid height the columns allow, and the width each cell needs
 * to fit in it; null if even three lines per text do not fit (eliding is
 * needed).
 */
function solveCover(
  cells: CoverCell[],
  avail: number,
): { height: number; needs: number[] } | null {
  const heights = [...new Set(cells.flatMap(cellHeights))].sort(
    (a, b) => a - b,
  );
  for (const height of heights) {
    const needs = cells.map((c) => cellNeed(c, height, avail));
    if (needs.reduce((a, b) => a + b, 0) <= avail) return { height, needs };
  }
  return null;
}

/**
 * Final widths: each cell at least what it needs, the rest shared according
 * to the weights of the original grid (a cell that needs nothing more keeps
 * its original share).
 */
function waterFill(
  needs: number[],
  weights: number[],
  avail: number,
): number[] {
  const fixed = new Set<number>();
  let unit = 0;
  for (let pass = 0; pass <= needs.length; pass += 1) {
    const free = avail - [...fixed].reduce((s, i) => s + needs[i], 0);
    const weight = weights.reduce((s, w, i) => (fixed.has(i) ? s : s + w), 0);
    unit = weight ? free / weight : 0;
    const more = needs
      .map((need, i) => i)
      .filter((i) => !fixed.has(i) && needs[i] > weights[i] * unit);
    if (!more.length) break;
    more.forEach((i) => fixed.add(i));
  }
  return needs.map((need, i) => (fixed.has(i) ? need : weights[i] * unit));
}

// Width of what a text keeps.
const keptPx = (t: CoverText): number =>
  textPx(t.full.slice(0, t.keep), t.font);

/**
 * The widest text that can still be elided (null: none). Never a short value
 * nor an identifier (UUID), which always fit in three lines.
 */
const longestElidable = (cells: CoverCell[]): CoverText | null =>
  cells
    .flatMap(cellTexts)
    .filter((t) => !t.whole && t.keep > SHORT_VALUE)
    .reduce<CoverText | null>(
      (best, t) => (!best || keptPx(t) > keptPx(best) ? t : best),
      null,
    );

// Do three lines per text fit, whatever the height?
const holdsThreeLines = (cells: CoverCell[], avail: number): boolean =>
  cells.reduce((s, c) => s + cellNeed(c, Infinity, avail), 0) <= avail;

interface CoverLayout {
  cells: CoverCell[];
  /** Grid tracks (`grid-template-columns`). */
  columns: string;
  /**
   * Class that folds the grid to two columns in a narrow preview: from 950 px
   * (`is-tight`, one-line values too wide for four columns), under 840 px
   * (`is-snug`, project identifier), else under 780 px ('').
   */
  fold: '' | 'is-tight' | 'is-snug';
  /** Tracks on two columns (`--cover-narrow-columns`); null: equal shares. */
  narrow: string | null;
  /** Estimated height of the printed grid (px). */
  height: number;
}

/**
 * Cover grid: columns at the width of their content, which give the tallest
 * cell the fewest lines possible (three at most per text, beyond that elided
 * in its middle). The original grid (1.3fr then 1fr) stays when it is
 * enough.
 */
function layoutCover(meta: CoverMeta[], idFontPx = ID_FONT_PX): CoverLayout {
  const n = meta.length;
  const avail = COVER_GRID_PX - COVER_GAP_PX * Math.max(0, n - 1);
  const cells: CoverCell[] = meta.map((m, i) => {
    const id = !!m.sub && ID_LIKE.test(m.sub);
    return {
      meta: m,
      weight: i === 0 && n > 1 ? FIRST_COLUMN_WEIGHT : 1,
      value: coverText(m.value, VALUE_FONT, {
        nowrap: m.value.length <= SHORT_VALUE,
      }),
      // A long identifier breaks at its <wbr>, which Chromium honours even
      // under a short value (`nowrap`): never elided, it is breakable.
      sub: m.sub
        ? coverText(m.sub, id ? idFont(idFontPx) : SUB_FONT, {
            whole: id,
            list: !id,
          })
        : null,
    };
  });
  const weights = cells.map((c) => c.weight);
  // Do the labels, the one-line values and the longest pieces of the others
  // fit on four columns of a 780 px preview?
  const tight =
    cells.reduce((s, c) => s + cellMin(c), 0) +
      COVER_GAP_PX * Math.max(0, n - 1) >
    NARROW_GRID_PX;

  // Elide the widest text, a few characters at a time, until three lines per
  // text fit (the final width then gives it back everything it can).
  for (
    let text = longestElidable(cells);
    text && !holdsThreeLines(cells, avail);
    text = longestElidable(cells)
  ) {
    Object.assign(
      text,
      elided(text, text.keep - Math.max(2, Math.round(text.keep / 20))),
    );
  }
  const solved = solveCover(cells, avail);
  const unit = avail / weights.reduce((a, b) => a + b, 0);
  const original =
    n > 1 ? `${FIRST_COLUMN_WEIGHT}fr repeat(${n - 1}, 1fr)` : '1fr';
  if (!solved) {
    return {
      cells,
      columns: original,
      fold: tight ? 'is-tight' : '',
      narrow: null,
      height: Math.max(...cells.map((c) => cellHeight(c, c.weight * unit))),
    };
  }
  // The original grid stays if it already holds each cell at the lowest
  // height, judged without the model's margin and within its error: at
  // worst, the cover stays as before.
  const holds = cells.every((cell, i) =>
    cellFits(cell, weights[i] * unit * MODEL_TOLERANCE, solved.height, 0),
  );
  const widths = holds
    ? weights.map((w) => w * unit)
    : waterFill(solved.needs, weights, avail);
  // An elided cell keeps everything its final width allows.
  cells.forEach((cell, i) =>
    cellTexts(cell)
      .filter((t) => t.keep < t.full.length)
      .forEach((t) => {
        let lo = t.keep;
        let hi = t.full.length;
        while (hi - lo > 1) {
          const mid = Math.floor((lo + hi) / 2);
          const saved = { ...t };
          Object.assign(t, elided(saved, mid));
          const fits = cellFits(cell, widths[i], solved.height);
          Object.assign(t, saved);
          if (fits) lo = mid;
          else hi = mid;
        }
        Object.assign(t, elided({ ...t }, lo));
      }),
  );
  // Preview narrower than the PDF: the identifier (UUID) of a project with a
  // short name keeps the line it has in the PDF (it reads and copies as one
  // block, and it is the only extra line of its cell). A <wbr> does not
  // reserve its width: its track gets it as a floor, taken from what the
  // other cells have beyond their minimum, never from that minimum (below
  // it, it breaks before a dash). Under a long name, already on several
  // lines, the column's room goes to the name and its neighbours.
  const mins = cells.map((c) => cellMin(c));
  const ids = cells.map((c, i) =>
    c.value.nowrap && idLinePx(c) && coverLines(c.sub, widths[i]) === 1
      ? idLinePx(c)
      : 0,
  );
  const floored = ids.map((id, i) => id > mins[i]);
  const floorSum =
    mins.reduce((s, m, i) => s + Math.max(m, ids[i]), 0) +
    COVER_GAP_PX * Math.max(0, n - 1);
  const px = (v: number): string => `${Math.round(v * 10) / 10}px`;
  // A computed track never goes below its longest piece: in a narrower
  // preview, the shares shrink in proportion, and `overflow-wrap: anywhere`
  // would cut a word (« Contain | er »).
  const minOf = (i: number): string =>
    floored[i]
      ? `clamp(${Math.floor(mins[i] * 10) / 10}px, 100% - ${px(floorSum - ids[i])}, ${px(ids[i])})`
      : `${Math.floor(mins[i] * 10) / 10}px`;
  // On two columns (cell i in column i % 2), the column of an identifier
  // holds it whole as long as the other keeps its longest word.
  const narrow =
    n > 1 && ids.some(Boolean)
      ? [0, 1]
          .map((col) => {
            const id = Math.max(0, ...ids.filter((_, i) => i % 2 === col));
            const word = Math.max(
              0,
              ...cells
                .filter((_, i) => i % 2 !== col)
                .map((c) => cellMin(c, COVER_SLACK_PX, true)),
            );
            return id
              ? `minmax(min(${px(id)}, 100% - ${px(COVER_GAP_PX + word)}), 1fr)`
              : 'minmax(0, 1fr)';
          })
          .join(' ')
      : null;
  return {
    cells,
    columns: holds
      ? floored.some(Boolean)
        ? weights
            .map((w, i) =>
              floored[i] ? `minmax(${minOf(i)}, ${w}fr)` : `${w}fr`,
            )
            .join(' ')
        : original
      : widths
          .map((w, i) => `minmax(${minOf(i)}, ${Math.round(w * 10) / 10}fr)`)
          .join(' '),
    // Do four columns that no longer hold the whole identifier at 780 px
    // still hold it at 840 px (the modal)?
    fold:
      tight || floorSum > SNUG_GRID_PX
        ? 'is-tight'
        : floorSum > NARROW_GRID_PX
          ? 'is-snug'
          : '',
    narrow,
    height: Math.max(
      ...cells.map((c, i) =>
        holds
          ? cellHeight(c, widths[i] * MODEL_TOLERANCE, 0)
          : cellHeight(c, widths[i]),
      ),
    ),
  };
}

/**
 * Estimated height (px) of the metadata grid of a cover in the PDF: the
 * tallest cell, label included. A template that sizes its page 1 under the
 * cover (scanner-type: coverGrowth) compares it with that of a reference
 * cover. `idFontPx`: as for renderCover.
 */
export function coverMetaHeight(
  meta: CoverMeta[],
  opts: { idFontPx?: number } = {},
): number {
  return layoutCover(meta, opts.idFontPx).height;
}

/** A cover text in HTML: its pieces, « … » included. */
function coverTextHtml(text: CoverText): string {
  if (text.keep >= text.full.length && !text.atoms.some((a) => a.piece)) {
    return escapeHtml(text.full);
  }
  return text.atoms
    .map(
      (a, i) =>
        `${i ? (a.spaced ? ' ' : '<wbr>') : ''}${a.piece ? piecesHtml([a.text]) : escapeHtml(a.text)}`,
    )
    .join('');
}

const titleOf = (text: CoverText): string =>
  text.keep < text.full.length ? ` title="${escapeHtml(text.full)}"` : '';

/**
 * Cover: brand, title, subtitle and metadata grid, its columns at the width
 * of their content (see layoutCover). `idFontPx`: font size of the project
 * identifier (`.cover-meta dd .sub.id`), 8 px; a template that prints it
 * larger passes it so that its column holds it.
 */
export function renderCover(opts: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  meta: CoverMeta[];
  idFontPx?: number;
}): string {
  const layout = layoutCover(opts.meta, opts.idFontPx);
  const meta = layout.cells
    .map(({ meta: m, value, sub }) => {
      const cls = value.nowrap ? ' class="short"' : '';
      const subHtml = sub
        ? `<span class="sub${ID_LIKE.test(sub.full) ? ' id' : ''}"${titleOf(sub)}>${coverTextHtml(sub)}</span>`
        : '';
      return `<div><dt>${escapeHtml(m.label)}</dt><dd${cls}${titleOf(value)}>${coverTextHtml(value)}${subHtml}</dd></div>`;
    })
    .join('');
  return `<header class="cover">
  <div class="cover-top">
    <div class="cover-brand"><img src="data:${CYBEDEFEND_LOGO_MIME};base64,${CYBEDEFEND_LOGO_BASE64}" alt="CybeDefend" />CYBEDEFEND</div>
    <div class="cover-eyebrow">${escapeHtml(opts.eyebrow)}</div>
  </div>
  <h1>${escapeHtml(opts.title)}</h1>
  ${opts.subtitle ? `<p class="cover-subtitle">${escapeHtml(opts.subtitle)}</p>` : ''}
  <dl class="cover-meta${layout.fold ? ` ${layout.fold}` : ''}" style="--cover-columns: ${layout.columns};${layout.narrow ? ` --cover-narrow-columns: ${layout.narrow};` : ''}">${meta}</dl>
</header>`;
}

/** Section header: overline, title, right-hand note (counter…). */
export function sectionHead(opts: {
  title: string;
  eyebrow?: string;
  aside?: string;
}): string {
  return `<div class="section-head"><div>${opts.eyebrow ? `<div class="eyebrow">${escapeHtml(opts.eyebrow)}</div>` : ''}<h2>${escapeHtml(opts.title)}</h2></div>${opts.aside ? `<div class="aside">${escapeHtml(opts.aside)}</div>` : ''}</div>`;
}

export interface KpiTile {
  label: string;
  value: number | string;
  severity?: string;
  /** Edge colour for a tile without severity (e.g. minimal risk). */
  tone?: 'success' | 'accent' | 'warning';
  /** Greys the value 0 even without severity (e.g. « Classified: 0 »). */
  muteZero?: boolean;
  caption?: string;
}

/** Row of key-figure tiles (one column per tile). */
const TONES: Record<string, string> = {
  success: '#12b76a',
  accent: C.accent,
  warning: '#e8a50c',
};

export function kpiTiles(
  items: KpiTile[],
  opts: { leadWidth?: number } = {},
): string {
  const tiles = items
    .map((item) => {
      const isZero =
        (item.severity || item.muteZero || item.tone) &&
        Number(item.value) === 0;
      const colors = item.severity ? severityColors(item.severity) : null;
      const tone = !colors && item.tone ? TONES[item.tone] : null;
      const neutral = !colors && !tone;
      const border = isZero ? C.border : (colors?.solid ?? tone);
      const valueColor = colors && !isZero ? `color: ${colors.fg};` : '';
      const cls = `kpi${isZero ? ' is-zero' : ''}${neutral ? ' is-neutral' : ''}`;
      const style =
        border && !isZero ? ` style="--kpi-accent: ${border};"` : '';
      return `<div class="${cls}"${style}><div class="kpi-value" style="${valueColor}">${escapeHtml(String(item.value))}</div><div class="kpi-label">${escapeHtml(item.label)}</div>${item.caption ? `<div class="kpi-caption">${escapeHtml(item.caption)}</div>` : ''}</div>`;
    })
    .join('');
  // The leading tile (e.g. total) may be wider than the others.
  const columns =
    opts.leadWidth && items.length > 1
      ? `${opts.leadWidth}fr repeat(${items.length - 1}, minmax(0, 1fr))`
      : `repeat(${items.length}, minmax(0, 1fr))`;
  return `<div class="kpis" style="grid-template-columns: ${columns};">${tiles}</div>`;
}

export interface TableColumn {
  label: string;
  /** CSS width (e.g. `12%`, `90px`); giving one enables `table-layout: fixed`. */
  width?: string;
  align?: 'left' | 'right' | 'center';
  /** Class added to the cells of the column (e.g. `nowrap`). */
  className?: string;
}

/** Data table. The cells are HTML supplied by the caller. */
export function dataTable(opts: {
  columns: TableColumn[];
  /** HTML cells, or `{ full }` for a full-width row (note). */
  rows: (string[] | { full: string; className?: string; attach?: boolean })[];
  /** Class per row (same index as `rows`), e.g. `total`. */
  rowClasses?: string[];
  /**
   * Row attached to the one above (same index as `rows`): they form one row
   * group, never split across two pages.
   */
  joinPrevious?: boolean[];
  /**
   * Label (text) repeated at the head of the table on the following pages. The
   * block before the table must carry the `cont-cover` class.
   */
  continuation?: string;
  className?: string;
}): string {
  const sized = opts.columns.some((c) => c.width);
  const classes = [
    sized ? 'fixed' : '',
    opts.continuation ? 'has-cont' : '',
    opts.className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  const cls = (c: TableColumn) => {
    const names = [
      c.align && c.align !== 'left' ? c.align : '',
      c.className ?? '',
    ]
      .filter(Boolean)
      .join(' ');
    return names ? ` class="${names}"` : '';
  };
  const colgroup = sized
    ? `<colgroup>${opts.columns.map((c) => (c.width ? `<col style="width: ${c.width}">` : '<col>')).join('')}</colgroup>`
    : '';
  const head = opts.columns
    .map((c) => `<th${cls(c)}>${escapeHtml(c.label)}</th>`)
    .join('');
  const contRow = opts.continuation
    ? `<tr class="cont-row" aria-hidden="true"><th colspan="${opts.columns.length}">${escapeHtml(opts.continuation)}</th></tr>`
    : '';
  const attachedAbove = (r: number) => {
    const next = opts.rows[r + 1];
    return !!next && !Array.isArray(next) && !!next.attach;
  };
  const renderRow = (row: (typeof opts.rows)[number], r: number) => {
    if (!Array.isArray(row)) {
      const names = [row.attach ? 'note-row' : '', row.className ?? '']
        .filter(Boolean)
        .join(' ');
      const c = names ? ` class="${escapeHtml(names)}"` : '';
      return `<tr${c}><td colspan="${opts.columns.length}">${row.full}</td></tr>`;
    }
    const names = [
      opts.rowClasses?.[r] ?? '',
      attachedAbove(r) ? 'has-note' : '',
    ]
      .filter(Boolean)
      .join(' ');
    return `<tr${names ? ` class="${escapeHtml(names)}"` : ''}>${row.map((cell, i) => `<td${cls(opts.columns[i] ?? { label: '' })}>${cell}</td>`).join('')}</tr>`;
  };
  // A row, its notes and the rows attached to it (`joinPrevious`) form their
  // own unbreakable row group (`tbody.unit`): Chromium ignores
  // `break-before: avoid` between two rows, only a whole section stays in one
  // piece. The other rows stay grouped in ordinary `tbody` elements.
  const groups: { unit: boolean; html: string }[] = [];
  const joined = (r: number) => {
    const row = opts.rows[r];
    return (
      !!row &&
      ((!Array.isArray(row) && !!row.attach) || !!opts.joinPrevious?.[r])
    );
  };
  opts.rows.forEach((row, r) => {
    const html = renderRow(row, r);
    const last = groups[groups.length - 1];
    if (joined(r) && last?.unit) last.html += html;
    else if (joined(r + 1)) groups.push({ unit: true, html });
    else if (last && !last.unit) last.html += html;
    else groups.push({ unit: false, html });
  });
  const body = groups.length
    ? groups
        .map((g) => `<tbody${g.unit ? ' class="unit"' : ''}>${g.html}</tbody>`)
        .join('')
    : '<tbody></tbody>';
  return `<table${classes ? ` class="${classes}"` : ''}>${colgroup}<thead>${contRow}<tr>${head}</tr></thead>${body}</table>`;
}

// Parts of a long identifier broken BEFORE each « / » (Chicago: the next line
// opens on it), never at the head (`/usr`); a part of fewer than three
// characters joins its neighbour.
const beforeSlashes = (text: string): string[] =>
  joinShortPieces(String(text ?? '').split(/(?=\/)/));

/**
 * File path in monospace, breakable only at a `/` (never at a hyphen or in
 * the middle of a name): after it for a short path (≤ `LONG_ID_CHARS`, its
 * original markup), before it for a long path (Chicago). A long segment
 * (> `LONG_ID_CHARS`) is an inline block: in one piece if it fits on a line,
 * else broken at its own separators (`breakableId`), as a last resort
 * anywhere.
 *
 * `keep`: path quoted in a sentence, in one piece; long, it breaks at its
 * separators when it does not fit on a line (see `idText`). `before` /
 * `after`: the punctuation around it (« ( », « , », « ): »), never separated
 * from it.
 */
export function pathText(
  path: string,
  opts: { keep?: boolean } & IdPunctuation = {},
): string {
  const raw = String(path ?? '');
  const before = escapeHtml(opts.before ?? '');
  const after = escapeHtml(opts.after ?? '');
  if (opts.keep) {
    return isLongId(raw)
      ? idBox(
          `<span class="path keep is-long">${breakableId(raw)}</span>`,
          opts,
        )
      : `${before}<span class="path keep">${escapeHtml(raw)}</span>${after}`;
  }
  if (!isLongId(raw)) {
    const parts = raw.split('/');
    return `${before}<span class="path">${parts
      .map(
        (part, i) =>
          `<span class="seg">${escapeHtml(i < parts.length - 1 ? `${part}/` : part)}</span>`,
      )
      .join('<wbr>')}</span>${after}`;
  }
  const segs = beforeSlashes(raw);
  const last = segs.length - 1;
  // A punctuation touching an unbreakable part: nothing separates it from
  // it. A long part is an inline block, which Chromium would separate from
  // it: it goes inside.
  const inner = segs
    .map((seg, i) =>
      isLongId(seg)
        ? `<span class="seg is-long">${punctuated(breakableId(seg), {
            before: i === 0 ? opts.before : undefined,
            after: i === last ? opts.after : undefined,
          })}</span>`
        : `<span class="seg">${escapeHtml(seg)}</span>`,
    )
    .join('<wbr>');
  return `${isLongId(segs[0]) ? '' : before}<span class="path">${inner}</span>${isLongId(segs[last]) ? '' : after}`;
}

/**
 * Identifier outside a chip (image reference, digest, manifest, version) in
 * monospace, at the size and colour of the surrounding text. Short
 * (≤ `LONG_ID_CHARS`), it never breaks; long, it is inline in a box
 * (`idBox`): in one piece while it fits on a line, else broken at its break
 * points (`breakableId`), as a last resort anywhere. The box carries its own
 * `white-space`: a `nowrap` parent does not prevent it from breaking.
 * `punctuation`: the punctuation around it, never separated from it (inside
 * the box when it is long).
 */
export function idText(text: string, punctuation: IdPunctuation = {}): string {
  return isLongId(text)
    ? idBox(
        `<span class="id-text is-long">${breakableId(text)}</span>`,
        punctuation,
      )
    : `${escapeHtml(punctuation.before ?? '')}<span class="id-text">${escapeHtml(text)}</span>${escapeHtml(punctuation.after ?? '')}`;
}

const humanize = (value: string): string => {
  const s = String(value ?? '')
    .replace(/_/g, ' ')
    .trim()
    .toLowerCase();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '—';
};

// State colours distinct from the severity colours: a ring for what is still
// to be qualified, the brand violet for what is confirmed.
const STATE_DOTS: Record<string, { color: string; ring?: boolean }> = {
  to_verify: { color: '#8a7fb0', ring: true },
  confirmed: { color: C.accent },
  proposed_not_exploitable: { color: '#98a2b3', ring: true },
  not_exploitable: { color: '#98a2b3' },
  ignored: { color: '#98a2b3' },
  resolved: { color: '#12b76a' },
};

/** State of a finding, humanised, with a colour dot. */
export function stateLabel(state: string): string {
  const key = String(state ?? '').toLowerCase();
  const dot = STATE_DOTS[key] ?? { color: '#c3bdcc' };
  const dotHtml = dot.ring
    ? `<span class="state-dot is-ring" style="border-color: ${dot.color};"></span>`
    : `<span class="state-dot" style="background: ${dot.color};"></span>`;
  return `<span class="state">${dotHtml}${escapeHtml(humanize(key))}</span>`;
}

// AI verdicts as outlined pills, never in the severity colours; only an
// active-exploitation (or malicious) verdict is filled.
const VERDICT_STYLES: Record<
  string,
  { kind: 'outline' | 'solid'; fg: string; border: string; bg?: string }
> = {
  not_exploitable: { kind: 'outline', fg: '#067647', border: '#a6e5c4' },
  theoretical: { kind: 'outline', fg: '#475467', border: '#d0d5dd' },
  proven: { kind: 'outline', fg: '#b42318', border: '#f5a39b' },
  actively_exploited: {
    kind: 'solid',
    fg: '#ffffff',
    border: '#b42318',
    bg: '#b42318',
  },
  malicious: { kind: 'solid', fg: '#ffffff', border: '#7a271a', bg: '#7a271a' },
};

/** Exploitability verdict pill (AI analysis or manual review). */
export function verdictPill(verdict: string): string {
  const key = String(verdict ?? '').toLowerCase();
  const v = VERDICT_STYLES[key] ?? {
    kind: 'outline' as const,
    fg: C.textSecondary,
    border: C.border,
  };
  const bg = v.kind === 'solid' ? v.bg : '#ffffff';
  return `<span class="verdict is-${v.kind}" style="background: ${bg}; color: ${v.fg}; border-color: ${v.border};">${escapeHtml(humanize(key))}</span>`;
}

/** Callout (information, warning, success, neutral). */
export function callout(
  tone: 'info' | 'warning' | 'success' | 'danger' | 'neutral',
  html: string,
): string {
  return `<div class="callout callout-${tone}">${html}</div>`;
}

const CHECK_ICON = `<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="8" fill="#ecfdf3"/><path d="M4.6 8.3l2.2 2.2 4.6-4.9" fill="none" stroke="#12b76a" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/** Empty state (no finding, no component…). */
export function emptyState(text: string): string {
  return `<div class="empty">${CHECK_ICON}<span>${escapeHtml(text)}</span></div>`;
}

/** End section: methodology, scope, disclaimer. */
// Each entry stays whole, but the section can flow over two pages (protected
// as a block, a long section left an almost empty page).
export function aboutSection(items: { title: string; html: string }[]): string {
  return `<section class="about"><h2>About this report</h2>${items
    .map(
      (i) =>
        `<div class="about-item"><h3>${escapeHtml(i.title)}</h3>${i.html}</div>`,
    )
    .join('')}</section>`;
}

/**
 * « To » arrow (e.g. installed version → fixed version), drawn in SVG: the
 * embedded fonts (latin subset) have no U+2192 glyph, which would fall back
 * to an embedded FreeSans as Type 3.
 */
export function arrowIcon(): string {
  return '<svg class="arrow" width="10" height="8" viewBox="0 0 10 8" aria-label="to"><path d="M0.5 4h8M5.5 1l3 3-3 3" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}

const slashSegments = (text: string): string[] =>
  String(text ?? '')
    .split('/')
    .map((part, i, all) => (i < all.length - 1 ? `${part}/` : part))
    .filter(Boolean);

// Part of a chip: short, unbreakable; long, an inline block broken after its
// separators when it does not fit on a line of the chip.
const chipSegment = (seg: string): string =>
  isLongId(seg)
    ? `<span class="seg is-long">${breakableId(seg)}</span>`
    : `<span class="seg">${escapeHtml(seg)}</span>`;

// Version of a package chip (`@version`): atomic. Long, it is a block
// (`.ver`) in its part (`seg is-long`, the markup the templates measure),
// which no template flows: broken only between the parts of the version
// (versionPieces) when it does not fit on a line of the chip; short, never
// broken.
const versionSegment = (version: string): string =>
  isLongId(`@${version}`)
    ? `<span class="seg is-long"><span class="ver">@${breakableVersion(version)}</span></span>`
    : `<span class="seg">${escapeHtml(`@${version}`)}</span>`;

// Short npm scope (`@opentelemetry/`, at most LONG_ID_CHARS characters): its
// « / » closes it, like the `8:` epoch of a version; the name that follows
// opens the next line. A long scope is a long part like any other: broken
// before its « / ».
const NPM_SCOPE_RE = new RegExp(`^@[^/]{1,${LONG_ID_CHARS - 1}}/`, 'u');

// Parts of a long name broken BEFORE each « / » (Chicago), except the one of
// a short npm scope, which stays with it.
const nameSegments = (name: string): string[] => {
  const raw = String(name ?? '');
  const scope = NPM_SCOPE_RE.exec(raw)?.[0] ?? '';
  const rest = raw.slice(scope.length);
  return [scope, ...(rest ? rest.split(/(?=\/)/) : [])].filter(Boolean);
};

/**
 * Package reference `name@version` as a mono chip, breakable first before the
 * version and at the `/` of a scope (never at a hyphen of a short name):
 * after the « / » of a short npm scope (`@opentelemetry/`), which closes it,
 * as after each « / » of a short reference (≤ `LONG_ID_CHARS`, its original
 * markup); before any other « / » of a long one (Chicago). A long part of the
 * name (> `LONG_ID_CHARS`) breaks at its own separators when it does not fit
 * on a line; the version is atomic: long, it is a block that breaks only
 * between its parts (versionPieces: never inside a Debian revision nor
 * between two digits), as a last resort anywhere; short, never broken. No
 * punctuation sticks to it: a package chip is separated from what follows it
 * by a space.
 */
export function packageChip(name: string, version?: string): string {
  const tail = version ? [`@${version}`] : [];
  if (!isLongId(version ? `${name}@${version}` : name)) {
    return `<span class="code-chip pkg">${[...slashSegments(name), ...tail]
      .map(chipSegment)
      .join('<wbr>')}</span>`;
  }
  const segs = joinShortPieces([...nameSegments(name), ...tail]);
  // A version of fewer than three characters (`@1`) has joined the part
  // before it: it breaks there like it.
  const own = version !== undefined && segs[segs.length - 1] === tail[0];
  return `<span class="code-chip pkg">${[
    ...(own ? segs.slice(0, -1) : segs).map(chipSegment),
    ...(own ? [versionSegment(version)] : []),
  ].join('<wbr>')}</span>`;
}

/**
 * Identifier as a mono chip (model id, purl…), breakable first at the `/`,
 * like a package chip.
 */
export function idChip(text: string): string {
  return packageChip(text);
}

/** « Key facts » panel: violet bullets, items in already escaped HTML. */
export function keyFacts(title: string, items: string[]): string {
  return `<div class="panel key-facts"><div class="panel-title">${escapeHtml(title)}</div><ul>${items
    .map((i) => `<li>${i}</li>`)
    .join('')}</ul></div>`;
}
