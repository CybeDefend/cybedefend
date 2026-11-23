import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());
// The stored-reports list listens to the reports stream; no socket in a unit test.
vi.mock('@/server/hooks/useRealtimeStream', () => ({ useRealtimeStream: () => undefined }));

vi.mock('../../../components/molecules/wrapper/ProjectTemplateWrapper', () => ({
  default: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@/components/molecules/modal/report-preview-modal/ReportPreviewModal', () => ({
  default: () => null,
}));

vi.mock('@/components/atoms/skeleton/Skeleton', () => ({
  Skeleton: () => <div />,
}));

vi.mock('@/components/molecules/feature-gate', () => ({
  FeatureGate: ({ children }: any) => <>{children}</>,
}));

// The closed report cards moved to the `project.reports.cards` slot.
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

describe('ProjectReportsTemplate — writes_blocked gate', () => {
  it('renders blocked wrappers on generate buttons when writesBlocked=true', () => {
    render(<ProjectReportsTemplate {...baseProps} writesBlocked={true} />);
    expect(screen.getByTestId('generate-owasp-blocked-wrapper')).toBeInTheDocument();
    expect(screen.getByTestId('generate-cwe-blocked-wrapper')).toBeInTheDocument();
  });

  it('does not render blocked wrappers when writesBlocked=false', () => {
    render(<ProjectReportsTemplate {...baseProps} writesBlocked={false} />);
    expect(screen.queryByTestId('generate-owasp-blocked-wrapper')).not.toBeInTheDocument();
    expect(screen.queryByTestId('generate-cwe-blocked-wrapper')).not.toBeInTheDocument();
  });
});
