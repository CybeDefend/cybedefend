import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The environment parsing of the two-engine live helper, without any
 * database: `liveEnabled` / `liveDialect` / `liveUrl` are pure functions of
 * the environment, and `createLiveDatabase` must reject a dialect mismatch or
 * a missing PostgreSQL baseline BEFORE opening a connection (the URLs below
 * point at 127.0.0.1:1, so a connection attempt would fail with
 * ECONNREFUSED, not with the expected error).
 */

type LiveModule = typeof import('./live-database');

describe('live helper environment', () => {
  const { liveEnabled, liveDialect, liveUrl } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('./live-database') as LiveModule;

  it('liveEnabled accepts <p>_LIVE=1 and the legacy <p>_MYSQL_LIVE=1', () => {
    expect(liveEnabled('X', { X_LIVE: '1' })).toBe(true);
    expect(liveEnabled('X', { X_MYSQL_LIVE: '1' })).toBe(true);
    expect(liveEnabled('X', {})).toBe(false);
    expect(liveEnabled('X', { X_LIVE: '0' })).toBe(false);
  });

  it('liveDialect: the legacy flag forces mysql, otherwise LIVE_DB_TYPE decides', () => {
    expect(
      liveDialect('X', { X_MYSQL_LIVE: '1', LIVE_DB_TYPE: 'postgres' }),
    ).toBe('mysql');
    expect(liveDialect('X', { LIVE_DB_TYPE: 'postgres' })).toBe('postgres');
    expect(liveDialect('X', {})).toBe('mysql');
  });

  it('liveUrl reads <p>_MYSQL_URL / <p>_PG_URL, else the defaults', () => {
    expect(liveUrl('X', 'postgres', {})).toBe(
      'postgres://postgres:postgres@127.0.0.1:5432',
    );
    expect(liveUrl('X', 'mysql', {})).toBe(
      'mysql://root:password@127.0.0.1:3308',
    );
    expect(liveUrl('X', 'mysql', { X_MYSQL_URL: 'mysql://a@b:1' })).toBe(
      'mysql://a@b:1',
    );
    expect(liveUrl('X', 'postgres', { X_PG_URL: 'postgres://a@b:1' })).toBe(
      'postgres://a@b:1',
    );
  });

  it('createLiveDatabase rejects LIVE_DIALECT_MISMATCH before connecting', async () => {
    const saved = { ...process.env };
    await jest.isolateModulesAsync(async () => {
      delete process.env.DB_TYPE;
      process.env.LIVE_DB_TYPE = 'postgres';
      process.env.X_PG_URL = 'postgres://postgres:postgres@127.0.0.1:1';
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { createLiveDatabase } = require('./live-database') as LiveModule;
      await expect(
        createLiveDatabase({ prefix: 'p', envPrefix: 'X' }),
      ).rejects.toThrow('LIVE_DIALECT_MISMATCH');
    });
    process.env = saved;
  });

  it('createLiveDatabase rejects LIVE_POSTGRES_BASELINE_MISSING before connecting', async () => {
    const saved = { ...process.env };
    await jest.isolateModulesAsync(async () => {
      process.env.DB_TYPE = 'postgres';
      process.env.LIVE_DB_TYPE = 'postgres';
      process.env.X_PG_URL = 'postgres://postgres:postgres@127.0.0.1:1';
      jest.doMock('node:fs', () => ({
        ...jest.requireActual<typeof import('node:fs')>('node:fs'),
        readdirSync: () => [],
      }));
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { createLiveDatabase } = require('./live-database') as LiveModule;
      // src/core/migrations-postgres/ holds the baseline: the folder is read
      // empty here, as it was before the baseline existed, and the
      // helper must refuse before creating anything.
      await expect(
        createLiveDatabase({ prefix: 'p', envPrefix: 'X' }),
      ).rejects.toThrow('LIVE_POSTGRES_BASELINE_MISSING');
    });
    process.env = saved;
  });

  // The schema-parity spec opens one database per engine in one process, with
  // no entity: the decorators' dialect (DB_TYPE) does not matter then.
  it('createLiveDatabase skips LIVE_DIALECT_MISMATCH when entities is [] and takes an explicit dialect', async () => {
    const saved = { ...process.env };
    await jest.isolateModulesAsync(async () => {
      delete process.env.DB_TYPE;
      delete process.env.LIVE_DB_TYPE;
      process.env.X_PG_URL = 'postgres://postgres:postgres@127.0.0.1:1';
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { createLiveDatabase } = require('./live-database') as LiveModule;
      // Past the checks, the helper connects to the PostgreSQL URL (port 1).
      await expect(
        createLiveDatabase({
          prefix: 'p',
          envPrefix: 'X',
          entities: [],
          dialect: 'postgres',
          migrations: 'none',
        }),
      ).rejects.toThrow(/ECONNREFUSED/);
      // With entities, the mismatch is still refused.
      await expect(
        createLiveDatabase({
          prefix: 'p',
          envPrefix: 'X',
          dialect: 'postgres',
          migrations: 'none',
        }),
      ).rejects.toThrow('LIVE_DIALECT_MISMATCH');
    });
    process.env = saved;
  });

  it('LIVE_DB_TYPE reaches DB_TYPE through the Jest setup file', () => {
    const pkg = JSON.parse(
      readFileSync(join(__dirname, '../../../package.json'), 'utf8'),
    ) as { jest: { setupFiles?: string[] } };
    expect(pkg.jest.setupFiles).toContain(
      '<rootDir>/core/db/jest.live-dialect.setup.ts',
    );
  });
});

