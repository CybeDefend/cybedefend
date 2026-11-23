import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PriorityDecomposition } from '@grpc/analysis-reporting/result';

export interface PriorityInput {
  cvss4EnvironmentalScore: number | null;
  cvss4BaseScore: number | null;
  currentSeverity: string;
  epssScore: number | null;
  epssPercentile: number | null;
  exploitabilityScore: number | null;
  businessCriticality: number; // enum value: 0=UNSPECIFIED, 1=LOW, 2=MEDIUM, 3=HIGH, 4=MISSION_CRITICAL
  dataClassification: number; // enum value: 0=UNSPECIFIED, 1=PUBLIC, 2=INTERNAL, 3=CONFIDENTIAL, 4=REGULATED
  reachability?: string | null; // SCA only: 'used' | 'unused' | null
  priorityManualOverride: boolean;
  // Malicious-package (malware) findings are scored on a dedicated
  // 2-dimension model — CVSS/EPSS are meaningless for malware — so priority is
  // exploitability (0.85) + business context (0.15).
  isMalware?: boolean;
}

// Malware priority weights (exploitability + context only).
const MALWARE_WEIGHT_EXPLOIT = 0.85;
const MALWARE_WEIGHT_CONTEXT = 0.15;

export interface PriorityResult {
  priority: string;
  /** Internal 0-1 weighted composite score. */
  compositeScore: number;
  /**
   * User-facing 0-100 priority score (compositeScore * 100, rounded to one
   * decimal). Persisted on the detection row so the listing can sort
   * server-side and the dashboard can render the same value as the detail.
   */
  priorityScore: number;
}

const SEVERITY_CVSS_DEFAULTS: Record<string, number> = {
  CRITICAL: 9.0,
  HIGH: 7.0,
  MEDIUM: 4.0,
  LOW: 2.0,
};

const BUSINESS_CRITICALITY_MAP: Record<string | number, number> = {
  0: 0.5, // UNSPECIFIED -> neutral
  1: 0.2, // LOW
  2: 0.4, // MEDIUM
  3: 0.7, // HIGH
  4: 1.0, // MISSION_CRITICAL
  low: 0.2,
  medium: 0.4,
  high: 0.7,
  mission_critical: 1.0,
  BUSINESS_CRITICALITY_UNSPECIFIED: 0.5,
  BUSINESS_CRITICALITY_LOW: 0.2,
  BUSINESS_CRITICALITY_MEDIUM: 0.4,
  BUSINESS_CRITICALITY_HIGH: 0.7,
  BUSINESS_CRITICALITY_MISSION_CRITICAL: 1.0,
};

const DATA_CLASSIFICATION_MAP: Record<string | number, number> = {
  0: 0.5, // UNSPECIFIED -> neutral
  1: 0.2, // PUBLIC
  2: 0.4, // INTERNAL
  3: 0.7, // CONFIDENTIAL
  4: 1.0, // REGULATED
  public: 0.2,
  internal: 0.4,
  confidential: 0.7,
  regulated: 1.0,
  DATA_CLASSIFICATION_UNSPECIFIED: 0.5,
  DATA_CLASSIFICATION_PUBLIC: 0.2,
  DATA_CLASSIFICATION_INTERNAL: 0.4,
  DATA_CLASSIFICATION_CONFIDENTIAL: 0.7,
  DATA_CLASSIFICATION_REGULATED: 1.0,
};

