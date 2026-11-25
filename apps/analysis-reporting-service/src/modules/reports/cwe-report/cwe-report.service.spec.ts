import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Logger } from 'nestjs-pino';
import { CweReportService } from './cwe-report.service';
import { CweReport } from 'src/entities/cwe-report.entity';
import { ScaVulnerabilityDetections } from 'src/entities/sca-vulnerability-detections.entity';
import { SastVulnerabilityDetections } from 'src/entities/sast-vulnerability-detections.entity';
import { IacVulnerabilityDetections } from 'src/entities/iac-vulnerability-detections.entity';
import { VulnerabilityDetectionsContainer } from 'src/entities/container_vulnerability_detections.entity';
import { PdfGeneratorService } from 'src/core/utils/pdf-generator.service';
import { ProjectNameResolver } from '../shared/project-name-resolver.service';
import { CweReportData } from './cwe-report.types';
import {
  NO_REPORT_ANALYSIS,
  REPORT_ANALYSIS,
  type ReportAnalysisPort,
} from '../../../edition/ports/report-analysis.port';

// ── entity builders ─────────────────────────────────────────────────────────
const sast = (over: Record<string, unknown> = {}) => ({
  id: 's1',
  currentState: 'to_verify',
  currentSeverity: 'high',
  effectiveSeverity: null,
  currentPriority: 'normal',
  language: 'JavaScript',
  path: 'app/routes/a.js',
  vulnerableStartLine: 10,
  vulnerableEndLine: 10,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updateAt: new Date('2026-01-02T00:00:00Z'),
  vulnerability: { name: 'Eval', description: 'desc', cwe: ['CWE-79'] },
  ...over,
});

const sca = (over: Record<string, unknown> = {}) => ({
  id: 'a1',
  currentState: 'to_verify',
  currentSeverity: 'medium',
  effectiveSeverity: null,
  currentPriority: 'normal',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:00:00Z'),
  scaDetectedPackage: {
    packageName: 'minimatch',
    packageVersion: '3.0.4',
    fileName: 'package-lock.json',
  },
  vulnerability: {
    id: 'GHSA-aaaa',
    summary: 'minimatch ReDoS',
    details: 'Regular expression denial of service.',
    aliases: [{ alias: 'CVE-2022-3517' }],
    databaseSpecific: { cwe_ids: ['CWE-400', '1333'] },
  },
  ...over,
});

const container = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  vulnerabilityIdentifier: 'CVE-2024-0001',
  currentState: 'to_verify',
  currentSeverity: 'critical',
  effectiveSeverity: null,
  currentPriority: 'urgent',
  fixedVersion: '1.1.1w',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:00:00Z'),
  detectedPackage: {
    packageName: 'openssl',
    packageVersion: '1.1.1k',
    class: 'os-pkgs',
  },
  detectedImage: { artifactName: 'node:20-alpine' },
  vulnerability: {
    id: 'CVE-2024-0001',
    summary: 'openssl overflow',
    aliases: [],
    databaseSpecific: { cwe_ids: ['CWE-787'] },
  },
  ...over,
});

/** Chainable stand-in for `repository.manager.createQueryBuilder()`. */
const queryBuilder = (rows: unknown[]) => {
  const qb: Record<string, jest.Mock> = {};
  for (const m of [
    'select',
    'addSelect',
    'from',
    'innerJoin',
    'where',
    'andWhere',
    'groupBy',
  ]) {
    qb[m] = jest.fn().mockReturnValue(qb);
  }
  qb.getRawMany = jest.fn().mockResolvedValue(rows);
  return qb;
};

