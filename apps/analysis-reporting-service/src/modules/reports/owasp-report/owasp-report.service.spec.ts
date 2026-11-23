import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Logger } from 'nestjs-pino';
import { OwaspReportService } from './owasp-report.service';
import { OwaspReport } from 'src/entities/owasp-report.entity';
import { ScaVulnerabilityDetections } from 'src/entities/sca-vulnerability-detections.entity';
import { SastVulnerabilityDetections } from 'src/entities/sast-vulnerability-detections.entity';
import { IacVulnerabilityDetections } from 'src/entities/iac-vulnerability-detections.entity';
import { VulnerabilityDetectionsContainer } from 'src/entities/container_vulnerability_detections.entity';
import { PdfGeneratorService } from 'src/core/utils/pdf-generator.service';
import { ProjectNameResolver } from '../shared/project-name-resolver.service';
import { OwaspReportData } from './owasp-report.types';
import {
  NO_REPORT_ANALYSIS,
  REPORT_ANALYSIS,
  type ReportAnalysisPort,
} from '../../../edition/ports/report-analysis.port';

const sastRow = (over: Record<string, unknown> = {}) => ({
  id: 's1',
  currentSeverity: 'high',
  effectiveSeverity: null,
  currentState: 'to_verify',
  currentPriority: 'normal',
  language: 'JavaScript',
  path: 'app/routes/index.js',
  vulnerableStartLine: 12,
  vulnerableEndLine: 12,
  vulnerability: {
    name: 'SQL injection',
    description: 'Untrusted input reaches a query.',
    cwe: ['CWE-89'],
    owaspTop10: ['A03:2021 - Injection'],
  },
  createdAt: new Date('2026-09-01T00:00:00Z'),
  updateAt: new Date('2026-09-01T00:00:00Z'),
  ...over,
});

const scaRow = (over: Record<string, unknown> = {}) => ({
  id: 'sca1',
  currentSeverity: 'critical',
  effectiveSeverity: null,
  currentState: 'to_verify',
  currentPriority: 'normal',
  scaDetectedPackage: { packageName: 'lodash', packageVersion: '4.17.4' },
  vulnerability: {
    id: 'GHSA-jf85-cpcp-j695',
    summary: 'Prototype pollution in lodash',
    details: 'lodash before 4.17.12 is vulnerable.',
    aliases: [{ alias: 'CVE-2019-10744' }, { alias: 'GHSA-jf85-cpcp-j695' }],
    affected: [
      {
        packageName: 'lodash',
        ranges: [
          {
            events: [
              { introduced: '0' },
              { fixed: '4.17.12' },
              { introduced: '5.0.0' },
              { fixed: '5.0.1' },
            ],
          },
        ],
      },
    ],
  },
  createdAt: new Date('2026-09-01T00:00:00Z'),
  updatedAt: new Date('2026-09-01T00:00:00Z'),
  ...over,
});

const containerRow = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  vulnerabilityIdentifier: 'CVE-2026-28390',
  currentSeverity: 'high',
  effectiveSeverity: null,
  currentState: 'to_verify',
  currentPriority: 'normal',
  fixedVersion: '3.5.6-r0',
  detectedPackage: {
    packageName: 'libssl3',
    packageVersion: '3.5.5-r0',
    class: 'os-pkgs',
  },
  detectedImage: { artifactName: 'alpine:latest' },
  vulnerability: { summary: 'OpenSSL NULL dereference' },
  createdAt: new Date('2026-09-01T00:00:00Z'),
  updatedAt: new Date('2026-09-01T00:00:00Z'),
  ...over,
});

