import { In, type EntityManager } from 'typeorm';
import { ilike } from '@cybedefend/db-dialect';
import { rawIdent } from '../../core/db/raw-sql';
import {
  isPyPiEcosystem,
  normalizeEcosystem,
  normalizePyPiPackageName,
} from '../sca/sca.utils';
import {
  ImportedAdvisory,
  ImportedAdvisoryFix,
} from '../../entities/imported-advisory.entity';
import { VulnerabilityOsv } from '../../entities/osv/vulnerability-osv.entity';
import { VulnerabilityOsvAlias } from '../../entities/osv/vulnerability-osv-alias.entity';
import { VulnerabilityOsvReference } from '../../entities/osv/vulnerability-osv-reference.entity';
import { VulnerabilityOsvSeverity } from '../../entities/osv/vulnerability-osv-severity.entity';
import { VulnerabilityOsvAffected } from '../../entities/osv/vulnerability-osv-affected.entity';
import { VulnerabilityOsvAffectedRange } from '../../entities/osv/vulnerability-osv-affected-range.entity';
import { VulnerabilityOsvAffectedEvent } from '../../entities/osv/vulnerability-osv-affected-event.entity';

/**
 * What one import may keep per advisory: an import is a file a project member
 * chose, so every collection it stores is bounded.
 */
export const IMPORTED_ADVISORY_LIMITS = {
  aliases: 50,
  referenceUrls: 20,
  fixes: 200,
  cweIds: 50,
} as const;

/** The content of an imported advisory: a stored row, or an import item. */
export type ImportedAdvisoryContent = Pick<
  ImportedAdvisory,
  | 'advisoryId'
  | 'toolName'
  | 'summary'
  | 'details'
  | 'severity'
  | 'cvssV3Vector'
  | 'cweIds'
  | 'aliases'
  | 'referenceUrls'
  | 'fixes'
>;

/** The package a finding is about. */
export interface FindingPackage {
  packageName: string;
  ecosystem: string;
  /** Other names of the same package (a container package's source name). */
  alternateNames?: string[];
}

/** Rows read per IN list. */
const IN_CHUNK = 500;

const normalized = (value: string | null | undefined): string =>
  (value ?? '').trim().toLowerCase();

const isPyPi = (ecosystem: string | null | undefined): boolean =>
  isPyPiEcosystem(normalizeEcosystem(normalized(ecosystem)));

/**
 * The forms of a package name the ingestion matcher compares: the name in
 * lower case, plus its PEP 503 form when either side is a PyPI package
 * (`apache_airflow`, `Apache.Airflow` and `apache-airflow` are one
 * distribution). Scoped npm names, Maven `group:artifact` and Go module paths
 * are compared whole, in lower case.
 */
export function packageNameForms(
  name: string | null | undefined,
  pypi: boolean,
): string[] {
  const lower = normalized(name);
  if (!pypi || !lower) return lower ? [lower] : [];
  const pep503 = normalizePyPiPackageName(lower);
  return pep503 === lower ? [lower] : [lower, pep503];
}

/**
 * The names a SQL lookup of a finding's package compares: the lower-case
 * names, and, for a PyPI package, the PEP 503 forms (to compare with
 * `REPLACE(REPLACE(LOWER(name), '_', '-'), '.', '-')`).
 */
export function packageLookupNames(pkg: FindingPackage): {
  lower: string[];
  pep503: string[];
} {
  const names = [pkg.packageName, ...(pkg.alternateNames ?? [])];
  const pypi = isPyPi(pkg.ecosystem);
  const lower = [
    ...new Set(names.flatMap((n) => packageNameForms(n, pypi))),
  ].filter(Boolean);
  const pep503 = pypi
    ? [...new Set(names.map((n) => normalizePyPiPackageName(normalized(n))))]
    : [];
  return { lower, pep503 };
}

/** Whether an advisory entry names the finding's package (or one of its names). */
function namesPackage(
  entry: { ecosystem: string | null; packageName: string | null },
  pkg: FindingPackage,
): boolean {
  const pypi = isPyPi(entry.ecosystem) || isPyPi(pkg.ecosystem);
  const entryForms = new Set(packageNameForms(entry.packageName, pypi));
  return [pkg.packageName, ...(pkg.alternateNames ?? [])].some((name) =>
    packageNameForms(name, pypi).some((form) => entryForms.has(form)),
  );
}