function toFiniteNumber(value: unknown): number | null {
  if (value == null || value === '') {
    return null;
  }
  const parsed =
    typeof value === 'number' ? value : Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

@Injectable()
export class PriorityCalculatorService {
  private readonly w1: number;
  private readonly w2: number;
  private readonly w3: number;
  private readonly w4: number;
  private readonly thresholds: Array<{ min: number; priority: string }>;

  constructor(private readonly configService: ConfigService) {
    this.w1 = parseFloat(
      this.configService.get('PRIORITY_WEIGHT_CVSS4', '0.35'),
    );
    this.w2 = parseFloat(
      this.configService.get('PRIORITY_WEIGHT_EPSS', '0.25'),
    );
    this.w3 = parseFloat(
      this.configService.get('PRIORITY_WEIGHT_EXPLOIT', '0.25'),
    );
    this.w4 = parseFloat(
      this.configService.get('PRIORITY_WEIGHT_CONTEXT', '0.15'),
    );

    const weightSum = this.w1 + this.w2 + this.w3 + this.w4;
    if (Math.abs(weightSum - 1) > 0.001) {
      throw new Error(
        `PriorityCalculatorService: configured weights must sum to 1.0 ` +
          `(got ${weightSum.toFixed(4)} = ${this.w1} + ${this.w2} + ${this.w3} + ${this.w4})`,
      );
    }

    this.thresholds = [
      {
        min: parseFloat(
          this.configService.get('PRIORITY_THRESHOLD_CRITICAL_URGENT', '0.8'),
        ),
        priority: 'critical_urgent',
      },
      {
        min: parseFloat(
          this.configService.get('PRIORITY_THRESHOLD_URGENT', '0.6'),
        ),
        priority: 'urgent',
      },
      {
        min: parseFloat(
          this.configService.get('PRIORITY_THRESHOLD_NORMAL', '0.4'),
        ),
        priority: 'normal',
      },
      {
        min: parseFloat(
          this.configService.get('PRIORITY_THRESHOLD_LOW', '0.2'),
        ),
        priority: 'low',
      },
    ];
  }

  /**
   * Calculate priority from multi-signal inputs.
   * Returns null if manual override is active (skip recalculation).
   */
  calculate(input: PriorityInput): PriorityResult | null {
    if (input.priorityManualOverride) {
      return null;
    }

    const { compositeScore } = this.computeComposite(input);

    return {
      priority: this.mapScoreToPriority(compositeScore),
      compositeScore,
      priorityScore: this.toPriorityScore(compositeScore),
    };
  }

  /**
   * Full decomposition for transparency endpoint.
   */
  decompose(input: PriorityInput): PriorityDecomposition {
    const {
      compositeScore,
      cvss4Contribution,
      epssContribution,
      exploitContribution,
      contextContribution,
      effectiveW1,
      effectiveW2,
      effectiveW3,
      effectiveW4,
    } = this.computeComposite(input);

    return {
      priority: input.priorityManualOverride
        ? ''
        : this.mapScoreToPriority(compositeScore),
      compositeScore,
      cvss4Contribution,
      epssContribution,
      exploitContribution,
      contextContribution,
      w1: effectiveW1,
      w2: effectiveW2,
      w3: effectiveW3,
      w4: effectiveW4,
      isManualOverride: input.priorityManualOverride,
    };
  }

  /**
   * Internal helper: computes composite, individual contributions, and the
   * effective weights actually applied. When epssPercentile is null, the
   * EPSS dimension is removed and w1/w3/w4 are renormalized to sum to 1.
   */
  private computeComposite(input: PriorityInput): {
    compositeScore: number;
    cvss4Contribution: number;
    epssContribution: number;
    exploitContribution: number;
    contextContribution: number;
    effectiveW1: number;
    effectiveW2: number;
    effectiveW3: number;
    effectiveW4: number;
  } {
    const cvssNorm = this.normalizeCvss(input);
    const exploit = this.resolveExploitability(input);
    const context = this.computeContextModifier(
      input.businessCriticality,
      input.dataClassification,
    );

    // Malware is scored purely on exploitability + business context —
    // CVSS and EPSS do not apply to a malicious package.
    if (input.isMalware) {
      const exploitContribution = MALWARE_WEIGHT_EXPLOIT * exploit;
      const contextContribution = MALWARE_WEIGHT_CONTEXT * context;
      return {
        compositeScore: exploitContribution + contextContribution,
        cvss4Contribution: 0,
        epssContribution: 0,
        exploitContribution,
        contextContribution,
        effectiveW1: 0,
        effectiveW2: 0,
        effectiveW3: MALWARE_WEIGHT_EXPLOIT,
        effectiveW4: MALWARE_WEIGHT_CONTEXT,
      };
    }

    const epssPercentile = toFiniteNumber(input.epssPercentile);
    if (epssPercentile != null) {
      const cvss4Contribution = this.w1 * cvssNorm;
      const epssContribution = this.w2 * epssPercentile;
      const exploitContribution = this.w3 * exploit;
      const contextContribution = this.w4 * context;
      return {
        compositeScore:
          cvss4Contribution +
          epssContribution +
          exploitContribution +
          contextContribution,
        cvss4Contribution,
        epssContribution,
        exploitContribution,
        contextContribution,
        effectiveW1: this.w1,
        effectiveW2: this.w2,
        effectiveW3: this.w3,
        effectiveW4: this.w4,
      };
    }

    const denom = this.w1 + this.w3 + this.w4;
    const effectiveW1 = this.w1 / denom;
    const effectiveW3 = this.w3 / denom;
    const effectiveW4 = this.w4 / denom;
    const cvss4Contribution = effectiveW1 * cvssNorm;
    const exploitContribution = effectiveW3 * exploit;
    const contextContribution = effectiveW4 * context;
    return {
      compositeScore:
        cvss4Contribution + exploitContribution + contextContribution,
      cvss4Contribution,
      epssContribution: 0,
      exploitContribution,
      contextContribution,
      effectiveW1,
      effectiveW2: 0,
      effectiveW3,
      effectiveW4,
    };
  }

  /**
   * Map business criticality + data classification enum values to a 0-1 modifier.
   */
  computeContextModifier(
    businessCriticality: number,
    dataClassification: number,
  ): number {
    const biz = BUSINESS_CRITICALITY_MAP[businessCriticality] ?? 0.5;
    const data = DATA_CLASSIFICATION_MAP[dataClassification] ?? 0.5;
    return (biz + data) / 2;
  }

  private normalizeCvss(input: PriorityInput): number {
    const raw =
      toFiniteNumber(input.cvss4EnvironmentalScore) ??
      toFiniteNumber(input.cvss4BaseScore) ??
      this.severityToDefaultCvss(input.currentSeverity);
    return raw / 10;
  }

  private severityToDefaultCvss(severity: string): number {
    return SEVERITY_CVSS_DEFAULTS[severity?.toUpperCase()] ?? 4.0;
  }

  private resolveExploitability(input: PriorityInput): number {
    if (input.reachability === 'unused') {
      return 0;
    }
    return toFiniteNumber(input.exploitabilityScore) ?? 0.5;
  }

  private mapScoreToPriority(score: number): string {
    for (const { min, priority } of this.thresholds) {
      if (score >= min) {
        return priority;
      }
    }
    return 'very_low';
  }

  /**
   * Convert internal 0-1 composite score to user-facing 0-100 score with one
   * decimal of precision. Bounded so a slightly-out-of-range input cannot
   * produce > 100.
   */
  private toPriorityScore(compositeScore: number): number {
    const bounded = Math.max(0, Math.min(1, compositeScore));
    return Math.round(bounded * 1000) / 10;
  }
}
