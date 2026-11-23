import React from 'react';
import { describe, it, expect, vi } from 'vitest';

/**
 * The report types of the organisation's reports page per edition: the EU AI
 * Act report depends on the AI-BOM, both closed, so the Community
 * Edition does not offer it. The project reports page already leaves it to the
 * cloud's slot. The template reads `EDITION` once at load, so each case
 * re-imports it.
 */
const ed = vi.hoisted(() => ({ edition: 'community' as string }));
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });
vi.mock('@/edition/edition', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/edition/edition')>()),
  get EDITION() {
    return ed.edition;
  },
}));
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

const AI_ACT = 'EU AI Act';

const renderStep2In = async (edition: string) => {
  ed.edition = edition;
  vi.resetModules();
  const ReportsPageTemplate = (await import('./ReportsPageTemplate')).default;
  render(<ReportsPageTemplate {...baseProps} />);
  fireEvent.click(screen.getAllByText('Continue')[0]);
};

describe('ReportsPageTemplate — the report types per edition', () => {
  it('the Community Edition offers no EU AI Act report', async () => {
    await renderStep2In('community');
    expect(screen.getByText('OWASP Top 10')).toBeInTheDocument();
    expect(screen.queryByText(AI_ACT)).not.toBeInTheDocument();
  });

  it('the Community Edition offers no licence report (licence management is the cloud\'s)', async () => {
    await renderStep2In('community');
    expect(screen.queryByText('Licenses')).not.toBeInTheDocument();
  });

  it('the cloud offers the licence report', async () => {
    await renderStep2In('cloud');
    expect(screen.getByText('Licenses')).toBeInTheDocument();
  });

  it('the cloud offers the EU AI Act report', async () => {
    await renderStep2In('cloud');
    expect(screen.getByText(AI_ACT)).toBeInTheDocument();
  });
});
