import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...p }: any) => <div {...p}>{children}</div>,
    button: ({ children, onClick, disabled, ...p }: any) => (
      <button onClick={onClick} disabled={disabled} {...p}>{children}</button>
    ),
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

vi.mock('@/components/atoms/skeleton/Skeleton', () => ({ Skeleton: () => null }));
vi.mock('@/components/atoms/card/Card', () => ({
  default: ({ children }: any) => <div>{children}</div>,
}));
vi.mock('@/components/atoms/button/Button', () => ({
  default: ({ children, onClick, disabled, loading }: any) => (
    <button onClick={onClick} disabled={disabled || loading}>{children}</button>
  ),
}));
vi.mock('@/components/atoms/select/Select', () => ({ default: () => null }));
vi.mock('@/components/atoms/toggle/Toggle', () => ({ default: () => null }));
vi.mock('@/components/atoms/modal/Modal', () => ({ default: () => null }));
vi.mock('@/components/molecules/not-found-element/NotFoundElement', () => ({ default: () => null }));
vi.mock('@/components/molecules/page-container', () => ({
  PageContainer: ({ children }: any) => <div>{children}</div>,
}));
vi.mock('@/components/molecules/page-header', () => ({ PageHeader: () => null }));
vi.mock('@/utils/function/utils', () => ({ cn: (...c: any[]) => c.filter(Boolean).join(' ') }));
vi.mock('@/components/molecules/on-boarding/OnboardingStep', () => ({
  default: ({ children }: any) => <>{children}</>,
}));

import ReportsPageTemplate from './ReportsPageTemplate';

const baseProps = {
  organizationName: 'Org',
  teams: [],
  teamsLoading: false,
  teamsError: null,
  selectedTeamId: '',
  onTeamSelect: vi.fn(),
  selectedTeamProjects: [],
  projects: [],
  projectsLoading: false,
  projectsError: null,
  selectedProjectIds: [],
  onToggleProject: vi.fn(),
  onSelectAllProjects: vi.fn(),
  onDeselectAllProjects: vi.fn(),
  reportType: 'owasp' as const,
  onReportTypeChange: vi.fn(),
  reportFormat: 'pdf' as const,
  onReportFormatChange: vi.fn(),
  detailed: false,
  onDetailedChange: vi.fn(),
  branchFilter: 'all' as const,
  onBranchFilterChange: vi.fn(),
  projectBranchSelections: [],
  onProjectBranchSelectionsChange: vi.fn(),
  projectBranchesMap: {},
  archivedBranchesMap: {},
  onArchiveBranch: vi.fn(),
  onUnarchiveBranch: vi.fn(),
  onLoadProjectBranches: vi.fn(),
  loadingProjectIds: new Set<string>(),
  loadedProjectIds: new Set<string>(),
  reportLoading: false,
  reportError: null,
  onGenerateOrganizationReport: vi.fn(),
  onGenerateTeamReport: vi.fn(),
  onGenerateBatchReport: vi.fn(),
};

function advanceToStep3() {
  // Step 1 → 2 → 3: click "Continue" twice
  const [step1Continue] = screen.getAllByText('Continue');
  fireEvent.click(step1Continue);
  const [step2Continue] = screen.getAllByText('Continue');
  fireEvent.click(step2Continue);
}

describe('ReportsPageTemplate — writes_blocked gate', () => {
  it('renders the blocked wrapper on the generate button when writesBlocked=true', () => {
    render(<ReportsPageTemplate {...baseProps} writesBlocked={true} />);
    advanceToStep3();
    expect(screen.getByTestId('generate-report-blocked-wrapper')).toBeInTheDocument();
  });

  it('does not render the blocked wrapper when writesBlocked=false', () => {
    render(<ReportsPageTemplate {...baseProps} writesBlocked={false} />);
    advanceToStep3();
    expect(screen.queryByTestId('generate-report-blocked-wrapper')).not.toBeInTheDocument();
  });
});
