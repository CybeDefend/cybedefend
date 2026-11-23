// pdf-generator.service.spec.ts
//
// The running PDF footer is built by the pure `buildPdfPageOptions`
// helper rather than asserted through Puppeteer: the test-utils puppeteer stub
// ignores `page.pdf()` options, so the option object is the only observable
// surface. Extracting it keeps the footer fully unit-tested.

import { buildPdfPageOptions } from './pdf-generator.service';
import { CYBEDEFEND_LOGO_BASE64 } from '../../modules/reports/shared/logo-base64';

describe('buildPdfPageOptions (running footer)', () => {
  const opts = buildPdfPageOptions('OWASP Top 10 Security Report');

  it('keeps A4 / printBackground / engine-driven page size', () => {
    expect(opts.format).toBe('A4');
    expect(opts.printBackground).toBe(true);
    expect(opts.preferCSSPageSize).toBe(false);
  });

  it('enables a Puppeteer header/footer with an empty header', () => {
    expect(opts.displayHeaderFooter).toBe(true);
    expect(opts.headerTemplate).toBe('<div></div>');
  });

  it('reserves room for the footer in the page margins', () => {
    expect(opts.margin).toEqual({
      top: '14mm',
      bottom: '17mm',
      left: '14mm',
      right: '14mm',
    });
  });

  it('renders the running footer: logo + title on the left, Page X / Y on the right', () => {
    const footer = opts.footerTemplate as string;
    expect(footer).toContain('font-size: 8px');
    expect(footer).toContain('color: #736c7f');
    // aligned with the content column (same side margin as the page)
    expect(footer).toContain('padding: 0 14mm');
    // hairline separating the footer from the content
    expect(footer).toContain('border-top: 0.5px solid #e7e3ee');
    expect(footer).toContain('data:image/png;base64,');
    expect(footer).toContain(CYBEDEFEND_LOGO_BASE64);
    expect(footer).toContain('OWASP Top 10 Security Report');
    expect(footer).toContain('class="pageNumber"');
    expect(footer).toContain('class="totalPages"');
  });

  it('escapes the document title (it can carry tenant data)', () => {
    const footer = buildPdfPageOptions('<img src=x onerror=alert(1)>')
      .footerTemplate as string;
    expect(footer).toContain('&lt;img');
    expect(footer).not.toContain('<img src=x');
  });

  it('typesets the footer in the embedded brand font, not a Type 3 FreeSans fallback', () => {
    const footer = opts.footerTemplate as string;
    expect(footer).toContain("@font-face { font-family: 'Rubik'");
    expect(footer).toContain("font-family: 'Rubik', 'FreeSans'");
  });

  it('reads "Page X of Y"', () => {
    const footer = opts.footerTemplate as string;
    expect(footer).toMatch(
      /Page <span class="pageNumber"><\/span> of <span class="totalPages"><\/span>/,
    );
  });

  // A project name of 163 characters wrapped the title onto two lines and
  // pushed "Page 1 of 5" into "Page 1" / "of 5" (EU2-03): the title is
  // elided on one line, the page count never shrinks nor wraps.
  it('elides a long title on one line and keeps the page count whole', () => {
    const footer = buildPdfPageOptions(`EU AI Act report · ${'x'.repeat(200)}`)
      .footerTemplate as string;
    expect(footer).toMatch(
      /<div style="display: flex; align-items: center; gap: 6px; flex: 1 1 auto; min-width: 0;">/,
    );
    expect(footer).toMatch(
      /<span style="flex: 1 1 auto; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;">EU AI Act report/,
    );
    expect(footer).toMatch(
      /<div style="flex: none; margin-left: 12px; white-space: nowrap;">Page <span class="pageNumber"><\/span> of <span class="totalPages"><\/span><\/div>/,
    );
    // the logo never shrinks either
    expect(footer).toMatch(
      /<img [^>]*style="height: 10px; width: auto; flex: none;"/,
    );
  });

  it('still produces a valid footer when no title is supplied', () => {
    const noTitle = buildPdfPageOptions();
    expect(noTitle.displayHeaderFooter).toBe(true);
    const footer = noTitle.footerTemplate as string;
    expect(footer).toContain('class="pageNumber"');
    expect(footer).toContain('class="totalPages"');
  });
});
