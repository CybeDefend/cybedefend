// license-template.ts
//
// Aggregated license compliance report: the licenses declared by the
// dependencies of several projects. Ordered by risk (copyleft, then unknown,
// then permissive) and COMPLETE in every format: the permissive packages, the
// bulk of the inventory, are listed in an appendix as a compact index by
// license, ecosystem and name instead of one table row each (the old PDF
// silently kept 10 % of the rows and told the reader to switch format).
//
// The unit is the package (ecosystem + name), counted once whatever the
// number of projects and versions using it, in the most restrictive category
// of its versions, and listed there; its versions in use are listed with it
// and counted apart. A package whose license was accepted during triage
// counts in the package totals only, in no license category (like a triaged
// finding, out of what is left to review), and is listed apart.

import { escapeHtml } from '../../../../core/utils/html-escape';
import {
  aboutSection,
  dataTable,
  emptyState,
  kpiTiles,
  renderCover,
  renderReportDocument,
  sectionHead,
  TableColumn,
} from '../../shared/report-layout';
import {
  breakableId,
  COLORS,
  idPieces,
  isLongId,
  joinShortPieces,
  piecesHtml,
  severityColors,
  typeBadge,
} from '../../shared/report-styles';
import { groupBy, redactSecrets } from '../../shared/report-findings';
import { donutChart } from '../../shared/report-charts';
import {
  AGGREGATED_CSS,
  AGGREGATED_SCREEN_CSS,
  AggregatedReportOptions,
  aggregatedCoverMeta,
  chartPanel,
  columnWidth,
  countCell,
  edgeUnitsJoined,
  flowingTable,
  fmt,
  inlineList,
  keepTogether,
  listEntry,
  nameList,
  plural,
  projectRows as projectRowsOf,
  rowCount,
  safe,
  scopeEyebrow,
  share,
  sharedBranch,
  splitBars,
  splitLegend,
  summaryFacts,
  versionItem,
  versionsShare,
  versionUnitChars,
  WHOLE_TABLE,
  wholeName,
  byVersion,
  goVersionItem,
  goVersionsShare,
  isGoPseudoVersion,
} from './aggregated-common';

export const LICENSE_REPORT_TITLE = 'License compliance report';

interface LicensePackage {
  ecosystem: string;
  packageName: string;
  packageVersion: string;
  licenses: string[];
  licenseExpression: string | null;
  /** Category of this version's license. */
  category: string;
  effectiveLicenses?: string[];
  projects: string[];
  /**
   * The same projects by id (absent from data aggregated before): a name is
   * unique only within its team.
   */
  projectIds?: string[];
  branches: string[];
  isDev: boolean;
  isTransitive: boolean;
  licenseIgnored?: boolean;
}

interface LicenseGroup {
  spdxId: string;
  name: string;
  category: string;
  packages: LicensePackage[];
}

type Category = 'STRONG_COPYLEFT' | 'WEAK_COPYLEFT' | 'UNKNOWN' | 'PERMISSIVE';

/** Most restrictive first: a package is counted in its worst category. */
const CATEGORY_RANK: Record<Category, number> = {
  STRONG_COPYLEFT: 0,
  WEAK_COPYLEFT: 1,
  UNKNOWN: 2,
  PERMISSIVE: 3,
};

const asCategory = (raw: unknown): Category =>
  Object.prototype.hasOwnProperty.call(CATEGORY_RANK, String(raw))
    ? (raw as Category)
    : 'UNKNOWN';

/** One package (ecosystem + name) with every version in use. */
interface PackageRow {
  key: string;
  ecosystem: string;
  name: string;
  versions: string[];
  projects: string[];
  isDev: boolean;
  isTransitive: boolean;
  declared: string;
  licenseIgnored: boolean;
}

// Display names: a readable name when the full one is offensive (its SPDX id
// stays in its own column), typographic quotes in the BSD variants.
const DISPLAY_NAMES: Record<string, string> = {
  WTFPL: 'WTF Public License',
};

function licenseName(group: { spdxId: string; name: string }): string {
  if (DISPLAY_NAMES[group.spdxId]) return DISPLAY_NAMES[group.spdxId];
  return String(group.name || group.spdxId).replace(/"([^"]+)"/g, '“$1”');
}

/** A license the SPDX list does not know is named after its own id. */
const isSpdx = (group: { spdxId: string; name: string }): boolean =>
  Boolean(group.name) && group.name !== group.spdxId;

/** SPDX identifier in monospace, or says that the license has none. */
const spdxHtml = (group: { spdxId: string; name: string }): string =>
  isSpdx(group)
    ? `<span class="mono">${spdxId(group)}</span>`
    : 'Not an SPDX id';

/**
 * An SPDX identifier, secrets masked: a long one (`BSD-3-Clause-No-Nuclear-
 * License-2014`, an exception) breaks before its separators, never after a
 * hyphen.
 */
const spdxId = (group: { spdxId: string }): string =>
  breakableId(redactSecrets(String(group.spdxId ?? '')));

/**
 * The SPDX id under a license name, unless the name is that id (it would
 * repeat it); a license the SPDX list does not know says so, everywhere.
 */
const spdxNote = (group: { spdxId: string; name: string }): string =>
  isSpdx(group) && licenseName(group) === group.spdxId ? '' : spdxHtml(group);

// One definition per category, given once, where the category is listed.
// Unknown is grey (not assessed), distinct from both copyleft colours.
const CATEGORY_META: Record<
  Category,
  { label: string; color: string; definition: string }
> = {
  STRONG_COPYLEFT: {
    label: 'Strong copyleft',
    color: severityColors('critical').solid,
    definition:
      'Software that includes the package may have to be distributed, with its source code, under the same license.',
  },
  WEAK_COPYLEFT: {
    label: 'Weak copyleft',
    color: severityColors('high').solid,
    definition:
      'Changes made to the library itself must be shared under the same license; using it unmodified as a dependency is generally allowed.',
  },
  UNKNOWN: {
    label: 'Unknown',
    color: severityColors('unknown').solid,
    definition:
      'No license is declared, or the declared one is not recognized: check it in the package repository before distributing software that includes the package.',
  },
  PERMISSIVE: {
    label: 'Permissive',
    color: '#12b76a',
    definition:
      'Use, modification and redistribution are allowed, provided the copyright and license notices are kept.',
  },
};

const ECOSYSTEMS: Record<string, string> = {
  npm: 'npm',
  pip: 'PyPI',
  pypi: 'PyPI',
  github_actions: 'GitHub Actions',
  github: 'GitHub Actions',
  maven: 'Maven',
  gradle: 'Maven',
  go: 'Go',
  gomod: 'Go',
  cargo: 'crates.io',
  nuget: 'NuGet',
  gem: 'RubyGems',
  rubygems: 'RubyGems',
  composer: 'Packagist',
  pub: 'Pub',
};

const ecosystemName = (raw: string): string =>
  ECOSYSTEMS[String(raw ?? '').toLowerCase()] ?? String(raw ?? '');

/** Ecosystem as a neutral chip, like a scanner type. */
const ecosystemChip = (raw: string): string => typeBadge(ecosystemName(raw));

/** Version as published, without a requirement operator (`==0.68.0`). */
const cleanVersion = (version: string): string =>
  String(version ?? '').replace(/^\s*(?:==|===)\s*/, '');

/** License a package declares, as written in its manifest (if any). */
const declaredLicense = (p: LicensePackage): string =>
  p.licenseExpression || (p.licenses ?? []).join(', ');

/**
 * Versions in version order (`0.1.9, 0.1.10`; a pre-release before its
 * release, an epoch before a higher major).
 */
const versionList = (versions: Iterable<string>): string[] =>
  Array.from(new Set(Array.from(versions, cleanVersion).filter(Boolean))).sort(
    byVersion,
  );

