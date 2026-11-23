import {
  DISPLAYABLE_SEVERITIES,
  effectiveSeveritySql,
} from './effective-severity-sql';

describe('effectiveSeveritySql', () => {
  const sql = effectiveSeveritySql('vd');

  it('derives the band from the LIVE CVSS4 scores, env preferred over base', () => {
    // The score driving the classification must be COALESCE(env, base) so the
    // expression mirrors resolveEffectiveSeverity (env wins, base is fallback).
    expect(sql).toContain(
      'COALESCE(vd.cvss4_environmental_score, vd.cvss4_base_score)',
    );
    // The order matters: environmental column appears before the base column.
    const envIdx = sql.indexOf('cvss4_environmental_score');
    const baseIdx = sql.indexOf('cvss4_base_score');
    expect(envIdx).toBeGreaterThanOrEqual(0);
    expect(envIdx).toBeLessThan(baseIdx);
  });

  it('uses the same band thresholds as deriveEffectiveSeverity', () => {
    expect(sql).toContain(">= 9.0 THEN 'critical'");
    expect(sql).toContain(">= 7.0 THEN 'high'");
    expect(sql).toContain(">= 4.0 THEN 'medium'");
    expect(sql).toContain("> 0.0 THEN 'low'");
    // A non-null score that is 0 or below classifies as 'none' (NOT null).
    expect(sql).toContain("ELSE 'none'");
  });

  it('falls back to the stored column/label only when BOTH scores are null', () => {
    expect(sql).toContain('IS NULL THEN LOWER(COALESCE(');
    expect(sql).toContain('vd.effective_severity');
    expect(sql).toContain('vd.currentSeverity');
  });

  // `COALESCE` skips NULL and NOTHING ELSE. A `currentSeverity` written as the
  // empty string is a non-null value, so it WINS the coalesce and the whole
  // expression evaluates to `''` — a band outside the vocabulary, which
  // DISPLAYABLE_SEVERITIES then hides from every list view, and which no
  // `severity=` filter can select (it is not 'none' either). The row becomes
  // unreachable rather than merely unlabelled.
  //
  // Measured on the local corpus: 21 SCA detections in exactly that state, and
  // the upstream OSV advisory knew their real band for all 21 — 8 of them HIGH.
  it('treats an empty stored label as ABSENT rather than as a severity', () => {
    expect(sql).toContain("NULLIF(vd.effective_severity, '')");
    expect(sql).toContain("NULLIF(vd.currentSeverity, '')");
    // The raw form is what let '' short-circuit the chain; it must be gone.
    expect(sql).not.toContain(
      'COALESCE(vd.effective_severity, vd.currentSeverity)',
    );
  });

  it('honours the provided alias', () => {
    const other = effectiveSeveritySql('sca');
    expect(other).toContain('sca.cvss4_environmental_score');
    expect(other).toContain('sca.effective_severity');
    expect(other).not.toContain('vd.');
  });

  it('wraps the CASE in parentheses so it composes inside IN()/UPPER()', () => {
    expect(sql.startsWith('(CASE')).toBe(true);
    expect(sql.trim().endsWith('END)')).toBe(true);
  });

  it('exposes the four displayable severity bands (no none/null) for list parity', () => {
    expect(DISPLAYABLE_SEVERITIES).toEqual([
      'critical',
      'high',
      'medium',
      'low',
    ]);
  });
});

describe('effectiveSeveritySql on PostgreSQL', () => {
  // A raw statement is not rewritten by the query builder: an unquoted
  // camelCase column folds to lower case on PostgreSQL.
  const sql = effectiveSeveritySql('vd', 'postgres');

  it('quotes every column, so a raw statement reads them as written', () => {
    expect(sql).toContain(
      'COALESCE("vd"."cvss4_environmental_score", "vd"."cvss4_base_score")',
    );
    // effective_severity is an enum on PostgreSQL: compared with '' as text.
    expect(sql).toContain(
      'NULLIF(CAST("vd"."effective_severity" AS text), \'\')',
    );
    expect(sql).toContain('NULLIF("vd"."currentSeverity", \'\')');
    expect(sql).not.toMatch(/(^|[^"])vd\./);
  });

  it("is today's text on MySQL", () => {
    expect(effectiveSeveritySql('vd', 'mysql')).toBe(
      effectiveSeveritySql('vd'),
    );
    expect(effectiveSeveritySql('vd', 'mysql')).toContain(
      "NULLIF(vd.currentSeverity, '')",
    );
  });
});
