import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { Span } from 'nestjs-otel';
import { Logger } from 'nestjs-pino';
import {
  FindOptionsWhere,
  In,
  IsNull,
  Not,
  QueryDeepPartialEntity,
  Repository,
} from 'typeorm';
import { CheckExistingScanResponse } from '@grpc/security-scanning/scan';
import { ident } from '@cybedefend/db-dialect';

import { Scan } from '../../../entities/scan.entity';
import { Container } from '../../../entities/container.entity';
import { CLOSED_CONTAINER_STATUSES } from './scanPipeline';
import { normalizeImageReference } from './image-reference.util';
import {
  REMOVE_REGISTRY_AUTH_SQL,
  leavesTheQueue,
  withoutRegistryAuth,
} from '../registry-auth-retention';

export const ACTIVE_SCAN_STATES = ['running', 'queued', 'waiting_for_file'];

export interface ExistingScanCheckOptions {
  /** Kind of scan about to start; 'container' selects the container pool. */
  scanType?: string;
  /** Container pool only: the image about to be scanned. */
  imageToScan?: string;
  /** The scan being started, whose own row must not count as a conflict. */
  excludeScanId?: string;
}

/**
 * The scan-row state machine of `ScanService`, extracted as a core
 * primitive so the edition implementations can inject it:
 * every state move is ONE conditional UPDATE whose affected-row count
 * decides the winner, and the registry credentials of a queued scan leave
 * with the UPDATE that takes it out of the queue.
 */
@Injectable()
export class ScanStateStore {
  constructor(
    @InjectRepository(Scan)
    private readonly scanRepository: Repository<Scan>,
    @InjectRepository(Container)
    private readonly containerRepository: Repository<Container>,
    private readonly logger: Logger,
  ) {}

  /**
   * Compare-and-set on `scan.state`, as ONE conditional UPDATE.
   *
   * A read → check → `save` is not a transition. Two writers both pass the
   * check, and TypeORM's `save` writes back every column that differs from
   * the row it re-reads right before its UPDATE, so a stale in-memory `state`
   * silently undoes what a concurrent writer committed. Here the precondition
   * lives in the WHERE and the affected-row count says who won: MySQL locks
   * the row for the UPDATE, so of N concurrent callers exactly one moves it.
   *
   * @returns true when this call moved the row; false when the row was no
   * longer in one of `fromStates`, does not exist, or is not in `projectId`.
   */
  async compareAndSetScanState(
    where: { id: string; projectId?: string },
    fromStates: readonly string[],
    toState: string,
    columns: QueryDeepPartialEntity<Scan> = {},
  ): Promise<boolean> {
    const set: QueryDeepPartialEntity<Scan> = { ...columns, state: toState };
    if (leavesTheQueue(fromStates, toState)) {
      // A queued scan's registry credentials only serve to launch its pods
      // (registry-auth-retention.ts): whatever takes it out of the queue
      // removes them, in this UPDATE.
      set.metadata =
        columns.metadata !== undefined
          ? withoutRegistryAuth(columns.metadata as Scan['metadata'])
          : () => REMOVE_REGISTRY_AUTH_SQL;
    }
    const update = this.scanRepository
      .createQueryBuilder()
      .update(Scan)
      .set(set)
      .where('id = :id', { id: where.id })
      .andWhere('state IN (:...fromStates)', { fromStates: [...fromStates] });
    if (where.projectId !== undefined) {
      // A bare `projectId` is not rewritten by the builder and folds to
      // `projectid` on PostgreSQL: quote it per engine.
      update.andWhere(`${ident('projectId').text} = :projectId`, {
        projectId: where.projectId,
      });
    }
    const result = await update.execute();
    return (result.affected ?? 0) > 0;
  }

  /**
   * `compareAndSetScanState` for a scan held in memory. A won move is mirrored
   * on the entity, so a later `save(scan)` cannot write back the state this
   * instance was read with, nor the registry credentials a move out of the
   * queue removed.
   */
  async moveScanState(
    scan: Scan,
    fromStates: readonly string[],
    toState: string,
    columns: QueryDeepPartialEntity<Scan> = {},
  ): Promise<boolean> {
    const moved = await this.compareAndSetScanState(
      { id: scan.id },
      fromStates,
      toState,
      columns,
    );
    if (moved) {
      Object.assign(scan, columns, { state: toState });
      if (leavesTheQueue(fromStates, toState)) {
        scan.metadata = withoutRegistryAuth(scan.metadata);
      }
    }
    return moved;
  }

