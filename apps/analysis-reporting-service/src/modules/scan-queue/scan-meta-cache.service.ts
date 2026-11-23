import { Injectable, Logger } from '@nestjs/common';
import { Span } from 'nestjs-otel';
import { ScanResponse } from '@grpc/security-scanning/scan';
import { ScanQueueService } from './scan-queue.service';

/**
 * The fields of a scan record the ingestion reads, all fixed before the
 * scanners start: the branch is set at the latest by StartScan, before the
 * pods that send the results exist, and the others at creation.
 *
 * Deliberately NOT here: `containers` (the scanner pods and their state),
 * `state`, `progress`, `step`, the dates, the error fields — they change
 * while the scan runs, and a cached copy would be wrong.
 */
export interface ScanRecordMeta {
  /** '' when the scan has no branch. */
  branch: string;
  isDiffScan: boolean;
  /** '' when absent. */
  scanType: string;
  /** '' when absent. */
  initializerUserId: string;
  /** '' when absent. */
  codingAgent: string;
  /**
   * Mode of the git history pass recorded on the scan (`full`, `partial`,
   * `incremental`, `incremental_with_gap`, `none`); null when none was
   * recorded (an upload, the history in the archive, an older platform).
   * Recorded before the scanners start, so as fixed as the branch.
   */
  historyMode: string | null;
  /** Whether that pass was the branch's first one; false without a pass. */
  historyFirstPass: boolean;
}

/**
 * What the SCA worker reads of the project for a scan, from
 * one lean ProjectService/Get. Unlike the scan record, these are project
 * settings a person can change while the scan runs: the copy is the one the
 * first batch read, and a change applies from the next scan, the same for
 * every batch of this one.
 */
export interface ScaProjectContext {
  /** The project's canonical branch scope, never empty. */
  scoringBranches: string[];
  reachabilityPriorityEnabled: boolean;
  reachabilityStatusEnabled: boolean;
  /** What closing the issues of resolved findings reads. */
  issueSettings: {
    projectId: string;
    organizationId: string;
    githubIssueEnabled: boolean;
    gitlabIssueEnabled: boolean;
    issueCreationMode: string;
    issueCreationBranches: string[];
  };
}

/**
 * What a scan's ingestion reads once and keeps for the scan, one Redis key
 * per section. A new section is a new member here and a guard in
 * SECTION_GUARDS; `getOrLoad` serves it as is.
 */
export interface ScanMetaSections {
  /** The scan record (GetScan), see ScanRecordMeta. */
  scan: ScanRecordMeta;
  /** The SCA worker's project context, see ScaProjectContext. */
  scaProject: ScaProjectContext;
}

export type ScanMetaSection = keyof ScanMetaSections;

const isScanRecordMeta = (value: unknown): value is ScanRecordMeta => {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.branch === 'string' &&
    typeof v.isDiffScan === 'boolean' &&
    typeof v.scanType === 'string' &&
    typeof v.initializerUserId === 'string' &&
    typeof v.codingAgent === 'string' &&
    (v.historyMode === null || typeof v.historyMode === 'string') &&
    typeof v.historyFirstPass === 'boolean'
  );
};

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

const isScaProjectContext = (value: unknown): value is ScaProjectContext => {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  const issues = v.issueSettings as Record<string, unknown> | null;
  return (
    isStringArray(v.scoringBranches) &&
    v.scoringBranches.length > 0 &&
    typeof v.reachabilityPriorityEnabled === 'boolean' &&
    typeof v.reachabilityStatusEnabled === 'boolean' &&
    typeof issues === 'object' &&
    issues !== null &&
    typeof issues.projectId === 'string' &&
    typeof issues.organizationId === 'string' &&
    typeof issues.githubIssueEnabled === 'boolean' &&
    typeof issues.gitlabIssueEnabled === 'boolean' &&
    typeof issues.issueCreationMode === 'string' &&
    isStringArray(issues.issueCreationBranches)
  );
};

/** How a caller of `getOrLoad` narrows what the cache serves and keeps. */
export interface GetOrLoadOptions<T> {
  /**
   * Whether a cached value is this caller's; a refused one reads as a miss
   * (it is loaded again and overwritten). True when absent.
   */
  accept?: (cached: T) => boolean;
  /** Whether a loaded value may be cached; true when absent. */
  store?: (loaded: T) => boolean;
}

/**
 * What a cached section must look like to be served. Anything else (an
 * older layout, a truncated write) reads as a miss and is loaded again.
 */
const SECTION_GUARDS: {
  [S in ScanMetaSection]: (value: unknown) => value is ScanMetaSections[S];
} = {
  scan: isScanRecordMeta,
  scaProject: isScaProjectContext,
};

/** The fixed fields of a GetScan response; never its `containers`. */
export function scanRecordMetaOf(scan: ScanResponse): ScanRecordMeta {
  return {
    branch: scan.branch ?? '',
    isDiffScan: scan.isDiffScan === true,
    scanType: scan.scanType ?? '',
    initializerUserId: scan.initializerUserId ?? '',
    codingAgent: scan.codingAgent ?? '',
    historyMode: scan.historyPass?.mode || null,
    historyFirstPass: scan.historyPass?.firstPass === true,
  };
}

