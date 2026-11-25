import { Injectable } from '@nestjs/common';
import { DataSource, type QueryDeepPartialEntity } from 'typeorm';
import { Logger } from 'nestjs-pino';
import { ImportSeverity } from './sarif/sarif-mapper';
import { withAdvisoryLock } from '@cybedefend/db-dialect';
import { VulnerabilityOsv } from '../../entities/osv/vulnerability-osv.entity';
import { ImportedAdvisory } from '../../entities/imported-advisory.entity';
import {
  IMPORTED_ADVISORY_LIMITS,
  ImportedAdvisoryContent,
  loadImportedAdvisories,
} from './imported-advisory.view';

export interface AdvisoryFix {
  ecosystem: string;
  packageName: string;
  fixed: string;
}

export interface AdvisoryInput {
  /** ≤ 255 characters (the caller refuses longer). */
  id: string;
  /** Sanitised. */
  toolName: string;
  summary: string;
  details: string;
  /** 'CWE-<n>' strings. */
  cweIds: string[];
  severity: ImportSeverity;
  cvssV3Vector: string | null;
  /** https or ''. */
  helpUri: string;
  aliases: string[];
  /** One per fixed version. */
  fixes: AdvisoryFix[];
}

/** The project an import writes for, and the import itself. */
export interface AdvisoryScope {
  projectId: string;
  /** The project's organization; null when the job does not carry it. */
  organizationId: string | null;
  /** The import scan. */
  scanId: string;
}

/** The varchar(255) columns: the advisory id, an alias, ecosystem, packageName, fixed, a URL. */
const MAX_VARCHAR = 255;
/** The summary and details are cut to these bounds. */
const MAX_SUMMARY = 1_000;
const MAX_DETAILS = 20_000;
/** Rows per multi-row write. */
const WRITE_CHUNK = 200;
/** How long a batch waits for the project's lock before it fails. */
const PROJECT_LOCK_TIMEOUT_S = 60;

const cut = (value: string | null | undefined, max: number): string =>
  (value ?? '').slice(0, max);

/** Only an https URI is kept as a reference. */
const httpsUriOf = (uri: string): string => {
  if (!uri || uri.length > 2_048) return '';
  try {
    return new URL(uri).protocol === 'https:' ? uri : '';
  } catch {
    return '';
  }
};

const fixKey = (fix: AdvisoryFix): string =>
  `${fix.ecosystem}\u0000${fix.packageName}\u0000${fix.fixed}`;

/** Appends the values of `more` absent from `into`, up to `max` in all. */
function addUnique<T>(
  into: T[],
  more: readonly T[],
  max: number,
  key: (value: T) => string = String,
): void {
  const seen = new Set(into.map(key));
  for (const value of more) {
    if (into.length >= max) return;
    const k = key(value);
    if (seen.has(k)) continue;
    seen.add(k);
    into.push(value);
  }
}

/** One stored content per advisory id, from the first item of that id. */
function contentOf(item: AdvisoryInput, id: string): ImportedAdvisoryContent {
  const content: ImportedAdvisoryContent = {
    advisoryId: id,
    toolName: cut(item.toolName, MAX_VARCHAR),
    summary: cut(item.summary, MAX_SUMMARY),
    details: cut(item.details, MAX_DETAILS),
    severity: item.severity,
    cvssV3Vector: item.cvssV3Vector
      ? cut(item.cvssV3Vector, MAX_VARCHAR)
      : null,
    cweIds: [],
    aliases: [],
    referenceUrls: [],
    fixes: [],
  };
  addInto(content, item);
  return content;
}

/** Adds an item's collections to a content, each bounded. */
function addInto(content: ImportedAdvisoryContent, item: AdvisoryInput): void {
  addUnique(
    content.cweIds,
    item.cweIds.map((cwe) => cut(cwe, MAX_VARCHAR)),
    IMPORTED_ADVISORY_LIMITS.cweIds,
  );
  addUnique(
    content.aliases,
    item.aliases.map((alias) => cut(alias, MAX_VARCHAR)).filter(Boolean),
    IMPORTED_ADVISORY_LIMITS.aliases,
  );
  const helpUri = httpsUriOf(item.helpUri);
  if (helpUri) {
    addUnique(
      content.referenceUrls,
      [helpUri],
      IMPORTED_ADVISORY_LIMITS.referenceUrls,
    );
  }
  addUnique(
    content.fixes,
    item.fixes.map((fix) => ({
      ecosystem: cut(fix.ecosystem, MAX_VARCHAR),
      packageName: cut(fix.packageName, MAX_VARCHAR),
      fixed: cut(fix.fixed, MAX_VARCHAR),
    })),
    IMPORTED_ADVISORY_LIMITS.fixes,
    fixKey,
  );
}

