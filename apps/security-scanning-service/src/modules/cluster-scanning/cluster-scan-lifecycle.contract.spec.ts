import { PROJECT_SCAN_SETTINGS_COMMUNITY_BINDINGS } from 'src/edition/community/project-scan-settings.binding';
import { randomUUID } from 'crypto';
import { Logger as NestLogger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Logger } from 'nestjs-pino';
import type { V1Pod } from '@kubernetes/client-node';
import { RealtimeEventPublisher } from '@cybedefend/realtime-publisher';
import { Container } from 'src/entities/container.entity';
import { Scan } from 'src/entities/scan.entity';
import { Scanner } from 'src/entities/scanner.entity';
import { ScanUploadToken } from 'src/entities/scan-upload-token.entity';
import { SupportedLanguage } from 'src/entities/supported-language.entity';
import {
  createLiveDatabase,
  liveEnabled,
  LiveDatabase,
} from 'src/core/db/live-database';
import { SCANNER_ORCHESTRATOR_PORT } from 'src/edition/ports/scanner-orchestrator.port';
import { SCANNER_PODS_PORT } from 'src/edition/ports/scanner-pods.port';
import { SCAN_LIFECYCLE_HOOKS } from 'src/edition/ports/scan-lifecycle-hooks.port';
import { AI_ANALYSIS_PORT } from 'src/edition/ports/ai-analysis.port';
import { CommunityScannerOrchestrator } from 'src/edition/community/scanner-orchestrator.community';
import { CommunityScannerPods } from 'src/edition/community/scanner-pods.community';
import { CommunityScanLifecycleHooks } from 'src/edition/community/scan-lifecycle-hooks.community';
import { CommunityAiAnalysis } from 'src/edition/community/ai-analysis.community';
import { FileManagementService } from '../file/file-management.service';
import { ScanService } from '../scan/scan.service';
import {
  OrganizationManager,
  ProjectAppsecMarker,
  ScanPipelineEvents,
  ScanProgressUtils,
  ScanStateManager,
  ScanStateStore,
  ScanUtils,
  ScanValidation,
} from '../scan/core';
import { ContainerScanBranchResolver } from '../scan/core/containerScanBranchResolver';
import { ImportScanService } from '../scan/import/import-scan.service';
import { ScanUploadTokens } from '../scan/cluster-results/scan-upload-tokens';
import { ScanResultsService } from '../scan/cluster-results/scan-results.service';
import {
  describeScanLifecycleContract,
  LIFECYCLE_ORG,
  lifecycleFakes,
  trackResultsFinalization,
  type LifecycleHarness,
} from '../scan/core/scan-lifecycle.contract';
import {
  CLUSTER_SCANNING_CONFIG,
  readClusterScanningConfig,
} from './cluster-scanning.config';
import { ClusterScanningState } from './cluster-scanning.state';
import { COMMUNITY_KUBE_CLIENT, type CommunityKubeClient } from './kube-client';
import { CommunityScannerCatalogue } from './scanner-catalogue';
import { ClusterPodLauncher } from './cluster-pod-launcher';
import { ClusterScannerOrchestrator } from './cluster-scanner-orchestrator';
import { ClusterScanQueue } from './cluster-scan-queue';
import { ClusterPodWatchdog } from './cluster-pod-watchdog';
import { ClusterScanEnd } from './cluster-scan-end';

/**
 * The scan lifecycle contract on the Community cluster engine: the
 * real ScanService, core primitives, edition facades and engine classes, on
 * a real database (both engines, `LIVE_DB_TYPE=mysql|postgres`), with a fake
 * Kubernetes client and fake gRPC peers.
 *
 *   SS_CLUSTER_SCAN_LIVE=1 LIVE_DB_TYPE=mysql SS_IMPORT_SCAN_MYSQL_URL=mysql://root:password@127.0.0.1:13308 \
 *     pnpm exec jest --ci --runInBand src/modules/cluster-scanning/cluster-scan-lifecycle.contract.spec.ts
 *   SS_CLUSTER_SCAN_LIVE=1 LIVE_DB_TYPE=postgres DB_TYPE=postgres SS_IMPORT_SCAN_PG_URL=postgres://postgres:postgres@127.0.0.1:15432 \
 *     pnpm exec jest --ci --runInBand src/modules/cluster-scanning/cluster-scan-lifecycle.contract.spec.ts
 */

interface CommunityHarness extends LifecycleHarness {
  /** The index-th container fails through ScanResultsService.closeContainer. */
  failContainer(
    scanId: string,
    index: number,
    errorCode: string,
  ): Promise<void>;
  scanRow(scanId: string): Promise<Scan>;
  /** The scan row as UpdateScan found it, at each call. */
  rowsAtUpdateScan: Array<Pick<Scan, 'state' | 'errorCode'>>;
}

