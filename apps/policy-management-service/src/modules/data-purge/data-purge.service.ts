import { Injectable, Logger } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { InjectDataSource } from '@nestjs/typeorm';
import { status } from '@grpc/grpc-js';
import { DataSource } from 'typeorm';
import { PurgeDataResponse } from '@core/grpc/data-purge/data_purge';
import {
  ORGANIZATION_PURGE_TABLES,
  PROJECT_PURGE_TABLES,
  PROJECT_TARGET_COLUMNS,
  PURGE_BATCH_SIZE,
  PurgeTable,
  TEAM_PURGE_TABLES,
  TEAM_TARGET_COLUMNS,
} from './purge-tables';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Every table and column name comes from purge-tables.ts, never from a request. */
const quote = (identifier: string): string => `"${identifier}"`;

/**
 * TypeORM's postgres driver answers `[rows, rowCount]` for DELETE and UPDATE.
 * Any other shape throws: read as 0 it would end the loop and answer
 * `complete: true` with rows left (fail closed).
 */
function affectedRows(result: unknown): number {
  if (Array.isArray(result) && typeof result[1] === 'number') return result[1];
  throw new Error('data purge: unknown query result shape');
}

interface Step {
  key: string;
  sql: string;
  params: unknown[];
}

/**
 * Purges this service's data of a deleted project, team or organization.
 * Each statement touches at most PURGE_BATCH_SIZE rows; a call runs at least
 * one statement and starts none after its deadline, then answers
 * `complete: false` so the caller calls again.
 */
@Injectable()
export class DataPurgeService {
  private readonly logger = new Logger(DataPurgeService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async purgeProject(
    projectId: string,
    organizationId: string,
    deadline: number,
  ): Promise<PurgeDataResponse> {
    assertUuids([projectId, organizationId]);
    return this.run('project', deadline, [
      ...PROJECT_PURGE_TABLES.map((t) => deleteStep(t, projectId)),
      ...PROJECT_TARGET_COLUMNS.map((t) => removeTargetStep(t, projectId)),
    ]);
  }

  async purgeTeam(
    teamId: string,
    organizationId: string,
    deadline: number,
  ): Promise<PurgeDataResponse> {
    assertUuids([teamId, organizationId]);
    return this.run('team', deadline, [
      ...TEAM_PURGE_TABLES.map((t) => deleteStep(t, teamId)),
      ...TEAM_TARGET_COLUMNS.map((t) => removeTargetStep(t, teamId)),
    ]);
  }

  async purgeOrganization(
    organizationId: string,
    teamIds: string[],
    deadline: number,
  ): Promise<PurgeDataResponse> {
    assertUuids([organizationId, ...(teamIds ?? [])]);
    // The organization's policies go, so their team targets go with them.
    return this.run(
      'organization',
      deadline,
      ORGANIZATION_PURGE_TABLES.map((t) => deleteStep(t, organizationId)),
    );
  }

  private async run(
    scope: string,
    deadline: number,
    steps: Step[],
  ): Promise<PurgeDataResponse> {
    const deleted: Record<string, number> = {};
    let ranOne = false;
    try {
      for (const step of steps) {
        for (;;) {
          if (ranOne && Date.now() >= deadline) {
            return { complete: false, deleted };
          }
          const n = affectedRows(
            await this.dataSource.query(step.sql, step.params),
          );
          ranOne = true;
          deleted[step.key] = (deleted[step.key] ?? 0) + n;
          if (n < PURGE_BATCH_SIZE) break;
        }
      }
    } catch (error) {
      // Neither the error text (hosts, SQL) nor an id leaves in the RPC message.
      this.logger.error(
        `data purge (${scope}) failed: ${(error as Error)?.constructor?.name ?? 'Error'}`,
      );
      throw new RpcException({ code: status.INTERNAL, message: 'INTERNAL' });
    }
    return { complete: true, deleted };
  }
}

function assertUuids(ids: string[]): void {
  if (!ids.every((id) => typeof id === 'string' && UUID.test(id))) {
    throw new RpcException({
      code: status.INVALID_ARGUMENT,
      message: 'INVALID_ARGUMENT',
    });
  }
}

function deleteStep({ table, column }: PurgeTable, id: string): Step {
  const t = quote(table);
  return {
    key: table,
    sql: `DELETE FROM ${t} WHERE "id" IN (SELECT "id" FROM ${t} WHERE ${quote(column)} = $1 LIMIT $2)`,
    params: [id, PURGE_BATCH_SIZE],
  };
}

/** Removes `id` from a JSONB array of ids; the row is kept. */
function removeTargetStep({ table, column }: PurgeTable, id: string): Step {
  const t = quote(table);
  const c = quote(column);
  return {
    key: `${table}.${column}`,
    sql: `UPDATE ${t} SET ${c} = ${c} - $2::text WHERE "id" IN (SELECT "id" FROM ${t} WHERE ${c} @> $1::jsonb LIMIT $3)`,
    params: [JSON.stringify([id]), id, PURGE_BATCH_SIZE],
  };
}
