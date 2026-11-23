// aggregated-common.ts
//
// Helpers shared by the four aggregated reports (OWASP Top 10, CWE Top 25,
// licenses, EU AI Act): cover metadata of an organization / team / custom
// selection, number formatting, project and branch cells, small charts built
// on the shared ones, and the CSS the aggregated reports add to the shared
// design system (compact tables, summary facts, matrices).

import { escapeHtml } from '../../../../core/utils/html-escape';
import { CoverMeta, dataTable, keyFacts } from '../../shared/report-layout';
import {
  comparePackageVersions,
  formatReportDate,
  isDistroVersion,
  redactSecrets,
} from '../../shared/report-findings';
import { ChartDatum, stackedBar } from '../../shared/report-charts';
import {
  COLORS,
  MONO_STACK,
  breakableId,
  breakableVersion,
  idBox,
  isLongId,
  piecesHtml,
  punctuated,
  versionColumnChars,
  versionPieces,
} from '../../shared/report-styles';

/** Options received by ReportBuilderService.buildReport. */
export interface AggregatedReportOptions {
  scopeType: string; // 'organization' | 'team' | 'batch'
  scopeName: string;
  reportType: string; // 'owasp' | 'cwe' | 'license' | 'ai-act'
  format: string; // 'json' | 'html' | 'pdf'
  detailed: boolean;
  aggregatedData: any;
  projectIds: string[];
  metadata: any;
}

/** `1,114`. */
export const fmt = (n: number | null | undefined): string =>
  Number(n || 0).toLocaleString('en-US');

// Advance of each digit of the text face (Rubik, 11px) in the regular and
// the semibold weight (a total, an open count), and of the comma of a
// grouped count and of the « of » between two counts (« 4 of 4 »), in px,
// as the production image lays them out.
const DIGIT_PX: Record<'regular' | 'bold', number[]> = {
  regular: [7.0, 4.72, 6.47, 6.63, 6.85, 6.55, 6.65, 5.66, 7.0, 6.54],
  bold: [7.36, 5.29, 6.99, 7.1, 7.35, 6.96, 7.04, 6.15, 7.33, 6.93],
};
const COMMA_PX = { regular: 2.75, bold: 2.99 };
const OF_PX = { regular: 10.49, bold: 11.27 };

/**
 * Width (px) of a count as the tables set it (`1,268`, `4 of 12`), in the
 * regular or the semibold weight.
 */
export function countTextPx(text: string, bold = false): number {
  const weight = bold ? 'bold' : 'regular';
  const [head, ...tail] = String(text ?? '').split(' of ');
  const digits = (part: string) =>
    Array.from(part).reduce(
      (n, c) =>
        n + (/\d/.test(c) ? DIGIT_PX[weight][Number(c)] : COMMA_PX[weight]),
      0,
    );
  return tail.reduce(
    (n, part) => n + OF_PX[weight] + digits(part),
    digits(head),
  );
}

/**
 * Width of a column (`TableColumn.width`, the style of its `<col>`): its
 * share of the table, and the room its content needs on one line (px, the
 * cell padding included). `min` holds in every medium: a count longer than
 * the column planned for widens it, never breaks (Chromium's fixed table
 * layout honours a col's min-width, never a cell's); a floor narrower than
 * the share changes nothing. `preview` holds in the dashboard preview only
 * (`--preview-min`, AGGREGATED_SCREEN_CSS), whose sheet is narrower than the
 * page: a short chip, a state and its count, a part of a version keep their
 * room there, the PDF its columns. A column that `yields` its share there
 * when the sheet is narrower still (`--narrow-share`, AGGREGATED_SCREEN_CSS)
 * is as wide as its floor, the flexible column taking the rest: the share
 * sized for the PDF left that one too little.
 */
export function columnWidth(
  pct: number,
  floors: { min?: number; preview?: number; yields?: boolean } = {},
): string {
  const px = (n: number) => `${Math.ceil(n)}px`;
  return [
    floors.yields ? `var(--narrow-share, ${pct}%)` : `${pct}%`,
    floors.min > 0 ? `min-width: ${px(floors.min)}` : '',
    floors.preview > 0 ? `--preview-min: ${px(floors.preview)}` : '',
  ]
    .filter(Boolean)
    .join('; ');
}

/**
 * `1 finding`, `3 findings`: the number and its noun joined by a no-break
 * space, so that a line never ends on a number apart from what it counts
 * (a plain character, not an entity: tile captions and continuation labels
 * are escaped text).
 */
