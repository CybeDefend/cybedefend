import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import PriorityDecompositionChart from './PriorityDecompositionChart';
import { PriorityDecomposition } from '@/server/interfaces/Vulnerability';

let currentLang: 'en' | 'fr' = 'en';
const setLang = (lang: 'en' | 'fr') => {
  currentLang = lang;
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const maps: Record<'en' | 'fr', Record<string, string>> = {
        en: {
          'pages.issuePage.scoring.decomposition.title': 'Why this priority?',
          'pages.issuePage.scoring.decomposition.cvssEnv': 'CVSS Env.',
          'pages.issuePage.scoring.decomposition.epss': 'EPSS',
          'pages.issuePage.scoring.decomposition.exploitability': 'Exploitability',
          'pages.issuePage.scoring.decomposition.context': 'Context',
          'pages.issuePage.scoring.decomposition.priority.criticalUrgent': 'Critical Urgent',
          'pages.issuePage.scoring.decomposition.priority.urgent': 'Urgent',
          'pages.issuePage.scoring.decomposition.priority.normal': 'Normal',
          'pages.issuePage.scoring.decomposition.priority.low': 'Low',
          'pages.issuePage.scoring.decomposition.priority.veryLow': 'Very Low',
        },
        fr: {
          'pages.issuePage.scoring.decomposition.title': 'Pourquoi cette priorité ?',
          'pages.issuePage.scoring.decomposition.cvssEnv': 'CVSS Env.',
          'pages.issuePage.scoring.decomposition.epss': 'EPSS',
          'pages.issuePage.scoring.decomposition.exploitability': 'Exploitabilité',
          'pages.issuePage.scoring.decomposition.context': 'Contexte',
          'pages.issuePage.scoring.decomposition.priority.criticalUrgent': 'Critique urgent',
          'pages.issuePage.scoring.decomposition.priority.urgent': 'Urgent',
          'pages.issuePage.scoring.decomposition.priority.normal': 'Normal',
          'pages.issuePage.scoring.decomposition.priority.low': 'Faible',
          'pages.issuePage.scoring.decomposition.priority.veryLow': 'Très faible',
        },
      };
      return maps[currentLang][key] || key;
    },
  }),
}));

const withEpss: PriorityDecomposition = {
  priority: 'urgent',
  compositeScore: 0.611,
  // cvss4: 0.35 * 0.88 = 0.308, epss: 0.25 * 0.87 = 0.2175, exploit: 0.25 * 0.88 = 0.22, context: 0.15 * 0.5 = 0.075
  cvss4Contribution: 0.308,
  epssContribution: 0.2175,
  exploitContribution: 0.22,
  contextContribution: 0.075,
  w1: 0.35,
  w2: 0.25,
  w3: 0.25,
  w4: 0.15,
  isManualOverride: false,
};

// Renormalized: w1≈0.4667, w3≈0.3333, w4=0.2 (sum = 1.0)
const withoutEpss: PriorityDecomposition = {
  priority: 'urgent',
  compositeScore: 0.626,
  cvss4Contribution: 0.4667 * 0.94, // ≈ 0.439
  epssContribution: 0,
  exploitContribution: 0.3333 * 0.89, // ≈ 0.297
  contextContribution: 0.2 * 0.5,     // = 0.1
  w1: 0.4667,
  w2: 0,
  w3: 0.3333,
  w4: 0.2,
  isManualOverride: false,
};

describe('PriorityDecompositionChart', () => {
  it('renders the title', () => {
    render(<PriorityDecompositionChart decomposition={withEpss} />);
    expect(screen.getByText('Why this priority?')).toBeInTheDocument();
  });

  it('hides EPSS row when w2 === 0', () => {
    render(<PriorityDecompositionChart decomposition={withoutEpss} />);
    expect(screen.getByText('CVSS Env.')).toBeInTheDocument();
    expect(screen.queryByText('EPSS')).not.toBeInTheDocument();
    expect(screen.getByText('Exploitability')).toBeInTheDocument();
    expect(screen.getByText('Context')).toBeInTheDocument();
  });

  it('renders weight percentages from the decomposition when EPSS present', () => {
    render(<PriorityDecompositionChart decomposition={withEpss} />);
    expect(screen.getByText('35%')).toBeInTheDocument();
    expect(screen.getAllByText('25%').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('15%')).toBeInTheDocument();
  });

  it('renders renormalized weight percentages when EPSS absent', () => {
    render(<PriorityDecompositionChart decomposition={withoutEpss} />);
    // Math.round(0.4667 * 100) = 47, Math.round(0.3333 * 100) = 33, Math.round(0.2 * 100) = 20
    expect(screen.getByText('47%')).toBeInTheDocument();
    expect(screen.getByText('33%')).toBeInTheDocument();
    expect(screen.getByText('20%')).toBeInTheDocument();
  });

  it('renders priority badge', () => {
    render(<PriorityDecompositionChart decomposition={withEpss} />);
    expect(screen.getByTestId('priority-badge')).toBeInTheDocument();
  });

  // For a malicious package the CVSS and EPSS dimensions are
  // meaningless, so only the Exploitability + Context rows are shown. This is a
  // display-only filter — the composite score header is untouched.
  it('hides the CVSS Env. and EPSS rows for malware, keeping Exploitability + Context', () => {
    render(<PriorityDecompositionChart decomposition={withEpss} isMalware />);
    expect(screen.queryByText('CVSS Env.')).not.toBeInTheDocument();
    expect(screen.queryByText('EPSS')).not.toBeInTheDocument();
    expect(screen.getByText('Exploitability')).toBeInTheDocument();
    expect(screen.getByText('Context')).toBeInTheDocument();
    // Composite score header is unchanged.
    expect(screen.getByText('Why this priority?')).toBeInTheDocument();
  });

  describe('priority labels i18n', () => {
    const priorities: Array<{ key: string; en: string; fr: string }> = [
      { key: 'critical_urgent', en: 'Critical Urgent', fr: 'Critique urgent' },
      { key: 'urgent', en: 'Urgent', fr: 'Urgent' },
      { key: 'normal', en: 'Normal', fr: 'Normal' },
      { key: 'low', en: 'Low', fr: 'Faible' },
      { key: 'very_low', en: 'Very Low', fr: 'Très faible' },
    ];

    afterEach(() => setLang('en'));

    it.each(priorities)('renders English label for priority %s', ({ key, en }) => {
      setLang('en');
      render(<PriorityDecompositionChart decomposition={{ ...withEpss, priority: key }} />);
      expect(screen.getByTestId('priority-badge').textContent).toBe(en);
    });

    it.each(priorities)('renders French label for priority %s', ({ key, fr }) => {
      setLang('fr');
      render(<PriorityDecompositionChart decomposition={{ ...withEpss, priority: key }} />);
      expect(screen.getByTestId('priority-badge').textContent).toBe(fr);
    });

    it('does NOT render hardcoded English "Critical Urgent" for FR locale', () => {
      setLang('fr');
      render(
        <PriorityDecompositionChart
          decomposition={{ ...withEpss, priority: 'critical_urgent' }}
        />,
      );
      expect(screen.getByTestId('priority-badge').textContent).not.toBe('Critical Urgent');
      expect(screen.getByTestId('priority-badge').textContent).toBe('Critique urgent');
    });
  });
});
