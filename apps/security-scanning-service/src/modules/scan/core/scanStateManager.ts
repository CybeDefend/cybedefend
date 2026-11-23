import { Inject, Injectable, Optional } from '@nestjs/common';
import { GitHistoryCursorService } from '../git-history/git-history-cursor.service';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryDeepPartialEntity, Repository } from 'typeorm';
import { Logger } from 'nestjs-pino';
import { Scan } from '../../../entities/scan.entity';
import { Container } from '../../../entities/container.entity';
import { FileManagementService } from '../../file/file-management.service';
import { Span } from 'nestjs-otel';
import { safeGrpcCall } from '@grpc/wrapper-grpc.module';
import { ClientGrpc } from '@nestjs/microservices';
import {
  RESULT_SERVICE_NAME,
  ResultServiceClient,
} from '@grpc/analysis-reporting/analysis_reporting';
import {
  POLICY_EVALUATION_SERVICE_NAME,
  PolicyEvaluationServiceClient,
} from '@grpc/policy-management/policy_management';
import { RealtimeEventPublisher } from '@cybedefend/realtime-publisher';
import { ulid } from 'ulid';
import {
  SCAN_LIFECYCLE_HOOKS,
  ScanLifecycleHooks,
} from 'src/edition/ports/scan-lifecycle-hooks.port';
import { status } from '@grpc/grpc-js';
import { throwError, timeout } from 'rxjs';
import { grpcCodeOf } from './grpc-status.util';
import { isClosedStatus } from './scanPipeline';
import {
  FinalizeResultsOutcome,
  RESULTS_TIMED_OUT_ERROR_CATEGORY,
  RESULTS_TIMED_OUT_ERROR_MESSAGE,
  isFinalOutcome,
  isResultState,
  mustHoldForResults,
} from './resultsHold';

/**
 * Delays between the attempts of NotifyScanEnded: 4 attempts,
 * 14 s of waits between them. analysis-reporting evaluates the end of a scan
 * idempotently (its scan-complete lock, its claim on the issue creation), so
 * a retry is safe, while a lost call costs a scan whose scanner failed after
 * the others had finalized its notification, its issues and its cyber-risk
 * recompute.
 */
const SCAN_ENDED_RETRY_DELAYS_MS = [1_000, 3_000, 10_000];

/**
 * Deadline of one NotifyScanEnded attempt: a call that never answers (a
 * half-open connection) would otherwise hold the retries for good. Well
 * above what a dispatch takes there: a retry of a dispatch still running
 * finds it already done.
 */
const SCAN_ENDED_ATTEMPT_TIMEOUT_MS = 30_000;

/**
 * What one NotifyScanEnded call learnt: analysis-reporting's outcome, or that
 * it could not be told. An analysis-reporting that predates the RPC counts as
 * told, with no outcome, once the former issue creation ran.
 */
type ScanEndedAnswer = { told: false } | { told: true; outcome?: string };

export interface RecordScanStateOptions {
  /**
   * The results never became final within the hold's ceiling: a scan whose
   * scanners all completed ends `completed_degraded`, with the reason.
   */
  resultsTimedOut?: boolean;
}

@Injectable()
export class ScanStateManager {
  private resultServiceClient!: ResultServiceClient;
  private policyEvaluationClient!: PolicyEvaluationServiceClient;
  constructor(
    @InjectRepository(Scan)
    private readonly scanRepository: Repository<Scan>,
    @InjectRepository(Container)
    private readonly containerRepository: Repository<Container>,
    @Inject('ANALYSIS_REPORTING_SERVICE')
    private readonly analysisReportingClient: ClientGrpc,
    @Inject('POLICY_MANAGEMENT_SERVICE')
    private readonly policyManagementClient: ClientGrpc,
    private readonly fileManagementService: FileManagementService,
    private readonly realtime: RealtimeEventPublisher,
    private readonly logger: Logger,
    @Inject(SCAN_LIFECYCLE_HOOKS)
    private readonly hooks: ScanLifecycleHooks,
    @Optional()
    private readonly historyCursors?: GitHistoryCursorService,
  ) {}

  onModuleInit() {
    this.resultServiceClient =
      this.analysisReportingClient.getService<ResultServiceClient>(
        RESULT_SERVICE_NAME,
      );
    this.policyEvaluationClient =
      this.policyManagementClient.getService<PolicyEvaluationServiceClient>(
        POLICY_EVALUATION_SERVICE_NAME,
      );
  }