export const plural = (n: number, one: string, many = `${one}s`): string =>
  `${fmt(n)}\u00a0${n === 1 ? one : many}`;

/** Rounded share, `0` when the total is zero. */
export const percent = (part: number, total: number): number =>
  total > 0 ? Math.round((part / total) * 100) : 0;

/** Share for tables: `72%`, `<1%` for a small non-zero part, `0%`. */
export function share(part: number, total: number): string {
  if (!part || total <= 0) return '0%';
  const value = (part / total) * 100;
  return value < 1 ? '&lt;1%' : `${Math.round(value)}%`;
}

/** `a, b and c` for up to three names, `N projects` beyond. */
export function nameList(names: string[], noun: string): string {
  if (names.length > 3) return plural(names.length, noun);
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** Eyebrow of the cover: which kind of aggregated report this is. */
export function scopeEyebrow(scopeType: string): string {
  if (scopeType === 'team') return 'Team report';
  if (scopeType === 'batch') return 'Custom selection report';
  return 'Organization report';
}

const BRANCH_FILTERS: Record<string, string> = {
  all: 'All branches',
  reference: 'Reference branches',
  selected: 'Selected branches',
};

/**
 * Cover metadata of an aggregated report: scope, projects, branch filter
 * (with the branches its scans were found on) and generation date (UTC).
 */
export function aggregatedCoverMeta(
  options: AggregatedReportOptions,
  facts: {
    branches: string[];
    /** What was scanned without a branch (`container images`). */
    unbranched?: string;
  },
): CoverMeta[] {
  const data = options.aggregatedData ?? {};
  const scope: CoverMeta =
    options.scopeType === 'team'
      ? { label: 'Team', value: options.scopeName }
      : options.scopeType === 'batch'
        ? { label: 'Scope', value: 'Custom selection' }
        : { label: 'Organization', value: options.scopeName };
  const named = Array.from(new Set(facts.branches.filter(Boolean))).sort();
  // A branch and a kind of target are not listed as equals: « main and
  // container images ».
  const scannedItems = [
    named.length <= 2 ? named.join(', ') : `${named.length} branches`,
    facts.unbranched ?? '',
  ].filter(Boolean);
  const scanned = scannedItems.length
    ? `Scanned: ${scannedItems.join(' and ')}`
    : undefined;
  return [
    scope,
    { label: 'Projects', value: fmt(options.projectIds?.length ?? 0) },
    {
      label: 'Branches',
      value: BRANCH_FILTERS[data.branchFilter] ?? BRANCH_FILTERS.all,
      sub: scanned,
    },
    {
      label: 'Generated',
      value: formatReportDate(data.generatedAt ?? new Date()),
    },
  ];
}

/** Running-footer title: `OWASP Top 10 report · Acme Corp`. */
export function footerTitle(
  reportTitle: string,
  options: AggregatedReportOptions,
): string {
  const scope =
    options.scopeType === 'batch' ? 'Custom selection' : options.scopeName;
  return scope ? `${reportTitle} · ${scope}` : reportTitle;
}

/**
 * Order of two versions of a package, as the package manager orders them
 * (`15.0.0-canary.123` before `15.0.0`, `1:3.0.7` before `2:1.0.2`); two that
 * compare equal (`1.0`, `1.0.0`) in numeric text order.
 */
export const byVersion = (a: string, b: string): number =>
  comparePackageVersions(a, b) ||
  a.localeCompare(b, undefined, { numeric: true });

/** Tenant text shown as plain text: secrets masked, then escaped. */
export const safe = (value: unknown): string =>
  escapeHtml(redactSecrets(String(value ?? '')));

/**
 * A name kept whole (a project, a branch), `after` it (its comma) with it,
 * secrets masked. A long one (over `LONG_ID_CHARS`) flows like the sentence
 * around it, broken before its separators (a hyphen, a slash), never past
 * its cell or the page; the mark after it stays on its last line, inside
 * the block of a hash that ends the name (`punctuated`).
 */
export function wholeName(value: unknown, after = ''): string {
  const raw = redactSecrets(String(value ?? ''));
  return isLongId(raw)
    ? `<span class="nw is-long">${punctuated(breakableId(raw), { after })}</span>`
    : `<span class="nw">${escapeHtml(raw)}${escapeHtml(after)}</span>`;
}

/**
 * A project named in a sentence: a short one never breaks; a long one only
 * before its separators, its mark after it kept with it.
 */
export const projectName = (name: string): string => wholeName(name);

/**
 * Project names inline, comma-separated; a short name never breaks, a long
 * one only before its separators.
 */
export function projectNames(names: Iterable<string>): string {
  const list = Array.from(new Set(Array.from(names).filter(Boolean))).sort();
  // The comma stays with its name: a line never starts with one.
  return list
    .map((n, i) => wholeName(n, i < list.length - 1 ? ',' : ''))
    .join(' ');
}

/** Branch names, comma-separated, a long one breakable before its separators. */
export const branchNames = (branches: Iterable<string>): string =>
  Array.from(branches, (b) => breakableId(redactSecrets(String(b ?? '')))).join(
    ', ',
  );

/**
 * The one branch every project was scanned on (named on the cover), or ''
 * when they differ: a project row then names its own branches.
 */
export function sharedBranch(lists: Iterable<Iterable<string>>): string {
  const seen = new Set<string>();
  let any = false;
  for (const list of lists) {
    const named = Array.from(new Set(Array.from(list ?? []).filter(Boolean)));
    if (named.length > 1) return '';
    named.forEach((b) => seen.add(b));
    any ||= named.length > 0;
  }
  return any && seen.size === 1 ? Array.from(seen)[0] : '';
}

/**
 * Project cell: name, then team and branches in muted text on the same line,
 * after a separator so the team never reads as part of the name (`note`
 * replaces the branches, e.g. "No dependency inventory"). The separator
 * stays with the name: a cell too narrow for both sends the team to the
 * next line, which never opens on « · » (it would read as a list bullet).
 */
export function projectCell(
  name: string,
  team: string | undefined,
  branches: Iterable<string> | undefined,
  note?: string,
): string {
  const named = Array.from(
    new Set(Array.from(branches ?? []).filter(Boolean)),
  ).sort();
  const parts = [team ? safe(team) : '', note ?? branchNames(named)].filter(
    Boolean,
  );
  // Each separator stays with the part before it: a wrapped line never
  // opens on « · ».
  return `<span class="name">${breakableId(redactSecrets(String(name ?? '')))}</span>${
    parts.length
      ? `<span class="inline-sep">&nbsp;&middot;</span> <span class="inline-sub">${parts.join('&nbsp;&middot; ')}</span>`
      : ''
  }`;
}

/** A row of a table: its cells, or a line attached to the row above. */
export type TableRow = string[] | { full: string; attach: boolean };

// A team name longer than this runs several lines in a Project column.
const LONG_TEAM_CHARS = 40;

/**
 * Rows of a project in a projects table: its cells after its project cell
 * (`projectCell`), and, when one of its branches is long (an identifier over
 * `LONG_ID_CHARS`) or its team is, its team and branches on a line of their
 * own under the row, across the table: in the Project column, beside cells
 * of one digit, they ran ten lines.
 */
export function projectRows(
  project: {
    name: string;
    team?: string;
    branches?: Iterable<string>;
    note?: string;
  },
  cells: string[],
): TableRow[] {
  const named = Array.from(
    new Set(Array.from(project.branches ?? []).filter(Boolean)),
  ).sort();
  const longTeam = String(project.team ?? '').length > LONG_TEAM_CHARS;
  if (project.note || !(longTeam || named.some(isLongId))) {
    return [
      [projectCell(project.name, project.team, named, project.note), ...cells],
    ];
  }
  const parts = [project.team ? safe(project.team) : '', branchNames(named)];
  return [
    [projectCell(project.name, undefined, []), ...cells],
    {
      full: `<div class="project-sub">${parts.filter(Boolean).join('&nbsp;&middot; ')}</div>`,
      attach: true,
    },
  ];
}

// Characters of a line attached under a row, across the table (10px text).
const ATTACHED_LINE_CHARS = 120;

/**
 * Rows of a table that count for keeping it whole (`keepTogether`): a line
 * attached to a row (the team and long branches of a project) counts as a
 * row for each of its lines, the table being as tall as with as many
 * projects more. Kept whole, five projects and such a line went to the
 * next page and left three quarters of a page blank (CWE, OWASP and
 * license reports); cut, the table fills the page and the block after it
 * follows.
 */
export const rowCount = (rows: TableRow[]): number =>
  rows.reduce(
    (n, row) =>
      n +
      (Array.isArray(row)
        ? 1
        : Math.max(
            1,
            Math.ceil(
              row.full.replace(/<[^>]+>/g, '').replace(/&#?\w+;/g, ' ').length /
                ATTACHED_LINE_CHARS,
            ),
          )),
    0,
  );

/**
 * `joinPrevious` of a table that flows across pages, its rows `rows`: its
 * second row is joined to the first and its last row to the one before (a
 * row with the lines attached to it), so that neither end of the table is
 * ever alone on a page.
 */
export function edgeUnitsJoined(rows: TableRow[]): boolean[] {
  const starts = rows
    .map((row, i) => (Array.isArray(row) ? i : -1))
    .filter((i) => i >= 0);
  const joined = rows.map(() => false);
  if (starts.length > 2) {
    joined[starts[1]] = true;
    joined[starts[starts.length - 1]] = true;
  }
  return joined;
}

/**
 * A short table (a few rows) is kept on one page rather than leaving its
 * last rows alone at the top of the next one; long tables flow freely.
 */
export function keepTogether(table: string, rows: number, max = 12): string {
  return rows <= max ? `<div class="avoid-break">${table}</div>` : table;
}

/** A table this short never breaks: kept whole, without a continuation row. */
export const SHORT_TABLE = 4;

/**
 * A projects table of this many rows or fewer is kept whole on its page; a
 * longer one flows, its first and last rows joined (`edgeRowsJoined`): kept
 * whole, a table of ten projects left a third of the first page blank.
 */
export const WHOLE_TABLE = 6;

/**
 * `joinPrevious` of a table that flows across pages: its second row is
 * joined to the first and its last row to the one before, so that neither
 * end of the table is ever alone on a page. Chromium ignores `break-before:
 * avoid` between two rows: only a whole row group stays together.
 */
export function edgeRowsJoined(count: number): boolean[] {
  return Array.from(
    { length: count },
    (_, i) => count > 2 && (i === 1 || i === count - 1),
  );
}

/**
 * Table that may continue on the next page: named there by its continuation
 * row, unless it is short enough to stay whole on its page (`count` rows of
 * data, attached notes not counted). A short table whose rows may still
 * outgrow a page (`named`) keeps its continuation row, hidden under the block
 * above it as long as the table does not break.
 */
export function flowingTable(
  opts: Parameters<typeof dataTable>[0] & { count: number; named?: boolean },
): string {
  const { count, continuation, named, ...rest } = opts;
  if (count > SHORT_TABLE) return dataTable({ ...rest, continuation });
  return keepTogether(
    dataTable(named ? { ...rest, continuation } : rest),
    count,
  );
}

/** « Key facts » of a summary: the shared panel, as in every report. */
export function summaryFacts(items: string[]): string {
  return items.length ? keyFacts('Key facts', items) : '';
}

/** Chart panel of a summary: title, then the chart centred in the panel. */
export function chartPanel(title: string, chart: string): string {
  return `<div class="panel avoid-break"><div class="panel-title">${escapeHtml(title)}</div><div class="chart-body">${chart}</div></div>`;
}

/** The one mark of an empty cell (a zero, no category, no location). */
export const EMPTY = '<span class="zero">&ndash;</span>';

/**
 * A version of a list, its comma with it: whole. A version is atomic: long
 * (a pre-release build, a Debian version with an epoch), it breaks only
 * between its parts (`breakableVersion`: before a « + » or the « - » of a
 * Debian revision, never in the revision nor between two digits), when it
 * does not fit a line of its column (sized with `versionColumnChars`).
 */
export function versionItem(version: string, comma = false): string {
  const raw = redactSecrets(String(version ?? ''));
  const after = comma ? ',' : '';
  // A long one wraps inside its box: its comma goes in with it, never
  // alone at the head of the next line.
  return isLongId(raw)
    ? idBox(`<span class="id-text is-long">${breakableVersion(raw)}</span>`, {
        after,
      })
    : `<span class="nw">${escapeHtml(raw)}${after}</span>`;
}

// Model of a table of the PDF: 675px wide (688px printed, the margin of
// every width computed on it); 10px monospace is 6px a character.
const MODEL_TABLE_PX = 675;
const MONO_CHAR_PX = 6;

/** Share of a table (%) a line of `chars` monospace characters needs. */
const charsShare = (chars: number, padPx: number): number =>
  Math.ceil(((chars * MONO_CHAR_PX + padPx) / MODEL_TABLE_PX) * 100);

// A Go pseudo-version: base version, timestamp, commit hash
// (`v1.6.1-0.20230418173708-d852ddb80c63`, the commit a module without a tag
// resolves to).
const GO_PSEUDO_VERSION_RE =
  /^v\d+\.\d+\.\d+-(?:[0-9A-Za-z.]+\.)?\d{14}-[0-9a-f]{12}(?:\+incompatible)?$/u;

/** Whether a version is a Go pseudo-version (GO_PSEUDO_VERSION_RE). */
export const isGoPseudoVersion = (version: string): boolean =>
  GO_PSEUDO_VERSION_RE.test(version);

/**
 * The parts of a Go pseudo-version, in two groups: its base and its
 * timestamp (`v1.6.1-0` `.20230418173708`), then its hash and its
 * `+incompatible` (`-1d1bb5c4787d` `+incompatible`). A line breaks between
 * the groups first: broken after its base, it opened on `v1.6.1` alone,
 * read as a published version, when it names a commit BEFORE it. A group
 * longer than its line breaks between its parts only: a timestamp never
 * between two digits, `+incompatible` never before its last letters
 * (« +incompatib / le »).
 */
export function goPseudoVersionParts(version: string): string[][] {
  const tail = /-[0-9a-f]{12}(?:\+incompatible)?$/u.exec(version);
  if (!tail) return [[version]];
  const head = version.slice(0, tail.index);
  const stamp = head.length - 15;
  const plus = tail[0].indexOf('+');
  return [
    [head.slice(0, stamp), head.slice(stamp)].filter(Boolean),
    plus > 0 ? [tail[0].slice(0, plus), tail[0].slice(plus)] : [tail[0]],
  ];
}

/**
 * Share of a table (%) a column of Go pseudo-versions needs, `max` at most:
 * its base and timestamp on a line (goPseudoVersionParts), its hash on the
 * next one; or, when no column within `max` holds them, its longest part
 * (a timestamp, 15 characters), never broken; 0 when not even that fits, as
 * versionsShare. Never the whole version: 34 characters at least, it took a
 * third of a table from the columns beside it, whose lists then ran two
 * lines on every row.
 */
export function goVersionsShare(
  versions: readonly string[],
  max: number,
  padPx: number,
): number {
  return Math.max(
    0,
    ...versions.map((v) => {
      const [first, ...rest] = goPseudoVersionParts(v);
      const longest = Math.max(
        ...[first, ...rest].flat().map((part) => part.length),
      );
      return (
        [first.join('').length, longest]
          .map((chars) => charsShare(chars, padPx))
          .find((pct) => pct <= max) ?? 0
      );
    }),
  );
}

/**
 * A Go pseudo-version of a list, its comma with it: whole when its column
 * holds it, else broken between its two groups (goPseudoVersionParts), each
 * a block of its own broken between its parts only when longer than a line,
 * in its box as versionItem. The comma goes into the last group: after a
 * block, Chromium would send it alone to the next line.
 */
export function goVersionItem(version: string, comma = false): string {
  const raw = redactSecrets(String(version ?? ''));
  const groups = goPseudoVersionParts(raw);
  return idBox(
    `<span class="id-text is-long">${groups
      .map(
        (parts, i) =>
          `<span class="go-part">${piecesHtml(parts)}${comma && i === groups.length - 1 ? ',' : ''}</span>`,
      )
      .join('<wbr>')}</span>`,
    {},
  );
}

/**
 * Characters of the widest part of a version that never breaks: a version
 * up to LONG_ID_CHARS whole, a longer one its longest part (versionPieces,
 * goPseudoVersionParts), a long hexadecimal run left out (it breaks between
 * its digits, in balanced lines).
 */
export function versionPartChars(version: string): number {
  const v = String(version ?? '');
  const parts = isGoPseudoVersion(v)
    ? goPseudoVersionParts(v).flat()
    : isLongId(v)
      ? versionPieces(v)
      : [v];
  return Math.max(
    0,
    ...parts.map((part) => part.replace(/[0-9a-f]{25,}/giu, '').length),
  );
}

/**
 * Characters a column of versions holds on one line in the preview: the
 * widest part of its versions that never breaks, and the comma after it.
 */
export const versionUnitChars = (versions: readonly string[]): number =>
  Math.max(0, ...versions.filter(Boolean).map((v) => versionPartChars(v) + 1));

/**
 * Share of a table (%) a column of versions needs, `max` at most. A version
 * is atomic: its column holds it whole up to VERSION_WHOLE_CHARS
 * (versionColumnChars), a Debian, Ubuntu or RPM one whatever its length (a
 * jammy-security version runs 35 characters), else, or when no column
 * within `max` holds it whole, its longest part (versionPieces), between
 * which it breaks. A
 * version none of whose parts a column within `max` holds (a hash of 40
 * hexadecimal digits) widens nothing: it breaks anywhere, as a last
 * resort. `padPx`: the padding of a line of the column (the cell's, and a
 * chip's or an indent). 0 without version.
 */
export function versionsShare(
  versions: readonly string[],
  max: number,
  padPx: number,
): number {
  const share = (chars: number): number => charsShare(chars, padPx);
  return Math.max(
    0,
    ...versions
      .filter(Boolean)
      .map(
        (v) =>
          [
            ...(isDistroVersion(v) ? [v.length] : []),
            versionColumnChars([v]),
            Math.max(...versionPieces(v).map((part) => part.length)),
          ]
            .map(share)
            .find((pct) => pct <= max) ?? 0,
      ),
  );
}

/**
 * A package name of a list longer than this (about two thirds of the
 * narrowest list line, a Maven coordinate) flows: kept whole, with its first
 * version, it ran past the page.
 */
const LIST_NAME_FLOW = 48;

/**
 * Entry of a flowing list (package index, triaged packages): the name (text,
 * secrets masked, in a span of `className`) and its versions. A short entry
 * never breaks; a long one keeps its name with its first version and breaks
 * only after a comma, so a line never starts with a version alone, unless
 * that version is long: it then goes to the next line when it does not fit
 * after the name. A name too long for a line flows, broken before its
 * separators, its first version kept with its last part. Every space
 * between two versions is set in their font, in both forms: one entry, one
 * rhythm.
 */
export function listEntry(
  name: string,
  className: string,
  versions: string[],
): string {
  const raw = redactSecrets(String(name ?? ''));
  const flows = raw.length > LIST_NAME_FLOW;
  const nameHtml = `<span class="${className}">${flows ? breakableId(raw) : escapeHtml(raw)}</span>`;
  const list = versions.map(safe);
  const length = raw.length + versions.reduce((n, v) => n + v.length + 2, 0);
  if (!list.length)
    return flows ? nameHtml : `<span class="nw">${nameHtml}</span>`;
  if (length <= 40) {
    return `<span class="nw">${nameHtml} <span class="versions mono">${list.join(', ')}</span></span>`;
  }
  const [first, ...rest] = versions;
  const others = rest.length
    ? `<span class="versions mono"> ${rest
        .map((v, i) => versionItem(v, i < rest.length - 1))
        .join(' ')}</span>`
    : '';
  const comma = rest.length ? ',' : '';
  const head = flows ? nameHtml : `<span class="nw">${nameHtml}</span>`;
  if (isLongId(first)) {
    return `${head} <span class="versions mono">${versionItem(first, !!comma)}</span>${others}`;
  }
  const firstHtml = `<span class="versions mono">${safe(first)}${comma}</span>`;
  // The first version stays with the end of the name (a no-break space).
  return flows
    ? `${nameHtml}&nbsp;${firstHtml}${others}`
    : `<span class="nw">${nameHtml} ${firstHtml}</span>${others}`;
}

/**
 * Title of a table that may continue on the next page: it hides the
 * table's context row on the first page (shared `continuation`). With
 * `columns` (the table's columns after the first, which the title names),
 * it also names them on its own line, each over its column: a table whose
 * header is hidden (several tables in a row, one header each cost a page)
 * keeps named columns, without a line more. The labels are drawn for the
 * eye only: the table's own header names the columns for assistive
 * technologies. The separator stays with the title: a detail sent to the
 * next line never opens it on « · ».
 */
export function tableTitle(
  title: string,
  detail = '',
  columns: { label: string; width: string }[] = [],
): string {
  const text = `${title}${detail ? `<span class="muted">&nbsp;&middot; ${detail}</span>` : ''}`;
  if (!columns.length)
    return `<div class="table-title cont-cover">${text}</div>`;
  return `<div class="table-title cont-cover has-cols"><span class="tt-text">${text}</span>${columns
    .map(
      (c) =>
        `<span class="col-label" aria-hidden="true" style="width: ${escapeHtml(c.width)};">${escapeHtml(c.label)}</span>`,
    )
    .join('')}</div>`;
}

/**
 * Items on flowing lines (package index, triaged packages), separated by a
 * muted middle dot that stays with the item before it: a line never starts
 * with a separator.
 */
export function inlineList(items: string[]): string {
  return items
    .map(
      (html, i) =>
        `<span class="li-item">${html}${i < items.length - 1 ? '<span class="sep">&nbsp;&middot;</span>' : ''}</span>`,
    )
    .join(' ');
}

/** Numeric cell: a muted dash for zero, grouped digits otherwise. */
export function countCell(n: number | null | undefined): string {
  return n ? fmt(n) : EMPTY;
}

/**
 * One bar per row, split by category (severities of an OWASP category, risk
 * levels of a project…), on one shared scale: a bar is as long as its total
 * compared with the largest one, and shows what that total is made of. The
 * total is written at the end of the label line; an `id` (A06, CWE-79) leads
 * the label in monospace, as on the shared bar charts. With `scale: 'row'`,
 * each bar spans the track and shows only what its total is made of (totals
 * too far apart for one scale).
 */
export function splitBars(
  rows: { label: string; id?: string; parts: ChartDatum[] }[],
  opts: { scale?: 'shared' | 'row' } = {},
): string {
  const totals = rows.map((r) =>
    r.parts.reduce((n, p) => n + Math.max(0, p.value), 0),
  );
  const max = Math.max(0, ...totals);
  // Every label starts at the same place: the ids take the longest one's width.
  const idWidth = Math.max(0, ...rows.map((r) => (r.id ?? '').length));
  return `<div class="split-bars">${rows
    .map((r, i) => {
      const of = opts.scale === 'row' ? totals[i] : max;
      const width = of > 0 ? Number(((totals[i] / of) * 100).toFixed(1)) : 0;
      return `<div class="split-row"><div class="split-head"><span class="split-label">${r.id ? `<span class="hbar-id" style="min-width: ${idWidth}ch;">${escapeHtml(r.id)}</span>` : ''}${escapeHtml(r.label)}</span><span class="split-value">${fmt(totals[i])}</span></div><div class="split-track"><div class="split-fill" style="width: ${width}%;">${stackedBar(r.parts)}</div></div></div>`;
    })
    .join('')}</div>`;
}

/** Colour legend of a split chart (only the parts present). */
export function splitLegend(parts: { label: string; color: string }[]): string {
  return `<div class="split-legend">${parts
    .map(
      (p) =>
        `<span><i style="background: ${escapeHtml(p.color)};"></i>${escapeHtml(p.label)}</span>`,
    )
    .join('')}</div>`;
}

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'unknown';
export const SEVERITIES: Severity[] = [
  'critical',
  'high',
  'medium',
  'low',
  'unknown',
];
export const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  unknown: 4,
};

/** Severity bucket of a raw value (`CRITICAL`, `''`, `info`…). */
export function normSeverity(raw: unknown): Severity {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase();
  return (SEVERITIES as string[]).includes(s) ? (s as Severity) : 'unknown';
}

export const emptySeverityCounts = (): Record<Severity, number> => ({
  critical: 0,
  high: 0,
  medium: 0,
  low: 0,
  unknown: 0,
});

/** CSS added by the aggregated reports to the shared design system. */
export const AGGREGATED_CSS = `
  /* Executive summary: the charts centred in panels of equal height, then
     the shared key facts. The reference lists take the key facts' bullet. */
  .ref li { position: relative; padding-left: 13px; list-style: none; }
  .ref li::before { content: ''; position: absolute; left: 1px; top: 0.6em; width: 5px; height: 5px; border-radius: 50%; background: ${COLORS.accent}; }
  .summary-charts { margin-top: 12px; }
  .summary-charts .panel { display: flex; flex-direction: column; }
  .summary-charts .chart-body { flex: 1; display: flex; flex-direction: column; justify-content: center; }
  .summary-charts + .key-facts, .verdict-box + .key-facts { margin-top: 12px; }
  .panel .chart-legend li { padding: 2px 0; }

  /* Split bars: a label and its total over a bar made of its parts, all
     bars on one scale. */
  .split-bars { display: flex; flex-direction: column; gap: 5px; }
  .split-head { display: flex; justify-content: space-between; gap: 10px; font-size: 11px; line-height: 1.3; color: ${COLORS.text}; margin-bottom: 1px; }
  .split-label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  .split-label .hbar-id { display: inline-block; }
  .split-value { font-weight: 600; color: ${COLORS.dark}; font-variant-numeric: tabular-nums; }
  .split-track { height: 8px; border-radius: 4px; background: #eeebf3; overflow: hidden; }
  .split-fill { min-width: 4px; border-radius: 4px; overflow: hidden; }
  .split-fill .stack-bar { border-radius: 0; }
  .split-legend { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-top: 10px; font-size: 10px; color: ${COLORS.textMuted}; }
  .split-legend i { display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 5px; vertical-align: -0.5px; }
  .split-more { margin-top: 6px; }

  /* Compact tables: aggregated reports list many rows. */
  table.compact th, table.compact td { padding: 6px 8px; }
  table.compact td { line-height: 1.4; }
  td .sub { display: block; font-size: 10px; color: ${COLORS.textMuted}; margin-top: 1px; }
  .inline-sub, .inline-sep { font-size: 10px; color: ${COLORS.textMuted}; }
  /* Team and branches of a project: whole on the line of its name, or the
     next one, while they fit a line; wrapped inside the cell otherwise. */
  .inline-sub { display: inline-block; max-width: 100%; white-space: normal; overflow-wrap: anywhere; text-indent: 0; }
  /* Team and long branches of a project under its row, across the table. */
  .project-sub { font-size: 10px; color: ${COLORS.textMuted}; }
  /* A header of two words set on two lines: its column takes the width of
     its counts, not of the two words side by side. */
  th.two-line { white-space: normal; }
  td .sub .chip { vertical-align: 0; margin-right: 1px; }
  .nw { white-space: nowrap; }
  /* A long name (wholeName): it flows like the sentence around it, broken
     before its separators, the mark after it (« . », « : », « , ») kept on
     its last line; a chip beside it aligns on its first line. */
  .nw.is-long { white-space: normal; overflow-wrap: anywhere; }
  /* A group of parts of a Go pseudo-version (goVersionItem): whole on its
     line, or the next one, while it fits a line; broken between its parts
     otherwise. */
  .go-part { display: inline-block; max-width: 100%; }
  .sep { color: ${COLORS.textMuted}; }
  .zero { color: #c3bdcc; }
  .name { color: ${COLORS.dark}; font-weight: 500; }
  tr.is-empty td, tr.is-empty .name { color: ${COLORS.textMuted}; font-weight: 400; }
  tr.total-row td { font-weight: 600; color: ${COLORS.dark}; border-top: 1px solid ${COLORS.border}; background: ${COLORS.subtleBg}; }
  tr:has(+ tr.same-project) td:first-child { border-bottom-color: transparent; }
  /* An id (A03, CWE-79) reads the same everywhere: monospace, as on the
     chart labels. */
  .code { font-family: ${MONO_STACK}; font-size: 10px; font-weight: 500; color: ${COLORS.dark}; }
  /* An identifier reads character by character: no ligature of the
     monospace face (« libstdc++6 » printed one « ++ » glyph). */
  .code-chip, .path, .mono, .id-text, .code { font-variant-ligatures: none; font-feature-settings: "liga" 0, "calt" 0; }
  tr.is-empty .code { color: ${COLORS.textMuted}; }
  .matrix .code { display: inline-block; min-width: 58px; }
  .pkg { font-size: 10px; color: ${COLORS.dark}; }
  .versions { font-size: 10px; color: ${COLORS.textMuted}; }
  .state + .state { margin-top: 2px; }
  td .state { display: flex; }
  .table-note { margin-top: 6px; }
  /* The closing line never stands alone on the last page. */
  .footer { break-before: avoid; }

  /* Title of a table that continues on the next page (shared continuation):
     the repeated label starts where the title does. */
  .table-title { font-size: 11px; font-weight: 600; color: ${COLORS.dark}; margin: 22px 0 0; }
  .table-title .muted { font-weight: 400; }
  .section-head + .table-title { margin-top: 0; }
  table.compact.has-cont .cont-row th { padding-left: 0; padding-right: 0; }
  /* A title naming its columns: each label over its column, where the
     cells' text starts (compact cells), on the baseline of the title, read
     like a column header. The title keeps the gutter of two cells before
     the first label. */
  .table-title.has-cols { display: flex; align-items: baseline; }
  .table-title .tt-text { flex: 1 1 auto; min-width: 0; padding-right: 8px; }
  .table-title .col-label { flex: none; box-sizing: border-box; padding-left: 8px; font-size: 9.5px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: ${COLORS.textSecondary}; white-space: nowrap; }
  .section-intro { break-after: avoid; }
`;

/**
 * CSS the aggregated reports add in the dashboard preview only: a column
 * keeps the floor its template measured on its content (`--preview-min`,
 * columnWidth) when the sheet is narrower than the page; narrower still, a
 * column that yields its share keeps its floor only (a share of 1px). The
 * PDF never reads it: its columns are sized for its page.
 */
export const AGGREGATED_SCREEN_CSS = `
  table.fixed col { min-width: var(--preview-min, 0px); }
  @media (max-width: 820px) { table.fixed col { --narrow-share: 1px; } }
`;
