import { Logger } from '@nestjs/common';
import { In, Not } from 'typeorm';
import type { ConfigService } from '@nestjs/config';
import type { ProjectScanSettings } from '@grpc/security-scanning/scan';
import { Container } from 'src/entities/container.entity';
import { Scan } from 'src/entities/scan.entity';
import { Scanner } from 'src/entities/scanner.entity';
import { ScanUploadToken } from 'src/entities/scan-upload-token.entity';
import {
  createLiveDatabase,
  liveEnabled,
  LiveDatabase,
} from 'src/core/db/live-database';
import type { FileManagementService } from '../file/file-management.service';
import type { ScanStateManager } from '../scan/core/scanStateManager';
import type { ScanStateStore } from '../scan/core/scanStateStore';
import { ScanUploadTokens } from '../scan/cluster-results/scan-upload-tokens';
import { readClusterScanningConfig } from './cluster-scanning.config';
import type { CommunityKubeClient } from './kube-client';
import {
  COMMUNITY_SCANNER_CATALOGUE,
  CommunityScannerCatalogue,
} from './scanner-catalogue';
import { ClusterPodLauncher } from './cluster-pod-launcher';

/**
 * LIVE proof of the Community pod launcher on BOTH engines
 * (`LIVE_DB_TYPE=mysql|postgres`): with the cloud's scanner rows present
 * (the MySQL track seeds them; seeded here on PostgreSQL), a Community scan's
 * containers are the catalogue's only, inserted with fixed ids, each with
 * one token, then recorded with its pod uid.
 *
 *   SS_CLUSTER_SCAN_LIVE=1 LIVE_DB_TYPE=mysql SS_IMPORT_SCAN_MYSQL_URL=mysql://root:password@127.0.0.1:13308 \
 *     pnpm exec jest --ci --runInBand src/modules/cluster-scanning/cluster-pod-launcher.live.spec.ts
 *   SS_CLUSTER_SCAN_LIVE=1 LIVE_DB_TYPE=postgres DB_TYPE=postgres SS_IMPORT_SCAN_PG_URL=postgres://postgres:postgres@127.0.0.1:15432 \
 *     pnpm exec jest --ci --runInBand src/modules/cluster-scanning/cluster-pod-launcher.live.spec.ts
 */
const describeLive = liveEnabled('SS_CLUSTER_SCAN') ? describe : describe.skip;

const ENV = {
  CYBEDEFEND_SCANNER_KUBECONFIG_FILE: '/run/k',
  CYBEDEFEND_SCANNER_NAMESPACE: 'scans',
  FRONTEND_URL: 'https://a.example',
};

/** The cloud's scanner rows, enabled, of every type a Community scan asks. */
const CLOUD_ROWS: Partial<Scanner>[] = [
  ['scanlink-sast-opengrep', 'sast'],
  ['scanlink-sast-bearer', 'sast'],
  ['scanlink-iac-checkov', 'iac'],
  ['scanlink-iac-kics', 'iac'],
  ['scanlink-sca', 'sca'],
  ['scanlink-secret-gitleaks', 'secret'],
  ['scanlink-container', 'container'],
  ['scanlink-aibom', 'aibom'],
].map(([name, scannerType], i) => ({
  id: `00000000-0000-4000-8000-00000000aa0${i}`,
  name,
  imageName: name,
  enabled: true,
  scannerType: scannerType as Scanner['scannerType'],
}));

describeLive('Community pod launcher on a real database', () => {
  jest.setTimeout(300_000);

  let db: LiveDatabase;

  beforeAll(async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    process.env.SS_CLUSTER_SCAN_MYSQL_URL ??=
      process.env.SS_IMPORT_SCAN_MYSQL_URL;
    process.env.SS_CLUSTER_SCAN_PG_URL ??= process.env.SS_IMPORT_SCAN_PG_URL;
    db = await createLiveDatabase({
      prefix: 'ss_cluster_launcher',
      envPrefix: 'SS_CLUSTER_SCAN',
    });
  });

  afterAll(async () => {
    await db?.drop();
    jest.restoreAllMocks();
  });

  it('cloud scanner rows never become containers of a Community scan', async () => {
    const scanners = db.dataSource.getRepository(Scanner);
    const catalogueIds = COMMUNITY_SCANNER_CATALOGUE.map((e) => e.id);
    if (
      (await scanners.count({ where: { id: Not(In(catalogueIds)) } })) === 0
    ) {
      await scanners.insert(CLOUD_ROWS);
    }
    const config = readClusterScanningConfig(ENV);
    await new CommunityScannerCatalogue(scanners, config).seed();
    const cloudRows = await scanners.count({
      where: { id: Not(In(catalogueIds)), enabled: true },
    });
    expect(cloudRows).toBeGreaterThan(0);

    const scan = await db.dataSource.getRepository(Scan).save({
      name: 'community-scan',
      language: [],
      projectId: 'p1',
      organizationId: 'o1',
      state: 'running',
      branch: 'main',
    });

    let uid = 0;
    const kube = {
      reviewAccess: jest.fn(),
      createSecret: jest.fn(async () => undefined),
      deleteSecret: jest.fn(async () => undefined),
      createPod: jest.fn(async () => ({ uid: `uid-${++uid}` })),
      readPod: jest.fn(),
      listManagedPods: jest.fn(),
      deletePod: jest.fn(async () => undefined),
    } as unknown as CommunityKubeClient;
    const launcher = new ClusterPodLauncher(
      db.dataSource.getRepository(Container),
      {} as ScanStateStore,
      {} as ScanStateManager,
      {
        getExternalDownloadUrl: async () => 'https://s.example/a.zip?sig=x',
      } as unknown as FileManagementService,
      new ScanUploadTokens(db.dataSource.getRepository(ScanUploadToken)),
      kube,
      config,
      { get: () => undefined } as unknown as ConfigService,
    );

    const pods = await launcher.launch(scan, {
      enabledScanTypes: ['sast', 'iac', 'sca', 'secret', 'aibom'],
      vulnerabilityTypesByScan: { sast: 'HIGH' },
    } as unknown as ProjectScanSettings);
    expect(pods).toBe(5);

    const rows = await db.dataSource.getRepository(Container).find({
      where: { scanId: scan.id },
      relations: { scanner: true },
      order: { podName: 'ASC' },
    });
    expect(rows).toHaveLength(5);
    for (const row of rows) {
      expect(catalogueIds).toContain(row.scanner.id);
      expect(row.image).toMatch(/^cybedefend-scanners\/[a-z-]+:1\.0\.0$/);
      expect(row.podName).toBe(
        `cd-scan-${row.image.split(':')[0].replace('cybedefend-scanners/', '')}-${row.id}`,
      );
      expect(row.status).toBe('starting');
      expect(row.podUid).toMatch(/^uid-\d$/);
      expect(row.startedAt).toBeInstanceOf(Date);
    }

    const tokens = await db.dataSource
      .getRepository(ScanUploadToken)
      .find({ where: { scanId: scan.id } });
    expect(tokens.map((t) => t.containerId).sort()).toEqual(
      rows.map((r) => r.id).sort(),
    );
    const byContainer = new Map(tokens.map((t) => [t.containerId, t]));
    const opengrep = rows.find((r) => r.podName.startsWith('cd-scan-opengrep'));
    expect(byContainer.get(opengrep.id)).toMatchObject({
      category: 'sast',
      severities: 'high',
    });
    const zizmor = rows.find((r) => r.podName.startsWith('cd-scan-zizmor'));
    expect(byContainer.get(zizmor.id).category).toBe('cicd');
  });
});
