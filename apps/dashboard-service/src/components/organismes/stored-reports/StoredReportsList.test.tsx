import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import StoredReportsList, { daysLeft } from './StoredReportsList';

// i18n → echo keys (append :count for pluralized strings) so assertions stay
// stable. Preserve the rest of react-i18next (initReactI18next) so the i18n
// bootstrap pulled in transitively by atoms still resolves.
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
vi.mock('react-toastify', () => ({ toast: { error: vi.fn() } }));
// The popover has its own tests; stub it here to keep this focused on the list.
vi.mock('./ReportMetadataPopover', () => ({ default: () => null }));
// Stub Pagination to surface just the props this list is responsible for.
vi.mock('../../molecules/pagination/Pagination', () => ({
  default: ({ currentPage, totalPages }: { currentPage: number; totalPages: number }) => (
    <div data-testid="pagination">{`page ${currentPage}/${totalPages}`}</div>
  ),
}));

const DAY = 24 * 60 * 60 * 1000;

const makeController = (over: Partial<any> = {}) => ({
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

const item = (over: Partial<any> = {}) => ({
  reportId: 'r1',
  kind: 'owasp',
  format: 'pdf',
  status: 'ready',
  filename: 'owasp.pdf',
  createdAtMs: Date.now(),
  expiresAtMs: Date.now() + 30 * DAY,
  ...over,
});

describe('StoredReportsList', () => {
  it('daysLeft returns null for 0 (never expires)', () => {
    expect(daysLeft(0)).toBeNull();
  });

  it('flags an amber expiry warning when a report expires in < 7 days', () => {
    const controller = makeController({
      total: 1,
      items: [item({ reportId: 'soon', expiresAtMs: Date.now() + 3 * DAY })],
    });
    const { container } = render(
      <StoredReportsList controller={controller as any} />,
    );
    expect(screen.getByText(/storedReports\.expiresIn:/)).toBeInTheDocument();
    expect(container.querySelector('.bg-amber-100')).toBeTruthy();
  });

  it('does not flag a warning for a report far from expiry', () => {
    const controller = makeController({
      total: 1,
      items: [item({ reportId: 'later', expiresAtMs: Date.now() + 30 * DAY })],
    });
    const { container } = render(
      <StoredReportsList controller={controller as any} />,
    );
    expect(container.querySelector('.bg-amber-100')).toBeNull();
  });

  it('renders "never expires" for a non-expiring report', () => {
    const controller = makeController({
      total: 1,
      items: [item({ expiresAtMs: 0 })],
    });
    render(<StoredReportsList controller={controller as any} />);
    expect(
      screen.getByText('pages.reportsPage.storedReports.neverExpires'),
    ).toBeInTheDocument();
  });

  it('hides the quota banner when loaded usage.limit is < 0 (unlimited / billing-unavailable), even with a finite entitlement', () => {
    // Backend fails open with limit -1 while `used` is the real count; the UI
    // must NOT pair the finite entitlement with used and show a false "full".
    const controller = makeController({
      total: 1,
      items: [item()],
      usage: { used: 500, limit: -1 },
    });
    render(
      <StoredReportsList controller={controller as any} maxStoredReports={500} />,
    );
    expect(
      screen.queryByText('pages.reportsPage.storedReports.quota.used'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText('pages.reportsPage.storedReports.quota.full'),
    ).not.toBeInTheDocument();
  });

  it('renders pagination with the controller page and computed totalPages', () => {
    const controller = makeController({
      total: 25,
      pageSize: 10,
      page: 2,
      items: [item()],
    });
    render(<StoredReportsList controller={controller as any} />);
    // totalPages = ceil(25 / 10) = 3
    expect(screen.getByTestId('pagination')).toHaveTextContent('page 2/3');
  });
});