/**
 * The entries (fixed versions, affected rows) of an advisory that concern the
 * finding's own package: those naming it (packageNameForms, or one of its
 * alternate names), of the same ecosystem when the advisory names that
 * package in several ecosystems. When the advisory names no such package, its
 * entries apply only if they are all about one single package (a naming
 * difference between the scanner and the advisory); otherwise none does, so
 * a finding never shows the fix of another package.
 */
export function entriesOfPackage<
  T extends { ecosystem: string | null; packageName: string | null },
>(entries: readonly T[], pkg: FindingPackage | null | undefined): T[] {
  if (!pkg || entries.length === 0) return [];
  const sameName = entries.filter((e) => namesPackage(e, pkg));
  if (sameName.length > 0) {
    const ecosystem = normalizeEcosystem(normalized(pkg.ecosystem));
    const sameEcosystem = sameName.filter(
      (e) =>
        normalized(normalizeEcosystem(normalized(e.ecosystem))) ===
        normalized(ecosystem),
    );
    return sameEcosystem.length > 0 ? sameEcosystem : sameName;
  }
  const names = new Set(entries.map((e) => normalized(e.packageName)));
  return names.size === 1 ? [...entries] : [];
}

/**
 * Every entry, the finding's own package's first (entriesOfPackage), then
 * the others in their order: what a list of the advisory's packages shows.
 */
export function ownPackageFirst<
  T extends { ecosystem: string | null; packageName: string | null },
>(entries: readonly T[], pkg: FindingPackage | null | undefined): T[] {
  const own = new Set(entriesOfPackage(entries, pkg));
  return [
    ...entries.filter((e) => own.has(e)),
    ...entries.filter((e) => !own.has(e)),
  ];
}

/**
 * The CVE shown for an advisory, the same rule in every list and detail: the
 * advisory id when it is a CVE, else the first CVE alias of `aliases` in the
 * order given (the callers pass them sorted), else ''.
 */
export function displayedCveOf(
  advisoryId: string,
  aliases: readonly string[],
): string {
  if (/^CVE-/i.test(advisoryId ?? '')) return advisoryId;
  return aliases.find((alias) => /^CVE-/i.test(alias ?? '')) ?? '';
}

/**
 * The CVE alias of each advisory of the shared catalogue: the smallest one in
 * the database's order, one row per advisory.
 */
export async function loadCatalogueCveAliases(
  manager: EntityManager,
  advisoryIds: readonly string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const ids = [...new Set(advisoryIds)].filter(Boolean);
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const chunk = ids.slice(i, i + IN_CHUNK);
    const rows = await manager
      .createQueryBuilder()
      .select('a.vulnerabilityOsvId', 'osvId')
      .addSelect('MIN(a.alias)', 'cve')
      .from('vulnerability_osv_alias', 'a')
      .where('a.vulnerabilityOsvId IN (:...chunk)', { chunk })
      .andWhere(ilike('a.alias', "'CVE-%'").text)
      .groupBy('a.vulnerabilityOsvId')
      .getRawMany<{ osvId: string; cve: string | null }>();
    for (const row of rows) {
      if (row.cve) result.set(row.osvId, row.cve);
    }
  }
  return result;
}

/**
 * The search condition of a list of SCA findings on advisory text. A finding
 * whose project imported its advisory is searched in that project's own row
 * (summary, aliases) only; the shared catalogue's terms (`sharedTerms`) apply
 * only to findings whose project has no row of its own, so a search never
 * tells whether the catalogue's text of an imported advisory holds a word.
 */
export function advisoryTextSearchSql(options: {
  /** SQL of the finding's project id column. */
  projectIdColumn: string;
  /** SQL of the finding's advisory id column. */
  advisoryIdColumn: string;
  /** SQL of the catalogue terms (summary, aliases). */
  sharedTerms: string;
  /** The search parameter, e.g. ':search'. */
  param: string;
}): string {
  const own = (alias: string) =>
    `FROM imported_advisory ${rawIdent(alias)} WHERE ${rawIdent(`${alias}.projectId`)} = ${options.projectIdColumn} AND ${rawIdent(`${alias}.advisoryId`)} = ${options.advisoryIdColumn}`;
  return `((NOT EXISTS (SELECT 1 ${own('ownRow')}) AND (${options.sharedTerms})) OR EXISTS (SELECT 1 ${own('ownText')} AND (${ilike(rawIdent('ownText.summary'), options.param).text} OR ${ilike(rawIdent('ownText.aliases'), options.param).text})))`;
}