/**
 * A scan's metadata, read once per scan instead of once per
 * ingestion batch.
 *
 * Every SAST/IaC and SCA batch called GetScan for its branch and its diff
 * flag (about one GetScan per batch, and a scan has many batches). The first batch of a scan now reads it and stores the fixed
 * fields in Redis for 24 h (the batch-tracking keys' TTL); the others, and
 * the finalization, read Redis.
 *
 * A value is written only after a successful read: a failed or empty
 * GetScan leaves nothing behind, so the fail-safe (no scan record,
 * no ingestion) still fires on the next batch. Redis is best-effort: a Redis
 * error reads as a miss and the scan record is read as before.
 *
 * Reuses the BullMQ-backed ioredis client of ScanQueueService, as
 * OverviewCacheService does.
 */
@Injectable()
export class ScanMetaCache {
  /** 24 h, like the batch-tracking keys: longer than any scan's ingestion. */
  static readonly TTL_SECONDS = 86_400;

  private readonly logger = new Logger(ScanMetaCache.name);

  constructor(private readonly scanQueue: ScanQueueService) {}

  /**
   * v2: the scan section carries the history pass. A v1 entry, written
   * without it, would read as a scan without history; the new key makes
   * every v1 entry a miss.
   */
  static keyOf(scanId: string, section: ScanMetaSection): string {
    return `scan-meta:v2:${section}:${scanId}`;
  }

  /**
   * The cached section of a scan, or `load()`'s answer, cached when it is
   * not null. An error of `load` propagates and caches nothing.
   *
   * `options.accept` lets the caller refuse a cached value that is not its
   * own (the key is the scan id alone): it is overwritten by the reload, or
   * deleted when the reload may not be kept. `options.store` lets the caller
   * refuse to keep an answer it cannot tell from a degraded one: it is
   * returned, not cached, and the next call loads again.
   */
  @Span()
  async getOrLoad<S extends ScanMetaSection>(
    scanId: string,
    section: S,
    load: () => Promise<ScanMetaSections[S] | null>,
    options: GetOrLoadOptions<ScanMetaSections[S]> = {},
  ): Promise<ScanMetaSections[S] | null> {
    const key = ScanMetaCache.keyOf(scanId, section);
    const cached = await this.read(key, section);
    const refused = cached != null && !(options.accept?.(cached) ?? true);
    if (cached && !refused) {
      return cached;
    }
    const value = await load();
    if (value != null && (options.store?.(value) ?? true)) {
      await this.write(key, value);
    } else if (refused) {
      // Nothing replaces the refused value: it must not stay for the next
      // read either.
      await this.remove(key);
    }
    return value ?? null;
  }

  /**
   * The scan record's fixed fields: cached, or read with `fetchScan` (the
   * caller's GetScan). Null when GetScan answered nothing.
   */
  @Span()
  async getScan(
    scanId: string,
    fetchScan: () => Promise<ScanResponse | null | undefined>,
  ): Promise<ScanRecordMeta | null> {
    return this.getOrLoad(scanId, 'scan', async () => {
      const scan = await fetchScan();
      return scan ? scanRecordMetaOf(scan) : null;
    });
  }

  private async read<S extends ScanMetaSection>(
    key: string,
    section: S,
  ): Promise<ScanMetaSections[S] | null> {
    try {
      const redis = await this.scanQueue.getRedisClient();
      const raw = await redis.get(key);
      if (!raw) return null;
      const parsed: unknown = JSON.parse(raw);
      return SECTION_GUARDS[section](parsed)
        ? (parsed as ScanMetaSections[S])
        : null;
    } catch (err) {
      this.logger.warn(
        `scan-meta read ${section} failed, reading the source: ${(err as Error).message}`,
      );
      return null;
    }
  }

  private async remove(key: string): Promise<void> {
    try {
      const redis = await this.scanQueue.getRedisClient();
      await redis.del(key);
    } catch (err) {
      this.logger.warn(
        `scan-meta delete failed, the next read refuses the value again: ${(err as Error).message}`,
      );
    }
  }

  private async write(key: string, value: unknown): Promise<void> {
    try {
      const redis = await this.scanQueue.getRedisClient();
      await redis.set(
        key,
        JSON.stringify(value),
        'EX',
        ScanMetaCache.TTL_SECONDS,
      );
    } catch (err) {
      this.logger.warn(
        `scan-meta write failed, the next batch reads the source again: ${(err as Error).message}`,
      );
    }
  }
}

/**
 * A scan's fixed metadata through the cache when the runtime provides one
 * (the worker and the gRPC server do), straight from `fetchScan` otherwise
 * (unit-test modules). Null when the scan record could not be read; a
 * GetScan error propagates.
 */
export async function readScanRecordMeta(
  cache: ScanMetaCache | undefined,
  scanId: string,
  fetchScan: () => Promise<ScanResponse | null | undefined>,
): Promise<ScanRecordMeta | null> {
  if (cache) {
    return cache.getScan(scanId, fetchScan);
  }
  const scan = await fetchScan();
  return scan ? scanRecordMetaOf(scan) : null;
}
