import { Injectable } from '@nestjs/common';
import { Cvss4P0 } from 'ae-cvss-calculator';
import {
  CvssAttackComplexity,
  CvssAttackOrigin,
  CvssAuthRequirement,
  CvssBaseExplanation,
  CvssEnvDirection,
  CvssEnvDriverData,
  CvssEnvDriverEffect,
  CvssEnvironmentalExplanation,
  CvssExplanation,
  CvssImpactLevel,
  CvssSeverity,
  CvssUserInteraction,
} from './cvss-explanation.types';

const VECTOR_PREFIX = 'CVSS:4.0/';

const ATTACK_ORIGIN: Record<string, CvssAttackOrigin> = {
  N: 'network',
  A: 'adjacent',
  L: 'local',
  P: 'physical',
};

const ATTACK_COMPLEXITY: Record<string, CvssAttackComplexity> = {
  L: 'low',
  H: 'high',
};

const AUTH_REQUIREMENT: Record<string, CvssAuthRequirement> = {
  N: 'none',
  L: 'low',
  H: 'high',
};

const USER_INTERACTION: Record<string, CvssUserInteraction> = {
  N: 'none',
  P: 'passive',
  A: 'active',
};

const IMPACT_LEVEL: Record<string, CvssImpactLevel> = {
  N: 'none',
  L: 'low',
  H: 'high',
};

const REQUIREMENT_EFFECT: Record<string, CvssEnvDriverEffect> = {
  L: 'decreases',
  M: 'neutral',
  H: 'increases',
};

const MODIFIED_RANK: Record<string, Record<string, number>> = {
  MAV: { N: 4, A: 3, L: 2, P: 1 },
  MAC: { L: 2, H: 1 },
  MAT: { N: 2, P: 1 },
  MPR: { N: 3, L: 2, H: 1 },
  MUI: { N: 3, P: 2, A: 1 },
  MVC: { H: 3, L: 2, N: 1 },
  MVI: { H: 3, L: 2, N: 1 },
  MVA: { H: 3, L: 2, N: 1 },
  MSC: { H: 3, L: 2, N: 1 },
  MSI: { S: 4, H: 3, L: 2, N: 1 },
  MSA: { S: 4, H: 3, L: 2, N: 1 },
};

interface CvssEntityFields {
  cvss4Vector?: string | null;
  cvss4EnvironmentalVector?: string | null;
  cvss4BaseScore?: number | null;
  cvss4EnvironmentalScore?: number | null;
}

@Injectable()
export class CvssExplainerService {
  explainCvss(
    baseVector: string | null | undefined,
    envVector: string | null | undefined,
    baseScore: number | null | undefined,
    envScore: number | null | undefined,
  ): CvssExplanation {
    return {
      base: this.explainBase(baseVector, baseScore),
      environmental: this.explainEnvironmental(
        baseVector,
        envVector,
        baseScore,
        envScore,
      ),
    };
  }

  // Helper for gRPC mappers: returns the explanation in proto-friendly shape
  // (undefined instead of null for absent fields). Returns undefined when
  // both base and environmental are null so the proto field can be omitted.
  buildExplanationForEntity(entity: CvssEntityFields):
    | {
        base?: CvssBaseExplanation;
        environmental?: CvssEnvironmentalExplanation;
      }
    | undefined {
    const explanation = this.explainCvss(
      entity.cvss4Vector,
      entity.cvss4EnvironmentalVector,
      entity.cvss4BaseScore,
      entity.cvss4EnvironmentalScore,
    );
    if (!explanation.base && !explanation.environmental) return undefined;
    return {
      base: explanation.base ?? undefined,
      environmental: explanation.environmental ?? undefined,
    };
  }

  explainBase(
    vector: string | null | undefined,
    baseScore?: number | null,
  ): CvssBaseExplanation | null {
    const metrics = parseVector(vector);
    if (!metrics) return null;

    const score = this.resolveScore(vector, baseScore);
    if (score === null) return null;

    const sc = metrics.get('SC') ?? 'N';
    const si = metrics.get('SI') ?? 'N';
    const sa = metrics.get('SA') ?? 'N';

    return {
      severity: scoreToSeverity(score),
      baseScore: score,
      attackOrigin: ATTACK_ORIGIN[metrics.get('AV') ?? 'N'],
      attackComplexity: ATTACK_COMPLEXITY[metrics.get('AC') ?? 'L'],
      authRequired: AUTH_REQUIREMENT[metrics.get('PR') ?? 'N'],
      userInteraction: USER_INTERACTION[metrics.get('UI') ?? 'N'],
      confidentialityImpact: IMPACT_LEVEL[metrics.get('VC') ?? 'N'],
      integrityImpact: IMPACT_LEVEL[metrics.get('VI') ?? 'N'],
      availabilityImpact: IMPACT_LEVEL[metrics.get('VA') ?? 'N'],
      hasSubsequentImpact: sc !== 'N' || si !== 'N' || sa !== 'N',
    };
  }

