import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// i18n → surface the interpolated count for the per-card links, fall back to
// the leaf key otherwise (type labels resolve to reportTypes.<x> leaf).
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: any) => {
      // Some call sites pass a string default as the 2nd arg (t(key, 'Default')).
      if (typeof opts === 'string') return opts;
      if (opts && typeof opts === 'object' && 'count' in opts)
        return `${key.split('.').pop()}:${opts.count}`;
      return opts?.defaultValue || (key.split('.').pop() ?? key);
    },
    i18n: { language: 'en' },
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

vi.mock('../../../components/molecules/wrapper/ProjectTemplateWrapper', () => ({
  default: ({ children }: any) => <div>{children}</div>,
}));
vi.mock('@/components/atoms/skeleton/Skeleton', () => ({
  Skeleton: () => <div />,
}));
vi.mock('@/components/molecules/feature-gate', () => ({
  FeatureGate: ({ children }: any) => <>{children}</>,
}));
// The closed report cards moved to the `project.reports.cards` slot.
vi.mock(
  '@/components/molecules/modal/report-preview-modal/ReportPreviewModal',
  () => ({
    default: () => null,
  }),
);

// The drawer is exercised in its own tests; here we only assert it opens.
vi.mock('@/components/organismes/stored-reports/StoredReportsDrawer', () => ({
  default: ({ open, onClose }: any) =>
    open ? (
      <div>
        <span>DRAWER_OPEN</span>
        <button type="button" onClick={onClose}>
          CLOSE_DRAWER
        </button>
      </div>
    ) : null,
}));

let hookState: any;
vi.mock('@/server/hooks/useStoredReports', () => ({
  useStoredReports: () => hookState,
}));

import ProjectReportsTemplate from './ProjectReportsTemplate';

const baseProps = {
  projectId: 'p1',
  projectTitle: 'My Project',
  teamName: 'Team A',
  owaspReportData: null,
  cweReportData: null,
  loading: false,
  cweLoading: false,
  onGenerateOwaspReport: vi.fn(),
  onGenerateCweReport: vi.fn(),
  onDownloadOwaspReport: vi.fn(),
  onDownloadCweReport: vi.fn(),
  onClearOwaspReport: vi.fn(),
  onClearCweReport: vi.fn(),
};

const makeState = (items: any[]) => ({
  items,
  total: items.length,
  page: 1,
  pageSize: 100,
  loading: false,
  error: null,
  deletingId: null,
  setPage: vi.fn(),
  setPageSize: vi.fn(),
  refresh: vi.fn(),
  deleteReport: vi.fn(),
  downloadReport: vi.fn(),
});

describe('ProjectReportsTemplate — per-card stored-report links', () => {
  beforeEach(() => {
    hookState = makeState([
      { reportId: 'a', kind: 'owasp' },
      { reportId: 'b', kind: 'owasp' },
      { reportId: 'c', kind: 'cwe' },
    ]);
  });

  it('counts stored reports per kind and hides the link for kinds with none', () => {
    render(<ProjectReportsTemplate {...baseProps} />);

    expect(screen.getByTestId('stored-reports-link-owasp')).toHaveTextContent(
      'viewTypeReports:2',
    );
    expect(screen.getByTestId('stored-reports-link-cwe')).toHaveTextContent(
      'viewTypeReports:1',
    );
    // No EU AI Act reports → that card's link is not rendered.
    expect(
      screen.queryByTestId('stored-reports-link-eu_ai_act'),
    ).not.toBeInTheDocument();
  });

  it('opens the shared drawer when a per-card link is clicked', () => {
    render(<ProjectReportsTemplate {...baseProps} />);

    expect(screen.queryByText('DRAWER_OPEN')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('stored-reports-link-owasp'));
    expect(screen.getByText('DRAWER_OPEN')).toBeInTheDocument();
  });

  it('also opens the same drawer from the header button', () => {
    render(<ProjectReportsTemplate {...baseProps} />);
    // Header button shows the global total via openButton:N.
    fireEvent.click(screen.getByText('openButton:3'));
    expect(screen.getByText('DRAWER_OPEN')).toBeInTheDocument();
  });
});

describe('ProjectReportsTemplate — a « View report » link on the page already shown', () => {
  beforeEach(() => {
    hookState = makeState([]);
  });

  it('opens the drawer on mount for a deep-linked report, without a second read of the list', () => {
    render(<ProjectReportsTemplate {...baseProps} highlightReportId="r1" highlightKey="k1" />);
    expect(screen.getByText('DRAWER_OPEN')).toBeInTheDocument();
    expect(hookState.refresh).not.toHaveBeenCalled();
  });

  it('opens the drawer and reads the list again when a link names a report', () => {
    const { rerender } = render(<ProjectReportsTemplate {...baseProps} />);
    expect(screen.queryByText('DRAWER_OPEN')).toBeNull();

    rerender(<ProjectReportsTemplate {...baseProps} highlightReportId="r1" highlightKey="k1" />);

    expect(screen.getByText('DRAWER_OPEN')).toBeInTheDocument();
    expect(hookState.refresh).toHaveBeenCalledTimes(1);
  });

  it('opens it again on a second click on the same link, after it was closed', () => {
    const { rerender } = render(
      <ProjectReportsTemplate {...baseProps} highlightReportId="r1" highlightKey="k1" />,
    );
    fireEvent.click(screen.getByText('CLOSE_DRAWER'));
    expect(screen.queryByText('DRAWER_OPEN')).toBeNull();

    rerender(<ProjectReportsTemplate {...baseProps} highlightReportId="r1" highlightKey="k2" />);

    expect(screen.getByText('DRAWER_OPEN')).toBeInTheDocument();
    expect(hookState.refresh).toHaveBeenCalledTimes(1);
  });
});
