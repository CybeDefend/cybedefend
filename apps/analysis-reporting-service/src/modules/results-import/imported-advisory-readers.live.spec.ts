import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Job } from 'bullmq';
import { Logger } from 'nestjs-pino';
import type { ClientGrpc } from '@nestjs/microservices';
import { of } from 'rxjs';
import { parseDialect } from '@cybedefend/db-dialect';
import { liveEnabled } from '../../core/db/live-database';
import type { ResultsImportJobData } from '../scan-queue/scan-queue.service';
import type { CweReportData } from '../reports/cwe-report/cwe-report.types';
import type { OwaspReportData } from '../reports/owasp-report/owasp-report.types';
import { ReportAggregationService } from '../reports/aggregated-reports/services/report-aggregation.service';
import { GroupedVulnerabilityService } from '../grouped-vulnerability/grouped-vulnerability.service';
import { PolicyVulnerabilityService } from '../result/policy-vulnerability.service';
import { ResultService } from '../result/result.service';
import { PriorityCalculatorService } from '../result/priority-calculator.service';
import { IssueIntegrationService } from '../vulnerability/issue-integration.service';
import { VulnerabilityDetectionHistory } from '../../entities/vulnerability-detection-history.entity';
import { ConfigService } from '@nestjs/config';
import { SastVulnerabilityDetections } from '../../entities/sast-vulnerability-detections.entity';
import { IacVulnerabilityDetections } from '../../entities/iac-vulnerability-detections.entity';
import { CicdVulnerabilityDetections } from '../../entities/cicd-vulnerability-detections.entity';
import { SecretVulnerabilityDetections } from '../../entities/secret-vulnerability-detections.entity';
import { ScaVulnerabilityDetections } from '../../entities/sca-vulnerability-detections.entity';
import { VulnerabilityDetectionsContainer } from '../../entities/container_vulnerability_detections.entity';
import { ScaDetectedPackages } from '../../entities/sca-detected-packages.entity';
import { ScaLicenseOverride } from '../../entities/sca-license-override.entity';
import { VulnerabilityOsv } from '../../entities/osv/vulnerability-osv.entity';
import { VulnerabilityOsvAlias } from '../../entities/osv/vulnerability-osv-alias.entity';
import type { ScaService } from '../sca/sca.service';
import { Vulnerability } from '../../entities/vulnerability/vulnerability.entity';
import {
  ImportHarness,
  openImportHarness,
} from '../../test-utils/results-import.live-harness';

/**
 * LIVE spec: the reports and the grouped view of a project read an imported
 * advisory from that project's own row (CWE ids, fixed version, CVE), on
 * the engine LIVE_DB_TYPE selects:
 *
 *   RESULTS_IMPORT_LIVE=1 LIVE_DB_TYPE=postgres \
 *     RESULTS_IMPORT_PG_URL=postgres://postgres:postgres@127.0.0.1:5432 \
 *     pnpm exec jest --ci --runInBand src/modules/results-import/imported-advisory-readers.live.spec.ts
 *
 * Two projects import one advisory id with different CWE ids, fixed versions
 * and CVE aliases; each reader shows each project its own.
 */
const LIVE = liveEnabled('RESULTS_IMPORT');
const describeLive = LIVE ? describe : describe.skip;

const ADVISORY = 'GHSA-read-0001-0001';

interface Declared {
  alias: string;
  cwe: string;
  fixed: string;
}
// Both CWE ids are in the CWE Top 25.
const A: Declared = { alias: 'CVE-2024-3333', cwe: 'CWE-79', fixed: '4.17.21' };
const B: Declared = { alias: 'CVE-2024-4444', cwe: 'CWE-89', fixed: '4.18.0' };

const sarifOf = (d: Declared): string =>
  JSON.stringify({
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'acme-sca',
            rules: [
              {
                id: ADVISORY,
                deprecatedIds: [d.alias],
                shortDescription: { text: `Advisory ${d.alias}` },
                properties: { tags: [d.cwe], 'security-severity': '7.5' },
              },
            ],
          },
        },
        results: [
          {
            ruleId: ADVISORY,
            ruleIndex: 0,
            level: 'error',
            message: { text: 'lodash is vulnerable' },
            properties: {
              'cybedefend/package': {
                name: 'lodash',
                version: '4.17.20',
                fixedVersion: d.fixed,
                ecosystem: 'npm',
              },
            },
            locations: [
              {
                physicalLocation: {
                  artifactLocation: { uri: 'package-lock.json' },
                  region: { startLine: 1 },
                },
              },
            ],
          },
        ],
      },
    ],
  });