const packageKey = (p: LicensePackage): string =>
  `${p.ecosystem}\u0000${p.packageName}`;

/**
 * Versions, each one whole, a line breaking only after a comma (a long one
 * breaks before its separators when it does not fit a line).
 */
const versionsHtml = (versions: string[]): string =>
  versions
    .map((v, i) =>
      (isGoPseudoVersion(redactSecrets(v)) ? goVersionItem : versionItem)(
        v,
        i < versions.length - 1,
      ),
    )
    .join(' ');

/** The projects of a package: their ids, or their names in older data. */
type ProjectKeys = (p: LicensePackage) => string[];

const projectNamesOf: ProjectKeys = (p) => p.projects ?? [];

/**
 * How the projects of the scope are counted and named: by id, a name being
 * unique only within its team (two teams may each have a « customer-portal
 * »: counted by name, a license used by both counted one project). A
 * project is named as the Projects table names it: its name, followed by its
 * team when another project of the scope has the same name.
 */
interface ProjectNamer {
  /** Keys of the projects of a package (projectIds, else names). */
  keysOf: ProjectKeys;
  /** Projects of a list, inline, sorted, comma-separated. */
  list: (keys: Iterable<string>) => string;
  /** Projects of a sentence (`a, b and c`, `N projects` beyond three). */
  sentence: (keys: Iterable<string>) => string;
}

function projectNamer(
  rows: { projectId?: string; projectName?: string; teamName?: string }[],
): ProjectNamer {
  const sameName = new Map<string, number>();
  for (const r of rows) {
    sameName.set(r.projectName, (sameName.get(r.projectName) ?? 0) + 1);
  }
  const byId = new Map(
    rows
      .filter((r) => r.projectId)
      .map((r) => [
        r.projectId,
        {
          name: String(r.projectName ?? ''),
          team: sameName.get(r.projectName) > 1 ? String(r.teamName ?? '') : '',
        },
      ]),
  );
  const of = (key: string) => byId.get(key) ?? { name: key, team: '' };
  // In the order of projectNames (code units), then by team.
  const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const sorted = (keys: Iterable<string>) =>
    Array.from(new Set(Array.from(keys).filter(Boolean)))
      .map(of)
      .sort((a, b) => order(a.name, b.name) || order(a.team, b.team));
  // The team after the name, muted, its separator kept with the name; the
  // comma after the last word.
  const named = (p: { name: string; team: string }, after = '') =>
    p.team
      ? `${wholeName(p.name)}<span class="muted"><span class="nw">&nbsp;&middot;</span> ${wholeName(p.team, after)}</span>`
      : wholeName(p.name, after);
  return {
    // Ids the scope does not know (a row without an id): the names.
    keysOf: (p) =>
      p.projectIds?.length && p.projectIds.every((id) => byId.has(id))
        ? p.projectIds
        : projectNamesOf(p),
    list: (keys) => {
      const list = sorted(keys);
      return list
        .map((p, i) => named(p, i < list.length - 1 ? ',' : ''))
        .join(' ');
    },
    sentence: (keys) =>
      nameList(
        sorted(keys).map((p) => named(p)),
        'project',
      ),
  };
}

/**
 * One row per package: its versions listed together, its projects merged
 * (`keysOf`: by id when the data has them). A package counts as a direct /
 * production dependency as soon as one of its versions is used that way.
 */
function packageRows(
  packages: LicensePackage[],
  keysOf: ProjectKeys = projectNamesOf,
): PackageRow[] {
  return groupBy(packages, packageKey).map(({ key, items }) => ({
    key,
    ecosystem: items[0].ecosystem,
    name: items[0].packageName,
    versions: versionList(items.map((p) => p.packageVersion)),
    projects: Array.from(new Set(items.flatMap(keysOf))),
    isDev: items.every((p) => p.isDev),
    isTransitive: items.every((p) => p.isTransitive),
    declared: items.map(declaredLicense).find(Boolean) ?? '',
    licenseIgnored: items.every((p) => p.licenseIgnored),
  }));
}

/** Most exposed first, in the order of the summary chart. */
const byImportance = (a: PackageRow, b: PackageRow) =>
  dependencyRank(a) - dependencyRank(b) || a.name.localeCompare(b.name);

/** `Direct · production`: the words of the summary chart, in one colour. */
const dependencyKind = (p: PackageRow): string =>
  `${p.isTransitive ? 'Transitive' : 'Direct'} &middot; ${p.isDev ? 'development' : 'production'}`;

/** `2 packages · 3 versions` (versions only when they differ). */
function packagesAndVersions(packages: LicensePackage[]): string {
  const names = new Set(packages.map(packageKey)).size;
  const versions = new Set(
    packages.map(
      (p) => `${packageKey(p)}\u0000${cleanVersion(p.packageVersion)}`,
    ),
  ).size;
  return versions > names
    ? `${plural(names, 'package')} · ${plural(versions, 'version')}`
    : plural(names, 'package');
}

// A line of the Package column: Rubik 11px medium, about 5.9px a character
// of an identifier; an ecosystem chip, 5px a character of its 9.5px label
// and its padding (2 x 6px), after a space. The column of a table of 675px
// (688px printed), its cell padding (2 x 8px) left out.
const NAME_CHAR_PX = 5.9;
const CHIP_CHAR_PX = 5;
const CHIP_PAD_PX = 3 + 12;
const packageLinePx = (pct: number): number => (675 * pct) / 100 - 16;

/**
 * A short identifier (a package name, a `LicenseRef-…`): breakable only
 * before its separators, a hyphen kept with the character after it (in a
 * narrow column Chromium broke after it: « LicenseRef- | ImageMagick »,
 * read as a hyphenated word). A long one as breakableId.
 */
const shortIdHtml = (raw: string): string =>
  isLongId(raw)
    ? breakableId(raw)
    : piecesHtml(joinShortPieces(raw.split(/(?=[-._/@+~])/).filter(Boolean)));

/**
 * Package name and its ecosystem chip, the Package column `pct` % wide. A
 * long name (a NuGet or Maven coordinate, a Go module) breaks before its
 * separators, never inside a word; its chip stays with its last part when
 * both fit a line, and goes to the next line otherwise (glued, the part
 * broke inside a word: « …IntegrationTestsSuppor | t »).
 */
function packageName(p: PackageRow, pct: number): string {
  const chip = ecosystemChip(p.ecosystem);
  const name = redactSecrets(p.name);
  if (!isLongId(name))
    return `<span class="name">${shortIdHtml(name)}</span> ${chip}`;
  const last = idPieces(name).pop() ?? '';
  const fits =
    last.length * NAME_CHAR_PX +
      ecosystemName(p.ecosystem).length * CHIP_CHAR_PX +
      CHIP_PAD_PX <=
    packageLinePx(pct);
  return `<span class="name">${breakableId(name)}</span>${fits ? '&nbsp;' : ' '}${chip}`;
}

/**
 * A Versions column never narrower than this (%), nor the Package column
 * beside it than PACKAGE_MIN: a name of 24 characters and its chip hold a
 * line of it.
 */
const VERSIONS_MIN = 14;
const PACKAGE_MIN = 25;
// The cell padding of a line of versions (2 x 8px).
const VERSION_CELL_PX = 16;

/** A column after the Versions column: its width and its floor (%). */
interface GivingColumn {
  width: number;
  floor: number;
}

/**
 * Widths (%) of a Versions column and of the columns after it (`others`,
 * in the order they give it room). A version is atomic: the column holds
 * every version whole (a short one has no break at all, a Debian one never
 * breaks in its revision), from 14 % up to what the Package column (25 %
 * at least) and the others, down to their floors, leave; the others give
 * it that room in their order. A version the column cannot hold whole
 * breaks between its parts; a Go pseudo-version, sized up to its hash
 * (goVersionsShare), breaks before it only, never after its base.
 */
