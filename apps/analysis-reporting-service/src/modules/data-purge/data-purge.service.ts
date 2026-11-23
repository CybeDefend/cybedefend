import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { DataSource } from 'typeorm';
import type { PurgeDataResponse } from '@grpc/data-purge/data_purge';
import {
  PURGE_TABLE_EXTENSIONS,
  PurgeTableExtension,
} from '../../edition/ports/purge-table-extensions.port';
import { ScanQueueService } from '../scan-queue/scan-queue.service';
import { OrganizationStatisticsService } from '../organization-statistics/organization-statistics.service';
import { deleteInBatches, PURGE_BATCH_SIZE } from './batched-delete';
import {
  ORGANIZATION_PURGE_TABLES,
  organizationRedisKeys,
  PROJECT_PURGE_TABLES,
  projectRedisKeys,
  PurgeTable,
  TEAM_PURGE_TABLES,
} from './purge-tables';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Refuses anything but a UUID before it can reach a WHERE or a key pattern. */
function assertUuid(id: unknown): asserts id is string {
  if (typeof id !== 'string' || !UUID.test(id)) {
    throw new RpcException({
      code: status.INVALID_ARGUMENT,
      message: 'INVALID_ARGUMENT',
    });
  }
}

/**
 * Deletes everything analysis-reporting holds for a deleted project, team or
 * organization, in batches, bounded by a deadline. A call that reaches its
 * deadline answers `complete: false` and the next call continues; a call on
 * data already gone deletes nothing and answers `complete: true`. Any error
 * propagates (fail closed).
 */
@Injectable()
export class DataPurgeService {
  private readonly logger = new Logger(DataPurgeService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly scanQueueService: ScanQueueService,
    private readonly organizationStatisticsService: OrganizationStatisticsService,
    // The closed tables and Redis keys, supplied by EePurgeModule in
    // the cloud. Absent in the Community Edition: the core lists only, so a
    // Community database never names a table it lacks.
    @Optional()
    @Inject(PURGE_TABLE_EXTENSIONS)
    private readonly purgeExtensions?: PurgeTableExtension,
  ) {}

  async purgeProject(
    projectId: string,
    organizationId: string,
    deadline: number,
  ): Promise<PurgeDataResponse> {
    assertUuid(projectId);
    // Not used in any WHERE here; older callers of the legacy delete send ''.
    if (organizationId) assertUuid(organizationId);

    const deleted: Record<string, number> = {};
    const tables = [
      ...PROJECT_PURGE_TABLES,
      ...(this.purgeExtensions?.project ?? []),
    ].map((t) => ({
      ...t,
      value: projectId,
    }));
    if (!(await this.runTables(tables, deadline, deleted))) {
      return { complete: false, deleted };
    }
    if (Date.now() >= deadline) return { complete: false, deleted };
    // A queued cvss-recalc job is a BullMQ job id, not a key: it is left to the
    // queue's retention and to the second purge pass.
    deleted.redis = await this.deleteKeys([
      ...projectRedisKeys(projectId),
      ...(this.purgeExtensions?.projectRedisKeys(projectId) ?? []),
    ]);
    // The organization's persisted KPI cards must be recomputed
    // without the project. Once, on the call that completes the purge.
    if (organizationId) await this.markStatisticsDirty(organizationId);
    this.logger.log(
      `Purged project ${projectId}: ${this.total(deleted)} rows and keys`,
    );
    return { complete: true, deleted };
  }

  async purgeTeam(
    teamId: string,
    organizationId: string,
    deadline: number,
  ): Promise<PurgeDataResponse> {
    assertUuid(teamId);
    if (organizationId) assertUuid(organizationId);

    const deleted: Record<string, number> = {};
    const tables = [
      ...TEAM_PURGE_TABLES,
      ...(this.purgeExtensions?.team ?? []),
    ].map((t) => ({ ...t, value: teamId }));
    const complete = await this.runTables(tables, deadline, deleted);
    return { complete, deleted };
  }

  async purgeOrganization(
    organizationId: string,
    teamIds: string[],
    deadline: number,
  ): Promise<PurgeDataResponse> {
    assertUuid(organizationId);
    const teams = teamIds ?? [];
    teams.forEach((id) => assertUuid(id));

    const deleted: Record<string, number> = {};
    const tables = [
      ...ORGANIZATION_PURGE_TABLES.map((t) => ({
        ...t,
        value: organizationId,
      })),
      ...(this.purgeExtensions?.organization ?? []).map((t) => ({
        ...t,
        value: organizationId,
      })),
      // A team report written before organization_id was set has none.
      ...teams.flatMap((teamId) =>
        TEAM_PURGE_TABLES.map((t) => ({ ...t, value: teamId })),
      ),
    ];
    if (!(await this.runTables(tables, deadline, deleted))) {
      return { complete: false, deleted };
    }
    if (Date.now() >= deadline) return { complete: false, deleted };
    deleted.redis = await this.deleteKeys([
      ...organizationRedisKeys(organizationId),
      ...(this.purgeExtensions?.organizationRedisKeys(organizationId) ?? []),
    ]);
    this.logger.log(
      `Purged organization ${organizationId}: ${this.total(deleted)} rows and keys`,
    );
    return { complete: true, deleted };
  }

  /**
   * Runs each table's batched delete in order. Returns false (not complete)
   * when the deadline stops it. The first statement always runs, so a call
   * whose deadline already passed still deletes one batch.
   */
  private async runTables(
    tables: (PurgeTable & { value: string })[],
    deadline: number,
    deleted: Record<string, number>,
  ): Promise<boolean> {
    for (let i = 0; i < tables.length; i++) {
      const { table, column, where, match, value } = tables[i];
      if (i > 0 && Date.now() >= deadline) return false;
      const res = await deleteInBatches(
        this.dataSource,
        table,
        column,
        value,
        deadline,
        PURGE_BATCH_SIZE,
        where,
        match,
      );
      deleted[table] = (deleted[table] ?? 0) + res.deleted;
      if (!res.complete) return false;
    }
    return true;
  }

  private async deleteKeys(keys: string[]): Promise<number> {
    if (keys.length === 0) return 0;
    const redis = await this.scanQueueService.getRedisClient();
    return Number(await redis.del(...keys));
  }

  /** Derived data: a failure is logged and never fails the purge. */
  private async markStatisticsDirty(organizationId: string): Promise<void> {
    try {
      // UPDATE only. In an organization delete the organization job has
      // removed the row; an inserting mark would re-create it.
      await this.organizationStatisticsService.markDirtyIfPresent(
        organizationId,
      );
    } catch (err) {
      this.logger.warn(
        `Organization statistics not marked dirty after a project purge: ${
          (err as Error)?.name ?? 'Error'
        }`,
      );
    }
  }

  private total(deleted: Record<string, number>): number {
    return Object.values(deleted).reduce((a, b) => a + b, 0);
  }
}
