export type CvssSeverity = 'critical' | 'high' | 'medium' | 'low' | 'none';

export type CvssAttackOrigin = 'network' | 'adjacent' | 'local' | 'physical';

export type CvssAttackComplexity = 'low' | 'high';

export type CvssAuthRequirement = 'none' | 'low' | 'high';

export type CvssUserInteraction = 'none' | 'passive' | 'active';

export type CvssImpactLevel = 'none' | 'low' | 'high';

export interface CvssBaseExplanation {
  severity: CvssSeverity;
  baseScore: number;
  attackOrigin: CvssAttackOrigin;
  attackComplexity: CvssAttackComplexity;
  authRequired: CvssAuthRequirement;
  userInteraction: CvssUserInteraction;
  confidentialityImpact: CvssImpactLevel;
  integrityImpact: CvssImpactLevel;
  availabilityImpact: CvssImpactLevel;
  hasSubsequentImpact: boolean;
}

export type CvssEnvDriverEffect = 'increases' | 'decreases' | 'neutral';

export interface CvssEnvDriverData {
  metricKey: string;
  value: string;
  baseKey?: string;
  baseValue?: string;
  effect: CvssEnvDriverEffect;
}

export type CvssEnvDirection = 'increased' | 'decreased' | 'unchanged';

export interface CvssEnvironmentalExplanation {
  envScore: number;
  baseScore: number;
  scoreDelta: number;
  direction: CvssEnvDirection;
  drivers: CvssEnvDriverData[];
}

export interface CvssExplanation {
  base: CvssBaseExplanation | null;
  environmental: CvssEnvironmentalExplanation | null;
}
