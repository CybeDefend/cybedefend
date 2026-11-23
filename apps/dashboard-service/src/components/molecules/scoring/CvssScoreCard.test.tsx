import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import CvssScoreCard from './CvssScoreCard';
import type { SastVulnerabilityResult } from '@/server/interfaces/Vulnerability';
import { ShieldAlt } from '@/components/atoms/icon/icons';

vi.mock('@/utils/function/utils', () => ({
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));
const baseCvss3 = { baseScore: '7.5', vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N' };

const baseVuln: Partial<SastVulnerabilityResult> = {
  vulnerability: {
    id: 'v-1', cwe: [], name: 'XSS', shortDescription: 'xss', description: 'desc',
    howToPrevent: 'sanitize', owaspTop10: null, severity: 'HIGH', language: 'ts',
    cvss3: baseCvss3,
  } as any,
  cvss4Vector: 'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:N/VA:N/SC:N/SI:N/SA:N',
  cvss4BaseScore: 8.7,
  cvss4EnvironmentalScore: 9.1,
};

const withCvss4 = baseVuln as SastVulnerabilityResult;
const withCvss4BaseOnly = { ...baseVuln, cvss4EnvironmentalScore: null } as SastVulnerabilityResult;
const withCvss3Only = { ...baseVuln, cvss4Vector: null, cvss4BaseScore: null, cvss4EnvironmentalScore: null } as SastVulnerabilityResult;
const withNoCvss = {
  ...baseVuln,
  cvss4Vector: null,
  cvss4BaseScore: null,
  cvss4EnvironmentalScore: null,
  vulnerability: { ...baseVuln.vulnerability, cvss3: undefined },
} as SastVulnerabilityResult;

describe('CvssScoreCard', () => {
  it('shows CVSS 4.0 Score title when cvss4BaseScore is present', () => {
    render(<CvssScoreCard vulnerability={withCvss4} />);
    expect(screen.getByText(/CVSS 4\.0 Score/i)).toBeInTheDocument();
  });

  it('shows environmental score (9.1) when both are set', () => {
    render(<CvssScoreCard vulnerability={withCvss4} />);
    expect(screen.getByText('9.1')).toBeInTheDocument();
  });

  it('shows base score (8.7) when environmental is null', () => {
    render(<CvssScoreCard vulnerability={withCvss4BaseOnly} />);
    expect(screen.getByText('8.7')).toBeInTheDocument();
  });

  it('shows CVSS 3.1 Score title when cvss4 is absent', () => {
    render(<CvssScoreCard vulnerability={withCvss3Only} />);
    expect(screen.getByText(/CVSS 3\.1 Score/i)).toBeInTheDocument();
  });

  it('shows cvss3 baseScore (7.5) in fallback mode', () => {
    render(<CvssScoreCard vulnerability={withCvss3Only} />);
    expect(screen.getByText('7.5')).toBeInTheDocument();
  });

  it('renders nothing when neither cvss4 nor cvss3 data exists', () => {
    const { container } = render(<CvssScoreCard vulnerability={withNoCvss} />);
    expect(container.firstChild).toBeNull();
  });

  describe('severity colors based on score (FE-H2)', () => {
    // Severity bands mirror ScoringExploitabilityTab.getSeverityLabel:
    //   >= 9.0 critical → text-critical-risk
    //   >= 7.0 high     → text-high-risk
    //   >= 4.0 medium   → text-medium-risk
    //   <  4.0 low      → text-low-risk
    it('renders CVSS4 score 3.1 with low-risk color (not red)', () => {
      const lowCvss4 = {
        ...baseVuln,
        cvss4BaseScore: 3.1,
        cvss4EnvironmentalScore: 3.1,
      } as SastVulnerabilityResult;
      render(<CvssScoreCard vulnerability={lowCvss4} />);
      const scoreEl = screen.getByText('3.1');
      expect(scoreEl.className).toContain('text-low-risk');
      expect(scoreEl.className).not.toContain('text-red-600');
    });

    it('renders CVSS4 score 5.0 with medium-risk color', () => {
      const mediumCvss4 = {
        ...baseVuln,
        cvss4BaseScore: 5.0,
        cvss4EnvironmentalScore: 5.0,
      } as SastVulnerabilityResult;
      render(<CvssScoreCard vulnerability={mediumCvss4} />);
      const scoreEl = screen.getByText('5');
      expect(scoreEl.className).toContain('text-medium-risk');
      expect(scoreEl.className).not.toContain('text-red-600');
    });

    it('renders CVSS4 score 7.5 with high-risk color', () => {
      const highCvss4 = {
        ...baseVuln,
        cvss4BaseScore: 7.5,
        cvss4EnvironmentalScore: 7.5,
      } as SastVulnerabilityResult;
      render(<CvssScoreCard vulnerability={highCvss4} />);
      const scoreEl = screen.getByText('7.5');
      expect(scoreEl.className).toContain('text-high-risk');
      expect(scoreEl.className).not.toContain('text-red-600');
    });

    it('renders CVSS4 score 9.5 with critical-risk color', () => {
      const criticalCvss4 = {
        ...baseVuln,
        cvss4BaseScore: 9.5,
        cvss4EnvironmentalScore: 9.5,
      } as SastVulnerabilityResult;
      render(<CvssScoreCard vulnerability={criticalCvss4} />);
      const scoreEl = screen.getByText('9.5');
      expect(scoreEl.className).toContain('text-critical-risk');
      expect(scoreEl.className).not.toContain('text-red-600');
    });

    it('renders CVSS3 fallback score 3.1 with low-risk color (not red)', () => {
      const lowCvss3 = {
        ...baseVuln,
        cvss4Vector: null,
        cvss4BaseScore: null,
        cvss4EnvironmentalScore: null,
        vulnerability: {
          ...baseVuln.vulnerability,
          cvss3: { baseScore: '3.1', vector: 'CVSS:3.1/AV:N/AC:H' },
        },
      } as SastVulnerabilityResult;
      render(<CvssScoreCard vulnerability={lowCvss3} />);
      const scoreEl = screen.getByText('3.1');
      expect(scoreEl.className).toContain('text-low-risk');
      expect(scoreEl.className).not.toContain('text-red-600');
    });

    it('renders CVSS3 fallback score 8.5 with high-risk color', () => {
      const highCvss3 = {
        ...baseVuln,
        cvss4Vector: null,
        cvss4BaseScore: null,
        cvss4EnvironmentalScore: null,
        vulnerability: {
          ...baseVuln.vulnerability,
          cvss3: { baseScore: '8.5', vector: 'CVSS:3.1/AV:N/AC:L' },
        },
      } as SastVulnerabilityResult;
      render(<CvssScoreCard vulnerability={highCvss3} />);
      const scoreEl = screen.getByText('8.5');
      expect(scoreEl.className).toContain('text-high-risk');
      expect(scoreEl.className).not.toContain('text-red-600');
    });
  });
});
