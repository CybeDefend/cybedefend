import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

import ReportPreviewModal from './ReportPreviewModal';

describe('ReportPreviewModal', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches the signed downloadUrl and renders the fetched HTML in the iframe when the inline content is empty', async () => {
    const html = '<html><body><h1>OWASP Report Body</h1></body></html>';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(html),
    });
    global.fetch = fetchMock as any;

    render(
      <ReportPreviewModal
        isOpen
        onClose={() => {}}
        reportContent=""
        reportFormat="html"
        reportFilename="owasp-top10-report.html"
        downloadUrl="https://storage.googleapis.com/bucket/owasp.html?sig=abc"
        onDownload={() => {}}
      />,
    );

    const iframe = await screen.findByTitle('Report Preview');
    await waitFor(() => {
      expect(iframe.getAttribute('srcdoc')).toContain('OWASP Report Body');
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://storage.googleapis.com/bucket/owasp.html?sig=abc',
    );
  });

  it('shows a loading state while the signed URL is being fetched', () => {
    global.fetch = vi.fn().mockReturnValue(new Promise(() => {})) as any;

    render(
      <ReportPreviewModal
        isOpen
        onClose={() => {}}
        reportContent=""
        reportFormat="html"
        reportFilename="cwe-top25-report.html"
        downloadUrl="https://storage.googleapis.com/bucket/cwe.html?sig=abc"
        onDownload={() => {}}
      />,
    );

    expect(screen.getByText('pages.projectReports.previewLoading')).toBeInTheDocument();
    expect(screen.queryByTitle('Report Preview')).not.toBeInTheDocument();
  });

  it('shows an error state when the signed URL fetch fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 403 }) as any;

    render(
      <ReportPreviewModal
        isOpen
        onClose={() => {}}
        reportContent=""
        reportFormat="html"
        reportFilename="owasp-top10-report.html"
        downloadUrl="https://storage.googleapis.com/bucket/owasp.html?sig=expired"
        onDownload={() => {}}
      />,
    );

    expect(
      await screen.findByText('pages.projectReports.previewError'),
    ).toBeInTheDocument();
    expect(screen.queryByTitle('Report Preview')).not.toBeInTheDocument();
  });

  it('decodes inline base64 content when no downloadUrl is provided (EU AI Act / SBOM)', () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as any;
    const html = '<html><body><h1>EU AI Act Body</h1></body></html>';

    render(
      <ReportPreviewModal
        isOpen
        onClose={() => {}}
        reportContent={btoa(html)}
        reportFormat="html"
        reportFilename="eu-ai-act-report.html"
        onDownload={() => {}}
      />,
    );

    const iframe = screen.getByTitle('Report Preview');
    expect(iframe.getAttribute('srcdoc')).toContain('EU AI Act Body');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('renders the html iframe with the strictest sandbox (no allow-* permissions) [H3]', () => {
    // The iframe renders attacker-controllable HTML (the report body is a
    // template-expanded artefact and the inline base64 path takes the same
    // code path). The strictest sandbox value, an empty string, denies
    // every capability: scripts, same-origin, forms, top-navigation, popups.
    // The previous `allow-same-origin` setting let any script in the
    // srcdoc reach back to the dashboard origin via cookies.
    const html = '<html><body><script>alert(1)</script></body></html>';

    render(
      <ReportPreviewModal
        isOpen
        onClose={() => {}}
        reportContent={btoa(html)}
        reportFormat="html"
        reportFilename="report.html"
        onDownload={() => {}}
      />,
    );

    const iframe = screen.getByTitle('Report Preview');
    // The attribute MUST be present but empty — that is the strictest
    // browser policy. Absence of the attribute would mean "no sandbox".
    expect(iframe.getAttribute('sandbox')).toBe('');
    expect(iframe.getAttribute('sandbox')).not.toContain('allow-same-origin');
    expect(iframe.getAttribute('sandbox')).not.toContain('allow-scripts');
  });
});