  /**
   * Update the state of a scan.
   *
   * The state is recomputed from the containers, written, and published
   * first; only then, when every container is done, comes the clean-up
   * (`handleCompletedScan`). It used to run before the write, so the
   * terminal state and SCAN_STATUS_CHANGED waited for the archive deletion
   * and the issue creation.
   *
   * Without `scan.containers`, they are read with one projected `find` (the
   * columns the recompute and the caller's slot check use). The scan is
   * written with one conditional UPDATE of the columns that changed, never
   * on a cancelled row, and not at all when nothing changed (never a
   * `findOne` with relations then a `save()` that reads the row again).
   *
   * @param scan The scan to update.
   */
  @Span()
  async updateScanState(
    scan: Scan,
    opts: RecordScanStateOptions = {},
  ): Promise<void> {
    if (await this.recordScanState(scan, opts)) {
      await this.handleCompletedScan(scan);
    }
  }

  /**
   * The first half of `updateScanState`: recompute the scan state from its
   * containers, write it and publish it, without the clean-up. For a caller
   * that runs the clean-up of the scan's end beside its own: UpdateScan
   * deletes the closed container's pod at the same time, never behind the
   * archive deletion.
   *
   * A scan whose containers are all closed but whose results are not final
   * yet (`mustHoldForResults`) is held: it stays `running`, with no `endTime`
   * and its error triplet untouched, and analysis-reporting is asked in the
   * background whether its results are final (`awaitResultsFinal`). The
   * terminal write comes from `finalizeResults`, through this method again.
   *
   * @returns true when every container is done and the terminal state was
   *   written: the caller then owes `handleCompletedScan(scan)`. False while
   *   the scan is held.
   */
  @Span()
  async recordScanState(
    scan: Scan,
    opts: RecordScanStateOptions = {},
  ): Promise<boolean> {
    const previousState = scan.state;

    // Never resurrect a cancelled scan. Cancellation is a terminal decision —
    // taken by the user through `cancelScan`, or by the stalled-queue
    // watchdog — and this method RECOMPUTES the state from the containers, so
    // without this guard a late container report (or a scan with no container
    // at all, which computes to `failed`) silently undoes it and wipes the
    // reason with it. `updateScanData` and `startScan` already guard the same
    // way.
    if (scan.state === 'cancelled') {
      this.logger.warn(
        `updateScanState: ignoring recompute for scan ${scan.id} because it is cancelled`,
      );
      return false;
    }

    if (!scan.containers) {
      scan.containers = await this.containerRepository.find({
        where: { scanId: scan.id },
        select: { id: true, status: true, image: true, podName: true },
      });
    }

    const total = scan.containers.length;
    let countFailed = 0;
    let countRunningOrStarting = 0;
    let countQueued = 0;
    let countCompleted = 0;
    let countDegraded = 0; // completed_degraded

    // Some scanners are "optional" for the global state (e.g. container, the
    // agent service's external logic): when only they fail, the scan must
    // not become completed_degraded.

    // Collect failed optional vs mandatory
    let failedOptional = 0;
    let failedMandatory = 0;

    for (const container of scan.containers) {
      const nameLower = (
        container.image ||
        container.podName ||
        ''
      ).toLowerCase();
      const isAgent = nameLower.includes('agent');
      const isContainerScanner = nameLower.includes('container');
      // AI-BOM is optional for the global scan state: it may depend on an
      // external LLM gateway, and with AI-BOM enabled by default an outage
      // of that gateway would otherwise degrade every scan. Treat an aibom
      // failure the same way as an agent/container failure: it does NOT
      // push the scan into completed_degraded.
      const isAibom = nameLower.includes('aibom');
      const optional = isAgent || isContainerScanner || isAibom;
      switch (container.status) {
        case 'failed':
          countFailed++;
          if (optional) failedOptional++;
          else failedMandatory++;
          break;
        case 'running':
        case 'starting':
        // The agent waiting for its AI analysis is still in progress:
        // counted nowhere, it would let the scan be computed completed /
        // completed_degraded before its AI ran.
        case 'parsing_completed':
          countRunningOrStarting++;
          break;
        case 'queued':
          countQueued++;
          break;
        case 'completed':
          countCompleted++;
          break;
        case 'completed_degraded':
          countDegraded++;
          break;
        default:
          break;
      }
    }

    // State computation, optional scanners taken into account.
    if (countRunningOrStarting > 0) {
      scan.state = 'running';
    } else if (countFailed === total) {
      scan.state = 'failed';
    } else if (countCompleted + countDegraded === total) {
      // All done
      if (countDegraded > 0) {
        scan.state = 'completed_degraded';
      } else {
        scan.state = 'completed';
      }
    } else if (countQueued === total) {
      scan.state = 'queued';
    } else {
      // Mixed statuses: tell an optional failure from a mandatory one
      if (failedMandatory > 0 && (countCompleted > 0 || countDegraded > 0)) {
        scan.state = 'completed_degraded';
      } else if (failedMandatory === 0 && failedOptional > 0) {
        // Only optional containers failed. An optional failure never changes
        // the scan state, degraded included: the scanners decide it alone.
        scan.state = countDegraded > 0 ? 'completed_degraded' : 'completed';
      } else if (countFailed > 0 && failedMandatory === 0) {
        // Fallback: failures, but possibly optional ones
        scan.state = 'completed';
      } else {
        scan.state = 'running';
      }
    }

    // Check whether every container is done, to trigger the clean-up
    const allContainersCompleted =
      countCompleted + countFailed + countDegraded === total && total > 0;

    // A scan that reached its terminal state before results were held (an
    // older row, `resultsFinalizedAt` null) is never moved back to `running`.
    if (
      allContainersCompleted &&
      !isResultState(previousState) &&
      mustHoldForResults(scan, scan.state)
    ) {
      return this.holdForResults(scan, previousState);
    }

    const changes: QueryDeepPartialEntity<Scan> = {};
    if (
      allContainersCompleted &&
      opts.resultsTimedOut &&
      scan.state === 'completed'
    ) {
      scan.state = 'completed_degraded';
      scan.errorCode = null;
      scan.errorCategory = RESULTS_TIMED_OUT_ERROR_CATEGORY;
      scan.errorMessage = RESULTS_TIMED_OUT_ERROR_MESSAGE;
      changes.errorCode = null;
      changes.errorCategory = scan.errorCategory;
      changes.errorMessage = scan.errorMessage;
    }
    if (scan.state !== previousState) changes.state = scan.state;
    if (allContainersCompleted) {
      scan.endTime = new Date();
      changes.endTime = scan.endTime;
    }

    // Clear the WHOLE stale error triplet when the scan is no longer in a
    // state that carries a reason. This prevents misleading errors (e.g.
    // transient gRPC timeouts) from persisting on scans that recovered and
    // continued running, and avoids leaving a stale errorCode/errorCategory
    // behind once the errorMessage is dropped.
    if (!this.stateCarriesReason(scan.state)) {
      if (
        scan.errorMessage != null ||
        scan.errorCode != null ||
        scan.errorCategory != null
      ) {
        changes.errorMessage = null;
        changes.errorCode = null;
        changes.errorCategory = null;
      }
      scan.errorMessage = null;
      scan.errorCode = null;
      scan.errorCategory = null;
    }

    if (Object.keys(changes).length === 0) return false;

    if (!(await this.writeScanState(scan.id, changes))) {
      this.logger.warn(
        `updateScanState: scan ${scan.id} was not written (cancelled or deleted meanwhile), state "${scan.state}" dropped`,
      );
      return false;
    }

    this.publishStatusChanged(scan, previousState);

    // The closed work a terminal scan triggers (closed extension) lives
    // behind the edition's SCAN_LIFECYCLE_HOOKS port. One call, once every container is closed,
    // fire-and-forget: nothing here waits for it.
    if (allContainersCompleted) {
      this.hooks.onScanClosed(scan, scan.state, 'containers');
    }

    // A failed scan is never held for its results, so it never reaches the
    // results-final path: the history pass it recorded counts as failed here,
    // once, on the write that made it failed.
    if (
      allContainersCompleted &&
      scan.state === 'failed' &&
      previousState !== 'failed'
    ) {
      await this.countFailedHistoryPass(scan.id);
    }

    if (allContainersCompleted) {
      this.logger.log(
        `All containers completed for scan ${scan.id}, updating state to "${scan.state}" - metadata: { scanId: ${scan.id}, containers: ${total}, completed: ${countCompleted}, failed: ${countFailed} }`,
      );
    }
    return allContainersCompleted;
  }

