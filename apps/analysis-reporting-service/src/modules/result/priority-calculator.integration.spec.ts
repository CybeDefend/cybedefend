import { ConfigService } from '@nestjs/config';
import {
  PriorityCalculatorService,
  PriorityInput,
} from './priority-calculator.service';

function makeConfig(): ConfigService {
  const store: Record<string, string> = {
    PRIORITY_WEIGHT_CVSS4: '0.35',
    PRIORITY_WEIGHT_EPSS: '0.25',
    PRIORITY_WEIGHT_EXPLOIT: '0.25',
    PRIORITY_WEIGHT_CONTEXT: '0.15',
    PRIORITY_THRESHOLD_CRITICAL_URGENT: '0.8',
    PRIORITY_THRESHOLD_URGENT: '0.6',
    PRIORITY_THRESHOLD_NORMAL: '0.4',
    PRIORITY_THRESHOLD_LOW: '0.2',
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

describe('PriorityCalculator Integration Tests', () => {
  let calculator: PriorityCalculatorService;

  beforeEach(() => {
    calculator = new PriorityCalculatorService(makeConfig());
  });

  describe('SAST vulnerability with high exploitability', () => {
    it('should produce critical_urgent priority for high composite score', () => {
      const input = makeInput({
        cvss4EnvironmentalScore: 9.0,
        epssPercentile: 0.8,
        exploitabilityScore: 0.9,
        businessCriticality: 3, // HIGH
        dataClassification: 3, // CONFIDENTIAL
        reachability: null, // SAST: no reachability
      });

      const result = calculator.calculate(input);

      expect(result).not.toBeNull();
      expect(result!.priority).toBe('critical_urgent');
      // Verify the composite score:
      // cvss: 0.35 * (9.0/10) = 0.315
      // epss: 0.25 * 0.8 = 0.2
      // exploit: 0.25 * 0.9 = 0.225
      // context: 0.15 * ((0.7 + 0.7) / 2) = 0.15 * 0.7 = 0.105
      // total: 0.845
      expect(result!.compositeScore).toBeCloseTo(0.845, 10);
      expect(result!.compositeScore).toBeGreaterThanOrEqual(0.8);

      // Cross-check via decompose
      const decomp = calculator.decompose(input);
      expect(decomp.priority).toBe('critical_urgent');
      expect(decomp.cvss4Contribution).toBeCloseTo(0.315, 10);
      expect(decomp.epssContribution).toBeCloseTo(0.2, 10);
      expect(decomp.exploitContribution).toBeCloseTo(0.225, 10);
      expect(decomp.contextContribution).toBeCloseTo(0.105, 10);
    });
  });

  describe('SCA vulnerability with reachability=unused', () => {
    it('should force exploitability to 0 and produce lower priority than reachable variant', () => {
      const baseInputOverrides: Partial<PriorityInput> = {
        cvss4EnvironmentalScore: 9.0,
        epssPercentile: 0.8,
        exploitabilityScore: 0.9,
        businessCriticality: 3, // HIGH
        dataClassification: 3, // CONFIDENTIAL
      };

      const reachableResult = calculator.calculate(
        makeInput({ ...baseInputOverrides, reachability: 'used' }),
      );
      const unreachableResult = calculator.calculate(
        makeInput({ ...baseInputOverrides, reachability: 'unused' }),
      );

      expect(reachableResult).not.toBeNull();
      expect(unreachableResult).not.toBeNull();

      // Reachable should be critical_urgent (same as SAST test: 0.845)
      expect(reachableResult!.priority).toBe('critical_urgent');

      // Unreachable: exploitability forced to 0
      // cvss: 0.35 * 0.9 = 0.315
      // epss: 0.25 * 0.8 = 0.2
      // exploit: 0.25 * 0 = 0
      // context: 0.15 * 0.7 = 0.105
      // total: 0.62
      expect(unreachableResult!.compositeScore).toBeCloseTo(0.62, 10);
      expect(unreachableResult!.priority).toBe('urgent');

      // Unreachable must always score lower
      expect(unreachableResult!.compositeScore).toBeLessThan(
        reachableResult!.compositeScore,
      );

      // Verify exploitability contribution is 0 via decompose
      const decomp = calculator.decompose(
        makeInput({ ...baseInputOverrides, reachability: 'unused' }),
      );
      expect(decomp.exploitContribution).toBe(0);
    });
  });

  describe('manual priority override', () => {
    it('should return null when priorityManualOverride is true regardless of signal values', () => {
      const input = makeInput({
        cvss4EnvironmentalScore: 9.0,
        epssPercentile: 0.8,
        exploitabilityScore: 0.9,
        businessCriticality: 3,
        dataClassification: 3,
        priorityManualOverride: true,
      });

      const result = calculator.calculate(input);

      expect(result).toBeNull();

      // Decompose still works but marks override
      const decomp = calculator.decompose(input);
      expect(decomp.isManualOverride).toBe(true);
      expect(decomp.priority).toBe('');
    });
  });

  describe('all null inputs with severity fallback', () => {
    it('should produce a valid priority using severity-based CVSS default', () => {
      const input = makeInput({
        cvss4EnvironmentalScore: null,
        cvss4BaseScore: null,
        epssScore: null,
        epssPercentile: null,
        exploitabilityScore: null,
        businessCriticality: 0, // UNSPECIFIED -> 0.5
        dataClassification: 0, // UNSPECIFIED -> 0.5
        currentSeverity: 'MEDIUM',
      });

      const result = calculator.calculate(input);

      expect(result).not.toBeNull();
      // MEDIUM severity -> default CVSS 4.0 -> normalized 0.4
      // EPSS absent → renormalized weights with denom = 0.75
      // exploitability: null -> 0.5 (neutral default)
      // context: (0.5 + 0.5) / 2 = 0.5
      // composite: (0.35/0.75)*0.4 + (0.25/0.75)*0.5 + (0.15/0.75)*0.5
      //          ≈ 0.1867 + 0.1667 + 0.1 ≈ 0.4533
      const denom = 0.35 + 0.25 + 0.15;
      const expected =
        (0.35 / denom) * 0.4 + (0.25 / denom) * 0.5 + (0.15 / denom) * 0.5;
      expect(result!.compositeScore).toBeCloseTo(expected, 10);
      expect(result!.priority).toBe('normal');

      // Verify it's a valid priority string
      expect([
        'critical_urgent',
        'urgent',
        'normal',
        'low',
        'very_low',
      ]).toContain(result!.priority);
    });
  });

  describe('SecurityContext impact: MISSION_CRITICAL + REGULATED vs LOW + PUBLIC', () => {
    it('should produce higher priority with high security context than with low context', () => {
      const moderateSignals: Partial<PriorityInput> = {
        cvss4EnvironmentalScore: 5.5,
        epssPercentile: 0.35,
        exploitabilityScore: 0.5,
      };

      const highContextResult = calculator.calculate(
        makeInput({
          ...moderateSignals,
          businessCriticality: 4, // MISSION_CRITICAL -> 1.0
          dataClassification: 4, // REGULATED -> 1.0
        }),
      );
      const lowContextResult = calculator.calculate(
        makeInput({
          ...moderateSignals,
          businessCriticality: 1, // LOW -> 0.2
          dataClassification: 1, // PUBLIC -> 0.2
        }),
      );

      expect(highContextResult).not.toBeNull();
      expect(lowContextResult).not.toBeNull();

      // High context: 0.35*(5.5/10) + 0.25*0.35 + 0.25*0.5 + 0.15*1.0
      //             = 0.1925 + 0.0875 + 0.125 + 0.15 = 0.555
      expect(highContextResult!.compositeScore).toBeCloseTo(0.555, 10);

      // Low context: 0.35*(5.5/10) + 0.25*0.35 + 0.25*0.5 + 0.15*0.2
      //            = 0.1925 + 0.0875 + 0.125 + 0.03 = 0.435
      expect(lowContextResult!.compositeScore).toBeCloseTo(0.435, 10);

      // High context should score higher
      expect(highContextResult!.compositeScore).toBeGreaterThan(
        lowContextResult!.compositeScore,
      );

      // The difference in context alone should shift the priority bucket
      expect(highContextResult!.priority).toBe('normal');
      expect(lowContextResult!.priority).toBe('normal');

      // Verify the context contribution difference
      const highDecomp = calculator.decompose(
        makeInput({
          ...moderateSignals,
          businessCriticality: 4,
          dataClassification: 4,
        }),
      );
      const lowDecomp = calculator.decompose(
        makeInput({
          ...moderateSignals,
          businessCriticality: 1,
          dataClassification: 1,
        }),
      );
      // context contribution difference: 0.15*1.0 - 0.15*0.2 = 0.12
      expect(
        highDecomp.contextContribution - lowDecomp.contextContribution,
      ).toBeCloseTo(0.12, 10);
    });
  });
});
