// report-builder.service.spec.ts — aggregated reports (OWASP Top 10, CWE
// Top 25, licenses) on the shared report design system. The EU AI Act
// cases live with its closed template.
//
// Pins the contract of the rendered document rather than its markup details:
// the shared skeleton (cover, sections, footer), figures that reconcile with
// the rows listed, triaged findings kept out of the figures, no silent
// truncation, no invented data, and HTML escaping of every tenant-controlled
// string (the document is rendered by Puppeteer, a live browser).

import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from 'nestjs-pino';
import { ReportBuilderService } from './report-builder.service';
import { PdfGeneratorService } from '../../../../core/utils/pdf-generator.service';
import { createLoggerMock } from '../../../../test-utils/typeorm-mock.util';
import { OWASP_TOP_10_2021_DATA } from '../../owasp-report/constants/owasp-data.constants';
import { CWE_TOP_25_2024_DATA } from '../../cwe-report/constants/cwe-data.constants';
import {
  AGGREGATED_CSS,
  edgeUnitsJoined,
  listEntry,
  plural,
  projectCell,
  projectName,
  projectNames,
  projectRows,
  rowCount,
  versionItem,
  wholeName,
} from '../templates/aggregated-common';
import { LICENSE_CSS } from '../templates/license-template';
import { keyFacts, packageChip, pathText } from '../../shared/report-layout';
import {
  breakableId,
  breakableVersion,
  codeChip,
  idBox,
  piecesHtml,
  punctuated,
  versionChip,
} from '../../shared/report-styles';
import { escapeHtml } from '../../../../core/utils/html-escape';

const GENERATED_AT = '2026-09-23T10:50:27.000Z';

/** Visible text of a document: tags dropped, entities decoded, spaces folded. */
function text(html: string): string {
  return (
    html
      .replace(/<style[\s\S]*?<\/style>/g, ' ')
      // A break opportunity, or a hyphen kept with the letter after it: no
      // space in the text.
      .replace(/<wbr[^>]*>|<\/?nobr>/g, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)))
      .replace(/&nbsp;/g, ' ')
      .replace(/&middot;/g, '·')
      .replace(/&mdash;/g, '—')
      .replace(/&ndash;/g, '–')
      .replace(/&hellip;/g, '…')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      // A tag closing before punctuation (`<span>name</span>:`, `…</span>),`)
      // adds no space.
      .replace(/ ([,;:.!?)])(?=[\s,;:.!?)]|$)/g, '$1')
      // Nor does a tag opening after a parenthesis (`(<span>1.0.0</span>`).
      .replace(/\( /g, '(')
      .trim()
  );
}

/**
 * Markup of the lines of a location as the PDF lays them out: the breaks
 * between two runs of a line that only a narrow preview shows dropped.
 */
const pdfLines = (html: string): string =>
  html.replace(/<wbr class="lw">/g, '');

/** HTML of the `<section>` whose heading contains `title`. */
function section(html: string, title: string): string {
  const sections = html.split(/(?=<section )/);
  const found = sections.find((s) =>
    new RegExp(`<h[23]>[^<]*${title}`).test(s),
  );
  if (!found) throw new Error(`section "${title}" not found`);
  return found.split('</section>')[0];
}

/** HTML of the first table of `html` carrying the class `cls`. */
function tableOf(html: string, cls: string): string {
  const found = html.match(
    new RegExp(`<table class="[^"]*\\b${cls}\\b[^"]*">[\\s\\S]*?</table>`),
  );
  if (!found) throw new Error(`table "${cls}" not found`);
  return found[0];
}

/**
 * HTML of the first table of `html` carrying the class `cls`, with the
 * tables nested in it (`tableOf` stops at the first `</table>`).
 */
function wholeTableOf(html: string, cls: string): string {
  const start = html.search(
    new RegExp(`<table class="[^"]*\\b${cls}\\b[^"]*">`),
  );
  if (start < 0) throw new Error(`table "${cls}" not found`);
  const tags = /<\/?table\b[^>]*>/g;
  tags.lastIndex = start;
  let depth = 0;
  for (let m = tags.exec(html); m; m = tags.exec(html)) {
    depth += m[0].startsWith('</') ? -1 : 1;
    if (depth === 0) return html.slice(start, m.index + m[0].length);
  }
  throw new Error(`table "${cls}" not closed`);
}

/** Visible text of each body row, inline markup dropped without a space. */
function plainRows(table: string): string[] {
  return bodyRows(table.replace(/<\/?(?:span|wbr|i|strong|em)\b[^>]*>/g, ''));
}

/** Visible text of each body row of a table, attached note rows left out. */
function bodyRows(table: string): string[] {
  // Every row group: a row and its notes form their own `tbody`.
  return table
    .split('</thead>')[1]
    .split('<tr')
    .slice(1)
    .filter((r) => !r.startsWith(' class="note-row'))
    .map((r) => text(`<tr${r}`));
}

/** Visible text of the note rows attached to the rows of a table. */
function noteRows(table: string): string[] {
  return table
    .split('</thead>')[1]
    .split('<tr')
    .slice(1)
    .filter((r) => r.startsWith(' class="note-row'))
    .map((r) => text(`<tr${r}`));
}

/** Classes of the `<span>` elements still open at `index` of `html`. */
function openAt(html: string, index: number): string[] {
  const stack: string[] = [];
  for (const m of html.slice(0, index).matchAll(/<(\/)?span\b([^>]*)>/g)) {
    if (m[1]) stack.pop();
    else stack.push(/class="([^"]*)"/.exec(m[2])?.[1] ?? '');
  }
  return stack;
}

type Vuln = Record<string, unknown>;

const vuln = (over: Vuln = {}): Vuln => ({
  id: `v-${Math.random().toString(36).slice(2)}`,
  type: 'sast',
  name: 'SQL injection via raw query',
  description: 'Untrusted input reaches a SQL query.',
  severity: 'critical',
  state: 'to_verify',
  path: 'src/db/query.js',
  line: '42',
  cwe: ['CWE-89'],
  owaspTop10: ['A03:2021 - Injection'],
  projectId: 'p1',
  projectName: 'billing-service',
  branch: 'main',
  ...over,
});

const PROJECTS_META = [
  { id: 'p1', name: 'billing-service', teamName: 'Payments' },
  { id: 'p2', name: 'vitality-api', teamName: 'Platform' },
  { id: 'p3', name: 'ml-recommender', teamName: 'Data' },
];

/** OWASP aggregated data as ReportAggregationService returns it. */
function owaspData(byCategory: Record<string, Vuln[]>, extra: Vuln[] = []) {
  const categories = Object.keys(OWASP_TOP_10_2021_DATA)
    .sort()
    .map((id) => ({
      categoryData: OWASP_TOP_10_2021_DATA[id],
      vulnerabilities: byCategory[id] ?? [],
      count: (byCategory[id] ?? []).length,
    }));
  const all = new Map<unknown, Vuln>();
  for (const list of Object.values(byCategory))
    for (const v of list) all.set(v.id, v);
  for (const v of extra) all.set(v.id, v);
  return {
    generatedAt: GENERATED_AT,
    branchFilter: 'all',
    summary: { totalVulnerabilities: all.size },
    categories,
    vulnerabilities: Array.from(all.values()),
    projectsMetadata: PROJECTS_META,
    projectBranchesMetadata: [],
  };
}

function cweData(byCwe: Record<string, Vuln[]>, extra: Vuln[] = []) {
  const categories = Object.values(CWE_TOP_25_2024_DATA)
    .sort((a, b) => a.rank - b.rank)
    .map((c) => ({
      cweData: c,
      vulnerabilities: byCwe[c.id] ?? [],
      count: (byCwe[c.id] ?? []).length,
    }));
  const all = new Map<unknown, Vuln>();
  for (const list of Object.values(byCwe))
    for (const v of list) all.set(v.id, v);
  for (const v of extra) all.set(v.id, v);
  return {
    generatedAt: GENERATED_AT,
    branchFilter: 'all',
    summary: { totalVulnerabilities: all.size },
    categories,
    vulnerabilities: Array.from(all.values()),
    projectsMetadata: PROJECTS_META,
    projectBranchesMetadata: [],
  };
}

const pkg = (over: Vuln = {}): Vuln => ({
  ecosystem: 'npm',
  packageName: 'left-pad',
  packageVersion: '1.3.0',
  licenses: ['MIT'],
  licenseExpression: null,
  category: 'PERMISSIVE',
  effectiveLicenses: ['MIT'],
  projects: ['billing-service'],
  branches: ['main'],
  isDev: false,
  isTransitive: true,
  licenseIgnored: false,
  ...over,
});

function licenseData(packages: Vuln[], projectRows?: Vuln[]) {
  const byLicense = new Map<string, Vuln[]>();
  for (const p of packages)
    for (const l of p.effectiveLicenses as string[]) {
      byLicense.set(l, [...(byLicense.get(l) ?? []), p]);
    }
  const CATEGORY: Record<string, string> = {
    MIT: 'PERMISSIVE',
    ISC: 'PERMISSIVE',
    WTFPL: 'PERMISSIVE',
    'BSD-like': 'PERMISSIVE',
    'GPL-3.0-only': 'STRONG_COPYLEFT',
    'GPL-like': 'STRONG_COPYLEFT',
    'LGPL-3.0-only': 'WEAK_COPYLEFT',
    'MPL-2.0': 'WEAK_COPYLEFT',
    UNKNOWN: 'UNKNOWN',
  };
  const NAMES: Record<string, string> = {
    MIT: 'MIT License',
    ISC: 'ISC License',
    WTFPL: 'Do What The F*ck You Want To Public License',
    'BSD-like': 'BSD-like',
    'GPL-3.0-only': 'GNU General Public License v3.0 only',
    'GPL-like': 'GPL-like',
    'LGPL-3.0-only': 'GNU Lesser General Public License v3.0 only',
    'MPL-2.0': 'Mozilla Public License 2.0',
    UNKNOWN: 'Unknown — License not found',
  };
  const categories: Record<string, Vuln[]> = {
    PERMISSIVE: [],
    WEAK_COPYLEFT: [],
    STRONG_COPYLEFT: [],
    UNKNOWN: [],
  };
  for (const [spdxId, list] of byLicense) {
    categories[CATEGORY[spdxId]].push({
      spdxId,
      name: NAMES[spdxId],
      category: CATEGORY[spdxId],
      risk: 'NONE',
      packages: list,
    });
  }
  // Like the aggregation: a package is its ecosystem + name, whatever the
  // number of versions in use.
  const names = new Map<string, string>();
  for (const p of packages) {
    names.set(`${p.ecosystem}\u0000${p.packageName}`, String(p.category));
  }
  const count = (c: string) =>
    Array.from(names.values()).filter((cat) => cat === c).length;
  return {
    generatedAt: GENERATED_AT,
    branchFilter: 'all',
    summary: {
      totalPackages: names.size,
      totalVersions: packages.length,
      packageOccurrences: packages.reduce(
        (n, p) => n + (p.projects as string[]).length,
        0,
      ),
      uniqueLicenses: byLicense.size,
      projectsCount: 2,
      projectsWithPackages: 1,
      byCategory: {
        permissive: count('PERMISSIVE'),
        weakCopyleft: count('WEAK_COPYLEFT'),
        strongCopyleft: count('STRONG_COPYLEFT'),
        unknown: count('UNKNOWN'),
      },
    },
    categories,
    packages,
    projectRows: projectRows ?? [
      {
        projectName: 'billing-service',
        teamName: 'Payments',
        branches: ['main'],
        packages: names.size,
        byCategory: {
          permissive: count('PERMISSIVE'),
          weakCopyleft: count('WEAK_COPYLEFT'),
          strongCopyleft: count('STRONG_COPYLEFT'),
          unknown: count('UNKNOWN'),
        },
      },
      {
        projectName: 'ml-recommender',
        teamName: 'Data',
        branches: [],
        packages: 0,
        byCategory: {
          permissive: 0,
          weakCopyleft: 0,
          strongCopyleft: 0,
          unknown: 0,
        },
      },
    ],
    projectsMetadata: PROJECTS_META,
  };
}

