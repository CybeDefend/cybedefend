import { randomUUID } from 'crypto';
import { DataSource, In, Repository } from 'typeorm';

import { Container } from 'src/entities/container.entity';
import { Scan } from 'src/entities/scan.entity';
import { Scanner } from 'src/entities/scanner.entity';
import {
  createLiveDatabase,
  liveDialect,
  liveEnabled,
  LiveDatabase,
} from 'src/core/db/live-database';
import { insertScannerContainers } from './insert-scanner-containers';

/**
 * LIVE proof for the shared container insert, on BOTH engines
 * (`LIVE_DB_TYPE=mysql|postgres`): a multi-row INSERT of scanner containers
 * whose ids the caller set must leave each entity on its own id. TypeORM's
 * read-back after a multi-row INSERT (no ORDER BY) merges the rows into the
 * entities by position, ids included, unless `updateEntity(false)`; with 3
 * rows the order comes back right one time in six, hence several runs.
 *
 * Skipped unless `SS_CLUSTER_SCAN_LIVE=1`. The throwaway database reuses the
 * import specs' URLs (`SS_IMPORT_SCAN_MYSQL_URL` / `SS_IMPORT_SCAN_PG_URL`).
 *
 *   SS_CLUSTER_SCAN_LIVE=1 LIVE_DB_TYPE=mysql SS_IMPORT_SCAN_MYSQL_URL=mysql://root:password@127.0.0.1:13308 \
 *     pnpm exec jest --ci --runInBand src/modules/scan/core/insert-scanner-containers.live.spec.ts
 *   SS_CLUSTER_SCAN_LIVE=1 LIVE_DB_TYPE=postgres SS_IMPORT_SCAN_PG_URL=postgres://postgres:postgres@127.0.0.1:15432 \
 *     pnpm exec jest --ci --runInBand src/modules/scan/core/insert-scanner-containers.live.spec.ts
 */
const describeLive = liveEnabled('SS_CLUSTER_SCAN') ? describe : describe.skip;

describeLive('insertScannerContainers on a real database', () => {
  jest.setTimeout(300_000);

  let db: LiveDatabase;
  let dataSource: DataSource;
  const containers = (): Repository<Container> =>
    dataSource.getRepository(Container);

  beforeAll(async () => {
    db = await createLiveDatabase({
      prefix: 'ss_insert_containers',
      envPrefix: 'SS_IMPORT_SCAN',
      dialect: liveDialect(),
    });
    dataSource = db.dataSource;
  });

  afterAll(async () => {
    await db?.drop();
  });

  it('keeps each row on its own id after a three-row insert', async () => {
    const scanners = await dataSource.getRepository(Scanner).save(
      ['sast', 'iac', 'secret'].map((scannerType) => ({
        name: `live-${scannerType}-${randomUUID().slice(0, 8)}`,
        imageName: `live-${scannerType}`,
        enabled: true,
        scannerType: scannerType as Scanner['scannerType'],
      })),
    );

    for (let run = 0; run < 5; run += 1) {
      const scan = await dataSource.getRepository(Scan).save({
        name: `live-${run}`,
        state: 'running',
        language: ['python'],
        projectId: 'p-insert-live',
        organizationId: 'o-insert-live',
        scanType: 'sast,iac,secret',
        branch: 'main',
      });
      const rows = scanners.map((scanner) =>
        containers().create({
          id: randomUUID(),
          podName: `pod-${scanner.scannerType}-${randomUUID()}`,
          image: scanner.imageName,
          status: 'starting',
          scanId: scan.id,
          scanner,
        }),
      );
      const before = rows.map((row) => ({ id: row.id, podName: row.podName }));

      await insertScannerContainers(containers(), rows);

      // The entities kept the ids the caller set (no positional merge)...
      expect(rows.map((row) => ({ id: row.id, podName: row.podName }))).toEqual(
        before,
      );
      // ...and each stored row carries the pod of the entity with its id.
      const stored = await containers().find({
        where: { id: In(before.map((row) => row.id)) },
        relations: ['scanner'],
      });
      expect(stored).toHaveLength(3);
      for (const expected of before) {
        const row = stored.find((s) => s.id === expected.id);
        expect(row?.podName).toBe(expected.podName);
        expect(row?.scanId).toBe(scan.id);
        expect(row?.scanner?.id).toBe(
          rows.find((r) => r.id === expected.id)?.scanner.id,
        );
      }
    }
  });
});
