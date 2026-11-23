/**
 * Settings of the scan pipeline (scan slot release and AI queue). Tuning
 * variables with a safe default in code, so they stay out of the Joi
 * validation schema, per the repository convention. Set them on both security-scanning Deployments (API
 * and cron) when both processes read them.
 */
export interface ScanPipelineConfig {
  /** `SCAN_SLOT_RELEASE_ENABLED`: false counts every running scan, as before. */
  slotReleaseEnabled: boolean;
  /** `AI_MAX_CONCURRENT_ANALYSES`: a value <= 0 removes the cap. */
  aiMaxConcurrentAnalyses: number;
  /** `AI_QUEUE_MAX_WAIT_MS`: queued for AI beyond this → ai_queue_timeout. */
  aiQueueMaxWaitMs: number;
  /** `AI_ANALYSIS_MAX_MS`: analysing beyond this → analysis_timeout. */
  aiAnalysisMaxMs: number;
  /** `AGENT_INGESTION_MAX_MS`: ingesting beyond this → ingestion_stalled. */
  agentIngestionMaxMs: number;
  /** `SCAN_SCANNER_PHASE_MAX_MS`: budget of the scanners, from startTime. */
  scannerPhaseMaxMs: number;
  /** `SCAN_MAX_TOTAL_MS`: last-resort cap on a running scan. */
  scanMaxTotalMs: number;
}

export const SCAN_PIPELINE_DEFAULTS: ScanPipelineConfig = {
  slotReleaseEnabled: true,
  aiMaxConcurrentAnalyses: 4,
  aiQueueMaxWaitMs: 7_200_000,
  aiAnalysisMaxMs: 7_200_000,
  agentIngestionMaxMs: 3_600_000,
  scannerPhaseMaxMs: 7_200_000,
  scanMaxTotalMs: 28_800_000,
};

/**
 * Reads the settings through `get` (a ConfigService or process.env lookup).
 * A malformed value, or a budget that is not strictly positive, falls back
 * to its default: a typo must never turn a budget off.
 */
export function readScanPipelineConfig(
  get: (key: string) => string | undefined,
): ScanPipelineConfig {
  const int = (key: string): number | null => {
    const raw = get(key)?.trim();
    if (!raw) return null;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
  };
  const budget = (key: string, fallback: number): number => {
    const n = int(key);
    return n !== null && n > 0 ? n : fallback;
  };
  const d = SCAN_PIPELINE_DEFAULTS;
  return {
    slotReleaseEnabled:
      (get('SCAN_SLOT_RELEASE_ENABLED') ?? 'true').trim().toLowerCase() !==
      'false',
    aiMaxConcurrentAnalyses:
      int('AI_MAX_CONCURRENT_ANALYSES') ?? d.aiMaxConcurrentAnalyses,
    aiQueueMaxWaitMs: budget('AI_QUEUE_MAX_WAIT_MS', d.aiQueueMaxWaitMs),
    aiAnalysisMaxMs: budget('AI_ANALYSIS_MAX_MS', d.aiAnalysisMaxMs),
    agentIngestionMaxMs: budget(
      'AGENT_INGESTION_MAX_MS',
      d.agentIngestionMaxMs,
    ),
    scannerPhaseMaxMs: budget('SCAN_SCANNER_PHASE_MAX_MS', d.scannerPhaseMaxMs),
    scanMaxTotalMs: budget('SCAN_MAX_TOTAL_MS', d.scanMaxTotalMs),
  };
}
