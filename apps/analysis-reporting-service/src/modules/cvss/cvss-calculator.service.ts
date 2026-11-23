import { Injectable, Logger } from '@nestjs/common';
import { Cvss4P0, Cvss3P1 } from 'ae-cvss-calculator';

export interface SecurityContext {
  internetExposure: string;
  networkSegmentation: string;
  environment: string;
  dataClassification: string;
  businessCriticality: string;
  handlesPii: boolean;
  handlesPaymentData: boolean;
  safetyCritical: boolean;
}

// Alias for use in processor/queue context
export type SecurityContextForScoring = SecurityContext;

export interface EnvironmentalResult {
  fullVector: string;
  baseScore: number;
  environmentalScore: number;
}

// Alias for use in processor/queue context
export type EnvironmentalScoreResult = EnvironmentalResult;

/**
 * The CVSS 4.0 vector given to a finding that carries no CVSS of its own,
 * by the severity its tool reported. Each scores near the middle of the band
 * of the same label (critical 9.5, high 8.2, medium 5.7, low 2.0), so the
 * severity derived from the score is the one the tool gave.
 *
 * The metric values are invented: they stand for a label, not for an
 * analysis of the finding. The vectors therefore use AT:P, which no CVSS 3.1
 * conversion produces (it always writes AT:N), so a default vector is never
 * mistaken for a converted one.
 */
const SEVERITY_VECTORS: Record<string, string> = {
  critical: 'CVSS:4.0/AV:N/AC:L/AT:P/PR:N/UI:N/VC:H/VI:H/VA:H/SC:H/SI:H/SA:H',
  high: 'CVSS:4.0/AV:N/AC:L/AT:P/PR:N/UI:N/VC:H/VI:N/VA:N/SC:N/SI:N/SA:N',
  medium: 'CVSS:4.0/AV:N/AC:L/AT:P/PR:L/UI:A/VC:H/VI:N/VA:N/SC:N/SI:N/SA:N',
  low: 'CVSS:4.0/AV:N/AC:L/AT:P/PR:L/UI:A/VC:L/VI:N/VA:N/SC:N/SI:N/SA:N',
};

/**
 * The default vectors used before, still stored on findings scored with them.
 * The former high one scored 9.3 (critical) and the former low one 4.8
 * (medium). They are AT:N vectors that a CVSS 3.1 conversion can also
 * produce, so a stored one counts as a default only next to the label it
 * stood for.
 */
const FORMER_SEVERITY_VECTORS: Record<string, string> = {
  critical: 'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:H/SI:H/SA:H',
  high: 'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:L/SC:N/SI:N/SA:N',
  medium: 'CVSS:4.0/AV:N/AC:L/AT:N/PR:L/UI:N/VC:L/VI:L/VA:N/SC:N/SI:N/SA:N',
  low: 'CVSS:4.0/AV:L/AC:L/AT:N/PR:L/UI:N/VC:L/VI:N/VA:N/SC:N/SI:N/SA:N',
};

/** Where the vector of `computeCvss4Base` came from. */
export type Cvss4BaseSource = 'cvss4' | 'cvss3' | 'severity';

export interface Cvss4BaseResult {
  vector: string;
  baseScore: number;
  /**
   * 'severity' when the finding had no usable CVSS and the vector stands for
   * its label: such a vector must not go through the environmental metrics,
   * which would move the severity the tool gave.
   */
  source: Cvss4BaseSource;
}

const CVSS3_AV_MAP: Record<string, string> = {
  NETWORK: 'N',
  ADJACENT_NETWORK: 'A',
  LOCAL: 'L',
  PHYSICAL: 'P',
};

const CVSS3_AC_MAP: Record<string, string> = {
  LOW: 'L',
  HIGH: 'H',
};

const CVSS3_PR_MAP: Record<string, string> = {
  NONE: 'N',
  LOW: 'L',
  HIGH: 'H',
};

const CVSS3_UI_MAP: Record<string, string> = {
  NONE: 'N',
  REQUIRED: 'P',
};

const CVSS3_CIA_MAP: Record<string, string> = {
  HIGH: 'H',
  LOW: 'L',
  NONE: 'N',
};

// CVSS 3.1 Exploit Code Maturity -> CVSS 4.0 Threat metric `E` (Exploit
// Maturity). The other two Temporal metrics have no 4.0 counterpart: `RL`
// (Remediation Level) and `RC` (Report Confidence) were removed from the
// specification, so they are dropped rather than approximated.
// `X` (Not Defined) is deliberately absent — an undefined maturity must emit
// no component at all, not `E:X`.
const CVSS3_E_MAP: Record<string, string> = {
  U: 'U', // Unproven -> Unreported
  P: 'P', // Proof-of-Concept -> POC
  F: 'A', // Functional -> Attacked
  H: 'A', // High -> Attacked
};

@Injectable()
export class CvssCalculatorService {
  private readonly logger = new Logger(CvssCalculatorService.name);