function versionColumns(
  versions: string[],
  others: GivingColumn[],
): { versions: number; others: number[] } {
  const floors = others.reduce((n, c) => n + c.floor, 0);
  const max = 100 - PACKAGE_MIN - floors;
  const width = Math.max(
    VERSIONS_MIN,
    versionsShare(
      versions.filter((v) => !isGoPseudoVersion(v)),
      max,
      VERSION_CELL_PX,
    ),
    goVersionsShare(versions.filter(isGoPseudoVersion), max, VERSION_CELL_PX),
  );
  let over =
    width + PACKAGE_MIN + others.reduce((n, c) => n + c.width, 0) - 100;
  return {
    versions: width,
    others: others.map((c) => {
      const give = Math.max(0, Math.min(over, c.width - c.floor));
      over -= give;
      return c.width - give;
    }),
  };
}

function packageTable(
  packages: LicensePackage[],
  withDeclared: boolean,
  continuation: string,
  projects: ProjectNamer,
): string {
  const listed = packageRows(packages, projects.keysOf).sort(byImportance);
  // With the declared license, the dependency kind (« Transitive ·
  // development ») still holds on a line, and two short project names too;
  // a long version takes from the declared license, then the projects,
  // then the dependency kind.
  const cols = versionColumns(
    listed.flatMap((p) => p.versions.map(redactSecrets)),
    [
      ...(withDeclared ? [{ width: 16, floor: 14 }] : []),
      { width: withDeclared ? 24 : 26, floor: 18 },
      { width: withDeclared ? 21 : 22, floor: 19 },
    ],
  );
  const [projectsPct, dependency] = cols.others.slice(-2);
  const declared = withDeclared ? cols.others[0] : 0;
  const pkgPct = 100 - cols.versions - declared - dependency - projectsPct;
  const rows = listed.map((p) => [
    packageName(p, pkgPct),
    `<span class="versions mono">${versionsHtml(p.versions)}</span>`,
    // A declared license that is an identifier (`LicenseRef-…`) breaks
    // before its separators.
    ...(withDeclared
      ? [
          p.declared
            ? `<span class="versions mono">${shortIdHtml(redactSecrets(p.declared))}</span>`
            : '<span class="muted">None declared</span>',
        ]
      : []),
    dependencyKind(p),
    projects.list(p.projects),
  ]);
  return flowingTable({
    className: 'compact pkg-table',
    columns: [
      { label: 'Package' },
      {
        label: 'Versions',
        width: columnWidth(cols.versions, {
          preview: versionsFloor(listed.flatMap((p) => p.versions)),
        }),
      },
      // Narrowed for a long version, its header takes two lines.
      ...(withDeclared
        ? [
            {
              label: 'Declared license',
              width: `${declared}%`,
              className: declared < 16 ? 'two-line' : undefined,
            },
          ]
        : []),
      { label: 'Dependency', width: `${dependency}%` },
      { label: 'Projects', width: `${projectsPct}%` },
    ],
    rows,
    count: rows.length,
    continuation,
  });
}

/**
 * The room (px) a Versions column needs in the preview, whose sheet is
 * narrower than the page: its widest part that never breaks (a short
 * version whole, a timestamp of a Go pseudo-version, `+incompatible`) and
 * its comma, in the cell padding. « .20230418173708 » broke between two
 * digits in a preview of 850px.
 */
const versionsFloor = (versions: string[]): number =>
  versionUnitChars(versions.map(redactSecrets)) * 6 + VERSION_CELL_PX;

// ── Package index (appendix) ────────────────────────────────────────────────

/** Most entries on one index row (about four lines): rows stay short. */
const INDEX_ROW_MAX = 24;
/** Fewest entries on a row (the last one excepted when the list is short). */
const INDEX_ROW_MIN = 14;

/** Length of the shortest prefix of `a` that is not a prefix of `b`. */
function distinctLength(a: string, b: string): number {
  let k = 0;
  while (k < a.length && k < b.length && a[k] === b[k]) k++;
  return Math.min(a.length, k + 1);
}

/**
 * Prefix of a name, never ending on a separator (`p-` would read `p-–pe`
 * before the range dash): it then takes one more character.
 */
function guidePrefix(name: string, length: number): string {
  let end = Math.max(1, length);
  while (end < name.length && /[-._/@]/.test(name.charAt(end - 1))) end++;
  return name.slice(0, end);
}

/**
 * Guide words of an index row, as in a dictionary: the shortest prefix of
 * its first name that tells it from the previous row's last one, and of its
 * last name that tells it from the next row's first one (and from its own
 * first one). Consecutive rows never overlap: `is-d–is-po`, `is-pr–isstream`.
 */
function guideLabel(
  first: string,
  last: string,
  prevLast?: string,
  nextFirst?: string,
): string {
  const a = first.toLowerCase();
  const z = last.toLowerCase();
  // A list of one row tells nothing apart: its initials only (`c–u`, never
  // the whole names it lists; `f` for a single package), unless several
  // packages share one: a lone `a` reads like an enumeration, so both ends
  // take what tells them apart (`actions/c–actions/u`). The first row of a
  // longer list has no neighbour before it: its first word is as long as
  // its last needs to be (`ia–ih`, not `i–ih`).
  const alone = !prevLast && !nextFirst;
  const initials = alone && (a === z || a.charAt(0) !== z.charAt(0));
  const start = guidePrefix(
    a,
    initials
      ? 1
      : prevLast
        ? distinctLength(a, prevLast.toLowerCase())
        : distinctLength(a, z),
  );
  if (a === z) return start;
  const end = guidePrefix(
    z,
    initials
      ? 1
      : Math.max(
          nextFirst ? distinctLength(z, nextFirst.toLowerCase()) : 1,
          distinctLength(z, a),
        ),
  );
  return start === end ? start : `${start}–${end}`;
}

/**
 * Rows of an index: packages in alphabetical order, `INDEX_ROW_MIN` to
 * `INDEX_ROW_MAX` entries each (so a row never has to break across pages).
 * A row ends where the next name differs soonest from the last one (a new
 * initial first), which keeps the guide words short; a short last row joins
 * the one before. Each row is labelled by its guide words.
 */
function indexRows<T extends { name: string }>(
  items: T[],
): { label: string; items: T[] }[] {
  const sorted = [...items].sort((a, b) => a.name.localeCompare(b.name));
  const names = sorted.map((i) => i.name.toLowerCase());
  // How long the guide words at a boundary before `i` would be.
  const cost = (i: number) =>
    Math.max(
      distinctLength(names[i], names[i - 1]),
      distinctLength(names[i - 1], names[i]),
    );
  const rows: T[][] = [];
  let from = 0;
  while (from < sorted.length) {
    const left = sorted.length - from;
    // A few entries more rather than a last row of a few entries.
    let size = left;
    if (left > INDEX_ROW_MAX + 4) {
      let best = 0;
      for (let n = INDEX_ROW_MAX; n >= INDEX_ROW_MIN; n--) {
        // Never leave fewer entries than a row's minimum behind (the
        // longest row allowed is no exception).
        if (left - n < INDEX_ROW_MIN) continue;
        if (!best || cost(from + n) < cost(from + best)) best = n;
      }
      size = best;
    }
    rows.push(sorted.slice(from, from + size));
    from += size;
  }
  return rows.map((r, i) => ({
    label: guideLabel(
      r[0].name,
      r[r.length - 1].name,
      rows[i - 1]?.[rows[i - 1].length - 1]?.name,
      rows[i + 1]?.[0]?.name,
    ),
    items: r,
  }));
}

