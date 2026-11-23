import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ReachabilityBadge from './ReachabilityBadge';
import enSca from '@/i18n/locales/en/pages/issuePage/sca.json';
import frSca from '@/i18n/locales/fr/pages/issuePage/sca.json';

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => { /* no-op */ } },
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'pages.issuePage.sca.reachability.used': 'Used',
        'pages.issuePage.sca.reachability.unused': 'Unused',
        'pages.issuePage.sca.reachability.potentially_used': 'Potentially Used',
        'pages.issuePage.sca.reachability.test_only': 'Test only',
        'pages.issuePage.sca.reachability.unknown': 'Unknown',
      };
      return map[key] || key;
    },
  }),
}));

describe('ReachabilityBadge', () => {
  it('renders the "used" label', () => {
    render(<ReachabilityBadge reachability="used" iconOnly={false} />);
    expect(screen.getByText('Used')).toBeInTheDocument();
  });

  it('renders the "unused" label', () => {
    render(<ReachabilityBadge reachability="unused" iconOnly={false} />);
    expect(screen.getByText('Unused')).toBeInTheDocument();
  });

  it('renders the "potentially_used" label', () => {
    render(<ReachabilityBadge reachability="potentially_used" iconOnly={false} />);
    expect(screen.getByText('Potentially Used')).toBeInTheDocument();
  });

  it('renders a translated label for "test_only", not the raw value', () => {
    render(<ReachabilityBadge reachability="test_only" iconOnly={false} />);
    expect(screen.getByText('Test only')).toBeInTheDocument();
    expect(screen.queryByText('test_only')).not.toBeInTheDocument();
  });

  it('renders nothing when reachability is absent', () => {
    const { container } = render(<ReachabilityBadge reachability={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('ReachabilityBadge translations', () => {
  it.each(['used', 'unused', 'potentially_used', 'test_only', 'unknown'])(
    'has an en and fr label for "%s"',
    (value) => {
      const en = (enSca as any).pages.issuePage.sca.reachability;
      const fr = (frSca as any).pages.issuePage.sca.reachability;
      expect(en[value]).toBeTruthy();
      expect(fr[value]).toBeTruthy();
    },
  );
});