  explainEnvironmental(
    baseVector: string | null | undefined,
    envVector: string | null | undefined,
    baseScore: number | null | undefined,
    envScore: number | null | undefined,
  ): CvssEnvironmentalExplanation | null {
    if (!envVector) return null;

    const baseMetrics = parseVector(baseVector);
    const envMetrics = parseVector(envVector);
    if (!envMetrics) return null;

    const resolvedBaseScore = this.resolveScore(baseVector, baseScore);
    const resolvedEnvScore = this.resolveScore(envVector, envScore);

    const finalBaseScore = resolvedBaseScore ?? 0;
    const finalEnvScore = resolvedEnvScore ?? finalBaseScore;
    const delta = round1(finalEnvScore - finalBaseScore);

    const drivers: CvssEnvDriverData[] = [];

    for (const key of ['CR', 'IR', 'AR']) {
      const value = envMetrics.get(key);
      if (!value || value === 'X') continue;
      const effect = REQUIREMENT_EFFECT[value] ?? 'neutral';
      drivers.push({ metricKey: key, value, effect });
    }

    for (const [key, value] of envMetrics.entries()) {
      if (!key.startsWith('M') || value === 'X') continue;
      const baseKey = key.slice(1);
      const baseValue = baseMetrics?.get(baseKey);
      drivers.push({
        metricKey: key,
        value,
        baseKey,
        baseValue,
        effect: modifierEffect(key, value, baseValue),
      });
    }

    const direction = computeDirection(delta, drivers);

    return {
      envScore: finalEnvScore,
      baseScore: finalBaseScore,
      scoreDelta: delta,
      direction,
      drivers,
    };
  }

  private resolveScore(
    vector: string | null | undefined,
    provided: number | null | undefined,
  ): number | null {
    if (provided !== null && provided !== undefined) return provided;
    if (!vector) return null;
    try {
      return new Cvss4P0(vector).calculateScores(true).overall;
    } catch {
      return null;
    }
  }
}

function parseVector(
  vector: string | null | undefined,
): Map<string, string> | null {
  if (!vector || typeof vector !== 'string') return null;
  if (!vector.startsWith(VECTOR_PREFIX)) return null;

  const map = new Map<string, string>();
  const parts = vector.slice(VECTOR_PREFIX.length).split('/');
  for (const part of parts) {
    const [key, value] = part.split(':');
    if (!key || !value) continue;
    if (!map.has(key)) map.set(key, value);
  }
  if (map.size === 0) return null;
  return map;
}

function scoreToSeverity(score: number): CvssSeverity {
  if (score <= 0) return 'none';
  if (score < 4) return 'low';
  if (score < 7) return 'medium';
  if (score < 9) return 'high';
  return 'critical';
}

function modifierEffect(
  key: string,
  envValue: string,
  baseValue: string | undefined,
): CvssEnvDriverEffect {
  const ranks = MODIFIED_RANK[key];
  if (!ranks) return 'neutral';
  const envRank = ranks[envValue];
  if (envRank === undefined) return 'neutral';
  if (baseValue === undefined) {
    return envRank === Math.max(...Object.values(ranks))
      ? 'increases'
      : envRank === Math.min(...Object.values(ranks))
        ? 'decreases'
        : 'neutral';
  }
  const baseRank = ranks[baseValue];
  if (baseRank === undefined) return 'neutral';
  if (envRank > baseRank) return 'increases';
  if (envRank < baseRank) return 'decreases';
  return 'neutral';
}

function computeDirection(
  delta: number,
  drivers: CvssEnvDriverData[],
): CvssEnvDirection {
  if (delta > 0.05) return 'increased';
  if (delta < -0.05) return 'decreased';
  if (drivers.length === 0) return 'unchanged';
  const hasIncrease = drivers.some((d) => d.effect === 'increases');
  const hasDecrease = drivers.some((d) => d.effect === 'decreases');
  if (hasIncrease && !hasDecrease) return 'increased';
  if (hasDecrease && !hasIncrease) return 'decreased';
  return 'unchanged';
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
