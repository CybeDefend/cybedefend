import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import StoredReportsSection from './StoredReportsSection';

// i18n → echo keys (with count suffix for plurals) so assertions stay stable.
// Preserve the rest of react-i18next (initReactI18next) so the i18n bootstrap
// imported transitively by atoms still works.
vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (k: string, o?: unknown) =>
        o && typeof o === 'object' && 'count' in o
          ? `${k}:${(o as { count: unknown }).count}`
          : k,
    }),
  };
});

let hookState: any;
vi.mock('../../../server/hooks/useStoredReports', () => ({
  useStoredReports: () => hookState,
}));

const toastError = vi.fn();
vi.mock('react-toastify', () => ({
  toast: { error: (...a: unknown[]) => toastError(...a) },
}));

const baseState = (over: Partial<any> = {}) => ({
  items: [],
  total: 0,
  page: 1,
  pageSize: 10,
  loading: false,
  error: null,
  deletingId: null,
  usage: null,
  setPage: vi.fn(),
  setPageSize: vi.fn(),
  refresh: vi.fn(),
  deleteReport: vi.fn().mockResolvedValue(undefined),
  downloadReport: vi.fn().mockResolvedValue(undefined),
  ...over,
});

describe('StoredReportsSection', () => {
  beforeEach(() => {
    hookState = baseState();
    toastError.mockReset();
  });

  const readyItem = (over: Partial<any> = {}) => ({
    reportId: 'r1',
    kind: 'owasp',
    format: 'pdf',
    status: 'ready',
    filename: 'owasp.pdf',
    createdAtMs: Date.now(),
    expiresAtMs: Date.now() + 90 * 24 * 3600 * 1000,
    ...over,
  });

  it('toasts an error when a download fails (e.g. legacy report with no object)', async () => {
    const downloadReport = vi
      .fn()
      .mockRejectedValue({ statusCode: 404, message: 'Report not found at …' });
    hookState = baseState({ total: 1, items: [readyItem()], downloadReport });

    render(
      <StoredReportsSection scope={{ kind: 'organization', organizationId: 'o1' }} />,
    );

    fireEvent.click(
      screen.getByText('pages.reportsPage.storedReports.download'),
    );
    // let the rejected promise settle
    await Promise.resolve();
    await Promise.resolve();
    expect(downloadReport).toHaveBeenCalledWith('r1');
    expect(toastError).toHaveBeenCalledWith(
      'pages.reportsPage.storedReports.downloadFailed',
    );
  });

  it('renders the empty state when there are no reports', () => {
    render(
      <StoredReportsSection scope={{ kind: 'project', projectId: 'p1' }} />,
    );
    expect(
      screen.getByText('pages.reportsPage.storedReports.empty.title'),
    ).toBeInTheDocument();
  });

  it('shows the quota banner only when maxStoredReports is provided', () => {
    hookState = baseState({ total: 3 });
    const { rerender } = render(
      <StoredReportsSection scope={{ kind: 'organization', organizationId: 'o1' }} />,
    );
    expect(
      screen.queryByText('pages.reportsPage.storedReports.quota.used'),
    ).not.toBeInTheDocument();

    rerender(
      <StoredReportsSection
        scope={{ kind: 'organization', organizationId: 'o1' }}
        maxStoredReports={500}
        retentionDays={90}
      />,
    );
    expect(
      screen.getByText('pages.reportsPage.storedReports.quota.used'),
    ).toBeInTheDocument();
  });

  it('shows the quota banner from the shared org-wide usage even without the maxStoredReports prop (project drawer)', () => {
    // The project drawer doesn't receive maxStoredReports, but controller.usage
    // carries the shared org-wide pool → the banner still shows.
    hookState = baseState({ usage: { used: 25, limit: 500 } });
    render(
      <StoredReportsSection scope={{ kind: 'project', projectId: 'p1' }} />,
    );
    expect(
      screen.getByText('pages.reportsPage.storedReports.quota.used'),
    ).toBeInTheDocument();
  });

  it('does not falsely flag "quota full" from this-scope total while the org-wide usage is still loading', () => {
    // usage not loaded yet → the shared org-wide used count is unknown. The
    // banner must NOT pair this scope's total with the org-wide max and declare
    // the pool full (that mislabels a nearly-empty org as full during loading).
    hookState = baseState({ total: 5, usage: null });
    render(
      <StoredReportsSection
        scope={{ kind: 'organization', organizationId: 'o1' }}
        maxStoredReports={1}
        retentionDays={90}
      />,
    );
    // The limit is known (from the entitlement) so the banner still shows…
    expect(
      screen.getByText('pages.reportsPage.storedReports.quota.used'),
    ).toBeInTheDocument();
    // …but "full" must NOT appear until the real org-wide usage arrives.
    expect(
      screen.queryByText('pages.reportsPage.storedReports.quota.full'),
    ).not.toBeInTheDocument();
  });

  it('delete button opens confirmation and confirming calls deleteReport', async () => {
    const deleteReport = vi.fn().mockResolvedValue(undefined);
    hookState = baseState({
      total: 1,
      items: [
        {
          reportId: 'r1',
          kind: 'owasp',
          format: 'pdf',
          status: 'ready',
          filename: 'owasp.pdf',
          createdAtMs: Date.now(),
          expiresAtMs: Date.now() + 90 * 24 * 3600 * 1000,
        },
      ],
      deleteReport,
    });

    render(
      <StoredReportsSection scope={{ kind: 'project', projectId: 'p1' }} />,
    );

    fireEvent.click(
      screen.getByText('pages.reportsPage.storedReports.delete'),
    );
    // ConfirmationModal renders a confirm (common.yes) button.
    fireEvent.click(screen.getByText('common.yes'));
    expect(deleteReport).toHaveBeenCalledWith('r1');
  });

  it('shows a not-found notice when the highlighted report is absent', () => {
    hookState = baseState({ total: 0, items: [] });
    render(
      <StoredReportsSection
        scope={{ kind: 'project', projectId: 'p1' }}
        highlightReportId="missing"
      />,
    );
    expect(
      screen.getByText('pages.reportsPage.storedReports.notFound'),
    ).toBeInTheDocument();
  });
});
