import { status } from '@grpc/grpc-js';
import { Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { Logger } from 'nestjs-pino';
import { DataSource } from 'typeorm';
import { deleteBatch, ident, run, sql } from '@cybedefend/db-dialect';
import { PurgeDataResponse } from '@grpc/data-purge/data_purge';
import { StoragePurge } from './storage-purge';

/** A purge call stops starting new work after this long. */
export const PURGE_CALL_BUDGET_MS = 60_000;

/** Rows deleted per statement. */
export const PURGE_BATCH_SIZE = 1000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PurgeTable {
  table: string;
  column: string;
}

/** Tables deleted for a project, after its objects. */
export const PROJECT_PURGE_TABLES: readonly PurgeTable[] = [
  { table: 'file_scan', column: 'projectId' },
];
/** No table of this service is keyed by a team: only report folders. */
export const TEAM_PURGE_TABLES: readonly PurgeTable[] = [];
/** No table of this service is keyed by an organization: only report folders. */
export const ORGANIZATION_PURGE_TABLES: readonly PurgeTable[] = [];
/** Tables keyed by a project, team or organization and deliberately kept (table → reason). */
export const KEPT_TABLES: Readonly<Record<string, string>> = {};

type ObjectKey =
  | 'objects:scan'
  | 'objects:filtered'
  | 'objects:reports'
  | 'objects:import';

interface PrefixStep {
  prefix: string;
  key: ObjectKey;
}

function invalidArgument(): RpcException {
  return new RpcException({
    code: status.INVALID_ARGUMENT,
    message: 'INVALID_ARGUMENT',
  });
}

/** Lower-cased: objects are stored under the lower-case id global-management generates. */
function requireUuid(id: unknown): string {
  if (typeof id !== 'string' || !UUID.test(id)) throw invalidArgument();
  return id.toLowerCase();
}

/**
 * Purges what file-management holds for a deleted project, team or
 * organization: every object under its folders, every version and delete
 * marker included, then the project's `file_scan` rows. Idempotent and
 * time-boxed: a call past its deadline answers `complete: false`, and the
 * next call continues where it stopped.
 */
@Injectable()
export class DataPurgeService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly storage: StoragePurge,
    private readonly logger: Logger,
  ) {}

  async purgeProject(
    projectId: string,
    organizationId: string,
    deadline: number,
  ): Promise<PurgeDataResponse> {
    const pid = requireUuid(projectId);
    requireUuid(organizationId);

    return this.guard('project', async () => {
      const deleted: Record<string, number> = {
        'objects:scan': 0,
        'objects:filtered': 0,
        'objects:reports': 0,
        'objects:import': 0,
      };
      const objectsDone = await this.purgePrefixes(
        [
          { prefix: `scan/${pid}/`, key: 'objects:scan' },
          { prefix: `filtered/${pid}/`, key: 'objects:filtered' },
          { prefix: `reports/${pid}/`, key: 'objects:reports' },
          { prefix: `import/${pid}/`, key: 'objects:import' },
        ],
        deadline,
        deleted,
      );
      deleted.file_scan = 0;
      // The rows go last, and only once every object is gone.
      if (!objectsDone || Date.now() >= deadline) {
        return { complete: false, deleted };
      }
      let complete = true;
      for (const t of PROJECT_PURGE_TABLES) {
        const res = await this.deleteInBatches(t, pid, deadline);
        deleted[t.table] = res.deleted;
        if (!res.complete) {
          complete = false;
          break;
        }
      }
      return { complete, deleted };
    });
  }

  async purgeTeam(
    teamId: string,
    organizationId: string,
    deadline: number,
  ): Promise<PurgeDataResponse> {
    const tid = requireUuid(teamId);
    requireUuid(organizationId);

    return this.guard('team', async () => {
      const deleted: Record<string, number> = { 'objects:reports': 0 };
      const complete = await this.purgePrefixes(
        [{ prefix: `reports/${tid}/`, key: 'objects:reports' }],
        deadline,
        deleted,
      );
      return { complete, deleted };
    });
  }

  async purgeOrganization(
    organizationId: string,
    teamIds: string[],
    deadline: number,
  ): Promise<PurgeDataResponse> {
    const oid = requireUuid(organizationId);
    const tids = [...new Set((teamIds ?? []).map(requireUuid))];

    return this.guard('organization', async () => {
      const deleted: Record<string, number> = { 'objects:reports': 0 };
      const complete = await this.purgePrefixes(
        [oid, ...tids].map((id) => ({
          prefix: `reports/${id}/`,
          key: 'objects:reports' as const,
        })),
        deadline,
        deleted,
      );
      return { complete, deleted };
    });
  }

  /** Runs the steps in order; the first one always runs, the next ones only before the deadline. */
  private async purgePrefixes(
    steps: PrefixStep[],
    deadline: number,
    deleted: Record<string, number>,
  ): Promise<boolean> {
    for (let i = 0; i < steps.length; i++) {
      if (i > 0 && Date.now() >= deadline) return false;
      const res = await this.storage.purgePrefix(steps[i].prefix, deadline);
      deleted[steps[i].key] += res.deleted;
      if (!res.complete) return false;
    }
    return true;
  }

  private async deleteInBatches(
    t: PurgeTable,
    value: string,
    deadline: number,
  ): Promise<{ deleted: number; complete: boolean }> {
    let deleted = 0;
    for (;;) {
      // `DELETE … LIMIT n` on MySQL, `ctid IN (SELECT … LIMIT n)` on
      // PostgreSQL; `run(...).affected` is the matched row count on both.
      const res = await run(
        this.dataSource,
        deleteBatch(
          t.table,
          sql`${ident(t.column)} = ${value}`,
          PURGE_BATCH_SIZE,
        ),
      );
      deleted += res.affected;
      if (res.affected < PURGE_BATCH_SIZE) return { deleted, complete: true };
      if (Date.now() >= deadline) return { deleted, complete: false };
    }
  }

  /** Fails closed with nothing but the gRPC code: the runner retries. */
  private async guard(
    scope: string,
    run: () => Promise<PurgeDataResponse>,
  ): Promise<PurgeDataResponse> {
    try {
      return await run();
    } catch (err) {
      const e = err as { name?: string; code?: unknown };
      this.logger.error(
        { scope, errorName: e?.name, errorCode: e?.code },
        'DATA_PURGE_FAILED',
      );
      throw new RpcException({
        code: status.UNAVAILABLE,
        message: 'UNAVAILABLE',
      });
    }
  }
}