/** The imported advisories of `projectId` among `advisoryIds`, by advisory id. */
export async function loadImportedAdvisories(
  manager: EntityManager,
  projectId: string,
  advisoryIds: readonly string[],
): Promise<Map<string, ImportedAdvisory>> {
  const result = new Map<string, ImportedAdvisory>();
  const ids = [...new Set(advisoryIds)].filter(Boolean);
  if (!projectId) return result;
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const rows = await manager.find(ImportedAdvisory, {
      where: { projectId, advisoryId: In(ids.slice(i, i + IN_CHUNK)) },
    });
    for (const row of rows) result.set(row.advisoryId, row);
  }
  return result;
}

/** The advisory objects built by {@link advisoryViewOf}. */
const importedViews = new WeakSet<VulnerabilityOsv>();

/** Whether `advisory` was built from imported content (not a catalogue row). */
export const isImportedAdvisoryView = (
  advisory: VulnerabilityOsv | null | undefined,
): boolean => !!advisory && importedViews.has(advisory);

const sortedAliases = (aliases: readonly string[]): string[] =>
  [...aliases].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

/**
 * An in-memory advisory built from imported content, in the shape the
 * mappers and the ingestion read: text, CWE ids, aliases (sorted), https
 * references, the DATABASE_SPECIFIC severity and the CVSS v3 vector the
 * import declared, and, when `pkg` is given, the fixed versions of that
 * package only. Never saved: the detection keeps only the advisory id.
 */
export function advisoryViewOf(
  content: ImportedAdvisoryContent,
  pkg?: FindingPackage | null,
): VulnerabilityOsv {
  const id = content.advisoryId;
  const view = Object.assign(new VulnerabilityOsv(), {
    id,
    internalId: null,
    summary: content.summary ?? '',
    details: content.details ?? '',
    databaseSpecific: {
      cwe_ids: [...(content.cweIds ?? [])],
      severity: (content.severity ?? '').toUpperCase(),
      source: `sarif:${content.toolName}`,
    },
  });
  view.aliases = sortedAliases(content.aliases ?? []).map((alias) =>
    Object.assign(new VulnerabilityOsvAlias(), { id: '', alias }),
  );
  view.references = (content.referenceUrls ?? []).map((url) =>
    Object.assign(new VulnerabilityOsvReference(), {
      id: '',
      type: 'ADVISORY',
      url,
    }),
  );
  const severities: VulnerabilityOsvSeverity[] = [];
  if (content.severity) {
    severities.push(
      Object.assign(new VulnerabilityOsvSeverity(), {
        id: '',
        type: 'DATABASE_SPECIFIC',
        score: content.severity.toUpperCase(),
      }),
    );
  }
  if (content.cvssV3Vector) {
    severities.push(
      Object.assign(new VulnerabilityOsvSeverity(), {
        id: '',
        type: 'CVSS_V3',
        score: content.cvssV3Vector,
      }),
    );
  }
  view.severities = severities;
  view.affected = pkg ? affectedOf(content.fixes ?? [], pkg) : [];
  importedViews.add(view);
  return view;
}

/** The packages an imported advisory's view lists (the finding's own first). */
const VIEW_AFFECTED_LIMIT = 20;

/**
 * One affected row per (ecosystem, package) of the fixes: the finding's own
 * package first, then the others, bounded.
 */
