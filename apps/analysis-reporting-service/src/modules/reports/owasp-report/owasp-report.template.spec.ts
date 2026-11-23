import { OWASP_TOP_10_2021_DATA } from './constants/owasp-data.constants';
import {
  OWASP_REPORT_CSS,
  owaspReportTitle,
  renderOwaspReport,
} from './owasp-report.template';
import { MappedVulnerability, OwaspReportData } from './owasp-report.types';
import {
  arrowIcon,
  idText,
  keyFacts,
  packageChip,
  pathText,
  verdictPill,
} from '../shared/report-layout';
import {
  IdPunctuation,
  breakableId,
  breakableVersion,
  codeChip,
  idBox,
  versionChip,
} from '../shared/report-styles';

let seq = 0;
const vuln = (over: Partial<MappedVulnerability> = {}): MappedVulnerability => {
  seq += 1;
  return {
    id: `v${seq}`,
    type: 'sast',
    name: 'Uncontrolled eval execution',
    description: 'Calling `eval` on **user input** runs arbitrary code.',
    severity: 'high',
    state: 'to_verify',
    priority: 'normal',
    path: 'app/routes/contributions.js',
    line: '32-32',
    cwe: ['CWE-95'],
    owaspTop10: ['A03:2021 - Injection'],
    createdAt: new Date('2026-09-01T00:00:00Z'),
    updatedAt: new Date('2026-09-01T00:00:00Z'),
    ...over,
  };
};

/** Builds report data; `category` maps a finding id to its OWASP id. */
const report = (
  vulns: MappedVulnerability[],
  category: (v: MappedVulnerability) => string | null = (v) =>
    v.type === 'sca' || v.type === 'container' ? 'A06' : 'A03',
  meta: Partial<OwaspReportData['scanMetadata']> = {},
): OwaspReportData => {
  const byCat = new Map<string, MappedVulnerability[]>();
  for (const v of vulns) {
    const id = category(v);
    if (!id) continue;
    byCat.set(id, [...(byCat.get(id) ?? []), v]);
  }
  const byType = { sast: 0, iac: 0, sca: 0, container: 0 };
  for (const v of vulns) byType[v.type] += 1;
  return {
    projectId: 'acme0001',
    generatedAt: '2026-09-23T10:50:27.000Z',
    scanMetadata: {
      projectId: 'acme0001',
      projectName: 'vitality-api',
      scanDate: '2026-09-23T10:50:27.000Z',
      ...meta,
    },
    summary: {
      totalVulnerabilities: vulns.length,
      byType,
      bySeverity: { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 },
      byState: {},
      byOwaspCategory: {},
    },
    owaspCategories: Object.keys(OWASP_TOP_10_2021_DATA)
      .filter((id) => byCat.has(id))
      .map((id) => ({
        categoryData: OWASP_TOP_10_2021_DATA[id],
        vulnerabilities: byCat.get(id),
        count: byCat.get(id).length,
      })),
    vulnerabilities: vulns,
  };
};

const render = (data: OwaspReportData, detailed = true, forPdf = true) =>
  renderOwaspReport(data, { forPdf, detailed });

/** Text of the element with the given id, up to the next section. */
const sectionOf = (html: string, id: string): string => {
  const start = html.indexOf(`id="${id}"`);
  if (start < 0) return '';
  const end = html.indexOf('<section', start + 1);
  return html.slice(start, end < 0 ? undefined : end);
};

