import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { DataSource, In, type QueryDeepPartialEntity } from 'typeorm';
import { Logger } from 'nestjs-pino';
import { ImportSeverity } from './sarif/sarif-mapper';
import { ScanQueueService } from '../scan-queue/scan-queue.service';
import { VulnerabilityOsv } from '../../entities/osv/vulnerability-osv.entity';
import { VulnerabilityOsvAlias } from '../../entities/osv/vulnerability-osv-alias.entity';
import { VulnerabilityOsvSeverity } from '../../entities/osv/vulnerability-osv-severity.entity';
import { VulnerabilityOsvReference } from '../../entities/osv/vulnerability-osv-reference.entity';
import { VulnerabilityOsvAffected } from '../../entities/osv/vulnerability-osv-affected.entity';
import { VulnerabilityOsvAffectedRange } from '../../entities/osv/vulnerability-osv-affected-range.entity';
import { VulnerabilityOsvAffectedEvent } from '../../entities/osv/vulnerability-osv-affected-event.entity';

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

/** The varchar(255) columns: the root id, alias, ecosystem, packageName, fixed. */
const MAX_VARCHAR = 255;
/**
 * Cut before the insert so MySQL's INSERT IGNORE has no truncation warning to
 * hide: the summary and details columns are wider, but the values are
 * cut to the documented bounds all the same.
 */
const MAX_SUMMARY = 1_000;
const MAX_DETAILS = 20_000;

const cut = (value: string | undefined, max: number): string =>
  (value ?? '').slice(0, max);

/** Only an https URI becomes a reference row. */
const httpsUriOf = (uri: string): string => {
  if (!uri) return '';
  try {
    return new URL(uri).protocol === 'https:' ? uri : '';
  } catch {
    return '';
  }
};

interface MergedAdvisory {
  input: AdvisoryInput;
  aliases: string[];
  fixes: AdvisoryFix[];
}

const fixKey = (fix: AdvisoryFix): string =>
  `${fix.ecosystem}\u0000${fix.packageName}\u0000${fix.fixed}`;

/**
 * Advisory fallback for imported SCA and container results. In the Community Edition no OSV sync
 * writes the advisory tables, so an imported advisory exists only if this
 * service writes it. It inserts what is absent and NEVER updates an existing
 * row: the root insert is `orIgnore()` (`INSERT IGNORE` on MySQL, `ON CONFLICT
 * DO NOTHING` on PostgreSQL — never `orUpdate`, which would rewrite the row
 * and fire the `updatedAt` trigger of the PostgreSQL baseline), and the child
 * rows have no unique key, so they are written under the per-advisory
 * detection creation lock, after a read of what the advisory already has.
 *
 * Portable on both engines: query builder and EntityManager only, never
 * raw SQL text, never a MySQL error code.
 *
 * Logs carry advisory ids and counts only, never a summary, details or a URL.
 */
