import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

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

// The closed report cards (SBOM, EU AI Act, per-scanner) moved to the
// `project.reports.cards` slot; they are not the branch selector's.
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

describe('ProjectReportsTemplate — branch selector', () => {
  it('does not offer an "All branches" option (a report must target one branch)', () => {
    render(
      <ProjectReportsTemplate
        {...baseProps}
        branches={[
          { name: 'final', isDefault: false },
          { name: 'testrisk', isDefault: false },
        ] as any}
        selectedBranch="final"
        onBranchChange={vi.fn()}
      />,
    );

    const selector = screen.getByTestId('reports-branch-selector');
    // Open the dropdown (the only button before opening is the trigger).
    fireEvent.click(within(selector).getByRole('button'));

    // Dropdown is open: the concrete branches are listed...
    expect(within(selector).getByText('testrisk')).toBeInTheDocument();
    // ...but "All branches" must NOT be selectable on the Reports page.
    expect(within(selector).queryByText('All branches')).not.toBeInTheDocument();
  });
});
