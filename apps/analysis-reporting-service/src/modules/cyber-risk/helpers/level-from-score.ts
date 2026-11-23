/**
 * Pure function: maps a CybeRisk Score (potentially unbounded) to a
 * categorical level. Thresholds match the historical 0..100 buckets
 * but apply unchanged to the new infinite scale.
 */
import { CyberRiskLevel } from '../cyber-risk.constants';

export type { CyberRiskLevel };

export function levelFromScore(score: number): CyberRiskLevel {
  if (score >= 80) return 'critical';
  if (score >= 50) return 'high';
  if (score >= 20) return 'medium';
  // 'low' is the floor: every project — even score 0 or no vulnerabilities —
  // reads as at least low. 'none' is no longer a CybeRisk level.
  return 'low';
}
