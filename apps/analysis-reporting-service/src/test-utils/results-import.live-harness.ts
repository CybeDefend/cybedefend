import { createReadStream } from 'node:fs';
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import type { ClientGrpc } from '@nestjs/microservices';
import { Queue } from 'bullmq';
import { Logger } from 'nestjs-pino';
import { of } from 'rxjs';
import { DataSource } from 'typeorm';
import type { parseDialect } from '@cybedefend/db-dialect';
import {
  createLiveDatabase,
  type LiveDatabase,
} from '../core/db/live-database';
import { SastIacService } from '../modules/sast-iac/sast-iac.service';
import { SastIacUtilsService } from '../modules/sast-iac/sast-iac.utils';
import { ScaService } from '../modules/sca/sca.service';
import { ContainerService } from '../modules/container/container.service';
import { ResultService } from '../modules/result/result.service';
import { IssueIntegrationService } from '../modules/vulnerability/issue-integration.service';
import { CvssCalculatorService } from '../modules/cvss/cvss-calculator.service';
import { CvssExplainerService } from '../modules/cvss/cvss-explainer.service';
import { SecretEncryptionService } from '../core/crypto/secret-encryption.service';
import { CyberiskRecomputeEnqueuer } from '../modules/cyber-risk/cyberisk-recompute.enqueuer';
import { ReferenceBranchResolver } from '../modules/cyber-risk/reference-branch.resolver';
import { ProjectOrgResolver } from '../core/realtime/project-org-resolver.service';
import { SecurityContextCacheService } from '../modules/security-context/security-context-cache.service';
import { OwaspReportService } from '../modules/reports/owasp-report/owasp-report.service';
import { CweReportService } from '../modules/reports/cwe-report/cwe-report.service';
import { PdfGeneratorService } from '../core/utils/pdf-generator.service';
import { ProjectNameResolver } from '../modules/reports/shared/project-name-resolver.service';
import { DataPurgeService } from '../modules/data-purge/data-purge.service';
import { OrganizationStatisticsService } from '../modules/organization-statistics/organization-statistics.service';
import { QUEUE_NAMES } from '../modules/scan-queue/queue-names';
import { ScanQueueService } from '../modules/scan-queue/scan-queue.service';
import type { ScanCompleteNotificationService } from '../modules/scan-queue/scan-complete-notification.service';
import type { RealtimeBatchPublisher } from '../core/realtime/realtime-batch-publisher.service';
import { HistoryItem } from '../entities/history-item.entity';
import { CatalogueFallbackService } from '../modules/results-import/catalogue-fallback.service';
import { AdvisoryFallbackService } from '../modules/results-import/advisory-fallback.service';
import type { ImportFileSource } from '../modules/results-import/import-file.source';
import { ResultsImportProcessor } from '../modules/results-import/results-import.processor';

/**
 * The SARIF import of the live specs: one migrated database (createLiveDatabase,
 * the dialect's tracks) and the real ResultsImportProcessor, ScaService,
 * ContainerService, advisory and catalogue fallbacks, SastIacService, report
 * services, purge and ScanQueueService (Redis RESULTS_IMPORT_REDIS_URL,
 * queues under `bullPrefix`). Only the edges are fakes: the file source reads
 * the path given as file key from disk, GetScan answers
 * `{ branch: 'main', isDiffScan: false }`, CompleteImportScan and the end of
 * scan dispatch are jest.fn().
 */
const REDIS_URL =
  process.env.RESULTS_IMPORT_REDIS_URL ?? 'redis://127.0.0.1:6379';

export interface ImportHarness {
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
export async function openImportHarness(
  dialect: ReturnType<typeof parseDialect>,
  bullPrefix: string,
): Promise<ImportHarness> {
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
