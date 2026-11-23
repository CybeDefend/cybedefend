import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ident, nowPrecise, run, sql, upsert } from '@cybedefend/db-dialect';
import { OrganizationStatisticsEntity } from '../../entities/organization-statistics.entity';

export interface OrgStatsTimingsRow {
  /** DB clock (ms) — read in the same query to avoid worker-replica skew. */
  now: number;
  computedAt: number; // 0 when never computed
  lastEventAt: number; // 0 when never
  dirtySince: number; // 0 when clean
}

const toMs = (v: unknown): number =>
  v == null ? 0 : new Date(v as string).getTime();

@Injectable()
export class OrganizationStatisticsRepository {
  constructor(
    @InjectRepository(OrganizationStatisticsEntity)
    private readonly repo: Repository<OrganizationStatisticsEntity>,
  ) {}

  /**
   * Mark an org dirty: bump last_event_at (drives the trailing debounce) and
   * set dirty_since to the FIRST event of the cycle (COALESCE keeps it once
   * set). Uses the DB clock so all replicas agree. O(1), idempotent.
   */
  async markDirty(organizationId: string): Promise<void> {
    const q = upsert(
      'organization_statistics',
      {
        organization_id: organizationId,
        last_event_at: nowPrecise(3),
        dirty_since: nowPrecise(3),
      },
      {
        conflict: ['organization_id'],
        update: {
          last_event_at: nowPrecise(3),
          dirty_since: sql`COALESCE(${ident('organization_statistics.dirty_since')}, ${nowPrecise(3)})`,
        },
      },
    );
    await this.repo.query(q.text, q.params);
  }

  /**
   * Mark an org dirty ONLY if its row exists, never inserting one (the
   * data purge marks the organization of a purged project; in an organization
   * delete, the organization job has already removed this row and an INSERT
   * would re-create it for an organization that no longer exists). Returns
   * whether a row was marked. Throws on an unknown result shape.
   */
  async markDirtyIfPresent(organizationId: string): Promise<boolean> {
    const { affected } = await run(
      this.repo.manager.connection,
      sql`UPDATE organization_statistics
          SET last_event_at = ${nowPrecise(3)},
              dirty_since = COALESCE(dirty_since, ${nowPrecise(3)})
        WHERE organization_id = ${organizationId}`,
    );
    if (typeof affected !== 'number') {
      throw new Error('organization_statistics UPDATE: unknown result shape');
    }
    // Matched rows on both engines (mysql2 found rows, pg rowCount): 1 means
    // the row exists and was marked.
    return affected === 1;
  }

  /** Read the debounce timings + the DB clock in a single query. */
  async readTimings(
    organizationId: string,
  ): Promise<OrgStatsTimingsRow | null> {
    const q = sql`SELECT
         computed_at   AS ${ident('computedAt')},
         last_event_at AS ${ident('lastEventAt')},
         dirty_since   AS ${ident('dirtySince')},
         ${nowPrecise(3)} AS ${ident('dbNow')}
       FROM organization_statistics
       WHERE organization_id = ${organizationId}`;
    const rows = (await this.repo.query(q.text, q.params)) as Array<{
      computedAt: string | Date | null;
      lastEventAt: string | Date | null;
      dirtySince: string | Date | null;
      dbNow: string | Date;
    }>;
    if (!rows || rows.length === 0) return null;
    const r = rows[0];
    return {
      now: toMs(r.dbNow),
      computedAt: toMs(r.computedAt),
      lastEventAt: toMs(r.lastEventAt),
      dirtySince: toMs(r.dirtySince),
    };
  }

  async findByOrgId(
    organizationId: string,
  ): Promise<OrganizationStatisticsEntity | null> {
    return this.repo.findOne({ where: { organizationId } });
  }

  /**
   * Persist a freshly computed payload. Clears dirty_since ONLY if no event
   * landed during the compute (last_event_at <= computeStart); otherwise the
   * cycle stays dirty so the caller re-enqueues a catch-up. Returns whether the
   * org is still dirty after the write.
   */
  async finishCompute(
    organizationId: string,
    stats: Record<string, number>,
    computeStartMs: number,
  ): Promise<{ stillDirty: boolean }> {
    const computeStart = new Date(computeStartMs);
    const update = sql`UPDATE organization_statistics
         SET stats = ${JSON.stringify(stats)},
             computed_at = ${nowPrecise(3)},
             dirty_since = CASE WHEN last_event_at > ${computeStart} THEN dirty_since ELSE NULL END
       WHERE organization_id = ${organizationId}`;
    await this.repo.query(update.text, update.params);
    const read = sql`SELECT dirty_since AS ${ident('dirtySince')} FROM organization_statistics WHERE organization_id = ${organizationId}`;
    const rows = (await this.repo.query(read.text, read.params)) as Array<{
      dirtySince: string | Date | null;
    }>;
    return { stillDirty: !!rows?.[0]?.dirtySince };
  }

  /** Upsert a computed payload for a brand-new org (synchronous first read). */
  async saveInitial(
    organizationId: string,
    stats: Record<string, number>,
  ): Promise<void> {
    const q = upsert(
      'organization_statistics',
      {
        organization_id: organizationId,
        stats: JSON.stringify(stats),
        computed_at: nowPrecise(3),
      },
      {
        conflict: ['organization_id'],
        update: { stats: 'excluded', computed_at: nowPrecise(3) },
      },
    );
    await this.repo.query(q.text, q.params);
  }
}
