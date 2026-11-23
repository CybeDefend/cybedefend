import {
  REPORT_LAYOUT_CSS,
  aboutSection,
  idChip,
  idText,
  keyFacts,
  arrowIcon,
  packageChip,
  callout,
  coverMetaHeight,
  dataTable,
  emptyState,
  kpiTiles,
  pathText,
  renderCover,
  renderReportDocument,
  sectionHead,
  stateLabel,
  verdictPill,
} from './report-layout';
import { breakableId, getReportBaseCss } from './report-styles';

describe('shared/report-layout', () => {
  describe('renderReportDocument', () => {
    const html = renderReportDocument({
      title: 'OWASP <Top 10>',
      forPdf: true,
      body: '<p>body</p>',
      extraCss: '.x { color: red; }',
    });

    it('produces a full document with the base CSS for the medium and the body inside .doc', () => {
      expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
      expect(html).toContain('<meta charset="UTF-8"');
      expect(html).toContain(getReportBaseCss(true));
      expect(html).toContain('.x { color: red; }');
      expect(html).toMatch(/<div class="doc">[\s\S]*<p>body<\/p>/);
    });

    it('escapes the title', () => {
      expect(html).toContain('<title>OWASP &lt;Top 10&gt;</title>');
    });

    it('closes with the end-of-document footer Puppeteer waits for', () => {
      expect(html).toMatch(/class="footer"/);
    });

    it('ships no script (the dashboard preview is a sandboxed iframe)', () => {
      expect(html).not.toContain('<script');
    });

    // A short chip (a version, a CVE, a short package name: codeChip or
    // versionChip of 24 characters or less, a plain `.code-chip`) never
    // wraps, in the PDF or the preview, at any width: no rule of the shared
    // stylesheet may make it wrappable, in a cell or anywhere else. Only a
    // long chip (.is-long), a long version (.version) and a long part
    // (.seg.is-long, .ver) break; a package chip (.pkg) wraps only between
    // its unbreakable parts.
    it('never makes a short chip wrappable, in the PDF or the preview', () => {
      const rules = (css: string) =>
        [
          ...css
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .matchAll(/([^{}]+)\{([^{}]*)\}/g),
        ].map(([, selectors, body]) => ({
          selectors: selectors.split(',').map((s) => s.trim()),
          body: body.trim(),
        }));
      // Its subject is a chip and nothing more (a tag at most, `a.code-chip`).
      const plainChip = /(^|[\s>+~])[a-z]*\.code-chip$/;
      const wraps =
        /white-space: (normal|pre-wrap|break-spaces)|overflow-wrap: anywhere|word-break: break-all/;
      for (const forPdf of [true, false]) {
        const doc = renderReportDocument({ title: 't', forPdf, body: '' });
        const style = /<style>([\s\S]*?)<\/style>/.exec(doc)?.[1] ?? '';
        expect(style).toContain(REPORT_LAYOUT_CSS);
        const offending = rules(style).filter(
          ({ selectors, body }) =>
            selectors.some((s) => plainChip.test(s)) && wraps.test(body),
        );
        expect(offending).toEqual([]);
      }
    });
  });

  describe('renderCover', () => {
    const html = renderCover({
      eyebrow: 'Security report',
      title: 'OWASP Top 10',
      subtitle: 'Mapped to the <2021> edition',
      meta: [
        { label: 'Project', value: 'vitality-api' },
        { label: 'Branch', value: '<main>' },
      ],
    });

    it('puts the brand, the title and the metadata grid in the cover band', () => {
      expect(html).toContain('class="cover"');
      expect(html).toContain('data:image/png;base64,');
      expect(html).toContain('<h1>OWASP Top 10</h1>');
      expect(html).toMatch(
        /cover-meta[\s\S]*Project[\s\S]*vitality-api[\s\S]*Branch/,
      );
    });

    it('escapes every text field', () => {
      expect(html).toContain('&lt;2021&gt;');
      expect(html).toContain('&lt;main&gt;');
      expect(html).not.toContain('<main>');
    });
  });

  describe('renderCover — layout', () => {
    it('gives the first column more room so a project id stays on one line', () => {
      const html = renderCover({
        eyebrow: 'x',
        title: 't',
        meta: [
          {
            label: 'Project',
            value: 'p',
            sub: '00000000-0000-4000-8000-000000000001',
          },
          { label: 'Branch', value: 'b' },
          { label: 'Generated', value: 'g' },
        ],
      });
      // A « 1fr » track (automatic minimum) keeps an unbreakable value in its
      // column when the preview is narrower than the PDF; « minmax(0, 1fr) » let it
      // overflow onto its neighbour. The first one also keeps the identifier's
      // width (see « project id in the preview »).
      expect(html).toMatch(
        /<dl class="cover-meta" style="--cover-columns: minmax\(clamp\([\d.]+px, 100% - [\d.]+px, [\d.]+px\), 1\.3fr\) 1fr 1fr;/,
      );
      expect(REPORT_LAYOUT_CSS).toMatch(
        /\.cover-meta \{[^}]*grid-template-columns: var\(--cover-columns\);/,
      );
    });
  });

  // Cover of a project or branch with a long name (stress fixture): Chromium
  // used to break the value AFTER its dashes, mid-word at « _ » and « . », in
  // a narrow column (5 to 6 lines) next to half-empty columns.
  describe('renderCover — long values', () => {
    const PROJECT =
      'acme-corp-customer-identity-and-access-management-platform-backend-services';
    const UUID = 'f3b1c2d4-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
    const BRANCH =
      'feature/PLAT-48213-migrate-imagemagick-thumbnail-pipeline-to-libvips-and-harden-upload-path-validation';
    const DATE = '24 Sep 2026, 13:21 UTC';
    const meta = (branch: string) => [
      { label: 'Project', value: PROJECT, sub: UUID },
      { label: 'Branch', value: branch },
      { label: 'Generated', value: DATE },
      { label: 'Scope', value: '7 scanner families' },
    ];
    const cover = (branch = BRANCH) =>
      renderCover({ eyebrow: 'x', title: 't', meta: meta(branch) });
    const dd = (html: string, label: string) =>
      new RegExp(`<dt>${label}</dt><dd([^>]*)>([\\s\\S]*?)</dd>`).exec(html);
    const copied = (html: string) =>
      html
        .replace(/<[^>]*>/g, '')
        .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(+n))
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"');
    // The shares (fr) and the minimums of the computed tracks,
    // `minmax(<min>px, <part>fr)`.
    const columnsOf = (html: string) =>
      /--cover-columns: ([^;"]*);/.exec(html)[1];
    const numbers = (text: string, re: RegExp) =>
      [...text.matchAll(re)].map((m) => Number(m[1]));
    const tracks = (html: string) => numbers(columnsOf(html), /([\d.]+)fr/g);
    const minimums = (html: string) =>
      numbers(columnsOf(html), /minmax\(([\d.]+)px, [\d.]+fr\)/g);

    it('breaks a long value and its identifier before their separators, a short value untouched', () => {
      const html = cover('feature/PLAT-48213-migrate-imagemagick');
      expect(dd(html, 'Project')[2]).toBe(
        `${breakableId(PROJECT)}<span class="sub id">${breakableId(UUID)}</span>`,
      );
      expect(dd(html, 'Branch')[2]).toBe(
        breakableId('feature/PLAT-48213-migrate-imagemagick'),
      );
      expect(html).toContain(`<dd class="short">${DATE}</dd>`);
      expect(copied(dd(html, 'Project')[2])).toBe(`${PROJECT}${UUID}`);
    });

    it('breaks prose at its spaces and the identifiers it names at their pieces', () => {
      const scanned =
        'Scanned: feature/PLAT_48213_migrate_imagemagick_thumbnail, main and container images';
      const html = renderCover({
        eyebrow: 'x',
        title: 't',
        meta: [
          { label: 'Organization', value: 'Acme Corp' },
          { label: 'Branches', value: 'All branches', sub: scanned },
        ],
      });
      expect(html).toContain(
        `<span class="sub">Scanned: ${breakableId('feature/PLAT_48213_migrate_imagemagick_thumbnail,')} main and container images</span>`,
      );
    });

    // Columns at the width of their content: short values at their width, the
    // remaining room to the long ones, so that the tallest fits on the fewest
    // lines possible (three at most).
    it('sizes the columns to their content, the short values on one line', () => {
      const html = cover();
      const [project, branch, generated, scope] = tracks(html);
      // The tracks are in PDF pixels: they fill the grid.
      expect(project + branch + generated + scope).toBeGreaterThan(580);
      expect(project + branch + generated + scope).toBeLessThan(588);
      // The date (123.6 px measured) and « 7 scanner families » (95.3 px) at their
      // width, the rest to the two long values.
      expect(generated).toBeGreaterThan(126);
      expect(generated).toBeLessThan(140);
      expect(scope).toBeLessThan(140);
      expect(project + branch).toBeGreaterThan(340);
      // At most three lines: 16.5 px per value line, 12 px per identifier line,
      // 14.75 px of label. The old grid left the branch on five lines (97.25 px).
      expect(coverMetaHeight(meta(BRANCH))).toBeLessThanOrEqual(
        14.75 + 3 * 16.5 + 12,
      );
    });

    it('keeps the grid of a cover whose values hold in it, and measures its height', () => {
      const normal = [
        {
          label: 'Project',
          value: 'vitality-api',
          sub: '00000000-0000-4000-8000-000000000001',
        },
        { label: 'Branch', value: 'All branches' },
        { label: 'Generated', value: DATE },
        { label: 'Scope', value: '7 scanner families' },
      ];
      // The shares of the original grid (1.3fr then 1fr), the first bounded by
      // the project identifier for the preview.
      const original =
        /--cover-columns: minmax\(clamp\([^)]*\), 1\.3fr\) 1fr 1fr 1fr;/;
      expect(renderCover({ eyebrow: 'x', title: 't', meta: normal })).toMatch(
        original,
      );
      expect(coverMetaHeight(normal)).toBeCloseTo(14.75 + 16.5 + 12, 1);
      // « SAST, IaC, SCA, Container »: 135.3 px measured in a 135.8 px column. The
      // model estimates it at 136.2 px (kerning): the original grid, which holds
      // it, stays.
      const scoped = [
        ...normal.slice(0, 3),
        { label: 'Scope', value: 'SAST, IaC, SCA, Container' },
      ];
      expect(renderCover({ eyebrow: 'x', title: 't', meta: scoped })).toMatch(
        original,
      );
      expect(coverMetaHeight(scoped)).toBeCloseTo(14.75 + 16.5 + 12, 1);
      expect(coverMetaHeight(meta(BRANCH))).toBeGreaterThan(
        coverMetaHeight(normal),
      );
    });

    // Chromium breaks at a <wbr> even in `nowrap`: the identifier no longer
    // reserves its width, the grid gives it. A template that prints it larger
    // (EU AI Act: 9 px, 194 px) tells the grid.
    it('gives the project id the room of its size, 8 px unless told otherwise', () => {
      const eu = [
        {
          label: 'Project',
          value: 'ml-recommender',
          sub: '00000000-0000-4000-8000-000000000002',
        },
        {
          label: 'Branch',
          value: 'All branches',
          sub: 'main, plus unbranched scans',
        },
        { label: 'Generated', value: DATE },
        { label: 'Scope', value: 'AI-BOM', sub: 'Last scan 20 May 2026' },
      ];
      expect(renderCover({ eyebrow: 'x', title: 't', meta: eu })).toMatch(
        /--cover-columns: minmax\(clamp\([^)]*\), 1\.3fr\) 1fr 1fr 1fr;/,
      );
      const html = renderCover({
        eyebrow: 'x',
        title: 't',
        meta: eu,
        idFontPx: 9,
      });
      const [project] = tracks(html);
      expect(project).toBeGreaterThan(36 * 5.4);
      // Identifier and notes on one line: 14.75 + 16.5 + 13.5 px.
      expect(coverMetaHeight(eu, { idFontPx: 9 })).toBeCloseTo(44.75, 1);
    });

    // « Scanned: main and container images » used to take two lines in a 136 px
    // column, next to half-empty columns.
    it('widens the column of a sub-line that does not hold in its share', () => {
      const html = renderCover({
        eyebrow: 'x',
        title: 't',
        meta: [
          { label: 'Organization', value: 'Acme Corp' },
          { label: 'Projects', value: '4' },
          {
            label: 'Branches',
            value: 'All branches',
            sub: 'Scanned: main and container images',
          },
          { label: 'Generated', value: DATE },
        ],
      });
      const [, , branches, generated] = tracks(html);
      // 154.4 px measured, plus the model's margin.
      expect(branches).toBeGreaterThan(157);
      expect(generated).toBeGreaterThan(126);
    });

    it('elides the middle of a value beyond three lines, the full value in its title', () => {
      const huge = `release/${'payments_gateway_timeout_retry_backoff_'.repeat(8)}end`;
      const html = cover(huge);
      const [, attrs, shown] = dd(html, 'Branch');
      expect(attrs).toBe(` title="${huge}"`);
      const text = copied(shown);
      expect(text).toContain('…');
      expect(text.length).toBeLessThan(huge.length);
      expect(huge.startsWith(text.split('…')[0])).toBe(true);
      expect(huge.endsWith(text.split('…')[1])).toBe(true);
      // Cut between two pieces, never in the middle of a word.
      expect(text.split('…')[1]).toMatch(/^_/);
      expect(coverMetaHeight(meta(huge))).toBeLessThanOrEqual(
        14.75 + 3 * 16.5 + 12,
      );
    });

    // Preview narrower than the PDF: the tracks shrink in proportion, and a
    // narrow column (« SAST, IaC, SCA, Container » on three lines, 57 px) cut
    // « Contain | er » mid-word. Each track keeps the width of its longest
    // piece.
    it('keeps each computed column at least as wide as its longest word or piece', () => {
      const html = renderCover({
        eyebrow: 'x',
        title: 't',
        meta: [
          { label: 'Project', value: PROJECT, sub: UUID },
          { label: 'Branch', value: BRANCH },
          { label: 'Generated', value: DATE },
          { label: 'Scope', value: 'SAST, IaC, SCA, Container' },
        ],
      });
      const mins = minimums(html);
      expect(mins).toHaveLength(4);
      // « Container » : 54,6 px ; « 24 Sep 2026, 13:21 UTC » : 123,6 px.
      expect(mins[3]).toBeGreaterThan(54.6);
      expect(mins[2]).toBeGreaterThan(123.6);
      // In the PDF, each track exceeds its minimum.
      tracks(html).forEach((part, i) =>
        expect(part).toBeGreaterThanOrEqual(mins[i]),
      );
    });

    it('never elides a value that holds on three lines', () => {
      const branch =
        'feature/PLAT-48213-migrate-imagemagick-thumbnail-pipeline';
      const html = cover(branch);
      expect(dd(html, 'Branch')[1]).toBe('');
      expect(copied(dd(html, 'Branch')[2])).toBe(branch);
      expect(copied(dd(html, 'Project')[2])).toBe(`${PROJECT}${UUID}`);
    });

    // The stress fixture's 102-character branch does not fit in three lines in
    // any distribution that keeps the cover at its lowest height (the project on
    // three lines, its identifier on one): its middle is elided, between two
    // pieces.
    it('elides the middle of the stress branch, never the project nor its id', () => {
      const html = cover();
      const [, attrs, shown] = dd(html, 'Branch');
      expect(attrs).toBe(` title="${BRANCH}"`);
      const [head, tail] = copied(shown).split('…');
      expect(BRANCH.startsWith(head)).toBe(true);
      expect(BRANCH.endsWith(tail)).toBe(true);
      expect(head).toMatch(/^feature\/PLAT-48213-migrate/);
      expect(tail).toMatch(/^-[a-z]+-/);
      expect(tail).toMatch(/-upload-path-validation$/);
      expect(head.length + tail.length).toBeGreaterThan(75);
      expect(dd(html, 'Project')[1]).toBe('');
    });

    // A list (« Scanned: a, b », « a and b, plus unbranched scans ») is never
    // elided in the middle of an item: elided in the middle, it merged two
    // branches into a name that does not exist (« …-pipeline-to…/payments_
    // gateway_… ») or made one disappear (« and…_to_libvips »). It keeps whole
    // items and states the rest.
    describe('a list in a sub-line', () => {
      const FIRST =
        'feature/PLAT-48213-migrate-imagemagick-thumbnail-pipeline-to-libvips-and-harden-upload-path-validation';
      const SECOND =
        'release/2026.09.28/payments_gateway_timeout_retry_backoff_and_idempotency_keys_rework';
      const sub = (html: string, label: string) =>
        new RegExp(
          `<dt>${label}</dt><dd[^>]*>[\\s\\S]*?<span class="sub"([^>]*)>([\\s\\S]*?)</span></dd>`,
        ).exec(html);
      // The items of a displayed list, its rest counted.
      const itemsOf = (text: string) => {
        const [, shown, more] = /^(.*?)(?: and (\d+) more)?$/.exec(text);
        return { shown: shown.split(/, | and /), more: Number(more ?? 0) };
      };

      it('keeps whole items and says how many are left, never an ellipsis inside an item', () => {
        const scanned = `Scanned: ${FIRST}, ${SECOND}`;
        const html = renderCover({
          eyebrow: 'x',
          title: 't',
          meta: [
            {
              label: 'Organization',
              value:
                'Acme Corporation Global Customer Identity and Access Management Division (EMEA)',
            },
            { label: 'Projects', value: '3' },
            { label: 'Branches', value: 'All branches', sub: scanned },
            { label: 'Generated', value: DATE },
          ],
        });
        const [, attrs, shown] = sub(html, 'Branches');
        const text = copied(shown);
        expect(text).not.toContain('…');
        expect(text).toBe(`Scanned: ${FIRST} and 1 more`);
        expect(attrs).toBe(` title="${scanned}"`);
        // Each item stays breakable at its break points.
        expect(shown).toContain(breakableId(FIRST));
      });

      it('never drops the head of a branch between two others (EU AI Act)', () => {
        const branches = `release/2026.09.x-hotfix_candidate_for_customer_identity_platform and feature/PLAT_48213_migrate_imagemagick_thumbnail_pipeline_to_libvips_and_harden_upload_path_validation, plus unbranched scans`;
        const html = renderCover({
          eyebrow: 'x',
          title: 't',
          idFontPx: 9,
          meta: [
            {
              label: 'Project',
              value:
                'acme_corp.customer_identity_and_access_management.platform_backend_services_monorepo.eu_west_1_production_mirror',
              sub: UUID,
            },
            { label: 'Branch', value: 'All branches', sub: branches },
            { label: 'Generated', value: DATE },
            { label: 'Scope', value: 'AI-BOM', sub: 'Last scan 20 May 2026' },
          ],
        });
        const text = copied(sub(html, 'Branch')[2]);
        expect(text).not.toContain('…');
        const { shown, more } = itemsOf(text);
        const all = branches.split(/, | and /);
        expect(shown.length + more).toBe(all.length);
        shown.forEach((item, i) => expect(item).toBe(all[i]));
      });

      it('prints a list that holds on three lines whole, unchanged', () => {
        const scanned = `Scanned: ${FIRST}, main and container images`;
        const html = renderCover({
          eyebrow: 'x',
          title: 't',
          meta: [
            { label: 'Organization', value: 'Acme Corp' },
            { label: 'Projects', value: '4' },
            { label: 'Branches', value: 'All branches', sub: scanned },
            { label: 'Generated', value: DATE },
          ],
        });
        const [, attrs, shown] = sub(html, 'Branches');
        expect(attrs).toBe('');
        expect(copied(shown)).toBe(scanned);
      });

      // A single value that is too long is, on the other hand, elided in its middle.
      it('elides a single item too long for three lines in its middle, the rest still counted', () => {
        const huge = `release/${'payments_gateway_timeout_retry_backoff_'.repeat(8)}end`;
        const html = renderCover({
          eyebrow: 'x',
          title: 't',
          meta: [
            { label: 'Project', value: PROJECT, sub: UUID },
            { label: 'Branch', value: 'All branches', sub: `${huge} and main` },
            { label: 'Generated', value: DATE },
            { label: 'Scope', value: '7 scanner families' },
          ],
        });
        const text = copied(sub(html, 'Branch')[2]);
        expect(text).toMatch(
          /^release\/payments_gateway_[^ ]*…[^ ]*_end and 1 more$/,
        );
      });
    });

    it('escapes the full value it puts in the title', () => {
      const html = cover(`${'x'.repeat(200)}"<b>&`);
      expect(dd(html, 'Branch')[1]).toBe(
        ` title="${'x'.repeat(200)}&quot;&lt;b&gt;&amp;"`,
      );
      expect(html).not.toContain('<b>');
    });
  });

  // Dashboard preview (iframe of 840 px and less): the date used to run into
  // SCOPE (« 13:21 UTC7 scanner families »). Four columns while they fit, two
  // below, and a short value breaks at its spaces there rather than overflow.
  describe('renderCover — narrow preview', () => {
    // The project identifier breaks before its dashes (<wbr>, which Chromium
    // honours even in `nowrap`) instead of widening its column: under a short,
    // unbreakable name, its 173 px pushed the date out of its own.
    it('folds the grid into two columns on a narrow screen, earlier for a tight cover', () => {
      // Two columns: the ones renderCover computes when the project identifier
      // must keep its line there, two equal shares otherwise.
      const two =
        'grid-template-columns: var\\(--cover-narrow-columns, repeat\\(2, minmax\\(0, 1fr\\)\\)\\);';
      expect(REPORT_LAYOUT_CSS).toMatch(
        new RegExp(
          `@media screen and \\(max-width: 950px\\) \\{ \\.cover-meta\\.is-tight \\{ ${two} \\} \\.cover-meta\\.is-tight dd\\.short \\{ white-space: normal; \\} \\}`,
        ),
      );
      expect(REPORT_LAYOUT_CSS).not.toMatch(/\.sub\.id \{ white-space: normal/);
      expect(REPORT_LAYOUT_CSS).toMatch(
        new RegExp(
          `@media screen and \\(max-width: 780px\\) \\{ \\.cover-meta \\{ ${two} \\} \\.cover-meta dd\\.short \\{ white-space: normal; \\} \\}`,
        ),
      );
    });

    it('marks a cover whose one-line values would not hold four columns at 780 px', () => {
      const tight = renderCover({
        eyebrow: 'x',
        title: 't',
        meta: [
          { label: 'Project', value: 'Customer Portal Backend' },
          { label: 'Branch', value: 'release/2026.09-hotfix-1' },
          { label: 'Generated', value: '24 Sep 2026, 13:21 UTC' },
          { label: 'Scope', value: 'SAST, IaC, SCA, Secrets' },
        ],
      });
      expect(tight).toContain('<dl class="cover-meta is-tight"');
      // The identifier of a project with a short name counts (see « project id in
      // the preview »): next to a 24-character branch, four columns do not hold it
      // even at 840 px.
      const withId = renderCover({
        eyebrow: 'x',
        title: 't',
        meta: [
          {
            label: 'Project',
            value: 'vitality-api',
            sub: '00000000-0000-4000-8000-000000000001',
          },
          { label: 'Branch', value: 'release/2026.09-hotfix-1' },
          { label: 'Generated', value: '24 Sep 2026, 13:21 UTC' },
          { label: 'Scope', value: '7 scanner families' },
        ],
      });
      expect(withId).toContain('<dl class="cover-meta is-tight"');
      const loose = renderCover({
        eyebrow: 'x',
        title: 't',
        meta: [
          { label: 'Project', value: 'vitality-api' },
          { label: 'Branch', value: 'All branches' },
          { label: 'Generated', value: '24 Sep 2026, 13:21 UTC' },
          { label: 'Scope', value: '7 scanner families' },
        ],
      });
      expect(loose).toContain('<dl class="cover-meta" ');
    });
  });

  // Dashboard preview between 800 and 900 px (the modal is 840): the project
  // UUID used to break in two (a 48 px cell instead of 34) next to a
  // three-quarters empty BRANCH column. The unbreakable date took its width
  // and the project column fell below the UUID's: a <wbr> does not reserve its
  // width.
  describe('renderCover — project id in the preview (R3-02)', () => {
    const UUID = '00000000-0000-4000-8000-000000000001';
    const DATE = '24 Sep 2026, 13:21 UTC';
    // 36 characters of JetBrains Mono (0.6 em) at 8 px, and at 9 px.
    const UUID_PX = 36 * 0.6 * 8;
    const UUID_9_PX = 36 * 0.6 * 9;
    const scanner = [
      { label: 'Project', value: 'vitality-api', sub: UUID },
      { label: 'Branch', value: 'All branches' },
      { label: 'Generated', value: DATE },
      { label: 'Scope', value: '7 scanner families' },
    ];
    const owasp = [
      ...scanner.slice(0, 3),
      { label: 'Scope', value: 'SAST, IaC, SCA, Container' },
    ];
    const eu = [
      { label: 'Project', value: 'ml-recommender', sub: UUID },
      {
        label: 'Branch',
        value: 'All branches',
        sub: 'main, plus unbranched scans',
      },
      { label: 'Generated', value: DATE },
      { label: 'Last AI-BOM scan', value: '20 May 2026' },
    ];
    const cover = (meta: typeof scanner, idFontPx?: number) =>
      renderCover({ eyebrow: 'x', title: 't', meta, idFontPx });
    // Floor of the first track: `minmax(clamp(<longest piece>,
    // 100% - <minimums of the others, gaps included>, <UUID>), <share>)`.
    const floorOf = (html: string) => {
      const m =
        /--cover-columns: minmax\(clamp\(([\d.]+)px, 100% - ([\d.]+)px, ([\d.]+)px\), ([\d.]+)fr\)/.exec(
          html,
        );
      return m && { min: +m[1], others: +m[2], id: +m[3], part: +m[4] };
    };
    const narrowOf = (html: string) =>
      /--cover-narrow-columns: ([^;"]*);/.exec(html)?.[1] ?? null;
    // Preview grid (gaps included) at an iframe width, 15 px scrollbar
    // included: (width − 15 − 2 × 16) / 1.13 − 2 × 53 − 2 × 28.
    const gridAt = (iframe: number) => (iframe - 15 - 32) / 1.13 - 106 - 56;

    it('gives the first column the width of the whole id, never more than its share of the PDF', () => {
      const floor = floorOf(cover(scanner));
      expect(floor).not.toBeNull();
      expect(floor.id).toBeGreaterThanOrEqual(UUID_PX);
      // In the PDF, the original share (1.3 / 4.3 of 583 px, 176.3 px) already
      // holds it: the printed cover does not change.
      expect(floor.id).toBeLessThanOrEqual((583 * 1.3) / 4.3);
      // The other cells keep their minimum: the date (123.6 px measured),
      // « 7 scanner families » (95.3 px), « All branches », three gaps.
      expect(floor.others).toBeGreaterThan(3 * 16 + 123.6 + 95.3 + 60);
      expect(floor.min).toBeLessThan(floor.id);
      expect(coverMetaHeight(scanner)).toBeCloseTo(14.75 + 16.5 + 12, 1);
    });

    it('keeps four columns at the width of the dashboard modal (840 px)', () => {
      for (const meta of [scanner, owasp]) {
        const floor = floorOf(cover(meta));
        expect(floor.id + floor.others).toBeLessThanOrEqual(gridAt(840));
      }
      const floor = floorOf(cover(eu, 9));
      expect(floor.id).toBeGreaterThanOrEqual(UUID_9_PX);
      expect(floor.id).toBeLessThanOrEqual(floor.part);
      expect(floor.id + floor.others).toBeLessThanOrEqual(gridAt(840));
    });

    // Four columns that no longer hold the whole UUID at 780 px go to two below
    // the modal's width: the UUID keeps its line there.
    it('folds into two columns under 840 px a cover whose id would not hold four columns at 780 px', () => {
      expect(cover(scanner)).toContain('<dl class="cover-meta is-snug"');
      expect(cover(eu, 9)).toContain('<dl class="cover-meta is-snug"');
      expect(cover(owasp)).toContain('<dl class="cover-meta" ');
      expect(REPORT_LAYOUT_CSS).toMatch(
        /@media screen and \(max-width: 839px\) \{ \.cover-meta\.is-snug \{ grid-template-columns: var\(--cover-narrow-columns, repeat\(2, minmax\(0, 1fr\)\)\); \} \.cover-meta\.is-snug dd\.short \{ white-space: normal; \} \}/,
      );
    });

    // Sur deux colonnes de 180 px (iframe de 640 px), l'UUID de 9 px
    // (194,4 px) se coupait.
    it('keeps the id whole on two columns while the other column keeps its longest word', () => {
      const narrow = narrowOf(cover(eu, 9));
      const m =
        /^minmax\(min\(([\d.]+)px, 100% - ([\d.]+)px\), 1fr\) minmax\(0, 1fr\)$/.exec(
          narrow,
        );
      expect(m).not.toBeNull();
      expect(+m[1]).toBeGreaterThanOrEqual(UUID_9_PX);
      // The gap and the longest word of the other column (« LAST AI-BOM SCAN » in
      // letter-spaced capitals, 93 px).
      expect(+m[2]).toBeGreaterThan(16 + 90);
      expect(+m[1] + +m[2]).toBeLessThanOrEqual(gridAt(640));
    });

    it('leaves a cover without project id as it was', () => {
      const html = renderCover({
        eyebrow: 'x',
        title: 't',
        meta: [
          { label: 'Organization', value: 'Acme Corp' },
          { label: 'Projects', value: '3' },
          { label: 'Branches', value: 'All branches', sub: 'Scanned: main' },
          { label: 'Generated', value: DATE },
        ],
      });
      expect(html).toContain(
        '<dl class="cover-meta" style="--cover-columns: 1.3fr repeat(3, 1fr);">',
      );
    });

    // Under a long name, already on several lines, the column's room goes to
    // the name and its neighbours (stress fixture: the branch went from 4 to 6
    // lines at 840 px for one UUID line).
    it('lets the id of a long project name break before its hyphens, as before', () => {
      const html = cover([
        {
          label: 'Project',
          value:
            'acme-corp-customer-identity-and-access-management-platform-backend-services',
          sub: UUID,
        },
        {
          label: 'Branch',
          value:
            'feature/PLAT-48213-migrate-imagemagick-thumbnail-pipeline-to-libvips-and-harden-upload-path-validation',
        },
        { label: 'Generated', value: DATE },
        { label: 'Scope', value: '7 scanner families' },
      ]);
      expect(html).not.toContain('clamp(');
      expect(narrowOf(html)).toBeNull();
      expect(html).toContain('<dl class="cover-meta" ');
    });
  });

  describe('renderCover — sub-lines', () => {
    it('sets an identifier in small mono and prose in the body font', () => {
      const html = renderCover({
        eyebrow: 'x',
        title: 't',
        meta: [
          {
            label: 'Project',
            value: 'p',
            sub: '00000000-0000-4000-8000-000000000001',
          },
          {
            label: 'Branch',
            value: 'All branches',
            sub: 'main and scans without a branch',
          },
        ],
      });
      // An identifier of more than 24 characters breaks BEFORE its dashes.
      expect(html).toContain(
        `<span class="sub id">${breakableId('00000000-0000-4000-8000-000000000001')}</span>`,
      );
      // readable in print: 7.5px at 62% white was below the type scale
      expect(REPORT_LAYOUT_CSS).toMatch(
        /\.cover-meta dd \.sub\.id \{[^}]*font-size: 8px;[^}]*color: rgba\(255, 255, 255, 0\.72\)/,
      );
      expect(html).toContain(
        '<span class="sub">main and scans without a branch</span>',
      );
    });
  });

  describe('renderCover — short values', () => {
    it('keeps a short value such as a date on one line', () => {
      const html = renderCover({
        eyebrow: 'x',
        title: 't',
        meta: [
          { label: 'Generated', value: '23 Sep 2026, 09:43 UTC' },
          {
            label: 'Scope',
            value: 'SAST, IaC, SCA, Container, Secrets, CI/CD',
          },
        ],
      });
      expect(html).toContain('<dd class="short">23 Sep 2026, 09:43 UTC');
      expect(html).toContain('<dd>SAST, IaC, SCA, Container, Secrets, CI/CD');
    });

    // « Scanned: main and container images » under a short value ran out of
    // its column (and a long branch name off the page): the one-line rule of
    // a short value must not reach its sub-line.
    it('lets the sub-line of a short value wrap', () => {
      expect(REPORT_LAYOUT_CSS).toMatch(
        /\.cover-meta dd \.sub \{[^}]*white-space: normal;[^}]*text-wrap: pretty;/,
      );
      // a project id stays on one line under a short value: it widens the
      // first column (see above)
      expect(REPORT_LAYOUT_CSS).toMatch(
        /\.cover-meta dd \.sub\.id \{[^}]*white-space: inherit;/,
      );
    });
  });

  describe('sectionHead', () => {
    it('renders eyebrow, title and aside', () => {
      const html = sectionHead({
        eyebrow: 'A01',
        title: 'Broken <Access>',
        aside: '5 findings',
      });
      expect(html).toContain('class="section-head"');
      expect(html).toContain('<div class="eyebrow">A01</div>');
      expect(html).toContain('<h2>Broken &lt;Access&gt;</h2>');
      expect(html).toContain('5 findings');
    });
  });

  describe('kpiTiles', () => {
    it('can give the lead tile more room', () => {
      const html = kpiTiles(
        [
          { label: 'Open findings', value: 139 },
          { label: 'Critical', value: 7, severity: 'critical' },
          { label: 'High', value: 62, severity: 'high' },
        ],
        { leadWidth: 1.6 },
      );
      expect(html).toContain(
        'grid-template-columns: 1.6fr repeat(2, minmax(0, 1fr));',
      );
    });

    it('renders one tile per item, severity tiles carrying the severity colour', () => {
      const html = kpiTiles([
        { label: 'Total', value: 343 },
        { label: 'Critical', value: 31, severity: 'critical' },
      ]);
      expect(html.match(/class="kpi[ "]/g)).toHaveLength(2);
      expect(html).toContain('>343<');
      expect(html).toContain('#d92d20');
    });

    it('draws a thin border on a neutral tile and a coloured one on a toned tile', () => {
      const html = kpiTiles([
        { label: 'Total', value: 3 },
        { label: 'Minimal', value: 2, tone: 'success' },
      ]);
      expect(html).toContain('class="kpi is-neutral"');
      // a straight accent bar painted as background (a 3px border against the
      // radius drew a crescent)
      expect(html).toMatch(/class="kpi" style="--kpi-accent: #12b76a;"/);
      expect(REPORT_LAYOUT_CSS).toMatch(
        /\.kpi \{[^}]*linear-gradient\(90deg, var\(--kpi-accent/,
      );
      expect(REPORT_LAYOUT_CSS).not.toMatch(
        /\.kpi \{[^}]*border-left-width: 3px/,
      );
      // a tile without accent paints white there: a hard stop from
      // `transparent` (transparent black) drew a dark hairline once antialiased
      expect(REPORT_LAYOUT_CSS).toMatch(/var\(--kpi-accent, #fff\)/);
      // painted once from the border edge: a repeated gradient leaked a 1px
      // accent line under the right border
      expect(REPORT_LAYOUT_CSS).toMatch(
        /\.kpi \{[^}]*background-repeat: no-repeat/,
      );
      expect(REPORT_LAYOUT_CSS).toMatch(
        /\.callout \{[^}]*background-repeat: no-repeat/,
      );
    });

    it('can grey out a zero on a tile without severity', () => {
      const html = kpiTiles([
        { label: 'Classified', value: 0, muteZero: true },
      ]);
      expect(html).toContain('kpi is-zero');
    });

    it('greys out a zero severity instead of shouting it in alert colours', () => {
      const html = kpiTiles([
        { label: 'Critical', value: 0, severity: 'critical' },
      ]);
      expect(html).toContain('kpi is-zero');
    });
  });

  describe('dataTable', () => {
    it('renders headers, rows and a colgroup (fixed layout) when widths are given', () => {
      const html = dataTable({
        columns: [
          { label: 'Rank', width: '8%' },
          { label: 'Name' },
          { label: 'Count', align: 'right', width: '12%' },
        ],
        rows: [['1', 'XSS', '4']],
      });
      expect(html).toContain('<table class="fixed">');
      expect(html).toContain('<col style="width: 8%">');
      expect(html).toContain('<th class="right">Count</th>');
      expect(html).toContain('<td class="right">4</td>');
    });

    it('accepts a class per row (e.g. a total row)', () => {
      const html = dataTable({
        columns: [{ label: 'A' }],
        rows: [['x'], ['Total']],
        rowClasses: ['', 'total'],
      });
      expect(html).toContain(
        '<tr><td>x</td></tr><tr class="total"><td>Total</td></tr>',
      );
    });

    it('names what a table continues on the next page (hidden on the first one)', () => {
      const html = dataTable({
        columns: [{ label: 'A' }, { label: 'B' }],
        rows: [['x', 'y']],
        continuation: 'SQL injection <continued>',
      });
      expect(html).toContain('<table class="has-cont">');
      expect(html).toContain(
        '<thead><tr class="cont-row" aria-hidden="true"><th colspan="2">SQL injection &lt;continued&gt;</th></tr><tr><th>A</th>',
      );
    });

    it('keeps the automatic layout without widths', () => {
      const html = dataTable({ columns: [{ label: 'A' }], rows: [['x']] });
      expect(html).toContain('<table>');
      expect(html).not.toContain('<colgroup>');
    });
  });

  describe('dataTable — full-width rows and continuation', () => {
    it('renders a full-width row spanning every column', () => {
      const html = dataTable({
        columns: [{ label: 'A' }, { label: 'B' }, { label: 'C' }],
        rows: [['1', '2', '3'], { full: '<em>note</em>', className: 'note' }],
      });
      expect(html).toContain(
        '<tr class="note"><td colspan="3"><em>note</em></td></tr>',
      );
    });

    it('keeps the continuation label off the header bar and aligned with the cells', () => {
      expect(REPORT_LAYOUT_CSS).toMatch(
        /thead tr\.cont-row\s*\{[^}]*background:\s*none/,
      );
      expect(REPORT_LAYOUT_CSS).toMatch(
        /\.cont-row th\s*\{[^}]*padding:\s*0 10px 3px/,
      );
    });

    it('hides the continuation row under blank padding, never under a line of text', () => {
      const px = (re: RegExp) => Number(re.exec(REPORT_LAYOUT_CSS)?.[1]);
      const rowHeight = px(/\.cont-row th \{[^}]*?(?<![-\w])height: (\d+)px/);
      const pullUp = px(/table\.has-cont \{[^}]*margin-top: -(\d+)px/);
      const coverPadding = px(/\.cont-cover \{[^}]*padding-bottom: (\d+)px/);
      expect(pullUp).toBe(rowHeight);
      // the whole hidden row sits in the cover's bottom padding, so its text
      // never overlaps (nor interleaves in extraction with) the cover's text
      expect(coverPadding).toBeGreaterThanOrEqual(rowHeight);
      // the row's line box and bottom padding fit its declared height: at the
      // body line height (15px + 3px) the row grew to 18px and the foot of its
      // hidden text showed as a dot above the table header
      const lineHeight = px(/\.cont-row th \{[^}]*line-height: (\d+)px/);
      expect(lineHeight + 3).toBeLessThanOrEqual(rowHeight);
    });

    it('hides the continuation row from assistive tech', () => {
      const html = dataTable({
        columns: [{ label: 'A' }],
        rows: [['x']],
        continuation: 'Group',
      });
      expect(html).toContain('<tr class="cont-row" aria-hidden="true">');
    });
  });

  describe('packageChip', () => {
    it('breaks a package reference only before its version', () => {
      expect(packageChip('decode-uri-component', '0.2.0')).toBe(
        '<span class="code-chip pkg"><span class="seg">decode-uri-component</span><wbr><span class="seg">@0.2.0</span></span>',
      );
      expect(packageChip('<x>')).toBe(
        '<span class="code-chip pkg"><span class="seg">&lt;x&gt;</span></span>',
      );
    });

    // `@8:6.9.11.60+dfsg-1.6ubuntu1.3` had no break at all: it ran over the
    // next column. A long name now breaks at its separators (before them, a
    // hyphen kept with the next character), a long version only between its
    // parts (never inside a Debian revision nor between two digits), and
    // only when it does not fit a line of the chip (it is an inline block).
    it('lets a long name break at its separators and a long version between its parts, within its own part', () => {
      expect(
        packageChip('imagemagick-6-common', '8:6.9.11.60+dfsg-1.6ubuntu1.3'),
      ).toBe(
        '<span class="code-chip pkg"><span class="seg">imagemagick-6-common</span><wbr><span class="seg is-long"><span class="ver">@8:6.9.11.60<wbr>+dfsg<wbr><nobr>-1</nobr>.6ubuntu1.3</span></span></span>',
      );
      // A version of 24 characters or less is whole, even when « @ » makes
      // its part longer: a block that fits a line, cut anywhere only when
      // no line holds it.
      expect(packageChip('libssl3t64', '3.0.13-0ubuntu3.4.1.abcdefgh')).toBe(
        '<span class="code-chip pkg"><span class="seg">libssl3t64</span><wbr><span class="seg is-long"><span class="ver">@3.0.13<wbr><nobr>-0</nobr>ubuntu3.4.1.abcdefgh</span></span></span>',
      );
      expect(packageChip('libssl3t64', '3.0.13-0ubuntu3.4.1.abcd')).toBe(
        '<span class="code-chip pkg"><span class="seg">libssl3t64</span><wbr><span class="seg is-long"><span class="ver">@3.0.13-0ubuntu3.4.1.abcd</span></span></span>',
      );
      // Chicago: a long reference breaks BEFORE the « / » of a scope that is
      // itself long (more than 24 characters, a long part).
      const scoped = packageChip(
        '@very-long-organization-name/extremely-long-package-name-for-testing',
        '3.0.0-alpha.20260915.4f2d9c1e',
      );
      expect(scoped).toBe(
        '<span class="code-chip pkg"><span class="seg is-long">@very<wbr><nobr>-l</nobr>ong<wbr><nobr>-o</nobr>rganization<wbr><nobr>-n</nobr>ame</span><wbr><span class="seg is-long">/extremely<wbr><nobr>-l</nobr>ong<wbr><nobr>-p</nobr>ackage<wbr><nobr>-n</nobr>ame<wbr><nobr>-f</nobr>or<wbr><nobr>-t</nobr>esting</span><wbr><span class="seg is-long"><span class="ver">@3.0.0<wbr><nobr>-a</nobr>lpha.20260915.4f2d9c1e</span></span></span>',
      );
      // Never a fragment of fewer than three characters: `@1` stays with the part
      // before it.
      expect(
        packageChip(
          '@very-long-organization-name/extremely-long-package-name',
          '1',
        ),
      ).toMatch(
        /<span class="seg is-long">\/extremely[^<]*(?:<[^>]+>[^<]*)*ame@1<\/span><\/span>$/,
      );
      expect(packageChip('@nestjs/platform-express', '10.0.0')).toBe(
        '<span class="code-chip pkg"><span class="seg">@nestjs/</span><wbr><span class="seg">platform-express</span><wbr><span class="seg">@10.0.0</span></span>',
      );
      // The « / » of a short npm scope closes it (`@scope/`, like the `8:` epoch):
      // one convention for a short or long scoped name (« @opentelemetry /
      // /auto-instrumentations-node / 0.72.0 » took one more line than
      // « @opentelemetry/ / auto-… 0.72.0 »).
      expect(packageChip('@opentelemetry/auto-instrumentations-node')).toBe(
        '<span class="code-chip pkg"><span class="seg">@opentelemetry/</span><wbr><span class="seg is-long">auto<wbr><nobr>-i</nobr>nstrumentations<wbr><nobr>-n</nobr>ode</span></span>',
      );
      expect(packageChip('@opentelemetry/sdk-node')).toBe(
        '<span class="code-chip pkg"><span class="seg">@opentelemetry/</span><wbr><span class="seg">sdk-node</span></span>',
      );
      // Another « / » (a path, a model) stays broken before it.
      expect(packageChip('github.com/aws/aws-sdk-go-v2/service/s3')).toBe(
        '<span class="code-chip pkg"><span class="seg">github.com</span><wbr><span class="seg">/aws</span><wbr><span class="seg">/aws-sdk-go-v2</span><wbr><span class="seg">/service</span><wbr><span class="seg">/s3</span></span>',
      );
      expect(REPORT_LAYOUT_CSS).toMatch(
        /\.code-chip \.seg\.is-long \{[^}]*display: inline-block;[^}]*max-width: 100%;[^}]*white-space: normal;[^}]*overflow-wrap: anywhere;[^}]*text-indent: 0;/,
      );
    });

    // A template that flows a chip (`.seg.is-long { display: inline }`) also cut
    // its version: « …client@2.8.1 | -beta.3+build.20260928 » read as the stable
    // version 2.8.1. The version of a chip is a block of its own, which no
    // long-part rule touches: whole while it fits on a line, broken only between
    // its parts beyond that; short, never broken.
    it('keeps the version of a chip one block, whole while it fits a line, whatever a template does to the long parts', () => {
      const chip = packageChip(
        '@huggingface/inference-endpoint-client',
        '2.8.1-beta.3+build.20260928',
      );
      expect(chip).toContain(
        '<span class="seg is-long"><span class="ver">@2.8.1<wbr><nobr>-b</nobr>eta.3<wbr>+build.20260928</span></span>',
      );
      // The part that carries it stays a `seg is-long` (the markup the templates
      // measure); the block is inside.
      expect(chip).not.toMatch(/class="seg is-long">@/);
      expect(
        packageChip('@huggingface/inference-endpoint-client', '2.8.1'),
      ).toMatch(/<span class="seg">@2\.8\.1<\/span><\/span>$/);
      expect(REPORT_LAYOUT_CSS).toMatch(
        /\.code-chip \.ver \{[^}]*display: inline-block;[^}]*max-width: 100%;[^}]*white-space: normal;[^}]*overflow-wrap: anywhere;[^}]*text-indent: 0;[^}]*background: #f1eef6;/,
      );
    });
  });

  describe('pathText', () => {
    it('keeps the markup of a short path: a break after each slash', () => {
      expect(pathText('app/<views>/index.js:12')).toBe(
        '<span class="path"><span class="seg">app/</span><wbr><span class="seg">&lt;views&gt;/</span><wbr><span class="seg">index.js:12</span></span>',
      );
    });

    // Chicago: a long path breaks BEFORE its « / », the next line opening on
    // them.
    it('lets a long path break before its slashes, escaped, in the mono path style', () => {
      expect(pathText('app/<views>/index.html:12')).toBe(
        '<span class="path"><span class="seg">app</span><wbr><span class="seg">/&lt;views&gt;</span><wbr><span class="seg">/index.html:12</span></span>',
      );
    });

    // A segment of 25 to 40 characters stayed unbreakable and left its column,
    // clipping the line number (EU AI Act, « Found in »); longer, it broke at the
    // first separator that fitted, whereas the « / » before it was enough. It is
    // now an inline block: in one piece if it fits on a line, else broken at its
    // own separators.
    it('moves a long segment whole to the next line, cut at its own separators only when longer than a line', () => {
      expect(
        pathText(
          'images/azureml_05b92b0c3f062d7d80a0ae539d0c1321.dockerfile:12',
        ),
      ).toBe(
        '<span class="path"><span class="seg">images</span><wbr><span class="seg is-long">/azureml<wbr><span class="hex">_05b92b0c3f062d7d80a0ae539d0c1321</span><wbr>.dockerfile:12</span></span>',
      );
      expect(
        pathText(
          'services/huggingface/HuggingFaceTextGenerationInferenceClientFactory.py:7',
        ),
      ).toBe(
        '<span class="path"><span class="seg">services</span><wbr><span class="seg">/huggingface</span><wbr><span class="seg is-long">/Hugging<wbr>Face<wbr>Text<wbr>Generation<wbr>Inference<wbr>Client<wbr>Factory<wbr>.py:7</span></span>',
      );
      expect(REPORT_LAYOUT_CSS).toMatch(
        /\.path \.seg\.is-long \{[^}]*display: inline-block;[^}]*max-width: 100%;[^}]*white-space: normal;[^}]*overflow-wrap: anywhere;[^}]*text-indent: 0;/,
      );
    });

    // Chromium breaks between a hexadecimal block and the comma that follows it:
    // the punctuation of a path that ends with a fingerprint goes inside the
    // block.
    it('keeps the punctuation of a path ending in a hexadecimal run inside its block', () => {
      expect(
        pathText('images/azureml_05b92b0c3f062d7d80a0ae539d0c1321', {
          after: ',',
        }),
      ).toBe(
        '<span class="path"><span class="seg">images</span><wbr><span class="seg is-long">/azureml<wbr><span class="hex">_05b92b0c3f062d7d80a0ae539d0c1321,</span></span></span>',
      );
    });
  });

  describe('idText', () => {
    it('keeps a short identifier on one line', () => {
      expect(idText('CVE-2026-25965')).toBe(
        '<span class="id-text">CVE-2026-25965</span>',
      );
      expect(idText('<x>')).toBe('<span class="id-text">&lt;x&gt;</span>');
    });

    // An image reference in an advisory line ran past its column over the
    // package chips.
    it('lets a long identifier break at its separators, whole when it fits a line', () => {
      expect(
        idText(
          'e4feaa3fac914202b07ad1e0a3ad933e.azurecr.io/azureml/azureml_05b92b0c3f062d7d80a0ae539d0c1321:1',
        ),
      ).toBe(
        '<span class="id-box"><span class="id-text is-long"><span class="hex">e4feaa3fac914202b07ad1e0a3ad933e</span><wbr>.azurecr<wbr>.io<wbr>/azureml<wbr>/azureml<wbr><span class="hex">_05b92b0c3f062d7d80a0ae539d0c1321:1</span></span></span>',
      );
      expect(REPORT_LAYOUT_CSS).toMatch(
        /\.id-text \{[^}]*font-family: 'JetBrains Mono'[^}]*white-space: nowrap;/,
      );
      // Inline in its box (.id-box, inline block of the base CSS).
      expect(REPORT_LAYOUT_CSS).toMatch(
        /\.id-text\.is-long \{[^}]*white-space: normal;[^}]*overflow-wrap: anywhere;/,
      );
      expect(REPORT_LAYOUT_CSS).not.toMatch(
        /\.id-text\.is-long \{[^}]*display: inline-block;/,
      );
    });

    // The comma of a list used to wrap alone after a long folded identifier;
    // « ( » stayed alone at the end of a line.
    it('keeps the punctuation around an identifier with it', () => {
      expect(idText('CVE-2026-25965', { after: ',' })).toBe(
        '<span class="id-text">CVE-2026-25965</span>,',
      );
      expect(
        idText('registry.example.com/team/app@sha256:c335e56da2', {
          before: '(',
          after: '),',
        }),
      ).toBe(
        '<span class="id-box">(<span class="id-text is-long">registry<wbr>.example<wbr>.com<wbr>/team<wbr>/app<wbr>@sha256:<wbr>c335e56da2</span>),</span>',
      );
    });
  });

  describe('stateLabel', () => {
    it('humanises the state and marks it with a coloured dot', () => {
      expect(stateLabel('to_verify')).toContain('To verify');
      expect(stateLabel('CONFIRMED')).toContain('Confirmed');
      expect(stateLabel('not_exploitable')).toContain('Not exploitable');
      expect(stateLabel('to_verify')).toContain('class="state"');
    });
  });

  describe('verdictPill', () => {
    it('labels the exploitability verdict with its tone', () => {
      expect(verdictPill('actively_exploited')).toContain('Actively exploited');
      expect(verdictPill('not_exploitable')).toContain('Not exploitable');
    });
  });

  describe('arrowIcon', () => {
    it('draws the arrow in SVG: the embedded fonts have no glyph for U+2192', () => {
      const html = arrowIcon();
      expect(html).toContain('<svg class="arrow"');
      expect(html).not.toContain('\u2192');
    });
  });

  describe('palette separation', () => {
    it('draws AI verdicts as outlined pills, solid red only when actively exploited', () => {
      expect(verdictPill('theoretical')).toContain(
        'class="verdict is-outline"',
      );
      expect(verdictPill('proven')).toContain('class="verdict is-outline"');
      expect(verdictPill('actively_exploited')).toContain(
        'class="verdict is-solid"',
      );
    });

    it('never reuses a severity colour for a finding state', () => {
      for (const s of ['to_verify', 'confirmed']) {
        const html = stateLabel(s);
        for (const sev of ['#d92d20', '#f2641b', '#e8a50c', '#2e90fa']) {
          expect(html).not.toContain(sev);
        }
      }
      expect(stateLabel('to_verify')).toContain('state-dot is-ring');
    });

    it('paints the callout accent as a straight bar', () => {
      expect(REPORT_LAYOUT_CSS).toMatch(
        /\.callout-warning \{[^}]*linear-gradient\(90deg, #e8a50c 0 3px/,
      );
    });
  });

  describe('keyFacts', () => {
    it('renders a titled panel of facts (HTML items)', () => {
      const html = keyFacts('Key facts', ['<strong>7</strong> critical', 'x']);
      expect(html).toContain('class="panel key-facts"');
      expect(html).toContain('<div class="panel-title">Key facts</div>');
      expect(html).toContain('<li><strong>7</strong> critical</li>');
    });
  });

  describe('idChip / pathText keep', () => {
    it('lets a long identifier break only before a slash', () => {
      expect(idChip('sentence-transformers/all-MiniLM-L6-v2')).toBe(
        '<span class="code-chip pkg"><span class="seg">sentence-transformers</span><wbr><span class="seg">/all-MiniLM-L6-v2</span></span>',
      );
    });

    // 24 characters or fewer: the original markup.
    it('keeps the markup of a short scoped package', () => {
      expect(packageChip('@babel/core', '7.0.0')).toContain(
        '<span class="seg">@babel/</span><wbr><span class="seg">core</span><wbr><span class="seg">@7.0.0</span>',
      );
    });

    it('lets a long model id break at its separators', () => {
      expect(
        idChip(
          'huggingface/extremely-long-model-name-for-testing-instruct-v2.5-gguf-q4_k_m',
        ),
      ).toBe(
        '<span class="code-chip pkg"><span class="seg">huggingface</span><wbr><span class="seg is-long">/extremely<wbr><nobr>-l</nobr>ong<wbr><nobr>-m</nobr>odel<wbr><nobr>-n</nobr>ame<wbr><nobr>-f</nobr>or<wbr><nobr>-t</nobr>esting<wbr><nobr>-i</nobr>nstruct<wbr><nobr>-v</nobr>2.5<wbr><nobr>-g</nobr>guf<wbr><nobr>-q</nobr>4_k_m</span></span>',
      );
    });

    it('keeps a short path whole inside a sentence', () => {
      expect(pathText('src/llm_client.py', { keep: true })).toBe(
        '<span class="path keep">src/llm_client.py</span>',
      );
      // Its punctuation does not come off it: no break point.
      expect(
        pathText('src/llm_client.py', { keep: true, before: '(', after: '):' }),
      ).toBe('(<span class="path keep">src/llm_client.py</span>):');
    });

    // A long one moves to the next line whole, and breaks at its separators
    // only when it is longer than the line, its punctuation with it.
    it('lets a long path cited in a sentence break when it does not fit a line', () => {
      expect(
        pathText('services/very/deep/package-lock.json', { keep: true }),
      ).toBe(
        '<span class="id-box"><span class="path keep is-long">services<wbr>/very<wbr>/deep<wbr>/package<wbr><nobr>-l</nobr>ock<wbr>.json</span></span>',
      );
      expect(
        pathText('services/very/deep/package-lock.json', {
          keep: true,
          after: ':',
        }),
      ).toBe(
        '<span class="id-box"><span class="path keep is-long">services<wbr>/very<wbr>/deep<wbr>/package<wbr><nobr>-l</nobr>ock<wbr>.json</span>:</span>',
      );
      expect(REPORT_LAYOUT_CSS).toMatch(
        /\.path\.keep\.is-long \{[^}]*white-space: normal;[^}]*text-indent: 0;/,
      );
      expect(REPORT_LAYOUT_CSS).not.toMatch(
        /\.path\.keep\.is-long \{[^}]*display: inline-block;/,
      );
    });
  });

  describe('dataTable — attached note rows', () => {
    it('ties a full-width note to the row above it', () => {
      const html = dataTable({
        columns: [{ label: 'A' }, { label: 'B' }],
        rows: [['1', '2'], { full: 'note', attach: true }],
      });
      expect(html).toContain(
        '<tr class="has-note"><td>1</td><td>2</td></tr><tr class="note-row"><td colspan="2">note</td></tr>',
      );
    });

    // Chromium ignores `break-before: avoid` between two rows: only a row
    // group kept whole (`break-inside: avoid`) stops a note from opening the
    // next page alone, cut from the row it explains.
    it('wraps a row and its notes in their own row group, the other rows staying together', () => {
      const html = dataTable({
        columns: [{ label: 'A' }],
        rows: [
          ['1'],
          ['2'],
          { full: 'n2', attach: true },
          { full: 'n2b', attach: true },
          ['3'],
        ],
      });
      expect(html).toContain(
        '</thead><tbody><tr><td>1</td></tr></tbody>' +
          '<tbody class="unit"><tr class="has-note"><td>2</td></tr>' +
          '<tr class="note-row"><td colspan="1">n2</td></tr>' +
          '<tr class="note-row"><td colspan="1">n2b</td></tr></tbody>' +
          '<tbody><tr><td>3</td></tr></tbody></table>',
      );
    });

    it('keeps rows joined to the row above in its row group, notes included', () => {
      const html = dataTable({
        columns: [{ label: 'A' }],
        rows: [['1'], ['2'], ['2b'], { full: 'n2', attach: true }, ['3']],
        joinPrevious: [false, false, true],
      });
      expect(html).toContain(
        '</thead><tbody><tr><td>1</td></tr></tbody>' +
          '<tbody class="unit"><tr><td>2</td></tr>' +
          '<tr class="has-note"><td>2b</td></tr>' +
          '<tr class="note-row"><td colspan="1">n2</td></tr></tbody>' +
          '<tbody><tr><td>3</td></tr></tbody></table>',
      );
    });

    it('keeps a single row group when no note is attached', () => {
      const html = dataTable({
        columns: [{ label: 'A' }],
        rows: [['1'], { full: 'free' }, ['2']],
      });
      expect(html.match(/<tbody/g)).toHaveLength(1);
    });

    it('never breaks inside a row and its notes', () => {
      expect(REPORT_LAYOUT_CSS).toMatch(
        /tbody\.unit \{[^}]*break-inside: avoid/,
      );
    });
  });

  describe('callout / emptyState / aboutSection', () => {
    it('renders a toned callout that never breaks', () => {
      const html = callout('warning', 'Careful');
      expect(html).toContain('class="callout callout-warning"');
      expect(html).toContain('Careful');
    });

    it('has a danger tone for blocking verdicts', () => {
      expect(callout('danger', 'Action required')).toContain(
        'class="callout callout-danger"',
      );
    });

    // A long item kept whole left the last page to the colophon alone: an
    // item now breaks between its paragraphs (3 lines at least on each side),
    // its title never alone at the foot of a page.
    it('lets a long about section flow over two pages, an item breaking between paragraphs', () => {
      const html = aboutSection([{ title: 'Methodology', html: '<p>x</p>' }]);
      expect(html).toContain('<section class="about">');
      expect(html).toContain('<div class="about-item">');
      expect(REPORT_LAYOUT_CSS).not.toMatch(
        /\.about-item \{[^}]*break-inside: avoid/,
      );
      expect(REPORT_LAYOUT_CSS).toMatch(/\.about h3 \{[^}]*break-after: avoid/);
    });

    // Tiles, callouts and panels share one inner left edge (17px).
    it('starts the text of tiles, callouts and panels at the same inset', () => {
      const left = (re: RegExp) =>
        Number(re.exec(REPORT_LAYOUT_CSS + getReportBaseCss(true))?.[1]);
      const kpi = left(/\.kpi \{[^}]*padding: \d+px \d+px \d+px (\d+)px/);
      const callout = left(
        /\.callout \{[^}]*padding: \d+px \d+px \d+px (\d+)px/,
      );
      const panel = left(/\.panel \{[^}]*padding: \d+px (\d+)px/);
      // tiles and panels have a 1px border, callouts none
      expect(kpi + 1).toBe(panel + 1);
      expect(callout).toBe(panel + 1);
    });

    it('renders an empty state', () => {
      expect(emptyState('No <findings>')).toContain('No &lt;findings&gt;');
    });

    it('renders the closing methodology / disclaimer section', () => {
      const html = aboutSection([
        { title: 'Disclaimer', html: '<p>Informational.</p>' },
      ]);
      expect(html).toContain('About this report');
      expect(html).toContain('Disclaimer');
    });
  });
});
