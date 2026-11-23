import { pointsFromVuln } from './points-from-vuln';

describe('pointsFromVuln', () => {
  describe('CVSS — Critical band [9.0, 10.0]', () => {
    it('returns 20 at cvss=10.0', () => {
      expect(pointsFromVuln({ cvss4: 10.0 })).toBe(20);
    });
    it('returns 17.5 at cvss=9.5', () => {
      expect(pointsFromVuln({ cvss4: 9.5 })).toBe(17.5);
    });
    it('returns 15 at cvss=9.0', () => {
      expect(pointsFromVuln({ cvss4: 9.0 })).toBe(15);
    });
  });

  describe('CVSS — High band [7.0, 9.0)', () => {
    it('returns 10 at cvss=8.9 (anchor)', () => {
      expect(pointsFromVuln({ cvss4: 8.9 })).toBeCloseTo(10, 5);
    });
    it('returns ≈7.63 at cvss=8.0', () => {
      expect(pointsFromVuln({ cvss4: 8.0 })).toBeCloseTo(7.6315789, 5);
    });
    it('returns 5 at cvss=7.0', () => {
      expect(pointsFromVuln({ cvss4: 7.0 })).toBe(5);
    });
  });

  describe('CVSS — Medium band [4.0, 7.0)', () => {
    it('returns 4 at cvss=6.9 (anchor)', () => {
      expect(pointsFromVuln({ cvss4: 6.9 })).toBeCloseTo(4, 5);
    });
    it('returns ≈3.03 at cvss=5.5', () => {
      expect(pointsFromVuln({ cvss4: 5.5 })).toBeCloseTo(3.0344827, 5);
    });
    it('returns 2 at cvss=4.0', () => {
      expect(pointsFromVuln({ cvss4: 4.0 })).toBe(2);
    });
  });

  describe('CVSS — Low band [0.1, 4.0)', () => {
    it('returns 1 at cvss=2.5', () => {
      expect(pointsFromVuln({ cvss4: 2.5 })).toBe(1);
    });
    it('returns 1 at cvss=0.1', () => {
      expect(pointsFromVuln({ cvss4: 0.1 })).toBe(1);
    });
    it('returns 1 just below 4.0', () => {
      expect(pointsFromVuln({ cvss4: 3.9 })).toBe(1);
    });
  });

  describe('CVSS — None / absent', () => {
    it('returns 0 at cvss=0', () => {
      expect(pointsFromVuln({ cvss4: 0 })).toBe(0);
    });
    it('returns 0 when all cvss and severity are absent', () => {
      expect(pointsFromVuln({})).toBe(0);
    });
  });

  describe('source priority: env > v4 > v3 > severity', () => {
    it('uses cvssEnvironmental when present', () => {
      // env=9.0 → 15 ; cvss4=10 would give 20 ; severity high would give 7.5
      expect(
        pointsFromVuln({
          cvssEnvironmental: 9.0,
          cvss4: 10.0,
          cvss3: 8.0,
          severity: 'high',
        }),
      ).toBe(15);
    });
    it('falls back to cvss4 when env is null', () => {
      expect(
        pointsFromVuln({
          cvssEnvironmental: null,
          cvss4: 9.5,
          cvss3: 8.0,
          severity: 'low',
        }),
      ).toBe(17.5);
    });
    it('falls back to cvss3 when env and v4 are null', () => {
      expect(
        pointsFromVuln({
          cvssEnvironmental: null,
          cvss4: null,
          cvss3: 7.0,
          severity: 'low',
        }),
      ).toBe(5);
    });
    it('falls back to severity-midpoint when all CVSS sources are null', () => {
      expect(
        pointsFromVuln({
          cvssEnvironmental: null,
          cvss4: null,
          cvss3: null,
          severity: 'high',
        }),
      ).toBe(7.5);
    });
  });

  describe('severity fallback midpoints (no CVSS)', () => {
    it('critical → 17.5', () => {
      expect(pointsFromVuln({ severity: 'critical' })).toBe(17.5);
    });
    it('high → 7.5', () => {
      expect(pointsFromVuln({ severity: 'high' })).toBe(7.5);
    });
    it('medium → 3', () => {
      expect(pointsFromVuln({ severity: 'medium' })).toBe(3);
    });
    it('low → 1', () => {
      expect(pointsFromVuln({ severity: 'low' })).toBe(1);
    });
    it('none → 0', () => {
      expect(pointsFromVuln({ severity: 'none' })).toBe(0);
    });
    it('null severity → 0', () => {
      expect(pointsFromVuln({ severity: null })).toBe(0);
    });
  });

  describe('boundary protection', () => {
    it('rejects CVSS > 10 by clamping to 10', () => {
      expect(pointsFromVuln({ cvss4: 10.5 })).toBe(20);
    });
    it('treats negative CVSS as 0', () => {
      expect(pointsFromVuln({ cvss4: -1 })).toBe(0);
    });
  });
});