  /**
   * startScan's move out of the state it read and validated at its
   * top. Every await in between (entitlements, org limits, the archive URL, the
   * project settings) is a window for a user cancel, so the move only happens
   * while the row still holds the state that was read. When it does not, the
   * caller gets the answer the top-of-method guard gives, and nothing is
   * queued or launched.
   */
  async claimScanStart(
    scan: Scan,
    toState: 'queued' | 'running',
    columns: QueryDeepPartialEntity<Scan>,
  ): Promise<void> {
    const readState = scan.state;
    if (await this.moveScanState(scan, [readState], toState, columns)) {
      return;
    }
    const current = await this.scanRepository.findOne({
      where: { id: scan.id },
    });
    this.logger.warn(
      `startScan: scan ${scan.id} left '${readState}' (now '${current?.state ?? 'deleted'}') before it could move to '${toState}': nothing queued or launched`,
    );
    if (!current) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: `Scan not found`,
      });
    }
    throw new RpcException({
      code: status.FAILED_PRECONDITION,
      message:
        current.state === 'cancelled'
          ? `Scan ${scan.id} is cancelled and cannot be started`
          : `Scan ${scan.id} cannot be started in state: ${current.state}`,
    });
  }

  /**
   * Close a container with ONE conditional UPDATE, only while it is still
   * open: a container that reported its own end meanwhile keeps that end.
   * `finishedAt` comes from the application clock, never SQL NOW().
   *
   * @returns true when this call closed it.
   */
  @Span()
  async closeOpenContainer(
    containerId: string,
    close: QueryDeepPartialEntity<Container>,
  ): Promise<boolean> {
    const result = await this.containerRepository
      .createQueryBuilder()
      .update(Container)
      .set(close)
      .where('id = :id', { id: containerId })
      .andWhere('status NOT IN (:...closed)', {
        closed: [...CLOSED_CONTAINER_STATUSES],
      })
      .execute();
    return (result.affected ?? 0) > 0;
  }

  /**
   * Refuse to start a scan that would collide with one already in flight.
   *
   * Code scans (SAST/SCA/IaC…) and container scans are two INDEPENDENT pools:
   * a running code scan never blocks a container scan, and vice versa.
   * - Code pool: one active code scan per project (per branch when given).
   * - Container pool: one active scan per IMAGE per project, whatever the
   *   branch. A caller that does not know the image yet (createScan) cannot
   *   conflict; startScan enforces the rule once the image is known.
   *
   * @param projectId The project ID to check.
   * @param branch The branch to check (code pool only, optional).
   * @param options Scan kind, image and the scan to leave out of the check.
   * @returns Throws ALREADY_EXISTS on a conflict, resolves otherwise.
   */
  @Span()
  async checkExistingScan(
    projectId: string,
    branch?: string,
    options: ExistingScanCheckOptions = {},
  ): Promise<CheckExistingScanResponse> {
    if (options.scanType === 'container') {
      await this.assertNoActiveScanOfImage(
        projectId,
        options.imageToScan,
        options.excludeScanId,
      );
      return { message: 'No existing scan in progress', exists: true };
    }

    // A graph-only scan (a repository import) runs no scanner: it never blocks
    // a code scan, and createScan does not check it against one. An import
    // scan (`importFormat` set) neither blocks a code scan nor is blocked by
    // one: the import watchdog owns its lifecycle.
    const base: FindOptionsWhere<Scan> = {
      projectId,
      state: In(ACTIVE_SCAN_STATES),
      isGraphOnly: false,
      importFormat: IsNull(),
    };
    // With a branch given, only a scan on the same branch blocks
    if (branch) {
      base.branch = branch;
    }

    // `scanType` is nullable: `<> 'container'` alone would drop NULL rows.
    const existingScan = await this.scanRepository.findOne({
      where: [
        { ...base, scanType: Not('container') },
        { ...base, scanType: IsNull() },
      ],
    });

    if (existingScan) {
      this.logger.log(
        `A scan with ID ${existingScan.id} is already in progress for project ${projectId}${branch ? ` on branch ${branch}` : ''}`,
      );
      throw new RpcException({
        code: status.ALREADY_EXISTS,
        message: `A scan is already in progress`,
      });
    }
    return {
      message: 'No existing scan in progress',
      exists: true,
    };
  }

  /**
   * Container pool: the same image must not be scanned twice at once on a
   * project. Registry/repository compare case-insensitively (OCI), the tag
   * case-sensitively — the same normalisation the scanner pod receives.
   */
  async assertNoActiveScanOfImage(
    projectId: string,
    imageToScan?: string,
    excludeScanId?: string,
    repo: Pick<Repository<Scan>, 'find'> = this.scanRepository,
  ): Promise<void> {
    if (!imageToScan) {
      return;
    }
    const wanted = normalizeImageReference(imageToScan);
    const activeContainerScans = await repo.find({
      where: {
        projectId,
        scanType: 'container',
        state: In(ACTIVE_SCAN_STATES),
      },
    });
    const duplicate = activeContainerScans.find(
      (candidate) =>
        candidate.id !== excludeScanId &&
        typeof candidate.metadata?.imageToScan === 'string' &&
        normalizeImageReference(candidate.metadata.imageToScan) === wanted,
    );
    if (duplicate) {
      this.logger.log(
        `Container scan ${duplicate.id} is already in progress for image ${wanted} on project ${projectId}`,
      );
      throw new RpcException({
        code: status.ALREADY_EXISTS,
        message: `A scan of this image is already in progress`,
      });
    }
  }
}