@Injectable()
export class AdvisoryFallbackService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly scanQueue: ScanQueueService,
    private readonly logger: Logger,
  ) {}

  /**
   * Writes what is absent for `items`.
   *
   * @returns the advisory rows of `items`, as stored, with `severities` and
   *   `aliases` loaded, keyed by id.
   */
  async ensureAdvisories(
    items: AdvisoryInput[],
  ): Promise<Map<string, VulnerabilityOsv>> {
    // 1. Merge by id: the first item of an id gives the root fields; aliases
    //    and fixes are the union over every item of that id.
    const merged = new Map<string, MergedAdvisory>();
    for (const item of items) {
      const id = cut(item.id, MAX_VARCHAR);
      const existing = merged.get(id);
      if (existing) {
        for (const alias of item.aliases) {
          if (!existing.aliases.includes(alias)) existing.aliases.push(alias);
        }
        for (const fix of item.fixes) {
          if (!existing.fixes.some((f) => fixKey(f) === fixKey(fix))) {
            existing.fixes.push(fix);
          }
        }
      } else {
        merged.set(id, {
          input: item,
          aliases: [...item.aliases],
          fixes: [...item.fixes],
        });
      }
    }
    const ids = [...merged.keys()];
    if (ids.length === 0) {
      this.logger.log('ADVISORY_FALLBACK roots_created=0 children_created=0');
      return new Map();
    }

    // 2. Roots: one multi-row insert with orIgnore, so an existing row is
    //    never touched on either engine. Every value is cut to its column
    //    first; every other column keeps its default.
    const existingRows = (await this.dataSource
      .createQueryBuilder(VulnerabilityOsv, 'v')
      .select('v.id', 'id')
      .where('v.id IN (:...ids)', { ids })
      .getRawMany()) as Array<{ id: string }>;
    const existingIds = new Set(existingRows.map((row) => row.id));
    const rootsCreated = ids.filter((id) => !existingIds.has(id)).length;

    const rootRows = ids.map((id) => {
      const entry = merged.get(id) as MergedAdvisory;
      return {
        id,
        summary: cut(entry.input.summary, MAX_SUMMARY),
        details: cut(entry.input.details, MAX_DETAILS),
        databaseSpecific: {
          cwe_ids: entry.input.cweIds,
          severity: entry.input.severity.toUpperCase(),
          source: `sarif:${entry.input.toolName}`,
        },
      } as unknown as QueryDeepPartialEntity<VulnerabilityOsv>;
    });
    await this.dataSource
      .createQueryBuilder()
      .insert()
      .into(VulnerabilityOsv)
      .values(rootRows)
      .orIgnore()
      .updateEntity(false)
      .execute();

    // 3. Children, one advisory at a time, under the per-advisory lock, in one
    //    transaction per advisory.
    let childrenCreated = 0;
    for (const id of ids) {
      const entry = merged.get(id) as MergedAdvisory;
      const lockKey = `advisory:${id}`;
      let token: string | null = null;
      try {
        token = await this.scanQueue.acquireDetectionCreationLock(lockKey);
      } catch {
        token = null;
      }
      if (!token) {
        this.logger.warn(`ADVISORY_FALLBACK_LOCK_SKIPPED advisory=${id}`);
      }
      try {
        childrenCreated += await this.writeChildren(id, entry);
      } finally {
        if (token) {
          await this.scanQueue.releaseDetectionCreationLock(lockKey, token);
        }
      }
    }

    // 4. Read the rows of every id back, with severities and aliases loaded.
    const rows = await this.dataSource.manager.find(VulnerabilityOsv, {
      where: { id: In(ids) },
      relations: ['severities', 'aliases'],
    });
    this.logger.log(
      `ADVISORY_FALLBACK roots_created=${rootsCreated} children_created=${childrenCreated}`,
    );
    return new Map(rows.map((row) => [row.id, row]));
  }

  /**
   * Reads the advisory's existing children and inserts the missing ones, in
   * one transaction. Reads and inserts go through the transaction's
   * EntityManager; every child id is set by the caller and the inserts run
   * with `updateEntity(false)`.
   *
   * @returns how many child rows it created.
   */
  private async writeChildren(
    id: string,
    entry: MergedAdvisory,
  ): Promise<number> {
    return this.dataSource.transaction(async (manager) => {
      const [aliases, severities, references, affected] = await Promise.all([
        manager.find(VulnerabilityOsvAlias, {
          where: { vulnerability: { id } },
          select: ['alias'],
        }),
        manager.find(VulnerabilityOsvSeverity, {
          where: { vulnerability: { id } },
          select: ['type'],
        }),
        manager.find(VulnerabilityOsvReference, {
          where: { vulnerability: { id } },
          select: ['url'],
        }),
        manager.find(VulnerabilityOsvAffected, {
          where: { vulnerability: { id } },
          relations: { ranges: { events: true } },
        }),
      ]);
      const aliasSet = new Set(aliases.map((row) => row.alias));
      const severityTypes = new Set(severities.map((row) => row.type));
      const refUrls = new Set(references.map((row) => row.url));
      const fixTuples = new Set<string>();
      for (const aff of affected) {
        for (const range of aff.ranges ?? []) {
          for (const event of range.events ?? []) {
            fixTuples.add(
              `${aff.ecosystem}\u0000${aff.packageName}\u0000${event.fixed ?? ''}`,
            );
          }
        }
      }

      let created = 0;
      const item = entry.input;

      const aliasRows = entry.aliases
        .filter((alias) => !aliasSet.has(alias))
        .map(
          (alias) =>
            ({
              id: randomUUID(),
              alias: cut(alias, MAX_VARCHAR),
              vulnerability: { id },
            }) as unknown as QueryDeepPartialEntity<VulnerabilityOsvAlias>,
        );
      if (aliasRows.length > 0) {
        await manager
          .createQueryBuilder()
          .insert()
          .into(VulnerabilityOsvAlias)
          .values(aliasRows)
          .updateEntity(false)
          .execute();
        created += aliasRows.length;
      }

      const severityRows: QueryDeepPartialEntity<VulnerabilityOsvSeverity>[] =
        [];
      if (!severityTypes.has('DATABASE_SPECIFIC')) {
        severityRows.push({
          id: randomUUID(),
          type: 'DATABASE_SPECIFIC',
          score: item.severity.toUpperCase(),
          vulnerability: { id },
        } as unknown as QueryDeepPartialEntity<VulnerabilityOsvSeverity>);
      }
      if (item.cvssV3Vector && !severityTypes.has('CVSS_V3')) {
        severityRows.push({
          id: randomUUID(),
          type: 'CVSS_V3',
          score: item.cvssV3Vector,
          vulnerability: { id },
        } as unknown as QueryDeepPartialEntity<VulnerabilityOsvSeverity>);
      }
      if (severityRows.length > 0) {
        await manager
          .createQueryBuilder()
          .insert()
          .into(VulnerabilityOsvSeverity)
          .values(severityRows)
          .updateEntity(false)
          .execute();
        created += severityRows.length;
      }

      const helpUri = httpsUriOf(item.helpUri);
      if (helpUri !== '' && !refUrls.has(helpUri)) {
        await manager
          .createQueryBuilder()
          .insert()
          .into(VulnerabilityOsvReference)
          .values({
            id: randomUUID(),
            type: 'ADVISORY',
            url: helpUri,
            vulnerability: { id },
          } as unknown as QueryDeepPartialEntity<VulnerabilityOsvReference>)
          .updateEntity(false)
          .execute();
        created += 1;
      }

      const missingFixes = entry.fixes.filter(
        (fix) => !fixTuples.has(fixKey(fix)),
      );
      if (missingFixes.length > 0) {
        const affectedRows = missingFixes.map(
          (fix) =>
            ({
              id: randomUUID(),
              ecosystem: cut(fix.ecosystem, MAX_VARCHAR),
              packageName: cut(fix.packageName, MAX_VARCHAR),
              severity: null,
              vulnerability: { id },
            }) as unknown as QueryDeepPartialEntity<VulnerabilityOsvAffected>,
        );
        await manager
          .createQueryBuilder()
          .insert()
          .into(VulnerabilityOsvAffected)
          .values(affectedRows)
          .updateEntity(false)
          .execute();
        const rangeRows = affectedRows.map(
          (aff) =>
            ({
              id: randomUUID(),
              type: 'ECOSYSTEM',
              affected: { id: aff.id as string },
            }) as unknown as QueryDeepPartialEntity<VulnerabilityOsvAffectedRange>,
        );
        await manager
          .createQueryBuilder()
          .insert()
          .into(VulnerabilityOsvAffectedRange)
          .values(rangeRows)
          .updateEntity(false)
          .execute();
        const eventRows = missingFixes.map(
          (fix, index) =>
            ({
              id: randomUUID(),
              fixed: cut(fix.fixed, MAX_VARCHAR),
              range: { id: rangeRows[index].id as string },
            }) as unknown as QueryDeepPartialEntity<VulnerabilityOsvAffectedEvent>,
        );
        await manager
          .createQueryBuilder()
          .insert()
          .into(VulnerabilityOsvAffectedEvent)
          .values(eventRows)
          .updateEntity(false)
          .execute();
        created += missingFixes.length * 3;
      }

      return created;
    });
  }
}
