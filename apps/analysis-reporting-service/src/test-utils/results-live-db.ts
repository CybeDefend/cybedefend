import { randomUUID } from 'crypto';
import { DataSource, EntityMetadata, Logger as TypeOrmLogger } from 'typeorm';

import { currentDialect } from '@cybedefend/db-dialect';
import { createLiveDatabase } from '../core/db/live-database';
import { LIVE_ENTITIES_GLOB } from '../core/db/typeorm-options';

import { SastVulnerabilityDetections } from '../entities/sast-vulnerability-detections.entity';
import { IacVulnerabilityDetections } from '../entities/iac-vulnerability-detections.entity';
import { CicdVulnerabilityDetections } from '../entities/cicd-vulnerability-detections.entity';
import { SecretVulnerabilityDetections } from '../entities/secret-vulnerability-detections.entity';
import { ScaVulnerabilityDetections } from '../entities/sca-vulnerability-detections.entity';
import { ScaDetectedPackages } from '../entities/sca-detected-packages.entity';
import { VulnerabilityDetectionsContainer } from '../entities/container_vulnerability_detections.entity';
import { AutoFixRecord } from '../entities/autofix-record.entity';
import { ScaAutoFixRecord } from '../entities/sca-autofix-record.entity';
import { ResultService } from '../modules/result/result.service';

/**
 * A throwaway database holding the detection tables, for the
 * live specs that compare the counts computed before and after the rewrite regrouped
 * their queries (UNION ALL, COUNT + SUM(EXISTS), one GROUP BY per table) on
 * one data set.
 *
 * The schema is built by the migration track (src/core/db/
 * live-database.ts), on the engine LIVE_DB_TYPE selects; it used to be
 * `synchronize()` from the entities, which misses the uniques only the
 * migrations create. It lives in its own database, dropped at the end, and
 * never touches a `cybedefend_*` database.
 */

export interface RecordedQuery {
  sql: string;
  parameters: unknown[];
}

export interface ResultsLiveDb {
  dataSource: DataSource;
  /** Every SELECT the data source ran since the last `queries.length = 0`. */
  queries: RecordedQuery[];
  close(): Promise<void>;
}

const CLOSURE_ROOTS = [
  SastVulnerabilityDetections,
  IacVulnerabilityDetections,
  CicdVulnerabilityDetections,
  SecretVulnerabilityDetections,
  ScaVulnerabilityDetections,
  VulnerabilityDetectionsContainer,
  AutoFixRecord,
  ScaAutoFixRecord,
];

