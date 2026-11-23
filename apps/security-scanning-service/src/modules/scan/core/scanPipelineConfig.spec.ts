import {
  readScanPipelineConfig,
  SCAN_PIPELINE_DEFAULTS,
} from './scanPipelineConfig';

const from = (env: Record<string, string>) => (key: string) => env[key];

describe('readScanPipelineConfig', () => {
  it('uses the defaults', () =>
    expect(readScanPipelineConfig(from({}))).toEqual(SCAN_PIPELINE_DEFAULTS));

  it('has the documented defaults', () =>
    expect(SCAN_PIPELINE_DEFAULTS).toEqual({
      slotReleaseEnabled: true,
      aiMaxConcurrentAnalyses: 4,
      aiQueueMaxWaitMs: 7_200_000,
      aiAnalysisMaxMs: 7_200_000,
      agentIngestionMaxMs: 3_600_000,
      scannerPhaseMaxMs: 7_200_000,
      scanMaxTotalMs: 28_800_000,
    }));

  it('reads every override', () => {
    const c = readScanPipelineConfig(
      from({
        SCAN_SLOT_RELEASE_ENABLED: 'false',
        AI_MAX_CONCURRENT_ANALYSES: '2',
        AI_QUEUE_MAX_WAIT_MS: '1000',
        AI_ANALYSIS_MAX_MS: '2000',
        AGENT_INGESTION_MAX_MS: '3000',
        SCAN_SCANNER_PHASE_MAX_MS: '4000',
        SCAN_MAX_TOTAL_MS: '5000',
      }),
    );
    expect(c).toEqual({
      slotReleaseEnabled: false,
      aiMaxConcurrentAnalyses: 2,
      aiQueueMaxWaitMs: 1000,
      aiAnalysisMaxMs: 2000,
      agentIngestionMaxMs: 3000,
      scannerPhaseMaxMs: 4000,
      scanMaxTotalMs: 5000,
    });
  });

  it('accepts 0 as "no AI cap"', () =>
    expect(
      readScanPipelineConfig(from({ AI_MAX_CONCURRENT_ANALYSES: '0' }))
        .aiMaxConcurrentAnalyses,
    ).toBe(0));

  it('falls back on garbage and on non-positive budgets', () => {
    const c = readScanPipelineConfig(
      from({
        AI_QUEUE_MAX_WAIT_MS: 'abc',
        AI_ANALYSIS_MAX_MS: '-5',
        SCAN_SLOT_RELEASE_ENABLED: 'FALSE',
      }),
    );
    expect(c.aiQueueMaxWaitMs).toBe(7_200_000);
    expect(c.aiAnalysisMaxMs).toBe(7_200_000);
    expect(c.slotReleaseEnabled).toBe(false);
  });

  it('keeps the slot release on for anything but "false"', () => {
    expect(
      readScanPipelineConfig(from({ SCAN_SLOT_RELEASE_ENABLED: 'true' }))
        .slotReleaseEnabled,
    ).toBe(true);
    expect(
      readScanPipelineConfig(from({ SCAN_SLOT_RELEASE_ENABLED: ' ' }))
        .slotReleaseEnabled,
    ).toBe(true);
  });

  it('falls back when the AI cap is not a number', () =>
    expect(
      readScanPipelineConfig(from({ AI_MAX_CONCURRENT_ANALYSES: 'many' }))
        .aiMaxConcurrentAnalyses,
    ).toBe(4));
});
