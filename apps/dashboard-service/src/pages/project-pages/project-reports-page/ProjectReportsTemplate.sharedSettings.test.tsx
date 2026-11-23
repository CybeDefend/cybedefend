import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

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
// `project.reports.cards` slot; the shared settings drive the core
// OWASP and CWE cards here.
// The shared format and detail controls, as native elements: what is under
// test is which report they drive, not the widgets themselves.
vi.mock('../../../components/atoms/select/Select', () => ({
  default: ({ options, value, onChange }: any) => (
    <select
      data-testid="shared-format"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((o: any) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
}));

vi.mock('../../../components/atoms/toggle/Toggle', () => ({
  default: ({ enabled, onChange }: any) => (
    <input
      type="checkbox"
      data-testid="shared-detailed"
      checked={enabled}
      onChange={(e) => onChange(e.target.checked)}
    />
  ),
}));

import ProjectReportsTemplate from './ProjectReportsTemplate';

const props = () => ({
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
});

// The page shows ONE format and ONE level of detail for the core reports
// (OWASP, CWE). The closed cards receive the same choice through the
// `project.reports.cards` slot context.
describe('ProjectReportsTemplate — shared format and detail', () => {
  // The Generate buttons of the page, in its order: OWASP, CWE.
  const generateAll = () => {
    const [owasp, cwe] = screen.getAllByRole('button', { name: 'Generate' });
    fireEvent.click(owasp);
    fireEvent.click(cwe);
  };

  it('generates every report in the format chosen once', () => {
    const p = props();
    render(<ProjectReportsTemplate {...p} />);
    fireEvent.change(screen.getByTestId('shared-format'), { target: { value: 'pdf' } });
    generateAll();
    expect(p.onGenerateOwaspReport).toHaveBeenCalledWith('pdf', true);
    expect(p.onGenerateCweReport).toHaveBeenCalledWith('pdf', true);
  });

  it('generates every report at the level of detail chosen once', () => {
    const p = props();
    render(<ProjectReportsTemplate {...p} />);
    fireEvent.change(screen.getByTestId('shared-format'), { target: { value: 'html' } });
    fireEvent.click(screen.getByTestId('shared-detailed'));
    generateAll();
    expect(p.onGenerateOwaspReport).toHaveBeenCalledWith('html', false);
    expect(p.onGenerateCweReport).toHaveBeenCalledWith('html', false);
  });
});