  /**
   * Keep a scan whose containers are all closed `running` until its results
   * are final: no `endTime`, no clean-up, no lifecycle hook, and its error
   * triplet kept (a `completed_degraded` scan's reason must survive until its
   * terminal write). The state is written only when it was not `running`
   * already. analysis-reporting is then asked in the background, even when
   * nothing was written.
   */
  private async holdForResults(
    scan: Scan,
    previousState: string,
  ): Promise<false> {
    const computedState = scan.state;
    scan.state = 'running';
    if (previousState !== scan.state) {
      if (!(await this.writeScanState(scan.id, { state: scan.state }))) {
        this.logger.warn(
          `updateScanState: scan ${scan.id} was not written (cancelled or deleted meanwhile), state "${scan.state}" dropped`,
        );
        return false;
      }
      this.publishStatusChanged(scan, previousState);
    }
    this.logger.log(
      `[ResultsHold] Scan ${scan.id} held: every container closed, waiting for analysis-reporting to finalize its results (computed state "${computedState}")`,
    );
    void this.awaitResultsFinal(scan);
    return false;
  }

  /**
   * The background half of the hold: ask analysis-reporting whether the
   * scan's results are final (with retries) and, when they are, end the scan.
   * When they are not, or analysis-reporting cannot be told, the scan stays
   * held for a later signal: analysis-reporting's MarkScanResultsFinal or the
   * next ask. Never rejects.
   */
  private async awaitResultsFinal(scan: Scan): Promise<void> {
    try {
      if (await this.askResultsFinal(scan, 'retry')) {
        await this.finalizeResults(scan.id);
      }
    } catch (error) {
      this.logger.error(
        `[ResultsHold] Scan ${scan.id} could not be finalized, it stays held: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Ask analysis-reporting whether the scan's results are final, through
   * NotifyScanEnded (which also tells it every container is closed).
   *
   * @param attempts `'retry'`: the retries of SCAN_ENDED_RETRY_DELAYS_MS;
   *   `'once'`: one attempt, for a caller that asks again later.
   * @returns true when they are: any outcome but `waiting`, or an
   *   analysis-reporting that predates the RPC (the former issue creation then
   *   ran). False while it still finalizes them or when it could not be
   *   told: the scan stays held. Never rejects.
   */
  @Span()
  async askResultsFinal(
    scan: Scan,
    attempts: 'retry' | 'once',
  ): Promise<boolean> {
    const answer = await this.notifyScanEnded(scan, attempts);
    return answer.told && isFinalOutcome(answer.outcome);
  }

  /**
   * End a scan held for its results, once they are final. Safe to call from
   * any signal, any number of times: the conditional UPDATE that stamps
   * `resultsFinalizedAt` on a `running` scan whose results were not final yet
   * lets one caller through; every other gets `already_final` and does
   * nothing. The winner then writes the terminal state and runs the clean-up
   * (`updateScanState`).
   *
   * @param opts.resultsTimedOut the results never became final in time: a
   *   scan whose scanners all completed ends `completed_degraded`.
   * @returns `finalized` for the call that ended the scan; `already_final`
   *   when another did; `containers_open` while a container is open (the
   *   last close holds the scan again); `not_running` for a scan in any
   *   other state; `not_found` for a missing scan.
   */
  @Span()
  async finalizeResults(
    scanId: string,
    opts: RecordScanStateOptions = {},
  ): Promise<FinalizeResultsOutcome> {
    const finalizedAt = new Date();
    const outcome = await this.claimResultsFinal(scanId, finalizedAt);
    if (outcome === 'finalized') {
      // Results final: the git history cursor may move. Never for a scan
      // ended by the results timeout (its results may be incomplete). A
      // failure here is logged and never changes the scan's state.
      if (!opts.resultsTimedOut && this.historyCursors) {
        try {
          await this.historyCursors.applyFinalizedScan(scanId);
        } catch (error) {
          this.logger.error(
            `[GitHistory] Scan ${scanId}: the cursor was not advanced: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      const scan = await this.scanRepository.findOne({ where: { id: scanId } });
      if (scan) {
        // The won UPDATE mirrored on the entity: a recompute that did not see
        // the results final would hold the scan again.
        scan.resultsFinalizedAt = finalizedAt;
        await this.updateScanState(scan, opts);
      }
    }
    const line = `[ResultsHold] Scan ${scanId} results final (${outcome}${opts.resultsTimedOut ? ', timed out' : ''})`;
    if (outcome === 'finalized' || outcome === 'already_final') {
      this.logger.log(line);
    } else {
      this.logger.debug(line);
    }
    return outcome;
  }

  /**
   * Counts the history pass of a scan that ended `failed` as a failed pass on
   * its branch's cursor. For every path that writes `failed` on a scan
   * outside `recordScanState` (the cloud watchdogs), once per scan: call it
   * only on the write that moved the scan to `failed`. Never throws: a
   * failure is logged and never changes the scan's state.
   */
  async countFailedHistoryPass(scanId: string): Promise<void> {
    if (!this.historyCursors) return;
    try {
      await this.historyCursors.applyFinalizedScan(scanId, {
        scanFailed: true,
      });
    } catch (error) {
      this.logger.error(
        `[GitHistory] Scan ${scanId}: the failed history pass was not counted: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** The checks and the conditional UPDATE of `finalizeResults`. */
  private async claimResultsFinal(
    scanId: string,
    finalizedAt: Date,
  ): Promise<FinalizeResultsOutcome> {
    const scan = await this.scanRepository.findOne({ where: { id: scanId } });
    if (!scan) return 'not_found';
    if (scan.resultsFinalizedAt != null) return 'already_final';
    if (scan.state !== 'running') return 'not_running';

    const containers = await this.containerRepository.find({
      where: { scanId },
      select: { id: true, status: true, image: true, podName: true },
    });
    if (
      containers.length === 0 ||
      !containers.every((c) => isClosedStatus(c.status))
    ) {
      return 'containers_open';
    }

    const result = await this.scanRepository
      .createQueryBuilder()
      .update(Scan)
      .set({ resultsFinalizedAt: finalizedAt })
      .where('id = :id', { id: scanId })
      .andWhere('state = :running', { running: 'running' })
      .andWhere('resultsFinalizedAt IS NULL')
      .execute();
    if (result.affected === 1) return 'finalized';

    // The UPDATE lost: say why from the row as it is now.
    const current = await this.scanRepository.findOne({
      where: { id: scanId },
    });
    if (!current) return 'not_found';
    if (current.resultsFinalizedAt != null) return 'already_final';
    return current.state !== 'running' ? 'not_running' : 'already_final';
  }

  /**
   * Write recomputed scan columns with ONE conditional UPDATE, never on a
   * cancelled scan: cancellation is final (`updateScanState` refuses a
   * loaded cancelled scan; this closes the window between that read and the
   * write).
   *
   * @returns true when the row was written. mysql2 counts the matched row
   *   even when its values do not change (FOUND_ROWS), so false means the
   *   scan is cancelled or gone.
   */
  @Span()
  private async writeScanState(
    scanId: string,
    changes: QueryDeepPartialEntity<Scan>,
  ): Promise<boolean> {
    const result = await this.scanRepository
      .createQueryBuilder()
      .update(Scan)
      .set(changes)
      .where('id = :id', { id: scanId })
      .andWhere('state <> :cancelled', { cancelled: 'cancelled' })
      .execute();
    return result.affected === 1;
  }

  /**
   * States whose stored error triplet is a reason the user must see, so it is
   * neither cleared on recompute nor omitted from the realtime payload.
   *
   * `completed_degraded` IS a failure outcome. `cancelled` is not a failure but
   * it carries a reason too (the stalled-queue watchdog stamps errorCode
   * 65): without it here, the first `updateScanState` to run on a cancelled
   * scan erased exactly the reason the watchdog had just recorded.
   */
  private stateCarriesReason(state: string): boolean {
    return (
      state === 'failed' ||
      state === 'completed_degraded' ||
      state === 'cancelled'
    );
  }

  /**
   * The single SCAN_STATUS_CHANGED emitter.
   *
   * `updateScanState` publishes the container-driven transitions through it,
   * and `ScanService` the ones that never go through a container at all: the
   * stalled-queue cancellation and the scan-level terminal update
   * applied when an UpdateScan has no container to attach to. One
   * method so the payload and the dedupe policy cannot drift apart.
   *
   * No-ops when the state did not actually change, and for a diff scan: no
   * page that listens to the event shows one (the home list, the org overview
   * and the Results pages read full scans only, the diff-scan history panel
   * polls), while each of its transitions would make every open home page
   * reload its list and KPI cards.
   *
   * @param scan The scan in its NEW state (already persisted by the caller).
   * @param previousState The state it held before.
   */
  @Span()
  publishStatusChanged(scan: Scan, previousState: string): void {
    if (scan.state === previousState) return;
    if (scan.isDiffScan) return;

    // Parallel container updates each load the scan with the same stale
    // `previousState` and independently compute the same `currentState`,
    // so without dedupe the same transition gets published 4-8 times
    // within < 1 s. Dedupe key is state-scoped (not transition-scoped)
    // so re-entering the same state within the TTL emits at most once
    // per logical state change.
    void this.realtime.publish(
      {
        eventId: ulid(),
        type: 'SCAN_STATUS_CHANGED',
        scope: {
          organizationId: scan.organizationId,
          projectId: scan.projectId,
          scanId: scan.id,
        },
        payload: {
          scanStatusChanged: {
            scanId: scan.id,
            previousState,
            currentState: scan.state,
            ...(this.stateCarriesReason(scan.state)
              ? {
                  errorCode: scan.errorCode ?? undefined,
                  errorCategory: scan.errorCategory ?? undefined,
                  errorMessage: scan.errorMessage ?? undefined,
                }
              : {}),
          },
        },
      },
      {
        dedupeKey: `scan:${scan.id}:state:${scan.state}`,
        dedupeTtlSec: 30,
      },
    );
  }

  /**
   * calculate the scan status based on the containers status.
   * @param scanId The scan ID to calculate the status for.
   * @returns The scan status.
   */
  @Span()
  async calculateScanStatus(scanId: string): Promise<string> {
    const containers = await this.containerRepository.find({
      where: { scanId },
    });

    const total = containers.length;
    let countFailed = 0;
    let countRunningOrStarting = 0;
    let countQueued = 0;
    let countCompleted = 0;
    let countDegraded = 0;

    // Collect failed optional vs mandatory (same logic as updateScanState)
    let failedOptional = 0;
    let failedMandatory = 0;

    for (const container of containers) {
      const nameLower = (
        container.image ||
        container.podName ||
        ''
      ).toLowerCase();
      const isAgent = nameLower.includes('agent');
      const isContainerScanner = nameLower.includes('container');
      // Same optional treatment as in updateScanState — aibom failure
      // does NOT push the scan into completed_degraded.
      const isAibom = nameLower.includes('aibom');
      const optional = isAgent || isContainerScanner || isAibom;

      switch (container.status) {
        case 'failed':
          countFailed++;
          if (optional) failedOptional++;
          else failedMandatory++;
          break;
        case 'running':
        case 'starting':
        // Same rule as updateScanState: the agent waiting for its AI
        // analysis is in progress.
        case 'parsing_completed':
          countRunningOrStarting++;
          break;
        case 'queued':
          countQueued++;
          break;
        case 'completed':
          countCompleted++;
          break;
        case 'completed_degraded':
          countDegraded++;
          break;
        default:
          break;
      }
    }

    // 1) If at least one container is running or starting => "running"
    if (countRunningOrStarting > 0) {
      return 'running';
    }

    // 2) If all containers are "failed" => "failed"
    if (countFailed === total) {
      return 'failed';
    }

    // 3) If all containers are "completed" or "completed_degraded" => final state
    if (countCompleted + countDegraded === total) {
      return countDegraded > 0 ? 'completed_degraded' : 'completed';
    }

    // 4) If all containers are "queued" => "queued"
    if (countQueued === total) {
      return 'queued';
    }

    // 5) Mixed statuses: tell an optional failure from a mandatory one
    if (failedMandatory > 0 && (countCompleted > 0 || countDegraded > 0)) {
      return 'completed_degraded';
    } else if (failedMandatory === 0 && failedOptional > 0) {
      // Same rule as updateScanState: an optional failure never changes the
      // scan state, degraded included.
      return countDegraded > 0 ? 'completed_degraded' : 'completed';
    } else if (countFailed > 0 && failedMandatory === 0) {
      // Fallback: failures, but possibly optional ones
      return 'completed';
    }

    // 6) Otherwise, return a default status (e.g. "running")
    return 'running';
  }

  /**
   * Check if a container state indicates termination.
   * @param state The state to check.
   * @returns True if the state indicates termination, false otherwise.
   */
  @Span()
  isContainerTerminated(state: string): boolean {
    return (
      state === 'failed' ||
      state === 'completed' ||
      state === 'completed_degraded'
    );
  }

  /**
   * The clean-up of a scan whose containers are all done, run once its
   * terminal state is written: analysis-reporting's notice that the scan
   * ended and the policy evaluation, both launched first and without
   * waiting, then the archive deletion (awaited, nothing else removes it).
   *
   * analysis-reporting alone creates a scan's issues, once its results are
   * final. A scan held for its results (`resultsFinalizedAt` set) told it at
   * the hold, diff scans included, and is not told again. Of the scans never
   * held, a diff scan is not told: analysis-reporting excludes it anyway, and
   * its findings never reach the tables issues are created from.
   *
   * @param scan The completed scan.
   */
  @Span()
  async handleCompletedScan(scan: Scan): Promise<void> {
    // A graph-only scan (a repository import) ends once the agent closes its
    // container after the parse. It has no finding, so neither the end of a
    // scan (issues, notification, cyber-risk) nor a policy evaluation is
    // asked for. Its archive still goes below.
    if (!scan.isGraphOnly) {
      // Launched first, without waiting, so that an archive deletion that
      // hangs (a file-management that never answers) holds neither. It
      // retries on its own and never rejects.
      if (scan.resultsFinalizedAt == null && !scan.isDiffScan) {
        void this.notifyScanEnded(scan, 'retry');
      }

      // Trigger policy evaluation asynchronously
      // This is fire-and-forget - we don't block the scan completion
      this.triggerPolicyEvaluation(scan).catch((error) => {
        this.logger.error(
          `[PolicyEvaluation] Failed to trigger policy evaluation for scan ${scan.id}: ${error?.message || error}`,
        );
      });
    }

    // An import scan (`importFormat` set) has no archive record — its
    // uploaded object lives under `import/<projectId>/<scanId>.sarif` and is
    // deleted by ImportScanService at every terminal move —
    // so `deleteFile(scan.id)` is skipped for one.
    if (scan.scanType !== 'container' && !scan.importFormat) {
      try {
        await this.fileManagementService.deleteFile(scan.id);
        this.logger.log(`File deleted after scan ${scan.id}`);
      } catch (error: any) {
        // Ignore "file not found" errors (file may have been deleted already)
        if (error?.message?.includes('not found') || error?.code === 'ENOENT') {
          this.logger.log(
            `File for scan ${scan.id} already deleted or not found, ignoring`,
          );
        } else {
          this.logger.warn(
            `Failed to delete file for scan ${scan.id}: ${error?.message || error}`,
          );
        }
      }
    }
  }

  /**
   * Trigger policy evaluation for a completed scan.
   * This calls the Policy Management Service to queue the evaluation.
   * The evaluation is done asynchronously via BullMQ in the policy service.
   * @param scan The completed scan.
   */
  @Span()
  private async triggerPolicyEvaluation(scan: Scan): Promise<void> {
    try {
      this.logger.log(
        `[PolicyEvaluation] Triggering async policy evaluation for scan ${scan.id}, project ${scan.projectId}`,
      );

      // Call policy evaluation service to trigger async evaluation
      // The policy service will:
      // 1. Queue the job immediately and return
      // 2. Process the job in the background via BullMQ
      // 3. Wait for vulnerability processing to complete
      // 4. Fetch vulnerabilities from analysis-reporting
      // 5. Evaluate them against applicable policies
      const response = await safeGrpcCall(
        this.policyEvaluationClient.triggerEvaluation({
          scanId: scan.id,
          projectId: scan.projectId,
          organizationId: scan.organizationId || '',
          teamId: undefined,
          triggeredBy: '', // Empty string = system triggered (not user-initiated)
          branch: scan.branch || undefined,
        }),
      );

      if (response?.evaluationId) {
        this.logger.log(
          `[PolicyEvaluation] Policy evaluation queued for scan ${scan.id}, evaluationId: ${response.evaluationId}`,
        );
      } else {
        this.logger.warn(
          `[PolicyEvaluation] Failed to queue policy evaluation for scan ${scan.id}: ${response?.message || 'Unknown error'}`,
        );
      }
    } catch (error: any) {
      // Log but don't fail - policy evaluation is best-effort
      this.logger.warn(
        `[PolicyEvaluation] Policy evaluation failed for scan ${scan.id}: ${error?.message || error}`,
      );
    }
  }

  /**
   * Tell analysis-reporting that every container of the scan is closed
   * (NotifyScanEnded). It evaluates the end of the scan once
   * more, the failed scanners out of the count, and once the results are
   * final sends the scan-complete notifications, creates the issues and
   * recomputes the cyber-risk. Without this, a scanner that failed after the
   * others had finalized left the scan waiting there for good.
   *
   * Retried after SCAN_ENDED_RETRY_DELAYS_MS on any error but
   * INVALID_ARGUMENT, each attempt bounded by SCAN_ENDED_ATTEMPT_TIMEOUT_MS.
   * An analysis-reporting that predates the RPC answers UNIMPLEMENTED: the
   * scan then gets the former CreateIssuesForScan, once, so deploying
   * security-scanning first loses no issue; only analysis-reporting first
   * guarantees a single creation, though (the former call ran beside
   * analysis-reporting's own). Never rejects: the outcome is logged.
   *
   * @param scan The completed scan.
   * @param attempts `'retry'` for the retries above, `'once'` for a single
   *   attempt (a caller that asks again later).
   * @returns analysis-reporting's outcome, or that it could not be told.
   */
  @Span()
  private async notifyScanEnded(
    scan: Scan,
    attempts: 'retry' | 'once',
  ): Promise<ScanEndedAnswer> {
    const delays = attempts === 'retry' ? SCAN_ENDED_RETRY_DELAYS_MS : [];
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await safeGrpcCall(
          this.resultServiceClient
            .notifyScanEnded({ scanId: scan.id, projectId: scan.projectId })
            .pipe(
              timeout({
                each: SCAN_ENDED_ATTEMPT_TIMEOUT_MS,
                with: () =>
                  throwError(() => ({
                    code: status.DEADLINE_EXCEEDED,
                    details: `no answer within ${SCAN_ENDED_ATTEMPT_TIMEOUT_MS} ms`,
                  })),
              }),
            ),
        );
        this.logger.log(
          `[ScanEnded] analysis-reporting evaluated the end of scan ${scan.id}: ${response?.message || 'no outcome'}`,
        );
        return { told: true, outcome: response?.message || undefined };
      } catch (error) {
        const code = grpcCodeOf(error);
        if (code === status.UNIMPLEMENTED) {
          this.logger.warn(
            `[ScanEnded] analysis-reporting predates NotifyScanEnded; creating the issues of scan ${scan.id} through CreateIssuesForScan`,
          );
          await this.triggerIssueCreation(scan);
          return { told: true };
        }
        const message = error instanceof Error ? error.message : String(error);
        const delay = delays[attempt];
        if (code === status.INVALID_ARGUMENT || delay === undefined) {
          const line = `[ScanEnded] Could not tell analysis-reporting that scan ${scan.id} ended (attempt ${attempt + 1}): its notification, issues and cyber-risk recompute depend on its scanners' finalization alone: ${message}`;
          // A single attempt is asked again later: a transient failure is
          // not an error yet.
          if (attempts === 'once' && code !== status.INVALID_ARGUMENT) {
            this.logger.warn(line);
          } else {
            this.logger.error(line);
          }
          return { told: false };
        }
        this.logger.warn(
          `[ScanEnded] Telling analysis-reporting that scan ${scan.id} ended failed (attempt ${attempt + 1}), retrying in ${delay} ms: ${message}`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  /**
   * The former issue creation, for an analysis-reporting that predates
   * NotifyScanEnded only (a rolling deployment window): remove it with the
   * CreateIssuesForScan RPC.
   * @param scan The completed scan.
   */
  @Span()
  private async triggerIssueCreation(scan: Scan): Promise<void> {
    try {
      this.logger.log(
        `[IssueCreation] Triggering issue creation for scan ${scan.id}`,
      );

      const response = await safeGrpcCall(
        this.resultServiceClient.createIssuesForScan({
          projectId: scan.projectId,
          scanId: scan.id,
          organizationId: scan.organizationId,
        }),
      );

      if (response?.success) {
        this.logger.log(
          `[IssueCreation] Issue creation completed for scan ${scan.id}: ${response.message} (GitHub: ${response.githubIssuesCreated || 0}, GitLab: ${response.gitlabIssuesCreated || 0})`,
        );
      } else {
        this.logger.warn(
          `[IssueCreation] Issue creation failed for scan ${scan.id}: ${response?.message || 'Unknown error'}`,
        );
      }
    } catch (error: any) {
      // Issue creation failure should not fail the scan completion
      this.logger.error(
        `[IssueCreation] Failed to trigger issue creation for scan ${scan.id}: ${error?.message || error}`,
      );
    }
  }

  /**
   * Check if all containers are completed for a scan.
   *
   * @param scanId The scan ID to check.
   * @returns True if all containers are completed, false otherwise.
   */
  @Span()
  async checkIfAllContainersAreCompleted(scanId: string): Promise<boolean> {
    const containers = await this.containerRepository.find({
      where: { scanId },
    });

    for (const container of containers) {
      if (
        container.status === 'queued' ||
        container.status === 'starting' ||
        container.status === 'running'
      ) {
        return false;
      }
    }

    return true;
  }
}
