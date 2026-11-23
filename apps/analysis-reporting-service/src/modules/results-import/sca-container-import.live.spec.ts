import { randomUUID } from 'node:crypto';
import { createReadStream, readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import type { ClientGrpc } from '@nestjs/microservices';
import { Queue } from 'bullmq';
import type { Job } from 'bullmq';
import { Logger } from 'nestjs-pino';
import { of } from 'rxjs';
import { DataSource } from 'typeorm';
import type {
  EntityTarget,
  ObjectLiteral,
  QueryDeepPartialEntity,
} from 'typeorm';
import { parseDialect } from '@cybedefend/db-dialect';
import {
  createLiveDatabase,
  liveEnabled,
  type LiveDatabase,
} from '../../core/db/live-database';
import { SastIacService } from '../sast-iac/sast-iac.service';
import { SastIacUtilsService } from '../sast-iac/sast-iac.utils';
import { ScaService } from '../sca/sca.service';
import { ContainerService } from '../container/container.service';
import { ResultService } from '../result/result.service';
import { IssueIntegrationService } from '../vulnerability/issue-integration.service';
import { CvssCalculatorService } from '../cvss/cvss-calculator.service';
import { CvssExplainerService } from '../cvss/cvss-explainer.service';
import { SecretEncryptionService } from '../../core/crypto/secret-encryption.service';
import { CyberiskRecomputeEnqueuer } from '../cyber-risk/cyberisk-recompute.enqueuer';
import { ReferenceBranchResolver } from '../cyber-risk/reference-branch.resolver';
import { ProjectOrgResolver } from '../../core/realtime/project-org-resolver.service';
import { SecurityContextCacheService } from '../security-context/security-context-cache.service';
import { OwaspReportService } from '../reports/owasp-report/owasp-report.service';
import { CweReportService } from '../reports/cwe-report/cwe-report.service';
import type { OwaspReportData } from '../reports/owasp-report/owasp-report.types';
import type { CweReportData } from '../reports/cwe-report/cwe-report.types';
import { PdfGeneratorService } from '../../core/utils/pdf-generator.service';
import { ProjectNameResolver } from '../reports/shared/project-name-resolver.service';
import { DataPurgeService } from '../data-purge/data-purge.service';
import { OrganizationStatisticsService } from '../organization-statistics/organization-statistics.service';
import { QUEUE_NAMES } from '../scan-queue/queue-names';
import {
  ResultsImportJobData,
  ScanQueueService,
} from '../scan-queue/scan-queue.service';
import type { ImportCategory } from './catalogue-fallback.service';
import type { ScanCompleteNotificationService } from '../scan-queue/scan-complete-notification.service';
import type { RealtimeBatchPublisher } from '../../core/realtime/realtime-batch-publisher.service';
import { HistoryItem } from '../../entities/history-item.entity';
import { SastVulnerabilityDetections } from '../../entities/sast-vulnerability-detections.entity';
import { IacVulnerabilityDetections } from '../../entities/iac-vulnerability-detections.entity';
import { SecretVulnerabilityDetections } from '../../entities/secret-vulnerability-detections.entity';
import { ScaDetectedPackages } from '../../entities/sca-detected-packages.entity';
import { ScaVulnerabilityDetections } from '../../entities/sca-vulnerability-detections.entity';
import { ContainerDetectedImage } from '../../entities/container-detected-image.entity';
import { ContainerDetectedPackage } from '../../entities/container-detected-package.entity';
import { VulnerabilityDetectionsContainer } from '../../entities/container_vulnerability_detections.entity';
import { VulnerabilityOsv } from '../../entities/osv/vulnerability-osv.entity';
import { VulnerabilityOsvAlias } from '../../entities/osv/vulnerability-osv-alias.entity';
import { VulnerabilityOsvSeverity } from '../../entities/osv/vulnerability-osv-severity.entity';
import { VulnerabilityOsvAffected } from '../../entities/osv/vulnerability-osv-affected.entity';
import { VulnerabilityOsvAffectedRange } from '../../entities/osv/vulnerability-osv-affected-range.entity';
import { VulnerabilityOsvAffectedEvent } from '../../entities/osv/vulnerability-osv-affected-event.entity';
import { CatalogueFallbackService } from './catalogue-fallback.service';
import { AdvisoryFallbackService } from './advisory-fallback.service';
import type { ImportFileSource } from './import-file.source';
import { ResultsImportProcessor } from './results-import.processor';

/**
 * LIVE end-to-end proofs of the SCA and container imports, on PostgreSQL (the import is a Community Edition feature,
 * and the Community Edition runs on PostgreSQL only: with LIVE_DB_TYPE=mysql the suite skips) and a real Redis:
 *
 *   RESULTS_IMPORT_MYSQL_LIVE=1 LIVE_DB_TYPE=postgres \
 *     RESULTS_IMPORT_PG_URL=postgres://postgres:postgres@127.0.0.1:15432 \
 *     pnpm exec jest --ci --runInBand src/modules/results-import/sca-container-import.live.spec.ts
 *
 * (`RESULTS_IMPORT_LIVE=1` is accepted in place of the MySQL-named flag.)
 *
 * The fixtures of libs/test-fixtures/sarif go through the real
 * ResultsImportProcessor with the real ScaService and ContainerService, the
 * real advisory and catalogue fallbacks, the real SastIacService (for the
 * Trivy kinds other than vulnerabilities) and the real ScanQueueService
 * (finalize locks, batch tracking) on Redis RESULTS_IMPORT_REDIS_URL
 * (default redis://127.0.0.1:6379, queues under a per-run prefix). No
 * ADVISORY_MATCHER, DETECTION_ENRICHERS, CONTAINER_INVENTORY_MATCHER nor
 * OS_END_OF_LIFE is provided: what the Community Edition runs. The dashboard's
 * reads (lists, details), the OWASP and CWE reports and the project purge are
 * the real services on the same data source. Only the edges are fakes: the
 * file source reads the fixture from disk, GetScan answers
 * `{ branch: 'main', isDiffScan: false }`, CompleteImportScan and the end of
 * scan dispatch are jest.fn().
 *
 * Each database `results_import_<12 hex>` comes from createLiveDatabase and is
 * migrated with the dialect's tracks; it is dropped at the end. Advisories
 * are not project data: the one case that needs a database where an advisory
 * already exists before any import opens a database of its own. Counts are
 * read with repository.count, never a raw COUNT(*).
 */
const LIVE = liveEnabled('RESULTS_IMPORT');
// SARIF import is a Community Edition feature, and the Community Edition runs
// on PostgreSQL only (it refuses DB_TYPE=mysql at boot): the MySQL pass skips.
const describeLive =
  LIVE && parseDialect(process.env.LIVE_DB_TYPE) === 'postgres'
    ? describe
    : describe.skip;
const REDIS_URL =
  process.env.RESULTS_IMPORT_REDIS_URL ?? 'redis://127.0.0.1:6379';
const FIXTURES = join(__dirname, '../../../../../libs/test-fixtures/sarif');
const fixture = (name: string) => join(FIXTURES, name);
const sbomFixture = (name: string) =>
  join(__dirname, '../../../../../libs/test-fixtures/sbom', name);

const TRIVY_FS_ADVISORIES = [
  'CVE-2021-23337',
  'CVE-2022-24999',
  'CVE-2023-26136',
  'CVE-2023-28155',
  'CVE-2023-32681',
];
const TRIVY_IMAGE = 'ghcr.io/example/api:2.0.1';
const GRYPE_IMAGE = 'ghcr.io/example/web:1.4.2';
const TRIVY_IMAGE_ID =
  'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

interface Harness {
  live: LiveDatabase;
  processor: ResultsImportProcessor;
  sca: ScaService;
  container: ContainerService;
  owasp: OwaspReportService;
  cwe: CweReportService;
  purge: DataPurgeService;
  completeImportScan: jest.Mock;
  onScannerFinalized: jest.Mock;
  close: () => Promise<void>;
}

/** One migrated database and every service of the import on it. */
async function openHarness(
  dialect: ReturnType<typeof parseDialect>,
  bullPrefix: string,
): Promise<Harness> {
  const live = await createLiveDatabase({
    prefix: 'results_import',
    envPrefix: 'RESULTS_IMPORT',
    dialect,
    migrations: 'track',
  });
  const queues: Queue[] = [];
  let scanQueue: ScanQueueService | undefined;
  const close = async () => {
    // Each cleanup step on its own: one failing handle must not leave the
    // others open and hang the Jest process.
    try {
      if (scanQueue) await (await scanQueue.getRedisClient()).quit();
    } catch {
      /* the client never came up */
    }
    for (const queue of queues) {
      try {
        await queue.close();
      } catch {
        /* ignore */
      }
    }
    await live.drop();
  };

  try {
    const logger = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };
    const url = new URL(REDIS_URL);
    const connection = { host: url.hostname, port: Number(url.port || 6379) };
    for (const name of Object.values(QUEUE_NAMES)) {
      queues.push(new Queue(name, { connection, prefix: bullPrefix }));
    }

    const getScan = jest.fn(() => of({ branch: 'main', isDiffScan: false }));
    const project = {
      id: '',
      name: 'live-import-project',
      referenceBranch: 'main',
      parsedBranches: [],
      scaReachabilityPriorityEnabled: false,
      scaReachabilityStatusEnabled: false,
      githubIssueEnabled: false,
      gitlabIssueEnabled: false,
      issueCreationBranches: [],
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        SastIacService,
        SastIacUtilsService,
        ScaService,
        ContainerService,
        OwaspReportService,
        CweReportService,
        DataPurgeService,
        ScanQueueService,
        ...queues.map((queue) => ({
          provide: getQueueToken(queue.name),
          useValue: queue,
        })),
        // Every entity's repository, on the live data source.
        ...live.dataSource.entityMetadatas.map((metadata) => ({
          provide: getRepositoryToken(
            metadata.target as Parameters<typeof getRepositoryToken>[0],
          ),
          useValue: live.dataSource.getRepository(metadata.target),
        })),
        { provide: DataSource, useValue: live.dataSource },
        { provide: getDataSourceToken(), useValue: live.dataSource },
        {
          provide: ResultService,
          useValue: {
            addHistoryItem: (item: HistoryItem) =>
              live.dataSource.getRepository(HistoryItem).save(item),
            computeEnvironmentalForProject: async () => null,
            recalculatePriority: async () => ({
              priority: 'high',
              priorityScore: 60,
            }),
            getCountVulnerabilitiesCountByType: async () => ({}),
            getAutofixCountByType: async () => ({}),
          },
        },
        {
          provide: IssueIntegrationService,
          useValue: { closeIssuesForResolvedVulnerabilities: async () => {} },
        },
        {
          provide: CvssCalculatorService,
          useValue: new CvssCalculatorService(),
        },
        {
          provide: CvssExplainerService,
          useValue: { buildExplanationForEntity: () => undefined },
        },
        { provide: SecretEncryptionService, useValue: {} },
        {
          provide: CyberiskRecomputeEnqueuer,
          useValue: { enqueue: async () => {} },
        },
        {
          provide: ReferenceBranchResolver,
          useValue: { getScoringBranches: async () => ['main', 'master'] },
        },
        {
          provide: ProjectOrgResolver,
          useValue: { resolveOrgId: async () => null },
        },
        { provide: SecurityContextCacheService, useValue: {} },
        { provide: PdfGeneratorService, useValue: {} },
        {
          provide: ProjectNameResolver,
          useValue: { resolve: async () => 'live-import-project' },
        },
        {
          provide: OrganizationStatisticsService,
          useValue: { markDirtyIfPresent: async () => undefined },
        },
        {
          provide: 'GLOBAL_MANAGEMENT_SERVICE',
          useValue: {
            getService: () => ({
              get: ({ projectId }: { projectId: string }) =>
                of({ ...project, id: projectId }),
              getById: () => of({}),
              getProjectBranches: () => of({ branches: [] }),
            }),
          },
        },
        {
          provide: 'SECURITY_SCANNING_SERVICE',
          useValue: {
            getService: () => ({
              getScan,
              getLastScanStatus: () => of({}),
            }),
          },
        },
        { provide: 'AGENT_SERVICE', useValue: { getService: () => ({}) } },
        { provide: Logger, useValue: logger },
      ],
    }).compile();

    scanQueue = moduleRef.get(ScanQueueService);
    await scanQueue.onModuleInit();
    const sastIac = moduleRef.get(SastIacService);
    (sastIac as unknown as { scanServiceClient: unknown }).scanServiceClient = {
      getScan,
    };
    const sca = moduleRef.get(ScaService);
    sca.onModuleInit();
    const container = moduleRef.get(ContainerService);
    container.onModuleInit();

    const catalogue = new CatalogueFallbackService(
      live.dataSource,
      moduleRef.get(SastIacUtilsService),
      scanQueue,
      logger as unknown as Logger,
    );
    const advisories = new AdvisoryFallbackService(
      live.dataSource,
      scanQueue,
      logger as unknown as Logger,
    );
    const files = {
      open: (_projectId: string, fileKey: string) => async () =>
        createReadStream(fileKey),
    } as unknown as ImportFileSource;

    const completeImportScan = jest.fn(() => of({}));
    const onScannerFinalized = jest.fn(async () => undefined);
    const processor = new ResultsImportProcessor(
      sastIac,
      scanQueue,
      { onScannerFinalized } as unknown as ScanCompleteNotificationService,
      { publishNow: jest.fn() } as unknown as RealtimeBatchPublisher,
      catalogue,
      files,
      {
        getService: () => ({ completeImportScan }),
      } as unknown as ClientGrpc,
      sca,
      container,
      advisories,
    );
    processor.onModuleInit();
    processor.delay = async () => undefined;

    return {
      live,
      processor,
      sca,
      container,
      owasp: moduleRef.get(OwaspReportService),
      cwe: moduleRef.get(CweReportService),
      purge: moduleRef.get(DataPurgeService),
      completeImportScan,
      onScannerFinalized,
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}