/** Versions of each package under each license it is listed under. */
type LicensesOf = ReadonlyMap<string, ReadonlyMap<string, ReadonlySet<string>>>;

/**
 * What the index notes need: the licenses of each package, and which of
 * their ids are SPDX ones (set in monospace, like everywhere else).
 */
interface IndexNotes {
  licensesOf: LicensesOf;
  spdxIds: ReadonlySet<string>;
}

/** A license id in a note: monospace when SPDX, a plain name otherwise. */
const noteId = (id: string, notes: IndexNotes): string =>
  notes.spdxIds.has(id) ? `<span class="mono">${safe(id)}</span>` : safe(id);

/** Versions named by a note, in monospace like every version. */
const noteVersions = (versions: Iterable<string>): string =>
  `<span class="mono">${Array.from(versions, safe).join(', ')}</span>`;

/**
 * Index entry: `accepts 1.3.5`, then the other licenses the package is
 * listed under: `also ISC` when they cover the versions listed (a dual
 * license), `(1.0.0 under ISC)` when the license changes with the version,
 * the other versions named. A short entry never breaks; a long one keeps
 * its name with its first version, and the note stays with the last one.
 */
function indexEntry(p: PackageRow, spdxId: string, index: IndexNotes): string {
  const also: string[] = [];
  const elsewhere: string[] = [];
  const byLicense =
    index.licensesOf.get(p.key) ?? new Map<string, Set<string>>();
  for (const [id, versions] of Array.from(byLicense).sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    if (id === spdxId) continue;
    const shared = p.versions.filter((v) => versions.has(v));
    if (shared.length === p.versions.length) also.push(noteId(id, index));
    else if (shared.length === 0) {
      elsewhere.push(
        `${noteVersions(versionList(versions))} under ${noteId(id, index)}`,
      );
    } else {
      also.push(`${noteId(id, index)} (${noteVersions(shared)})`);
    }
  }
  const notes = [
    also.length ? `also ${also.join(', ')}` : '',
    elsewhere.length ? `(${elsewhere.join('; ')})` : '',
  ].filter(Boolean);
  return `<span class="pi">${listEntry(p.name, 'pn', p.versions)}${notes
    .map((n) => `&nbsp;<span class="also nw">${n}</span>`)
    .join('')}</span>`;
}

/**
 * Index of the packages of one license: one table per ecosystem, its rows
 * of packages labelled by guide words, each package once with all its
 * versions. With several ecosystems, each one opens on a heading of one
 * form, the first one included: its chip, then the license and its count,
 * so that a heading opening a page names its list (the first one, which
 * never leaves the license heading right above it, gives only its count);
 * with a single one, the license heading carries the chip. The heading
 * hides the table's context row (`MIT License · npm · continued`). Every
 * row has its guide words, a one-row list included: the packages of every
 * license start at one edge.
 */
function packageIndex(group: LicenseGroup, notes: IndexNotes): string {
  const byEcosystem = groupBy(packageRows(group.packages), (p) =>
    ecosystemName(p.ecosystem),
  )
    .sort(
      (a, b) => b.items.length - a.items.length || a.key.localeCompare(b.key),
    )
    .map((eco) => ({ ...eco, index: indexRows(eco.items) }));
  const single = byEcosystem.length === 1;
  const heading = single
    ? licenseHead(group, { covers: 'index', chip: byEcosystem[0].key })
    : licenseHead(group, { covers: false });
  return `${heading}${byEcosystem
    .map((eco, e) => {
      const rows = eco.index.map((r) => [
        guideHtml(r.label),
        inlineList(r.items.map((p) => indexEntry(p, group.spdxId, notes))),
      ]);
      const count = packagesAndVersions(
        group.packages.filter((p) => ecosystemName(p.ecosystem) === eco.key),
      );
      const head = single
        ? ''
        : `<div class="eco-head cont-cover index-cover">${typeBadge(eco.key)} <span class="eco-name">${e > 0 ? `${escapeHtml(licenseName(group))} · ` : ''}${count}</span></div>`;
      return `${head}${dataTable({
        className: 'compact inventory-index',
        columns: [
          { label: '', width: '12%' },
          { label: 'Packages and versions' },
        ],
        rows,
        continuation: `${licenseName(group)} · ${eco.key} · continued`,
      })}`;
    })
    .join('')}`;
}

/**
 * Guide words around a spaced range dash, which never reads as the hyphen
 * of a name (`is-d – is-p`); breakable after the dash only.
 */
const guideHtml = (label: string): string =>
  `<span class="initial">${label
    .split('–')
    .map(
      (part, i, all) =>
        `<span class="nw">${escapeHtml(part)}${i < all.length - 1 ? ' –' : ''}</span>`,
    )
    .join(' ')}</span>`;

/** Licenses with this many packages or fewer share one index table. */
const SMALL_LICENSE = 10;

/** One row per small license: its packages, by ecosystem. */
function smallLicensesIndex(groups: LicenseGroup[], notes: IndexNotes): string {
  const rows = groups.map((g) => {
    const byEcosystem = groupBy(packageRows(g.packages), (p) =>
      ecosystemName(p.ecosystem),
    );
    const sub = [spdxNote(g), packagesAndVersions(g.packages)]
      .filter(Boolean)
      .join(' &middot; ');
    return [
      `<span class="name">${escapeHtml(licenseName(g))}</span><span class="sub">${sub}</span>`,
      byEcosystem
        .map(
          (eco) =>
            `<div class="eco-line">${typeBadge(eco.key)} ${inlineList(
              eco.items
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((p) => indexEntry(p, g.spdxId, notes)),
            )}</div>`,
        )
        .join(''),
    ];
  });
  return dataTable({
    className: 'compact inventory-index small-licenses',
    columns: [
      { label: 'License', width: '30%' },
      { label: 'Packages and versions' },
    ],
    rows,
    continuation: 'Other permissive licenses · continued',
  });
}

export const LICENSE_CSS = `
  .inventory-index td { font-size: 10px; line-height: 1.5; }
  .inventory-index .initial { font-weight: 600; color: ${COLORS.accent}; overflow-wrap: anywhere; }
  .inventory-index .versions { font-size: 10px; }
  /* An ecosystem of a license: its heading, then its rows. The heading
     names the list, so the index repeats no column header ("Packages and
     versions" on every ecosystem); its context row still names the
     license and the ecosystem on the pages it continues on. */
  .license-head:not(.cont-cover) { break-after: avoid; }
  /* A heading sits closer to its rows than to the rows above it: the
     context row it hides is shorter than the shared one, and the first row
     starts right under it. */
  .eco-head { margin-top: 24px; font-size: 10px; }
  .license-head + .eco-head { margin-top: 6px; }
  .eco-name { font-weight: 500; color: ${COLORS.textSecondary}; margin-left: 2px; }
  .index-cover.cont-cover { padding-bottom: 12px; min-height: 12px; }
  .index-cover + table.inventory-index { margin-top: -12px; }
  table.inventory-index:not(.small-licenses) .cont-row th { height: 12px; line-height: 11px; padding-bottom: 1px; }
  table.inventory-index:not(.small-licenses) tbody:first-of-type > tr:first-child td { padding-top: 0; }
  .inventory-index:not(.small-licenses) thead tr:not(.cont-row) { display: none; }
  /* An index row runs several lines and its heading travels with the first
     one: that row may end a page alone (the shared rule keeps a one-line
     first row with the next one). */
  table.inventory-index:not(.small-licenses) tbody:first-of-type > tr:first-child + tr { break-before: auto; }
  /* The shares of the packages to review would read against the tiles'
     shares of all packages: the legend gives the counts only. */
  .review-donut .legend-pct { display: none; }
  .small-licenses td:first-child { font-size: 11px; line-height: 1.4; }
  .eco-line + .eco-line { margin-top: 3px; }
  .eco-line .chip { margin-right: 2px; }
  .pn { color: ${COLORS.text}; }
  .also { font-size: 9.5px; color: ${COLORS.textMuted}; }
  td .chip { vertical-align: 0.5px; }
  .license-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin: 22px 0 0; }
  .section-intro + .license-head, h3 + .section-intro + .license-head { margin-top: 0; }
  .license-head .title { font-size: 11px; font-weight: 600; color: ${COLORS.dark}; }
  .license-head .meta { font-size: 10px; color: ${COLORS.textMuted}; white-space: nowrap; }
  .appendix { break-before: page; }
  /* A margin survives a forced page break: the appendix opens at the top
     of its page, like the others; the preview keeps the space. */
  @media print { .appendix { margin-top: 0; } }
  .appendix .section-intro { break-after: avoid; }
  h3 + .section-intro { margin-top: 0; }
  /* In the appendix, a new license (level 1) has clearly more air than a
     new ecosystem of it (level 2): on a dense index page, the licenses read
     as blocks. The first one, under the intro, keeps none. */
  .appendix .license-head { margin-top: 34px; }
  .appendix .section-intro + .license-head { margin-top: 0; }
`;

