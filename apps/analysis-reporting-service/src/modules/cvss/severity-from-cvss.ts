export type EffectiveSeverity = 'critical' | 'high' | 'medium' | 'low' | 'none';

export function deriveEffectiveSeverity(
  cvss4EnvScore: number | null | undefined,
  cvss4BaseScore: number | null | undefined,
): EffectiveSeverity | null {
  const score = cvss4EnvScore ?? cvss4BaseScore;
  if (score == null) return null;
  if (score >= 9.0) return 'critical';
  if (score >= 7.0) return 'high';
  if (score >= 4.0) return 'medium';
  if (score > 0.0) return 'low';
  return 'none';
}

export interface SeverityResolvable {
  cvss4EnvironmentalScore?: number | null;
  cvss4BaseScore?: number | null;
  effectiveSeverity?: string | null;
  currentSeverity?: string | null;
}

// Source of truth for severity display: recompute from CVSS4 scores live so
// the UI never shows a stale stored effectiveSeverity (e.g. 'medium' persisted
// when env was null, then the env score bumped to 7.2 but the stored value
// was not refreshed). Falls back to stored values only when scores are absent.
export function resolveEffectiveSeverity(
  entity: SeverityResolvable,
): string | null {
  const computed = deriveEffectiveSeverity(
    entity.cvss4EnvironmentalScore ?? null,
    entity.cvss4BaseScore ?? null,
  );
  if (computed != null) return computed;
  return entity.effectiveSeverity ?? entity.currentSeverity ?? null;
}
