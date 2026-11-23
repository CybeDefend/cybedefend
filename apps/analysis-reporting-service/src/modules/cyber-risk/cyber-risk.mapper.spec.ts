import {
  buildByScanType,
  buildTopContributors,
  buildBreakdown,
  persistedCyberRiskToProto,
  type ScoredVuln,
} from './cyber-risk.mapper';

const critical10: ScoredVuln = {
  id: 'c1',
  scanType: 'SAST',
  cvssEnvironmental: 10,
  cvss4: null,
  cvss3: null,
  severity: 'critical',
};

describe('buildByScanType', () => {
  it('groups by scan type, counts only exact severities and sums points (rounded)', () => {
    const vulns: ScoredVuln[] = [
      critical10, // SAST critical, 20 pts
      {
        id: 's1',
        scanType: 'SCA',
        cvssEnvironmental: 7,
        cvss4: null,
        cvss3: null,
        severity: 'high',
      }, // SCA high, 5 pts
      {
        id: 's2',
        scanType: 'SCA',
        cvssEnvironmental: null,
        cvss4: null,
        cvss3: null,
        severity: 'low',
      }, // SCA low fallback, 1 pt
    ];

    const byScanType = buildByScanType(vulns);

    expect(byScanType.SAST).toEqual({
      critical: 1,
      high: 0,
      medium: 0,
      low: 0,
      weightedScore: 20,
      avgReachabilityFactor: 0,
    });
    expect(byScanType.SCA).toEqual({
      critical: 0,
      high: 1,
      medium: 0,
      low: 1,
      weightedScore: 6,
      avgReachabilityFactor: 0,
    });
  });
});

describe('buildTopContributors', () => {
  it('contributes 20 for a cvss10 critical vuln', () => {
    const [top] = buildTopContributors([critical10]);
    expect(top).toEqual({
      vulnerabilityId: 'c1',
      scanType: 'SAST',
      severity: 'critical',
      reachability: '',
      exploitabilityVerdict: '',
      contribution: 20,
    });
  });

  it('sorts by descending contribution, drops zero-point vulns and caps at 5', () => {
    const vulns: ScoredVuln[] = Array.from({ length: 7 }, (_, i) => ({
      id: `v${i}`,
      scanType: 'SAST',
      cvssEnvironmental: i + 1, // 1..7 -> ascending points
      cvss4: null,
      cvss3: null,
      severity: 'medium',
    }));
    // A none/0-point vuln that must be filtered out.
    vulns.push({
      id: 'zero',
      scanType: 'SECRET',
      cvssEnvironmental: 0,
      cvss4: null,
      cvss3: null,
      severity: 'none',
    });

    const top = buildTopContributors(vulns);

    expect(top).toHaveLength(5);
    expect(top.map((t) => t.vulnerabilityId)).not.toContain('zero');
    // Highest cvss first.
    expect(top[0].vulnerabilityId).toBe('v6');
    for (let i = 1; i < top.length; i++) {
      expect(top[i - 1].contribution).toBeGreaterThanOrEqual(
        top[i].contribution,
      );
    }
  });
});

describe('buildBreakdown', () => {
  it('uses the persisted score as base and neutral multipliers', () => {
    const breakdown = buildBreakdown(42, [critical10]);
    expect(breakdown.base).toBe(42);
    expect(breakdown.businessMultiplier).toBe(1);
    expect(breakdown.exposureMultiplier).toBe(1);
    expect(breakdown.byScanType.SAST.weightedScore).toBe(20);
    expect(breakdown.topContributors).toHaveLength(1);
  });
});

describe('persistedCyberRiskToProto', () => {
  it('attaches the breakdown when provided', () => {
    const computedAt = new Date('2026-05-29T00:00:00.000Z');
    const breakdown = buildBreakdown(42, [critical10]);
    const proto = persistedCyberRiskToProto(
      { score: 42, level: 'high', computedAt },
      breakdown,
    );
    expect(proto.score).toBe(42);
    expect(proto.breakdown).toBe(breakdown);
  });

  it('omits the breakdown when not provided', () => {
    const computedAt = new Date('2026-05-29T00:00:00.000Z');
    const proto = persistedCyberRiskToProto({
      score: 42,
      level: 'high',
      computedAt,
    });
    expect(proto.breakdown).toBeUndefined();
  });

  it('returns an empty 0/low score when the persisted row is null', () => {
    const proto = persistedCyberRiskToProto(null);
    expect(proto.score).toBe(0);
    expect(proto.level).toBe('low');
    expect(proto.breakdown).toBeUndefined();
    expect(typeof proto.computedAt).toBe('string');
  });
});