/** The dashboard preview has a larger body: the index follows it. */
const LICENSE_SCREEN_CSS = `
  .inventory-index td, .inventory-index .versions { font-size: 11px; }
`;

/**
 * `; production dependencies come first, direct before transitive`: the
 * order of the list (the summary chart's), as far as the list tells the
 * kinds apart.
 */
function orderNote(rows: PackageRow[]): string {
  const splits = (is: (p: PackageRow) => boolean) =>
    rows.some(is) && !rows.every(is);
  const byUse = splits((p) => p.isDev);
  const byDepth = splits((p) => p.isTransitive);
  if (byUse && byDepth) {
    return '; production dependencies come first, direct before transitive';
  }
  if (byUse) return '; production dependencies come first';
  return byDepth ? '; direct dependencies come first' : '';
}

function reviewIntro(rows: PackageRow[], anyDeclared: boolean): string {
  if (rows.length === 1) {
    return `This package declares ${anyDeclared ? 'a license that is not recognized' : 'no license'}. Check its license in the package repository before distributing software that includes it.`;
  }
  return `${
    anyDeclared
      ? 'These packages declare no license, or one that is not recognized.'
      : 'None of these packages declares a license.'
  } Check their license in the package repository before distributing software that includes them${orderNote(rows)}.`;
}

/**
 * Heading of a license: name, SPDX id, packages and versions (the count
 * left to the section when the license is its only one). It `covers` the
 * table right below (it hides the table's context row; `index`: the shorter
 * one of an index), unless ecosystem headings come in between; a `chip`
 * names the ecosystem of an index that has a single one.
 */
function licenseHead(
  group: LicenseGroup,
  opts: { covers?: boolean | 'index'; chip?: string; counted?: boolean } = {},
): string {
  const { covers = true, chip, counted = true } = opts;
  const meta = [
    spdxNote(group),
    counted ? packagesAndVersions(group.packages) : '',
  ]
    .filter(Boolean)
    .join(' &middot; ');
  const cls = `license-head${covers ? ' cont-cover' : ''}${covers === 'index' ? ' index-cover' : ''}`;
  return `<div class="${cls}"><span class="title">${escapeHtml(licenseName(group))}${chip ? ` ${typeBadge(chip)}` : ''}</span><span class="meta">${meta}</span></div>`;
}

/** `, both direct production dependencies of billing-service`. */
function dependencyDetail(rows: PackageRow[], people: ProjectNamer): string {
  const n = rows.length;
  const direct = rows.filter((p) => !p.isTransitive && !p.isDev);
  const projects = people.sentence(direct.flatMap((p) => p.projects));
  if (direct.length === n) {
    if (n === 1) return `, a direct production dependency of ${projects}`;
    return `, ${n === 2 ? 'both' : 'all'} direct production dependencies of ${projects}`;
  }
  if (direct.length > 0) {
    return `; ${fmt(direct.length)} of them ${direct.length === 1 ? 'is a direct production dependency' : 'are direct production dependencies'} (${projects})`;
  }
  return n === 1
    ? '; it is a transitive or development dependency'
    : '; all are transitive or development dependencies';
}

/** `; 2 are direct production dependencies, 1 a direct development dependency`. */
function directDetail(rows: PackageRow[]): string {
  const prod = rows.filter((p) => !p.isTransitive && !p.isDev).length;
  const dev = rows.filter((p) => !p.isTransitive && p.isDev).length;
  const kind = (n: number, what: string) =>
    n === 1 ? `a direct ${what} dependency` : `direct ${what} dependencies`;
  const parts: string[] = [];
  if (prod) {
    parts.push(
      `${fmt(prod)} ${prod === 1 ? 'is' : 'are'} ${kind(prod, 'production')}`,
    );
  }
  if (dev) {
    parts.push(
      prod
        ? `${fmt(dev)} ${kind(dev, 'development')}`
        : `${fmt(dev)} ${dev === 1 ? 'is' : 'are'} ${kind(dev, 'development')}`,
    );
  }
  return parts.length ? `; ${parts.join(', ')}` : '';
}

/** Dependency types of the packages to review, most exposed first. */
const DEPENDENCY_TYPES: {
  label: string;
  match: (p: PackageRow) => boolean;
}[] = [
  { label: 'Direct · production', match: (p) => !p.isTransitive && !p.isDev },
  {
    label: 'Transitive · production',
    match: (p) => p.isTransitive && !p.isDev,
  },
  { label: 'Direct · development', match: (p) => !p.isTransitive && p.isDev },
  {
    label: 'Transitive · development',
    match: (p) => p.isTransitive && p.isDev,
  },
];

const dependencyRank = (p: PackageRow): number =>
  DEPENDENCY_TYPES.findIndex((t) => t.match(p));

const REVIEW: Category[] = ['STRONG_COPYLEFT', 'WEAK_COPYLEFT', 'UNKNOWN'];

