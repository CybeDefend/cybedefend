import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// The stored-reports list listens to the reports stream; no socket in a unit test.
vi.mock('@/server/hooks/useRealtimeStream', () => ({ useRealtimeStream: () => undefined }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: any) => opts?.defaultValue || key,
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

// Capture the props handed to the preview modal so we can assert the template
// forwards the signed downloadUrl (OWASP/CWE content is empty).
const capturedProps: any[] = [];
vi.mock('@/components/molecules/modal/report-preview-modal/ReportPreviewModal', () => ({
  default: (props: any) => {
    capturedProps.push(props);
    return null;
  },
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

describe('ProjectReportsTemplate — preview wiring', () => {
  beforeEach(() => {
    capturedProps.length = 0;
  });

  it('forwards the signed downloadUrl to the preview modal for an OWASP HTML report', () => {
    const owaspReportData = {
      projectId: 'p1',
      format: 'html',
      content: '',
      filename: 'owasp-top10-report.html',
      contentType: 'text/html',
      downloadUrl: 'https://storage.googleapis.com/bucket/owasp.html?sig=abc',
      expiresAtMs: Date.now() + 900_000,
    };

    render(
      <ProjectReportsTemplate
        {...baseProps}
        owaspReportData={owaspReportData as any}
      />,
    );

    fireEvent.click(screen.getByText('pages.projectReports.preview'));

    const last = capturedProps[capturedProps.length - 1];
    expect(last.downloadUrl).toBe(
      'https://storage.googleapis.com/bucket/owasp.html?sig=abc',
    );
  });

  // The SBOM and EU AI Act cards are a closed extension: their
  // preview wiring is tested with it.
});