  applyEnvironmentalMetrics(
    cvss4BaseVector: string,
    context: SecurityContext,
  ): EnvironmentalResult | null {
    try {
      const cvss = new Cvss4P0(cvss4BaseVector);

      const baseScores = cvss.calculateScores(true);
      const baseScore = baseScores.overall;

      // internetExposure -> MAV (Modified Attack Vector)
      switch (context.internetExposure) {
        case 'public':
          cvss.applyComponentString('MAV', 'N');
          break;
        case 'internal':
          cvss.applyComponentString('MAV', 'A');
          break;
        case 'airgapped':
          cvss.applyComponentString('MAV', 'L');
          break;
        case 'unspecified':
          this.logger.warn(
            '[CVSS] internetExposure=unspecified, skipping MAV adjustment',
          );
          break;
      }

      // networkSegmentation -> MAT (Modified Attack Requirements)
      switch (context.networkSegmentation) {
        case 'flat':
          cvss.applyComponentString('MAT', 'N');
          break;
        case 'segmented':
        case 'microsegmented':
          cvss.applyComponentString('MAT', 'P');
          break;
        case 'unspecified':
          this.logger.warn(
            '[CVSS] networkSegmentation=unspecified, skipping MAT adjustment',
          );
          break;
      }

      // environment -> MPR (Modified Privileges Required) for development
      // environment also sets CR/IR/AR defaults for production/staging
      // (overridable by explicit dataClassification / businessCriticality below)
      switch (context.environment) {
        case 'development':
          cvss.applyComponentString('MPR', 'H');
          break;
        case 'production':
          // Conservative default: treat prod as high-requirement unless caller
          // provides explicit overrides via dataClassification/businessCriticality
          cvss.applyComponentString('CR', 'H');
          cvss.applyComponentString('IR', 'H');
          cvss.applyComponentString('AR', 'H');
          break;
        case 'staging':
          cvss.applyComponentString('CR', 'M');
          cvss.applyComponentString('IR', 'M');
          cvss.applyComponentString('AR', 'M');
          break;
        case 'unspecified':
          this.logger.warn(
            '[CVSS] environment=unspecified, skipping env adjustments',
          );
          break;
      }

      // dataClassification -> CR (Confidentiality Requirement)
      // Applied AFTER environment defaults so explicit classification overrides
      // the env-derived default. regulated also sets MSC:H to boost subsequent
      // confidentiality impact.
      switch (context.dataClassification) {
        case 'public':
          cvss.applyComponentString('CR', 'L');
          break;
        case 'internal':
          cvss.applyComponentString('CR', 'M');
          break;
        case 'confidential':
          cvss.applyComponentString('CR', 'H');
          break;
        case 'regulated':
          cvss.applyComponentString('CR', 'H');
          cvss.applyComponentString('MSC', 'H');
          break;
        case 'unspecified':
          this.logger.warn(
            '[CVSS] dataClassification=unspecified, keeping env default for CR',
          );
          break;
      }

      // businessCriticality -> AR (Availability Requirement)
      // Applied AFTER environment defaults so explicit criticality overrides
      // the env-derived default. mission_critical also sets MSA:H to boost
      // subsequent availability impact.
      switch (context.businessCriticality) {
        case 'low':
          cvss.applyComponentString('AR', 'L');
          break;
        case 'medium':
          cvss.applyComponentString('AR', 'M');
          break;
        case 'high':
          cvss.applyComponentString('AR', 'H');
          break;
        case 'mission_critical':
          cvss.applyComponentString('AR', 'H');
          cvss.applyComponentString('MSA', 'H');
          break;
        case 'unspecified':
          this.logger.warn(
            '[CVSS] businessCriticality=unspecified, keeping env default for AR',
          );
          break;
      }

      // Boost signals — applied after base requirements so they can upgrade earlier values
      // handlesPii: CR:H + MSC:H
      if (context.handlesPii) {
        cvss.applyComponentString('CR', 'H');
        cvss.applyComponentString('MSC', 'H');
      }

      // handlesPaymentData: CR:H + IR:H + MSC:H + MSI:H
      if (context.handlesPaymentData) {
        cvss.applyComponentString('CR', 'H');
        cvss.applyComponentString('IR', 'H');
        cvss.applyComponentString('MSC', 'H');
        cvss.applyComponentString('MSI', 'H');
      }

      // safetyCritical: IR:H + AR:H + MSI:H + MSA:H
      if (context.safetyCritical) {
        cvss.applyComponentString('IR', 'H');
        cvss.applyComponentString('AR', 'H');
        cvss.applyComponentString('MSI', 'H');
        cvss.applyComponentString('MSA', 'H');
      }

      const envScores = cvss.calculateScores(true);

      return {
        fullVector: cvss.toString(),
        baseScore,
        environmentalScore: envScores.overall,
      };
    } catch (error) {
      this.logger.warn(
        `[CVSS] applyEnvironmentalMetrics failed to parse vector='${cvss4BaseVector}': ${(error as Error)?.message}. Returning null.`,
      );
      return null;
    }
  }