describe('CweReportService', () => {
  let service: CweReportService;
  let resolverMock: { resolve: jest.Mock };
  let repos: Record<'sast' | 'iac' | 'sca' | 'container', any>;
  let fixedRows: unknown[];
  let cybeLoader: { load: jest.Mock; renderer: ReportAnalysisPort['renderer'] };
  let logger: { log: jest.Mock; warn: jest.Mock; error: jest.Mock };

  // bindAnalysis: REPORT_ANALYSIS is bound (an analysis extension); the
  // Community Edition binds none.
  const build = async (bindAnalysis = true) => {
    fixedRows = [];
    const detectionRepoMock = () => ({
      find: jest.fn().mockResolvedValue([]),
      manager: {
        // No imported advisory.
        find: jest.fn().mockResolvedValue([]),
        createQueryBuilder: jest.fn(() => queryBuilder(fixedRows)),
      },
    });
    repos = {
      sast: detectionRepoMock(),
      iac: detectionRepoMock(),
      sca: detectionRepoMock(),
      container: detectionRepoMock(),
    };
    const cweRepoMock = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation((x) => x),
      save: jest.fn().mockImplementation(async (x) => x),
    };
    resolverMock = { resolve: jest.fn().mockResolvedValue('Acme Web App') };
    cybeLoader = {
      load: jest.fn().mockResolvedValue(new Map()),
      renderer: NO_REPORT_ANALYSIS,
    };
    logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CweReportService,
        { provide: getRepositoryToken(CweReport), useValue: cweRepoMock },
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
        { provide: PdfGeneratorService, useValue: { generatePDF: jest.fn() } },
        { provide: ProjectNameResolver, useValue: resolverMock },
        ...(bindAnalysis
          ? [{ provide: REPORT_ANALYSIS, useValue: cybeLoader }]
          : []),
      ],
    }).compile();

    service = module.get(CweReportService);
  };
  beforeEach(() => build());

  const jsonReport = async (): Promise<CweReportData> =>
    JSON.parse(
      (await service.generateReport('p1', 'json', true)).content.toString(),
    );

  describe('project name & branch header', () => {
    it('embeds resolved project name, id and branch in the JSON report', async () => {
      const result = await service.generateReport('p1', 'json', true, 'main');
      const data = JSON.parse(result.content.toString());

      expect(resolverMock.resolve).toHaveBeenCalledWith('p1');
      expect(data.scanMetadata.projectId).toBe('p1');
      expect(data.scanMetadata.projectName).toBe('Acme Web App');
      expect(data.scanMetadata.branch).toBe('main');
    });

    it('never stamps the generation time as a scan date', async () => {
      const data = await jsonReport();
      expect(data.scanMetadata).not.toHaveProperty('scanDate');
      expect(data.scanMetadata).not.toHaveProperty('scanDuration');
    });

    it('renders project name (escaped), id and branch on the cover', async () => {
      resolverMock.resolve.mockResolvedValue('Acme <script>');
      const result = await service.generateReport('p1', 'html', true, 'main');
      const html = result.content.toString();

      expect(html).toContain('class="cover"');
      expect(html).toContain('p1');
      expect(html).toContain('Acme &lt;script&gt;');
      expect(html).not.toContain('Acme <script>');
      expect(html).toContain('main');
    });

    it('shows "All branches" when no branch is provided', async () => {
      const result = await service.generateReport('p1', 'html', true);
      expect(result.content.toString()).toContain('All branches');
    });

    it('renders the CybeDefend brand in the HTML and in the PDF cover', async () => {
      const html = (
        await service.generateReport('p1', 'html', true, 'main')
      ).content.toString();
      expect(html).toContain('data:image/png;base64,');
      expect(html).toContain('CYBEDEFEND');

      const pdfMock = service['pdfGeneratorService'].generatePDF as jest.Mock;
      pdfMock.mockResolvedValue(Buffer.from('pdf'));
      await service.generateReport('p1', 'pdf', true, 'main');
      const pdfHtml = pdfMock.mock.calls[0][0] as string;
      expect(pdfHtml).toContain('data:image/png;base64,');
      expect(pdfHtml).toContain('CYBEDEFEND');
    });

    it('consumes the shared base CSS (single merged sheet)', async () => {
      const html = (
        await service.generateReport('p1', 'html', true, 'main')
      ).content.toString();
      expect(html).toContain('.code-chip');
      expect(html).toContain('break-inside: avoid');
      expect(html).toContain('.badge {');
      expect(html).toContain('#7845FF');
    });

    it('waits for the end-of-document footer only, and names the project in the running footer', async () => {
      const pdfMock = service['pdfGeneratorService'].generatePDF as jest.Mock;
      pdfMock.mockResolvedValue(Buffer.from('pdf'));

      await service.generateReport('p1', 'pdf', true, 'main');

      const [html, options] = pdfMock.mock.calls[0];
      expect(html).not.toContain('page-break-inside');
      expect(options).toEqual(
        expect.objectContaining({
          waitForSelector: '.footer',
          footerTitle: 'CWE Top 25 report · Acme Web App',
        }),
      );
      expect(options).not.toHaveProperty('waitForFunction');
    });

    it('fails soft: missing project name falls back to id, report still builds', async () => {
      resolverMock.resolve.mockResolvedValue(undefined);
      const data = await jsonReport();

      expect(data.scanMetadata.projectName).toBeUndefined();
      expect(data.scanMetadata.projectId).toBe('p1');
    });
  });

  describe('CWE mapping of dependency and container advisories', () => {
    it('maps an SCA advisory to the CWE ids of its OSV record', () => {
      // The CVE is the catalogue's smallest CVE alias, read in one batch.
      const mapped = (service as any).mapScaVulnerability(
        sca(),
        new Map([['GHSA-aaaa', 'CVE-2022-3517']]),
      );
      expect(mapped.cwe).toEqual(['CWE-400', 'CWE-1333']);
      expect(mapped).toEqual(
        expect.objectContaining({
          advisoryId: 'GHSA-aaaa',
          cve: 'CVE-2022-3517',
          packageName: 'minimatch',
          packageVersion: '3.0.4',
          manifest: 'package-lock.json',
        }),
      );
    });

    it('maps a container advisory to the CWE ids of its OSV record', () => {
      const mapped = (service as any).mapContainerVulnerability(container());
      expect(mapped.cwe).toEqual(['CWE-787']);
      expect(mapped).toEqual(
        expect.objectContaining({
          advisoryId: 'CVE-2024-0001',
          packageName: 'openssl',
          packageVersion: '1.1.1k',
          image: 'node:20-alpine',
          fixedVersion: '1.1.1w',
        }),
      );
    });

    it('flags a development dependency (not shipped to production) from the detected package', () => {
      const dev = sca({
        scaDetectedPackage: {
          packageName: 'lodash',
          packageVersion: '4.17.11',
          fileName: 'package-lock.json',
          isDev: true,
        },
      });
      expect((service as any).mapScaVulnerability(dev).devDependency).toBe(
        true,
      );
      expect(
        (service as any).mapScaVulnerability(sca()).devDependency,
      ).toBeUndefined();
    });

    it('flags a withdrawn advisory (still counted, as in the dashboard)', () => {
      const withdrawn = (row: typeof sca | typeof container) =>
        row({
          vulnerability: {
            id: 'GHSA-w',
            summary: 'Withdrawn',
            aliases: [],
            databaseSpecific: { cwe_ids: ['CWE-125'] },
            withdrawnAt: new Date('2025-01-01T00:00:00Z'),
          },
        });
      expect(
        (service as any).mapScaVulnerability(withdrawn(sca)).withdrawn,
      ).toBe(true);
      expect(
        (service as any).mapContainerVulnerability(withdrawn(container))
          .withdrawn,
      ).toBe(true);
      expect(
        (service as any).mapScaVulnerability(sca()).withdrawn,
      ).toBeUndefined();
    });

    it('tolerates advisories without CWE data', () => {
      const noCwe = sca({
        vulnerability: { id: 'GHSA-b', aliases: [], databaseSpecific: null },
      });
      const odd = sca({
        vulnerability: {
          id: 'GHSA-c',
          aliases: [],
          databaseSpecific: { cwe_ids: 'CWE-79' },
        },
      });
      expect((service as any).mapScaVulnerability(noCwe).cwe).toEqual([]);
      expect((service as any).mapScaVulnerability(odd).cwe).toEqual([]);
    });

    it('loads the container image with the detection', async () => {
      await jsonReport();
      expect(repos.container.find).toHaveBeenCalledWith(
        expect.objectContaining({
          relations: expect.arrayContaining(['detectedImage']),
        }),
      );
    });

    it('resolves the installed-aware fixed version of SCA advisories in one batched query (plus one for the CVE aliases)', async () => {
      repos.sca.find.mockResolvedValue([sca()]);
      fixedRows = [
        { osvId: 'GHSA-aaaa', fixedVersion: '4.0.0' },
        { osvId: 'GHSA-aaaa', fixedVersion: '3.0.5' },
        { osvId: 'GHSA-aaaa', fixedVersion: '2.0.0' },
      ];
      const data = await jsonReport();
      const mapped = data.vulnerabilities.find((v) => v.id === 'a1');
      expect(mapped.fixedVersion).toBe('3.0.5');
      expect(repos.sca.manager.createQueryBuilder).toHaveBeenCalledTimes(2);
    });

    it('still builds the report when the fixed-version lookup fails', async () => {
      repos.sca.find.mockResolvedValue([sca()]);
      repos.sca.manager.createQueryBuilder.mockImplementation(() => {
        throw new Error('db down');
      });
      const data = await jsonReport();
      expect(data.vulnerabilities[0].fixedVersion).toBeUndefined();
    });
  });

  describe('exploitability verdict', () => {
    it('carries the verdict, its source, score and reasoning', () => {
      const mapped = (service as any).mapSastVulnerability(
        sast({
          exploitabilityVerdict: 'proven',
          exploitabilitySource: 'agent',
          exploitabilityScore: 0.8,
          exploitabilityReason: 'Reachable from POST /contributions.',
        }),
      );
      expect(mapped.exploitability).toEqual({
        verdict: 'proven',
        source: 'agent',
        score: 0.8,
        reason: 'Reachable from POST /contributions.',
      });
    });

    it('leaves it undefined when no verdict exists', () => {
      expect(
        (service as any).mapSastVulnerability(sast()).exploitability,
      ).toBeUndefined();
    });
  });

  describe('Top 25 summary', () => {
    beforeEach(() => {
      repos.sast.find.mockResolvedValue([
        sast({ id: 'xss-open', currentSeverity: 'HIGH' }),
        sast({ id: 'xss-ignored', currentState: 'ignored' }),
        // Two Top 25 weaknesses: counted in each category, once in totals.
        sast({
          id: 'cmd',
          currentSeverity: 'critical',
          vulnerability: {
            name: 'Command',
            description: '',
            cwe: ['CWE-77', '94'],
          },
        }),
        // Outside the Top 25.
        sast({
          id: 'cookie',
          vulnerability: { name: 'Cookie', description: '', cwe: ['CWE-522'] },
        }),
      ]);
      repos.sca.find.mockResolvedValue([sca()]);
      repos.container.find.mockResolvedValue([
        container({
          id: 'c-resolved',
          currentState: 'resolved',
        }),
      ]);
    });

    it('counts only open findings mapped to the Top 25, each once', async () => {
      const { summary } = await jsonReport();
      expect(summary.top25).toEqual({
        findings: 3,
        categoriesAffected: 4,
        bySeverity: { critical: 1, high: 1, medium: 1, low: 0, unknown: 0 },
        byType: { sast: 2, iac: 0, sca: 1, container: 0 },
        triaged: 2,
      });
    });

    it('keeps the whole-project totals apart', async () => {
      const { summary } = await jsonReport();
      expect(summary.totalVulnerabilities).toBe(6);
      expect(summary.openFindings).toBe(4);
    });

    it('excludes triaged findings from the category counts but keeps them listed', async () => {
      const { cweCategories, summary } = await jsonReport();
      const xss = cweCategories.find((c) => c.cweData.id === 'CWE-79');
      expect(xss.count).toBe(1);
      expect(xss.vulnerabilities.map((v) => v.id)).toEqual([
        'xss-open',
        'xss-ignored',
      ]);
      expect(summary.byCweCategory['CWE-79']).toBe(1);
      // A category whose findings are all triaged is still listed.
      const oob = cweCategories.find((c) => c.cweData.id === 'CWE-787');
      expect(oob.count).toBe(0);
    });

    it('sorts the findings of a category by severity, then state, then location', async () => {
      repos.sast.find.mockResolvedValue([
        sast({ id: 'm', currentSeverity: 'medium', path: 'a.js' }),
        sast({ id: 'h-b', currentSeverity: 'high', path: 'b.js' }),
        sast({
          id: 'h-a-confirmed',
          currentSeverity: 'HIGH',
          currentState: 'confirmed',
          path: 'z.js',
        }),
        sast({
          id: 'h-a-20',
          currentSeverity: 'high',
          path: 'a.js',
          vulnerableStartLine: 20,
        }),
        sast({
          id: 'h-a-3',
          currentSeverity: 'high',
          path: 'a.js',
          vulnerableStartLine: 3,
        }),
      ]);
      repos.sca.find.mockResolvedValue([]);
      repos.container.find.mockResolvedValue([]);
      const { cweCategories } = await jsonReport();
      expect(cweCategories[0].vulnerabilities.map((v) => v.id)).toEqual([
        'h-a-confirmed',
        'h-a-3',
        'h-a-20',
        'h-b',
        'm',
      ]);
    });
  });
  describe('Cybe Analysis', () => {
    const pinned = {
      markdown:
        '## Verdict\nTrue Positive\n\n## Summary\nThe page reflects the input.',
      date: '2026-04-14T18:37:31.000Z',
      url: 'https://app.example.com/project/p1/sast/issue/s1',
    };

    it('loads the analyses of open findings and of critical or high triaged ones, per family', async () => {
      repos.sast.find.mockResolvedValueOnce([
        sast({ id: 's1', currentSeverity: 'LOW' }),
        sast({
          id: 's2',
          currentSeverity: 'CRITICAL',
          currentState: 'ignored',
        }),
        sast({ id: 's3', currentSeverity: 'MEDIUM', currentState: 'ignored' }),
      ]);
      repos.sca.find.mockResolvedValueOnce([
        sca({ id: 'a1', currentSeverity: 'HIGH', currentState: 'resolved' }),
      ]);
      await service.generateReport('p1', 'pdf', true);
      expect(cybeLoader.load).toHaveBeenCalledWith('p1', 'sast', ['s1', 's2']);
      expect(cybeLoader.load).toHaveBeenCalledWith('p1', 'sca', ['a1']);
    });

    it('loads nothing for a summary report', async () => {
      repos.sast.find.mockResolvedValueOnce([sast()]);
      await service.generateReport('p1', 'pdf', false);
      expect(cybeLoader.load).not.toHaveBeenCalled();
    });

    it('pins the analysis on the finding, in the list and in its category, and in JSON', async () => {
      repos.sast.find.mockResolvedValueOnce([
        sast({ id: 's1' }),
        sast({ id: 's2' }),
      ]);
      cybeLoader.load.mockImplementation(async (_p: string, family: string) =>
        family === 'sast' ? new Map([['s1', pinned]]) : new Map(),
      );
      const report = await jsonReport();
      expect(
        report.vulnerabilities.find((v) => v.id === 's1').cybeAnalysis,
      ).toEqual(pinned);
      expect(
        report.vulnerabilities.find((v) => v.id === 's2'),
      ).not.toHaveProperty('cybeAnalysis');
      const xss = report.cweCategories.find((c) => c.cweData.id === 'CWE-79');
      expect(
        xss.vulnerabilities.find((v) => v.id === 's1').cybeAnalysis,
      ).toEqual(pinned);
    });

    it('hands the bound renderer to the template', async () => {
      repos.sast.find.mockResolvedValueOnce([sast({ id: 's1' })]);
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
        repos.sast.find.mockResolvedValueOnce([sast({ id: 's1' })]);
        const report = await jsonReport();
        expect(cybeLoader.load).not.toHaveBeenCalled();
        expect(report.vulnerabilities[0]).not.toHaveProperty('cybeAnalysis');
        repos.sast.find.mockResolvedValueOnce([sast({ id: 's1' })]);
        const html = (
          await service.generateReport('p1', 'html', true)
        ).content.toString();
        expect(html).not.toContain('ca-card');
      });
    });

    it('still generates the report when the analyses cannot be loaded', async () => {
      repos.sast.find.mockResolvedValueOnce([sast()]);
      cybeLoader.load.mockRejectedValue(new Error('connection lost'));
      const report = await jsonReport();
      expect(report.vulnerabilities[0]).not.toHaveProperty('cybeAnalysis');
      expect(logger.warn).toHaveBeenCalledWith(
        'Cybe Analysis lookup failed (project=p1, family=sast): connection lost',
      );
    });
  });
});
