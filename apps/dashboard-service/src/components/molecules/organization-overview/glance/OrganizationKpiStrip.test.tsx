import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { GetOrganizationOverviewResponse } from '@/server/interfaces/Vulnerability';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'fr' } }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

import OrganizationKpiStrip from './OrganizationKpiStrip';

const data = {
  criticalIssues: 24,
  highIssues: 96,
  mediumIssues: 11000,
  lowIssues: 1225,
  solvedIssues: 12345,
  newIssuesLast7Days: 38,
  solvedIssuesLast7Days: 64,
  criticalRiskProjects: 2,
  highRiskProjects: 4,
  totalProjects: 12,
} as unknown as GetOrganizationOverviewResponse;

/**
 * A figure is written in the interface's language: « 12 345 » in French, not
 * the browser's « 12,345 » (what OverviewCards.locale.test pinned for the KPI
 * cards this strip replaces). The deltas carry their sign.
 */
describe('OrganizationKpiStrip', () => {
  it('writes the four figures with the separators of the interface language', () => {
    render(<OrganizationKpiStrip data={data} />);
    expect(screen.getByTestId('kpi-open')).toHaveTextContent(/12\s345/);
    expect(screen.getByTestId('kpi-open')).not.toHaveTextContent('12,345');
    expect(screen.getByTestId('kpi-resolved')).toHaveTextContent(/12\s345/);
    expect(screen.getByTestId('kpi-new')).toHaveTextContent('38');
    expect(screen.getByTestId('kpi-risk')).toHaveTextContent('6');
  });

  it('writes a large seven-day move in the interface language too (what OverviewCards.locale.test pinned for the trend)', () => {
    render(<OrganizationKpiStrip data={{ ...data, newIssuesLast7Days: 30000, solvedIssuesLast7Days: 6544 } as GetOrganizationOverviewResponse} />);
    expect(screen.getByTestId('kpi-open')).toHaveTextContent(/\+23\s456/);
    expect(screen.getByTestId('kpi-open')).not.toHaveTextContent('23456');
    expect(screen.getByTestId('kpi-resolved')).toHaveTextContent(/\+6\s544/);
  });

  it('signs the seven-day moves: the net on open findings, what the week resolved', () => {
    render(<OrganizationKpiStrip data={data} />);
    expect(screen.getByTestId('kpi-open')).toHaveTextContent('−26');
    expect(screen.getByTestId('kpi-resolved')).toHaveTextContent('+64');
  });
});