async function communityHarness(): Promise<CommunityHarness> {
  for (const m of ['log', 'warn', 'error'] as const) {
    jest.spyOn(NestLogger.prototype, m).mockImplementation(() => undefined);
  }
  process.env.SS_CLUSTER_SCAN_MYSQL_URL ??=
    process.env.SS_IMPORT_SCAN_MYSQL_URL;
  process.env.SS_CLUSTER_SCAN_PG_URL ??= process.env.SS_IMPORT_SCAN_PG_URL;
  const db: LiveDatabase = await createLiveDatabase({
    prefix: 'ss_cluster_lifecycle',
    envPrefix: 'SS_CLUSTER_SCAN',
  });
  const fakes = lifecycleFakes();
  let pods = 0;
  const kube: CommunityKubeClient = {
    reviewAccess: async () => ({ ok: true }),
    createSecret: async () => undefined,
    deleteSecret: async () => undefined,
    createPod: async () => ({ uid: `uid-${++pods}` }),
    readPod: async () => ({ status: { phase: 'Running' } }) as V1Pod,
    listManagedPods: async () => [],
    deletePod: async () => undefined,
  };
  const config = readClusterScanningConfig({
    CYBEDEFEND_SCANNER_KUBECONFIG_FILE: '/run/kubeconfig',
    CYBEDEFEND_SCANNER_NAMESPACE: 'scans',
    CYBEDEFEND_SCANNER_MAX_CONCURRENT: '50',
    FRONTEND_URL: 'https://appsec.example.com',
  });

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      ScanService,
      ScanUtils,
      ScanProgressUtils,
      ScanStateManager,
      ScanValidation,
      OrganizationManager,
      ...PROJECT_SCAN_SETTINGS_COMMUNITY_BINDINGS,
      ScanStateStore,
      ScanPipelineEvents,
      ProjectAppsecMarker,
      ScanUploadTokens,
      ScanResultsService,
      CommunityScannerCatalogue,
      ClusterScanEnd,
      ClusterPodLauncher,
      ClusterScannerOrchestrator,
      ClusterScanQueue,
      ClusterPodWatchdog,
      {
        provide: SCANNER_ORCHESTRATOR_PORT,
        useClass: CommunityScannerOrchestrator,
      },
      { provide: SCANNER_PODS_PORT, useClass: CommunityScannerPods },
      { provide: SCAN_LIFECYCLE_HOOKS, useClass: CommunityScanLifecycleHooks },
      { provide: AI_ANALYSIS_PORT, useClass: CommunityAiAnalysis },
      { provide: ClusterScanningState, useValue: { enabled: true } },
      { provide: CLUSTER_SCANNING_CONFIG, useValue: config },
      { provide: COMMUNITY_KUBE_CLIENT, useValue: kube },
      { provide: FileManagementService, useValue: fakes.files },
      { provide: ContainerScanBranchResolver, useValue: {} },
      {
        provide: ImportScanService,
        useValue: { isImportRequest: () => false },
      },
      { provide: RealtimeEventPublisher, useValue: fakes.realtime },
      { provide: Logger, useValue: fakes.logger },
      { provide: ConfigService, useValue: fakes.config },
      { provide: 'GLOBAL_MANAGEMENT_SERVICE', useValue: fakes.gm },
      { provide: 'ANALYSIS_REPORTING_SERVICE', useValue: fakes.ar },
      { provide: 'POLICY_MANAGEMENT_SERVICE', useValue: fakes.pm },
      ...[Scan, Container, Scanner, SupportedLanguage, ScanUploadToken].map(
        (entity) => ({
          provide: getRepositoryToken(entity),
          useValue: db.dataSource.getRepository(entity),
        }),
      ),
    ],
  }).compile();
  await module.init();

  const scans = module.get(ScanService);
  const finalization = trackResultsFinalization(module.get(ScanStateManager));
  const orchestrator = module.get(ClusterScannerOrchestrator);
  const launcher = module.get(ClusterPodLauncher);
  const organizationManager = module.get(OrganizationManager);
  const queue = module.get(ClusterScanQueue);
  const watchdog = module.get(ClusterPodWatchdog);
  const scanRepo = db.dataSource.getRepository(Scan);
  const containerRepo = db.dataSource.getRepository(Container);

  const startCalls: string[] = [];
  const realLaunchScan = orchestrator.launchScan.bind(orchestrator);
  jest
    .spyOn(orchestrator, 'launchScan')
    .mockImplementation(async (scan: Scan) => {
      startCalls.push('launchScan');
      return realLaunchScan(scan);
    });

  const results = module.get(ScanResultsService);
  const rowsAtUpdateScan: Array<Pick<Scan, 'state' | 'errorCode'>> = [];
  const realUpdateScan = scans.updateScan.bind(
    scans,
  ) as ScanService['updateScan'];
  jest
    .spyOn(scans, 'updateScan')
    .mockImplementation(
      async (...args: Parameters<ScanService['updateScan']>) => {
        const row = await scanRepo.findOneByOrFail({ id: args[0].scanId });
        rowsAtUpdateScan.push({ state: row.state, errorCode: row.errorCode });
        return realUpdateScan(...args);
      },
    );

  const projects = new Map<string, string>();
  const state = async (id: string) =>
    (await scanRepo.findOneByOrFail({ id })).state;

  return {
    async createAndStart(opts = {}) {
      const scanId = randomUUID();
      const projectId = randomUUID();
      projects.set(scanId, projectId);
      await scans.createScan({
        scanId,
        projectId,
        initializerUserId: 'u1',
        privateScan: false,
        vulnerabilityTypes: [],
      });
      expect(await state(scanId)).toBe('waiting_for_file');
      if (opts.atCapacity) {
        jest
          .spyOn(organizationManager, 'getSlotHoldingScansCount')
          .mockResolvedValueOnce({
            total: 1000,
            byOrganization: { [LIFECYCLE_ORG]: 1000 },
          });
      }
      if (opts.stallLaunch) {
        jest
          .spyOn(launcher, 'launch')
          .mockImplementationOnce(() => new Promise<number>(() => undefined));
      }
      const started = scans.startScan({
        scanId,
        projectId,
        language: ['python'],
        totalLOC: 10,
        totalSize: '1Mo',
      });
      if (opts.stallLaunch) {
        for (let i = 0; i < 100 && (await state(scanId)) !== 'running'; i++) {
          await new Promise((r) => setTimeout(r, 50));
        }
      } else {
        await started;
      }
      return scanId;
    },
    tick: () => queue.tick(),
    async closeContainer(scanId, index, closeState) {
      const rows = await containerRepo.find({
        where: { scanId },
        order: { podName: 'ASC' },
      });
      await scans.updateScan({
        scanId,
        podName: rows[index].podName,
        state: closeState,
      });
    },
    async cancel(scanId) {
      await scans.cancelScan(scanId, projects.get(scanId));
    },
    answerScanEnded: fakes.answerScanEnded,
    scanEndedNotices: fakes.scanEndedNotices,
    resultsSettled: () => finalization.settled(),
    markResultsFinal: (scanId) => scans.markScanResultsFinal(scanId),
    async failContainer(scanId, index, errorCode) {
      const rows = await containerRepo.find({
        where: { scanId },
        order: { podName: 'ASC' },
      });
      await results.closeContainer({
        scanId,
        containerId: rows[index].id,
        status: 'failed',
        errorCode,
        findingsCount: 0,
        toolName: '',
      });
    },
    scanRow: (id) => scanRepo.findOneByOrFail({ id }),
    rowsAtUpdateScan,
    runWatchdog: (now) => watchdog.tick(now),
    state,
    containers: (scanId) => containerRepo.count({ where: { scanId } }),
    podsCreated: () => pods,
    archiveDeletions: fakes.archiveDeletions,
    startCalls: () => [...startCalls],
    async close() {
      await finalization.settled();
      await module.close();
      await db.drop();
      jest.restoreAllMocks();
    },
  };
}