describe('ReportBuilderService (aggregated reports)', () => {
  let service: ReportBuilderService;
  let generatePDF: jest.Mock;

  beforeEach(async () => {
    // The PDF path stubs Puppeteer and echoes the HTML it would print.
    generatePDF = jest.fn(async (html: string) => Buffer.from(html));
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportBuilderService,
        { provide: Logger, useValue: createLoggerMock() },
        { provide: PdfGeneratorService, useValue: { generatePDF } },
      ],
    }).compile();
    service = module.get(ReportBuilderService);
  });

  const build = async (
    reportType: string,
    aggregatedData: unknown,
    over: Record<string, unknown> = {},
  ): Promise<string> => {
    const out = await service.buildReport({
      scopeType: 'organization',
      scopeName: 'Acme Corp',
      reportType,
      format: 'html',
      detailed: true,
      projectIds: ['p1', 'p2', 'p3'],
      metadata: { id: 'org-1' },
      aggregatedData,
      ...over,
    });
    return out.content.toString('utf8');
  };

  const SAMPLES: Record<string, () => unknown> = {
    owasp: () => owaspData({ A03: [vuln()] }),
    cwe: () => cweData({ 'CWE-89': [vuln()] }),
    license: () => licenseData([pkg()]),
  };

  describe('shared document skeleton (every aggregated report)', () => {
    for (const reportType of Object.keys(SAMPLES)) {
      for (const format of ['html', 'pdf']) {
        it(`${reportType} ${format}: cover, sections and closing footer from the shared layout, no script`, async () => {
          const html = await build(reportType, SAMPLES[reportType](), {
            format,
          });
          expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
          expect(html).toContain('<header class="cover">');
          expect(html).toContain('data:image/png;base64,');
          expect(html).toContain('class="section"');
          expect(html).toContain('class="footer"');
          expect(html).toContain('About this report');
          expect(html).not.toContain('<script');
          expect(html).not.toContain('<canvas');
          // No legacy template leftovers.
          expect(html).not.toContain('class="header"');
          expect(html).not.toContain('#ff6659');
          expect(html).not.toContain('-apple-system');
          expect(html).not.toMatch(/Generated on \w+day/);
        });
      }

      it(`${reportType}: cover metadata (scope, projects, branches, generation date in UTC)`, async () => {
        const html = await build(reportType, SAMPLES[reportType]());
        const cover = text(html.split('</header>')[0]);
        expect(cover).toContain('Organization report');
        expect(cover).toMatch(/Organization Acme Corp/);
        expect(cover).toMatch(/Projects 3/);
        expect(cover).toMatch(/Branches All branches/);
        expect(cover).toContain('Generated 23 Sep 2026, 10:50 UTC');
        // The shared cover lays the metadata out (short values on one line):
        // no local override.
        expect(html).not.toMatch(/\.cover-meta \{[^}]*!important/);
        // No prose under the project count: the summary explains it.
        expect(html.split('</header>')[0]).not.toMatch(
          /<dt>Projects<\/dt><dd>\d+<span class="sub">/,
        );
      });

      it(`${reportType}: summary on key figures, a donut, a second SVG-free chart and the shared key facts`, async () => {
        const html = await build(reportType, SAMPLES[reportType]());
        const summary = section(html, 'Executive summary');
        expect(summary).toContain('class="kpis"');
        expect(summary).toContain('class="donut"');
        // Two chart panels, and the facts in the shared « Key facts » panel
        // (same component as the per-project reports), never a local list.
        expect(summary.match(/class="panel avoid-break"/g)).toHaveLength(2);
        expect(summary).toContain(keyFacts('Key facts', []).split('<ul>')[0]);
        expect(summary).not.toContain('class="facts"');
        expect(html).not.toMatch(/\.facts li/);
      });

      it(`${reportType}: centres each summary chart in its panel`, async () => {
        const html = await build(reportType, SAMPLES[reportType]());
        const summary = section(html, 'Executive summary');
        expect(summary.match(/class="chart-body"/g)).toHaveLength(2);
        expect(html).toMatch(
          /\.summary-charts \.chart-body \{[^}]*justify-content: center/,
        );
      });

      it(`${reportType}: no !important in its own CSS`, async () => {
        const html = await build(reportType, SAMPLES[reportType]());
        const own = html.split('.footer { margin-top: 18px')[1] ?? '';
        expect(own).not.toContain('!important');
      });

      it(`${reportType}: continued tables use the shared mechanism, no local copy`, async () => {
        const html = await build(reportType, SAMPLES[reportType]());
        expect(html.match(/\s\.cont-cover \{/g)).toHaveLength(1);
        expect(html.match(/table\.has-cont \{/g)).toHaveLength(1);
        expect(html).not.toContain('cont-tag');
      });

      it(`${reportType}: escapes a malicious organization name`, async () => {
        const html = await build(reportType, SAMPLES[reportType](), {
          scopeName: `</title><script>alert('scope')</script>`,
        });
        expect(html).not.toContain("<script>alert('scope')</script>");
        expect(html).toContain('&lt;script&gt;');
      });
    }

    it('names a branch shared by every project once, on the cover, never on each row', async () => {
      const shared = await build(
        'owasp',
        owaspData({
          A03: [vuln(), vuln({ projectId: 'p2', projectName: 'vitality-api' })],
        }),
      );
      expect(text(shared.split('</header>')[0])).toContain('Scanned: main');
      const rows = bodyRows(tableOf(section(shared, 'Projects'), 'compact'));
      // The team follows the name after a separator: never read as part of it.
      expect(rows[0]).toMatch(/^billing-service · Payments 1 /);
      const mixed = await build(
        'owasp',
        owaspData({
          A03: [
            vuln(),
            vuln({
              projectId: 'p2',
              projectName: 'vitality-api',
              branch: 'develop',
            }),
          ],
        }),
      );
      const mixedRows = bodyRows(
        tableOf(section(mixed, 'Projects'), 'compact'),
      );
      expect(mixedRows[0]).toMatch(/^billing-service · Payments · main /);
      expect(mixedRows[1]).toMatch(/^vitality-api · Platform · develop /);
    });

    it('keeps a count with its noun, and the separator of a project cell with the name before it', async () => {
      // A number never ends a line apart from what it counts.
      expect(plural(13, 'other component')).toBe('13\u00a0other components');
      expect(plural(1, 'package')).toBe('1\u00a0package');
      // A project cell that wraps before its team keeps the separator at the
      // end of the name: a line opening on « · » reads as a list bullet.
      for (const html of [
        await build('license', licenseData([pkg()])),
        await build('owasp', SAMPLES.owasp()),
      ]) {
        const cells = tableOf(section(html, 'Projects'), 'compact').match(
          /<td><span class="name">[\s\S]*?<\/td>/g,
        );
        expect(cells.length).toBeGreaterThan(0);
        for (const cell of cells) {
          expect(cell).toMatch(
            /^<td><span class="name">[^<]*<\/span><span class="inline-sep">&nbsp;&middot;<\/span> <span class="inline-sub">[^<]+<\/span><\/td>$/,
          );
        }
      }
      // The separator is set like the team it introduces.
      expect(AGGREGATED_CSS).toMatch(
        /\.inline-sub, \.inline-sep \{ font-size: 10px; color: #[0-9a-f]+; \}/,
      );
    });

    it('names the branches found under the branch filter on the cover', async () => {
      const cover = (html: string) => text(html.split('</header>')[0]);
      expect(cover(await build('owasp', SAMPLES.owasp()))).toMatch(
        /Branches All branches Scanned: main Generated/,
      );
      const none = owaspData({ A03: [vuln({ branch: '' })] });
      expect(cover(await build('owasp', none))).toMatch(
        /Branches All branches Generated/,
      );
    });

    it('keeps its own CSS on the type scale of the design spec', () => {
      const sizes = [AGGREGATED_CSS, LICENSE_CSS]
        .join('')
        .match(/font-size: [\d.]+px/g)
        .map((m) => Number(m.replace(/\D+([\d.]+)px/, '$1')));
      for (const size of sizes) {
        expect([26, 17, 13, 11, 10, 9.5]).toContain(size);
      }
    });

    it('labels team and custom-selection scopes', async () => {
      const team = text(
        await build('owasp', SAMPLES.owasp(), {
          scopeType: 'team',
          scopeName: 'Payments',
        }),
      );
      expect(team).toContain('Team report');
      expect(team).toMatch(/Team Payments/);
      const batch = text(
        await build('owasp', SAMPLES.owasp(), {
          scopeType: 'batch',
          scopeName: 'Custom selection',
        }),
      );
      expect(batch).toContain('Custom selection report');
    });

    it('names the branch selection mode on the cover', async () => {
      const data = {
        ...(SAMPLES.owasp() as object),
        branchFilter: 'reference',
      };
      expect(text(await build('owasp', data))).toMatch(
        /Branches Reference branches/,
      );
    });

    it.each([
      ['owasp', 'OWASP Top 10 report · Acme Corp'],
      ['cwe', 'CWE Top 25 report · Acme Corp'],
      ['license', 'License compliance report · Acme Corp'],
    ])(
      '%s PDF: waits for the closing footer and titles the running footer',
      async (reportType, footerTitle) => {
        await build(reportType, SAMPLES[reportType](), { format: 'pdf' });
        expect(generatePDF).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({ waitForSelector: '.footer', footerTitle }),
        );
      },
    );

    it('drops the reference texts and inventories in the summary variant, keeps every figure and finding', async () => {
      const owasp = await build('owasp', owaspData({ A03: [vuln()] }), {
        detailed: false,
      });
      const detail = section(owasp, 'Injection');
      expect(text(detail)).not.toContain('How to prevent');
      expect(text(detail)).toContain('SQL injection via raw query');
      // Without a reference text, the heading block hides the context row.
      expect(detail).toContain('class="cat-head cont-cover"');
      const license = await build('license', licenseData([pkg()]), {
        detailed: false,
      });
      expect(license).not.toMatch(/<h2>Permissive package inventory/);
      expect(text(license)).not.toContain('appendix');
      expect(text(section(license, 'Permissive licenses'))).toContain('MIT');
    });

    it('returns the aggregated data untouched for the JSON format', async () => {
      const data = SAMPLES.owasp();
      const out = await service.buildReport({
        scopeType: 'organization',
        scopeName: 'Acme Corp',
        reportType: 'owasp',
        format: 'json',
        detailed: true,
        projectIds: ['p1'],
        metadata: { id: 'org-1' },
        aggregatedData: data,
      });
      expect(JSON.parse(out.content.toString())).toEqual(data);
      expect(out.contentType).toBe('application/json');
    });
  });

  describe('OWASP Top 10', () => {
    it('counts every open finding, the ones outside the Top 10 as not mapped (per-project rule); triaged ones are excluded', async () => {
      const outside = vuln({
        type: 'iac',
        name: 'Privileged container',
        severity: 'critical',
        path: 'k8s/deployment.yaml',
        owaspTop10: [],
        cwe: [],
      });
      const data = owaspData(
        {
          A03: [vuln({ severity: 'critical' }), vuln({ severity: 'high' })],
          A01: [vuln({ severity: 'medium', state: 'ignored' })],
        },
        [outside],
      );
      const html = await build('owasp', data);
      const summary = text(section(html, 'Executive summary'));
      expect(summary).toMatch(/^.*3 Open findings/);
      expect(summary).toMatch(/2 Critical/);
      expect(summary).toMatch(/1 High/);
      expect(summary).toMatch(/0 Medium/);
      expect(summary).toContain('3 open findings · 1 triaged, excluded');
      expect(summary).toContain(
        '1 open finding (1 critical) matches no OWASP Top 10 category; it is listed under Not mapped.',
      );
      const matrix = tableOf(
        section(html, 'OWASP Top 10 at a glance'),
        'matrix',
      );
      const rows = bodyRows(matrix);
      // No glyph stands in for a code: one mark (–) means « nothing ».
      expect(rows[rows.length - 2]).toMatch(
        /^Not mapped to the OWASP Top 10 1 – 1 – 1 of 3$/,
      );
      expect(matrix).not.toContain('&mdash;');
      expect(rows[rows.length - 1]).toMatch(/^Total 2 1 3 1 /);
      expect(text(section(html, 'Not mapped to the OWASP Top 10'))).toContain(
        'Privileged container',
      );
      // Its introduction is set like the reference text of the others.
      expect(html).toMatch(/\.cat-intro \{[^}]*font-size: 10px/);
    });

    it('adds an Unrated column where findings without a severity would leave the columns short', async () => {
      const withUnknown = await build(
        'owasp',
        owaspData({ A03: [vuln(), vuln({ severity: '' })] }),
      );
      // An Unrated tile, like the donut and the tables: the tiles add up.
      // « Unrated », the word of the per-project reports, everywhere.
      expect(text(section(withUnknown, 'Executive summary'))).toMatch(
        /2 Open findings 1 Critical 0 High 0 Medium 0 Low 1 Unrated/,
      );
      for (const title of ['Projects', 'OWASP Top 10 at a glance']) {
        const head = text(section(withUnknown, title).split('<tbody>')[0]);
        expect(head).toContain('Unrated');
      }
      const detail = text(section(withUnknown, 'Injection'));
      expect(detail).toMatch(/^.*Unrated 1 /);
      expect(
        bodyRows(tableOf(section(withUnknown, 'Injection'), 'code-table'))[1],
      ).toMatch(/^Unrated SQL injection/);
      expect(text(withUnknown)).not.toMatch(/\bUnknown\b/);
      expect(text(withUnknown)).not.toContain('Open totals include');
      const without = await build('owasp', owaspData({ A03: [vuln()] }));
      expect(text(section(without, 'Projects'))).not.toContain('Unrated');
    });

    it('gives a severity column to the severities of the open findings only, in every table', async () => {
      const html = await build(
        'owasp',
        owaspData({
          A03: [
            vuln(),
            vuln({ severity: 'high' }),
            vuln({ severity: 'medium', state: 'resolved' }),
          ],
        }),
      );
      // No open finding is medium or low: no column of dashes, as in the
      // triaged counts (the tiles still show a greyed 0).
      for (const title of ['Projects', 'OWASP Top 10 at a glance']) {
        const head = text(section(html, title).split('<tbody>')[0]);
        expect(head).toMatch(/Critical High Open Triaged/);
        expect(head).not.toMatch(/Medium|Low/);
      }
      expect(text(section(html, 'Executive summary'))).toMatch(
        /0 Medium 0 Low/,
      );
    });

    it('closes the projects table on a total row', async () => {
      const html = await build(
        'owasp',
        owaspData({
          A03: [vuln(), vuln({ projectId: 'p2', projectName: 'vitality-api' })],
        }),
      );
      const rows = bodyRows(tableOf(section(html, 'Projects'), 'compact'));
      expect(rows[rows.length - 1]).toBe('Total 2 2 –');
      expect(section(html, 'Projects')).toContain('<tr class="total-row">');
    });

    it('presents the projects first, then the Top 10 matrix with its per-project breakdown', async () => {
      const html = await build(
        'owasp',
        owaspData({
          A03: [vuln(), vuln({ projectId: 'p2', projectName: 'vitality-api' })],
        }),
      );
      expect(html.indexOf('<h2>Projects</h2>')).toBeLessThan(
        html.indexOf('<h2>OWASP Top 10 at a glance</h2>'),
      );
      const glance = text(section(html, 'OWASP Top 10 at a glance'));
      expect(glance).toContain('Open findings per project and category');
      expect(glance).toMatch(/vitality-api – – 1 /);
      expect(text(section(html, 'Projects'))).not.toContain(
        'per project and category',
      );
    });

    it('breaks a location only between folders, never inside a file name or a line range', async () => {
      const html = await build(
        'owasp',
        owaspData({
          A03: [vuln({ path: 'NodeGoat/docker-compose.yml', line: '84-93' })],
        }),
      );
      const detail = section(html, 'Injection');
      // Before the slash: the next line opens on it.
      expect(pdfLines(detail)).toContain(
        '<span class="nw">NodeGoat</span><wbr><span class="nw">/docker-compose.yml:84–93</span>',
      );
    });

    it('moves the line range of a long file name to the next line whole, the colon kept with the name', async () => {
      const html = await build(
        'owasp',
        owaspData({
          A03: [
            vuln({
              path: 'dashwright/frontend/PlaywrightTraceViewerPane.tsx',
              line: '84-93',
            }),
          ],
        }),
      );
      // A line never starts with the colon.
      expect(pdfLines(section(html, 'Injection'))).toContain(
        'frontend</span><wbr><span class="nw">/PlaywrightTraceViewerPane.tsx:</span><wbr><span class="nw">84–93</span>',
      );
      expect(section(html, 'Injection')).not.toContain('<span class="nw">:');
    });

    it('sends the lines of a file to the next line whole when they do not fit after its name', async () => {
      const at = (line: string) =>
        vuln({ path: 'src/models/inference_servers.py', line });
      const html = await build(
        'owasp',
        owaspData({ A03: ['39', '45', '52', '57'].map(at) }),
      );
      // « inference_servers.py:39, 45, » then « 52, 57 » split the list.
      expect(pdfLines(section(html, 'Injection'))).toContain(
        'inference_servers.py:</span><wbr><span class="nw">39, 45, 52, 57</span>',
      );
    });

    it('never leaves a folder alone on a line of a location', async () => {
      // Its file does not fit beside it: the folder goes with its file
      // name, the lines alone on the next line…
      const terraform = await build(
        'owasp',
        owaspData({
          A03: ['10', '24', '43', '57'].map((line) =>
            vuln({
              path: 'aibom-fullscan-test-project/terraform/main.tf',
              line,
            }),
          ),
        }),
      );
      expect(pdfLines(section(terraform, 'Injection'))).toContain(
        '<span class="nw">aibom-fullscan-test-project</span><wbr><span class="nw">/terraform/main.tf:</span><wbr><span class="nw">10, 24, 43, 57</span>',
      );
      // …or the folder before it moves down with it, in the triaged list
      // as in the tables above.
      const at = (state: string) =>
        vuln({
          state,
          path: 'dashwright/frontend/src/components/PlaywrightTraceViewer.tsx',
          line: '84-93',
        });
      const deep = await build(
        'owasp',
        owaspData({ A03: [at('to_verify'), at('resolved')] }),
      );
      const cell = (table: string) =>
        /<div class="locs">.*?<\/div><\/div>/.exec(table)?.[0];
      const triaged = cell(
        tableOf(section(deep, 'Triaged findings'), 'triaged-list'),
      );
      expect(pdfLines(triaged)).toContain(
        '<span class="nw">dashwright/frontend</span><wbr><span class="nw">/src/components/</span><wbr><span class="nw">PlaywrightTraceViewer.tsx:84–93</span>',
      );
      expect(triaged).toEqual(
        cell(tableOf(section(deep, 'Injection'), 'code-table')),
      );
    });

    it('keeps the slash before a file with its folder when, with the file, it would send its lines to a line of their own', async () => {
      const html = await build(
        'owasp',
        owaspData({
          A03: [
            vuln({
              path: 'dashwright/frontend/src/components/PlaywrightTraceViewer.tsx',
              line: '84-93',
            }),
          ],
        }),
      );
      // « /PlaywrightTraceViewer.tsx: » then « 84–93 » alone: a line more
      // than the three of the page before (« …/src/components/ » then
      // « PlaywrightTraceViewer.tsx:84–93 »).
      expect(pdfLines(section(html, 'Injection'))).toContain(
        '<span class="nw">/src/components/</span><wbr><span class="nw">PlaywrightTraceViewer.tsx:84–93</span>',
      );
      // Where it costs no line, the slash opens the line of the file.
      const short = await build(
        'owasp',
        owaspData({
          A03: [
            vuln({ path: 'NodeGoat/artifacts/cert/server.key', line: '1-2' }),
          ],
        }),
      );
      expect(pdfLines(section(short, 'Injection'))).toContain(
        '<span class="nw">/server.key:1–2</span>',
      );
    });

    it('names the OWASP reference by its code, the full address behind the link', async () => {
      const html = await build(
        'owasp',
        owaspData({ A10: [vuln({ owaspTop10: ['A10:2021'] })] }),
      );
      const detail = section(html, 'Server-Side Request Forgery');
      expect(text(detail)).toContain('OWASP reference: A10:2021');
      expect(text(detail)).not.toContain('owasp.org/Top10/A10');
      expect(detail).toContain(`href="${OWASP_TOP_10_2021_DATA.A10.url}"`);
      // A MITRE address is short: shown as such.
      const cwe = await build('cwe', cweData({ 'CWE-89': [vuln()] }));
      expect(text(section(cwe, 'SQL'))).toContain(
        'MITRE reference: cwe.mitre.org/data/definitions/89.html',
      );
    });

    it('keeps the ten-row matrix on one page', async () => {
      const html = await build('owasp', owaspData({ A03: [vuln()] }));
      expect(section(html, 'OWASP Top 10 at a glance')).toMatch(
        /<div class="avoid-break"><table/,
      );
    });

    it('never calls a category with triaged findings only "not detected": its projects read a dash, like any empty count', async () => {
      const html = await build(
        'owasp',
        owaspData({ A03: [vuln()], A01: [vuln({ state: 'resolved' })] }),
      );
      const matrix = section(html, 'OWASP Top 10 at a glance');
      const a01 = matrix.split('<tr').find((r) => r.includes('>A01<'));
      expect(text(`<tr${a01}`)).toMatch(/Broken Access Control – – 1 –$/);
      expect(text(matrix)).not.toMatch(/Not detected|Triaged only/);
    });

    it('names the categories by their official titles, in the chart as in the tables', async () => {
      const html = await build('owasp', owaspData({ A01: [vuln()] }));
      const summary = text(section(html, 'Executive summary'));
      expect(summary).toContain('A01 Broken Access Control');
      expect(summary).not.toContain('Access control');
      expect(summary).not.toContain(':2021');
      expect(text(section(html, 'OWASP Top 10 at a glance'))).toContain(
        '10 categories with open findings'.replace('10', '1 of 10'),
      );
    });

    it('shades the project and category breakdown by volume', async () => {
      const html = await build(
        'owasp',
        owaspData({ A03: [vuln(), vuln()], A01: [vuln()] }),
      );
      const heat = tableOf(
        section(html, 'OWASP Top 10 at a glance'),
        'heatmap',
      );
      // Discrete steps, the largest count in the darkest one; the column
      // of the findings outside the Top 10 is shaded like the others.
      expect(heat).toMatch(/class="heat heat-5"/);
      expect(heat).toMatch(/class="heat heat-[1-4]"/);
      expect(heat).not.toContain('style="background');
      // Every count of a category column, a dash and the total row included,
      // sits in the same box: the digits of a column end at one place.
      const cells = heat
        .split('<tbody')[1]
        .split('<tr')
        .slice(1)
        .map((r) => r.split('<td').slice(2, -1));
      for (const row of cells) {
        for (const cell of row)
          expect(cell).toMatch(/^[^>]*><span class="heat/);
      }
      expect(heat).toMatch(/<span class="heat">2<\/span>/);
    });

    it('gives the category names of the matrix one line, the counts only the room their header needs', async () => {
      const html = await build(
        'owasp',
        owaspData({
          A03: ['critical', 'high', 'medium', 'low', ''].map((severity) =>
            vuln({ severity }),
          ),
        }),
      );
      const matrix = tableOf(
        section(html, 'OWASP Top 10 at a glance'),
        'matrix',
      );
      const widths = Array.from(
        matrix.matchAll(
          /<col style="width: (?:var\(--narrow-share, )?([\d.]+)%[^"]*">/g,
        ),
      ).map((m) => Number(m[1]));
      // Eight count columns, the Unrated one included: the category keeps
      // 40% of the width, enough for « Security Logging and Monitoring
      // Failures » on one line.
      expect(widths).toHaveLength(8);
      expect(widths.reduce((n, w) => n + w, 0)).toBeLessThanOrEqual(60);
      expect(html).toMatch(
        /\.matrix th\.right, \.matrix td\.right \{[^}]*padding-left: 0/,
      );
      // The id and the name share a baseline.
      expect(html).toMatch(/\.cat-label \{[^}]*align-items: baseline/);
    });

    it('condenses the reference text from the shared OWASP data (brief, key measures, link)', async () => {
      const html = await build('owasp', owaspData({ A03: [vuln()] }));
      const detail = section(html, 'Injection');
      const ref = OWASP_TOP_10_2021_DATA.A03;
      expect(text(detail)).toContain(ref.brief);
      for (const measure of ref.keyPrevention) {
        expect(text(detail)).toContain(measure);
      }
      expect(detail).toContain(`href="${ref.url}"`);
    });

    it('lists the ten categories in a matrix, empty ones included', async () => {
      const html = await build('owasp', owaspData({ A03: [vuln()] }));
      const matrix = text(section(html, 'OWASP Top 10 at a glance'));
      for (const id of Object.keys(OWASP_TOP_10_2021_DATA)) {
        expect(matrix).toContain(OWASP_TOP_10_2021_DATA[id].title);
      }
      expect(
        bodyRows(tableOf(section(html, 'OWASP Top 10 at a glance'), 'matrix')),
      ).toHaveLength(11);
    });

    it('details only the categories with open findings, condensed (no attack scenarios, no OWASP-wide statistics)', async () => {
      const html = await build('owasp', owaspData({ A03: [vuln()] }));
      expect(html).toMatch(/<h3>Injection<\/h3>/);
      expect(html).not.toMatch(/<h3>Broken Access Control<\/h3>/);
      const body = text(html);
      expect(body).toContain('How to prevent');
      expect(body).not.toContain('Scenario #1');
      expect(body).not.toContain('Total Occurrences');
      expect(body).not.toContain('Risk Factors');
    });

    it('sorts findings by severity and merges the same finding shared by several projects', async () => {
      const shared = {
        name: 'Uncontrolled eval',
        path: 'app/routes/contributions.js',
        line: '32',
      };
      const html = await build(
        'owasp',
        owaspData({
          A03: [
            vuln({ name: 'Medium thing', severity: 'medium' }),
            vuln({ ...shared, projectName: 'billing-service' }),
            vuln({ ...shared, projectId: 'p2', projectName: 'vitality-api' }),
          ],
        }),
      );
      const rows = bodyRows(tableOf(section(html, 'Injection'), 'code-table'));
      expect(rows).toHaveLength(2);
      expect(rows[0]).toContain('Uncontrolled eval');
      expect(rows[0]).toContain('billing-service');
      expect(rows[0]).toContain('vitality-api');
      expect(rows[0]).toContain('contributions.js:32');
      // One finding per project on that line: no multiplicity mark.
      expect(rows[0]).not.toContain('×');
      expect(rows[1]).toContain('Medium thing');
    });

    it('splits a rule by severity: each row has one severity, a project is never annotated', async () => {
      const shared = {
        name: 'Template XSS',
        path: 'app/profile.html',
        line: '78',
      };
      const html = await build(
        'owasp',
        owaspData({
          A03: [
            vuln({ ...shared, severity: 'critical' }),
            vuln({
              ...shared,
              severity: 'high',
              projectId: 'p2',
              projectName: 'vitality-api',
            }),
          ],
        }),
      );
      const rows = bodyRows(tableOf(section(html, 'Injection'), 'code-table'));
      expect(rows).toHaveLength(2);
      // The scanner chip leads the line of projects, under the rule.
      expect(rows[0]).toMatch(/^Critical Template XSS SAST billing-service /);
      expect(rows[1]).toMatch(/^High Template XSS SAST vitality-api /);
      expect(text(html)).not.toMatch(/\((?:high|medium|low)\)/);
    });

    it('counts the findings behind each row, so the category total can be checked', async () => {
      const same = { name: 'Unpinned apt-get', path: 'Dockerfile', line: '11' };
      const html = await build(
        'owasp',
        owaspData({ A03: [vuln(same), vuln(same), vuln(same), vuln()] }),
      );
      const table = tableOf(section(html, 'Injection'), 'code-table');
      // « Rule » and « Count »: never « Finding » next to « Findings ».
      expect(text(table.split('<tbody>')[0].split('</tr>')[1])).toBe(
        'Severity Rule Location State Count',
      );
      const rows = plainRows(table);
      expect(rows.map((r) => r.split(' ').pop())).toEqual(['1', '3']);
      // Three findings on one line: the line says so.
      expect(rows[1]).toContain('Dockerfile:11 ×3');
    });

    it('lists the states of a row in one order, each counted when there are several', async () => {
      const at = (severity: string, state: string, line: string) =>
        vuln({ name: 'Uncontrolled eval', severity, state, line });
      const html = await build(
        'owasp',
        owaspData({
          A03: [
            at('critical', 'to_verify', '1'),
            at('critical', 'confirmed', '2'),
            at('critical', 'confirmed', '3'),
            at('high', 'confirmed', '4'),
            at('high', 'to_verify', '5'),
            at('medium', 'to_verify', '6'),
          ],
        }),
      );
      const table = tableOf(section(html, 'Injection'), 'code-table');
      const states = bodyRows(table).map((r) =>
        r.replace(/^.*query\.js:[\d, ]+ /, ''),
      );
      expect(states).toEqual([
        'Confirmed 2 To verify 1 3',
        'Confirmed 1 To verify 1 2',
        'To verify 1',
      ]);
      // The State column holds a label and its count on one line.
      const widths = Array.from(
        table.matchAll(
          /<col style="width: (?:var\(--narrow-share, )?([\d.]+)%[^"]*">/g,
        ),
      ).map((m) => Number(m[1]));
      expect(widths[2]).toBeGreaterThanOrEqual(13.5);
      // The Count column takes its header's width only (no left padding):
      // the rule titles keep their room.
      expect(widths[3]).toBeLessThanOrEqual(7);
      expect(html).toMatch(
        /\.code-table th\.right, \.code-table td\.right \{ padding-left: 0/,
      );
      // The count sits on the baseline of its label, never raised.
      expect(html).toMatch(/\.state-line \{[^}]*align-items: baseline/);
    });

    it('folds a line into the range that covers it, and counts the findings of each range', async () => {
      const at = (line: string) =>
        vuln({ name: 'Missing limits', path: 'k8s/deployment.yaml', line });
      const html = await build(
        'owasp',
        owaspData({ A03: [at('1-45'), at('20'), at('24'), at('46-58')] }),
      );
      const rows = plainRows(tableOf(section(html, 'Injection'), 'code-table'));
      expect(rows[0]).toContain('deployment.yaml:1–45 ×3, 46–58');
      expect(rows[0]).toMatch(/ 4$/);
    });

    it('merges one rule at one severity in one row, whatever the projects of each file', async () => {
      const link = (line: string, over: Vuln = {}) =>
        vuln({
          name: 'Plaintext HTTP link',
          severity: 'medium',
          path: 'NodeGoat/app/views/tutorial/a2.html',
          line,
          ...over,
        });
      const html = await build(
        'owasp',
        owaspData({
          A03: [
            link('210'),
            link('207'),
            link('209'),
            link('50', { projectId: 'p2', projectName: 'vitality-api' }),
          ],
        }),
      );
      const rows = bodyRows(tableOf(section(html, 'Injection'), 'code-table'));
      // One rule at one severity is one row (the About section says so):
      // the file is the same, its lines are merged.
      expect(rows).toHaveLength(1);
      expect(rows[0]).toContain('a2.html:50, 207, 209, 210');
      expect(rows[0]).toContain('billing-service, vitality-api');
      expect(rows[0]).toMatch(/ 4$/);
    });

    it('names the projects of a file found in some of the projects of its row only', async () => {
      const at = (path: string, line: string, over: Vuln = {}) =>
        vuln({ name: 'Eval injection', path, line, ...over });
      const html = await build(
        'owasp',
        owaspData({
          A03: [
            at('NodeGoat/app/routes/contributions.js', '32'),
            at('NodeGoat/app/routes/contributions.js', '32', {
              projectId: 'p2',
              projectName: 'vitality-api',
            }),
            at('src/utils.py', '28'),
          ],
        }),
      );
      const table = tableOf(section(html, 'Injection'), 'code-table');
      const rows = plainRows(table);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toContain('src/utils.py:28 only in billing-service');
      expect(rows[0]).not.toContain('contributions.js:32 only in');
      // A project name never breaks at its hyphen.
      expect(table).toContain(
        'only in <span class="nw">billing-service</span>',
      );
    });

    it('names the projects of a file in one form, on a line of their own under it, never breaking it', async () => {
      const at = (path: string, line: string, over: Vuln = {}) =>
        vuln({ name: 'Eval injection', path, line, ...over });
      const html = await build(
        'owasp',
        owaspData({
          A03: [
            at('src/agent.py', '37'),
            at('src/unsafe_patterns.py', '63'),
            at('src/utils.py', '28', {
              projectId: 'p3',
              projectName: 'ml-recommender',
            }),
            ...['32', '33', '34'].map((line) =>
              at('NodeGoat/app/routes/contributions.js', line, {
                projectId: 'p2',
                projectName: 'vitality-api',
              }),
            ),
          ],
        }),
      );
      const table = tableOf(section(html, 'Injection'), 'code-table');
      // One form wherever the names go, even when they would fit after the
      // lines of the file (« agent.py:37 (billing-service) » and « only in
      // billing-service » in one cell read as two notations): « only in »
      // and the names, on a line of their own, under the file. The file
      // keeps its lines on its line (« 63 » alone read as another file).
      for (const file of ['agent.py:37', 'unsafe_patterns.py:63']) {
        expect(pdfLines(table)).toContain(
          `<span class="path"><span class="nw">${file}</span></span><div class="loc-note">only in <span class="nw">billing-service</span></div>`,
        );
      }
      expect(table).not.toContain('<wbr><span class="nw">63');
      // A file whose lines fill its line: « contributions.js:32, 33, 34 »
      // stays whole.
      expect(pdfLines(table)).toContain(
        '<span class="nw">/contributions.js:32, 33, 34</span></span><div class="loc-note">only in <span class="nw">vitality-api</span></div>',
      );
      expect(html).not.toContain('loc-proj');
      // In the text face, never indented like the first line of a location,
      // and attached to what it qualifies: close under it, apart from the
      // location below.
      expect(html).toMatch(
        /\.loc-note \{[^}]*font-family: [^}]*text-indent: 0;[^}]*line-height: 1\.3;[^}]*margin-top: -1px;[^}]*padding-bottom: 3px;/,
      );
    });

    it('names the projects of a short location under it too: one form in every row', async () => {
      const at = (path: string, line: string, over: Vuln = {}) =>
        vuln({ name: 'Prompt injection', path, line, ...over });
      const html = await build(
        'owasp',
        owaspData({
          A03: [
            at('aibom-fullscan-test-project/src/llm_client.py', '15'),
            at('aibom-fullscan-test-project/src/llm_client.py', '15', {
              projectId: 'p3',
              projectName: 'ml-recommender',
            }),
            at('aibom-fullscan-test-project/src/moderation.py', '11'),
          ],
        }),
      );
      // « moderation.py:11 (billing-service) » would fit its line: the
      // names still go under it, as everywhere else.
      expect(
        pdfLines(tableOf(section(html, 'Injection'), 'code-table')),
      ).toContain(
        '<span class="path"><span class="nw">moderation.py:11</span></span><div class="loc-note">only in <span class="nw">billing-service</span></div>',
      );
    });

    it('names the projects of a folder once when all its files were found in the same ones', async () => {
      const at = (path: string, line: string, over: Vuln = {}) =>
        vuln({ name: 'Eval injection', path, line, ...over });
      const html = await build(
        'owasp',
        owaspData({
          A03: [
            at('src/agent.py', '37'),
            at('src/unsafe_patterns.py', '63'),
            at('src/utils.py', '28'),
            at('app/routes/contributions.js', '32', {
              projectId: 'p2',
              projectName: 'vitality-api',
            }),
          ],
        }),
      );
      const table = tableOf(section(html, 'Injection'), 'code-table');
      // « only in billing-service » once, under the folder, never under
      // each of its three files.
      expect(
        table.match(/only in <span class="nw">billing-service<\/span>/g),
      ).toHaveLength(1);
      expect(table).toContain(
        '<div class="loc-dir"><span class="path"><span class="nw">src/</span></span><div class="loc-note">only in <span class="nw">billing-service</span></div></div>',
      );
      expect(plainRows(table)[0]).toContain(
        'src/ only in billing-service agent.py:37 unsafe_patterns.py:63 utils.py:28',
      );
      // A folder that fills its line stays whole: its projects go on a line
      // of their own under it, above its files (« aibom-fullscan-test-
      // project/ » then « src/ » and the names read as two folders).
      const long = await build(
        'owasp',
        owaspData({
          A03: [
            at('aibom-fullscan-test-project/src/agent.py', '37'),
            at('aibom-fullscan-test-project/src/utils.py', '28'),
            at('app/routes/contributions.js', '32', {
              projectId: 'p2',
              projectName: 'vitality-api',
            }),
          ],
        }),
      );
      const cell = tableOf(section(long, 'Injection'), 'code-table');
      expect(pdfLines(cell)).toContain(
        '<div class="loc-dir"><span class="path"><span class="nw">aibom-fullscan-test-project/src/</span></span><div class="loc-note">only in <span class="nw">billing-service</span></div></div><div class="loc in-dir">',
      );
      expect(cell).not.toContain('<wbr><span class="nw">src/');
      // Once in the cell, under the folder, at the folder's indent: never
      // where its files start, where it read as the first of them.
      expect(
        cell.split('class="locs"')[1].match(/billing-service/g),
      ).toHaveLength(1);
      expect(long).not.toMatch(/\.loc-dir \.loc-note \{[^}]*padding-left/);
    });

    it('indents a folder too long for its line like a wrapped path, and its files one step further', async () => {
      const at = (file: string, line: string) =>
        vuln({
          name: 'Unsafe format string',
          path: `dashwright/integrations/npm-package/src/${file}`,
          line,
        });
      const html = await build(
        'owasp',
        owaspData({ A03: [at('reporter.ts', '177'), at('index.ts', '12')] }),
      );
      const cell = tableOf(section(html, 'Injection'), 'code-table');
      // « npm-package/src/ » never starts again at the edge, where it would
      // read as a folder of its own: the cell reads as a tree.
      expect(pdfLines(cell)).toContain(
        '<div class="loc-dir wraps"><span class="path"><span class="nw">dashwright/integrations</span><wbr><span class="nw">/npm-package/src/</span></span></div>',
      );
      expect(cell.match(/class="loc in-dir deep"/g)).toHaveLength(2);
      expect(html).toMatch(
        /\.loc-dir\.wraps \{ padding-left: 10px; text-indent: -10px; \}/,
      );
      expect(html).toMatch(/\.loc\.in-dir\.deep \{ padding-left: 30px; \}/);
      // A folder that holds its line is not indented.
      const short = await build(
        'owasp',
        owaspData({
          A03: [
            vuln({ path: 'app/views/a.html' }),
            vuln({ path: 'app/views/b.html' }),
          ],
        }),
      );
      expect(short).toContain('<div class="loc-dir"><span class="path">');
      expect(short).not.toContain('class="loc in-dir deep"');
    });

    it('names a folder once above the files of one row it holds', async () => {
      const at = (path: string, line: string) =>
        vuln({ name: 'Missing CSRF token', severity: 'medium', path, line });
      const html = await build(
        'owasp',
        owaspData({
          A03: [
            at('app/views/benefits.html', '54-63'),
            at('app/views/login.html', '107-127'),
            at('app/views/memos.html', '15-23'),
          ],
        }),
      );
      const table = tableOf(section(html, 'Injection'), 'code-table');
      expect(plainRows(table)[0]).toContain(
        'app/views/ benefits.html:54–63 login.html:107–127 memos.html:15–23',
      );
      expect(table.match(/class="loc-dir"/g)).toHaveLength(1);
      expect(table.match(/class="loc in-dir"/g)).toHaveLength(3);
      // A wrapped path is indented under its first line; files stand apart.
      // A folder line that holds its line is not indented.
      expect(html).toMatch(/\.loc \{[^}]*text-indent: -/);
      expect(html).not.toMatch(/\.loc-dir \{[^}]*text-indent/);
    });

    it('gives a path the same folder line in every row of a table', async () => {
      const k8s = 'aibom-fullscan-test-project/k8s/deployment.yaml';
      const html = await build(
        'owasp',
        owaspData({
          A05: [
            vuln({
              name: 'Privileged pod',
              type: 'iac',
              path: k8s,
              line: '1-45',
            }),
            ...['1-45', '1-45', '46-58', '46-58', '59-67', '59-67'].map(
              (line) =>
                vuln({
                  name: 'Namespace usage',
                  type: 'iac',
                  severity: 'medium',
                  path: k8s,
                  line,
                }),
            ),
          ],
        }),
      );
      const table = tableOf(
        section(html, 'Security Misconfiguration'),
        'code-table',
      );
      // As many folders as fit on the first line, in both rows: the eye
      // runs down one column of folders.
      expect(
        pdfLines(table).match(
          /<span class="nw">aibom-fullscan-test-project\/k8s<\/span>/g,
        ),
      ).toHaveLength(2);
      expect(plainRows(table)[1]).toContain(
        'aibom-fullscan-test-project/k8s/deployment.yaml:1–45 ×2, 46–58 ×2, 59–67 ×2',
      );
    });

    it('lists the files of a folder in alphabetical order', async () => {
      const at = (path: string, line: string) =>
        vuln({ name: 'Insecure deserialization', path, line });
      const html = await build(
        'owasp',
        owaspData({
          A03: [
            at('src/app.py', '49'),
            at('src/app.py', '52'),
            at('src/utils.py', '12'),
            at('src/utils.py', '14'),
            at('src/unsafe_patterns.py', '53'),
          ],
        }),
      );
      // The number of findings of a file is not shown: it never sets their
      // order either.
      expect(
        plainRows(tableOf(section(html, 'Injection'), 'code-table'))[0],
      ).toContain('src/ app.py:49, 52 unsafe_patterns.py:53 utils.py:12, 14');
    });

    it('gives each rule the lead sentence of its description, once, on a line attached to its row', async () => {
      const description = [
        '## Overview',
        '',
        '**Root cause:** The application passes `req.query` to **eval**, which runs it as code. An attacker runs arbitrary JavaScript on the server. It also reads files.',
        '',
        '- A list that is dropped',
      ].join('\n');
      const html = await build(
        'owasp',
        owaspData({
          A03: [
            vuln({ name: 'Eval injection', description }),
            vuln({ name: 'Eval injection', description, line: '50' }),
          ],
        }),
      );
      const table = tableOf(section(html, 'Injection'), 'code-table');
      const notes = noteRows(table);
      expect(notes).toHaveLength(1);
      expect(notes[0]).toMatch(/^The application passes req\.query to eval/);
      expect(notes[0]).not.toContain('Overview');
      expect(notes[0]).not.toContain('Root cause');
      expect(notes[0]).not.toContain('**');
      expect(notes[0]).not.toContain('A list that is dropped');
      expect(notes[0].length).toBeLessThanOrEqual(230);
      expect(table).toContain('<code class="code-inline">req.query</code>');
      // A Markdown escape outside code is honoured, never printed.
      const escaped = await build(
        'owasp',
        owaspData({
          A03: [
            vuln({
              description: 'Sets **Action** to **\\***, like NO\\_PROXY does.',
            }),
          ],
        }),
      );
      const note = noteRows(
        tableOf(section(escaped, 'Injection'), 'code-table'),
      )[0];
      expect(note).toMatch(/^Sets Action to \* ?, like NO_PROXY does\.$/);
      // A sentence cut short never ends on « or… ».
      const long = await build(
        'owasp',
        owaspData({
          A03: [
            vuln({
              description: `${'Policies allow write access without constraints such as conditions, restrictions '.repeat(5)}or approvals.`,
            }),
          ],
        }),
      );
      const cut = noteRows(
        tableOf(section(long, 'Injection'), 'code-table'),
      )[0];
      expect(cut).toMatch(/…$/);
      expect(cut).not.toMatch(/\b(?:or|such|as)…$/);
      expect(note).not.toContain('\\');
      // Attached to the rule row with the shared note-row mechanism.
      expect(table).toMatch(/<tr class="has-note">[\s\S]*?<tr class="note-row/);
      // It starts where the rule does: the Severity column's share of the
      // table, not of the note cell (narrower by its padding).
      expect(html).toMatch(
        /\.rule-desc \{ margin-left: calc\(11% \+ 1\.76px\)/,
      );
      // An emphasis of the scanner's text is never slanted by the browser
      // (no italic face is embedded): it reads in the medium weight.
      const em = await build(
        'owasp',
        owaspData({
          A03: [
            vuln({
              description:
                'Dockerfiles support two syntaxes: *shell form* and *JSON array form*.',
            }),
          ],
        }),
      );
      expect(section(em, 'Injection')).toContain('<em>shell form</em>');
      expect(em).toMatch(
        /\.rule-desc em \{ font-style: normal; font-weight: 500; \}/,
      );
      // A rule title wraps in balanced lines, never a word alone: Chromium
      // balances the lines of a block only.
      expect(html).toMatch(
        /\.code-table \.name, \.triaged-list \.name \{ display: block; text-wrap: balance;/,
      );
    });

    it('describes only the critical and high rules; medium and low rules stay one compact row', async () => {
      const html = await build(
        'owasp',
        owaspData({
          A03: [
            vuln({
              name: 'Severe rule',
              severity: 'high',
              description: 'A high rule does harm.',
            }),
            vuln({
              name: 'Mild rule',
              severity: 'medium',
              description: 'A medium rule does little.',
            }),
          ],
        }),
      );
      const notes = noteRows(tableOf(section(html, 'Injection'), 'code-table'));
      expect(notes).toEqual(['A high rule does harm.']);
    });

    it('reads the lead sentence of a rule as a reader would: whole sentences, no label, no list, no writing instructions', async () => {
      const lead = async (description: string): Promise<string> => {
        const html = await build(
          'owasp',
          owaspData({ A03: [vuln({ description })] }),
        );
        // Inline markup dropped without a space (« **x**. » reads « x. »).
        return noteRows(
          tableOf(section(html, 'Injection'), 'code-table').replace(
            /<\/?(?:span|strong|em|code)\b[^>]*>/g,
            '',
          ),
        )[0];
      };
      // Writing instructions left in a catalogue description are skipped,
      // and a paragraph of labelled lines gives its first one only.
      expect(
        await lead(
          [
            'A detailed, technical explanation of the vulnerability for a developer. The tone must be neutral, objective, and pragmatic. Use markdown for readability.',
            '',
            '**Vulnerability Mechanism:** The application reads a URL from user input and fetches it.  ',
            '**Root Cause:** Missing validation of the URL.',
          ].join('\n'),
        ),
      ).toBe('The application reads a URL from user input and fetches it.');
      // A label on a line of its own is dropped.
      expect(
        await lead(
          '**Overview**\nPrivate keys must remain confidential. Anyone with the repository can read them.',
        ),
      ).toBe(
        'Private keys must remain confidential. Anyone with the repository can read them.',
      );
      // A list inside the paragraph is left out, with the sentence that
      // announces it.
      expect(
        await lead(
          'Service runs with a **writable root filesystem**. Any process inside the container can:\n- **Modify** files\n- **Deploy** binaries',
        ),
      ).toBe('Service runs with a writable root filesystem.');
      // Whole sentences rather than a cut one, even when the first is short.
      const sentences = await lead(
        `The Linux capability CAP_SYS_ADMIN grants administrative privileges. ${'When this capability is added to a container, any process inside it can mount file systems, change namespaces and reach the host, '.repeat(2)}which breaks isolation.`,
      );
      expect(sentences).toBe(
        'The Linux capability CAP_SYS_ADMIN grants administrative privileges.',
      );
      // A sentence cut inside bold text never leaves its opening marks.
      const bold = await lead(
        `Containers run as root by default, which raises the risk of **${'privilege escalation and lateral movement across the node '.repeat(6)}** on the node.`,
      );
      expect(bold).toMatch(/…$/);
      expect(bold).not.toContain('**');
      // A description written in lower case starts with a capital, code
      // excepted.
      expect(await lead('firewall rule open to 0.0.0.0/0 on port 3389.')).toBe(
        'Firewall rule open to 0.0.0.0/0 on port 3389.',
      );
      expect(
        await lead('**sqlalchemy.text** runs raw SQL without escaping.'),
      ).toBe('sqlalchemy.text runs raw SQL without escaping.');
    });

    it('keeps a first sentence of up to three lines whole, and cuts a longer one between clauses', async () => {
      const lead = async (description: string): Promise<string> => {
        const html = await build(
          'owasp',
          owaspData({ A03: [vuln({ description })] }),
        );
        return noteRows(
          tableOf(section(html, 'Injection'), 'code-table').replace(
            /<\/?(?:span|strong|em|code)\b[^>]*>/g,
            '',
          ),
        )[0];
      };
      // 263 characters: whole, never « …without proper… ».
      expect(
        await lead(
          'This vulnerability occurs when IAM policies grant overly permissive access to permission management actions (like `iam:*`, `iam:AttachUserPolicy`, `iam:PutUserPolicy`) or resource exposure actions without proper conditions or resource constraints. Such policies can allow users to escalate their own privileges.',
        ),
      ).toBe(
        'This vulnerability occurs when IAM policies grant overly permissive access to permission management actions (like iam:*, iam:AttachUserPolicy, iam:PutUserPolicy) or resource exposure actions without proper conditions or resource constraints.',
      );
      // Longer than three lines: cut after a whole clause, never inside
      // parentheses nor after an adjective.
      const cut = await lead(
        `A vulnerability in AWS IAM policy definitions where unconstrained resources are specified in data-read actions (for example, \`secretsmanager:GetSecretValue\` or \`ssm:*\`), ${'which lets a principal read secrets, parameters and stored objects, '.repeat(3)}allows principals to exfiltrate all sensitive data in the account.`,
      );
      expect(cut).toMatch(/objects…$/);
      expect(cut).toContain('(for example, secretsmanager:GetSecretValue');
      expect(cut.length).toBeLessThanOrEqual(321);
    });

    it('takes the lead sentence of a description made of a list from its first item', async () => {
      const html = await build(
        'owasp',
        owaspData({
          A03: [
            vuln({
              description: [
                '- **Host PID namespace sharing** occurs when a Pod is configured with `hostPID: true`, causing the container to join the host’s process namespace.',
                '- This breaks **process isolation**, allowing container processes to trace host processes.',
              ].join('\n'),
            }),
          ],
        }),
      );
      expect(
        noteRows(tableOf(section(html, 'Injection'), 'code-table')),
      ).toEqual([
        'Host PID namespace sharing occurs when a Pod is configured with hostPID: true, causing the container to join the host’s process namespace.',
      ]);
    });

    it('gives the first item of a list announced by the lead sentence, when it says the risk in a sentence', async () => {
      const lead = async (description: string) =>
        noteRows(
          tableOf(
            section(
              await build('owasp', owaspData({ A03: [vuln({ description })] })),
              'Injection',
            ),
            'code-table',
          ).replace(/<\/?(?:span|strong|em|code)\b[^>]*>/g, ''),
        )[0];
      // « When limits are not set: » announced the risk: it is kept, with
      // the first item of its list.
      expect(
        await lead(
          [
            '**CPU limits** define the maximum CPU a container can consume on a node. When limits are not set:',
            '',
            '- A container can use all available CPU cycles if other pods are idle, causing **resource contention**.',
            '- Starved pods may experience high latency.',
          ].join('\n'),
        ),
      ).toBe(
        'CPU limits define the maximum CPU a container can consume on a node. When limits are not set: a container can use all available CPU cycles if other pods are idle, causing resource contention.',
      );
      // An item that is no sentence (« Modify files ») is left out.
      expect(
        await lead(
          'Service runs with a **writable root filesystem**. Any process inside the container can:\n- **Modify** files\n- **Deploy** binaries',
        ),
      ).toBe('Service runs with a writable root filesystem.');
    });

    it('ends the lead sentence before a label inside the paragraph, and drops the scanner’s bold', async () => {
      const notes = noteRows(
        tableOf(
          section(
            await build(
              'owasp',
              owaspData({
                A03: [
                  vuln({
                    name: 'Unencrypted HTTP Request',
                    description:
                      '**Root Cause**: The code constructs requests using the `http://` scheme, transmitting data in clear text. **Mechanism**: Any data sent over an unencrypted channel can be intercepted. **Risks**:  \n- **Data Exposure**: Confidential information can be read.',
                  }),
                  vuln({
                    name: 'Unrestricted Seccomp Profile',
                    description:
                      'Containers without a properly configured **Seccomp profile** run unconfined, permitting all system calls. **Root cause:** The container runtime defaults to an unconfined mode.',
                  }),
                ],
              }),
            ),
            'Injection',
          ),
          'code-table',
        ),
      );
      expect(notes).toEqual([
        'The code constructs requests using the http:// scheme, transmitting data in clear text.',
        'Containers without a properly configured Seccomp profile run unconfined, permitting all system calls.',
      ]);
      // The scanner's emphasis is not repeated in the lead sentence (it
      // would compete with the rule title); code stays code.
      const html = await build(
        'owasp',
        owaspData({
          A03: [
            vuln({
              description:
                'Overly permissive **ACL** on a bucket set to `public-read`.',
            }),
          ],
        }),
      );
      const note = tableOf(section(html, 'Injection'), 'code-table')
        .split('class="rule-desc">')[1]
        .split('</div>')[0];
      expect(note).not.toContain('<strong>');
      expect(note).toContain('<code class="code-inline">public-read</code>');
    });

    it('prints the description of a rule rated at two severities once, under its most severe row', async () => {
      const des = {
        name: 'Use of DES',
        description: 'DES uses a 56-bit key that can be brute-forced.',
      };
      const html = await build(
        'owasp',
        owaspData({
          A03: [
            vuln({ ...des, severity: 'critical' }),
            vuln({
              ...des,
              severity: 'high',
              projectId: 'p3',
              projectName: 'ml-recommender',
            }),
            vuln({ name: 'Other rule', severity: 'high' }),
          ],
        }),
      );
      const table = tableOf(section(html, 'Injection'), 'code-table');
      expect(bodyRows(table).map((r) => r.split(' SAST')[0])).toEqual([
        'Critical Use of DES',
        'High Other rule',
        'High Use of DES',
      ]);
      expect(noteRows(table)).toEqual([
        'DES uses a 56-bit key that can be brute-forced.',
        'Untrusted input reaches a SQL query.',
      ]);
      // The less severe row says where its description is (a high row
      // without one would read like a medium row), and where to look: above
      // (often a page before), in the row of the projects it names. On a
      // line of its own under the projects, always the same place.
      expect(bodyRows(table)[2]).toMatch(
        /^High Use of DES SAST ml-recommender see its critical row above \(billing-service\) /,
      );
      expect(table).toContain(
        '<span class="nw">ml-recommender</span><span class="rule-ref own">see its critical row above <span class="nw ref-names">(<span class="nw">billing-service)</span></span></span>',
      );
      expect(table).not.toContain('rule-ref nw');
      // The projects of the described row, as that row names them, kept
      // together: the line breaks before the parenthesis, never inside it
      // (« (billing-service, » then « vitality-api) »).
      const shared = await build(
        'owasp',
        owaspData({
          A03: [
            vuln({ ...des, severity: 'critical' }),
            vuln({
              ...des,
              severity: 'critical',
              projectId: 'p2',
              projectName: 'vitality-api',
            }),
            vuln({
              ...des,
              severity: 'high',
              projectId: 'p3',
              projectName: 'ml-recommender',
            }),
          ],
        }),
      );
      expect(tableOf(section(shared, 'Injection'), 'code-table')).toContain(
        '<span class="rule-ref own">see its critical row above <span class="nw ref-names">(<span class="nw">billing-service,</span> <span class="nw">vitality-api)</span></span></span>',
      );
      // The PDF sets them as one run of text, as before (the page holds
      // them on a line): only the preview breaks between two of them.
      const printed = await build(
        'owasp',
        owaspData({
          A03: [
            vuln({ ...des, severity: 'critical' }),
            vuln({
              ...des,
              severity: 'critical',
              projectId: 'p2',
              projectName: 'vitality-api',
            }),
            vuln({
              ...des,
              severity: 'high',
              projectId: 'p3',
              projectName: 'ml-recommender',
            }),
          ],
        }),
        { format: 'pdf' },
      );
      expect(printed).toContain(
        '<span class="rule-ref own">see its critical row above <span class="nw">(billing-service, vitality-api)</span></span>',
      );
      // Names too long for one line together break after a comma, never
      // past the column.
      const many = await build(
        'owasp',
        owaspData({
          A03: [
            ...PROJECTS_META.map((p) =>
              vuln({ ...des, projectId: p.id, projectName: p.name }),
            ),
            vuln({
              ...des,
              severity: 'high',
              projectId: 'p4',
              projectName: 'customer-portal',
            }),
          ],
        }),
      );
      expect(tableOf(section(many, 'Injection'), 'code-table')).toContain(
        'see its critical row above (<span class="nw">billing-service,</span> <span class="nw">ml-recommender,</span> <span class="nw">vitality-api)</span></span>',
      );
      expect(shared).toMatch(/\.rule-ref\.own \{[^}]*display: block/);
      // A medium or low row carries no description anywhere: it needs no
      // pointer (its line would push the rows below).
      const lower = await build(
        'owasp',
        owaspData({
          A03: [
            vuln({ ...des, severity: 'high' }),
            vuln({
              ...des,
              severity: 'medium',
              projectId: 'p3',
              projectName: 'ml-recommender',
            }),
            vuln({ name: 'Lone medium rule', severity: 'medium' }),
          ],
        }),
      );
      const rows = bodyRows(tableOf(section(lower, 'Injection'), 'code-table'));
      expect(rows[2]).toMatch(/^Medium Use of DES SAST ml-recommender /);
      expect(rows[2]).not.toContain('see its');
    });

    it('keeps a short findings table whole, with its heading, its context row hidden under it', async () => {
      for (const detailed of [true, false]) {
        const html = await build(
          'owasp',
          owaspData({ A03: [vuln(), vuln({ name: 'Other rule' })] }),
          { detailed },
        );
        const detail = section(html, 'Injection');
        // The heading travels with the whole table: its context row, hidden
        // under the heading, shows only if the rows (every file of a
        // critical rule) outgrow the page.
        expect(detail).toMatch(
          /<div class="cat-head cont-cover">[\s\S]*?<\/div><\/div>\s*<div class="avoid-break"><table class="[^"]*code-table/,
        );
        expect(text(tableOf(detail, 'code-table').split('</tr>')[0])).toBe(
          'A03 Injection · continued',
        );
      }
      // A short table under a title that it never leaves needs no name.
      const triaged = await build(
        'owasp',
        owaspData({ A03: [vuln(), vuln({ state: 'ignored' })] }),
      );
      expect(
        tableOf(section(triaged, 'Triaged findings'), 'triaged-list'),
      ).not.toContain('cont-row');
    });

    it('lists the files of one rule in one row, one per line: every file of a critical or high rule, three of a lower one', async () => {
      const at = (severity: string, path: string, line: string) =>
        vuln({ name: 'Root user', type: 'iac', severity, path, line });
      const files: [string, string][] = [
        ['docker/Dockerfile.runtime', '1-31'],
        ['Dockerfile', '1-34'],
        ['api/Dockerfile', '3'],
        ['worker/Dockerfile', '4'],
        ['jobs/Dockerfile', '5'],
      ];
      const table = async (severity: string, n: number) =>
        tableOf(
          section(
            await build(
              'owasp',
              owaspData({
                A03: files.slice(0, n).map(([p, l]) => at(severity, p, l)),
              }),
            ),
            'Injection',
          ),
          'code-table',
        );
      // A critical or high list is exhaustive: no file is ever hidden.
      for (const severity of ['critical', 'high']) {
        const list = await table(severity, 5);
        const rows = plainRows(list);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toContain(
          'api/Dockerfile:3 docker/Dockerfile.runtime:1–31 Dockerfile:1–34 jobs/Dockerfile:5 worker/Dockerfile:4',
        );
        expect(rows[0]).toMatch(/ 5$/);
        expect(list.match(/class="loc"/g)).toHaveLength(5);
        expect(list).not.toContain('more file');
      }
      // A lower rule lists three files and counts the others…
      const five = await table('medium', 5);
      expect(plainRows(five)[0]).toContain(
        'api/Dockerfile:3 docker/Dockerfile.runtime:1–31 Dockerfile:1–34 +2 more files',
      );
      expect(five.match(/class="loc"/g)).toHaveLength(3);
      // …but never hides a single file behind « +1 more file »: it takes the
      // same room.
      const four = await table('medium', 4);
      expect(four.match(/class="loc"/g)).toHaveLength(4);
      expect(four).not.toContain('more file');
    });

    it('lists every line of a critical or high rule; a lower rule lists six lines of a file and counts the others', async () => {
      const row = async (severity: string, lines: number) =>
        plainRows(
          tableOf(
            section(
              await build(
                'owasp',
                owaspData({
                  A03: Array.from({ length: lines }, (_, i) =>
                    vuln({
                      severity,
                      path: 'src/app.js',
                      line: String(10 + i),
                    }),
                  ),
                }),
              ),
              'Injection',
            ),
            'code-table',
          ),
        );
      const critical = await row('critical', 9);
      expect(critical).toHaveLength(1);
      expect(critical[0]).toContain(
        'app.js:10, 11, 12, 13, 14, 15, 16, 17, 18',
      );
      expect(critical[0]).not.toContain('more');
      expect((await row('medium', 9))[0]).toContain(
        'app.js:10, 11, 12, 13, 14, 15 +3 more',
      );
      // One line left over is shown, never counted.
      const seven = (await row('medium', 7))[0];
      expect(seven).toContain('app.js:10, 11, 12, 13, 14, 15, 16');
      expect(seven).not.toContain('more');
    });

    it('sizes every findings table explicitly (no equal columns, no header collisions)', async () => {
      const html = await build('owasp', owaspData({ A03: [vuln()] }));
      const detail = section(html, 'Injection');
      expect(detail).toMatch(/<table class="[^"]*\bfixed\b/);
      expect(detail).toContain('<colgroup>');
    });

    it('groups dependency findings by package with every advisory id and the fixed version', async () => {
      const dep = (over: Vuln) =>
        vuln({
          type: 'sca',
          name: 'Prototype pollution',
          path: undefined,
          line: undefined,
          packageName: 'lodash',
          packageVersion: '4.17.4',
          owaspTop10: [],
          cwe: [],
          ...over,
        });
      const html = await build(
        'owasp',
        owaspData({
          A06: [
            dep({
              advisoryId: 'GHSA-aaaa',
              cve: 'CVE-2020-8203',
              fixedVersion: '4.17.19',
            }),
            dep({
              advisoryId: 'GHSA-bbbb',
              cve: '',
              severity: 'high',
              fixedVersion: '4.17.21',
            }),
            dep({
              advisoryId: 'GHSA-aaaa',
              cve: 'CVE-2020-8203',
              projectId: 'p2',
              projectName: 'vitality-api',
              fixedVersion: '4.17.19',
            }),
          ],
        }),
      );
      const detail = section(html, 'Vulnerable and Outdated Components');
      const rows = bodyRows(tableOf(detail, 'dep-table'));
      expect(rows).toHaveLength(1);
      const row = rows[0];
      expect(row).toMatch(/lodash 4\.17\.4 SCA billing-service, vitality-api/);
      // A project name never breaks at its hyphen.
      expect(detail).toContain('<span class="nw">vitality-api</span>');
      expect(row).toContain('CVE-2020-8203');
      expect(row).toContain('GHSA-bbbb');
      expect(row).toContain('4.17.21');
    });

    it('lists every version of a package on one row, in version order', async () => {
      const dep = (packageVersion: string, advisoryId: string) =>
        vuln({
          type: 'sca',
          path: undefined,
          line: undefined,
          packageName: 'form-data',
          packageVersion,
          advisoryId,
          owaspTop10: [],
          cwe: [],
        });
      const html = await build(
        'owasp',
        owaspData({
          A06: [
            dep('2.3.3', 'GHSA-a'),
            dep('1.0.1', 'GHSA-b'),
            dep('2.0.0', 'GHSA-a'),
          ],
        }),
      );
      const rows = bodyRows(
        tableOf(
          section(html, 'Vulnerable and Outdated Components'),
          'dep-table',
        ),
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatch(
        /^Critical form-data 1\.0\.1, 2\.0\.0, 2\.3\.3 SCA /,
      );
      expect(rows[0]).toContain('2 advisories');
    });

    it('says how many advisories stay unfixed after the upgrade, and "No fix" when none has a fix', async () => {
      const dep = (
        packageName: string,
        advisoryId: string,
        fixedVersion = '',
      ) =>
        vuln({
          type: 'container',
          path: undefined,
          line: undefined,
          packageName,
          packageVersion: '7.5.13',
          advisoryId,
          fixedVersion,
          owaspTop10: [],
          cwe: [],
        });
      const html = await build(
        'owasp',
        owaspData({
          A06: [
            dep('tar', 'CVE-1', '7.5.16'),
            dep('tar', 'CVE-2'),
            dep('tar', 'CVE-3'),
            dep('zlib', 'CVE-4'),
          ],
        }),
      );
      const rows = bodyRows(
        tableOf(
          section(html, 'Vulnerable and Outdated Components'),
          'dep-table',
        ),
      );
      const tar = rows.find((r) => r.includes('tar'));
      expect(tar).toMatch(/7\.5\.16 2 unfixed 3$/);
      expect(rows.find((r) => r.includes('zlib'))).toMatch(/No fix 1$/);
    });

    it('prefers a final release to a pre-release of the same version, and flags a pre-release', async () => {
      const dep = (
        packageName: string,
        advisoryId: string,
        fixedVersion: string,
      ) =>
        vuln({
          type: 'sca',
          path: undefined,
          line: undefined,
          packageName,
          packageVersion: '0.0.30',
          advisoryId,
          fixedVersion,
          owaspTop10: [],
          cwe: [],
        });
      const html = await build(
        'owasp',
        owaspData({
          A06: [
            dep('langgraph', 'GHSA-1', '1.0.10rc1'),
            dep('langgraph', 'GHSA-2', '1.0.10'),
            dep('transformers', 'GHSA-3', '5.0.0rc3'),
          ],
        }),
      );
      const rows = bodyRows(
        tableOf(
          section(html, 'Vulnerable and Outdated Components'),
          'dep-table',
        ),
      );
      expect(rows.find((r) => r.includes('langgraph'))).toMatch(/ 1\.0\.10 2$/);
      expect(rows.find((r) => r.includes('transformers'))).toMatch(
        / 5\.0\.0rc3 Pre-release 1$/,
      );
    });

    it('fixes a Debian package at its highest fix, its epoch never read as the major version', async () => {
      // 8:… read as 8.0.0 made both fixes equal: the first one listed won.
      const INSTALLED = '8:6.9.11.60+dfsg-1.6ubuntu1.3';
      const LOW = '8:6.9.11.60+dfsg-1.6ubuntu1.4';
      const HIGH = '8:6.9.11.60+dfsg-1.6ubuntu1.10';
      const dep = (
        packageName: string,
        advisoryId: string,
        packageVersion: string,
        fixedVersion: string,
      ) =>
        vuln({
          type: 'container',
          path: undefined,
          line: undefined,
          packageName,
          packageVersion,
          advisoryId,
          fixedVersion,
          owaspTop10: [],
          cwe: [],
        });
      for (const [first, second] of [
        [LOW, HIGH],
        [HIGH, LOW],
      ]) {
        const html = await build(
          'owasp',
          owaspData({
            A06: [
              dep('imagemagick', 'CVE-1', INSTALLED, first),
              dep('imagemagick', 'CVE-2', INSTALLED, second),
              // A Debian rebuild (`+b1`) is no pre-release.
              dep('coreutils', 'CVE-3', '8.32-4', '8.32-4+b1'),
            ],
          }),
        );
        const rows = bodyRows(
          tableOf(
            section(html, 'Vulnerable and Outdated Components'),
            'dep-table',
          ),
        );
        // A long version may break after its separators: read it whole.
        const whole = (row: string) => row.replace(/\s+/g, '');
        const magick = whole(rows.find((r) => r.includes('imagemagick')));
        expect(magick).toContain(HIGH);
        expect(magick).not.toContain(LOW);
        const coreutils = rows.find((r) => r.includes('coreutils'));
        expect(whole(coreutils)).toContain('8.32-4+b1');
        expect(coreutils).not.toContain('Pre-release');
      }
    });

    it('names a package with the shared package chip, its first version kept with the end of its name when they fit a line', async () => {
      const dep = (packageName: string) =>
        vuln({
          type: 'container',
          path: undefined,
          line: undefined,
          packageName,
          packageVersion: '0.214.0',
          advisoryId: `CVE-${packageName}`,
          owaspTop10: [],
          cwe: [],
        });
      const html = await build(
        'owasp',
        owaspData({
          A06: [
            dep('@opentelemetry/exporter-prometheus'),
            dep('opentelemetry-instrumentation-requests-extended'),
          ],
        }),
      );
      // The shared chip breaks after the scope only, never at a hyphen; the
      // version never starts a line alone under a name that fits it…
      const detail = section(html, 'Vulnerable and Outdated Components');
      expect(detail).toContain(
        `${packageChip('@opentelemetry/exporter-prometheus')}<span class="glue">&nbsp;</span><span class="unglue"> </span><span class="versions mono">`,
      );
      // …but goes to the next line rather than overflow the column.
      expect(detail).toContain(
        `${packageChip('opentelemetry-instrumentation-requests-extended')} <span class="versions mono">`,
      );
      // A line of versions sent to the next line is indented under the
      // name, never read as another package.
      expect(detail).toContain(
        `<div class="pkg-head">${packageChip('@opentelemetry/exporter-prometheus')}<span class="glue">&nbsp;</span>`,
      );
      expect(html).toMatch(
        /\.dep-table \.pkg-head \{ padding-left: 10px; text-indent: -10px; \}/,
      );
    });

    it('keeps a scoped package chip a chip when it wraps, its version on the same line as its name', async () => {
      const html = await build('owasp', owaspData({ A03: [vuln()] }));
      // An inline chip wraps like text, never a grey block as wide as the
      // column; one chip, its cut edges open (the shared slice).
      expect(html).toMatch(
        /\.dep-table \.code-chip\.pkg \{ display: inline; \}/,
      );
    });

    it('gives a long package name a column wide enough for its longest segment', async () => {
      const html = await build(
        'owasp',
        owaspData({
          A06: [
            vuln({
              type: 'container',
              path: undefined,
              line: undefined,
              packageName: '@opentelemetry/auto-instrumentations-node',
              packageVersion: '0.72.0',
              advisoryId: 'CVE-2026-44902',
              owaspTop10: [],
              cwe: [],
            }),
          ],
        }),
      );
      const table = tableOf(
        section(html, 'Vulnerable and Outdated Components'),
        'dep-table',
      );
      const widths = Array.from(
        table.matchAll(
          /<col style="width: (?:var\(--narrow-share, )?([\d.]+)%[^"]*">/g,
        ),
      ).map((m) => Number(m[1]));
      // Severity, Package, Fixed in, Count sized; Advisories flexible. The
      // package column holds « auto-instrumentations-node » (26 characters
      // of 10px monospace, about 160px) with the cell padding.
      expect(widths[1]).toBeGreaterThanOrEqual(30);
    });

    it('names the three most severe advisory ids of a package, under a count of them all', async () => {
      const advisories = Array.from({ length: 14 }, (_, i) =>
        vuln({
          type: 'sca',
          name: `Advisory ${i}`,
          path: undefined,
          line: undefined,
          packageName: 'mlflow',
          packageVersion: '2.10.0',
          advisoryId: `GHSA-${String(i).padStart(4, '0')}`,
          cve: '',
          severity: i === 13 ? 'critical' : 'medium',
          owaspTop10: [],
          cwe: [],
        }),
      );
      const html = await build('owasp', owaspData({ A06: advisories }));
      const row = bodyRows(
        tableOf(
          section(html, 'Vulnerable and Outdated Components'),
          'dep-table',
        ),
      )[0];
      expect(row).toContain('14 advisories (1 critical, 13 medium)');
      expect(row).toContain('GHSA-0013'); // the critical one comes first
      expect(row.match(/GHSA-\d{4}/g)).toHaveLength(3);
      // The ids not named are counted, never silently dropped.
      expect(row).toContain('+11 more');
      // Each row says how many findings it stands for.
      expect(row).toMatch(/ 14$/);
      expect(text(html.split('<section class="about">')[1])).toContain(
        'the three most severe named',
      );
    });

    it('flags a withdrawn advisory, a duplicate included: still counted, named last, never setting the fixed version', async () => {
      const dep = (
        packageName: string,
        packageVersion: string,
        advisoryId: string,
        over: Vuln = {},
      ) =>
        vuln({
          type: 'sca',
          name: `Advisory ${advisoryId}`,
          description: 'An advisory.',
          path: undefined,
          line: undefined,
          packageName,
          packageVersion,
          advisoryId,
          cve: '',
          owaspTop10: [],
          cwe: [],
          ...over,
        });
      const html = await build(
        'owasp',
        owaspData({
          A06: [
            dep('express', '4.16.4', 'GHSA-qw6h-vgh9-j6wx', {
              cve: 'CVE-2024-43796',
              severity: 'low',
              fixedVersion: '4.20.0',
            }),
            dep('express', '4.16.4', 'GHSA-rv95-896h-c2vc', {
              cve: 'CVE-2024-29041',
              severity: 'medium',
              fixedVersion: '4.19.2',
            }),
            // The most severe, withdrawn: named last, its fix ignored.
            dep('express', '4.16.4', 'GHSA-pj86-cfqh-vqx6', {
              cve: 'CVE-2024-51999',
              severity: 'high',
              fixedVersion: '4.22.0',
              name: 'Withdrawn Advisory: express improperly controls modification of query properties',
              description:
                '## Withdrawn Advisory\nThis advisory has been withdrawn because it describes a correctness bug, not a vulnerability.',
            }),
            dep('uuid', '3.3.2', 'GHSA-w5hq-g745-h8pq', {
              severity: 'medium',
              fixedVersion: '14.0.0',
            }),
            dep('uuid', '3.3.2', 'GHSA-qmq6-f8pr-cx5x', {
              severity: 'medium',
              fixedVersion: '14.0.0',
              name: 'Duplicate Advisory: uuid: Missing buffer bounds check',
              description:
                '## Duplicate Advisory\nThis advisory has been withdrawn because it is a duplicate of GHSA-w5hq-g745-h8pq.',
            }),
          ],
        }),
      );
      const detail = section(html, 'Vulnerable and Outdated Components');
      const rows = bodyRows(tableOf(detail, 'dep-table'));
      const express = rows.find((r) => r.includes('express'));
      // Counted like on the dashboard: in the advisories, the severity and
      // the count of the row.
      expect(express).toMatch(/^High express 4\.16\.4 /);
      expect(express).toContain('3 advisories (1 high, 1 medium, 1 low)');
      expect(express).toContain(
        'CVE-2024-29041 CVE-2024-43796 CVE-2024-51999 Withdrawn',
      );
      // Fixed in: from the live advisories only.
      expect(express).toMatch(/ 4\.20\.0 3$/);
      expect(express).not.toContain('4.22.0');
      const uuid = rows.find((r) => r.includes('uuid'));
      // A duplicate says so: two ids, one flaw.
      expect(uuid).toContain(
        'GHSA-w5hq-g745-h8pq GHSA-qmq6-f8pr-cx5x Duplicate',
      );
      expect(uuid).toMatch(/ 14\.0\.0 2$/);
      expect(detail).toContain('<span class="tag">Withdrawn</span>');
      expect(detail).toContain('<span class="tag">Duplicate</span>');
      const summary = text(section(html, 'Executive summary'));
      // The figures keep them…
      expect(summary).toMatch(/^Executive summary 5 open findings/);
      // …the facts say where they are, and an upgrade never counts them.
      expect(summary).toContain(
        '2 open findings come from 2 withdrawn advisories (1 duplicate), flagged in A06 and still counted.',
      );
      // Every id of the facts set as in the bars beside.
      expect(section(html, 'Executive summary')).toContain(
        'flagged in <span class="code">A06</span> and still counted.',
      );
      expect(summary).toContain(
        'Upgrading express and uuid closes 3 advisories.',
      );
      const about = text(html.split('<section class="about">')[1]);
      expect(about).toContain(
        'Advisories withdrawn by their publisher are tagged Withdrawn, or Duplicate when they repeat another one; they are always named and counted, as on the CybeDefend dashboard, and never set “Fixed in”.',
      );
    });

    it('flags a withdrawn advisory from its OSV record or its text, even among the ids left unnamed', async () => {
      const dep = (packageName: string, advisoryId: string, over: Vuln = {}) =>
        vuln({
          type: 'sca',
          name: `Advisory ${advisoryId}`,
          description: 'An advisory.',
          path: undefined,
          line: undefined,
          packageName,
          packageVersion: '0.6.6',
          advisoryId,
          cve: '',
          severity: 'high',
          fixedVersion: '1.0.0',
          owaspTop10: [],
          cwe: [],
          ...over,
        });
      const html = await build(
        'owasp',
        owaspData({
          A06: [
            dep('qs', 'GHSA-1'),
            dep('qs', 'GHSA-2'),
            dep('qs', 'GHSA-3'),
            dep('qs', 'GHSA-4'),
            dep('qs', 'GHSA-crvj-3gj9-gm2p', {
              severity: 'critical',
              fixedVersion: '6.0.0',
              name: 'High severity vulnerability that affects qs',
              description: 'Withdrawn, accidental duplicate publish.',
            }),
            // Withdrawn per its OSV record, its text silent about it.
            dep('left-pad', 'GHSA-5', { withdrawn: true }),
            dep('left-pad', 'GHSA-6', { withdrawn: false }),
            dep('growl', 'GHSA-7', { withdrawn: true }),
          ],
        }),
      );
      const detail = section(html, 'Vulnerable and Outdated Components');
      const rows = bodyRows(tableOf(detail, 'dep-table'));
      const qs = rows.find((r) => r.includes(' qs '));
      // The withdrawn one is always named, after the three most severe live
      // ones and the count of the other live ones: « +1 more » never reads
      // as one more withdrawn advisory.
      expect(qs).toMatch(/^Critical qs /);
      expect(qs).toContain(
        'GHSA-1 GHSA-2 GHSA-3 +1 more GHSA-crvj-3gj9-gm2p Duplicate',
      );
      expect(qs).toMatch(/ 1\.0\.0 5$/);
      expect(rows.find((r) => r.includes('left-pad'))).toContain(
        'GHSA-6 GHSA-5 Withdrawn',
      );
      // Nothing but withdrawn advisories: no fix to point at.
      expect(rows.find((r) => r.includes('growl'))).toMatch(
        /GHSA-7 Withdrawn Withdrawn only 1$/,
      );
      expect(text(section(html, 'Executive summary'))).toContain(
        '3 open findings come from 3 withdrawn advisories (1 duplicate), flagged in A06 and still counted.',
      );
    });

    it('counts the withdrawn advisories apart from the findings they give', async () => {
      const dep = (projectId: string, projectName: string) =>
        vuln({
          type: 'sca',
          name: 'Duplicate Advisory: uuid: Missing buffer bounds check',
          description:
            'This advisory has been withdrawn because it is a duplicate of GHSA-w5hq-g745-h8pq.',
          path: undefined,
          line: undefined,
          packageName: 'uuid',
          packageVersion: '3.3.2',
          advisoryId: 'GHSA-qmq6-f8pr-cx5x',
          cve: '',
          owaspTop10: [],
          cwe: [],
          projectId,
          projectName,
        });
      const html = await build(
        'owasp',
        owaspData({
          A06: [dep('p1', 'billing-service'), dep('p2', 'vitality-api')],
        }),
      );
      // One advisory, reported in two projects: two findings.
      expect(text(section(html, 'Executive summary'))).toContain(
        '2 open findings come from 1 withdrawn advisory (a duplicate), flagged in A06 and still counted.',
      );
    });

    it('says nothing about withdrawn advisories when there are none', async () => {
      const html = await build(
        'owasp',
        owaspData({
          A06: [
            vuln({
              type: 'sca',
              path: undefined,
              line: undefined,
              packageName: 'lodash',
              packageVersion: '4.17.4',
              advisoryId: 'GHSA-1',
              fixedVersion: '4.17.21',
              owaspTop10: [],
              cwe: [],
            }),
          ],
        }),
      );
      expect(text(html)).not.toMatch(/withdrawn/i);
    });

    it('opens a category on one heading block, whole, that travels with the first rows of its table', async () => {
      const html = await build(
        'owasp',
        owaspData({
          A03: Array.from({ length: 6 }, (_, i) => vuln({ name: `Rule ${i}` })),
        }),
      );
      const detail = section(html, 'Injection');
      // Heading, severities, description and measures form one block that
      // never splits and hides the table's context row. It keeps with the
      // first rows of the table (the shared .cont-cover avoids a break after
      // it): a blank at the foot of a page rather than a heading alone, and
      // a table never opens on « continued » where it first appears.
      expect(detail).toMatch(
        /<div class="cat-head cont-cover">[\s\S]*<h3>Injection<\/h3>[\s\S]*class="cat-meta"[\s\S]*How to prevent[\s\S]*?<\/ul><\/div><\/div>\s*<table class="[^"]*has-cont/,
      );
      expect(detail.match(/cont-cover/g)).toHaveLength(1);
      expect(detail).not.toContain('<div class="cont-cover"></div>');
      expect(html).toMatch(
        /\.cat-head \{[^}]*break-inside: avoid; break-after: avoid/,
      );
      // No local override lets a page end under a heading.
      expect(html).not.toMatch(/cont-cover[^{}]*\{[^}]*break-after: auto/);
      expect(html).not.toMatch(/\.cat-head[^{}]*\{[^}]*break-after: auto/);
      expect(html).not.toContain('cover-flow');
      // The heading is right above: the measures need no category name.
      expect(text(detail)).toContain('How to prevent');
      expect(text(detail)).not.toContain('How to prevent · A03');
      // One kind of finding: no table title.
      expect(detail).not.toContain('table-title');
    });

    it('groups the categories under one chapter, each titled one level below', async () => {
      const html = await build(
        'owasp',
        owaspData({ A03: [vuln()], A01: [vuln()] }),
      );
      expect(html).toContain('<h2>Findings by category</h2>');
      expect(html).toContain('<h3>Broken Access Control</h3>');
      expect(html).not.toContain('<h2>Broken Access Control</h2>');
      const cwe = await build('cwe', cweData({ 'CWE-89': [vuln()] }));
      expect(cwe).toContain('<h2>Findings by weakness</h2>');
      expect(cwe).toContain('<h3>SQL injection</h3>');
      // The chapter opens a page: the first category never starts at the
      // foot of the matrix page, its table on the next one.
      expect(html).toMatch(
        /<section class="section chapter">\s*<div class="section-head"><div><h2>Findings by category/,
      );
      expect(html).toMatch(/\.chapter \{[^}]*break-before: page/);
      // Opening a page of the PDF, it starts at the top like every other
      // page (Chromium keeps a margin after a forced break)…
      const pdf = await build('owasp', owaspData({ A03: [vuln()] }), {
        format: 'pdf',
      });
      expect(pdf).toMatch(/\.chapter \{[^}]*margin-top: 0/);
      // …while on screen, where nothing breaks, it keeps the room of a
      // section above its heading.
      expect(html).not.toMatch(/\.chapter \{[^}]*margin-top: 0/);
    });

    it('names the category on every page a findings table continues on', async () => {
      const dep = vuln({
        type: 'sca',
        path: undefined,
        line: undefined,
        packageName: 'lodash',
        packageVersion: '4.17.4',
        advisoryId: 'GHSA-aaaa',
        owaspTop10: [],
        cwe: [],
      });
      const many = (over: Vuln) =>
        Array.from({ length: 5 }, (_, i) =>
          vuln({ ...over, name: `Rule ${i}` }),
        );
      const deps = Array.from({ length: 5 }, (_, i) => ({
        ...dep,
        id: `dep-${i}`,
        packageName: `pkg-${i}`,
      }));
      const html = await build(
        'owasp',
        owaspData({ A03: many({}), A06: [...many({ type: 'iac' }), ...deps] }),
      );
      // Chromium repeats a table header on every page: its first row names
      // the category; on the first page it hides under the block above.
      const code = tableOf(section(html, 'Injection'), 'has-cont');
      expect(code).toMatch(/<thead><tr class="cont-row"[^>]*><th colspan="5">/);
      expect(text(code.split('</tr>')[0])).toBe('A03 Injection · continued');
      const a06 = section(html, 'Vulnerable and Outdated Components');
      const tables = a06.match(/<table class="[^"]*has-cont[\s\S]*?<\/table>/g);
      expect(tables).toHaveLength(2);
      // The packages, the bulk of A06, come first, right under the heading,
      // and continue like any category's table; the other findings follow
      // under a title of their own, which reads the same on the pages their
      // table continues on. A context row never names a title the page
      // before did not show.
      expect(tables[0]).toContain('dep-table');
      expect(text(tables[0].split('</tr>')[0])).toBe(
        'A06 Vulnerable and Outdated Components · continued',
      );
      expect(text(tables[1].split('</tr>')[0])).toBe(
        'A06 Vulnerable and Outdated Components · Infrastructure findings · continued',
      );
      expect(text(a06)).toContain(
        'A06 Vulnerable and Outdated Components · Infrastructure findings · 5 rules · 5 findings',
      );
      expect(a06).not.toContain('Vulnerable packages');
      // Each continued table directly follows the block that hides its row.
      expect(a06.match(/cont-cover/g)).toHaveLength(2);
    });

    it('names the triaged list on every page it continues on', async () => {
      const html = await build(
        'owasp',
        owaspData({
          A03: [
            vuln(),
            ...Array.from({ length: 5 }, (_, i) =>
              vuln({ name: `Rule ${i}`, state: 'ignored' }),
            ),
          ],
        }),
      );
      const list = tableOf(section(html, 'Triaged findings'), 'triaged-list');
      expect(text(list.split('</tr>')[0])).toBe(
        'Critical and high triaged findings · continued',
      );
    });

    it('never invents a branch and has no branch column', async () => {
      const html = await build(
        'owasp',
        owaspData({ A03: [vuln({ branch: '' })] }),
      );
      expect(text(section(html, 'Injection'))).not.toContain('main');
    });

    it('summarises every project in scope, including one without findings', async () => {
      const html = await build(
        'owasp',
        owaspData({
          A03: [vuln(), vuln({ projectId: 'p2', projectName: 'vitality-api' })],
        }),
      );
      const projects = text(section(html, 'Projects'));
      expect(projects).toContain('billing-service');
      expect(projects).toContain('vitality-api');
      expect(projects).toContain('ml-recommender');
      expect(projects).toContain('Payments');
    });

    it('lists triaged findings in a closing section, with their state', async () => {
      const html = await build(
        'owasp',
        owaspData({
          A03: [
            vuln(),
            vuln({ name: 'Old issue', state: 'resolved', severity: 'high' }),
          ],
        }),
      );
      const triaged = text(section(html, 'Triaged findings'));
      expect(triaged).toContain('Old issue');
      expect(triaged).toContain('Resolved');
      expect(text(section(html, 'Injection'))).not.toContain('Old issue');
    });

    it('opens the triaged findings on a count per project, state and severity, with a total row', async () => {
      const html = await build(
        'owasp',
        owaspData({
          A03: [
            vuln(),
            vuln({ name: 'A', severity: 'critical', state: 'ignored' }),
            vuln({ name: 'B', severity: 'medium', state: 'ignored' }),
            vuln({ name: 'D', severity: 'high', state: 'resolved' }),
            vuln({
              name: 'C',
              severity: 'medium',
              state: 'resolved',
              projectId: 'p2',
              projectName: 'vitality-api',
            }),
          ],
        }),
      );
      const counts = tableOf(
        section(html, 'Triaged findings'),
        'triaged-counts',
      );
      // A severity no triaged finding has gets no column.
      expect(text(counts.split('<tbody>')[0])).toBe(
        'Project State Critical High Medium Total',
      );
      // The project is named on its first state row only.
      expect(bodyRows(counts)).toEqual([
        'billing-service Ignored 1 – 1 2',
        'Resolved – 1 – 1',
        'vitality-api Resolved – – 1 1',
        'Total 1 1 2 4',
      ]);
      expect(counts).toContain('<tr class="same-project">');
      expect(counts).toContain('<tr class="total-row">');
    });

    it('lists the projects of the triaged counts in the order of the projects table', async () => {
      const html = await build(
        'owasp',
        owaspData({
          A03: [
            vuln({ projectId: 'p2', projectName: 'vitality-api' }),
            vuln({ state: 'ignored' }),
            vuln({
              state: 'ignored',
              projectId: 'p2',
              projectName: 'vitality-api',
            }),
            vuln({
              state: 'resolved',
              projectId: 'p2',
              projectName: 'vitality-api',
            }),
          ],
        }),
      );
      const counts = bodyRows(
        tableOf(section(html, 'Triaged findings'), 'triaged-counts'),
      );
      expect(counts[0]).toMatch(/^vitality-api /);
      expect(counts[2]).toMatch(/^billing-service /);
    });

    it('adds an Unrated column to the triaged counts only when a triaged finding has no severity', async () => {
      const counts = async (severity: string) =>
        tableOf(
          section(
            await build(
              'owasp',
              owaspData({
                A03: [vuln(), vuln({ severity, state: 'ignored' })],
              }),
            ),
            'Triaged findings',
          ),
          'triaged-counts',
        );
      expect(await counts('high')).not.toContain('Unrated');
      expect(await counts('')).toContain('<th class="right">Unrated</th>');
    });

    it('lists only the critical and high triaged findings and says how many lower ones are left out', async () => {
      const html = await build(
        'owasp',
        owaspData({
          A03: [
            vuln(),
            vuln({
              name: 'Critical one',
              severity: 'critical',
              state: 'ignored',
            }),
            vuln({ name: 'Medium one', severity: 'medium', state: 'ignored' }),
            vuln({ name: 'Low one', severity: 'low', state: 'resolved' }),
          ],
        }),
      );
      const triaged = section(html, 'Triaged findings');
      // One list: a short title, the introduction gives the count.
      expect(triaged).toContain(
        '<h3 class="list-title cont-cover">Critical and high triaged findings</h3>',
      );
      expect(text(tableOf(triaged, 'triaged-list'))).toContain('Critical one');
      expect(text(triaged)).not.toContain('Medium one');
      expect(text(triaged)).not.toContain('Low one');
      expect(text(triaged)).toContain(
        '2 lower-severity triaged findings are not listed.',
      );

      const single = section(
        await build(
          'owasp',
          owaspData({
            A03: [
              vuln(),
              vuln({ name: 'Low one', severity: 'low', state: 'ignored' }),
            ],
          }),
        ),
        'Triaged findings',
      );
      expect(text(single)).toContain(
        '1 lower-severity triaged finding is not listed.',
      );
      expect(single).not.toContain('triaged-list');
    });

    it('lists triaged packages once per package with their versions, one row per severity, type and state', async () => {
      const dep = (over: Vuln) =>
        vuln({
          type: 'sca',
          state: 'ignored',
          path: undefined,
          line: undefined,
          packageName: 'form-data',
          owaspTop10: [],
          cwe: [],
          ...over,
        });
      const html = await build(
        'owasp',
        owaspData({
          A06: [
            dep({ packageVersion: '2.3.3', advisoryId: 'GHSA-1' }),
            dep({ packageVersion: '1.0.1', advisoryId: 'GHSA-1' }),
            dep({
              packageName: 'Unknown',
              packageVersion: 'Unknown',
              state: 'resolved',
              advisoryId: 'GHSA-2',
            }),
          ],
        }),
      );
      const triaged = section(html, 'Triaged findings');
      const list = tableOf(triaged, 'triaged-packages');
      expect(bodyRows(list)).toHaveLength(2);
      expect(text(list)).toContain('form-data 1.0.1, 2.3.3');
      expect(bodyRows(list)[0]).toMatch(
        /SCA 1 package · 1 advisory · 2 findings Ignored$/,
      );
      // A count never leaves its noun at the end of a line.
      expect(list).toContain('1\u00a0package &middot;');
      expect(list).toContain('2\u00a0findings');
      expect(text(triaged)).not.toContain('Unknown@Unknown');
      // Packages no longer identified: counted, never a list of raw ids.
      expect(bodyRows(list)[1]).toBe(
        'Critical Packages no longer identified by the scans SCA 1 advisory · 1 finding Resolved',
      );
      expect(text(list)).not.toContain('GHSA-2');
      // The rows count the packages and findings: the title does not.
      expect(triaged).toContain(
        '<h3 class="list-title cont-cover">Critical and high triaged findings</h3>',
      );
    });

    it('keeps every package of a triaged group on one row, never split into chunks', async () => {
      const deps = Array.from({ length: 30 }, (_, i) =>
        vuln({
          type: 'sca',
          state: 'ignored',
          path: undefined,
          line: undefined,
          packageName: `pkg-${String(i).padStart(2, '0')}`,
          packageVersion: '1.0.0',
          advisoryId: `GHSA-${i}`,
          owaspTop10: [],
          cwe: [],
        }),
      );
      const html = await build(
        'owasp',
        owaspData({ A03: [vuln()], A06: deps }),
      );
      const rows = bodyRows(
        tableOf(section(html, 'Triaged findings'), 'triaged-packages'),
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toContain('pkg-00 1.0.0');
      expect(rows[0]).toContain('pkg-29 1.0.0');
      expect(rows[0]).toContain('30 packages · 30 advisories · 30 findings');
    });

    it('breaks down by severity the findings of a triaged package row that holds several', async () => {
      const dep = (over: Vuln) =>
        vuln({
          type: 'sca',
          state: 'ignored',
          path: undefined,
          line: undefined,
          packageName: 'lodash',
          packageVersion: '4.17.20',
          owaspTop10: [],
          cwe: [],
          ...over,
        });
      const html = await build(
        'owasp',
        owaspData({
          A03: [vuln()],
          A06: [
            dep({ advisoryId: 'GHSA-1', severity: 'critical' }),
            dep({ advisoryId: 'GHSA-2', severity: 'high' }),
            dep({ advisoryId: 'GHSA-3', severity: 'high' }),
            dep({ packageName: 'qs', advisoryId: 'GHSA-4', severity: 'high' }),
          ],
        }),
      );
      const rows = bodyRows(
        tableOf(section(html, 'Triaged findings'), 'triaged-packages'),
      );
      // A package is listed at its most severe advisory: the Critical row
      // says that some of its findings are high, never counting them as
      // critical without a word.
      expect(rows[0]).toMatch(
        /^Critical lodash 4\.17\.20 SCA 1 package · 3 advisories · 3 findings \(1 critical, 2 high\) Ignored$/,
      );
      // A row of one severity needs no breakdown.
      expect(rows[1]).toMatch(
        /SCA 1 package · 1 advisory · 1 finding Ignored$/,
      );
    });

    it('names the families of each triaged list when there are two', async () => {
      const html = await build(
        'owasp',
        owaspData({
          A03: [vuln(), vuln({ state: 'ignored' })],
          A06: [
            vuln({
              type: 'sca',
              state: 'ignored',
              path: undefined,
              line: undefined,
              packageName: 'form-data',
              packageVersion: '2.3.3',
              advisoryId: 'GHSA-1',
              owaspTop10: [],
              cwe: [],
            }),
          ],
        }),
      );
      const titles = Array.from(
        section(html, 'Triaged findings').matchAll(
          /<h3 class="list-title cont-cover">([^<]+)</g,
        ),
      ).map((m) => m[1].trim());
      expect(titles).toEqual([
        'Critical and high triaged code findings',
        'Critical and high triaged dependency findings',
      ]);
    });

    it('lists the files of a triaged rule like the tables above', async () => {
      const at = (path: string, line: string) =>
        vuln({ name: 'Exposed bcrypt hash', state: 'ignored', path, line });
      const html = await build(
        'owasp',
        owaspData({
          A03: [
            vuln(),
            at('NodeGoat/artifacts/db-reset.js', '19'),
            at('NodeGoat/artifacts/db-reset.js', '28'),
            at('NodeGoat/artifacts/seed.js', '4'),
          ],
        }),
      );
      const list = tableOf(section(html, 'Triaged findings'), 'triaged-list');
      expect(text(list.split('<tbody>')[0])).toContain('Location');
      expect(plainRows(list)[0]).toContain(
        'NodeGoat/artifacts/ db-reset.js:19, 28 seed.js:4',
      );
      expect(list).not.toContain('more file');
      expect(list).toContain('<span class="name">Exposed bcrypt hash</span>');
    });

    it('gives the triaged locations a column wide enough for a path, projects under the finding', async () => {
      const html = await build(
        'owasp',
        owaspData({
          A03: [
            vuln(),
            vuln({ state: 'resolved' }),
            vuln({
              state: 'resolved',
              projectId: 'p2',
              projectName: 'vitality-api',
            }),
          ],
        }),
      );
      const list = tableOf(section(html, 'Triaged findings'), 'triaged-list');
      const widths = Array.from(
        list.matchAll(
          /<col style="width: (?:var\(--narrow-share, )?([\d.]+)%[^"]*">/g,
        ),
      ).map((m) => Number(m[1]));
      // Severity, Location, State, Count (Rule + projects is the flexible
      // one): the category id reads under the rule, beside its scanner
      // chip, and leaves the rule titles the room of a column.
      expect(text(list.split('<tbody>')[0])).toBe(
        'Severity Rule Location State Count',
      );
      expect(widths).toHaveLength(4);
      // As wide as in the tables above (a path breaks the same way there).
      expect(widths[1]).toBeGreaterThanOrEqual(31);
      // The State column holds a state and its count on one line, as in
      // the tables above.
      expect(widths[2]).toBeGreaterThanOrEqual(13.5);
      // The Count column takes its header's width only: the rule titles
      // keep their room.
      expect(widths[3]).toBeLessThanOrEqual(7);
      expect(100 - widths.reduce((n, w) => n + w, 0)).toBeGreaterThanOrEqual(
        36,
      );
      expect(html).toMatch(
        /\.triaged-list th\.right, \.triaged-list td\.right \{ padding-left: 0/,
      );
      expect(list).not.toContain('<th>Projects</th>');
      expect(bodyRows(list)[0]).toMatch(
        /SQL injection via raw query SAST A03 · billing-service, vitality-api/,
      );
      expect(list).toContain(
        '<span class="who"><span class="code nw">A03</span> &middot; <span class="nw">billing-service,</span>',
      );
    });

    it('gives a triaged rule one row per severity, whatever the states of its findings', async () => {
      const html = await build(
        'owasp',
        owaspData({
          A03: [
            vuln(),
            vuln({
              state: 'ignored',
              projectId: 'p2',
              projectName: 'vitality-api',
            }),
            vuln({ state: 'resolved' }),
            vuln({ name: 'Other rule', state: 'ignored' }),
          ],
        }),
      );
      const list = tableOf(section(html, 'Triaged findings'), 'triaged-list');
      // The same location triaged two ways reads as one row, each state
      // counted, as in the tables above; never two rows pages apart.
      expect(bodyRows(list)).toEqual([
        'Critical Other rule SAST A03 · billing-service src/db/query.js:42 Ignored 1',
        'Critical SQL injection via raw query SAST A03 · billing-service, vitality-api src/db/query.js:42 Ignored 1 Resolved 1 2',
      ]);
      expect(list).toContain('<div class="state-line">');
    });

    it('says when a triaged finding maps to no OWASP category, under its rule', async () => {
      const html = await build(
        'owasp',
        owaspData({ A03: [vuln()] }, [
          vuln({
            name: 'Container runs as root',
            type: 'iac',
            state: 'resolved',
            owaspTop10: [],
            cwe: [],
          }),
        ]),
      );
      const list = tableOf(section(html, 'Triaged findings'), 'triaged-list');
      expect(bodyRows(list)[0]).toMatch(
        /^Critical Container runs as root IaC not mapped · billing-service /,
      );
    });

    it('breaks a long rule title between its noun group and the phrase that follows it', async () => {
      const html = await build(
        'owasp',
        owaspData({
          A10: [
            vuln({
              name: 'Server-Side Request Forgery via Unvalidated URL',
              owaspTop10: ['A10:2021'],
            }),
          ],
          A05: [
            vuln({
              name: 'Publicly Readable S3 Bucket ACL Configuration',
              type: 'iac',
            }),
          ],
          A02: [vuln({ name: 'Use of HTTP Instead of HTTPS Server' })],
          A03: [
            vuln({
              name: 'Unrestricted Container Capabilities in Docker Compose',
              type: 'iac',
            }),
            vuln({
              name: 'Unrestricted Container Capabilities in Docker Compose',
              type: 'iac',
              state: 'resolved',
            }),
          ],
        }),
      );
      // « Server-Side Request / Forgery via… » never: the line breaks
      // before the phrase, each part kept whole while it fits the column.
      expect(section(html, 'Server-Side Request Forgery')).toContain(
        '<span class="name"><span class="ph">Server-Side Request Forgery</span> <span class="ph">via Unvalidated URL</span></span>',
      );
      expect(html).toMatch(/\.name \.ph \{[^}]*display: inline-block/);
      // A product name with a number stays with its noun (« S3 Bucket »),
      // a compound preposition whole (« Instead of »).
      expect(section(html, 'Security Misconfiguration')).toContain(
        'Publicly Readable S3&nbsp;Bucket ACL Configuration',
      );
      // which opens the phrase: « Use of HTTP / Instead of HTTPS Server ».
      expect(section(html, 'Cryptographic Failures')).toContain(
        '<span class="ph">Use of HTTP</span> <span class="ph">Instead&nbsp;of HTTPS Server</span>',
      );
      // The triaged list breaks a title the way the tables above do.
      expect(tableOf(section(html, 'Injection'), 'code-table')).toContain(
        '<span class="ph">Unrestricted Container Capabilities</span> <span class="ph">in Docker Compose</span>',
      );
      expect(
        tableOf(section(html, 'Triaged findings'), 'triaged-list'),
      ).toContain(
        '<span class="ph">Unrestricted Container Capabilities</span> <span class="ph">in Docker Compose</span>',
      );
    });

    it('keeps « Read Access » whole and breaks a title after its verb, never leaving one word alone', async () => {
      const iac = (name: string) => vuln({ name, type: 'iac' });
      const html = await build(
        'owasp',
        owaspData({
          A01: [
            iac('S3 Bucket Public Read Access Misconfiguration'),
            iac('IAM Policies Allow Unconstrained Permissions Management'),
            iac('Security Group Allows Escalation'),
          ],
        }),
      );
      const table = tableOf(
        section(html, 'Broken Access Control'),
        'code-table',
      );
      // « S3 Bucket Public / Read Access… » never: « Public Read Access »
      // is one kind of access, and the line breaks before it, the object
      // the misconfiguration applies to.
      expect(table).toContain(
        '<span class="name"><span class="ph">S3&nbsp;Bucket</span> <span class="ph">Public&nbsp;Read&nbsp;Access Misconfiguration</span></span>',
      );
      // « IAM Policies Allow Unconstrained / Permissions Management » never:
      // the adjective stays with its noun.
      expect(table).toContain(
        '<span class="ph">IAM Policies Allow</span> <span class="ph">Unconstrained Permissions Management</span>',
      );
      expect(table).toContain(
        '<span class="name">Security Group Allows Escalation</span>',
      );
    });

    it('breaks a title before the consequence or the lack it names, keeping « as » with its word', async () => {
      const iac = (name: string) => vuln({ name, type: 'iac' });
      const html = await build(
        'owasp',
        owaspData({
          A01: [
            iac(
              'Kubernetes Container Running as Root Leading to Privilege Escalation',
            ),
            vuln({ name: 'Insecure Use of Native XML Parsing Leading to XXE' }),
            iac('Host PID Namespace Sharing Privilege Escalation'),
            iac('S3 Bucket Missing Access Logging Configuration'),
            iac('Privileged Kubernetes Container Misconfiguration'),
          ],
        }),
      );
      const table = tableOf(
        section(html, 'Broken Access Control'),
        'code-table',
      );
      // « Kubernetes Container Running as / Root Leading to… » never.
      expect(table).toContain(
        '<span class="ph">Kubernetes Container Running as&nbsp;Root</span> <span class="ph">Leading to Privilege Escalation</span>',
      );
      expect(table).toContain(
        '<span class="ph">Insecure Use of Native XML Parsing</span> <span class="ph">Leading to XXE</span>',
      );
      // A title without a phrase or a verb ends on what goes wrong: the
      // line breaks before its last two words, never inside the subject
      // (« Host PID Namespace / Sharing Privilege Escalation »).
      expect(table).toContain(
        '<span class="ph">Host PID Namespace Sharing</span> <span class="ph">Privilege Escalation</span>',
      );
      expect(table).toContain(
        '<span class="ph">Privileged Kubernetes</span> <span class="ph">Container Misconfiguration</span>',
      );
      // « S3 Bucket Missing Access / Logging Configuration » never.
      expect(table).toContain(
        '<span class="ph">S3&nbsp;Bucket</span> <span class="ph">Missing Access Logging Configuration</span>',
      );
    });

    it('gives the rule titles of the triaged list the width of the tables above: a title breaks the same way in both', async () => {
      const html = await build(
        'owasp',
        owaspData({
          A04: [
            vuln({ name: 'Missing Secure Flag in Express Session Cookie' }),
            vuln({
              name: 'Missing Secure Flag in Express Session Cookie',
              state: 'resolved',
            }),
          ],
        }),
      );
      const widths = (table: string) =>
        Array.from(table.matchAll(/<col(?: style="width: ([\d.]+)%")?>/g)).map(
          (m) => m[1] ?? 'rest',
        );
      expect(
        widths(tableOf(section(html, 'Triaged findings'), 'triaged-list')),
      ).toEqual(
        widths(tableOf(section(html, 'Insecure Design'), 'code-table')),
      );
    });

    it('lays out a location of the triaged list as in the tables above', async () => {
      const at = (line: string, state: string) =>
        vuln({
          name: 'Missing Security Options',
          type: 'iac',
          state,
          path: 'NodeGoat/docker-compose.yml',
          line,
        });
      const html = await build(
        'owasp',
        owaspData({
          A05: [
            at('4', 'to_verify'),
            at('13', 'to_verify'),
            at('4', 'resolved'),
            at('13', 'resolved'),
          ],
        }),
      );
      // The same column, the same lines: « NodeGoat/docker-compose.yml:4,
      // 13 » breaks, or holds, the same way in both.
      const cell = (table: string) =>
        /<div class="locs">.*?<\/div><\/div>/.exec(table)?.[0];
      expect(
        cell(tableOf(section(html, 'Triaged findings'), 'triaged-list')),
      ).toEqual(
        cell(tableOf(section(html, 'Security Misconfiguration'), 'code-table')),
      );
      expect(
        pdfLines(
          cell(tableOf(section(html, 'Triaged findings'), 'triaged-list')),
        ),
      ).toContain('docker-compose.yml:4, 13');
    });

    it('keeps the projects of a row beside its scanner chip, a wrapped line aligned after the chip', async () => {
      const html = await build(
        'owasp',
        owaspData({
          A03: ['p1', 'p2', 'p3'].map((p, i) =>
            vuln({ projectId: p, projectName: PROJECTS_META[i].name }),
          ),
        }),
      );
      const table = tableOf(section(html, 'Injection'), 'code-table');
      expect(table).toMatch(
        /<span class="sub typed"><span class="chip">SAST<\/span><span class="who">/,
      );
      expect(html).toMatch(/\.sub\.typed \{[^}]*display: flex/);
    });

    it('escapes finding, path, project and team names', async () => {
      const html = await build('owasp', {
        ...owaspData({
          A03: [
            vuln({
              name: '<img src=x onerror=alert(1)>',
              path: 'src/<svg onload=alert(2)>.js',
              projectName: '<b>proj</b>',
            }),
          ],
        }),
        projectsMetadata: [
          { id: 'p1', name: '<b>proj</b>', teamName: '<i>team</i>' },
        ],
      });
      expect(html).not.toContain('<img src=x onerror=alert(1)>');
      expect(html).not.toContain('<svg onload=alert(2)>');
      expect(html).not.toContain('<b>proj</b>');
      expect(html).not.toContain('<i>team</i>');
    });

    it('masks secrets in finding titles and paths', async () => {
      const html = await build(
        'owasp',
        owaspData({
          A03: [
            vuln({ name: 'Hardcoded key sk_live_EXAMPLEKEYEXAMPLEKEY0000' }),
          ],
        }),
      );
      expect(html).not.toContain('EXAMPLEKEYEXAMPLEKEY0000');
    });

    it('words the triaged section and the method precisely', async () => {
      const html = await build(
        'owasp',
        owaspData({
          A03: [
            vuln(),
            vuln({ state: 'ignored' }),
            vuln({ state: 'resolved' }),
            vuln({ state: 'resolved' }),
          ],
        }),
      );
      expect(text(section(html, 'Triaged findings'))).toContain(
        '3 findings were closed during triage (1 ignored, 2 resolved); the 3 critical and high ones are listed below.',
      );
      const about = text(html.split('<section class="about">')[1]);
      expect(about).toContain(
        'the critical and high ones are listed at the end',
      );
      expect(about).toContain('(ignored, resolved, not exploitable)');
      expect(about).toContain(
        'The Count column gives the number of findings a row stands for',
      );
      expect(about).not.toMatch(/; Findings counts/);
      expect(about).not.toContain('excluded from every figure');
      // What the rows carry, as the document shows it: the opening
      // sentences on the critical and high rows only, given once per rule.
      expect(about).toContain(
        'Critical and high rows add the opening sentences of the rule’s description; a rule rated differently in two projects has one row per severity, and its description is given once, under the most severe row, which its other critical or high rows point to.',
      );
      expect(about).toContain('a row with several states counts each');
      // A file or folder found in only some of the projects of its row:
      // unambiguous.
      expect(about).toContain(
        'a file or folder found in only some of them is followed by “only in” and their names.',
      );
      expect(about).not.toContain('when they do not fit after it');
      expect(about).not.toContain('only names them');
      // A line folded into the range that covers it counts there: « ×2 »
      // after a range says so.
      expect(about).toContain(
        '×3 marks three findings of one project on the same line or within the same range',
      );
      // The method and the reading of the rows in rubrics of their own.
      const rubrics = Array.from(
        html.split('<section class="about">')[1].matchAll(/<h3>([^<]+)<\/h3>/g),
      ).map((m) => m[1]);
      expect(rubrics).toEqual([
        'Scope and method',
        'Reading the rows',
        'Reference',
        'Disclaimer',
      ]);
      expect(about).not.toContain('Two rules can share a title');
      expect(about).not.toContain('with the lead sentence of its description');
    });

    it('words a single triage state once, and names the families of the listed findings', async () => {
      const html = await build(
        'owasp',
        owaspData({
          A03: [
            vuln(),
            vuln({ name: 'A', state: 'resolved' }),
            vuln({ name: 'B', state: 'resolved', type: 'iac' }),
            vuln({ name: 'C', state: 'resolved', severity: 'low' }),
          ],
        }),
      );
      const triaged = section(html, 'Triaged findings');
      expect(text(triaged)).toContain(
        '3 findings were resolved during triage; the 2 critical and high ones are listed below (1 code, 1 infrastructure).',
      );
      // A count and its family never part at the end of a line.
      expect(triaged).toContain('(1\u00a0code, 1\u00a0infrastructure)');
      // The families and the count are the introduction's: the title of
      // the one list does not repeat them, nor does the heading.
      expect(text(triaged)).toMatch(
        /\(1 code, 1 infrastructure\)\. .* Critical and high triaged findings Severity Rule/,
      );
      expect(triaged.split('</h2>')[1].split('<p')[0]).not.toContain(
        'class="aside"',
      );
      // A title one level under the heading, never read as a context row.
      expect(html).toMatch(/\.list-title \{[^}]*font-size: 13px/);
      // One state: said in the sentence, no State column in the counts.
      const counts = tableOf(triaged, 'triaged-counts');
      expect(text(counts.split('<tbody>')[0])).toBe(
        'Project Critical Low Total',
      );
    });

    it('ranks the top five categories on one scale and says how many are left out', async () => {
      const cats = ['A01', 'A02', 'A03', 'A04', 'A05', 'A07'];
      const byCategory: Record<string, Vuln[]> = {};
      cats.forEach((id, i) => {
        byCategory[id] = Array.from({ length: 6 - i }, () => vuln());
      });
      const summary = section(
        await build('owasp', owaspData(byCategory)),
        'Executive summary',
      );
      expect(text(summary)).toContain('Top 5 categories by open findings');
      expect(text(summary)).toContain('+1 more category · 1 finding');
      // The donut's legend beside it gives the severity colours.
      expect(summary).not.toContain('split-legend');
      const widths = Array.from(
        summary.matchAll(/class="split-fill" style="width: ([\d.]+)%/g),
      ).map((m) => Number(m[1]));
      expect(widths).toEqual([100, 83.3, 66.7, 50, 33.3]);
      // Totals too far apart for one scale (the smallest under a quarter of
      // the largest): each bar spans the track and shows the severity mix
      // of its category, its total written beside.
      const skewed: Record<string, Vuln[]> = {
        A06: Array.from({ length: 40 }, () => vuln({ severity: 'high' })),
        A01: [vuln(), vuln({ severity: 'medium' })],
        A03: [vuln()],
      };
      const skewedHtml = await build('owasp', owaspData(skewed));
      const mix = section(skewedHtml, 'Executive summary');
      expect(
        Array.from(
          mix.matchAll(/class="split-fill" style="width: ([\d.]+)%/g),
        ).map((m) => Number(m[1])),
      ).toEqual([100, 100, 100]);
      expect(text(mix)).toMatch(/A06 Vulnerable and Outdated Components 40 /);
      // Bars of one length would read as equal volumes: a note says what
      // they show, only on that scale, above them (how to read the chart
      // comes before it, never after the count of the others).
      expect(text(mix)).toContain(
        'Each bar shows the severity mix of its category.',
      );
      expect(text(summary)).not.toContain('Each bar shows');
      expect(mix).toContain(
        '<p class="small split-note">Each bar shows the severity mix of its category.</p><div class="split-bars">',
      );
      expect(skewedHtml).toMatch(/\.split-note \{ margin: 0 0 8px; \}/);
      // The category id leads its label in monospace, every label aligned
      // on the longest id.
      expect(summary).toMatch(
        /<span class="hbar-id" style="min-width: 3ch;">A01<\/span>/,
      );
    });

    it('accounts for every open finding under the top five, the not mapped ones included', async () => {
      const cats = ['A01', 'A02', 'A03', 'A04', 'A05', 'A07'];
      const byCategory: Record<string, Vuln[]> = {};
      cats.forEach((id, i) => {
        byCategory[id] = Array.from({ length: 6 - i }, () => vuln());
      });
      const html = await build(
        'owasp',
        owaspData(byCategory, [
          vuln({ type: 'iac', owaspTop10: [], cwe: [] }),
          vuln({ type: 'iac', owaspTop10: [], cwe: [] }),
        ]),
      );
      expect(text(section(html, 'Executive summary'))).toContain(
        '+1 more category · 1 finding · 2 not mapped',
      );
    });

    it('opens the key facts on the category with the most critical findings, not on the first bar again', async () => {
      const html = await build(
        'owasp',
        owaspData({
          A01: Array.from({ length: 5 }, () => vuln({ severity: 'medium' })),
          A03: [vuln(), vuln(), vuln({ severity: 'high' })],
        }),
      );
      const facts = text(
        section(html, 'Executive summary').split('class="panel key-facts">')[1],
      );
      expect(facts).toMatch(
        /^Key facts A03 Injection has the most critical findings: 2 of its 3 open findings\./,
      );
      expect(facts).not.toContain('accounts for');
      // The id set as in the bars beside: monospace, in grey, a step
      // under the text.
      expect(section(html, 'Executive summary')).toContain(
        '<li><span class="code">A03</span> Injection has the most critical findings',
      );
      expect(html).toMatch(
        /\.key-facts \.code \{ font-size: 10px; font-weight: 400; color: #736c7f; \}/,
      );
    });

    it('says which project holds the critical findings, rather than repeating the projects table', async () => {
      const html = await build(
        'owasp',
        owaspData({
          A03: [
            vuln(),
            vuln(),
            vuln({ projectId: 'p2', projectName: 'vitality-api' }),
            vuln({ severity: 'high' }),
          ],
        }),
      );
      const facts = text(section(html, 'Executive summary'));
      // A fact opens on a capital, never on a project name in lower case.
      expect(facts).toContain(
        'Of the 3 critical findings, 2 (67%) are in billing-service.',
      );
      expect(facts).not.toContain('billing-service holds');
      expect(facts).not.toContain('Most exposed project');
    });

    it('gives a category its number of projects beside its open findings, apart from the severity counts', async () => {
      const html = await build(
        'owasp',
        owaspData({
          A03: [vuln(), vuln({ projectId: 'p2', projectName: 'vitality-api' })],
        }),
      );
      const detail = section(html, 'Injection');
      expect(text(detail.split('class="cat-meta"')[0])).toContain(
        '2 open findings · 2 projects',
      );
      expect(
        detail.split('class="cat-meta"')[1].split('</div>')[0],
      ).not.toContain('project');
    });

    it('says which package upgrades close the most advisories', async () => {
      const dep = (packageName: string, advisoryId: string, over: Vuln = {}) =>
        vuln({
          type: 'sca',
          path: undefined,
          line: undefined,
          packageName,
          packageVersion: '1.0.0',
          advisoryId,
          fixedVersion: '2.0.0',
          owaspTop10: [],
          cwe: [],
          ...over,
        });
      const html = await build(
        'owasp',
        owaspData({
          A06: [
            dep('mlflow', 'GHSA-1'),
            dep('mlflow', 'GHSA-2', { severity: 'high' }),
            dep('mlflow', 'GHSA-3', { fixedVersion: '' }),
            dep('gradio', 'GHSA-4'),
            dep('gradio', 'GHSA-5', { severity: 'medium' }),
            dep('axios', 'GHSA-6'),
          ],
        }),
      );
      expect(text(section(html, 'Executive summary'))).toContain(
        'Upgrading mlflow, gradio and axios closes 5 advisories, 3 of them critical.',
      );
    });

    describe('upgrade plan: every advisory counted once, closed only where it is open', () => {
      const THUMBNAILER =
        'ghcr.io/acme-corp/platform/thumbnail-renderer:2026.09.28-bookworm-slim';
      const dep = (packageName: string, advisoryId: string, over: Vuln = {}) =>
        vuln({
          type: 'sca',
          path: undefined,
          line: undefined,
          packageName,
          packageVersion: '1.0.0',
          advisoryId,
          fixedVersion: '2.0.0',
          owaspTop10: [],
          cwe: [],
          ...over,
        });
      const summaryOf = async (findings: Vuln[]) =>
        text(
          section(
            await build('owasp', owaspData({ A06: findings })),
            'Executive summary',
          ),
        );

      it('names a package once, and counts once an advisory an image also carries', async () => {
        const summary = await summaryOf([
          dep('form-data', 'CVE-2026-12143', {
            severity: 'high',
            fixedVersion: '2.5.6',
          }),
          dep('form-data', 'CVE-2025-7783', { fixedVersion: '2.5.4' }),
          dep('form-data', 'CVE-2026-12143', {
            severity: 'high',
            fixedVersion: '2.5.6',
            projectId: 'p2',
            projectName: 'vitality-api',
          }),
          dep('form-data', 'CVE-2026-12143', {
            type: 'container',
            severity: 'high',
            packageVersion: '4.0.5',
            fixedVersion: '4.0.6',
            projectId: 'p3',
            projectName: 'ml-recommender',
            image: THUMBNAILER,
          }),
          dep('ws', 'CVE-2026-48779', { fixedVersion: '5.2.5' }),
        ]);
        // « Upgrading form-data, form-data and ws closes 4 advisories »: two
        // packages of one name, and CVE-2026-12143 counted in each.
        expect(summary).toContain(
          'Upgrading form-data and ws closes 3 advisories, 2 of them critical.',
        );
      });

      it('closes an advisory of the images only with every package it is open in', async () => {
        const magick = (packageName: string, image = THUMBNAILER) =>
          dep(packageName, 'CVE-2026-25965', {
            type: 'container',
            packageVersion: '8:6.9.11.60+dfsg-1.6ubuntu1.3',
            fixedVersion: '8:6.9.11.60+dfsg-1.6ubuntu1.4',
            image,
          });
        const summary = await summaryOf([
          magick('libmagickcore-6.q16-6'),
          magick('imagemagick'),
          magick('libmagickwand-6.q16-6', 'registry.acme.io/api:7'),
          dep('ws', 'CVE-2026-48779'),
          dep('ws', 'CVE-2024-37890', { severity: 'high' }),
        ]);
        // Upgrading imagemagick alone left CVE-2026-25965 open in the two
        // libraries built from the same source, in its image and another.
        expect(summary).toContain(
          'Upgrading ws and imagemagick (and 2 related packages) closes 3 advisories, 2 of them critical.',
        );
      });

      it('never counts as closed an advisory still open without a fix elsewhere', async () => {
        const summary = await summaryOf([
          dep('lodash', 'CVE-2026-1000'),
          dep('lodash', 'CVE-2026-1000', {
            type: 'container',
            fixedVersion: '',
            image: THUMBNAILER,
          }),
          dep('ws', 'CVE-2026-48779'),
          dep('ws', 'CVE-2024-37890'),
        ]);
        expect(summary).toContain(
          'Upgrading ws closes 2 advisories, 2 of them critical.',
        );
        expect(summary).not.toContain('lodash closes');
      });
    });

    it('labels the column of the findings outside the Top 10 like the matrix does', async () => {
      const html = await build(
        'owasp',
        owaspData({ A03: [vuln()] }, [
          vuln({ type: 'iac', owaspTop10: [], cwe: [] }),
        ]),
      );
      const heat = tableOf(
        section(html, 'OWASP Top 10 at a glance'),
        'heatmap',
      );
      expect(text(heat.split('<tbody>')[0])).toMatch(/A10 Not mapped Total$/);
      expect(text(section(html, 'OWASP Top 10 at a glance'))).not.toContain(
        'None:',
      );
    });

    it('counts the triaged findings of each listed row, one severity per row', async () => {
      const html = await build(
        'owasp',
        owaspData({
          A03: [
            vuln(),
            vuln({ name: 'Old', state: 'resolved', severity: 'critical' }),
            vuln({
              name: 'Old',
              state: 'resolved',
              severity: 'high',
              line: '50',
            }),
            vuln({
              name: 'Old',
              state: 'resolved',
              severity: 'critical',
              line: '60',
            }),
          ],
        }),
      );
      const list = tableOf(section(html, 'Triaged findings'), 'triaged-list');
      expect(text(list.split('<tbody>')[0])).toMatch(/Count$/);
      expect(bodyRows(list)).toEqual([
        expect.stringMatching(/^Critical Old SAST .* Resolved 2$/),
        expect.stringMatching(/^High Old SAST .* Resolved 1$/),
      ]);
    });

    it('shows every path as scanned: one file reads the same in every row and project', async () => {
      const at = (path: string, over: Vuln = {}) => vuln({ path, ...over });
      const html = await build(
        'owasp',
        owaspData({
          A03: [
            at('NodeGoat/Dockerfile', { name: 'C' }),
            at('NodeGoat/Dockerfile', {
              name: 'H',
              projectId: 'p2',
              projectName: 'vitality-api',
            }),
            at('aibom-test-project/Dockerfile', { name: 'B' }),
          ],
        }),
      );
      const rows = plainRows(tableOf(section(html, 'Injection'), 'code-table'));
      const row = (name: string) =>
        rows.find((r) => r.includes(` ${name}SAST`));
      expect(row('C')).toContain('NodeGoat/Dockerfile:42');
      expect(row('H')).toContain('NodeGoat/Dockerfile:42');
      expect(row('B')).toContain('aibom-test-project/Dockerfile:42');
      // No note about stripped folders: nothing is stripped.
      expect(text(section(html, 'Findings by category'))).not.toContain(
        'Paths start inside',
      );
    });

    it('says when container findings were scanned from images rather than a branch', async () => {
      const html = await build(
        'owasp',
        owaspData({
          A03: [vuln()],
          A06: [
            vuln({
              type: 'container',
              branch: '',
              path: undefined,
              line: undefined,
              packageName: 'openssl',
              packageVersion: '3.0.0',
              advisoryId: 'CVE-1',
              owaspTop10: [],
              cwe: [],
            }),
          ],
        }),
      );
      // A branch and a kind of target are not listed as equals.
      expect(text(html.split('</header>')[0])).toMatch(
        /Scanned: main and container images/,
      );
    });

    it('counts the container images of the findings outside the list on the cover too', async () => {
      const html = await build(
        'cwe',
        cweData({ 'CWE-89': [vuln()] }, [
          vuln({
            type: 'container',
            branch: '',
            cwe: [],
            path: undefined,
            line: undefined,
            packageName: 'openssl',
            packageVersion: '3.0.0',
          }),
        ]),
      );
      expect(text(html.split('</header>')[0])).toMatch(
        /Scanned: main and container images/,
      );
    });

    it('styles the matrix: ids in monospace, a category with triaged findings only never greyed nor bold', async () => {
      const html = await build(
        'owasp',
        owaspData({ A03: [vuln()], A01: [vuln({ state: 'resolved' })] }),
      );
      const matrix = tableOf(
        section(html, 'OWASP Top 10 at a glance'),
        'matrix',
      );
      const a01 = matrix.split('<tr').find((r) => r.includes('>A01<'));
      const a02 = matrix.split('<tr').find((r) => r.includes('>A02<'));
      const a03 = matrix.split('<tr').find((r) => r.includes('>A03<'));
      expect(a01).toMatch(/^ class="is-triaged"/);
      expect(a02).toMatch(/^ class="is-empty"/);
      expect(a03).not.toMatch(/^ class=/);
      // Only the categories with open findings stand out in bold.
      expect(html).toMatch(/tr\.is-triaged \.name \{[^}]*font-weight: 400/);
      expect(html).toMatch(/\.code \{[^}]*font-family: 'JetBrains Mono'/);
      // The Projects column is explained.
      expect(text(section(html, 'OWASP Top 10 at a glance'))).toContain(
        'Projects: how many of the projects in scope have open findings in the category.',
      );
    });

    it('explains the severity of a package row and of rules sharing a title', async () => {
      const html = await build(
        'owasp',
        owaspData({
          A06: [
            vuln({
              type: 'sca',
              path: undefined,
              line: undefined,
              packageName: 'lodash',
              packageVersion: '4.17.4',
              advisoryId: 'GHSA-1',
              owaspTop10: [],
              cwe: [],
            }),
          ],
        }),
      );
      const about = text(html.split('<section class="about">')[1]);
      expect(about).toContain('takes the severity of its most severe advisory');
      expect(about).toContain(
        'one advisory can be reported by several sources',
      );
      expect(about).not.toContain(
        'one finding per advisory, version and project',
      );
      // Packages have a rubric of their own.
      expect(html.split('<section class="about">')[1]).toContain(
        '<h3>Vulnerable packages</h3>',
      );
    });

    it('opens the findings chapter without repeating the matrix count', async () => {
      const html = await build('owasp', owaspData({ A03: [vuln()] }));
      const head = html
        .split('<h2>Findings by category</h2>')[1]
        .split('</div>')[0];
      expect(head).not.toContain('class="aside"');
    });

    it('shows a positive empty state when nothing is open', async () => {
      const html = await build('owasp', owaspData({}));
      expect(text(html)).toContain('No open finding maps to the OWASP Top 10.');
    });
  });

  describe('CWE Top 25', () => {
    it('counts only open findings mapped to the Top 25 and lists the 25 weaknesses', async () => {
      const html = await build(
        'cwe',
        cweData({ 'CWE-89': [vuln(), vuln({ state: 'ignored' })] }, [
          vuln({ type: 'sca', cwe: [] }),
        ]),
      );
      const summary = text(section(html, 'Executive summary'));
      expect(summary).toMatch(/1 Open findings/);
      expect(summary).toContain('1 triaged, excluded');
      expect(summary).toContain(
        '1 other open finding (dependency) carries no Top 25 weakness.',
      );
      // The weakness count is in the matrix heading, not under the tile.
      expect(summary).not.toContain('in 1 of 25 weaknesses');
      // Ids in monospace, labels aligned on the longest id.
      expect(section(html, 'Executive summary')).toMatch(
        /<span class="hbar-id" style="min-width: 6ch;">CWE-89<\/span>/,
      );
      const matrix = tableOf(section(html, 'CWE Top 25 at a glance'), 'matrix');
      const rows = bodyRows(matrix);
      expect(rows.filter((r) => /CWE-\d+/.test(r))).toHaveLength(25);
      // Ranked like MITRE, closed on a total row.
      expect(text(matrix.split('<tbody>')[0])).toMatch(/^# Weakness /);
      // 25 rows and a total: always on one page.
      expect(section(html, 'CWE Top 25 at a glance')).toContain(
        '<div class="avoid-break"><table',
      );
      expect(rows[0]).toMatch(/^1 CWE-79 Cross-site scripting /);
      expect(rows[rows.length - 1]).toMatch(/^Total 1 1 1 /);
    });

    it('names a weakness as a weakness, never as a practice', async () => {
      const html = await build(
        'cwe',
        cweData({
          'CWE-20': [vuln({ cwe: ['CWE-20'] })],
          'CWE-269': [vuln({ cwe: ['CWE-269'] })],
        }),
      );
      expect(html).toContain('<h3>Improper input validation</h3>');
      expect(html).toContain('<h3>Improper privilege management</h3>');
    });

    it('centres the bullets of the prevention measures on the letters of their 10px text', async () => {
      const html = await build('cwe', cweData({ 'CWE-79': [vuln()] }));
      // 0.6em (the key facts' 11.5px text) set them 1px under the middle of
      // the lowercase letters at 10px, their foot under the baseline
      // (measured at 600 dpi on the rendered PDF).
      const reset = html.indexOf('.ref li::before { top: 0.5em; }');
      expect(reset).toBeGreaterThan(html.indexOf('.ref li::before { content'));
    });

    it('uses typographic apostrophes in the reference texts', async () => {
      const html = await build('cwe', cweData({ 'CWE-79': [vuln()] }));
      const detail = text(section(html, 'Cross-site scripting'));
      expect(detail).toContain('victim’s browser');
      expect(detail).not.toMatch(/\w'\w/);
    });

    it('styles the CWE ids of the triaged list like everywhere else', async () => {
      const html = await build(
        'cwe',
        cweData({ 'CWE-89': [vuln(), vuln({ state: 'resolved' })] }),
      );
      const list = tableOf(section(html, 'Triaged findings'), 'triaged-list');
      expect(list).toMatch(/<span class="code nw">CWE-89<\/span>/);
      expect(
        tableOf(section(html, 'CWE Top 25 at a glance'), 'matrix'),
      ).toMatch(/<span class="code">CWE-89<\/span>/);
    });

    it('spells out every weakness name, CSRF and SSRF included', async () => {
      const html = await build(
        'cwe',
        cweData({ 'CWE-352': [vuln({ cwe: ['CWE-352'] })] }),
      );
      expect(html).toContain('<h3>Cross-site request forgery (CSRF)</h3>');
      expect(text(section(html, 'CWE Top 25 at a glance'))).toContain(
        'CWE-918 Server-side request forgery (SSRF)',
      );
    });

    it('keeps each MITRE fact whole and writes "no CVE" rather than "0 CVEs"', async () => {
      const html = await build(
        'cwe',
        cweData({ 'CWE-352': [vuln({ cwe: ['CWE-352'] })] }),
      );
      const detail = section(html, 'Cross-site request forgery');
      expect(text(detail)).not.toContain('0 CVEs');
      expect(text(detail)).toContain('no known exploited CVE (CISA KEV)');
      expect(detail).toMatch(
        /<span class="nw">#\d+ in 2023 \((?:(?:up|down) \d+(?: |&#160;)places?|stable)\)<\/span>/,
      );
      // The statistics together on one line, the separator never left at
      // the end of a line.
      expect(html).toMatch(/\.ref-stats \{[^}]*white-space: nowrap/);
      // The official name on its own line, when it says more than the
      // title (« Cross-Site Request Forgery (CSRF) » only repeats it: the
      // title carries the acronym instead).
      expect(detail).toMatch(/<p class="ref-meta"><span class="ref-stats">/);
      expect(detail).not.toContain('ref-name');
      const xss = await build('cwe', cweData({ 'CWE-79': [vuln()] }));
      expect(section(xss, 'Cross-site scripting')).toMatch(
        /<p class="ref-meta"><span class="ref-name">Improper Neutralization of Input During Web Page Generation \(&#8216;Cross-site Scripting&#8217;\)<\/span><span class="ref-stats">/,
      );
    });

    it('says that a finding counts under a weakness only when its rule names it exactly', async () => {
      const html = await build('cwe', cweData({ 'CWE-89': [vuln()] }));
      const about = text(html.split('<section class="about">')[1]);
      expect(about).toContain(
        'A finding counts only when its rule or advisory names one of the 25 identifiers exactly: related weaknesses are not folded in (CWE-95 is not counted under CWE-94, nor CWE-770 under CWE-400).',
      );
    });

    it('says nothing about vulnerable packages in a report that has none', async () => {
      const html = await build('cwe', cweData({ 'CWE-89': [vuln()] }));
      const about = text(html.split('<section class="about">')[1]);
      expect(about).not.toMatch(/vulnerable package/i);
    });

    it('presents MITRE metadata as context, with a link to the CWE definition', async () => {
      const html = await build('cwe', cweData({ 'CWE-89': [vuln()] }));
      const detail = section(html, 'SQL');
      // The 2024 rank is in the heading; the line gives last year's.
      expect(text(detail)).toContain('CWE-89 · Rank 3');
      expect(text(detail)).toContain('#3 in 2023 (stable)');
      expect(detail).toContain(
        'href="https://cwe.mitre.org/data/definitions/89.html"',
      );
      expect(text(detail)).not.toContain('Last Year Rank');
    });

    it('names the weakness on every page its findings table continues on', async () => {
      const html = await build(
        'cwe',
        cweData({
          'CWE-89': Array.from({ length: 5 }, (_, i) =>
            vuln({ name: `Rule ${i}` }),
          ),
        }),
      );
      const table = tableOf(section(html, 'SQL'), 'has-cont');
      expect(text(table.split('</tr>')[0])).toBe(
        'CWE-89 SQL injection · continued',
      );
    });

    it('titles a weakness with its plain-words name and gives the MITRE-based prevention measures', async () => {
      const html = await build('cwe', cweData({ 'CWE-89': [vuln()] }));
      const ref = CWE_TOP_25_2024_DATA['CWE-89'];
      expect(html).toContain(`<h3>${ref.shortName}</h3>`);
      const detail = text(section(html, ref.shortName));
      expect(detail).toContain('How to prevent');
      for (const measure of ref.mitigations ?? []) {
        expect(detail).toContain(measure);
      }
    });
  });

  describe('License compliance', () => {
    it('keeps the category tiles reconcilable with the total', async () => {
      const html = await build(
        'license',
        licenseData([
          pkg(),
          pkg({ packageName: 'b' }),
          pkg({
            packageName: 'mystery',
            licenses: [],
            category: 'UNKNOWN',
            effectiveLicenses: ['UNKNOWN'],
          }),
        ]),
      );
      const summary = text(section(html, 'Executive summary'));
      expect(summary).toMatch(/3 Packages in 1 of 3 projects/);
      expect(summary).toMatch(/2 Permissive/);
      expect(summary).toMatch(/1 Unknown/);
    });

    it('counts packages, not versions, everywhere, and gives the versions apart', async () => {
      const html = await build(
        'license',
        licenseData([
          pkg({ packageName: 'a', packageVersion: '1.0.0' }),
          pkg({ packageName: 'a', packageVersion: '2.0.0' }),
          pkg({ packageName: 'b' }),
          pkg({
            packageName: 'psycopg2',
            ecosystem: 'pip',
            packageVersion: '2.8.6',
            category: 'WEAK_COPYLEFT',
            licenses: ['LGPL-3.0-only'],
            effectiveLicenses: ['LGPL-3.0-only'],
          }),
          pkg({
            packageName: 'psycopg2',
            ecosystem: 'pip',
            packageVersion: '2.9.5',
            category: 'WEAK_COPYLEFT',
            licenses: ['LGPL-3.0-only'],
            effectiveLicenses: ['LGPL-3.0-only'],
          }),
        ]),
      );
      const summary = text(section(html, 'Executive summary'));
      // The package total is the lead tile: the aside gives the rest.
      expect(summary).toMatch(
        /^Executive summary 5 versions · 2 licenses 3 Packages/,
      );
      expect(summary).not.toMatch(/\buses?\b/);
      const copyleft = section(html, 'Copyleft licenses');
      expect(text(copyleft)).toContain('1 package · 2 versions');
      // The only license of its section: the section counts it, its
      // heading names it (never the same count twice on one screen).
      expect(text(copyleft)).toContain(
        'GNU Lesser General Public License v3.0 only LGPL-3.0-only Package Versions',
      );
      expect(text(copyleft).match(/1 package · 2 versions/g)).toHaveLength(1);
      expect(bodyRows(tableOf(copyleft, 'pkg-table'))).toHaveLength(1);
      const permissive = bodyRows(
        tableOf(section(html, 'Permissive licenses'), 'license-table'),
      );
      expect(permissive[0]).toMatch(/^MIT License MIT 2 1$/);
      // Every section heading gives packages and versions alike.
      for (const title of [
        'Permissive licenses',
        'Permissive package inventory',
      ]) {
        expect(text(section(html, title).split('</div></div>')[0])).toContain(
          '2 packages · 3 versions',
        );
      }
      // So does every license of the appendix, a small one included.
      expect(text(section(html, 'Permissive package inventory'))).toContain(
        'MIT License MIT · 2 packages · 3 versions',
      );
    });

    it('counts each copyleft license in its heading when the section lists several', async () => {
      const copyleft = (name: string, id: string, category: string) =>
        pkg({
          packageName: name,
          category,
          licenses: [id],
          effectiveLicenses: [id],
        });
      const html = await build(
        'license',
        licenseData([
          copyleft('gpl-lib', 'GPL-3.0-only', 'STRONG_COPYLEFT'),
          copyleft('paramiko', 'LGPL-3.0-only', 'WEAK_COPYLEFT'),
          copyleft('psycopg2', 'LGPL-3.0-only', 'WEAK_COPYLEFT'),
        ]),
      );
      const section_ = text(section(html, 'Copyleft licenses'));
      expect(section_).toMatch(/^Copyleft licenses 3 packages /);
      expect(section_).toContain('GPL-3.0-only · 1 package');
      expect(section_).toContain('LGPL-3.0-only · 2 packages');
    });

    it('names the ecosystem of each package', async () => {
      const html = await build(
        'license',
        licenseData([
          pkg({ packageName: 'left-pad' }),
          pkg({ packageName: 'flask', ecosystem: 'pip' }),
          pkg({
            packageName: 'cohere',
            ecosystem: 'pip',
            licenses: [],
            category: 'UNKNOWN',
            effectiveLicenses: ['UNKNOWN'],
          }),
        ]),
      );
      expect(
        bodyRows(tableOf(section(html, 'Unknown licenses'), 'pkg-table'))[0],
      ).toMatch(/^cohere PyPI /);
      // The ecosystem is a neutral chip, never plain text next to a name.
      expect(section(html, 'Unknown licenses')).toContain(
        '<span class="chip">PyPI</span>',
      );
      const inventory = text(section(html, 'Permissive package inventory'));
      expect(inventory).toContain('npm left-pad 1.3.0');
      expect(inventory).toContain('PyPI flask 1.3.0');
    });

    it('names the other license of a package listed under several licenses, a different license per version included', async () => {
      const html = await build(
        'license',
        licenseData([
          pkg({
            packageName: 'json-schema',
            licenses: ['MIT', 'ISC'],
            effectiveLicenses: ['MIT', 'ISC'],
          }),
          pkg({ packageName: 'entities', packageVersion: '2.2.0' }),
          pkg({
            packageName: 'entities',
            packageVersion: '1.0.0',
            licenses: ['ISC'],
            effectiveLicenses: ['ISC'],
          }),
          pkg({ packageName: 'left-pad' }),
        ]),
      );
      const inventory = text(section(html, 'Permissive package inventory'));
      // The same version under two licenses: « also ».
      expect(inventory).toContain('json-schema 1.3.0 also ISC');
      expect(inventory).toContain('json-schema 1.3.0 also MIT');
      // A license that changes with the version is never read as a dual
      // license of the versions listed: the other versions are named, in the
      // singular when there is one.
      expect(inventory).toContain('entities 2.2.0 (1.0.0 under ISC)');
      expect(inventory).toContain('entities 1.0.0 (2.2.0 under MIT)');
      expect(inventory).not.toContain('other versions');
      expect(inventory).not.toContain('entities 2.2.0 also');
      expect(inventory).not.toMatch(/left-pad 1\.3\.0 (?:also|other)/);
      expect(inventory).not.toContain('*');
      // The note stays with its entry: never alone at the start of a line.
      const raw = section(html, 'Permissive package inventory');
      expect(raw).toContain('&nbsp;<span class="also nw">');
      expect(raw).not.toMatch(/ <span class="also/);
      // The listings exceed the packages: said, not left to the reader.
      expect(text(section(html, 'Permissive licenses'))).toContain(
        '2 packages are listed under several licenses (combined licenses, or a different license per version), so the rows add up to 5.',
      );
    });

    it('lists a package with a permissive and an unknown version under Unknown only, where it is counted', async () => {
      const html = await build(
        'license',
        licenseData([
          pkg({ packageName: 'left-pad' }),
          pkg({ packageName: 'mixed', packageVersion: '1.0.0' }),
          pkg({
            packageName: 'mixed',
            packageVersion: '2.0.0',
            licenses: [],
            category: 'UNKNOWN',
            effectiveLicenses: ['UNKNOWN'],
          }),
        ]),
      );
      expect(text(section(html, 'Unknown licenses'))).toContain('mixed');
      expect(text(section(html, 'Permissive package inventory'))).not.toContain(
        'mixed',
      );
      const permissive = text(section(html, 'Permissive licenses'));
      expect(permissive).toMatch(/MIT License MIT 1 1/);
      expect(permissive).not.toContain('rows add up');
    });

    it('keeps the licenses accepted during triage out of the figures and lists them apart', async () => {
      const html = await build(
        'license',
        licenseData([
          pkg(),
          pkg({
            packageName: 'mystery',
            licenses: [],
            category: 'UNKNOWN',
            effectiveLicenses: ['UNKNOWN'],
            licenseIgnored: true,
          }),
          pkg({
            packageName: 'other',
            licenses: [],
            category: 'UNKNOWN',
            effectiveLicenses: ['UNKNOWN'],
          }),
        ]),
      );
      const summary = text(section(html, 'Executive summary'));
      // Tiles that add up: 1 permissive + 1 unknown + 1 accepted = 3.
      expect(summary).toMatch(/3 Packages/);
      expect(summary).toMatch(/1 Unknown/);
      expect(summary).toMatch(/1 Accepted/);
      // The Accepted tile says it; « excluded » said nothing true (the
      // Packages tile counts them).
      expect(summary).not.toContain('excluded');
      expect(summary).toContain('1 package (33%) declares no license');
      const accepted = section(html, 'Accepted during triage');
      expect(text(accepted)).toContain('mystery');
      expect(
        bodyRows(tableOf(section(html, 'Unknown licenses'), 'pkg-table')),
      ).toHaveLength(1);
    });

    it('says one thing of the licenses accepted during triage: counted in the package totals, in no license category', async () => {
      const html = await build(
        'license',
        licenseData([
          pkg(),
          pkg({ projects: ['ml-recommender'] }),
          pkg({
            packageName: 'mystery',
            licenses: [],
            category: 'UNKNOWN',
            effectiveLicenses: ['UNKNOWN'],
            licenseIgnored: true,
          }),
        ]),
      );
      // The Packages tile and column count them, as the Projects note says.
      expect(text(section(html, 'Projects'))).toContain(
        'counts in Packages only',
      );
      const accepted = text(section(html, 'Accepted during triage'));
      expect(accepted).toContain('Excluded from the review');
      expect(accepted).toContain(
        'they count in the package totals only, in no license category above.',
      );
      const about = text(html.split('About this report')[1] ?? '');
      expect(about).toContain(
        'a package whose license was accepted during triage counts in the package totals only, in no license category',
      );
      // What contradicted it: « counted in no figure above », « left out of
      // the figures », « Excluded from the figures ».
      expect(text(html)).not.toMatch(
        /no figure|out of the figures|from the figures/,
      );
    });

    it('lists the versions of a package in version order: a pre-release before its release, an epoch before a higher major', async () => {
      const html = await build(
        'license',
        licenseData([
          pkg({ packageName: 'next', packageVersion: '15.0.0' }),
          pkg({ packageName: 'next', packageVersion: '15.0.0-canary.123' }),
          pkg({ packageName: 'next', packageVersion: '14.2.3' }),
        ]),
      );
      // « Versions in numeric order » listed 15.0.0 before its canary.
      expect(text(html)).toContain('next 14.2.3, 15.0.0-canary.123, 15.0.0');
      const vulnerable = await build(
        'owasp',
        owaspData({
          A06: ['2:1.0.2-1', '1:3.0.7-28'].map((packageVersion) =>
            vuln({
              type: 'container',
              path: undefined,
              line: undefined,
              packageName: 'openssl',
              packageVersion,
              advisoryId: 'CVE-2026-1',
              owaspTop10: [],
              cwe: [],
            }),
          ),
        }),
      );
      expect(
        bodyRows(
          tableOf(
            section(vulnerable, 'Vulnerable and Outdated Components'),
            'dep-table',
          ),
        )[0],
      ).toContain('openssl 1:3.0.7-28, 2:1.0.2-1');
    });

    it('keeps the licenses accepted during triage out of the counts of each project, as out of the tiles', async () => {
      const gpl = (packageName: string, over: Vuln = {}) =>
        pkg({
          packageName,
          licenses: ['GPL-3.0-only'],
          category: 'STRONG_COPYLEFT',
          effectiveLicenses: ['GPL-3.0-only'],
          licenseIgnored: true,
          ...over,
        });
      // As the aggregation counts them: a package once, at its most
      // restrictive version (libtiff6: strong), accepted ones included.
      const byCategory = {
        permissive: 1,
        weakCopyleft: 0,
        strongCopyleft: 3,
        unknown: 0,
      };
      const data = licenseData(
        [
          pkg(),
          gpl('ghostscript'),
          gpl('libtiff6', { packageVersion: '4.5.0' }),
          gpl('libtiff6', {
            packageVersion: '4.5.1',
            licenses: ['LGPL-3.0-only'],
            category: 'WEAK_COPYLEFT',
            effectiveLicenses: ['LGPL-3.0-only'],
          }),
          gpl('bash', { licenseIgnored: false }),
        ],
        [
          {
            projectName: 'billing-service',
            teamName: 'Payments',
            branches: ['main'],
            packages: 4,
            byCategory,
          },
          {
            projectName: 'ml-recommender',
            teamName: 'Data',
            branches: [],
            packages: 0,
            byCategory: {
              permissive: 0,
              weakCopyleft: 0,
              strongCopyleft: 0,
              unknown: 0,
            },
          },
        ],
      );
      data.summary.byCategory = byCategory;
      const html = await build('license', data);
      const summary = text(section(html, 'Executive summary'));
      expect(summary).toMatch(/1 Copyleft/);
      expect(summary).toMatch(/2 Accepted/);
      const projects = section(html, 'Projects');
      // The row said 3 strong copyleft packages, the organization 1.
      expect(bodyRows(tableOf(projects, 'compact'))[0]).toBe(
        'billing-service · Payments 4 1 – 1 –',
      );
      expect(text(projects)).toContain(
        'A package used by several projects is counted in each of them. One whose license was accepted during triage counts in Packages only.',
      );
    });

    it('takes the accepted packages out of the project they were accepted in, by its id: never out of a project of the same name in another team', async () => {
      const both = { projects: ['customer-portal'] };
      const data = licenseData(
        [
          pkg({ ...both, projectIds: ['web', 'platform'] }),
          pkg({
            ...both,
            projectIds: ['web'],
            packageName: 'ghostscript',
            licenses: ['GPL-3.0-only'],
            category: 'STRONG_COPYLEFT',
            effectiveLicenses: ['GPL-3.0-only'],
            licenseIgnored: true,
          }),
        ],
        [
          {
            projectId: 'web',
            projectName: 'customer-portal',
            teamName: 'Web',
            branches: ['main'],
            packages: 2,
            byCategory: {
              permissive: 1,
              weakCopyleft: 0,
              strongCopyleft: 1,
              unknown: 0,
            },
          },
          {
            projectId: 'platform',
            projectName: 'customer-portal',
            teamName: 'Platform',
            branches: ['main'],
            packages: 1,
            byCategory: {
              permissive: 1,
              weakCopyleft: 0,
              strongCopyleft: 0,
              unknown: 0,
            },
          },
        ],
      );
      const html = await build('license', data);
      const rows = bodyRows(tableOf(section(html, 'Projects'), 'compact'));
      // Matched by name, the Platform project lost a package it never had
      // (« -1 » strong copyleft).
      expect(rows).toEqual([
        'customer-portal · Web 2 1 – – –',
        'customer-portal · Platform 1 1 – – –',
      ]);
    });

    it('never prints a negative count for a project, even when data without project ids names two projects alike', async () => {
      const data = licenseData(
        [
          pkg({
            projects: ['customer-portal'],
            packageName: 'ghostscript',
            licenses: ['GPL-3.0-only'],
            category: 'STRONG_COPYLEFT',
            effectiveLicenses: ['GPL-3.0-only'],
            licenseIgnored: true,
          }),
        ],
        ['Web', 'Platform'].map((teamName) => ({
          projectName: 'customer-portal',
          teamName,
          branches: ['main'],
          packages: teamName === 'Web' ? 1 : 0,
          byCategory: {
            permissive: 0,
            weakCopyleft: 0,
            strongCopyleft: teamName === 'Web' ? 1 : 0,
            unknown: 0,
          },
        })),
      );
      const projects = text(section(await build('license', data), 'Projects'));
      expect(projects).not.toMatch(/-\d/);
    });

    it('labels each index row by guide words: unique, ordered, never overlapping, never « -– »', async () => {
      const names = [
        ...Array.from(
          { length: 30 },
          (_, i) => `is-${String.fromCharCode(97 + (i % 26))}${i}`,
        ),
        'isarray',
        'isobject',
        'jade',
        'p-finally',
        'p-map',
        ...Array.from(
          { length: 26 },
          (_, i) => `pa${String.fromCharCode(97 + i)}`,
        ),
        'q',
        'querystring',
        ...Array.from(
          { length: 20 },
          (_, i) => `r${String.fromCharCode(97 + i)}x`,
        ),
      ];
      const html = await build(
        'license',
        licenseData(names.map((packageName) => pkg({ packageName }))),
      );
      const index = tableOf(
        section(html, 'Permissive package inventory'),
        'inventory-index',
      );
      const labels = Array.from(
        index.matchAll(/<span class="initial">([\s\S]*?)<\/span><\/td>/g),
      ).map((m) => m[1].replace(/<[^>]+>/g, ''));
      expect(labels.length).toBeGreaterThan(3);
      expect(new Set(labels).size).toBe(labels.length);
      // The range dash is spaced: it never reads as a hyphen of a name
      // (« is-d – is-p »).
      for (const label of labels) {
        expect(label).not.toMatch(/[-._@] ?–/);
        expect(label).toMatch(/^[^–\s]+(?: – [^–\s]+)?$/);
      }
      const bounds = labels.map((l) => l.split(' – '));
      for (let i = 1; i < bounds.length; i++) {
        const prevEnd = bounds[i - 1][bounds[i - 1].length - 1];
        const start = bounds[i][0];
        expect(prevEnd < start).toBe(true);
        expect(start.startsWith(prevEnd)).toBe(false);
      }
      // No initial with a couple of packages is left alone on a row.
      expect(labels).not.toContain('q');
      // A row ends where the next name differs early: a guide word stays
      // short even among names that share a long prefix.
      const long = await build(
        'license',
        licenseData(
          [
            ...Array.from(
              { length: 20 },
              (_, i) => `sa${String.fromCharCode(97 + i)}`,
            ),
            ...Array.from(
              { length: 12 },
              (_, i) => `string.prototype.trim${String.fromCharCode(97 + i)}x`,
            ),
            ...Array.from(
              { length: 20 },
              (_, i) => `t${String.fromCharCode(97 + i)}`,
            ),
          ].map((packageName) => pkg({ packageName })),
        ),
      );
      const longLabels = Array.from(
        tableOf(
          section(long, 'Permissive package inventory'),
          'inventory-index',
        ).matchAll(/<span class="initial">([\s\S]*?)<\/span><\/td>/g),
      ).map((m) => m[1].replace(/<[^>]+>/g, ''));
      for (const label of longLabels) {
        for (const word of label.split(' – '))
          expect(word.length).toBeLessThanOrEqual(10);
      }
    });

    it('never lets an index row run long: a large initial is split, each row stays whole on its page', async () => {
      const many = Array.from({ length: 70 }, (_, i) =>
        pkg({ packageName: `i${String.fromCharCode(97 + (i % 26))}-${i}` }),
      );
      const html = await build(
        'license',
        licenseData([...many, pkg({ packageName: 'zeta' })]),
      );
      const index = tableOf(
        section(html, 'Permissive package inventory'),
        'inventory-index',
      );
      const rows = index.split('<tbody>')[1].split('<tr').slice(1);
      for (const row of rows) {
        expect(row.match(/class="pi[ "]/g)?.length ?? 0).toBeLessThanOrEqual(
          28,
        );
      }
      // The rows of one initial are labelled by their range.
      expect(rows[0]).toMatch(
        /<span class="initial"><span class="nw">ia –<\/span> <span class="nw">i[a-z]<\/span>/,
      );
      // Rows are protected like every other table row.
      expect(html).not.toMatch(/\.inventory-index tr \{ break-inside: auto/);
      // The ecosystems of one license align their packages: a one-row
      // ecosystem keeps the guide column of the others.
      const mixed = await build(
        'license',
        licenseData([...many, pkg({ packageName: 'flask', ecosystem: 'pip' })]),
      );
      const tables = section(mixed, 'Permissive package inventory').match(
        /<table class="[^"]*inventory-index[\s\S]*?<\/table>/g,
      );
      expect(tables).toHaveLength(2);
      for (const table of tables) {
        expect(table).toContain('<col style="width: 12%">');
      }
    });

    it('never leaves an index row shorter than a row minimum, even where a later boundary is cheaper', async () => {
      // 24 names under one initial, then 5 under others: the cheapest
      // boundary (a new initial) would leave 5 entries on a row of their own.
      const names = [
        ...Array.from(
          { length: 24 },
          (_, i) => `p${String.fromCharCode(97 + i)}`,
        ),
        'redis',
        'sqlalchemy',
        'urllib3',
        'voyageai',
        'wandb',
      ];
      const html = await build(
        'license',
        licenseData(names.map((packageName) => pkg({ packageName }))),
      );
      const index = tableOf(
        section(html, 'Permissive package inventory'),
        'inventory-index',
      );
      const counts = index
        .split('</thead>')[1]
        .split('<tr')
        .slice(1)
        .map((row) => row.match(/class="pi[ "]/g)?.length ?? 0);
      expect(counts.reduce((a, b) => a + b, 0)).toBe(29);
      for (const n of counts) expect(n).toBeGreaterThanOrEqual(14);
    });

    it('labels a one-row list of several packages by two guide words, never by a lone initial', async () => {
      const actions = [
        'actions/cache',
        'actions/checkout',
        'actions/setup-node',
        'actions/upload-artifact',
      ];
      const html = await build(
        'license',
        licenseData([
          ...Array.from({ length: 12 }, (_, i) =>
            pkg({ packageName: `pkg-${i}` }),
          ),
          ...actions.map((packageName) =>
            pkg({ packageName, ecosystem: 'github_actions' }),
          ),
          pkg({ packageName: 'flask', ecosystem: 'pip' }),
        ]),
      );
      const labels = Array.from(
        section(html, 'Permissive package inventory').matchAll(
          /<span class="initial">([\s\S]*?)<\/span><\/td>/g,
        ),
      ).map((m) => text(m[1]));
      // A lone « a » reads like an enumeration: the ends of the list are
      // told apart, as far as they need to be.
      expect(labels).toContain('actions/c – actions/u');
      // Different initials are enough; a single package keeps its initial.
      expect(labels).toContain('f');
      for (const label of labels.filter((l) => l !== 'f')) {
        expect(label).toContain(' – ');
      }
    });

    it('lets the first row of an index end a page alone: an index row runs several lines', async () => {
      const html = await build('license', licenseData([pkg()]));
      // The shared rule keeps a one-line first row with the next one; an
      // index row is 3 to 6 lines, and its heading already travels with it.
      expect(html).toMatch(
        /table\.inventory-index:not\(\.small-licenses\) tbody:first-of-type > tr:first-child \+ tr \{ break-before: auto; \}/,
      );
    });

    it('sets the SPDX ids of the index notes in monospace, like everywhere else', async () => {
      const html = await build(
        'license',
        licenseData([
          pkg({
            packageName: 'json-schema',
            licenses: ['MIT', 'ISC'],
            effectiveLicenses: ['MIT', 'ISC'],
          }),
          pkg({ packageName: 'entities', packageVersion: '2.2.0' }),
          pkg({
            packageName: 'entities',
            packageVersion: '1.0.0',
            licenses: ['BSD-like'],
            effectiveLicenses: ['BSD-like'],
          }),
        ]),
      );
      const inventory = section(html, 'Permissive package inventory');
      expect(inventory).toContain(
        '<span class="also nw">also <span class="mono">ISC</span></span>',
      );
      // A license that is not an SPDX id is a name: never in monospace. The
      // versions a note names are versions, in monospace like the others.
      expect(inventory).toContain(
        '<span class="also nw">(<span class="mono">1.0.0</span> under BSD-like)</span>',
      );
      expect(inventory).toContain(
        '<span class="also nw">(<span class="mono">2.2.0</span> under <span class="mono">MIT</span>)</span>',
      );
    });

    it('sets the versions named by a partial « also » note in monospace', async () => {
      const html = await build(
        'license',
        licenseData([
          pkg({
            packageName: 'json5',
            packageVersion: '1.0.0',
            licenses: ['MIT', 'ISC'],
            effectiveLicenses: ['MIT', 'ISC'],
          }),
          pkg({ packageName: 'json5', packageVersion: '2.0.0' }),
        ]),
      );
      expect(section(html, 'Permissive package inventory')).toContain(
        '<span class="also nw">also <span class="mono">ISC</span> (<span class="mono">1.0.0</span>)</span>',
      );
    });

    it('gives a new license of the appendix more air than a new ecosystem of it', () => {
      const px = (re: RegExp) => Number(LICENSE_CSS.match(re)[1]);
      const license = px(
        /\.appendix \.license-head \{ margin-top: (\d+)px; \}/,
      );
      const ecosystem = px(/\.eco-head \{ margin-top: (\d+)px;/);
      // Level 1 over level 2: the licenses read as blocks on a dense page.
      expect(license).toBeGreaterThanOrEqual(ecosystem + 8);
      // The first license, under the appendix intro, keeps none (declared
      // after, at the same specificity).
      const reset = LICENSE_CSS.indexOf(
        '.appendix .section-intro + .license-head { margin-top: 0; }',
      );
      expect(reset).toBeGreaterThan(
        LICENSE_CSS.indexOf('.appendix .license-head { margin-top:'),
      );
    });

    it('repeats the license on every page its inventory continues on, as an appendix opening a page', async () => {
      const many = Array.from({ length: 12 }, (_, i) =>
        pkg({ packageName: `pkg-${i}` }),
      );
      const html = await build(
        'license',
        licenseData([
          ...many,
          pkg({ packageName: 'flask', ecosystem: 'pip' }),
          pkg({
            packageName: 'isc-one',
            licenses: ['ISC'],
            effectiveLicenses: ['ISC'],
          }),
        ]),
      );
      const inventory = section(html, 'Permissive package inventory');
      expect(text(inventory)).toMatch(/^Appendix Permissive package inventory/);
      expect(html).toMatch(/\.appendix \{[^}]*break-before: page/);
      // A margin survives a forced page break: the appendix opens at the
      // top of its page, like every other page, and keeps its space in the
      // preview.
      expect(html).toMatch(
        /@media print \{ \.appendix \{ margin-top: 0; \} \}/,
      );
      const tables = inventory.match(
        /<table class="[^"]*has-cont[\s\S]*?<\/table>/g,
      );
      // One table per license and ecosystem, under a heading naming the
      // ecosystem (in its own case), repeated with it on every page.
      expect(text(tables[0].split('</tr>')[0])).toBe(
        'MIT License · npm · continued',
      );
      expect(text(tables[1].split('</tr>')[0])).toBe(
        'MIT License · PyPI · continued',
      );
      // Every ecosystem of a license with several has one heading: its
      // chip, then the license and its count, so that a heading opening a
      // page names its list, never read as a continued table nor as a
      // license of its own. The first one never leaves the license heading
      // right above it: it does not repeat its name.
      const ecoHeads = Array.from(
        inventory.matchAll(/<div class="eco-head[^"]*">([\s\S]*?)<\/div>/g),
      ).map((m) => m[1]);
      expect(ecoHeads).toEqual([
        '<span class="chip">npm</span> <span class="eco-name">12\u00a0packages</span>',
        '<span class="chip">PyPI</span> <span class="eco-name">MIT License · 1\u00a0package</span>',
      ]);
      expect(inventory).not.toContain('eco-next');
      expect(inventory).not.toContain('eco-row');
      expect(html).toMatch(
        /\.eco-name \{[^}]*font-weight: 500; color: #5b5566/,
      );
      // An ecosystem heading is closer to its rows than to the rows above
      // it: the context row it hides is shorter than the shared one.
      expect(html).toMatch(/\.eco-head \{ margin-top: 24px;/);
      expect(html).toMatch(/\.license-head \+ \.eco-head \{ margin-top: 6px;/);
      expect(inventory).toMatch(
        /<div class="eco-head cont-cover index-cover">[\s\S]*?<\/div><table/,
      );
      expect(html).toMatch(
        /\.index-cover\.cont-cover \{ padding-bottom: 12px; min-height: 12px; \}/,
      );
      expect(html).toMatch(
        /\.index-cover \+ table\.inventory-index \{ margin-top: -12px; \}/,
      );
      expect(html).toMatch(
        /table\.inventory-index:not\(\.small-licenses\) \.cont-row th \{ height: 12px; line-height: 11px; padding-bottom: 1px; \}/,
      );
      // The heading names the list: no column header repeated under it.
      expect(html).toMatch(
        /\.inventory-index:not\(\.small-licenses\) thead tr:not\(\.cont-row\) \{ display: none/,
      );
      // Every index has the guide column, and every row its guide words:
      // the packages of every license start at one edge, never after an
      // empty cell.
      for (const table of tables.slice(0, 2)) {
        expect(table).toContain('<col style="width: 12%">');
        for (const row of table.split('</thead>')[1].split('<tr').slice(1)) {
          expect(row).toMatch(/<td><span class="initial">[^<]*<span/);
        }
      }
      expect(tables[1]).toMatch(
        /<span class="initial"><span class="nw">f<\/span>/,
      );
      // Licenses with a few packages share one table.
      expect(text(tables[2].split('</tr>')[0])).toBe(
        'Other permissive licenses · continued',
      );
      // A license with a single ecosystem: its heading carries the chip and
      // hides the context row of the index, with no ecosystem heading of its
      // own (a chip alone on its line).
      const single = await build(
        'license',
        licenseData(
          many.map((p) => ({
            ...p,
            licenses: ['ISC'],
            effectiveLicenses: ['ISC'],
          })),
        ),
      );
      const isc = section(single, 'Permissive package inventory');
      expect(text(isc)).toContain(
        'ISC License npm ISC · 12 packages ISC License · npm · continued',
      );
      expect(isc).not.toContain('eco-head');
      expect(isc).toMatch(
        /<div class="license-head cont-cover index-cover"><span class="title">ISC License <span class="chip">npm<\/span><\/span><span class="meta">[^<]*<span class="mono">ISC<\/span>[^<]*<\/span><\/div><table/,
      );
      const iscTable = tableOf(isc, 'inventory-index');
      expect(iscTable).toContain('<col style="width: 12%">');
      expect(text(iscTable.split('<tbody')[0])).toBe(
        'ISC License · npm · continued Packages and versions',
      );
      expect(bodyRows(tables[2])[0]).toMatch(
        /^ISC License ISC · 1 package npm isc-one/,
      );
      expect(text(section(html, 'Permissive licenses'))).toContain(
        'Every permissive package is listed in the appendix.',
      );
    });

    it('keeps a package with its first version: a line never starts with a version alone', async () => {
      const html = await build(
        'license',
        licenseData([
          pkg({ packageName: 'debug', packageVersion: '2.2.0' }),
          pkg({ packageName: 'debug', packageVersion: '2.6.9' }),
          pkg({
            packageName: 'validate-npm-package-license',
            packageVersion: '3.0.1',
          }),
          pkg({
            packageName: 'validate-npm-package-license',
            packageVersion: '3.0.4',
          }),
        ]),
      );
      const inventory = section(html, 'Permissive package inventory');
      // A short entry stays whole.
      expect(inventory).toMatch(
        /<span class="nw">[^]*?debug[^]*?2\.2\.0, 2\.6\.9<\/span><\/span>/,
      );
      // A long one keeps its name with its first version.
      expect(inventory).toMatch(
        /<span class="nw"><span class="pn">validate-npm-package-license<\/span> <span class="versions mono">3\.0\.1,<\/span><\/span>/,
      );
    });

    it('spaces the versions of a long entry like a short one: every space between two versions is a monospace one', async () => {
      const versions = ['2.36.0', '2.67.0', '2.75.0', '2.79.0', '2.88.0'];
      const html = await build(
        'license',
        licenseData([
          ...versions.map((v) =>
            pkg({ packageName: 'request', packageVersion: v }),
          ),
          pkg({ packageName: 'debug', packageVersion: '2.2.0' }),
          pkg({ packageName: 'debug', packageVersion: '2.6.9' }),
        ]),
      );
      const inventory = section(html, 'Permissive package inventory');
      // `request` and its versions run over 40 characters: the entry may
      // break after a comma. Its spaces are those of the short entries
      // (`debug 2.2.0, 2.6.9`), the version font's: never a narrower one
      // after the first version only.
      const entries = [
        inventory.slice(inventory.indexOf('<span class="pn">request<')),
        inventory.slice(inventory.indexOf('<span class="pn">debug<')),
      ];
      for (const [entry, list] of [
        [entries[0], versions],
        [entries[1], ['2.2.0', '2.6.9']],
      ] as const) {
        for (let i = 0; i < list.length - 1; i++) {
          const from = entry.indexOf(`${list[i]},`) + list[i].length + 1;
          const gap = entry.slice(from, entry.indexOf(list[i + 1], from));
          expect(gap.replace(/<[^>]+>/g, '')).toBe(' ');
          // The one space outside a tag.
          const space = from + gap.search(/ (?![^<]*>)/);
          expect(
            openAt(entry, space).some((c) => /\bversions\b.*\bmono\b/.test(c)),
          ).toBe(true);
        }
      }
    });

    it('sizes the inventory text for the screen in the dashboard preview', async () => {
      const pdf = await build('license', licenseData([pkg()]), {
        format: 'pdf',
      });
      const preview = await build('license', licenseData([pkg()]));
      expect(pdf).not.toMatch(
        /\.inventory-index td, \.inventory-index \.versions \{ font-size: 11px/,
      );
      expect(preview).toMatch(
        /\.inventory-index td, \.inventory-index \.versions \{ font-size: 11px/,
      );
    });

    it('counts the projects with an inventory in the subtitle', async () => {
      const html = await build('license', licenseData([pkg()]), {
        projectIds: ['p1', 'p3'],
      });
      expect(text(html.split('</header>')[0])).toContain(
        'Licenses declared by the dependencies of 1 of 2 projects',
      );
    });

    it('shows a license name that is not an SPDX identifier as such', async () => {
      const html = await build(
        'license',
        licenseData([
          pkg({ licenses: ['BSD-like'], effectiveLicenses: ['BSD-like'] }),
        ]),
      );
      const row = bodyRows(
        tableOf(section(html, 'Permissive licenses'), 'license-table'),
      )[0];
      expect(row).toMatch(/^BSD-like Not an SPDX id /);
      // The appendix says it too.
      expect(
        bodyRows(
          tableOf(
            section(html, 'Permissive package inventory'),
            'small-licenses',
          ),
        )[0],
      ).toMatch(/^BSD-like Not an SPDX id · 1 package /);
    });

    it('states risk facts in the summary, never a share of the permissive licenses', async () => {
      const html = await build(
        'license',
        licenseData([
          pkg(),
          pkg({
            packageName: 'paramiko',
            ecosystem: 'pip',
            isTransitive: false,
            category: 'WEAK_COPYLEFT',
            licenses: ['LGPL-3.0-only'],
            effectiveLicenses: ['LGPL-3.0-only'],
          }),
        ]),
      );
      const summary = text(section(html, 'Executive summary'));
      // The absence of strong copyleft is said once, with the weak one.
      expect(summary).toContain(
        '1 package under a weak copyleft license (LGPL-3.0-only), a direct production dependency of billing-service; no strong copyleft license (GPL, AGPL).',
      );
      expect(summary.match(/strong copyleft/g)).toHaveLength(1);
      expect(summary).not.toMatch(/covers \d+%/);
      expect(summary).toContain('Packages to review by dependency type');
      // The donut shows what needs a look, never an all-green ring; it
      // breaks it down by license category.
      expect(summary).toContain('Packages to review by license category');
      expect(summary).toMatch(/1 to review/);
      expect(summary).toMatch(/1 Permissive 50% of packages/);
      // Its shares would be of the packages to review, beside tiles giving
      // shares of all packages: only the counts are shown.
      const raw = section(html, 'Executive summary');
      // The SPDX id reads in monospace, as everywhere else in the report.
      expect(raw).toContain('(<span class="mono">LGPL-3.0-only</span>)');
      expect(raw).toContain('class="review-donut"');
      expect(html).toMatch(/\.review-donut \.legend-pct \{ display: none/);
      // The bars by dependency type carry their own colour legend.
      expect(raw).toMatch(/class="split-legend">.*Weak copyleft/);
      expect(raw.split('class="split-legend">')[1]).not.toContain('Unknown');
    });

    it('names in the key facts the copyleft licenses of the packages to review only', async () => {
      const copyleft = (name: string, id: string, category: string) =>
        pkg({
          packageName: name,
          isTransitive: false,
          category,
          licenses: [id],
          effectiveLicenses: [id],
        });
      const html = await build(
        'license',
        licenseData([
          pkg(),
          copyleft('paramiko', 'LGPL-3.0-only', 'WEAK_COPYLEFT'),
          // Accepted during triage: out of the figures, out of the facts.
          {
            ...copyleft('accepted-lib', 'MPL-2.0', 'WEAK_COPYLEFT'),
            licenseIgnored: true,
          },
          copyleft('custom-lib', 'GPL-like', 'STRONG_COPYLEFT'),
        ]),
      );
      const raw = section(html, 'Executive summary');
      expect(text(raw)).toContain(
        '1 package under a weak copyleft license (LGPL-3.0-only),',
      );
      expect(text(raw)).not.toContain('MPL-2.0');
      // A license the SPDX list does not know is a name, never set as an id.
      expect(raw).toContain('under a strong copyleft license (GPL-like),');
    });

    it('sizes the packages to review on one scale, by dependency type', async () => {
      const unknown = (name: string, over: Vuln = {}) =>
        pkg({
          packageName: name,
          licenses: [],
          category: 'UNKNOWN',
          effectiveLicenses: ['UNKNOWN'],
          ...over,
        });
      const html = await build(
        'license',
        licenseData([
          pkg(),
          unknown('a', { isTransitive: false }),
          unknown('b', { isTransitive: false }),
          unknown('c', { isTransitive: false }),
          unknown('d', { isTransitive: false }),
          unknown('e'),
          unknown('f'),
          unknown('g', { isTransitive: false, isDev: true }),
        ]),
      );
      const summary = section(html, 'Executive summary');
      expect(text(summary)).toMatch(
        /Direct · production 4 Transitive · production 2 Direct · development 1/,
      );
      // Bar lengths follow the counts (4 : 2 : 1), never all full.
      const widths = Array.from(
        summary.matchAll(/class="split-fill" style="width: ([\d.]+)%/g),
      ).map((m) => Number(m[1]));
      expect(widths).toEqual([100, 50, 25]);
    });

    it('sums both copyleft kinds in one tile that details them, coloured by the strongest', async () => {
      const lgpl = pkg({
        packageName: 'paramiko',
        category: 'WEAK_COPYLEFT',
        licenses: ['LGPL-3.0-only'],
        effectiveLicenses: ['LGPL-3.0-only'],
      });
      const tiles = (html: string) =>
        section(html, 'Executive summary').split('</div></div></div>')[0];
      const weak = tiles(await build('license', licenseData([pkg(), lgpl])));
      expect(text(weak)).toMatch(/1 Copyleft 50% · weak copyleft/);
      expect(weak).not.toMatch(/Strong copyleft/i);
      expect(weak).toContain('--kpi-accent: #f2641b'); // high
      const strong = tiles(
        await build(
          'license',
          licenseData([
            lgpl,
            pkg({
              packageName: 'gpl-lib',
              category: 'STRONG_COPYLEFT',
              licenses: ['GPL-3.0-only'],
              effectiveLicenses: ['GPL-3.0-only'],
            }),
          ]),
        ),
      );
      expect(text(strong)).toMatch(/2 Copyleft 1 weak · 1 strong/);
      expect(strong).toContain('--kpi-accent: #d92d20'); // critical
    });

    it('lists every package, with no truncation and no "use HTML format" note, in the PDF too', async () => {
      const many = Array.from({ length: 180 }, (_, i) =>
        pkg({ packageName: `pkg-${String(i).padStart(3, '0')}` }),
      );
      const html = await build('license', licenseData(many), { format: 'pdf' });
      expect(html).not.toMatch(/HTML format/i);
      expect(html).not.toMatch(/more packages/i);
      for (const p of many) expect(html).toContain(String(p.packageName));
    });

    it('says explicitly when no copyleft license is found', async () => {
      const html = await build('license', licenseData([pkg()]));
      expect(text(html)).toContain('No copyleft license in the dependencies.');
    });

    it('says under its own heading that no strong copyleft license was found when only weak ones are', async () => {
      const html = await build(
        'license',
        licenseData([
          pkg({
            packageName: 'paramiko',
            category: 'WEAK_COPYLEFT',
            licenses: ['LGPL-3.0-only'],
            effectiveLicenses: ['LGPL-3.0-only'],
          }),
        ]),
      );
      const copyleft = section(html, 'Copyleft licenses');
      // Both kinds under their heading, the strongest first: an absent kind
      // says so in the shared empty state, as visible as the other one.
      expect(text(copyleft)).toMatch(
        /Strong copyleft No strong copyleft license \(GPL, AGPL\) was found\. Weak copyleft /,
      );
      expect(copyleft).toContain('<h3>Strong copyleft</h3><div class="empty">');
      expect(copyleft).not.toContain('kind-note');
      // A definition only for the kind that has packages.
      expect(copyleft.match(/class="section-intro/g)).toHaveLength(1);
    });

    it('details the packages to review with their projects and dependency kind', async () => {
      const html = await build(
        'license',
        licenseData([
          pkg({
            packageName: 'bcrypt-nodejs',
            packageVersion: '0.0.3',
            licenses: [],
            category: 'UNKNOWN',
            effectiveLicenses: ['UNKNOWN'],
            isTransitive: false,
            projects: ['billing-service', 'vitality-api'],
          }),
        ]),
      );
      const review = text(section(html, 'Unknown licenses'));
      expect(review).toContain('bcrypt-nodejs');
      expect(review).toContain('0.0.3');
      // Same words as the summary chart: production / development, in one
      // colour (the production qualifier is what says the exposure).
      expect(review).toContain('Direct · production');
      expect(section(html, 'Unknown licenses')).not.toContain(
        '<span class="muted">&middot;',
      );
      expect(review).not.toMatch(/\b(?:prod|dev)\b/);
      // Projects on one line, comma-separated.
      expect(review).toContain('billing-service, vitality-api');
      // A column that would say "None declared" on every row is dropped; the
      // introduction says it once.
      expect(review).toContain('This package declares no license.');
      expect(review).not.toContain('Declared license');
      expect(review).not.toContain('None declared');
    });

    it('names the list on every page the packages to review continue on', async () => {
      const html = await build(
        'license',
        licenseData(
          Array.from({ length: 5 }, (_, i) =>
            pkg({
              packageName: `mystery-${i}`,
              licenses: [],
              category: 'UNKNOWN',
              effectiveLicenses: ['UNKNOWN'],
            }),
          ),
        ),
      );
      const table = tableOf(section(html, 'Unknown licenses'), 'has-cont');
      expect(text(table.split('</tr>')[0])).toBe(
        'Unknown licenses · continued',
      );
    });

    it('orders the packages to review like the summary chart: production before development, direct before transitive', async () => {
      const unknown = (name: string, over: Vuln = {}) =>
        pkg({
          packageName: name,
          licenses: [],
          category: 'UNKNOWN',
          effectiveLicenses: ['UNKNOWN'],
          ...over,
        });
      const html = await build(
        'license',
        licenseData([
          unknown('a-dev', { isTransitive: false, isDev: true }),
          unknown('b-trans', { isTransitive: true }),
          unknown('c-direct', { isTransitive: false }),
          unknown('d-trans-dev', { isTransitive: true, isDev: true }),
        ]),
      );
      const rows = bodyRows(
        tableOf(section(html, 'Unknown licenses'), 'pkg-table'),
      );
      expect(rows.map((r) => r.split(' ')[0])).toEqual([
        'c-direct',
        'b-trans',
        'a-dev',
        'd-trans-dev',
      ]);
      // The introduction announces that order, never another one.
      const intro = text(section(html, 'Unknown licenses'));
      expect(intro).toContain(
        'before distributing software that includes them; production dependencies come first, direct before transitive.',
      );
      expect(intro).not.toContain('direct and production dependencies');
      // It only names the distinctions the list makes.
      const prodOnly = text(
        section(
          await build(
            'license',
            licenseData([
              unknown('a', { isTransitive: false }),
              unknown('b', { isTransitive: true }),
            ]),
          ),
          'Unknown licenses',
        ),
      );
      expect(prodOnly).toContain(
        'includes them; direct dependencies come first.',
      );
      const same = text(
        section(
          await build('license', licenseData([unknown('a'), unknown('b')])),
          'Unknown licenses',
        ),
      );
      expect(same).toMatch(/includes them\. Package /);
    });

    it('lists a package to review once, with every version in use', async () => {
      const unknown = (over: Vuln) =>
        pkg({
          packageName: 'cliff',
          licenses: [],
          category: 'UNKNOWN',
          effectiveLicenses: ['UNKNOWN'],
          ...over,
        });
      const html = await build(
        'license',
        licenseData([
          unknown({ packageVersion: '0.1.10', projects: ['vitality-api'] }),
          unknown({ packageVersion: '0.1.9', projects: ['billing-service'] }),
        ]),
      );
      const rows = bodyRows(
        tableOf(section(html, 'Unknown licenses'), 'pkg-table'),
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatch(/^cliff npm 0\.1\.9, 0\.1\.10 /);
      expect(rows[0]).toContain('billing-service, vitality-api');
    });

    it('shows the declared license column when some package declares an unrecognised one', async () => {
      const html = await build(
        'license',
        licenseData([
          pkg({
            packageName: 'odd',
            licenses: ['Custom-EULA'],
            category: 'UNKNOWN',
            effectiveLicenses: ['UNKNOWN'],
          }),
          pkg({
            packageName: 'bare',
            licenses: [],
            category: 'UNKNOWN',
            effectiveLicenses: ['UNKNOWN'],
          }),
        ]),
      );
      const review = text(section(html, 'Unknown licenses'));
      expect(review).toContain('Declared license');
      expect(review).toContain('Custom-EULA');
      expect(review).toContain('None declared');
    });

    it('lists the versions of a permissive package on one entry of the inventory, without requirement operators', async () => {
      const html = await build(
        'license',
        licenseData([
          pkg({ packageName: 'ansi-regex', packageVersion: '3.0.0' }),
          pkg({ packageName: 'ansi-regex', packageVersion: '2.1.1' }),
          pkg({ packageName: 'fastapi', packageVersion: '==0.68.0' }),
        ]),
      );
      const inventory = section(html, 'Permissive package inventory');
      expect(inventory.match(/class="pi[ "]/g)).toHaveLength(2);
      expect(text(inventory)).toContain('ansi-regex 2.1.1, 3.0.0');
      expect(text(inventory)).toContain('fastapi 0.68.0');
      expect(text(inventory)).not.toContain('==');
    });

    it('orders the sections by risk: copyleft, then review, then permissive', async () => {
      const html = await build(
        'license',
        licenseData([
          pkg(),
          pkg({
            packageName: 'x',
            category: 'UNKNOWN',
            licenses: [],
            effectiveLicenses: ['UNKNOWN'],
          }),
        ]),
      );
      const order = [
        'Copyleft licenses',
        'Unknown licenses',
        'Permissive licenses',
        'Permissive package inventory',
      ].map((t) => html.indexOf(`<h2>${t}`));
      expect(order.every((i) => i > 0)).toBe(true);
      expect([...order].sort((a, b) => a - b)).toEqual(order);
    });

    it('shows a small but non-zero share as "<1%", never "0%"', async () => {
      const many = Array.from({ length: 150 }, (_, i) =>
        pkg({ packageName: `m-${i}` }),
      );
      const html = await build(
        'license',
        licenseData([
          ...many,
          pkg({
            packageName: 'mystery',
            licenses: [],
            category: 'UNKNOWN',
            effectiveLicenses: ['UNKNOWN'],
          }),
        ]),
      );
      const summary = text(section(html, 'Executive summary'));
      expect(summary).toContain('1 package (<1%) declares no license');
      expect(summary).not.toMatch(/ 0%/);
      // The tile captions are text: the share reads « <1% », never escaped
      // twice.
      expect(summary).toMatch(/1 Unknown <1% /);
      expect(section(html, 'Executive summary')).not.toContain('&amp;lt;');
    });

    it('words the unknown licenses precisely: declared or not, production or development', async () => {
      const unknown = (name: string, over: Vuln = {}) =>
        pkg({
          packageName: name,
          licenses: [],
          category: 'UNKNOWN',
          effectiveLicenses: ['UNKNOWN'],
          ...over,
        });
      const html = await build(
        'license',
        licenseData([
          pkg(),
          unknown('a', { isTransitive: false }),
          unknown('b', { isTransitive: false }),
          unknown('c', { isTransitive: false, isDev: true }),
          unknown('d'),
        ]),
      );
      expect(text(section(html, 'Executive summary'))).toContain(
        '4 packages (80%) declare no license and need a manual review; 2 are direct production dependencies, 1 a direct development dependency.',
      );
      expect(text(html)).not.toMatch(/recognised/);
    });

    it('describes each project in scope, including one without a dependency inventory', async () => {
      const html = await build('license', licenseData([pkg()]));
      const projects = text(section(html, 'Projects'));
      expect(projects).toContain('ml-recommender');
      expect(projects).toContain('No inventory');
      // A short table stays whole on its page.
      expect(section(html, 'Projects')).toContain('<div class="avoid-break">');
    });

    it('lets a long projects table flow, its first and last rows never alone on a page', async () => {
      const rows = Array.from({ length: 8 }, (_, i) => ({
        projectName: `project-${i}`,
        teamName: 'Data',
        branches: ['main'],
        packages: 1,
        byCategory: {
          permissive: 1,
          weakCopyleft: 0,
          strongCopyleft: 0,
          unknown: 0,
        },
      }));
      const html = await build('license', licenseData([pkg()], rows));
      const projects = section(html, 'Projects');
      expect(projects).not.toContain('avoid-break');
      const groups = tableOf(projects, 'compact')
        .split('</thead>')[1]
        .match(/<tbody[^>]*>[\s\S]*?<\/tbody>/g);
      expect(groups[0]).toMatch(/^<tbody class="unit">/);
      expect(groups[0].match(/<tr/g)).toHaveLength(2);
      const last = groups[groups.length - 1];
      expect(last).toMatch(/^<tbody class="unit">/);
      expect(last.match(/<tr/g)).toHaveLength(2);
    });

    it('names the ecosystem of every package of the small licenses, and the SPDX ids in monospace', async () => {
      const html = await build(
        'license',
        licenseData([
          pkg({ packageName: 'npm', packageVersion: '3.10.10' }),
          pkg({
            packageName: 'pillow',
            ecosystem: 'pip',
            licenses: ['ISC'],
            effectiveLicenses: ['ISC'],
          }),
        ]),
      );
      const small = tableOf(
        section(html, 'Permissive package inventory'),
        'small-licenses',
      );
      expect(bodyRows(small)[0]).toMatch(
        /^ISC License ISC · 1 package PyPI pillow/,
      );
      expect(bodyRows(small)[1]).toMatch(
        /^MIT License MIT · 1 package npm npm 3\.10\.10/,
      );
      expect(small).toMatch(/<span class="mono">MIT<\/span>/);
    });

    it('states the limits of the inventory in the closing section', async () => {
      const about = text(
        (await build('license', licenseData([pkg()]))).split(
          '<section class="about">',
        )[1],
      );
      expect(about).toContain('Limits');
      expect(about).toMatch(/not verified against the source code/);
      // Two short rubrics: the method with its limits, then the disclaimer.
      expect(about).toMatch(
        /^About this report Method and limits .* Disclaimer /,
      );
    });

    it('shows the SPDX short name of a license with an offensive full name', async () => {
      const html = await build(
        'license',
        licenseData([
          pkg({ licenses: ['WTFPL'], effectiveLicenses: ['WTFPL'] }),
        ]),
      );
      expect(text(html)).not.toContain('F*ck');
      expect(text(html)).toContain('WTFPL');
      // A readable name, never « WTFPL » next to its identical id.
      expect(
        bodyRows(
          tableOf(section(html, 'Permissive licenses'), 'license-table'),
        )[0],
      ).toMatch(/^WTF Public License WTFPL /);
    });

    it('escapes package and project names', async () => {
      const html = await build(
        'license',
        licenseData([
          pkg({
            packageName: '<img src=x onerror=alert(1)>',
            category: 'UNKNOWN',
            licenses: [],
            effectiveLicenses: ['UNKNOWN'],
            projects: ['<b>p</b>'],
          }),
        ]),
      );
      expect(html).not.toContain('<img src=x onerror=alert(1)>');
      expect(html).not.toContain('<b>p</b>');
    });
  });

  // A single identifier wider than the text column makes Chromium print the
  // whole document smaller: nothing may overflow its cell or the page.
  describe('long identifiers (project, branch, version)', () => {
    const LONG_PROJECT =
      'acme-corp-customer-identity-and-access-management-platform-backend-services';
    const LONG_TEAM = 'Identity & Access Management Platform Engineering';
    const LONG_BRANCH =
      'feature/PLAT-48213-migrate-imagemagick-thumbnail-pipeline-to-libvips-and-harden-upload-path-validation';
    const INSTALLED = '8:6.9.11.60+dfsg-1.6ubuntu1.3';
    const EPOCH_FIX = '8:6.9.11.60+dfsg-1.6ubuntu1.4';
    const PRERELEASE =
      '3.0.0-alpha.20260915.4f2d9c1e8b7a6d5c4b3a2f1e0d9c8b7a6f5e4d3c';

    const longMeta = [
      ...PROJECTS_META,
      { id: 'p4', name: LONG_PROJECT, teamName: LONG_TEAM },
    ];
    const image = (over: Vuln = {}): Vuln =>
      vuln({
        type: 'container',
        name: 'ImageMagick path traversal',
        path: undefined,
        line: undefined,
        packageName: 'imagemagick-6-common',
        packageVersion: INSTALLED,
        advisoryId: 'CVE-2026-25965',
        fixedVersion: EPOCH_FIX,
        owaspTop10: [],
        cwe: [],
        projectId: 'p4',
        projectName: LONG_PROJECT,
        branch: LONG_BRANCH,
        ...over,
      });
    const colWidths = (table: string): number[] =>
      Array.from(
        table.matchAll(
          /<col style="width: (?:var\(--narrow-share, )?([\d.]+)%[^"]*">/g,
        ),
      ).map((m) => Number(m[1]));

    /** A long version as text of a list: its parts, in its box. */
    const versionText = (version: string, after = ''): string =>
      idBox(
        `<span class="id-text is-long">${breakableVersion(version)}</span>`,
        {
          after,
        },
      );

    it('names a project longer than a line like a phrase, broken before its separators, its punctuation kept with it', () => {
      // Short, a name never breaks (the rule every test above pins).
      expect(projectName('vitality-api')).toBe(
        '<span class="nw">vitality-api</span>',
      );
      // Long, it flows like the sentence around it, broken before a
      // hyphen, never past its cell.
      expect(projectName(LONG_PROJECT)).toBe(
        `<span class="nw is-long">${breakableId(LONG_PROJECT)}</span>`,
      );
      // In a list, its comma stays with it.
      expect(projectNames(['billing-service', LONG_PROJECT])).toBe(
        `<span class="nw is-long">${breakableId(LONG_PROJECT)},</span> <span class="nw">billing-service</span>`,
      );
      // No block of its own: a block wider than the rest of a line took a
      // whole line, sent the mark after it (« : », « , ») to the next one
      // or floated it at the top right, and left the lines around it short.
      expect(AGGREGATED_CSS).toMatch(
        /\.nw\.is-long \{ white-space: normal; overflow-wrap: anywhere; \}/,
      );
      expect(AGGREGATED_CSS).not.toMatch(/\.nw\.is-long \{ display/);
    });

    it('keeps the comma of a long version inside its box, and flows a package name too long for a line', () => {
      // A long version wraps inside its box: the comma after it never opens
      // the next line.
      expect(versionItem(PRERELEASE, true)).toBe(versionText(PRERELEASE, ','));
      expect(versionItem('1.0.0', true)).toBe('<span class="nw">1.0.0,</span>');
      expect(listEntry('left-pad', 'pn', [PRERELEASE, '4.0.0'])).toBe(
        `<span class="nw"><span class="pn">left-pad</span></span> <span class="versions mono">${versionText(PRERELEASE, ',')}</span><span class="versions mono"> <span class="nw">4.0.0</span></span>`,
      );
      // A name longer than most of a line (a Maven coordinate) no longer
      // runs past the page, nowrap: it breaks before its separators, its
      // first version kept with its last part.
      const MAVEN =
        'io.opentelemetry.instrumentation:opentelemetry-spring-boot-autoconfigure-spring-webmvc-6.0';
      expect(listEntry(MAVEN, 'pn', ['2.1.0-alpha', '2.2.0'])).toBe(
        `<span class="pn">${breakableId(MAVEN)}</span>&nbsp;<span class="versions mono">2.1.0-alpha,</span><span class="versions mono"> <span class="nw">2.2.0</span></span>`,
      );
      expect(listEntry(MAVEN, 'pn', [PRERELEASE])).toBe(
        `<span class="pn">${breakableId(MAVEN)}</span> <span class="versions mono">${versionText(PRERELEASE)}</span>`,
      );
      // Its secrets masked, its markup escaped.
      expect(listEntry('<b>x</b>', 'pn', [])).toBe(
        '<span class="nw"><span class="pn">&lt;b&gt;x&lt;/b&gt;</span></span>',
      );
    });

    it('lets the team and branches of a project wrap inside its cell, each separator kept with the part before it', () => {
      const cell = projectCell('billing-service', LONG_TEAM, [
        LONG_BRANCH,
        'main',
      ]);
      expect(cell).toBe(
        `<span class="name">billing-service</span><span class="inline-sep">&nbsp;&middot;</span> <span class="inline-sub">Identity &amp; Access Management Platform Engineering&nbsp;&middot; ${breakableId(LONG_BRANCH)}, main</span>`,
      );
      // Whole on the line of the name, or the next one, when it fits a
      // line; wrapped inside the cell otherwise, never past it.
      expect(AGGREGATED_CSS).toMatch(
        /\.inline-sub \{ display: inline-block; max-width: 100%; white-space: normal; overflow-wrap: anywhere; text-indent: 0; \}/,
      );
      // A long project name breaks after its separators too.
      expect(projectCell(LONG_PROJECT, '', [])).toBe(
        `<span class="name">${breakableId(LONG_PROJECT)}</span>`,
      );
    });

    it('breaks a long version after its separators, never glued to a name that cannot hold it on its line', () => {
      const name = '<span class="pn">left-pad</span>';
      // Short, unchanged: the name keeps its first version.
      expect(listEntry('left-pad', 'pn', ['1.3.0'])).toBe(
        `<span class="nw">${name} <span class="versions mono">1.3.0</span></span>`,
      );
      // A long version is an identifier of its own, sent to the next line
      // when it does not fit after the name, broken there when it does not
      // fit a line either.
      expect(listEntry('left-pad', 'pn', ['1.0.0', PRERELEASE])).toBe(
        `<span class="nw">${name} <span class="versions mono">1.0.0,</span></span><span class="versions mono"> ${versionText(PRERELEASE)}</span>`,
      );
    });

    it('fits the vulnerable packages of an image in their columns: project, installed and fixed versions', async () => {
      const html = await build(
        'owasp',
        { ...owaspData({ A06: [image()] }), projectsMetadata: longMeta },
        { projectIds: ['p1', 'p2', 'p3', 'p4'] },
      );
      const detail = section(html, 'Vulnerable and Outdated Components');
      const table = tableOf(detail, 'dep-table');
      // The project under the package, and the installed version.
      expect(table).toContain(
        `<span class="who"><span class="nw is-long">${breakableId(LONG_PROJECT)}</span></span>`,
      );
      expect(table).toContain(
        `<span class="versions mono">${versionText(INSTALLED)}</span>`,
      );
      // The fixed version is atomic, one chip held whole by its column (see
      // « holds a Debian fixed version whole in one chip »).
      expect(table).toContain(versionChip(EPOCH_FIX));
      // A part of a scoped name longer than a line of the chip flows in the
      // chip, whose every line keeps its background (clone): a block there
      // left a line bare and laid a bar the width of the column under the
      // last one.
      expect(html).toMatch(
        /\.dep-table \.pkg-head\.flows \.code-chip\.pkg \.seg\.is-long \{ display: inline; max-width: none; \}/,
      );
    });

    it('flows a scoped package name in its chip only when a part of it is longer than a line of the column', async () => {
      const dep = (packageName: string) =>
        vuln({
          type: 'sca',
          path: undefined,
          line: undefined,
          packageName,
          packageVersion: '1.0.0',
          advisoryId: `CVE-${packageName.length}`,
          owaspTop10: [],
          cwe: [],
        });
      const table = tableOf(
        section(
          await build(
            'owasp',
            owaspData({
              A06: [
                dep(
                  '@very-long-organization-name/extremely-long-package-name-for-testing',
                ),
                dep('@opentelemetry/auto-instrumentations-node'),
              ],
            }),
          ),
          'Vulnerable and Outdated Components',
        ),
        'dep-table',
      );
      // « /extremely-long-package-name-for-testing » (40 characters) is
      // longer than a line: it flows.
      expect(table).toMatch(
        /<div class="pkg-head flows"><span class="code-chip pkg"><span class="seg is-long">@very/,
      );
      // « auto-instrumentations-node » fits a line: it moves to the next
      // one whole, as the other chips' parts do; the « / » of a short scope
      // stays with it (shared packageChip), as in a short name.
      expect(table).toMatch(
        /<div class="pkg-head"><span class="code-chip pkg"><span class="seg">@opentelemetry\/<\/span>/,
      );
    });

    it('keeps a short fixed version whole: its column widens to it, taken from the package and count columns', async () => {
      const widths = async (fixedVersion: string) =>
        colWidths(
          tableOf(
            section(
              await build(
                'owasp',
                owaspData({ A06: [image({ projectId: 'p1', fixedVersion })] }),
              ),
              'Vulnerable and Outdated Components',
            ),
            'dep-table',
          ),
        );
      // 17 and 18 characters (Ubuntu security updates): never broken at
      // their hyphen; the Advisories column keeps its 31 %.
      expect(await widths('3.0.13-0ubuntu3.5')).toEqual([11, 32, 19, 7]);
      expect(await widths('1.1.1f-1ubuntu2.23')).toEqual([11, 31, 20, 7]);
      // The narrower count column has no left padding: its header fits.
      const html = await build('owasp', SAMPLES.owasp());
      expect(html).toMatch(
        /\.dep-table th\.right, \.dep-table td\.right \{ padding-left: 0; \}/,
      );
    });

    it('keeps the Fixed in column at 12 % when every fixed version fits it, and never widens it for a part no column holds', async () => {
      const short = await build(
        'owasp',
        owaspData({
          A06: [image({ projectId: 'p1', fixedVersion: '1.2.5-r23' })],
        }),
      );
      expect(
        colWidths(
          tableOf(
            section(short, 'Vulnerable and Outdated Components'),
            'dep-table',
          ),
        )[2],
      ).toBe(12);
      const hex = await build(
        'owasp',
        owaspData({
          A06: [
            image({
              projectId: 'p1',
              fixedVersion:
                '3.0.0-beta.20260922.9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b',
            }),
          ],
        }),
      );
      // Its 40 hexadecimal digits, in the part that opens its pre-release,
      // break anywhere at any width: it widens nothing.
      expect(
        colWidths(
          tableOf(
            section(hex, 'Vulnerable and Outdated Components'),
            'dep-table',
          ),
        )[2],
      ).toBe(12);
    });

    it('breaks a folder or file name longer than its line before its separators, never past the Location column', async () => {
      const at = (path: string, line: string) =>
        vuln({ name: 'Path traversal', path, line });
      const html = await build(
        'owasp',
        owaspData({
          A01: [
            at(
              'services/payments/SettlementReconciliationExportRepositoryImplementation.java',
              '1287-1293',
            ),
            at(
              'services/customer-identity-access-management/ReconciliationExportService.java',
              '12',
            ),
            at(
              'services/customer-identity-access-management/ReconciliationExportFacade.java',
              '30',
            ),
            at('infra/values.production.override.yaml', '42'),
          ],
        }),
      );
      const locs = tableOf(section(html, 'Broken Access Control'), 'code-table')
        .match(/<div class="locs">[\s\S]*?<\/td>/)[0]
        .replace(/<\/td>$/, '');
      // A camel-case name breaks between its words, never inside one
      // (« …ExportR / epository… »); its extension, colon and first lines
      // stay with its last part (never a line opening on « : » or on the
      // lines alone).
      expect(locs).toContain(
        `${breakableId('SettlementReconciliationExportRepositoryImplementation.java')}<span class="nw">:1287–1293</span>`,
      );
      expect(locs).toContain('Export<wbr>Repository');
      // A folder or file longer than its line (after the indent of a file
      // of a folder) breaks before its separators, not in a nowrap line.
      expect(locs).toContain(
        `${breakableId('customer-identity-access-management')}/`,
      );
      expect(locs).toContain(
        `${breakableId('ReconciliationExportService.java')}<span class="nw">:12</span>`,
      );
      // A line number of two digits never stands alone on its line.
      expect(locs).toContain(
        `${breakableId('values.production.override.yaml')}<span class="nw">:42</span>`,
      );
      // A file of a folder opens its own line, indented less than its next
      // ones: a name that fits it stays whole.
      const fits = await build(
        'owasp',
        owaspData({
          A03: ['8', '25'].flatMap((line) => [
            vuln({
              path: 'dashwright/examples/docker-compose.scaleway-s3.yml',
              line,
            }),
            vuln({
              path: 'dashwright/examples/docker-compose.minio.yml',
              line,
            }),
          ]),
        }),
      );
      expect(pdfLines(section(fits, 'Injection'))).toContain(
        '<span class="nw">docker-compose.scaleway-s3.yml:</span>',
      );
      // A list of lines is no fragment: it goes to the next line whole.
      const list = await build(
        'owasp',
        owaspData({
          A03: ['4', '21', '39', '75'].map((line) =>
            vuln({ path: 'dashwright/docker-compose.yaml', line }),
          ),
        }),
      );
      expect(pdfLines(section(list, 'Injection'))).toContain(
        'docker-compose.yaml:</span><wbr><span class="nw">4, 21, 39, 75</span>',
      );
      // Every unbreakable line fits the widest line of the column (32
      // characters of 10px monospace).
      for (const [, line] of locs.matchAll(
        /<span class="nw">((?:(?!<span class="nw">)[\s\S])*?)<\/span>(?=<wbr>| |<\/span>|<div)/g,
      )) {
        expect(text(line).length).toBeLessThanOrEqual(32);
      }
    });

    it('widens the project column of the per-project breakdown for a long name, its categories and « Not mapped » narrower', async () => {
      const html = await build(
        'owasp',
        {
          ...owaspData(
            { A03: [vuln({ projectId: 'p4', projectName: LONG_PROJECT })] },
            [
              vuln({
                owaspTop10: [],
                cwe: ['CWE-1'],
                projectId: 'p2',
                projectName: 'vitality-api',
              }),
            ],
          ),
          projectsMetadata: longMeta,
        },
        { projectIds: ['p1', 'p2', 'p3', 'p4'] },
      );
      const heat = tableOf(html, 'heatmap');
      // The name breaks before its hyphens, never after them.
      expect(heat).toContain(
        `<span class="name">${breakableId(LONG_PROJECT)}</span>`,
      );
      // Six lines of name beside rows of one: the header « Not mapped »
      // takes two lines, the count columns the width of their counts.
      expect(colWidths(heat)).toEqual([...Array(10).fill(5.6), 7.5, 7.5]);
      expect(heat).toContain('<th class="right two-line">Not mapped</th>');
      expect(html).toMatch(/ th\.two-line \{ white-space: normal; \}/);
      // Short names: the columns of before.
      const short = await build(
        'owasp',
        owaspData({
          A03: [vuln(), vuln({ projectId: 'p2', projectName: 'vitality-api' })],
        }),
      );
      expect(colWidths(tableOf(short, 'heatmap'))).toEqual([
        ...Array(10).fill(6.2),
        7.5,
      ]);
    });

    it('breaks a long project name of the triaged counts before its separators', async () => {
      const html = await build(
        'owasp',
        {
          ...owaspData({
            A03: [
              vuln({
                state: 'ignored',
                projectId: 'p4',
                projectName: LONG_PROJECT,
              }),
            ],
          }),
          projectsMetadata: longMeta,
        },
        { projectIds: ['p1', 'p2', 'p3', 'p4'] },
      );
      expect(tableOf(html, 'triaged-counts')).toContain(
        `<span class="name">${breakableId(LONG_PROJECT)}</span>`,
      );
    });

    it('sets the team and long branches of a project on a line of their own under its row, across the table', () => {
      expect(
        projectRows(
          { name: 'billing-service', team: 'Payments', branches: ['main'] },
          ['1'],
        ),
      ).toEqual([[projectCell('billing-service', 'Payments', ['main']), '1']]);
      expect(
        projectRows(
          {
            name: LONG_PROJECT,
            team: LONG_TEAM,
            branches: ['main', LONG_BRANCH],
          },
          ['1'],
        ),
      ).toEqual([
        [`<span class="name">${breakableId(LONG_PROJECT)}</span>`, '1'],
        {
          full: `<div class="project-sub">Identity &amp; Access Management Platform Engineering&nbsp;&middot; ${breakableId(LONG_BRANCH)}, main</div>`,
          attach: true,
        },
      ]);
      expect(AGGREGATED_CSS).toMatch(
        /\.project-sub \{ font-size: 10px; color: #[0-9a-f]+; \}/,
      );
      // A team too long for the Project column goes under the row too, with
      // the branches (beside a camel-case name it ran nine lines).
      const GUILD =
        'Identity, Access Management & Zero-Trust Platform Engineering Guild';
      expect(
        projectRows(
          { name: 'billing-service', team: GUILD, branches: ['main'] },
          ['1'],
        ),
      ).toEqual([
        [`<span class="name">billing-service</span>`, '1'],
        {
          full: `<div class="project-sub">${escapeHtml(GUILD)}&nbsp;&middot; main</div>`,
          attach: true,
        },
      ]);
      // A line under a row counts as a row of the table for each of its
      // lines (about 120 characters of its 10px text across the table).
      expect(rowCount([['a'], { full: 'x', attach: true }, ['b']])).toBe(3);
      expect(
        rowCount([
          ['a'],
          { full: `<div>${'x'.repeat(150)}</div>`, attach: true },
        ]),
      ).toBe(3);
      // The edges of a table that flows are its first and last projects,
      // each with the line under it.
      expect(
        edgeUnitsJoined([
          ['a'],
          ['b'],
          { full: 'x', attach: true },
          ['c'],
          ['d'],
        ]),
      ).toEqual([false, true, false, false, true]);
      expect(
        edgeUnitsJoined([['a'], { full: 'x', attach: true }, ['b']]),
      ).toEqual([false, false, false]);
    });

    it('gives the projects tables a line under a project whose branch is long, a table of a few projects kept whole', async () => {
      const long = {
        projectId: 'p4',
        projectName: LONG_PROJECT,
        teamName: LONG_TEAM,
        branches: [LONG_BRANCH],
      };
      const licenseOf = (others: string[]) =>
        build(
          'license',
          licenseData(
            [pkg()],
            [
              {
                ...long,
                packages: 1,
                byCategory: {
                  permissive: 1,
                  weakCopyleft: 0,
                  strongCopyleft: 0,
                  unknown: 0,
                },
              },
              ...others.map((n) => ({
                projectName: `project-${n}`,
                teamName: 'Web',
                branches: ['main'],
                packages: 0,
                byCategory: {},
              })),
            ],
          ),
        );
      const license = await licenseOf(['a', 'b', 'c', 'd', 'e']);
      const projects = section(license, 'Projects');
      expect(projects).toContain(
        '<tr class="note-row"><td colspan="6"><div class="project-sub">',
      );
      // Six projects, one with a line of two lines under it: each line of
      // it counts as a row, the table flows, its edges joined. Kept whole,
      // five projects and such a line went to the next page and left three
      // quarters of a page blank (CWE, OWASP, licenses).
      expect(projects).not.toContain('<div class="avoid-break"><table');
      // Four projects and the line: kept whole.
      expect(section(await licenseOf(['a', 'b', 'c']), 'Projects')).toContain(
        '<div class="avoid-break"><table',
      );
      // The numbers take the width of their header on two lines, the
      // project the rest.
      const table = tableOf(projects, 'compact');
      expect(colWidths(table)).toEqual([11, 12.5, 11, 11, 10.5]);
      expect(table).toContain('<th class="right two-line">Weak copyleft</th>');
      expect(license).toMatch(/th\.two-line \{ white-space: normal; \}/);

      const owasp = await build(
        'owasp',
        {
          ...owaspData({
            A03: [
              vuln({
                projectId: 'p4',
                projectName: LONG_PROJECT,
                branch: LONG_BRANCH,
              }),
              vuln(),
            ],
          }),
          projectsMetadata: longMeta,
        },
        { projectIds: ['p1', 'p2', 'p3', 'p4'] },
      );
      const owaspProjects = section(owasp, 'Projects');
      expect(owaspProjects).toContain('<div class="project-sub">');
      expect(owaspProjects).not.toContain(
        `<span class="inline-sub">${escapeHtml(LONG_TEAM)}`,
      );
    });

    it('breaks a long package name of the key facts before its separators', async () => {
      const LONG_PKG =
        '@very-long-organization-name/extremely-long-package-name-for-testing';
      const dep = (packageName: string, advisoryId: string) =>
        vuln({
          type: 'sca',
          path: undefined,
          line: undefined,
          packageName,
          packageVersion: '1.0.0',
          advisoryId,
          fixedVersion: '2.0.0',
          owaspTop10: [],
          cwe: [],
        });
      const html = await build(
        'owasp',
        owaspData({ A06: [dep(LONG_PKG, 'CVE-1'), dep(LONG_PKG, 'CVE-2')] }),
      );
      expect(section(html, 'Executive summary')).toContain(
        `Upgrading ${wholeName(LONG_PKG)} closes`,
      );
    });

    it('lets the lines of a location wrap in a dashboard preview narrower than the page at its separators only, never in the PDF', async () => {
      const html = await build(
        'owasp',
        owaspData({
          A03: [
            vuln({
              path: 'dashwright/frontend/src/components/PlaywrightTraceViewer.tsx',
              line: '84-93',
            }),
          ],
        }),
      );
      // A break between two parts of a line, before a « / » (or after a
      // comma of a list of lines), that only the preview shows: a hidden
      // <wbr> breaks nothing, and a line of the PDF stays whole.
      expect(section(html, 'Injection')).toContain(
        '<span class="nw">dashwright<wbr class="lw">/frontend</span>',
      );
      // Inside a part too, before its separators (a line of the preview
      // ran past its column, or broke after a hyphen).
      expect(section(html, 'Injection')).toContain(
        '<span class="nw">PlaywrightTraceViewer<wbr class="lw">.tsx:<wbr class="lw">84–93</span>',
      );
      expect(html).toMatch(/\.locs wbr\.lw \{ display: none; \}/);
      // Narrower than the page, the breaks show.
      const preview =
        /@media \(max-width: 928px\) \{ \.locs wbr\.lw \{ display: inline; \} \}/;
      expect(html).toMatch(preview);
      // Never the browser's own breaks (after a hyphen, inside a range).
      expect(html).not.toMatch(/\.locs \.nw \{ white-space: normal;/);
      const pdf = await build('owasp', SAMPLES.owasp(), { format: 'pdf' });
      expect(pdf).not.toMatch(preview);
    });

    it('keeps the title of the per-project breakdown with its table, never alone at the foot of a page', async () => {
      const html = await build(
        'owasp',
        owaspData({
          A03: [vuln(), vuln({ projectId: 'p2', projectName: 'vitality-api' })],
        }),
      );
      expect(html).toMatch(
        /<div class="avoid-break"><div class="table-title">Open findings per project and category<\/div><table class="[^"]*\bheatmap\b/,
      );
    });

    it('never glues a long project name to a rule, a location or a less severe row', async () => {
      const at = (over: Vuln = {}) =>
        vuln({
          name: 'Eval injection',
          path: 'src/utils.py',
          line: '28',
          ...over,
        });
      const html = await build(
        'owasp',
        {
          ...owaspData({
            A03: [
              at({ projectId: 'p4', projectName: LONG_PROJECT }),
              at({
                path: 'src/app.py',
                projectId: 'p2',
                projectName: 'vitality-api',
              }),
              at({
                severity: 'high',
                projectId: 'p4',
                projectName: LONG_PROJECT,
              }),
            ],
          }),
          projectsMetadata: longMeta,
        },
        { projectIds: ['p1', 'p2', 'p3', 'p4'] },
      );
      const table = tableOf(section(html, 'Injection'), 'code-table');
      // « only in » a project, and « see its critical row above (…) », its
      // comma or parenthesis kept with it.
      expect(table).toContain(`only in ${projectName(LONG_PROJECT)}`);
      const long = breakableId(LONG_PROJECT).replace(
        /[.*+?^${}()|[\]\\]/g,
        '\\$&',
      );
      expect(table).toMatch(
        new RegExp(
          `row above \\(<span class="nw is-long">${long},</span> <span class="nw">vitality-api\\)</span>`,
        ),
      );
      expect(table).not.toContain(`<span class="nw">${LONG_PROJECT}`);
    });

    it('fits the long versions and project names of the license tables and index', async () => {
      const html = await build(
        'license',
        licenseData([
          pkg({
            packageName: 'lodash',
            packageVersion: PRERELEASE,
            category: 'UNKNOWN',
            effectiveLicenses: ['UNKNOWN'],
            projects: [LONG_PROJECT],
          }),
          pkg({ packageName: 'debug', packageVersion: PRERELEASE }),
        ]),
      );
      const unknown = section(html, 'Unknown licenses');
      expect(unknown).toContain(
        `<span class="versions mono">${versionText(PRERELEASE)}</span>`,
      );
      expect(unknown).toContain(projectName(LONG_PROJECT));
      const index = section(html, 'Permissive package inventory');
      expect(index).toContain(
        `<span class="nw"><span class="pn">debug</span></span> <span class="versions mono">${versionText(PRERELEASE)}</span>`,
      );
    });

    it('breaks a long package name of the license tables before its separators, its ecosystem chip kept with its last part', async () => {
      const NUGET = 'Microsoft.Extensions.Configuration.EnvironmentVariables';
      const html = await build(
        'license',
        licenseData([
          pkg({
            ecosystem: 'nuget',
            packageName: NUGET,
            licenses: [],
            category: 'UNKNOWN',
            effectiveLicenses: ['UNKNOWN'],
          }),
          pkg({
            packageName: 'left-pad',
            licenses: [],
            category: 'UNKNOWN',
            effectiveLicenses: ['UNKNOWN'],
          }),
        ]),
      );
      const unknown = tableOf(section(html, 'Unknown licenses'), 'pkg-table');
      // « Microsoft.Extensions.Configu / ration… » cut a word while a « . »
      // was there. Its last part and the chip fit a line of the column.
      expect(unknown).toContain(
        `<span class="name">${breakableId(NUGET)}</span>&nbsp;<span class="chip">NuGet</span>`,
      );
      // A short name: breakable before its hyphen only, its chip after it.
      expect(unknown).toContain(
        '<span class="name">left<wbr><nobr>-p</nobr>ad</span> <span class="chip">npm</span>',
      );
    });

    it('gives the unknown licenses table with a declared license its room: projects on one line, the dependency kind too', async () => {
      const html = await build(
        'license',
        licenseData([
          pkg({
            packageName: 'left-pad',
            category: 'UNKNOWN',
            effectiveLicenses: ['UNKNOWN'],
            licenses: ['Custom-License'],
          }),
        ]),
      );
      const unknown = tableOf(section(html, 'Unknown licenses'), 'pkg-table');
      expect(colWidths(unknown)).toEqual([14, 16, 21, 24]);
      // A declared license that is an identifier breaks before its
      // hyphens, never after them.
      const REF = 'LicenseRef-acme-corp-proprietary-internal-use-only';
      const ref = await build(
        'license',
        licenseData([
          pkg({
            packageName: 'left-pad',
            category: 'UNKNOWN',
            effectiveLicenses: ['UNKNOWN'],
            licenses: [REF],
          }),
        ]),
      );
      expect(tableOf(section(ref, 'Unknown licenses'), 'pkg-table')).toContain(
        `<span class="versions mono">${breakableId(REF)}</span>`,
      );
    });

    it('sizes the versions column for a Go pseudo-version up to its hash, never for the whole version at the cost of the other columns', async () => {
      const GO = 'v0.0.0-20230817173708-d852ddb80c63';
      const html = await build(
        'license',
        licenseData([
          pkg({
            ecosystem: 'go',
            packageName: 'github.com/acme/resourcemapping',
            packageVersion: GO,
            licenses: [],
            category: 'UNKNOWN',
            effectiveLicenses: ['UNKNOWN'],
          }),
        ]),
      );
      const unknown = tableOf(section(html, 'Unknown licenses'), 'pkg-table');
      // « v0.0.0-20230817173708 », 21 characters: 22 %. At 16 % (its
      // longest part) it ran three lines, « v0.0.0 » alone first, read as a
      // published version. Whole (34 characters, 33 %), it took 8 points
      // from the projects, whose lists then ran two lines on every row.
      expect(colWidths(unknown)).toEqual([22, 22, 26]);
      // Short versions: the columns of before.
      const short = await build(
        'license',
        licenseData([
          pkg({
            licenses: [],
            category: 'UNKNOWN',
            effectiveLicenses: ['UNKNOWN'],
          }),
        ]),
      );
      expect(
        colWidths(tableOf(section(short, 'Unknown licenses'), 'pkg-table')),
      ).toEqual([14, 22, 26]);
    });

    // ── Pass 3: a package version is atomic ──────────────────────────────

    it('keeps a version of a list atomic: a Debian version never breaks in its revision nor between two digits', () => {
      // Long, it breaks only between its parts (before « + » or the « - » of
      // its revision), in its box, its comma inside.
      expect(versionItem(INSTALLED, true)).toBe(versionText(INSTALLED, ','));
      expect(versionItem(INSTALLED)).toContain(
        '8:6.9.11.60<wbr>+dfsg<wbr><nobr>-1</nobr>.6ubuntu1.3',
      );
      // Never between two digits nor in its revision (« -1 | .6ubuntu1.3 »).
      expect(versionItem(INSTALLED)).not.toMatch(/\d<wbr>[\d.]|ubuntu1<wbr>/);
      // A pre-release with a hash breaks before the « - » that opens it only.
      expect(versionItem(PRERELEASE)).toBe(versionText(PRERELEASE));
      expect(versionItem(PRERELEASE).match(/<wbr>/g)).toHaveLength(1);
      // Short: unchanged.
      expect(versionItem('1.0.0', true)).toBe('<span class="nw">1.0.0,</span>');
      // In a list entry, as in a table.
      expect(listEntry('left-pad', 'pn', [PRERELEASE, '4.0.0'])).toBe(
        `<span class="nw"><span class="pn">left-pad</span></span> <span class="versions mono">${versionText(PRERELEASE, ',')}</span><span class="versions mono"> <span class="nw">4.0.0</span></span>`,
      );
    });

    it('holds a Debian fixed version whole in one chip: Fixed in and Package widen to it, the advisories keep their floor', async () => {
      const table = tableOf(
        section(
          await build(
            'owasp',
            { ...owaspData({ A06: [image()] }), projectsMetadata: longMeta },
            { projectIds: ['p1', 'p2', 'p3', 'p4'] },
          ),
          'Vulnerable and Outdated Components',
        ),
        'dep-table',
      );
      // One chip, never two pastilles read as two versions.
      expect(table).toContain(versionChip(EPOCH_FIX));
      expect(table).not.toContain(codeChip(EPOCH_FIX));
      // 29 characters of 10px monospace, the chip's and the cell's padding:
      // 30 % for Fixed in, 30 % for the installed version under the package,
      // the advisories keep 22 %, the count 7 %.
      expect(colWidths(table)).toEqual([11, 30, 30, 7]);
      expect(table).toContain(
        `<span class="versions mono">${versionText(INSTALLED)}</span>`,
      );
    });

    it('never widens a version column past what the table holds: a version no column holds breaks between its parts', async () => {
      const widths = async (fixedVersion: string, packageVersion = '1.0.0') =>
        colWidths(
          tableOf(
            section(
              await build(
                'owasp',
                owaspData({
                  A06: [
                    image({ projectId: 'p1', fixedVersion, packageVersion }),
                  ],
                }),
              ),
              'Vulnerable and Outdated Components',
            ),
            'dep-table',
          ),
        );
      // 32 characters, the longest version kept whole: 33 %, the package
      // column down to its floor.
      const V32 = '1:2.38.1-5+deb12u3~bpo11+1.el9_4';
      expect(V32).toHaveLength(32);
      expect(await widths(V32)).toEqual([11, 26, 33, 7]);
      // With a long installed version beside it, the package column keeps
      // it whole and Fixed in holds what is left: the fixed version breaks
      // between its parts.
      const [, pkg, fixed] = await widths(V32, INSTALLED);
      expect(pkg).toBe(30);
      expect(fixed).toBeLessThan(33);
      expect(11 + pkg + fixed + 7 + 22).toBeLessThanOrEqual(100);
    });

    it('keeps the severities of the advisories of a package whole on a line, wrapped between two counts when the column narrows', async () => {
      const html = await build(
        'owasp',
        owaspData({
          A06: ['critical', 'high', 'medium', 'low'].map((severity, i) =>
            image({ projectId: 'p1', severity, advisoryId: `CVE-2026-${i}` }),
          ),
        }),
      );
      // One block, moved to the next line whole when it does not fit after
      // the count, broken between two counts only when longer than a line
      // (a Fixed in column widened for a Debian version narrows it).
      expect(tableOf(html, 'dep-table')).toContain(
        '<div class="adv-count">4\u00a0advisories <span class="muted breakdown"><span class="nw">(1 critical,</span> <span class="nw">1 high,</span> <span class="nw">1 medium,</span> <span class="nw">1 low)</span></span></div>',
      );
      expect(html).toMatch(
        /\.adv-count \.breakdown \{ display: inline-block; max-width: 100%; \}/,
      );
    });

    it('lets the tag of a withdrawn advisory wrap under its id, never past the Advisories column', async () => {
      const html = await build(
        'owasp',
        owaspData({
          A06: [
            image({
              projectId: 'p1',
              advisoryId: 'GHSA-crmx-v835-hcp4',
              withdrawn: true,
            }),
          ],
        }),
      );
      // The dot and the id never part; the tag may go under them.
      expect(tableOf(html, 'dep-table')).toMatch(
        /<span class="adv"><span class="nw"><i style="background: #[0-9a-f]+;"><\/i>GHSA-crmx-v835-hcp4<\/span><wbr><span class="tag">Withdrawn<\/span><\/span>/,
      );
      expect(html).toMatch(
        /\.adv \{ display: inline-block; max-width: 100%; margin-right: 8px; \}/,
      );
      expect(html).not.toMatch(/\.adv \{ white-space: nowrap;/);
    });

    it('holds every version of a license table whole: a short one has no break at all, the columns beside give it room', async () => {
      const widths = async (
        packageVersion: string,
        category: string,
        licenses: string[] = [],
      ) =>
        colWidths(
          tableOf(
            await build(
              'license',
              licenseData([
                pkg({
                  packageName: 'aspnet-sdk',
                  packageVersion,
                  category,
                  licenses,
                  effectiveLicenses: [
                    category === 'UNKNOWN' ? 'UNKNOWN' : 'LGPL-3.0-only',
                  ],
                }),
              ]),
            ),
            'pkg-table',
          ),
        );
      // 19 characters (a dated beta), never broken: 20 %, not 14 (it ran
      // over the Dependency column, « 4.0.0-beta.20231Direct »).
      expect(await widths('4.0.0-beta.20231012', 'WEAK_COPYLEFT')).toEqual([
        20, 22, 26,
      ]);
      // 23 characters beside a declared license: the Declared, Projects and
      // Dependency columns give it room, down to their floors; the package
      // keeps 25 %.
      const cols = await widths('8.0.0-preview.7.23375.9', 'UNKNOWN', [
        'Custom-License',
      ]);
      expect(cols).toEqual([23, 14, 20, 18]);
      expect(100 - cols.reduce((a, b) => a + b, 0)).toBe(25);
      // Narrowed, the header of the declared license takes two lines (it
      // ran over the Dependency header).
      const narrowed = await build(
        'license',
        licenseData([
          pkg({
            packageName: 'aspnet-sdk',
            packageVersion: '8.0.0-preview.7.23375.9',
            category: 'UNKNOWN',
            licenses: ['Custom-License'],
            effectiveLicenses: ['UNKNOWN'],
          }),
        ]),
      );
      expect(tableOf(narrowed, 'pkg-table')).toContain(
        '<th class="two-line">Declared license</th>',
      );
    });

    it('breaks a Go pseudo-version only before its hash, never between its base and its timestamp', async () => {
      const unknownTable = async (version: string, declared: boolean) =>
        tableOf(
          section(
            await build(
              'license',
              licenseData([
                pkg({
                  ecosystem: 'go',
                  packageName: 'github.com/acme/resourcemapping',
                  packageVersion: version,
                  licenses: declared ? ['Custom-License'] : [],
                  category: 'UNKNOWN',
                  effectiveLicenses: ['UNKNOWN'],
                }),
              ]),
            ),
            'Unknown licenses',
          ),
          'pkg-table',
        );
      // A break before the hash first: « v1.6.1-0.20230418173708 » then
      // « -d852ddb80c63 » (a commit BEFORE v1.6.1, never « v1.6.1 » alone
      // on a line). The base and its timestamp form a group of their own,
      // broken between them only when the group does not fit a line.
      const goText = (base: string, stamp: string, hash: string): string =>
        idBox(
          `<span class="id-text is-long"><span class="go-part">${piecesHtml([base, stamp])}</span><wbr><span class="go-part">${piecesHtml([hash])}</span></span>`,
          {},
        );
      for (const [base, stamp, hash, pct] of [
        ['v0.0.0', '-20230817173708', '-d852ddb80c63', 22],
        ['v1.6.1-0', '.20230418173708', '-d852ddb80c63', 23],
      ] as const) {
        const version = `${base}${stamp}${hash}`;
        // The column holds its base and its timestamp (21 and 23
        // characters: 22 % and 23 %), with or without a declared license.
        for (const declared of [false, true]) {
          const table = await unknownTable(version, declared);
          expect(table).toContain(goText(base, stamp, hash));
          expect(colWidths(table)[0]).toBe(pct);
        }
      }
    });

    it('sends the ecosystem chip of a long package name to the next line when its last part and the chip do not fit a line', async () => {
      const NUGET =
        'Microsoft.AspNetCore.Authentication.JwtBearer.IntegrationTestsSupport';
      const html = await build(
        'license',
        licenseData([
          pkg({
            ecosystem: 'nuget',
            packageName: NUGET,
            packageVersion: '8.0.0-preview.7.23375.9',
            category: 'UNKNOWN',
            effectiveLicenses: ['UNKNOWN'],
            licenses: ['Custom-License'],
          }),
        ]),
      );
      // « .IntegrationTestsSupport NuGet » is longer than a line of the
      // column: glued, the name broke inside a word (« …Suppor / t »).
      expect(tableOf(html, 'pkg-table')).toContain(
        `<span class="name">${breakableId(NUGET)}</span> <span class="chip">NuGet</span>`,
      );
    });

    it('breaks a long SPDX identifier before its separators', async () => {
      const SPDX = 'BSD-3-Clause-No-Nuclear-License-2014';
      const data = licenseData([pkg()]);
      data.categories.PERMISSIVE[0] = {
        ...data.categories.PERMISSIVE[0],
        spdxId: SPDX,
        name: 'BSD 3-Clause No Nuclear License 2014',
      };
      const html = await build('license', data);
      expect(tableOf(html, 'license-table')).toContain(
        `<span class="versions mono">${breakableId(SPDX)}</span>`,
      );
    });

    // ── Pass 3: dependency and container advisories ─────────────────────

    // ── Pass 4: license identifiers and distribution versions ──────────

    it('never breaks a short license id or package name after its hyphen, only before it', async () => {
      const html = await build(
        'license',
        licenseData([
          pkg({
            packageName: 'react-server-dom-webpack',
            licenses: ['LicenseRef-ImageMagick'],
            category: 'UNKNOWN',
            effectiveLicenses: ['UNKNOWN'],
          }),
        ]),
      );
      const unknown = tableOf(section(html, 'Unknown licenses'), 'pkg-table');
      // « LicenseRef- » ended a line like a hyphenated word.
      expect(unknown).toContain(
        '<span class="versions mono">LicenseRef<wbr><nobr>-I</nobr>mageMagick</span>',
      );
      expect(unknown).toContain(
        '<span class="name">react<wbr><nobr>-s</nobr>erver<wbr><nobr>-d</nobr>om<wbr><nobr>-w</nobr>ebpack</span>',
      );
    });

    it('holds a Debian or Ubuntu version whole in its column as far as the table allows', async () => {
      const lgpl = (packageVersion: string) =>
        pkg({
          packageName: 'imagemagick',
          packageVersion,
          ecosystem: 'deb',
          licenses: ['LGPL-3.0-only'],
          category: 'WEAK_COPYLEFT',
          effectiveLicenses: ['LGPL-3.0-only'],
        });
      const html = await build(
        'license',
        licenseData([
          lgpl('8:6.9.11.60+dfsg-1.3ubuntu0.22.04.5'),
          lgpl('8:6.9.11.60+dfsg-1.6ubuntu1.4'),
        ]),
      );
      const table = tableOf(section(html, 'Copyleft licenses'), 'pkg-table');
      // A jammy-security version, 35 characters: cut before its revision at
      // 29 %, where 34 % held it whole.
      expect(colWidths(table)[0]).toBe(34);
    });

    // ── Pass 4: container packages, one row per image ───────────────────

    it('keeps the mark after a long name ending on a hash inside its hash block', () => {
      const name = 'nightly-build-4f2d9c1e8b7a6d5c4b3a2f1e0d9c8b7a';
      // After a hash block, Chromium could send the comma alone to the next
      // line.
      expect(wholeName(name, ',')).toBe(
        `<span class="nw is-long">${punctuated(breakableId(name), { after: ',' })}</span>`,
      );
      expect(wholeName(name, ',')).toContain('8b7a,</span>');
    });

    const DIGEST_IMG =
      'registry.acme-corp.internal:5000/identity/backend-services@sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';
    const packagesOf = async (findings: Vuln[]) =>
      section(
        await build('owasp', {
          ...owaspData({ A06: findings }),
          projectsMetadata: longMeta,
        }),
        'Vulnerable and Outdated Components',
      );

    it('gives a package of several images a row, and a fix, per image', async () => {
      const detail = await packagesOf([
        image({
          projectId: 'p3',
          projectName: 'ml-recommender',
          packageName: 'imagemagick',
          image: 'debian:bookworm-20260901',
          packageVersion: '8:6.9.11.60+dfsg-1.6+deb12u1',
          fixedVersion: '8:6.9.11.60+dfsg-1.6+deb12u2',
        }),
        image({ packageName: 'imagemagick', image: DIGEST_IMG }),
      ]);
      const rows = bodyRows(tableOf(detail, 'dep-table')).filter((r) =>
        r.includes('imagemagick 8:'),
      );
      // One row said « Fixed in 8:6.9.11.60+dfsg-1.6+deb12u2 » for the
      // Ubuntu image too, where no such package exists.
      expect(rows).toHaveLength(2);
      expect(rows.find((r) => r.includes('deb12u1'))).toContain(
        '8:6.9.11.60+dfsg-1.6+deb12u2',
      );
      const ubuntu = rows.find((r) => r.includes(INSTALLED));
      expect(ubuntu).toContain(EPOCH_FIX);
      expect(ubuntu).not.toContain('deb12u2');
      expect(text(detail.split('class="cat-meta"')[0])).toContain(
        '2 vulnerable packages',
      );
    });

    it('names an image once, on a line above its packages, with their projects when they share them', async () => {
      const detail = await packagesOf([
        image({ packageName: 'imagemagick', image: DIGEST_IMG }),
        image({ packageName: 'libmagickcore-6.q16-6', image: DIGEST_IMG }),
        image({
          projectId: 'p1',
          projectName: 'billing-service',
          type: 'sca',
          packageName: 'ws',
          packageVersion: '5.2.0',
          fixedVersion: '5.2.5',
          advisoryId: 'CVE-2026-48779',
        }),
      ]);
      const table = tableOf(detail, 'dep-table');
      // The reference ran 6 to 9 lines in the Package column of every row
      // of its image.
      expect(table.match(/<tr class="image-row">/g)).toHaveLength(1);
      expect(table.split(pathText(DIGEST_IMG))).toHaveLength(2);
      expect(table).toContain(
        `<div class="image-head"><span class="image-label">Image</span> ${pathText(DIGEST_IMG)}<span class="inline-sep">&nbsp;&middot;</span> <span class="image-who">${projectNames([LONG_PROJECT])}</span></div>`,
      );
      expect(table).not.toContain('class="sub images"');
      // Its packages follow it, the first one joined to it: never the image
      // alone at the foot of a page.
      expect(table).toMatch(
        /<tbody class="unit"><tr class="image-row">[\s\S]*?imagemagick[\s\S]*?<\/tr><\/tbody>/,
      );
      // Their projects are the image's: named on its line only, and so is
      // the image. A row never repeats it (an Azure ML repository, a hash of
      // 32 hexadecimal digits, ran three lines on every row).
      const rows = bodyRows(table);
      expect(rows.filter((r) => r.includes(LONG_PROJECT))).toHaveLength(1);
      expect(rows.find((r) => r.includes('imagemagick 8:'))).toContain(
        `${INSTALLED} Container 1 advisory`,
      );
      expect(table).not.toContain('image backend-services');
      expect(table).toContain('<span class="who"></span>');
      expect(rows.find((r) => r.includes('ws 5.2.0'))).toContain(
        'billing-service',
      );
    });

    it('keeps the vulnerable packages in severity order with images: an image groups its packages within one severity only', async () => {
      const sca = (packageName: string, severity: string, n = 1): Vuln[] =>
        Array.from({ length: n }, (_, i) =>
          vuln({
            projectId: 'p1',
            projectName: 'billing-service',
            type: 'sca',
            path: undefined,
            line: undefined,
            packageName,
            packageVersion: '1.0.0',
            fixedVersion: '1.0.1',
            advisoryId: `CVE-2026-${packageName.length}${i}`,
            severity,
            owaspTop10: [],
            cwe: [],
          }),
        );
      const inImage = (packageName: string, severity: string, n = 1) =>
        Array.from({ length: n }, (_, i) =>
          image({
            packageName,
            image: DIGEST_IMG,
            severity,
            advisoryId: `CVE-2026-9${packageName.length}${i}`,
          }),
        );
      const table = tableOf(
        await packagesOf([
          ...inImage('openssl', 'critical', 3),
          ...sca('cryptography', 'critical', 2),
          ...inImage('libssl3t64', 'critical'),
          ...inImage('pnpm', 'high', 2),
          ...sca('langgraph', 'critical'),
          ...sca('adm-zip', 'high'),
          ...inImage('zlib1g', 'medium'),
          ...sca('moment', 'low'),
        ]),
        'dep-table',
      );
      const rank = ['Critical', 'High', 'Medium', 'Low'];
      const severities = bodyRows(table)
        .map((r) => rank.indexOf(r.split(' ')[0]))
        .filter((i) => i >= 0);
      // The image's packages were drawn together at the place of its most
      // severe one: langgraph (critical) came after pnpm (high).
      expect(severities).toEqual([...severities].sort((a, b) => a - b));
      expect(
        bodyRows(table)
          .filter((r) => !r.startsWith('Image '))
          .map((r) => r.split(' ').slice(0, 2).join(' ')),
      ).toEqual([
        'Critical openssl',
        'Critical libssl3t64',
        'Critical cryptography',
        'Critical langgraph',
        'High pnpm',
        'High adm-zip',
        'Medium zlib1g',
        'Low moment',
      ]);
    });

    it('covers with an image line only the rows of that image right below it, and closes it on the last one: a dependency of a manifest is never under it', async () => {
      const table = tableOf(
        await packagesOf([
          image({ packageName: 'openssl', image: DIGEST_IMG }),
          image({ packageName: 'libssl3t64', image: DIGEST_IMG }),
          image({ packageName: 'pnpm', image: DIGEST_IMG, severity: 'high' }),
          vuln({
            projectId: 'p1',
            projectName: 'billing-service',
            type: 'sca',
            path: undefined,
            line: undefined,
            packageName: 'twisted',
            packageVersion: '22.4.0',
            fixedVersion: '22.10.0',
            advisoryId: 'CVE-2026-1111',
            owaspTop10: [],
            cwe: [],
          }),
        ]),
        'dep-table',
      );
      const rows = table.split('</thead>')[1].split('<tr').slice(1);
      const classes = rows.map((r) => /^ class="([^"]*)"/.exec(r)?.[1] ?? '');
      const names = rows.map((r) =>
        r.includes('image-head')
          ? 'IMAGE'
          : (text(`<tr${r}`).split(' ')[1] ?? ''),
      );
      expect(names).toEqual([
        'IMAGE',
        'libssl3t64',
        'openssl',
        'twisted',
        'IMAGE',
        'pnpm',
      ]);
      // Every row under an image line belongs to it, up to the one that
      // closes it; twisted, from a manifest, is under none.
      expect(classes).toEqual([
        'image-row',
        'in-image',
        'in-image image-end',
        '',
        'image-row',
        'in-image image-end',
      ]);
      // Its rule runs down the left edge of its rows and stops on the last
      // one.
      const html = await build(
        'owasp',
        owaspData({ A06: [image({ image: DIGEST_IMG })] }),
      );
      expect(html).toMatch(
        /\.dep-table tr\.in-image td:first-child::before, \.dep-table tr\.image-row td::before \{ content: ''; position: absolute; left: 0; top: -1px; bottom: -1px; width: 2px;/,
      );
      expect(html).toMatch(
        /\.dep-table tr\.image-end td:first-child::before \{ bottom: 0; \}/,
      );
    });

    it('paints the cells of an image row in the order of any other row: its severity badge never covers the package beside it', async () => {
      const html = await build(
        'owasp',
        owaspData({ A06: [image({ image: DIGEST_IMG })] }),
      );
      // Only its first cell positioned (to hold the rule), the row painted
      // that cell above the others: in a preview under 760 px, the badge,
      // wider than its column, covered the start of the package name
      // (« ar » for tar, « magemagick »). Every cell of the row positioned,
      // the package is painted after the badge, as on a row under no image.
      expect(html).toMatch(
        /\.dep-table tr\.in-image td, \.dep-table tr\.image-row td \{ position: relative; \}/,
      );
      expect(html).not.toMatch(
        /tr\.in-image td:first-child, \.dep-table tr\.image-row td \{ position: relative; \}/,
      );
    });

    it('names each image of a table on its own line, two tags of one repository included: its rows never repeat it', async () => {
      const table = tableOf(
        await packagesOf([
          image({
            packageName: 'imagemagick',
            image: 'registry.acme.io/api:7',
          }),
          image({ packageName: 'libtiff6', image: 'registry.acme.io/api:8' }),
          image({ packageName: 'zlib1g', image: DIGEST_IMG }),
        ]),
        'dep-table',
      );
      const lines = plainRows(table);
      for (const ref of ['registry.acme.io/api:7', 'registry.acme.io/api:8']) {
        expect(lines.filter((r) => r.includes(ref))).toHaveLength(1);
      }
      const rows = bodyRows(table);
      for (const name of ['imagemagick', 'libtiff6', 'zlib1g']) {
        expect(rows.find((r) => r.startsWith(`Critical ${name}`))).toContain(
          `${INSTALLED} Container 1 advisory`,
        );
      }
      expect(table).not.toContain('image-name');
    });

    it('sets the image line on the Package column, closed on its packages', async () => {
      const html = await build(
        'owasp',
        owaspData({ A06: [image({ image: DIGEST_IMG })] }),
      );
      expect(html).toMatch(
        /\.dep-table tr\.image-row td \{ padding-top: 7px; padding-bottom: 1px; border-bottom: none; \}/,
      );
      // The Severity column is 11 % of the table, the cell's padding 2 x 8px.
      expect(html).toMatch(
        /\.image-head \{ margin-left: calc\(11% \+ 1\.76px\); font-size: 10px;/,
      );
    });

    it('keeps a package chip that wraps one chip (the shared slice), never one pill per line', async () => {
      const html = await build(
        'owasp',
        owaspData({ A06: [image({ image: DIGEST_IMG })] }),
      );
      // « @very-long-organization-name », « /extremely-long-package-name »
      // and « -for-testing » read as three packages.
      expect(html).not.toMatch(
        /\.dep-table \.code-chip\.pkg \{[^}]*box-decoration-break/,
      );
      expect(html).toMatch(
        /\.dep-table \.code-chip\.pkg \{ display: inline; \}/,
      );
    });

    it('still names the projects of a package of an image found in only some of them', async () => {
      const table = tableOf(
        await packagesOf([
          image({ packageName: 'imagemagick', image: DIGEST_IMG }),
          image({
            packageName: 'libmagickcore-6.q16-6',
            image: DIGEST_IMG,
            projectId: 'p3',
            projectName: 'ml-recommender',
          }),
        ]),
        'dep-table',
      );
      const rows = bodyRows(table);
      expect(rows[0]).toContain(`${LONG_PROJECT}, ml-recommender`);
      // Its projects say where it is: no short image name after them (the
      // line ran to two).
      const magick = rows.find((r) => r.includes('imagemagick 8:'));
      expect(magick).toContain(LONG_PROJECT);
      expect(magick).not.toContain('image backend-services');
      expect(
        rows.find((r) => r.includes('libmagickcore-6.q16-6 8:')),
      ).toContain('Container ml-recommender');
    });

    // The image's packages of the category below: two of a critical line,
    // one of a high line, a dependency of a manifest between them.
    const imageLines = (): Vuln[] => [
      image({ packageName: 'openssl', image: DIGEST_IMG }),
      image({ packageName: 'libssl3t64', image: DIGEST_IMG }),
      image({ packageName: 'pnpm', image: DIGEST_IMG, severity: 'high' }),
      vuln({
        projectId: 'p1',
        projectName: 'billing-service',
        type: 'sca',
        path: undefined,
        line: undefined,
        packageName: 'twisted',
        packageVersion: '22.4.0',
        fixedVersion: '22.10.0',
        advisoryId: 'CVE-2026-1111',
        owaspTop10: [],
        cwe: [],
      }),
    ];
    const pdfPackagesOf = async (findings: Vuln[]) =>
      section(
        await build(
          'owasp',
          { ...owaspData({ A06: findings }), projectsMetadata: longMeta },
          { format: 'pdf' },
        ),
        'Vulnerable and Outdated Components',
      );
    /** Classes of the body rows of a table (`''` for a row without one). */
    const rowClassesOf = (table: string): string[] =>
      Array.from(
        table.split('</thead>')[1].matchAll(/<tr(?: class="([^"]*)")?>/g),
        (m) => m[1] ?? '',
      );

    it('names an image again at the head of every page its packages continue on: in the PDF, they form a table of their own in one row of the table, its header the line naming the image', async () => {
      const pdf = await pdfPackagesOf(imageLines());
      const outer = wholeTableOf(pdf, 'dep-table');
      // The category's table keeps its header and its context row: the
      // page a line continues on still names the category and the columns.
      expect(outer).toMatch(
        /^<table class="fixed has-cont compact dep-table">/,
      );
      const colgroup = /<colgroup>[\s\S]*?<\/colgroup>/.exec(outer)[0];
      const blocks = Array.from(
        outer.matchAll(
          /<tr class="image-block"><td colspan="5"><table class="([^"]*)">([\s\S]*?)<\/table><\/td><\/tr>/g,
        ),
      );
      // One per image line (a severity each).
      expect(blocks).toHaveLength(2);
      for (const [, cls, inner] of blocks) {
        expect(cls).toBe('fixed compact dep-table image-table');
        // The columns of the table it sits in: the stack reads as one
        // table.
        expect(inner.startsWith(colgroup)).toBe(true);
        // Its header is the line naming the image and its projects, alone
        // (no column labels, no context row): Chromium repeats it at the
        // head of every page its rows continue on, under the header of the
        // category's table. Named once, the rows sent to the next page
        // named neither the image nor its project (a line of 13 packages of
        // an Ubuntu image ran past a page).
        const head = inner.split('</thead>')[0];
        expect(head).toMatch(
          /<\/colgroup><thead><tr class="image-row"><td colspan="5"><div class="image-head"><span class="image-label">Image<\/span> /,
        );
        expect(head).toContain(pathText(DIGEST_IMG));
        expect(head).toContain(projectNames([LONG_PROJECT]));
        expect(head).not.toMatch(/<th[\s>]/);
        expect(head).not.toContain('cont-row');
      }
      // Its packages below it, the last one closing its rule; the rows of
      // a page never repeat the image.
      expect(rowClassesOf(blocks[0][2])).toEqual([
        'in-image',
        'in-image image-end',
      ]);
      expect(
        bodyRows(blocks[0][2]).map((r) => r.split(' ').slice(0, 2).join(' ')),
      ).toEqual(['Critical libssl3t64', 'Critical openssl']);
      expect(rowClassesOf(blocks[1][2])).toEqual(['in-image image-end']);
      expect(bodyRows(blocks[1][2])[0]).toMatch(/^High pnpm /);
      // A dependency of a manifest stays a row of the category's table,
      // under no image, between the two lines.
      const own = outer.replace(
        /<table class="[^"]*image-table[\s\S]*?<\/table>/g,
        '',
      );
      expect(rowClassesOf(own)).toEqual(['image-block', '', 'image-block']);
      expect(bodyRows(own)[1]).toMatch(/^Critical twisted /);
      // The document names each line once: the pages it continues on name
      // it through the repeated header.
      expect(pdf.split(pathText(DIGEST_IMG))).toHaveLength(3);
    });

    it('keeps one table in the preview, which never breaks into pages: the image line a row of it', async () => {
      const preview = await packagesOf(imageLines());
      expect(preview).not.toContain('image-table');
      expect(preview).not.toContain('image-block');
      expect(rowClassesOf(tableOf(preview, 'dep-table'))).toEqual([
        'image-row',
        'in-image',
        'in-image image-end',
        '',
        'image-row',
        'in-image image-end',
      ]);
    });

    it('sets the image line of the PDF as in the preview: the row holding its table unpadded, the table flush with it, the line without the background of a header', async () => {
      const pdf = await build(
        'owasp',
        owaspData({ A06: [image({ image: DIGEST_IMG })] }),
        { format: 'pdf' },
      );
      expect(pdf).toMatch(/\.dep-table tr\.image-block > td \{ padding: 0; \}/);
      // The row holding them breaks between two packages, as the table's
      // own rows do: kept whole like any row, it left the foot of the page
      // before it blank (a line of a dozen packages).
      expect(pdf).toMatch(
        /\.dep-table tr\.image-block \{ break-inside: auto; \}/,
      );
      // Its first and last packages go to another page as in one table:
      // the first one with the line, the others alone (the edges of a
      // table, kept in pairs, sent a line and two packages to the next
      // page, the foot of the page before it blank).
      expect(pdf).toMatch(
        /table\.image-table tbody:first-of-type > tr:first-child \+ tr, table\.image-table tbody:last-child > tr:last-child \{ break-before: auto; \}/,
      );
      // Nor is a line of the category's table tied to the row before or
      // after it (its first and last rows): Chromium, unable to break
      // there, never breaks inside the row before it but before it, and an
      // image line that fitted the page went to the next one, the foot of
      // the page blank.
      expect(pdf).toMatch(
        /table\.dep-table:not\(\.image-table\) > tbody > tr\.image-block, table\.dep-table:not\(\.image-table\) > tbody > tr\.image-block \+ tr \{ break-before: auto; \}/,
      );
      // Each row draws its own bottom rule: collapsed, the rule a row shares
      // with the one above it, left on the page before, was drawn again
      // under the repeated line.
      expect(pdf).toMatch(
        /table\.image-table \{ margin-top: 0; border-collapse: separate; border-spacing: 0; \}/,
      );
      expect(pdf).toMatch(
        /\.dep-table thead tr\.image-row \{ background: none; \}/,
      );
    });

    it('rules the packages of the last image of a table in the PDF as those of the others', async () => {
      const pdf = await build(
        'owasp',
        owaspData({ A06: [image({ image: DIGEST_IMG })] }),
        { format: 'pdf' },
      );
      // The table's last row drops its rule, and the image's table sits in
      // that row: every package of the last image lost its rule with it.
      // Only the image's own last package goes without, the row holding
      // the table drawing the rule under it. Two classes: the shared rule
      // weighs two pseudo-classes, and one class lost to it.
      expect(pdf).toMatch(
        /table\.dep-table\.image-table > tbody > tr > td \{ border-bottom: 1px solid #efebf4; \}\s*table\.dep-table\.image-table > tbody:last-child > tr:last-child > td \{ border-bottom: none; \}/,
      );
    });

    it('lists the dependency and container advisories of a weakness in the CWE report, as the per-project report counts them', async () => {
      const html = await build(
        'cwe',
        cweData({
          'CWE-22': [
            image({ projectId: 'p1', cwe: ['CWE-22'] }),
            vuln({ name: 'Path traversal', cwe: ['CWE-22'] }),
          ],
        }),
      );
      const weakness = section(html, 'Path traversal');
      expect(weakness).toContain('dep-table');
      expect(weakness).toContain(versionChip(EPOCH_FIX));
      const about = text(html.split('<section class="about">')[1]);
      // « dependency and container advisories carry no CWE » was false.
      expect(about).not.toContain('carry no CWE');
      expect(about).toContain(
        'dependency and container advisories through those of their advisory',
      );
      expect(about).toContain('A vulnerable package is one row');
    });

    it('sets identifiers without the ligatures of their monospace face', () => {
      // « libstdc++6 » printed a single « ++ » glyph.
      expect(AGGREGATED_CSS).toMatch(
        /\.code-chip, \.path, \.mono, \.id-text, \.code \{ font-variant-ligatures: none; font-feature-settings: "liga" 0, "calt" 0; \}/,
      );
    });

    // ── Pass 3: paths of the Location column ────────────────────────────

    /** The Location cell of the first row of a code table. */
    const locsOf = (html: string): string =>
      tableOf(html, 'code-table')
        .match(/<div class="locs">[\s\S]*?<\/td>/)[0]
        .replace(/<\/td>$/, '');
    /** Visible text of markup, tags dropped without a space. */
    const bare = (html: string): string =>
      html
        .replace(/<[^>]+>/g, '')
        .replace(/&ndash;/g, '–')
        .replace(/&amp;/g, '&');

    it('breaks a path of the Location column before its slashes, as every other report, a folder of a group keeping its trailing slash', async () => {
      const DEEP =
        'services/payments-gateway/src/main/java/com/acmecorp/platform/payments/infrastructure/adapters/Export.java';
      const locs = locsOf(
        section(
          await build(
            'owasp',
            owaspData({
              A01: [vuln({ name: 'Path traversal', path: DEEP, line: '12' })],
            }),
          ),
          'Broken Access Control',
        ),
      );
      // A line never ends on a slash: the next one opens on it.
      expect(locs).not.toMatch(/\/(?:<\/span>)?<wbr>/);
      expect(locs).toMatch(/<wbr><span class="nw">\/[a-z]/);
      expect(bare(locs)).toBe(`${DEEP}:12`);
      // The folder of a group of files keeps its trailing slash: a tree
      // notation, not a cut.
      const group = await build(
        'owasp',
        owaspData({
          A03: ['benefits.html', 'login.html'].map((file) =>
            vuln({ path: `NodeGoat/app/views/${file}` }),
          ),
        }),
      );
      expect(pdfLines(section(group, 'Injection'))).toContain(
        '<div class="loc-dir"><span class="path"><span class="nw">NodeGoat/app/views/</span></span></div>',
      );
      // A long folder of a group: before its slashes too, its last one kept.
      const long = await build(
        'owasp',
        owaspData({
          A03: ['A.java', 'B.java'].map((file) =>
            vuln({
              path: `services/customer-identity-access-management/${file}`,
            }),
          ),
        }),
      );
      expect(section(long, 'Injection')).toContain(
        `<wbr>${breakableId('/customer-identity-access-management/')}`,
      );
    });

    it('indents the wrapped lines of a file name one step further than the lines of its path: never read as another file', async () => {
      const NAME =
        'SettlementReconciliationExportRepositoryImplementation.java';
      const locs = locsOf(
        section(
          await build(
            'owasp',
            owaspData({
              A01: [
                vuln({
                  name: 'Path traversal',
                  path: `services/payments/${NAME}`,
                  line: '1287-1293',
                }),
              ],
            }),
          ),
          'Broken Access Control',
        ),
      );
      // The name, its slash, its colon and its first lines in one block,
      // broken before its separators and between its words.
      expect(locs).toContain(
        `<span class="loc-name">${breakableId(`/${NAME}`)}<span class="nw">:1287–1293</span></span>`,
      );
      const html = await build('owasp', SAMPLES.owasp());
      expect(html).toMatch(
        /\.loc-name \{ display: inline-block; max-width: 100%; padding-left: 10px; text-indent: -10px; \}/,
      );
      // A name opening its location (no folder) goes two steps in: one
      // step is the indent of a file listed under a folder.
      expect(html).toMatch(
        /\.loc > \.path > \.loc-name:first-child \{ padding-left: 20px; text-indent: -20px; \}/,
      );
    });
  });

  describe('counts, narrow previews, image rows, homonyms and Go versions', () => {
    /** The printed table: 688px wide. */
    const PDF_TABLE_PX = 688;

    /**
     * Each column of a table: its share of the table (%), its floor in every
     * medium and its floor in the dashboard preview (px, 0 without one).
     */
    const columnsOf = (table: string) =>
      Array.from(table.matchAll(/<col(?: style="([^"]*)")?>/g)).map((m) => {
        const style = m[1] ?? '';
        return {
          pct: Number(
            /width: (?:var\(--narrow-share, )?([\d.]+)%/.exec(style)?.[1] ?? 0,
          ),
          min: Number(/(?:^|; )min-width: ([\d.]+)px/.exec(style)?.[1] ?? 0),
          preview: Number(/--preview-min: ([\d.]+)px/.exec(style)?.[1] ?? 0),
        };
      });

    /** Header labels of a table, in the order of its columns. */
    const headers = (table: string): string[] =>
      Array.from(
        table
          .split('</thead>')[0]
          .matchAll(/<th(?: class="[^"]*")?>([^<]*)<\/th>/g),
      ).map((m) => m[1]);

    /** The column of a table under the header `label`. */
    const column = (table: string, label: string) => {
      const i = headers(table).indexOf(label);
      if (i < 0) throw new Error(`column "${label}" not found`);
      return columnsOf(table)[i];
    };

    /** Every table of a document carrying the class `cls`. */
    const tablesOf = (html: string, cls: string): string[] =>
      Array.from(
        html.matchAll(
          new RegExp(
            `<table class="[^"]*\\b${cls}\\b[^"]*">[\\s\\S]*?</table>`,
            'g',
          ),
        ),
      ).map((m) => m[0]);

    const many = (n: number, over: Vuln = {}): Vuln[] =>
      Array.from({ length: n }, () => vuln(over));

    it('never breaks a count: a count column holds its widest count on one line, in the PDF too (« 1,26 / 8 »)', async () => {
      const xss = (n: number, severity: string) =>
        many(n, {
          severity,
          name: 'Reflected XSS in template',
          cwe: ['CWE-79'],
          path: 'src/views/index.ejs',
          line: '12',
        });
      const html = await build(
        'cwe',
        cweData({ 'CWE-79': [...xss(3305, 'high'), ...xss(12, 'critical')] }),
      );
      const matrix = tableOf(section(html, 'CWE Top 25 at a glance'), 'matrix');
      // « 3,305 », semibold on the Total row: about 32px, and the right
      // padding (the matrix has no left one). The High column was sized on
      // its header only (5.4 %, 37px): the count broke after « 3,30 ».
      const high = column(matrix, 'High');
      expect(high.min).toBeGreaterThanOrEqual(39);
      expect(high.min).toBeGreaterThan((high.pct * PDF_TABLE_PX) / 100);
      // The Projects table, padded on both sides.
      const projects = tableOf(section(html, 'Projects'), 'counts');
      expect(column(projects, 'High').min).toBeGreaterThanOrEqual(47);
      // A count cell never breaks: too long for its column, it widens it.
      expect(html).toMatch(
        /table\.compact td\.right \{ white-space: nowrap; \}/,
      );
      const pdf = await build(
        'cwe',
        cweData({ 'CWE-79': [...xss(3305, 'high'), ...xss(12, 'critical')] }),
        { format: 'pdf' },
      );
      expect(pdf).toMatch(
        /table\.compact td\.right \{ white-space: nowrap; \}/,
      );
      expect(column(tableOf(pdf, 'matrix'), 'High').min).toBe(high.min);
    });

    it('sizes the heat map on its counts too: a cell holds its shaded box, the Total column its total', async () => {
      const html = await build(
        'owasp',
        owaspData({
          A06: many(1200, { name: 'Outdated component', severity: 'high' }),
          A03: [vuln({ projectId: 'p2', projectName: 'vitality-api' })],
        }),
      );
      const heat = tableOf(
        section(html, 'OWASP Top 10 at a glance'),
        'heatmap',
      );
      // « 1,200 » in its box (5px of padding each side), and the cell's
      // padding (2px and 6px).
      expect(column(heat, 'A06').min).toBeGreaterThanOrEqual(46);
      expect(column(heat, 'A06').min).toBeGreaterThan(
        (column(heat, 'A06').pct * PDF_TABLE_PX) / 100,
      );
      expect(column(heat, 'Total').min).toBeGreaterThanOrEqual(38);
    });

    it('keeps the columns of the PDF when their counts fit them: a floor never wider than the column the page gives', async () => {
      const three = ['critical', 'high', 'medium', 'low', 'unknown'].flatMap(
        (severity) => many(180, { severity }),
      );
      const triaged = many(120, { state: 'ignored', severity: 'high' });
      for (const html of [
        await build('owasp', owaspData({ A03: [...three, ...triaged] })),
        await build('cwe', cweData({ 'CWE-89': [...three, ...triaged] })),
      ]) {
        const tables = tablesOf(html, 'counts');
        expect(tables.length).toBeGreaterThanOrEqual(3);
        for (const table of tables) {
          for (const c of columnsOf(table).filter((c) => c.min)) {
            expect(c.min).toBeLessThanOrEqual((c.pct * PDF_TABLE_PX) / 100);
          }
        }
      }
    });

    it('lets a count table size its columns on their content in a preview narrower than the page: headers never overlap, counts never break', async () => {
      const html = await build(
        'owasp',
        owaspData({
          A03: [vuln(), vuln({ state: 'ignored', severity: 'high' })],
        }),
      );
      // The projects, the matrix, the heat map and the triaged counts.
      expect(tablesOf(html, 'counts')).toHaveLength(4);
      expect(tableOf(section(html, 'Projects'), 'compact')).toMatch(
        /^<table class="fixed compact counts">/,
      );
      // Narrower than the page, a count table takes the widths of its
      // headers and counts (its name column the rest), its headers closer
      // set: spaced as in the PDF, they took 21 px of the category column at
      // 850 px, and three categories more went on two lines than in the
      // columns of the page. Narrower still, its headers are set smaller,
      // the multi-word ones on two lines.
      const layout =
        /@media \(max-width: 928px\) \{[^}]*\}?\s*table\.counts \{ table-layout: auto; \}/;
      expect(html).toMatch(layout);
      expect(html).toMatch(
        /@media \(max-width: 928px\) \{[^@]*table\.counts th \{ letter-spacing: 0\.02em; \}/,
      );
      expect(html).toMatch(
        /@media \(max-width: 820px\) \{\s*table\.counts th \{ font-size: 8\.5px; \}/,
      );
      expect(html).toMatch(/\.heatmap th\.right \{[^}]*white-space: normal;/);
      // The projects a pointer names break after a comma there, never
      // inside a name (« (billing- / service, »).
      expect(html).toMatch(
        /@media \(max-width: 820px\) \{[^@]*\.rule-ref\.own \.ref-names \{ white-space: normal; \}/,
      );
      // The PDF keeps its layout.
      const pdf = await build(
        'owasp',
        owaspData({
          A03: [vuln(), vuln({ state: 'ignored', severity: 'high' })],
        }),
        { format: 'pdf' },
      );
      expect(pdf).not.toMatch(/table\.counts \{ table-layout: auto; \}/);
      expect(pdf).not.toMatch(/table\.counts th \{ font-size: 8\.5px/);
    });

    it('keeps every word of a project name of the heat map whole at the width of the dashboard preview (821 to 928 px), never « ml- / recommender »', async () => {
      const data = {
        ...owaspData({
          A03: [
            vuln({ projectId: 'p3', projectName: 'ml-recommender' }),
            vuln({ projectId: 'p4', projectName: 'customer portal' }),
          ],
        }),
        projectsMetadata: [
          ...PROJECTS_META,
          { id: 'p4', name: 'customer portal', teamName: 'Web' },
        ],
      };
      const over = { projectIds: ['p1', 'p2', 'p3', 'p4'] };
      const html = await build('owasp', data, over);
      const heat = tableOf(html, 'heatmap');
      // Each word of a name a unit of its own: a table sized on its
      // content (a preview under 929 px) gives the Project column the width
      // of its longest word at least.
      expect(heat).toContain(
        '<span class="name"><span class="word">ml-recommender</span></span>',
      );
      expect(heat).toContain(
        '<span class="name"><span class="word">customer</span> <span class="word">portal</span></span>',
      );
      // Whole there as long as the headers keep their size: at 850 px, the
      // count columns widened to their counts had taken the room of the
      // names (« ml- / recommender », « customer- / portal »).
      expect(html).toMatch(
        /@media \(min-width: 821px\) and \(max-width: 928px\) \{ \.heatmap \.name \.word \{ white-space: nowrap; \} \}/,
      );
      // The header « Not mapped » takes two lines there: on one line, its
      // column left the names too little under 850 px.
      expect(html).toMatch(
        /@media \(max-width: 928px\) \{[^@]*table\.counts\.heatmap th\.right \{ white-space: normal; \}/,
      );
      // The PDF, its columns sized for the page, keeps its layout.
      const pdf = await build('owasp', data, { ...over, format: 'pdf' });
      expect(pdf).not.toMatch(/\.heatmap \.name \.word \{/);
      expect(pdf).not.toMatch(
        /table\.counts\.heatmap th\.right \{ white-space: normal; \}/,
      );
    });

    it('keeps the count of a state clear of the Count column in a narrow preview (never « Confirmed 69 » for 6 and 9)', async () => {
      const data = owaspData({
        A03: [
          ...many(6, { state: 'confirmed' }),
          ...many(3, { state: 'to_verify' }),
        ],
      });
      const html = await build('owasp', data);
      const table = tableOf(section(html, 'Injection'), 'code-table');
      // « Confirmed 6 »: the dot, the label, the count (about 75px), and the
      // cell padding; « COUNT » and its right padding (no left one).
      const state = column(table, 'State');
      const count = column(table, 'Count');
      expect(state.min).toBeGreaterThanOrEqual(91);
      expect(count.min).toBeGreaterThanOrEqual(44);
      // Within the columns the page gives: the PDF keeps its layout.
      expect(state.min).toBeLessThanOrEqual((state.pct * PDF_TABLE_PX) / 100);
      expect(count.min).toBeLessThanOrEqual((count.pct * PDF_TABLE_PX) / 100);
      // A count of three digits widens the column, in the PDF too (it ran
      // past it).
      const wide = tableOf(
        section(
          await build(
            'owasp',
            owaspData({
              A03: [
                ...many(180, { state: 'confirmed' }),
                ...many(3, { state: 'to_verify' }),
              ],
            }),
          ),
          'Injection',
        ),
        'code-table',
      );
      expect(column(wide, 'State').min).toBeGreaterThan(
        (column(wide, 'State').pct * PDF_TABLE_PX) / 100,
      );
    });

    it('never lets a short fixed version or a part of a package name outgrow its column in a narrow preview', async () => {
      const html = await build(
        'owasp',
        owaspData({
          A06: [
            vuln({
              type: 'container',
              name: 'musl: out-of-bounds write',
              path: undefined,
              line: undefined,
              packageName: 'musl',
              packageVersion: '1.2.5-r10',
              fixedVersion: '1.2.5-r23',
              advisoryId: 'CVE-2025-26519',
            }),
            vuln({
              type: 'container',
              name: 'ImageMagick path traversal',
              path: undefined,
              line: undefined,
              packageName: 'libmagickcore-6-headers',
              packageVersion: '8:6.9.11.60+dfsg-1.6ubuntu1.3',
              fixedVersion: '8:6.9.11.60+dfsg-1.6ubuntu1.4',
              advisoryId: 'CVE-2026-25965',
            }),
          ],
        }),
      );
      const table = tableOf(
        section(html, 'Vulnerable and Outdated Components'),
        'dep-table',
      );
      // « 1.2.5-r23 » whole: 9 characters of 10px monospace, the chip's
      // padding (5px each side), the cell's (8px each side).
      expect(column(table, 'Fixed in').preview).toBeGreaterThanOrEqual(80);
      // « libmagickcore-6-headers » whole (23 characters), in its chip.
      expect(column(table, 'Package').preview).toBeGreaterThanOrEqual(164);
      // Narrower still, both keep that room only: the Advisories column
      // takes the rest (their shares, sized for the PDF, left it too little).
      expect(table).toMatch(
        /<col style="width: var\(--narrow-share, [\d.]+%\); --preview-min: 164px">/,
      );
      expect(html).toMatch(
        /@media \(max-width: 820px\) \{ table\.fixed col \{ --narrow-share: 1px; \} \}/,
      );
      // The column that takes the rest keeps « 1 advisory » whole: never a
      // word broken because the others took their room.
      expect(table).toMatch(/<col style="width: auto; --preview-min: \d+px">/);
      expect(column(table, 'Advisories').preview).toBeGreaterThanOrEqual(62);
      // Honoured by the preview only: the PDF keeps its columns.
      const floor =
        /table\.fixed col \{ min-width: var\(--preview-min, 0px\); \}/;
      expect(html).toMatch(floor);
      expect(
        await build(
          'owasp',
          owaspData({ A06: [vuln({ type: 'sca', packageName: 'ws' })] }),
          { format: 'pdf' },
        ),
      ).not.toMatch(floor);
    });

    it('keeps the first version on the line of its package name in the PDF only: a narrower preview lets it go to the next line', async () => {
      const html = await build(
        'owasp',
        owaspData({
          A06: [
            vuln({
              type: 'sca',
              name: 'Prometheus exporter advisory',
              path: undefined,
              line: undefined,
              packageName: '@opentelemetry/exporter-prometheus',
              packageVersion: '0.217.0',
              fixedVersion: '0.218.0',
              advisoryId: 'GHSA-2x8r-3m4v-9pq7',
            }),
          ],
        }),
      );
      const table = tableOf(
        section(html, 'Vulnerable and Outdated Components'),
        'dep-table',
      );
      expect(table).toContain(
        '<span class="glue">&nbsp;</span><span class="unglue"> </span><span class="versions mono">',
      );
      expect(html).toMatch(/\.dep-table \.unglue \{ display: none; \}/);
      expect(html).toMatch(
        /@media \(max-width: 928px\) \{[^}]*\}\s*\.dep-table \.glue \{ display: none; \}\s*\.dep-table \.unglue \{ display: inline; \}/,
      );
      // The no-break space kept the version on the line in a column narrower
      // than the page: the Package column of the preview does not keep room
      // for both.
      expect(column(table, 'Package').preview).toBeLessThan(
        (19 + 1 + 7) * 6 + 10 + 10 + 16,
      );
    });

    it('names an image once when its line covers the rows: a row never repeats its hash name (« image azureml_05b92… » on three lines)', async () => {
      const AZURE =
        'e4feaa3fac914202b07ad1e0a3ad933e.azurecr.io/azureml/azureml_05b92b0c3f062d7d80a0ae539d0c1321:1';
      const inImage = (packageName: string) =>
        vuln({
          type: 'container',
          name: `${packageName} advisory`,
          path: undefined,
          line: undefined,
          packageName,
          packageVersion: '8:6.9.11.60+dfsg-1.6ubuntu1.3',
          fixedVersion: '8:6.9.11.60+dfsg-1.6ubuntu1.4',
          advisoryId: `CVE-2026-${packageName.length}01`,
          image: AZURE,
          projectId: 'p3',
          projectName: 'ml-recommender',
        });
      const table = tableOf(
        section(
          await build(
            'owasp',
            owaspData({
              A06: [
                'imagemagick',
                'libmagickcore-6-arch-config',
                'libmagickwand-dev',
              ].map(inImage),
            }),
          ),
          'Vulnerable and Outdated Components',
        ),
        'dep-table',
      );
      // Named once, by the line above its packages (and its projects).
      expect(
        table
          .replace(/<[^>]+>/g, '')
          .split('azureml_05b92b0c3f062d7d80a0ae539d0c1321'),
      ).toHaveLength(2);
      expect(table).not.toContain('class="image-name"');
      // Each row keeps its scanner chip under the package.
      for (const row of bodyRows(table).filter((r) => r.includes('8:6.9'))) {
        expect(row).toContain(
          '8:6.9.11.60+dfsg-1.6ubuntu1.3 Container 1 advisory',
        );
      }
    });

    const homonyms = [
      {
        projectId: 'web',
        projectName: 'api',
        teamName: 'Web',
        branches: ['main'],
        packages: 1,
        byCategory: {
          permissive: 1,
          weakCopyleft: 0,
          strongCopyleft: 0,
          unknown: 0,
        },
      },
      {
        projectId: 'platform',
        projectName: 'api',
        teamName: 'Platform',
        branches: ['main'],
        packages: 2,
        byCategory: {
          permissive: 1,
          weakCopyleft: 0,
          strongCopyleft: 1,
          unknown: 0,
        },
      },
      {
        projectId: 'billing',
        projectName: 'billing-service',
        teamName: 'Payments',
        branches: ['main'],
        packages: 1,
        byCategory: {
          permissive: 1,
          weakCopyleft: 0,
          strongCopyleft: 0,
          unknown: 0,
        },
      },
    ];
    const gpl = {
      packageName: 'readline',
      licenses: ['GPL-3.0-only'],
      category: 'STRONG_COPYLEFT',
      effectiveLicenses: ['GPL-3.0-only'],
      isTransitive: false,
    };

    it('counts two projects of the same name apart, by their ids (MIT used by 3 projects, never 2)', async () => {
      const html = await build(
        'license',
        licenseData(
          [
            pkg({
              projects: ['api', 'billing-service'],
              projectIds: ['billing', 'platform', 'web'],
            }),
            pkg({ ...gpl, projects: ['api'], projectIds: ['platform'] }),
          ],
          homonyms,
        ),
      );
      const permissive = tableOf(
        section(html, 'Permissive licenses'),
        'license-table',
      );
      expect(bodyRows(permissive)).toEqual(['MIT License MIT 1 3']);
    });

    it('names a project with its team wherever another project has the same name', async () => {
      const html = await build(
        'license',
        licenseData(
          [
            pkg({
              projects: ['api', 'billing-service'],
              projectIds: ['billing', 'platform', 'web'],
            }),
            pkg({ ...gpl, projects: ['api'], projectIds: ['platform'] }),
            pkg({
              ...gpl,
              packageName: 'bash',
              projects: ['api', 'billing-service'],
              projectIds: ['billing', 'web'],
              licenseIgnored: true,
            }),
          ],
          homonyms,
        ),
      );
      // The package table: the team of the one that uses it, never the
      // other one's; a name no other project has, alone.
      const copyleft = bodyRows(
        tableOf(section(html, 'Copyleft licenses'), 'pkg-table'),
      );
      expect(copyleft[0]).toMatch(/ api · Platform$/);
      expect(copyleft[0]).not.toContain('Web');
      const accepted = bodyRows(
        tableOf(section(html, 'Accepted during triage'), 'accepted-table'),
      );
      expect(accepted[0]).toMatch(/ api · Web, billing-service$/);
      // The key facts too.
      expect(text(section(html, 'Executive summary'))).toContain(
        'a direct production dependency of api · Platform;',
      );
      // Unique names, unchanged.
      const unique = await build(
        'license',
        licenseData([
          pkg({ ...gpl, projects: ['billing-service'], projectIds: ['p1'] }),
        ]),
      );
      expect(
        bodyRows(tableOf(section(unique, 'Copyleft licenses'), 'pkg-table'))[0],
      ).toMatch(/ billing-service$/);
    });

    const goTable = async (version: string, declared: boolean) =>
      tableOf(
        section(
          await build(
            'license',
            licenseData([
              pkg({
                ecosystem: 'go',
                packageName: 'github.com/docker/docker',
                packageVersion: version,
                licenses: declared ? ['Custom-License'] : [],
                category: 'UNKNOWN',
                effectiveLicenses: ['UNKNOWN'],
              }),
            ]),
          ),
          'Unknown licenses',
        ),
        'pkg-table',
      );

    /** A Go pseudo-version as a list sets it: its two groups of parts. */
    const goHtml = (groups: string[][]): string =>
      idBox(
        `<span class="id-text is-long">${groups
          .map((g) => `<span class="go-part">${piecesHtml(g)}</span>`)
          .join('<wbr>')}</span>`,
        {},
      );

    it('keeps « +incompatible » and the timestamp of a Go pseudo-version whole: a line breaks before the hash, else before the timestamp or the « + »', async () => {
      for (const declared of [false, true]) {
        const incompatible = await goTable(
          'v28.0.5-0.20250327124211-1d1bb5c4787d+incompatible',
          declared,
        );
        expect(incompatible).toContain(
          goHtml([
            ['v28.0.5-0', '.20250327124211'],
            ['-1d1bb5c4787d', '+incompatible'],
          ]),
        );
        const rc = await goTable(
          'v2.0.0-rc.1.0.20230418173708-d852ddb80c63',
          declared,
        );
        expect(rc).toContain(
          goHtml([['v2.0.0-rc.1.0', '.20230418173708'], ['-d852ddb80c63']]),
        );
        // The column holds its longest part (« .20230418173708 », 15
        // characters of 10px monospace, and the cell padding) in the PDF
        // and in the preview: never a timestamp broken between two digits.
        for (const table of [incompatible, rc]) {
          const versions = column(table, 'Versions');
          expect((versions.pct * 675) / 100).toBeGreaterThanOrEqual(
            15 * 6 + 16,
          );
          expect(versions.preview).toBeGreaterThanOrEqual(15 * 6 + 16);
        }
      }
    });

    it('keeps the comma after a Go pseudo-version in its last part: never alone at the head of a line', async () => {
      const html = await build(
        'license',
        licenseData(
          [
            'v1.6.1-0.20230418173708-d852ddb80c63',
            'v28.0.5-0.20250327124211-1d1bb5c4787d+incompatible',
          ].map((packageVersion) =>
            pkg({
              ecosystem: 'go',
              packageName: 'github.com/docker/docker',
              packageVersion,
              licenses: [],
              category: 'UNKNOWN',
              effectiveLicenses: ['UNKNOWN'],
            }),
          ),
        ),
      );
      const table = tableOf(section(html, 'Unknown licenses'), 'pkg-table');
      expect(table).toContain(
        `<span class="go-part">${piecesHtml(['-d852ddb80c63'])},</span></span></span>`,
      );
      expect(html).toMatch(
        /\.go-part \{ display: inline-block; max-width: 100%; \}/,
      );
    });
  });
});
