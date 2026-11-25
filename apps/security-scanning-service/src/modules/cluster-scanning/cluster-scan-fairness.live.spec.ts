import { CommunityProjectScanSettings } from 'src/edition/community/project-scan-settings.community';
import { randomUUID } from 'crypto';
import { Logger as NestLogger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Logger } from 'nestjs-pino';
import type { ClientGrpc } from '@nestjs/microservices';
import { of } from 'rxjs';
import { In } from 'typeorm';
import { Scan } from 'src/entities/scan.entity';
import { Container } from 'src/entities/container.entity';
import {
  createLiveDatabase,
  liveEnabled,
  LiveDatabase,
} from 'src/core/db/live-database';
import { OrganizationManager } from '../scan/core/organizationManager';
import { ScanStateStore } from '../scan/core/scanStateStore';
import type { ScanStateManager } from '../scan/core/scanStateManager';
import { lifecycleFakes } from '../scan/core/scan-lifecycle.contract';
import type { FileManagementService } from '../file/file-management.service';
import { readClusterScanningConfig } from './cluster-scanning.config';
import type { ClusterPodLauncher } from './cluster-pod-launcher';
import type { ClusterScanningState } from './cluster-scanning.state';
import { ClusterScanEnd } from './cluster-scan-end';
import type { CommunityScannerCatalogue } from './scanner-catalogue';
import { ClusterScannerOrchestrator } from './cluster-scanner-orchestrator';
import { ClusterScanQueue } from './cluster-scan-queue';

/**
 * LIVE proof, on BOTH engines, that the cluster engine shares its capacity
 * between organizations: the instance's per-organization limit
 * (CYBEDEFEND_SCANNER_MAX_CONCURRENT_PER_ORGANIZATION, the instance maximum
 * when unset) is applied at admission and at dequeue, the organization's
 * stored limit is not read, and the dequeue rotates between the
 * organizations that have scans waiting, so one organization's backlog never
 * holds another's scan back, two replicas ticking at once included.
 *
 *   SS_CLUSTER_SCAN_LIVE=1 LIVE_DB_TYPE=mysql SS_CLUSTER_SCAN_MYSQL_URL=mysql://root:password@127.0.0.1:3308 \
 *     pnpm exec jest --ci --runInBand src/modules/cluster-scanning/cluster-scan-fairness.live.spec.ts
 *   SS_CLUSTER_SCAN_LIVE=1 LIVE_DB_TYPE=postgres DB_TYPE=postgres SS_CLUSTER_SCAN_PG_URL=postgres://postgres:postgres@127.0.0.1:5432 \
 *     pnpm exec jest --ci --runInBand src/modules/cluster-scanning/cluster-scan-fairness.live.spec.ts
 */
const describeLive = liveEnabled('SS_CLUSTER_SCAN') ? describe : describe.skip;

const ORG_A = 'org-fair-a';
const ORG_B = 'org-fair-b';

