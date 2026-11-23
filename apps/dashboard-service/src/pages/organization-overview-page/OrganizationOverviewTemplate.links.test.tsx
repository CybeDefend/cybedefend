import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GetOrganizationOverviewResponse } from '@/server/interfaces/Vulnerability';

// The organisation overview is an AppSec page: a project of its « most
// vulnerable » list opens on the project's AppSec page, under the prefix.

const h = vi.hoisted(() => ({ navigate: vi.fn() }));

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());
vi.mock('react-router-dom', () => ({
  useNavigate: () => h.navigate,
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));
vi.mock('@/components/molecules/on-boarding/OnboardingStep', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/molecules/organization-branch-selector/OrganizationBranchSelector', () => ({
  default: () => <div />,
}));
vi.mock('./tabs/SeverityTab', () => ({ default: () => <div /> }));
vi.mock('./tabs/StateTab', () => ({ default: () => <div /> }));
vi.mock('./tabs/TrendsTab', () => ({ default: () => <div /> }));

import OrganizationOverviewTemplate from './OrganizationOverviewTemplate';

const data = {
  totalProjects: 1,
  totalTeams: 1,
  projectsSummary: [],
  topVulnerableProjects: [
    {
      projectId: 'proj-1',
      projectName: 'Payment service',
      teamName: 'Core',
      vulnerabilityCount: 12,
      criticalCount: 2,
      highCount: 3,
    },
  ],
} as unknown as GetOrganizationOverviewResponse;

const props = {
  data,
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

beforeEach(() => {
  h.navigate.mockReset();
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

describe('OrganizationOverviewTemplate — the most vulnerable projects', () => {
  it('opens a project on its AppSec page', async () => {
    render(<OrganizationOverviewTemplate {...props} />);
    await userEvent.click(screen.getByText('Payment service'));
    expect(h.navigate).toHaveBeenCalledWith('/appsec/project/proj-1');
  });
});
