import {
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { Queue, JobsOptions } from 'bullmq';
import {
  ScanAddScaResultRequest,
  ScanAddResultRequest,
  ScanAddContainerResultRequest,
} from '@grpc/analysis-reporting/result';
import { QUEUE_NAMES } from './queue-names';
import { QueueBacklogResponse, QueueDepthStats } from './queue-metrics.types';
import {
  QUEUE_BACKLOG_EXTENSIONS,
  QueueBacklogExtension,
} from '../../edition/ports/queue-backlog-extensions.port';
import Redis from 'ioredis';
import { createHash, randomUUID } from 'crypto';
import {
  compareOccurrenceEntries,
  normalizeOccurrenceLine,
} from '../findings-export/fingerprint.util';
import type { ImportCategory } from '../results-import/catalogue-fallback.service';

/**
 * Job data of a SARIF import: one job per import scan, or,
 * for a Community cluster scan, one job per scanner container.
 * `category` is the import type that security-scanning copied from
 * `CreateScanRequest.import_type`, or the container's category; `fileKey` is
 * `import/<projectId>/<scanId>.sarif` (`import/<projectId>/<scanId>/
 * <containerId>.sarif` with a container), read through file-management's
 * GetImportDownloadUrl.
 */
export interface ResultsImportJobData {
  scanId: string;
  projectId: string;
  organizationId: string;
  branch: string;
  category: ImportCategory;
  format: 'sarif';
  fileKey: string;
  /** The image reference of a container import; absent otherwise. */
  image?: string;
  /**
   * The scanner container whose file this is (Community cluster scans only):
   * the job is `results-import-<scanId>-<containerId>` and CompleteImportScan
   * carries it back. Absent for a file import.
   */
  containerId?: string;
  /**
   * The severities the project keeps, `critical|high|medium|low` comma-joined
   * (Community cluster scans only). Absent: every severity is asked for.
   */
  severities?: string;
  /**
   * The CycloneDX SBOM sent with an `sca` import, `import/<p>/<s>.sbom`, or
   * by the sca container of a Community cluster scan, `import/<p>/<s>/<c>.sbom`:
   * its packages and the SARIF's vulnerabilities are one picture of the
   * branch, ingested and finalized together (once per job, so once per sca
   * container). Absent: the SARIF alone.
   */
  sbomFileKey?: string;
}

/**
 * Files a user sent for import that one organization may have waiting in the
 * results-import queue (the files of the instance's own scans are never
 * refused, only ordered). Tunable with RESULTS_IMPORT_MAX_WAITING_PER_ORG (a
 * positive integer; anything else keeps the default).
 */
export const DEFAULT_MAX_WAITING_IMPORTS_PER_ORG = 50;

export function maxWaitingImportsPerOrg(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = Number(env.RESULTS_IMPORT_MAX_WAITING_PER_ORG);
  return Number.isInteger(raw) && raw > 0
    ? raw
    : DEFAULT_MAX_WAITING_IMPORTS_PER_ORG;
}

/** BullMQ's lowest priority (the largest number it accepts). */
const BULLMQ_MAX_PRIORITY = 2_097_152;
/** The turns are renumbered past this value, well under the limit. */
const RESULTS_IMPORT_TURN_REBASE_AT = 1_048_576;
/**
 * A reserved place counts for this long even before its job is visible in
 * the queue (the add follows the reservation).
 */
const RESULTS_IMPORT_RESERVATION_GRACE_MS = 30_000;

/**
 * One atomic step for a new results-import job: the cap of user imports
 * waiting per organization, and the job's turn.
 *
 * KEYS: 1 prioritized, 2 wait, 3 delayed, 4 paused (the queue's own keys),
 *   5 turn being served, 6 highest turn given, 7 hash org -> next turn,
 *   8 the organization's waiting user imports (sorted set id -> reserved at).
 * ARGV: 1 org, 2 jobId, 3 user import (1/0), 4 cap, 5 now (ms),
 *   6 grace (ms), 7 renumber above, 8 queue key prefix (for job hashes).
 *
 * The waiting set forgets a job once it left the queue's waiting lists
 * (taken by the worker, removed): there is no counter to keep in step with
 * the worker. A place reserved but not yet added counts for its grace
 * period; once the job is added its score is 0 and only its presence in the
 * queue counts. The turn being served is the
 * head of the prioritized set minus one, or the highest turn given when
 * nothing waits. Past ARGV[7] every turn is lowered by the turn being
 * served, the waiting jobs' priorities included, so their order is
 * unchanged. Returns the turn, or -1 when the user import is refused.
 */
const RESERVE_RESULTS_IMPORT_TURN = `
local SHIFT = 4294967296
if ARGV[3] == '1' then
  local now = tonumber(ARGV[5])
  local grace = tonumber(ARGV[6])
  local members = redis.call('ZRANGE', KEYS[8], 0, -1, 'WITHSCORES')
  local live = 0
  for i = 1, #members, 2 do
    local id = members[i]
    local at = tonumber(members[i + 1])
    local present = redis.call('ZSCORE', KEYS[1], id)
      or redis.call('ZSCORE', KEYS[3], id)
      or redis.call('LPOS', KEYS[2], id)
      or redis.call('LPOS', KEYS[4], id)
    if present or (at > 0 and (now - at) < grace) then
      live = live + 1
    else
      redis.call('ZREM', KEYS[8], id)
    end
  end
  if live >= tonumber(ARGV[4]) then
    return -1
  end
  redis.call('ZADD', KEYS[8], now, ARGV[2])
end
local turn = tonumber(redis.call('GET', KEYS[5]) or '0')
local maxturn = tonumber(redis.call('GET', KEYS[6]) or '0')
local head = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
if #head > 0 then
  local served = math.floor(tonumber(head[2]) / SHIFT) - 1
  if served > turn then turn = served end
elseif maxturn > turn then
  turn = maxturn
end
local nextTurn = tonumber(redis.call('HGET', KEYS[7], ARGV[1]) or '0')
local mine = math.max(turn, nextTurn) + 1
if mine > maxturn then maxturn = mine end
if mine > tonumber(ARGV[7]) and turn > 0 then
  local base = turn
  local waiting = redis.call('ZRANGE', KEYS[1], 0, -1, 'WITHSCORES')
  for i = 1, #waiting, 2 do
    local score = tonumber(waiting[i + 1])
    local prio = math.floor(score / SHIFT)
    local counter = score - prio * SHIFT
    local lowered = math.max(1, prio - base)
    redis.call('ZADD', KEYS[1], lowered * SHIFT + counter, waiting[i])
    redis.call('HSET', ARGV[8] .. waiting[i], 'priority', lowered)
  end
  local nexts = redis.call('HGETALL', KEYS[7])
  for i = 1, #nexts, 2 do
    redis.call('HSET', KEYS[7], nexts[i], math.max(0, tonumber(nexts[i + 1]) - base))
  end
  turn = turn - base
  maxturn = math.max(0, maxturn - base)
  mine = math.max(1, mine - base)
end
redis.call('HSET', KEYS[7], ARGV[1], mine)
redis.call('SET', KEYS[5], turn)
redis.call('SET', KEYS[6], maxturn)
return mine
`;

/**
 * Job data for SCA scan processing
 */
export interface ScaJobData {
  request: ScanAddScaResultRequest;
  isLast: boolean;
  batchIndex: number;
  scanId: string;
  projectId: string;
  scannerName: string;
}

/**
 * Job data for SAST/IAC scan processing
 */
export interface SastIacJobData {
  request: ScanAddResultRequest;
  isLast: boolean;
  batchIndex: number;
  scanId: string;
  projectId: string;
  scannerName: string;
}

/**
 * How a secret scanner's git history pass ended, as its last batch reports it
 * (`ScanAddResultRequest.historyPassOutcome`): `ok`, `failed`, or `none` (no
 * history pass ran).
 */
export type HistoryPassOutcome = 'ok' | 'failed' | 'none';

const HISTORY_PASS_OUTCOMES: readonly string[] = ['ok', 'failed', 'none'];

/** The outcome a value names, or null for an absent or unknown value. */
export function parseHistoryPassOutcome(
  value: unknown,
): HistoryPassOutcome | null {
  return typeof value === 'string' && HISTORY_PASS_OUTCOMES.includes(value)
    ? (value as HistoryPassOutcome)
    : null;
}

/**
 * Job data for Container scan processing
 */
export interface ContainerJobData {
  request: ScanAddContainerResultRequest;
  isLast: boolean;
  batchIndex: number;
  scanId: string;
  projectId: string;
  scannerName: string;
}

// ScaAutoFixJobData, ScaAutoFixEnqueueScope, ScaAutoFixEnqueueResult
// and the admission keys moved to the closed SCA autofix module with the
// SCA_AUTOFIX queue.

// AgentReanalysisJobData and enqueueAgentReanalysis moved to the closed
// agent re-analysis module with the AGENT_REANALYSIS queue.

/**
 * Job data for async premium report generation (OWASP / CWE / EU AI Act /
 * scanner-type). The gRPC handler inserts a GeneratedReport row (status
 * "queued") and enqueues this job; the worker builds the PDF/HTML, uploads it
 * and publishes a REPORT_READY realtime event.
 */
export interface ReportJobData {
  reportId: string;
  kind: 'owasp' | 'cwe' | 'eu_ai_act' | 'scanner_type';
  projectId: string;
  format: string;
  detailed: boolean;
  branch?: string;
  scannerTypes?: string[];
  // Async-task tracking so the generation shows in the widget.
  taskId?: string;
  userId?: string;
}

/**
 * Job data for async bulk vulnerability batch-update (status / priority /
 * comment changes applied to N vulnerabilities in one background job).
 * The gRPC handler inserts a BatchUpdateTask row (status "queued") and
 * enqueues this job; the worker applies each item update and publishes a
 * BATCH_UPDATE_COMPLETE realtime event.
 */
export interface VulnBatchUpdateJobData {
  taskId: string;
  projectId: string;
  userId: string;
  items: {
    vulnerabilityId: string;
    status?: string;
    priority?: string;
    comment?: string;
  }[];
  agentToolCallId?: string;
  agentConversationId?: string;
  agentStreamId?: string;
}

/**
 * Job data for async AGGREGATED report generation (organization / team / batch
 * × owasp / cwe / license / ai-act). The gRPC handler inserts an
 * AggregatedReport row (status "queued") and enqueues this job; the worker
 * resolves the scope's project list, builds the PDF/HTML, uploads it and
 * publishes an AGGREGATED_REPORT_READY realtime event.
 */
export interface AggregatedReportJobData {
  reportId: string;
  scopeType: 'organization' | 'team' | 'batch';
  scopeId: string;
  organizationId: string;
  reportType: string;
  format: string;
  detailed: boolean;
  branchFilter: string;
  projectBranchSelections: { projectId: string; branches: string[] }[];
  userId: string;
  // Batch scope only: explicit project list (org/team resolve their list in
  // the worker via gRPC).
  projectIds?: string[];
  // Async-task tracking so the generation shows in the widget.
  taskId?: string;
}

/**
 * Service responsible for adding scan processing jobs to BullMQ queues.
 *
 * Key features:
 * - Jobs are added to Redis-backed queues for async processing
 * - isLast jobs have lower priority (higher number = lower priority)
 * - Uses a Redis counter to track batch completion for isLast processing
 * - Worker processors run in the same process but don't block the event loop
 */
@Injectable()
export class ScanQueueService implements OnModuleInit {
  /**
   * TTL (24h) applied to every batch-tracking Redis key (index, progress,
   * expected, completed set, finalize lock) so abandoned scans cannot leak
   * keys indefinitely.
   */
  private static readonly TRACKING_TTL_SECONDS = 86400;

  /**
   * Maximum arguments packed into one Redis command by the occurrence
   * allocator. It writes one field per finding, so an unchunked HMGET/HSET on a
   * large scanner batch would be a single multi-thousand-argument command.
   */
  private static readonly REDIS_ARG_CHUNK = 1000;

  private readonly logger = new Logger(ScanQueueService.name);
  /**
   * Turn above which the results-import turns are renumbered, so a priority
   * never reaches BullMQ's limit (2^21). Lowered by specs only.
   */
  resultsImportTurnRebaseAt = RESULTS_IMPORT_TURN_REBASE_AT;
  private redisClient: Redis | null = null;

  constructor(
    @InjectQueue(QUEUE_NAMES.SCA) private readonly scaQueue: Queue<ScaJobData>,
    @InjectQueue(QUEUE_NAMES.SAST_IAC)
    private readonly sastIacQueue: Queue<SastIacJobData>,
    @InjectQueue(QUEUE_NAMES.CONTAINER)
    private readonly containerQueue: Queue<ContainerJobData>,
    // The SCA_AUTOFIX queue injection moved to ScaAutoFixQueueService
    // (ee/sca-autofix).
    @InjectQueue(QUEUE_NAMES.CVSS_RECALCULATION)
    private readonly cvssRecalculationQueue: Queue,
    // The AGENT_REANALYSIS queue injection moved to
    // AgentReanalysisEnqueuerService (ee/agent-reanalysis).
    @InjectQueue(QUEUE_NAMES.CYBERISK_RECOMPUTE)
    private readonly cyberiskRecomputeQueue: Queue,
    @InjectQueue(QUEUE_NAMES.REPORTS)
    private readonly reportsQueue: Queue<ReportJobData>,
    @InjectQueue(QUEUE_NAMES.AGGREGATED_REPORTS)
    private readonly aggregatedReportsQueue: Queue<AggregatedReportJobData>,
    @InjectQueue(QUEUE_NAMES.VULN_BATCH_UPDATE)
    private readonly vulnBatchUpdateQueue: Queue<VulnBatchUpdateJobData>,
    // SARIF imports (one job per import scan).
    @InjectQueue(QUEUE_NAMES.RESULTS_IMPORT)
    private readonly resultsImportQueue: Queue<ResultsImportJobData>,
    // Closed queues whose backlog KEDA still reads, supplied by ee
    // modules in the cloud (the AI-BOM queue; the
    // agent-reanalysis queue; The SCA autofix queue). Absent in the
    // Community Edition: the core queues only.
    @Optional()
    @Inject(QUEUE_BACKLOG_EXTENSIONS)
    private readonly backlogExtensions?: QueueBacklogExtension[],
  ) {}

  async onModuleInit(): Promise<void> {
    // Initialize Redis client from the queue's connection
    await this.initializeRedisClient();
  }

  /**
   * Initialize the Redis client from the BullMQ queue connection.
   */
  private async initializeRedisClient(): Promise<void> {
    try {
      // Get the Redis client from BullMQ queue
      const client = await this.scaQueue.client;
      // Create a duplicate connection for our batch tracking
      this.redisClient = (client as unknown as Redis).duplicate();
      this.logger.log('Redis client initialized for batch tracking');
    } catch (error) {
      this.logger.error(
        `Failed to initialize Redis client: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Get or create a Redis client for tracking batch completion.
   * Uses the same connection as BullMQ.
   */
  async getRedisClient(): Promise<Redis> {
    if (!this.redisClient) {
      await this.initializeRedisClient();
    }
    if (!this.redisClient) {
      throw new Error('Redis client not available');
    }
    return this.redisClient;
  }

  /**
   * Normalize a scanner name for use inside a Redis tracking key: lowercase and
   * collapse every non-alphanumeric character to a dash. Single source of truth
   * for the key-builder normalization so the gate keys stay byte-identical.
   */
  private normalizeScanner(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]/g, '-');
  }

  /**
   * Generate a unique key for tracking batch index per scan+scanner (for unique job IDs).
   * Each scanner within a scan gets its own batch index sequence.
   */
  private getBatchIndexKey(
    queueType: 'sca' | 'sast-iac' | 'container' | 'aibom',
    scanId: string,
    scannerName: string,
  ): string {
    // Normalize scanner name to avoid key issues
    const normalizedScanner = this.normalizeScanner(scannerName);
    return `scan-queue:${queueType}:${scanId}:${normalizedScanner}:batch-index`;
  }

  /**
   * Generate a unique key for tracking batch progress per scan+scanner.
   * Each scanner within a scan tracks its own batch completion progress.
   */
  private getBatchProgressKey(
    queueType: 'sca' | 'sast-iac' | 'container' | 'aibom',
    scanId: string,
    scannerName: string,
  ): string {
    const normalizedScanner = this.normalizeScanner(scannerName);
    return `scan-queue:${queueType}:${scanId}:${normalizedScanner}:progress`;
  }

  /**
   * Generate the key holding the EXPECTED number of batches for a
   * scan+scanner combination. Set when the isLast job is enqueued so the
   * finalize gate knows how many distinct batches must complete.
   */
  private getExpectedBatchesKey(
    queueType: 'sca' | 'sast-iac' | 'container' | 'aibom',
    scanId: string,
    scannerName: string,
  ): string {
    const normalizedScanner = this.normalizeScanner(scannerName);
    return `scan-queue:${queueType}:${scanId}:${normalizedScanner}:expected`;
  }

  /**
   * Generate the key of the set of scanners of a scan whose isLast job was
   * enqueued, per queue type. It lists the candidates for
   * `getScannersAwaitingFinalization` without scanning the keyspace.
   */
  private getLastBatchReceivedKey(
    queueType: 'sca' | 'sast-iac' | 'container' | 'aibom',
    scanId: string,
  ): string {
    return `scan-queue:${queueType}:${scanId}:last-batch-received`;
  }

  /**
   * Generate the key holding the (fingerprint group, line) -> occurrence index
   * map for a scan+scanner combination. ONE hash per (scan, scanner), not one
   * key per group, so a scan with thousands of groups still costs one key.
   */
  private getOccurrenceIndexKey(
    queueType: 'sca' | 'sast-iac' | 'container' | 'aibom',
    scanId: string,
    scannerName: string,
  ): string {
    const normalizedScanner = this.normalizeScanner(scannerName);
    return `scan-queue:${queueType}:${scanId}:${normalizedScanner}:occurrence`;
  }

  /**
   * Generate the key recording which (group, index) pairs this scan+scanner has
   * ALREADY handed out, and to which entry.
   *
   * Why it is a SEPARATE key from the counter hash rather than extra fields in
   * it: the counter's uniqueness rests on a single field, `n:<groupId>`, and
   * HINCRBY RECREATES a missing field at 0. If the occurrence key disappears
   * between two batches of one scan — it carries a 24h sliding TTL but lives on
   * the Redis shared with BullMQ, the cross-process caches and rate limiting,
   * so `maxmemory-policy allkeys-lru` can evict it at any moment — the counter
   * silently restarts and the next batch is handed an index an earlier batch
   * already used. That is one fingerprint on two rows, inside a single scan,
   * with no NULL and no log.
   *
   * Two independent keys are evicted independently, so the claims survive the
   * counter's loss and the reallocation is caught. Losing the CLAIMS instead is
   * harmless: the counter is then intact, so the indexes it hands out are still
   * unique and the claims simply rebuild.
   *
   * This does not survive a FLUSHALL or a failover to a cold replica, which
   * takes both keys — no Redis-only guard can. The durable answer is the
   * planned `UNIQUE (projectId, branch, fingerprint)` index.
   */
  private getOccurrenceClaimKey(
    queueType: 'sca' | 'sast-iac' | 'container' | 'aibom',
    scanId: string,
    scannerName: string,
  ): string {
    return `${this.getOccurrenceIndexKey(queueType, scanId, scannerName)}:claims`;
  }

  /**
   * Allocate a stable occurrence index per (fingerprint group, line) for the
   * WHOLE scan+scanner, across batches and across worker pods.
   *
   * Why this cannot be a per-batch ranking: SAST/IaC results arrive as N
   * independent BullMQ jobs per scanner, processed with concurrency >= 3 and on
   * KEDA-scaled pods. Two copies of the same pattern in one file that fall
   * either side of a chunk boundary would each be ranked 0 in their own batch
   * and would then be persisted with an IDENTICAL fingerprint — which merges
   * two distinct findings and makes `ADD UNIQUE INDEX (projectId, branch,
   * fingerprint)` fail on a customer database.
   *
   * Two properties make the mapping both collision-free and retry-safe:
   *
   * - Every ENTRY gets its own hash field, never every (group, line) PAIR. Two
   *   detection rows are distinct today when they differ only in
   *   `vulnerableEndLine` or `language` — both are in `dupWhereBase` and in the
   *   `existingVulnsMap` predicate, and neither is hashed by
   *   `computeCodeFingerprint` nor present in `codeOccurrenceKey`. A pair like
   *   that sharing a start line (or any pair whose vulnerable region normalises
   *   to '', routine for secret/cicd) would otherwise be handed ONE index, i.e.
   *   ONE fingerprint for TWO rows — precisely the `ER_DUP_ENTRY` the planned
   *   `UNIQUE (projectId, branch, fingerprint)` would hit. The per-entry
   *   ordinal `occ` disambiguates them, and the result then agrees with
   *   `assignOccurrenceIndexes` for the same input, so a finding's identity
   *   does not depend on whether Redis answered.
   * - WHICH of that pair gets index 0 comes from the caller's `tieBreak` rather
   *   than from the scanner's output order — FOR THE MEMBERS THAT SHARE A
   *   BATCH; see the residue below, which this sentence used to omit. The
   *   ordinal alone made two same-line findings SWAP fingerprints between two
   *   scans of unchanged code, and every per-fingerprint state (dismissal,
   *   status, first-seen) followed the wrong one. The tie-break is ordered
   *   lexicographically before the ordinal, and it is part of the field name,
   *   so a pair differing only in it can never share a field either.
   *
   * THE RESIDUE — a group SPLIT ACROSS BATCHES is still ordered by batch
   * arrival. `misses.sort(...)` below sorts one call's misses and the following
   * `hincrby(key, n:<groupId>, misses.length)` hands that call one contiguous
   * block, so the block order is whichever batch reached Redis first — and
   * nothing orders batches (N independent BullMQ jobs, concurrency >= 3, KEDA-
   * scaled pods). Two members of one group in two batches therefore swap
   * indexes, hence fingerprints, whenever the batches race differently; not
   * even the ascending-line property survives a split. A group straddling a
   * chunk boundary is the exact case this allocator exists for, so this is not
   * an exotic input.
   *
   * It is NOT closable here. A dense rank by (line, tieBreak) cannot be
   * committed for the first arrival without knowing whether a smaller key is
   * still coming, and the index is written into a digest the moment its batch
   * is ingested. Closing it means allocating indexes (and stamping fingerprints)
   * at the finalize gate, once `setExpectedBatches`/`markBatchCompleted` say the
   * scanner is complete — a different design, and a decision that belongs to
   * whoever flips fingerprints from shadow to authoritative. Until then the
   * behaviour is pinned, not implied, by `scan-queue.occurrence-index.spec.ts`
   * ("the cross-batch residue (known, unclosed)").
   *
   * The agreement with `assignOccurrenceIndexes` is a real contract and is
   * pinned by `scan-queue.occurrence-index.spec.ts`: both sides order on
   * (line, tieBreak, arrival) through `compareOccurrenceEntries`, and both
   * coerce the line through the shared `normalizeOccurrenceLine` — a local
   * `Number(x) || 0` used to sort a NaN line FIRST here while the utility
   * sorted it LAST, and nothing upstream rejects a non-finite line.
   *
   * - The fields are namespaced by a token derived from the batch's own entry
   *   list. It is deterministic, so a BullMQ retry of the SAME job re-reads the
   *   fields it already wrote instead of consuming a fresh range; and it is
   *   distinct per batch, so two different jobs each carrying a finding at the
   *   same (group, line) can never be handed the same index. Chunks of one
   *   scanner's output are disjoint, so that case is two findings, not a retry.
   *
   * Within a batch the caller passes entries in ascending-line order, so the
   * common case (a group wholly inside one batch) comes out line-ordered, i.e.
   * stable under line drift.
   *
   * Neither property survives the counter hash DISAPPEARING mid-scan (HINCRBY
   * recreates a missing field at 0), so every index is checked against the
   * separate claims key before it is handed out — see getOccurrenceClaimKey.
   *
   * @param queueType - Queue family (only 'sast-iac' uses this today).
   * @param scanId - The scan the batch belongs to.
   * @param scannerName - The scanner within that scan.
   * @param entries - {groupKey, line, tieBreak?} in the order indexes should be
   *   handed out. `tieBreak` is the caller's stable discriminator for entries
   *   sharing (group, line) — build it with `occurrenceTieBreak` so its own
   *   components cannot be forged into one another.
   * @returns One index per input entry, positionally aligned, and `null` for
   *   any entry this allocator cannot rank with certainty. `null` means "write
   *   no fingerprint", NOT "index 0" — the caller
   *   (`SastIacService.computeOccurrenceIndexes`) propagates it as such.
   */
  async allocateOccurrenceIndexes(
    queueType: 'sca' | 'sast-iac' | 'container' | 'aibom',
    scanId: string,
    scannerName: string,
    entries: { groupKey: string; line: number; tieBreak?: string }[],
  ): Promise<(number | null)[]> {
    if (!entries?.length) return [];

    const key = this.getOccurrenceIndexKey(queueType, scanId, scannerName);
    const claimKey = this.getOccurrenceClaimKey(queueType, scanId, scannerName);
    const redis = await this.getRedisClient();

    // Short, collision-free-in-practice group id so the hash fields stay small
    // even when the group key carries a whole normalised code snippet.
    const groupIdOf = new Map<string, string>();
    // Per-entry ordinal among the entries of THIS batch that share the same
    // (group, line, tieBreak): what keeps two rows the caller cannot tell apart
    // on two distinct indexes.
    const seenAt = new Map<string, number>();
    const fields = entries.map((e) => {
      const groupKey = String(e.groupKey ?? '');
      let groupId = groupIdOf.get(groupKey);
      if (!groupId) {
        groupId = createHash('sha256')
          .update(groupKey)
          .digest('hex')
          .slice(0, 24);
        groupIdOf.set(groupKey, groupId);
      }
      // Same coercion as `assignOccurrenceIndexes`, from the same function:
      // the two must agree entry-for-entry or a finding's identity depends on
      // whether Redis answered.
      const line = normalizeOccurrenceLine(e.line);
      // Hashed so an arbitrarily long discriminator cannot blow up the field
      // name, and so a tieBreak carrying ':' cannot shift the field boundary.
      const tie = String(e.tieBreak ?? '');
      const tieId = tie
        ? createHash('sha256').update(tie).digest('hex').slice(0, 16)
        : '';
      const at = `${groupId}:${line}:${tieId}`;
      const occ = seenAt.get(at) ?? 0;
      seenAt.set(at, occ + 1);
      return { groupId, line, tie, tieId, occ };
    });

    // Batch namespace: a function of this batch's entry list and nothing else.
    // A retry of the same job re-derives it, so the mapping is re-read rather
    // than re-allocated; a different job derives a different one, so two
    // distinct findings at the same (group, line) can never share a field.
    const batchToken = createHash('sha256')
      .update(fields.map((f) => `${f.groupId}@${f.line}@${f.tieId}`).join('.'))
      .digest('hex')
      .slice(0, 12);

    const nameOf = (f: {
      groupId: string;
      line: number;
      tieId: string;
      occ: number;
    }) => `g:${batchToken}:${f.groupId}:${f.line}:${f.tieId}:${f.occ}`;

    // Read the whole batch back. On a BullMQ retry every field is already
    // there, so the retry re-derives the same indexes instead of consuming a
    // fresh range. The names are unique by construction (the ordinal
    // disambiguates), so this maps 1:1 onto `fields` — which is exactly why the
    // command is chunked: one field per finding would otherwise spread
    // thousands of arguments into a single Redis call.
    const names = fields.map(nameOf);
    const known = new Map<string, number>();
    for (let i = 0; i < names.length; i += ScanQueueService.REDIS_ARG_CHUNK) {
      const slice = names.slice(i, i + ScanQueueService.REDIS_ARG_CHUNK);
      const stored = (await redis.hmget(key, ...slice)) ?? [];
      slice.forEach((f, j) => {
        const v = stored[j];
        if (v != null) known.set(f, Number(v));
      });
    }

    // Allocate the misses one contiguous block per group, filled in ascending
    // (line, tieBreak, ordinal) order — so a group that fits in a single batch
    // comes out line-ordered, i.e. stable under line drift, and identical to
    // what `assignOccurrenceIndexes` would return for the same input. HINCRBY is
    // atomic, so two pods allocating concurrently can never receive the same
    // index.
    const missesByGroup = new Map<
      string,
      {
        groupId: string;
        line: number;
        tie: string;
        tieId: string;
        occ: number;
      }[]
    >();
    for (const f of fields) {
      if (known.has(nameOf(f))) continue;
      const misses = missesByGroup.get(f.groupId) ?? [];
      misses.push(f);
      missesByGroup.set(f.groupId, misses);
    }

    const pending: { name: string; claim: string; index: number }[] = [];
    for (const [groupId, misses] of missesByGroup) {
      // The shared comparator, so this ordering and the fallback's are one
      // definition rather than two that happen to look alike. `ordinal` is the
      // per-(group, line, tieBreak) arrival ordinal here and the array index
      // there; both mean "the caller could not tell these two apart".
      misses.sort((a, b) =>
        compareOccurrenceEntries(
          { line: a.line, tie: a.tie, ordinal: a.occ },
          { line: b.line, tie: b.tie, ordinal: b.occ },
        ),
      );
      const total = await redis.hincrby(key, `n:${groupId}`, misses.length);
      const start = total - misses.length;
      misses.forEach((miss, rank) => {
        pending.push({
          name: nameOf(miss),
          claim: `i:${groupId}:${start + rank}`,
          index: start + rank,
        });
      });
    }

    // The allocation above is PROVISIONAL. `hincrby` recreates a missing field
    // at 0, so if the counter hash was evicted since the previous batch of this
    // scan the block just computed overlaps one already handed out. The claims
    // key is a second, independently-evicted key that remembers which
    // (group, index) pairs are taken and by whom, so that overlap is visible.
    //
    // A claim held by the entry's OWN field name is a BullMQ retry re-deriving
    // its own index — the whole point of the deterministic batch token — and is
    // accepted. A claim held by a DIFFERENT name is a counter restart: that
    // entry is unrankable and comes back `null` rather than duplicating an
    // index. Never guess: a NULL fingerprint is a hole the next healthy scan
    // fills, a duplicate identity never self-heals.
    const heldBy = new Map<string, string>();
    for (let i = 0; i < pending.length; i += ScanQueueService.REDIS_ARG_CHUNK) {
      const slice = pending.slice(i, i + ScanQueueService.REDIS_ARG_CHUNK);
      const stored =
        (await redis.hmget(claimKey, ...slice.map((p) => p.claim))) ?? [];
      slice.forEach((p, j) => {
        const v = stored[j];
        if (v != null) heldBy.set(p.claim, String(v));
      });
    }

    const toWrite: string[] = [];
    const claimsToWrite: string[] = [];
    let unrankable = 0;
    for (const p of pending) {
      const owner = heldBy.get(p.claim);
      if (owner != null && owner !== p.name) {
        unrankable++;
        continue;
      }
      known.set(p.name, p.index);
      toWrite.push(p.name, String(p.index));
      claimsToWrite.push(p.claim, p.name);
    }
    if (unrankable > 0) {
      this.logger.error(
        `[occurrence] counter restarted for scan=${scanId} scanner=${scannerName}: ` +
          `${unrankable}/${pending.length} entries would have reused an index this scan ` +
          `already handed out (the occurrence hash was lost — eviction or flush). They are ` +
          `UNRANKABLE and their detections are written with a NULL fingerprint; the next ` +
          `healthy scan backfills them.`,
      );
    }

    for (let i = 0; i < toWrite.length; i += ScanQueueService.REDIS_ARG_CHUNK) {
      await redis.hset(
        key,
        ...toWrite.slice(i, i + ScanQueueService.REDIS_ARG_CHUNK),
      );
    }
    for (
      let i = 0;
      i < claimsToWrite.length;
      i += ScanQueueService.REDIS_ARG_CHUNK
    ) {
      await redis.hset(
        claimKey,
        ...claimsToWrite.slice(i, i + ScanQueueService.REDIS_ARG_CHUNK),
      );
    }
    await redis.expire(key, ScanQueueService.TRACKING_TTL_SECONDS);
    await redis.expire(claimKey, ScanQueueService.TRACKING_TTL_SECONDS);

    // `?? null`, never `?? 0`: an entry with no answer is unrankable, and a
    // corrupted stored value reads back as NaN, which is not an index either.
    return fields.map((f) => {
      const index = known.get(nameOf(f));
      return Number.isFinite(index) ? (index as number) : null;
    });
  }

  /**
   * Generate the key holding the SET of completed batch indices for a
   * scan+scanner combination. SADD semantics make completion counting
   * idempotent across BullMQ retries.
   */
  private getCompletedSetKey(
    queueType: 'sca' | 'sast-iac' | 'container' | 'aibom',
    scanId: string,
    scannerName: string,
  ): string {
    const normalizedScanner = this.normalizeScanner(scannerName);
    return `scan-queue:${queueType}:${scanId}:${normalizedScanner}:completedset`;
  }

  /**
   * Generate the key used as the single-winner finalize lock for a
   * scan+scanner combination. SET NX guarantees finalization runs exactly
   * once regardless of how many consumers reach the gate.
   */
  private getFinalizeLockKey(
    queueType: 'sca' | 'sast-iac' | 'container' | 'aibom',
    scanId: string,
    scannerName: string,
  ): string {
    const normalizedScanner = this.normalizeScanner(scannerName);
    return `scan-queue:${queueType}:${scanId}:${normalizedScanner}:finalized`;
  }

  /**
   * Generate the key holding the outcome of a SAST/IaC scanner's git history
   * pass, which its last batch carries and its finalization reads.
   */
  private getHistoryPassOutcomeKey(
    scanId: string,
    scannerName: string,
  ): string {
    const normalizedScanner = this.normalizeScanner(scannerName);
    return `scan-queue:sast-iac:${scanId}:${normalizedScanner}:history-outcome`;
  }

  /**
   * Keep the outcome of a scanner's git history pass until its finalization,
   * which runs from whichever consumer completes the scanner's last batch.
   * Same 24 h TTL as the expected-batch key.
   */
  async setHistoryPassOutcome(
    scanId: string,
    scannerName: string,
    outcome: HistoryPassOutcome,
  ): Promise<void> {
    const redis = await this.getRedisClient();
    await redis.set(
      this.getHistoryPassOutcomeKey(scanId, scannerName),
      outcome,
      'EX',
      ScanQueueService.TRACKING_TTL_SECONDS,
    );
  }

  /**
   * The outcome of a scanner's git history pass, or null when its last batch
   * sent none (an older scanner, no history pass in two-pass mode) or the
   * value is unknown. An `ok` outcome of a scanner whose results were not all
   * stored (`markHistoryIngestionLost`) reads as `failed`.
   */
  async getHistoryPassOutcome(
    scanId: string,
    scannerName: string,
  ): Promise<HistoryPassOutcome | null> {
    const redis = await this.getRedisClient();
    const outcome = parseHistoryPassOutcome(
      await redis.get(this.getHistoryPassOutcomeKey(scanId, scannerName)),
    );
    if (
      outcome === 'ok' &&
      (await redis.get(this.getHistoryLostKey(scanId, scannerName))) != null
    ) {
      return 'failed';
    }
    return outcome;
  }

  /**
   * Generate the key marking that a SAST/IaC scanner's results were not all
   * stored (a batch dropped after its retries, or the scanner given up).
   */
  private getHistoryLostKey(scanId: string, scannerName: string): string {
    const normalizedScanner = this.normalizeScanner(scannerName);
    return `scan-queue:sast-iac:${scanId}:${normalizedScanner}:history-lost`;
  }

  /**
   * Some results of a scanner were never stored: a batch dropped after its
   * retries, or the scanner given up. A history pass whose findings were lost
   * did not report every secret it read, so it must not count as `ok`: the
   * stored `ok` is downgraded to `failed`, and the mark makes an `ok` that
   * the last batch stores later read as `failed` too. `none` (no history
   * pass) is left alone. Same 24 h TTL as the scanner's tracking, cleared
   * with it.
   *
   * @returns the outcome stored before the mark, null when none was.
   */
  async markHistoryIngestionLost(
    scanId: string,
    scannerName: string,
  ): Promise<HistoryPassOutcome | null> {
    const redis = await this.getRedisClient();
    const before = parseHistoryPassOutcome(
      await redis.get(this.getHistoryPassOutcomeKey(scanId, scannerName)),
    );
    await redis.set(
      this.getHistoryLostKey(scanId, scannerName),
      '1',
      'EX',
      ScanQueueService.TRACKING_TTL_SECONDS,
    );
    if (before === 'ok') {
      await this.setHistoryPassOutcome(scanId, scannerName, 'failed');
    }
    return before;
  }

  /**
   * Generate the key holding the files a SAST/IaC scanner dropped because the
   * project's ignore file excludes them, which its last batch carries and its
   * finalization reads.
   */
  private getIgnoredPathsKey(scanId: string, scannerName: string): string {
    const normalizedScanner = this.normalizeScanner(scannerName);
    return `scan-queue:sast-iac:${scanId}:${normalizedScanner}:ignored-paths`;
  }

  /**
   * Keep a scanner's ignored paths (a Redis set) until its finalization, which
   * runs from whichever consumer completes the scanner's last batch. Same 24 h
   * TTL as the expected-batch key. The paths are stored exactly as sent.
   */
  async setIgnoredPaths(
    scanId: string,
    scannerName: string,
    paths: string[],
  ): Promise<void> {
    if (!paths.length) return;
    const redis = await this.getRedisClient();
    const key = this.getIgnoredPathsKey(scanId, scannerName);
    for (let i = 0; i < paths.length; i += 1000) {
      await redis.sadd(key, ...paths.slice(i, i + 1000));
    }
    await redis.expire(key, ScanQueueService.TRACKING_TTL_SECONDS);
  }

  /** The scanner's ignored paths; empty when its last batch sent none. */
  async getIgnoredPaths(
    scanId: string,
    scannerName: string,
  ): Promise<Set<string>> {
    const redis = await this.getRedisClient();
    return new Set(
      await redis.smembers(this.getIgnoredPathsKey(scanId, scannerName)),
    );
  }

  /**
   * Get the next batch index for a scan+scanner combination (used for unique job IDs).
   * Returns an auto-incrementing index starting from 0.
   * Each scanner within a scan gets its own sequence.
   */
  async getNextBatchIndex(
    queueType: 'sca' | 'sast-iac' | 'container' | 'aibom',
    scanId: string,
    scannerName: string,
  ): Promise<number> {
    const key = this.getBatchIndexKey(queueType, scanId, scannerName);
    const redis = await this.getRedisClient();
    // INCR returns 1 on first call, so we subtract 1 to get 0-based index
    const index = (await redis.incr(key)) - 1;
    // Set expiration of 24 hours to avoid memory leaks
    await redis.expire(key, ScanQueueService.TRACKING_TTL_SECONDS);
    return index;
  }

  /**
   * Increment the completed batch count for a scan+scanner combination.
   * Returns the new count. Each scanner tracks its own progress.
   */
  async incrementBatchProgress(
    queueType: 'sca' | 'sast-iac' | 'container' | 'aibom',
    scanId: string,
    scannerName: string,
  ): Promise<number> {
    const key = this.getBatchProgressKey(queueType, scanId, scannerName);
    const redis = await this.getRedisClient();
    const count = await redis.incr(key);
    // Set expiration of 24 hours to avoid memory leaks
    await redis.expire(key, ScanQueueService.TRACKING_TTL_SECONDS);
    return count;
  }

  /**
   * Get the current batch progress for a scan+scanner combination.
   */
  async getBatchProgress(
    queueType: 'sca' | 'sast-iac' | 'container' | 'aibom',
    scanId: string,
    scannerName: string,
  ): Promise<number> {
    const key = this.getBatchProgressKey(queueType, scanId, scannerName);
    const redis = await this.getRedisClient();
    const count = await redis.get(key);
    return count ? parseInt(count, 10) : 0;
  }

  /**
   * Record the EXPECTED total number of batches for a scan+scanner
   * combination. Called when the isLast job is enqueued (total =
   * batchIndex + 1). The finalize gate compares this against the number of
   * distinct completed batches to decide when finalization may run.
   */
  async setExpectedBatches(
    queueType: 'sca' | 'sast-iac' | 'container' | 'aibom',
    scanId: string,
    scannerName: string,
    total: number,
  ): Promise<void> {
    const key = this.getExpectedBatchesKey(queueType, scanId, scannerName);
    const redis = await this.getRedisClient();
    await redis.set(
      key,
      String(total),
      'EX',
      ScanQueueService.TRACKING_TTL_SECONDS,
    );
    const receivedKey = this.getLastBatchReceivedKey(queueType, scanId);
    await redis.sadd(receivedKey, scannerName);
    await redis.expire(receivedKey, ScanQueueService.TRACKING_TTL_SECONDS);
  }

  /**
   * The scanners of a scan, for one queue type, whose isLast job was
   * enqueued and whose finalization is still to come: their EXPECTED count
   * is still there (`clearBatchTracking` removes it once the scanner is
   * finalized). The end of a scan waits for them even when their container
   * was closed failed meanwhile: their results are in the
   * queue, and their finalization dispatches the end.
   *
   * @returns the scanner names as the jobs carry them (lower-cased).
   */
  async getScannersAwaitingFinalization(
    queueType: 'sca' | 'sast-iac' | 'container' | 'aibom',
    scanId: string,
  ): Promise<string[]> {
    const redis = await this.getRedisClient();
    const scanners = await redis.smembers(
      this.getLastBatchReceivedKey(queueType, scanId),
    );
    const awaiting: string[] = [];
    for (const scanner of scanners) {
      const expected = await redis.get(
        this.getExpectedBatchesKey(queueType, scanId, scanner),
      );
      if (expected != null) awaiting.push(scanner);
    }
    return awaiting;
  }

  /**
   * Read the EXPECTED total number of batches for a scan+scanner combination.
   * Returns null when the isLast job has not been enqueued yet (so the gate
   * must wait before finalizing).
   */
  async getExpectedBatches(
    queueType: 'sca' | 'sast-iac' | 'container' | 'aibom',
    scanId: string,
    scannerName: string,
  ): Promise<number | null> {
    const key = this.getExpectedBatchesKey(queueType, scanId, scannerName);
    const redis = await this.getRedisClient();
    const value = await redis.get(key);
    return value == null ? null : parseInt(value, 10);
  }

  /**
   * Mark a batch index as completed for a scan+scanner combination and return
   * the number of DISTINCT completed batches. Idempotent on retry: re-adding
   * the same batchIndex (SADD) does not inflate the count.
   */
  async markBatchCompleted(
    queueType: 'sca' | 'sast-iac' | 'container' | 'aibom',
    scanId: string,
    scannerName: string,
    batchIndex: number,
  ): Promise<number> {
    const key = this.getCompletedSetKey(queueType, scanId, scannerName);
    const redis = await this.getRedisClient();
    await redis.sadd(key, String(batchIndex));
    await redis.expire(key, ScanQueueService.TRACKING_TTL_SECONDS);
    return await redis.scard(key);
  }

  /**
   * Get the number of DISTINCT completed batches for a scan+scanner
   * combination.
   */
  async getCompletedCount(
    queueType: 'sca' | 'sast-iac' | 'container' | 'aibom',
    scanId: string,
    scannerName: string,
  ): Promise<number> {
    const key = this.getCompletedSetKey(queueType, scanId, scannerName);
    const redis = await this.getRedisClient();
    return redis.scard(key);
  }

  /**
   * Attempt to acquire the single-winner finalize lock for a scan+scanner
   * combination. Returns true exactly once (SET NX), so the caller that gets
   * true is the only one that runs finalization.
   */
  async tryAcquireFinalizeLock(
    queueType: 'sca' | 'sast-iac' | 'container' | 'aibom',
    scanId: string,
    scannerName: string,
  ): Promise<boolean> {
    const key = this.getFinalizeLockKey(queueType, scanId, scannerName);
    const redis = await this.getRedisClient();
    const result = await redis.set(
      key,
      '1',
      'EX',
      ScanQueueService.TRACKING_TTL_SECONDS,
      'NX',
    );
    return result === 'OK';
  }

  /**
   * Release the single-winner finalize lock for a scan+scanner combination.
   *
   * Used by the FAILURE path of the finalize gate: if finalization throws after
   * the lock was acquired, the lock must be dropped so the job's normal retry
   * can re-acquire it and actually finalize. (On the SUCCESS path the lock is
   * removed as part of clearBatchTracking, so this is not called there.)
   */
  async releaseFinalizeLock(
    queueType: 'sca' | 'sast-iac' | 'container' | 'aibom',
    scanId: string,
    scannerName: string,
  ): Promise<void> {
    const key = this.getFinalizeLockKey(queueType, scanId, scannerName);
    const redis = await this.getRedisClient();
    await redis.del(key);
  }

  /**
   * Lifetime of a detection creation lock. The section it guards is one
   * lookup plus a few inserts (row, history, snippet, data-flow items): tens of
   * milliseconds, seconds when the worker's DB pool is saturated. The TTL only
   * matters when a holder dies mid-section (pod killed): it bounds how long the
   * key outlives it. A section that overran it would merely lose the
   * serialization — the behaviour before the lock existed.
   */
  static readonly DETECTION_CREATION_LOCK_TTL_MS = 30_000;

  /**
   * How long a twin waits for the holder before proceeding WITHOUT the lock.
   * A waiter occupies one of its batch's worker slots, so the wait is bounded
   * well below the TTL: a dead holder delays its twin by at most this much.
   */
  static readonly DETECTION_CREATION_LOCK_MAX_WAIT_MS = 10_000;

  /**
   * Retry interval of a waiter: about one section, so a twin is admitted
   * right after its holder while a 10 s wait still costs at most 400 SETs —
   * and only twins ever wait.
   */
  static readonly DETECTION_CREATION_LOCK_POLL_MS = 25;

  /**
   * Deletes KEYS[1] only while it still holds ARGV[1], the token of the holder
   * releasing it: a holder whose TTL ran out never deletes the lock a twin has
   * taken since. A compare-and-delete of its own, so no other lock's release
   * can change it (The SCA AutoFix one moved to
   * ScaAutoFixQueueService).
   */
  static readonly DETECTION_CREATION_LOCK_RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

  /**
   * Take the detection creation lock `key`, waiting for its holder when there
   * is one (`SastIacUtilsService.createNewVulnerability`, which derives the key
   * from the finding's position).
   *
   * @returns the token to release it with, or `null` when the key was still
   *   held after DETECTION_CREATION_LOCK_MAX_WAIT_MS. A Redis error is thrown:
   *   what to do without the lock is the caller's decision.
   */
  async acquireDetectionCreationLock(key: string): Promise<string | null> {
    const redis = await this.getRedisClient();
    const token = randomUUID();
    const deadline =
      Date.now() + ScanQueueService.DETECTION_CREATION_LOCK_MAX_WAIT_MS;
    for (;;) {
      const taken = await redis.set(
        key,
        token,
        'PX',
        ScanQueueService.DETECTION_CREATION_LOCK_TTL_MS,
        'NX',
      );
      if (taken === 'OK') return token;
      const remaining = deadline - Date.now();
      if (remaining <= 0) return null;
      await new Promise((resolve) =>
        setTimeout(
          resolve,
          Math.min(ScanQueueService.DETECTION_CREATION_LOCK_POLL_MS, remaining),
        ),
      );
    }
  }

  /**
   * Release a detection creation lock taken with `token`.
   *
   * @returns false when the key no longer held that token: the TTL ran out
   *   during the section, and a twin may have run it concurrently.
   */
  async releaseDetectionCreationLock(
    key: string,
    token: string,
  ): Promise<boolean> {
    const redis = await this.getRedisClient();
    const deleted = await redis.eval(
      ScanQueueService.DETECTION_CREATION_LOCK_RELEASE_SCRIPT,
      1,
      key,
      token,
    );
    return Number(deleted) === 1;
  }

  /**
   * Clear the batch tracking for a scan+scanner combination (after the
   * scanner has been finalized). Removes the legacy progress/index keys, the
   * finalize-gate keys (expected, completed set, finalize lock) AND the
   * occurrence-index hash together with its claims key.
   *
   * The occurrence hash is by far the largest of them — roughly one field per
   * finding plus one counter per group, i.e. tens of thousands of fields and
   * several MB for a large scanner run — on the Redis instance shared with the
   * BullMQ queues, the cross-process caches and rate limiting. Leaving it to
   * its 24h TTL once the scanner has demonstrably finished, while deleting the
   * five keys that hold a handful of fields each, is exactly backwards. The
   * claims key is the same order of magnitude (one field per allocated index),
   * so it goes with it.
   */
  async clearBatchTracking(
    queueType: 'sca' | 'sast-iac' | 'container' | 'aibom',
    scanId: string,
    scannerName: string,
  ): Promise<void> {
    const progressKey = this.getBatchProgressKey(
      queueType,
      scanId,
      scannerName,
    );
    const indexKey = this.getBatchIndexKey(queueType, scanId, scannerName);
    const expectedKey = this.getExpectedBatchesKey(
      queueType,
      scanId,
      scannerName,
    );
    const completedSetKey = this.getCompletedSetKey(
      queueType,
      scanId,
      scannerName,
    );
    const finalizeLockKey = this.getFinalizeLockKey(
      queueType,
      scanId,
      scannerName,
    );
    const occurrenceKey = this.getOccurrenceIndexKey(
      queueType,
      scanId,
      scannerName,
    );
    const occurrenceClaimKey = this.getOccurrenceClaimKey(
      queueType,
      scanId,
      scannerName,
    );
    const keys = [
      progressKey,
      indexKey,
      expectedKey,
      completedSetKey,
      finalizeLockKey,
      occurrenceKey,
      occurrenceClaimKey,
    ];
    if (queueType === 'sast-iac') {
      keys.push(this.getHistoryPassOutcomeKey(scanId, scannerName));
      keys.push(this.getHistoryLostKey(scanId, scannerName));
      keys.push(this.getIgnoredPathsKey(scanId, scannerName));
    }
    const redis = await this.getRedisClient();
    await redis.del(...keys);
  }

  /**
   * Register that a scan has jobs of a given queue type (sca, sast-iac, container).
   * Used to determine when all scanner types have finalized for scan-complete notifications.
   */
  async registerScanQueueType(
    scanId: string,
    queueType: string,
  ): Promise<void> {
    const redis = await this.getRedisClient();
    const key = `scan-registered-types:${scanId}`;
    await redis.sadd(key, queueType);
    await redis.expire(key, 86400); // 24h TTL
  }

  /**
   * Get all queue types that have been registered for a scan.
   */
  async getRegisteredScanQueueTypes(scanId: string): Promise<string[]> {
    const redis = await this.getRedisClient();
    const key = `scan-registered-types:${scanId}`;
    return redis.smembers(key);
  }

  /**
   * Add a SCA scan result job to the queue.
   * Automatically assigns a unique batch index for each request.
   * Jobs are tracked per scanId + scannerName combination.
   *
   * @param request - The SCA scan result request
   * @returns Job ID for tracking
   */
  async addScaJob(request: ScanAddScaResultRequest): Promise<string> {
    const isLast = request.isLastRequest;
    const { scanId, projectId, scannerName } = request;
    const normalizedScanner = (scannerName || 'unknown').toLowerCase();

    // Get a unique batch index for this scanner within this scan
    const batchIndex = await this.getNextBatchIndex(
      'sca',
      scanId,
      normalizedScanner,
    );

    // The isLast job is enqueued last, so its batchIndex + 1 is the total
    // number of batches for this scanner. Publish it so the finalize gate in
    // the processor knows how many distinct batches must complete before
    // finalization can run (independent of completion order or consumer count).
    if (isLast) {
      await this.setExpectedBatches(
        'sca',
        scanId,
        normalizedScanner,
        batchIndex + 1,
      );
    }

    const jobData: ScaJobData = {
      request,
      isLast,
      batchIndex,
      scanId,
      projectId,
      scannerName: normalizedScanner,
    };

    const jobOptions: JobsOptions = {
      // Use scanId + scannerName + batchIndex as job ID for idempotency
      jobId: `sca-${scanId}-${normalizedScanner}-${batchIndex}`,
      // isLast jobs have lower priority (processed last within their scanner group)
      // Priority 1 = normal batches, Priority 10 = isLast batch
      priority: isLast ? 10 : 1,
      // Retry configuration
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
      // Remove completed jobs after 1 hour
      removeOnComplete: { age: 3600 },
      // Keep failed jobs for 24 hours for debugging
      removeOnFail: { age: 86400 },
    };

    const job = await this.scaQueue.add('process-sca', jobData, jobOptions);

    // Register that this scan has SCA jobs
    await this.registerScanQueueType(scanId, 'sca');

    this.logger.log(
      `[SCA Queue] Added job ${job.id} for scan=${scanId}, scanner=${normalizedScanner}, batch=${batchIndex}, isLast=${isLast}`,
    );

    return job.id!;
  }

  /**
   * Store the history pass outcome a last batch carries. Nothing is stored
   * for an absent or unknown value. A Redis error is logged, not thrown: the
   * batch is still enqueued, and a missing outcome closes nothing (only an
   * `ok` outcome lets the branch's first full pass resolve what it did not
   * report).
   */
  private async keepHistoryPassOutcome(
    scanId: string,
    scannerName: string,
    value: string | undefined,
  ): Promise<void> {
    const outcome = parseHistoryPassOutcome(value);
    if (!outcome) {
      if (value) {
        this.logger.warn(
          `HISTORY_OUTCOME_UNKNOWN scan=${scanId} scanner=${scannerName} — ignored`,
        );
      }
      return;
    }
    try {
      await this.setHistoryPassOutcome(scanId, scannerName, outcome);
    } catch (error) {
      this.logger.warn(
        `HISTORY_OUTCOME_NOT_STORED scan=${scanId} scanner=${scannerName} outcome=${outcome}: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Store the ignored paths a last batch carries. A Redis error is logged, not
   * thrown: the batch is still enqueued, and missing paths close nothing. Only
   * the count is logged, never a path.
   */
  private async keepIgnoredPaths(
    scanId: string,
    scannerName: string,
    paths: string[] | undefined,
  ): Promise<void> {
    if (!paths?.length) return;
    try {
      await this.setIgnoredPaths(scanId, scannerName, paths);
    } catch (error) {
      this.logger.warn(
        `IGNORED_PATHS_NOT_STORED scan=${scanId} scanner=${scannerName} count=${paths.length}: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Add a SAST/IAC scan result job to the queue.
   * Automatically assigns a unique batch index for each request.
   * Jobs are tracked per scanId + scannerName combination.
   *
   * @param request - The SAST/IAC scan result request
   * @returns Job ID for tracking
   */
  async addSastIacJob(request: ScanAddResultRequest): Promise<string> {
    const isLast = request.isLastRequest;
    const { scanId, projectId, scannerName } = request;
    const normalizedScanner = (scannerName || 'unknown').toLowerCase();

    // Get a unique batch index for this scanner within this scan
    const batchIndex = await this.getNextBatchIndex(
      'sast-iac',
      scanId,
      normalizedScanner,
    );

    // The isLast job is enqueued last, so its batchIndex + 1 is the total
    // number of batches for this scanner. Publish it so the finalize gate in
    // the processor knows how many distinct batches must complete before
    // finalization can run (independent of completion order or consumer count).
    if (isLast) {
      // The secret scanner's history pass reports its outcome on its last
      // batch only; the finalization reads it. Stored before the expected
      // count, so no finalization can run without it.
      await this.keepHistoryPassOutcome(
        scanId,
        normalizedScanner,
        request.historyPassOutcome,
      );
      // The files the scanner dropped for the ignore file travel the same way.
      await this.keepIgnoredPaths(
        scanId,
        normalizedScanner,
        request.ignoredPaths,
      );
      await this.setExpectedBatches(
        'sast-iac',
        scanId,
        normalizedScanner,
        batchIndex + 1,
      );
    }

    const jobData: SastIacJobData = {
      request,
      isLast,
      batchIndex,
      scanId,
      projectId,
      scannerName: normalizedScanner,
    };

    const jobOptions: JobsOptions = {
      // Use scanId + scannerName + batchIndex as job ID for idempotency
      jobId: `sast-iac-${scanId}-${normalizedScanner}-${batchIndex}`,
      priority: isLast ? 10 : 1,
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
      removeOnComplete: { age: 3600 },
      removeOnFail: { age: 86400 },
    };

    const job = await this.sastIacQueue.add(
      'process-sast-iac',
      jobData,
      jobOptions,
    );

    // Register that this scan has SAST/IAC jobs
    await this.registerScanQueueType(scanId, 'sast-iac');

    this.logger.log(
      `[SAST/IAC Queue] Added job ${job.id} for scan=${scanId}, scanner=${normalizedScanner}, batch=${batchIndex}, isLast=${isLast}`,
    );

    return job.id!;
  }

  /**
   * Add a Container scan result job to the queue.
   * Automatically assigns a unique batch index for each request.
   *
   * @param request - The Container scan result request
   * @returns Job ID for tracking
   */
  async addContainerJob(
    request: ScanAddContainerResultRequest,
  ): Promise<string> {
    const isLast = request.chunk?.isLast ?? false;
    const { scanId, projectId, scannerName } = request;
    const normalizedScanner = (scannerName || 'unknown').toLowerCase();

    // Get a unique batch index for this request (per scanner)
    const batchIndex = await this.getNextBatchIndex(
      'container',
      scanId,
      normalizedScanner,
    );

    // The isLast job is enqueued last, so its batchIndex + 1 is the total
    // number of batches for this scanner. Publish it so the finalize gate in
    // the processor knows how many distinct batches must complete before
    // finalization can run (independent of completion order or consumer count).
    if (isLast) {
      await this.setExpectedBatches(
        'container',
        scanId,
        normalizedScanner,
        batchIndex + 1,
      );
    }

    const jobData: ContainerJobData = {
      request,
      isLast,
      batchIndex,
      scanId,
      projectId,
      scannerName: normalizedScanner,
    };

    const jobOptions: JobsOptions = {
      jobId: `container-${scanId}-${normalizedScanner}-${batchIndex}`,
      priority: isLast ? 10 : 1,
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
      removeOnComplete: { age: 3600 },
      removeOnFail: { age: 86400 },
    };

    const job = await this.containerQueue.add(
      'process-container',
      jobData,
      jobOptions,
    );

    // Register that this scan has Container jobs
    await this.registerScanQueueType(scanId, 'container');

    this.logger.log(
      `[Container Queue] Added job ${job.id} for scan=${scanId}, scanner=${normalizedScanner}, batch=${batchIndex}, isLast=${isLast}`,
    );

    return job.id!;
  }

  /**
   * Enqueue an async premium-report generation job.
   *
   * The jobId is derived from the reportId so BullMQ collapses an accidental
   * double-enqueue of the same report into a single job. No automatic retry:
   * a generation failure is terminal and surfaced to the user via a
   * REPORT_READY(status=failed) realtime event, so re-running it would only
   * publish a duplicate failure.
   */
  async addReportJob(data: ReportJobData): Promise<string> {
    const jobOptions: JobsOptions = {
      jobId: `report-${data.reportId}`,
      attempts: 1,
      removeOnComplete: { age: 3600 },
      removeOnFail: { age: 86400 },
    };

    const job = await this.reportsQueue.add(
      'generate-report',
      data,
      jobOptions,
    );

    this.logger.log(
      `[Reports Queue] Added job ${job.id} reportId=${data.reportId} kind=${data.kind} project=${data.projectId} format=${data.format}`,
    );

    return job.id!;
  }

  /**
   * Remove the job of a deleted project report, so it neither renders nor
   * holds the shared worker. A job already rendering is locked and cannot be
   * removed: the worker then stops at its next re-read of the report. Throws
   * what BullMQ throws; callers treat it as best effort.
   */
  async removeReportJob(reportId: string): Promise<void> {
    await this.reportsQueue.remove(`report-${reportId}`);
  }

  /** The same for an aggregated (org / team / batch) report. */
  async removeAggregatedReportJob(reportId: string): Promise<void> {
    await this.aggregatedReportsQueue.remove(`aggregated-report-${reportId}`);
  }

  /**
   * Enqueue an async AGGREGATED-report generation job (org / team / batch).
   *
   * Mirrors addReportJob: the jobId is derived from the reportId so BullMQ
   * collapses an accidental double-enqueue into a single job, and there is no
   * automatic retry (attempts=1) — a generation failure is terminal and
   * surfaced to the user via an AGGREGATED_REPORT_READY(status=failed) event.
   */
  async addAggregatedReportJob(data: AggregatedReportJobData): Promise<void> {
    await this.aggregatedReportsQueue.add('aggregated-report', data, {
      jobId: `aggregated-report-${data.reportId}`,
      attempts: 1,
      removeOnComplete: { age: 3600 },
      removeOnFail: { age: 86400 },
    });
  }

  /**
   * Enqueue the SARIF import of one scan.
   *
   * The jobId is derived from the scanId, so a repeated ImportResults call
   * collapses into the job already queued (BullMQ answers the existing job).
   * No automatic retry: the processor ends the scan itself, completed or
   * failed, through CompleteImportScan.
   *
   * The queue is shared by every organization of the instance and BullMQ
   * serves the lowest priority number first. Each job gets a turn
   * (RESERVE_RESULTS_IMPORT_TURN, one atomic step with the cap below):
   * max(the turn being served, the organization's next turn) + 1. An
   * organization with a backlog therefore gets one file in every round,
   * whatever the other organizations keep sending, and its own files keep
   * the order in which they were sent.
   *
   * A file a user sent (no `containerId`) is refused with RESOURCE_EXHAUSTED
   * when its organization already has maxWaitingImportsPerOrg() of them
   * waiting; the files of the instance's own scans are only ordered, never
   * refused.
   */
  async addResultsImportJob(data: ResultsImportJobData): Promise<string> {
    // One job per scan, or per scanner container of a Community cluster scan.
    const jobId =
      data.containerId !== undefined
        ? `results-import-${data.scanId}-${data.containerId}`
        : `results-import-${data.scanId}`;
    // A repeated call answers the job already there, untouched.
    const existing = await this.resultsImportQueue.getJob(jobId);
    if (existing) return existing.id!;

    const userImport = data.containerId === undefined;
    const turn = await this.reserveResultsImportTurn(
      data.organizationId,
      jobId,
      userImport,
    );
    if (turn === null) {
      throw new RpcException({
        code: status.RESOURCE_EXHAUSTED,
        message:
          'IMPORT_QUEUE_FULL: too many imports are waiting for this organization. Try again once some of them are processed.',
      });
    }
    let addedId: string;
    try {
      const job = await this.resultsImportQueue.add('import-results', data, {
        jobId,
        attempts: 1,
        priority: Math.min(turn, BULLMQ_MAX_PRIORITY),
        removeOnComplete: { age: 3600 },
        removeOnFail: { age: 86400 },
      });
      addedId = job.id!;
      if (userImport) {
        await this.markResultsImportPlaceQueued(data.organizationId, jobId);
      }
    } catch (err) {
      if (userImport) {
        await this.releaseResultsImportPlace(data.organizationId, jobId);
      }
      throw err;
    }

    this.logger.log(
      `[Results Import Queue] Added job ${addedId} scan=${data.scanId} project=${data.projectId} type=${data.category} turn=${turn}`,
    );

    return addedId;
  }

  private resultsImportFairKey(part: string): string {
    return this.resultsImportQueue.toKey(`fair:${part}`);
  }

  /**
   * Run RESERVE_RESULTS_IMPORT_TURN: the job's turn, or null when a user
   * import is refused because its organization is at the cap.
   */
  private async reserveResultsImportTurn(
    organizationId: string,
    jobId: string,
    userImport: boolean,
  ): Promise<number | null> {
    // BullMQ's connection is an ioredis client.
    const client = (await this.resultsImportQueue.client) as unknown as Redis;
    const keys = this.resultsImportQueue.keys;
    const result = await client.eval(
      RESERVE_RESULTS_IMPORT_TURN,
      8,
      keys.prioritized,
      keys.wait,
      keys.delayed,
      keys.paused,
      this.resultsImportFairKey('turn'),
      this.resultsImportFairKey('maxturn'),
      this.resultsImportFairKey('next'),
      this.resultsImportFairKey(`waiting:${organizationId}`),
      organizationId,
      jobId,
      userImport ? '1' : '0',
      String(maxWaitingImportsPerOrg()),
      String(Date.now()),
      String(RESULTS_IMPORT_RESERVATION_GRACE_MS),
      String(this.resultsImportTurnRebaseAt ?? RESULTS_IMPORT_TURN_REBASE_AT),
      this.resultsImportQueue.toKey(''),
    );
    const turn = Number(result);
    return turn < 0 ? null : turn;
  }

  /**
   * The job is in the queue now: its place counts while it waits there and
   * no longer by its grace period (score 0), so it is freed as soon as the
   * worker takes it.
   */
  private async markResultsImportPlaceQueued(
    organizationId: string,
    jobId: string,
  ): Promise<void> {
    try {
      // BullMQ's connection is an ioredis client.
      const client = (await this.resultsImportQueue.client) as unknown as Redis;
      await client.zadd(
        this.resultsImportFairKey(`waiting:${organizationId}`),
        'XX',
        0,
        jobId,
      );
    } catch {
      // The place is freed anyway once its grace period is over.
    }
  }

  private async releaseResultsImportPlace(
    organizationId: string,
    jobId: string,
  ): Promise<void> {
    try {
      // BullMQ's connection is an ioredis client.
      const client = (await this.resultsImportQueue.client) as unknown as Redis;
      await client.zrem(
        this.resultsImportFairKey(`waiting:${organizationId}`),
        jobId,
      );
    } catch {
      // The place is freed anyway once its grace period is over.
    }
  }

  /**
   * Enqueue an async vulnerability batch-update job.
   *
   * The jobId is derived from the taskId so BullMQ collapses an accidental
   * double-enqueue of the same task into a single job. No automatic retry:
   * a processing failure is terminal and surfaced to the user via a
   * BATCH_UPDATE_COMPLETE(status=failed) realtime event, so re-running it
   * would only publish a duplicate failure.
   */
  async addVulnBatchUpdateJob(data: VulnBatchUpdateJobData): Promise<string> {
    const jobOptions: JobsOptions = {
      jobId: `vuln-batch-update-${data.taskId}`,
      attempts: 1,
      removeOnComplete: { age: 3600 },
      removeOnFail: { age: 86400 },
    };

    const job = await this.vulnBatchUpdateQueue.add(
      'process-vuln-batch-update',
      data,
      jobOptions,
    );

    this.logger.log(
      `[Vuln Batch Update Queue] Added job ${job.id} taskId=${data.taskId} project=${data.projectId} items=${data.items.length}`,
    );

    return job.id!;
  }

  // addScaAutoFixJob, its admission, the KEDA backlog
  // list and the stale-job eviction moved to the closed SCA autofix module.

  // enqueueAgentReanalysis moved to the closed agent re-analysis module.

  /**
   * Get the status of all queues.
   */
  async getQueueStats(): Promise<{
    sca: { waiting: number; active: number; completed: number; failed: number };
    sastIac: {
      waiting: number;
      active: number;
      completed: number;
      failed: number;
    };
    container: {
      waiting: number;
      active: number;
      completed: number;
      failed: number;
    };
  }> {
    // The scaAutoFix entry left with the SCA_AUTOFIX queue.
    const [scaCounts, sastIacCounts, containerCounts] = await Promise.all([
      this.scaQueue.getJobCounts(),
      this.sastIacQueue.getJobCounts(),
      this.containerQueue.getJobCounts(),
    ]);

    return {
      sca: {
        waiting: scaCounts.waiting,
        active: scaCounts.active,
        completed: scaCounts.completed,
        failed: scaCounts.failed,
      },
      sastIac: {
        waiting: sastIacCounts.waiting,
        active: sastIacCounts.active,
        completed: sastIacCounts.completed,
        failed: sastIacCounts.failed,
      },
      container: {
        waiting: containerCounts.waiting,
        active: containerCounts.active,
        completed: containerCounts.completed,
        failed: containerCounts.failed,
      },
    };
  }

  /**
   * Get backlog depth for the core queues plus the extension queues.
   *
   * Uses BullMQ getJobCounts('wait','prioritized','delayed','active') on each queue.
   * The `wait` key (BullMQ internal name for the FIFO list) is mapped to `waiting`
   * in the output so callers never need to know about BullMQ internals.
   *
   * Intended to be scraped by the KEDA metrics-api scaler for autoscaling decisions.
   * The payload contains integers only — no tenant/scan IDs.
   */
  async getQueueBacklog(): Promise<QueueBacklogResponse> {
    const STATES = ['wait', 'prioritized', 'delayed', 'active'] as const;

    // [key, queue, aggregate]: the core queues in the response's
    // historical key order, followed by the injected extensions, so a closed
    // queue keeps its KEDA key once it moves out of this service.
    const entries: [
      string,
      Pick<Queue, 'getJobCounts'>,
      'workerPending' | 'autofixPending',
    ][] = [
      ['sca', this.scaQueue, 'workerPending'],
      ['sastIac', this.sastIacQueue, 'workerPending'],
      ['container', this.containerQueue, 'workerPending'],
      // 'scaAutofix' (autofixPending) left this core list; the cloud
      // reports it through a QUEUE_BACKLOG_EXTENSIONS entry (EeQueuesModule).
      ['cvss', this.cvssRecalculationQueue, 'workerPending'],
      // 'agentReanalysis' left this core list; the cloud reports it
      // through a QUEUE_BACKLOG_EXTENSIONS entry (EeQueuesModule).
      ['cyberisk', this.cyberiskRecomputeQueue, 'workerPending'],
      ['reports', this.reportsQueue, 'workerPending'],
      ['aggregatedReports', this.aggregatedReportsQueue, 'workerPending'],
      // The SARIF imports, consumed by the main worker.
      ['resultsImport', this.resultsImportQueue, 'workerPending'],
      ...(this.backlogExtensions ?? []).map(
        (
          e,
        ): [
          string,
          Pick<Queue, 'getJobCounts'>,
          'workerPending' | 'autofixPending',
        ] => [e.key, e.queue, e.aggregate],
      ),
    ];

    const countsList = await Promise.all(
      entries.map(([, queue]) => queue.getJobCounts(...STATES)),
    );

    const toStats = (counts: Record<string, number>): QueueDepthStats => {
      const waiting = counts['wait'] ?? 0;
      const prioritized = counts['prioritized'] ?? 0;
      const delayed = counts['delayed'] ?? 0;
      const active = counts['active'] ?? 0;
      const pending = waiting + prioritized + delayed;
      return {
        waiting,
        prioritized,
        delayed,
        active,
        pending,
        backlog: pending + active,
      };
    };

    const queues: Record<string, QueueDepthStats> = {};
    let workerPending = 0;
    let autofixPending = 0;
    entries.forEach(([key, , aggregate], i) => {
      const stats = toStats(countsList[i]);
      queues[key] = stats;
      if (aggregate === 'autofixPending') autofixPending += stats.pending;
      else workerPending += stats.pending;
    });

    return {
      queues,
      aggregates: {
        workerPending,
        autofixPending,
      },
    };
  }

  /**
   * Get queue status for a specific scan ID.
   * Checks all queues (SCA, SAST/IAC, Container) for jobs matching the scan ID.
   *
   * @param scanId - The scan ID to check
   * @returns Queue status including pending, active, completed, and failed job counts
   */
  async getScanQueueStatus(scanId: string): Promise<{
    scanId: string;
    isProcessingComplete: boolean;
    pendingJobs: number;
    activeJobs: number;
    completedJobs: number;
    failedJobs: number;
    scaPending: number;
    sastIacPending: number;
    containerPending: number;
  }> {
    // Get all jobs from each queue that match the scanId pattern
    // Job IDs follow pattern: {queueType}-{scanId}-{scanner}-{batchIndex}
    const scanIdPattern = `-${scanId}-`;

    const [scaJobs, sastIacJobs, containerJobs] = await Promise.all([
      this.getJobsForScan(this.scaQueue, scanIdPattern),
      this.getJobsForScan(this.sastIacQueue, scanIdPattern),
      this.getJobsForScan(this.containerQueue, scanIdPattern),
    ]);

    const scaPending = scaJobs.waiting + scaJobs.active;
    const sastIacPending = sastIacJobs.waiting + sastIacJobs.active;
    const containerPending = containerJobs.waiting + containerJobs.active;

    const pendingJobs = scaPending + sastIacPending + containerPending;
    const activeJobs =
      scaJobs.active + sastIacJobs.active + containerJobs.active;
    const completedJobs =
      scaJobs.completed + sastIacJobs.completed + containerJobs.completed;
    const failedJobs =
      scaJobs.failed + sastIacJobs.failed + containerJobs.failed;

    // Processing is complete when there are no waiting or active jobs
    const isProcessingComplete = pendingJobs === 0;

    return {
      scanId,
      isProcessingComplete,
      pendingJobs,
      activeJobs,
      completedJobs,
      failedJobs,
      scaPending,
      sastIacPending,
      containerPending,
    };
  }

  /**
   * Get job counts for a specific scan from a queue.
   * Filters jobs by scan ID pattern in job ID.
   */
  private async getJobsForScan(
    queue: Queue,
    scanIdPattern: string,
  ): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
  }> {
    try {
      // Get jobs from different states
      const [waitingJobs, activeJobs, completedJobs, failedJobs] =
        await Promise.all([
          queue.getJobs(['waiting', 'delayed', 'prioritized'], 0, 1000),
          queue.getJobs(['active'], 0, 1000),
          queue.getJobs(['completed'], 0, 1000),
          queue.getJobs(['failed'], 0, 1000),
        ]);

      // Filter by scanId pattern in job ID
      const filterByScanId = (jobs: any[]) =>
        jobs.filter((job) => job?.id?.includes(scanIdPattern)).length;

      return {
        waiting: filterByScanId(waitingJobs),
        active: filterByScanId(activeJobs),
        completed: filterByScanId(completedJobs),
        failed: filterByScanId(failedJobs),
      };
    } catch (error) {
      this.logger.warn(
        `Failed to get jobs for scan pattern ${scanIdPattern}: ${(error as Error).message}`,
      );
      return { waiting: 0, active: 0, completed: 0, failed: 0 };
    }
  }
}
