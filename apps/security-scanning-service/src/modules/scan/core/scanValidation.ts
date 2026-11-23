import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Like, Repository } from 'typeorm';
import { Logger } from 'nestjs-pino';
import { Scan } from '../../../entities/scan.entity';
import { Container } from '../../../entities/container.entity';
import { Span } from 'nestjs-otel';
import { status } from '@grpc/grpc-js';

import { RpcException } from '@nestjs/microservices';
import { UpdateScanRequest } from '@grpc/security-scanning/scan';
import { ident } from '@cybedefend/db-dialect';
import {
  CLOSED_CONTAINER_STATUSES,
  isClosedStatus,
  OUTCOME_REASON_PATTERN,
} from './scanPipeline';

/**
 * What `updateContainerStatus` did with an UpdateScan. `applied: false` means
 * nothing was written, and the caller must not recompute nor publish.
 */
export interface ContainerUpdateResult {
  applied: boolean;
  reason?: 'container_closed' | 'analysis_started';
}

/** The container columns an UpdateScan may write. */
type ContainerUpdateFields = Partial<
  Pick<
    Container,
    | 'status'
    | 'startedAt'
    | 'version'
    | 'finishedAt'
    | 'outcomeReason'
    | 'totalVulnerabilities'
    | 'processedVulnerabilities'
    | 'step'
    | 'historyOutcome'
  >
>;

@Injectable()
export class ScanValidation {
  constructor(
    @InjectRepository(Scan)
    private readonly scanRepository: Repository<Scan>,
    @InjectRepository(Container)
    private readonly containerRepository: Repository<Container>,
    private readonly logger: Logger,
  ) {}

  /**
   * Find a scan by its ID.
   * @param scanId The ID of the scan to find.
   * @returns The scan if found, null otherwise.
   */
  @Span()
  async findScanById(scanId: string): Promise<Scan | null> {
    return await this.scanRepository.findOne({
      where: { id: scanId },
    });
  }

  /**
   * Find a container by its pod name and scan ID.
   * @param podName The name of the pod.
   * @param scanId The ID of the scan.
   * @returns The container if found, null otherwise.
   */
  @Span()
  async findContainerByPodName(
    podName: string,
    scanId: string,
  ): Promise<Container | null> {
    return await this.containerRepository.findOne({
      where: {
        podName: podName,
        scanId: scanId,
      },
    });
  }

  /**
   * Find the container an UpdateScan should be applied to.
   *
   * podName is `optional` in UpdateScanRequest, and the agent no longer drops
   * its report when it cannot resolve its own pod name — it used to, and that
   * silently discarded the terminal `completed`/`failed` updates along with
   * every progress tick. Matching strictly on podName here would discard them
   * a second time, so fall back to the scan's agent container.
   *
   * @param podName The reporting pod's name; may be empty or stale.
   * @param scanId The ID of the scan.
   * @returns The container to update, or null if the scan has no agent container.
   */
  @Span()
  async findContainerForUpdate(
    podName: string,
    scanId: string,
  ): Promise<Container | null> {
    if (podName) {
      const byPod = await this.findContainerByPodName(podName, scanId);
      if (byPod) return byPod;
    }

    return await this.containerRepository.findOne({
      where: { scanId, image: Like('%agent%') },
    });
  }

  /**
   * Handle scan not found error.
   * @param scanId The ID of the scan that was not found.
   * @throws RpcException with a 404 error code and message.
   */
  @Span()
  handleScanNotFound(scanId: string): void {
    this.logger.error(
      `Scan with id test ${scanId} not found - metadata: { scanId: ${scanId} }`,
    );
    throw new RpcException({
      code: status.NOT_FOUND,
      message: `Scan not found`,
    });
  }

  /**
   * Handle container not found error.
   * @param scanId The ID of the scan.
   * @param podName The name of the pod.
   * @throws RpcException with a 500 error code and message.
   */
  @Span()
  handleContainerNotFound(scanId: string, podName: string): void {
    this.logger.error(
      `Container with podName ${podName} not found for scan ${scanId} - metadata: { container: null }`,
    );
    throw new RpcException({
      code: status.INTERNAL,
      message: `Container not found`,
    });
  }

