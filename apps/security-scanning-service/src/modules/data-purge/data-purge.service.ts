import { Inject, Injectable, Logger } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { DataSource } from 'typeorm';
import type { PurgeDataResponse } from '@grpc/data-purge/data_purge';
import {
  SCANNER_PODS_PORT,
  ScannerPodsPort,
} from 'src/edition/ports/scanner-pods.port';
import { ident, run, sql } from '@cybedefend/db-dialect';
import type { Sql } from '@cybedefend/db-dialect';
import { deleteInBatches } from './batched-delete';
import {
  ALL_SCANS,
  GIT_HISTORY_CURSORS,
  NOT_STARTED_SCANS,
} from './purge-tables';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class DataPurgeService {
  private readonly logger = new Logger(DataPurgeService.name);

  constructor(
    private readonly dataSource: DataSource,
    // The pod deletion goes through SCANNER_PODS_PORT, which each edition
    // binds to its own implementation.
    @Inject(SCANNER_PODS_PORT)
    private readonly pods: ScannerPodsPort,
  ) {}

  /**
   * Purges a deleted project's scans (their `container` rows go by the FK
   * cascade), in this order:
   *
   * 1. The `queued` and `waiting_for_file` scans. They have no pod yet, and
   *    every path that starts one claims it by a compare-and-set on its row
   *    (`startQueuedScan`: `queued` → `running`; `startScan`:
   *    `claimScanStart`), so a dequeue or an upload completion that has not
   *    claimed its scan yet finds no row and launches nothing.
   * 2. The pods and Kubernetes secrets of the `running` scans, strictly: any
   *    answer but a 404 fails the call before the next step, so the rows
   *    that name those pods are still there for the retry.
   * 3. Every remaining scan.
   *
   * What is left: a launch already past its claim whose `podName` is not yet
   * written on its container row when step 2 reads them. Its pod starts with
   * no row naming it; it is not stopped by this purge.
   */
  async purgeProject(
    projectId: string,
    organizationId: string,
    deadline: number,
  ): Promise<PurgeDataResponse> {
    if (!UUID.test(projectId ?? '') || !UUID.test(organizationId ?? '')) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'INVALID_ARGUMENT',
      });
    }

    const deleted: Record<string, number> = {
      pods: 0,
      scan: 0,
      git_history_cursor: 0,
    };
    const answer = (complete: boolean): PurgeDataResponse => {
      this.logger.log(
        `Data purge of project ${projectId}: complete=${complete} pods=${deleted.pods} scan=${deleted.scan} git_history_cursor=${deleted.git_history_cursor}`,
      );
      return { complete, deleted };
    };

    const notStarted = await this.deleteScans(
      projectId,
      deadline,
      NOT_STARTED_SCANS.where,
    );
    deleted.scan += notStarted.deleted;
    // Past the deadline a call runs one batch at most.
    if (!notStarted.complete || Date.now() >= deadline) return answer(false);

    deleted.pods = await this.stopRunningPods(projectId);

    const rest = await this.deleteScans(projectId, deadline);
    deleted.scan += rest.deleted;
    if (!rest.complete || Date.now() >= deadline) return answer(false);

    const cursors = await deleteInBatches(
      this.dataSource,
      GIT_HISTORY_CURSORS.table,
      GIT_HISTORY_CURSORS.column,
      projectId,
      deadline,
    );
    deleted.git_history_cursor = cursors.deleted;
    return answer(cursors.complete);
  }

  private deleteScans(projectId: string, deadline: number, where?: Sql) {
    return deleteInBatches(
      this.dataSource,
      ALL_SCANS.table,
      ALL_SCANS.column,
      projectId,
      deadline,
      undefined,
      where,
    );
  }

  private async stopRunningPods(projectId: string): Promise<number> {
    // The backticked join goes through libs/db-dialect; the SELECT
    // aliases are quoted too, so the raw rows keep their camelCase keys on
    // PostgreSQL (an unquoted `AS podName` comes back as `podname`).
    const { rows } = await run(
      this.dataSource,
      sql`SELECT c.${ident('podName')} AS ${ident('podName')}, sc.${ident('scannerType')} AS ${ident('scannerType')} FROM ${ident('container')} c INNER JOIN ${ident('scan')} s ON s.${ident('id')} = c.${ident('scanId')} LEFT JOIN ${ident('scanner')} sc ON sc.${ident('id')} = c.${ident('scannerId')} WHERE s.${ident('projectId')} = ${projectId} AND s.${ident('state')} = 'running'`,
    );
    const pods = (
      rows as { podName: string; scannerType: string | null }[]
    ).filter((r) => r?.podName);

    const results = await Promise.allSettled(
      pods.map((pod) =>
        this.pods.deleteScannerPodStrict(
          pod.podName,
          pod.scannerType ?? undefined,
        ),
      ),
    );
    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length > 0) {
      const reason = (failed[0] as PromiseRejectedResult).reason;
      this.logger.warn(
        `Data purge of project ${projectId}: ${failed.length} of ${pods.length} pod(s) could not be stopped (${reason instanceof Error ? reason.constructor.name : typeof reason}); its running scans are kept for the retry`,
      );
      throw new RpcException({
        code: status.UNAVAILABLE,
        message: 'UNAVAILABLE',
      });
    }
    return pods.length;
  }
}
