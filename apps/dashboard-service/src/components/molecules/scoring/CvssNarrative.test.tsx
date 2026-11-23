import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import CvssNarrative from './CvssNarrative';
import type { CvssExplanation } from '@/server/interfaces/Vulnerability';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (!options) return key;
      const params = Object.entries(options)
        .map(([k, v]) => `${k}=${v}`)
        .join(' ');
      return `${key} ${params}`;
    },
  }),
}));

const fullExplanation: CvssExplanation = {
  base: {
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
  },
  environmental: {
    envScore: 8.7,
    baseScore: 9.3,
    scoreDelta: -0.6,
    direction: 'decreased',
    drivers: [
      { metricKey: 'CR', value: 'L', effect: 'decreases' },
      { metricKey: 'AR', value: 'L', effect: 'decreases' },
    ],
  },
};

describe('CvssNarrative', () => {
  it('renders nothing when explanation is null', () => {
    const { container } = render(<CvssNarrative explanation={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when both base and environmental are missing', () => {
    const { container } = render(
      <CvssNarrative explanation={{ base: null, environmental: null }} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders the base intro with score and severity label', () => {
    render(<CvssNarrative explanation={fullExplanation} />);
    const baseSentence = screen.getByTestId('cvss-narrative-base');
    expect(baseSentence.textContent).toContain('score=9.3');
    expect(baseSentence.textContent).toContain(
      'severityLabel=pages.issuePage.scoring.cvss.narrative.severity.critical',
    );
  });

  it('includes attacker, auth, action verb and impact i18n keys for critical network vector', () => {
    render(<CvssNarrative explanation={fullExplanation} />);
    const baseSentence = screen.getByTestId('cvss-narrative-base');
    expect(baseSentence.textContent).toContain(
      'pages.issuePage.scoring.cvss.narrative.attacker.network',
    );
    expect(baseSentence.textContent).toContain(
      'pages.issuePage.scoring.cvss.narrative.auth.none',
    );
    expect(baseSentence.textContent).toContain(
      'pages.issuePage.scoring.cvss.narrative.actionVerb',
    );
    expect(baseSentence.textContent).toContain(
      'pages.issuePage.scoring.cvss.narrative.impact.fullCia',
    );
  });

  it('appends the subsequent-impact suffix when hasSubsequentImpact is true', () => {
    const explanation: CvssExplanation = {
      base: { ...fullExplanation.base!, hasSubsequentImpact: true },
      environmental: null,
    };
    render(<CvssNarrative explanation={explanation} />);
    const baseSentence = screen.getByTestId('cvss-narrative-base');
    expect(baseSentence.textContent).toContain(
      'pages.issuePage.scoring.cvss.narrative.subsequent',
    );
  });

  it('renders environmental sentence with envScore and driver labels when direction is decreased', () => {
    render(<CvssNarrative explanation={fullExplanation} />);
    const envSentence = screen.getByTestId('cvss-narrative-env');
    expect(envSentence.textContent).toContain('envScore=8.7');
    expect(envSentence.textContent).toContain(
      'pages.issuePage.scoring.cvss.narrative.drivers.CR.L',
    );
    expect(envSentence.textContent).toContain(
      'pages.issuePage.scoring.cvss.narrative.drivers.AR.L',
    );
    expect(envSentence.textContent).toContain(
      'pages.issuePage.scoring.cvss.narrative.env.decreased',
    );
  });

  it('does not render the env sentence when direction is unchanged', () => {
    const explanation: CvssExplanation = {
      base: fullExplanation.base!,
      environmental: {
        envScore: 9.3,
        baseScore: 9.3,
        scoreDelta: 0,
        direction: 'unchanged',
        drivers: [],
      },
    };
    render(<CvssNarrative explanation={explanation} />);
    expect(screen.queryByTestId('cvss-narrative-env')).toBeNull();
  });

  it('renders the env sentence with "increased" key when direction is increased', () => {
    const explanation: CvssExplanation = {
      base: fullExplanation.base!,
      environmental: {
        envScore: 9.5,
        baseScore: 8.8,
        scoreDelta: 0.7,
        direction: 'increased',
        drivers: [{ metricKey: 'CR', value: 'H', effect: 'increases' }],
      },
    };
    render(<CvssNarrative explanation={explanation} />);
    const envSentence = screen.getByTestId('cvss-narrative-env');
    expect(envSentence.textContent).toContain(
      'pages.issuePage.scoring.cvss.narrative.env.increased',
    );
    expect(envSentence.textContent).toContain(
      'pages.issuePage.scoring.cvss.narrative.drivers.CR.H',
    );
  });

  it('chooses the right impact key for confidentiality-only impact', () => {
    const explanation: CvssExplanation = {
      base: {
        ...fullExplanation.base!,
        confidentialityImpact: 'high',
        integrityImpact: 'none',
        availabilityImpact: 'none',
      },
      environmental: null,
    };
    render(<CvssNarrative explanation={explanation} />);
    const baseSentence = screen.getByTestId('cvss-narrative-base');
    expect(baseSentence.textContent).toContain(
      'pages.issuePage.scoring.cvss.narrative.impact.c',
    );
  });

  it('chooses impact.none when no CIA impact', () => {
    const explanation: CvssExplanation = {
      base: {
        ...fullExplanation.base!,
        confidentialityImpact: 'none',
        integrityImpact: 'none',
        availabilityImpact: 'none',
      },
      environmental: null,
    };
    render(<CvssNarrative explanation={explanation} />);
    const baseSentence = screen.getByTestId('cvss-narrative-base');
    expect(baseSentence.textContent).toContain(
      'pages.issuePage.scoring.cvss.narrative.impact.none',
    );
  });

  it('renders only env sentence if base is null', () => {
    const explanation: CvssExplanation = {
      base: null,
      environmental: fullExplanation.environmental!,
    };
    render(<CvssNarrative explanation={explanation} />);
    expect(screen.queryByTestId('cvss-narrative-base')).toBeNull();
    expect(screen.getByTestId('cvss-narrative-env')).toBeInTheDocument();
  });
});