function affectedOf(
  fixes: readonly ImportedAdvisoryFix[],
  pkg: FindingPackage,
): VulnerabilityOsvAffected[] {
  const byPackage = new Map<string, ImportedAdvisoryFix[]>();
  for (const fix of ownPackageFirst(fixes, pkg)) {
    const key = `${fix.ecosystem}\u0000${fix.packageName}`;
    byPackage.set(key, [...(byPackage.get(key) ?? []), fix]);
  }
  return [...byPackage.values()].slice(0, VIEW_AFFECTED_LIMIT).map((group) =>
    Object.assign(new VulnerabilityOsvAffected(), {
      id: '',
      ecosystem: group[0].ecosystem,
      packageName: group[0].packageName,
      severity: null,
      ranges: [
        Object.assign(new VulnerabilityOsvAffectedRange(), {
          id: '',
          type: 'ECOSYSTEM',
          events: group.map((fix) =>
            Object.assign(new VulnerabilityOsvAffectedEvent(), {
              id: '',
              fixed: fix.fixed,
            }),
          ),
        }),
      ],
    }),
  );
}

/** The key of a (project, advisory) pair in {@link loadImportedAdvisoriesOfProjects}. */
export const importedAdvisoryKey = (
  projectId: string,
  advisoryId: string,
): string => `${projectId}\u0000${advisoryId}`;

/**
 * The imported advisories of findings of several projects: each finding's
 * own project only, keyed by {@link importedAdvisoryKey}. One query per
 * chunk of projects and advisory ids, on the table's primary key.
 */
export async function loadImportedAdvisoriesOfProjects(
  manager: EntityManager,
  pairs: ReadonlyArray<{ projectId: string; advisoryId: string }>,
): Promise<Map<string, ImportedAdvisory>> {
  const result = new Map<string, ImportedAdvisory>();
  const wanted = new Set(
    pairs
      .filter((p) => p.projectId && p.advisoryId)
      .map((p) => importedAdvisoryKey(p.projectId, p.advisoryId)),
  );
  if (wanted.size === 0) return result;
  const projects = [...new Set(pairs.map((p) => p.projectId))].filter(Boolean);
  const ids = [...new Set(pairs.map((p) => p.advisoryId))].filter(Boolean);
  for (let i = 0; i < projects.length; i += IN_CHUNK) {
    for (let j = 0; j < ids.length; j += IN_CHUNK) {
      const rows = await manager.find(ImportedAdvisory, {
        where: {
          projectId: In(projects.slice(i, i + IN_CHUNK)),
          advisoryId: In(ids.slice(j, j + IN_CHUNK)),
        },
      });
      for (const row of rows) {
        const key = importedAdvisoryKey(row.projectId, row.advisoryId);
        if (wanted.has(key)) result.set(key, row);
      }
    }
  }
  return result;
}

/** A finding whose advisory may have been imported into its project. */
export interface AdvisoryFinding {
  projectId: string;
  vulnerability?: VulnerabilityOsv | null;
}

/**
 * Replaces the advisory of every finding whose own project imported it by
 * that project's content ({@link advisoryViewOf}, with the finding's
 * package). Findings of several projects are read in one lookup.
 */
export async function applyImportedAdvisories<T extends AdvisoryFinding>(
  manager: EntityManager,
  findings: readonly T[],
  packageOf: (finding: T) => FindingPackage | null,
): Promise<void> {
  const pairs = findings
    .filter(
      (f) => f.vulnerability?.id && !isImportedAdvisoryView(f.vulnerability),
    )
    .map((f) => ({ projectId: f.projectId, advisoryId: f.vulnerability.id }));
  if (pairs.length === 0) return;
  const imported = await loadImportedAdvisoriesOfProjects(manager, pairs);
  if (imported.size === 0) return;
  for (const finding of findings) {
    const id = finding.vulnerability?.id;
    if (!id) continue;
    const row = imported.get(importedAdvisoryKey(finding.projectId, id));
    if (row) finding.vulnerability = advisoryViewOf(row, packageOf(finding));
  }
}

/**
 * {@link applyImportedAdvisories} for findings of one project whose rows do not
 * carry their project id.
 */
export async function applyProjectImportedAdvisories<
  T extends { vulnerability?: VulnerabilityOsv | null },
