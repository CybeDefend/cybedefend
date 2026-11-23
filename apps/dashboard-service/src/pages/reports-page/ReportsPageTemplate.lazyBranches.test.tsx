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

const projects = [
  { projectId: 'p1', name: 'Project One', teamId: 't1', teamName: 'Team A' },
  { projectId: 'p2', name: 'Project Two', teamId: 't1', teamName: 'Team A' },
] as any;

const baseProps = {
  organizationName: 'Org',
  teams: [],
  teamsLoading: false,
  teamsError: null,
  selectedTeamId: '',
  onTeamSelect: vi.fn(),
  selectedTeamProjects: [],
  projects,
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
  branchFilter: 'selected' as const,
  onBranchFilterChange: vi.fn(),
  projectBranchSelections: [],
  onProjectBranchSelectionsChange: vi.fn(),
  projectBranchesMap: {},
  archivedBranchesMap: {},
  onArchiveBranch: vi.fn(),
  onUnarchiveBranch: vi.fn(),
  reportLoading: false,
  reportError: null,
  onGenerateOrganizationReport: vi.fn(),
  onGenerateTeamReport: vi.fn(),
  onGenerateBatchReport: vi.fn(),
  onLoadProjectBranches: vi.fn(),
  loadingProjectIds: new Set<string>(),
  loadedProjectIds: new Set<string>(),
};

function renderAtBranchStep(overrides: Partial<typeof baseProps> = {}) {
  render(<ReportsPageTemplate {...baseProps} {...overrides} />);
  // The branch selector lives on the "Configure" step (step 2): advance once.
  const [continueBtn] = screen.getAllByText('Continue');
  fireEvent.click(continueBtn);
}

describe('ReportsPageTemplate — lazy branch selector', () => {
  it('requests no branches when the selector first renders', () => {
    const onLoadProjectBranches = vi.fn();
    renderAtBranchStep({ onLoadProjectBranches });
    expect(onLoadProjectBranches).not.toHaveBeenCalled();
  });

  it('requests only the expanded project when its row is clicked', () => {
    const onLoadProjectBranches = vi.fn();
    renderAtBranchStep({ onLoadProjectBranches });

    fireEvent.click(screen.getByText('Project One'));
    expect(onLoadProjectBranches).toHaveBeenCalledTimes(1);
    expect(onLoadProjectBranches).toHaveBeenCalledWith('p1');

    fireEvent.click(screen.getByText('Project Two'));
    expect(onLoadProjectBranches).toHaveBeenCalledTimes(2);
    expect(onLoadProjectBranches).toHaveBeenLastCalledWith('p2');
  });

  it('does not re-request branches when a project is collapsed again', () => {
    const onLoadProjectBranches = vi.fn();
    renderAtBranchStep({ onLoadProjectBranches });

    const row = screen.getByText('Project One');
    fireEvent.click(row); // expand → load
    fireEvent.click(row); // collapse → must not load again

    expect(onLoadProjectBranches).toHaveBeenCalledTimes(1);
  });

  it('shows a per-project loading indicator only for the project being fetched', () => {
    renderAtBranchStep({ loadingProjectIds: new Set(['p1']) });

    expect(screen.getByTestId('branch-row-loading-p1')).toBeInTheDocument();
    expect(screen.queryByTestId('branch-row-loading-p2')).not.toBeInTheDocument();
  });

  it('advertises a project-name search (branches are not pre-loaded)', () => {
    renderAtBranchStep();
    // The placeholder must not promise branch search across unloaded projects.
    expect(screen.getByPlaceholderText('Search projects...')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Search branches...')).not.toBeInTheDocument();
  });

  it('renders "No branches" only once for an expanded project that loaded empty', () => {
    renderAtBranchStep({
      projects: [{ projectId: 'p1', name: 'Project One', teamId: 't1', teamName: 'Team A' }] as any,
      loadedProjectIds: new Set(['p1']),
      projectBranchesMap: { p1: [] },
      archivedBranchesMap: { p1: [] },
    });

    // Expand the (already-loaded, empty) project.
    fireEvent.click(screen.getByText('Project One'));

    // The label must appear exactly once (the row badge), not duplicated in the
    // expanded body.
    expect(screen.getAllByText('No branches')).toHaveLength(1);
  });
});
