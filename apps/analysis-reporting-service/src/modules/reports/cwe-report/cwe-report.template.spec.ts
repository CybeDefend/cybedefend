import { CWE_TOP_25_2024_DATA } from './constants/cwe-data.constants';
import { idText, packageChip, pathText } from '../shared/report-layout';
import {
  breakableId,
  codeChip,
  idPieces,
  piecesHtml,
  versionChip,
  versionPieces,
} from '../shared/report-styles';
import { cweReportTitle, renderCweReport } from './cwe-report.template';
import {
  CweCategoryWithVulnerabilities,
  CweReportData,
  MappedVulnerability,
} from './cwe-report.types';

let seq = 0;
const vuln = (
  over: Partial<MappedVulnerability> = {},
): MappedVulnerability => ({
  id: `v${++seq}`,
  type: 'sast',
  name: 'Uncontrolled Eval Execution',
  description: 'Calling **eval** on user input runs arbitrary code.',
  severity: 'HIGH',
  state: 'to_verify',
  priority: 'normal',
  path: 'NodeGoat/app/routes/contributions.js',
  line: '32-32',
  cwe: ['CWE-79'],
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  ...over,
});

const isOpen = (v: MappedVulnerability) =>
  !['ignored', 'resolved', 'not_exploitable'].includes(v.state);

/** Builds report data the way the service does (categories from the CWEs). */
const report = (
  vulnerabilities: MappedVulnerability[],
  over: Partial<CweReportData> = {},
): CweReportData => {
  const categories: CweCategoryWithVulnerabilities[] = Object.values(
    CWE_TOP_25_2024_DATA,
  )
    .map((cweData) => {
      const list = vulnerabilities.filter((v) => v.cwe.includes(cweData.id));
      return {
        cweData,
        vulnerabilities: list,
        count: list.filter(isOpen).length,
      };
    })
    .filter((c) => c.vulnerabilities.length > 0);
  return {
    projectId: 'baad3b53-91a9-42c2-918f-ebb2a50c3ee0',
    generatedAt: '2026-09-23T10:50:27.587Z',
    scanMetadata: {
      projectId: 'baad3b53-91a9-42c2-918f-ebb2a50c3ee0',
      projectName: 'vitality-api',
    },
    summary: {
      totalVulnerabilities: vulnerabilities.length + 300,
      openFindings: vulnerabilities.filter(isOpen).length + 120,
      byType: { sast: 0, iac: 0, sca: 0, container: 0 },
      bySeverity: { critical: 31, high: 168, medium: 118, low: 24, unknown: 2 },
      byState: {},
      byCweCategory: {},
    },
    cweCategories: categories,
    vulnerabilities,
    ...over,
  };
};

/** Numeric entities decoded: the template emits ASCII only (see below). */
const decode = (html: string) =>
  html.replace(/&#(\d+);/g, (_m, code: string) =>
    String.fromCharCode(Number(code)),
  );
const render = (data: CweReportData, detailed = true, forPdf = true) =>
  decode(renderCweReport(data, { detailed, forPdf }));

/** Slice of the document between two markers (a section). */
const section = (html: string, id: string) => {
  const start = html.indexOf(`id="${id}"`);
  if (start < 0) return '';
  const end = html.indexOf('</section>', start);
  return html.slice(start, end);
};

const count = (haystack: string, needle: string) =>
  haystack.split(needle).length - 1;

/** Visible text of an HTML fragment: block ends read as a space, inline tags
 * vanish, spaces collapse. */
const textOf = (html: string) =>
  html
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<\/(div|p|li|dt|dd|td|th|h\d)>|<br>/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');

/** The cover block. */
const coverOf = (html: string) =>
  html.slice(html.indexOf('<header class="cover"'), html.indexOf('</header>'));

/** CSS rule body of a selector in the document's style sheets. */
const cssRule = (html: string, selector: string) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return html.match(new RegExp(`${escaped} \\{([^}]*)\\}`))?.[1] ?? '';
};

