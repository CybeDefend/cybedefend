import { OrganizationStatisticsRepository } from './organization-statistics.repository';

// `run` calls through to the real one; one test makes it answer a shape the
// real one never returns.
jest.mock('@cybedefend/db-dialect', () => {
  const actual = jest.requireActual('@cybedefend/db-dialect');
  return { ...actual, run: jest.fn((...args) => actual.run(...args)) };
});
// eslint-disable-next-line @typescript-eslint/no-require-imports
const dbDialect = require('@cybedefend/db-dialect') as { run: jest.Mock };

/**
 * A repository whose DataSource hands out one fake query runner, answering
 * like TypeORM's structured result: `affected` is the rows the UPDATE matched.
 */
function makeRepo(affected: number) {
  const runnerQuery = jest.fn(async () => ({ records: [], affected }));
  const runner = {
    connect: jest.fn(async () => undefined),
    query: runnerQuery,
    release: jest.fn(async () => undefined),
  };
  const query = jest.fn(async () => []);
  const repo = new OrganizationStatisticsRepository({
    query,
    manager: { connection: { createQueryRunner: () => runner } },
  } as any);
  return { repo, query, runnerQuery, runner };
}

describe('OrganizationStatisticsRepository.markDirtyIfPresent', () => {
  it('updates only, never inserts, and reports a row it marked', async () => {
    const { repo, runnerQuery, runner } = makeRepo(1);

    expect(await repo.markDirtyIfPresent('org-1')).toBe(true);

    const [sql, params, structured] = runnerQuery.mock.calls[0] as unknown as [
      string,
      unknown[],
      boolean,
    ];
    expect(sql.trim().startsWith('UPDATE organization_statistics')).toBe(true);
    expect(sql).not.toContain('INSERT');
    expect(sql).toContain('WHERE organization_id = ?');
    expect(params).toEqual(['org-1']);
    expect(structured).toBe(true);
    expect(runner.release).toHaveBeenCalledTimes(1);
  });

  it('reports false when the organization has no row', async () => {
    const { repo } = makeRepo(0);
    expect(await repo.markDirtyIfPresent('org-1')).toBe(false);
  });

  it('throws on an unknown result shape instead of guessing', async () => {
    const { repo } = makeRepo(1);
    dbDialect.run.mockResolvedValueOnce({ rows: [], affected: undefined });
    await expect(repo.markDirtyIfPresent('org-1')).rejects.toThrow(
      'organization_statistics UPDATE: unknown result shape',
    );
  });
});

describe('OrganizationStatisticsRepository on MySQL keeps its statements', () => {
  it('markDirty is one upsert keyed by the organization, on the DB clock', async () => {
    const { repo, query } = makeRepo(1);
    await repo.markDirty('org-1');
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql.replace(/\s+/g, ' ')).toBe(
      'INSERT INTO `organization_statistics` (`organization_id`, `last_event_at`, `dirty_since`) ' +
        'VALUES (?, NOW(3), NOW(3)) ON DUPLICATE KEY UPDATE `last_event_at` = NOW(3), ' +
        '`dirty_since` = COALESCE(`organization_statistics`.`dirty_since`, NOW(3))',
    );
    expect(params).toEqual(['org-1']);
  });

  it('saveInitial upserts the payload and the compute time', async () => {
    const { repo, query } = makeRepo(1);
    await repo.saveInitial('org-1', { a: 1 });
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql.replace(/\s+/g, ' ')).toBe(
      'INSERT INTO `organization_statistics` (`organization_id`, `stats`, `computed_at`) ' +
        'VALUES (?, ?, NOW(3)) ON DUPLICATE KEY UPDATE `stats` = VALUES(`stats`), `computed_at` = NOW(3)',
    );
    expect(params).toEqual(['org-1', '{"a":1}']);
  });

  it('readTimings reads its camelCase aliases back quoted', async () => {
    const { repo, query } = makeRepo(1);
    query.mockResolvedValueOnce([
      {
        computedAt: '2026-11-03T10:00:00.000Z',
        lastEventAt: null,
        dirtySince: null,
        dbNow: '2026-11-03T10:00:01.000Z',
      },
    ]);
    const timings = await repo.readTimings('org-1');
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    const flat = sql.replace(/\s+/g, ' ');
    expect(flat).toContain('computed_at AS `computedAt`');
    expect(flat).toContain('NOW(3) AS `dbNow`');
    expect(flat).toContain('WHERE organization_id = ?');
    expect(params).toEqual(['org-1']);
    expect(timings).toEqual({
      now: Date.parse('2026-11-03T10:00:01.000Z'),
      computedAt: Date.parse('2026-11-03T10:00:00.000Z'),
      lastEventAt: 0,
      dirtySince: 0,
    });
  });
});

describe('OrganizationStatisticsRepository on PostgreSQL', () => {
  const onPostgres = <T>(
    fn: (Repo: typeof OrganizationStatisticsRepository) => T,
  ): T => {
    const previous = process.env.DB_TYPE;
    process.env.DB_TYPE = 'postgres';
    try {
      let out: T;
      jest.isolateModules(() => {
        jest.unmock('@cybedefend/db-dialect');
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const mod = require('./organization-statistics.repository') as {
          OrganizationStatisticsRepository: typeof OrganizationStatisticsRepository;
        };
        out = fn(mod.OrganizationStatisticsRepository);
      });
      return out;
    } finally {
      if (previous === undefined) delete process.env.DB_TYPE;
      else process.env.DB_TYPE = previous;
    }
  };

  it('markDirty names its conflict column and keeps dirty_since once set', async () => {
    const query = jest.fn(async () => []);
    await onPostgres((Repo) => new Repo({ query } as any).markDirty('org-1'));
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql.replace(/\s+/g, ' ')).toBe(
      'INSERT INTO "organization_statistics" ("organization_id", "last_event_at", "dirty_since") ' +
        'VALUES ($1, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)) ON CONFLICT ("organization_id") ' +
        'DO UPDATE SET "last_event_at" = CURRENT_TIMESTAMP(3), ' +
        '"dirty_since" = COALESCE("organization_statistics"."dirty_since", CURRENT_TIMESTAMP(3))',
    );
    expect(params).toEqual(['org-1']);
  });

  it('saveInitial takes the new payload from EXCLUDED', async () => {
    const query = jest.fn(async () => []);
    await onPostgres((Repo) =>
      new Repo({ query } as any).saveInitial('org-1', { a: 1 }),
    );
    const [sql] = query.mock.calls[0] as unknown as [string];
    expect(sql).toContain('ON CONFLICT ("organization_id") DO UPDATE SET');
    expect(sql).toContain('"stats" = EXCLUDED."stats"');
    expect(sql).not.toContain('VALUES(');
  });
});
