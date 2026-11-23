import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Logger } from 'nestjs-pino';
import { DataSource, QueryDeepPartialEntity } from 'typeorm';
import { Scan } from 'src/entities/scan.entity';
import { Container } from 'src/entities/container.entity';
import { Scanner } from 'src/entities/scanner.entity';
import { SupportedLanguage } from 'src/entities/supported-language.entity';
import {
  createLiveDatabase,
  liveEnabled,
  LiveDatabase,
} from 'src/core/db/live-database';
import { deleteBatchFor } from './batched-delete';

/**
 * LIVE proof of the batched purge delete on BOTH engines
 * (`LIVE_DB_TYPE=mysql|postgres`, default mysql): `deleteBatchFor` removes at
 * most `limit` rows of one project per call — 2 500 rows with a limit of 1 000
 * go 1 000, 1 000, 500, then 0 — and never touches another project's rows.
 * The old `DELETE … LIMIT ?` is MySQL-only; on PostgreSQL the batch goes
 * through the `ctid` sub-select of libs/db-dialect.
 *
 * Skipped unless `SS_PURGE_LIVE=1` (the legacy `SS_PURGE_MYSQL_LIVE=1` pins
 * mysql), so `pnpm run test` stays hermetic. The throwaway database is created
 * by `createLiveDatabase`, its schema built by the service's real migrations
 * on the selected engine, and it is dropped at the end.
 *
 * How to run:
 *   SS_PURGE_LIVE=1 LIVE_DB_TYPE=postgres SS_PURGE_PG_URL=postgres://postgres:postgres@127.0.0.1:15432 \
 *     pnpm exec jest --testPathPatterns=batched-delete.live --runInBand
 *   SS_PURGE_LIVE=1 LIVE_DB_TYPE=mysql SS_PURGE_MYSQL_URL=mysql://root:password@127.0.0.1:13308 \
 *     pnpm exec jest --testPathPatterns=batched-delete.live --runInBand
 */
const describeLive = liveEnabled('SS_PURGE') ? describe : describe.skip;

const PROJECT_A = '11111111-1111-4111-8111-111111111111';
const PROJECT_B = '22222222-2222-4222-8222-222222222222';

describeLive('deleteBatchFor on a real database', () => {
  jest.setTimeout(180_000);

  let db: LiveDatabase;
  let dataSource: DataSource;

  const seed = (projectId: string, count: number) => {
    const repo = dataSource.getRepository(Scan);
    const row = (i: number): QueryDeepPartialEntity<Scan> => ({
      name: `purge-${i}`,
      state: 'completed',
      language: ['python'],
      projectId,
      organizationId: 'org-purge',
    });
    return (async () => {
      for (let chunk = 0; chunk < count; chunk += 500) {
        const size = Math.min(500, count - chunk);
        await repo
          .createQueryBuilder()
          .insert()
          .values(Array.from({ length: size }, (_, i) => row(chunk + i)))
          .execute();
      }
    })();
  };

  beforeAll(async () => {
    db = await createLiveDatabase({
      prefix: 'ss_purge',
      envPrefix: 'SS_PURGE',
    });
    dataSource = db.dataSource;

    // Touch the entities through a compiled module, so a missing repository
    // token fails here rather than inside the test.
    await Test.createTestingModule({
      providers: [
        ...[Scan, Container, Scanner, SupportedLanguage].map((entity) => ({
          provide: getRepositoryToken(entity),
          useValue: dataSource.getRepository(entity),
        })),
        { provide: Logger, useValue: { log: jest.fn(), warn: jest.fn() } },
      ],
    })
      .useMocker(() => ({}))
      .compile();
  });

  afterAll(async () => {
    await db?.drop();
  });

  it('deletes 2 500 rows of one project in batches of 1 000, then 0, and leaves the other project alone', async () => {
    await seed(PROJECT_A, 2_500);
    await seed(PROJECT_B, 3);

    expect(
      await deleteBatchFor(dataSource, 'scan', 'projectId', PROJECT_A, 1000),
    ).toBe(1000);
    expect(
      await deleteBatchFor(dataSource, 'scan', 'projectId', PROJECT_A, 1000),
    ).toBe(1000);
    expect(
      await deleteBatchFor(dataSource, 'scan', 'projectId', PROJECT_A, 1000),
    ).toBe(500);
    expect(
      await deleteBatchFor(dataSource, 'scan', 'projectId', PROJECT_A, 1000),
    ).toBe(0);

    const repo = dataSource.getRepository(Scan);
    expect(await repo.countBy({ projectId: PROJECT_A })).toBe(0);
    expect(await repo.countBy({ projectId: PROJECT_B })).toBe(3);
  });
});