/** Visible text of an HTML fragment, tags dropped and spaces collapsed. */
const textOf = (html: string): string =>
  String(html ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Text of an HTML fragment with its tags removed (inline spans kept joined). */
const plainOf = (html: string): string =>
  String(html ?? '').replace(/<[^>]+>/g, '');

/** Visible text of the cover band. */
const coverOf = (html: string): string =>
  textOf(html.slice(html.indexOf('class="cover"'), html.indexOf('</header>')));

/**
 * A long version in running text, as idText names an identifier but cut
 * only between the parts of the version (breakableVersion).
 */
const versionText = (version: string, punctuation: IdPunctuation = {}) =>
  idBox(
    `<span class="id-text is-long">${breakableVersion(version)}</span>`,
    punctuation,
  );

/** First `<table>` carrying the given class. */
const tableOf = (html: string, cls: string): string =>
  new RegExp(`<table class="[^"]*\\b${cls}\\b[^"]*">[\\s\\S]*?</table>`).exec(
    html,
  )?.[0] ?? '';

/** The finding block whose title contains `title`, up to the next one. */
const findingOf = (html: string, title: string): string => {
  const at = html.indexOf(title, html.indexOf('<div class="finding">'));
  if (at < 0) return '';
  const start = html.lastIndexOf('<div class="finding">', at);
  const next = html.indexOf('<div class="finding">', at);
  const end = [
    next,
    html.indexOf('<section', at),
    html.indexOf('class="prevent"', at),
  ]
    .filter((i) => i >= 0)
    .sort((a, b) => a - b)[0];
  return html.slice(start, end);
};

describe('OWASP report template', () => {
  describe('document frame', () => {
    const html = render(report([vuln()]));

    it('opens on a cover naming the project, its id, the branch, the generation date and the scope', () => {
      expect(html).toContain('class="cover"');
      expect(html).toContain('OWASP Top 10 &#183; 2021');
      expect(html).toContain('<h1>OWASP Top 10 report</h1>');
      const cover = coverOf(html);
      expect(cover).toContain('Project vitality-api acme0001');
      expect(cover).toContain('Branch All branches');
      expect(cover).toContain('Generated 23 Sep 2026, 10:50 UTC');
      expect(cover).toContain('Scope SAST');
    });

    it('falls back to the project id when the name is unknown, and shows the branch when given', () => {
      const cover = coverOf(
        render(
          report([vuln()], undefined, {
            projectName: undefined,
            branch: 'main',
          }),
        ),
      );
      expect(cover).toContain('Project acme0001 Branch main');
    });

    it('derives the scope from the families that reported findings, in a fixed order', () => {
      const scope = (vulns: MappedVulnerability[]) =>
        /Scope (.*)$/.exec(coverOf(render(report(vulns))))?.[1];
      expect(
        scope([
          vuln({ type: 'container', packageName: 'zlib' }),
          vuln(),
          vuln({ type: 'sca', packageName: 'qs', state: 'ignored' }),
        ]),
      ).toBe('SAST, SCA, Container');
      // Nothing reported at all: the families the report covers.
      expect(scope([])).toBe('SAST, IaC, SCA, Container');
    });

    it('titles the document and the running footer with the project, never with an id', () => {
      expect(html).toContain(
        '<title>OWASP Top 10 report &#183; vitality-api</title>',
      );
      expect(owaspReportTitle(report([]))).toBe(
        'OWASP Top 10 report · vitality-api',
      );
    });

    it('drops the marketing and generic blocks of the previous layout', () => {
      for (const legacy of [
        'Comprehensive',
        'Report Description',
        'Legal Disclaimer',
        'Scan Metadata',
        'Security Profile',
        'Compliance at a Glance',
        'manual security testing',
        'Detailed Category Analysis',
      ]) {
        expect(html).not.toContain(legacy);
      }
    });

    it('keeps styles in classes (no inline font sizes), ships no script and ends with the methodology', () => {
      expect(html).not.toMatch(/style="[^"]*font-size/);
      expect(html).not.toContain('<script');
      expect(html).not.toContain('<canvas');
      expect(html).toContain('class="footer"');
      expect(html).toMatch(/About this report[\s\S]*Methodology/);
      expect(html.lastIndexOf('About this report')).toBeGreaterThan(
        html.lastIndexOf('id="owasp-a03"'),
      );
    });

    it('uses only the sizes of the type scale in its own styles', () => {
      const sizes = Array.from(
        OWASP_REPORT_CSS.matchAll(/font-size:\s*([\d.]+)px/g),
        (m) => m[1],
      );
      expect(sizes.length).toBeGreaterThan(0);
      for (const size of sizes) {
        expect(['26', '17', '13', '11.5', '11', '10', '9.5']).toContain(size);
      }
    });

    it('lets a description flow across pages, its last paragraph hiding the continuation row of its table', () => {
      expect(OWASP_REPORT_CSS).not.toMatch(/\.md-p[^{]*\{[^}]*break-inside/);
      // Only the last paragraph of the description covers the continuation
      // row of the occurrence table: the rest of it flows freely.
      const description = 'First paragraph.\n\nSecond paragraph.';
      const finding = findingOf(
        render(
          report([
            vuln({ description }),
            vuln({ description, line: '33-33', state: 'confirmed' }),
          ]),
        ),
        'Uncontrolled eval execution',
      );
      expect(finding).toMatch(
        /<div class="finding-desc">[^]*?First paragraph\.[^]*?<\/div>\s*<div class="finding-desc desc-tail cont-cover">[^]*?Second paragraph\.[^]*?<\/div>\s*<table/,
      );
      // It may end a page: the table then opens the next one on its
      // continuation row, which names the finding.
      expect(OWASP_REPORT_CSS).toMatch(/\.desc-tail \{[^}]*break-after: auto/);
      // Without a description, an empty cover still hides the row.
      const bare = findingOf(
        render(
          report([vuln(), vuln({ line: '33-33', state: 'confirmed' })]),
          false,
        ),
        'Uncontrolled eval execution',
      );
      expect(bare).toMatch(/<div class="cont-cover"><\/div>\s*<table/);
    });

    it('never ends a page on a category head: its first finding may break after its description instead', () => {
      const a03 = sectionOf(render(report([vuln()])), 'owasp-a03');
      expect(a03).toContain('<div class="cat-head">');
      expect(OWASP_REPORT_CSS).toMatch(/\.cat-head \{[^}]*break-after: avoid/);
      expect(OWASP_REPORT_CSS).not.toContain('has-brief');
      // The description may end a page above its occurrence table: the
      // table then opens the next page on its continuation row, which names
      // the finding.
      expect(OWASP_REPORT_CSS).toMatch(/\.desc-tail \{[^}]*break-after: auto/);
    });

    it('keeps no local copy of what the shared components now do', () => {
      // The header is painted on its row by the shared table.
      expect(OWASP_REPORT_CSS).not.toMatch(
        /(^|[\s,])(th|thead)\b[^{]*\{[^}]*box-shadow/m,
      );
      expect(OWASP_REPORT_CSS).not.toMatch(/\.cont-cover[^{]*\{[^}]*padding/);
      expect(OWASP_REPORT_CSS).not.toMatch(/\.code-chip\s*\{[^}]*white-space/);
      // Verdict pills, key facts, attached note rows, inline code and chart
      // bars are styled by the shared components only. The pill of the
      // upgrade plan may only wrap between its words there (planWidths).
      expect(
        OWASP_REPORT_CSS.replace(
          '.plan-verdict .verdict { white-space: normal; }',
          '',
        ),
      ).not.toMatch(/\.verdict\b/);
      expect(OWASP_REPORT_CSS).not.toMatch(/\.facts\b/);
      expect(OWASP_REPORT_CSS).not.toMatch(
        /tr\.has-note|tr\.note-row\s*(td)?\s*\{/,
      );
      expect(OWASP_REPORT_CSS).not.toMatch(/(^|\s)\.code-inline \{/m);
      expect(OWASP_REPORT_CSS).not.toMatch(/\.hbar-/);
      expect(OWASP_REPORT_CSS).not.toContain('!important');
    });

    it('draws every AI verdict with the shared pill', () => {
      const html = render(
        report([
          vuln({
            exploitability: {
              verdict: 'theoretical',
              source: 'agent',
              score: 0.4,
              reason: null,
            },
          }),
          vuln({
            path: 'b.js',
            exploitability: {
              verdict: 'proven',
              source: 'agent',
              score: 0.8,
              reason: null,
            },
          }),
        ]),
      );
      expect(html).toContain(verdictPill('theoretical'));
      expect(html).toContain(verdictPill('proven'));
      // No local variant of the pill.
      expect(html.match(/class="verdict/g)).toHaveLength(
        html.split(verdictPill('theoretical')).length -
          1 +
          html.split(verdictPill('proven')).length -
          1,
      );
    });

    it('sets a finding title in one weight and colour, whatever the table it heads a row of', () => {
      const html = render(
        report([
          vuln(),
          vuln({
            name: 'Code injection',
            severity: 'critical',
            state: 'ignored',
          }),
          vuln({
            type: 'sca',
            name: 'Prototype pollution in qs',
            advisoryId: 'GHSA-1',
            path: undefined,
            line: undefined,
            packageName: 'qs',
            packageVersion: '6.5.2',
          }),
        ]),
      );
      expect(tableOf(html, 'top-table')).toContain('class="top-title"');
      expect(tableOf(html, 'dep-table')).toContain('class="adv-title"');
      expect(tableOf(html, 'triaged-table')).toContain(
        '<span class="tri-title">Code injection</span>',
      );
      const rule = /([^{}]*)\{([^}]*)\}/g;
      const rules = Array.from(OWASP_REPORT_CSS.matchAll(rule), (m) => ({
        selectors: m[1],
        body: m[2],
      }));
      const title = rules.find(
        (r) =>
          r.selectors.includes('.top-title') &&
          r.selectors.includes('.adv-title') &&
          r.selectors.includes('.tri-title'),
      );
      expect(title?.body).toContain('font-weight: 500');
      expect(title?.body).toContain(`color: ${'#281434'}`);
      // No other rule gives one of them another weight.
      for (const r of rules.filter((x) => x !== title)) {
        if (/\.(top|adv|tri)-title\b/.test(r.selectors)) {
          expect(r.body).not.toContain('font-weight');
        }
      }
    });

    it('renders the dashboard preview as a centred sheet with the same content', () => {
      const preview = render(report([vuln()]), true, false);
      expect(preview).toMatch(/\.doc \{[^}]*zoom: 1\.13;[^}]*max-width: 794px/);
      expect(preview).toContain('id="owasp-a03"');
    });
  });

  describe('executive summary', () => {
    const data = report([
      vuln({ severity: 'critical', state: 'confirmed' }),
      vuln({ severity: 'high' }),
      vuln({ severity: 'high', state: 'ignored' }),
      vuln({
        type: 'sca',
        severity: 'medium',
        name: 'Prototype pollution',
        packageName: 'lodash',
        packageVersion: '4.17.4',
        advisoryId: 'GHSA-1',
      }),
    ]);
    const html = render(data);

    it('counts only open findings and says how many triaged ones are excluded', () => {
      expect(html).toContain('3 open findings &#183; 1 triaged, excluded');
      expect(html).toMatch(
        /class="kpi-value"[^>]*>3<\/div><div class="kpi-label">Open findings/,
      );
      expect(html).toMatch(/>1<\/div><div class="kpi-label">Critical/);
      expect(html).toMatch(/>1<\/div><div class="kpi-label">High/);
    });

    it('adds an unrated tile only when an open finding has no severity, so the tiles add up', () => {
      expect(html).not.toContain('kpi-label">Unrated');
      const unrated = render(report([vuln({ severity: '' }), vuln()]));
      expect(unrated).toMatch(/>1<\/div><div class="kpi-label">Unrated/);
    });

    it('gives the total tile more room, so its label stays whole next to six severity tiles', () => {
      const unrated = render(report([vuln({ severity: '' }), vuln()]));
      expect(unrated).toContain('kpi-label">Open findings<');
      expect(unrated).toContain(
        'grid-template-columns: 1.6fr repeat(5, minmax(0, 1fr));',
      );
    });

    it('charts the open findings per OWASP category beside the key facts, since the tiles already give the severities', () => {
      const summary = sectionOf(html, 'owasp-summary');
      expect(summary).not.toContain('class="donut"');
      expect(summary).toContain('Open findings by category');
      const chart = textOf(
        summary.slice(
          summary.indexOf('class="hbars"'),
          summary.indexOf('Key facts'),
        ),
      );
      expect(chart).toMatch(/A03 Injection 2 A06 Vulnerable components 1/);
      // Only the categories with open findings get a bar.
      expect(chart).not.toContain('Access control');
      expect(html).not.toContain('<canvas');
    });

    it('names each bar by its category id, set apart from the short title by the shared chart', () => {
      const summary = sectionOf(html, 'owasp-summary');
      // The id is passed to the chart, never glued to the label by a regex.
      expect(summary).not.toMatch(/hbar-label[^>]*>A03 Injection/);
      expect(summary).toMatch(/>A03<\/span>\s*Injection/);
    });

    it('adds a « Not mapped » bar when open findings fall outside the Top 10', () => {
      const out = render(
        report([vuln(), vuln({ name: 'CPU limits' })], (v) =>
          v.name === 'CPU limits' ? null : 'A03',
        ),
      );
      expect(textOf(sectionOf(out, 'owasp-summary'))).toMatch(
        /A03 Injection 1 Not mapped 1/,
      );
    });

    it('states computed facts, not generic prose, in the shared key facts panel', () => {
      const summary = sectionOf(html, 'owasp-summary');
      // The panel every report uses for its key facts.
      expect(summary).toContain(
        keyFacts('Key facts', ['\u0000']).split('\u0000')[0],
      );
      expect(html).toMatch(
        /<strong>2<\/strong> of the <strong>3<\/strong> open findings[^<]*fall under A03/,
      );
      expect(textOf(summary).replace(/&#160;/g, ' ')).toContain(
        '2 critical or high findings are open (1 critical, 1 high); 1 of them is confirmed.',
      );
      // A count never ends a line without its unit.
      expect(summary).toContain('(1&#160;critical, 1&#160;high)');
      expect(textOf(summary)).toContain('fall under A03 Injection.');
      // The chart beside already shows which categories have findings and
      // how many fall outside the Top 10: no fact repeats it.
      expect(textOf(summary)).not.toContain('of the 10 categories');
      expect(textOf(summary)).not.toContain('outside the Top 10');
    });

    it('states four key facts at most', () => {
      const dep = (over: Partial<MappedVulnerability>) =>
        vuln({
          type: 'sca',
          severity: 'critical',
          path: undefined,
          line: undefined,
          packageName: 'qs',
          packageVersion: '0.6.6',
          ...over,
        });
      const summary = sectionOf(
        render(
          report(
            [
              vuln({ state: 'confirmed' }),
              vuln({ name: 'Other rule', severity: 'low' }),
              dep({
                name: 'Prototype pollution',
                advisoryId: 'GHSA-1',
                fixedVersion: '6.2.4',
                exploitability: {
                  verdict: 'actively_exploited',
                  source: 'agent',
                  score: 1,
                  reason: null,
                },
              }),
              dep({
                name: 'Withdrawn flaw',
                advisoryId: 'GHSA-2',
                withdrawn: true,
              }),
            ],
            (v) =>
              v.name === 'Other rule' ? null : v.type === 'sca' ? 'A06' : 'A03',
          ),
        ),
        'owasp-summary',
      );
      const factsOf = (html: string) =>
        /<div class="panel key-facts">[\s\S]*?<\/ul>/.exec(html)[0];
      expect(factsOf(summary).match(/<li>/g)).toHaveLength(4);
      // Five facts to state: the withdrawn advisories, which A06 flags
      // anyway, give way to the upgrade that resolves the worst findings.
      const five = sectionOf(
        render(
          report([
            vuln({ state: 'confirmed' }),
            vuln({ name: 'Rule b', path: 'b.js' }),
            vuln({ name: 'Rule c', path: 'c.js' }),
            dep({
              name: 'Prototype pollution',
              advisoryId: 'GHSA-1',
              fixedVersion: '6.2.4',
              exploitability: {
                verdict: 'actively_exploited',
                source: 'agent',
                score: 1,
                reason: null,
              },
            }),
            dep({
              name: 'Withdrawn flaw',
              advisoryId: 'GHSA-2',
              withdrawn: true,
            }),
          ]),
        ),
        'owasp-summary',
      );
      expect(factsOf(five).match(/<li>/g)).toHaveLength(4);
      expect(textOf(factsOf(five))).toContain('would resolve');
      expect(textOf(factsOf(five))).not.toContain('withdrawn');
    });

    it('says which upgrades resolve the most severe dependency findings, in the order of the upgrade plan', () => {
      const dep = (
        packageName: string,
        severity: string,
        over: Partial<MappedVulnerability> = {},
      ) =>
        vuln({
          type: 'sca',
          name: `Flaw in ${packageName}`,
          advisoryId: `GHSA-${packageName}`,
          severity,
          description: '',
          path: undefined,
          line: undefined,
          packageName,
          packageVersion: '1.0.0',
          fixedVersion: '2.0.0',
          ...over,
        });
      const factsOf = (vulns: MappedVulnerability[]) =>
        /<div class="panel key-facts">[\s\S]*?<\/ul>/.exec(
          sectionOf(render(report(vulns)), 'owasp-summary'),
        )?.[0] ?? '';
      const critical = [
        vuln({ severity: 'critical', line: '32-32' }),
        vuln({ severity: 'critical', line: '33-33' }),
        dep('bson', 'critical'),
        dep('form-data', 'critical'),
        dep('lodash', 'critical', { packageVersion: '2.4.2' }),
        dep('lodash', 'critical', { packageVersion: '4.17.11' }),
        dep('underscore', 'critical', {
          exploitability: {
            verdict: 'actively_exploited',
            source: 'agent',
            score: 1,
            reason: null,
          },
        }),
        dep('qs', 'high'),
      ];
      const facts = factsOf(critical);
      // Named as in the plan: the actively exploited underscore first, then
      // lodash and its two critical findings.
      expect(plainOf(facts).replace(/&#160;/g, ' ')).toContain(
        'Upgrading underscore, lodash, bson and form-data would resolve 5 of the 7 critical findings.',
      );
      // Named in mono, like a path cited in a sentence: a chip in running
      // text parts from the comma that follows it.
      expect(facts).toContain(pathText('underscore', { keep: true }));
      expect(facts).not.toContain('code-chip');
      // A withdrawn advisory or one without a fix resolves nothing.
      const unfixed = factsOf([
        ...critical,
        dep('marked', 'critical', { fixedVersion: undefined }),
        dep('hoek', 'critical', { withdrawn: true }),
      ]);
      expect(textOf(unfixed)).toContain(
        'would resolve 5 of the 9 critical findings.',
      );
      expect(textOf(unfixed)).not.toContain('marked');
      // Past four packages, a count.
      const many = factsOf([...critical, dep('marked', 'critical')]);
      expect(textOf(many)).toContain(
        'Upgrading 5 packages of the A06 upgrade plan would resolve 6 of the 8 critical findings.',
      );
      // No critical dependency: the high ones; every one of them resolved.
      expect(
        textOf(
          factsOf([
            vuln({ severity: 'critical' }),
            dep('qs', 'high'),
            dep('ws', 'high'),
          ]),
        ),
      ).toContain('Upgrading qs and ws would resolve both high findings.');
      expect(textOf(factsOf([dep('qs', 'high')]))).toContain(
        'Upgrading qs would resolve the only high finding.',
      );
      // Nothing to upgrade: no such fact.
      expect(
        textOf(factsOf([dep('qs', 'high', { fixedVersion: undefined })])),
      ).not.toContain('Upgrading');
      expect(textOf(factsOf([dep('qs', 'medium')]))).not.toContain('Upgrading');
    });

    it('keeps the key facts short: the dependency split of the top category replaces its name', () => {
      const dep = (
        type: 'sca' | 'container',
        over: Partial<MappedVulnerability> = {},
      ) =>
        vuln({
          type,
          name: `CVE-${type}`,
          advisoryId: `GHSA-${type}`,
          path: undefined,
          line: undefined,
          packageName: 'zlib',
          packageVersion: '1.3.1',
          ...over,
        });
      const facts = textOf(
        sectionOf(
          render(
            report([
              dep('sca'),
              dep('container'),
              dep('sca', {
                advisoryId: 'GHSA-w',
                name: 'Withdrawn in zlib',
                withdrawn: true,
                description: 'Withdrawn, accidental duplicate publish.',
              }),
            ]),
          ),
          'owasp-summary',
        ),
      );
      // The withdrawn advisories are part of A06: said in its fact, beside
      // the dependencies they all belong to (never after the images).
      expect(facts).toContain(
        '3 of the 3 open findings (100%) fall under A06: 2 in dependencies (1&#160;from an advisory withdrawn as a duplicate, still counted) and 1 in container images.',
      );
      const mixed = textOf(
        sectionOf(
          render(
            report([
              dep('sca'),
              dep('container'),
              ...['a', 'b', 'c'].map((id, i) =>
                dep('sca', {
                  advisoryId: `GHSA-${id}`,
                  name: `Withdrawn ${id}`,
                  withdrawn: true,
                  description: i
                    ? 'Withdrawn, accidental duplicate publish.'
                    : 'Not a vulnerability.',
                }),
              ),
            ]),
          ),
          'owasp-summary',
        ),
      );
      expect(mixed).toContain(
        'fall under A06: 4 in dependencies (3&#160;from withdrawn advisories, 2&#160;of them duplicates, still counted) and 1 in container images.',
      );
      // Withdrawn advisories on both sides: said after the split.
      const both = textOf(
        sectionOf(
          render(
            report([
              dep('sca', { withdrawn: true }),
              dep('container', { withdrawn: true }),
            ]),
          ),
          'owasp-summary',
        ),
      );
      expect(both).toContain(
        'fall under A06: 1 in dependencies and 1 in container images; 2 of them come from withdrawn advisories, still counted.',
      );
      // A count and its words never part at a line end.
      const withdrawn = (id: string, description: string) =>
        dep('sca', {
          advisoryId: id,
          name: `Withdrawn ${id}`,
          withdrawn: true,
          description,
        });
      const three = sectionOf(
        render(
          report([
            withdrawn('GHSA-a', 'Withdrawn, accidental duplicate publish.'),
            withdrawn('GHSA-b', 'Withdrawn, accidental duplicate publish.'),
            withdrawn('GHSA-c', 'Not a vulnerability.'),
          ]),
        ),
        'owasp-summary',
      );
      expect(three).toContain(
        'withdrawn advisories (2&#160;as&#160;duplicates)',
      );
    });

    it('credits an exploitable verdict to the AI analysis, and to a reviewer only when one gave it', () => {
      const proven = (source: string) =>
        vuln({
          exploitability: {
            verdict: 'proven',
            source,
            score: 0.8,
            reason: null,
          },
        });
      const agent = textOf(
        sectionOf(render(report([proven('agent')])), 'owasp-summary'),
      );
      expect(agent).toContain(
        '1 open finding was rated proven or actively exploited by the AI analysis.',
      );
      const both = textOf(
        sectionOf(
          render(report([proven('agent'), proven('manual')])),
          'owasp-summary',
        ),
      );
      expect(both).toContain(
        '2 open findings were rated proven or actively exploited by the AI analysis or a reviewer.',
      );
    });

    it('names the finding the AI analysis rated actively exploited', () => {
      const facts = plainOf(
        sectionOf(
          render(
            report([
              vuln({
                exploitability: {
                  verdict: 'proven',
                  source: 'agent',
                  score: 0.8,
                  reason: null,
                },
              }),
              vuln({
                type: 'sca',
                severity: 'critical',
                name: 'Arbitrary code execution in underscore',
                advisoryId: 'GHSA-1',
                path: undefined,
                line: undefined,
                packageName: 'underscore',
                packageVersion: '1.9.1',
                exploitability: {
                  verdict: 'actively_exploited',
                  source: 'agent',
                  score: 1,
                  reason: 'CISA KEV confirms active exploitation.',
                },
              }),
            ]),
          ),
          'owasp-summary',
        ),
      );
      expect(facts).toContain(
        '2 open findings were rated proven or actively exploited by the AI analysis; 1 is actively exploited: underscore 1.9.1.',
      );
    });

    it('names the package of a key fact in mono, its version after a space, never name@version', () => {
      const summary = sectionOf(
        render(
          report([
            vuln({
              type: 'sca',
              severity: 'critical',
              name: 'Arbitrary code execution in underscore',
              advisoryId: 'GHSA-1',
              path: undefined,
              line: undefined,
              packageName: 'underscore',
              packageVersion: '1.9.1',
              exploitability: {
                verdict: 'actively_exploited',
                source: 'agent',
                score: 1,
                reason: null,
              },
            }),
          ]),
        ),
        'owasp-summary',
      );
      expect(summary).toContain(pathText('underscore 1.9.1', { keep: true }));
      expect(plainOf(summary)).not.toContain('underscore@');
    });

    it('says how many open findings come from withdrawn advisories, still counted', () => {
      const dep = (over: Partial<MappedVulnerability>) =>
        vuln({
          type: 'sca',
          path: undefined,
          line: undefined,
          packageName: 'qs',
          packageVersion: '0.6.6',
          ...over,
        });
      // A06 leads: its fact says it.
      const html = render(
        report([
          vuln(),
          dep({ name: 'Prototype pollution', advisoryId: 'GHSA-1' }),
          dep({
            name: 'High severity vulnerability that affects qs',
            advisoryId: 'GHSA-2',
            withdrawn: true,
          }),
        ]),
      );
      expect(textOf(sectionOf(html, 'owasp-summary'))).toContain(
        '2 of the 3 open findings (67%) fall under A06 Vulnerable and Outdated Components; 1 of them comes from a withdrawn advisory, still counted.',
      );
      expect(html).toContain('3 open findings');
      // Another category leads: a fact of its own.
      const code = [vuln(), vuln({ name: 'Rule b' }), vuln({ name: 'Rule c' })];
      const apart = render(
        report([
          ...code,
          dep({
            name: 'High severity vulnerability that affects qs',
            advisoryId: 'GHSA-2',
            withdrawn: true,
          }),
        ]),
      );
      expect(textOf(sectionOf(apart, 'owasp-summary'))).toContain(
        '1 open finding comes from a withdrawn advisory, flagged in A06 and still counted.',
      );
      // Duplicates are counted among the withdrawn, in the words of A06.
      const several = render(
        report([
          ...code,
          vuln({ name: 'Rule d' }),
          vuln({ name: 'Rule e' }),
          dep({ name: 'Prototype pollution', advisoryId: 'GHSA-1' }),
          dep({ name: 'Flaw one', advisoryId: 'GHSA-2', withdrawn: true }),
          dep({ name: 'Flaw two', advisoryId: 'GHSA-3', withdrawn: true }),
          dep({
            name: 'Duplicate Advisory: flaw three',
            advisoryId: 'GHSA-4',
            withdrawn: true,
          }),
        ]),
      );
      expect(textOf(sectionOf(several, 'owasp-summary'))).toContain(
        '3 open findings come from withdrawn advisories (1&#160;as&#160;a&#160;duplicate), flagged in A06 and still counted.',
      );
      const allDuplicates = render(
        report([
          ...code,
          dep({
            name: 'Duplicate Advisory: flaw',
            advisoryId: 'GHSA-5',
            withdrawn: true,
          }),
        ]),
      );
      expect(textOf(sectionOf(allDuplicates, 'owasp-summary'))).toContain(
        '1 open finding comes from an advisory withdrawn as a duplicate, flagged in A06 and still counted.',
      );
      // The dashboard is named once, in the methodology, never in the body.
      expect(html.split('About this report')[0]).not.toContain('dashboard');
      const clean = sectionOf(render(report([vuln()])), 'owasp-summary');
      expect(clean).not.toContain('withdrawn');
    });

    it('lists the ten categories with a not-mapped row and a total that matches the open count', () => {
      const table = sectionOf(html, 'owasp-categories');
      for (const id of Object.keys(OWASP_TOP_10_2021_DATA)) {
        expect(table).toMatch(new RegExp(`>${id}</(a|span)>`));
      }
      // Only a category with open findings has a section to link to; an
      // empty one reads in grey, like its name.
      expect(table).toContain('<a class="cat-code" href="#owasp-a03">A03</a>');
      expect(table).toContain('<span class="cat-code is-empty">A09</span>');
      expect(table).not.toContain('href="#owasp-a09"');
      for (const [, href] of html.matchAll(/href="#([^"]+)"/g)) {
        expect(html).toContain(`id="${href}"`);
      }
      expect(OWASP_REPORT_CSS).toMatch(/\.cat-code\.is-empty \{[^}]*color: #/);
      expect(table).toContain('Not mapped to the OWASP Top 10');
      expect(table).toMatch(/Total[\s\S]*>3<\/strong><\/td><\/tr><\/tbody>/);
      // A06 carries the dependency finding; empty categories show a dash.
      expect(table).toMatch(
        />A06<\/a>[\s\S]*?Vulnerable and Outdated Components/,
      );
      expect(table).toContain('class="zero"');
      expect(table).toContain('href="#owasp-a03"');
    });

    it('greys the dash of a finding outside the Top 10 like any empty cell, never in the accent of a category link', () => {
      const html = render(report([vuln()], () => null));
      const table = tableOf(sectionOf(html, 'owasp-categories'), 'cat-table');
      expect(table).toContain(
        '<span class="cat-code zero">&#8211;</span><span class="cat-name is-other">',
      );
      const top = tableOf(sectionOf(html, 'owasp-summary'), 'top-table');
      expect(top).toContain('<span class="cat-code zero">&#8211;</span>');
      expect(html).not.toContain('<span class="cat-code">');
      // .zero comes after .cat-code, so its grey wins.
      expect(OWASP_REPORT_CSS.indexOf('.zero {')).toBeGreaterThan(
        OWASP_REPORT_CSS.indexOf('.cat-code {'),
      );
    });

    it('lists the most severe open findings first, exploitable and confirmed ones ahead', () => {
      const out = render(
        report([
          vuln({ name: 'Plain high', severity: 'high' }),
          vuln({ name: 'Critical to verify', severity: 'critical' }),
          vuln({
            name: 'Critical confirmed',
            severity: 'critical',
            state: 'confirmed',
          }),
          vuln({
            name: 'Critical ignored',
            severity: 'critical',
            state: 'ignored',
          }),
        ]),
      );
      const top = sectionOf(out, 'owasp-summary');
      expect(top).toContain('Most severe open findings');
      expect(top).toContain('Key facts');
      expect(top.indexOf('Critical confirmed')).toBeLessThan(
        top.indexOf('Critical to verify'),
      );
      expect(top.indexOf('Critical to verify')).toBeLessThan(
        top.indexOf('Plain high'),
      );
      expect(top).not.toContain('Critical ignored');
    });

    it('keeps a long finding title readable in the top list instead of cutting it mid-phrase', () => {
      const title =
        'form-data uses unsafe random function in form-data for choosing boundary';
      const top = sectionOf(
        render(report([vuln({ name: title, severity: 'critical' })])),
        'owasp-summary',
      );
      expect(plainOf(top)).toContain(title);
      // A hyphenated name never wraps at its hyphen.
      expect(top).toContain('<span class="nobr">form-data</span>');
    });

    it('gives the AI verdict of a top finding its own column, apart from its state', () => {
      const top = tableOf(
        sectionOf(
          render(
            report([
              vuln({
                type: 'sca',
                severity: 'critical',
                name: 'Arbitrary code execution in underscore',
                advisoryId: 'GHSA-1',
                path: undefined,
                line: undefined,
                packageName: 'underscore',
                packageVersion: '1.9.1',
                exploitability: {
                  verdict: 'actively_exploited',
                  source: 'agent',
                  score: 1,
                  reason: 'CISA KEV confirms active exploitation.',
                },
              }),
            ]),
          ),
          'owasp-summary',
        ),
        'top-table',
      );
      expect(top).toContain('>AI verdict</th>');
      expect(top).toContain(verdictPill('actively_exploited'));
      const cells = top
        .split('<tbody>')[1]
        .split('</td>')
        .map(textOf)
        .filter(Boolean);
      // Severity, finding, state, AI verdict: the state cell holds the state
      // only.
      expect(cells[2]).toBe('To verify');
      expect(cells[3]).toBe('Actively exploited 100% confidence');
      // The category and the location sit under the title.
      expect(plainOf(cells[1])).toMatch(
        /^Arbitrary code execution in underscore A06 underscore 1\.9\.1$/,
      );
      // The reasoning stays in the A06 section.
      expect(top).not.toContain('CISA KEV');
      // Without any analysed finding, no column of dashes.
      const plain = tableOf(
        sectionOf(
          render(report([vuln({ severity: 'critical' })])),
          'owasp-summary',
        ),
        'top-table',
      );
      expect(plain).not.toContain('AI verdict');
    });

    it('shows the strongest verdict of a top finding, the most confident one on a tie', () => {
      const note = (verdict: string, score: number) => ({
        verdict,
        source: 'agent',
        score,
        reason: null,
      });
      const top = tableOf(
        sectionOf(
          render(
            report([
              vuln({
                severity: 'critical',
                line: '1-1',
                exploitability: note('theoretical', 0.7),
              }),
              vuln({
                severity: 'critical',
                line: '2-2',
                exploitability: note('theoretical', 0.8),
              }),
              vuln({
                severity: 'critical',
                line: '3-3',
                exploitability: note('not_exploitable', 0.9),
              }),
            ]),
          ),
          'owasp-summary',
        ),
        'top-table',
      );
      expect(textOf(top)).toContain('Theoretical 80% confidence');
    });

    it('names the occurrence whose verdict and confidence the top list shows, not another of the same verdict', () => {
      const note = (score: number) => ({
        verdict: 'theoretical',
        source: 'agent',
        score,
        reason: null,
      });
      const top = tableOf(
        sectionOf(
          render(
            report([
              vuln({
                severity: 'critical',
                line: '32-32',
                exploitability: note(0.7),
              }),
              vuln({
                severity: 'critical',
                line: '33-33',
                exploitability: note(0.8),
              }),
            ]),
          ),
          'owasp-summary',
        ),
        'top-table',
      );
      expect(textOf(top)).toContain('Theoretical 80% confidence');
      expect(plainOf(top)).toContain('app/routes/contributions.js:33');
      expect(plainOf(top)).not.toContain('contributions.js:32');
    });

    it('names a code location by its full path and a package as the A06 tables do in the top list', () => {
      const top = tableOf(
        sectionOf(
          render(
            report([
              vuln({ severity: 'critical' }),
              vuln({
                type: 'sca',
                severity: 'critical',
                name: 'Arbitrary code execution in underscore',
                advisoryId: 'GHSA-1',
                path: undefined,
                line: undefined,
                packageName: 'underscore',
                packageVersion: '1.9.1',
              }),
            ]),
          ),
          'owasp-summary',
        ),
        'top-table',
      );
      expect(plainOf(top)).toContain('app/routes/contributions.js:32');
      // One notation for a package in the whole report: chip, then version.
      expect(top).toContain(
        `${packageChip('underscore')} <span class="versions">1.9.1</span>`,
      );
      expect(plainOf(top)).not.toContain('@');
    });

    it('says an empty category is not the absence of risk', () => {
      expect(html).toContain('not that the risk is absent');
    });

    it('shows an empty state instead of empty charts when nothing is open', () => {
      const empty = render(report([vuln({ state: 'resolved' })]));
      expect(empty).toContain('No open finding is mapped');
      expect(empty).not.toContain('class="hbars"');
      expect(empty).not.toContain('id="owasp-a03"');
    });
  });

  describe('category sections', () => {
    it('details only the categories with open findings, with the condensed reference text', () => {
      const html = render(
        report([vuln(), vuln({ id: 'only-triaged', state: 'ignored' })], (v) =>
          v.id === 'only-triaged' ? 'A01' : 'A03',
        ),
      );
      expect(html).toContain('id="owasp-a03"');
      expect(html).not.toContain('id="owasp-a01"');
      const a03 = sectionOf(html, 'owasp-a03');
      const ref = OWASP_TOP_10_2021_DATA.A03;
      expect(a03).toContain('Injection');
      expect(a03).toContain('How to prevent');
      expect(ref.keyPrevention.length).toBeGreaterThanOrEqual(3);
      expect(ref.keyPrevention.length).toBeLessThanOrEqual(5);
      expect(a03.match(/<li>/g)?.length).toBe(ref.keyPrevention.length);
      expect(a03).toContain(ref.url);
      for (const generic of [
        'Example Attack Scenarios',
        'Scenario #',
        'Factors',
        'Total CVEs',
        'References',
      ]) {
        expect(html).not.toContain(generic);
      }
    });

    it('says when the detection rule, not the official CWE list, placed findings in a category', () => {
      const iac = (over: Partial<MappedVulnerability>) =>
        vuln({
          type: 'iac',
          path: 'docker-compose.yml',
          owaspTop10: ['A08:2021'],
          ...over,
        });
      const html = render(
        report(
          [
            iac({ name: 'Missing healthcheck', cwe: ['CWE-703'] }),
            iac({ name: 'Unbound host interface', cwe: ['CWE-693'] }),
            // CWE-502 is on the official A08 list.
            iac({ name: 'Unsafe deserialisation', cwe: ['CWE-502'] }),
          ],
          () => 'A08',
        ),
      );
      expect(textOf(sectionOf(html, 'owasp-a08'))).toContain(
        'The detection rules of 2 of these findings assign them to A08, although their CWEs are not on the official A08 list.',
      );
      const all = render(
        report(
          [
            iac({ name: 'Missing healthcheck', cwe: ['CWE-703'] }),
            iac({ name: 'Unbound host interface', cwe: ['CWE-693'] }),
          ],
          () => 'A08',
        ),
      );
      expect(textOf(sectionOf(all, 'owasp-a08'))).toContain(
        'Their detection rules assign these 2 findings to A08, although their CWEs are not on the official A08 list.',
      );
      const single = render(
        report(
          [iac({ name: 'Missing healthcheck', cwe: ['CWE-703'] })],
          () => 'A08',
        ),
      );
      expect(textOf(sectionOf(single, 'owasp-a08'))).toContain(
        'Its detection rule assigns this finding to A08, although its CWE is not on the official A08 list.',
      );
      // Placed by its CWE: nothing to explain.
      expect(
        textOf(sectionOf(render(report([vuln()])), 'owasp-a03')),
      ).not.toContain('detection rule');
    });

    it('says when several rules report the same code, so the counts are not read as distinct flaws', () => {
      const html = render(
        report([
          vuln({
            name: 'Cookie without expiry',
            path: 'server.js',
            line: '78-102',
          }),
          vuln({
            name: 'Cookie without path',
            path: 'server.js',
            line: '78-102',
          }),
          vuln({
            name: 'Cookie without domain',
            path: 'server.js',
            line: '78-102',
          }),
        ]),
      );
      expect(plainOf(sectionOf(html, 'owasp-a03'))).toContain(
        'All 3 findings below point to the same code: server.js:78&#8211;102.',
      );
      // A short path in a sentence stays in one piece.
      expect(sectionOf(html, 'owasp-a03')).toContain(
        pathText('server.js:78–102', { keep: true }),
      );
      const partial = render(
        report([
          vuln({ name: 'Code injection via eval', line: '32-32' }),
          vuln({ name: 'Code injection via eval', line: '33-33' }),
          vuln({
            name: 'Uncontrolled eval',
            description: 'Other.',
            line: '32-32',
          }),
          vuln({
            name: 'Uncontrolled eval',
            description: 'Other.',
            line: '34-34',
          }),
        ]),
      );
      expect(plainOf(sectionOf(partial, 'owasp-a03'))).toContain(
        'Some locations are reported by more than one rule: app/routes/contributions.js:32 (2 rules).',
      );
      // Lines of one file are named once, in order.
      const lines = render(
        report([
          vuln({ name: 'Code injection via eval', line: '33-33' }),
          vuln({ name: 'Code injection via eval', line: '32-32' }),
          vuln({
            name: 'Uncontrolled eval',
            description: 'Other.',
            line: '32-32',
          }),
          vuln({
            name: 'Uncontrolled eval',
            description: 'Other.',
            line: '33-33',
          }),
        ]),
      );
      expect(plainOf(sectionOf(lines, 'owasp-a03'))).toContain(
        'Some locations are reported by more than one rule: app/routes/contributions.js, lines 32 and 33 (2 rules each).',
      );
      expect(
        textOf(sectionOf(render(report([vuln()])), 'owasp-a03')),
      ).not.toContain('more than one rule');
    });

    it('keeps every reference paragraph short and states the OWASP category page', () => {
      for (const cat of Object.values(OWASP_TOP_10_2021_DATA)) {
        expect(cat.brief.length).toBeLessThanOrEqual(400);
        expect(cat.url).toMatch(/^https:\/\/owasp\.org\/Top10\/A\d{2}_2021-/);
      }
    });

    it('groups identical findings: one description, then a table of their locations', () => {
      const html = render(
        report([
          vuln({ line: '32-32' }),
          vuln({ line: '33-33', state: 'confirmed' }),
          vuln({ line: '78-102', path: 'server.js' }),
        ]),
      );
      const a03 = sectionOf(html, 'owasp-a03');
      expect(a03.match(/runs arbitrary code/g)).toHaveLength(1);
      expect(a03).toContain('3 occurrences');
      expect(a03).toContain('contributions.js:32');
      expect(a03).toContain('contributions.js:33');
      expect(a03).toContain('server.js:78&#8211;102');
      expect(a03).toContain('<strong>user input</strong>');
      expect(a03).not.toContain('**');
    });

    it('gives a single occurrence one location line under the title instead of a table', () => {
      const a03 = sectionOf(render(report([vuln()])), 'owasp-a03');
      expect(a03).not.toContain('<table');
      const meta = /<div class="finding-meta">[\s\S]*?<\/div>/.exec(a03)?.[0];
      expect(plainOf(meta)).toContain('app/routes/contributions.js:32');
      expect(plainOf(meta)).toContain('To verify');
      expect(a03).not.toContain('1 occurrence');
    });

    // Without a table, nothing names the finding again on the next page: its
    // description never splits between two pages.
    it('keeps a finding whose occurrences fit on its scanner line whole', () => {
      expect(OWASP_REPORT_CSS).toMatch(
        /\.finding:not\(:has\(table\)\) \{[^}]*break-inside: avoid/,
      );
    });

    it('names the locations on the scanner line when a table would show nothing else', () => {
      const a03 = sectionOf(
        render(
          report([
            vuln({ path: 'NodeGoat/artifacts/db-reset.js', line: '36-36' }),
            vuln({ path: 'NodeGoat/artifacts/db-reset.js', line: '19-19' }),
            vuln({ path: 'NodeGoat/artifacts/db-reset.js', line: '28-28' }),
          ]),
        ),
        'owasp-a03',
      );
      expect(a03).not.toContain('<table');
      const meta = /<div class="finding-meta">[\s\S]*?<\/div>/.exec(a03)?.[0];
      // One file, its lines in order, like a single occurrence.
      expect(plainOf(meta)).toContain(
        'NodeGoat/artifacts/db-reset.js, lines 19, 28 and 36',
      );
      expect(plainOf(meta)).toContain('To verify');
      expect(plainOf(meta)).not.toContain('occurrences');
      // The description is shown once, above nothing but the next finding.
      expect(a03.match(/runs arbitrary code/g)).toHaveLength(1);
    });

    it('names each file of such a line once, with its lines, a range kept whole', () => {
      const a03 = sectionOf(
        render(
          report([
            vuln({ path: 'NodeGoat/docker-compose.yml', line: '13-13' }),
            vuln({ path: 'NodeGoat/server.js', line: '78-102' }),
            vuln({ path: 'NodeGoat/docker-compose.yml', line: '4-4' }),
          ]),
        ),
        'owasp-a03',
      );
      expect(a03).not.toContain('<table');
      const meta = /<div class="finding-meta">[\s\S]*?<\/div>/.exec(a03)?.[0];
      expect(plainOf(meta)).toContain(
        'NodeGoat/docker-compose.yml, lines 4 and 13; NodeGoat/server.js:78&#8211;102',
      );
    });

    it('states a verdict every occurrence shares once, under the finding, as for a single occurrence', () => {
      const same = {
        verdict: 'theoretical',
        source: 'agent',
        score: 0.3,
        reason: 'Resource limits only bound availability.',
      };
      const a03 = sectionOf(
        render(
          report([
            vuln({ line: '4-4', exploitability: same }),
            vuln({ line: '13-13', exploitability: same }),
          ]),
        ),
        'owasp-a03',
      );
      expect(a03).not.toContain('<table');
      expect(a03.match(/30% confidence/g)).toHaveLength(1);
      expect(
        a03.match(/Resource limits only bound availability/g),
      ).toHaveLength(1);
      expect(a03).not.toContain('All analysed occurrences');
      expect(a03.indexOf('runs arbitrary code')).toBeLessThan(
        a03.indexOf('class="ai-note'),
      );
      const meta = /<div class="finding-meta">[\s\S]*?<\/div>/.exec(a03)?.[0];
      expect(plainOf(meta)).toContain('contributions.js, lines 4 and 13');
    });

    it('keeps the table of occurrences when they differ, or are too many to name in one line', () => {
      const table = (items: MappedVulnerability[]) =>
        tableOf(sectionOf(render(report(items)), 'owasp-a03'), 'occ-table');
      const analysed = {
        verdict: 'theoretical',
        source: 'agent',
        score: 0.3,
        reason: null,
      };
      // States differ.
      expect(
        table([vuln(), vuln({ line: '33-33', state: 'confirmed' })]),
      ).toContain('>State<');
      // Only some are analysed, or their verdicts differ.
      expect(
        table([vuln({ exploitability: analysed }), vuln({ line: '33-33' })]),
      ).toContain('>AI verdict<');
      expect(
        table([
          vuln({ exploitability: analysed }),
          vuln({ line: '33-33', exploitability: { ...analysed, score: 0.8 } }),
        ]),
      ).toContain('>AI verdict<');
      // More than six locations, or more than two files.
      expect(
        table(
          Array.from({ length: 7 }, (_, i) =>
            vuln({ line: `${i + 1}-${i + 1}` }),
          ),
        ),
      ).toContain('>Location<');
      expect(
        table(['a.js', 'b.js', 'c.js'].map((path) => vuln({ path }))),
      ).toContain('>Location<');
      // Two occurrences at the same place would read as one.
      expect(
        table([
          vuln({ line: undefined }),
          vuln({ line: undefined, id: 'twin' }),
        ]),
      ).toContain('>Location<');
    });

    it('states a state shared by every occurrence once, and adds a state column only when they differ', () => {
      // A verdict on one of them only keeps the table of occurrences.
      const same = findingOf(
        render(
          report([
            vuln({
              exploitability: {
                verdict: 'theoretical',
                source: 'agent',
                score: 0.4,
                reason: null,
              },
            }),
            vuln({ line: '33-33' }),
          ]),
        ),
        'Uncontrolled eval execution',
      );
      const meta = /<div class="finding-meta">[\s\S]*?<\/div>/.exec(same)?.[0];
      expect(plainOf(meta)).toContain('2 occurrences');
      expect(plainOf(meta)).toContain('To verify');
      expect(tableOf(same, 'occ-table')).not.toContain('>State<');
      const mixed = findingOf(
        render(report([vuln(), vuln({ line: '33-33', state: 'confirmed' })])),
        'Uncontrolled eval execution',
      );
      expect(tableOf(mixed, 'occ-table')).toContain('>State<');
      expect(tableOf(mixed, 'occ-table')).toContain('Confirmed');
    });

    it('keeps an occurrence table with its finding across a page break, repeating the finding title', () => {
      const finding = findingOf(
        render(report([vuln(), vuln({ line: '33-33', state: 'confirmed' })])),
        'Uncontrolled eval execution',
      );
      // The block above the table covers the continuation row on the first page.
      expect(finding).toMatch(/class="[^"]*cont-cover[^"]*"[\s\S]*<table/);
      // One pattern for every continued table: section, then what continues.
      expect(tableOf(finding, 'occ-table')).toContain(
        'A03 &#183; Uncontrolled eval execution (continued)',
      );
    });

    it('sorts groups by severity, most severe first', () => {
      const html = render(
        report([
          vuln({ name: 'Low thing', severity: 'low' }),
          vuln({ name: 'Critical thing', severity: 'CRITICAL' }),
          vuln({ name: 'Medium thing', severity: 'medium' }),
        ]),
      );
      const a03 = sectionOf(html, 'owasp-a03');
      expect(a03.indexOf('Critical thing')).toBeLessThan(
        a03.indexOf('Medium thing'),
      );
      expect(a03.indexOf('Medium thing')).toBeLessThan(
        a03.indexOf('Low thing'),
      );
    });

    it('titles a container CVE by its id and packages, its ids under the title as for any advisory, then its summary (without « Issue summary: »)', () => {
      const a06 = sectionOf(
        render(
          report([
            vuln({
              type: 'container',
              name: 'CVE-2026-2673',
              description:
                'Issue summary: An OpenSSL TLS 1.3 server may fail to negotiate',
              path: undefined,
              line: undefined,
              packageName: 'libssl3',
              packageVersion: '3.5.5-r0',
            }),
          ]),
        ),
        'owasp-a06',
      );
      const advisories = tableOf(a06, 'dep-table');
      expect(textOf(advisories)).toContain(
        'CVE-2026-2673 in libssl3 Container An OpenSSL TLS 1.3 server may fail to negotiate',
      );
      expect(advisories).toMatch(
        /<div class="adv-title">[^]*?<\/div><div class="adv-ids">[^]*?<\/div><div class="adv-summary">An OpenSSL TLS 1.3 server may fail to negotiate<\/div>/,
      );
      expect(advisories).not.toContain('Issue summary');
      // The summary sits a little apart from the ids above it.
      expect(OWASP_REPORT_CSS).toMatch(
        /\.dep-table \.adv-summary \{[^}]*margin-top: 3px/,
      );
    });

    it('orders advisories of the same severity by the title they are shown under', () => {
      const a06 = sectionOf(
        render(
          report([
            vuln({
              type: 'sca',
              name: 'Denial of service in bson',
              advisoryId: 'GHSA-2',
              path: undefined,
              line: undefined,
              packageName: 'bson',
              packageVersion: '1.0.9',
            }),
            vuln({
              type: 'container',
              name: 'CVE-2026-27171',
              description: 'zlib before 1.3.2 allows CPU consumption',
              path: undefined,
              line: undefined,
              packageName: 'zlib',
              packageVersion: '1.3.1-r2',
            }),
            vuln({
              type: 'sca',
              name: 'Arbitrary file write in adm-zip',
              advisoryId: 'GHSA-1',
              path: undefined,
              line: undefined,
              packageName: 'adm-zip',
              packageVersion: '0.4.4',
            }),
          ]),
        ),
        'owasp-a06',
      );
      const rows = tableOf(a06, 'dep-table');
      expect(rows.indexOf('Arbitrary file write')).toBeLessThan(
        rows.indexOf('CVE-2026-27171'),
      );
      expect(rows.indexOf('CVE-2026-27171')).toBeLessThan(
        rows.indexOf('Denial of service'),
      );
    });

    it('lists dependencies by advisory, with each affected package and the fixed version', () => {
      const dep = (over: Partial<MappedVulnerability>) =>
        vuln({
          type: 'sca',
          name: 'Prototype pollution in lodash',
          description: 'Long advisory details that the table leaves out.',
          severity: 'critical',
          path: undefined,
          line: undefined,
          advisoryId: 'GHSA-jf85-cpcp-j695',
          cve: 'CVE-2019-10744',
          packageName: 'lodash',
          packageVersion: '4.17.4',
          fixedVersion: '4.17.12',
          ...over,
        });
      const html = render(
        report([
          dep({}),
          dep({ packageVersion: '4.17.11' }),
          vuln({
            type: 'container',
            name: 'CVE-2026-28390',
            description: '',
            severity: 'high',
            path: undefined,
            line: undefined,
            packageName: 'libssl3',
            packageVersion: '3.5.5-r0',
            fixedVersion: '3.5.6-r0',
            imageName: 'alpine:latest',
          }),
          vuln({
            type: 'container',
            name: 'CVE-2026-28390',
            description: '',
            severity: 'high',
            path: undefined,
            line: undefined,
            packageName: 'libcrypto3',
            packageVersion: '3.5.5-r0',
            fixedVersion: '3.5.6-r0',
            imageName: 'alpine:latest',
          }),
        ]),
      );
      const a06 = sectionOf(html, 'owasp-a06');
      const advisories = tableOf(a06, 'dep-table');
      expect(advisories.match(/Prototype pollution in lodash/g)).toHaveLength(
        1,
      );
      expect(advisories).toContain('GHSA-jf85-cpcp-j695');
      expect(advisories).toContain('CVE-2019-10744');
      // The installed versions that share a fixed version share one line:
      // the package, then its versions, even when there is only one.
      expect(advisories).toContain(
        `${packageChip('lodash')} <span class="versions">4.17.4, 4.17.11</span>`,
      );
      expect(advisories.match(/4\.17\.12/g)).toHaveLength(1);
      expect(advisories).toContain(codeChip('4.17.12'));
      // The fixed version follows a drawn arrow: the fonts have no U+2192.
      expect(advisories).toContain(arrowIcon());
      expect(a06).not.toContain('&#8594;');
      expect(textOf(advisories)).toContain(
        'CVE-2026-28390 in libcrypto3 and libssl3',
      );
      for (const name of ['libssl3', 'libcrypto3']) {
        expect(advisories).toContain(
          `${packageChip(name)} <span class="versions"><span class="nobr">3.5.5-r0</span></span>`,
        );
        expect(advisories).not.toContain(packageChip(name, '3.5.5-r0'));
      }
      expect(advisories).not.toContain(packageChip('lodash', '4.17.4'));
      expect(advisories.match(/alpine:latest/g)).toHaveLength(1);
      expect(a06).not.toContain('Long advisory details');
      expect(advisories.indexOf('Prototype pollution')).toBeLessThan(
        advisories.indexOf('CVE-2026-28390'),
      );
    });

    it('opens A06 on an upgrade plan: one row per package, with the version that fixes all its open advisories', () => {
      const dep = (over: Partial<MappedVulnerability>) =>
        vuln({
          type: 'sca',
          description: '',
          path: undefined,
          line: undefined,
          ...over,
        });
      const a06 = sectionOf(
        render(
          report([
            dep({
              name: 'Prototype pollution',
              advisoryId: 'GHSA-1',
              severity: 'critical',
              packageName: 'lodash',
              packageVersion: '2.4.2',
              fixedVersion: '4.17.5',
            }),
            dep({
              name: 'Command injection',
              advisoryId: 'GHSA-2',
              severity: 'high',
              packageName: 'lodash',
              packageVersion: '2.4.2',
              fixedVersion: '4.17.21',
            }),
            dep({
              name: 'Command injection',
              advisoryId: 'GHSA-2',
              severity: 'high',
              packageName: 'lodash',
              packageVersion: '4.17.11',
              fixedVersion: '4.17.21',
            }),
            dep({
              name: 'ReDoS',
              advisoryId: 'GHSA-3',
              severity: 'medium',
              packageName: 'lodash',
              packageVersion: '4.17.11',
              fixedVersion: '4.17.9',
            }),
            dep({
              name: 'Arbitrary file read in swig',
              advisoryId: 'GHSA-4',
              severity: 'high',
              packageName: 'swig',
              packageVersion: '1.4.2',
            }),
            dep({
              name: 'Prototype pollution in hoek',
              advisoryId: 'GHSA-5',
              severity: 'medium',
              packageName: 'hoek',
              packageVersion: '0.9.1',
              fixedVersion: '4.2.1',
            }),
            dep({
              name: 'hoek subject to prototype pollution',
              advisoryId: 'GHSA-6',
              severity: 'medium',
              packageName: 'hoek',
              packageVersion: '0.9.1',
            }),
          ]),
        ),
        'owasp-a06',
      );
      expect(a06).toContain('Upgrade plan');
      expect(textOf(a06)).toContain(
        'Counts are open findings, one per advisory and installed version.',
      );
      const plan = tableOf(a06, 'plan-table');
      expect(plan).toContain('>Open findings<');
      expect(plan).toContain(packageChip('lodash'));
      expect(a06.indexOf('Upgrade plan')).toBeLessThan(
        a06.indexOf('dep-table'),
      );
      const rows = plan
        .split('<tbody>')[1]
        .split('</tr>')
        .map(textOf)
        .filter(Boolean);
      // Worst severity first; the highest fixed version, never a lower one.
      // Counts are findings: GHSA-2 affects both installed lodash versions,
      // so the rows add up to the findings of the section.
      expect(rows[0]).toMatch(
        /^lodash 2\.4\.2, 4\.17\.11 4\.17\.21 .*1 critical.*2 high.*1 medium/,
      );
      expect(rows[1]).toMatch(/^swig 1\.4\.2 No fix /);
      expect(rows[2]).toMatch(
        /^hoek 0\.9\.1 4\.2\.1 1 advisory has no fix .*2 medium/,
      );
      expect(rows).toHaveLength(3);
      // The section says how findings, advisories and packages relate.
      expect(textOf(a06)).toContain(
        '7 open findings from 6 advisories in 3 packages.',
      );
    });

    it('fixes an image package at its highest distribution release, never misread as a semver pre-release', () => {
      const dep = (over: Partial<MappedVulnerability>) =>
        vuln({
          type: 'container',
          description: '',
          path: undefined,
          line: undefined,
          severity: 'high',
          imageName: 'alpine:3.18',
          ...over,
        });
      const a06 = sectionOf(
        render(
          report([
            // `-r10` read as a pre-release sorted before `-r9`.
            dep({
              name: 'zlib heap overflow',
              advisoryId: 'CVE-1',
              packageName: 'zlib',
              packageVersion: '1.2.5-r8',
              fixedVersion: '1.2.5-r10',
            }),
            dep({
              name: 'zlib out-of-bounds read',
              advisoryId: 'CVE-2',
              packageName: 'zlib',
              packageVersion: '1.2.5-r8',
              fixedVersion: '1.2.5-r9',
            }),
            // A backport (`~bpo11`) comes before the release it is from.
            dep({
              name: 'curl header injection',
              advisoryId: 'CVE-3',
              imageName: 'debian:11',
              packageName: 'curl',
              packageVersion: '7.74.0-1.3',
              fixedVersion: '7.88.1-10',
            }),
            dep({
              name: 'curl cookie leak',
              advisoryId: 'CVE-4',
              imageName: 'debian:11',
              packageName: 'curl',
              packageVersion: '7.74.0-1.3',
              fixedVersion: '7.88.1-10~bpo11+1',
            }),
          ]),
        ),
        'owasp-a06',
      );
      const rows = tableOf(a06, 'plan-table')
        .split('<tbody>')[1]
        .split('</tr>')
        .map(textOf)
        .filter(Boolean);
      // « in » is joined to its image by a no-break space.
      expect(rows.find((r) => r.startsWith('zlib'))).toMatch(
        /^zlib 1\.2\.5-r8 in&#160; alpine:3\.18 1\.2\.5-r10 /,
      );
      expect(rows.find((r) => r.startsWith('curl'))).toMatch(
        /^curl 7\.74\.0-1\.3 in&#160; debian:11 7\.88\.1-10 /,
      );
    });

    it('orders the upgrade plan by risk: worst severity, an exploitable verdict, then the critical, high, medium and low counts', () => {
      const dep = (
        packageName: string,
        severity: string,
        advisoryId: string,
        over: Partial<MappedVulnerability> = {},
      ) =>
        vuln({
          type: 'sca',
          name: `Flaw ${advisoryId}`,
          description: '',
          advisoryId,
          severity,
          path: undefined,
          line: undefined,
          packageName,
          packageVersion: '1.0.0',
          fixedVersion: '2.0.0',
          ...over,
        });
      const a06 = sectionOf(
        render(
          report([
            dep('bson', 'critical', 'GHSA-1'),
            dep('bson', 'medium', 'GHSA-2'),
            dep('underscore', 'critical', 'GHSA-3', {
              exploitability: {
                verdict: 'actively_exploited',
                source: 'agent',
                score: 1,
                reason: null,
              },
            }),
            dep('underscore', 'high', 'GHSA-4'),
            dep('marked', 'high', 'GHSA-5'),
            dep('marked', 'medium', 'GHSA-6'),
            dep('marked', 'medium', 'GHSA-7'),
            dep('marked', 'medium', 'GHSA-8'),
            dep('qs', 'high', 'GHSA-9', {
              exploitability: {
                verdict: 'proven',
                source: 'agent',
                score: 0.75,
                reason: null,
              },
            }),
            dep('qs', 'high', 'GHSA-10'),
            dep('async', 'high', 'GHSA-11', {
              exploitability: {
                verdict: 'theoretical',
                source: 'agent',
                score: 0.4,
                reason: null,
              },
            }),
          ]),
        ),
        'owasp-a06',
      );
      const plan = tableOf(a06, 'plan-table');
      // underscore is actively exploited; qs, proven, comes before marked,
      // which has more findings in all.
      const order = ['underscore', 'bson', 'qs', 'marked', 'async'].map((n) =>
        plan.indexOf(`>${n}<`),
      );
      expect(order[0]).toBeGreaterThan(-1);
      expect(order).toEqual([...order].sort((a, b) => a - b));
      // The verdict that moves a package up is shown on its row, so the
      // order reads; a theoretical verdict moves nothing and is not shown.
      const rows = plan
        .split('<tbody>')[1]
        .split('</tr>')
        .filter((r) => r.includes('<td'));
      const rowOf = (name: string) =>
        rows.find((r) => r.includes(`>${name}<`)) ?? '';
      expect(rowOf('underscore')).toContain(verdictPill('actively_exploited'));
      expect(rowOf('qs')).toContain(verdictPill('proven'));
      for (const name of ['bson', 'marked', 'async']) {
        expect(rowOf(name)).not.toContain('class="verdict');
      }
      // At the right end of the cell, the verdicts of the column line up.
      expect(OWASP_REPORT_CSS).toMatch(
        /\.plan-verdict \{[^}]*margin-left: auto/,
      );
      // The intro states the order.
      expect(textOf(a06)).toContain(
        'Rows run by worst severity, then a finding rated proven or actively exploited (its verdict shown), then the number of findings at each severity, from critical down.',
      );
      // Without any such verdict, the intro does not mention one.
      const plain = sectionOf(
        render(report([dep('bson', 'critical', 'GHSA-1')])),
        'owasp-a06',
      );
      expect(textOf(plain)).toContain(
        'Rows run by worst severity, then the number of findings at each severity, from critical down.',
      );
    });

    it('says in what order the advisories run, naming only the criteria that apply', () => {
      const dep = (over: Partial<MappedVulnerability>) =>
        vuln({
          type: 'sca',
          description: '',
          path: undefined,
          line: undefined,
          packageName: 'qs',
          packageVersion: '0.6.6',
          ...over,
        });
      const introOf = (vulns: MappedVulnerability[]) =>
        textOf(
          /<h3>Advisories<\/h3>[\s\S]*?<\/p>/.exec(
            sectionOf(render(report(vulns)), 'owasp-a06'),
          )?.[0],
        );
      const full = introOf([
        dep({ name: 'A', advisoryId: 'GHSA-1' }),
        dep({
          name: 'B',
          advisoryId: 'GHSA-2',
          state: 'confirmed',
          exploitability: {
            verdict: 'proven',
            source: 'agent',
            score: 0.75,
            reason: null,
          },
        }),
        dep({ name: 'C', advisoryId: 'GHSA-3', withdrawn: true }),
      ]);
      expect(full).toContain(
        'Rows run by severity, then an advisory rated proven or actively exploited, then a confirmed one, then the number of findings; withdrawn advisories close their severity.',
      );
      const plain = introOf([
        dep({ name: 'A', advisoryId: 'GHSA-1' }),
        dep({ name: 'B', advisoryId: 'GHSA-2' }),
      ]);
      expect(plain).toContain(
        'Rows run by severity, then the number of findings.',
      );
    });

    it('keeps together the packages of one image that share their advisories and fixed version', () => {
      const proven = {
        verdict: 'proven',
        source: 'agent',
        score: 0.8,
        reason: null,
      };
      const os = (
        packageName: string,
        name: string,
        severity: string,
        over: Partial<MappedVulnerability> = {},
      ) =>
        vuln({
          type: 'container',
          name,
          description: '',
          severity,
          path: undefined,
          line: undefined,
          packageName,
          packageVersion: '3.5.5-r0',
          fixedVersion: '3.5.6-r0',
          imageName: 'alpine:latest',
          ...over,
        });
      const a06 = sectionOf(
        render(
          report([
            os('libssl3', 'CVE-2026-28390', 'high', { exploitability: proven }),
            os('libssl3', 'CVE-2026-28387', 'medium'),
            os('libcrypto3', 'CVE-2026-28390', 'high'),
            os('libcrypto3', 'CVE-2026-28387', 'medium'),
            os('musl', 'CVE-2026-40200', 'high', {
              packageVersion: '1.2.5-r21',
              fixedVersion: '1.2.5-r23',
              exploitability: proven,
            }),
            // Same image and fix, other advisories: not a twin.
            os('zlib', 'CVE-2026-22184', 'high', {
              packageVersion: '1.3.1-r2',
              fixedVersion: '1.3.2-r0',
            }),
            vuln({
              type: 'sca',
              name: 'Prototype Pollution in async',
              advisoryId: 'GHSA-fwr7-v2mv-hh25',
              description: '',
              path: undefined,
              line: undefined,
              packageName: 'async',
              packageVersion: '2.6.1',
              fixedVersion: '2.6.4',
              exploitability: proven,
            }),
          ]),
        ),
        'owasp-a06',
      );
      const plan = tableOf(a06, 'plan-table');
      const rows = plan
        .split('</thead>')[1]
        .split('</tr>')
        .filter((r) => r.includes('<td'));
      const names = rows.map((r) => /class="seg">([^<]+)</.exec(r)?.[1]);
      // libcrypto3 has no verdict of its own: without its twin it would
      // come after every package with one.
      expect(names).toEqual(['libssl3', 'libcrypto3', 'async', 'musl', 'zlib']);
      // One group of rows, never parted by a page break.
      expect(plan).toMatch(
        /<tbody class="unit"><tr class="has-twin">[\s\S]*?libssl3[\s\S]*?<\/tr><tr class="twin">[\s\S]*?libcrypto3[\s\S]*?<\/tr><\/tbody>/,
      );
      expect(textOf(a06)).toContain(
        'then the number of findings at each severity, from critical down; packages of one image that share their advisories and fixed version stay together.',
      );
      // Without such packages, the intro does not mention them.
      const single = sectionOf(
        render(report([os('libssl3', 'CVE-2026-28390', 'high')])),
        'owasp-a06',
      );
      expect(textOf(single)).not.toContain('stay together');
    });

    it('names a state shared by every advisory once instead of a constant state column', () => {
      const dep = (over: Partial<MappedVulnerability>) =>
        vuln({
          type: 'sca',
          path: undefined,
          line: undefined,
          packageName: 'qs',
          packageVersion: '0.6.6',
          ...over,
        });
      const same = sectionOf(
        render(
          report([
            dep({ name: 'A', advisoryId: 'GHSA-1' }),
            dep({ name: 'B', advisoryId: 'GHSA-2' }),
          ]),
        ),
        'owasp-a06',
      );
      expect(tableOf(same, 'dep-table')).not.toContain('>State<');
      expect(textOf(same)).toContain(
        '2 advisories behind the 2 open findings, all to verify.',
      );
      // Never « Advisories 2 advisories ».
      expect(textOf(same)).not.toMatch(/Advisories \d+ advisories/);
      const mixed = sectionOf(
        render(
          report([
            dep({ name: 'A', advisoryId: 'GHSA-1' }),
            dep({ name: 'B', advisoryId: 'GHSA-2', state: 'confirmed' }),
          ]),
        ),
        'owasp-a06',
      );
      expect(tableOf(mixed, 'dep-table')).toContain('>State<');
    });

    it('says « No fix » like the dashboard when no fixed version is known', () => {
      const a06 = sectionOf(
        render(
          report([
            vuln({
              type: 'sca',
              name: 'Arbitrary file read in swig',
              advisoryId: 'GHSA-4',
              path: undefined,
              line: undefined,
              packageName: 'swig',
              packageVersion: '1.4.2',
            }),
          ]),
        ),
        'owasp-a06',
      );
      const table = tableOf(a06, 'dep-table');
      expect(plainOf(table)).toContain('swig 1.4.2');
      expect(textOf(table)).toMatch(/1\.4\.2 No fix$/);
      expect(a06).not.toContain('no fix listed');
    });

    it('titles a container CVE by its id and packages, so identical summaries stay distinct', () => {
      const cve = (packageName: string) =>
        vuln({
          type: 'container',
          name: 'CVE-2026-28390',
          description: '',
          path: undefined,
          line: undefined,
          packageName,
          packageVersion: '3.5.5-r0',
          imageName: 'alpine:latest',
        });
      const a06 = sectionOf(
        render(report([cve('libssl3'), cve('libcrypto3')])),
        'owasp-a06',
      );
      const advisories = tableOf(a06, 'dep-table');
      expect(textOf(advisories)).toContain(
        'CVE-2026-28390 in libcrypto3 and libssl3',
      );
      expect(advisories).not.toContain('Vulnerability in');
      // The id heads the title: it is not repeated on the id line.
      expect(textOf(advisories).match(/CVE-2026-28390/g)).toHaveLength(1);
    });

    it('flags every withdrawn advisory the same way, naming the advisory a duplicate repeats', () => {
      const html = render(
        report([
          vuln({
            type: 'sca',
            name: 'Withdrawn Advisory: express improperly controls query properties',
            advisoryId: 'GHSA-pj86',
            severity: 'low',
            path: undefined,
            line: undefined,
            packageName: 'express',
            packageVersion: '4.16.4',
          }),
          vuln({
            type: 'sca',
            name: 'Duplicate Advisory: uuid: Missing buffer bounds check',
            description:
              '## Duplicate Advisory\nThis advisory has been withdrawn because it is a duplicate of GHSA-w5hq-g745-h8pq. This link is maintained to preserve external references.',
            advisoryId: 'GHSA-qmq6',
            severity: '',
            path: undefined,
            line: undefined,
            packageName: 'uuid',
            packageVersion: '3.3.2',
            withdrawn: true,
          }),
        ]),
      );
      const advisories = tableOf(sectionOf(html, 'owasp-a06'), 'dep-table');
      expect(advisories).toContain(
        '<div class="adv-title">express improperly controls query properties</div>',
      );
      expect(advisories).toContain(
        '<div class="adv-title">uuid: Missing buffer bounds check</div>',
      );
      // One flag for both: a duplicate is an advisory withdrawn as such.
      expect(textOf(advisories).match(/Withdrawn/g)).toHaveLength(2);
      expect(textOf(advisories)).not.toContain('Duplicate Advisory');
      expect(textOf(advisories)).toContain('Duplicate of GHSA-w5hq-g745-h8pq');
      expect(html).toContain('2 open findings');
      expect(textOf(sectionOf(html, 'owasp-a06'))).toContain(
        '2 open findings from 2 advisories in 2 packages. Both come from advisories their publisher later withdrew (1&#160;as&#160;a&#160;duplicate); they are flagged below and still counted.',
      );
    });

    it('flags an advisory withdrawn in its OSV record or in its text, and never lets it set the upgrade target', () => {
      const dep = (over: Partial<MappedVulnerability>) =>
        vuln({
          type: 'sca',
          severity: 'high',
          path: undefined,
          line: undefined,
          packageName: 'qs',
          packageVersion: '0.6.6',
          ...over,
        });
      const a06 = sectionOf(
        render(
          report([
            dep({
              name: 'Prototype pollution in qs',
              advisoryId: 'GHSA-1',
              fixedVersion: '6.2.4',
            }),
            dep({
              name: 'High severity vulnerability that affects qs',
              description:
                'Withdrawn, accidental duplicate publish.\n\nThe qs module before 1.0.0 does not call compact.',
              advisoryId: 'GHSA-2',
              fixedVersion: '1.0.0',
            }),
            dep({
              name: 'Content injection in marked',
              advisoryId: 'GHSA-3',
              packageName: 'marked',
              packageVersion: '0.3.5',
              fixedVersion: '0.3.9',
              withdrawn: true,
            }),
            dep({
              name: 'Regular expression denial of service in marked',
              advisoryId: 'GHSA-4',
              packageName: 'marked',
              packageVersion: '0.3.5',
              fixedVersion: '0.3.6',
            }),
          ]),
        ),
        'owasp-a06',
      );
      const rows = tableOf(a06, 'dep-table')
        .split('<tbody>')[1]
        .split('</tr>')
        .map(textOf);
      const row = (title: string) => rows.find((r) => r.includes(title));
      expect(row('affects qs')).toContain('Withdrawn');
      expect(row('Content injection')).toContain('Withdrawn');
      expect(row('Prototype pollution')).not.toContain('Withdrawn');
      const plan = tableOf(a06, 'plan-table')
        .split('<tbody>')[1]
        .split('</tr>')
        .map(textOf);
      // qs 1.0.0 and marked 0.3.9 come from withdrawn advisories.
      expect(plan.find((r) => r.startsWith('qs'))).toMatch(
        /^qs 0\.6\.6 6\.2\.4 /,
      );
      expect(plan.find((r) => r.startsWith('marked'))).toMatch(
        /^marked 0\.3\.5 0\.3\.6 /,
      );
      expect(textOf(a06)).toContain(
        'Withdrawn advisories never set the target.',
      );
      expect(textOf(a06)).toContain(
        '2 of them come from advisories their publisher later withdrew (1&#160;as&#160;a&#160;duplicate); they are flagged below and still counted.',
      );
      // An accidental duplicate publish is named as a duplicate too.
      expect(row('affects qs')).toContain('Duplicate of another advisory');
    });

    it('sets a withdrawn advisory apart from its scanner chip, after the live ones of its severity', () => {
      const dep = (over: Partial<MappedVulnerability>) =>
        vuln({
          type: 'sca',
          severity: 'medium',
          path: undefined,
          line: undefined,
          packageName: 'uuid',
          packageVersion: '3.3.2',
          fixedVersion: '14.0.0',
          ...over,
        });
      const a06 = sectionOf(
        render(
          report([
            dep({
              name: 'uuid: Missing buffer bounds check',
              description:
                'This advisory has been withdrawn because it is a duplicate of GHSA-w5hq-g745-h8pq.',
              advisoryId: 'GHSA-qmq6-f8pr-cx5x',
              withdrawn: true,
            }),
            dep({
              name: 'Cross-site scripting in marked',
              advisoryId: 'GHSA-8wp3',
              packageName: 'marked',
              withdrawn: true,
            }),
            dep({
              name: 'uuid: Missing buffer bounds check',
              advisoryId: 'GHSA-w5hq-g745-h8pq',
            }),
            dep({
              name: 'Remote memory exposure in request',
              advisoryId: 'GHSA-7xfp',
              packageName: 'request',
            }),
          ]),
        ),
        'owasp-a06',
      );
      const advisories = tableOf(a06, 'dep-table');
      // Live advisories first, then the withdrawn ones: an original precedes
      // the duplicate that repeats it.
      const at = (id: string) => advisories.indexOf(id);
      expect(at('GHSA-w5hq-g745-h8pq</span>')).toBeLessThan(
        at('GHSA-qmq6-f8pr-cx5x'),
      );
      expect(at('GHSA-7xfp')).toBeLessThan(at('GHSA-8wp3'));
      // The duplicate note has a line of its own, never inside the ids line.
      const ids = advisories.match(/<div class="adv-ids">[\s\S]*?<\/div>/g);
      expect(ids.join('')).not.toContain('uplicate');
      expect(advisories).toMatch(
        /<div class="adv-dup">Duplicate of <span class="mono">GHSA-w5hq-g745-h8pq<\/span><\/div>/,
      );
      // The flag is drawn apart from the neutral scanner chip.
      expect(advisories).toContain('<span class="chip flag">Withdrawn</span>');
      expect(OWASP_REPORT_CSS).toMatch(/\.chip\.flag \{[^}]*dashed/);
    });

    it('shows the CVSS score of an advisory when it is known', () => {
      const a06 = sectionOf(
        render(
          report([
            vuln({
              type: 'container',
              name: 'CVE-2026-1',
              description: 'musl iconv out-of-bounds write',
              path: undefined,
              line: undefined,
              packageName: 'musl',
              packageVersion: '1.2.5-r21',
              cvssScore: 7.5,
            }),
          ]),
        ),
        'owasp-a06',
      );
      expect(textOf(tableOf(a06, 'dep-table'))).toContain('CVSS 7.5');
    });

    it('explains why a container severity can differ from its CVSS score, and how withdrawn advisories count', () => {
      const about = textOf(
        render(report([vuln()])).split('About this report')[1],
      );
      expect(about).toContain(
        'The severity of a container finding is the rating of the image distribution, which can differ from the CVSS base score shown next to it.',
      );
      expect(about).toContain(
        'Advisories their publisher withdrew, duplicates included, are flagged and still counted, as on the CybeDefend dashboard, but never set an upgrade target.',
      );
    });

    describe('AI note of an advisory affecting several packages', () => {
      const proven = {
        verdict: 'proven',
        source: 'agent',
        score: 0.75,
        reason: 'Public PoC available, vulnerability reachable through API.',
      };
      const qs = (over: Partial<MappedVulnerability>) =>
        vuln({
          type: 'sca',
          name: 'qs vulnerable to Prototype Pollution',
          advisoryId: 'GHSA-hrpp-h998-j3pp',
          cve: 'CVE-2022-24999',
          path: undefined,
          line: undefined,
          packageName: 'qs',
          ...over,
        });
      const cve = (packageName: string, over: Partial<MappedVulnerability>) =>
        vuln({
          type: 'container',
          name: 'CVE-2026-28390',
          description: '',
          path: undefined,
          line: undefined,
          packageName,
          packageVersion: '3.5.5-r0',
          fixedVersion: '3.5.6-r0',
          imageName: 'alpine:latest',
          ...over,
        });
      /** The AI note of the first advisory, closing its cell. */
      const ADV_NOTE =
        /<div class="ai-note has-head adv-note">[\s\S]*?(?=<\/td>)/;
      /** Visible text of the AI note under the advisory title. */
      const noteOf = (vulns: MappedVulnerability[]): string =>
        textOf(
          ADV_NOTE.exec(
            tableOf(sectionOf(render(report(vulns)), 'owasp-a06'), 'dep-table'),
          )?.[0],
        );

      it('names the installed version its verdict covers, never the one only a static heuristic rated', () => {
        const note = noteOf([
          qs({
            packageVersion: '0.6.6',
            fixedVersion: '6.2.4',
            exploitability: {
              verdict: 'not_exploitable',
              source: 'static',
              score: 0.1,
              reason: 'Static analysis: development dependency.',
            },
          }),
          qs({
            packageVersion: '6.5.2',
            fixedVersion: '6.5.3',
            exploitability: proven,
          }),
        ]);
        expect(note).toBe(
          'AI analysis &#183; qs 6.5.2 Proven 75% confidence Public PoC available, vulnerability reachable through API.',
        );
      });

      it('names the package its verdict covers by its name alone when the advisory has one version of it', () => {
        const note = noteOf([
          cve('libssl3', { exploitability: { ...proven, score: 0.8 } }),
          cve('libcrypto3', {
            exploitability: {
              verdict: 'proven',
              source: 'static',
              score: 0.87,
              reason: 'Static analysis: known exploitable pattern.',
            },
          }),
        ]);
        expect(note).toMatch(
          /^AI analysis &#183; libssl3 Proven 80% confidence /,
        );
        expect(note).not.toContain('libcrypto3');
      });

      it('names the image too when the CVE affects the same package in several images', () => {
        const note = noteOf([
          cve('libssl3', { exploitability: proven }),
          cve('libssl3', { imageName: 'node:18-alpine' }),
        ]);
        // « in » is joined to its image by a no-break space.
        expect(note).toMatch(
          /^AI analysis &#183; libssl3 in&#160; alpine:latest Proven 75% confidence /,
        );
        expect(note).not.toContain('node:18-alpine');
      });

      it('names every package its verdict covers, and none when it covers them all', () => {
        const three = noteOf([
          cve('libssl3', { exploitability: proven }),
          cve('libcrypto3', { exploitability: proven }),
          cve('openssl', {}),
        ]);
        expect(three).toMatch(
          /^AI analysis &#183; libcrypto3 and libssl3 Proven 75% confidence /,
        );
        // The same verdict on every package, or a single package: the note
        // speaks for the whole advisory, as before.
        const all = noteOf([
          cve('libssl3', { exploitability: proven }),
          cve('libcrypto3', { exploitability: { ...proven, score: 0.6 } }),
        ]);
        expect(all).toBe(
          'AI analysis Proven 75% confidence Public PoC available, vulnerability reachable through API.',
        );
        const single = noteOf([
          qs({ packageVersion: '6.5.2', exploitability: proven }),
        ]);
        expect(single).toBe(
          'AI analysis Proven 75% confidence Public PoC available, vulnerability reachable through API.',
        );
      });

      it('starts every reasoning at one abscissa, whatever the verdict beside it', () => {
        // « Theoretical » and « Proven » made heads of 202 and 182px: the
        // reasoning moved from note to note. The head is as wide as
        // « AI analysis Theoretical 100% confidence »; a label under a table
        // (« All analysed occurrences: ») keeps its own width.
        expect(OWASP_REPORT_CSS).toContain(
          '.ai-note.has-head:not(.ai-after) > .ai-head { min-width: 210px; }',
        );
      });

      it('lets a head naming packages wrap between them rather than squeeze the reasoning', () => {
        expect(OWASP_REPORT_CSS).toMatch(
          /\.ai-note\.has-head \{[^}]*grid-template-columns: fit-content\(60%\) minmax\(0, 1fr\)/,
        );
        expect(OWASP_REPORT_CSS).toMatch(
          /\.ai-scope \{[^}]*white-space: normal/,
        );
      });

      it('starts every reasoning of the advisories table at the same left edge, under its head', () => {
        // Heads of different widths would start each reasoning at its own
        // abscissa, row after row: in that table, the reasoning takes the
        // line under its head.
        expect(OWASP_REPORT_CSS).toMatch(
          /\.dep-table \.ai-note\.has-head \{[^}]*display: block/,
        );
        const note = ADV_NOTE.exec(
          tableOf(
            sectionOf(
              render(
                report([
                  qs({ packageVersion: '6.5.2', exploitability: proven }),
                ]),
              ),
              'owasp-a06',
            ),
            'dep-table',
          ),
        )?.[0];
        expect(note).toMatch(
          /<span class="ai-head">[\s\S]*?<\/span><div class="ai-reason">/,
        );
      });

      it('sets the note in the advisory cell, under its ids, whatever the height of the package cell', () => {
        // A note on a row of its own starts under the tallest cell of the
        // row above: further down when the advisory spans two packages.
        const table = tableOf(
          sectionOf(
            render(
              report([
                cve('libssl3', { exploitability: { ...proven, score: 0.8 } }),
                cve('libcrypto3', {}),
              ]),
            ),
            'owasp-a06',
          ),
          'dep-table',
        );
        expect(table).not.toContain('note-row');
        const cells = table
          .split('<tbody>')[1]
          .split('</td>')
          .filter((c) => c.includes('<td'));
        const advisory = cells.find((c) => c.includes('adv-title')) ?? '';
        expect(advisory).toMatch(
          /class="adv-ids"[\s\S]*<div class="ai-note has-head adv-note">/,
        );
        expect(textOf(advisory)).toContain(
          'Public PoC available, vulnerability reachable through API.',
        );
        expect(OWASP_REPORT_CSS).not.toMatch(/tr\.adv-note/);
      });

      it('credits the verdict to exactly the findings the key facts count as exploitable', () => {
        const html = render(
          report([
            qs({
              packageVersion: '0.6.6',
              fixedVersion: '6.2.4',
              exploitability: {
                verdict: 'not_exploitable',
                source: 'static',
                score: 0.1,
                reason: 'Static analysis: development dependency.',
              },
            }),
            qs({
              packageVersion: '6.5.2',
              fixedVersion: '6.5.3',
              exploitability: proven,
            }),
          ]),
        );
        expect(textOf(html)).toContain(
          '1 open finding was rated proven or actively exploited by the AI analysis.',
        );
        const note = ADV_NOTE.exec(
          tableOf(sectionOf(html, 'owasp-a06'), 'dep-table'),
        )?.[0];
        expect(note).toContain(
          `${packageChip('qs')} <span class="versions">6.5.2</span>`,
        );
        expect(note).not.toContain('0.6.6');
      });

      it('names, in the top list, an occurrence the verdict shown beside it covers', () => {
        const top = tableOf(
          sectionOf(
            render(
              report([
                qs({
                  severity: 'critical',
                  packageVersion: '0.6.6',
                  fixedVersion: '6.2.4',
                }),
                qs({
                  severity: 'critical',
                  packageVersion: '6.5.2',
                  fixedVersion: '6.5.3',
                  exploitability: proven,
                }),
              ]),
            ),
            'owasp-summary',
          ),
          'top-table',
        );
        // « +1 version » says what it counts: another version of the package
        // named, where a code finding counts other locations (« +1 more »).
        expect(plainOf(top)).toContain('qs 6.5.2+1 version');
        expect(plainOf(top)).not.toContain('more version');
        expect(top).not.toContain('0.6.6');
      });

      it('says, in the top list, whether the other occurrences of an advisory are versions or packages', () => {
        const topOf = (vulns: MappedVulnerability[]): string =>
          plainOf(
            tableOf(
              sectionOf(render(report(vulns)), 'owasp-summary'),
              'top-table',
            ),
          );
        const critical = { severity: 'critical' };
        expect(
          topOf([
            cve('libssl3', critical),
            cve('libcrypto3', critical),
            cve('openssl', critical),
          ]),
        ).toContain('libcrypto3 3.5.5-r0 in&#160;alpine:latest+2 packages');
        expect(
          topOf([
            qs({ ...critical, packageVersion: '0.6.6' }),
            qs({ ...critical, packageVersion: '1.0.0' }),
            qs({ ...critical, packageVersion: '6.5.2' }),
          ]),
        ).toContain('qs 0.6.6+2 versions');
        // A code finding keeps its short « +N more » of locations.
        expect(
          topOf([
            vuln({ severity: 'critical', line: '1-1' }),
            vuln({ severity: 'critical', line: '2-2' }),
          ]),
        ).toMatch(/contributions\.js:1\+1 more(?! [a-z])/);
      });

      it('explains, at the end, that the note names the packages a verdict covers', () => {
        const about = textOf(
          render(report([vuln()])).split('About this report')[1],
        );
        expect(about).toContain(
          'An advisory shows the strongest verdict among its packages; when that verdict covers only some of them, its note names them.',
        );
      });
    });

    it('adds a compact AI note under an occurrence analysed by the agent or a reviewer only', () => {
      const html = render(
        report([
          vuln({
            exploitability: {
              verdict: 'proven',
              source: 'agent',
              score: 0.85,
              reason: 'Reachable from the **contributions** route.',
            },
          }),
          vuln({
            path: 'static.js',
            exploitability: {
              verdict: 'theoretical',
              source: 'static',
              score: 0.3,
              reason: 'Heuristic default.',
            },
          }),
        ]),
      );
      expect(html).toContain('class="ai-note"');
      expect(html).toContain('Proven');
      expect(html).toContain('85% confidence');
      expect(html).toContain('<strong>contributions</strong>');
      expect(html).not.toContain('Heuristic default');
    });

    it('gives every analysed occurrence its verdict in a column, and a reasoning they all share once, under the table', () => {
      const shared = {
        verdict: 'theoretical',
        source: 'agent',
        score: 0.42,
        reason: 'Pattern detected but requires specific preconditions.',
      };
      const a03 = sectionOf(
        render(
          report([
            vuln({ line: '1-1', exploitability: shared }),
            vuln({ line: '2-2', exploitability: shared }),
            vuln({ line: '3-3', exploitability: { ...shared, score: 0.6 } }),
          ]),
        ),
        'owasp-a03',
      );
      const table = tableOf(a03, 'occ-table');
      expect(table).toContain('>AI verdict<');
      expect(table.match(/42% confidence/g)).toHaveLength(2);
      expect(table.match(/60% confidence/g)).toHaveLength(1);
      expect(table).not.toContain('requires specific preconditions');
      expect(a03.match(/requires specific preconditions/g)).toHaveLength(1);
      const after = a03.slice(a03.indexOf('</table>'));
      expect(textOf(after)).toContain(
        'All analysed occurrences: Pattern detected but requires specific preconditions.',
      );
      // No head line above the table any more.
      expect(a03).not.toContain('all 3 occurrences');
    });

    it('puts the reasoning of each occurrence on a full-width line under its row', () => {
      const note = (reason: string) => ({
        verdict: 'theoretical',
        source: 'agent',
        score: 0.8,
        reason,
      });
      const table = tableOf(
        sectionOf(
          render(
            report([
              vuln({ line: '1-1', exploitability: note('Reason one.') }),
              vuln({ line: '2-2', exploitability: note('Reason two.') }),
            ]),
          ),
          'owasp-a03',
        ),
        'occ-table',
      );
      expect(table.match(/80% confidence/g)).toHaveLength(2);
      expect(table).toMatch(/<td colspan="2">[\s\S]*?Reason one\./);
      expect(table).toMatch(/<td colspan="2">[\s\S]*?Reason two\./);
      // The reasoning follows the row it explains.
      expect(table.indexOf('contributions.js:1')).toBeLessThan(
        table.indexOf('Reason one.'),
      );
      expect(table.indexOf('Reason one.')).toBeLessThan(
        table.indexOf('contributions.js:2'),
      );
    });

    it('hangs a wrapped AI reasoning under its own first line, not under its head', () => {
      const html = render(
        report([
          vuln({
            exploitability: {
              verdict: 'proven',
              source: 'agent',
              score: 0.8,
              reason: 'Reachable from the route.',
            },
          }),
        ]),
      );
      expect(html).toMatch(
        /<div class="ai-note has-head"><span class="ai-head">[\s\S]*?<\/span><div class="ai-reason">/,
      );
      expect(OWASP_REPORT_CSS).toMatch(
        /\.ai-note\.has-head \{[^}]*grid-template-columns/,
      );
      // Pill and confidence share a baseline.
      expect(OWASP_REPORT_CSS).toMatch(
        /\.ai-cell \{[^}]*align-items: baseline/,
      );
    });

    it('places the AI note of a single occurrence after its description', () => {
      const a03 = sectionOf(
        render(
          report([
            vuln({
              exploitability: {
                verdict: 'proven',
                source: 'agent',
                score: 0.82,
                reason: 'Reachable from the route.',
              },
            }),
          ]),
        ),
        'owasp-a03',
      );
      expect(a03.indexOf('runs arbitrary code')).toBeLessThan(
        a03.indexOf('class="ai-note'),
      );
      expect(a03).toContain('82% confidence');
    });

    it('prints a repeated AI reasoning once when only some occurrences share it', () => {
      const note = {
        verdict: 'theoretical',
        source: 'agent',
        score: 0.42,
        reason: 'Pattern detected but requires specific preconditions.',
      };
      const a03 = sectionOf(
        render(
          report([
            vuln({ line: '1-1', exploitability: note }),
            vuln({ line: '2-2', exploitability: note }),
            vuln({ line: '3-3' }),
          ]),
        ),
        'owasp-a03',
      );
      expect(a03.match(/requires specific preconditions/g)).toHaveLength(1);
      expect(a03.match(/42% confidence/g)).toHaveLength(2);
    });

    it('states a reasoning shared by the analysed occurrences once under the table, marking the others unanalysed', () => {
      const note = {
        verdict: 'theoretical',
        source: 'agent',
        score: 0.42,
        reason: 'Pattern detected but requires specific preconditions.',
      };
      const a03 = sectionOf(
        render(
          report([
            vuln({ line: '1-1', exploitability: note }),
            vuln({ line: '2-2', exploitability: note }),
            vuln({ line: '3-3' }),
          ]),
        ),
        'owasp-a03',
      );
      const table = tableOf(a03, 'occ-table');
      expect(table).not.toContain('requires specific preconditions');
      expect(textOf(table)).toMatch(/contributions\.js:3 &#8211;/);
      expect(a03.indexOf('</table>')).toBeLessThan(
        a03.indexOf('All analysed occurrences'),
      );
    });

    it('gives each occurrence its verdict in an AI analysis column when they differ, instead of a repeated head', () => {
      const note = (score: number, reason: string) => ({
        verdict: 'theoretical',
        source: 'agent',
        score,
        reason,
      });
      const table = tableOf(
        sectionOf(
          render(
            report([
              vuln({ line: '1-1', exploitability: note(0.7, 'Reason A.') }),
              vuln({ line: '2-2', exploitability: note(0.8, 'Reason B.') }),
              vuln({ line: '3-3' }),
            ]),
          ),
          'owasp-a03',
        ),
        'occ-table',
      );
      expect(table).toContain('>AI verdict<');
      expect(table).toContain('70% confidence');
      expect(table).toContain('80% confidence');
      expect(table).toContain('Reason A.');
      expect(table).toContain('Reason B.');
      // The column names the analysis once: no « AI analysis » head per row.
      expect(table).not.toContain('AI analysis');
      expect(table.match(/AI verdict/g)).toHaveLength(1);
    });

    it('names the category in its prevention box, which may land on another page', () => {
      const a03 = sectionOf(render(report([vuln()])), 'owasp-a03');
      expect(a03).toMatch(/How to prevent[^<]*A03 Injection/);
    });

    it('survives findings without a name or a path', () => {
      const html = render(
        report([
          vuln({ name: undefined, path: undefined, line: undefined }),
          vuln({
            type: 'container',
            name: undefined,
            packageName: undefined,
            state: 'ignored',
          }),
        ]),
      );
      expect(html).toContain('id="owasp-a03"');
    });

    it('leaves row breaks to the shared table rules: one body, no local grouping', () => {
      // The base CSS keeps the second and the last row with their neighbour,
      // so no table needs a local workaround against a lone row.
      const long = sectionOf(
        render(
          report(
            Array.from({ length: 8 }, (_, i) =>
              vuln({ line: `${i + 1}-${i + 1}` }),
            ),
          ),
        ),
        'owasp-a03',
      );
      expect(long.match(/<tbody/g)).toHaveLength(1);
      expect(long.match(/<tr>/g)).toHaveLength(9);
      const short = sectionOf(
        render(report([vuln(), vuln({ line: '9-9' })])),
        'owasp-a03',
      );
      expect(short).not.toContain('keep');
      const deps = Array.from({ length: 6 }, (_, i) =>
        vuln({
          type: 'sca',
          name: `Advisory ${i}`,
          advisoryId: `GHSA-${i}`,
          path: undefined,
          line: undefined,
          packageName: `pkg${i}`,
          packageVersion: '1.0.0',
        }),
      );
      const a06 = sectionOf(render(report(deps)), 'owasp-a06');
      expect(tableOf(a06, 'dep-table').match(/<tbody/g)).toHaveLength(1);
    });

    it('drops the lone full stop that ends a title, never an ellipsis or an elision mark', () => {
      const html = render(
        report([
          vuln({ name: 'Plaintext HTTP link.' }),
          vuln({
            type: 'sca',
            name: 'hoek subject to prototype pollution via the clone function.',
            advisoryId: 'GHSA-jp4x-w63m-7wgm',
            path: undefined,
            line: undefined,
            packageName: 'hoek',
            packageVersion: '0.9.1',
          }),
          vuln({ name: 'Spread over several lines...', line: '9-9' }),
        ]),
      );
      const text = plainOf(html);
      expect(html).toMatch(/via the clone function<\//);
      expect(text).not.toContain('the clone function.');
      expect(text).not.toContain('Plaintext HTTP link.');
      expect(text).toContain('Plaintext HTTP link');
      expect(text).toContain('Spread over several lines...');
    });

    it('renders inline code of an advisory title as code, not as raw backticks', () => {
      const a06 = sectionOf(
        render(
          report([
            vuln({
              type: 'sca',
              name: 'lodash vulnerable to Code Injection via `_.template` imports key names',
              advisoryId: 'GHSA-r5fr-rjxr-66jc',
              path: undefined,
              line: undefined,
              packageName: 'lodash',
              packageVersion: '4.17.11',
            }),
          ]),
        ),
        'owasp-a06',
      );
      expect(a06).toContain(
        'via <code class="code-inline">_.template</code> imports',
      );
      expect(a06).not.toContain('`');
    });

    it('lists the open findings outside the Top 10 in their own section', () => {
      const html = render(
        report(
          [vuln(), vuln({ name: 'Missing CPU limits', cwe: ['CWE-400'] })],
          (v) => (v.name === 'Missing CPU limits' ? null : 'A03'),
        ),
      );
      const other = sectionOf(html, 'owasp-unmapped');
      expect(other).toContain('Not mapped to the OWASP Top 10');
      expect(other).toContain('Missing CPU limits');
      // Says why, in the terms of the methodology.
      expect(textOf(other)).toContain(
        'Open findings whose detection rule and CWE match no 2021 category.',
      );
    });

    it('omits the reference text and the descriptions in the non-detailed variant', () => {
      const html = render(report([vuln()]), false);
      const a03 = sectionOf(html, 'owasp-a03');
      expect(a03).toContain('contributions.js:32');
      expect(a03).not.toContain('How to prevent');
      expect(a03).not.toContain('runs arbitrary code');
    });

    it('says in the methodology that only critical and high triaged findings are listed', () => {
      const html = render(report([vuln()]));
      expect(html).toContain(
        'Findings triaged as ignored, resolved or not exploitable are excluded from every figure; the end of the report counts them and lists the critical and high ones.',
      );
    });

    it('marks a shortened description, so a cut is never silent', () => {
      const long = [
        `First paragraph ${'about the flaw '.repeat(20)}.`,
        `Second paragraph ${'about the impact '.repeat(30)}.`,
      ].join('\n\n');
      const a03 = sectionOf(
        render(report([vuln({ description: long })])),
        'owasp-a03',
      );
      expect(a03).toContain('First paragraph');
      expect(a03).not.toContain('Second paragraph');
      expect(a03).toMatch(/\[&#8230;\]/);
      // A short description is shown whole, without the mark.
      const short = sectionOf(render(report([vuln()])), 'owasp-a03');
      expect(short).not.toContain('[&#8230;]');
      // A first paragraph cut on a word gets the same mark, never a bare one.
      const endless = sectionOf(
        render(
          report([
            vuln({
              description: `The flaw ${'spreads through the session store '.repeat(30)}`,
            }),
          ]),
        ),
        'owasp-a03',
      );
      expect(endless).toContain('[&#8230;]');
      expect(endless).not.toMatch(/&#8230;\s*<span class="elided">/);
    });

    it('starts a paragraph at each bold label of a description, as the blank-line ones are', () => {
      const a03 = sectionOf(
        render(
          report([
            vuln({
              description:
                '**Root Cause**: no limit is set.  \n**Impact**: the host can be starved.',
            }),
          ]),
        ),
        'owasp-a03',
      );
      expect(a03).toContain('<strong>Impact:</strong>');
      expect(a03).not.toMatch(/<br>\s*<strong>Impact/);
    });

    it('sets the colon of a bold label inside it, like the labels written that way', () => {
      const a03 = sectionOf(
        render(
          report([
            vuln({
              description:
                '**Root Cause**: no limit is set.\n\n**Use of `eval()`**: runs a string as code.\n\n**Impact:** the host can be starved.',
            }),
          ]),
        ),
        'owasp-a03',
      );
      expect(a03).toContain('<strong>Root Cause:</strong>');
      expect(a03).toContain('<strong>Impact:</strong>');
      expect(a03).not.toContain('</strong>:');
      // Inline code right before a punctuation mark sits tight against it.
      expect(a03).toMatch(
        /<code class="code-inline is-tight">eval\(\)<\/code>:<\/strong>/,
      );
    });

    it('fills a shortened description with the whole sentences of the next paragraph that fit', () => {
      const description = [
        'Insecure handling of redirect targets can lead to an **open redirect**. For example:',
        '- `res.redirect(req.body.url)`\n- `res.redirect(req.query.next)`',
        `These patterns permit arbitrary URIs to be specified as the redirect target. An attacker can craft a URL that forwards users to malicious sites. The root cause is the lack of an allow-list ${'or of any validation logic '.repeat(18)}for the redirect destination.`,
      ].join('\n\n');
      const a03 = textOf(
        sectionOf(render(report([vuln({ description })])), 'owasp-a03'),
      );
      expect(a03).toContain(
        'These patterns permit arbitrary URIs to be specified as the redirect target. An attacker can craft a URL that forwards users to malicious sites.',
      );
      expect(a03).not.toContain('The root cause is the lack');
      expect(a03).toContain('[&#8230;]');
    });

    it('reproduces a reasoning the agent repeats across findings under each verdict, never dropping it', () => {
      const generic = (name: string, path: string) =>
        vuln({
          name,
          path,
          exploitability: {
            verdict: 'proven',
            source: 'agent',
            score: 0.82,
            reason:
              'Data flow analysis confirms vulnerability is reachable through public input.',
          },
        });
      const reasonOf = (html: string) =>
        sectionOf(html, 'owasp-a03').match(
          /Data flow analysis confirms vulnerability is reachable through public input\./g,
        ) ?? [];
      // Two distinct findings: each keeps its verdict, its confidence and
      // the reasoning the agent gave, word for word.
      const two = render(
        report([
          generic('Use of HTTP Instead of HTTPS Server', 'server.js'),
          generic('Express Session Cookie Without Expiration', 'server.js'),
        ]),
      );
      expect(reasonOf(two)).toHaveLength(2);
      expect(sectionOf(two, 'owasp-a03').match(/Proven<\/span>/g)).toHaveLength(
        2,
      );
      expect(sectionOf(two, 'owasp-a03').match(/82% confidence/g)).toHaveLength(
        2,
      );
      // Five findings: still under every one of them.
      const five = render(
        report(
          ['a', 'b', 'c', 'd', 'e'].map((n) => generic(`Rule ${n}`, `${n}.js`)),
        ),
      );
      expect(reasonOf(five)).toHaveLength(5);
      // The occurrences of one finding sharing a reasoning are one finding:
      // it is stated once, under the table.
      const one = render(
        report([
          generic('Plaintext HTTP link', 'a.html'),
          generic('Plaintext HTTP link', 'b.html'),
        ]),
      );
      expect(reasonOf(one)).toHaveLength(1);
    });

    it('shows an unclosed code span as code, never as a stray backtick', () => {
      const a03 = sectionOf(
        render(
          report([
            vuln({
              description:
                'For example:\n\n- `res.redirect(req.body.url)`\n- `res.redirect(`${req.query.url}/path`)',
            }),
          ]),
        ),
        'owasp-a03',
      );
      const desc = /<div class="finding-desc">[\s\S]*?<\/div>/.exec(a03)?.[0];
      // A long code span carries its points of cut (<wbr>): its visible text
      // is the code.
      expect(plainOf(desc)).toContain('res.redirect(req.body.url)');
      expect(plainOf(desc)).toContain('${req.query.url}/path');
      // No backtick left outside a code span.
      expect(desc.replace(/<code[^>]*>[\s\S]*?<\/code>/g, '')).not.toContain(
        '`',
      );
    });

    it('maps punctuation the embedded fonts lack in titles (no Type 3 fallback)', () => {
      const html = render(
        report([vuln({ name: 'Session cookie without time‐based expiry' })]),
      );
      expect(plainOf(html)).toContain('time-based expiry');
      expect(html).not.toContain('&#8208;');
    });

    it('shows a container summary in whole sentences, marking what it leaves out', () => {
      const shown = (description: string) =>
        /<div class="adv-summary">([\s\S]*?)<\/div>/.exec(
          sectionOf(
            render(
              report([
                vuln({
                  type: 'container',
                  name: 'CVE-2026-22184',
                  description,
                  path: undefined,
                  line: undefined,
                  packageName: 'zlib',
                  packageVersion: '1.3.1-r2',
                }),
              ]),
            ),
            'owasp-a06',
          ),
        )?.[1];
      const mark = '<span class="elided">[&#8230;]</span>';
      // Short enough: whole, unmarked.
      expect(
        shown(
          'zlib before 1.3.2 allows CPU consumption via crc32_combine64 and crc32_combine_gen64 because x2nmodp can do right shifts within a loop that has no termination condition.',
        ),
      ).toBe(
        'zlib before 1.3.2 allows CPU consumption via crc32_combine64 and crc32_combine_gen64 because x2nmodp can do right shifts within a loop that has no termination condition.',
      );
      // A summary cut short at the source loses its unfinished sentence.
      expect(
        shown(
          'zlib versions up to and including 1.3.1.2 include a global buffer overflow in the untgz utility located under contrib/untgz. The vulnerability is limited to the standalone demonstration utility and does not affect the core zlib compression library. T',
        ),
      ).toBe(
        `zlib versions up to and including 1.3.1.2 include a global buffer overflow in the untgz utility located under contrib/untgz. The vulnerability is limited to the standalone demonstration utility and does not affect the core zlib compression library. ${mark}`,
      );
      // Only the first paragraph, without its « Issue summary: » label.
      expect(
        shown(
          'Issue summary: An OpenSSL TLS 1.3 server may fail to negotiate the expected\npreferred key exchange group.\n\nImpact summary: A less preferred key exchange may',
        ),
      ).toBe(
        `An OpenSSL TLS 1.3 server may fail to negotiate the expected preferred key exchange group. ${mark}`,
      );
      // One endless sentence: cut on a word, marked the same way.
      const endless = shown(`zlib ${'overflows the untgz buffer '.repeat(20)}`);
      expect(endless).toMatch(
        /^zlib overflows the untgz buffer .* <span class="elided">\[&#8230;\]<\/span>$/,
      );
      expect(plainOf(endless).length).toBeLessThanOrEqual(260);
      // Never two marks: no bare ellipsis before the bracketed one.
      expect(endless).not.toContain('&#8230; <span');
    });

    it('clips an advisory title only past three lines, never inside a parenthesis, with the same mark', () => {
      const dep = (name: string) =>
        sectionOf(
          render(
            report([
              vuln({
                type: 'sca',
                name,
                advisoryId: 'GHSA-1',
                path: undefined,
                line: undefined,
                packageName: 'tar',
                packageVersion: '4.4.8',
              }),
            ]),
          ),
          'owasp-a06',
        );
      const shown = (html: string) =>
        /<div class="adv-title">([\s\S]*?)<\/div>/.exec(html)?.[1];
      // 147 characters: whole.
      const real =
        'node-tar applies PAX size override to intermediary GNU long-name/long-link headers, causing tar parser interpretation differential (file smuggling)';
      expect(plainOf(shown(dep(real)))).toBe(real);
      const long = shown(
        dep(`tar ${'global buffer overflow in the untgz utility '.repeat(5)}`),
      );
      expect(long).toMatch(/ <span class="elided">\[&#8230;\]<\/span>$/);
      const kept = plainOf(long).replace(/ \[&#8230;\]$/, '');
      expect(kept.length).toBeGreaterThan(140);
      expect(kept.length).toBeLessThanOrEqual(180);
      const paren = shown(
        dep(
          'node-tar applies PAX size override to intermediary GNU long-name/long-link headers, causing tar parser interpretation differential between implementations (file smuggling through crafted archives)',
        ),
      );
      expect(plainOf(paren)).toBe(
        'node-tar applies PAX size override to intermediary GNU long-name/long-link headers, causing tar parser interpretation differential between implementations [&#8230;]',
      );
    });

    it('drops the references of a rule description to its own test fixtures', () => {
      const a03 = sectionOf(
        render(
          report([
            vuln({
              description:
                'Missing the **HttpOnly** attribute exposes the token via `document.cookie`. In the provided code example (see `test3`), the `cookie` object does not include `httpOnly: true`. An attacker (e.g., via a separate XSS flaw) can steal it.',
            }),
            vuln({
              name: 'Default cookie name',
              path: 'server.js',
              description:
                'In code such as `app.use(session(opts))` (e.g., in **test1**), omitting the `name` property results in a predictable cookie name.',
            }),
          ]),
        ),
        'owasp-a03',
      );
      const text = textOf(a03);
      expect(text).not.toMatch(/test[13]/);
      expect(text).not.toContain('provided code example');
      // Every other character is kept: a dot inside code or « e.g. » is not
      // the end of a sentence.
      expect(plainOf(a03)).toContain(
        'Missing the HttpOnly attribute exposes the token via document.cookie. An attacker (e.g., via a separate XSS flaw) can steal it.',
      );
      expect(plainOf(a03)).toContain(
        'In code such as app.use(session(opts)), omitting the name property',
      );
    });

    it('explains, at the end, that the state and the AI verdict are independent', () => {
      const about = textOf(
        render(report([vuln()])).split('About this report')[1],
      );
      expect(about).toContain('Reading this report');
      for (const word of [
        'To verify',
        'Confirmed',
        'Theoretical',
        'Proven',
        'Actively exploited',
        'confidence',
        'independent',
      ]) {
        expect(about).toContain(word);
      }
    });

    it('says, only when it happens, that a reasoning repeated word for word is reproduced as given', () => {
      const note = (name: string, reason: string) =>
        vuln({
          name,
          path: `${name}.js`,
          exploitability: {
            verdict: 'proven',
            source: 'agent',
            score: 0.8,
            reason,
          },
        });
      const said =
        'The agent sometimes gives the same reasoning word for word for several findings; it is reproduced as given.';
      const aboutOf = (vulns: MappedVulnerability[]) =>
        render(report(vulns)).split('About this report')[1];
      const repeated = aboutOf([
        note('Rule a', 'Reachable through public input.'),
        note('Rule b', 'Reachable through public input.'),
      ]);
      expect(textOf(repeated)).toContain(said);
      // Nothing is left out any more, so nothing says it is.
      expect(repeated).not.toContain('is omitted');
      expect(repeated).not.toContain('Boilerplate');
      // Distinct reasonings, or one finding stating it for its occurrences.
      expect(
        textOf(
          aboutOf([
            note('Rule a', 'Reachable through public input.'),
            note('Rule b', 'Reachable from the admin route.'),
          ]),
        ),
      ).not.toContain('word for word');
      expect(
        textOf(
          aboutOf([
            note('Rule a', 'Reachable through public input.'),
            vuln({
              name: 'Rule a',
              path: 'Rule a.js',
              line: '40-40',
              exploitability: {
                verdict: 'proven',
                source: 'agent',
                score: 0.8,
                reason: 'Reachable through public input.',
              },
            }),
          ]),
        ),
      ).not.toContain('word for word');
      // Written text uses the curly apostrophe of the finding texts.
      expect(repeated).toContain('CybeDefend&#8217;s');
      expect(repeated).not.toMatch(/[A-Za-z]'[A-Za-z]/);
      expect(repeated).not.toContain('&#39;');
    });

    it('names a reviewer verdict only when one is shown, and says static verdicts are left out when there are some', () => {
      const aboutOf = (vulns: MappedVulnerability[]) =>
        textOf(render(report(vulns)).split('About this report')[1]);
      const verdict = (source: string) =>
        vuln({
          exploitability: {
            verdict: 'theoretical',
            source,
            score: 0.5,
            reason: null,
          },
        });
      expect(aboutOf([verdict('agent')])).not.toContain('Reviewer');
      expect(aboutOf([verdict('manual')])).toContain(
        'a verdict marked Reviewer was set by hand',
      );
      // A reviewer verdict on a triaged finding is not shown: not named.
      expect(
        aboutOf([verdict('agent'), { ...verdict('manual'), state: 'ignored' }]),
      ).not.toContain('Reviewer');
      const staticNote =
        'Verdicts set by static analysis alone, marked Static on the CybeDefend dashboard, are not shown.';
      expect(aboutOf([verdict('static')])).toContain(staticNote);
      expect(aboutOf([verdict('agent')])).not.toContain(staticNote);
    });

    it('describes in the methodology only what the variant shows', () => {
      const detailed = render(report([vuln()]), true);
      expect(detailed).toContain('their description is shown once');
      expect(detailed).toContain('prevention measures are condensed from it');
      const brief = render(report([vuln()]), false);
      expect(brief).not.toContain('their description is shown once');
      expect(brief).not.toContain('prevention measures');
      expect(brief).toContain('Identical findings are grouped');
    });
  });

  describe('triaged findings', () => {
    it('lists them at the end, outside the figures, without their description', () => {
      const html = render(
        report([
          vuln(),
          vuln({
            name: 'Server-side code injection',
            description: 'Secret sauce description.',
            state: 'ignored',
            severity: 'critical',
          }),
        ]),
      );
      const triaged = sectionOf(html, 'owasp-triaged');
      expect(triaged).toContain('Triaged findings');
      expect(plainOf(triaged)).toContain('Server-side code injection');
      expect(triaged).toContain('Ignored');
      expect(html).not.toContain('Secret sauce description');
      expect(sectionOf(html, 'owasp-a03')).not.toContain(
        'Server-side code injection',
      );
    });

    it('lists critical and high triaged dependencies once per package, compactly, with their versions and finding counts', () => {
      const dep = (name: string, severity: string, version: string) =>
        vuln({
          type: 'sca',
          name,
          severity,
          state: 'ignored',
          path: undefined,
          line: undefined,
          packageName: 'tar',
          packageVersion: version,
        });
      const html = render(
        report([
          vuln(),
          dep('Arbitrary file creation', 'high', '4.4.8'),
          dep('Arbitrary file creation', 'high', '2.2.1'),
          dep('Symlink escape', 'critical', '4.4.8'),
          dep('Denial of service', 'medium', '4.4.8'),
        ]),
      );
      const triaged = sectionOf(html, 'owasp-triaged');
      // No table of advisory titles: one entry per package.
      expect(triaged).not.toContain('triaged-table');
      const table = tableOf(triaged, 'tri-packages');
      const rows = table
        .split('<tbody>')[1]
        .split('</tr>')
        .filter((r) => r.includes('<td'));
      expect(rows).toHaveLength(1);
      // A package reads the same as in the advisories: one chip, its versions.
      expect(rows[0]).toContain(
        `${packageChip('tar')} <span class="versions">2.2.1, 4.4.8</span>`,
      );
      expect(textOf(rows[0])).toMatch(/1 critical 2 high$/);
      expect(triaged).not.toContain('Denial of service');
      expect(triaged).not.toContain('Symlink escape');
      expect(triaged).not.toContain('more advisor');
      // A single version reads the same way, never name@version.
      const single = sectionOf(
        render(
          report([
            vuln(),
            vuln({
              type: 'sca',
              name: 'Prototype pollution',
              severity: 'high',
              state: 'ignored',
              path: undefined,
              line: undefined,
              packageName: 'qs',
              packageVersion: '6.5.2',
            }),
          ]),
        ),
        'owasp-triaged',
      );
      expect(single).toContain(
        `${packageChip('qs')} <span class="versions">6.5.2</span>`,
      );
      // Past two versions, the lowest one and how many more keep the row on
      // one line: no « … », which would read as a range. The other versions
      // are named as in the top list.
      const many = sectionOf(
        render(
          report([
            vuln(),
            ...['4.0.0', '5.1.0', '7.0.3', '6.0.5'].map((packageVersion) =>
              vuln({
                type: 'sca',
                name: 'ReDoS in cross-spawn',
                severity: 'high',
                state: 'ignored',
                path: undefined,
                line: undefined,
                packageName: 'cross-spawn',
                packageVersion,
              }),
            ),
          ]),
        ),
        'owasp-triaged',
      );
      expect(many).toContain(
        `${packageChip('cross-spawn')} <span class="versions">4.0.0</span><span class="more">+3 versions</span>`,
      );
      expect(many).not.toContain('&#8230;');
      expect(many).not.toContain('…');
    });

    it('gives the code and dependency lists the same rank under one heading, dependencies read down the columns', () => {
      const dep = (packageName: string, severity: string) =>
        vuln({
          type: 'sca',
          name: `Flaw in ${packageName}`,
          severity,
          state: 'ignored',
          path: undefined,
          line: undefined,
          packageName,
          packageVersion: '1.0.0',
        });
      const triaged = sectionOf(
        render(
          report([
            vuln(),
            vuln({
              name: 'Code injection',
              severity: 'critical',
              state: 'ignored',
            }),
            dep('alpha', 'critical'),
            dep('beta', 'high'),
            dep('gamma', 'high'),
          ]),
        ),
        'owasp-triaged',
      );
      const heads = Array.from(
        triaged.matchAll(/<(h[34])[^>]*>([\s\S]*?)<\/\1>/g),
        (m) => `${m[1]} ${textOf(m[2])}`,
      );
      expect(heads).toEqual([
        'h3 Critical and high triaged findings, all ignored',
        'h4 Code',
        'h4 Dependencies',
      ]);
      // Each list says what it holds, next to its title.
      expect(textOf(triaged)).toContain('Code 1 finding');
      expect(textOf(triaged)).toContain('Dependencies 3 packages, 3 findings');
      // One package per row: the list reads top to bottom, column after
      // column, in severity order.
      const table = tableOf(triaged, 'tri-packages');
      // Two columns (the continuation row names the list on a next page).
      expect(
        table
          .replace(/<tr class="cont-row"[\s\S]*?<\/tr>/, '')
          .match(/<th[ >]/g),
      ).toHaveLength(2);
      const order = ['alpha', 'beta', 'gamma'].map((n) =>
        table.indexOf(`>${n}<`),
      );
      expect(order[0]).toBeLessThan(order[1]);
      expect(order[1]).toBeLessThan(order[2]);
    });

    describe('dependency list running down two columns', () => {
      const dep = (packageName: string) =>
        vuln({
          type: 'sca',
          name: `Flaw in ${packageName}`,
          severity: 'high',
          state: 'ignored',
          path: undefined,
          line: undefined,
          packageName,
          packageVersion: '1.0.0',
        });
      const data = report([
        vuln(),
        ...['alpha', 'beta', 'gamma', 'delta', 'epsilon'].map(dep),
      ]);

      it('names the list on the next page when it continues there, hidden in both columns of its first page', () => {
        const triaged = sectionOf(render(data), 'owasp-triaged');
        const table = tableOf(triaged, 'tri-packages');
        expect(table).toContain(
          'Triaged findings &#183; Dependencies (continued)',
        );
        // The list head covers the continuation row of both columns: the
        // columns rise under it, not the table alone (whose header repeats at
        // the top of the second column).
        expect(triaged).toMatch(
          /<div class="list-head cont-cover"><h4>Dependencies<\/h4>/,
        );
        expect(OWASP_REPORT_CSS).toMatch(/\.tri-cols \{[^}]*margin-top: -16px/);
        // The hidden row sits in the bottom padding of the head, never under
        // its text, so text extraction does not slip it into the head.
        expect(OWASP_REPORT_CSS).toMatch(
          /\.list-head \{[^}]*padding-bottom: 16px/,
        );
        expect(OWASP_REPORT_CSS).toMatch(
          /\.tri-cols table\.has-cont \{[^}]*margin-top: 0/,
        );
      });

      it('gives each column its own header in the dashboard preview, where the columns never repeat it', () => {
        const triaged = sectionOf(render(data, true, false), 'owasp-triaged');
        const tables = triaged.match(
          /<table class="[^"]*\btri-packages\b[^"]*">[\s\S]*?<\/table>/g,
        );
        expect(tables).toHaveLength(2);
        for (const table of tables) {
          expect(table).toContain('>Package</th>');
          // No page, so nothing to name on a next one.
          expect(table).not.toContain('(continued)');
        }
        // The left column holds the first half, read before the right one.
        const names = (table: string) =>
          ['alpha', 'beta', 'gamma', 'delta', 'epsilon']
            .filter((n) => table.includes(`>${n}<`))
            .sort((a, b) => table.indexOf(`>${a}<`) - table.indexOf(`>${b}<`));
        expect(names(tables[0])).toEqual(['alpha', 'beta', 'delta']);
        expect(names(tables[1])).toEqual(['epsilon', 'gamma']);
        expect(triaged).not.toContain('class="tri-cols"');
        expect(triaged).not.toContain('list-head cont-cover"><h4>Dependencies');
      });
    });

    it('orders the triaged packages by their critical then high findings', () => {
      const dep = (packageName: string, severity: string, name: string) =>
        vuln({
          type: 'sca',
          name,
          severity,
          state: 'ignored',
          path: undefined,
          line: undefined,
          packageName,
          packageVersion: '1.0.0',
        });
      const triaged = sectionOf(
        render(
          report([
            vuln(),
            dep('alpha', 'high', 'A'),
            dep('beta', 'critical', 'B'),
            dep('gamma', 'high', 'C'),
            dep('gamma', 'high', 'D'),
          ]),
        ),
        'owasp-triaged',
      );
      const order = ['beta', 'gamma', 'alpha'].map((n) =>
        triaged.indexOf(`>${n}<`),
      );
      expect(order[0]).toBeGreaterThan(-1);
      expect(order[0]).toBeLessThan(order[1]);
      expect(order[1]).toBeLessThan(order[2]);
    });

    it('lists triaged code findings with their full path', () => {
      const list = tableOf(
        sectionOf(
          render(
            report([vuln(), vuln({ severity: 'critical', state: 'ignored' })]),
          ),
          'owasp-triaged',
        ),
        'triaged-table',
      );
      expect(plainOf(list)).toContain('app/routes/contributions.js:32');
    });

    it('opens on a count per state and severity, with a total row', () => {
      const html = render(
        report([
          vuln(),
          vuln({ name: 'A', severity: 'critical', state: 'ignored' }),
          vuln({ name: 'B', severity: 'medium', state: 'ignored' }),
          vuln({ name: 'C', severity: 'medium', state: 'ignored' }),
          vuln({ name: 'D', severity: 'high', state: 'resolved' }),
        ]),
      );
      const counts = sectionOf(html, 'owasp-triaged').match(
        /<table class="fixed triaged-counts">[\s\S]*?<\/table>/,
      )?.[0];
      expect(counts).toBeDefined();
      expect(counts).toMatch(
        /<th>State<\/th><th class="right">Critical<\/th><th class="right">High<\/th><th class="right">Medium<\/th><th class="right">Low<\/th><th class="right">Total<\/th>/,
      );
      // Body rows only: the header also reads « Total ».
      const row = (label: string) =>
        counts
          .split('<tbody>')[1]
          .split(/<tr[^>]*>/)
          .find((r) => r.includes(label))
          ?.replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
      // Critical, High, Medium, Low, Total.
      expect(row('Ignored')).toBe('Ignored 1 &#8211; 2 &#8211; 3');
      expect(row('Resolved')).toBe('Resolved &#8211; 1 &#8211; &#8211; 1');
      expect(row('Total')).toBe('Total 1 1 2 &#8211; 4');
    });

    it('drops the total row when every triaged finding shares one state', () => {
      const counts = sectionOf(
        render(
          report([
            vuln(),
            vuln({ severity: 'critical', state: 'ignored' }),
            vuln({ severity: 'high', state: 'ignored' }),
          ]),
        ),
        'owasp-triaged',
      ).match(/<table class="fixed triaged-counts">[\s\S]*?<\/table>/)?.[0];
      expect(counts).toContain('Ignored');
      expect(counts.split('<tbody>')[1]).not.toContain('Total');
    });

    it('names a state shared by every listed finding once, instead of a state column', () => {
      const uniform = sectionOf(
        render(
          report([
            vuln(),
            vuln({ name: 'One', severity: 'critical', state: 'ignored' }),
            vuln({ name: 'Two', severity: 'high', state: 'ignored' }),
            vuln({ name: 'Three', severity: 'low', state: 'resolved' }),
          ]),
        ),
        'owasp-triaged',
      );
      expect(uniform).toMatch(
        /<h3[^>]*>Critical and high triaged findings, all ignored<\/h3>/,
      );
      const list = uniform.match(
        /<table class="[^"]*triaged-table">[\s\S]*?<\/table>/,
      )?.[0];
      expect(list).not.toContain('<th>State</th>');
      const mixed = sectionOf(
        render(
          report([
            vuln(),
            vuln({ name: 'One', severity: 'critical', state: 'ignored' }),
            vuln({ name: 'Two', severity: 'high', state: 'resolved' }),
          ]),
        ),
        'owasp-triaged',
      );
      expect(mixed).toMatch(
        /<h3[^>]*>Critical and high triaged findings<\/h3>/,
      );
      expect(
        mixed.match(/<table class="[^"]*triaged-table">[\s\S]*?<\/table>/)?.[0],
      ).toContain('<th>State</th>');
    });

    it('adds an unrated column to the counts only when a triaged finding has no severity', () => {
      const counts = (html: string) =>
        sectionOf(html, 'owasp-triaged').match(
          /<table class="fixed triaged-counts">[\s\S]*?<\/table>/,
        )?.[0];
      expect(
        counts(render(report([vuln(), vuln({ state: 'ignored' })]))),
      ).not.toContain('Unrated');
      expect(
        counts(
          render(report([vuln(), vuln({ severity: '', state: 'ignored' })])),
        ),
      ).toContain('<th class="right">Unrated</th>');
    });

    it('lists only the critical and high triaged findings and says how many lower ones are left out', () => {
      const html = render(
        report([
          vuln(),
          vuln({
            name: 'Critical one',
            severity: 'critical',
            state: 'ignored',
          }),
          vuln({ name: 'Medium one', severity: 'medium', state: 'ignored' }),
          vuln({ name: 'Low one', severity: 'low', state: 'resolved' }),
        ]),
      );
      const triaged = sectionOf(html, 'owasp-triaged');
      expect(triaged).toContain('Critical one');
      expect(triaged).not.toContain('Medium one');
      expect(triaged).not.toContain('Low one');
      expect(triaged).toContain(
        '2 lower-severity triaged findings are not listed.',
      );
      const single = sectionOf(
        render(
          report([
            vuln(),
            vuln({ name: 'Low one', severity: 'low', state: 'ignored' }),
          ]),
        ),
        'owasp-triaged',
      );
      expect(single).toContain(
        '1 lower-severity triaged finding is not listed.',
      );
      expect(single).not.toContain('triaged-table');
    });

    it('is omitted when nothing was triaged', () => {
      expect(render(report([vuln()]))).not.toContain('id="owasp-triaged"');
    });
  });

  describe('identifiers too long for their column', () => {
    // As a container scan and a monorepo report them: an image of a private
    // registry, one pinned by digest, Debian versions with an epoch, a
    // scoped package whose prerelease version carries a commit hash.
    const AZURE_IMAGE =
      'e4feaa3fac914202b07ad1e0a3ad933e.azurecr.io/azureml/azureml_05b92b0c3f062d7d80a0ae539d0c1321:1';
    const DIGEST_IMAGE = `registry.example.com/team/app@sha256:${'c335e56d'.repeat(8)}`;
    const EPOCH = '8:6.9.11.60+dfsg-1.6ubuntu1.3';
    const EPOCH_FIX = '8:6.9.11.60+dfsg-1.6ubuntu1.4';
    const SCOPED =
      '@very-long-organization-name/extremely-long-package-name-for-testing';
    const PRERELEASE =
      '3.0.0-alpha.20260915.4f2d9c1e8b7a6d5c4b3a2f1e0d9c8b7a6f5e4d3c';
    const PRERELEASE_FIX =
      '3.0.0-beta.20260922.9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b';

    const imagemagick = (
      packageName: string,
      over: Partial<MappedVulnerability> = {},
    ) =>
      vuln({
        type: 'container',
        name: 'CVE-2026-25965',
        description: '',
        severity: 'critical',
        path: undefined,
        line: undefined,
        packageName,
        packageVersion: EPOCH,
        fixedVersion: EPOCH_FIX,
        imageName: AZURE_IMAGE,
        ...over,
      });
    const scoped = (over: Partial<MappedVulnerability> = {}) =>
      vuln({
        type: 'sca',
        name: `Code injection in ${SCOPED}`,
        description: '',
        severity: 'critical',
        advisoryId: 'GHSA-9f3q-7w2m-x4pc',
        cve: 'CVE-2026-41877',
        path: undefined,
        line: undefined,
        packageName: SCOPED,
        packageVersion: PRERELEASE,
        fixedVersion: PRERELEASE_FIX,
        ...over,
      });
    const a06Of = (vulns: MappedVulnerability[]): string =>
      sectionOf(render(report(vulns)), 'owasp-a06');
    /** Widths of the columns of a table, `auto` for a free one. */
    const widthsOf = (table: string): string[] =>
      Array.from(
        (/<colgroup>([\s\S]*?)<\/colgroup>/.exec(table)?.[1] ?? '').matchAll(
          /<col(?: style="width: ([^"]+)")?>/g,
        ),
        (m) => m[1] ?? 'auto',
      );

    it('names an image in the advisory column as an identifier, cut after its separators rather than mid-word', () => {
      const advisories = tableOf(
        a06Of([
          imagemagick('imagemagick'),
          vuln({
            type: 'container',
            name: 'CVE-2026-31789',
            description: '',
            path: undefined,
            line: undefined,
            packageName: 'openssl',
            packageVersion: '3.0.13-0ubuntu3.4',
            fixedVersion: '3.0.13-0ubuntu3.5',
            imageName: DIGEST_IMAGE,
          }),
          vuln({
            type: 'container',
            name: 'CVE-2026-28390',
            description: '',
            path: undefined,
            line: undefined,
            packageName: 'libssl3',
            packageVersion: '3.5.5-r0',
            fixedVersion: '3.5.6-r0',
            imageName: 'alpine:latest',
          }),
        ]),
        'dep-table',
      );
      // The reference overflowed its cell over the package column: in
      // monospace, nowrap, with no point to break at.
      for (const image of [AZURE_IMAGE, DIGEST_IMAGE, 'alpine:latest']) {
        expect(advisories).toContain(idText(image));
      }
      expect(advisories).not.toMatch(/<span class="mono">[^<]*azurecr/);
      expect(advisories).not.toContain('<span class="mono">alpine:latest');
    });

    it('names a long advisory id as an identifier, a short one as before', () => {
      const id = 'SNYK-DEBIAN12-IMAGEMAGICK-6210512';
      const advisories = tableOf(
        a06Of([scoped({ advisoryId: id })]),
        'dep-table',
      );
      expect(advisories).toContain(idText(id));
      expect(advisories).toContain('<span class="mono">CVE-2026-41877</span>');
    });

    it('cuts a long installed version only between its parts, never in its Debian revision, a short one staying whole', () => {
      const html = render(
        report([
          scoped(),
          imagemagick('imagemagick'),
          vuln({
            type: 'container',
            name: 'CVE-2026-28390',
            description: '',
            path: undefined,
            line: undefined,
            packageName: 'libssl3',
            packageVersion: '3.5.5-r0',
            fixedVersion: '3.5.6-r0',
            imageName: 'alpine:latest',
          }),
        ]),
      );
      const a06 = sectionOf(html, 'owasp-a06');
      const top = tableOf(sectionOf(html, 'owasp-summary'), 'top-table');
      for (const table of [
        tableOf(a06, 'dep-table'),
        tableOf(a06, 'plan-table'),
        top,
      ]) {
        // A prerelease version with a commit hash was one unbreakable span
        // of 366px: it pushed its cell past the page edge. Cut as any
        // identifier, it then broke at every dot of its hash.
        expect(table).toContain(
          `<span class="versions">${versionText(PRERELEASE)}`,
        );
        expect(table).not.toContain(`<span class="nobr">3.0.0-alpha`);
        expect(table).not.toContain(breakableId(PRERELEASE));
      }
      // « 8:6.9.11.60+dfsg-1 » ended a line, a whole Debian version at a
      // glance, the rest of its revision on the next one.
      expect(tableOf(a06, 'dep-table')).toContain(
        `<span class="versions">${versionText(EPOCH)}</span>`,
      );
      expect(tableOf(a06, 'plan-table')).toContain(
        `<span class="versions">${versionText(EPOCH)}</span>`,
      );
      expect(html).not.toContain(breakableId(EPOCH));
      expect(tableOf(a06, 'dep-table')).toContain(
        `${packageChip('libssl3')} <span class="versions"><span class="nobr">3.5.5-r0</span></span>`,
      );
    });

    it('names the image of a package of the upgrade plan as an identifier', () => {
      const plan = tableOf(
        a06Of([
          imagemagick('imagemagick'),
          vuln({
            type: 'container',
            name: 'CVE-2026-28390',
            description: '',
            path: undefined,
            line: undefined,
            packageName: 'libssl3',
            packageVersion: '3.5.5-r0',
            fixedVersion: '3.5.6-r0',
            imageName: 'alpine:latest',
          }),
        ]),
        'plan-table',
      );
      // « in » never ends a line alone: a long image carries it in its box,
      // a short one is joined to it by a no-break space (« 1.2.5-r21 in » /
      // « alpine:latest » in a narrowed column).
      expect(plan).toContain(
        `<span class="versions">${versionText(EPOCH)}</span><span class="plan-image"> ${idText(AZURE_IMAGE, { before: 'in\u00a0' })}</span>`,
      );
      expect(plan).toContain(
        `<span class="plan-image"> ${idText('alpine:latest', { before: 'in\u00a0' })}</span>`,
      );
      expect(plan).not.toContain('in <span class="id-text">');
    });

    it('keeps the widths of the upgrade plan while everything fits them', () => {
      const plan = tableOf(
        a06Of([
          vuln({
            type: 'sca',
            description: '',
            path: undefined,
            line: undefined,
            packageName: 'path-to-regexp',
            packageVersion: '0.1.7',
            fixedVersion: '0.1.13',
          }),
          vuln({
            type: 'container',
            name: 'CVE-2026-28390',
            description: '',
            path: undefined,
            line: undefined,
            packageName: 'libcrypto3',
            packageVersion: '3.5.5-r0',
            fixedVersion: '3.5.6-r0',
            imageName: 'alpine:latest',
          }),
        ]),
        'plan-table',
      );
      expect(widthsOf(plan)).toEqual(['20%', '27%', '17%', 'auto']);
    });

    it('never widens a column of the upgrade plan past its bound', () => {
      const plan = tableOf(
        a06Of([
          imagemagick('libmagickwand-6.q16-hdri', {
            packageVersion: `1:${EPOCH}-hdri-backport2`,
            // Short (24 characters): a chip that never breaks.
            fixedVersion: '1.2.3-alpha.456789012345',
            imageName: `${'a'.repeat(60)}.azurecr.io/${'b'.repeat(60)}:1`,
          }),
        ]),
        'plan-table',
      );
      const [pkg, installed, target] = widthsOf(plan).map(parseFloat);
      // The package column takes its 26% at most; the target holds its chip
      // whole; the installed version, longer than a version held whole,
      // needs less than its 27% once cut between its parts (its longest,
      // « +dfsg-1.6ubuntu1.3-hdri », 23 characters), and the image, cut
      // anywhere, widens nothing.
      expect(pkg).toBe(26);
      expect(target).toBe(26);
      expect(installed).toBe(27);
    });

    it('names a long image in an AI note and among the triaged packages as an identifier', () => {
      const proven = {
        verdict: 'proven',
        source: 'agent',
        score: 0.8,
        reason: 'Reachable from the upload route.',
      };
      const html = render(
        report([
          imagemagick('imagemagick', { exploitability: proven }),
          imagemagick('imagemagick', {
            imageName: 'node:18-alpine',
            packageVersion: '6.9.11',
          }),
          imagemagick('libmagickwand-6.q16-6', { state: 'ignored' }),
        ]),
      );
      const note =
        /<div class="ai-note has-head adv-note">[\s\S]*?<\/div>/.exec(
          tableOf(sectionOf(html, 'owasp-a06'), 'dep-table'),
        )?.[0];
      const inImage = idText(AZURE_IMAGE, { before: 'in\u00a0' });
      expect(note).toContain(` ${inImage}`);
      expect(
        tableOf(sectionOf(html, 'owasp-triaged'), 'tri-packages'),
      ).toContain(`<span class="plan-image"> ${inImage}</span>`);
    });

    it('keeps a long hyphenated word of a title whole while it fits on a line, else cuts it at its separators', () => {
      const top = tableOf(
        sectionOf(
          render(
            report([
              scoped({
                name: 'Prototype pollution in object-path-immutable-extended-edition',
              }),
            ]),
          ),
          'owasp-summary',
        ),
        'top-table',
      );
      // A box, whole while it fits on a line, else cut before its hyphens.
      expect(top).toContain(
        `in ${idBox(breakableId('object-path-immutable-extended-edition'), {})}</div>`,
      );
      expect(breakableId('object-path-immutable-extended-edition')).toContain(
        '<wbr>',
      );
      // A short one never wraps at its hyphen, as before.
      const short = tableOf(
        sectionOf(
          render(
            report([
              vuln({
                name: 'form-data in @nest-js/core uses unsafe random function',
                severity: 'critical',
              }),
            ]),
          ),
          'owasp-summary',
        ),
        'top-table',
      );
      expect(short).toContain('<span class="nobr">form-data</span>');
      expect(short).toContain('@<span class="nobr">nest-js</span>/core');
    });

    it('never squeezes the category code of a top finding beside a long location', () => {
      // « A06 » shrank to one character per line beside the chip of a
      // scoped package.
      expect(OWASP_REPORT_CSS).toMatch(
        /\.top-sub \.cat-code \{[^}]*flex: none/,
      );
    });

    it('lines the category code of a top finding up with the first line of a long package chip', () => {
      const top = tableOf(
        sectionOf(
          render(report([scoped(), vuln({ severity: 'critical' })])),
          'owasp-summary',
        ),
        'top-table',
      );
      // Aligned on the baseline of the chip, a block of two lines, « A06 »
      // sat beside its last line.
      expect(top).toContain(
        '<div class="top-sub is-long"><a class="cat-code" href="#owasp-a06">A06</a>',
      );
      // A short chip, or a path, keeps the baseline of its line.
      expect(top).toContain(
        '<div class="top-sub"><a class="cat-code" href="#owasp-a03">A03</a>',
      );
      expect(OWASP_REPORT_CSS).toMatch(
        /\.top-sub\.is-long \{[^}]*align-items: flex-start/,
      );
      // The line of a chip: its text on the line of the chip's first.
      expect(OWASP_REPORT_CSS).toMatch(
        /\.top-sub\.is-long \.cat-code \{[^}]*line-height: 1\.7/,
      );
    });

    const alpine = (packageName: string) =>
      vuln({
        type: 'container',
        name: 'CVE-2026-28390',
        description: '',
        path: undefined,
        line: undefined,
        packageName,
        packageVersion: '3.5.5-r0',
        fixedVersion: '3.5.6-r0',
        imageName: 'alpine:latest',
      });
    /** The rows of a table, its header and continuation rows left out. */
    const bodyRows = (table: string): string[] =>
      table
        .split('</thead>')[1]
        .split('</tr>')
        .filter((r) => r.includes('<td'));
    /** How many times `part` shows in the visible text of `html`. */
    const shown = (html: string, part: string): number =>
      plainOf(html).split(part).length - 1;
    /** A dependency of a Node application, with short versions. */
    const node = (packageName: string) =>
      vuln({
        type: 'sca',
        name: 'Cross-site scripting',
        description: '',
        severity: 'high',
        path: undefined,
        line: undefined,
        packageName,
        packageVersion: '6.0.0',
        fixedVersion: '6.0.2',
      });
    /**
     * The chip of a name the package column of the upgrade plan cannot hold
     * whole: its pieces, each never cut, flowing as the parts of any chip,
     * a line opening on the separator before them.
     */
    const cutChip = (...pieces: string[]): string =>
      `<span class="code-chip pkg">${pieces
        .map((piece) => `<span class="seg">${piece}</span>`)
        .join('<wbr>')}</span>`;
    /** The A06 section of the dashboard preview. */
    const previewA06Of = (vulns: MappedVulnerability[]): string =>
      sectionOf(render(report(vulns), true, false), 'owasp-a06');

    it('gives twin packages that share a long version or image one row of the upgrade plan, which names them once', () => {
      const proven = {
        verdict: 'proven',
        source: 'agent',
        score: 0.8,
        reason: null,
      };
      const a06 = a06Of([
        imagemagick('libmagickcore-6-headers'),
        imagemagick('imagemagick-6-common', { exploitability: proven }),
        imagemagick('imagemagick'),
        alpine('libssl3'),
        alpine('libcrypto3'),
      ]);
      const plan = tableOf(a06, 'plan-table');
      const rows = bodyRows(plan);
      // The same image of four lines and the same versions were repeated on
      // every row of a group: 13 ImageMagick packages filled a page.
      expect(rows).toHaveLength(3);
      const [group] = rows;
      // The installed version whole, the names the column cannot hold whole
      // cut at their separators.
      expect(group).toContain(
        `<td>${[
          packageChip('imagemagick'),
          cutChip('imagemagick-6', '-common'),
          cutChip('libmagickcore-6', '-headers'),
        ].join(' ')}</td>`,
      );
      expect(shown(group, EPOCH)).toBe(1);
      expect(shown(group, AZURE_IMAGE)).toBe(1);
      expect(shown(group, EPOCH_FIX)).toBe(1);
      // The findings of all three are counted, the verdict of one shown.
      expect(textOf(group)).toContain('3 critical');
      expect(group).toContain(verdictPill('proven'));
      // Twins whose versions and image are short keep a row each.
      expect(plan).toMatch(
        /<tbody class="unit"><tr class="has-twin">[\s\S]*?libcrypto3[\s\S]*?<\/tr><tr class="twin">[\s\S]*?libssl3[\s\S]*?<\/tr><\/tbody>/,
      );
      expect(textOf(a06)).toContain(
        'packages of one image that share their advisories and fixed version stay together, in one row counting the findings of all of them when their version or image name is long.',
      );
    });

    it('gives the target of the upgrade plan the width of a Debian version, then the installed column, the package names yielding first', () => {
      const plan = tableOf(
        a06Of([
          imagemagick('imagemagick'),
          imagemagick('libmagickcore-6-headers'),
          imagemagick('libmagickcore-6.q16-6-extra'),
          scoped(),
        ]),
        'plan-table',
      );
      const widths = widthsOf(plan);
      // Upgrade to: the version to install whole (29 characters), where it
      // was cut after « dfsg- » while the installed one had room; the hash
      // of the prerelease, wider than any column, widens nothing.
      // Installed: the installed version whole too. Held whole first,
      // « libmagickcore-6-headers » (23 characters) took 25% of the page and
      // the version read « 8:6.9.11.60+dfsg » / « -1.6ubuntu1.3 », a whole
      // Debian version at a glance.
      // Package: what is left, the name cut before its last hyphen.
      expect(widths).toEqual(['21%', '29%', '31%', 'auto']);
      expect(plan).toContain(
        `${packageChip('imagemagick')} ${cutChip('libmagickcore-6', '-headers')} ${packageChip('libmagickcore-6.q16-6-extra')}</td>`,
      );
      const fixed = widths
        .filter((w) => w !== 'auto')
        .reduce((sum, w) => sum + parseFloat(w), 0);
      expect(100 - fixed).toBeGreaterThanOrEqual(19);
    });

    it('holds a Debian version whole in the installed column beside a package name of 19 to 24 characters, the name cut at its separators', () => {
      // A Node application shipped in an Ubuntu image. Held whole before the
      // installed versions, « serialize-javascript » (20 characters) took
      // 23% of the page, and the installed version read « 8:6.9.11.60+dfsg »
      // / « -1.6ubuntu1.3 ».
      const cases: [string, string][] = [
        ['serialize-javascript', cutChip('serialize', '-javascript')],
        ['webpack-dev-middleware', cutChip('webpack', '-dev', '-middleware')],
        // A short npm scope keeps its « / », as in any chip; the first
        // piece of the name may share its line (« @aws-sdk/client » /
        // « -secrets-manager »).
        [
          '@aws-sdk/client-secrets-manager',
          cutChip('@aws-sdk/', 'client', '-secrets', '-manager'),
        ],
        [
          '@opentelemetry/instrumentation-express',
          cutChip('@opentelemetry/', 'instrumentation', '-express'),
        ],
      ];
      for (const [name, chip] of cases) {
        const plan = tableOf(
          a06Of([imagemagick('imagemagick'), node(name)]),
          'plan-table',
        );
        expect(widthsOf(plan)).toEqual(['21%', '29%', '31%', 'auto']);
        expect(plan).toContain(`<td>${chip}</td>`);
        expect(plan).toContain(
          `<span class="versions">${versionText(EPOCH)}</span>`,
        );
      }
      // A name the column holds keeps its chip.
      const fits = tableOf(
        a06Of([imagemagick('imagemagick'), node('express-rate-limit')]),
        'plan-table',
      );
      expect(widthsOf(fits)).toEqual(['21%', '29%', '31%', 'auto']);
      expect(fits).toContain(`<td>${packageChip('express-rate-limit')}</td>`);
    });

    it('holds a Debian version whole in the installed column beside a name of 19 to 24 characters without a separator, Open findings giving up room before the name is cut', () => {
      // A Django application shipped in an Ubuntu image: « djangorestframework »
      // has no separator to be cut at. Held whole first, it left the
      // installed column 28% of the page, and the version read
      // « 8:6.9.11.60+dfsg » / « -1.6ubuntu1.3 ».
      const exploited = (name: string): MappedVulnerability => ({
        ...node(name),
        exploitability: {
          verdict: 'actively_exploited',
          source: 'agent',
          score: 1,
          reason: null,
        },
      });
      const cases: [string, string[]][] = [
        // Open findings keeps 18% (124px), its verdict pill on one line.
        ['djangorestframework', ['22%', '29%', '31%', 'auto']],
        // It gives more, down to the room of its widest count: its header
        // and its pill wrap between their words.
        ['tensorflowjsconverter', ['24%', '29%', '31%', 'auto']],
        ['azurestoragefiledatalake', ['26%', '29%', '31%', 'auto']],
      ];
      for (const [name, widths] of cases) {
        const plan = tableOf(
          a06Of([imagemagick('imagemagick'), exploited(name)]),
          'plan-table',
        );
        expect(widthsOf(plan)).toEqual(widths);
        expect(plan).toContain(`<td>${packageChip(name)}</td>`);
        expect(plan).toContain(
          `<span class="versions">${versionText(EPOCH)}</span>`,
        );
        expect(plan).toContain(verdictPill('actively_exploited'));
      }
      expect(OWASP_REPORT_CSS).toMatch(
        /\.plan-verdict \.verdict \{[^}]*white-space: normal/,
      );
      expect(OWASP_REPORT_CSS).toMatch(
        /\.plan-table tr:not\(\.cont-row\) > th:last-child \{[^}]*white-space: normal/,
      );
      // Without a verdict pill, Open findings keeps its header on one line:
      // the name keeps its separators to be cut at first.
      const plain = tableOf(
        a06Of([imagemagick('imagemagick'), node('serialize-javascript')]),
        'plan-table',
      );
      expect(widthsOf(plain)).toEqual(['21%', '29%', '31%', 'auto']);
    });

    it('holds both Debian versions whole in a dashboard preview narrower than the PDF, a long name cut anywhere and Open findings wrapping its header', () => {
      const vulns = [imagemagick('imagemagick'), scoped()];
      const preview = previewA06Of(vulns);
      // In the modal of the dashboard (an iframe of 840px, its scrollbar
      // included), the zoomed page has a text column of 596px: the widths
      // of the PDF cut every Debian version with its epoch there, in the
      // plan and after the arrow of an advisory (« 8:6.9.11.60+dfsg » /
      // « -1.6ubuntu1.4 »). Below 950px, each column reads its width for
      // that column of text from its block. The installed version was then
      // cut too, the pieces of the scoped name (18 characters) held whole
      // first: it read « 8:6.9.11.60+dfsg » / « -1.6ubuntu1.3 ».
      expect(widthsOf(tableOf(preview, 'plan-table'))).toEqual([
        'var(--plan-package, 21%)',
        'var(--plan-installed, 29%)',
        'var(--plan-target, 31%)',
        'auto',
      ]);
      expect(widthsOf(tableOf(preview, 'dep-table'))).toEqual([
        '88px',
        'auto',
        'var(--advisory-packages, 34%)',
      ]);
      // The version to install whole: 35% of 596px holds its chip of 184px
      // and the padding of its cell, 38% the chip after its arrow. The
      // installed version whole too (34%). The package column keeps
      // « imagemagick » whole (17%), the long scoped name cut anywhere in
      // it; Open findings keeps the room of its widest count (13%).
      expect(preview).toContain(
        '<div class="deps" style="--narrow-plan-package: 17%; --narrow-plan-installed: 34%; --narrow-plan-target: 35%; --narrow-advisory-packages: 38%">',
      );
      expect(tableOf(preview, 'plan-table')).toContain(
        `<td>${packageChip('imagemagick')}</td>`,
      );
      // A verdict pill that wraps between its words leaves the same room.
      const exploited = previewA06Of([
        ...vulns,
        {
          ...node('underscore'),
          exploitability: {
            verdict: 'actively_exploited',
            source: 'agent',
            score: 1,
            reason: null,
          },
        },
      ]);
      expect(exploited).toContain(
        '<div class="deps" style="--narrow-plan-package: 17%; --narrow-plan-installed: 34%; --narrow-plan-target: 35%; --narrow-advisory-packages: 38%">',
      );
      const html = render(report(vulns), true, false);
      expect(html).toMatch(
        /@media screen and \(max-width: 950px\) \{\s*\.deps \{ --plan-package: var\(--narrow-plan-package\); --plan-installed: var\(--narrow-plan-installed\); --plan-target: var\(--narrow-plan-target\); --advisory-packages: var\(--narrow-advisory-packages\); \}/,
      );
      // The PDF keeps its widths and its markup.
      const pdf = render(report(vulns));
      expect(
        widthsOf(tableOf(sectionOf(pdf, 'owasp-a06'), 'plan-table')),
      ).toEqual(['21%', '29%', '31%', 'auto']);
      expect(sectionOf(pdf, 'owasp-a06')).toContain('<div class="deps">');
      expect(pdf).not.toContain('--narrow-');
      expect(pdf).not.toContain('--plan-');
    });

    it('never narrows a column of the upgrade plan, nor that of the triaged packages, below its content in a narrower preview', () => {
      // Their shares are those of a text column of 596px (the modal): at a
      // window of 700px, « path-to-regexp » (106px with the padding of its
      // cell) passed the package column of the plan (97px), and
      // « decode-uri-component » that of the triaged packages. Below 950px,
      // these tables lay out on their content: a column keeps its share, or
      // the width of its widest unbreakable chip, pill or count.
      const preview = render(report([vuln()]), true, false);
      expect(preview).toMatch(
        /@media screen and \(max-width: 950px\) \{[^@]*\.deps table\.plan-table, \.tri-split table\.tri-packages \{ table-layout: auto; \}/,
      );
      expect(render(report([vuln()]))).not.toContain('table-layout: auto');
    });

    it('keeps whole in the preview a short package name the PDF holds whole, its column widening for it', () => {
      // « express-rate-limit » (18 characters) fits the 21% of the PDF, not
      // the share of a text column of 596px: it was cut at its separators
      // there. A short name never breaks; below 950px, the plan lays out on
      // its content and its package column widens for the name.
      const vulns = [imagemagick('imagemagick'), node('express-rate-limit')];
      expect(tableOf(previewA06Of(vulns), 'plan-table')).toContain(
        `<td>${packageChip('express-rate-limit')}</td>`,
      );
      expect(tableOf(a06Of(vulns), 'plan-table')).toContain(
        `<td>${packageChip('express-rate-limit')}</td>`,
      );
      // A name the PDF cuts at its separators is cut there in the preview.
      const cut = [imagemagick('imagemagick'), node('serialize-javascript')];
      expect(tableOf(previewA06Of(cut), 'plan-table')).toContain(
        `<td>${cutChip('serialize', '-javascript')}</td>`,
      );
    });

    it('never cuts a piece of a package name in the preview, its column widening for the longest', () => {
      // « @opentelemetry/ » and « instrumentation » (15 characters each, no
      // separator) were cut anywhere in 20% of a text column of 596px: its
      // « / » alone on a line, then « instrumentatio » / « n ».
      const preview = previewA06Of([
        imagemagick('imagemagick'),
        node('@opentelemetry/instrumentation-express'),
      ]);
      // 21% there, as in the PDF: the package column keeps its width, the
      // installed column yields.
      expect(preview).toContain(
        '<div class="deps" style="--narrow-plan-installed: 25%; --narrow-plan-target: 35%; --narrow-advisory-packages: 38%">',
      );
      expect(widthsOf(tableOf(preview, 'plan-table'))).toEqual([
        '21%',
        'var(--plan-installed, 29%)',
        'var(--plan-target, 31%)',
        'auto',
      ]);
      expect(tableOf(preview, 'plan-table')).toContain(
        `<td>${cutChip('@opentelemetry/', 'instrumentation', '-express')}</td>`,
      );
    });

    it('keeps the markup of a preview whose A06 tables fit its narrower column', () => {
      const preview = previewA06Of([alpine('libssl3'), node('path-to-regexp')]);
      expect(preview).toContain('<div class="deps">');
      expect(widthsOf(tableOf(preview, 'plan-table'))).toEqual([
        '20%',
        '27%',
        '17%',
        'auto',
      ]);
      expect(widthsOf(tableOf(preview, 'dep-table'))).toEqual([
        '88px',
        'auto',
        '34%',
      ]);
    });

    it('lists together the packages of an advisory that share a long installed version and its fix, the pair named once', () => {
      const advisories = tableOf(
        a06Of([
          imagemagick('imagemagick'),
          imagemagick('libmagickcore-6-headers'),
          imagemagick('imagemagick-6-common'),
          alpine('libssl3'),
          alpine('libcrypto3'),
        ]),
        'dep-table',
      );
      // Repeated under each package, the pair took three lines a package.
      expect(advisories).toContain(
        `<div class="pkg pkg-set"><div class="pkg-names">${[
          packageChip('imagemagick'),
          packageChip('imagemagick-6-common'),
          packageChip('libmagickcore-6-headers'),
        ].join(
          ' ',
        )}</div><span class="versions">${versionText(EPOCH)}</span><span class="fix">${arrowIcon()}${versionChip(EPOCH_FIX)}</span></div>`,
      );
      expect(shown(advisories, EPOCH)).toBe(1);
      // A short pair stays on the line of each package.
      expect(advisories).toContain(
        `<div class="pkg">${packageChip('libcrypto3')} <span class="versions"><span class="nobr">3.5.5-r0</span></span><span class="fix">${arrowIcon()}${codeChip('3.5.6-r0')}</span></div>`,
      );
    });

    /** Binary packages of one ImageMagick source, as an Ubuntu image has them. */
    const MAGICK = [
      'imagemagick',
      'imagemagick-6-common',
      'libmagickcore-6-headers',
      'libmagickwand-6.q16-dev',
      'libmagickcore-6.q16-6-extra',
    ];

    it('lists more than three packages sharing a row of the upgrade plan on a full-width line under it', () => {
      const names = MAGICK.slice(0, 4);
      const plan = tableOf(
        a06Of(names.map((n) => imagemagick(n))),
        'plan-table',
      );
      const rows = bodyRows(plan);
      // Thirteen chips stacked one per line in the package column made a
      // row of 290px that no page end could hold: it left 27% of a page
      // blank.
      expect(rows).toHaveLength(2);
      const [row, list] = rows;
      expect(row).toContain(
        `<td>${packageChip('imagemagick')}<span class="more">+3 packages</span></td>`,
      );
      expect(shown(row, EPOCH)).toBe(1);
      expect(list).toContain(
        `<tr class="note-row pkg-list-row"><td colspan="4"><div class="pkg-list"><span class="pkg-list-head">The 4 packages:</span> ${names
          .map((n) => packageChip(n))
          .join(' ')}</div></td>`,
      );
      // The row and its list: one group of rows, never parted by a page
      // break.
      expect(plan).toMatch(
        /<tbody class="unit"><tr class="has-note">[\s\S]*?<tr class="note-row pkg-list-row">[\s\S]*?<\/tbody>/,
      );
      expect(
        textOf(
          sectionOf(
            render(report(names.map((n) => imagemagick(n)))),
            'owasp-a06',
          ),
        ),
      ).toContain(
        'in one row counting the findings of all of them when their version or image name is long, their names listed under the row when they are more than three.',
      );
    });

    it('lists more than three packages that share a long pair of an advisory on a full-width line under its row', () => {
      const names = MAGICK.slice(0, 4);
      const advisories = tableOf(
        a06Of(names.map((n) => imagemagick(n))),
        'dep-table',
      );
      // Named in the package column, 13 chips and the pair made a row of
      // 320px beside an advisory cell empty on 60% of its height.
      expect(advisories).toContain(
        `<div class="pkg pkg-set"><div class="pkg-names">${packageChip('imagemagick')}<span class="more">+3 packages</span></div><span class="versions">${versionText(EPOCH)}</span><span class="fix">${arrowIcon()}${versionChip(EPOCH_FIX)}</span></div>`,
      );
      expect(advisories).toContain(
        `<tr class="note-row pkg-list-row"><td colspan="3"><div class="pkg-list"><span class="pkg-list-head">The 4 packages:</span> ${names
          .map((n) => packageChip(n))
          .join(' ')}</div></td></tr>`,
      );
      // Under the advisory, from its column on.
      expect(OWASP_REPORT_CSS).toMatch(
        /\.dep-table tr\.pkg-list-row td \{[^}]*padding-left: calc\(88px \+ 10px\)/,
      );
    });

    it('holds a Debian version whole in the installed column once the packages of a row are listed under it', () => {
      const plan = tableOf(
        a06Of([...MAGICK.map((n) => imagemagick(n)), scoped()]),
        'plan-table',
      );
      // Named in the package column, « libmagickcore-6-headers » (23
      // characters, never cut) took 25% of the page, and the installed
      // version was cut. Listed under their row, the package column only
      // needs the pieces of the scoped name: the version installed and the
      // version to install are each held whole.
      expect(widthsOf(plan)).toEqual(['21%', '29%', '31%', 'auto']);
    });

    it('shows a long version to install as one chip, cut only between its parts', () => {
      const a06 = a06Of([imagemagick('imagemagick'), scoped()]);
      for (const table of [
        tableOf(a06, 'plan-table'),
        tableOf(a06, 'dep-table'),
      ]) {
        // Cut as an identifier, the target of a prerelease showed three
        // chips, one per line, read as three versions.
        for (const fix of [EPOCH_FIX, PRERELEASE_FIX]) {
          expect(table).toContain(versionChip(fix));
          expect(table).not.toContain(codeChip(fix));
        }
      }
    });

    it('keeps the comma of a list of versions with the long version it follows', () => {
      const OLDER = '8:6.9.11.60+dfsg-1.6ubuntu1.2';
      const advisories = tableOf(
        a06Of([
          imagemagick('imagemagick'),
          imagemagick('imagemagick', { packageVersion: OLDER }),
        ]),
        'dep-table',
      );
      expect(advisories).toContain(
        `<span class="versions">${versionText(OLDER, { after: ',' })} ${versionText(EPOCH)}</span>`,
      );
    });

    it('names in a key fact a long version apart from its package, cut only between its parts, the full stop kept with it', () => {
      const summary = sectionOf(
        render(
          report([
            imagemagick('imagemagick', {
              exploitability: {
                verdict: 'actively_exploited',
                source: 'agent',
                score: 1,
                reason: null,
              },
            }),
          ]),
        ),
        'owasp-summary',
      );
      // In the mono of the path it follows, its box keeping the full stop.
      expect(summary).toContain(
        `actively exploited: ${pathText('imagemagick', { keep: true })} ${idBox(
          `<span class="path keep is-long">${breakableVersion(EPOCH)}</span>`,
          { after: '.' },
        )}</li>`,
      );
      expect(summary).not.toContain(breakableId(`imagemagick ${EPOCH}`));
    });

    it('names the image of a container finding in the top list', () => {
      const top = tableOf(
        sectionOf(
          render(report([imagemagick('imagemagick'), alpine('libssl3')])),
          'owasp-summary',
        ),
        'top-table',
      );
      // Which image to rebuild was said nowhere in the summary.
      expect(top).toContain(
        `<span class="top-where">${packageChip('imagemagick')} <span class="versions">${versionText(EPOCH)}</span><span class="plan-image"> ${idText(AZURE_IMAGE, { before: 'in\u00a0' })}</span></span>`,
      );
      expect(top).toContain(
        `<span class="plan-image"> ${idText('alpine:latest', { before: 'in\u00a0' })}</span></span>`,
      );
    });

    it('widens the package column of the advisories to hold a version whole, within its bound', () => {
      // 32 characters: a version still held whole.
      const LONG = '1:2.02~beta2-36ubuntu3.32+esm2.0';
      const LONG_FIX = '1:2.02~beta2-36ubuntu3.32+esm2.1';
      const widths = (vulns: MappedVulnerability[]) =>
        widthsOf(tableOf(a06Of(vulns), 'dep-table'));
      // The fix, its chip and arrow: 242px, where the column gave 214.
      expect(
        widths([
          imagemagick('grub2-common', {
            packageVersion: LONG,
            fixedVersion: LONG_FIX,
          }),
        ]),
      ).toEqual(['88px', 'auto', '36%']);
      expect(widths([imagemagick('imagemagick')])).toEqual([
        '88px',
        'auto',
        '34%',
      ]);
    });

    it('never lets a state overflow its column: it wraps between its words, in a column that holds the longest', () => {
      // « Proposed not exploitable » (128px) ran past every state column,
      // « Not exploitable » past a column of 12% (62px of text).
      expect(OWASP_REPORT_CSS).toMatch(/td \.state \{[^}]*white-space: normal/);
      // Wrapped, its dot stays on its first line, where a centred dot sat
      // beside the second (« Proposed / ● not / exploitable »).
      expect(OWASP_REPORT_CSS).toMatch(
        /td \.state \{[^}]*align-items: flex-start/,
      );
      expect(OWASP_REPORT_CSS).toMatch(
        /td \.state \.state-dot \{[^}]*margin-top: calc\(\(1lh - 6px\) \/ 2\)/,
      );
      const advisories = tableOf(
        a06Of([
          alpine('libssl3'),
          alpine('libcrypto3'),
          scoped({ state: 'proposed_not_exploitable' }),
        ]),
        'dep-table',
      );
      expect(widthsOf(advisories)).toEqual(['88px', 'auto', '34%', '13%']);
      const triaged = tableOf(
        sectionOf(
          render(
            report([
              vuln({ state: 'ignored', severity: 'critical' }),
              vuln({
                name: 'Other rule',
                state: 'not_exploitable',
                severity: 'critical',
              }),
            ]),
          ),
          'owasp-triaged',
        ),
        'triaged-table',
      );
      expect(widthsOf(triaged)).toEqual(['88px', 'auto', '32%', '13%']);
    });

    it('never cuts a state inside a word: in a narrower preview, a state column holds the widest word of a state and its dot', () => {
      // In the modal of a window of 850px (706px) and below, the 14% of the
      // State column of Most severe gave « Confirmed » and its dot (64px)
      // 58px of text: breakable anywhere, it read « Confir » / « med ». A
      // state wraps between its words only.
      expect(OWASP_REPORT_CSS).toMatch(
        /td \.state \{[^}]*overflow-wrap: normal/,
      );
      expect(OWASP_REPORT_CSS).not.toMatch(
        /td \.state \{[^}]*overflow-wrap: anywhere/,
      );
      const vulns = [
        vuln({ severity: 'critical', state: 'confirmed', line: '33-33' }),
        vuln({ severity: 'critical', line: '34-34' }),
        alpine('libssl3'),
        alpine('libcrypto3'),
        scoped({ state: 'proposed_not_exploitable' }),
        vuln({ name: 'Other rule', state: 'ignored', severity: 'critical' }),
        vuln({ name: 'Third rule', state: 'resolved', severity: 'critical' }),
      ];
      const stateOf = (html: string, id: string, cls: string): string => {
        const widths = widthsOf(tableOf(sectionOf(html, id), cls));
        return widths[widths.length - 1];
      };
      const tables: [string, string, string][] = [
        ['owasp-summary', 'top-table', '14%'],
        ['owasp-a03', 'occ-table', '15%'],
        ['owasp-a06', 'dep-table', '13%'],
        ['owasp-triaged', 'triaged-table', '13%'],
      ];
      // Below 950px, the column takes 88px: « exploitable », the widest word
      // of a state (67px with its dot), and the padding of its cell. Above,
      // its share of a text column as wide as the PDF's.
      const preview = render(report(vulns), true, false);
      for (const [id, cls, share] of tables) {
        expect(stateOf(preview, id, cls)).toBe(`var(--state-col, ${share})`);
      }
      expect(preview).toMatch(
        /@media screen and \(max-width: 950px\) \{[^@]*\.doc \{ --state-col: 88px; \}/,
      );
      // The PDF keeps its widths and its markup.
      const pdf = render(report(vulns));
      for (const [id, cls, share] of tables) {
        expect(stateOf(pdf, id, cls)).toBe(share);
      }
      expect(pdf).not.toContain('--state-col');
    });

    it('keeps the arrow of a fix its width beside a fixed version that wraps', () => {
      // A flex item, it shrank to 3px beside a chip of three lines.
      expect(OWASP_REPORT_CSS).toMatch(
        /\.dep-table \.fix > \.arrow \{[^}]*flex: none/,
      );
    });

    it('gives a location too long for the scanner line a line of its own, after the state, never opened by a separator', () => {
      const DEEP =
        'NodeGoat/services/payments-gateway/src/main/java/com/acmecorp/platform/payments/infrastructure/adapters/persistence/reconciliation/SettlementReconciliationExportRepositoryImplementation.java';
      const metaOf = (path: string): string =>
        /<div class="finding-meta[^"]*">[\s\S]*?<\/div>/.exec(
          sectionOf(
            render(
              report([vuln({ path, line: '1287-1293', state: 'confirmed' })]),
            ),
            'owasp-a03',
          ),
        )?.[0];
      const CHIPS =
        '<span class="meta-chips">(?:<span class="chip[^"]*">[^<]*</span>)+</span>';
      // Its « · » opened the next line, the state alone on a third one.
      expect(metaOf(DEEP)).toMatch(
        new RegExp(
          `^<div class="finding-meta is-long">${CHIPS}<span class="meta-item"><span class="state">`,
        ),
      );
      expect(metaOf(DEEP)).toContain(
        `<span class="meta-where">${pathText(`${DEEP}:1287–1293`)}</span></div>`,
      );
      expect(OWASP_REPORT_CSS).toMatch(
        /\.finding-meta \.meta-where \{[^}]*flex-basis: 100%/,
      );
      // One that fits keeps its place, between the chips and the state.
      expect(metaOf('app/routes/contributions.js')).toMatch(
        new RegExp(
          `^<div class="finding-meta">${CHIPS}<span class="meta-item"><span class="path">`,
        ),
      );
    });

    it('names in a title a scoped package as one identifier, cut before its « / », its punctuation kept with it', () => {
      const top = tableOf(
        sectionOf(
          render(
            report([
              scoped({
                name: `Code injection in ${SCOPED}, fixed upstream`,
              }),
            ]),
          ),
          'owasp-summary',
        ),
        'top-table',
      );
      // The « / » ended the first line of the name. Now the scope and the
      // name are each whole while they fit on a line, the name opening its
      // line on its « / »; the text after them follows on its last line.
      const [scope, name] = SCOPED.split(/(?=\/)/);
      expect(top).toContain(
        `in ${idBox(breakableId(scope), {})}<wbr>${idBox(breakableId(name), { after: ',' })} fixed upstream`,
      );
      expect(top).not.toContain('nobr is-long');
    });

    it('counts the packages of a container CVE in its title when naming them all would cut it', () => {
      const names = [
        'imagemagick',
        'imagemagick-6-common',
        'imagemagick-6.q16',
        'libmagickcore-6-arch-config',
        'libmagickcore-6-headers',
        'libmagickcore-6.q16-6',
        'libmagickcore-6.q16-6-extra',
        'libmagickcore-6.q16-dev',
        'libmagickcore-dev',
      ];
      const titleOf = (vulns: MappedVulnerability[]): string =>
        textOf(
          /<div class="adv-title">([\s\S]*?)<\/div>/.exec(
            tableOf(a06Of(vulns), 'dep-table'),
          )?.[1],
        );
      // Seven names in bold over four lines, then « […] ».
      expect(titleOf(names.map((n) => imagemagick(n)))).toBe(
        'CVE-2026-25965 in imagemagick and 8 other packages',
      );
      expect(titleOf([alpine('libssl3'), alpine('libcrypto3')])).toBe(
        'CVE-2026-28390 in libcrypto3 and libssl3',
      );
    });
  });

  describe('untrusted data', () => {
    it('escapes names, paths, descriptions and project names', () => {
      const html = render(
        report(
          [
            vuln({
              name: '<img src=x onerror=alert(1)>',
              path: 'a/<b>.js',
              description: '<script>alert(1)</script>',
            }),
          ],
          undefined,
          { projectName: '<svg onload=alert(1)>' },
        ),
      );
      expect(html).not.toContain('<img src=x');
      expect(html).not.toContain('<script>alert');
      expect(html).not.toContain('<svg onload');
      expect(html).not.toContain('<b>.js');
      expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    });

    it('never prints a secret in clear', () => {
      const secret = 'sk_live_EXAMPLEKEYEXAMPLEKEY0000';
      const html = render(
        report([
          vuln({ name: `Stripe key ${secret}`, path: `config/${secret}.js` }),
          vuln({ description: `Found ${secret} in code.` }),
        ]),
      );
      expect(html).not.toContain(secret);
      expect(html).toContain('sk_live_&#8226;&#8226;&#8226;&#8226;0000');
    });
  });

  // Without an analysis renderer (the Community Edition), an analysis a
  // finding carries is never printed, and the document is the one of a
  // report without any.
  it('prints no analysis without an analysis renderer', () => {
    const analysis = {
      markdown: [
        '## Verdict',
        'True Positive — confidence 0.85, exploitability: proven (network vector, low complexity, low privileges, no user interaction).',
        '',
        '## Summary',
        'The `amount` fields of `req.body` reach `eval()` with no type check, so any signed-in user runs code on the server.',
        '',
        '## Remediation',
        '- Replace `eval()` with `parseInt(value, 10)` for each amount.',
      ].join('\n'),
      date: '2026-04-14T18:35:08Z',
      url: 'https://app.example.com/project/p1/sast/issue/x',
    };
    const plainVuln = vuln({ state: 'confirmed' });
    const withAnalysis = render(
      report([{ ...plainVuln, cybeAnalysis: analysis }]),
    );
    expect(withAnalysis).not.toContain('ca-card');
    expect(withAnalysis).not.toContain('Cybe Analysis');
    expect(withAnalysis).toBe(render(report([plainVuln])));
  });
});

describe('OWASP report licence notice', () => {
  it.each([true, false])(
    'credits the OWASP Top 10 text under CC BY-SA 4.0 (detailed: %s)',
    (detailed) => {
      const text = textOf(render(report([vuln()]), detailed));
      expect(text).toContain(
        'Text from the OWASP Top 10:2021 (https://owasp.org/Top10/), © OWASP Foundation, licensed under CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/); adapted.',
      );
    },
  );
});
