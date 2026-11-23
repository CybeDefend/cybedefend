import { ConfigService } from '@nestjs/config';
import {
  PriorityCalculatorService,
  PriorityInput,
} from './priority-calculator.service';

function makeConfig(overrides: Record<string, string> = {}): ConfigService {
  const store: Record<string, string> = {
    PRIORITY_WEIGHT_CVSS4: '0.35',
    PRIORITY_WEIGHT_EPSS: '0.25',
    PRIORITY_WEIGHT_EXPLOIT: '0.25',
    PRIORITY_WEIGHT_CONTEXT: '0.15',
    PRIORITY_THRESHOLD_CRITICAL_URGENT: '0.8',
    PRIORITY_THRESHOLD_URGENT: '0.6',
    PRIORITY_THRESHOLD_NORMAL: '0.4',
    PRIORITY_THRESHOLD_LOW: '0.2',
    ...overrides,
  };
  return {
    get: (key: string, fallback?: string) => store[key] ?? fallback,
  } as any;
}

function makeInput(overrides: Partial<PriorityInput> = {}): PriorityInput {
  return {
    cvss4EnvironmentalScore: null,
    cvss4BaseScore: null,
    currentSeverity: 'MEDIUM',
    epssScore: null,
    epssPercentile: null,
    exploitabilityScore: null,
    businessCriticality: 0,
    dataClassification: 0,
    reachability: null,
    priorityManualOverride: false,
    ...overrides,
  };
}