class RecordingLogger implements TypeOrmLogger {
  constructor(private readonly queries: RecordedQuery[]) {}
  logQuery(query: string, parameters?: unknown[]): void {
    if (/^\s*\(?\s*SELECT/i.test(query)) {
      this.queries.push({ sql: query, parameters: parameters ?? [] });
    }
  }
  logQueryError(): void {}
  logQuerySlow(): void {}
  logSchemaBuild(): void {}
  logMigration(): void {}
  log(): void {}
}

export interface OpenResultsLiveDbOptions {
  /** names the throwaway database */
  prefix: string;
  /**
   * the spec's flag minus `_MYSQL_LIVE` (e.g. `RESULT_OVERVIEW`): the server
   * URL is `<envPrefix>_MYSQL_URL` / `<envPrefix>_PG_URL`, else the shared
   * `RESULTS_LIVE_MYSQL_URL` / `RESULTS_LIVE_PG_URL`, else the defaults of
   * the live helper.
   */
  envPrefix: string;
}

/**
 * A throwaway database holding the detection tables, built by the service's
 * migration track through the two-engine live helper (never `synchronize`:
 * it misses the uniques only migrations create), with the entities the
 * detection tables reach (their relation closure) registered on the data
 * source. Dropped by `close()`; never touches a `cybedefend_*` database.
 */
export async function openResultsLiveDb(
  opts: OpenResultsLiveDbOptions,
): Promise<ResultsLiveDb> {
  // The engine the entities were decorated for: a MySQL driver refuses the
  // PostgreSQL column types (jsonb, citext…) and the reverse. The core
  // entities only, as createLiveDatabase loads them: src/ee holds cloud-only
  // entities still typed for MySQL.
  const metadataOnly = new DataSource({
    type: currentDialect(),
    database: 'unused',
    entities: [LIVE_ENTITIES_GLOB],
  });
  // Builds the entity metadata; never connects.
  await (
    metadataOnly as unknown as { buildMetadatas(): Promise<void> }
  ).buildMetadatas();
  const closure = new Set<EntityMetadata>();
  const visit = (metadata: EntityMetadata): void => {
    if (closure.has(metadata)) return;
    closure.add(metadata);
    metadata.relations.forEach((r) => visit(r.inverseEntityMetadata));
  };
  CLOSURE_ROOTS.forEach((root) => visit(metadataOnly.getMetadata(root)));

  const queries: RecordedQuery[] = [];
  const live = await createLiveDatabase({
    prefix: opts.prefix,
    envPrefix: opts.envPrefix,
    fallbackEnvPrefix: 'RESULTS_LIVE',
    entities: [...closure].map((m) => m.target as new () => unknown),
    extra: { connectionLimit: 20 },
    migrations: 'track',
    logger: new RecordingLogger(queries),
  });

  return {
    dataSource: live.dataSource,
    queries,
    async close() {
      await live.drop();
    },
  };
}

/** The two projects of the data set; a third id owns nothing. */
export const LIVE_PROJECTS = {
  P: '0f0f0f0f-0000-4000-8000-00000000000a',
  Q: '0f0f0f0f-0000-4000-8000-00000000000b',
  EMPTY: '0f0f0f0f-0000-4000-8000-00000000000c',
} as const;

/** Every state a detection can be in. */
export const LIVE_STATES = [
  'to_verify',
  'confirmed',
  'resolved',
  'ignored',
  'not_exploitable',
  'proposed_not_exploitable',
] as const;

/**
 * Severity inputs, chosen to cover every branch of `effectiveSeveritySql`:
 * env score, base score only, a score of 0 ('none'), a stored band, an
 * upper-case scanner label, and no label at all (the NULL band).
 */
const BANDS: Array<{
  cvss4EnvironmentalScore: number | null;
  cvss4BaseScore: number | null;
  effectiveSeverity: string | null;
  currentSeverity: string;
}> = [
  {
    cvss4EnvironmentalScore: 9.5,
    cvss4BaseScore: 9.8,
    effectiveSeverity: null,
    currentSeverity: 'critical',
  },
  {
    cvss4EnvironmentalScore: null,
    cvss4BaseScore: 7.5,
    effectiveSeverity: null,
    currentSeverity: 'critical',
  },
  {
    cvss4EnvironmentalScore: 5,
    cvss4BaseScore: null,
    effectiveSeverity: null,
    currentSeverity: 'high',
  },
  {
    cvss4EnvironmentalScore: 2,
    cvss4BaseScore: 8,
    effectiveSeverity: null,
    currentSeverity: 'low',
  },
  {
    cvss4EnvironmentalScore: 0,
    cvss4BaseScore: null,
    effectiveSeverity: null,
    currentSeverity: 'low',
  },
  {
    cvss4EnvironmentalScore: null,
    cvss4BaseScore: null,
    effectiveSeverity: 'high',
    currentSeverity: 'low',
  },
  {
    cvss4EnvironmentalScore: null,
    cvss4BaseScore: null,
    effectiveSeverity: null,
    currentSeverity: 'MEDIUM',
  },
  {
    cvss4EnvironmentalScore: null,
    cvss4BaseScore: null,
    effectiveSeverity: null,
    currentSeverity: '',
  },
];

const CLOSED_STATES = new Set(['resolved', 'ignored', 'not_exploitable']);

const day = (n: number): Date =>
  new Date(Date.UTC(2026, 6, 1 + (n % 40), 8 + (n % 11), 0, 0));

/**
 * Dates of the n-th row. A closed row carries a resolution date, a triage
 * date, or neither (the trend then falls back to its update date), so every
 * branch of the over-time COALESCE is exercised.
 */
function datesOf(n: number, state: string) {
  const createdAt = day(n);
  const later = day(n + 3);
  const closed = CLOSED_STATES.has(state);
  return {
    createdAt,
    resolvedAt: closed && n % 3 === 0 ? later : null,
    triagedAt: closed && n % 3 === 1 ? day(n + 5) : null,
    touchedAt: day(n + 7),
  };
}

export interface SeededResults {
  /** Ids of the code-table detections, per table. */
  codeIds: Record<'sast' | 'iac' | 'cicd' | 'secret', string[]>;
  scaIds: string[];
  scaPackageIds: Record<string, string>;
}

const CODE_TABLES = [
  ['sast', SastVulnerabilityDetections],
  ['iac', IacVulnerabilityDetections],
  ['cicd', CicdVulnerabilityDetections],
  ['secret', SecretVulnerabilityDetections],
] as const;

/**
 * Seeds two projects with every combination of state and severity input, on
 * several branches:
 *  - code tables (SAST, IaC, CICD, Secret) and container: 'main', 'feat' and
 *    a NULL branch;
 *  - SCA: packages on 'main', the legacy '' partition, 'master' and 'feat';
 *    each package's detections share its project and branch, as both
 *    ingestion factories write them; malware findings active and
 *    resolved; detections whose package is gone (`scaDetectedPackageId`
 *    NULL), which the tab count's INNER JOIN leaves out;
 *  - autofix records on some code detections (two on some), and SCA autofix
 *    records with and without an available fix (two on some).
 */
export async function seedResultsDataset(
  dataSource: DataSource,
): Promise<SeededResults> {
  const { P, Q } = LIVE_PROJECTS;
  const codeIds: SeededResults['codeIds'] = {
    sast: [],
    iac: [],
    cicd: [],
    secret: [],
  };
  let n = 0;

  for (const [key, entity] of CODE_TABLES) {
    const rows: Record<string, unknown>[] = [];
    const autofix: Record<string, unknown>[] = [];
    for (const projectId of [P, Q]) {
      for (const branch of ['main', 'feat', null]) {
        for (const state of LIVE_STATES) {
          for (const band of BANDS) {
            n += 1;
            const id = randomUUID();
            const dates = datesOf(n, state);
            rows.push({
              id,
              projectId,
              branch,
              currentState: state,
              currentPriority: 'normal',
              language: 'typescript',
              path: `src/file-${n}.ts`,
              vulnerableStartLine: n,
              vulnerableEndLine: n,
              scannerType: key,
              ...band,
              createdAt: dates.createdAt,
              resolvedAt: dates.resolvedAt,
              triagedAt: dates.triagedAt,
              updateAt: dates.touchedAt,
            });
            codeIds[key].push(id);
            const copies = n % 8 === 0 ? 2 : n % 4 === 0 ? 1 : 0;
            for (let c = 0; c < copies; c += 1) {
              autofix.push({
                id: randomUUID(),
                projectId,
                vulnerabilityId: `rule-${n}`,
                detectionId: id,
                vulnerabilityType: key,
                branch: branch ?? 'main',
                edits: [],
                commitMessage: 'fix',
                prTitle: 'fix',
                prBody: 'fix',
                status: c === 0 ? 'ok' : 'error',
              });
            }
          }
        }
      }
    }
    await dataSource.getRepository(entity).insert(rows);
    if (autofix.length) {
      await dataSource.getRepository(AutoFixRecord).insert(autofix);
    }
  }

  const containerRows: Record<string, unknown>[] = [];
  for (const projectId of [P, Q]) {
    for (const branch of ['main', 'feat', null]) {
      for (const state of LIVE_STATES) {
        for (const band of BANDS) {
          n += 1;
          const dates = datesOf(n, state);
          containerRows.push({
            id: randomUUID(),
            projectId,
            branch,
            vulnerabilityIdentifier: `CVE-2026-${n}`,
            currentState: state,
            ...band,
            createdAt: dates.createdAt,
            resolvedAt: dates.resolvedAt,
            triagedAt: dates.triagedAt,
            updatedAt: dates.touchedAt,
          });
        }
      }
    }
  }
  await dataSource
    .getRepository(VulnerabilityDetectionsContainer)
    .insert(containerRows);

  const scaPackageIds: Record<string, string> = {};
  const packages: Record<string, unknown>[] = [];
  const packageSpecs: Array<[string, string]> = [
    [P, 'main'],
    [P, ''],
    [P, 'master'],
    [P, 'feat'],
    [Q, 'main'],
    [Q, ''],
  ];
  for (const [projectId, branch] of packageSpecs) {
    const id = randomUUID();
    scaPackageIds[`${projectId}:${branch}`] = id;
    packages.push({
      id,
      projectId,
      branch,
      packageName: `pkg-${branch || 'legacy'}`,
      packageVersion: '1.0.0',
      fileName: 'package.json',
      ecosystem: 'npm',
      isTransitive: false,
      isDev: false,
    });
  }
  await dataSource.getRepository(ScaDetectedPackages).insert(packages);

  const scaRows: Record<string, unknown>[] = [];
  const scaAutofix: Record<string, unknown>[] = [];
  const scaIds: string[] = [];
  const addSca = (
    projectId: string,
    branch: string,
    packageId: string | null,
    state: string,
    band: (typeof BANDS)[number],
    isMalware: boolean,
  ) => {
    n += 1;
    const id = randomUUID();
    const dates = datesOf(n, state);
    scaRows.push({
      id,
      projectId,
      branch,
      scaDetectedPackage: packageId ? { id: packageId } : null,
      currentState: state,
      currentCVSS: 0,
      isMalware,
      ...band,
      createdAt: dates.createdAt,
      resolvedAt: dates.resolvedAt,
      triagedAt: dates.triagedAt,
      updatedAt: dates.touchedAt,
    });
    scaIds.push(id);
    const fixes: boolean[] =
      n % 6 === 0
        ? [true, false]
        : n % 3 === 0
          ? [true]
          : n % 5 === 0
            ? [false]
            : [];
    if (n % 12 === 0) fixes.push(true);
    for (const hasFixAvailable of fixes) {
      scaAutofix.push({
        id: randomUUID(),
        projectId,
        scaVulnerabilityDetectionId: id,
        cveId: `GHSA-${n}`,
        severity: 'high',
        vulnerablePackage: 'pkg',
        vulnerableVersion: '1.0.0',
        dependencyPath: [],
        ecosystem: 'npm',
        hasFixAvailable,
      });
    }
  };
  for (const [projectId, branch] of packageSpecs) {
    const packageId = scaPackageIds[`${projectId}:${branch}`];
    for (const state of LIVE_STATES) {
      for (const band of BANDS) {
        addSca(projectId, branch, packageId, state, band, false);
      }
    }
    addSca(projectId, branch, packageId, 'to_verify', BANDS[0], true);
    addSca(projectId, branch, packageId, 'confirmed', BANDS[2], true);
    addSca(projectId, branch, packageId, 'resolved', BANDS[0], true);
  }
  // Detections whose package row is gone: counted by the overview (which reads
  // the detection table alone), never by the tab count (INNER JOIN package).
  addSca(P, 'main', null, 'to_verify', BANDS[0], false);
  addSca(P, '', null, 'confirmed', BANDS[2], false);
  addSca(Q, 'main', null, 'resolved', BANDS[3], false);
  await dataSource.getRepository(ScaVulnerabilityDetections).insert(scaRows);
  await dataSource.getRepository(ScaAutoFixRecord).insert(scaAutofix);

  return { codeIds, scaIds, scaPackageIds };
}

/**
 * A ResultService over the live repositories, without Nest: only what the
 * counters and the project overview read. `extra` replaces or adds fields.
 */
export function liveResultService(
  dataSource: DataSource,
  extra: Record<string, unknown> = {},
): ResultService {
  return Object.assign(
    Object.create(ResultService.prototype) as ResultService,
    {
      sastVulnDetectRepository: dataSource.getRepository(
        SastVulnerabilityDetections,
      ),
      iacVulnDetectRepository: dataSource.getRepository(
        IacVulnerabilityDetections,
      ),
      cicdVulnDetectRepository: dataSource.getRepository(
        CicdVulnerabilityDetections,
      ),
      secretVulnDetectRepository: dataSource.getRepository(
        SecretVulnerabilityDetections,
      ),
      scaVulnDetectRepository: dataSource.getRepository(
        ScaVulnerabilityDetections,
      ),
      containerVulnDetectRepository: dataSource.getRepository(
        VulnerabilityDetectionsContainer,
      ),
      aibom: { countMergedComponents: async () => 0 },
      ...extra,
    },
  );
}