describeLive(
  'cluster scan capacity shared between organizations, on a real database',
  () => {
    jest.setTimeout(300_000);
    let db: LiveDatabase;
    const launched: string[] = [];

    const build = (maxConcurrent: number, perOrganization?: number) => {
      const fakes = lifecycleFakes();
      const logger = fakes.logger as unknown as Logger;
      const scans = db.dataSource.getRepository(Scan);
      const store = new ScanStateStore(
        scans,
        db.dataSource.getRepository(Container),
        logger,
      );
      const gm = {
        getService: (name: string) => {
          const base = fakes.gm.getService(name);
          if (name === 'ProjectService') return base;
          return {
            ...base,
            get: ({ organizationId }: { organizationId: string }) =>
              // Every organization is stored with a limit of 1: this engine
              // must not read it.
              of({ organizationId, concurrentScanLimit: 1 }),
          };
        },
      };
      const organizationManager = new OrganizationManager(
        gm as unknown as ClientGrpc,
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
        CYBEDEFEND_SCANNER_MAX_CONCURRENT: String(maxConcurrent),
        CYBEDEFEND_SCANNER_MAX_CONCURRENT_PER_ORGANIZATION:
          perOrganization === undefined ? '' : String(perOrganization),
        FRONTEND_URL: 'https://appsec.example.com',
      });
      // A launch that writes no container: the scan keeps its slot while running.
      const launcher = {
        launch: async (scan: Scan) => {
          launched.push(scan.id);
          return 2;
        },
      } as unknown as ClusterPodLauncher;
      const orchestrator = new ClusterScannerOrchestrator(
        scans,
        store,
        stateManager,
        organizationManager,
        launcher,
        { seed: async () => undefined } as unknown as CommunityScannerCatalogue,
        new ClusterScanEnd(
          store,
          stateManager,
          fakes.files as unknown as FileManagementService,
        ),
        config,
      );
      const queue = new ClusterScanQueue(
        scans,
        organizationManager,
        orchestrator,
        { enabled: true } as unknown as ClusterScanningState,
        config,
      );
      return { orchestrator, queue };
    };

    const newRows = (organizationId: string, n: number, base: number) =>
      db.dataSource.getRepository(Scan).save(
        Array.from({ length: n }, (_, i) => ({
          id: randomUUID(),
          name: 'fairness',
          state: 'waiting_for_file',
          language: [],
          projectId: randomUUID(),
          organizationId,
          scanType: 'iac,secret',
          // distinct creation times: the oldest-first order is unambiguous
          createAt: new Date(base + i * 1000),
        })),
      );

    const startAll = (orchestrator: ClusterScannerOrchestrator, rows: Scan[]) =>
      Promise.all(
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

    const countOf = (ids: string[], state: string) =>
      db.dataSource
        .getRepository(Scan)
        .count({ where: { id: In(ids), state } });

    /** One running scan of these ends: its slot is free again. */
    const endOne = async (ids: string[]) => {
      const repo = db.dataSource.getRepository(Scan);
      const one = await repo.findOneOrFail({
        where: { id: In(ids), state: 'running' },
        order: { createAt: 'ASC' },
      });
      await repo.update({ id: one.id }, { state: 'completed' });
    };

    beforeAll(async () => {
      for (const m of ['log', 'warn', 'error'] as const) {
        jest.spyOn(NestLogger.prototype, m).mockImplementation(() => undefined);
      }
      process.env.SS_CLUSTER_SCAN_MYSQL_URL ??=
        process.env.SS_IMPORT_SCAN_MYSQL_URL;
      process.env.SS_CLUSTER_SCAN_PG_URL ??= process.env.SS_IMPORT_SCAN_PG_URL;
      db = await createLiveDatabase({
        prefix: 'ss_cluster_fairness',
        envPrefix: 'SS_CLUSTER_SCAN',
      });
    });

    beforeEach(async () => {
      await db.dataSource
        .getRepository(Scan)
        .update({ state: In(['running', 'queued']) }, { state: 'completed' });
    });

    afterAll(async () => {
      await db?.drop();
      jest.restoreAllMocks();
    });

    it.each([1, 2, 3, 4, 5, 6, 7, 8])(
      'round %i: an organization never runs more than its limit, and the other organization starts at once',
      async () => {
        const { orchestrator, queue } = build(3, 1);
        const base = Date.now();
        const a = await newRows(ORG_A, 6, base);
        const b = await newRows(ORG_B, 1, base + 60_000);
        const aIds = a.map((r) => r.id);
        const bIds = b.map((r) => r.id);

        await startAll(orchestrator, a);
        expect(await countOf(aIds, 'running')).toBeLessThanOrEqual(1);
        expect(
          (await countOf(aIds, 'running')) + (await countOf(aIds, 'queued')),
        ).toBe(6);

        // B's one scan is admitted although A has a backlog
        await startAll(orchestrator, b);
        await queue.tick();
        expect(await countOf(bIds, 'running')).toBe(1);
        expect(await countOf(aIds, 'running')).toBe(1);
        expect(await countOf(aIds, 'queued')).toBe(5);

        // A's backlog drains one at a time, never above its limit
        for (let left = 5; left > 0; left--) {
          await endOne(aIds);
          await queue.tick();
          expect(await countOf(aIds, 'running')).toBe(1);
          expect(await countOf(aIds, 'queued')).toBe(left - 1);
        }
      },
    );

    it.each([1, 2, 3, 4, 5, 6, 7, 8])(
      'round %i: the dequeue rotates between organizations; a backlog does not hold another organization back',
      async () => {
        // A may fill the whole platform; B waits behind A's older backlog
        const { orchestrator, queue } = build(2, 2);
        const base = Date.now();
        const a = await newRows(ORG_A, 6, base);
        const b = await newRows(ORG_B, 1, base + 60_000);
        const aIds = a.map((r) => r.id);
        const bIds = b.map((r) => r.id);

        await startAll(orchestrator, a);
        await queue.tick();
        expect(await countOf(aIds, 'running')).toBe(2);
        await startAll(orchestrator, b);
        expect(await countOf(bIds, 'queued')).toBe(1);

        // one slot frees: B takes it, before A's older queued scans
        await endOne(aIds);
        await queue.tick();
        expect(await countOf(bIds, 'running')).toBe(1);
        expect(await countOf(aIds, 'running')).toBe(1);
        expect(await countOf(aIds, 'queued')).toBe(4);
      },
    );

    it.each([1, 2, 3, 4, 5, 6, 7, 8])(
      'round %i: unset, one organization keeps the whole capacity; its stored limit of 1 is not read',
      async () => {
        const { orchestrator, queue } = build(3);
        const a = await newRows(ORG_A, 5, Date.now());
        const aIds = a.map((r) => r.id);
        await startAll(orchestrator, a);
        await queue.tick();
        expect(await countOf(aIds, 'running')).toBe(3);
        expect(await countOf(aIds, 'queued')).toBe(2);
      },
    );

    it.each([1, 2, 3, 4, 5, 6, 7, 8])(
      'round %i: two replicas ticking at once launch no scan twice, lose none and respect the limits',
      async () => {
        const MAX = 3;
        const PER_ORG = 2;
        const one = build(MAX, PER_ORG);
        const two = build(MAX, PER_ORG);
        const repo = db.dataSource.getRepository(Scan);
        const base = Date.now();
        const rows = await repo.save(
          [
            ...Array.from({ length: 6 }, (_, i) => [ORG_A, i] as const),
            ...Array.from({ length: 3 }, (_, i) => [ORG_B, 10 + i] as const),
          ].map(([organizationId, i]) => ({
            id: randomUUID(),
            name: 'replicas',
            state: 'queued',
            language: [],
            projectId: randomUUID(),
            organizationId,
            scanType: 'iac,secret',
            createAt: new Date(base + i * 1000),
          })),
        );
        const ids = rows.map((r) => r.id);
        const idsOf = (org: string) =>
          rows.filter((r) => r.organizationId === org).map((r) => r.id);
        const before = launched.length;
        const ended: string[] = [];

        const check = async () => {
          const mine = launched.slice(before);
          // no scan launched twice
          expect(new Set(mine).size).toBe(mine.length);
          const running = await countOf(ids, 'running');
          expect(running).toBeLessThanOrEqual(MAX);
          expect(await countOf(idsOf(ORG_A), 'running')).toBeLessThanOrEqual(
            PER_ORG,
          );
          expect(await countOf(idsOf(ORG_B), 'running')).toBeLessThanOrEqual(
            PER_ORG,
          );
          // none lost: every scan is queued, running (launched) or ended
          expect(running + ended.length).toBe(mine.length);
          expect(running + (await countOf(ids, 'queued')) + ended.length).toBe(
            rows.length,
          );
        };

        for (let step = 0; step < 60 && ended.length < rows.length; step++) {
          await Promise.all([one.queue.tick(), two.queue.tick()]);
          await check();
          const running = await repo.find({
            where: { id: In(ids), state: 'running' },
            order: { createAt: 'ASC' },
          });
          if (running.length > 0) {
            await repo.update({ id: running[0].id }, { state: 'completed' });
            ended.push(running[0].id);
          }
        }
        expect(ended.length).toBe(rows.length);
        expect(new Set(launched.slice(before))).toEqual(new Set(ids));
      },
    );
  },
);
