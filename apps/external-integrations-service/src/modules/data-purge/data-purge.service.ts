import { Inject, Injectable, Optional } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { Logger } from 'nestjs-pino';
import { DataSource } from 'typeorm';
import {
  deleteBatch,
  ident,
  run,
  sql,
  updateBatch,
} from '@cybedefend/db-dialect';
import type { Sql } from '@cybedefend/db-dialect';
import { PurgeDataResponse } from '@grpc/data-purge/data_purge';
import { IntegrationsAdminService } from '../integrations-admin/integrations-admin.service';
import {
  PURGE_TABLE_EXTENSIONS,
  type PurgeTableExtension,
} from '../../edition/ports/purge-table-extensions.port';
import {
  ORGANIZATION_INTEGRATION_TYPES,
  ORGANIZATION_PURGE_TABLES,
  PROJECT_PURGE_TABLES,
  PROJECT_UNLINK_TABLES,
  PURGE_BATCH_SIZE,
  PurgeTable,
} from './purge-tables';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One step of a purge: a fixed statement run in batches against one id. */
interface Step {
  key: string;
  query: Sql;
}

/**
 * Purges external-integrations' data of a deleted project or organization.
 *
 * Every statement is bounded (`LIMIT 1000`) and repeated until it touches
 * fewer rows than the batch; once the deadline is past no new statement
 * starts and the answer is `complete: false`, so the caller calls again and
 * the next call continues. A call that finds nothing left answers
 * `complete: true` with zero counts. Any failure answers an error (fail
 * closed), with nothing but the gRPC code in its message.
 *
 * No remote call: GitHub, GitLab, Jira and Slack are never contacted.
 */
@Injectable()
export class DataPurgeService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly integrationsAdmin: IntegrationsAdminService,
    private readonly logger: Logger,
    // The closed tables, supplied in the cloud only. Absent in the Community
    // Edition: the core lists only, so a Community database never names a
    // table it lacks.
    @Optional()
    @Inject(PURGE_TABLE_EXTENSIONS)
    private readonly purgeExtensions?: PurgeTableExtension,
  ) {}

  async purgeProject(
    projectId: string,
    organizationId: string,
    deadline: number,
  ): Promise<PurgeDataResponse> {
    assertUuids([projectId, organizationId]);
    return this.failClosed('project', async () => {
      const steps: Step[] = [
        ...PROJECT_UNLINK_TABLES.map((t) => ({
          key: t.table,
          // Bounded UPDATE on both engines: `LIMIT n` on MySQL, `ctid IN
          // (SELECT … LIMIT n)` on PostgreSQL.
          query: updateBatch(
            t.table,
            { projectId: null, scanBranch: null },
            sql`${ident(t.column)} = ${projectId}`,
            PURGE_BATCH_SIZE,
          ),
        })),
        ...[
          ...PROJECT_PURGE_TABLES,
          ...(this.purgeExtensions?.project ?? []),
        ].map((t) => deleteStep(t, projectId)),
      ];
      return this.runSteps(steps, deadline);
    });
  }

  async purgeOrganization(
    organizationId: string,
    teamIds: string[],
    deadline: number,
  ): Promise<PurgeDataResponse> {
    assertUuids([organizationId, ...(teamIds ?? [])]);
    return this.failClosed('organization', async () => {
      const result = await this.runSteps(
        [
          ...(this.purgeExtensions?.organization ?? []),
          ...ORGANIZATION_PURGE_TABLES,
        ].map((t) => deleteStep(t, organizationId)),
        deadline,
      );
      // The integrations go only once their repositories and branches are
      // gone, so their own cascade is bounded; and no new work past the
      // deadline.
      if (!result.complete || Date.now() >= deadline) {
        return { complete: false, deleted: result.deleted };
      }
      const counts = await this.integrationsAdmin.deleteIntegrationsForOrg(
        organizationId,
        ORGANIZATION_INTEGRATION_TYPES,
        { failClosed: true },
      );
      for (const [type, n] of Object.entries(counts)) {
        result.deleted[`integrations.${type}`] = n;
      }
      return result;
    });
  }

  private async runSteps(
    steps: readonly Step[],
    deadline: number,
  ): Promise<PurgeDataResponse> {
    const deleted: Record<string, number> = {};
    let ran = false;
    for (const step of steps) {
      // Past the deadline, start nothing new; but a call always makes
      // progress, at least one batch.
      if (ran && Date.now() >= deadline) {
        return { complete: false, deleted };
      }
      for (;;) {
        // `run(...).affected` is the matched row count on both engines
        // (mysql2 affectedRows, pg rowCount).
        const res = await run(this.dataSource, step.query);
        ran = true;
        const affected = res.affected;
        deleted[step.key] = (deleted[step.key] ?? 0) + affected;
        if (affected < PURGE_BATCH_SIZE) break;
        if (Date.now() >= deadline) return { complete: false, deleted };
      }
    }
    return { complete: true, deleted };
  }

  private async failClosed(
    scope: string,
    run: () => Promise<PurgeDataResponse>,
  ): Promise<PurgeDataResponse> {
    try {
      return await run();
    } catch (e) {
      // The exception class only: a driver message can quote SQL values.
      this.logger.error(
        { scope, err: (e as Error)?.constructor?.name ?? 'unknown' },
        'data purge failed',
      );
      throw new RpcException({ code: status.INTERNAL, message: 'INTERNAL' });
    }
  }
}

function deleteStep(t: PurgeTable, id: string): Step {
  const where = t.where ? t.where(id) : sql`${ident(t.column)} = ${id}`;
  return {
    key: t.table,
    query: deleteBatch(t.table, where, PURGE_BATCH_SIZE),
  };
}

function assertUuids(ids: readonly unknown[]): void {
  for (const id of ids) {
    if (typeof id !== 'string' || !UUID.test(id)) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'INVALID_ARGUMENT',
      });
    }
  }
}