describe('live helper entities', () => {
  // A non-entity file next to the entities (src/entities/*.entity.spec.ts,
  // src/entities/*-columns.spec.ts) must never be loaded: TypeORM requires
  // every file its glob matches, and a spec file then registers its tests
  // inside another suite after it started. Nor may an src/ee/ entity.
  it('the default entity glob matches the core entity files only', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { globSync } = require('node:fs') as {
      globSync: (pattern: string) => string[];
    };
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { LIVE_ENTITIES_GLOB } = require('./typeorm-options') as {
      LIVE_ENTITIES_GLOB: string;
    };
    const files = globSync(LIVE_ENTITIES_GLOB);
    expect(files).toHaveLength(32);
    expect(files.some((f) => f.endsWith('vulnerability.entity.ts'))).toBe(true);
    expect(files.filter((f) => !/\.entity\.(ts|js)$/.test(f))).toEqual([]);
    expect(files.filter((f) => f.includes('/ee/'))).toEqual([]);
  });
});

// A real database on the engine LIVE_DB_TYPE selects (default mysql), with the
// 32 core entities, built by the migration track of that engine: every
// entity reads its table (each mapped column must exist).
//   AR_SCHEMA_PARITY_LIVE=1 LIVE_DB_TYPE=postgres \
//   AR_SCHEMA_PARITY_PG_URL=postgres://postgres:postgres@127.0.0.1:5432 \
//   pnpm exec jest --ci --runInBand --testPathPatterns=core/db/live-database.spec
const describeLive =
  process.env.AR_SCHEMA_PARITY_LIVE === '1' ? describe : describe.skip;

describeLive('live helper on a real database', () => {
  it('opens a database built by the migration track of its engine, where every core entity reads its table', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createLiveDatabase } = require('./live-database') as LiveModule;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { POSTGRES_BASELINE_AT } = require('./migration-tracks') as {
      POSTGRES_BASELINE_AT: number;
    };
    const db = await createLiveDatabase({
      prefix: 'ar_helper',
      envPrefix: 'AR_SCHEMA_PARITY',
    });
    try {
      const executed = (await db.dataSource.query(
        'SELECT name FROM migrations ORDER BY id',
      )) as Array<{ name: string }>;
      const names = executed.map((r) => r.name);
      if (db.dialect === 'postgres') {
        // The baseline first; the common migrations (and, outside the
        // Community Edition, the closed ones) run after it.
        expect(names[0]).toBe(`PostgresBaseline${POSTGRES_BASELINE_AT}`);
      } else {
        expect(names).toContain('CreateMcpInventoryTables1845000000000');
      }
      expect(db.dataSource.entityMetadatas).toHaveLength(32);
      for (const metadata of db.dataSource.entityMetadatas) {
        await expect(
          db.dataSource.getRepository(metadata.target).find({ take: 1 }),
        ).resolves.toEqual([]);
      }
    } finally {
      await db.drop();
    }
  }, 600_000);
});