  /**
   * Apply an UpdateScan to its container.
   *
   * A closed container is final: a
   * late or replayed report — the agent reporting progress on the project's
   * last scan during an on-demand reanalysis, a scanner pod
   * reporting after its end — must not reopen it, because the scan state is
   * recomputed from the containers and would reopen the scan and take its
   * organisation slot again. A `parsing_completed` arriving once the
   * analysis started is refused the same way, so a late or duplicated
   * report cannot start the analysis a second time.
   *
   * Fields absent from the request keep their stored value. Counters are
   * written whenever present, 0 included. `outcomeReason` is only read with
   * a closed state, and only when it is a code of the outcome vocabulary.
   *
   * The checks above run on the loaded entity and give the reason; the write
   * itself is ONE conditional UPDATE of the fields present in the request,
   * `WHERE id AND status NOT IN (closed)`, plus `analysisStartedAt IS NULL`
   * for a `parsing_completed`. A `save` would re-read the row and write back
   * every column that differs from the entity: a progress report read just
   * before a watchdog's close and saved just after it reopened the container,
   * and a late `parsing_completed` saved just after the AI claim wrote a null
   * `analysisStartedAt` back. The written fields are mirrored on `container`
   * only when the update was applied.
   *
   * @param container The container to update.
   * @param update The update data.
   * @returns Whether the update was applied, and why not when it was not.
   */
  @Span()
  async updateContainerStatus(
    container: Container,
    update: UpdateScanRequest,
  ): Promise<ContainerUpdateResult> {
    if (isClosedStatus(container.status)) {
      return { applied: false, reason: 'container_closed' };
    }
    if (update.state === 'parsing_completed' && container.analysisStartedAt) {
      return { applied: false, reason: 'analysis_started' };
    }

    const fields: ContainerUpdateFields = {};
    if (update.state) fields.status = update.state;
    if (update.startedAt) fields.startedAt = new Date(update.startedAt);
    if (update.version) fields.version = update.version;

    if (isClosedStatus(update.state)) {
      fields.finishedAt = new Date();
      if (update.outcomeReason) {
        if (OUTCOME_REASON_PATTERN.test(update.outcomeReason)) {
          fields.outcomeReason = update.outcomeReason;
        } else {
          // The value itself is not logged: it came from the caller.
          this.logger.warn(
            `[updateContainerStatus] dropped a malformed outcomeReason - metadata: { containerId: ${container.id}, scanId: ${update.scanId} }`,
          );
        }
      }
    }

    if (
      update.totalVulnerabilities !== undefined &&
      update.totalVulnerabilities !== null
    ) {
      fields.totalVulnerabilities = update.totalVulnerabilities;
    }
    if (
      update.processedVulnerabilities !== undefined &&
      update.processedVulnerabilities !== null
    ) {
      fields.processedVulnerabilities = update.processedVulnerabilities;
    }
    if (update.step) {
      fields.step = update.step;
    }
    if (update.historyOutcome) {
      if (
        update.historyOutcome === 'ok' ||
        update.historyOutcome === 'failed'
      ) {
        fields.historyOutcome = update.historyOutcome;
      } else {
        // The value itself is not logged: it came from the caller.
        this.logger.warn(
          `[updateContainerStatus] ignored an unknown historyOutcome - metadata: { containerId: ${container.id}, scanId: ${update.scanId} }`,
        );
      }
    }

    // A request that carries no field has nothing to write, and nothing the
    // container could refuse.
    if (Object.keys(fields).length === 0) {
      return { applied: true };
    }

    const write = this.containerRepository
      .createQueryBuilder()
      .update(Container)
      .set(fields)
      .where('id = :id', { id: container.id })
      .andWhere('status NOT IN (:...closed)', {
        closed: [...CLOSED_CONTAINER_STATUSES],
      });
    if (update.state === 'parsing_completed') {
      // A bare `analysisStartedAt` is not rewritten by the builder and folds
      // to `analysisstartedat` on PostgreSQL: quote it per engine.
      write.andWhere(`${ident('analysisStartedAt').text} IS NULL`);
    }
    const result = await write.execute();
    // mysql2 3.x connects with FOUND_ROWS (it is in the default client flags,
    // `lib/connection_config.js` `getDefaultFlags`): `affected` counts the
    // matched row even when the values did not change, so 0 means the WHERE
    // refused the write.
    if (result.affected !== 1) {
      return {
        applied: false,
        reason: await this.whyUpdateRefused(container.id, update.state),
      };
    }

    Object.assign(container, fields);
    return { applied: true };
  }

  /**
   * The reason a conditional container update matched no row, from a fresh
   * read of the row: the checks on the loaded entity passed, so something
   * changed in between. Only a `parsing_completed` can be refused because
   * the analysis started (the AI claim won the race); anything else was
   * refused by a close. A row that is gone counts as closed.
   */
  @Span()
  private async whyUpdateRefused(
    containerId: string,
    requestedState: string | undefined,
  ): Promise<'container_closed' | 'analysis_started'> {
    const row = await this.containerRepository.findOne({
      where: { id: containerId },
      select: { id: true, status: true, analysisStartedAt: true },
    });
    if (
      row &&
      !isClosedStatus(row.status) &&
      requestedState === 'parsing_completed' &&
      row.analysisStartedAt
    ) {
      return 'analysis_started';
    }
    return 'container_closed';
  }
}
