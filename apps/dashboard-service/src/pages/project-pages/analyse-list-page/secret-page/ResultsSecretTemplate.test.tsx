import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ResultsSecretTemplate from './ResultsSecretTemplate';

// The counter header in ResultsSecretTemplate must go through i18n
// (t) with the count interpolated, instead of the previously hardcoded French
// literals ("groupe(s) de vulnérabilités" / "vulnérabilités"). We mock t to
// echo the key + count so we can assert the wiring without relying on real
// resolution (covered by ResultsSecretCounter.i18n.test.ts).
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { count?: number }) =>
      opts && typeof opts.count !== 'undefined' ? `${key}#${opts.count}` : key,
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));

vi.mock('@/utils/function/utils', () => ({
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
}));

vi.mock('framer-motion', () => ({
  motion: { div: ({ children, ...p }: any) => <div {...p}>{children}</div> },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

// Children stubbed so the test focuses on the counter header only.
vi.mock('@/components/molecules/wrapper/AnalyseWrapper', () => ({
  default: ({ children, afterStatusBanner }: any) => (
    <div>
      {afterStatusBanner}
      {children}
    </div>
  ),
}));
vi.mock('@/components/atoms/card/Card', () => ({
  default: ({ children }: any) => <div>{children}</div>,
}));
vi.mock('@/components/organismes/issue-drawer/IssueQuickViewHost', () => ({
  default: () => null,
}));
vi.mock('@/components/organismes/table/secret-table/ResultsSecretTable', () => ({
  ResultsSecretTable: () => null,
}));
vi.mock('@/components/organismes/table/grouped-secret-table/GroupedResultsSecretTable', () => ({
  GroupedResultsSecretTable: () => null,
}));
vi.mock('@/components/molecules/view-mode-toggle/ViewModeToggle', () => ({
  ViewModeToggle: () => null,
  ViewMode: {},
}));

const baseProps: any = {
  projectId: 'p-1',
  projectName: 'Demo',
  issues: [],
  totalIssues: 0,
  currentPage: 1,
  totalPages: 1,
  pageSize: 10,
  pageSizeOptions: [10, 25, 50],
  onPageChange: vi.fn(),
  onPageSizeChange: vi.fn(),
  selectedSeverity: [],
  selectedStatus: [],
  selectedPriority: [],
  selectedOrder: '',
  selectedOrderDirection: '',
  onSeverityChange: vi.fn(),
  onStatusChange: vi.fn(),
  onPriorityChange: vi.fn(),
  onOrderChange: vi.fn(),
  onOrderDirectionChange: vi.fn(),
  onSearchQueryChange: vi.fn(),
  showStartScanModal: false,
  handleStartScanClick: vi.fn(),
  handleCloseStartScanModal: vi.fn(),
  handleScanSubmit: vi.fn(),
  errors: {},
  setSelectedFile: vi.fn(),
  showLoader: false,
  scanData: null,
  vulnCount: 0,
  showPulse: false,
  onCloseLoader: vi.fn(),
  vulnCounts: { sast: 0, iac: 0, sca: 0, container: 0, cicd: 0, secret: 0 },
  loading: false,
  scanInfo: null,
  // The counter header only renders when onViewModeChange is provided.
  onViewModeChange: vi.fn(),
};

describe('ResultsSecretTemplate — counter header i18n', () => {
  it('renders the detailed counter via i18n with the issue count', () => {
    render(<ResultsSecretTemplate {...baseProps} viewMode="detailed" totalIssues={5} />);
    expect(
      screen.getByText('components.resultsTable.vulnerabilityCount#5'),
    ).toBeInTheDocument();
  });

  it('renders the grouped counter via i18n with the group count', () => {
    render(
      <ResultsSecretTemplate
        {...baseProps}
        viewMode="grouped"
        totalGroups={3}
        totalIssues={9}
      />,
    );
    expect(
      screen.getByText('components.resultsTable.vulnerabilityGroupCount#3'),
    ).toBeInTheDocument();
  });

  it('does not render any hardcoded French counter literal', () => {
    render(
      <ResultsSecretTemplate
        {...baseProps}
        viewMode="grouped"
        totalGroups={2}
        totalIssues={4}
      />,
    );
    expect(screen.queryByText(/de vulnérabilités/)).toBeNull();
    expect(screen.queryByText(/groupes?/)).toBeNull();
    expect(screen.queryByText(/^\d+ vulnérabilités$/)).toBeNull();
  });
});

describe('ResultsSecretTemplate — history coverage banner', () => {
  it('forwards the history coverage banner', () => {
    render(
      <ResultsSecretTemplate
        {...baseProps}
        viewMode="detailed"
        historyCoverageBanner={<p>coverage-notice</p>}
      />,
    );
    expect(screen.getByText('coverage-notice')).toBeInTheDocument();
  });
});
