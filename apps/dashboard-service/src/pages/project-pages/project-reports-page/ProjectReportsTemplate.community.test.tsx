import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { SlotRegistration } from '@/edition/slots';

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

vi.mock('../../../components/molecules/wrapper/ProjectTemplateWrapper', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/atoms/skeleton/Skeleton', () => ({
  Skeleton: () => <div />,
}));
vi.mock('@/components/molecules/feature-gate', () => ({
  FeatureGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/molecules/modal/report-preview-modal/ReportPreviewModal', () => ({
  default: () => null,
}));
vi.mock('@/components/organismes/stored-reports/StoredReportsDrawer', () => ({
  default: () => null,
}));
// The closed cards (SBOM, EU AI Act, per-scanner) are slot registrations now:
// with `activeSlots` emptied below, none of them renders.
vi.mock('@/server/hooks/useStoredReports', () => ({
  useStoredReports: () => ({
    items: [],
    total: 0,
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
  }),
}));

/**
 * The SBOM, EU AI Act and per-scanner report cards are registrations
 * of the `project.reports.cards` slot (the closed tree's, in a private build).
 * With no registration — the Community Edition — the page lists the core
 * report cards only: OWASP and CWE (and the aggregated ones). Querying by the
 * translated titles, so a missing key fails here too.
 */
const { slots } = vi.hoisted(() => ({ slots: { current: [] as SlotRegistration[] } }));
vi.mock('@/edition/active', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/edition/active')>()),
  activeSlots: () => slots.current,
}));

import ProjectReportsTemplate from './ProjectReportsTemplate';

const baseProps = {
  projectId: 'p1',
  projectTitle: 'My Project',
  teamName: 'Team A',
  owaspReportData: null,
  cweReportData: null,
  sbomData: null,
  loading: false,
  cweLoading: false,
  sbomLoading: false,
  onGenerateOwaspReport: vi.fn(),
  onGenerateCweReport: vi.fn(),
  onDownloadOwaspReport: vi.fn(),
  onDownloadCweReport: vi.fn(),
  onDownloadSbom: vi.fn(),
  onClearOwaspReport: vi.fn(),
  onClearCweReport: vi.fn(),
  onGenerateEuAiActReport: vi.fn(),
  onDownloadEuAiActReport: vi.fn(),
  onClearEuAiActReport: vi.fn(),
};

describe('ProjectReportsTemplate — community (no project.reports.cards registration)', () => {
  it('lists the OWASP and CWE report cards and no SBOM, AI-BOM, EU AI Act or per-scanner card', () => {
    slots.current = [];
    render(<ProjectReportsTemplate {...baseProps} />);

    // The core cards stay.
    expect(screen.getByText('OWASP Top 10 Report')).toBeInTheDocument();
    expect(screen.getByText('CWE Top 25 Report')).toBeInTheDocument();

    // The closed cards are gone.
    expect(screen.queryByText('SBOM (Software Bill of Materials)')).not.toBeInTheDocument();
    expect(screen.queryByText('EU AI Act Compliance Report (Annex IV)')).not.toBeInTheDocument();
    expect(screen.queryByText('Reports by Scanner Type')).not.toBeInTheDocument();
    expect(screen.queryByText(/AI-BOM/)).not.toBeInTheDocument();
  });
});
