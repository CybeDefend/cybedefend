import { CommunityProjectScanSettings } from 'src/edition/community/project-scan-settings.community';
import { randomUUID } from 'crypto';
import { Logger as NestLogger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Logger } from 'nestjs-pino';
import type { ClientGrpc } from '@nestjs/microservices';
import { In } from 'typeorm';
import { Scan } from 'src/entities/scan.entity';
import {
  createLiveDatabase,
  liveEnabled,
  LiveDatabase,
} from 'src/core/db/live-database';
import { OrganizationManager } from '../scan/core/organizationManager';
import { ScanStateStore } from '../scan/core/scanStateStore';
import type { ScanStateManager } from '../scan/core/scanStateManager';
import { lifecycleFakes } from '../scan/core/scan-lifecycle.contract';
import { readClusterScanningConfig } from './cluster-scanning.config';
import type { ClusterPodLauncher } from './cluster-pod-launcher';
import type { ClusterScanningState } from './cluster-scanning.state';
import { ClusterScanEnd } from './cluster-scan-end';
import type { FileManagementService } from '../file/file-management.service';
import { Container } from 'src/entities/container.entity';
import { Scanner } from 'src/entities/scanner.entity';
import {
  COMMUNITY_SCANNER_CATALOGUE,
  CommunityScannerCatalogue as Catalogue,
} from './scanner-catalogue';
import { ClusterScannerOrchestrator } from './cluster-scanner-orchestrator';
import { ClusterScanQueue } from './cluster-scan-queue';

/**
 * LIVE proof of MAX_CONCURRENT on BOTH engines: N
 * concurrent StartScans, on a real database, never leave more than
 * MAX_CONCURRENT scans `running`; the post-claim recount steps the others
 * back to `queued`, and the tick then fills the free slots exactly.
 *
 *   SS_CLUSTER_SCAN_LIVE=1 LIVE_DB_TYPE=mysql SS_IMPORT_SCAN_MYSQL_URL=mysql://root:password@127.0.0.1:13308 \
 *     pnpm exec jest --ci --runInBand src/modules/cluster-scanning/cluster-scanner-orchestrator.live.spec.ts
 *   SS_CLUSTER_SCAN_LIVE=1 LIVE_DB_TYPE=postgres DB_TYPE=postgres SS_IMPORT_SCAN_PG_URL=postgres://postgres:postgres@127.0.0.1:15432 \
 *     pnpm exec jest --ci --runInBand src/modules/cluster-scanning/cluster-scanner-orchestrator.live.spec.ts
 */
const describeLive = liveEnabled('SS_CLUSTER_SCAN') ? describe : describe.skip;

const MAX = 2;
const N = 8;

