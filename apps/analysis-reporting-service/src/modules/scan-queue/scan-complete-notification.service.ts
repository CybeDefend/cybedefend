import {
  Injectable,
  Inject,
  OnModuleInit,
  Logger,
  Optional,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ulid } from 'ulid';
import { ClientGrpc } from '@nestjs/microservices';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import Redis from 'ioredis';
import { Span } from 'nestjs-otel';
import { status } from '@grpc/grpc-js';
import { firstValueFrom, throwError, timeout } from 'rxjs';
import {
  PROJECT_SERVICE_NAME,
  ProjectServiceClient,
} from '@grpc/global-management/global_management';
import {
  MAIL_REPORT_SERVICE_NAME,
  MailReportServiceClient,
  ScanCompleteReportRequest,
  SeverityBreakdown,
  TypeBreakdown,
} from '@grpc/global-management/mail';
import {
  SlackServiceClient,
  SLACK_SERVICE_NAME,
} from '@grpc/external-integrations/external_integrations';
import {
  SCAN_SERVICE_NAME,
  ScanServiceClient,
} from '@grpc/security-scanning/security_scanning';
import { ScanResponse } from '@grpc/security-scanning/scan';
import type { ScanAddResultRequest } from '@grpc/analysis-reporting/result';
import { SendSlackNotificationRequest } from '@grpc/external-integrations/slack';
import { ProjectInformationsResponse } from '@grpc/global-management/project';
import { safeGrpcCall } from '@grpc/wrapper-grpc.module';
import { SastVulnerabilityDetections } from 'src/entities/sast-vulnerability-detections.entity';
import { IacVulnerabilityDetections } from 'src/entities/iac-vulnerability-detections.entity';
import { ScaVulnerabilityDetections } from 'src/entities/sca-vulnerability-detections.entity';
import { VulnerabilityDetectionsContainer } from 'src/entities/container_vulnerability_detections.entity';
import { ScanQueueService } from './scan-queue.service';
import { QUEUE_NAMES } from './queue-names';
import { resolveConcurrency } from './concurrency.util';
import {
  IssueCreationContext,
  IssueIntegrationService,
} from '../vulnerability/issue-integration.service';
import { CyberiskRecomputeEnqueuer } from '../cyber-risk/cyberisk-recompute.enqueuer';
import { ACTIVE_VULN_STATES } from '../cyber-risk/cyber-risk.constants';
import {
  SCAN_COMPLETED_LISTENERS,
  type ScanCompletedListener,
} from '../../edition/ports/scan-completed-listeners.port';

/**
 * Default lifetime of a deferred scan-complete notification: 6 h.
 *
 * The deferral is written once the scanners are done, and waits for the Cybe
 * agent. From then on, security-scanning closes the agent container within
 * AGENT_INGESTION_MAX_MS + AI_QUEUE_MAX_WAIT_MS + AI_ANALYSIS_MAX_MS, that is
 * 5 h by default (1 h, 2 h and 2 h). The key must outlive that sum, or a long
 * analysis ends with no notification, no issue creation and no cyber-risk
 * recompute. Raise SCAN_NOTIFICATION_DEFER_TTL_SEC whenever those budgets are
 * raised.
 */
const DEFAULT_DEFER_TTL_SEC = 21_600;

/**
 * Lifetime of the claim on a scan's issue creation (`scan-issues:<scanId>`):
 * 7 days, well past the scan-complete lock (about 2 h), so a late re-dispatch
 * (a finalization replayed hours later) never creates the issues twice.
 */
const ISSUE_CREATION_CLAIM_TTL_SEC = 7 * 86_400;

/**
 * Retries of the delayed job that gives a scanner up when its first attempt
 * failed: first run 1 min after the give-up, then 1, 2, 4, 8,
 * 16 and 32 min apart, the last one about 64 min after. A give-up comes after
 * the batch retries and the onFailed gate all failed, so the outage (mostly
 * MySQL, which the end's GetScan reads too) is already older than 15 s, and
 * security-scanning's notice may be gone: this is the scan's last chance.
 */
const SCAN_END_EVALUATION_JOB_OPTIONS = {
  delay: 60_000,
  attempts: 7,
  backoff: { type: 'exponential', delay: 60_000 },
  removeOnComplete: true,
  removeOnFail: { age: 7 * 86_400 },
} as const;

/**
 * How long after a give-up the delayed job may still run: its first delay,
 * then the exponential backoffs between its attempts (64 min).
 */
const SCAN_END_EVALUATION_WINDOW_MS =
  SCAN_END_EVALUATION_JOB_OPTIONS.delay +
  SCAN_END_EVALUATION_JOB_OPTIONS.backoff.delay *
    (2 ** (SCAN_END_EVALUATION_JOB_OPTIONS.attempts - 1) - 1);

/**
 * Lifetime of the scan-complete lock (`scan-complete-notification:<scanId>`):
 * twice the delayed job's window, at least 2 h, so a late attempt of that job
 * finds the dispatch done instead of sending the mail and Slack again
 * (it was 1 h).
 */
const SCAN_COMPLETE_LOCK_TTL_SEC = Math.max(
  2 * 3600,
  Math.ceil((2 * SCAN_END_EVALUATION_WINDOW_MS) / 1000),
);

/**
 * How long the end of a scan waits for security-scanning to take its results
 * as final (MarkScanResultsFinal): the notifications follow, and must not
 * wait longer. A lost call costs little: security-scanning re-asks the end
 * of every scan it holds for its results.
 */
const RESULTS_FINAL_CALL_TIMEOUT_MS = 10_000;

/**
 * Lifetime of the record that a scan's history pass failure is still to be
 * told to security-scanning (`history-ingestion-failed:<scanId>`): 24 h, like
 * the batch tracking, well past the 90 min after which security-scanning ends
 * a held scan without its results.
 */
const HISTORY_FAILURE_TTL_SEC = 86_400;

/** The record once security-scanning knows. */
const HISTORY_FAILURE_RECORDED = 'recorded';

/** The record while it does not, followed by the scanner's name. */
const HISTORY_FAILURE_PENDING = 'pending:';

const historyFailureKey = (scanId: string) =>
  `history-ingestion-failed:${scanId}`;

/** The outcomes a secret scanner sends when it ran a history pass. */
const HISTORY_PASS_RAN: ReadonlySet<string> = new Set(['ok', 'failed']);

/**
 * Whether a batch comes from a secret scanner that ran a history pass: its
 * last batch carries the pass's outcome, and each of its findings the pass
 * that reported it (it reports passes only when the scan gave it a history).
 */
function isHistoryPassBatch(batch?: ScanAddResultRequest): boolean {
  if (!batch) return false;
  if (HISTORY_PASS_RAN.has(batch.historyPassOutcome ?? '')) return true;
  return (batch.vulnerabilities ?? []).some(
    (v) => v?.secretPass === 'head' || v?.secretPass === 'history',
  );
}

/** The scan queues whose scanners finalize into a scan's end. */
const SCAN_QUEUE_TYPES = ['sca', 'sast-iac', 'container', 'aibom'] as const;

/**
 * The Community `cybedefend-scanners/<adapter>` images whose results finalize in
 * the SAST/IaC queue (`cybedefend-scanners/trivy-fs` finalizes in the SCA one).
 */
