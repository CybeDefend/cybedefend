import { In } from 'typeorm';
import { Scanner } from 'src/entities/scanner.entity';
import {
  createLiveDatabase,
  liveEnabled,
  LiveDatabase,
} from 'src/core/db/live-database';
import { readClusterScanningConfig } from './cluster-scanning.config';
import {
  COMMUNITY_SCANNER_CATALOGUE,
  CommunityScannerCatalogue,
} from './scanner-catalogue';

/**
 * LIVE proof of the Community scanner seed on BOTH engines
 * (`LIVE_DB_TYPE=mysql|postgres`): two seeds at once leave exactly the five
 * rows, and a later seed updates the resources in place. The rows a
 * migration track already holds (the MySQL track seeds the cloud's scanners)
 * are left as they are.
 *
 * Skipped unless `SS_CLUSTER_SCAN_LIVE=1`. The server is
 * `SS_CLUSTER_SCAN_MYSQL_URL` / `SS_CLUSTER_SCAN_PG_URL`, else the import
 * spec's `SS_IMPORT_SCAN_MYSQL_URL` / `SS_IMPORT_SCAN_PG_URL`.
 *
 *   SS_CLUSTER_SCAN_LIVE=1 LIVE_DB_TYPE=mysql SS_IMPORT_SCAN_MYSQL_URL=mysql://root:password@127.0.0.1:13308 \
 *     pnpm exec jest --ci --runInBand src/modules/cluster-scanning/scanner-catalogue.live.spec.ts
 *   SS_CLUSTER_SCAN_LIVE=1 LIVE_DB_TYPE=postgres SS_IMPORT_SCAN_PG_URL=postgres://postgres:postgres@127.0.0.1:15432 \
 *     pnpm exec jest --ci --runInBand src/modules/cluster-scanning/scanner-catalogue.live.spec.ts
 */
const describeLive = liveEnabled('SS_CLUSTER_SCAN') ? describe : describe.skip;

const BASE = {
  CYBEDEFEND_SCANNER_KUBECONFIG_FILE: '/run/k',
  CYBEDEFEND_SCANNER_NAMESPACE: 'scans',
  FRONTEND_URL: 'https://a.example',
};

describeLive('Community scanner seed on a real database', () => {
  jest.setTimeout(300_000);

  let db: LiveDatabase;

  beforeAll(async () => {
    process.env.SS_CLUSTER_SCAN_MYSQL_URL ??=
      process.env.SS_IMPORT_SCAN_MYSQL_URL;
    process.env.SS_CLUSTER_SCAN_PG_URL ??= process.env.SS_IMPORT_SCAN_PG_URL;
    db = await createLiveDatabase({
      prefix: 'ss_cluster_catalogue',
      envPrefix: 'SS_CLUSTER_SCAN',
    });
  });

  afterAll(async () => {
    await db?.drop();
  });

  it('seed twice, concurrently: five rows, resources updated on the second run', async () => {
    const repo = db.dataSource.getRepository(Scanner);
    const ids = COMMUNITY_SCANNER_CATALOGUE.map((e) => e.id);
    const catalogueRows = () =>
      repo.find({ where: { id: In(ids) }, order: { id: 'ASC' } });
    const others = await repo.find({ order: { id: 'ASC' } });
    const first = new CommunityScannerCatalogue(
      repo,
      readClusterScanningConfig(BASE),
    );

    await Promise.all([first.seed(), first.seed()]);

    const seeded = await catalogueRows();
    expect(seeded.map((s) => s.id)).toEqual(ids);
    expect(await repo.count()).toBe(others.length + 5);
    expect(seeded.map((s) => [s.name, s.imageName, s.scannerType])).toEqual([
      [
        'cybedefend-scanners/opengrep',
        'cybedefend-scanners/opengrep:1.0.0',
        'sast',
      ],
      [
        'cybedefend-scanners/zizmor',
        'cybedefend-scanners/zizmor:1.0.0',
        'sast',
      ],
      [
        'cybedefend-scanners/gitleaks',
        'cybedefend-scanners/gitleaks:1.0.0',
        'secret',
      ],
      [
        'cybedefend-scanners/trivy-config',
        'cybedefend-scanners/trivy-config:1.0.0',
        'iac',
      ],
      [
        'cybedefend-scanners/trivy-fs',
        'cybedefend-scanners/trivy-fs:1.0.0',
        'sca',
      ],
    ]);
    expect(seeded.every((s) => s.enabled && s.deletePodsOnFinish)).toBe(true);
    expect(seeded[0].memoryLimit).toBe('2Gi');

    await new CommunityScannerCatalogue(
      repo,
      readClusterScanningConfig({
        ...BASE,
        CYBEDEFEND_SCANNER_IMAGE_TAG: '1.1.0',
        CYBEDEFEND_SCANNER_KEEP_PODS: 'true',
        CYBEDEFEND_SCANNER_RESOURCES: JSON.stringify({
          opengrep: { memoryLimit: '6Gi', cpuLimit: '2' },
        }),
      }),
    ).seed();

    const updated = await catalogueRows();
    expect(updated).toHaveLength(5);
    expect(await repo.count()).toBe(others.length + 5);
    expect(
      await repo.find({
        where: { id: In(others.map((o) => o.id)) },
        order: { id: 'ASC' },
      }),
    ).toEqual(others);
    expect(updated[0]).toMatchObject({
      imageName: 'cybedefend-scanners/opengrep:1.1.0',
      memoryLimit: '6Gi',
      cpuLimit: '2',
      deletePodsOnFinish: false,
      deletePodsOnError: false,
    });
    expect(updated[1].memoryLimit).toBe('512Mi');
  });
});
