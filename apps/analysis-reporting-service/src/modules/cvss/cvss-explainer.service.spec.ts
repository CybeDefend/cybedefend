import { CvssExplainerService } from './cvss-explainer.service';

describe('CvssExplainerService', () => {
  let service: CvssExplainerService;

  beforeEach(() => {
    service = new CvssExplainerService();
  });

  describe('explainBase', () => {
    it('returns null for null/undefined/empty vector', () => {
      expect(service.explainBase(null)).toBeNull();
      expect(service.explainBase(undefined)).toBeNull();
      expect(service.explainBase('')).toBeNull();
    });

    it('returns null for invalid vector (random string)', () => {
      expect(service.explainBase('foo')).toBeNull();
    });

    it('returns null for CVSS 3.1 vector (only 4.0 supported)', () => {
      expect(
        service.explainBase('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H'),
      ).toBeNull();
    });

    it('decodes a critical network vector with no auth', () => {
      const result = service.explainBase(
        'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N',
      );
      expect(result).toEqual({
        severity: 'critical',
        baseScore: 9.3,
        attackOrigin: 'network',
        attackComplexity: 'low',
        authRequired: 'none',
        userInteraction: 'none',
        confidentialityImpact: 'high',
        integrityImpact: 'high',
        availabilityImpact: 'high',
        hasSubsequentImpact: false,
      });
    });

    it('decodes a low physical vector requiring active interaction', () => {
      const result = service.explainBase(
        'CVSS:4.0/AV:P/AC:H/AT:N/PR:H/UI:A/VC:N/VI:L/VA:N/SC:N/SI:N/SA:N',
      );
      expect(result).not.toBeNull();
      expect(result!.attackOrigin).toBe('physical');
      expect(result!.attackComplexity).toBe('high');
      expect(result!.authRequired).toBe('high');
      expect(result!.userInteraction).toBe('active');
      expect(result!.confidentialityImpact).toBe('none');
      expect(result!.integrityImpact).toBe('low');
      expect(result!.availabilityImpact).toBe('none');
      expect(result!.severity).toBe('low');
    });

    it('flags hasSubsequentImpact when SC/SI/SA != N', () => {
      const result = service.explainBase(
        'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:H/SI:N/SA:N',
      );
      expect(result!.hasSubsequentImpact).toBe(true);
    });

    it('reports severity none when all impacts are N', () => {
      const result = service.explainBase(
        'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:N/VI:N/VA:N/SC:N/SI:N/SA:N',
      );
      expect(result!.severity).toBe('none');
      expect(result!.baseScore).toBe(0);
    });

    it('decodes adjacent network origin', () => {
      const result = service.explainBase(
        'CVSS:4.0/AV:A/AC:L/AT:N/PR:N/UI:N/VC:L/VI:L/VA:L/SC:N/SI:N/SA:N',
      );
      expect(result!.attackOrigin).toBe('adjacent');
    });

    it('decodes passive user interaction (UI:P)', () => {
      const result = service.explainBase(
        'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:P/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N',
      );
      expect(result!.userInteraction).toBe('passive');
    });

    it('decodes low auth required (PR:L)', () => {
      const result = service.explainBase(
        'CVSS:4.0/AV:N/AC:L/AT:N/PR:L/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N',
      );
      expect(result!.authRequired).toBe('low');
    });
  });

  describe('explainEnvironmental', () => {
    const baseVector =
      'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N';

    it('returns null when env vector is missing', () => {
      expect(
        service.explainEnvironmental(baseVector, null, 8.8, null),
      ).toBeNull();
      expect(
        service.explainEnvironmental(baseVector, undefined, 8.8, undefined),
      ).toBeNull();
    });

    it('reports unchanged when env equals base', () => {
      const result = service.explainEnvironmental(
        baseVector,
        baseVector,
        8.8,
        8.8,
      );
      expect(result).toEqual({
        envScore: 8.8,
        baseScore: 8.8,
        scoreDelta: 0,
        direction: 'unchanged',
        drivers: [],
      });
    });

    it('reports decreased when env score is below base score', () => {
      const envVector =
        'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N/CR:L/AR:L';
      const result = service.explainEnvironmental(
        baseVector,
        envVector,
        8.8,
        7.5,
      );
      expect(result!.direction).toBe('decreased');
      expect(result!.scoreDelta).toBeCloseTo(-1.3, 1);
      expect(result!.drivers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            metricKey: 'CR',
            value: 'L',
            effect: 'decreases',
          }),
          expect.objectContaining({
            metricKey: 'AR',
            value: 'L',
            effect: 'decreases',
          }),
        ]),
      );
    });

    it('marks CR/IR/AR:H as increases', () => {
      const envVector =
        'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N/CR:H/IR:H/AR:H';
      const result = service.explainEnvironmental(
        baseVector,
        envVector,
        8.8,
        9.5,
      );
      expect(result!.direction).toBe('increased');
      expect(result!.drivers.find((d) => d.metricKey === 'CR')!.effect).toBe(
        'increases',
      );
      expect(result!.drivers.find((d) => d.metricKey === 'IR')!.effect).toBe(
        'increases',
      );
      expect(result!.drivers.find((d) => d.metricKey === 'AR')!.effect).toBe(
        'increases',
      );
    });

    it('skips X (Not Defined) requirement values', () => {
      const envVector =
        'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N/CR:X/IR:X/AR:X';
      const result = service.explainEnvironmental(
        baseVector,
        envVector,
        8.8,
        8.8,
      );
      expect(result!.drivers).toEqual([]);
    });

    it('detects modified base metrics with baseKey/baseValue and changed status', () => {
      const localBase =
        'CVSS:4.0/AV:A/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N';
      const envVector =
        'CVSS:4.0/AV:A/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N/MAV:N';
      const result = service.explainEnvironmental(
        localBase,
        envVector,
        7.5,
        8.5,
      );
      const mav = result!.drivers.find((d) => d.metricKey === 'MAV');
      expect(mav).toEqual({
        metricKey: 'MAV',
        value: 'N',
        baseKey: 'AV',
        baseValue: 'A',
        effect: 'increases',
      });
    });

    it('marks MAC:H modifier as decreases (more complex = lower score)', () => {
      const envVector =
        'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N/MAC:H';
      const result = service.explainEnvironmental(
        baseVector,
        envVector,
        8.8,
        7.5,
      );
      const mac = result!.drivers.find((d) => d.metricKey === 'MAC');
      expect(mac!.effect).toBe('decreases');
    });

    it('falls back to score delta when drivers list is empty', () => {
      const envVector =
        'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N';
      const result = service.explainEnvironmental(
        baseVector,
        envVector,
        8.8,
        7.0,
      );
      expect(result!.direction).toBe('decreased');
      expect(result!.drivers).toEqual([]);
    });
  });

  describe('buildExplanationForEntity', () => {
    it('returns undefined when entity has no CVSS data', () => {
      expect(
        service.buildExplanationForEntity({
          cvss4Vector: null,
          cvss4EnvironmentalVector: null,
          cvss4BaseScore: null,
          cvss4EnvironmentalScore: null,
        }),
      ).toBeUndefined();
    });

    it('returns base only when only base vector is set', () => {
      const result = service.buildExplanationForEntity({
        cvss4Vector:
          'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N',
        cvss4BaseScore: 8.8,
      });
      expect(result).toBeDefined();
      expect(result!.base).toBeDefined();
      expect(result!.environmental).toBeUndefined();
    });

    it('returns both when both vectors present', () => {
      const result = service.buildExplanationForEntity({
        cvss4Vector:
          'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N',
        cvss4EnvironmentalVector:
          'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N/CR:L',
        cvss4BaseScore: 8.8,
        cvss4EnvironmentalScore: 8.0,
      });
      expect(result!.base).toBeDefined();
      expect(result!.environmental).toBeDefined();
      expect(result!.environmental!.direction).toBe('decreased');
    });
  });

  describe('explainCvss (combined)', () => {
    it('returns both null when no vectors provided', () => {
      expect(service.explainCvss(null, null, null, null)).toEqual({
        base: null,
        environmental: null,
      });
    });

    it('returns base only when env vector is missing', () => {
      const result = service.explainCvss(
        'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N',
        null,
        8.8,
        null,
      );
      expect(result.base).not.toBeNull();
      expect(result.environmental).toBeNull();
    });

    it('returns both when both vectors provided', () => {
      const baseVector =
        'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N';
      const envVector =
        'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N/CR:L';
      const result = service.explainCvss(baseVector, envVector, 8.8, 8.0);
      expect(result.base).not.toBeNull();
      expect(result.environmental).not.toBeNull();
      expect(result.environmental!.direction).toBe('decreased');
    });
  });
});