describe('OwaspReportService', () => {
  let service: OwaspReportService;
  let resolverMock: { resolve: jest.Mock };
  let repos: Record<'sast' | 'iac' | 'sca' | 'container', { find: jest.Mock }>;
  let pdfMock: jest.Mock;
  let cybeLoader: { load: jest.Mock; renderer: ReportAnalysisPort['renderer'] };
  let logger: { log: jest.Mock; warn: jest.Mock; error: jest.Mock };

  const data = async (): Promise<OwaspReportData> => {
    const result = await service.generateReport('p1', 'json', true, 'main');
    return JSON.parse(result.content.toString());
  };

  // bindAnalysis: REPORT_ANALYSIS is bound (an analysis extension); the
  // Community Edition binds none.
  const build = async (bindAnalysis = true) => {
    const detectionRepoMock = () => ({ find: jest.fn().mockResolvedValue([]) });
    repos = {
      sast: detectionRepoMock(),
      iac: detectionRepoMock(),
      sca: detectionRepoMock(),
      container: detectionRepoMock(),
    };
    const owaspRepoMock = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation((x) => x),
      save: jest.fn().mockImplementation(async (x) => x),
    };
    resolverMock = { resolve: jest.fn().mockResolvedValue('Acme Web App') };
    pdfMock = jest.fn().mockResolvedValue(Buffer.from('pdf'));
    cybeLoader = {
      load: jest.fn().mockResolvedValue(new Map()),
      renderer: NO_REPORT_ANALYSIS,
    };
    logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OwaspReportService,
        { provide: getRepositoryToken(OwaspReport), useValue: owaspRepoMock },
        {
          provide: getRepositoryToken(ScaVulnerabilityDetections),
          useValue: repos.sca,
        },
        {
          provide: getRepositoryToken(SastVulnerabilityDetections),
          useValue: repos.sast,
        },
        {
          provide: getRepositoryToken(IacVulnerabilityDetections),
          useValue: repos.iac,
        },
        {
          provide: getRepositoryToken(VulnerabilityDetectionsContainer),
          useValue: repos.container,
        },
        { provide: Logger, useValue: logger },
        { provide: PdfGeneratorService, useValue: { generatePDF: pdfMock } },
        { provide: ProjectNameResolver, useValue: resolverMock },
        ...(bindAnalysis
          ? [{ provide: REPORT_ANALYSIS, useValue: cybeLoader }]
          : []),
      ],
    }).compile();

    service = module.get(OwaspReportService);
  };
  beforeEach(() => build());

  describe('report data', () => {
    it('embeds resolved project name, id and branch', async () => {
      const d = await data();
      expect(resolverMock.resolve).toHaveBeenCalledWith('p1');
      expect(d.scanMetadata.projectId).toBe('p1');
      expect(d.scanMetadata.projectName).toBe('Acme Web App');
      expect(d.scanMetadata.branch).toBe('main');
    });

    it('fails soft: a missing project name leaves only the id', async () => {
      resolverMock.resolve.mockResolvedValue(undefined);
      const d = await data();
      expect(d.scanMetadata.projectName).toBeUndefined();
      expect(d.scanMetadata.projectId).toBe('p1');
    });

    it('maps vulnerable dependencies and container packages to A06 by definition', async () => {
      repos.sca.find.mockResolvedValue([scaRow()]);
      repos.container.find.mockResolvedValue([containerRow()]);
      const d = await data();
      const a06 = d.owaspCategories.find((c) => c.categoryData.id === 'A06');
      expect(a06?.vulnerabilities.map((v) => v.id).sort()).toEqual([
        'c1',
        'sca1',
      ]);
      expect(d.summary.byOwaspCategory['A06:2021']).toBe(2);
    });

    it('puts every finding in exactly one category or in the unmapped count, so the figures add up', async () => {
      repos.sast.find.mockResolvedValue([
        sastRow({ id: 'tagged' }),
        // No OWASP tag: falls back to the category whose CWE list matches.
        sastRow({
          id: 'by-cwe',
          vulnerability: {
            name: 'CSRF',
            description: '',
            cwe: ['352'],
            owaspTop10: [],
          },
        }),
        // CWE-259 is listed in both A02 and A07: counted once.
        sastRow({
          id: 'two-lists',
          vulnerability: {
            name: 'Hard-coded password',
            description: '',
            cwe: ['CWE-259'],
            owaspTop10: [],
          },
        }),
        // Only a 2017 tag and a CWE outside the Top 10: not mapped.
        sastRow({
          id: 'none',
          vulnerability: {
            name: 'Resource exhaustion',
            description: '',
            cwe: ['CWE-400'],
            owaspTop10: ['A06:2017 - Security Misconfiguration'],
          },
        }),
      ]);
      repos.sca.find.mockResolvedValue([scaRow()]);
      const d = await data();

      const placed = d.owaspCategories.flatMap((c) =>
        c.vulnerabilities.map((v) => v.id),
      );
      expect(new Set(placed).size).toBe(placed.length);
      expect(d.summary.unmapped).toBe(1);
      expect(placed).not.toContain('none');
      const categoryOf = (id: string) =>
        d.owaspCategories.find((c) =>
          c.vulnerabilities.some((v) => v.id === id),
        )?.categoryData.id;
      expect(categoryOf('tagged')).toBe('A03');
      expect(categoryOf('by-cwe')).toBe('A01');
      expect(categoryOf('two-lists')).toBe('A02');
      const sum = Object.values(d.summary.byOwaspCategory).reduce(
        (a, b) => a + b,
        0,
      );
      expect(sum + d.summary.unmapped).toBe(d.summary.totalVulnerabilities);
    });

    it('carries the advisory id, CVE, installed version and the fix above it for SCA findings', async () => {
      repos.sca.find.mockResolvedValue([scaRow()]);
      const [v] = (await data()).vulnerabilities;
      expect(v).toMatchObject({
        type: 'sca',
        name: 'Prototype pollution in lodash',
        advisoryId: 'GHSA-jf85-cpcp-j695',
        cve: 'CVE-2019-10744',
        packageName: 'lodash',
        packageVersion: '4.17.4',
        fixedVersion: '4.17.12',
      });
    });

    it('flags a dependency finding whose advisory its publisher withdrew, from the OSV record', async () => {
      repos.sca.find.mockResolvedValue([
        scaRow(),
        scaRow({
          id: 'sca2',
          vulnerability: {
            ...scaRow().vulnerability,
            id: 'GHSA-crvj-3gj9-gm2p',
            summary: 'High severity vulnerability that affects qs',
            withdrawnAt: new Date('2020-06-16T23:32:53Z'),
          },
        }),
      ]);
      repos.container.find.mockResolvedValue([
        containerRow({
          vulnerability: {
            summary: 'Rejected CVE',
            withdrawnAt: new Date('2026-01-01T00:00:00Z'),
          },
        }),
      ]);
      const byId = new Map(
        (await data()).vulnerabilities.map((v) => [v.id, v]),
      );
      expect(byId.get('sca1').withdrawn).toBe(false);
      expect(byId.get('sca2').withdrawn).toBe(true);
      expect(byId.get('c1').withdrawn).toBe(true);
    });

    it('loads the OSV aliases and affected ranges the SCA mapping needs, without a cartesian join', async () => {
      await data();
      const options = repos.sca.find.mock.calls[0][0];
      expect(options.relations).toEqual(
        expect.arrayContaining([
          'vulnerability.aliases',
          'vulnerability.affected.ranges.events',
        ]),
      );
      expect(options.relationLoadStrategy).toBe('query');
    });

    it('carries the image, installed version and fix of container findings', async () => {
      repos.container.find.mockResolvedValue([containerRow()]);
      const [v] = (await data()).vulnerabilities;
      expect(v).toMatchObject({
        type: 'container',
        name: 'CVE-2026-28390',
        packageName: 'libssl3',
        packageVersion: '3.5.5-r0',
        fixedVersion: '3.5.6-r0',
        imageName: 'alpine:latest',
      });
      expect(repos.container.find.mock.calls[0][0].relations).toContain(
        'detectedImage',
      );
    });

    it('carries the exploitability assessment of a detection', async () => {
      repos.sast.find.mockResolvedValue([
        sastRow({
          exploitabilityVerdict: 'proven',
          exploitabilitySource: 'agent',
          exploitabilityScore: 0.85,
          exploitabilityReason: 'Reachable from an unauthenticated route.',
        }),
        sastRow({ id: 's2' }),
      ]);
      const [withVerdict, without] = (await data()).vulnerabilities;
      expect(withVerdict.exploitability).toEqual({
        verdict: 'proven',
        source: 'agent',
        score: 0.85,
        reason: 'Reachable from an unauthenticated route.',
      });
      expect(without.exploitability).toBeUndefined();
    });
  });

  describe('rendering', () => {
    it('renders the cover with the escaped project name, its id and the branch', async () => {
      resolverMock.resolve.mockResolvedValue('Acme <script>');
      const result = await service.generateReport('p1', 'html', true, 'main');
      const html = result.content.toString();

      expect(html).toContain('class="cover"');
      expect(html).toContain('Acme &lt;script&gt;');
      expect(html).not.toContain('Acme <script>');
      expect(html).toContain('p1');
      expect(html).toContain('main');
    });

    it('shows "All branches" when no branch is provided', async () => {
      const result = await service.generateReport('p1', 'html', true);
      expect(result.content.toString()).toContain('All branches');
    });

    it('carries the CybeDefend brand in the HTML and in the PDF', async () => {
      const html = (
        await service.generateReport('p1', 'html', true, 'main')
      ).content.toString();
      expect(html).toContain('data:image/png;base64,');
      expect(html).toContain('CYBEDEFEND');

      await service.generateReport('p1', 'pdf', true, 'main');
      const pdfHtml = pdfMock.mock.calls[0][0] as string;
      expect(pdfHtml).toContain('data:image/png;base64,');
      expect(pdfHtml).toContain('CYBEDEFEND');
    });

    it('builds on the shared design system (base CSS, embedded fonts, no script)', async () => {
      const html = (
        await service.generateReport('p1', 'html', true, 'main')
      ).content.toString();
      expect(html).toContain('.code-chip');
      expect(html).toContain('@font-face');
      expect(html).toContain('#7845FF');
      expect(html).not.toContain('<script');
      expect(html).not.toContain('page-break-inside');
    });

    it('asks Puppeteer to wait for the end-of-document footer and titles the running footer with the project', async () => {
      await service.generateReport('p1', 'pdf', true, 'main');
      expect(pdfMock.mock.calls[0][1]).toEqual(
        expect.objectContaining({
          waitForSelector: '.footer',
          footerTitle: 'OWASP Top 10 report · Acme Web App',
        }),
      );
      expect(pdfMock.mock.calls[0][1].waitForFunction).toBeUndefined();
    });

    it('names the files after the project id, the branch and the day', async () => {
      const result = await service.generateReport(
        'p1',
        'pdf',
        true,
        'feature/x y',
      );
      expect(result.filename).toMatch(
        /^owasp-top10-report-p1-feature_x_y-\d{4}-\d{2}-\d{2}\.pdf$/,
      );
      expect(result.contentType).toBe('application/pdf');
    });

    it('rejects an unknown format', async () => {
      await expect(
        service.generateReport('p1', 'docx', true, 'main'),
      ).rejects.toBeDefined();
    });
  });
  describe('Cybe Analysis', () => {
    const pinned = {
      markdown:
        '## Verdict\nTrue Positive\n\n## Summary\nThe query trusts the body.',
      date: '2026-04-14T18:37:31.000Z',
      url: 'https://app.example.com/project/p1/sast/issue/s1',
    };

    it('loads the analyses of open findings and of critical or high triaged ones, per family', async () => {
      repos.sast.find.mockResolvedValueOnce([
        sastRow({ id: 's1', currentSeverity: 'MEDIUM' }),
        sastRow({ id: 's2', currentSeverity: 'HIGH', currentState: 'ignored' }),
        sastRow({
          id: 's3',
          currentSeverity: 'MEDIUM',
          currentState: 'resolved',
        }),
      ]);
      repos.sca.find.mockResolvedValueOnce([
        scaRow({
          id: 'a1',
          currentSeverity: 'CRITICAL',
          currentState: 'ignored',
        }),
      ]);
      repos.container.find.mockResolvedValueOnce([containerRow()]);
      await service.generateReport('p1', 'pdf', true);
      expect(cybeLoader.load).toHaveBeenCalledWith('p1', 'sast', ['s1', 's2']);
      expect(cybeLoader.load).toHaveBeenCalledWith('p1', 'sca', ['a1']);
      expect(cybeLoader.load).toHaveBeenCalledWith('p1', 'container', ['c1']);
      expect(cybeLoader.load).toHaveBeenCalledWith('p1', 'iac', []);
    });

    it('loads nothing for a summary report', async () => {
      repos.sast.find.mockResolvedValueOnce([sastRow()]);
      await service.generateReport('p1', 'pdf', false);
      expect(cybeLoader.load).not.toHaveBeenCalled();
    });

    it('pins the analysis on the finding, in the list and in its category, and in JSON', async () => {
      repos.sast.find.mockResolvedValueOnce([
        sastRow({ id: 's1' }),
        sastRow({ id: 's2' }),
      ]);
      cybeLoader.load.mockImplementation(async (_p: string, family: string) =>
        family === 'sast' ? new Map([['s1', pinned]]) : new Map(),
      );
      const report = await data();
      const s1 = report.vulnerabilities.find((v) => v.id === 's1');
      expect(s1.cybeAnalysis).toEqual(pinned);
      expect(
        report.vulnerabilities.find((v) => v.id === 's2'),
      ).not.toHaveProperty('cybeAnalysis');
      const a03 = report.owaspCategories.find(
        (c) => c.categoryData.id === 'A03',
      );
      expect(
        a03.vulnerabilities.find((v) => v.id === 's1').cybeAnalysis,
      ).toEqual(pinned);
    });

    it('hands the bound renderer to the template', async () => {
      repos.sast.find.mockResolvedValueOnce([sastRow({ id: 's1' })]);
      cybeLoader.load.mockImplementation(async (_p: string, family: string) =>
        family === 'sast' ? new Map([['s1', pinned]]) : new Map(),
      );
      cybeLoader.renderer = {
        ...NO_REPORT_ANALYSIS,
        briefSource: (v) =>
          v.cybeAnalysis
            ? { id: v.id, pinned: v.cybeAnalysis, agentVerdict: null }
            : null,
        buildBrief: () => ({ pill: null }),
        card: () => '<div class="test-analysis-card"></div>',
      };
      const html = (
        await service.generateReport('p1', 'html', true)
      ).content.toString();
      expect(html).toContain('<div class="test-analysis-card"></div>');
    });

    describe('without an analysis extension (REPORT_ANALYSIS unbound)', () => {
      beforeEach(() => build(false));

      it('loads no analysis and still builds the detailed report', async () => {
        repos.sast.find.mockResolvedValueOnce([sastRow({ id: 's1' })]);
        const report = await data();
        expect(cybeLoader.load).not.toHaveBeenCalled();
        expect(report.vulnerabilities[0]).not.toHaveProperty('cybeAnalysis');
        repos.sast.find.mockResolvedValueOnce([sastRow({ id: 's1' })]);
        const html = (
          await service.generateReport('p1', 'html', true)
        ).content.toString();
        expect(html).not.toContain('ca-card');
      });
    });

    it('still generates the report when the analyses cannot be loaded', async () => {
      repos.sast.find.mockResolvedValueOnce([sastRow()]);
      cybeLoader.load.mockRejectedValue(new Error('connection lost'));
      const report = await data();
      expect(report.vulnerabilities[0]).not.toHaveProperty('cybeAnalysis');
      expect(logger.warn).toHaveBeenCalledWith(
        'Cybe Analysis lookup failed (project=p1, family=sast): connection lost',
      );
    });
  });
});
