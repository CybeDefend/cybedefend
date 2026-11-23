import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Four pill tabs in one unwrapped flex row measure 523px. On a 390px phone the
// row pushed the whole document to 552px wide: the browser widened the layout
// viewport to fit, the page rendered zoomed out, and every `position: fixed`
// surface (tour panel, Cybe button) was anchored to a viewport larger than the
// screen — i.e. partly or wholly off it. The row must scroll inside its own
// box instead of stretching the page.

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children }: any) => <a>{children}</a>,
}));

vi.mock('@/components/molecules/on-boarding/OnboardingStep', () => ({
  default: ({ children }: any) => <>{children}</>,
}));

vi.mock('@/components/molecules/organization-branch-selector/OrganizationBranchSelector', () => ({
  default: () => <div />,
}));

vi.mock('./tabs/SeverityTab', () => ({ default: () => <div /> }));
vi.mock('./tabs/StateTab', () => ({ default: () => <div /> }));
vi.mock('./tabs/TrendsTab', () => ({ default: () => <div /> }));

import OrganizationOverviewTemplate from './OrganizationOverviewTemplate';

const props = {
  data: { totalProjects: 0, totalTeams: 0, projectsSummary: [] } as any,
  loading: false,
  error: null,
  onRefresh: vi.fn(),
  organizationId: 'org-1',
  organizationName: 'Acme Studio',
  filters: {},
  onFiltersChange: vi.fn(),
  onResetFilters: vi.fn(),
  projects: [],
  projectsLoading: false,
};

describe('OrganizationOverviewTemplate — tab row on a narrow screen', () => {
  it('scrolls the tab row inside its own box instead of widening the page', () => {
    render(<OrganizationOverviewTemplate {...props} />);

    const tabRow = screen.getByRole('tablist');
    expect(tabRow.className).toContain('overflow-x-auto');

    // Tabs keep their natural width (labels stay on one line); the row scrolls.
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(4);
    for (const tab of tabs) {
      expect(tab.className).toContain('shrink-0');
    }
  });

  it('tells assistive tech which tab is showing', () => {
    render(<OrganizationOverviewTemplate {...props} />);

    const selected = screen.getAllByRole('tab').filter((tab) => tab.getAttribute('aria-selected') === 'true');
    expect(selected).toHaveLength(1);
  });
});