describeScanLifecycleContract(
  'Community cluster engine',
  communityHarness,
  liveEnabled('SS_CLUSTER_SCAN') ? describe : describe.skip,
);

// A failed scan must never be read with no reason between
// UpdateScan's state flip and the error written after it. The error is on
// the row before UpdateScan runs; the state manager keeps it only on a
// `failed` scan.
(liveEnabled('SS_CLUSTER_SCAN') ? describe : describe.skip)(
  'a cluster container failure on the real ScanService',
  () => {
    jest.setTimeout(120_000);
    let h: CommunityHarness;

    beforeAll(async () => {
      h = await communityHarness();
    });

    afterAll(async () => {
      await h?.close?.();
    });

    it('another container still open: the scan stays running with no error; the last one fails it with the first code, already on the row at the flip', async () => {
      const id = await h.createAndStart();
      expect(await h.state(id)).toBe('running');
      expect(await h.containers(id)).toBeGreaterThanOrEqual(2);
      const total = await h.containers(id);

      await h.failContainer(id, 0, 'CLUSTER_IMAGE_INCOMPATIBLE');
      let row = await h.scanRow(id);
      expect(row.state).toBe('running');
      expect(row.errorCode ?? null).toBeNull();
      expect(row.errorCategory ?? null).toBeNull();
      expect(row.errorMessage ?? null).toBeNull();

      for (let i = 1; i < total; i++) {
        h.rowsAtUpdateScan.length = 0;
        await h.failContainer(id, i, 'CLUSTER_TOOL_FAILED');
      }
      // the last close: UpdateScan already found the first failure's code
      expect(h.rowsAtUpdateScan).toEqual([{ state: 'running', errorCode: 84 }]);
      row = await h.scanRow(id);
      expect(row.state).toBe('failed');
      expect(row.errorCode).toBe(84);
      expect(row.errorCategory).toBe('cluster');
      expect(row.errorMessage).toEqual(expect.any(String));
    });
  },
);
