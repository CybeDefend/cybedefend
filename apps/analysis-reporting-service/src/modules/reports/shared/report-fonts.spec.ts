import { getReportFontFaceCss, REPORT_FONT_FACES } from './report-fonts';

describe('report-fonts', () => {
  it('embeds the brand sans (Rubik) in every weight the reports use', () => {
    const css = getReportFontFaceCss();
    for (const weight of [400, 500, 600, 700]) {
      expect(css).toMatch(
        new RegExp(
          `@font-face \\{ font-family: 'Rubik'; font-style: normal; font-weight: ${weight};`,
        ),
      );
    }
  });

  it('embeds a real monospace (JetBrains Mono) instead of the FreeMono fallback', () => {
    const css = getReportFontFaceCss();
    expect(css).toContain("font-family: 'JetBrains Mono'");
    expect(css).toMatch(/font-weight: 400;/);
  });

  it('inlines the files as base64 data URIs, so the PDF needs no network and the sandboxed preview can load them', () => {
    const css = getReportFontFaceCss();
    const sources = css.match(
      /src: url\(data:font\/woff2;base64,[A-Za-z0-9+/=]+\)/g,
    );
    expect(sources).toHaveLength(REPORT_FONT_FACES.length);
    expect(css).not.toMatch(/url\((?!data:)/);
  });

  it('keeps the payload small (latin subset only)', () => {
    expect(getReportFontFaceCss().length).toBeLessThan(220_000);
  });

  it('builds the CSS once and serves it from cache', () => {
    expect(getReportFontFaceCss()).toBe(getReportFontFaceCss());
  });
});