const COMMUNITY_SAST_IAC_IMAGES: ReadonlySet<string> = new Set([
  'cybedefend-scanners/opengrep',
  'cybedefend-scanners/zizmor',
  'cybedefend-scanners/gitleaks',
  'cybedefend-scanners/trivy-config',
]);

/** A scanner given up, as the delayed scan-end evaluation job carries it. */
export interface ScanEndEvaluationJobData {
  scanId: string;
  projectId: string;
  scannerType: (typeof SCAN_QUEUE_TYPES)[number];
  scannerName: string;
}

/**
 * What became of a scan's end, evaluated on a scanner's finalization or on
 * security-scanning's word that every container is closed.
 */
export type ScanEndOutcome =
  /** Notified, issues created, cyber-risk recompute enqueued. */
  | 'dispatched'
  /** Another path dispatched it already (the scan-complete lock). */
  | 'already_dispatched'
  /** The AI agent still runs: its own end dispatches it. */
  | 'deferred'
  /** A scanner's results are still being finalized: its finalization dispatches it. */
  | 'waiting'
  /** No scanner finalized any result (every one failed): nothing to notify. */
  | 'nothing_finalized'
  /** A diff scan whose scanners are finalized: isolated, never notified. */
  | 'diff_scan';

/**
 * Service responsible for dispatching scan completion notifications (email + Slack).
 *
 * Uses a Redis lock to ensure only one notification is sent per scan,
 * even when multiple scanner types (SCA, SAST/IAC, Container) finalize independently.
 */
@Injectable()
export class ScanCompleteNotificationService implements OnModuleInit {
  private readonly logger = new Logger(ScanCompleteNotificationService.name);
  private projectClient: ProjectServiceClient;
  private mailClient: MailReportServiceClient;
  private slackClient: SlackServiceClient;
  private scanServiceClient: ScanServiceClient;
  // Strict positive integer, else the default (same rules as the *_CONCURRENCY
  // vars): '6h' must not become a 6-second deferral.
  private readonly deferredNotificationTtlSec = resolveConcurrency(
    process.env.SCAN_NOTIFICATION_DEFER_TTL_SEC,
    DEFAULT_DEFER_TTL_SEC,
  );

  constructor(
    @Inject('GLOBAL_MANAGEMENT_SERVICE')
    private readonly gmClient: ClientGrpc,
    @Inject('EXTERNAL_INTEGRATIONS_SERVICE')
    private readonly eiClient: ClientGrpc,
    @Inject('SECURITY_SCANNING_SERVICE')
    private readonly ssClient: ClientGrpc,
    @InjectRepository(SastVulnerabilityDetections)
    private readonly sastRepo: Repository<SastVulnerabilityDetections>,
    @InjectRepository(IacVulnerabilityDetections)
    private readonly iacRepo: Repository<IacVulnerabilityDetections>,
    @InjectRepository(ScaVulnerabilityDetections)
    private readonly scaRepo: Repository<ScaVulnerabilityDetections>,
    @InjectRepository(VulnerabilityDetectionsContainer)
    private readonly containerRepo: Repository<VulnerabilityDetectionsContainer>,
    private readonly scanQueueService: ScanQueueService,
    private readonly issueIntegrationService: IssueIntegrationService,
    private readonly cyberiskEnqueuer: CyberiskRecomputeEnqueuer,
    @InjectQueue(QUEUE_NAMES.SCAN_END_EVALUATION)
    private readonly scanEndEvaluationQueue: Queue<ScanEndEvaluationJobData>,
    // What else runs once a scan has completed (edition bindings;
    // none in the Community Edition). Absent from a module that binds no
    // edition layer: no listener then.
    @Optional()
    @Inject(SCAN_COMPLETED_LISTENERS)
    private readonly scanCompletedListeners: ScanCompletedListener[] = [],
  ) {}

  onModuleInit() {
    this.projectClient =
      this.gmClient.getService<ProjectServiceClient>(PROJECT_SERVICE_NAME);
    this.mailClient = this.gmClient.getService<MailReportServiceClient>(
      MAIL_REPORT_SERVICE_NAME,
    );
    this.slackClient =
      this.eiClient.getService<SlackServiceClient>(SLACK_SERVICE_NAME);
    this.scanServiceClient =
      this.ssClient.getService<ScanServiceClient>(SCAN_SERVICE_NAME);
  }