describeLive('readers of imported advisories', () => {
  jest.setTimeout(300_000);
  const HOOK_TIMEOUT = 300_000;
  const ORIGINAL_EDITION = process.env.CYBEDEFEND_EDITION;
  const dialect = parseDialect(process.env.LIVE_DB_TYPE);
  let h: ImportHarness;
  let tmp: string;
  let aggregation: ReportAggregationService;
  let grouped: GroupedVulnerabilityService;
  const projectA = randomUUID();
  const projectB = randomUUID();
  let scanA: string;
  let scanB: string;

  const repo = <T extends object>(entity: new () => T) =>
    h.live.dataSource.getRepository(entity);

  const runImport = async (
    projectId: string,
    declared: Declared,
  ): Promise<string> => {
    const file = join(tmp, `${randomUUID()}.sarif`);
    await writeFile(file, sarifOf(declared));
    const scanId = randomUUID();
    const data: ResultsImportJobData = {
      scanId,
      projectId,
      organizationId: randomUUID(),
      branch: 'main',
      category: 'sca',
      format: 'sarif',
      fileKey: file,
    };
    await h.processor.process({
      id: `results-import-${scanId}`,
      data,
    } as Job<ResultsImportJobData>);
    return scanId;
  };

  const reportJson = <T>(report: { content: Buffer }): T =>
    JSON.parse(report.content.toString('utf8')) as T;

  beforeAll(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'imported-readers-live-'));
    h = await openImportHarness(
      dialect,
      `bull-imported-readers-live-${randomUUID()}`,
    );
    process.env.CYBEDEFEND_EDITION = 'community';
    scanA = await runImport(projectA, A);
    scanB = await runImport(projectB, B);

    const logger = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as unknown as Logger;
    const projectService = {
      Get: ({ projectId }: { projectId: string }) =>
        of({ projectId, name: projectId, referenceBranch: 'main' }),
      get: ({ projectId }: { projectId: string }) =>
        of({
          id: projectId,
          name: projectId,
          referenceBranch: 'main',
          parsedBranches: [],
        }),
      getArchivedBranches: () => of({ branches: [] }),
      getProjectBranches: () => of({ branches: [] }),
    };
    const gm = { getService: () => projectService } as unknown as ClientGrpc;
    aggregation = new ReportAggregationService(
      repo(SastVulnerabilityDetections),
      repo(IacVulnerabilityDetections),
      repo(ScaVulnerabilityDetections),
      repo(VulnerabilityDetectionsContainer),
      repo(ScaDetectedPackages),
      repo(ScaLicenseOverride),
      gm,
      logger,
    );
    aggregation.onModuleInit();
    grouped = new GroupedVulnerabilityService(
      repo(SastVulnerabilityDetections),
      repo(IacVulnerabilityDetections),
      repo(CicdVulnerabilityDetections),
      repo(SecretVulnerabilityDetections),
      repo(ScaVulnerabilityDetections),
      repo(VulnerabilityDetectionsContainer),
      {
        getCountVulnerabilitiesCountByType: async () => ({}),
      } as unknown as ResultService,
      gm,
      {
        getService: () => ({ getLastScanStatus: () => of({}) }),
      } as unknown as ClientGrpc,
      logger,
      repo(VulnerabilityOsv),
      repo(Vulnerability),
    );
    grouped.onModuleInit();
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    if (ORIGINAL_EDITION === undefined) delete process.env.CYBEDEFEND_EDITION;
    else process.env.CYBEDEFEND_EDITION = ORIGINAL_EDITION;
    if (tmp) await rm(tmp, { recursive: true, force: true });
    await h?.close();
  }, HOOK_TIMEOUT);

  it.each([
    ['A', projectA, A],
    ['B', projectB, B],
  ] as const)(
    'the CWE report of project %s shows its own CWE, CVE and fixed version',
    async (_name, projectId, d) => {
      const report = reportJson<CweReportData>(
        await h.cwe.generateReport(projectId, 'json', true, 'main'),
      );
      const sca = report.vulnerabilities.filter((v) => v.type === 'sca');
      expect(sca).toHaveLength(1);
      expect(sca[0]).toMatchObject({
        cwe: [d.cwe],
        cve: d.alias,
        fixedVersion: d.fixed,
      });
      expect(report.summary.byCweCategory[d.cwe]).toBe(1);
    },
  );

  it('the OWASP report shows each project its own CVE and fixed version', async () => {
    for (const [projectId, d] of [
      [projectA, A],
      [projectB, B],
    ] as const) {
      const report = reportJson<OwaspReportData>(
        await h.owasp.generateReport(projectId, 'json', true, 'main'),
      );
      const sca = report.vulnerabilities.filter((v) => v.type === 'sca');
      expect(sca).toHaveLength(1);
      expect(sca[0]).toMatchObject({ cve: d.alias, fixedVersion: d.fixed });
    }
  });

  it("the aggregated report takes each finding's content from its own project", async () => {
    const result = await aggregation.aggregateVulnerabilities(
      [projectA, projectB],
      'sca',
      'all',
    );
    const sca = (
      result.vulnerabilities as Array<{
        type: string;
        projectId: string;
        cwe: string[];
        cve: string;
        fixedVersion: string;
      }>
    ).filter((v) => v.type === 'sca');
    const byProject = Object.fromEntries(
      sca.map((v) => [
        v.projectId,
        { cwe: v.cwe, cve: v.cve, fixedVersion: v.fixedVersion },
      ]),
    );
    expect(byProject).toEqual({
      [projectA]: { cwe: [A.cwe], cve: A.alias, fixedVersion: A.fixed },
      [projectB]: { cwe: [B.cwe], cve: B.alias, fixedVersion: B.fixed },
    });
  });

  it("search finds a finding by its project's own text, and never tells whether the shared catalogue's text holds a word", async () => {
    // Text an earlier import left in the shared catalogue row.
    await repo(VulnerabilityOsv).update(
      { id: ADVISORY },
      { summary: 'Shared text with the word zebracorn' },
    );
    await repo(VulnerabilityOsvAlias).insert({
      id: randomUUID(),
      alias: 'CVE-2099-7777',
      vulnerability: { id: ADVISORY },
    } as never);
    const listed = async (projectId: string, searchQuery: string) =>
      (
        await h.sca.getProjectScaVulnerabilities({
          projectId,
          branch: 'main',
          pageNumber: 1,
          pageSizeNumber: 50,
          excludeAutofixCounts: true,
          searchQuery,
        } as Parameters<ScaService['getProjectScaVulnerabilities']>[0])
      ).vulnerabilities.length;
    const grouped_ = async (projectId: string, searchQuery: string) =>
      (
        await grouped.getGroupedScaVulnerabilities({
          projectId,
          pageNumber: 1,
          pageSize: 10,
          branch: 'main',
          searchQuery,
        } as Parameters<
          GroupedVulnerabilityService['getGroupedScaVulnerabilities']
        >[0])
      ).groupedVulnerabilities.length;
    try {
      for (const read of [listed, grouped_]) {
        // Its own summary and alias find it.
        expect(await read(projectA, `Advisory ${A.alias}`)).toBe(1);
        expect(await read(projectA, A.alias)).toBe(1);
        // The shared catalogue's text and aliases never do.
        expect(await read(projectA, 'zebracorn')).toBe(0);
        expect(await read(projectA, 'CVE-2099-7777')).toBe(0);
        // Nor another project's own text.
        expect(await read(projectA, B.alias)).toBe(0);
      }
    } finally {
      await repo(VulnerabilityOsv).update({ id: ADVISORY }, { summary: null });
      await repo(VulnerabilityOsvAlias).delete({ alias: 'CVE-2099-7777' });
    }
  });

  it("the project's top vulnerabilities describe each finding by its own advisory text", async () => {
    // The real method, on a stand-in that holds the real repositories.
    const self = {
      sastVulnDetectRepository: repo(SastVulnerabilityDetections),
      iacVulnDetectRepository: repo(IacVulnerabilityDetections),
      cicdVulnDetectRepository: repo(CicdVulnerabilityDetections),
      secretVulnDetectRepository: repo(SecretVulnerabilityDetections),
      scaVulnDetectRepository: repo(ScaVulnerabilityDetections),
      containerVulnDetectRepository: repo(VulnerabilityDetectionsContainer),
      priorityCalculator: new PriorityCalculatorService(new ConfigService()),
      getSecurityContextCached: async () => null,
    };
    for (const [projectId, d] of [
      [projectA, A],
      [projectB, B],
    ] as const) {
      const response = await ResultService.prototype.getTopVulnerabilities.call(
        self,
        { projectId, limit: 10 },
      );
      const sca = response.items.filter(
        (i: { vulnerabilityType: string }) => i.vulnerabilityType === 'sca',
      );
      expect(sca.map((i: { description: string }) => i.description)).toEqual([
        `Advisory ${d.alias}`,
      ]);
    }
  });

  it("the issue tickets of a scan carry each finding's own text and its own package's fix", async () => {
    const issues = new IssueIntegrationService(
      { getService: () => ({}) } as unknown as ClientGrpc,
      { getService: () => ({}) } as unknown as ClientGrpc,
      repo(SastVulnerabilityDetections),
      repo(ScaVulnerabilityDetections),
      repo(IacVulnerabilityDetections),
      repo(VulnerabilityDetectionsContainer),
      repo(SecretVulnerabilityDetections),
      repo(VulnerabilityDetectionHistory),
      new ConfigService({ FRONTEND_URL: 'https://dashboard.example' }),
      {
        log: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      } as unknown as Logger,
    );
    for (const [projectId, scanId, d] of [
      [projectA, scanA, A],
      [projectB, scanB, B],
    ] as const) {
      const tickets = await (
        issues as unknown as {
          fetchVulnerabilitiesForScan: (
            projectId: string,
            scanId: string,
          ) => Promise<
            Array<{
              scannerType: string;
              name: string;
              shortDescription: string;
              fixedVersion: string;
            }>
          >;
        }
      ).fetchVulnerabilitiesForScan(projectId, scanId);
      const sca = tickets.filter((t) => t.scannerType === 'sca');
      expect(
        sca.map((t) => [t.name, t.shortDescription, t.fixedVersion]),
      ).toEqual([[`Advisory ${d.alias}`, `Advisory ${d.alias}`, d.fixed]]);
    }
  });

  it('the policy evaluation input names each finding by its own advisory text', async () => {
    const policy = new PolicyVulnerabilityService(
      repo(SastVulnerabilityDetections),
      repo(ScaVulnerabilityDetections),
      repo(IacVulnerabilityDetections),
      repo(CicdVulnerabilityDetections),
      repo(SecretVulnerabilityDetections),
      repo(VulnerabilityDetectionsContainer),
      {
        log: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      } as unknown as Logger,
    );
    for (const [projectId, d] of [
      [projectA, A],
      [projectB, B],
    ] as const) {
      const response = await policy.getScanVulnerabilitiesForPolicy(
        projectId,
        randomUUID(),
      );
      const sca = response.vulnerabilities.filter(
        (i) => i.scannerType === 'SCA',
      );
      expect(sca.map((i) => [i.title, i.severity, i.cveId])).toEqual([
        [`Advisory ${d.alias}`, 'HIGH', ADVISORY],
      ]);
    }
  });

  it('the grouped view of a project shows its own CVE, CWE and fix', async () => {
    for (const [projectId, d] of [
      [projectA, A],
      [projectB, B],
    ] as const) {
      const response = await grouped.getGroupedScaVulnerabilities({
        projectId,
        pageNumber: 1,
        pageSize: 10,
        branch: 'main',
      } as Parameters<
        GroupedVulnerabilityService['getGroupedScaVulnerabilities']
      >[0]);
      expect(response.groupedVulnerabilities).toHaveLength(1);
      const group = response.groupedVulnerabilities[0];
      expect({
        cveId: group.cveId,
        hasFix: group.hasFix,
        cve: group.vulnerability?.cve,
        cwes: group.vulnerability?.cwes.map((c) => c.cweId),
        fixed: group.vulnerability?.packages.map((p) => p.fixed),
      }).toEqual({
        cveId: d.alias,
        hasFix: true,
        cve: d.alias,
        cwes: [d.cwe],
        fixed: [d.fixed],
      });
    }
  });
});