  severityToDefaultVector(severity: string): string | null {
    return SEVERITY_VECTORS[severity.toLowerCase()] ?? null;
  }

  /**
   * True when `vector` is the default vector of `severity`, current or
   * former: the finding had no CVSS of its own and its vector only stands for
   * its label.
   */
  isSeverityDefaultVector(
    vector: string | null | undefined,
    severity: string | null | undefined,
  ): boolean {
    if (!vector) return false;
    if (Object.values(SEVERITY_VECTORS).includes(vector)) return true;
    const label = severity?.toLowerCase();
    return !!label && FORMER_SEVERITY_VECTORS[label] === vector;
  }

  convertCvss3ToCvss4BaseVector(cvss3Vector: string): string | null {
    try {
      const cvss3 = new Cvss3P1(cvss3Vector);
      const schema = cvss3.createJsonSchema();

      const av = CVSS3_AV_MAP[schema.attackVector] ?? 'N';
      const ac = CVSS3_AC_MAP[schema.attackComplexity] ?? 'L';
      const pr = CVSS3_PR_MAP[schema.privilegesRequired] ?? 'N';
      const ui = CVSS3_UI_MAP[schema.userInteraction] ?? 'N';

      const vc = CVSS3_CIA_MAP[schema.confidentialityImpact] ?? 'N';
      const vi = CVSS3_CIA_MAP[schema.integrityImpact] ?? 'N';
      const va = CVSS3_CIA_MAP[schema.availabilityImpact] ?? 'N';

      // Scope handling: S:C means subsequent system gets the CIA values; S:U means SC/SI/SA = N
      let sc = 'N';
      let si = 'N';
      let sa = 'N';
      if (schema.scope === 'CHANGED') {
        sc = vc;
        si = vi;
        sa = va;
      }

      // AT has no CVSS 3 equivalent, always N
      return `CVSS:4.0/AV:${av}/AC:${ac}/AT:N/PR:${pr}/UI:${ui}/VC:${vc}/VI:${vi}/VA:${va}/SC:${sc}/SI:${si}/SA:${sa}`;
    } catch (error) {
      this.logger.warn(
        `[CVSS] convertCvss3ToCvss4BaseVector failed to parse vector='${cvss3Vector}': ${(error as Error)?.message}. Returning null.`,
      );
      return null;
    }
  }

  /**
   * Reads the CVSS 3.1 Exploit Code Maturity off a vector and returns its
   * CVSS 4.0 Threat equivalent, or null when the vector defines none.
   *
   * Parsed off the string rather than through the library: `Cvss3P1` does read
   * `E` (its temporal score reflects it) but `createJsonSchema()` omits the
   * field, so there is no accessor to go through.
   */
  extractCvss4ThreatMetric(cvss3Vector: string): string | null {
    const match = /\/E:([XUPFH])(?:\/|$)/.exec(cvss3Vector);
    if (!match) return null;
    return CVSS3_E_MAP[match[1]] ?? null;
  }

  computeCvss4Base(input: {
    cvss4Vector?: string | null;
    cvss3Vector?: string | null;
    severity: string;
  }): Cvss4BaseResult | null {
    let cvss4Vector: string | null = null;
    let source: Cvss4BaseSource = 'cvss4';

    // Priority 1: Use direct CVSS4 vector
    if (input.cvss4Vector) {
      cvss4Vector = input.cvss4Vector;
    }

    // Priority 2: Convert from CVSS3
    if (!cvss4Vector && input.cvss3Vector) {
      source = 'cvss3';
      cvss4Vector = this.convertCvss3ToCvss4BaseVector(input.cvss3Vector);
      // Carry the Threat layer across. Without it a rule explicitly scored
      // `E:U` ("no known exploit") produced the exact same number as one under
      // active attack, because the whole Temporal group was dropped on
      // conversion. The base conversion above stays base-only on purpose; the
      // threat component is appended here, so the emitted vector is CVSS-BT
      // whenever the source rule defined a maturity.
      if (cvss4Vector) {
        const threatMetric = this.extractCvss4ThreatMetric(input.cvss3Vector);
        if (threatMetric) {
          cvss4Vector = `${cvss4Vector}/E:${threatMetric}`;
        }
      }
    }

    // Priority 3: Fall back to severity default
    if (!cvss4Vector) {
      source = 'severity';
      cvss4Vector = this.severityToDefaultVector(input.severity);
    }

    if (!cvss4Vector) {
      return null;
    }

    try {
      const calc = new Cvss4P0(cvss4Vector);
      const baseScore = calc.calculateScores(true).overall;
      return { vector: cvss4Vector, baseScore, source };
    } catch (error) {
      this.logger.warn(
        `[CVSS] computeCvss4Base failed to parse vector='${cvss4Vector}': ${(error as Error)?.message}. Returning null.`,
      );
      return null;
    }
  }
}
