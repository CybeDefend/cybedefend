import { Logger } from '@nestjs/common';
import { CvssCalculatorService } from './cvss-calculator.service';
import { deriveEffectiveSeverity } from './severity-from-cvss';

describe('CvssCalculatorService', () => {
  let service: CvssCalculatorService;

  beforeEach(() => {
    service = new CvssCalculatorService();
  });

  describe('observability on parse failures', () => {
    let warnSpy: jest.SpyInstance;

    beforeEach(() => {
      warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    });

    afterEach(() => {
      warnSpy.mockRestore();
    });

    it('should log a warning when applyEnvironmentalMetrics fails to parse the vector', () => {
      const ctx = {
        internetExposure: 'public',
        networkSegmentation: 'flat',
        environment: 'production',
        dataClassification: 'public',
        businessCriticality: 'low',
        handlesPii: false,
        handlesPaymentData: false,
        safetyCritical: false,
      };
      const invalidVector = 'CVSS:4.0/garbage';

      const result = service.applyEnvironmentalMetrics(invalidVector, ctx);

      expect(result).toBeNull();
      expect(warnSpy).toHaveBeenCalled();
      const loggedArgs = warnSpy.mock.calls.flat().join(' ');
      expect(loggedArgs).toContain('applyEnvironmentalMetrics');
      expect(loggedArgs).toContain(invalidVector);
    });

    it('should log a warning when convertCvss3ToCvss4BaseVector fails to parse the vector', () => {
      const invalid = 'invalid';

      const result = service.convertCvss3ToCvss4BaseVector(invalid);

      expect(result).toBeNull();
      expect(warnSpy).toHaveBeenCalled();
      const loggedArgs = warnSpy.mock.calls.flat().join(' ');
      expect(loggedArgs).toContain('convertCvss3ToCvss4BaseVector');
      expect(loggedArgs).toContain(invalid);
    });

    it('should log a warning when computeCvss4Base fails to parse the resolved vector', () => {
      const invalid = 'CVSS:4.0/invalid';

      const result = service.computeCvss4Base({
        cvss4Vector: invalid,
        severity: 'high',
      });

      expect(result).toBeNull();
      expect(warnSpy).toHaveBeenCalled();
      const loggedArgs = warnSpy.mock.calls.flat().join(' ');
      expect(loggedArgs).toContain('computeCvss4Base');
      expect(loggedArgs).toContain(invalid);
    });
  });

  describe('applyEnvironmentalMetrics', () => {
    const baseVector =
      'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N';

    it('should return base and environmental scores for a valid CVSS 4.0 vector', () => {
      const context = {
        internetExposure: 'public',
        networkSegmentation: 'flat',
        environment: 'production',
        dataClassification: 'confidential',
        businessCriticality: 'high',
        handlesPii: false,
        handlesPaymentData: false,
        safetyCritical: false,
      };
      const result = service.applyEnvironmentalMetrics(baseVector, context);
      expect(result).toHaveProperty('fullVector');
      expect(result).toHaveProperty('baseScore');
      expect(result).toHaveProperty('environmentalScore');
      expect(result.baseScore).toBeGreaterThanOrEqual(0);
      expect(result.baseScore).toBeLessThanOrEqual(10);
      expect(result.environmentalScore).toBeGreaterThanOrEqual(0);
      expect(result.environmentalScore).toBeLessThanOrEqual(10);
    });

    it('should lower environmental score for airgapped + microsegmented context', () => {
      const publicCtx = {
        internetExposure: 'public',
        networkSegmentation: 'flat',
        environment: 'production',
        dataClassification: 'public',
        businessCriticality: 'low',
        handlesPii: false,
        handlesPaymentData: false,
        safetyCritical: false,
      };
      const airgappedCtx = {
        internetExposure: 'airgapped',
        networkSegmentation: 'microsegmented',
        environment: 'development',
        dataClassification: 'public',
        businessCriticality: 'low',
        handlesPii: false,
        handlesPaymentData: false,
        safetyCritical: false,
      };
      const pub = service.applyEnvironmentalMetrics(baseVector, publicCtx);
      const air = service.applyEnvironmentalMetrics(baseVector, airgappedCtx);
      expect(air.environmentalScore).toBeLessThan(pub.environmentalScore);
    });

    it('should boost requirements when handlesPii is true', () => {
      const noPii = {
        internetExposure: 'public',
        networkSegmentation: 'flat',
        environment: 'production',
        dataClassification: 'internal',
        businessCriticality: 'medium',
        handlesPii: false,
        handlesPaymentData: false,
        safetyCritical: false,
      };
      const withPii = { ...noPii, handlesPii: true };
      const noPiiResult = service.applyEnvironmentalMetrics(baseVector, noPii);
      const piiResult = service.applyEnvironmentalMetrics(baseVector, withPii);
      expect(piiResult.environmentalScore).toBeGreaterThanOrEqual(
        noPiiResult.environmentalScore,
      );
    });

    it('should raise the environmental score when security context bumps CR/IR/AR, keeping network/exposure constant', () => {
      // Isolates the "security context" dimension (CR/IR/AR, driven by
      // dataClassification, businessCriticality, safetyCritical, handlesPii)
      // from the network dimension (MAV/MAT/MPR). Network-side inputs are
      // identical in both contexts so any delta in env score is attributable
      // to the requirements modifiers.
      //
      // Base is VC:H/VI:L/VA:N (not the saturated VC:H/VI:H/VA:H used in the
      // other tests): CVSS 4 macro-vector EQ3 bucketing on a fully-H vector
      // doesn't move between default-M and L, so a saturated base hides the
      // wiring. This unsaturated vector exposes the CR/AR sensitivity.
      const sensitiveBase =
        'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:L/VA:N/SC:N/SI:N/SA:N';

      const lowSecCtx = {
        internetExposure: 'public',
        networkSegmentation: 'flat',
        environment: 'production',
        dataClassification: 'public', // → CR:L
        businessCriticality: 'low', // → AR:L
        handlesPii: false,
        handlesPaymentData: false,
        safetyCritical: false, // IR stays default (M)
      };
      const highSecCtx = {
        ...lowSecCtx,
        dataClassification: 'regulated', // → CR:H
        businessCriticality: 'mission_critical', // → AR:H
        handlesPii: true, // reinforces CR:H
        safetyCritical: true, // → IR:H, AR:H
      };

      const low = service.applyEnvironmentalMetrics(sensitiveBase, lowSecCtx);
      const high = service.applyEnvironmentalMetrics(sensitiveBase, highSecCtx);

      expect(low).not.toBeNull();
      expect(high).not.toBeNull();

      // Base score is identical (same underlying vector).
      expect(high.baseScore).toBe(low.baseScore);
      // Env score must strictly increase when requirements go up; ≥0.5 guards
      // against silent no-ops if someone regresses the CR/IR/AR wiring.
      expect(high.environmentalScore).toBeGreaterThan(low.environmentalScore);
      expect(
        high.environmentalScore - low.environmentalScore,
      ).toBeGreaterThanOrEqual(0.5);

      // Requirements markers must appear in the produced vector — guards
      // against a regression that silently drops CR/IR/AR application.
      expect(low.fullVector).toContain('CR:L');
      expect(low.fullVector).toContain('AR:L');
      expect(high.fullVector).toContain('CR:H');
      expect(high.fullVector).toContain('IR:H');
      expect(high.fullVector).toContain('AR:H');
    });

    it('should raise env score above base when dataClassification=regulated via MSC:H boost', () => {
      // Saturated base with SC:N means MSC:H raises subsequent-confidentiality
      // impact, pushing env above base. This confirms the regulated context now
      // BOOSTS the env score instead of being a CR:H no-op.
      const base =
        'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N';
      const ctx = {
        internetExposure: 'public',
        networkSegmentation: 'flat',
        environment: 'production',
        dataClassification: 'regulated',
        businessCriticality: 'mission_critical',
        handlesPii: false,
        handlesPaymentData: false,
        safetyCritical: false,
      };
      const result = service.applyEnvironmentalMetrics(base, ctx);
      expect(result).not.toBeNull();
      expect(result.environmentalScore).toBeGreaterThan(result.baseScore);
      expect(result.fullVector).toContain('MSC:H');
      expect(result.fullVector).toContain('MSA:H');
    });

    it('should apply MSI:H and MSA:H when safetyCritical is true', () => {
      const base =
        'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N';
      const ctx = {
        internetExposure: 'public',
        networkSegmentation: 'flat',
        environment: 'production',
        dataClassification: 'internal',
        businessCriticality: 'medium',
        handlesPii: false,
        handlesPaymentData: false,
        safetyCritical: true,
      };
      const result = service.applyEnvironmentalMetrics(base, ctx);
      expect(result).not.toBeNull();
      expect(result.fullVector).toContain('MSI:H');
      expect(result.fullVector).toContain('MSA:H');
      expect(result.fullVector).toContain('IR:H');
      expect(result.fullVector).toContain('AR:H');
    });

    it('should apply MSC:H + MSI:H + IR:H + CR:H when handlesPaymentData is true', () => {
      const base =
        'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N';
      const ctx = {
        internetExposure: 'public',
        networkSegmentation: 'flat',
        environment: 'production',
        dataClassification: 'public',
        businessCriticality: 'low',
        handlesPii: false,
        handlesPaymentData: true,
        safetyCritical: false,
      };
      const result = service.applyEnvironmentalMetrics(base, ctx);
      expect(result).not.toBeNull();
      expect(result.fullVector).toContain('CR:H');
      expect(result.fullVector).toContain('IR:H');
      expect(result.fullVector).toContain('MSC:H');
      expect(result.fullVector).toContain('MSI:H');
    });

    it('should return null for an invalid vector', () => {
      const context = {
        internetExposure: 'public',
        networkSegmentation: 'flat',
        environment: 'production',
        dataClassification: 'public',
        businessCriticality: 'low',
        handlesPii: false,
        handlesPaymentData: false,
        safetyCritical: false,
      };
      const result = service.applyEnvironmentalMetrics(
        'invalid-vector',
        context,
      );
      expect(result).toBeNull();
    });

    describe('environment defaults for CR/IR/AR', () => {
      const plainBase =
        'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N';

      it("applies CR=H, IR=H, AR=H by default when environment='production' and no dataClassification/businessCriticality override", () => {
        const ctx = {
          internetExposure: 'public',
          networkSegmentation: 'flat',
          environment: 'production',
          dataClassification: 'unspecified',
          businessCriticality: 'unspecified',
          handlesPii: false,
          handlesPaymentData: false,
          safetyCritical: false,
        };
        const result = service.applyEnvironmentalMetrics(plainBase, ctx);
        expect(result).not.toBeNull();
        expect(result.fullVector).toContain('CR:H');
        expect(result.fullVector).toContain('IR:H');
        expect(result.fullVector).toContain('AR:H');
      });

      it("applies CR=M, IR=M, AR=M by default when environment='staging' and no dataClassification/businessCriticality override", () => {
        const ctx = {
          internetExposure: 'public',
          networkSegmentation: 'flat',
          environment: 'staging',
          dataClassification: 'unspecified',
          businessCriticality: 'unspecified',
          handlesPii: false,
          handlesPaymentData: false,
          safetyCritical: false,
        };
        const result = service.applyEnvironmentalMetrics(plainBase, ctx);
        expect(result).not.toBeNull();
        expect(result.fullVector).toContain('CR:M');
        expect(result.fullVector).toContain('IR:M');
        expect(result.fullVector).toContain('AR:M');
      });

      it("does not apply any CR/IR/AR default when environment='unspecified'", () => {
        const ctx = {
          internetExposure: 'public',
          networkSegmentation: 'flat',
          environment: 'unspecified',
          dataClassification: 'unspecified',
          businessCriticality: 'unspecified',
          handlesPii: false,
          handlesPaymentData: false,
          safetyCritical: false,
        };
        const result = service.applyEnvironmentalMetrics(plainBase, ctx);
        expect(result).not.toBeNull();
        // CR/IR/AR must not be explicitly set in the vector (no env default applied)
        expect(result.fullVector).not.toMatch(/\/CR:[HML]/);
        expect(result.fullVector).not.toMatch(/\/IR:[HML]/);
        expect(result.fullVector).not.toMatch(/\/AR:[HML]/);
      });

      it("logs a warn when environment='unspecified'", () => {
        const warnSpy = jest
          .spyOn(Logger.prototype, 'warn')
          .mockImplementation();
        const ctx = {
          internetExposure: 'public',
          networkSegmentation: 'flat',
          environment: 'unspecified',
          dataClassification: 'confidential',
          businessCriticality: 'high',
          handlesPii: false,
          handlesPaymentData: false,
          safetyCritical: false,
        };
        service.applyEnvironmentalMetrics(plainBase, ctx);
        const loggedArgs = warnSpy.mock.calls.flat().join(' ');
        expect(loggedArgs).toContain('environment');
        expect(loggedArgs).toContain('unspecified');
        warnSpy.mockRestore();
      });

      it("logs a warn for each other 'unspecified' field (exposure, dataClassification, businessCriticality, networkSegmentation)", () => {
        const warnSpy = jest
          .spyOn(Logger.prototype, 'warn')
          .mockImplementation();
        const ctx = {
          internetExposure: 'unspecified',
          networkSegmentation: 'unspecified',
          environment: 'production',
          dataClassification: 'unspecified',
          businessCriticality: 'unspecified',
          handlesPii: false,
          handlesPaymentData: false,
          safetyCritical: false,
        };
        service.applyEnvironmentalMetrics(plainBase, ctx);
        const allLogged = warnSpy.mock.calls.flat().join(' | ');
        expect(allLogged).toContain('internetExposure');
        expect(allLogged).toContain('dataClassification');
        expect(allLogged).toContain('businessCriticality');
        expect(allLogged).toContain('networkSegmentation');
        warnSpy.mockRestore();
      });

      it("overrides the production AR default with businessCriticality='low' (AR=L wins over default H)", () => {
        const ctx = {
          internetExposure: 'public',
          networkSegmentation: 'flat',
          environment: 'production',
          dataClassification: 'unspecified',
          businessCriticality: 'low',
          handlesPii: false,
          handlesPaymentData: false,
          safetyCritical: false,
        };
        const result = service.applyEnvironmentalMetrics(plainBase, ctx);
        expect(result).not.toBeNull();
        // businessCriticality='low' takes precedence over environment='production' default H
        expect(result.fullVector).toContain('AR:L');
        expect(result.fullVector).not.toContain('AR:H');
      });

      it("overrides the production CR default with dataClassification='public' (CR=L wins over default H)", () => {
        const ctx = {
          internetExposure: 'public',
          networkSegmentation: 'flat',
          environment: 'production',
          dataClassification: 'public',
          businessCriticality: 'unspecified',
          handlesPii: false,
          handlesPaymentData: false,
          safetyCritical: false,
        };
        const result = service.applyEnvironmentalMetrics(plainBase, ctx);
        expect(result).not.toBeNull();
        expect(result.fullVector).toContain('CR:L');
        expect(result.fullVector).not.toContain('CR:H');
      });

      it("keeps environment='development' behavior (MPR=H)", () => {
        const ctx = {
          internetExposure: 'public',
          networkSegmentation: 'flat',
          environment: 'development',
          dataClassification: 'unspecified',
          businessCriticality: 'unspecified',
          handlesPii: false,
          handlesPaymentData: false,
          safetyCritical: false,
        };
        const result = service.applyEnvironmentalMetrics(plainBase, ctx);
        expect(result).not.toBeNull();
        expect(result.fullVector).toContain('MPR:H');
      });
    });
  });

  describe('severityToDefaultVector', () => {
    it('should return a valid CVSS 4.0 vector for each severity level', () => {
      for (const severity of ['critical', 'high', 'medium', 'low']) {
        const vector = service.severityToDefaultVector(severity);
        expect(vector).toMatch(/^CVSS:4\.0\//);
      }
    });

    it('should return null for unknown severity', () => {
      expect(service.severityToDefaultVector('unknown')).toBeNull();
    });

    // A finding with no CVSS of its own is scored from its label. The score
    // of that default vector must fall in the CVSS 4.0 band of the same
    // label, or the severity the tool gave changes on the way in.
    it.each([
      ['critical', 'critical'],
      ['high', 'high'],
      ['medium', 'medium'],
      ['low', 'low'],
      ['HIGH', 'high'],
    ])('scores the %s default vector inside the %s band', (severity, band) => {
      const result = service.computeCvss4Base({ severity });
      expect(deriveEffectiveSeverity(result.baseScore, result.baseScore)).toBe(
        band,
      );
    });
  });

  describe('isSeverityDefaultVector', () => {
    it.each(['critical', 'high', 'medium', 'low'])(
      'recognises the current %s default vector',
      (severity) => {
        expect(
          service.isSeverityDefaultVector(
            service.severityToDefaultVector(severity),
            severity,
          ),
        ).toBe(true);
      },
    );

    // Rows scored before the default vectors were corrected still carry the
    // former ones; they are recognised only with the label that produced them,
    // since a converted CVSS 3.1 vector can be the same string.
    it.each([
      [
        'high',
        'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:L/SC:N/SI:N/SA:N',
      ],
      [
        'low',
        'CVSS:4.0/AV:L/AC:L/AT:N/PR:L/UI:N/VC:L/VI:N/VA:N/SC:N/SI:N/SA:N',
      ],
    ])('recognises the former %s default vector', (severity, vector) => {
      expect(service.isSeverityDefaultVector(vector, severity)).toBe(true);
      expect(
        service.isSeverityDefaultVector(vector, severity.toUpperCase()),
      ).toBe(true);
    });

    it('does not take a former default vector under another label for a default', () => {
      expect(
        service.isSeverityDefaultVector(
          'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:L/SC:N/SI:N/SA:N',
          'critical',
        ),
      ).toBe(false);
    });

    // The former default vectors are also what real CVSS 3.1 vectors convert
    // to, so the label is what tells them apart: a converted vector under
    // another label is a score of the finding's own and must not be replaced.
    it.each([
      ['critical', 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H', 'high'],
      ['high', 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:L', 'critical'],
    ])(
      'keeps a converted CVSS 3.1 vector equal to the former %s default when the label differs',
      (former, cvss3Vector, label) => {
        const converted = service.computeCvss4Base({
          cvss3Vector,
          severity: label,
        });
        expect(service.isSeverityDefaultVector(converted.vector, former)).toBe(
          true,
        );
        expect(service.isSeverityDefaultVector(converted.vector, label)).toBe(
          false,
        );
      },
    );

    it('does not take a vector converted from CVSS 3.1 for a default', () => {
      const converted = service.computeCvss4Base({
        cvss3Vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
        severity: 'critical',
      });
      expect(
        service.isSeverityDefaultVector(converted.vector, 'critical'),
      ).toBe(false);
      expect(service.isSeverityDefaultVector(null, 'high')).toBe(false);
      expect(service.isSeverityDefaultVector(undefined, undefined)).toBe(false);
    });
  });

  describe('convertCvss3ToCvss4BaseVector', () => {
    it('should convert a CVSS 3.1 vector to a CVSS 4.0 base vector', () => {
      const cvss3 = 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H';
      const result = service.convertCvss3ToCvss4BaseVector(cvss3);
      expect(result).toMatch(/^CVSS:4\.0\//);
      expect(result).toContain('AV:N');
    });

    it('should return null for an invalid CVSS 3 vector', () => {
      expect(service.convertCvss3ToCvss4BaseVector('invalid')).toBeNull();
    });
  });

  describe('computeCvss4Base', () => {
    it('should convert CVSS3 vector to CVSS4 and return base score', () => {
      const result = service.computeCvss4Base({
        cvss3Vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
        severity: 'critical',
      });
      expect(result).not.toBeNull();
      expect(result.vector).toMatch(/^CVSS:4\.0\//);
      expect(result.baseScore).toBeGreaterThan(0);
      expect(result.baseScore).toBeLessThanOrEqual(10);
    });

    it('should use direct CVSS4 vector when provided', () => {
      const directVector =
        'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N';
      const result = service.computeCvss4Base({
        cvss4Vector: directVector,
        severity: 'critical',
      });
      expect(result).not.toBeNull();
      expect(result.vector).toBe(directVector);
      expect(result.baseScore).toBeGreaterThan(0);
    });

    it('should prefer CVSS4 vector over CVSS3 vector', () => {
      const directVector =
        'CVSS:4.0/AV:L/AC:L/AT:N/PR:L/UI:N/VC:L/VI:N/VA:N/SC:N/SI:N/SA:N';
      const result = service.computeCvss4Base({
        cvss4Vector: directVector,
        cvss3Vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
        severity: 'low',
      });
      expect(result.vector).toBe(directVector);
    });

    it('should fall back to severity default when CVSS3 conversion fails', () => {
      const result = service.computeCvss4Base({
        cvss3Vector: 'invalid-vector',
        severity: 'high',
      });
      expect(result).not.toBeNull();
      expect(result.vector).toMatch(/^CVSS:4\.0\//);
      expect(result.baseScore).toBeGreaterThan(0);
    });

    it('should fall back to severity default when no vectors provided', () => {
      const result = service.computeCvss4Base({ severity: 'medium' });
      expect(result).not.toBeNull();
      expect(result.vector).toMatch(/^CVSS:4\.0\//);
    });

    it('should return null for unknown severity and no vectors', () => {
      const result = service.computeCvss4Base({ severity: 'unknown' });
      expect(result).toBeNull();
    });

    it('says where the vector came from', () => {
      expect(
        service.computeCvss4Base({
          cvss4Vector:
            'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N',
          severity: 'high',
        }).source,
      ).toBe('cvss4');
      expect(
        service.computeCvss4Base({
          cvss3Vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
          severity: 'high',
        }).source,
      ).toBe('cvss3');
      expect(
        service.computeCvss4Base({
          cvss3Vector: 'invalid-vector',
          severity: 'high',
        }).source,
      ).toBe('severity');
      expect(service.computeCvss4Base({ severity: 'low' }).source).toBe(
        'severity',
      );
    });
  });

  // A CVSS 3.1 vector may carry the Temporal group (E / RL / RC). Only `E`
  // survives into CVSS 4.0, as the Threat metric Exploit Maturity — `RL`
  // (Remediation Level) and `RC` (Report Confidence) were removed from the
  // spec outright and have no 4.0 equivalent, so dropping them is correct.
  // Before this, `E` was dropped too: a rule explicitly scored "no known
  // exploit" landed on the exact same score as one under active attack.
  describe('CVSS 3.1 temporal -> CVSS 4.0 threat (Exploit Maturity)', () => {
    const BASE_3_1 = 'CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:H/A:N';

    it('should carry E:U into the CVSS 4.0 vector and lower the score out of the critical band', () => {
      const withoutTemporal = service.computeCvss4Base({
        cvss3Vector: BASE_3_1,
        severity: 'high',
      });
      const withTemporal = service.computeCvss4Base({
        cvss3Vector: `${BASE_3_1}/E:U/RL:O/RC:C`,
        severity: 'high',
      });

      expect(withoutTemporal.baseScore).toBe(9.1);
      expect(withTemporal.vector).toContain('/E:U');
      expect(withTemporal.baseScore).toBe(6.9);
    });

    it.each([
      ['U', 'U'], // Unproven -> Unreported
      ['P', 'P'], // Proof-of-Concept -> POC
      ['F', 'A'], // Functional -> Attacked
      ['H', 'A'], // High -> Attacked
    ])('should map CVSS 3.1 E:%s to CVSS 4.0 E:%s', (cvss3E, cvss4E) => {
      const result = service.computeCvss4Base({
        cvss3Vector: `${BASE_3_1}/E:${cvss3E}`,
        severity: 'high',
      });
      expect(result.vector.endsWith(`/E:${cvss4E}`)).toBe(true);
    });

    it('should not emit an E component when the 3.1 vector carries E:X or no temporal group', () => {
      for (const cvss3 of [BASE_3_1, `${BASE_3_1}/E:X/RL:O/RC:C`]) {
        const result = service.computeCvss4Base({
          cvss3Vector: cvss3,
          severity: 'high',
        });
        expect(result.vector).not.toContain('/E:');
      }
    });

    it('should never emit RL or RC, which do not exist in CVSS 4.0', () => {
      const result = service.computeCvss4Base({
        cvss3Vector: `${BASE_3_1}/E:U/RL:O/RC:C`,
        severity: 'high',
      });
      expect(result.vector).not.toContain('RL:');
      expect(result.vector).not.toContain('RC:');
    });

    it('should keep convertCvss3ToCvss4BaseVector base-only, so the base layer stays a true base vector', () => {
      const result = service.convertCvss3ToCvss4BaseVector(
        `${BASE_3_1}/E:U/RL:O/RC:C`,
      );
      expect(result).not.toContain('/E:');
    });

    it('should leave a directly supplied CVSS 4.0 vector untouched', () => {
      const direct =
        'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N/E:P';
      const result = service.computeCvss4Base({
        cvss4Vector: direct,
        cvss3Vector: `${BASE_3_1}/E:U`,
        severity: 'critical',
      });
      expect(result.vector).toBe(direct);
    });

    it('should preserve the threat metric through the environmental recalculation', () => {
      const ctx = {
        internetExposure: 'public',
        networkSegmentation: 'flat',
        environment: 'production',
        dataClassification: 'confidential',
        businessCriticality: 'high',
        handlesPii: true,
        handlesPaymentData: false,
        safetyCritical: false,
      };
      const { vector } = service.computeCvss4Base({
        cvss3Vector: `${BASE_3_1}/E:U`,
        severity: 'high',
      });

      const env = service.applyEnvironmentalMetrics(vector, ctx);

      expect(env.fullVector).toContain('/E:U');
      expect(env.baseScore).toBe(6.9);
    });
  });
});