describe('cwe-report.template', () => {
  // The short note of the agent is written by an LLM: masked and without
  // a link, as in its brief.
  it('prints the note of the agent without a secret it quotes nor a link it writes', () => {
    const html = render(
      report([
        vuln({
          exploitability: {
            verdict: 'theoretical',
            source: 'agent',
            score: 0.7,
            reason:
              'Set `cookieSecret: "s3cr3t-session-key"` in code; see [the fix](https://evil.example/phish).',
          },
        }),
      ]),
    );
    expect(html).not.toContain('s3cr3t-session-key');
    expect(html).not.toContain('evil.example');
    expect(html).toContain('see the fix.');
  });

  beforeEach(() => {
    seq = 0;
  });

  describe('pagination of a finding', () => {
    const html = render(report([vuln()]));

    it('never cuts a finding description, which travels with the first rows of its table', () => {
      expect(cssRule(html, '.fgroup-desc')).toMatch(/break-inside: avoid/);
    });

    it('never slides the hidden continuation row under a line of the description', () => {
      expect(cssRule(html, '.desc-cover')).not.toMatch(/margin-top: -/);
    });
  });

  describe('document and cover', () => {
    const html = render(report([vuln()]));

    it('is a script-free document ending with the footer Puppeteer waits for', () => {
      expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
      expect(html).toContain('class="footer"');
      expect(html).not.toContain('<script');
      expect(html).not.toContain('<canvas');
    });

    it('names the project in the document title, never its UUID', () => {
      expect(html).toContain('<title>CWE Top 25 report · vitality-api</title>');
      expect(cweReportTitle({ projectId: 'p1', projectName: 'Acme <x>' })).toBe(
        'CWE Top 25 report · Acme <x>',
      );
      expect(cweReportTitle({ projectId: 'p1' })).toBe(
        'CWE Top 25 report · p1',
      );
    });

    it('opens on the shared cover with project, branch, generation date and scope', () => {
      expect(html).toContain('class="cover"');
      expect(html).toContain('CWE Top 25 · 2024');
      expect(html).toContain('<h1>CWE Top 25 report</h1>');
      // The project id breaks before its hyphens (<wbr>, <nobr>).
      expect(html.replace(/<wbr>|<\/?nobr>/g, '')).toMatch(
        /cover-meta[\s\S]*Project[\s\S]*vitality-api[\s\S]*baad3b53-91a9-42c2-918f-ebb2a50c3ee0/,
      );
      expect(html).toContain('All branches');
      expect(html).toContain('Generated');
      expect(html).toContain('23 Sep 2026, 10:50 UTC');
      expect(html).not.toContain('Scan Date');
      expect(html).not.toContain('Legal Disclaimer');
    });

    it('names the edition once on the cover (eyebrow), not in every line', () => {
      const cover = textOf(coverOf(html));
      expect(count(cover, '2024')).toBe(1);
      expect(cover).toContain('Scope SAST, IaC, SCA, Container');
    });

    it('shows the scanned branch when there is one', () => {
      const withBranch = render(
        report([vuln()], {
          scanMetadata: { projectId: 'p1', projectName: 'x', branch: 'main' },
        }),
      );
      expect(textOf(coverOf(withBranch))).toContain('Branch main');
    });

    it('emits ASCII only: non-ASCII characters travel as entities (Puppeteer mojibake)', () => {
      const raw = renderCweReport(report([vuln()]), {
        detailed: true,
        forPdf: true,
      });
      const body = raw.slice(raw.indexOf('<body>'));
      expect(body).not.toMatch(/[^\x00-\x7f]/);
      expect(body).toContain('&#183;');
    });

    it('uses classes, not inline styles, for everything but dynamic colours and widths', () => {
      expect(html).not.toMatch(
        /style="[^"]*(font-size|padding|margin|font-weight|border-radius)/,
      );
    });
  });

  describe('executive summary', () => {
    const data = report([
      vuln({ severity: 'HIGH', state: 'confirmed' }),
      vuln({ severity: 'high', line: '33-33' }),
      vuln({
        type: 'iac',
        name: 'Missing CPU limits',
        severity: 'medium',
        path: 'NodeGoat/docker-compose.yml',
        cwe: ['CWE-400'],
      }),
      // Two Top 25 weaknesses: one finding, counted once in the totals.
      vuln({ name: 'Eval in template', cwe: ['CWE-79', 'CWE-94'] }),
      vuln({ state: 'ignored', severity: 'critical', name: 'Dismissed' }),
    ]);
    const html = render(data);
    const summary = section(html, 'summary');

    it('gives the headline tile the room its caption needs, with the shared option', () => {
      expect(summary).toContain('1.6fr');
      expect(html).not.toContain('!important');
    });

    it('counts the open Top 25 findings once each, never the whole project', () => {
      expect(summary).toMatch(
        /kpi-value"[^>]*>4<\/div><div class="kpi-label">Top 25 findings/,
      );
      expect(summary).toContain('in 3 of 25 weaknesses');
      expect(summary).not.toMatch(/kpi-value"[^>]*>343</);
    });

    it('breaks the Top 25 findings down by severity, zeros greyed out', () => {
      expect(summary).toMatch(/>3<\/div><div class="kpi-label">High/);
      expect(summary).toMatch(/>1<\/div><div class="kpi-label">Medium/);
      expect(summary).toMatch(
        /kpi is-zero[^>]*><div class="kpi-value"[^>]*>0<\/div><div class="kpi-label">Critical/,
      );
    });

    // "Unrated", the word of every report for a finding without a severity.
    it('shows an Unrated tile only when some findings have no severity (same word as the badge)', () => {
      expect(summary).not.toMatch(/kpi-label">Unrated/);
      const unrated = section(
        render(report([vuln({ severity: 'none' })])),
        'summary',
      );
      expect(unrated).toMatch(/>1<\/div><div class="kpi-label">Unrated/);
      expect(unrated).not.toContain('Unknown');
    });

    it('states the whole-project total apart, with an explicit label, and the triaged exclusion', () => {
      expect(summary).toContain('Whole project');
      expect(textOf(summary)).toContain(
        '124 open findings across all scan types. 4 of them (3%) map to a Top 25 weakness.',
      );
      expect(textOf(summary)).toContain(
        '1 triaged Top 25 finding is excluded from all figures and listed at the end.',
      );
    });

    it('says which triaged findings the end of the report lists: only the critical and high ones', () => {
      const scope = (...severities: string[]) =>
        textOf(
          section(
            render(
              report([
                vuln(),
                ...severities.map((severity) =>
                  vuln({
                    name: `Dismissed ${severity}`,
                    severity,
                    state: 'ignored',
                  }),
                ),
              ]),
            ),
            'summary',
          ),
        );
      expect(scope('high', 'medium', 'low')).toContain(
        '3 triaged Top 25 findings are excluded from all figures; the critical and high ones are listed at the end.',
      );
      expect(scope('medium', 'low')).toContain(
        '2 triaged Top 25 findings are excluded from all figures and counted at the end.',
      );
    });

    it('says how many open findings map to CWEs outside the Top 25', () => {
      const data2 = report([
        vuln(),
        vuln({ cwe: ['CWE-1321'] }),
        vuln({ cwe: ['CWE-1333'] }),
      ]);
      data2.summary.openFindings = 3;
      expect(textOf(section(render(data2), 'summary'))).toContain(
        '3 open findings across all scan types. 1 of them (33%) maps to a Top 25 weakness, 2 to other CWEs.',
      );
    });

    it('charts the severity split and the weaknesses found in SVG', () => {
      expect(summary).toContain('class="donut"');
      expect(summary).toContain('class="hbars"');
    });

    it('labels each bar with the CWE id and a plain-words name, as the tables do', () => {
      const bars = summary.slice(summary.indexOf('class="hbars"'));
      expect(bars).toMatch(/CWE-79<[^>]*>(<[^>]*>)*\s*Cross-site scripting/);
      expect(bars).toMatch(/CWE-400<[^>]*>(<[^>]*>)*\s*Resource exhaustion/);
      // The id goes in the shared chart's id slot, never through a regex on
      // its markup.
      expect(bars).toContain('hbar-id');
    });

    it('explains under the bars why they add up to more than the total', () => {
      // 'Eval in template' maps to CWE-79 and CWE-94: 5 in the bars, 4 findings.
      expect(textOf(summary)).toContain(
        '1 finding maps to two weaknesses and counts in each bar.',
      );
      const single = section(render(report([vuln()])), 'summary');
      expect(single).not.toContain('counts in each bar');
    });

    describe('page 1 with long identifiers', () => {
      // Eleven weaknesses found: eight bars, « 3 more in the coverage table ».
      const eleven = Object.keys(CWE_TOP_25_2024_DATA)
        .slice(0, 11)
        .map((id, i) => vuln({ cwe: [id], line: `${i + 1}-${i + 1}` }));
      const exploited = (path: string) =>
        vuln({
          name: 'Path Traversal in Settlement Export File Resolution',
          severity: 'medium',
          cwe: ['CWE-22'],
          path,
          line: '1287-1293',
          exploitability: {
            verdict: 'proven',
            source: 'agent',
            score: 0.92,
            reason: 'Reachable from the export route.',
          },
        });
      const LONG_FILE =
        'NodeGoat/services/payments-gateway/src/main/java/com/acmecorp/platform/payments/infrastructure/adapters/persistence/reconciliation/SettlementReconciliationExportRepositoryImplementation.java';
      const longMeta = {
        projectId: 'baad3b53-91a9-42c2-918f-ebb2a50c3ee0',
        projectName:
          'acme-corp-customer-identity-and-access-management-platform-backend-services',
        branch:
          'feature/PLAT-48213-migrate-imagemagick-thumbnail-pipeline-to-libvips-and-harden-upload-path-validation',
      };
      const summaryOf = (
        path: string,
        scanMetadata?: CweReportData['scanMetadata'],
      ) =>
        section(
          render(
            report(
              [...eleven, exploited(path)],
              scanMetadata ? { scanMetadata } : {},
            ),
          ),
          'summary',
        );
      const bars = (summary: string) => count(summary, 'class="hbar-row"');

      it('keeps eight bars when no identifier makes page 1 longer', () => {
        const summary = summaryOf('NodeGoat/app/routes/export.js');
        expect(bars(summary)).toBe(8);
        expect(textOf(summary)).toContain('3 more in the coverage table.');
      });

      it('gives back with fewer bars the room a long project name and branch take on the cover, so the key facts stay on page 1', () => {
        // The cover grows by 45 px (two lines of project, two of branch): two
        // bars of 23.5 px.
        const summary = summaryOf('NodeGoat/app/routes/export.js', longMeta);
        expect(bars(summary)).toBe(6);
        expect(textOf(summary)).toContain('5 more in the coverage table.');
      });

      it('and the line a long file name adds to a key fact', () => {
        expect(bars(summaryOf(LONG_FILE, longMeta))).toBe(5);
        expect(bars(summaryOf(LONG_FILE))).toBe(7);
      });
    });

    it('centres the donut in the height of its panel', () => {
      expect(cssRule(html, '.charts .panel')).toContain(
        'flex-direction: column',
      );
    });

    it('keeps the charts inside the sheet of a narrower preview, one under the other below 840px', () => {
      // Below a window of about 820px, « Weaknesses found » left the sheet,
      // its bars and counts out of the frame, and the document scrolled
      // sideways: each panel kept the width of its content (the ring and
      // its legend; labels of 186px, the counts). In the preview, the
      // panel of the bars never grows past its share, its labels shortened
      // first (ellipsis); below 840px, the panels stack.
      const preview = render(report([vuln()]), true, false);
      expect(preview).toContain(
        '@media screen { .grid-2.charts { grid-template-columns: 0.9fr minmax(0, 1.1fr); } .summary .hbar-label { flex-shrink: 1; min-width: 0; } }',
      );
      expect(preview).toContain(
        '@media screen and (max-width: 840px) { .grid-2.charts { grid-template-columns: minmax(0, 1fr); } }',
      );
      // The PDF keeps its grid and its markup.
      expect(html).not.toContain('minmax(0, 1.1fr)');
      expect(html).not.toContain('max-width: 840px');
    });

    it('words every reference description the way MITRE does today ("The product"), briefly', () => {
      for (const cwe of Object.values(CWE_TOP_25_2024_DATA)) {
        expect(cwe.description).toMatch(/\bproduct\b/);
        expect(cwe.description).not.toMatch(
          /\b(software|web application|the application|web server)\b/i,
        );
        expect(cwe.description.length).toBeLessThanOrEqual(260);
      }
    });

    it('gives every Top 25 weakness a short name that fits a chart label', () => {
      for (const cwe of Object.values(CWE_TOP_25_2024_DATA)) {
        expect(cwe.shortName).toBeTruthy();
        expect(cwe.shortName.length).toBeLessThanOrEqual(24);
      }
    });

    it('lists factual findings computed from the data, in the shared key facts panel', () => {
      const panel = summary.slice(summary.indexOf('key-facts'));
      expect(textOf(panel)).toMatch(/^[^<]*Key facts/);
      expect(textOf(panel)).toContain(
        'Highest-ranked weakness found: #1 CWE-79 Cross-site scripting (3 findings).',
      );
      expect(panel).toMatch(/3 high findings, 1 of them confirmed/);
      // The coverage count is already in the headline tile.
      expect(textOf(summary)).not.toMatch(/of the 25 weaknesses/);
      // No local copy of the panel.
      expect(html).not.toContain('class="facts"');
    });

    it('names the findings confirmed in triage below the worst severity', () => {
      const confirmed = section(
        render(
          report([
            vuln({ severity: 'critical', name: 'Critical one' }),
            ...[32, 33, 34].map((line) =>
              vuln({ state: 'confirmed', line: `${line}-${line}` }),
            ),
            vuln({
              state: 'confirmed',
              name: 'Template Variable in href',
              description: 'Other.',
              path: 'NodeGoat/app/views/profile.html',
            }),
            vuln({
              type: 'iac',
              state: 'confirmed',
              severity: 'medium',
              name: 'Missing CPU limits',
              description: 'IaC.',
              path: 'NodeGoat/docker-compose.yml',
              cwe: ['CWE-400'],
            }),
          ]),
        ),
        'summary',
      );
      expect(textOf(confirmed)).toContain(
        '1 critical finding, still to be verified.',
      );
      // Once one name carries a count, every name does: "X and Y (2
      // occurrences)" would read as two occurrences each. "Triage" is kept
      // for the excluded findings, "review" names the open ones.
      expect(textOf(confirmed)).toContain(
        '5 findings confirmed by review (4 high, 1 medium): Uncontrolled Eval Execution (3 occurrences), Template Variable in href (1 occurrence) and Missing CPU limits (1 occurrence).',
      );
      // Nothing confirmed below the worst severity: no such fact.
      expect(textOf(summary)).not.toContain('confirmed by review');
    });

    it('names confirmed findings without counts when each is a single occurrence', () => {
      const confirmed = section(
        render(
          report([
            vuln({ severity: 'critical', name: 'Critical one' }),
            vuln({ state: 'confirmed', name: 'One' }),
            vuln({ state: 'confirmed', name: 'Two', description: 'Other.' }),
          ]),
        ),
        'summary',
      );
      expect(textOf(confirmed)).toContain(
        '2 findings confirmed by review (2 high): One and Two.',
      );
    });

    it('never calls the open findings "triage": the word names the excluded ones', () => {
      const html = render(report([vuln({ state: 'confirmed' })]));
      expect(textOf(html)).not.toMatch(/in triage|triage status/);
    });

    it('never says "to verify" as if it were plain English', () => {
      const allToVerify = section(
        render(
          report([
            vuln({ severity: 'critical' }),
            vuln({ severity: 'critical' }),
          ]),
        ),
        'summary',
      );
      expect(textOf(allToVerify)).toContain(
        '2 critical findings, all still to be verified.',
      );
      expect(textOf(allToVerify)).not.toMatch(
        /\bare to verify|still to verify/,
      );
    });

    it('names the most frequent weakness when it is not the highest-ranked', () => {
      const data2 = report([
        vuln(),
        ...[1, 2].map((i) =>
          vuln({ name: `DoS ${i}`, cwe: ['CWE-400'], line: `${i}-${i}` }),
        ),
      ]);
      expect(textOf(section(render(data2), 'summary'))).toContain(
        'most frequent: #24 CWE-400 Resource exhaustion (2 findings)',
      );
    });

    it('names the finding AI analysis rates exploited within the worst-severity fact', () => {
      const exploited = section(
        render(
          report([
            vuln({
              type: 'sca',
              severity: 'critical',
              name: 'Arbitrary Code Execution in underscore',
              path: undefined,
              line: undefined,
              packageName: 'underscore',
              packageVersion: '1.9.1',
              advisoryId: 'GHSA-cf4h',
              cwe: ['CWE-94'],
              exploitability: {
                verdict: 'actively_exploited',
                source: 'agent',
                score: 1,
                reason: 'CISA KEV.',
              },
            }),
            vuln({ severity: 'critical', name: 'Other critical' }),
          ]),
        ),
        'summary',
      );
      expect(textOf(exploited)).toContain(
        '2 critical findings, all still to be verified; AI analysis rates 1 of them actively exploited: Arbitrary Code Execution in underscore (underscore@1.9.1).',
      );
      expect(textOf(exploited)).not.toContain('rated proven or actively');
      // Package references and CWE ids in the code face, as everywhere else.
      expect(exploited).toContain(
        '(<span class="mono">underscore@1.9.1</span>)',
      );
      expect(exploited).toMatch(/#1 <span class="mono">CWE-79<\/span> Cross/);
      expect(cssRule(html, '.key-facts .mono')).toContain('font-size: 10px');
    });

    it('cites a code location in the code face, with its line', () => {
      const located = section(
        render(
          report([
            vuln({
              severity: 'critical',
              exploitability: {
                verdict: 'proven',
                source: 'agent',
                score: 0.9,
                reason: 'Reachable.',
              },
            }),
          ]),
        ),
        'summary',
      );
      expect(textOf(located)).toContain(
        'Uncontrolled Eval Execution (app/routes/contributions.js:32)',
      );
      // Longer than a short identifier: it flows in the sentence, breakable
      // before its separators, its parentheses never cut from it.
      expect(located).toContain(
        `(<span class="path">${breakableId('app/routes/contributions.js')}</span><span class="loc-line">:32</span>)`,
      );
      const short = section(
        render(
          report([
            vuln({
              severity: 'critical',
              path: 'NodeGoat/server.js',
              line: '15-15',
              exploitability: {
                verdict: 'proven',
                source: 'agent',
                score: 0.9,
                reason: 'Reachable.',
              },
            }),
          ]),
        ),
        'summary',
      );
      expect(short).toContain(pathText('server.js'));
    });

    it('cites the file of a long path in a key fact, with its line: the whole path is in the Location table', () => {
      const deep =
        'NodeGoat/services/payments-gateway/src/main/java/com/acmecorp/platform/payments/infrastructure/adapters/persistence/reconciliation/SettlementReconciliationExportRepositoryImplementation.java';
      const located = section(
        render(
          report([
            vuln({
              severity: 'critical',
              path: deep,
              line: '1287-1293',
              exploitability: {
                verdict: 'proven',
                source: 'agent',
                score: 0.9,
                reason: 'Reachable.',
              },
            }),
          ]),
        ),
        'summary',
      );
      expect(textOf(located)).toContain(
        'Uncontrolled Eval Execution (SettlementReconciliationExportRepositoryImplementation.java:1287–1293).',
      );
      expect(located).not.toContain('payments-gateway');
      expect(located).toContain(
        `(<span class="path">${breakableId('SettlementReconciliationExportRepositoryImplementation.java')}</span><span class="loc-line">:1287–1293</span>)`,
      );
      // A line range never breaks after its dash.
      expect(cssRule(html, '.loc-line')).toContain('white-space: nowrap');
    });

    it('says where the findings come from and how many dependency findings are dev-only, in one fact', () => {
      const dep = (over: Partial<MappedVulnerability>) =>
        vuln({
          type: 'sca',
          path: undefined,
          line: undefined,
          packageName: 'lodash',
          packageVersion: '4.17.11',
          cwe: ['CWE-400'],
          ...over,
        });
      const withDev = section(
        render(
          report([
            vuln(),
            dep({ advisoryId: 'GHSA-1', devDependency: true }),
            dep({ advisoryId: 'GHSA-2' }),
          ]),
        ),
        'summary',
      );
      expect(textOf(withDev)).toContain(
        'By source: 1 from code (SAST) and 2 from dependencies (SCA); 1 of the 2 dependency findings is in a development dependency, not shipped to production.',
      );
      expect(summary).not.toContain('development dependenc');
    });

    it('says how many open findings carry no CWE and cannot be classified', () => {
      const unmapped = (type: 'sca' | 'container', n: number) =>
        Array.from({ length: n }, () =>
          vuln({ type, cwe: [], path: undefined, packageName: 'openssl' }),
        );
      const withUnmapped = report([
        vuln(),
        ...unmapped('container', 2),
        ...unmapped('sca', 1),
        vuln({ type: 'sca', cwe: [], state: 'ignored' }),
      ]);
      expect(textOf(section(render(withUnmapped), 'summary'))).toContain(
        '3 carry no CWE identifier (2 container, 1 dependency) and cannot be classified.',
      );
      expect(summary).not.toContain('carry no CWE identifier');
    });
  });

  describe('Top 25 coverage table', () => {
    const html = render(
      report([
        vuln({ severity: 'medium' }),
        vuln({ severity: 'HIGH' }),
        vuln({ cwe: ['CWE-416'], state: 'resolved' }),
      ]),
    );
    const coverage = section(html, 'coverage');

    it('starts on a page of its own so the 25 rows are never split', () => {
      expect(html).toContain('class="section page-start" id="coverage"');
      expect(render(report([]))).toContain('class="section" id="coverage"');
    });

    it('lists the 25 weaknesses in rank order with sized columns', () => {
      expect(count(coverage, '<tr>')).toBe(26); // header + 25 rows
      expect(coverage).toContain('<colgroup>');
      expect(coverage.indexOf('CWE-79')).toBeLessThan(
        coverage.indexOf('CWE-787'),
      );
    });

    it('shows the open findings count, tinted by the highest severity; zero stays muted', () => {
      expect(coverage).toMatch(/class="count-pill"[^>]*#b93815[^>]*>2</);
      // CWE-416: only a resolved finding, so nothing open.
      const row416 = coverage.slice(coverage.indexOf('CWE-416'));
      expect(row416.slice(0, row416.indexOf('</tr>'))).toContain(
        'class="count-zero"',
      );
    });

    it('reads a climb in the MITRE ranking as a rising risk, never in green', () => {
      // CWE-352 climbed from #9 to #4; CWE-416 fell from #4 to #8.
      const row352 = coverage.slice(coverage.indexOf('CWE-352'));
      expect(row352.slice(0, row352.indexOf('</tr>'))).toMatch(
        /class="trend trend-up"><span class="tri"><\/span>5</,
      );
      const row416 = coverage.slice(coverage.indexOf('CWE-416'));
      expect(row416.slice(0, row416.indexOf('</tr>'))).toMatch(
        /class="trend trend-down"><span class="tri"><\/span>4</,
      );
      expect(coverage).not.toMatch(/#10b981|#12b76a/);
    });

    it('draws the trend arrows in CSS: the embedded Latin fonts have no triangle glyph', () => {
      expect(html).not.toMatch(/[\u25b2\u25bc]/);
      expect(html).toMatch(
        /\.trend-up \.tri \{[^}]*border-bottom: \d+px solid currentColor/,
      );
      expect(html).toMatch(
        /\.trend-down \.tri \{[^}]*border-top: \d+px solid currentColor/,
      );
    });

    it('never fakes a bold code face (a synthetic bold is embedded as a Type 3 font)', () => {
      expect(html).toMatch(/\.code-inline[^{]*\{[^}]*font-synthesis: none/);
    });

    it('does not repeat the cover eyebrow as a section eyebrow', () => {
      expect(coverage).not.toContain('CWE Top 25 · 2024');
    });

    it('draws the MITRE trend in neutral tones, never a severity colour', () => {
      expect(html).not.toContain('#b54708');
      expect(cssRule(html, '.trend-up')).not.toContain('font-weight');
      // A weakness without findings mutes its trend like the rest of the row.
      expect(html).toMatch(
        /tr:has\(\.count-zero\) \.trend \{[^}]*color: inherit/,
      );
    });

    it('aligns the zero counts with the digits of the count pills', () => {
      expect(cssRule(html, '.count-zero')).toContain('min-width: 22px');
    });

    it('explains the reference columns once, under the table', () => {
      expect(coverage).toContain('class="table-note"');
      expect(coverage).toMatch(/Known Exploited Vulnerabilities/);
      expect(coverage).toMatch(/2023/);
    });

    it('explains every mark of the vs 2023 column, the dash included', () => {
      const note = coverage.slice(coverage.indexOf('class="table-note"'));
      expect(textOf(note)).toContain(
        'climbed (more dangerous), fell or — unchanged.',
      );
      // The same mark as in the table.
      expect(note).toContain('<span class="trend trend-flat">—</span>');
    });
  });

  describe('findings by weakness', () => {
    const data = report([
      vuln({ line: '33-33', state: 'confirmed' }),
      vuln({ line: '32-32', state: 'confirmed' }),
      vuln({ line: '34-34', state: 'confirmed' }),
      vuln({
        name: 'Template Variable in href',
        description: 'Other description.',
        path: 'NodeGoat/app/views/profile.html',
        line: '78-78',
        exploitability: {
          verdict: 'proven',
          source: 'agent',
          score: 0.8,
          reason: 'Reachable from **GET /profile** without encoding.',
        },
      }),
      vuln({
        name: 'Static verdict only',
        description: 'Third description.',
        path: 'NodeGoat/app/views/memo.html',
        exploitability: {
          verdict: 'theoretical',
          source: 'static',
          score: 0.3,
          reason: 'Static analysis: pattern detected.',
        },
      }),
      vuln({
        type: 'sca',
        name: 'minimatch ReDoS',
        description: 'Catastrophic backtracking.',
        severity: 'high',
        path: undefined,
        line: undefined,
        packageName: 'minimatch',
        packageVersion: '3.0.4',
        fixedVersion: '3.0.5',
        manifest: 'NodeGoat/package-lock.json',
        advisoryId: 'GHSA-f8q6-p94x-37v3',
        cve: 'CVE-2022-3517',
        cwe: ['CWE-400'],
      }),
      vuln({
        type: 'sca',
        name: 'minimatch ReDoS',
        description: 'Catastrophic backtracking.',
        severity: 'high',
        path: undefined,
        line: undefined,
        packageName: 'minimatch',
        packageVersion: '5.0.0',
        fixedVersion: '5.1.1',
        manifest: 'NodeGoat/package-lock.json',
        advisoryId: 'GHSA-f8q6-p94x-37v3',
        cve: 'CVE-2022-3517',
        cwe: ['CWE-400'],
      }),
      vuln({ name: 'Dismissed eval', state: 'ignored' }),
    ]);
    const html = render(data);
    const details = section(html, 'findings');

    it('describes each weakness found once, with a short "how to prevent"', () => {
      expect(details).toContain('class="cwe-head"');
      expect(details).toContain(CWE_TOP_25_2024_DATA['CWE-79'].mitigations[0]);
      expect(details).toContain('How to prevent');
      // Weaknesses without open findings get no block.
      expect(details).not.toMatch(/cwe-eyebrow">#2 · CWE-787/);
    });

    it('names the weakness with the plain-words name of the charts above its MITRE title', () => {
      expect(details).toMatch(
        /cwe-eyebrow">#1 · CWE-79 · Cross-site scripting<\/div><h3 class="cwe-title">Improper Neutralization/,
      );
      expect(details).toMatch(
        /cwe-eyebrow">#24 · CWE-400 · Resource exhaustion</,
      );
    });

    it('drops the plain-words name from the eyebrow when it only repeats the MITRE title', () => {
      const oob = section(
        render(
          report([
            vuln({
              type: 'sca',
              name: 'uuid: missing buffer bounds check',
              path: undefined,
              line: undefined,
              packageName: 'uuid',
              packageVersion: '3.3.2',
              advisoryId: 'GHSA-w5hq',
              cwe: ['CWE-787'],
            }),
          ]),
        ),
        'findings',
      );
      // "Out-of-bounds write" over "Out-of-bounds Write": said once.
      expect(oob).toMatch(
        /cwe-eyebrow">#2 · CWE-787<\/div><h3 class="cwe-title">Out-of-bounds Write</,
      );
      // The recall, shown without the title, still names the weakness.
      expect(textOf(oob)).toContain(
        'CWE-787 · Vulnerable dependencies (continued)',
      );
    });

    it('drops the plain-words name from the eyebrow when a short MITRE title already says it', () => {
      const eyebrowOf = (cwe: string) =>
        section(render(report([vuln({ cwe: [cwe] })])), 'findings').match(
          /cwe-eyebrow">([^<]*)</,
        )?.[1];
      // "CSRF" over "Cross-Site Request Forgery (CSRF)", "Input validation"
      // over "Improper Input Validation": said once.
      expect(eyebrowOf('CWE-352')).toBe('#4 · CWE-352');
      expect(eyebrowOf('CWE-918')).toBe('#19 · CWE-918');
      expect(eyebrowOf('CWE-798')).toBe('#22 · CWE-798');
      expect(eyebrowOf('CWE-20')).toBe('#12 · CWE-20');
      // Kept where it helps: a long MITRE title, or other words.
      expect(eyebrowOf('CWE-94')).toBe('#11 · CWE-94 · Code injection');
      expect(eyebrowOf('CWE-400')).toBe('#24 · CWE-400 · Resource exhaustion');
      expect(eyebrowOf('CWE-502')).toBe(
        '#16 · CWE-502 · Unsafe deserialization',
      );
    });

    it('pairs the chapter count with the eyebrow and the rank line with the last line of the title', () => {
      // A 2 x 2 grid aligned on baselines: eyebrow | count, title | rank.
      const head = cssRule(html, '.cwe-head');
      expect(head).toContain('display: grid');
      expect(head).toContain('align-items: baseline');
      expect(cssRule(html, '.cwe-head-main, .cwe-aside')).toContain(
        'display: contents',
      );
      expect(cssRule(html, '.cwe-title')).toContain(
        'align-self: last baseline',
      );
      expect(cssRule(html, '.cwe-ref')).toContain('align-self: last baseline');
      // The text still reads eyebrow, title, then count and rank.
      expect(textOf(details)).toMatch(
        /#1 · CWE-79 · Cross-site scripting Improper Neutralization[^·]*Scripting'\) 5 findings/,
      );
    });

    it('balances a weakness title on its lines (no lone last word)', () => {
      expect(cssRule(html, '.cwe-title')).toContain('text-wrap: balance');
    });

    it('never leaves a lone word on the last line of a finding or advisory title', () => {
      // Blocks only: the advisory names of the triaged list are spans of an
      // identifier line.
      for (const selector of [
        '.fgroup-title',
        '.adv-title',
        '.triage-title',
        '.adv-ids',
      ])
        expect(cssRule(html, selector)).toContain('text-wrap: pretty');
    });

    it('says "no KEV CVE" rather than printing a zero count', () => {
      // CWE-400 has no CVE in the KEV catalog; CWE-79 has 3.
      expect(textOf(details)).toContain(
        'Rank up from #37 in 2023 · no KEV CVE',
      );
      expect(textOf(details)).toContain('Rank up from #2 in 2023 · 3 KEV CVEs');
      expect(textOf(details)).not.toContain('0 KEV');
    });

    it('explains the State and Verdict columns once, before the first table', () => {
      const conventions = textOf(
        details.slice(details.indexOf('class="conventions"')),
      );
      expect(conventions).toMatch(
        /State: review status\. Verdict: exploitability assessed by CybeDefend’s AI analysis or a reviewer, with its confidence\./,
      );
      const unanalysed = section(render(report([vuln()])), 'findings');
      expect(textOf(unanalysed)).not.toContain('Verdict:');
    });

    it('groups identical findings: one description, one row per occurrence with its line', () => {
      expect(count(details, 'runs arbitrary code')).toBe(1);
      expect(details).toMatch(
        /Uncontrolled Eval Execution[\s\S]*?3 occurrences/,
      );
      // Every group states its count, so the headers line up.
      expect(details).toMatch(
        /Template Variable in href<\/span>[^\n]*?>1 occurrence</,
      );
      const text = textOf(details);
      expect(text).toContain('app/routes/contributions.js:32');
      expect(text).toContain('app/routes/contributions.js:33');
      expect(text).toContain('app/routes/contributions.js:34');
    });

    it('keeps the single geometry of the shared severity badge', () => {
      expect(cssRule(html, '.fgroup-head .badge')).toBe('');
    });

    it('keeps short code spans of a description on one line', () => {
      expect(html).toMatch(/\.fgroup-desc code[^{]*\{[^}]*white-space: nowrap/);
    });

    it('renders Markdown descriptions, never raw markers', () => {
      expect(details).toContain('<strong>eval</strong>');
      expect(details).not.toContain('**eval**');
    });

    it('strips the path prefix shared by every file and says so once, as a short path', () => {
      expect(details).toContain(
        `Paths are relative to ${pathText('NodeGoat/', { keep: true })}.`,
      );
      expect(textOf(details)).not.toContain('NodeGoat/app');
    });

    it('lists dependency advisories in one compact table: one row per advisory, its packages and fixed versions', () => {
      expect(details).toContain('Vulnerable dependencies');
      expect(details).toContain('advisories"');
      expect(textOf(details)).toContain(
        'CWE-400 · Vulnerable dependencies (continued)',
      );
      expect(count(details, 'minimatch ReDoS')).toBe(1);
      expect(details).toContain('GHSA-f8q6-p94x-37v3');
      expect(details).toContain('CVE-2022-3517');
      // One manifest for the whole project: named once, not on every row.
      expect(count(details, 'package-lock.json')).toBe(1);
      expect(details).toMatch(
        /Dependency findings come from[\s\S]*package-lock\.json/,
      );
      expect(textOf(details)).toMatch(/minimatch@3\.0\.4.*minimatch@5\.0\.0/);
      expect(details).toMatch(/3\.0\.5[\s\S]*5\.1\.1/);
      // The advisory title says it all: no advisory prose in the body.
      expect(details).not.toContain('Catastrophic backtracking');
    });

    it('says in the intro how the blocks are ordered and that multi-mapped findings repeat', () => {
      const intro = textOf(details.slice(details.indexOf('section-intro')));
      expect(intro).toContain(
        'code and infrastructure findings first, then vulnerable dependencies',
      );
      expect(intro).toContain('listed under each');
    });

    it('announces the triaged findings it leaves out in the section aside', () => {
      expect(textOf(details)).toContain(
        '7 open findings · 1 triaged, excluded',
      );
    });

    it('gives every occurrence table the same columns once any finding has a verdict', () => {
      // 'Uncontrolled Eval Execution' has no analysis, 'Template Variable in
      // href' has one: both tables still show State then Verdict.
      const tables = details.split('occurrences"').slice(1);
      expect(tables.length).toBe(3);
      for (const t of tables) {
        expect(t.slice(0, t.indexOf('</thead>'))).toContain('>Verdict<');
      }
      const noVerdict = section(render(report([vuln()])), 'findings');
      expect(noVerdict).not.toContain('>Verdict<');
    });

    it('repeats the finding title above an occurrence table that continues on the next page', () => {
      expect(textOf(details)).toContain(
        'CWE-79 · Uncontrolled Eval Execution (continued)',
      );
    });

    it('keeps a (clamped) description whole, followed by the small empty cover of the table', () => {
      const long = section(
        render(
          report([
            vuln({
              description:
                'First paragraph of the rule.\n\nSecond paragraph.\n\nLast paragraph.',
            }),
          ]),
        ),
        'findings',
      );
      // The block that covers the continuation row of the table is a small
      // empty one; the description itself is never split (same rule as the
      // scanner report: a finding's lead travels with its first rows).
      const desc = long.slice(long.indexOf('class="fgroup-desc"'));
      const cover = desc.slice(desc.indexOf('cont-cover'));
      expect(desc.indexOf('Last paragraph')).toBeLessThan(
        desc.indexOf('cont-cover'),
      );
      expect(cover.slice(cover.indexOf('>') + 1, cover.indexOf('</div>'))).toBe(
        '',
      );
      expect(cssRule(html, '.fgroup-desc')).toContain('break-inside: avoid');
      expect(cssRule(html, '.fgroup-desc')).toContain('break-after: avoid');
    });

    it('recalls the weakness between its blocks, shown only at the top of a page', () => {
      // CWE-79: three code groups, so two recalls; CWE-400: one block, none.
      // The reference box is chained to the first block: no recall after it.
      expect(count(details, 'class="cwe-cont"')).toBe(2);
      expect(
        count(section(render(data, false), 'findings'), 'class="cwe-cont"'),
      ).toBe(2);
      expect(textOf(details)).toContain(
        '#1 · CWE-79 · Cross-site scripting (continued)',
      );
      // Hidden from assistive tech, like the shared continuation row.
      expect(details).toMatch(/class="cwe-cont" aria-hidden="true"/);
      expect(cssRule(html, '.cwe-cont')).toMatch(/margin-top: -\d+px/);
      expect(cssRule(html, '.cwe-cont')).toContain('break-after: avoid');
      // Same look as the continuation row of the shared tables.
      expect(cssRule(html, '.cwe-cont')).not.toContain('uppercase');
    });

    it('shows the AI verdict and a short reasoning only for agent or manual analyses', () => {
      expect(details).toContain('class="ai-note"');
      expect(details).toContain('<strong>GET /profile</strong>');
      expect(details).toMatch(/Proven<\/span>[\s\S]*?80%/);
      expect(details).not.toContain('Static analysis: pattern detected');
    });

    it('puts a reasoning on the full width, under the occurrence it explains', () => {
      const start = details.lastIndexOf('<tr', details.indexOf('profile.html'));
      const row = details.slice(start, details.indexOf('</tr>', start));
      expect(row).not.toContain('ai-note');
      const next = details.slice(details.indexOf('</tr>', start));
      expect(next.slice(0, next.indexOf('</tr>', 5))).toMatch(
        /colspan="3"><div class="ai-note">/,
      );
    });

    it('marks a shortened description or reasoning', () => {
      const long = section(
        render(
          report([
            vuln({
              description: `${'A sentence of the rule description. '.repeat(12)}\n\n${'Another paragraph that will not fit. '.repeat(10)}`,
            }),
          ]),
        ),
        'findings',
      );
      expect(long).toContain('[…]');
      expect(details).not.toContain('[…]');
    });

    it('drops the State column of dependency tables when every dependency finding shares one state, and says so', () => {
      // Both minimatch rows are to verify.
      const adv = details.slice(details.indexOf('advisories"'));
      expect(adv.slice(0, adv.indexOf('</thead>'))).not.toContain('>State<');
      expect(textOf(details)).toContain(
        'All dependency findings are still to be verified.',
      );
      const mixed = section(
        render(
          report([
            vuln({
              type: 'sca',
              path: undefined,
              line: undefined,
              packageName: 'qs',
              packageVersion: '6.5.2',
              advisoryId: 'GHSA-q',
              cwe: ['CWE-400'],
            }),
            vuln({
              type: 'sca',
              state: 'confirmed',
              path: undefined,
              line: undefined,
              packageName: 'ws',
              packageVersion: '1.1.5',
              advisoryId: 'GHSA-w',
              cwe: ['CWE-400'],
            }),
          ]),
        ),
        'findings',
      );
      const mixedAdv = mixed.slice(mixed.indexOf('advisories"'));
      expect(mixedAdv.slice(0, mixedAdv.indexOf('</thead>'))).toContain(
        '>State<',
      );
      expect(textOf(mixed)).not.toContain('All dependency findings are');
    });

    it('tags development dependencies and withdrawn advisories, neutrally', () => {
      const tagged = section(
        render(
          report([
            vuln({
              type: 'sca',
              name: 'Prototype Pollution in lodash',
              path: undefined,
              line: undefined,
              packageName: 'lodash',
              packageVersion: '4.17.11',
              advisoryId: 'GHSA-jf85',
              devDependency: true,
              withdrawn: true,
              cwe: ['CWE-20'],
            }),
          ]),
        ),
        'findings',
      );
      expect(textOf(tagged)).toContain('lodash@4.17.11 dev');
      expect(textOf(tagged)).toContain(
        'Prototype Pollution in lodash withdrawn',
      );
      expect(textOf(tagged)).toContain(
        'dev: development dependency, not shipped to production.',
      );
      expect(textOf(details)).not.toContain('development dependency');
    });

    it('cross-references an advisory listed under several weaknesses', () => {
      const multi = section(
        render(
          report([
            vuln({
              type: 'sca',
              name: 'Command Injection in lodash',
              path: undefined,
              line: undefined,
              packageName: 'lodash',
              packageVersion: '4.17.11',
              advisoryId: 'GHSA-35jh',
              cwe: ['CWE-77', 'CWE-94'],
            }),
          ]),
        ),
        'findings',
      );
      const text = textOf(multi);
      expect(text).toContain('GHSA-35jh · also under CWE-77');
      expect(text).toContain('GHSA-35jh · also under CWE-94');
      // CWE ids in the code face, as in the ranking and the triaged list.
      expect(multi).toContain('also under <span class="mono">CWE-77</span>');
    });

    it('never ends a line of identifiers on a separator: the "·" travels with what follows it', () => {
      const lodash = (packageVersion: string, state = 'to_verify') =>
        vuln({
          type: 'sca',
          name: 'Command Injection in lodash',
          state,
          path: undefined,
          line: undefined,
          packageName: 'lodash',
          packageVersion,
          advisoryId: 'GHSA-35jh',
          cwe: ['CWE-77', 'CWE-94'],
        });
      const html2 = render(
        report([
          lodash('4.17.11'),
          lodash('4.13.1', 'ignored'),
          lodash('4.17.20', 'ignored'),
          lodash('4.17.21', 'ignored'),
        ]),
      );
      const idLines = [
        ...section(html2, 'findings').matchAll(
          /<div class="adv-ids">[\s\S]*?<\/div>/g,
        ),
        ...section(html2, 'triaged').matchAll(
          /<div class="adv-ids">[\s\S]*?<\/div>/g,
        ),
      ].map((m) => m[0]);
      expect(idLines.length).toBeGreaterThan(2);
      for (const l of idLines) {
        // A break is possible before a separator, never after it.
        expect(l).not.toMatch(/·[ <]/);
      }
      expect(idLines.join('')).toContain(
        '<span class="mono">GHSA-35jh</span> ·\u00a0also under',
      );
      // Nor on a lone version: the last two stay together.
      expect(section(html2, 'findings')).toContain(
        '<span class="mono">4.17.20,</span>\u00a0<span class="mono">4.17.21</span>',
      );
    });

    it('joins two cross-references with a semicolon: a wrapped line never opens on "· ignored for"', () => {
      const lodash = (packageVersion: string, state = 'to_verify') =>
        vuln({
          type: 'sca',
          name: 'Command Injection in lodash',
          state,
          path: undefined,
          line: undefined,
          packageName: 'lodash',
          packageVersion,
          advisoryId: 'GHSA-35jh',
          cwe: ['CWE-77', 'CWE-94'],
        });
      const findings = section(
        render(report([lodash('4.17.11'), lodash('4.13.1', 'ignored')])),
        'findings',
      );
      expect(textOf(findings)).toContain(
        'GHSA-35jh · also under CWE-77; ignored for lodash@4.13.1',
      );
      expect(findings).toContain(
        'also under <span class="mono">CWE-77</span>; <span class="keep">ignored for',
      );
      // The only break before "ignored for" is the space after the ";".
      expect(findings).not.toContain('· <span class="keep">ignored for');
    });

    it('renders code spans of titles as code, never raw backticks', () => {
      const withCode = section(
        render(
          report([
            vuln({
              type: 'sca',
              name: 'lodash Code Injection via `_.template` <b>',
              path: undefined,
              line: undefined,
              packageName: 'lodash',
              packageVersion: '4.17.11',
              advisoryId: 'GHSA-r5fr',
              cwe: ['CWE-94'],
            }),
          ]),
        ),
        'findings',
      );
      expect(withCode).toContain(
        'via <code class="code-inline">_.template</code> &lt;b&gt;',
      );
    });

    const redos = (over: Partial<MappedVulnerability>) =>
      vuln({
        type: 'sca',
        name: 'Regular Expression Denial of Service (ReDoS) in lodash',
        severity: 'medium',
        path: undefined,
        line: undefined,
        packageName: 'lodash',
        cwe: ['CWE-400'],
        ...over,
      });

    it('merges advisories a reader cannot tell apart (same title and severity, same package versions) and names them all', () => {
      const merged = section(
        render(
          report([
            redos({
              advisoryId: 'GHSA-29mw',
              packageVersion: '2.4.2',
              fixedVersion: '4.17.21',
            }),
            redos({
              advisoryId: 'GHSA-29mw',
              packageVersion: '4.17.11',
              fixedVersion: '4.17.21',
            }),
            redos({
              name: 'Regular Expression Denial of Service (ReDoS) in Lodash',
              advisoryId: 'GHSA-x5rq',
              packageVersion: '2.4.2',
              fixedVersion: '4.17.11',
            }),
            redos({
              name: 'Regular Expression Denial of Service (ReDoS) in Lodash',
              advisoryId: 'GHSA-x5rq',
              packageVersion: '4.17.11',
              fixedVersion: '4.17.12',
            }),
          ]),
        ),
        'findings',
      );
      const text = textOf(merged);
      expect(count(text.toLowerCase(), 'redos) in lodash')).toBe(1);
      expect(text).toContain('GHSA-29mw · GHSA-x5rq');
      // Both advisories hit both versions: four findings on two lines.
      expect(text).toContain(
        'Vulnerable dependencies · 4 findings in 2 advisories',
      );
      // One line per package version, with the version that fixes all.
      expect(count(text, 'lodash@2.4.2')).toBe(1);
      expect(text).toMatch(
        /lodash@2\.4\.2.*lodash@4\.17\.11.*4\.17\.21.*4\.17\.21/,
      );
    });

    it('fixes a merged line of a Debian package with its highest fix, its epoch never read as the major version', () => {
      // 8:… read as 8.0.0 made both fixes equal: the first one listed won.
      const magick = (advisoryId: string, fixedVersion: string) =>
        vuln({
          type: 'container',
          name: 'ImageMagick: path traversal in the MSL and SVG coders',
          severity: 'critical',
          path: undefined,
          line: undefined,
          image: 'ubuntu:22.04',
          packageName: 'imagemagick',
          packageVersion: '8:6.9.11.60+dfsg-1.6ubuntu1.3',
          advisoryId,
          cve: advisoryId,
          fixedVersion,
          cwe: ['CWE-22'],
        });
      const LOW = '8:6.9.11.60+dfsg-1.6ubuntu1.4';
      const HIGH = '8:6.9.11.60+dfsg-1.6ubuntu1.10';
      for (const fixes of [
        [LOW, HIGH],
        [HIGH, LOW],
      ]) {
        const text = textOf(
          section(
            render(
              report([
                magick('CVE-2026-25965', fixes[0]),
                magick('CVE-2026-25966', fixes[1]),
              ]),
            ),
            'findings',
          ),
        );
        expect(text).toContain('CVE-2026-25965 · CVE-2026-25966');
        // A long version may break at its separators: read it whole.
        const whole = text.replace(/\s+/g, '');
        expect(whole).toContain(HIGH);
        expect(whole).not.toContain(LOW);
      }
    });

    it('keeps advisories of the same title apart when they touch different package versions, under one title', () => {
      const apart = section(
        render(
          report([
            redos({
              advisoryId: 'GHSA-29mw',
              packageVersion: '2.4.2',
              fixedVersion: '4.17.21',
            }),
            redos({
              advisoryId: 'GHSA-29mw',
              packageVersion: '4.17.11',
              fixedVersion: '4.17.21',
            }),
            redos({
              name: 'Regular Expression Denial of Service (ReDoS) in Lodash',
              advisoryId: 'GHSA-x5rq',
              packageVersion: '2.4.2',
              fixedVersion: '4.17.11',
            }),
          ]),
        ),
        'findings',
      );
      const text = textOf(apart);
      // One row per advisory, each with its own versions: every package line
      // is one finding. The title is said once, over both rows, which never
      // read as a duplicated line.
      expect(count(text.toLowerCase(), 'redos) in lodash')).toBe(1);
      expect(text).not.toContain('GHSA-29mw · GHSA-x5rq');
      expect(text).toMatch(
        /GHSA-29mw lodash@2\.4\.2 lodash@4\.17\.11 4\.17\.21 4\.17\.21 .*GHSA-x5rq lodash@2\.4\.2 4\.17\.11/,
      );
      expect(text).toContain(
        'Vulnerable dependencies · 3 findings in 2 advisories',
      );
      // The rows of one title form a unit, never split by a page break.
      const unit = apart.slice(apart.indexOf('<tbody class="unit">'));
      expect(unit.slice(0, unit.indexOf('</tbody>'))).toMatch(
        /ReDoS\) in lodash[\s\S]*GHSA-29mw[\s\S]*<tr class="same-title">[\s\S]*GHSA-x5rq/,
      );
      // A light dashed rule parts the advisories of the unit from the
      // Advisory column on: the package chips of each never stack into one
      // list, and the severity column stays open under the shared title.
      const css = render(report([vuln()]));
      expect(
        cssRule(css, 'table.advisories tr.same-title td:not(:first-child)'),
      ).toMatch(/border-top: 1px dashed/);
      expect(cssRule(css, 'table.advisories tr.same-title td')).toMatch(
        /padding-top: [5-9]px/,
      );
    });

    it('says a title once over neighbouring advisories that share it, whatever their severity', () => {
      const bson = (advisoryId: string, severity: string) =>
        vuln({
          type: 'sca',
          name: 'Deserialization of Untrusted Data in bson',
          severity,
          path: undefined,
          line: undefined,
          packageName: 'bson',
          packageVersion: '1.0.9',
          fixedVersion: '1.1.4',
          advisoryId,
          cwe: ['CWE-502'],
        });
      const chapter = section(
        render(
          report([bson('GHSA-v8w9', 'critical'), bson('GHSA-4jwp', 'medium')]),
        ),
        'findings',
      );
      const text = textOf(chapter);
      expect(count(text, 'Deserialization of Untrusted Data in bson')).toBe(1);
      // Each advisory keeps its badge, identifier, package and fixed version.
      expect(text).toMatch(
        /Critical Deserialization of Untrusted Data in bson GHSA-v8w9 bson@1\.0\.9 1\.1\.4 Medium GHSA-4jwp bson@1\.0\.9 1\.1\.4/,
      );
      expect(text).toContain(
        'Vulnerable dependencies · 2 findings, one per advisory',
      );
    });

    it('orders the dependency rows of a severity by package, so a package to update reads in one place', () => {
      const dep = (name: string, packageName: string, severity = 'high') =>
        vuln({
          type: 'sca',
          name,
          severity,
          path: undefined,
          line: undefined,
          packageName,
          packageVersion: '1.0.0',
          advisoryId: `GHSA-${name.length}-${packageName}`,
          cwe: ['CWE-400'],
        });
      const text = textOf(
        section(
          render(
            report([
              dep('Denial of Service in qs', 'qs'),
              dep(
                'Inefficient Regular Expression Complexity in marked',
                'marked',
              ),
              dep('Prototype Pollution in lodash', 'lodash'),
              dep('Regular Expression Denial of Service in marked', 'marked'),
              dep('Algorithmic complexity in aaa', 'aaa', 'medium'),
            ]),
          ),
          'findings',
        ),
      );
      const order = [...text.matchAll(/ ([a-z]+)@1\.0\.0/g)].map((m) => m[1]);
      expect(order).toEqual(['lodash', 'marked', 'marked', 'qs', 'aaa']);
    });

    it('adds up to the count of the weakness: occurrences of its code findings plus the findings of its dependency table', () => {
      const iac = (name: string, severity: string, line: string) =>
        vuln({
          type: 'iac',
          name,
          description: `${name}.`,
          severity,
          path: 'NodeGoat/docker-compose.yml',
          line,
          cwe: ['CWE-400'],
        });
      const dep = (
        advisoryId: string,
        packageName: string,
        packageVersion: string,
      ) =>
        redos({
          name: `Denial of Service in ${packageName}`,
          severity: 'high',
          advisoryId,
          packageName,
          packageVersion,
        });
      const chapter = textOf(
        section(
          render(
            report([
              iac('Unrestricted capabilities', 'high', '4-4'),
              iac('Unrestricted capabilities', 'high', '13-13'),
              iac('Missing CPU limits', 'medium', '4-4'),
              iac('Missing CPU limits', 'medium', '13-13'),
              dep('GHSA-q1', 'qs', '0.6.6'),
              dep('GHSA-q2', 'qs', '0.6.6'),
              dep('GHSA-m1', 'marked', '0.3.5'),
              redos({ advisoryId: 'GHSA-29mw', packageVersion: '2.4.2' }),
              redos({ advisoryId: 'GHSA-29mw', packageVersion: '4.17.11' }),
              redos({ advisoryId: 'GHSA-x5rq', packageVersion: '2.4.2' }),
            ]),
          ),
          'findings',
        ),
      );
      const announced = Number(chapter.match(/(\d+) findings/)?.[1]);
      const occurrences = [...chapter.matchAll(/(\d+) occurrences?/g)].map(
        (m) => Number(m[1]),
      );
      const dependencies = Number(
        chapter.match(/Vulnerable dependencies · (\d+) findings? in/)?.[1],
      );
      expect(announced).toBe(10);
      expect(occurrences).toEqual([2, 2]);
      expect(dependencies).toBe(6);
      expect(occurrences[0] + occurrences[1] + dependencies).toBe(announced);
    });

    it('names the dependency findings, one per advisory, when no advisory touches several versions', () => {
      const single = textOf(
        section(
          render(
            report([
              redos({ advisoryId: 'GHSA-a', packageVersion: '2.4.2' }),
              redos({
                name: 'Prototype Pollution in lodash',
                advisoryId: 'GHSA-b',
                packageVersion: '2.4.2',
              }),
            ]),
          ),
          'findings',
        ),
      );
      expect(single).toContain(
        'Vulnerable dependencies · 2 findings, one per advisory',
      );
      const one = textOf(
        section(render(report([redos({ advisoryId: 'GHSA-a' })])), 'findings'),
      );
      expect(one).toContain('Vulnerable dependencies · 1 finding ');
    });

    it('says when an open advisory was ignored for another version, and the other way round', () => {
      const underscore = (over: Partial<MappedVulnerability>) =>
        vuln({
          type: 'sca',
          name: 'Arbitrary Code Execution in underscore',
          severity: 'critical',
          path: undefined,
          line: undefined,
          packageName: 'underscore',
          advisoryId: 'GHSA-cf4h',
          cwe: ['CWE-94'],
          ...over,
        });
      const html2 = render(
        report([
          underscore({ packageVersion: '1.9.1' }),
          underscore({ packageVersion: '1.8.3', state: 'ignored' }),
        ]),
      );
      expect(textOf(section(html2, 'findings'))).toContain(
        'GHSA-cf4h · ignored for underscore@1.8.3',
      );
      expect(textOf(section(html2, 'triaged'))).toContain(
        'still open for underscore@1.9.1',
      );
      expect(textOf(details)).not.toContain('ignored for');
      // A package reference reads like the chips: in the code face, breakable
      // only after a comma, never away from the words that introduce it.
      expect(section(html2, 'findings')).toContain(
        '<span class="keep">ignored for <span class="mono">underscore@1.8.3</span></span>',
      );
      expect(section(html2, 'triaged')).toContain(
        '<span class="keep">still open for <span class="mono">underscore@1.9.1</span></span>',
      );
      const several = render(
        report([
          underscore({ packageVersion: '1.9.1' }),
          underscore({ packageVersion: '1.8.3', state: 'ignored' }),
          underscore({ packageVersion: '1.8.2', state: 'ignored' }),
        ]),
      );
      expect(section(several, 'findings')).toContain(
        '<span class="keep">ignored for <span class="mono">underscore@1.8.2,</span></span>\u00a0<span class="mono">1.8.3</span>',
      );
    });

    it('puts an advisory AI verdict under its title rather than in a mostly empty column', () => {
      const adv = section(
        render(
          report([
            vuln({
              type: 'sca',
              name: 'Arbitrary Code Execution in underscore',
              path: undefined,
              line: undefined,
              packageName: 'underscore',
              packageVersion: '1.9.1',
              advisoryId: 'GHSA-cf4h',
              cwe: ['CWE-94'],
              exploitability: {
                verdict: 'actively_exploited',
                source: 'agent',
                score: 1,
                reason: 'CISA KEV confirms active exploitation.',
              },
            }),
            vuln({
              type: 'sca',
              name: 'Command Injection in lodash',
              path: undefined,
              line: undefined,
              packageName: 'lodash',
              packageVersion: '4.17.11',
              advisoryId: 'GHSA-35jh',
              cwe: ['CWE-94'],
            }),
          ]),
        ),
        'findings',
      );
      const table = adv.slice(adv.indexOf('class="fixed has-cont advisories"'));
      expect(table).not.toContain('>Verdict<');
      expect(table).toMatch(
        /Arbitrary Code Execution in underscore[\s\S]*class="ai-note"[\s\S]*Actively exploited[\s\S]*100%[\s\S]*CISA KEV confirms/,
      );
    });

    it('keeps triaged findings out of the weakness blocks', () => {
      expect(details).not.toContain('Dismissed eval');
    });

    it('keeps a weakness heading and its reference box with the start of its first block', () => {
      expect(cssRule(html, '.cwe-head')).toContain('break-after: avoid');
      const rule = cssRule(html, '.cwe-about');
      expect(rule).toContain('break-inside: avoid');
      // Never a reference box alone at the bottom of a page: the unit it drags
      // along stays small, since the description of a group can flow.
      expect(rule).toContain('break-after: avoid');
      expect(details).toMatch(
        /class="cwe-about"[\s\S]*?<\/div>\s*<\/div>\s*<div class="fgroup">/,
      );
    });

    it('drops descriptions and guidance in the summary (non-detailed) variant', () => {
      const brief = section(render(data, false), 'findings');
      expect(brief).not.toContain('How to prevent');
      expect(brief).not.toContain('runs arbitrary code');
      expect(brief).toContain('Uncontrolled Eval Execution');
    });
  });

  // Identifiers longer than their column: nothing may cross into the next
  // cell nor past the page, and a fixed version keeps facing its package.
  describe('long identifiers', () => {
    // A long image reference: an ImageMagick advisory on a registry image,
    // its Debian versions carrying an epoch.
    const AZURE_IMAGE =
      '0123456789abcdef0123456789abcdef.azurecr.example.test/ml/ml_0123456789abcdef0123456789abcdef:1';
    const DIGEST_IMAGE = `registry.example.com/team/app@sha256:${'c335e56d'.repeat(8)}`;
    const DEEP_MANIFEST =
      'NodeGoat/services/very/deep/monorepo/path/to/some/package/package-lock.json';
    const SCOPED =
      '@very-long-organization-name/extremely-long-package-name-for-testing';
    const container = (over: Partial<MappedVulnerability>) =>
      vuln({
        type: 'container',
        name: 'ImageMagick: path traversal in the MSL and SVG coders',
        severity: 'critical',
        path: undefined,
        line: undefined,
        image: AZURE_IMAGE,
        cve: 'CVE-2026-25965',
        cwe: ['CWE-22'],
        ...over,
      });
    const magick = (packageName: string) =>
      container({
        packageName,
        packageVersion: '8:6.9.11.60+dfsg-1.6ubuntu1.3',
        fixedVersion: '8:6.9.11.60+dfsg-1.6ubuntu1.4',
      });
    const openssl = (packageName: string, cwe = ['CWE-22']) =>
      container({
        name: 'OpenSSL: out-of-bounds write in the PKCS#7 parser',
        severity: 'high',
        image: DIGEST_IMAGE,
        cve: 'CVE-2026-31789',
        packageName,
        packageVersion: '3.0.13-0ubuntu3.4',
        fixedVersion: '3.0.13-0ubuntu3.5',
        cwe,
      });
    const npm = (over: Partial<MappedVulnerability>) =>
      vuln({
        type: 'sca',
        name: 'Arbitrary Code Execution in underscore',
        severity: 'high',
        path: undefined,
        line: undefined,
        packageName: 'underscore',
        packageVersion: '1.9.1',
        fixedVersion: '1.12.1',
        manifest: 'NodeGoat/package-lock.json',
        advisoryId: 'GHSA-cf4h-3jhx-xvhq',
        cwe: ['CWE-94'],
        ...over,
      });
    const html = render(
      report([
        vuln(),
        ...[
          'imagemagick',
          'imagemagick-6-common',
          'libmagickcore-6.q16-6-extra',
        ].map(magick),
        openssl('libssl3t64'),
        openssl('openssl'),
        npm({}),
        npm({
          name: 'Code injection in the template compiler',
          severity: 'critical',
          packageName: SCOPED,
          packageVersion: '3.0.0-alpha.20260915.4f2d9c1e',
          fixedVersion: '3.0.0-beta.20260922.9a8b7c6d',
          manifest: DEEP_MANIFEST,
          advisoryId: 'GHSA-9f3q-7w2m-x4pc',
        }),
      ]),
    );
    const details = section(html, 'findings');

    /** The table of advisories of a weakness, from its head to its end. */
    const table = (source: string, cweId: string, label: string) => {
      const at = source.indexOf(`${cweId} · ${label} (continued)`);
      return at < 0
        ? ''
        : source.slice(
            source.lastIndexOf('<table', at),
            source.indexOf('</table>', at),
          );
    };
    /** Widths of the columns of a table ('' for the flexible one). */
    const widths = (t: string) =>
      Array.from(
        (t.match(/<colgroup>([\s\S]*?)<\/colgroup>/)?.[1] ?? '').matchAll(
          /<col(?: style="width: ([^"]+)")?>/g,
        ),
      ).map((m) => m[1] ?? '');
    /** Printed width of a column in the 688 px text column of a page. */
    const px = (width: string) =>
      width.endsWith('%') ? (parseFloat(width) / 100) * 688 : parseFloat(width);
    /** Characters of a code chip a column holds on one line: 10 px of
     * cell padding a side, 5 px of chip padding a side, 6 px a character. */
    const chipRoom = (width: string) => Math.floor((px(width) - 30) / 6);
    /** The body rows of a table, each as its cells. */
    const rowsOf = (t: string) =>
      t
        .slice(t.indexOf('<tbody'))
        .split(/<tr[^>]*>/)
        .slice(1)
        .map((row) => row.split(/<td[^>]*>/).slice(1));
    /** Heights (in chip lines) of the stacked lines of a cell. */
    const heights = (cell: string) =>
      Array.from(
        cell.matchAll(
          /<div class="line"(?: style="(?:--lines: (\d+))?[^"]*")?>/g,
        ),
      ).map((m) => Number(m[1] ?? 1));

    it('prints a long image reference on a line of its own, cut before its separators, never over the next column', () => {
      const t = table(details, 'CWE-22', 'Vulnerable image packages');
      expect(t).toContain(
        `<div class="adv-ids adv-where">${idText(AZURE_IMAGE)}</div>`,
      );
      expect(t).toContain(
        `<div class="adv-ids adv-where">${idText(DIGEST_IMAGE)}</div>`,
      );
      // Never in the unbreakable code face of the identifiers line.
      expect(t).not.toContain(`<span class="mono">${AZURE_IMAGE}`);
      expect(t).not.toContain(`<span class="mono">${DIGEST_IMAGE}`);
      expect(textOf(t)).toContain(`CVE-2026-25965 ${AZURE_IMAGE}`);
    });

    it('prints a long manifest path the same way, a short one inline with the identifiers', () => {
      const t = table(details, 'CWE-94', 'Vulnerable dependencies');
      expect(t).toContain(
        `<div class="adv-ids adv-where">${idText('services/very/deep/monorepo/path/to/some/package/package-lock.json')}</div>`,
      );
      expect(t).toContain(
        'GHSA-cf4h-3jhx-xvhq</span> · <span class="mono">package-lock.json</span>',
      );
      // Two images: each row names its own.
      const short = section(
        render(
          report([
            container({
              image: 'alpine:3.18',
              packageName: 'zlib',
              packageVersion: '1.2.13-r0',
            }),
            container({
              cve: 'CVE-2026-25966',
              image: 'alpine:3.19',
              packageName: 'zlib',
              packageVersion: '1.3.1-r0',
            }),
          ]),
        ),
        'findings',
      );
      expect(short).toContain(
        'CVE-2026-25965</span> · <span class="mono">alpine:3.18</span>',
      );
      expect(short).not.toContain('adv-where');
    });

    it('names once the image every open image finding comes from, as the manifest of the dependencies', () => {
      const doc = render(
        report([
          vuln(),
          magick('imagemagick'),
          { ...magick('imagemagick-6-common'), cve: 'CVE-2026-25966' },
          { ...magick('libmagickcore-dev'), state: 'ignored' },
        ]),
      );
      const findings = section(doc, 'findings');
      expect(findings).toContain(
        `Container findings come from the image ${idText(AZURE_IMAGE, { after: '.' })}`,
      );
      // Never again on a row, nor in the triaged list.
      expect(findings).not.toContain('adv-where');
      expect(count(doc, 'azurecr')).toBe(1);
    });

    it('names an advisory once when its title is its identifier', () => {
      const titled = table(
        section(
          render(
            report([
              { ...openssl('openssl', ['CWE-787']), name: 'CVE-2026-31789' },
              {
                ...magick('imagemagick'),
                name: 'CVE-2026-25965',
                cwe: ['CWE-787'],
              },
            ]),
          ),
          'findings',
        ),
        'CWE-787',
        'Vulnerable image packages',
      );
      expect(titled).toContain('<div class="adv-title">CVE-2026-31789</div>');
      expect(textOf(titled)).not.toContain('CVE-2026-31789 CVE-2026-31789');
      expect(count(titled, 'CVE-2026-31789')).toBe(1);
      expect(count(titled, 'CVE-2026-25965')).toBe(1);
    });

    it('holds every short fixed version whole in a dashboard preview narrower than the PDF, Fixed in never narrower than its chips', () => {
      // At a window of 760px and below, 12% of the narrower text column gave
      // « 4.17.21 » less than its chip and the padding of its cell: a short
      // version never breaks, and it passed its cell. Fixed in keeps its
      // share while it holds its widest chip; below the window where it no
      // longer does (its scrollbar included), it takes the pixels of the
      // chip, those of the PDF at most.
      const lodash = npm({
        name: 'Prototype pollution in lodash',
        packageName: 'lodash',
        packageVersion: '4.17.11',
        fixedVersion: '4.17.21',
      });
      const doc = render(report([lodash]), true, false);
      const t = table(
        section(doc, 'findings'),
        'CWE-94',
        'Vulnerable dependencies',
      );
      expect(widths(t)).toEqual(['84px', '', '26%', 'var(--adv-fixed, 12%)']);
      // Seven characters (42px), the padding of the chip (10px) and of the
      // cell (20px), and a margin (4px): 76px, 12% of a text column of
      // 633px, that of a window of 883px.
      expect(section(doc, 'findings')).toContain(
        '<div class="adv-block fix-below-883" style="--adv-fixed-narrow: 76px">',
      );
      expect(doc).toContain(
        '@media screen and (max-width: 883px) { .fix-below-883 { --adv-fixed: var(--adv-fixed-narrow); } }',
      );
      // « 3.0.13-0ubuntu3.5 »: the 136px the PDF gives it (19.8%), from a
      // window of 943px down.
      const ubuntu = render(
        report([
          openssl('libssl3t64', ['CWE-787']),
          openssl('openssl', ['CWE-787']),
        ]),
        true,
        false,
      );
      expect(section(ubuntu, 'findings')).toContain(
        '<div class="adv-block fix-below-943" style="--adv-fixed-narrow: 136px">',
      );
      expect(ubuntu).toContain(
        '@media screen and (max-width: 943px) { .fix-below-943 { --adv-fixed: var(--adv-fixed-narrow); } }',
      );
      // A long version (« 8:6.9.11.60+dfsg-1.6ubuntu1.4 ») breaks between its
      // parts: Fixed in keeps its share. Held in pixels (208px), it left the
      // Advisory column 42px at a window of 700px (« CVE / -20 / 26- »).
      const magickDoc = render(report([magick('imagemagick')]), true, false);
      expect(section(magickDoc, 'findings')).toContain(
        '<div class="adv-block">',
      );
      expect(magickDoc).not.toContain('fix-below');
      // The PDF keeps its widths and its markup.
      const pdf = render(report([lodash]));
      expect(
        widths(
          table(section(pdf, 'findings'), 'CWE-94', 'Vulnerable dependencies'),
        ),
      ).toEqual(['84px', '', '26%', '12%']);
      expect(pdf).not.toContain('--adv-fixed');
      expect(pdf).not.toContain('fix-below');
    });

    it('keeps the columns of a table of short chips as they were', () => {
      const t = table(
        section(render(report([npm({})])), 'findings'),
        'CWE-94',
        'Vulnerable dependencies',
      );
      expect(widths(t)).toEqual(['84px', '', '26%', '12%']);
      expect(t).not.toContain('--lines');
    });

    it('widens Package and Fixed in to hold their chips on one line while the Advisory column keeps its share', () => {
      const t = table(
        section(
          render(
            report([
              openssl('libssl3t64', ['CWE-787']),
              openssl('openssl', ['CWE-787']),
            ]),
          ),
          'findings',
        ),
        'CWE-787',
        'Vulnerable image packages',
      );
      const [severity, advisory, pkg, fixed] = widths(t);
      expect([severity, advisory]).toEqual(['84px', '']);
      // libssl3t64@3.0.13-0ubuntu3.4 and 3.0.13-0ubuntu3.5.
      expect(chipRoom(pkg)).toBeGreaterThanOrEqual(28);
      expect(chipRoom(fixed)).toBeGreaterThanOrEqual(17);
      expect(688 - 84 - px(pkg) - px(fixed)).toBeGreaterThanOrEqual(0.36 * 688);
      expect(t).not.toContain('--lines');
      expect(t).toContain(codeChip('3.0.13-0ubuntu3.5'));
    });

    it('holds a Debian version whole in Package and in Fixed in, one chip each, the Advisory column giving way while the table holds, and keeps every fixed version facing its package', () => {
      const t = table(details, 'CWE-22', 'Vulnerable image packages');
      const [, , pkg, fixed] = widths(t);
      // A version is atomic: its column widens to hold it whole, never cut
      // in its revision (« …dfsg-1 | .6ubuntu1.4 » read as an older fix)
      // nor between two digits.
      expect(chipRoom(pkg)).toBeGreaterThanOrEqual(
        '@8:6.9.11.60+dfsg-1.6ubuntu1.3'.length,
      );
      expect(chipRoom(fixed)).toBeGreaterThanOrEqual(
        '8:6.9.11.60+dfsg-1.6ubuntu1.4'.length,
      );
      // The table still holds: the Advisory column keeps a line for an
      // identifier of 24 characters.
      expect(688 - 84 - px(pkg) - px(fixed)).toBeGreaterThanOrEqual(
        24 * 6 + 24,
      );
      // One chip, never a pill per line that would read as two versions.
      expect(t).toContain(versionChip('8:6.9.11.60+dfsg-1.6ubuntu1.4'));
      expect(t).not.toContain('code-chip is-long');
      const [magickRow, opensslRow] = rowsOf(t);
      // Package and Fixed in lines of a row share their heights: two chip
      // lines each for ImageMagick, one for OpenSSL.
      expect(heights(magickRow[2])).toEqual([2, 2, 2]);
      expect(heights(magickRow[3])).toEqual(heights(magickRow[2]));
      expect(heights(opensslRow[2])).toEqual([1, 1]);
      expect(heights(opensslRow[3])).toEqual([1, 1]);
      expect(cssRule(html, 'table.advisories .line')).toContain(
        'min-height: calc(17px * var(--lines, 1))',
      );
    });

    it('keeps every fixed version facing its package in a dashboard preview narrower than the PDF', () => {
      // At 850 px (scroll bar included), the preview's columns are 12%
      // narrower than the PDF's: « @8:6.9.11.60+dfsg-1.6ubuntu1.3 » takes a
      // third line in Package (a fourth under « libmagickcore-6.q16-6-extra »),
      // Fixed in keeps two. Both columns take the taller height there.
      const narrowHeights = (cell: string) =>
        Array.from(
          cell.matchAll(
            /<div class="line"(?: style="(?:--lines: (\d+))?(?:; )?(?:--lines-narrow: (\d+))?")?>/g,
          ),
        ).map((m) => Number(m[2] ?? m[1] ?? 1));
      const t = table(details, 'CWE-22', 'Vulnerable image packages');
      const [magickRow, opensslRow] = rowsOf(t);
      expect(heights(magickRow[2])).toEqual([2, 2, 2]);
      expect(narrowHeights(magickRow[2])).toEqual([3, 3, 4]);
      expect(narrowHeights(magickRow[3])).toEqual([3, 3, 4]);
      // « libssl3t64@3.0.13-0ubuntu3.4 » (28 characters) wraps there too.
      expect(narrowHeights(opensslRow[2])).toEqual([2, 1]);
      expect(narrowHeights(opensslRow[3])).toEqual([2, 1]);
      expect(html).toMatch(
        /@media screen and \(max-width: 950px\) \{ table\.advisories \.line \{ min-height: calc\(17px \* var\(--lines-narrow, var\(--lines, 1\)\)\); \} \}/,
      );
      // A table that wraps the same way keeps its markup and its style sheet.
      const plain = render(report([npm({})]));
      expect(plain).not.toContain('--lines-narrow');
    });

    it('cuts a Debian version only between its parts when the table cannot hold it whole, never in its revision', () => {
      // A State column (two open states): Package and Fixed in cannot both
      // hold their versions whole, nor Fixed in beside the unbreakable name
      // « imagemagick-6-common ».
      const t = table(
        section(
          render(
            report([
              vuln(),
              ...['imagemagick', 'imagemagick-6-common'].map(magick),
              { ...magick('libmagickcore-dev'), state: 'confirmed' },
            ]),
          ),
          'findings',
        ),
        'CWE-22',
        'Vulnerable image packages',
      );
      const [, , pkg, fixed, state] = widths(t);
      expect(state).toBeTruthy();
      expect(chipRoom(pkg)).toBeGreaterThanOrEqual(
        '@8:6.9.11.60+dfsg-1.6ubuntu1.3'.length,
      );
      // Fixed in: cut once, before its revision (« 8:6.9.11.60+dfsg » |
      // « -1.6ubuntu1.4 »).
      expect(chipRoom(fixed)).toBeGreaterThanOrEqual('8:6.9.11.60+dfsg'.length);
      expect(688 - 84 - px(pkg) - px(fixed) - px(state)).toBeGreaterThanOrEqual(
        24 * 6 + 24,
      );
      expect(t).toContain(versionChip('8:6.9.11.60+dfsg-1.6ubuntu1.4'));
      expect(t).toContain(
        packageChip('imagemagick', '8:6.9.11.60+dfsg-1.6ubuntu1.3'),
      );
    });

    it('sizes the Package column of the triaged list to hold a version whole', () => {
      const VERSION = '1:9.18.28-0ubuntu0.22.04.1+esm1';
      const triaged = section(
        render(
          report([
            vuln(),
            container({
              packageName: 'libbind9-161',
              packageVersion: VERSION,
              state: 'ignored',
            }),
          ]),
        ),
        'triaged',
      );
      const [, , pkg] = widths(triaged.slice(triaged.indexOf('triage-label')));
      expect(chipRoom(pkg)).toBeGreaterThanOrEqual(`@${VERSION}`.length);
    });

    it('never cuts a version inside its revision in a sentence or a line of identifiers', () => {
      const doc = render(
        report([
          vuln(),
          magick('imagemagick'),
          { ...magick('libmagickcore-dev'), state: 'ignored' },
          {
            ...magick('libmagickwand-6.q16-6'),
            cve: 'CVE-2026-25966',
            exploitability: {
              verdict: 'proven',
              source: 'agent',
              score: 0.9,
              reason: 'The MSL coder is reachable from the upload route.',
            },
          },
        ]),
      );
      // « ignored for libmagickcore-dev@8:6.9.11.60+dfsg-1.6ubuntu1.3 »: the
      // name whole, the version cut only before « +dfsg » and its revision.
      expect(section(doc, 'findings')).toContain(
        `<span class="mono is-long">${piecesHtml([
          'libmagickcore-dev',
          '@8:6.9.11.60',
          '+dfsg',
          '-1.6ubuntu1.3',
        ])}</span>`,
      );
      // The key fact that names the exploited package, likewise.
      expect(section(doc, 'summary')).toContain(
        `<span class="mono is-long">${piecesHtml([
          'libmagickwand-6.q16-6',
          '@8:6.9.11.60',
          '+dfsg',
          '-1.6ubuntu1.3',
        ])}</span>`,
      );
      expect(doc).not.toContain('<wbr>.6ubuntu');
      expect(doc).not.toMatch(/-1<\/nobr><wbr>/);
    });

    it('lists the versions of a package in version order, an epoch compared first and a pre-release before its release', () => {
      const findings = textOf(
        section(
          render(
            report([
              vuln(),
              magick('imagemagick'),
              ...['8:6.9.11.60+dfsg-1.6ubuntu1.2', '9.0.0-1'].map(
                (packageVersion) => ({
                  ...magick('imagemagick'),
                  packageVersion,
                  state: 'ignored',
                }),
              ),
            ]),
          ),
          'findings',
        ),
      );
      // Epoch 8 wins over a version without one, whatever its number.
      expect(findings).toContain(
        'ignored for imagemagick@9.0.0-1, 8:6.9.11.60+dfsg-1.6ubuntu1.2',
      );
      const npmFindings = textOf(
        section(
          render(
            report([
              npm({}),
              ...['1.9.0', '1.9.0-rc.1', '1.10.0'].map((packageVersion) =>
                npm({ packageVersion, state: 'ignored' }),
              ),
            ]),
          ),
          'findings',
        ),
      );
      expect(npmFindings).toContain(
        'ignored for underscore@1.9.0-rc.1, 1.9.0, 1.10.0',
      );
    });

    it('sizes a State column to its longest label, never letting a state run into the next column', () => {
      // Label widths measured in the PDF (Rubik 11 px, dot and gap
      // included): Proposed not exploitable 138.2 px, Not exploitable 87.8.
      const doc = render(
        report([
          vuln({ state: 'proposed_not_exploitable' }),
          vuln({ line: '40-40' }),
          npm({ state: 'proposed_not_exploitable' }),
          npm({ advisoryId: 'GHSA-2', packageName: 'lodash' }),
          vuln({
            name: 'Dismissed eval',
            severity: 'critical',
            state: 'not_exploitable',
          }),
          vuln({ name: 'Other eval', severity: 'critical', state: 'ignored' }),
        ]),
      );
      const findings = section(doc, 'findings');
      const occurrences = findings.slice(
        findings.indexOf('<table'),
        findings.indexOf('</table>'),
      );
      expect(px(widths(occurrences)[1])).toBeGreaterThanOrEqual(138.2 + 20);
      const [, , , , advisoryState] = widths(
        table(findings, 'CWE-94', 'Vulnerable dependencies'),
      );
      expect(px(advisoryState)).toBeGreaterThanOrEqual(138.2 + 20);
      const triaged = section(doc, 'triaged');
      const list = triaged.slice(triaged.indexOf('triage-label'));
      expect(px(widths(list)[3])).toBeGreaterThanOrEqual(87.8 + 20);
      // Short labels keep the columns as they were.
      const plain = section(render(report([vuln(), npm({})])), 'findings');
      expect(widths(plain.slice(plain.indexOf('<table')))).toEqual(['', '14%']);
    });

    it('keeps a long package reference of a sentence breakable before its separators', () => {
      const findings = section(
        render(
          report([
            npm({
              packageName: SCOPED,
              packageVersion: '3.0.0-alpha.20260915.4f2d9c1e',
            }),
            npm({
              packageName: SCOPED,
              packageVersion: '2.9.14-next.20260801.0b1c2d3e',
              state: 'ignored',
            }),
          ]),
        ),
        'findings',
      );
      // The name cut before its separators, the version only between its
      // parts (atomic).
      expect(findings).toContain(
        `<span class="mono is-long">${piecesHtml([
          ...idPieces(SCOPED),
          '@2.9.14',
          '-next.20260801.0b1c2d3e',
        ])}</span>`,
      );
      expect(cssRule(html, '.adv-ids .mono.is-long')).toContain(
        'white-space: normal',
      );
    });

    it('lets a long package named in a key fact or an analysis note break before its separators', () => {
      const exploited = (packageVersion: string) =>
        npm({
          packageName: SCOPED,
          packageVersion,
          exploitability: {
            verdict: 'proven',
            source: 'agent',
            score: 0.9,
            reason: 'Reachable from the template route.',
          },
        });
      const doc = render(
        report([
          exploited('3.0.0-alpha.20260915.4f2d9c1e'),
          exploited('3.0.0-alpha.20260916.5a3e0d2f'),
        ]),
      );
      const ref = piecesHtml([
        ...idPieces(SCOPED),
        '@3.0.0',
        '-alpha.20260915.4f2d9c1e',
      ]);
      expect(section(doc, 'summary')).toContain(
        `<span class="mono is-long">${ref}</span>`,
      );
      expect(cssRule(doc, '.key-facts .mono.is-long')).toContain(
        'white-space: normal',
      );
      // Two packages under one advisory: each note names its own.
      expect(section(doc, 'findings')).toContain(
        `<span class="ai-pkg">${ref}</span>`,
      );
    });

    it('lets the image of a triaged package break before its separators', () => {
      // Two open images: each row names its own.
      const triaged = section(
        render(
          report([
            vuln(),
            magick('imagemagick'),
            openssl('openssl'),
            { ...magick('libmagickcore-dev'), state: 'ignored' },
          ]),
        ),
        'triaged',
      );
      expect(triaged).toContain(
        `<div class="also-open">in ${breakableId(AZURE_IMAGE)}</div>`,
      );
    });

    /** Lines of a version cut between its parts in `room` characters (the
     * last resort: anywhere). */
    const versionLines = (version: string, room: number) => {
      let lines = 1;
      let used = 0;
      for (const piece of versionPieces(version)) {
        if (used > 0 && used + piece.length > room) {
          lines += 1;
          used = 0;
        }
        used += piece.length;
        while (used > room) {
          lines += 1;
          used -= room;
        }
      }
      return lines;
    };

    it('widens Fixed in into the room its row leaves, so a long fixed version breaks into fewer lines', () => {
      // The package sets the height of its row: a wider Fixed in costs
      // nothing, a narrow one cut the version into six lines.
      const LONG_FIX =
        '3.0.0-beta.20260922.9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b';
      const t = table(
        section(
          render(
            report([
              npm({
                name: 'Code injection in the template compiler',
                severity: 'critical',
                packageName: SCOPED,
                packageVersion:
                  '3.0.0-alpha.20260915.4f2d9c1e8b7a6d5c4b3a2f1e0d9c8b7a6f5e4d3c',
                fixedVersion: LONG_FIX,
              }),
            ]),
          ),
          'findings',
        ),
        'CWE-94',
        'Vulnerable dependencies',
      );
      const [, , pkg, fixed] = widths(t);
      expect(versionLines(LONG_FIX, chipRoom(fixed))).toBeLessThanOrEqual(4);
      expect(t).toContain(versionChip(LONG_FIX));
      expect(688 - 84 - px(pkg) - px(fixed)).toBeGreaterThanOrEqual(0.36 * 688);
      // The same when a long title sets the height of the row: its four
      // lines leave room for a wider Fixed in (seen at six lines on p. 9).
      const titled = table(
        section(
          render(
            report([
              npm({
                name: `Code injection in the template compiler of ${SCOPED} through unsanitised partial names`,
                severity: 'critical',
                packageName: SCOPED,
                packageVersion:
                  '3.0.0-alpha.20260915.4f2d9c1e8b7a6d5c4b3a2f1e0d9c8b7a6f5e4d3c',
                fixedVersion: LONG_FIX,
                manifest: DEEP_MANIFEST,
                cve: 'CVE-2026-41877',
              }),
              npm({}),
            ]),
          ),
          'findings',
        ),
        'CWE-94',
        'Vulnerable dependencies',
      );
      const [, , , titledFixed] = widths(titled);
      expect(versionLines(LONG_FIX, chipRoom(titledFixed))).toBeLessThanOrEqual(
        4,
      );
    });

    it('widens Fixed in as far as the other rows of the table keep their height', () => {
      // The table of the stress report: widening Fixed in to 17% keeps every
      // row as it is (measured in Chromium); to 20%, the identifiers line of
      // « Command Injection in lodash » takes a third line.
      const LONG_FIX =
        '3.0.0-beta.20260922.9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b';
      const lodash = (over: Partial<MappedVulnerability>) =>
        npm({
          name: 'Command Injection in lodash',
          packageName: 'lodash',
          advisoryId: 'GHSA-35jh-r3h4-6jhm',
          fixedVersion: '4.17.21',
          devDependency: true,
          cwe: ['CWE-94', 'CWE-77'],
          ...over,
        });
      const template = (over: Partial<MappedVulnerability>) =>
        npm({
          name: 'lodash vulnerable to Code Injection via `_.template` imports key names',
          packageName: 'lodash',
          packageVersion: '4.17.11',
          advisoryId: 'GHSA-r5fr-rjxr-66jc',
          fixedVersion: '4.18.0',
          devDependency: true,
          ...over,
        });
      const t = table(
        section(
          render(
            report([
              npm({
                name: `Code injection in the template compiler of ${SCOPED} through unsanitised partial names`,
                severity: 'critical',
                packageName: SCOPED,
                packageVersion:
                  '3.0.0-alpha.20260915.4f2d9c1e8b7a6d5c4b3a2f1e0d9c8b7a6f5e4d3c',
                fixedVersion: LONG_FIX,
                manifest: DEEP_MANIFEST,
                advisoryId: 'GHSA-9f3q-7w2m-x4pc',
                cve: 'CVE-2026-41877',
              }),
              npm({ severity: 'critical' }),
              npm({
                severity: 'critical',
                packageVersion: '1.8.3',
                state: 'ignored',
              }),
              lodash({ packageVersion: '2.4.2' }),
              lodash({ packageVersion: '4.17.11' }),
              lodash({ packageVersion: '4.13.1', state: 'ignored' }),
              lodash({ packageVersion: '4.17.20', state: 'ignored' }),
              template({}),
              ...['4.13.1', '4.17.20', '4.17.21'].map((packageVersion) =>
                template({ packageVersion, state: 'ignored' }),
              ),
            ]),
          ),
          'findings',
        ),
        'CWE-94',
        'Vulnerable dependencies',
      );
      const [, , , fixed] = widths(t);
      expect(versionLines(LONG_FIX, chipRoom(fixed))).toBeLessThanOrEqual(5);
      expect(px(fixed)).toBeLessThan(0.198 * 688);
    });

    it('breaks a long identifier of a title before its separators, never after a hyphen', () => {
      const LONG_TITLE = `Code injection in the template compiler of ${SCOPED} through unsanitised partial names`;
      const METHOD =
        'resolveSettlementReconciliationExportFileForMerchantBatchWithRetryPolicy';
      const doc = render(
        report([
          npm({ name: LONG_TITLE, packageName: SCOPED }),
          npm({ advisoryId: 'GHSA-2', packageName: 'lodash' }),
          vuln({ name: `Path traversal in \`${METHOD}\``, cwe: ['CWE-22'] }),
        ]),
      );
      const findings = section(doc, 'findings');
      expect(findings).toContain(
        `<div class="adv-title">Code injection in the template compiler of ${breakableId(SCOPED)} through unsanitised partial names</div>`,
      );
      expect(findings).toContain(
        `<span class="fgroup-title">Path traversal in <code class="code-inline">${breakableId(METHOD)}</code></span>`,
      );
      // Short titles keep their markup.
      expect(findings).toContain(
        '<div class="adv-title">Arbitrary Code Execution in underscore</div>',
      );
    });

    it('keeps the full stop of a convention with the long path it follows', () => {
      const findings = section(
        render(
          report([
            npm({ manifest: `NodeGoat/${DEEP_MANIFEST.slice(9)}` }),
            npm({ advisoryId: 'GHSA-2', manifest: DEEP_MANIFEST }),
          ]),
        ),
        'findings',
      );
      expect(findings).toContain(
        `Dependency findings come from ${pathText(DEEP_MANIFEST.slice(9), { keep: true, after: '.' })}`,
      );
    });

    it('lets a long code span of a description break inside its box', () => {
      expect(cssRule(html, '.fgroup-desc .id-box > code')).toContain(
        'white-space: normal',
      );
      expect(html).toMatch(
        /\.cwe-about \.id-box > code[^{]*\{[^}]*white-space: normal/,
      );
    });

    it('lets a long advisory identifier break before its separators, in a table and in the triaged list', () => {
      const LONG_ID = 'ROOT-OS-UBUNTU-2204-CVE-2026-25965-IMAGEMAGICK';
      const doc = render(
        report([
          vuln(),
          npm({ advisoryId: LONG_ID }),
          npm({
            advisoryId: LONG_ID,
            packageVersion: '1.8.3',
            state: 'ignored',
            severity: 'critical',
          }),
        ]),
      );
      const ref = `<span class="mono is-long">${breakableId(LONG_ID)}`;
      expect(section(doc, 'findings')).toContain(ref);
      expect(section(doc, 'triaged')).toContain(ref);
      expect(doc).not.toContain(`<span class="mono">${LONG_ID}`);
      // Also in the note that names the withdrawn advisories it leaves out.
      expect(doc).toMatch(
        /\.table-note \.mono\.is-long[^{]*\{[^}]*white-space: normal/,
      );
    });

    it('keeps the line number with a long file name, never alone on the next line', () => {
      const findings = section(
        render(
          report([
            vuln({
              path: 'NodeGoat/app/routes/express-check-csurf-middleware-usage.js',
              line: '15-15',
            }),
          ]),
        ),
        'findings',
      );
      expect(findings).toContain(
        pathText('app/routes/express-check-csurf-middleware-usage.js', {
          after: ':15',
        }),
      );
    });
  });

  describe('triaged findings', () => {
    const html = render(
      report([
        vuln(),
        vuln({ name: 'Dismissed eval', state: 'ignored', line: '1-1' }),
        vuln({ name: 'Dismissed eval', state: 'ignored', line: '2-2' }),
        vuln({ name: 'Fixed one', state: 'resolved', severity: 'low' }),
        vuln({ name: 'Minor one', state: 'ignored', severity: 'medium' }),
      ]),
    );
    const triaged = section(html, 'triaged');
    const list = triaged.slice(
      triaged.indexOf('class="fixed has-cont triaged"'),
    );

    it('groups identical triaged findings on one row', () => {
      expect(count(list, 'Dismissed eval')).toBe(1);
      expect(textOf(list)).toMatch(/:1 .*:2 /);
    });

    it('counts them in a small state x severity table, with totals', () => {
      const counts = textOf(
        triaged.slice(
          triaged.indexOf('triage-counts'),
          triaged.indexOf('has-cont triaged'),
        ),
      );
      expect(counts).toContain('State Critical High Medium Low Total');
      expect(counts).toContain('Ignored 0 2 1 0 3');
      expect(counts).toContain('Resolved 0 0 0 1 1');
      expect(counts).toContain('Total 0 2 1 1 4');
    });

    it('lists only the critical and high ones and says what is left out', () => {
      expect(triaged).toContain('Triaged findings');
      expect(textOf(list)).toContain('Dismissed eval');
      expect(list).not.toContain('Fixed one');
      expect(list).not.toContain('Minor one');
      expect(textOf(triaged)).toContain(
        '2 lower-severity triaged findings are not listed.',
      );
      expect(triaged).not.toContain('runs arbitrary code');
    });

    it('drops the State column when every listed row shares one state, and says it in the label', () => {
      expect(list).not.toContain('>State<');
      expect(textOf(triaged)).toContain(
        'Critical and high triaged findings · all ignored',
      );
      const mixed = section(
        render(
          report([
            vuln(),
            vuln({ name: 'Dismissed eval', state: 'ignored' }),
            vuln({ name: 'Fixed eval', state: 'resolved' }),
          ]),
        ),
        'triaged',
      );
      const mixedList = mixed.slice(mixed.indexOf('has-cont triaged'));
      expect(mixedList.slice(0, mixedList.indexOf('</thead>'))).toContain(
        '>State<',
      );
      expect(textOf(mixedList)).toContain('Resolved');
      expect(textOf(mixed)).not.toContain('· all ');
    });

    it('announces the exclusion in the section aside and the intro, in the words of the findings aside', () => {
      expect(textOf(triaged)).toContain('4 triaged, excluded from all figures');
      expect(textOf(triaged)).toContain(
        'Top 25 findings that were ignored, resolved or judged not exploitable. They are excluded from every figure of this report.',
      );
      // They are counted in the overview and here: never "counted nowhere".
      expect(textOf(triaged)).not.toContain('counted nowhere');
    });

    it('lines its continuation label up with the recall of a weakness, at the page edge', () => {
      const rules = [
        ...html.matchAll(/table\.has-cont \.cont-row th \{([^}]*)\}/g),
      ].map((m) => m[1]);
      // The report's rule comes after the shared one, which pads the label
      // like a table cell (10px off the edge where ".cwe-cont" starts).
      expect(rules.length).toBeGreaterThan(1);
      expect(rules[rules.length - 1]).toContain('padding: 0 0 3px');
    });

    it('repeats its label when the list continues on the next page', () => {
      expect(textOf(list)).toContain(
        'Critical and high triaged findings (continued)',
      );
    });

    const adv = (over: Partial<MappedVulnerability>) =>
      vuln({
        type: 'sca',
        state: 'ignored',
        path: undefined,
        line: undefined,
        packageName: 'tar',
        packageVersion: '4.4.8',
        cwe: ['CWE-22'],
        ...over,
      });

    it('gives a package one row: its advisory, its versions and its weaknesses', () => {
      const t = section(
        render(
          report([
            vuln(),
            adv({
              name: 'Command Injection in lodash',
              packageName: 'lodash',
              packageVersion: '4.13.1',
              advisoryId: 'GHSA-35jh',
              cwe: ['CWE-77', 'CWE-94'],
            }),
            adv({
              name: 'Command Injection in lodash',
              packageName: 'lodash',
              packageVersion: '4.17.20',
              advisoryId: 'GHSA-35jh',
              cwe: ['CWE-77', 'CWE-94'],
            }),
          ]),
        ),
        'triaged',
      );
      // Identifiers under the title, as in the open advisory tables; the
      // weaknesses in Top 25 rank order.
      expect(textOf(t)).toContain(
        'Command Injection in lodash GHSA-35jh · CWE-94, CWE-77',
      );
      expect(t).not.toContain('>CWE<');
      expect(count(textOf(t), 'Command Injection in lodash')).toBe(1);
      // One chip per package version, as in the weakness tables.
      expect(t).toContain(packageChip('lodash', '4.13.1'));
      expect(t).toContain(packageChip('lodash', '4.17.20'));
      expect(textOf(t)).toContain('lodash@4.13.1 lodash@4.17.20');
      // Dependencies only: the column holds packages, one chip per line, and
      // leaves the identifiers the room of the Finding column.
      expect(t).toContain('>Package<');
      expect(t).not.toContain('>Location<');
      expect(t).toMatch(/<colgroup><col[^>]*><col><col style="width: 28%">/);
    });

    it('counts the findings of a package that has several advisories, by severity, and names the advisories', () => {
      const t = section(
        render(
          report([
            vuln(),
            adv({
              name: 'Remote code execution in handlebars',
              severity: 'critical',
              packageName: 'handlebars',
              packageVersion: '4.0.5',
              advisoryId: 'GHSA-f2jv',
              cwe: ['CWE-94'],
            }),
            adv({
              name: 'Prototype Pollution in handlebars',
              packageName: 'handlebars',
              packageVersion: '4.0.5',
              advisoryId: 'GHSA-q42p',
              cwe: ['CWE-94'],
            }),
            adv({
              name: 'Regular Expression Denial of Service in Handlebars',
              packageName: 'handlebars',
              packageVersion: '4.0.5',
              advisoryId: 'GHSA-62gr',
              withdrawn: true,
              cwe: ['CWE-400'],
            }),
          ]),
        ),
        'triaged',
      );
      // Same unit as the counts table above: findings, one per advisory and
      // package version.
      expect(textOf(t)).toContain(
        '3 findings, one per advisory: 1 critical, 2 high; 1 withdrawn',
      );
      // A few advisories: every one is traceable, the critical ones first,
      // each on its own line and named by its title (an identifier alone does
      // not qualify it), the withdrawn one flagged where it is named.
      expect(textOf(t)).toContain(
        'critical: Remote code execution in handlebars (GHSA-f2jv) high: Regular Expression Denial of Service in Handlebars (GHSA-62gr) withdrawn high: Prototype Pollution in handlebars (GHSA-q42p) CWE-94, CWE-400',
      );
      // The weaknesses of the row stand on a line of their own: after the
      // last advisory, they would read as its weaknesses alone.
      const lines = [
        ...t.matchAll(/<div class="adv-ids[^"]*">[\s\S]*?<\/div>/g),
      ];
      expect(lines.length).toBe(4);
      expect(lines[3][0]).not.toContain('GHSA');
      // A severity word never ends a line away from the title it introduces,
      // nor an identifier away from the title it follows.
      expect(t).toContain(
        'critical:\u00a0<span class="adv-name">Remote code execution in handlebars</span>\u00a0(<span class="mono">GHSA-f2jv</span>)',
      );
      // The title of an advisory reads a step darker than the ids.
      expect(cssRule(render(report([vuln()])), '.adv-name')).toContain(
        'color:',
      );
      expect(cssRule(render(report([vuln()])), '.keep')).toContain(
        'white-space: nowrap',
      );
      const same = (n: number) =>
        textOf(
          section(
            render(
              report([
                vuln(),
                ...Array.from({ length: n }, (_x, i) =>
                  adv({ name: `Path traversal ${i}`, advisoryId: `GHSA-${i}` }),
                ),
              ]),
            ),
            'triaged',
          ),
        );
      // One severity: no severity word before the titles.
      expect(same(2)).toContain(
        '2 findings, one per advisory, both high Path traversal 0 (GHSA-0) Path traversal 1 (GHSA-1) CWE-22',
      );
      expect(same(3)).toContain('3 findings, one per advisory, all high');
    });

    it('counts findings, not advisories, when an advisory touches several versions', () => {
      const t = textOf(
        section(
          render(
            report([
              vuln(),
              ...['2.2.1', '4.4.8'].flatMap((packageVersion) => [
                adv({
                  name: 'Hardlink overwrite',
                  advisoryId: 'GHSA-h',
                  packageVersion,
                }),
                adv({
                  name: 'Symlink traversal',
                  advisoryId: 'GHSA-s',
                  packageVersion,
                }),
              ]),
              adv({ name: 'Drive-relative path', advisoryId: 'GHSA-d' }),
              ...['4.13.1', '4.17.20'].map((packageVersion) =>
                adv({
                  name: 'Command Injection in lodash',
                  packageName: 'lodash',
                  advisoryId: 'GHSA-35jh',
                  packageVersion,
                }),
              ),
              adv({
                name: 'Prototype Pollution in lodash',
                severity: 'critical',
                packageName: 'lodash',
                advisoryId: 'GHSA-jf85',
                packageVersion: '4.13.1',
              }),
            ]),
          ),
          'triaged',
        ),
      );
      expect(t).toContain(
        '5 findings in 3 advisories, all high Hardlink overwrite (GHSA-h) Symlink traversal (GHSA-s) Drive-relative path (GHSA-d)',
      );
      expect(t).toContain(
        '3 findings in 2 advisories: 1 critical, 2 high critical: Prototype Pollution in lodash (GHSA-jf85) high: Command Injection in lodash (GHSA-35jh)',
      );
      // The rows add up to the critical and high columns of the counts table.
      expect(t).toContain('Ignored 1 7 0 0 8');
    });

    it('lists every advisory of a package, the high ones by identifier when there are many, never capped', () => {
      const manyHtml = (critical: number, high: number) =>
        section(
          render(
            report([
              vuln(),
              ...Array.from({ length: critical + high }, (_x, i) =>
                adv({
                  name: `Advisory ${i}`,
                  severity: i < critical ? 'critical' : 'high',
                  advisoryId: `GHSA-${String(i).padStart(2, '0')}`,
                  // The last one maps to another weakness: every weakness
                  // cited comes from an identifier the reader sees.
                  cwe: i === critical + high - 1 ? ['CWE-79'] : ['CWE-22'],
                }),
              ),
            ]),
          ),
          'triaged',
        );
      const many = (critical: number, high: number) =>
        textOf(manyHtml(critical, high));
      // Critical and high triaged findings are listed exhaustively: many
      // advisories, the critical ones by title, the high ones by identifier.
      expect(many(2, 8)).toContain(
        'critical: Advisory 0 (GHSA-00) critical: Advisory 1 (GHSA-01) high: GHSA-02, GHSA-03, GHSA-04, GHSA-05, GHSA-06, GHSA-07, GHSA-08, GHSA-09 CWE-79, CWE-22',
      );
      // One line of identifiers holds every advisory: the weaknesses follow
      // it; several lines: the weaknesses of the row stand on their own.
      expect(many(0, 6)).toContain(
        'GHSA-00, GHSA-01, GHSA-02, GHSA-03, GHSA-04, GHSA-05 · CWE-79, CWE-22',
      );
      // Up to four advisories, each one is named by its title; from five,
      // only the critical ones are.
      expect(many(1, 3)).toContain(
        'critical: Advisory 0 (GHSA-00) high: Advisory 1 (GHSA-01) high: Advisory 2 (GHSA-02) high: Advisory 3 (GHSA-03) CWE-79, CWE-22',
      );
      expect(many(1, 4)).toContain(
        'critical: Advisory 0 (GHSA-00) high: GHSA-01, GHSA-02, GHSA-03, GHSA-04 CWE-79, CWE-22',
      );
      expect(manyHtml(2, 8)).not.toMatch(/and \d+ more/);
      // A severity word never ends a line away from its first identifier.
      expect(manyHtml(2, 8)).toContain(
        '<span class="keep">high: <span class="mono">GHSA-02,</span></span>',
      );
      expect(many(7, 1)).toContain(
        'critical: Advisory 5 (GHSA-05) critical: Advisory 6 (GHSA-06) high: GHSA-07 CWE-79, CWE-22',
      );
      for (const [critical, high] of [
        [2, 8],
        [7, 1],
      ]) {
        const text = many(critical, high);
        for (let i = 0; i < critical + high; i++) {
          const id = `GHSA-${String(i).padStart(2, '0')}`;
          expect(text).toContain(id);
          // Every critical one comes with its title.
          if (i < critical) expect(text).toContain(`Advisory ${i} (${id})`);
        }
      }
    });

    it('hangs the wrapped lines of an advisory entry, so its end never reads as the next entry', () => {
      const hbs = (over: Partial<MappedVulnerability>) =>
        adv({ packageName: 'handlebars', packageVersion: '4.0.5', ...over });
      const html = render(
        report([
          vuln(),
          // Mixed severities: the critical one by its title, the high ones
          // on a line of identifiers that opens with « high: ».
          hbs({
            name: 'Handlebars.js has JavaScript Injection via AST Type Confusion',
            severity: 'critical',
            advisoryId: 'GHSA-2w6w',
            cwe: ['CWE-94'],
          }),
          ...['GHSA-2cf5', 'GHSA-3cqr', 'GHSA-3mfm', 'GHSA-62gr'].map(
            (advisoryId, i) =>
              hbs({ name: `Handlebars ${i}`, advisoryId, cwe: ['CWE-79'] }),
          ),
          // One severity, a few advisories: each named on its own line.
          ...['GHSA-8hfj', 'GHSA-wc69'].map((advisoryId, i) =>
            adv({
              name: `Moment.js advisory ${i}`,
              packageName: 'moment',
              packageVersion: '2.24.0',
              advisoryId,
            }),
          ),
          // Many advisories of one severity: one line of identifiers, which
          // the weaknesses follow.
          ...[
            'GHSA-34x7',
            'GHSA-3jfq',
            'GHSA-5955',
            'GHSA-83g3',
            'GHSA-8qq5',
          ].map((advisoryId, i) => adv({ name: `Tar ${i}`, advisoryId })),
        ]),
      );
      const t = section(html, 'triaged');
      const idLines = [
        ...t.matchAll(/<div class="adv-ids[^"]*">[\s\S]*?<\/div>/g),
      ].map(([line]) => line);
      const entries = idLines.filter((l) => l.includes('adv-entry'));
      // 2 handlebars entries (critical title, high identifiers), 2 moment.
      expect(entries.length).toBe(4);
      expect(entries[0]).toContain('GHSA-2w6w');
      expect(entries[1]).toContain('high:');
      expect(entries[2]).toContain('GHSA-8hfj');
      expect(entries[3]).toContain('GHSA-wc69');
      // The weaknesses of a row, and a single line of identifiers joined to
      // them, stay flush with the title.
      for (const line of idLines.filter((l) => /CWE-\d/.test(l)))
        expect(line).not.toContain('adv-entry');
      expect(idLines.find((l) => l.includes('GHSA-34x7'))).not.toContain(
        'adv-entry',
      );
      // First line at the edge of the column, the next ones indented.
      const rule = cssRule(html, 'table.triaged .adv-entry');
      expect(rule).toContain('padding-left: 12px');
      expect(rule).toContain('text-indent: -12px');
      // A tag is an inline block: it would inherit the negative indent and
      // push its label out of its frame.
      expect(cssRule(html, 'table.triaged .adv-entry .tag')).toContain(
        'text-indent: 0',
      );
    });

    it('lists identifiers without a title in alphabetical order, never by a weight the reader cannot see', () => {
      const t = textOf(
        section(
          render(
            report([
              vuln(),
              // Two findings each (two versions), then one: the heavier ones
              // used to come first.
              ...['GHSA-qffp', 'GHSA-34x7', 'GHSA-8qq5'].flatMap((advisoryId) =>
                ['2.2.1', '4.4.8'].map((packageVersion) =>
                  adv({
                    name: `Tar ${advisoryId}`,
                    advisoryId,
                    packageVersion,
                  }),
                ),
              ),
              ...['GHSA-9r2w', 'GHSA-5955'].map((advisoryId) =>
                adv({ name: `Tar ${advisoryId}`, advisoryId }),
              ),
              // Advisories merged under one title: their identifiers too.
              ...['4.13.1', '4.17.20'].map((packageVersion) =>
                adv({
                  name: 'Command Injection in lodash',
                  packageName: 'lodash',
                  advisoryId: 'GHSA-x5rq',
                  packageVersion,
                }),
              ),
              adv({
                name: 'Command Injection in lodash',
                packageName: 'lodash',
                advisoryId: 'GHSA-35jh',
                packageVersion: '4.13.1',
              }),
            ]),
          ),
          'triaged',
        ),
      );
      expect(t).toContain(
        '8 findings in 5 advisories, all high GHSA-34x7, GHSA-5955, GHSA-8qq5, GHSA-9r2w, GHSA-qffp · CWE-22',
      );
      expect(t).toContain(
        'Command Injection in lodash GHSA-35jh · GHSA-x5rq · CWE-22',
      );
    });

    it('merges advisories a reader cannot tell apart (same title, any case) and names them all', () => {
      const t = section(
        render(
          report([
            vuln(),
            adv({
              name: 'Arbitrary File Overwrite in tar',
              advisoryId: 'GHSA-1',
            }),
            adv({
              name: 'Arbitrary File Overwrite in tar',
              advisoryId: 'GHSA-2',
            }),
            adv({
              name: 'Arbitrary code execution in Handlebars',
              advisoryId: 'GHSA-3',
              packageName: 'handlebars',
              packageVersion: '4.0.5',
            }),
            adv({
              name: 'Arbitrary Code Execution in handlebars',
              advisoryId: 'GHSA-4',
              packageName: 'handlebars',
              packageVersion: '4.0.5',
            }),
          ]),
        ),
        'triaged',
      );
      expect(count(t, 'Arbitrary File Overwrite in tar')).toBe(1);
      expect(textOf(t)).toContain('GHSA-1 · GHSA-2');
      expect(count(textOf(t), 'tar@4.4.8')).toBe(1);
      expect(
        count(t.toLowerCase(), 'arbitrary code execution in handlebars'),
      ).toBe(1);
    });

    it('caps a long version list and says how many more there are', () => {
      const t = section(
        render(
          report([
            vuln(),
            ...[
              '0.3.0',
              '3.0.2',
              '3.0.3',
              '3.0.4',
              '3.0.5',
              '3.0.6',
              '3.0.7',
              '3.0.8',
            ].map((version) =>
              adv({
                name: 'minimatch ReDoS',
                packageName: 'minimatch',
                packageVersion: version,
                advisoryId: 'GHSA-m',
                cwe: ['CWE-400'],
              }),
            ),
          ]),
        ),
        'triaged',
      );
      expect(textOf(t)).toContain(
        'minimatch@0.3.0 minimatch@3.0.2 minimatch@3.0.3 minimatch@3.0.4 minimatch@3.0.5 minimatch@3.0.6 and 2 more',
      );
    });

    it('flags a withdrawn advisory next to its title', () => {
      const t = section(
        render(
          report([
            vuln(),
            adv({
              name: 'Out-of-Bounds read in stringstream',
              advisoryId: 'GHSA-s',
              withdrawn: true,
            }),
          ]),
        ),
        'triaged',
      );
      expect(textOf(t)).toContain(
        'Out-of-Bounds read in stringstream withdrawn',
      );
    });

    it('names the withdrawn advisories among the findings it does not list', () => {
      const t = section(
        render(
          report([
            vuln(),
            adv({
              name: 'Out-of-Bounds read in stringstream',
              severity: 'medium',
              packageName: 'stringstream',
              packageVersion: '0.0.5',
              advisoryId: 'GHSA-qpw2',
              withdrawn: true,
              cwe: ['CWE-125'],
            }),
            adv({ severity: 'low', advisoryId: 'GHSA-l' }),
          ]),
        ),
        'triaged',
      );
      // Counted in findings, the unit of the sentence; the identifier alone
      // in the code face.
      expect(textOf(t)).toContain(
        '2 lower-severity triaged findings are not listed, including 1 finding on a withdrawn advisory (GHSA-qpw2 on stringstream@0.0.5).',
      );
      expect(t).toContain('<span class="mono">GHSA-qpw2</span> on ');
      // An advisory withdrawn for two versions: two findings.
      const twice = section(
        render(
          report([
            vuln(),
            ...['0.0.5', '0.0.6'].map((packageVersion) =>
              adv({
                name: 'Out-of-Bounds read in stringstream',
                severity: 'medium',
                packageName: 'stringstream',
                packageVersion,
                advisoryId: 'GHSA-qpw2',
                withdrawn: true,
                cwe: ['CWE-125'],
              }),
            ),
          ]),
        ),
        'triaged',
      );
      expect(textOf(twice)).toContain(
        '2 lower-severity triaged findings are not listed, including 2 findings on a withdrawn advisory (GHSA-qpw2 on stringstream@0.0.5, 0.0.6).',
      );
      // Nothing withdrawn left out: nothing said.
      expect(textOf(triaged)).not.toContain('withdrawn');
    });

    it('tags development dependencies in the list, as in the weakness tables, and says what the tag means', () => {
      const html2 = render(
        report([
          vuln(),
          adv({
            name: 'Remote code execution in handlebars',
            packageName: 'handlebars',
            packageVersion: '4.0.5',
            advisoryId: 'GHSA-f2jv',
            devDependency: true,
            cwe: ['CWE-94'],
          }),
          adv({
            name: 'Arbitrary File Overwrite in tar',
            advisoryId: 'GHSA-t',
          }),
        ]),
      );
      const text = textOf(section(html2, 'triaged'));
      expect(text).toContain('handlebars@4.0.5 dev');
      expect(text).not.toContain('tar@4.4.8 dev');
      // Short chips: the Package column keeps its width.
      expect(section(html2, 'triaged')).toMatch(
        /<colgroup><col[^>]*><col><col style="width: 28%">/,
      );
      // A long chip and its tag: the column widens, the tag never drops
      // alone to the next line.
      const long = section(
        render(
          report([
            vuln(),
            adv({
              name: 'ReDoS in websocket-extensions',
              packageName: 'websocket-extensions',
              packageVersion: '0.1.3',
              advisoryId: 'GHSA-w',
              devDependency: true,
            }),
          ]),
        ),
        'triaged',
      );
      expect(long).toMatch(/<colgroup><col[^>]*><col><col style="width: 32%">/);
      // No open finding is a development dependency: the legend is still
      // given, once, before the first table.
      expect(textOf(section(html2, 'findings'))).toContain(
        'dev: development dependency, not shipped to production.',
      );
    });

    it('explains once that triage applies to one package version', () => {
      const t = section(
        render(
          report([
            adv({
              state: 'to_verify',
              advisoryId: 'GHSA-t',
              packageVersion: '2.2.1',
            }),
            adv({ advisoryId: 'GHSA-t' }),
          ]),
        ),
        'triaged',
      );
      expect(textOf(t)).toContain(
        'Triage applies to a package version: 1 advisory ignored for one version is still open for another.',
      );
      expect(textOf(triaged)).not.toContain('Triage applies');
    });

    it('is omitted when nothing was triaged', () => {
      expect(render(report([vuln()]))).not.toContain('id="triaged"');
    });
  });

  describe('about this report', () => {
    const html = render(report([vuln()]));
    const about = html.slice(html.indexOf('class="about"'));

    it('links the MITRE reference', () => {
      expect(about).toContain(
        '<a href="https://cwe.mitre.org/top25/">cwe.mitre.org/top25</a>',
      );
    });

    it('explains the exploitability verdicts', () => {
      expect(textOf(about)).toContain('Exploitability analysis');
      expect(textOf(about)).toMatch(
        /not exploitable, theoretical, proven or actively exploited/,
      );
    });

    it('states the rules without internal justification', () => {
      expect(textOf(about)).not.toContain('dashboard');
    });

    it('states the rule for withdrawn advisories only when the report holds one', () => {
      expect(textOf(about)).not.toContain('Withdrawn');
      const withdrawn = render(
        report([
          vuln(),
          vuln({
            type: 'sca',
            name: 'Out-of-Bounds read in stringstream',
            severity: 'medium',
            state: 'ignored',
            path: undefined,
            line: undefined,
            packageName: 'stringstream',
            packageVersion: '0.0.5',
            advisoryId: 'GHSA-qpw2',
            withdrawn: true,
            cwe: ['CWE-125'],
          }),
        ]),
      );
      expect(
        textOf(withdrawn.slice(withdrawn.indexOf('class="about"'))),
      ).toContain(
        'Withdrawn advisories stay counted and are flagged as withdrawn.',
      );
    });
  });

  describe('empty project', () => {
    const html = render(report([]));

    it('words the whole-project share without a "0 of them (0%)"', () => {
      expect(textOf(html)).toContain(
        '120 open findings across all scan types. None of them maps to a Top 25 weakness.',
      );
    });

    it('says so plainly and skips the empty sections', () => {
      expect(html).toContain('No CWE Top 25 weakness was found');
      expect(html).not.toContain('id="findings"');
      expect(section(html, 'coverage')).toContain('class="count-zero"');
    });
  });

  describe('escaping and secrets', () => {
    const html = render(
      report(
        [
          vuln({
            name: '<img src=x onerror=alert(1)>',
            path: 'src/<evil>.js',
            description: '<script>alert(1)</script>',
          }),
          vuln({
            name: 'Token ghp_abcdefghijklmnopqrstuvwxyz0123456789 leaked',
            path: 'src/config.js',
          }),
        ],
        {
          scanMetadata: { projectId: 'p1', projectName: 'Acme <b>' },
        },
      ),
    );

    it('escapes every value coming from the data', () => {
      expect(html).not.toContain('<img src=x');
      expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
      expect(html).toContain('&lt;evil&gt;');
      expect(html).not.toContain('<script>alert(1)');
      expect(html).toContain('Acme &lt;b&gt;');
    });

    it('never prints a secret in clear', () => {
      expect(html).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789');
      expect(html).toContain('ghp_••••6789');
    });
  });

  describe('apostrophes', () => {
    /** Straight apostrophes between two letters in the visible text. */
    const straight = (html: string) =>
      textOf(html).match(/[A-Za-z]'[A-Za-z]/g) ?? [];

    it('curls the apostrophes of its own words, like the Cybe Analysis briefs and the other reports', () => {
      const html = render(
        report([
          vuln({
            cwe: ['CWE-79', 'CWE-352'],
            exploitability: {
              verdict: 'theoretical',
              source: 'agent',
              score: 0.8,
              reason: 'Reachable.',
            },
          }),
        ]),
      );
      const words = textOf(html);
      expect(words).toContain(
        'Open findings mapped to MITRE’s list of the 25 most dangerous',
      );
      expect(words).toContain('move in MITRE’s ranking since the 2023 list');
      expect(words).toContain('listed in CISA’s Known Exploited');
      expect(words).toContain('assessed by CybeDefend’s AI analysis');
      expect(words).toContain('Only verdicts from CybeDefend’s AI analysis');
      // The reference description of a weakness is the report's own text.
      expect(words).toContain('The injected script then runs in the victim’s');
      expect(words).toContain('An attacker can make the victim’s browser');
      expect(straight(html)).toEqual([]);
    });

    it('curls the apostrophes of a finding title, never inside its code', () => {
      const html = render(
        report([vuln({ name: "qs's arrayLimit bypass in `it's`" })]),
      );
      expect(textOf(section(html, 'findings'))).toContain(
        'qs’s arrayLimit bypass in',
      );
      expect(html).toContain('<code class="code-inline">it\'s</code>');
      // The continuation row names it the same way.
      expect(html).toContain("qs’s arrayLimit bypass in it's (continued)");
    });

    it('curls the apostrophes of a finding description and of an AI reason, never inside their code', () => {
      const html = render(
        report([
          vuln({
            description: [
              "An attacker can run JavaScript in a victim's browser through `it's`.",
              '',
              '```html',
              "<a href='{{ link }}'>it's</a>",
              '```',
            ].join('\n'),
            exploitability: {
              verdict: 'theoretical',
              source: 'agent',
              score: 0.7,
              reason: "The handler's input reaches the `user's` sink.",
            },
          }),
        ]),
      );
      const findings = section(html, 'findings');
      expect(textOf(findings)).toContain('in a victim’s browser through');
      expect(textOf(findings)).toContain('The handler’s input reaches the');
      // Code keeps its straight apostrophes, inline or in a block.
      expect(findings).toContain('<code class="code-inline">it\'s</code>');
      expect(findings).toContain('<code class="code-inline">user\'s</code>');
      expect(findings).toContain(
        "<pre class=\"code-block\">&lt;a href='{{ link }}'&gt;it's&lt;/a&gt;</pre>",
      );
      const prose = findings.replace(/<(code|pre)\b[^>]*>[\s\S]*?<\/\1>/g, '');
      expect(straight(prose)).toEqual([]);
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

describe('a state the reference table does not know', () => {
  // `currentState` is a free varchar: an import or an API write can store a
  // value outside the known states, and its fallback wording is printed
  const hostile = '<img src=x onerror=alert(1)>_state';
  const dependency = (over: Partial<MappedVulnerability> = {}) =>
    vuln({
      type: 'sca',
      state: hostile,
      path: undefined,
      line: undefined,
      packageName: 'qs',
      packageVersion: '6.5.2',
      advisoryId: 'GHSA-q',
      cwe: ['CWE-400'],
      ...over,
    });

  it('is escaped where the shared dependency state is announced', () => {
    const html = render(
      report([dependency(), dependency({ advisoryId: 'GHSA-r' })]),
    );
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt; state');
  });
});
