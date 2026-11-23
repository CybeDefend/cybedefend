// report-brand.spec.ts — the shared CybeDefend brand block used by every report.

import { renderReportBrand } from './report-brand';

describe('shared/report-brand', () => {
  const html = renderReportBrand();

  it('embeds the CybeDefend logo as an inline base64 data URI', () => {
    // Inline data URI keeps PDF generation IO/network-free.
    expect(html).toContain('data:image/png;base64,');
    expect(html).toContain('alt="CybeDefend"');
  });

  it('renders the CYBEDEFEND wordmark', () => {
    expect(html).toContain('CYBEDEFEND');
  });

  it('is self-contained (inline styles, no external CSS class dependency)', () => {
    // Reports have heterogeneous header CSS, so the brand must style itself.
    expect(html).toMatch(/<img[^>]*style=/);
    expect(html).not.toContain('class=');
  });
});