describe('PriorityCalculatorService', () => {
  let service: PriorityCalculatorService;

  beforeEach(() => {
    service = new PriorityCalculatorService(makeConfig());
  });

  describe('constructor', () => {
    it('should accept default weights that sum to 1.0', () => {
      expect(() => new PriorityCalculatorService(makeConfig())).not.toThrow();
    });

    it('should throw when configured weights do not sum to 1.0', () => {
      expect(
        () =>
          new PriorityCalculatorService(
            makeConfig({
              PRIORITY_WEIGHT_CVSS4: '0.5',
              PRIORITY_WEIGHT_EPSS: '0.5',
              PRIORITY_WEIGHT_EXPLOIT: '0.5',
              PRIORITY_WEIGHT_CONTEXT: '0.5',
            }),
          ),
      ).toThrow(/weights/i);
    });

    it('should accept tiny floating-point drift around 1.0', () => {
      // 0.1 + 0.2 + 0.3 + 0.4 = 1.0000000000000002 in IEEE-754
      expect(
        () =>
          new PriorityCalculatorService(
            makeConfig({
              PRIORITY_WEIGHT_CVSS4: '0.1',
              PRIORITY_WEIGHT_EPSS: '0.2',
              PRIORITY_WEIGHT_EXPLOIT: '0.3',
              PRIORITY_WEIGHT_CONTEXT: '0.4',
            }),
          ),
      ).not.toThrow();
    });
  });

  describe('calculate', () => {
    it('should return critical_urgent for all high-value signals', () => {
      const result = service.calculate(
        makeInput({
          cvss4EnvironmentalScore: 9.5,
          epssPercentile: 0.9,
          exploitabilityScore: 0.95,
          businessCriticality: 4, // MISSION_CRITICAL
          dataClassification: 4, // REGULATED
        }),
      );
      expect(result).not.toBeNull();
      expect(result!.priority).toBe('critical_urgent');
      expect(result!.compositeScore).toBeGreaterThanOrEqual(0.8);
    });

    it('should return very_low for all low-value signals', () => {
      const result = service.calculate(
        makeInput({
          cvss4EnvironmentalScore: 1.0,
          epssPercentile: 0.01,
          exploitabilityScore: 0.05,
          businessCriticality: 1, // LOW
          dataClassification: 1, // PUBLIC
        }),
      );
      expect(result).not.toBeNull();
      expect(result!.priority).toBe('very_low');
      expect(result!.compositeScore).toBeLessThan(0.2);
    });

    it('should fall back to cvss4BaseScore when environmentalScore is null', () => {
      const withEnv = service.calculate(
        makeInput({
          cvss4EnvironmentalScore: 7.0,
          cvss4BaseScore: 7.0,
          epssPercentile: 0.5,
          exploitabilityScore: 0.5,
          businessCriticality: 2,
          dataClassification: 2,
        }),
      );
      const withBase = service.calculate(
        makeInput({
          cvss4EnvironmentalScore: null,
          cvss4BaseScore: 7.0,
          epssPercentile: 0.5,
          exploitabilityScore: 0.5,
          businessCriticality: 2,
          dataClassification: 2,
        }),
      );
      expect(withEnv).not.toBeNull();
      expect(withBase).not.toBeNull();
      expect(withEnv!.compositeScore).toBe(withBase!.compositeScore);
    });

    it('should fall back to severity-based default when both CVSS4 scores are null', () => {
      const critical = service.calculate(
        makeInput({
          currentSeverity: 'CRITICAL',
          epssPercentile: 0.5,
          exploitabilityScore: 0.5,
          businessCriticality: 2,
          dataClassification: 2,
        }),
      );
      const low = service.calculate(
        makeInput({
          currentSeverity: 'LOW',
          epssPercentile: 0.5,
          exploitabilityScore: 0.5,
          businessCriticality: 2,
          dataClassification: 2,
        }),
      );
      expect(critical).not.toBeNull();
      expect(low).not.toBeNull();
      expect(critical!.compositeScore).toBeGreaterThan(low!.compositeScore);
    });

    it('should produce a lower score when EPSS percentile is low vs high', () => {
      const highEpss = service.calculate(
        makeInput({
          cvss4EnvironmentalScore: 5.0,
          epssPercentile: 0.9,
          exploitabilityScore: 0.5,
          businessCriticality: 2,
          dataClassification: 2,
        }),
      );
      const lowEpss = service.calculate(
        makeInput({
          cvss4EnvironmentalScore: 5.0,
          epssPercentile: 0.1,
          exploitabilityScore: 0.5,
          businessCriticality: 2,
          dataClassification: 2,
        }),
      );
      expect(lowEpss).not.toBeNull();
      expect(lowEpss!.compositeScore).toBeLessThan(highEpss!.compositeScore);
    });

    it('should treat missing exploitability as 0.5 (neutral)', () => {
      const result = service.calculate(
        makeInput({
          cvss4EnvironmentalScore: 5.0,
          epssPercentile: 0.3,
          exploitabilityScore: null,
          businessCriticality: 2,
          dataClassification: 2,
        }),
      );
      const explicit = service.calculate(
        makeInput({
          cvss4EnvironmentalScore: 5.0,
          epssPercentile: 0.3,
          exploitabilityScore: 0.5,
          businessCriticality: 2,
          dataClassification: 2,
        }),
      );
      expect(result).not.toBeNull();
      expect(result!.compositeScore).toBe(explicit!.compositeScore);
    });

    it('should treat UNSPECIFIED context (0) as 0.5 (neutral)', () => {
      const result = service.calculate(
        makeInput({
          cvss4EnvironmentalScore: 5.0,
          epssPercentile: 0.3,
          exploitabilityScore: 0.5,
          businessCriticality: 0,
          dataClassification: 0,
        }),
      );
      expect(result).not.toBeNull();
      // contextModifier = (0.5 + 0.5) / 2 = 0.5
      const expected = 0.35 * (5.0 / 10) + 0.25 * 0.3 + 0.25 * 0.5 + 0.15 * 0.5;
      expect(result!.compositeScore).toBeCloseTo(expected, 10);
    });

    it('should compute severity-only fallback when all signals are null', () => {
      const result = service.calculate(
        makeInput({
          currentSeverity: 'HIGH',
          cvss4EnvironmentalScore: null,
          cvss4BaseScore: null,
          epssScore: null,
          epssPercentile: null,
          exploitabilityScore: null,
          businessCriticality: 0,
          dataClassification: 0,
        }),
      );
      expect(result).not.toBeNull();
      // EPSS absent → renormalize to w1'/w3'/w4' with denom 0.75.
      // CVSS fallback: HIGH=7.0 -> 0.7, exploit=0.5 (neutral), context=0.5
      const denom = 0.35 + 0.25 + 0.15;
      const expected =
        (0.35 / denom) * 0.7 + (0.25 / denom) * 0.5 + (0.15 / denom) * 0.5;
      expect(result!.compositeScore).toBeCloseTo(expected, 10);
    });

    it('should correctly map threshold boundaries', () => {
      // Verify exact boundary via the mapScoreToPriority logic through decompose
      const decomp080 = service.decompose(
        makeInput({
          cvss4EnvironmentalScore: 10.0,
          epssPercentile: 1.0,
          exploitabilityScore: 0.33,
          businessCriticality: 2, // MEDIUM -> 0.4
          dataClassification: 2, // INTERNAL -> 0.4
        }),
      );
      // composite = 0.35*1.0 + 0.25*1.0 + 0.25*0.33 + 0.15*0.4 = 0.35+0.25+0.0825+0.06 = 0.7425
      expect(decomp080.priority).toBe('urgent');
    });

    it('should force exploitability to 0 when SCA reachability is unused', () => {
      const used = service.calculate(
        makeInput({
          cvss4EnvironmentalScore: 7.0,
          epssPercentile: 0.5,
          exploitabilityScore: 0.8,
          businessCriticality: 2,
          dataClassification: 2,
          reachability: 'used',
        }),
      );
      const unused = service.calculate(
        makeInput({
          cvss4EnvironmentalScore: 7.0,
          epssPercentile: 0.5,
          exploitabilityScore: 0.8,
          businessCriticality: 2,
          dataClassification: 2,
          reachability: 'unused',
        }),
      );
      expect(used).not.toBeNull();
      expect(unused).not.toBeNull();
      // Unused should have lower score because exploitability is forced to 0
      expect(unused!.compositeScore).toBeLessThan(used!.compositeScore);
      // Verify exploitability contribution is 0 for unused
      const decomp = service.decompose(
        makeInput({
          cvss4EnvironmentalScore: 7.0,
          epssPercentile: 0.5,
          exploitabilityScore: 0.8,
          businessCriticality: 2,
          dataClassification: 2,
          reachability: 'unused',
        }),
      );
      expect(decomp.exploitContribution).toBe(0);
    });

    it('should not change exploitability when reachability is used', () => {
      const withReach = service.calculate(
        makeInput({
          cvss4EnvironmentalScore: 7.0,
          epssPercentile: 0.5,
          exploitabilityScore: 0.8,
          businessCriticality: 2,
          dataClassification: 2,
          reachability: 'used',
        }),
      );
      const withoutReach = service.calculate(
        makeInput({
          cvss4EnvironmentalScore: 7.0,
          epssPercentile: 0.5,
          exploitabilityScore: 0.8,
          businessCriticality: 2,
          dataClassification: 2,
          reachability: null,
        }),
      );
      expect(withReach!.compositeScore).toBe(withoutReach!.compositeScore);
    });

    it('should return null when priorityManualOverride is true', () => {
      const result = service.calculate(
        makeInput({
          cvss4EnvironmentalScore: 9.0,
          epssPercentile: 0.9,
          exploitabilityScore: 0.9,
          businessCriticality: 4,
          dataClassification: 4,
          priorityManualOverride: true,
        }),
      );
      expect(result).toBeNull();
    });

    it('should be deterministic (same inputs always produce same output)', () => {
      const input = makeInput({
        cvss4EnvironmentalScore: 6.5,
        epssPercentile: 0.45,
        exploitabilityScore: 0.6,
        businessCriticality: 3,
        dataClassification: 3,
      });
      const results = Array.from({ length: 100 }, () =>
        service.calculate(input),
      );
      const first = results[0];
      for (const r of results) {
        expect(r!.priority).toBe(first!.priority);
        expect(r!.compositeScore).toBe(first!.compositeScore);
      }
    });

    it('should expose priorityScore as compositeScore * 100, rounded to 1 decimal', () => {
      const result = service.calculate(
        makeInput({
          cvss4EnvironmentalScore: 8.0,
          epssPercentile: 0.6,
          exploitabilityScore: 0.7,
          businessCriticality: 3, // HIGH -> 0.7
          dataClassification: 2, // INTERNAL -> 0.4
        }),
      );
      expect(result).not.toBeNull();
      // composite = 0.35*0.8 + 0.25*0.6 + 0.25*0.7 + 0.15*0.55 = 0.28 + 0.15 + 0.175 + 0.0825 = 0.6875
      // priorityScore = 68.75 → rounded to 1 decimal = 68.8
      expect(result!.priorityScore).toBeCloseTo(68.8, 1);
    });

    it('priorityScore should be bounded in [0, 100]', () => {
      const max = service.calculate(
        makeInput({
          cvss4EnvironmentalScore: 10.0,
          epssPercentile: 1.0,
          exploitabilityScore: 1.0,
          businessCriticality: 4,
          dataClassification: 4,
        }),
      );
      const min = service.calculate(
        makeInput({
          cvss4EnvironmentalScore: 0.0,
          epssPercentile: 0.0,
          exploitabilityScore: 0.0,
          businessCriticality: 1,
          dataClassification: 1,
        }),
      );
      expect(max).not.toBeNull();
      expect(min).not.toBeNull();
      expect(max!.priorityScore).toBeLessThanOrEqual(100);
      expect(max!.priorityScore).toBeGreaterThanOrEqual(0);
      expect(min!.priorityScore).toBeLessThanOrEqual(100);
      expect(min!.priorityScore).toBeGreaterThanOrEqual(0);
    });

    it('should produce different results with custom weights', () => {
      const customService = new PriorityCalculatorService(
        makeConfig({
          PRIORITY_WEIGHT_CVSS4: '0.10',
          PRIORITY_WEIGHT_EPSS: '0.10',
          PRIORITY_WEIGHT_EXPLOIT: '0.70',
          PRIORITY_WEIGHT_CONTEXT: '0.10',
        }),
      );
      const input = makeInput({
        cvss4EnvironmentalScore: 3.0,
        epssPercentile: 0.1,
        exploitabilityScore: 0.95,
        businessCriticality: 2,
        dataClassification: 2,
      });
      const defaultResult = service.calculate(input);
      const customResult = customService.calculate(input);
      expect(defaultResult).not.toBeNull();
      expect(customResult).not.toBeNull();
      expect(customResult!.compositeScore).not.toBe(
        defaultResult!.compositeScore,
      );
    });
  });

  describe('decompose', () => {
    it('should return contributions summing to compositeScore', () => {
      const decomp = service.decompose(
        makeInput({
          cvss4EnvironmentalScore: 7.0,
          epssPercentile: 0.5,
          exploitabilityScore: 0.6,
          businessCriticality: 3,
          dataClassification: 3,
        }),
      );
      const sum =
        decomp.cvss4Contribution +
        decomp.epssContribution +
        decomp.exploitContribution +
        decomp.contextContribution;
      expect(sum).toBeCloseTo(decomp.compositeScore, 10);
    });

    it('should return the correct weights when EPSS percentile is present', () => {
      const decomp = service.decompose(
        makeInput({
          cvss4EnvironmentalScore: 5.0,
          epssPercentile: 0.3,
          exploitabilityScore: 0.5,
          businessCriticality: 2,
          dataClassification: 2,
        }),
      );
      expect(decomp.w1).toBe(0.35);
      expect(decomp.w2).toBe(0.25);
      expect(decomp.w3).toBe(0.25);
      expect(decomp.w4).toBe(0.15);
    });

    it('uses malware weights (exploitability 0.85 / context 0.15, no CVSS/EPSS)', () => {
      const decomp = service.decompose(
        makeInput({
          isMalware: true,
          cvss4EnvironmentalScore: 9.0,
          epssPercentile: 1.0,
          exploitabilityScore: 1.0,
          businessCriticality: 0,
          dataClassification: 0, // context modifier = 0.5
        }),
      );
      expect(decomp.w1).toBe(0);
      expect(decomp.w2).toBe(0);
      expect(decomp.w3).toBe(0.85);
      expect(decomp.w4).toBe(0.15);
      expect(decomp.cvss4Contribution).toBe(0);
      expect(decomp.epssContribution).toBe(0);
      expect(decomp.exploitContribution).toBeCloseTo(0.85, 10);
      expect(decomp.contextContribution).toBeCloseTo(0.075, 10);
      expect(decomp.compositeScore).toBeCloseTo(0.925, 10);
    });

    it('should report isManualOverride correctly', () => {
      const manual = service.decompose(
        makeInput({ priorityManualOverride: true }),
      );
      const auto = service.decompose(
        makeInput({ priorityManualOverride: false }),
      );
      expect(manual.isManualOverride).toBe(true);
      expect(auto.isManualOverride).toBe(false);
    });

    it('should compute each contribution as weight * normalized input', () => {
      const decomp = service.decompose(
        makeInput({
          cvss4EnvironmentalScore: 8.0,
          epssPercentile: 0.6,
          exploitabilityScore: 0.7,
          businessCriticality: 3, // HIGH -> 0.7
          dataClassification: 2, // INTERNAL -> 0.4
        }),
      );
      expect(decomp.cvss4Contribution).toBeCloseTo(0.35 * 0.8, 10);
      expect(decomp.epssContribution).toBeCloseTo(0.25 * 0.6, 10);
      expect(decomp.exploitContribution).toBeCloseTo(0.25 * 0.7, 10);
      // context = (0.7 + 0.4) / 2 = 0.55
      expect(decomp.contextContribution).toBeCloseTo(0.15 * 0.55, 10);
    });
  });

  describe('computeContextModifier', () => {
    it('should return 0.5 for UNSPECIFIED values', () => {
      const result = service.computeContextModifier(0, 0);
      expect(result).toBe(0.5);
    });

    it('should return correct value for LOW/PUBLIC', () => {
      const result = service.computeContextModifier(1, 1);
      expect(result).toBe(0.2); // (0.2 + 0.2) / 2
    });

    it('should return correct value for MISSION_CRITICAL/REGULATED', () => {
      const result = service.computeContextModifier(4, 4);
      expect(result).toBe(1.0); // (1.0 + 1.0) / 2
    });

    it('should return mixed value for HIGH/INTERNAL', () => {
      const result = service.computeContextModifier(3, 2);
      expect(result).toBeCloseTo(0.55, 10); // (0.7 + 0.4) / 2
    });
  });

  describe('EPSS percentile branching', () => {
    it('uses epssPercentile (not epssScore) when available', () => {
      // percentile = 0.87, probability = 0.033 — the composite must reflect 0.87.
      const input = makeInput({
        cvss4BaseScore: 0,
        currentSeverity: 'LOW',
        epssScore: 0.033,
        epssPercentile: 0.87,
        exploitabilityScore: 0,
        businessCriticality: 1, // 0.2
        dataClassification: 1, // 0.2
      });
      const result = service.calculate(input);
      // cvssNorm = 0 (cvss4BaseScore=0) = 0
      // context = (0.2 + 0.2) / 2 = 0.2
      // composite = 0.35*0 + 0.25*0.87 + 0.25*0 + 0.15*0.2 = 0 + 0.2175 + 0 + 0.03 = 0.2475
      expect(result!.compositeScore).toBeCloseTo(0.2475, 4);
    });

    it('renormalizes weights to sum to 1.0 when epssPercentile is null', () => {
      const input = makeInput({
        cvss4BaseScore: 10, // cvssNorm = 1.0
        epssPercentile: null,
        exploitabilityScore: 1.0, // exploit = 1.0
        businessCriticality: 4, // biz = 1.0
        dataClassification: 4, // data = 1.0 → context = 1.0
      });
      const result = service.calculate(input);
      // Renormalized: w1'=0.35/0.75, w3'=0.25/0.75, w4'=0.15/0.75 (sum=1.0)
      // composite = (0.35+0.25+0.15)/0.75 * 1 = 1.0
      expect(result!.compositeScore).toBeCloseTo(1.0, 6);
    });

    it('renormalization preserves relative contribution ratios', () => {
      // With EPSS absent, CVSS should contribute 46.67%, exploit 33.33%, context 20%.
      const input = makeInput({
        cvss4BaseScore: 10, // cvssNorm = 1
        epssPercentile: null,
        exploitabilityScore: 0,
        businessCriticality: 0, // context = 0.5
        dataClassification: 0,
      });
      const result = service.calculate(input);
      // composite = (0.35/0.75)*1 + (0.25/0.75)*0 + (0.15/0.75)*0.5
      //           ≈ 0.4667 + 0 + 0.1 = 0.5667
      expect(result!.compositeScore).toBeCloseTo(0.5667, 3);
    });

    it('SCA with epssScore set but epssPercentile null is treated as EPSS-absent', () => {
      const input = makeInput({
        cvss4BaseScore: 10,
        epssScore: 0.5,
        epssPercentile: null,
        exploitabilityScore: 0,
        businessCriticality: 0,
        dataClassification: 0,
      });
      const result = service.calculate(input);
      expect(result!.compositeScore).toBeCloseTo(0.5667, 3);
    });

    it('treats NaN or Infinity epssPercentile as EPSS-absent', () => {
      const base = {
        cvss4BaseScore: 10,
        exploitabilityScore: 0,
        businessCriticality: 0,
        dataClassification: 0,
      };
      const nanResult = service.calculate(
        makeInput({ ...base, epssPercentile: Number.NaN }),
      );
      const infResult = service.calculate(
        makeInput({ ...base, epssPercentile: Number.POSITIVE_INFINITY }),
      );
      const nullResult = service.calculate(
        makeInput({ ...base, epssPercentile: null }),
      );
      // All three must produce the identical renormalized composite.
      expect(nanResult!.compositeScore).toBeCloseTo(
        nullResult!.compositeScore,
        6,
      );
      expect(infResult!.compositeScore).toBeCloseTo(
        nullResult!.compositeScore,
        6,
      );
    });

    it('treats decimal-string epssPercentile from TypeORM as EPSS-present', () => {
      const d = service.decompose(
        makeInput({
          cvss4BaseScore: 9.4 as any,
          epssPercentile: '0.6200' as any,
          exploitabilityScore: 0.89 as any,
          businessCriticality: 0,
          dataClassification: 0,
        }),
      );

      expect(d.w2).toBeCloseTo(0.25, 6);
      expect(d.epssContribution).toBeCloseTo(0.155, 3);
    });

    it('accepts gRPC enum names for project context instead of falling back to neutral 50', () => {
      const d = service.decompose(
        makeInput({
          cvss4BaseScore: 9.4 as any,
          epssPercentile: '0.6200' as any,
          exploitabilityScore: 0.89 as any,
          businessCriticality: 'BUSINESS_CRITICALITY_MISSION_CRITICAL' as any,
          dataClassification: 'DATA_CLASSIFICATION_REGULATED' as any,
        }),
      );

      expect(d.contextContribution).toBeCloseTo(0.15, 6);
    });
  });

  describe('decompose() effective weights', () => {
    it('returns configured weights and percentile contribution when EPSS present', () => {
      const input = makeInput({
        cvss4BaseScore: 8,
        epssPercentile: 0.87,
        exploitabilityScore: 0.5,
        businessCriticality: 2,
        dataClassification: 2,
      });
      const d = service.decompose(input);
      expect(d.w1).toBeCloseTo(0.35, 6);
      expect(d.w2).toBeCloseTo(0.25, 6);
      expect(d.w3).toBeCloseTo(0.25, 6);
      expect(d.w4).toBeCloseTo(0.15, 6);
      // epssContribution = 0.25 * 0.87 = 0.2175
      expect(d.epssContribution).toBeCloseTo(0.2175, 4);
    });

    it('returns renormalized weights and zero EPSS contribution when EPSS absent', () => {
      const input = makeInput({
        cvss4BaseScore: 8,
        epssPercentile: null,
        exploitabilityScore: 0.5,
        businessCriticality: 2,
        dataClassification: 2,
      });
      const d = service.decompose(input);
      expect(d.w1).toBeCloseTo(0.35 / 0.75, 4); // ≈ 0.4667
      expect(d.w2).toBe(0);
      expect(d.w3).toBeCloseTo(0.25 / 0.75, 4); // ≈ 0.3333
      expect(d.w4).toBeCloseTo(0.15 / 0.75, 4); // = 0.2
      expect(d.epssContribution).toBe(0);
      expect(d.w1 + d.w2 + d.w3 + d.w4).toBeCloseTo(1.0, 6);
    });
  });
});
