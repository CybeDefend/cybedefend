import {
  deriveEffectiveSeverity,
  resolveEffectiveSeverity,
} from './severity-from-cvss';

describe('deriveEffectiveSeverity', () => {
  it('returns null when both scores are null', () => {
    expect(deriveEffectiveSeverity(null, null)).toBeNull();
    expect(deriveEffectiveSeverity(undefined, undefined)).toBeNull();
  });

  it('classifies env score per FIRST CVSS 4.0 grid', () => {
    expect(deriveEffectiveSeverity(0.0, null)).toBe('none');
    expect(deriveEffectiveSeverity(0.1, null)).toBe('low');
    expect(deriveEffectiveSeverity(3.9, null)).toBe('low');
    expect(deriveEffectiveSeverity(4.0, null)).toBe('medium');
    expect(deriveEffectiveSeverity(6.9, null)).toBe('medium');
    expect(deriveEffectiveSeverity(7.0, null)).toBe('high');
    expect(deriveEffectiveSeverity(8.9, null)).toBe('high');
    expect(deriveEffectiveSeverity(9.0, null)).toBe('critical');
    expect(deriveEffectiveSeverity(10.0, null)).toBe('critical');
  });

  it('falls back to base score when env is null', () => {
    expect(deriveEffectiveSeverity(null, 9.4)).toBe('critical');
    expect(deriveEffectiveSeverity(null, 5.0)).toBe('medium');
  });

  it('prefers env over base when both provided', () => {
    expect(deriveEffectiveSeverity(9.4, 3.0)).toBe('critical');
    expect(deriveEffectiveSeverity(3.0, 9.4)).toBe('low');
  });
});

describe('resolveEffectiveSeverity', () => {
  it('recomputes from CVSS scores, ignoring a stale stored effectiveSeverity', () => {
    // Regression: IaC "Missing CPU Limits in Docker Compose"
    // env=7.2 (High) but stored effectiveSeverity='medium' (computed when env was null)
    // → must return 'high', otherwise the badge keeps showing MEDIUM.
    const entity = {
      cvss4EnvironmentalScore: 7.2,
      cvss4BaseScore: 6.7,
      effectiveSeverity: 'medium',
      currentSeverity: 'medium',
    };

    expect(resolveEffectiveSeverity(entity)).toBe('high');
  });

  it('upgrades to critical when env score crosses the 9.0 threshold', () => {
    const entity = {
      cvss4EnvironmentalScore: 9.5,
      cvss4BaseScore: 6.7,
      effectiveSeverity: 'medium',
      currentSeverity: 'medium',
    };

    expect(resolveEffectiveSeverity(entity)).toBe('critical');
  });

  it('uses base score when env is absent', () => {
    const entity = {
      cvss4EnvironmentalScore: null,
      cvss4BaseScore: 7.4,
      effectiveSeverity: 'medium',
      currentSeverity: 'medium',
    };

    expect(resolveEffectiveSeverity(entity)).toBe('high');
  });

  it('falls back to stored effectiveSeverity when no CVSS4 scores are present', () => {
    const entity = {
      cvss4EnvironmentalScore: null,
      cvss4BaseScore: null,
      effectiveSeverity: 'high',
      currentSeverity: 'medium',
    };

    expect(resolveEffectiveSeverity(entity)).toBe('high');
  });

  it('falls back to currentSeverity when no scores and no stored effectiveSeverity', () => {
    const entity = {
      cvss4EnvironmentalScore: null,
      cvss4BaseScore: null,
      effectiveSeverity: null,
      currentSeverity: 'low',
    };

    expect(resolveEffectiveSeverity(entity)).toBe('low');
  });

  it('treats undefined score fields like null', () => {
    const entity = {
      effectiveSeverity: 'high',
      currentSeverity: 'medium',
    };

    expect(resolveEffectiveSeverity(entity)).toBe('high');
  });

  it('does not misclassify an env score of 0 as null (returns none)', () => {
    const entity = {
      cvss4EnvironmentalScore: 0,
      cvss4BaseScore: null,
      effectiveSeverity: 'high',
      currentSeverity: 'medium',
    };

    expect(resolveEffectiveSeverity(entity)).toBe('none');
  });
});
