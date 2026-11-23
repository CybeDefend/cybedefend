// report-styles.spec.ts — single source of truth for report HTML/PDF styling.
//
// Pins the design tokens and the invariants of the shared base CSS: embedded
// brand fonts, one typographic scale, one badge geometry, readable severity
// colours, and page-break rules that live in the BASE stylesheet (never
// @media print, so the dashboard iframe preview shows the same layout).

import {
  COLORS,
  FONT_STACK,
  MONO_STACK,
  TYPE_SCALE,
  SPACING,
  RADIUS,
  getReportBaseCss,
  severityBadge,
  severityLabel,
  typeBadge,
  codeChip,
  breakableId,
  breakableVersion,
  idColumnChars,
  idPieces,
  piecesHtml,
  versionChip,
  versionColumnChars,
  versionPieces,
  VERSION_WHOLE_CHARS,
} from './report-styles';
import { getReportFontFaceCss } from './report-fonts';

/** WCAG relative-luminance contrast ratio between two #rrggbb colours. */
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('shared/report-styles', () => {
  describe('design tokens', () => {
    it('keeps the violet brand palette', () => {
      expect(COLORS.accent).toBe('#7845FF');
      expect(COLORS.dark).toBe('#281434');
    });

    it('gives every severity a solid colour and a badge pair readable at 4.5:1', () => {
      for (const key of [
        'critical',
        'high',
        'medium',
        'low',
        'unknown',
      ] as const) {
        const s = COLORS.severity[key];
        expect(s.solid).toMatch(/^#[0-9a-f]{6}$/i);
        expect(contrast(s.fg, s.bg)).toBeGreaterThanOrEqual(4.5);
      }
    });

    it('keeps body and muted text readable on white', () => {
      expect(contrast(COLORS.text, '#ffffff')).toBeGreaterThanOrEqual(7);
      expect(contrast(COLORS.textMuted, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    });

    it('leads the font stacks with the embedded fonts, then the fonts the prod image ships', () => {
      expect(FONT_STACK.startsWith("'Rubik'")).toBe(true);
      expect(FONT_STACK).toContain('FreeSans');
      expect(MONO_STACK.startsWith("'JetBrains Mono'")).toBe(true);
      expect(MONO_STACK).toContain('FreeMono');
    });

    it('exposes one typographic scale and the spacing/radius tokens', () => {
      expect(TYPE_SCALE.td).toBe('11px');
      expect(TYPE_SCALE.th).toBe('9.5px');
      expect(typeof SPACING).toBe('object');
      expect(typeof RADIUS).toBe('object');
    });
  });

  describe('getReportBaseCss', () => {
    const pdf = getReportBaseCss(true);
    const browser = getReportBaseCss(false);

    it('embeds the brand fonts in both variants', () => {
      expect(pdf).toContain(getReportFontFaceCss());
      expect(browser).toContain(getReportFontFaceCss());
      expect(pdf).toContain("font-family: 'Rubik'");
    });

    // A larger body alone on screen flattened the hierarchy (body text as big
    // as a finding title, bigger than the tables): the preview keeps the PDF
    // scale and enlarges the whole sheet instead.
    it('sets one type scale for both media, the preview sheet enlarged as a whole', () => {
      expect(pdf).toMatch(/td\s*\{[^}]*font-size:\s*11px/);
      expect(browser).toMatch(/td\s*\{[^}]*font-size:\s*11px/);
      expect(pdf).toMatch(/body\s*\{[^}]*font-size:\s*11\.5px/);
      expect(browser).toMatch(/body\s*\{[^}]*font-size:\s*11\.5px/);
      expect(browser).toMatch(/\.doc\s*\{[^}]*zoom:\s*1\.13/);
      expect(pdf).not.toMatch(/zoom/);
      // the preview's text column is the PDF's (A4 less 2 x 14mm = 688px), so
      // lines break at the same words
      const doc =
        /\.doc \{[^}]*max-width: (\d+)px;[^}]*padding: \d+px (\d+)px;/.exec(
          browser,
        );
      expect(Number(doc?.[1]) - 2 * Number(doc?.[2])).toBe(688);
    });

    it('lets the page margins frame the PDF (no extra body padding) and centres a sheet on screen', () => {
      expect(pdf).toMatch(/body\s*\{[^}]*padding:\s*0/);
      expect(browser).toMatch(/\.doc\s*\{[^}]*max-width/);
    });

    it('prints backgrounds exactly (tinted badges and tiles survive the PDF)', () => {
      expect(pdf).toContain('print-color-adjust: exact');
    });

    it('puts page-break rules in the BASE css (not @media print)', () => {
      expect(pdf).toContain('break-inside: avoid');
      expect(pdf).toContain('display: table-header-group');
      expect(pdf).toContain('break-after: avoid');
      expect(pdf).toContain('orphans: 3');
      expect(pdf).not.toContain('@media print');
    });

    it('never protects large containers, and never frames a section (a frame cut by a page break leaves open borders)', () => {
      expect(pdf).not.toMatch(/\.section\s*\{[^}]*break-inside/);
      expect(pdf).not.toMatch(/\.section\s*\{[^}]*border:/);
      expect(pdf).not.toMatch(/(^|[^-.\w])table\s*\{[^}]*break-inside/);
    });

    it('wraps words in cells without cutting them anywhere, and only fixes the layout when columns are sized', () => {
      expect(pdf).not.toMatch(/\btd\s*\{[^}]*overflow-wrap:\s*anywhere/);
      expect(pdf).toMatch(/\btd\s*\{[^}]*overflow-wrap:\s*break-word/);
      expect(pdf).toMatch(/table\.fixed\s*\{[^}]*table-layout:\s*fixed/);
      expect(pdf).not.toMatch(/(^|\s)table\s*\{[^}]*table-layout:\s*fixed/);
    });

    it('uses a light table header, not a heavy dark bar repeated on every page', () => {
      // painted on the row, so no seam shows between header cells
      expect(pdf).toMatch(/thead tr\s*\{[^}]*background:\s*#f4f1fa/i);
      expect(pdf).not.toMatch(/(^|\s)th\s*\{[^}]*background:/);
      expect(pdf).toMatch(/th\s*\{[^}]*text-transform:\s*uppercase/);
    });

    it('never fakes a bold or italic monospace (no synthetic Type 3 glyphs)', () => {
      expect(pdf).toMatch(/\.code-chip, \.path \{[^}]*font-synthesis: none/);
    });

    // A table can hold several row groups (a row and its notes form one):
    // "first" and "last" are the table's, not each group's.
    it('never leaves a single table row alone at the top or bottom of a page', () => {
      expect(pdf).toMatch(
        /tbody:first-of-type > tr:first-child \+ tr,\s*tbody:last-child > tr:last-child \{\s*break-before: avoid;/,
      );
    });

    it('drops the rule under the last row of the table only, not under each row group', () => {
      expect(pdf).toMatch(
        /tbody:last-child > tr:last-child td \{ border-bottom: none; \}/,
      );
      expect(pdf).not.toMatch(/(^|\s)tbody tr:last-child td \{/);
    });

    it('avoids orphan words and keeps inline code tight', () => {
      expect(pdf).toMatch(/text-wrap: pretty/);
      expect(pdf).toMatch(
        /code, \.code-inline \{[^}]*padding: 0 2px;[^}]*line-height: 1/,
      );
    });

    it('uses no shadow in the PDF', () => {
      expect(pdf).not.toContain('box-shadow');
      expect(browser).toContain('box-shadow');
    });

    // An image reference or a Debian version with an epoch has no space: in a
    // chip that never wraps it ran past its cell, over the next column, and
    // past the page edge (Chromium then shrinks the whole PDF).
    it('keeps a chip whole while it fits a line, a long one wrapping inside its own background', () => {
      // atomic: moved to the next line whole rather than cut at a line end;
      // its own block, it never takes the hanging indent of its line
      expect(pdf).toMatch(
        /\.code-chip \{[^}]*display: inline-block;[^}]*text-indent: 0;/,
      );
      expect(pdf).toMatch(
        /\.code-chip\.is-long \{[^}]*max-width: 100%;[^}]*white-space: normal;[^}]*overflow-wrap: anywhere;/,
      );
      // a chip set inline and broken over lines stays ONE chip: its cut ends
      // open and square, never one rounded pill per line (read as several
      // identifiers)
      expect(pdf).toMatch(
        /\.code-chip \{[^}]*-webkit-box-decoration-break: slice;[^}]*box-decoration-break: slice;/,
      );
      expect(pdf).not.toMatch(/box-decoration-break: clone/);
    });

    // Column widths of a fixed table never depend on their content, yet a
    // short chip (a version, a CVE, a short package name) never wraps there
    // either: made wrappable, « 1.2.5-r23 » broke after its hyphen and
    // « 0.3.30 » anywhere (« 0.3.3 » over « 0 », read as another version) as
    // soon as the preview narrowed its column. A column too narrow for one is
    // the template's to widen, measured on its content; only a long chip, a
    // long version and a long part break (see above).
    it('keeps a short chip whole in a fixed table cell', () => {
      for (const css of [pdf, browser]) {
        expect(css).not.toMatch(/table\.fixed td[^{]*\.code-chip[^{]*\{/);
        expect(css).toMatch(
          /td \.badge, td \.chip, td \.code-chip \{ white-space: nowrap; \}/,
        );
      }
    });

    // Prose words still wrap whole (see above); only monospace text, an
    // identifier, may break anywhere, and only when nothing else fits.
    it('lets monospace text in a cell break anywhere as a last resort', () => {
      expect(pdf).toMatch(
        /td \.mono, td code, td \.code-inline \{[^}]*overflow-wrap: anywhere;/,
      );
    });
  });

  // Identifier breaking per the Chicago Manual of Style: after « : » and
  // « // », before « / . - _ @ + ~ ? # % = & » (the next line opens on the
  // separator: a line never ends on a dash that would read as hyphenation).
  describe('breakableId', () => {
    // The text copied or extracted from the PDF: tags removed, entities decoded.
    const copied = (html: string) =>
      html
        .replace(/<[^>]*>/g, '')
        .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(+n))
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&');

    it('breaks before its separators and after « : » or « // », the copied text unchanged', () => {
      const ref =
        'e4feaa3fac914202b07ad1e0a3ad933e.azurecr.io/azureml/azureml_05b92b0c3f062d7d80a0ae539d0c1321:1';
      const html = breakableId(ref);
      // A long hexadecimal run: a block, with no extra break point (see
      // idPieces).
      expect(html).toBe(
        '<span class="hex">e4feaa3fac914202b07ad1e0a3ad933e</span><wbr>.azurecr<wbr>.io<wbr>/azureml<wbr>/azureml<wbr><span class="hex">_05b92b0c3f062d7d80a0ae539d0c1321:1</span>',
      );
      // <wbr> adds no character to the copied or extracted text
      expect(copied(html)).toBe(ref);
      expect(
        breakableId('registry.example.com/team/app@sha256:c335e56da2'),
      ).toBe(
        'registry<wbr>.example<wbr>.com<wbr>/team<wbr>/app<wbr>@sha256:<wbr>c335e56da2',
      );
      expect(breakableId('https://registry.example.com/x')).toBe(
        'https://<wbr>registry<wbr>.example<wbr>.com/x',
      );
      expect(
        breakableId('https://example.com/search?q=long-value&page=2#section'),
      ).toBe(
        'https://<wbr>example<wbr>.com<wbr>/search<nobr>?q</nobr><wbr>=long<wbr><nobr>-v</nobr>alue<wbr>&amp;page=2<wbr>#section',
      );
      expect(breakableId('~user/very/deep/path%20with%2Fencoded')).toBe(
        '~user<wbr>/very<wbr>/deep<wbr>/path<wbr>%20with<wbr>%2Fencoded',
      );
    });

    // Chromium breaks on its own after a hyphen or a question mark: tied to
    // the character after them, the line opens on them instead of ending on
    // them.
    it('keeps a hyphen or a question mark with the character after it', () => {
      expect(breakableId('extremely-long-package-name-for-testing')).toBe(
        'extremely<wbr><nobr>-l</nobr>ong<wbr><nobr>-p</nobr>ackage<wbr><nobr>-n</nobr>ame<wbr><nobr>-f</nobr>or<wbr><nobr>-t</nobr>esting',
      );
      expect(breakableId('docker-compose.production.yml:84–93')).toBe(
        'docker<wbr><nobr>-c</nobr>ompose<wbr>.production<wbr>.yml:<wbr>84<nobr>&#8211;9</nobr>3',
      );
      expect(getReportBaseCss(true)).toMatch(/nobr \{ white-space: nowrap; \}/);
    });

    it('cuts a camelCase or PascalCase word longer than 24 characters between a lower-case and an upper-case letter', () => {
      expect(
        breakableId(
          'SettlementReconciliationExportRepositoryImplementation.java:1291',
        ),
      ).toBe(
        'Settlement<wbr>Reconciliation<wbr>Export<wbr>Repository<wbr>Implementation<wbr>.java:<wbr>1291',
      );
      expect(
        breakableId(
          'resolveSettlementReconciliationExportFileForMerchantBatchWithRetryPolicy',
        ),
      ).toBe(
        'resolve<wbr>Settlement<wbr>Reconciliation<wbr>Export<wbr>File<wbr>For<wbr>Merchant<wbr>Batch<wbr>With<wbr>Retry<wbr>Policy',
      );
      // An acronym stays whole: only the lower-case → upper-case boundary.
      expect(breakableId('HTTPServerConfigurationFactory.java')).toBe(
        'HTTPServer<wbr>Configuration<wbr>Factory<wbr>.java',
      );
      // A word of 24 characters or fewer never breaks in its middle.
      expect(
        breakableId('com.acmecorp.platform.ReconciliationController'),
      ).toBe('com<wbr>.acmecorp<wbr>.platform<wbr>.ReconciliationController');
    });

    it('never breaks at its head, and never leaves fewer than three characters alone', () => {
      expect(breakableId('@very-long-organization-name/')).toBe(
        '@very<wbr><nobr>-l</nobr>ong<wbr><nobr>-o</nobr>rganization<wbr><nobr>-n</nobr>ame/',
      );
      expect(breakableId('8:6.9.11.60+dfsg-1.6ubuntu1.4')).toBe(
        '8:6.9<wbr>.11<wbr>.60<wbr>+dfsg<nobr>-1</nobr><wbr>.6ubuntu1.4',
      );
      expect(breakableId('registry.example.com/team/app:1')).toBe(
        'registry<wbr>.example<wbr>.com<wbr>/team<wbr>/app:1',
      );
      expect(breakableId('../very/deep/relative/path/to/file.ts')).toBe(
        '../very<wbr>/deep<wbr>/relative<wbr>/path<wbr>/to<wbr>/file<wbr>.ts',
      );
      expect(breakableId('getAConfigurationValueFromTheEnvironmentX')).toBe(
        'get<wbr>AConfiguration<wbr>Value<wbr>From<wbr>The<wbr>EnvironmentX',
      );
    });

    it('keeps a space as the break it already is', () => {
      expect(
        breakableId(
          'GET /api/v2/merchants/{merchantId}/settlements/{batchId}/export',
        ),
      ).toBe(
        'GET <wbr>/api<wbr>/v2<wbr>/merchants<wbr>/{merchantId}<wbr>/settlements<wbr>/{batchId}<wbr>/export',
      );
    });

    it('escapes each piece, never putting a break inside an HTML entity', () => {
      const raw = 'a&b<c>/"quoted"-name/été-café.json';
      const html = breakableId(raw);
      expect(html).toBe(
        'a&amp;b&lt;c&gt;<wbr>/&quot;quoted&quot;<wbr><nobr>-n</nobr>ame<wbr>/&#233;t&#233;<wbr><nobr>-c</nobr>af&#233;<wbr>.json',
      );
      expect(html).not.toMatch(/&[#\w]*<(?:wbr|\/?nobr)>/);
      expect(html).not.toMatch(/<(?!wbr>|\/?nobr>)/);
      expect(copied(html)).toBe(raw);
    });

    // A version, a CVE or a package name moves to the next line whole.
    it('adds no break to a short identifier', () => {
      expect(breakableId('CVE-2026-25965')).toBe('CVE-2026-25965');
      expect(breakableId('3.0.13-0ubuntu3.5')).toBe('3.0.13-0ubuntu3.5');
      expect(breakableId('a<b')).toBe('a&lt;b');
      expect(breakableId(undefined)).toBe('');
      expect(breakableId(null)).toBe('');
    });
  });

  // The pieces between two break points, as text: what a template measures
  // to size a column (never breakableId's HTML).
  describe('idPieces', () => {
    it('gives the pieces of a long identifier, joined back into it', () => {
      expect(idPieces('8:6.9.11.60+dfsg-1.6ubuntu1.4')).toEqual([
        '8:6.9',
        '.11',
        '.60',
        '+dfsg-1',
        '.6ubuntu1.4',
      ]);
      const ref = 'registry.example.com/team/app@sha256:c335e56da2';
      expect(idPieces(ref).join('')).toBe(ref);
      expect(idPieces('a&b<c>')).toEqual(['a&b<c>']);
    });

    it('keeps a short identifier whole', () => {
      expect(idPieces('CVE-2026-25965')).toEqual(['CVE-2026-25965']);
      expect(idPieces(null)).toEqual(['']);
    });

    it('matches the pieces breakableId renders', () => {
      for (const id of [
        'e4feaa3fac914202b07ad1e0a3ad933e.azurecr.io/azureml/azureml_05b92b0c3f062d7d80a0ae539d0c1321:1',
        'extremely-long-package-name-for-testing',
        'a&b<c>/"quoted"-name/été-café.json',
      ]) {
        const shown = breakableId(id)
          .replace(/<\/?span[^>]*>/g, '')
          .split('<wbr>')
          .map((p) => p.replace(/<\/?nobr>/g, '').replace(/&[#\w]+;/g, '_'));
        expect(shown.map((p) => p.length)).toEqual(
          idPieces(id).map((p) => p.length),
        );
      }
    });

    // A sha256 digest or an azurecr host has no separator: wider than its
    // column, it broke at the edge, leaving « 08 » alone on its line. It is
    // now a block, whole while it fits on a line, otherwise broken into
    // balanced lines; its breaks are not pieces: no <wbr>, the column that can
    // hold it whole holds it.
    it('puts a hexadecimal run longer than 24 characters in a block, whole while it fits a line, else cut into balanced lines', () => {
      const digest =
        '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';
      const ref = `registry.acme-corp.internal:5000/identity/backend-services@sha256:${digest}`;
      expect(idPieces(ref)).toContain(digest);
      expect(breakableId(ref)).toMatch(
        new RegExp(`@sha256:<wbr><span class="hex">${digest}</span>$`),
      );
      expect(breakableId(ref).replace(/<[^>]*>/g, '')).toBe(ref);
      expect(
        breakableId('e4feaa3fac914202b07ad1e0a3ad933e.azurecr.io/azureml'),
      ).toBe(
        '<span class="hex">e4feaa3fac914202b07ad1e0a3ad933e</span><wbr>.azurecr<wbr>.io<wbr>/azureml',
      );
      // The separator that opens the run goes into the block: the line opens
      // on it, never ends on it; what follows it in its piece (`:1`) too.
      expect(
        breakableVersion(
          '3.0.0-alpha.20260915.4f2d9c1e8b7a6d5c4b3a2f1e0d9c8b7a6f5e4d3c',
        ),
      ).toBe(
        '3.0.0<wbr><nobr>-a</nobr>lpha.20260915<span class="hex">.4f2d9c1e8b7a6d5c4b3a2f1e0d9c8b7a6f5e4d3c</span>',
      );
      expect(
        breakableId('images/azureml_05b92b0c3f062d7d80a0ae539d0c1321:1'),
      ).toBe(
        'images<wbr>/azureml<wbr><span class="hex">_05b92b0c3f062d7d80a0ae539d0c1321:1</span>',
      );
      // A fingerprint of 24 characters or fewer, a timestamp: plain text.
      expect(
        breakableId('golang.org/x/net@v0.0.0-20230817173708-d852ddb80c63'),
      ).not.toContain('hex');
      const pdf = getReportBaseCss(true);
      // Broken anywhere between two digits, but into balanced lines: never a
      // two-character remainder.
      expect(pdf).toMatch(
        /\.hex \{[^}]*display: inline-block;[^}]*max-width: 100%;[^}]*white-space: normal;[^}]*word-break: break-all;[^}]*text-wrap: balance;[^}]*text-indent: 0;/,
      );
      // In a chip (even in one of its parts, without background) or inline
      // code, the block keeps their background on all its lines; in inline
      // code (line height 1), it takes back the text's line spacing.
      expect(pdf).toContain(
        `.code-chip .hex { background: ${COLORS.chipBg}; }`,
      );
      expect(pdf).toContain(
        'code .hex, .code-inline .hex { background: inherit; line-height: 1.5; }',
      );
    });

    // Chromium breaks between an inline block and the comma after it: the
    // punctuation of an identifier that ends (or starts) with a hexadecimal
    // run goes into its block.
    it('keeps the punctuation around a hexadecimal block inside it', () => {
      const ref =
        'ghcr.io/acme/app@sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';
      expect(codeChip(ref, { after: ',' })).toMatch(
        /b0f00a08,<\/span><\/span><\/span>$/,
      );
      expect(
        codeChip('e4feaa3fac914202b07ad1e0a3ad933e.azurecr.io/azureml', {
          before: '(',
          after: ')',
        }),
      ).toMatch(
        /^<span class="id-box"><span class="code-chip is-long"><span class="hex">\(e4feaa3fac914202b07ad1e0a3ad933e<\/span>/,
      );
      expect(
        versionChip(
          '3.0.0-alpha.20260915.4f2d9c1e8b7a6d5c4b3a2f1e0d9c8b7a6f5e4d3c',
          {
            after: ',',
          },
        ),
      ).toMatch(/6f5e4d3c,<\/span><\/span><\/span>$/);
      // The punctuation stays literal (no replacement pattern).
      expect(codeChip(ref, { before: '$1', after: '$&' })).toMatch(
        /b0f00a08\$&amp;<\/span><\/span><\/span>$/,
      );
      // With no block at its edge, the punctuation stays outside the chip.
      expect(
        codeChip('registry.example.com/team/app:1', { after: ',' }),
      ).toMatch(/app:1<\/span>,<\/span>$/);
    });

    it('renders given pieces as breakableId does', () => {
      const id = 'feature/PLAT-48213-migrate-imagemagick-thumbnail';
      expect(piecesHtml(idPieces(id))).toBe(breakableId(id));
      expect(piecesHtml(['a<b', '-c&d'])).toBe(
        'a&lt;b<wbr><nobr>-c</nobr>&amp;d',
      );
    });
  });

  // A package version is atomic: a Debian or RPM version never breaks inside
  // its revision or between two digits, and only an absurdly long version
  // (fingerprinted pre-release, Go pseudo-version) breaks, before « + » or
  // before the « - » that opens its pre-release.
  describe('versions', () => {
    const copied = (html: string) =>
      html.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&');

    it('keeps a version of 24 characters or less whole, with its markup', () => {
      expect(versionPieces('3.0.13-0ubuntu3.5')).toEqual(['3.0.13-0ubuntu3.5']);
      expect(breakableVersion('1:2.3.4-1+deb11u5')).toBe('1:2.3.4-1+deb11u5');
      expect(versionChip('3.0.13-0ubuntu3.5')).toBe(
        codeChip('3.0.13-0ubuntu3.5'),
      );
      expect(versionChip('4.18.0', { after: ',' })).toBe(
        codeChip('4.18.0', { after: ',' }),
      );
      expect(versionPieces(null)).toEqual(['']);
    });

    it('never cuts a Debian or RPM version inside its revision nor between two digits', () => {
      // breakableId used to cut « 8:6.9 | .11 | .60 | +dfsg-1 | .6ubuntu1.4 ».
      expect(versionPieces('8:6.9.11.60+dfsg-1.6ubuntu1.4')).toEqual([
        '8:6.9.11.60',
        '+dfsg',
        '-1.6ubuntu1.4',
      ]);
      // The « + » of a revision (`+esm1`, `+deb11u5`) belongs to it.
      expect(versionPieces('2:1.02.185-2.1ubuntu0.20.04.1+esm1')).toEqual([
        '2:1.02.185',
        '-2.1ubuntu0.20.04.1+esm1',
      ]);
      expect(versionPieces('1:1.1.1k-12.el8_9.1.alma.1+really')).toEqual([
        '1:1.1.1k',
        '-12.el8_9.1.alma.1+really',
      ]);
    });

    // A Go pseudo-version broken only before its first « - » left a
    // 28-character part that a narrow column broke anywhere:
    // « -2023081717370 | 8-d852ddb80c63 | , ».
    it('cuts a language version only before « + » or before each « - » of its pre-release, never between two digits', () => {
      expect(versionPieces('v0.0.0-20240312152122-5f08fbb34913')).toEqual([
        'v0.0.0',
        '-20240312152122',
        '-5f08fbb34913',
      ]);
      expect(versionPieces('v0.0.0-20230817173708-d852ddb80c63')).toEqual([
        'v0.0.0',
        '-20230817173708',
        '-d852ddb80c63',
      ]);
      expect(versionPieces('19.0.0-canary-e4d33f7b-20240522')).toEqual([
        '19.0.0',
        '-canary',
        '-e4d33f7b',
        '-20240522',
      ]);
      for (const v of [
        'v0.0.0-20230817173708-d852ddb80c63',
        '19.0.0-canary-e4d33f7b-20240522',
        '2.8.1-beta.3+build.20260928',
      ]) {
        const pieces = versionPieces(v);
        expect(pieces.join('')).toBe(v);
        pieces.slice(1).forEach((piece, i) => {
          expect(`${pieces[i].slice(-1)}${piece[0]}`).not.toMatch(/\d\d/);
        });
      }
      expect(
        versionPieces(
          '3.0.0-alpha.20260915.4f2d9c1e8b7a6d5c4b3a2f1e0d9c8b7a6f5e4d3c',
        ),
      ).toEqual([
        '3.0.0',
        '-alpha.20260915.4f2d9c1e8b7a6d5c4b3a2f1e0d9c8b7a6f5e4d3c',
      ]);
      expect(versionPieces('1.0.0-rc.1+build.20240312.abcdef12')).toEqual([
        '1.0.0',
        '-rc.1',
        '+build.20240312.abcdef12',
      ]);
      // A « - » of the build metadata opens no pre-release.
      expect(versionPieces('1.0.0+build-20240312.abcdef1234')).toEqual([
        '1.0.0',
        '+build-20240312.abcdef1234',
      ]);
      // Never a piece shorter than three characters.
      expect(versionPieces('v1-20240312152122-5f08fbb34913')).toEqual([
        'v1-20240312152122',
        '-5f08fbb34913',
      ]);
      expect(breakableVersion('v0.0.0-20230817173708-d852ddb80c63')).toBe(
        'v0.0.0<wbr><nobr>-2</nobr>0230817173708<wbr><nobr>-d</nobr>852ddb80c63',
      );
    });

    it('renders the pieces with a break between them only, the copied text unchanged', () => {
      const v = '8:6.9.11.60+dfsg-1.6ubuntu1.4';
      expect(breakableVersion(v)).toBe(
        '8:6.9.11.60<wbr>+dfsg<wbr><nobr>-1</nobr>.6ubuntu1.4',
      );
      expect(copied(breakableVersion(v))).toBe(v);
      expect(breakableVersion('1.0.0-rc.1+build.20240312.a&b<c>')).toBe(
        '1.0.0<wbr><nobr>-r</nobr>c.1<wbr>+build.20240312.a&amp;b&lt;c&gt;',
      );
    });

    // A version chip stays ONE chip: an inline block whose background covers
    // its two lines, never two pills that would read as two versions
    // (codeChip's long chip is inline in its box).
    it('keeps a long version in one chip, whole while it fits a line', () => {
      const v = '8:6.9.11.60+dfsg-1.6ubuntu1.4';
      expect(versionChip(v)).toBe(
        `<span class="code-chip version">${breakableVersion(v)}</span>`,
      );
      expect(versionChip(v, { before: '(', after: '),' })).toBe(
        `<span class="id-box">(<span class="code-chip version">${breakableVersion(v)}</span>),</span>`,
      );
      const pdf = getReportBaseCss(true);
      expect(pdf).toMatch(
        /\.code-chip\.version \{[^}]*display: inline-block;[^}]*max-width: 100%;[^}]*white-space: normal;/,
      );
      expect(pdf).not.toMatch(
        /\.code-chip\.version[^{]*\{[^}]*display: inline;/,
      );
    });

    // What a Fixed in / Installed / Upgrade to / Versions column must hold on
    // one line: a whole version up to VERSION_WHOLE_CHARS characters, its
    // longest part beyond.
    it('measures the characters a column of versions needs on one line', () => {
      expect(VERSION_WHOLE_CHARS).toBe(32);
      expect(
        versionColumnChars(['4.18.0', '8:6.9.11.60+dfsg-1.6ubuntu1.4', null]),
      ).toBe(29);
      expect(versionColumnChars(['v0.0.0-20240312152122-5f08fbb34913'])).toBe(
        15,
      );
      expect(versionColumnChars([])).toBe(0);
    });

    it('measures the characters a column of identifiers needs on one line', () => {
      expect(
        idColumnChars([
          'CVE-2026-25965',
          'registry.example.com/team/app@sha256:c335e56da2',
          undefined,
        ]),
      ).toBe(14);
      expect(idColumnChars(['extremely-long-package-name-for-testing'])).toBe(
        Math.max(
          ...idPieces('extremely-long-package-name-for-testing').map(
            (p) => p.length,
          ),
        ),
      );
      expect(idColumnChars([])).toBe(0);
    });
  });

  describe('helpers', () => {
    it('severityBadge uses the readable badge pair of the severity', () => {
      const html = severityBadge('critical');
      expect(html).toContain('class="badge"');
      expect(html).toContain(COLORS.severity.critical.fg);
      expect(html).toContain(COLORS.severity.critical.bg);
      expect(html).toContain('Critical');
    });

    it('severityBadge is case-insensitive and falls back to a neutral pair', () => {
      expect(severityBadge('HIGH')).toContain(COLORS.severity.high.fg);
      expect(severityBadge('banana')).toContain(COLORS.severity.unknown.fg);
      expect(severityBadge('banana')).toContain('Banana');
    });

    // One word in every report for a finding without a severity.
    it('names a missing or unknown severity "Unrated"', () => {
      for (const s of ['unknown', 'UNKNOWN', 'none', 'unrated', '', null]) {
        expect(severityLabel(s)).toBe('Unrated');
      }
      expect(severityBadge('unknown')).toContain('>Unrated<');
      expect(severityBadge('unknown')).toContain(COLORS.severity.unknown.fg);
      expect(severityLabel('critical')).toBe('Critical');
    });

    it('typeBadge renders a neutral chip (type conveyed by label, not colour)', () => {
      expect(typeBadge('sast')).toContain('class="chip"');
      expect(typeBadge('sast')).toContain('SAST');
    });

    it('codeChip renders the unified .code-chip', () => {
      const html = codeChip('pkg@1.2');
      expect(html).toContain('class="code-chip"');
      expect(html).toContain('pkg@1.2');
    });

    // A long chip is a transparent box (in one piece while it fits on a
    // line) carrying the inline chip: broken, its background follows each
    // line instead of covering the whole column.
    it('codeChip keeps a short value as it is and lets a long one break at its separators, inside a box', () => {
      expect(codeChip('3.0.13-0ubuntu3.5')).toBe(
        '<span class="code-chip">3.0.13-0ubuntu3.5</span>',
      );
      expect(codeChip('8:6.9.11.60+dfsg-1.6ubuntu1.4')).toBe(
        '<span class="id-box"><span class="code-chip is-long">8:6.9<wbr>.11<wbr>.60<wbr>+dfsg<nobr>-1</nobr><wbr>.6ubuntu1.4</span></span>',
      );
    });

    // Chromium breaks between an inline block and the punctuation after it:
    // the punctuation goes into the box, never alone at the start or the end
    // of a line.
    it('codeChip keeps the punctuation around it inside its box', () => {
      expect(codeChip('3.0.13-0ubuntu3.5', { after: ',' })).toBe(
        '<span class="id-box"><span class="code-chip">3.0.13-0ubuntu3.5</span>,</span>',
      );
      expect(
        codeChip('8:6.9.11.60+dfsg-1.6ubuntu1.4', { before: '(', after: '):' }),
      ).toBe(
        '<span class="id-box">(<span class="code-chip is-long">8:6.9<wbr>.11<wbr>.60<wbr>+dfsg<nobr>-1</nobr><wbr>.6ubuntu1.4</span>):</span>',
      );
      expect(codeChip('x', { before: '<', after: '"' })).toBe(
        '<span class="id-box">&lt;<span class="code-chip">x</span>&quot;</span>',
      );
    });

    it('sizes the box of a long chip to its text, the inline chip as tall as a chip block', () => {
      const pdf = getReportBaseCss(true);
      expect(pdf).toMatch(
        /\.id-box \{[^}]*display: inline-block;[^}]*max-width: 100%;[^}]*white-space: normal;[^}]*overflow-wrap: anywhere;[^}]*text-indent: 0;/,
      );
      // Same background height as the block chip (1.7 × 10px): a line of
      // JetBrains Mono content is 1.3em. One more pixel on each side: one
      // line's background joins the next one's, ONE continuous chip.
      expect(pdf).toMatch(
        /\.id-box > \.code-chip\.is-long \{[^}]*display: inline;[^}]*padding: calc\(\(1lh - 1\.3em\) \/ 2 \+ 1px\) 5px;/,
      );
    });

    it('escapes user-controlled input in every helper (XSS defense-in-depth)', () => {
      expect(severityBadge('<x>')).toContain('&lt;x&gt;');
      expect(severityBadge('<x>')).not.toContain('<x>');
      expect(typeBadge('"onx"')).not.toContain('"onx"');
      expect(codeChip('<b>')).toContain('&lt;b&gt;');
      expect(codeChip('<b>')).not.toContain('<b>');
    });
  });
});