  /**
   * Attempt to send scan complete notifications after a scanner type finishes.
   *
   * Tracks which individual scanners have finalized per category via Redis.
   * Fetches the scan's containers to know how many scanners are expected per category.
   * Only sends the notification when all expected scanners in all categories are done.
   *
   * @param scanId The scan ID
   * @param projectId The project ID
   * @param scannerType The scanner category that just completed (e.g. "sca", "sast-iac", "container")
   * @param scannerName The individual scanner name (e.g. "opengrep", "bearer", "scanlink-sca")
   */
  @Span()
  async onScannerFinalized(
    scanId: string,
    projectId: string,
    scannerType: string,
    scannerName: string,
  ): Promise<void> {
    try {
      const redis = await this.scanQueueService.getRedisClient();

      // Read order, which onScanEnded relies on: this scanner
      // is added to the finalized set BEFORE the containers are read
      // (GetScan), and onScanEnded reads the containers BEFORE the finalized
      // sets. Neither path locks the other out, so whichever runs last sees
      // both facts: a finalization that onScanEnded did not count reads the
      // containers after security-scanning closed them all, and dispatches
      // the end itself.
      //
      // Track this individual scanner as finalized within its category (Redis SET)
      const perScannerKey = `scan-finalized-scanners:${scanId}:${scannerType}`;
      await redis.sadd(perScannerKey, scannerName);
      await redis.expire(perScannerKey, 86400);

      // Also track at category level for the fallback path
      const finalizedKey = `scan-finalized-types:${scanId}`;
      await redis.sadd(finalizedKey, scannerType);
      await redis.expire(finalizedKey, 86400);

      // Get expected scanner counts per category from containers (authoritative).
      // Falls back to registered queue types (category-level) if lookup fails.
      // The scan read for it also serves the agent check, the diff-scan check
      // and the dispatch below: one GetScan per finalization.
      // Nothing is kept for the next call, whose counts must exclude the
      // containers that failed in between.
      const { counts: expectedCounts, scan: finalizationScan } =
        await this.getExpectedScannerCounts(scanId);

      this.logger.log(
        `[ScanCompleteNotification] Scanner '${scannerName}' (${scannerType}) finalized for scan ${scanId}. Expected: [${Array.from(expectedCounts.keys()).join(', ') || 'unknown'}]`,
      );

      // The same rule as security-scanning's end-of-scan notice: one
      // function, so that the two paths cannot disagree.
      const readiness = await this.scanEndReadiness(
        redis,
        scanId,
        expectedCounts,
        finalizationScan,
      );
      if (readiness !== 'ready') {
        return;
      }

      // The results are final: security-scanning ends the scan it holds
      // `running` for them, before the notifications that say it completed.
      // A diff scan too: its findings are stored by now.
      await this.notifyResultsFinal(scanId);

      await this.dispatchScanEnd(
        scanId,
        projectId,
        scannerType,
        finalizationScan,
      );
    } catch (error) {
      this.logger.error(
        `[ScanCompleteNotification] Error dispatching notifications for scan ${scanId}: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }

  /**
   * security-scanning's word that every container of a scan is closed
   * The end of a scan was only evaluated when one of
   * its scanners finalized here, so a scanner whose container failed after
   * the others had finalized left the scan waiting for good: no
   * notification, no issue, no cyber-risk recompute ("2/3 scanners
   * finalized. Waiting.", then nothing). security-scanning's
   * own CreateIssuesForScan was the only net, for the issues alone. This
   * evaluates the end once more, the failed containers out of the count, and
   * dispatches it through the same lock as every other path.
   *
   * It waits, and lets the scanner's own finalization dispatch, while a
   * scanner that sent its last batch still has to finalize, its container
   * closed failed or not: its results are still in the queue. With no
   * scanner left to count (every one failed), one finalized queue type is
   * enough. A scan none of whose scanners finalized is not dispatched: there
   * is nothing final to notify, nor to create issues from. The rule is
   * `scanEndReadiness`, shared with a scanner's finalization.
   *
   * The containers are read before the finalized sets: see the read order
   * in onScannerFinalized.
   *
   * security-scanning holds a scan `running` until this answers anything but
   * `waiting`, so a diff scan goes through the same readiness: `diff_scan`
   * only once its scanners are finalized, and nothing dispatched then (a
   * diff scan is isolated).
   *
   * @throws when the scan or Redis cannot be read: nothing was dispatched
   *   and no lock was taken, so the caller retries.
   */
  @Span()
  async onScanEnded(
    scanId: string,
    projectId: string,
  ): Promise<ScanEndOutcome> {
    const outcome = await this.evaluateScanEnd(scanId, projectId);
    // security-scanning takes any answer but `waiting` as "results final"
    // and may then move the scan's history cursor: not while a lost history
    // pass is still unknown to it.
    if (outcome === 'waiting' || (await this.historyFailureRecorded(scanId))) {
      return outcome;
    }
    return 'waiting';
  }

  /** `onScanEnded` without the history pass check. */
  private async evaluateScanEnd(
    scanId: string,
    projectId: string,
  ): Promise<ScanEndOutcome> {
    const { counts, scan } = await this.getExpectedScannerCounts(scanId);
    if (!scan) {
      throw new Error(
        `scan ${scanId} could not be read from security-scanning`,
      );
    }

    const redis = await this.scanQueueService.getRedisClient();
    const readiness = await this.scanEndReadiness(redis, scanId, counts, scan);
    if (readiness !== 'ready') {
      return readiness;
    }
    if (scan.isDiffScan === true) {
      return 'diff_scan';
    }

    this.logger.log(
      `[ScanCompleteNotification] Scan ${scanId} ended and every scanner left is finalized.`,
    );
    return this.dispatchScanEnd(scanId, projectId, scan.scanType ?? '', scan);
  }

  /**
   * A scanner whose finalization failed for good: its batch retries spent,
   * the finalize gate of the processor's onFailed threw on `finalizeScan`
   * itself. It never finalizes, and security-scanning tells
   * the end of a scan once, so the end would wait for it for good. It is
   * given up (`giveUpScanner`) at once; when that fails (the outage that
   * failed the finalization mostly fails the end's GetScan too), a delayed
   * job retries it for about an hour (SCAN_END_EVALUATION_JOB_OPTIONS), with
   * an id of its own: a deterministic jobId silently no-ops while a job of
   * that id is kept. Never throws: each failure is logged.
   */
  @Span()
  async onScannerAbandoned(
    scanId: string,
    projectId: string,
    scannerType: (typeof SCAN_QUEUE_TYPES)[number],
    scannerName: string,
  ): Promise<void> {
    this.logger.warn(
      `[ScanCompleteNotification] Scanner '${scannerName}' (${scannerType}) of scan ${scanId} failed to finalize for good: the end of the scan no longer waits for it. Its processed batches stay; its finalization (resolving what it no longer reports, SCA library clean-up, AI-BOM merge) does not happen.`,
    );
    const data: ScanEndEvaluationJobData = {
      scanId,
      projectId,
      scannerType,
      scannerName,
    };
    try {
      await this.giveUpScanner(data);
      return;
    } catch (error) {
      this.logger.warn(
        `[ScanCompleteNotification] Giving '${scannerName}' up failed for scan ${scanId}, retrying in a delayed job: ${(error as Error).message}`,
      );
    }
    try {
      await this.scanEndEvaluationQueue.add('give-up-scanner', data, {
        ...SCAN_END_EVALUATION_JOB_OPTIONS,
        jobId: `scan-end-${scanId}-${scannerType}-${scannerName}-${ulid()}`,
      });
    } catch (error) {
      this.logger.error(
        `[ScanCompleteNotification] Could not queue the delayed end of scan ${scanId} after giving '${scannerName}' up: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }

  /**
   * Give a scanner up and evaluate the end of its scan: its batch tracking
   * is cleared (the guard stops waiting for it), it is counted as done in
   * its category (a scanner whose container completed is in the expected
   * count too), and the end is evaluated once more. The scan then goes out
   * with the batches that scanner had processed, which stay in the
   * database, but without what its finalization does: resolving the
   * findings it no longer reports, the SCA library clean-up, the AI-BOM
   * merge. Every step is idempotent. Once the end no longer waits,
   * security-scanning is told that the results are final.
   *
   * @throws when it could not be done (Redis, the scan unreadable): the
   *   delayed job that runs it retries.
   */
  @Span()
  async giveUpScanner(data: ScanEndEvaluationJobData): Promise<ScanEndOutcome> {
    const { scanId, projectId, scannerType, scannerName } = data;
    // Its finalization never ran: a history pass it reported is not whole.
    // Read before the clear below removes the outcome it stored.
    if (scannerType === 'sast-iac') {
      await this.recordHistoryIngestionLoss(scanId, scannerName);
    }
    await this.scanQueueService.clearBatchTracking(
      scannerType,
      scanId,
      scannerName,
    );
    const redis = await this.scanQueueService.getRedisClient();
    const perScannerKey = `scan-finalized-scanners:${scanId}:${scannerType}`;
    await redis.sadd(perScannerKey, scannerName);
    await redis.expire(perScannerKey, 86400);

    const outcome = await this.onScanEnded(scanId, projectId);
    this.logger.log(
      `[ScanCompleteNotification] End of scan ${scanId} evaluated after giving '${scannerName}' up: ${outcome}`,
    );
    // Anything but `waiting` leaves nothing to finalize: the scan held for
    // its results may end.
    if (outcome !== 'waiting') {
      await this.notifyResultsFinal(scanId);
    }
    return outcome;
  }

  /**
   * Tell security-scanning that the results of a scan are final
   * (MarkScanResultsFinal), so that it ends the scan it holds `running` for
   * them. One call, bounded by RESULTS_FINAL_CALL_TIMEOUT_MS, that never
   * throws: security-scanning re-asks the end of every scan it holds, so a
   * lost call (an older security-scanning without the RPC, a transient
   * failure) only ends the scan later. security-scanning decides from the
   * scan itself, so a call for a scan it does not hold changes nothing.
   */
  private async notifyResultsFinal(scanId: string): Promise<void> {
    // A lost history pass first: once the results are final,
    // security-scanning may move the scan's history cursor.
    if (!(await this.historyFailureRecorded(scanId))) return;
    try {
      const response = await firstValueFrom(
        this.scanServiceClient.markScanResultsFinal({ scanId }).pipe(
          timeout({
            first: RESULTS_FINAL_CALL_TIMEOUT_MS,
            with: () =>
              throwError(
                () =>
                  new Error(
                    `no answer within ${RESULTS_FINAL_CALL_TIMEOUT_MS} ms`,
                  ),
              ),
          }),
        ),
      );
      this.logger.log(
        `[ScanCompleteNotification] Results of scan ${scanId} final, security-scanning answered: ${response?.outcome || 'no outcome'}`,
      );
    } catch (error) {
      if ((error as { code?: unknown } | null)?.code === status.UNIMPLEMENTED) {
        this.logger.warn(
          `[ScanCompleteNotification] security-scanning does not implement MarkScanResultsFinal: scan ${scanId} ends when it re-asks the end of the scan.`,
        );
        return;
      }
      this.logger.warn(
        `[ScanCompleteNotification] Could not tell security-scanning that the results of scan ${scanId} are final; it ends the scan when it re-asks its end: ${(error as Error)?.message ?? String(error)}`,
      );
    }
  }

  /**
   * Some results of a SAST/IaC scanner were never stored: a batch dropped
   * after its retries (`batch`), or the scanner given up. The scanner's git
   * history pass is downgraded to `failed` for its finalization
   * (`markHistoryIngestionLost`), so its first full pass resolves nothing by
   * absence. When the scanner ran a history pass (the outcome its last batch
   * stored, or the lost batch itself, says so), security-scanning must count
   * that pass as failed before it takes the scan's results as final:
   * otherwise it moves the history cursor past commits whose findings were
   * lost. Recorded in Redis, told at once when possible, and before any
   * "results final" signal for the scan otherwise (`historyFailureRecorded`).
   *
   * @throws when Redis cannot be written: the caller must not finalize the
   *   scanner then.
   */
  @Span()
  async recordHistoryIngestionLoss(
    scanId: string,
    scannerName: string,
    batch?: ScanAddResultRequest,
  ): Promise<void> {
    const before = await this.scanQueueService.markHistoryIngestionLost(
      scanId,
      scannerName,
    );
    if (!HISTORY_PASS_RAN.has(before ?? '') && !isHistoryPassBatch(batch)) {
      return;
    }
    const redis = await this.scanQueueService.getRedisClient();
    await redis.set(
      historyFailureKey(scanId),
      `${HISTORY_FAILURE_PENDING}${scannerName}`,
      'EX',
      HISTORY_FAILURE_TTL_SEC,
      'NX',
    );
    this.logger.warn(
      `[ScanCompleteNotification] Scanner '${scannerName}' of scan ${scanId} lost results of its git history pass: the pass counts as failed.`,
    );
    await this.historyFailureRecorded(scanId);
  }

  /**
   * Whether security-scanning knows every lost history pass of a scan
   * (MarkHistoryIngestionFailed): true when there is none, or once it
   * answered. Tells it when it does not know yet; an older security-scanning
   * without the RPC keeps no history cursor, and an unknown scan has none,
   * so both count as known. False when it could not be told, or the record
   * could not be read: the caller then says nothing about the results being
   * final. Never throws.
   */
  private async historyFailureRecorded(scanId: string): Promise<boolean> {
    let redis: Redis;
    let state: string | null;
    try {
      redis = await this.scanQueueService.getRedisClient();
      state = await redis.get(historyFailureKey(scanId));
    } catch (error) {
      this.logger.warn(
        `[ScanCompleteNotification] Scan ${scanId}: whether its history pass failed could not be read, its results are not said final: ${(error as Error)?.message ?? String(error)}`,
      );
      return false;
    }
    if (!state || state === HISTORY_FAILURE_RECORDED) return true;
    const scannerName = state.startsWith(HISTORY_FAILURE_PENDING)
      ? state.slice(HISTORY_FAILURE_PENDING.length)
      : '';
    try {
      const response = await firstValueFrom(
        this.scanServiceClient
          .markHistoryIngestionFailed({ scanId, scannerName })
          .pipe(
            timeout({
              first: RESULTS_FINAL_CALL_TIMEOUT_MS,
              with: () =>
                throwError(
                  () =>
                    new Error(
                      `no answer within ${RESULTS_FINAL_CALL_TIMEOUT_MS} ms`,
                    ),
                ),
            }),
          ),
      );
      if (response?.success !== true) {
        throw new Error('security-scanning did not confirm it');
      }
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      if (code !== status.UNIMPLEMENTED && code !== status.NOT_FOUND) {
        this.logger.warn(
          `[ScanCompleteNotification] Scan ${scanId}: its history pass failure could not be recorded on security-scanning, its results are not said final: ${(error as Error)?.message ?? String(error)}`,
        );
        return false;
      }
    }
    try {
      await redis.set(
        historyFailureKey(scanId),
        HISTORY_FAILURE_RECORDED,
        'EX',
        HISTORY_FAILURE_TTL_SEC,
      );
    } catch (error) {
      // The RPC is idempotent: the next check tells it again.
      this.logger.warn(
        `[ScanCompleteNotification] Scan ${scanId}: could not keep that its history pass failure is recorded: ${(error as Error)?.message ?? String(error)}`,
      );
    }
    return true;
  }

  /**
   * Whether the end of a scan can be dispatched: the one rule of a scanner's
   * finalization and of security-scanning's end-of-scan notice, so
   * that the two paths cannot disagree.
   *
   * - Some scanner is counted (a container neither failed nor unknown):
   *   every counted scanner must be finalized.
   * - None is counted: only once every container is closed (an AI-BOM
   *   container is in no category, so a running one leaves the count empty
   *   too), and then one finalized queue type is enough. Not every
   *   registered one: a type registered without its last batch (a pod
   *   killed by the time limit while sending) never finalizes, and
   *   security-scanning tells the end once, so waiting for it would block
   *   the scan for good. None finalized: nothing final to dispatch.
   * - The scan could not be read (`scan` absent, a finalization only), or
   *   was read without any container (as good as unread, on both paths;
   *   security-scanning never tells the end of such a scan): the
   *   category-level fallback, every registered queue type finalized.
   *
   * In every case a scanner that sent its last batch and is not finalized
   * yet holds the end (`scannersAwaitingFinalization`): its own
   * finalization dispatches it.
   */
  private async scanEndReadiness(
    redis: Redis,
    scanId: string,
    counts: Map<string, number>,
    scan: ScanResponse | undefined,
  ): Promise<'ready' | 'waiting' | 'nothing_finalized'> {
    if (!scan?.containers?.length) {
      const registeredTypes =
        await this.scanQueueService.getRegisteredScanQueueTypes(scanId);
      const finalizedTypes = await redis.smembers(
        `scan-finalized-types:${scanId}`,
      );
      const missingTypes = registeredTypes.filter(
        (type) => !finalizedTypes.includes(type),
      );
      if (missingTypes.length > 0) {
        this.logger.warn(
          `[ScanCompleteNotification] Scan ${scanId} unread or without containers: waiting for registered queue types [${missingTypes.join(', ')}] to finalize.`,
        );
        return 'waiting';
      }
    } else if (counts.size > 0) {
      if (!(await this.allScannersFinalized(redis, scanId, counts))) {
        return 'waiting';
      }
    } else {
      if (!(scan.containers ?? []).every((c) => this.isClosedContainer(c))) {
        this.logger.log(
          `[ScanCompleteNotification] Scan ${scanId}: no scanner left to count, but a container still runs. Waiting for its end.`,
        );
        return 'waiting';
      }
      const finalizedTypes = await redis.scard(
        `scan-finalized-types:${scanId}`,
      );
      if (finalizedTypes === 0) {
        this.logger.log(
          `[ScanCompleteNotification] Scan ${scanId} ended with no scanner left to wait for and none finalized. Nothing to dispatch.`,
        );
        return 'nothing_finalized';
      }
    }

    const awaiting = await this.scannersAwaitingFinalization(redis, scanId);
    if (awaiting.length > 0) {
      this.logger.log(
        `[ScanCompleteNotification] Scan ${scanId}: [${awaiting.join(', ')}] sent their last batch and are not finalized yet. Waiting: their finalization dispatches the end.`,
      );
      return 'waiting';
    }
    return 'ready';
  }

  /** A container that will report nothing more: completed, degraded or failed. */
  private isClosedContainer(container: { status?: string }): boolean {
    return ['completed', 'completed_degraded', 'failed', 'error'].includes(
      (container.status || '').toLowerCase(),
    );
  }

  /**
   * The scanners of a scan whose last batch arrived and whose finalization is
   * still to come, as `<queue type>/<scanner>`. A scanner already in the
   * finalized set is left out: a finalization adds it there before
   * `clearBatchTracking` removes its expected count, so one in both states
   * is done.
   */
  private async scannersAwaitingFinalization(
    redis: Redis,
    scanId: string,
  ): Promise<string[]> {
    const awaiting: string[] = [];
    for (const queueType of SCAN_QUEUE_TYPES) {
      const pending =
        await this.scanQueueService.getScannersAwaitingFinalization(
          queueType,
          scanId,
        );
      if (pending.length === 0) continue;
      const finalized = await redis.smembers(
        `scan-finalized-scanners:${scanId}:${queueType}`,
      );
      for (const scanner of pending) {
        if (!finalized.includes(scanner)) {
          awaiting.push(`${queueType}/${scanner}`);
        }
      }
    }
    return awaiting;
  }

  /**
   * Whether every expected scanner of each category has finalized its
   * results (`scan-finalized-scanners:<scanId>:<category>`).
   */
  private async allScannersFinalized(
    redis: Redis,
    scanId: string,
    expectedCounts: Map<string, number>,
  ): Promise<boolean> {
    for (const [category, expectedCount] of expectedCounts.entries()) {
      const categoryKey = `scan-finalized-scanners:${scanId}:${category}`;
      const finalizedCount = await redis.scard(categoryKey);
      if (finalizedCount < expectedCount) {
        this.logger.log(
          `[ScanCompleteNotification] Scan ${scanId} category '${category}': ${finalizedCount}/${expectedCount} scanners finalized. Waiting.`,
        );
        return false;
      }
    }
    return true;
  }

  /**
   * Dispatch the end of a scan whose scanners are all finalized: defer it
   * while the AI agent runs, else, once per scan (the scan-complete lock),
   * notify, create the issues and enqueue the cyber-risk recompute.
   *
   * Throws only before the lock is taken (the deferral write); past it,
   * every failure is logged, so a caller that retries never finds a
   * dispatch half done.
   */
  private async dispatchScanEnd(
    scanId: string,
    projectId: string,
    scannerType: string,
    finalizationScan?: ScanResponse,
  ): Promise<ScanEndOutcome> {
    // Check if the scan has an agent container that is still pending. A
    // closed container never reopens, so the scan read above is enough to
    // tell that the agent is done; a pending one is re-read below.
    const agentPending = await this.isAgentPendingForScan(scanId, {
      knownScan: finalizationScan,
    });
    if (agentPending) {
      this.logger.log(
        `[ScanCompleteNotification] Agent analysis still pending for scan ${scanId}. Deferring notification until agent completes.`,
      );
      await this.saveDeferredNotification(scanId, projectId, scannerType);
      // The agent may have ended between the check above and this write, and
      // its notifyScanComplete then found no key and did nothing. Look once
      // more, and dispatch only on a confirmed end: notifyScanComplete reads
      // the key and takes the scan-complete lock, so the notification still
      // goes out exactly once. The agent was running a moment ago, so when
      // security-scanning cannot be asked, the key stays for its own call.
      const stillPending = await this.isAgentPendingForScan(scanId, {
        assumePendingOnError: true,
      });
      if (!stillPending) {
        this.logger.log(
          `[ScanCompleteNotification] Agent ended while the notification for scan ${scanId} was being deferred. Dispatching it now.`,
        );
        await this.notifyScanComplete(scanId);
      }
      return 'deferred';
    }

    // Acquire a Redis lock to prevent duplicate notifications
    const lockAcquired = await this.acquireScanNotificationLock(scanId);
    if (!lockAcquired) {
      this.logger.log(
        `[ScanCompleteNotification] Notification already sent for scan ${scanId}. Skipping.`,
      );
      return 'already_dispatched';
    }

    // Reuse the scan read above for both the diff-scan isolation check and
    // the notification's scanType/branch; read it only if that read failed.
    const scan =
      finalizationScan ?? (await this.fetchScanForFinalization(scanId));

    // Diff scans (changed-files only, pre-commit/agent) are fully
    // isolated. They must NOT send scan-complete notifications, auto-create
    // Jira/GitHub issues, NOR trigger a cyber-risk recompute — their findings
    // never reach the project's posture/stats/cyber-risk (they live in the
    // ephemeral diff_scan_finding store). Skipping the recompute also avoids
    // saturating the shared DB on every pre-commit run.
    if (scan?.isDiffScan === true) {
      this.logger.log(
        `[ScanCompleteNotification] Diff scan ${scanId} — isolated: skipping notifications, issue creation and cyber-risk recompute.`,
      );
      return 'diff_scan';
    }

    // If fetchScanForFinalization failed (getScan threw), `scan` is undefined
    // and the check above is false, so we fall through and treat it as a
    // normal scan. That fallback is intentional and conservative: a transient
    // gRPC hiccup must never SILENCE a real scan's completion notification.
    // The blast radius if a diff scan ever slipped through here is bounded —
    // diff findings never reach the posture tables, so issue creation finds
    // nothing to create and the cyber-risk recompute is a no-op.

    try {
      // The scan-completed listeners run once per scan (the Redis lock above)
      // and not for diff scans, which returned above — with the same caveat
      // as the paragraph right before: a diff scan whose getScan failed is
      // treated as a normal scan and does reach them.
      await this.runScanCompletedListeners(scanId, projectId);

      this.logger.log(
        `[ScanCompleteNotification] All processing complete for scan ${scanId}. Dispatching notifications and creating issues...`,
      );

      const project = await this.dispatchNotifications(
        scanId,
        projectId,
        scannerType,
        scan,
      );

      // Trigger issue creation (GitHub, GitLab, Jira) now that all results are saved
      await this.triggerIssueCreation(scanId, projectId, {
        project,
        scanBranch: scan?.branch,
      });
      await this.cyberiskEnqueuer.enqueue(projectId, 'scan_complete');
    } catch (error) {
      this.logger.error(
        `[ScanCompleteNotification] Error dispatching notifications for scan ${scanId}: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
    return 'dispatched';
  }

  /**
   * Fetch the scan once (best-effort) so a single getScan serves both
   * the diff-scan isolation check (`isDiffScan`) AND the notification's
   * scanType/branch — instead of two separate round-trips per finalization. On
   * failure returns `undefined`; callers then treat the scan as a normal scan
   * (so notifications are never lost) and dispatchNotifications falls back to
   * its own fetch.
   */
  private async fetchScanForFinalization(
    scanId: string,
  ): Promise<ScanResponse | undefined> {
    try {
      return await safeGrpcCall(this.scanServiceClient.getScan({ scanId }));
    } catch (e) {
      this.logger.warn(
        `[ScanCompleteNotification] Could not fetch scan ${scanId}: ${(e as Error).message}. Treating as a normal scan.`,
      );
      return undefined;
    }
  }

  /**
   * Run every scan-completed listener, one after the other, best-effort: a
   * listener that throws or rejects is logged and ignored, so none can cost a
   * scan its notifications, issues or cyber-risk recompute, nor stop the
   * listeners after it.
   */
  private async runScanCompletedListeners(
    scanId: string,
    projectId: string,
  ): Promise<void> {
    for (const listener of this.scanCompletedListeners ?? []) {
      try {
        await listener.onScanCompleted(scanId, projectId);
      } catch (error) {
        this.logger.warn(
          `[ScanCompleteNotification] A scan-completed listener failed for scan ${scanId} (ignored): ${(error as Error).message}`,
        );
      }
    }
  }

  /**
   * Determine how many scanners are expected per category (sca, sast-iac, container)
   * by looking at the scan's containers from the security-scanning-service.
   *
   * This is the authoritative source: it knows all scanners that were launched,
   * even those that haven't sent any results yet.
   *
   * @returns `counts`: category → expected scanner count (e.g. { 'sast-iac': 2,
   *   'sca': 1 }), empty when unknown; `scan`: the scan read for it, absent
   *   when the read failed.
   */
  private async getExpectedScannerCounts(
    scanId: string,
  ): Promise<{ counts: Map<string, number>; scan?: ScanResponse }> {
    try {
      const scan = await safeGrpcCall(
        this.scanServiceClient.getScan({ scanId }),
      );
      if (!scan?.containers?.length) {
        return { counts: new Map(), scan };
      }

      const counts = new Map<string, number>();
      for (const container of scan.containers) {
        const status = (container.status || '').toLowerCase();
        // Skip containers that failed before sending any results
        if (status === 'failed' || status === 'error') {
          continue;
        }

        const category = this.mapImageToCategory(container.image || '');
        if (category) {
          counts.set(category, (counts.get(category) || 0) + 1);
        }
      }

      return { counts, scan };
    } catch (e) {
      this.logger.warn(
        `[ScanCompleteNotification] Could not fetch scan containers for ${scanId}: ${(e as Error).message}. Falling back to registered types.`,
      );
      return { counts: new Map() };
    }
  }

  /**
   * Map a scanner container image name to its queue category.
   *
   * Scanner images follow the pattern: scanlink-{type}-{name}
   * - scanlink-sast-opengrep, scanlink-sast-semgrep, etc. → sast-iac
   * - scanlink-iac-kics, scanlink-iac-checkov → sast-iac
   * - scanlink-secret-gitleaks → sast-iac: its secrets go through the
   *   SAST/IaC queue, it finalizes there, and the issue creation reads them
   *
   * - scanlink-sca → sca
   * - scanlink-container → container
   *
   * Community scans on a connected Kubernetes cluster run the open-source
   * `cybedefend-scanners/<adapter>` images: opengrep, zizmor, gitleaks and
   * trivy-config import through the SAST/IaC queue (sast-iac), trivy-fs
   * through the SCA one (sca). Any other cybedefend-scanners image (trivy-image
   * is not launched in v1) has no category.
   */
  private mapImageToCategory(image: string): string | null {
    // Extract the base image name: the last path segment, without its tag
    // or digest. Splitting on ':' before '/' cut a registry with a port
    // (`registry.local:5000/scanners/<image>:<tag>`) to its host.
    const segments = image.split('@')[0].split('/');
    const lastSegment = segments.pop() ?? '';
    const baseName = lastSegment.split(':')[0].toLowerCase();

    // The Community images, `cybedefend-scanners/<adapter>`: the last two
    // segments. trivy-fs first, the only one that is not sast-iac. Exact
    // names, so that an unknown adapter counts nowhere.
    const communityName = `${(segments.pop() ?? '').toLowerCase()}/${baseName}`;
    if (communityName === 'cybedefend-scanners/trivy-fs') {
      return 'sca';
    }
    if (COMMUNITY_SAST_IAC_IMAGES.has(communityName)) {
      return 'sast-iac';
    }

    // Check specific prefixes (order matters: sast/iac before sca
    // because all images start with "scanlink-" which contains "sca")
    if (
      baseName.startsWith('scanlink-sast-') ||
      baseName.startsWith('scanlink-iac-') ||
      baseName.startsWith('scanlink-secret-')
    ) {
      return 'sast-iac';
    }
    if (baseName === 'scanlink-sca') {
      return 'sca';
    }
    if (baseName === 'scanlink-container') {
      return 'container';
    }
    return null;
  }

  /**
   * Acquire a Redis lock to ensure only one notification per scan.
   * Returns true if the lock was acquired (first caller wins).
   */
  private async acquireScanNotificationLock(scanId: string): Promise<boolean> {
    try {
      const redis = await this.scanQueueService.getRedisClient();
      const key = `scan-complete-notification:${scanId}`;
      const result = await redis.set(
        key,
        '1',
        'EX',
        SCAN_COMPLETE_LOCK_TTL_SEC,
        'NX',
      );
      return result === 'OK';
    } catch (error) {
      this.logger.warn(
        `[ScanCompleteNotification] Failed to acquire lock for scan ${scanId}: ${(error as Error).message}`,
      );
      // If we can't acquire the lock, proceed anyway to avoid missing notifications
      return true;
    }
  }

  /**
   * Fetch project preferences and dispatch email/Slack notifications.
   *
   * Never throws: the issue creation and the cyber-risk
   * recompute that follow it sat in the same try, and a global-management
   * outage or a failed count skipped them. Returns the project it read, for
   * the issue creation, or undefined when the read failed.
   */
  private async dispatchNotifications(
    scanId: string,
    projectId: string,
    scannerType: string,
    cachedScan?: ScanResponse,
  ): Promise<ProjectInformationsResponse | undefined> {
    let project: ProjectInformationsResponse | undefined;
    try {
      project = await safeGrpcCall(this.projectClient.get({ projectId }));
      await this.sendNotifications(
        project,
        scanId,
        projectId,
        scannerType,
        cachedScan,
      );
    } catch (error) {
      this.logger.error(
        `[ScanCompleteNotification] Failed to dispatch notifications for scan ${scanId}: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
    return project;
  }

  /**
   * Send the email/Slack notifications the project's preferences ask for.
   */
  private async sendNotifications(
    project: ProjectInformationsResponse | undefined,
    scanId: string,
    projectId: string,
    scannerType: string,
    cachedScan?: ScanResponse,
  ): Promise<void> {
    const emailEnabled = project?.scanCompleteEmailEnabled ?? false;
    const slackEnabled = project?.scanCompleteSlackEnabled ?? false;

    if (!emailEnabled && !slackEnabled) {
      this.logger.log(
        `[ScanCompleteNotification] No notifications enabled for project ${projectId}. Skipping.`,
      );
      return;
    }

    // Resolve scanner type and branch from the caller-provided scan when present
    // (single fetch hoisted in onScannerFinalized); otherwise fetch it here.
    let resolvedScannerType = scannerType;
    let branch = '';
    let scan = cachedScan;
    if (!scan) {
      try {
        scan = await safeGrpcCall(this.scanServiceClient.getScan({ scanId }));
      } catch (e) {
        this.logger.warn(
          `[ScanCompleteNotification] Could not fetch scan info for ${scanId}: ${(e as Error).message}`,
        );
      }
    }
    if (scan?.scanType) {
      resolvedScannerType = scan.scanType;
    }
    if (scan?.branch) {
      branch = scan.branch;
    }

    // Collect severity counts for this branch (or all branches if no branch)
    const severities = await this.getSeverityCounts(projectId, branch);
    const types = await this.getTypeCounts(projectId, branch);
    const total =
      severities.critical +
      severities.high +
      severities.medium +
      severities.low;

    // Send email notification
    if (emailEnabled) {
      try {
        const req: ScanCompleteReportRequest = {
          projectId,
          projectName: project.name || '',
          scanId,
          severities,
          types,
          total,
          topVulnerabilities: [], // Not including top vulns for now to keep it lightweight
          scannerType: resolvedScannerType,
          branch,
        };
        await safeGrpcCall(this.mailClient.sendScanCompleteReport(req));
        this.logger.log(
          `[ScanCompleteNotification] Email notification sent for scan ${scanId}, project ${projectId}`,
        );
      } catch (error) {
        this.logger.error(
          `[ScanCompleteNotification] Failed to send email for scan ${scanId}: ${(error as Error).message}`,
        );
      }
    }

    // Send Slack notification
    if (slackEnabled) {
      try {
        const payload = {
          projectId,
          projectName: project.name || '',
          scanId,
          scannerType: resolvedScannerType,
          branch,
          severities,
          types,
          total,
        };
        const req: SendSlackNotificationRequest = {
          projectId,
          notificationType: 'scan_complete',
          payloadJson: JSON.stringify(payload),
        };
        await safeGrpcCall(this.slackClient.sendNotification(req));
        this.logger.log(
          `[ScanCompleteNotification] Slack notification sent for scan ${scanId}, project ${projectId}`,
        );
      } catch (error) {
        this.logger.error(
          `[ScanCompleteNotification] Failed to send Slack notification for scan ${scanId}: ${(error as Error).message}`,
        );
      }
    }
  }

  /**
   * Get severity counts for active vulnerabilities in a project, optionally filtered by branch.
   */
  private async getSeverityCounts(
    projectId: string,
    branch?: string,
  ): Promise<SeverityBreakdown> {
    const activeStates = [...ACTIVE_VULN_STATES];

    const countBySeverity = async (
      repo: Repository<any>,
      severity: string,
    ): Promise<number> => {
      const where: Record<string, any> = {
        projectId,
        currentSeverity: severity,
        currentState: In(activeStates),
      };
      if (branch) {
        where.branch = branch;
      }
      return repo.count({ where });
    };

    const [
      criticalSast,
      highSast,
      mediumSast,
      lowSast,
      criticalIac,
      highIac,
      mediumIac,
      lowIac,
      criticalSca,
      highSca,
      mediumSca,
      lowSca,
      criticalContainer,
      highContainer,
      mediumContainer,
      lowContainer,
    ] = await Promise.all([
      countBySeverity(this.sastRepo, 'critical'),
      countBySeverity(this.sastRepo, 'high'),
      countBySeverity(this.sastRepo, 'medium'),
      countBySeverity(this.sastRepo, 'low'),
      countBySeverity(this.iacRepo, 'critical'),
      countBySeverity(this.iacRepo, 'high'),
      countBySeverity(this.iacRepo, 'medium'),
      countBySeverity(this.iacRepo, 'low'),
      countBySeverity(this.scaRepo, 'critical'),
      countBySeverity(this.scaRepo, 'high'),
      countBySeverity(this.scaRepo, 'medium'),
      countBySeverity(this.scaRepo, 'low'),
      countBySeverity(this.containerRepo, 'critical'),
      countBySeverity(this.containerRepo, 'high'),
      countBySeverity(this.containerRepo, 'medium'),
      countBySeverity(this.containerRepo, 'low'),
    ]);

    return {
      critical: criticalSast + criticalIac + criticalSca + criticalContainer,
      high: highSast + highIac + highSca + highContainer,
      medium: mediumSast + mediumIac + mediumSca + mediumContainer,
      low: lowSast + lowIac + lowSca + lowContainer,
    };
  }

  /**
   * Get vulnerability type counts for active vulnerabilities in a project, optionally filtered by branch.
   */
  private async getTypeCounts(
    projectId: string,
    branch?: string,
  ): Promise<TypeBreakdown> {
    const activeStates = [...ACTIVE_VULN_STATES];
    const where: Record<string, any> = {
      projectId,
      currentState: In(activeStates),
    };
    if (branch) {
      where.branch = branch;
    }

    const [sast, iac, sca, container] = await Promise.all([
      this.sastRepo.count({ where }),
      this.iacRepo.count({ where }),
      this.scaRepo.count({ where }),
      this.containerRepo.count({ where }),
    ]);

    return { sast, iac, sca, container };
  }

  /**
   * Check if the scan has an agent container that is still pending (not in terminal state).
   * Used to defer notifications until the agent analysis completes.
   *
   * When security-scanning cannot be asked, the answer is `assumePendingOnError`:
   * false for the first check (notify now rather than never), true for the
   * check made after writing the deferral, where the agent was just seen
   * running and its own notifyScanComplete will find the key.
   *
   * `knownScan`, when given, is a scan the caller already read: it is used
   * instead of asking security-scanning again.
   */
  private async isAgentPendingForScan(
    scanId: string,
    {
      assumePendingOnError = false,
      knownScan,
    }: { assumePendingOnError?: boolean; knownScan?: ScanResponse } = {},
  ): Promise<boolean> {
    try {
      const scan =
        knownScan ??
        (await safeGrpcCall(this.scanServiceClient.getScan({ scanId })));
      if (!scan?.containers?.length) return false;

      const agentContainer = scan.containers.find((c) => {
        const baseName =
          (c.image || '').split(':')[0].split('/').pop()?.toLowerCase() || '';
        return baseName.includes('agent');
      });

      if (!agentContainer) return false;

      const terminalStates = ['completed', 'failed', 'completed_degraded'];
      return !terminalStates.includes(
        (agentContainer.status || '').toLowerCase(),
      );
    } catch (e) {
      if (assumePendingOnError) {
        this.logger.warn(
          `[ScanCompleteNotification] Could not re-check agent status for scan ${scanId}: ${(e as Error).message}. Keeping the deferred notification for the agent's own notifyScanComplete.`,
        );
        return true;
      }
      this.logger.warn(
        `[ScanCompleteNotification] Could not check agent status for scan ${scanId}: ${(e as Error).message}. Proceeding without deferral.`,
      );
      return false;
    }
  }

  /**
   * Save deferred notification state in Redis.
   * Called when all scanner queues are done but the agent is still running.
   */
  @Span()
  private async saveDeferredNotification(
    scanId: string,
    projectId: string,
    scannerType: string,
  ): Promise<void> {
    const redis = await this.scanQueueService.getRedisClient();
    const key = `scan-notification-deferred:${scanId}`;
    await redis.set(
      key,
      JSON.stringify({ projectId, scannerType }),
      'EX',
      this.deferredNotificationTtlSec,
    );
  }

  /**
   * Dispatch a deferred scan completion notification.
   * Called by security-scanning-service when the agent container completes.
   *
   * @param scanId The scan ID
   */
  @Span()
  async notifyScanComplete(scanId: string): Promise<void> {
    try {
      const redis = await this.scanQueueService.getRedisClient();
      const deferredKey = `scan-notification-deferred:${scanId}`;
      const deferredData = await redis.get(deferredKey);

      if (!deferredData) {
        this.logger.log(
          `[ScanCompleteNotification] No deferred notification for scan ${scanId}. Skipping.`,
        );
        return;
      }

      const { projectId: storedProjectId, scannerType } =
        JSON.parse(deferredData);

      const lockAcquired = await this.acquireScanNotificationLock(scanId);
      if (!lockAcquired) {
        this.logger.log(
          `[ScanCompleteNotification] Notification already sent for scan ${scanId}. Skipping.`,
        );
        return;
      }

      // Fetch the scan once for both the isolation guard and dispatch (see
      // onScannerFinalized — same single-fetch optimisation).
      const scan = await this.fetchScanForFinalization(scanId);

      // Defence-in-depth — diff scans are isolated and never run the
      // AI agent, so they should never reach this deferred path; guard anyway.
      if (scan?.isDiffScan === true) {
        this.logger.log(
          `[ScanCompleteNotification] Deferred path for diff scan ${scanId} — isolated: skipping notifications, issues and cyber-risk recompute.`,
        );
        await redis.del(deferredKey);
        return;
      }

      this.logger.log(
        `[ScanCompleteNotification] Agent completed. Dispatching deferred notification for scan ${scanId}.`,
      );

      // Same listeners as onScannerFinalized. An agent-enabled scan reaches
      // completion through THIS path instead, and the two are mutually
      // exclusive (both sit behind the same scan-complete lock), so a
      // deferred scan still reaches them exactly once.
      await this.runScanCompletedListeners(scanId, storedProjectId);

      const project = await this.dispatchNotifications(
        scanId,
        storedProjectId,
        scannerType,
        scan,
      );
      await this.triggerIssueCreation(scanId, storedProjectId, {
        project,
        scanBranch: scan?.branch,
      });
      await this.cyberiskEnqueuer.enqueue(storedProjectId, 'scan_complete');

      // Clean up deferred key
      await redis.del(deferredKey);
    } catch (error) {
      this.logger.error(
        `[ScanCompleteNotification] Error dispatching deferred notification for scan ${scanId}: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }

  /**
   * Claim a scan's issue creation: `SET NX scan-issues:<scanId>`, kept 7
   * days. analysis-reporting alone creates a scan's issues,
   * and every way in ends here, security-scanning's legacy
   * CreateIssuesForScan included (sent by its older pods while both versions
   * run). The scan-complete lock already gives one dispatch per scan, but for
   * about 2 h only. A creation that fails gives the claim back
   * (`releaseIssueCreationClaim`). A Redis error lets the creation go ahead,
   * as the scan-complete lock does: a duplicate attempt (the integrations
   * look an issue up before creating it) is better than no issue.
   *
   * @returns true when this call may create the issues.
   */
  private async claimIssueCreation(scanId: string): Promise<boolean> {
    try {
      const redis = await this.scanQueueService.getRedisClient();
      const result = await redis.set(
        `scan-issues:${scanId}`,
        '1',
        'EX',
        ISSUE_CREATION_CLAIM_TTL_SEC,
        'NX',
      );
      return result === 'OK';
    } catch (error) {
      this.logger.warn(
        `[ScanCompleteNotification] Could not claim the issue creation of scan ${scanId}, creating them anyway: ${(error as Error).message}`,
      );
      return true;
    }
  }

  /**
   * Trigger issue creation for all integrations (GitHub, GitLab, Jira).
   * Called after all scan results have been processed and saved.
   *
   * @param known the project and the scan's branch this dispatch already
   *   read, so the issue creation does not ask global-management again.
   */
  private async triggerIssueCreation(
    scanId: string,
    projectId: string,
    known: IssueCreationContext,
  ): Promise<void> {
    if (!(await this.claimIssueCreation(scanId))) {
      this.logger.log(
        `[ScanCompleteNotification] Issues already created for scan ${scanId}. Skipping.`,
      );
      return;
    }
    let failed = false;
    try {
      this.logger.log(
        `[ScanCompleteNotification] Triggering issue creation for scan ${scanId}`,
      );
      const result = await this.issueIntegrationService.createIssuesForScan(
        projectId,
        scanId,
        undefined,
        known,
      );
      failed = result?.success === false;
      this.logger.log(
        `[ScanCompleteNotification] Issue creation result for scan ${scanId}: ${result.message}`,
      );
    } catch (error) {
      failed = true;
      this.logger.error(
        `[ScanCompleteNotification] Issue creation failed for scan ${scanId}: ${(error as Error).message}`,
      );
    }
    if (failed) {
      await this.releaseIssueCreationClaim(scanId);
    }
  }

  /**
   * Give back the claim of an issue creation that failed (a
   * global-management or external-integrations error), so that a later
   * dispatch may try again rather than wait out the 7 days. The
   * integrations look an issue up before creating it, so another attempt
   * after a partial creation is safe. Never throws.
   */
  private async releaseIssueCreationClaim(scanId: string): Promise<void> {
    try {
      const redis = await this.scanQueueService.getRedisClient();
      await redis.del(`scan-issues:${scanId}`);
    } catch (error) {
      this.logger.warn(
        `[ScanCompleteNotification] Could not give back the issue creation claim of scan ${scanId}: ${(error as Error).message}`,
      );
    }
  }
}