/**
 * Advisory fallback for imported SCA and container results.
 *
 * What an import declares about an advisory (summary, details, severity,
 * CVSS vector, CWE ids, aliases, references, fixed versions) belongs to the
 * project it was imported into: it is upserted into `imported_advisory`, one
 * row per (project, advisory). The batches of one import add to the row; the
 * project's next import replaces it. Every collection is bounded
 * (IMPORTED_ADVISORY_LIMITS).
 *
 * The shared advisory catalogue (`vulnerability_osv` and its children)
 * receives nothing an import chose: only a root row holding the advisory id
 * when the id is unknown, so a detection can reference it (`orIgnore`: an
 * existing row is never touched), and never a child row.
 *
 * The read-merge-write of a project's rows runs under a database advisory
 * lock of that project (withAdvisoryLock), so two batches of one import that
 * run at once both keep their part. Portable on both engines: query builder and
 * EntityManager only.
 *
 * Logs carry counts only, never an advisory text or a URL.
 */
@Injectable()
export class AdvisoryFallbackService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly logger: Logger,
  ) {}

  /** Stores the advisory content of `items` for `scope.projectId`. */
  async ensureAdvisories(
    scope: AdvisoryScope,
    items: AdvisoryInput[],
  ): Promise<void> {
    const incoming = new Map<string, AdvisoryInput[]>();
    for (const item of items) {
      const id = cut(item.id, MAX_VARCHAR);
      if (!id) continue;
      incoming.set(id, [...(incoming.get(id) ?? []), item]);
    }
    const ids = [...incoming.keys()];
    if (ids.length === 0) {
      this.logger.log('ADVISORY_FALLBACK roots_created=0 advisories=0');
      return;
    }

    // 1. The id-only roots the detections reference.
    const existingRoots = new Set<string>();
    for (let i = 0; i < ids.length; i += WRITE_CHUNK) {
      const rows = (await this.dataSource
        .createQueryBuilder(VulnerabilityOsv, 'v')
        .select('v.id', 'id')
        .where('v.id IN (:...chunk)', { chunk: ids.slice(i, i + WRITE_CHUNK) })
        .getRawMany()) as Array<{ id: string }>;
      for (const row of rows) existingRoots.add(row.id);
    }
    const missingRoots = ids.filter((id) => !existingRoots.has(id));
    for (let i = 0; i < missingRoots.length; i += WRITE_CHUNK) {
      await this.dataSource
        .createQueryBuilder()
        .insert()
        .into(VulnerabilityOsv)
        .values(
          missingRoots
            .slice(i, i + WRITE_CHUNK)
            .map((id) => ({ id }) as QueryDeepPartialEntity<VulnerabilityOsv>),
        )
        .orIgnore()
        .updateEntity(false)
        .execute();
    }

    // 2. The project's own rows, merged with what this import already wrote.
    // The read-merge-write runs under a database lock of the project: two
    // batches of one import that run at once both keep their part, and the
    // lock is never skipped (no write without it).
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    try {
      await withAdvisoryLock(
        runner,
        `imported-advisory:${scope.projectId}`,
        PROJECT_LOCK_TIMEOUT_S,
        () => this.writeProjectRows(scope, ids, incoming),
      );
    } finally {
      await runner.release();
    }
    this.logger.log(
      `ADVISORY_FALLBACK roots_created=${missingRoots.length} advisories=${ids.length}`,
    );
  }

  private async writeProjectRows(
    scope: AdvisoryScope,
    ids: string[],
    incoming: Map<string, AdvisoryInput[]>,
  ): Promise<void> {
    const stored = await loadImportedAdvisories(
      this.dataSource.manager,
      scope.projectId,
      ids,
    );
    const now = new Date();
    const rows = ids.map((id) => {
      const items = incoming.get(id) as AdvisoryInput[];
      const previous = stored.get(id);
      // A row of this same import keeps its root fields and gains the new
      // collections; a row of an earlier import is replaced.
      const content: ImportedAdvisoryContent =
        previous && previous.scanId === scope.scanId
          ? {
              advisoryId: id,
              toolName: previous.toolName,
              summary: previous.summary,
              details: previous.details,
              severity: previous.severity,
              cvssV3Vector: previous.cvssV3Vector,
              cweIds: [...(previous.cweIds ?? [])],
              aliases: [...(previous.aliases ?? [])],
              referenceUrls: [...(previous.referenceUrls ?? [])],
              fixes: [...(previous.fixes ?? [])],
            }
          : contentOf(items[0], id);
      for (const item of items) addInto(content, item);
      return {
        ...content,
        projectId: scope.projectId,
        organizationId: scope.organizationId || null,
        scanId: scope.scanId,
        createdAt: previous?.createdAt ?? now,
        updatedAt: now,
      } as QueryDeepPartialEntity<ImportedAdvisory>;
    });
    for (let i = 0; i < rows.length; i += WRITE_CHUNK) {
      await this.dataSource
        .createQueryBuilder()
        .insert()
        .into(ImportedAdvisory)
        .values(rows.slice(i, i + WRITE_CHUNK))
        .orUpdate(
          [
            'organizationId',
            'scanId',
            'toolName',
            'summary',
            'details',
            'severity',
            'cvssV3Vector',
            'cweIds',
            'aliases',
            'referenceUrls',
            'fixes',
            'updatedAt',
          ],
          ['projectId', 'advisoryId'],
        )
        .updateEntity(false)
        .execute();
    }
  }
}