export function renderLicenseReport(
  options: AggregatedReportOptions,
  forPdf: boolean,
): string {
  const data = options.aggregatedData ?? {};
  const summary = data.summary ?? {};
  const byCategory = summary.byCategory ?? {};
  const groups: Record<string, LicenseGroup[]> = data.categories ?? {};
  const packages: LicensePackage[] = data.packages ?? [];
  const projectRows: any[] = data.projectRows ?? [];
  // Projects counted and named by id, with their team beside a namesake.
  const people = projectNamer(projectRows);
  const total =
    Number(summary.totalPackages) || new Set(packages.map(packageKey)).size;
  const versions = Number(summary.totalVersions) || packages.length;
  const nProjects = options.projectIds?.length ?? projectRows.length;
  const withInventory = projectRows.filter((r) => r.packages > 0);
  const branches = Array.from(
    new Set(packages.flatMap((p) => p.branches ?? [])),
  ).sort();
  const detailed = options.detailed !== false;

  // A package is counted and listed in the most restrictive category of its
  // versions (as the aggregation counts it).
  const categoryOf = new Map<string, Category>();
  for (const p of packages) {
    const c = asCategory(p.category);
    const known = categoryOf.get(packageKey(p));
    if (!known || CATEGORY_RANK[c] < CATEGORY_RANK[known]) {
      categoryOf.set(packageKey(p), c);
    }
  }
  const inCategory = (c: Category) =>
    packages.filter((p) => categoryOf.get(packageKey(p)) === c);

  // Licenses accepted during triage: in the package totals only, in no
  // license category, listed apart.
  const acceptedRows = REVIEW.flatMap((k) =>
    packageRows(inCategory(k), people.keysOf).filter((p) => p.licenseIgnored),
  );
  const accepted = new Set(acceptedRows.map((p) => p.key));
  const toReview = (c: Category) =>
    inCategory(c).filter((p) => !accepted.has(packageKey(p)));
  const acceptedIn = (c: Category) =>
    new Set(
      inCategory(c)
        .map(packageKey)
        .filter((k) => accepted.has(k)),
    ).size;
  const counts: Record<Category, number> = {
    PERMISSIVE: Number(byCategory.permissive) || 0,
    WEAK_COPYLEFT:
      (Number(byCategory.weakCopyleft) || 0) - acceptedIn('WEAK_COPYLEFT'),
    STRONG_COPYLEFT:
      (Number(byCategory.strongCopyleft) || 0) - acceptedIn('STRONG_COPYLEFT'),
    UNKNOWN: (Number(byCategory.unknown) || 0) - acceptedIn('UNKNOWN'),
  };
  // The same packages out of the counts of each project: each at its most
  // restrictive version in that project, as the aggregation counts it (a
  // project counted 5 strong copyleft packages, the organization 3). A
  // project is its id, as the aggregation counts it: a name is unique only
  // within its team, and two « customer-portal » lost each other's packages
  // (« -2 »). Data without ids places a package by name, only where the
  // name is one project's.
  const rowKey = (row: { projectId?: string; projectName?: string }) =>
    row.projectId || row.projectName;
  const keysByName = new Map<string, string[]>();
  for (const row of projectRows) {
    keysByName.set(row.projectName, [
      ...(keysByName.get(row.projectName) ?? []),
      rowKey(row),
    ]);
  }
  const projectKeys = (p: LicensePackage): string[] =>
    p.projectIds?.length
      ? p.projectIds
      : (p.projects ?? []).flatMap((name) => {
          const keys = keysByName.get(name) ?? [];
          return keys.length === 1 ? keys : [];
        });
  const acceptedByProject = new Map<string, Map<string, Category>>();
  for (const p of packages) {
    if (!accepted.has(packageKey(p))) continue;
    for (const project of projectKeys(p)) {
      const inProject = acceptedByProject.get(project) ?? new Map();
      const known = inProject.get(packageKey(p));
      const c = asCategory(p.category);
      if (!known || CATEGORY_RANK[c] < CATEGORY_RANK[known]) {
        inProject.set(packageKey(p), c);
      }
      acceptedByProject.set(project, inProject);
    }
  }
  const projectCount = (
    row: {
      projectId?: string;
      projectName?: string;
      byCategory?: Record<string, number>;
    },
    c: Category,
    field: string,
  ): number =>
    Math.max(
      0,
      (Number(row.byCategory?.[field]) || 0) -
        Array.from(acceptedByProject.get(rowKey(row))?.values() ?? []).filter(
          (k) => k === c,
        ).length,
    );

  // Every license each package is listed under, with the versions under it
  // (the other ones are named in the index).
  const licensesOf = new Map<string, Map<string, Set<string>>>();
  const spdxIds = new Set<string>();
  for (const list of Object.values(groups)) {
    for (const g of list ?? []) {
      if (isSpdx(g)) spdxIds.add(g.spdxId);
      for (const p of g.packages ?? []) {
        const byLicense =
          licensesOf.get(packageKey(p)) ?? new Map<string, Set<string>>();
        const versions = byLicense.get(g.spdxId) ?? new Set<string>();
        versions.add(cleanVersion(p.packageVersion));
        byLicense.set(g.spdxId, versions);
        licensesOf.set(packageKey(p), byLicense);
      }
    }
  }
  const notes: IndexNotes = { licensesOf, spdxIds };

  // The licenses of a category's packages to review: each with only the
  // packages counted in that category and not accepted during triage.
  const licensesToReview = (k: Category) =>
    (groups[k] ?? [])
      .map((g) => ({
        ...g,
        packages: g.packages.filter(
          (p) =>
            categoryOf.get(packageKey(p)) === k && !accepted.has(packageKey(p)),
        ),
      }))
      .filter((g) => g.packages.length > 0);

  // ── Cover ──
  const cover = renderCover({
    eyebrow: `${scopeEyebrow(options.scopeType)} · Open-source licenses`,
    title: LICENSE_REPORT_TITLE,
    subtitle:
      withInventory.length < nProjects
        ? `Licenses declared by the dependencies of ${fmt(withInventory.length)} of ${plural(nProjects, 'project')}`
        : `Licenses declared by the dependencies of ${plural(nProjects, 'project')}`,
    meta: aggregatedCoverMeta(options, { branches }),
  });

  // ── Executive summary ──
  // Both copyleft kinds share one tile: the caption details them and the
  // colour follows the strongest one present. The tiles add up to the total.
  const copyleft = counts.STRONG_COPYLEFT + counts.WEAK_COPYLEFT;
  const reviewRows = new Map(
    REVIEW.map((k) => [k, packageRows(toReview(k), people.keysOf)]),
  );
  const unknownDirect = (reviewRows.get('UNKNOWN') ?? []).filter(
    (p) => !p.isTransitive,
  ).length;
  // A tile caption is text (the tile escapes it): « <1% », not HTML.
  const shareText = (part: number) => share(part, total).replace('&lt;', '<');
  // Like the other captions: the share of the packages, then the detail.
  const copyleftCaption =
    counts.STRONG_COPYLEFT && counts.WEAK_COPYLEFT
      ? `${fmt(counts.WEAK_COPYLEFT)} weak · ${fmt(counts.STRONG_COPYLEFT)} strong`
      : copyleft
        ? `${shareText(copyleft)} · ${counts.STRONG_COPYLEFT ? 'strong' : 'weak'} copyleft`
        : undefined;
  const tiles = kpiTiles(
    [
      {
        label: 'Packages',
        value: fmt(total),
        caption: `in ${fmt(withInventory.length)} of ${plural(nProjects, 'project')}`,
      },
      {
        label: 'Permissive',
        value: fmt(counts.PERMISSIVE),
        tone: 'success',
        caption: total
          ? `${shareText(counts.PERMISSIVE)} of packages`
          : undefined,
      },
      {
        label: 'Copyleft',
        value: fmt(copyleft),
        severity: counts.STRONG_COPYLEFT > 0 ? 'critical' : 'high',
        caption: copyleftCaption,
      },
      {
        label: 'Unknown',
        value: fmt(counts.UNKNOWN),
        severity: 'unknown',
        caption: counts.UNKNOWN
          ? [
              shareText(counts.UNKNOWN),
              unknownDirect ? `${fmt(unknownDirect)} direct` : '',
            ]
              .filter(Boolean)
              .join(' · ')
          : undefined,
      },
      ...(accepted.size
        ? [
            {
              label: 'Accepted',
              value: fmt(accepted.size),
              muteZero: true,
              caption: 'during triage',
            },
          ]
        : []),
    ],
    { leadWidth: 1.4 },
  );
  // What needs a look: the donut shows the packages to review; with none,
  // the categories present.
  const reviewTotal = REVIEW.reduce((n, k) => n + counts[k], 0);
  const ORDER: Category[] = [
    'PERMISSIVE',
    'WEAK_COPYLEFT',
    'STRONG_COPYLEFT',
    'UNKNOWN',
  ];
  const donutKeys = reviewTotal
    ? REVIEW.filter((k) => counts[k] > 0)
    : ORDER.filter((k) => counts[k] > 0);
  const donut = donutChart(
    donutKeys.map((k) => ({
      label: CATEGORY_META[k].label,
      value: counts[k],
      color: CATEGORY_META[k].color,
    })),
    { centerLabel: reviewTotal ? 'to review' : 'packages' },
  );
  const donutHtml = reviewTotal
    ? `<div class="review-donut">${donut}</div>`
    : donut;
  const byType = DEPENDENCY_TYPES.map((t) => ({
    label: t.label,
    parts: REVIEW.map((k) => ({
      label: CATEGORY_META[k].label,
      value: (reviewRows.get(k) ?? []).filter(t.match).length,
      color: CATEGORY_META[k].color,
    })),
  })).filter((r) => r.parts.some((p) => p.value > 0));
  // The colours are the donut's, named again under the bars.
  const present = REVIEW.filter((k) =>
    byType.some((r) =>
      r.parts.some((p) => p.label === CATEGORY_META[k].label && p.value > 0),
    ),
  );
  const reviewChart = byType.length
    ? `${splitBars(byType)}${splitLegend(present.map((k) => CATEGORY_META[k]))}`
    : emptyState('No package to review.');

  const facts: string[] = [];
  if (total > 0) {
    if (copyleft === 0) {
      facts.push('No copyleft license in the dependencies.');
    } else {
      for (const k of ['STRONG_COPYLEFT', 'WEAK_COPYLEFT'] as const) {
        const rows = reviewRows.get(k) ?? [];
        if (!rows.length) continue;
        // The licenses of the packages counted here (none accepted during
        // triage), each id as everywhere else: monospace when SPDX.
        const ids = licensesToReview(k)
          .map((g) => (isSpdx(g) ? spdxHtml(g) : safe(g.spdxId)))
          .join(', ');
        // The absent kind is said once, with the present one.
        const absent =
          k === 'WEAK_COPYLEFT' && counts.STRONG_COPYLEFT === 0
            ? '; no strong copyleft license (GPL, AGPL)'
            : k === 'STRONG_COPYLEFT' && counts.WEAK_COPYLEFT === 0
              ? '; no weak copyleft license (LGPL, MPL)'
              : '';
        facts.push(
          `${plural(rows.length, 'package')} under a ${CATEGORY_META[k].label.toLowerCase()} license (${ids})${dependencyDetail(rows, people)}${absent}.`,
        );
      }
    }
    if (counts.UNKNOWN > 0) {
      const n = counts.UNKNOWN;
      const declared = toReview('UNKNOWN').some((p) => declaredLicense(p));
      facts.push(
        `${plural(n, 'package')} (${share(n, total)}) ${
          declared
            ? `${n === 1 ? 'has' : 'have'} no recognized license`
            : `${n === 1 ? 'declares' : 'declare'} no license`
        } and ${n === 1 ? 'needs' : 'need'} a manual review${directDetail(reviewRows.get('UNKNOWN') ?? [])}.`,
      );
    }
  }
  // A project without an inventory is said by the cover, the Packages tile
  // and the projects table: not again here.

  // The total is the lead tile: the aside gives what the tiles do not (the
  // accepted packages have their tile; « excluded » said nothing true, the
  // Packages tile counts them).
  const summaryAside = [
    versions > total ? plural(versions, 'version') : '',
    plural(Number(summary.uniqueLicenses) || 0, 'license'),
  ]
    .filter(Boolean)
    .join(' · ');
  const summarySection = `<section class="section">
${sectionHead({ title: 'Executive summary', aside: summaryAside })}
${tiles}
${
  total > 0
    ? `<div class="grid-2 summary-charts">
  ${chartPanel(reviewTotal ? 'Packages to review by license category' : 'Packages by license category', donutHtml)}
  ${chartPanel('Packages to review by dependency type', reviewChart)}
</div>`
    : `<div class="summary-charts">${emptyState('No dependency inventory for the selected projects.')}</div>`
}
${summaryFacts(facts)}
</section>`;

  // ── Projects ──
  // A branch every project shares is named on the cover only.
  const oneBranch = sharedBranch(projectRows.map((r) => r.branches ?? []));
  const projectTableRows = projectRows.flatMap((r) =>
    projectRowsOf(
      {
        name: r.projectName,
        team: r.teamName,
        branches: oneBranch ? [] : r.branches,
        note: r.packages ? undefined : 'No inventory',
      },
      [
        r.packages ? `<strong>${fmt(r.packages)}</strong>` : countCell(0),
        countCell(projectCount(r, 'PERMISSIVE', 'permissive')),
        countCell(projectCount(r, 'WEAK_COPYLEFT', 'weakCopyleft')),
        countCell(projectCount(r, 'STRONG_COPYLEFT', 'strongCopyleft')),
        countCell(projectCount(r, 'UNKNOWN', 'unknown')),
      ],
    ),
  );
  // A long project name or branch: the copyleft headers on two lines, their
  // columns as wide as their counts, the project the rest (its row ran
  // seven lines beside counts of one digit).
  const longProject = projectRows.some(
    (r) =>
      isLongId(r.projectName) ||
      (r.branches ?? []).some((b: string) => isLongId(b)),
  );
  const copyleftColumn = (label: string, width: string): TableColumn =>
    longProject
      ? { label, width: '11%', align: 'right', className: 'two-line' }
      : { label, width, align: 'right' };
  const projectsSection = `<section class="section">
${sectionHead({ title: 'Projects', aside: plural(projectRows.length, 'project') })}
${keepTogether(
  dataTable({
    className: 'compact',
    columns: [
      { label: 'Project' },
      { label: 'Packages', width: '11%', align: 'right' },
      { label: 'Permissive', width: '12.5%', align: 'right' },
      copyleftColumn('Weak copyleft', '15%'),
      copyleftColumn('Strong copyleft', '17.5%'),
      { label: 'Unknown', width: '10.5%', align: 'right' },
    ],
    rows: projectTableRows,
    joinPrevious: edgeUnitsJoined(projectTableRows),
  }),
  rowCount(projectTableRows),
  WHOLE_TABLE,
)}
${
  projectRows.length > 1 || accepted.size
    ? `<p class="small table-note">${[
        projectRows.length > 1
          ? 'A package used by several projects is counted in each of them.'
          : '',
        accepted.size
          ? `${projectRows.length > 1 ? 'One' : 'A package'} whose license was accepted during triage counts in Packages only.`
          : '',
      ]
        .filter(Boolean)
        .join(' ')}</p>`
    : ''
}
</section>`;

  // ── Copyleft ──
  // Each kind under its heading, the strongest first: with packages, its
  // definition and one table per license; absent (next to a present one),
  // the shared empty state.
  const ABSENT: Record<'STRONG_COPYLEFT' | 'WEAK_COPYLEFT', string> = {
    STRONG_COPYLEFT: 'No strong copyleft license (GPL, AGPL) was found.',
    WEAK_COPYLEFT: 'No weak copyleft license (LGPL, MPL) was found.',
  };
  const kinds = ['STRONG_COPYLEFT', 'WEAK_COPYLEFT'] as const;
  // The only license of the section is counted by the section heading.
  const counted =
    kinds.reduce(
      (n, k) => n + (counts[k] ? licensesToReview(k).length : 0),
      0,
    ) > 1;
  const copyleftBlocks = kinds
    .map((k) =>
      counts[k] === 0
        ? `<h3>${CATEGORY_META[k].label}</h3>${emptyState(ABSENT[k])}`
        : `<h3>${CATEGORY_META[k].label}</h3><p class="section-intro">${CATEGORY_META[k].definition}</p>${licensesToReview(
            k,
          )
            .map(
              (g) =>
                `${licenseHead(g, { counted })}${packageTable(g.packages, false, `${licenseName(g)} · continued`, people)}`,
            )
            .join('')}`,
    )
    .join('');
  const copyleftPackages = [
    ...toReview('STRONG_COPYLEFT'),
    ...toReview('WEAK_COPYLEFT'),
  ];
  const copyleftSection = `<section class="section">
${sectionHead({ title: 'Copyleft licenses', aside: copyleft ? packagesAndVersions(copyleftPackages) : 'None' })}
${copyleft === 0 ? emptyState('No copyleft license in the dependencies.') : copyleftBlocks}
</section>`;

  // ── Unknown licenses ──
  // The declared-license column only when one of them declares something.
  const unknownPackages = toReview('UNKNOWN');
  const anyDeclared = unknownPackages.some((p) => declaredLicense(p));
  const unknownSection = `<section class="section">
${sectionHead({ title: 'Unknown licenses', aside: unknownPackages.length ? packagesAndVersions(unknownPackages) : 'None' })}
${
  unknownPackages.length === 0
    ? emptyState('Every package declares a recognized license.')
    : `<p class="section-intro cont-cover">${reviewIntro(reviewRows.get('UNKNOWN') ?? [], anyDeclared)}</p>${packageTable(
        unknownPackages,
        anyDeclared,
        'Unknown licenses · continued',
        people,
      )}`
}
</section>`;

  // ── Accepted during triage ──
  const acceptedCols = versionColumns(
    acceptedRows.flatMap((p) => p.versions.map(redactSecrets)),
    [
      { width: 16, floor: 14 },
      { width: 28, floor: 18 },
    ],
  );
  const [acceptedCategory, acceptedProjects] = acceptedCols.others;
  const acceptedPkg =
    100 - acceptedCols.versions - acceptedCategory - acceptedProjects;
  const acceptedSection = acceptedRows.length
    ? `<section class="section">
${sectionHead({ eyebrow: 'Excluded from the review', title: 'Accepted during triage', aside: plural(acceptedRows.length, 'package') })}
<p class="section-intro cont-cover">Licenses reviewed and accepted by the organization: they count in the package totals only, in no license category above.</p>${flowingTable(
        {
          className: 'compact accepted-table',
          columns: [
            { label: 'Package' },
            {
              label: 'Versions',
              width: columnWidth(acceptedCols.versions, {
                preview: versionsFloor(acceptedRows.flatMap((p) => p.versions)),
              }),
            },
            { label: 'Category', width: `${acceptedCategory}%` },
            { label: 'Projects', width: `${acceptedProjects}%` },
          ],
          rows: acceptedRows
            .sort(byImportance)
            .map((p) => [
              packageName(p, acceptedPkg),
              `<span class="versions mono">${versionsHtml(p.versions)}</span>`,
              escapeHtml(
                CATEGORY_META[categoryOf.get(p.key) ?? 'UNKNOWN'].label,
              ),
              people.list(p.projects),
            ]),
          count: acceptedRows.length,
          continuation: 'Accepted during triage · continued',
        },
      )}
</section>`
    : '';

  // ── Permissive ──
  // Only the packages counted as permissive: one with a permissive and an
  // unknown version is listed under Unknown, where it is counted.
  const permissive = (groups.PERMISSIVE ?? [])
    .map((g) => ({
      ...g,
      packages: g.packages.filter(
        (p) => categoryOf.get(packageKey(p)) === 'PERMISSIVE',
      ),
    }))
    .filter((g) => g.packages.length > 0);
  const namesIn = (g: LicenseGroup) => new Set(g.packages.map(packageKey)).size;
  permissive.sort(
    (a, b) => namesIn(b) - namesIn(a) || a.spdxId.localeCompare(b.spdxId),
  );
  const listed = permissive.reduce((n, g) => n + namesIn(g), 0);
  const timesListed = new Map<string, number>();
  for (const g of permissive) {
    for (const key of new Set(g.packages.map(packageKey))) {
      timesListed.set(key, (timesListed.get(key) ?? 0) + 1);
    }
  }
  const listedTwice = Array.from(timesListed.values()).filter(
    (n) => n > 1,
  ).length;
  // Packages and versions, as in the headings of the other sections.
  const permissiveCount = packagesAndVersions(inCategory('PERMISSIVE'));
  const permissiveSection = `<section class="section">
${sectionHead({ title: 'Permissive licenses', aside: counts.PERMISSIVE ? permissiveCount : 'None' })}
${
  permissive.length === 0
    ? emptyState('No package under a permissive license.')
    : `<p class="section-intro cont-cover">${CATEGORY_META.PERMISSIVE.definition}${detailed ? ' Every permissive package is listed in the appendix.' : ''}</p>${flowingTable(
        {
          className: 'compact license-table',
          columns: [
            { label: 'License' },
            { label: 'SPDX identifier', width: '24%' },
            { label: 'Packages', width: '12%', align: 'right' },
            { label: 'Projects', width: '11%', align: 'right' },
          ],
          rows: permissive.map((g) => [
            `<span class="name">${escapeHtml(licenseName(g))}</span>`,
            isSpdx(g)
              ? `<span class="versions mono">${spdxId(g)}</span>`
              : '<span class="muted">Not an SPDX id</span>',
            fmt(namesIn(g)),
            fmt(new Set(g.packages.flatMap(people.keysOf)).size),
          ]),
          count: permissive.length,
          continuation: 'Permissive licenses · continued',
        },
      )}${
        listedTwice > 0 && listed > timesListed.size
          ? `<p class="small table-note">${plural(listedTwice, 'package')} ${listedTwice === 1 ? 'is' : 'are'} listed under several licenses (combined licenses, or a different license per version), so the rows add up to ${fmt(listed)}.</p>`
          : ''
      }`
}
</section>`;

  // ── Appendix: every permissive package, compact ──
  const small = permissive.filter((g) => namesIn(g) <= SMALL_LICENSE);
  const inventorySection =
    detailed && permissive.length > 0
      ? `<section class="section appendix">
${sectionHead({ eyebrow: 'Appendix', title: 'Permissive package inventory', aside: permissiveCount })}
<p class="section-intro">Every package under a permissive license, by license, ecosystem and name, with the versions in use. A package used by several projects is listed once; one listed under several licenses names the others.</p>
${permissive
  .filter((g) => namesIn(g) > SMALL_LICENSE)
  .map((g) => packageIndex(g, notes))
  .join('')}
${
  small.length
    ? `<div class="license-head cont-cover"><span class="title">Other permissive licenses</span><span class="meta">${plural(
        small.length,
        'license',
      )}</span></div>${smallLicensesIndex(small, notes)}`
    : ''
}
</section>`
      : '';

  const about = aboutSection([
    {
      title: 'Method and limits',
      html: '<p>Licenses come from the manifests and registries read by the dependency (SCA) scans. A package is an ecosystem and a name: it is counted once, whatever the number of projects and versions using it, in the most restrictive category of its versions, and its versions in use are listed with it. With several licenses, its SPDX expression decides: with OR the least restrictive option applies, with AND or a plain list the most restrictive one. License overrides defined by the organization are applied, and a package whose license was accepted during triage counts in the package totals only, in no license category.</p><p>Limits: licenses are the ones the packages declare; they are not verified against the source code. Transitive dependencies are listed as far as the scanned lockfiles resolve them, and a project without a dependency scan has no inventory.</p>',
    },
    {
      title: 'Disclaimer',
      html: '<p>This report is an automated inventory, not legal advice. Confirm license obligations with your legal team before distributing software.</p>',
    },
  ]);

  return renderReportDocument({
    title: `${LICENSE_REPORT_TITLE} · ${options.scopeName ?? ''}`,
    forPdf,
    body: [
      cover,
      summarySection,
      projectsSection,
      copyleftSection,
      unknownSection,
      acceptedSection,
      permissiveSection,
      inventorySection,
      about,
    ].join('\n'),
    extraCss: `${AGGREGATED_CSS}${LICENSE_CSS}${forPdf ? '' : `${AGGREGATED_SCREEN_CSS}${LICENSE_SCREEN_CSS}`}`,
  });
}
