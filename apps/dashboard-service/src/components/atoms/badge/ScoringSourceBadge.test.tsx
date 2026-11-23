import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ScoringSourceBadge from './ScoringSourceBadge';

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => { /* no-op */ } },
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'pages.issuePage.scoring.cvss.iaAnalysis': 'AI Analysis',
        'pages.issuePage.scoring.cvss.scoreV4': 'CVSS 4.0 Score',
        'pages.issuePage.scoring.cvss.scoreV3': 'CVSS 3.1 Score',
        'pages.issuePage.scoring.cvss.legacyLabel': 'CVSS v3',
      };
      return map[key] || key;
    },
  }),
}));

describe('ScoringSourceBadge', () => {
  it('renders the AI Analysis label when scoringSource is agent', () => {
    render(<ScoringSourceBadge scoringSource="agent" cvssVersion="v4" />);
    expect(screen.getByText('AI Analysis')).toBeInTheDocument();
  });

  it('renders the CVSS 4.0 label for static v4 scoring', () => {
    render(<ScoringSourceBadge scoringSource="static" cvssVersion="v4" />);
    expect(screen.getByText('CVSS 4.0 Score')).toBeInTheDocument();
  });

  it('renders the CVSS 3.1 label for static v3 scoring', () => {
    render(<ScoringSourceBadge scoringSource="static" cvssVersion="v3" />);
    expect(screen.getByText('CVSS 3.1 Score')).toBeInTheDocument();
  });

  it('renders the legacy CVSS v3 label for static legacy scoring', () => {
    render(<ScoringSourceBadge scoringSource="static" cvssVersion="legacy" />);
    expect(screen.getByText('CVSS v3')).toBeInTheDocument();
  });

  it('returns null when scoringSource is null', () => {
    const { container } = render(
      <ScoringSourceBadge scoringSource={null} cvssVersion="v4" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('returns null when scoringSource is undefined', () => {
    const { container } = render(<ScoringSourceBadge cvssVersion="v4" />);
    expect(container.firstChild).toBeNull();
  });

  it('applies purple styling for agent scoring', () => {
    const { container } = render(
      <ScoringSourceBadge scoringSource="agent" cvssVersion="v4" />,
    );
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).toMatch(/purple/);
  });

  it('applies neutral gray styling for static scoring', () => {
    const { container } = render(
      <ScoringSourceBadge scoringSource="static" cvssVersion="v4" />,
    );
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).toMatch(/gray/);
    expect(badge.className).not.toMatch(/purple/);
  });

  it('treats unknown scoringSource strings as static fallback', () => {
    render(
      <ScoringSourceBadge scoringSource="manual" cvssVersion="v4" />,
    );
    expect(screen.getByText('CVSS 4.0 Score')).toBeInTheDocument();
  });

  it('hides label text until hover but keeps an accessible label in icon-only mode', () => {
    render(
      <ScoringSourceBadge scoringSource="agent" cvssVersion="v4" iconOnly />,
    );

    expect(screen.getByText('AI Analysis')).toHaveClass('opacity-0');
    expect(screen.getByLabelText('AI Analysis')).toBeInTheDocument();
  });
});