describeLive(
  'MAX_CONCURRENT under concurrent starts, on a real database',
  () => {
    jest.setTimeout(300_000);
    let db: LiveDatabase;
    let orchestrator: ClusterScannerOrchestrator;
    let queue: ClusterScanQueue;
    const launched: string[] = [];

    beforeAll(async () => {
      for (const m of ['log', 'warn', 'error'] as const) {
        jest.spyOn(NestLogger.prototype, m).mockImplementation(() => undefined);
      }
      process.env.SS_CLUSTER_SCAN_MYSQL_URL ??=
        process.env.SS_IMPORT_SCAN_MYSQL_URL;
      process.env.SS_CLUSTER_SCAN_PG_URL ??= process.env.SS_IMPORT_SCAN_PG_URL;
      db = await createLiveDatabase({
        prefix: 'ss_cluster_capacity',
        envPrefix: 'SS_CLUSTER_SCAN',
      });
      const fakes = lifecycleFakes();
      const logger = fakes.logger as unknown as Logger;
      const scans = db.dataSource.getRepository(Scan);
      const store = new ScanStateStore(
        scans,
        db.dataSource.getRepository(Container),
        logger,
      );
      const organizationManager = new OrganizationManager(
        fakes.gm as unknown as ClientGrpc,
        scans,
        logger,
        fakes.config as unknown as ConfigService,
        new CommunityProjectScanSettings(),
      );
      organizationManager.onModuleInit();
      const stateManager = {
        publishStatusChanged: () => undefined,
        handleCompletedScan: async () => undefined,
      } as unknown as ScanStateManager;
      const config = readClusterScanningConfig({
        CYBEDEFEND_SCANNER_KUBECONFIG_FILE: '/run/kubeconfig',
        CYBEDEFEND_SCANNER_NAMESPACE: 'scans',
        CYBEDEFEND_SCANNER_MAX_CONCURRENT: String(MAX),
        FRONTEND_URL: 'https://appsec.example.com',
      });
      // A launch that writes no container: the scan keeps its slot while running.
      const launcher = {
        launch: async (scan: Scan) => {
          launched.push(scan.id);
          return 2;
        },
      } as unknown as ClusterPodLauncher;
      orchestrator = new ClusterScannerOrchestrator(
        scans,
        store,
        stateManager,
        organizationManager,
        launcher,
        { seed: async () => undefined } as unknown as Catalogue,
        new ClusterScanEnd(
          store,
          stateManager,
          fakes.files as unknown as FileManagementService,
        ),
        config,
      );
      queue = new ClusterScanQueue(
        scans,
        organizationManager,
        orchestrator,
        { enabled: true } as unknown as ClusterScanningState,
        config,
      );
    });

    afterAll(async () => {
      await db?.drop();
      jest.restoreAllMocks();
    });

    it.each([1, 2, 3])(
      'round %i: N concurrent starts never leave more than MAX running; the tick fills the slots',
      async () => {
        const repo = db.dataSource.getRepository(Scan);
        // the previous round's scans end: every slot is free
        await repo.update(
          { state: In(['running', 'queued']) },
          { state: 'completed' },
        );
        const rows = await repo.save(
          Array.from({ length: N }, () => ({
            id: randomUUID(),
            name: 'capacity',
            state: 'waiting_for_file',
            language: [],
            projectId: randomUUID(),
            organizationId: 'org-capacity',
            scanType: 'iac,secret',
            createAt: new Date(),
          })),
        );
        const before = launched.length;
        await Promise.all(
          rows.map((row) =>
            orchestrator.startScan(row, {
              scanId: row.id,
              projectId: row.projectId,
              language: ['python'],
              totalLOC: 1,
              totalSize: '1Mo',
            }),
          ),
        );
        const ids = rows.map((r) => r.id);
        const count = (state: string) =>
          repo.count({ where: { id: In(ids), state } });
        expect(await count('running')).toBeLessThanOrEqual(MAX);
        expect((await count('running')) + (await count('queued'))).toBe(N);
        expect(launched.length - before).toBe(await count('running'));

        await queue.tick();
        expect(await count('running')).toBe(MAX);
        expect(await count('queued')).toBe(N - MAX);
        expect(launched.length - before).toBe(MAX);
      },
    );

    it('over capacity: a running scan that already has a container row is never stepped back; one without is', async () => {
      const repo = db.dataSource.getRepository(Scan);
      await repo.update(
        { state: In(['running', 'queued']) },
        { state: 'completed' },
      );
      // the catalogue rows the container row references
      await new Catalogue(
        db.dataSource.getRepository(Scanner),
        readClusterScanningConfig({
          CYBEDEFEND_SCANNER_KUBECONFIG_FILE: '/run/kubeconfig',
          CYBEDEFEND_SCANNER_NAMESPACE: 'scans',
          FRONTEND_URL: 'https://appsec.example.com',
        }),
      ).seed();
      const row = (state: string) => ({
        id: randomUUID(),
        name: 'guard',
        state,
        language: [],
        projectId: randomUUID(),
        organizationId: 'org-capacity',
        scanType: 'iac,secret',
        createAt: new Date(),
        startTime: new Date(),
      });
      // MAX slot holders already running: any claim is over capacity
      await repo.save(Array.from({ length: MAX }, () => row('running')));
      const withContainer = await repo.save(row('queued'));
      const without = await repo.save(row('queued'));
      const containerId = randomUUID();
      await db.dataSource.getRepository(Container).insert({
        id: containerId,
        podName: `cd-scan-gitleaks-${containerId}`,
        image: 'cybedefend-scanners/gitleaks:1.0.0',
        status: 'starting',
        scanId: withContainer.id,
        scanner: { id: COMMUNITY_SCANNER_CATALOGUE[2].id } as Scanner,
      });

      await expect(orchestrator.launchScan(withContainer)).resolves.toBe(
        'launched',
      );
      expect((await repo.findOneByOrFail({ id: withContainer.id })).state).toBe(
        'running',
      );
      await expect(orchestrator.launchScan(without)).resolves.toBe('requeued');
      expect((await repo.findOneByOrFail({ id: without.id })).state).toBe(
        'queued',
      );
    });
  },
);
