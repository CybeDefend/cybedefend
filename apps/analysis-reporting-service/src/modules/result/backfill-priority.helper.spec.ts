import {
  BackfillPriorityWeights,
  BackfillRow,
  computeBackfillPriority,
} from './backfill-priority.helper';

const DEFAULT_WEIGHTS: BackfillPriorityWeights = {
  w1: 0.35,
  w2: 0.25,
  w3: 0.25,
  w4: 0.15,
};

function makeRow(overrides: Partial<BackfillRow> = {}): BackfillRow {
  return {
    currentSeverity: 'MEDIUM',
    cvss4_base_score: null,
    cvss4_environmental_score: null,
    epss_score: null,
    epss_percentile: null,
    exploitability_score: null,
    reachability: null,
    ...overrides,
  };
}

describe('computeBackfillPriority', () => {
  it('uses epss_percentile (not epss_score) in the composite formula', () => {
    // epss_score is a raw probability (~0.01) — if the backfill wrongly uses
    // this value, the composite will be ~0.22 lower than it should be.
    // The runtime uses epss_percentile (the rank in [0,1]).
    const row = makeRow({
      cvss4_base_score: 0,
      currentSeverity: 'LOW',
      epss_score: 0.01,
      epss_percentile: 0.9,
      exploitability_score: 0,
    });
    const context = 0.5;
    // Expected composite if percentile is used:
    // 0.35*0 + 0.25*0.9 + 0.25*0 + 0.15*0.5 = 0 + 0.225 + 0 + 0.075 = 0.3
    const result = computeBackfillPriority(DEFAULT_WEIGHTS, row, context);
    expect(result.compositeScore).toBeCloseTo(0.3, 6);
    // Buggy output (using epss_score 0.01):
    //   0 + 0.25*0.01 + 0 + 0.075 = 0.0775 → very different from 0.3
    expect(result.compositeScore).not.toBeCloseTo(0.0775, 4);
  });

  it('renormalizes w1/w3/w4 when epss_percentile is null (matches runtime)', () => {
    // Mirrors PriorityCalculatorService behavior: when EPSS percentile is
    // absent, the three remaining weights must be renormalized by
    // (1 - W_EPSS) so they sum to 1.
    const row = makeRow({
      cvss4_base_score: 10, // cvssNorm = 1.0
      epss_percentile: null,
      exploitability_score: 1.0,
    });
    const context = 1.0;
    // Renormalized: composite = (0.35 + 0.25 + 0.15)/0.75 * 1 = 1.0
    const result = computeBackfillPriority(DEFAULT_WEIGHTS, row, context);
    expect(result.compositeScore).toBeCloseTo(1.0, 6);
  });

  it('preserves renormalized ratios when EPSS is null and inputs are mixed', () => {
    // cvssNorm=1, exploit=0, context=0.5 → composite must be
    //   (0.35/0.75)*1 + (0.25/0.75)*0 + (0.15/0.75)*0.5 ≈ 0.4667 + 0 + 0.1
    //   ≈ 0.5667
    const row = makeRow({
      cvss4_base_score: 10,
      epss_percentile: null,
      exploitability_score: 0,
    });
    const context = 0.5;
    const result = computeBackfillPriority(DEFAULT_WEIGHTS, row, context);
    expect(result.compositeScore).toBeCloseTo(0.5667, 3);
  });

  it('forces exploitability to 0 when reachability is "unused" (SCA)', () => {
    const used = computeBackfillPriority(
      DEFAULT_WEIGHTS,
      makeRow({
        cvss4_base_score: 7,
        epss_percentile: 0.5,
        exploitability_score: 0.8,
        reachability: 'used',
      }),
      0.5,
    );
    const unused = computeBackfillPriority(
      DEFAULT_WEIGHTS,
      makeRow({
        cvss4_base_score: 7,
        epss_percentile: 0.5,
        exploitability_score: 0.8,
        reachability: 'unused',
      }),
      0.5,
    );
    expect(unused.compositeScore).toBeLessThan(used.compositeScore);
  });

  it('produces a priorityScore on a 0-100 scale, rounded to 1 decimal', () => {
    const result = computeBackfillPriority(
      DEFAULT_WEIGHTS,
      makeRow({
        cvss4_base_score: 8,
        epss_percentile: 0.6,
        exploitability_score: 0.7,
      }),
      0.5,
    );
    // composite = 0.35*0.8 + 0.25*0.6 + 0.25*0.7 + 0.15*0.5
    //           = 0.28 + 0.15 + 0.175 + 0.075 = 0.68
    expect(result.priorityScore).toBeCloseTo(68.0, 1);
  });

  it('matches PriorityCalculatorService for a representative EPSS-present input', () => {
    // Reproduces the EPSS-absent convergence expectation: the backfill must
    // produce the same composite the runtime would, bit-identical on the
    // same inputs.
    const row = makeRow({
      cvss4_environmental_score: 5,
      epss_percentile: 0.3,
      exploitability_score: 0.5,
    });
    const context = 0.5;
    const result = computeBackfillPriority(DEFAULT_WEIGHTS, row, context);
    // 0.35*0.5 + 0.25*0.3 + 0.25*0.5 + 0.15*0.5 = 0.175+0.075+0.125+0.075 = 0.45
    expect(result.compositeScore).toBeCloseTo(0.45, 10);
  });
});