>(
  manager: EntityManager,
  projectId: string,
  findings: readonly T[],
  packageOf: (finding: T) => FindingPackage | null,
): Promise<void> {
  const ids = findings
    .map((f) => f.vulnerability)
    .filter((v) => v?.id && !isImportedAdvisoryView(v))
    .map((v) => (v as VulnerabilityOsv).id);
  if (ids.length === 0) return;
  const imported = await loadImportedAdvisories(manager, projectId, ids);
  if (imported.size === 0) return;
  for (const finding of findings) {
    const row = imported.get(finding.vulnerability?.id ?? '');
    if (row) finding.vulnerability = advisoryViewOf(row, packageOf(finding));
  }
}

/**
 * The fixed versions the catalogue lists per advisory, each with the package
 * and ecosystem of its affected row (callers keep the finding's own with
 * {@link entriesOfPackage}).
 */
export async function loadCatalogueFixes(
  manager: EntityManager,
  advisoryIds: readonly string[],
): Promise<Map<string, ImportedAdvisoryFix[]>> {
  const result = new Map<string, ImportedAdvisoryFix[]>();
  const ids = [...new Set(advisoryIds)].filter(Boolean);
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const chunk = ids.slice(i, i + IN_CHUNK);
    const rows = await manager
      .createQueryBuilder()
      .select('aff.vulnerabilityOsvId', 'osvId')
      .addSelect('aff.ecosystem', 'ecosystem')
      .addSelect('aff.packageName', 'packageName')
      .addSelect('evt.fixed', 'fixedVersion')
      .from('vulnerability_osv_affected', 'aff')
      .innerJoin(
        'vulnerability_osv_affected_range',
        'rng',
        'rng.affectedId = aff.id',
      )
      .innerJoin(
        'vulnerability_osv_affected_event',
        'evt',
        'evt.rangeId = rng.id',
      )
      .where('aff.vulnerabilityOsvId IN (:...chunk)', { chunk })
      .andWhere('evt.fixed IS NOT NULL')
      .andWhere("evt.fixed <> ''")
      .getRawMany<{
        osvId: string;
        ecosystem: string | null;
        packageName: string | null;
        fixedVersion: string | null;
      }>();
    for (const row of rows) {
      if (!row.fixedVersion) continue;
      const bucket = result.get(row.osvId) ?? [];
      bucket.push({
        ecosystem: row.ecosystem ?? '',
        packageName: row.packageName ?? '',
        fixed: row.fixedVersion,
      });
      result.set(row.osvId, bucket);
    }
  }
  return result;
}

/**
 * The fixed versions of a finding's own package: from its imported advisory
 * (already restricted to the package), else from the catalogue's fixes.
 */
export function fixesOfFinding(
  advisory: VulnerabilityOsv | null | undefined,
  pkg: FindingPackage | null,
  catalogueFixes: ReadonlyMap<string, readonly ImportedAdvisoryFix[]>,
): string[] {
  if (!advisory) return [];
  if (isImportedAdvisoryView(advisory)) {
    return entriesOfPackage(advisory.affected ?? [], pkg).flatMap((aff) =>
      (aff.ranges ?? []).flatMap((range) =>
        (range.events ?? [])
          .map((event) => event.fixed)
          .filter((fixed): fixed is string => !!fixed),
      ),
    );
  }
  return entriesOfPackage(catalogueFixes.get(advisory.id) ?? [], pkg).map(
    (fix) => fix.fixed,
  );
}

/**
 * The CVE shown for a finding ({@link displayedCveOf}): from its imported
 * advisory's aliases, else from the catalogue's smallest CVE alias.
 */
export function cveOfFinding(
  advisory: VulnerabilityOsv | null | undefined,
  catalogueCves: ReadonlyMap<string, string>,
): string {
  if (!advisory?.id) return '';
  if (isImportedAdvisoryView(advisory)) {
    return displayedCveOf(
      advisory.id,
      (advisory.aliases ?? []).map((a) => a.alias),
    );
  }
  const cve = catalogueCves.get(advisory.id);
  return displayedCveOf(advisory.id, cve ? [cve] : []);
}

/** The catalogue advisory ids among findings' advisories (not imported ones). */
export const catalogueAdvisoryIds = (
  advisories: ReadonlyArray<VulnerabilityOsv | null | undefined>,
): string[] => [
  ...new Set(
    advisories
      .filter((a) => !!a?.id && !isImportedAdvisoryView(a))
      .map((a) => (a as VulnerabilityOsv).id),
  ),
];