describeLive('SCA and container imports end to end', () => {
  // SARIF import is a Community Edition feature: the
  // worker refuses every job elsewhere.
  const ORIGINAL_EDITION = process.env.CYBEDEFEND_EDITION;
  beforeAll(() => {
    process.env.CYBEDEFEND_EDITION = 'community';
  });
  afterAll(() => {
    if (ORIGINAL_EDITION === undefined) delete process.env.CYBEDEFEND_EDITION;
    else process.env.CYBEDEFEND_EDITION = ORIGINAL_EDITION;
  });

  jest.setTimeout(300_000);
  const HOOK_TIMEOUT = 300_000;

  const dialect = parseDialect(process.env.LIVE_DB_TYPE);
  const bullPrefix = `bull-sca-container-import-live-${randomUUID()}`;

  let h: Harness;
  let tmp: string;

  const repo = <T extends ObjectLiteral>(
    entity: EntityTarget<T>,
    harness: Harness = h,
  ) => harness.live.dataSource.getRepository(entity);

  /** One import of `file` as a new scan of `projectId`. */
  const runImport = async (
    projectId: string,
    file: string,
    category: ImportCategory,
    image?: string,
    harness: Harness = h,
    sbomFile?: string,
  ): Promise<string> => {
    const scanId = randomUUID();
    const data: ResultsImportJobData = {
      scanId,
      projectId,
      organizationId: randomUUID(),
      branch: 'main',
      category,
      format: 'sarif',
      // The fake file source reads this path.
      fileKey: file,
      ...(image ? { image } : {}),
      ...(sbomFile ? { sbomFileKey: sbomFile } : {}),
    };
    await harness.processor.process({
      id: `results-import-${scanId}`,
      data,
    } as Job<ResultsImportJobData>);
    return scanId;
  };

  /** The CompleteImportScan request of `scanId` (exactly one). */
  const completionOf = (scanId: string, harness: Harness = h) => {
    const calls = harness.completeImportScan.mock.calls.filter(
      ([request]) => request.scanId === scanId,
    );
    expect(calls).toHaveLength(1);
    return calls[0][0];
  };

  /** A copy of `name` in which `keep` decides which results stay. */
  const filtered = async (
    name: string,
    keep: (result: { message?: { text?: string } }) => boolean,
  ): Promise<string> => {
    const sarif = JSON.parse(readFileSync(fixture(name), 'utf8')) as {
      runs: Array<{ results: Array<{ message?: { text?: string } }> }>;
    };
    for (const run of sarif.runs) run.results = run.results.filter(keep);
    const path = join(tmp, `${randomUUID()}-${name}`);
    await writeFile(path, JSON.stringify(sarif));
    return path;
  };

  const scaDetections = (projectId: string, harness: Harness = h) =>
    repo(ScaVulnerabilityDetections, harness).find({
      where: { projectId },
      relations: ['scaDetectedPackage', 'vulnerability'],
      order: { id: 'ASC' },
    });

  const scaPackages = (projectId: string, harness: Harness = h) =>
    repo(ScaDetectedPackages, harness).find({
      where: { projectId },
      order: { packageName: 'ASC' },
    });

  const containerDetections = (projectId: string) =>
    repo(VulnerabilityDetectionsContainer).find({
      where: { projectId },
      relations: ['detectedPackage', 'detectedImage', 'vulnerability'],
      order: { id: 'ASC' },
    });

  /** The `fixed` versions of an advisory's fix chains (affected → range → event). */
  const fixedVersionsOf = async (
    advisoryId: string,
    harness: Harness = h,
  ): Promise<string[]> => {
    const events = await repo(VulnerabilityOsvAffectedEvent, harness).find({
      where: { range: { affected: { vulnerability: { id: advisoryId } } } },
    });
    return events
      .map((event) => event.fixed)
      .filter((fixed): fixed is string => !!fixed)
      .sort();
  };

  /** States by advisory: a resolved package is removed, its detection kept. */
  const statesByAdvisory = (rows: ScaVulnerabilityDetections[]) =>
    Object.fromEntries(
      rows.map((row) => [row.vulnerability.id, row.currentState]),
    );

  const reportJson = <T>(report: { content: Buffer }): T =>
    JSON.parse(report.content.toString('utf8')) as T;

  beforeAll(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'sca-container-import-live-'));
    h = await openHarness(dialect, bullPrefix);
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    if (tmp) await rm(tmp, { recursive: true, force: true });
    await h?.close();
  }, HOOK_TIMEOUT);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('imports trivy-fs-sca.sarif as sca: packages, detections, fixed versions, ecosystems', async () => {
    const projectId = randomUUID();
    const scanId = await runImport(
      projectId,
      fixture('trivy-fs-sca.sarif'),
      'sca',
    );
    expect(completionOf(scanId)).toEqual(
      expect.objectContaining({
        status: 'completed',
        errorCode: '',
        findingsCount: 5,
        toolName: 'trivy',
      }),
    );

    const packages = await scaPackages(projectId);
    expect(
      packages.map((p) => [p.packageName, p.packageVersion, p.ecosystem]),
    ).toEqual([
      ['lodash', '4.17.20', 'npm'],
      ['qs', '6.5.2', 'npm'],
      ['request', '2.88.2', 'npm'],
      ['requests', '2.25.1', 'PyPI'],
      ['tough-cookie', '2.5.0', 'npm'],
    ]);
    const detections = await scaDetections(projectId);
    expect(detections.map((d) => d.vulnerability.id).sort()).toEqual(
      TRIVY_FS_ADVISORIES,
    );
    for (const detection of detections) {
      expect(detection.currentState).toBe('to_verify');
      expect(detection.branch).toBe('main');
    }

    expect(await fixedVersionsOf('CVE-2021-23337')).toEqual(['4.17.21']);
    expect(await fixedVersionsOf('CVE-2022-24999')).toEqual(
      ['6.10.3', '6.9.7', '6.7.3', '6.5.3', '6.4.1', '6.3.3', '6.2.4'].sort(),
    );
    expect(await fixedVersionsOf('CVE-2023-28155')).toEqual([]);

    const advisories = await repo(VulnerabilityOsv).find({
      where: TRIVY_FS_ADVISORIES.map((id) => ({ id })),
    });
    expect(advisories).toHaveLength(5);
    for (const advisory of advisories) {
      expect(advisory.databaseSpecific?.source).toBe('sarif:trivy');
    }

    // The dashboard's reads.
    const lodash = detections.find(
      (d) => d.scaDetectedPackage.packageName === 'lodash',
    );
    const detail = await h.sca.getScaVulnerabilityByIdInProject({
      projectId,
      vulnerabilityId: lodash.id,
    });
    expect(detail.sca?.metadata?.packages.map((p) => p.fixed)).toContain(
      '4.17.21',
    );

    const list = await h.sca.getProjectScaVulnerabilities({
      projectId,
      branch: 'main',
      pageNumber: 1,
      pageSizeNumber: 50,
      excludeAutofixCounts: true,
    } as Parameters<ScaService['getProjectScaVulnerabilities']>[0]);
    expect(list.total).toBe(5);
    expect(
      list.vulnerabilities.map((v) => v.library?.packageName).sort(),
    ).toEqual(['lodash', 'qs', 'request', 'requests', 'tough-cookie']);
  });

  it('re-importing the same sca file creates no row and resolves nothing', async () => {
    const projectId = randomUUID();
    await runImport(projectId, fixture('trivy-fs-sca.sarif'), 'sca');
    const packagesBefore = await scaPackages(projectId);
    const detectionsBefore = await scaDetections(projectId);
    const advisoriesBefore = await repo(VulnerabilityOsv).count();

    const second = await runImport(
      projectId,
      fixture('trivy-fs-sca.sarif'),
      'sca',
    );
    expect(completionOf(second).status).toBe('completed');

    expect((await scaPackages(projectId)).map((p) => p.id)).toEqual(
      packagesBefore.map((p) => p.id),
    );
    const detectionsAfter = await scaDetections(projectId);
    expect(detectionsAfter.map((d) => d.id)).toEqual(
      detectionsBefore.map((d) => d.id),
    );
    for (const detection of detectionsAfter) {
      expect(detection.currentState).toBe('to_verify');
    }
    expect(await repo(VulnerabilityOsv).count()).toBe(advisoriesBefore);
  });

  it('a second sca import without lodash resolves exactly lodash', async () => {
    const projectId = randomUUID();
    await runImport(projectId, fixture('trivy-fs-sca.sarif'), 'sca');
    const withoutLodash = await filtered(
      'trivy-fs-sca.sarif',
      (result) => !(result.message?.text ?? '').includes('Package: lodash'),
    );

    const scanId = await runImport(projectId, withoutLodash, 'sca');
    expect(completionOf(scanId)).toEqual(
      expect.objectContaining({ status: 'completed', findingsCount: 4 }),
    );

    // lodash is CVE-2021-23337; its package row is removed (removeMissingLibs)
    expect(statesByAdvisory(await scaDetections(projectId))).toEqual({
      'CVE-2021-23337': 'resolved',
      'CVE-2022-24999': 'to_verify',
      'CVE-2023-26136': 'to_verify',
      'CVE-2023-28155': 'to_verify',
      'CVE-2023-32681': 'to_verify',
    });
    expect((await scaPackages(projectId)).map((p) => p.packageName)).toEqual([
      'qs',
      'request',
      'requests',
      'tough-cookie',
    ]);
  });

  it('an sca import with its SBOM keeps every package, licensed and placed, through the finalization', async () => {
    const projectId = randomUUID();
    const scanId = await runImport(
      projectId,
      fixture('trivy-fs-sca.sarif'),
      'sca',
      undefined,
      h,
      sbomFixture('trivy-fs.cdx.json'),
    );
    expect(completionOf(scanId)).toEqual(
      expect.objectContaining({ status: 'completed', findingsCount: 5 }),
    );

    // finalize ran inside the import: every row it kept carries this scan
    const packages = await scaPackages(projectId);
    const byName = new Map(packages.map((p) => [p.packageName, p]));
    expect([...byName.keys()].sort()).toEqual([
      '@babel/code-frame',
      'express',
      'lodash',
      'qs',
      'request',
      'requests',
      'tough-cookie',
      'typing_extensions',
    ]);
    for (const row of packages) {
      expect(row.lastScanId).toBe(scanId);
      expect(row.dependencyInfoAvailable).toBe(true);
    }
    // a package without a vulnerability: stored with its licenses, no detection
    expect(byName.get('express')).toMatchObject({
      packageVersion: '4.17.1',
      ecosystem: 'npm',
      fileName: 'package-lock.json',
      isTransitive: false,
      isDev: false,
      licenses: ['MIT'],
      path: ['express@4.17.1', 'package-lock.json'],
    });
    expect(byName.get('typing_extensions')).toMatchObject({
      ecosystem: 'PyPI',
      licenseExpression: 'PSF-2.0',
    });
    // a vulnerable package: one row, its detection, and the SBOM's facts
    expect(byName.get('qs')).toMatchObject({
      isTransitive: true,
      licenses: ['BSD-3-Clause'],
    });
    const detections = await scaDetections(projectId);
    expect(detections.map((d) => d.vulnerability.id).sort()).toEqual(
      TRIVY_FS_ADVISORIES,
    );
    const lodashDetections = detections.filter(
      (d) => d.scaDetectedPackage.packageName === 'lodash',
    );
    expect(lodashDetections).toHaveLength(1);
    expect(lodashDetections[0].scaDetectedPackage.id).toBe(
      byName.get('lodash').id,
    );
    expect(
      detections.some((d) => d.scaDetectedPackage.packageName === 'express'),
    ).toBe(false);
  });

  it('the sca container of a cluster scan sends its SBOM: the same eight packages, finalized once, the container closed', async () => {
    const projectId = randomUUID();
    const scanId = randomUUID();
    const containerId = randomUUID();
    await h.processor.process({
      id: `results-import-${scanId}-${containerId}`,
      data: {
        scanId,
        projectId,
        organizationId: randomUUID(),
        branch: 'main',
        category: 'sca',
        format: 'sarif',
        // The fake file source reads these paths.
        fileKey: fixture('trivy-fs-sca.sarif'),
        sbomFileKey: sbomFixture('trivy-fs.cdx.json'),
        containerId,
        severities: 'critical,high,medium,low',
      },
    } as Job<ResultsImportJobData>);
    expect(completionOf(scanId)).toEqual(
      expect.objectContaining({
        status: 'completed',
        findingsCount: 5,
        containerId,
      }),
    );
    const packages = await scaPackages(projectId);
    expect(packages.map((p) => p.packageName).sort()).toEqual([
      '@babel/code-frame',
      'express',
      'lodash',
      'qs',
      'request',
      'requests',
      'tough-cookie',
      'typing_extensions',
    ]);
    for (const row of packages) expect(row.lastScanId).toBe(scanId);
    expect(
      (await scaDetections(projectId)).map((d) => d.vulnerability.id).sort(),
    ).toEqual(TRIVY_FS_ADVISORIES);
  });

  it('the next sca import without an SBOM replaces both: the SBOM-only packages go', async () => {
    const projectId = randomUUID();
    await runImport(
      projectId,
      fixture('trivy-fs-sca.sarif'),
      'sca',
      undefined,
      h,
      sbomFixture('trivy-fs.cdx.json'),
    );
    expect(
      await repo(ScaDetectedPackages).count({ where: { projectId } }),
    ).toBe(8);

    await runImport(projectId, fixture('trivy-fs-sca.sarif'), 'sca');
    expect(
      (await scaPackages(projectId)).map((p) => p.packageName).sort(),
    ).toEqual(['lodash', 'qs', 'request', 'requests', 'tough-cookie']);
    for (const detection of await scaDetections(projectId)) {
      expect(detection.currentState).toBe('to_verify');
    }
  });

  it("an unparsable file leaves the previous import's findings open", async () => {
    const projectId = randomUUID();
    await runImport(projectId, fixture('trivy-fs-sca.sarif'), 'sca');
    const packagesBefore = await repo(ScaDetectedPackages).count();
    const detectionsBefore = await repo(ScaVulnerabilityDetections).count();
    const advisoriesBefore = await repo(VulnerabilityOsv).count();

    const scanId = await runImport(
      projectId,
      fixture('sca-unparsable.sarif'),
      'sca',
    );
    expect(completionOf(scanId)).toEqual(
      expect.objectContaining({
        status: 'failed',
        errorCode: 'IMPORT_UNSUPPORTED_RESULT',
        findingsCount: 0,
      }),
    );
    expect(
      h.onScannerFinalized.mock.calls.filter(([id]) => id === scanId),
    ).toEqual([]);

    const detections = await scaDetections(projectId);
    expect(detections).toHaveLength(5);
    for (const detection of detections) {
      expect(detection.currentState).toBe('to_verify');
    }
    expect(await repo(ScaDetectedPackages).count()).toBe(packagesBefore);
    expect(await repo(ScaVulnerabilityDetections).count()).toBe(
      detectionsBefore,
    );
    expect(await repo(VulnerabilityOsv).count()).toBe(advisoriesBefore);
  });

  it('imports osv-scanner.sarif with its aliases and the bag file with its CWEs', async () => {
    const osvProject = randomUUID();
    const osvScan = await runImport(
      osvProject,
      fixture('osv-scanner.sarif'),
      'sca',
    );
    expect(completionOf(osvScan)).toEqual(
      expect.objectContaining({ status: 'completed', findingsCount: 3 }),
    );
    const aliases = await repo(VulnerabilityOsvAlias).find({
      where: { vulnerability: { id: 'CVE-2022-24713' } },
    });
    // the id itself is an alias too (a CVE id)
    expect(aliases.map((a) => a.alias)).toEqual(
      expect.arrayContaining(['RUSTSEC-2022-0013', 'GHSA-m5pq-gvj9-9vr8']),
    );
    expect(
      (await scaPackages(osvProject)).map((p) => [
        p.packageName,
        p.packageVersion,
        p.ecosystem,
      ]),
    ).toEqual([
      ['@babel/traverse', '7.22.5', 'npm'],
      ['golang.org/x/net', '0.17.0', 'Go'],
      ['regex', '1.5.1', 'crates.io'],
    ]);

    const bagProject = randomUUID();
    const bagScan = await runImport(
      bagProject,
      fixture('sca-package-bag.sarif'),
      'sca',
    );
    expect(completionOf(bagScan)).toEqual(
      expect.objectContaining({
        status: 'completed',
        findingsCount: 3,
        toolName: 'acme-sca,trivy',
      }),
    );
    const lodash = (await scaPackages(bagProject)).find(
      (p) => p.packageName === 'lodash',
    );
    expect(lodash?.packageVersion).toBe('4.17.15');

    const cwe = reportJson<CweReportData>(
      await h.cwe.generateReport(bagProject, 'json', true, 'main'),
    );
    expect(cwe.summary.byType.sca).toBe(3);
    const cwes = cwe.vulnerabilities.flatMap((v) => v.cwe);
    expect(cwes).toEqual(expect.arrayContaining(['CWE-1321', 'CWE-1333']));
  });

  it('places the imported SCA findings in A06 and minimal.sarif rule 1 in A03 by its label', async () => {
    const projectId = randomUUID();
    await runImport(projectId, fixture('trivy-fs-sca.sarif'), 'sca');
    await runImport(projectId, fixture('minimal.sarif'), 'sast');

    const report = reportJson<OwaspReportData>(
      await h.owasp.generateReport(projectId, 'json', true, 'main'),
    );
    expect(report.summary.byType).toEqual(
      expect.objectContaining({ sca: 5, sast: 2 }),
    );
    const category = (id: string) =>
      report.owaspCategories.find((c) => c.categoryData.id === id);

    const a06 = category('A06');
    expect(a06?.vulnerabilities.filter((v) => v.type === 'sca')).toHaveLength(
      5,
    );

    const a03 = category('A03');
    const views = a03?.vulnerabilities.find((v) => v.path === 'app/views.py');
    const server = a03?.vulnerabilities.find((v) => v.path === 'web/server.js');
    expect(views?.owaspTop10).toEqual(['A03:2021']);
    expect(server).toBeDefined();
    expect(server?.owaspTop10 ?? []).toEqual([]);
    expect(server?.cwe).toContain('CWE-79');
  });

  it('imports trivy-image.sarif as container: the image, its id, packages and detections', async () => {
    const projectId = randomUUID();
    const scanId = await runImport(
      projectId,
      fixture('trivy-image.sarif'),
      'container',
      TRIVY_IMAGE,
    );
    expect(completionOf(scanId)).toEqual(
      expect.objectContaining({
        status: 'completed',
        findingsCount: 4,
        toolName: 'trivy',
      }),
    );

    const images = await repo(ContainerDetectedImage).find({
      where: { projectId },
    });
    expect(images.map((i) => [i.artifactName, i.imageId])).toEqual([
      [TRIVY_IMAGE, TRIVY_IMAGE_ID],
    ]);

    const packages = await repo(ContainerDetectedPackage).find({
      where: { projectId },
      order: { packageName: 'ASC' },
    });
    expect(packages.map((p) => [p.packageName, p.target])).toEqual([
      ['busybox', 'ghcr.io/example/api'],
      ['libcrypto3', 'ghcr.io/example/api'],
      ['libssl3', 'ghcr.io/example/api'],
      ['lodash', 'app/package-lock.json'],
    ]);
    const detections = await containerDetections(projectId);
    expect(detections).toHaveLength(4);
    expect(detections.map((d) => d.detectedPackage.packageName).sort()).toEqual(
      ['busybox', 'libcrypto3', 'libssl3', 'lodash'],
    );

    const libcrypto3 = detections.find(
      (d) => d.detectedPackage.packageName === 'libcrypto3',
    );
    const detail = await h.container.getContainerVulnerabilityById({
      projectId,
      vulnerabilityId: libcrypto3.id,
    });
    expect(detail.detection?.fixedVersion).toBe('3.1.1-r0');
    const list = await h.container.getProjectContainerImages({
      projectId,
      branch: 'main',
    });
    expect(list.images.map((i) => i.artifactName)).toEqual([TRIVY_IMAGE]);

    // The results list and its AutoFix filter, an EXISTS subquery written as
    // raw SQL: its alias is unknown to TypeORM, so its camelCase column is
    // quoted (PostgreSQL answers 42703 on the unquoted one).
    const vulnerabilities = (hasAutofix?: boolean) =>
      h.container.getProjectContainerVulnerabilities({
        projectId,
        branch: 'main',
        page: 1,
        limit: 10,
        ...(hasAutofix === undefined ? {} : { hasAutofix }),
      } as Parameters<
        ContainerService['getProjectContainerVulnerabilities']
      >[0]);
    expect((await vulnerabilities()).total).toBe(4);
    expect((await vulnerabilities(false)).total).toBe(4);
    expect((await vulnerabilities(true)).total).toBe(0);
  });

  it('a second container import without busybox resolves exactly busybox', async () => {
    const projectId = randomUUID();
    await runImport(
      projectId,
      fixture('trivy-image.sarif'),
      'container',
      TRIVY_IMAGE,
    );
    const withoutBusybox = await filtered(
      'trivy-image.sarif',
      (result) => !(result.message?.text ?? '').includes('Package: busybox'),
    );

    const scanId = await runImport(
      projectId,
      withoutBusybox,
      'container',
      TRIVY_IMAGE,
    );
    expect(completionOf(scanId)).toEqual(
      expect.objectContaining({ status: 'completed', findingsCount: 3 }),
    );

    expect(
      await repo(ContainerDetectedImage).count({ where: { projectId } }),
    ).toBe(1);
    const states = Object.fromEntries(
      (await containerDetections(projectId)).map((d) => [
        d.detectedPackage.packageName,
        d.currentState,
      ]),
    );
    expect(states).toEqual({
      busybox: 'resolved',
      libcrypto3: 'to_verify',
      libssl3: 'to_verify',
      lodash: 'to_verify',
    });
  });

  it('imports grype-image.sarif as container with GHSA-72xf-g2v4-qvf3 and the image reference as imageId', async () => {
    const projectId = randomUUID();
    const scanId = await runImport(
      projectId,
      fixture('grype-image.sarif'),
      'container',
      GRYPE_IMAGE,
    );
    expect(completionOf(scanId)).toEqual(
      expect.objectContaining({
        status: 'completed',
        findingsCount: 4,
        toolName: 'grype',
      }),
    );

    const images = await repo(ContainerDetectedImage).find({
      where: { projectId },
    });
    expect(images.map((i) => [i.artifactName, i.imageId])).toEqual([
      [GRYPE_IMAGE, GRYPE_IMAGE],
    ]);
    const detections = await containerDetections(projectId);
    expect(detections.map((d) => d.vulnerability.id).sort()).toEqual([
      'CVE-2021-23337',
      'CVE-2023-2650',
      'CVE-2023-2650',
      'GHSA-72xf-g2v4-qvf3',
    ]);
    const toughCookie = detections.find(
      (d) => d.vulnerability.id === 'GHSA-72xf-g2v4-qvf3',
    );
    expect(toughCookie?.detectedPackage.packageName).toBe('tough-cookie');
  });

  it('routes trivy-mixed-kinds.sarif by kind: one SCA detection, one IaC finding, one secret, nothing for sast', async () => {
    const projectId = randomUUID();
    const file = fixture('trivy-mixed-kinds.sarif');
    const scans: Array<[ImportCategory, string]> = [];
    for (const category of ['sca', 'iac', 'secret', 'sast'] as const) {
      scans.push([category, await runImport(projectId, file, category)]);
    }
    for (const [category, scanId] of scans) {
      expect(completionOf(scanId)).toEqual(
        expect.objectContaining({
          status: 'completed',
          findingsCount: category === 'sast' ? 0 : 1,
        }),
      );
    }

    const sca = await scaDetections(projectId);
    expect(
      sca.map((d) => [d.scaDetectedPackage.packageName, d.currentState]),
    ).toEqual([['lodash', 'to_verify']]);
    const iac = await repo(IacVulnerabilityDetections).find({
      where: { projectId },
    });
    expect(iac.map((d) => [d.path, d.currentState])).toEqual([
      ['Dockerfile', 'to_verify'],
    ]);
    const secrets = await repo(SecretVulnerabilityDetections).find({
      where: { projectId },
    });
    expect(secrets.map((d) => [d.path, d.currentState])).toEqual([
      ['config/settings.py', 'to_verify'],
    ]);
    expect(
      await repo(SastVulnerabilityDetections).count({ where: { projectId } }),
    ).toBe(0);
  });

  it('keeps an advisory written by an earlier import unchanged', async () => {
    // Advisories are shared by every project: this case needs a database
    // where CVE-2021-23337 exists before any import, so it opens its own.
    const own = await openHarness(dialect, `${bullPrefix}-kept`);
    try {
      // What an earlier import wrote: the root, its DATABASE_SPECIFIC
      // severity and the lodash 4.17.21 fix chain.
      const ds = own.live.dataSource;
      const past = new Date(Date.now() - 3_600_000);
      await ds
        .createQueryBuilder()
        .insert()
        .into(VulnerabilityOsv)
        .values({
          id: 'CVE-2021-23337',
          summary: 'kept',
          details: 'kept details',
          databaseSpecific: {
            cwe_ids: ['CWE-94'],
            severity: 'LOW',
            source: 'sarif:earlier',
          },
          createdAt: past,
          updatedAt: past,
        } as unknown as QueryDeepPartialEntity<VulnerabilityOsv>)
        .updateEntity(false)
        .execute();
      const severityId = randomUUID();
      await ds
        .createQueryBuilder()
        .insert()
        .into(VulnerabilityOsvSeverity)
        .values({
          id: severityId,
          type: 'DATABASE_SPECIFIC',
          score: 'LOW',
          vulnerability: { id: 'CVE-2021-23337' },
        } as unknown as QueryDeepPartialEntity<VulnerabilityOsvSeverity>)
        .updateEntity(false)
        .execute();
      const affectedId = randomUUID();
      const rangeId = randomUUID();
      await ds
        .createQueryBuilder()
        .insert()
        .into(VulnerabilityOsvAffected)
        .values({
          id: affectedId,
          ecosystem: 'npm',
          packageName: 'lodash',
          severity: null,
          vulnerability: { id: 'CVE-2021-23337' },
        } as unknown as QueryDeepPartialEntity<VulnerabilityOsvAffected>)
        .updateEntity(false)
        .execute();
      await ds
        .createQueryBuilder()
        .insert()
        .into(VulnerabilityOsvAffectedRange)
        .values({
          id: rangeId,
          type: 'ECOSYSTEM',
          affected: { id: affectedId },
        } as unknown as QueryDeepPartialEntity<VulnerabilityOsvAffectedRange>)
        .updateEntity(false)
        .execute();
      await ds
        .createQueryBuilder()
        .insert()
        .into(VulnerabilityOsvAffectedEvent)
        .values({
          id: randomUUID(),
          fixed: '4.17.21',
          range: { id: rangeId },
        } as unknown as QueryDeepPartialEntity<VulnerabilityOsvAffectedEvent>)
        .updateEntity(false)
        .execute();
      const advisories = ds.getRepository(VulnerabilityOsv);
      const before = await advisories.findOneByOrFail({
        id: 'CVE-2021-23337',
      });

      const projectId = randomUUID();
      const scanId = await runImport(
        projectId,
        fixture('trivy-fs-sca.sarif'),
        'sca',
        undefined,
        own,
      );
      expect(completionOf(scanId, own).status).toBe('completed');

      const after = await advisories.findOneOrFail({
        where: { id: 'CVE-2021-23337' },
        relations: ['severities', 'affected', 'affected.ranges.events'],
      });
      // The root is never rewritten.
      expect(after.summary).toBe('kept');
      expect(after.details).toBe('kept details');
      expect(after.databaseSpecific).toEqual({
        cwe_ids: ['CWE-94'],
        severity: 'LOW',
        source: 'sarif:earlier',
      });
      expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
      // Its DATABASE_SPECIFIC severity is the one it had, alone of its type.
      expect(
        after.severities
          .filter((row) => row.type === 'DATABASE_SPECIFIC')
          .map((row) => [row.id, row.score]),
      ).toEqual([[severityId, 'LOW']]);
      // Its fix chain is not written twice.
      expect(after.affected.map((row) => row.id)).toEqual([affectedId]);
      expect(await fixedVersionsOf('CVE-2021-23337', own)).toEqual(['4.17.21']);
      // The new detection points at it.
      expect(
        (await scaDetections(projectId, own)).map((d) => d.vulnerability.id),
      ).toContain('CVE-2021-23337');
    } finally {
      await own.close();
    }
  });

  it('a project purge deletes the imported SCA and container rows and keeps the advisories', async () => {
    const projectId = randomUUID();
    const organizationId = randomUUID();
    await runImport(projectId, fixture('trivy-fs-sca.sarif'), 'sca');
    await runImport(
      projectId,
      fixture('trivy-image.sarif'),
      'container',
      TRIVY_IMAGE,
    );
    const projectRows = async () => ({
      scaPackages: await repo(ScaDetectedPackages).count({
        where: { projectId },
      }),
      scaDetections: await repo(ScaVulnerabilityDetections).count({
        where: { projectId },
      }),
      images: await repo(ContainerDetectedImage).count({
        where: { projectId },
      }),
      containerPackages: await repo(ContainerDetectedPackage).count({
        where: { projectId },
      }),
      containerDetections: await repo(VulnerabilityDetectionsContainer).count({
        where: { projectId },
      }),
    });
    expect(await projectRows()).toEqual({
      scaPackages: 5,
      scaDetections: 5,
      images: 1,
      containerPackages: 4,
      containerDetections: 4,
    });
    const advisoriesBefore = await repo(VulnerabilityOsv).count();

    const result = await h.purge.purgeProject(
      projectId,
      organizationId,
      Date.now() + 60_000,
    );
    expect(result.complete).toBe(true);

    expect(await projectRows()).toEqual({
      scaPackages: 0,
      scaDetections: 0,
      images: 0,
      containerPackages: 0,
      containerDetections: 0,
    });
    expect(await repo(VulnerabilityOsv).count()).toBe(advisoriesBefore);
    for (const id of [...TRIVY_FS_ADVISORIES, 'CVE-2023-2650']) {
      expect(await repo(VulnerabilityOsv).existsBy({ id })).toBe(true);
    }
  });

  it('dispatches the scan end once per import, with the import type', async () => {
    const projectId = randomUUID();
    const scaScan = await runImport(
      projectId,
      fixture('trivy-fs-sca.sarif'),
      'sca',
    );
    const containerScan = await runImport(
      projectId,
      fixture('trivy-image.sarif'),
      'container',
      TRIVY_IMAGE,
    );

    const callsOf = (scanId: string) =>
      h.onScannerFinalized.mock.calls.filter(([id]) => id === scanId);
    expect(callsOf(scaScan)).toEqual([[scaScan, projectId, 'sca', 'trivy']]);
    expect(callsOf(containerScan)).toEqual([
      [containerScan, projectId, 'container', 'trivy'],
    ]);
    expect(h.onScannerFinalized).toHaveBeenCalledTimes(2);
  });
});
