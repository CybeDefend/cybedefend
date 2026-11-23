/**
 * The environment parsing of the two-engine live helper, without any
 * database: `liveEnabled` / `liveDialect` / `liveUrl` are pure functions of
 * the environment, and `createLiveDatabase` must reject a dialect mismatch or
 * a missing PostgreSQL baseline BEFORE opening a connection (the URLs below
 * point at 127.0.0.1:1, so a connection attempt would fail with
 * ECONNREFUSED, not with the expected error).
 */

describe('live helper environment', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { liveEnabled, liveDialect, liveUrl } = require('./live-database') as {
    liveEnabled: (p: string, env?: NodeJS.ProcessEnv) => boolean;
    liveDialect: (p?: string, env?: NodeJS.ProcessEnv) => 'mysql' | 'postgres';
    liveUrl: (
      p: string,
      d: 'mysql' | 'postgres',
      env?: NodeJS.ProcessEnv,
    ) => string;
  };

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
      const { createLiveDatabase } = require('./live-database') as {
        createLiveDatabase: (opts: {
          prefix: string;
          envPrefix: string;
        }) => Promise<unknown>;
      };
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
      const { createLiveDatabase } = require('./live-database') as {
        createLiveDatabase: (opts: {
          prefix: string;
          envPrefix: string;
        }) => Promise<unknown>;
      };
      // src/core/migrations-postgres/ holds the baseline: the folder is
      // read empty here, and the helper must refuse before creating
      // anything.
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
      const { createLiveDatabase } = require('./live-database') as {
        createLiveDatabase: (opts: {
          prefix: string;
          envPrefix: string;
          entities?: unknown[];
          dialect?: 'mysql' | 'postgres';
          migrations?: 'track' | 'none';
        }) => Promise<unknown>;
      };
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
});

describe('live helper entities', () => {
  // A non-entity file next to the entities (src/entities/performance-indexes.spec.ts)
  // must never be loaded: TypeORM requires every file its glob matches, and a
  // spec file then registers its tests inside another suite after it started.
  it('the default entity glob matches entity files only', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { globSync } = require('node:fs') as {
      globSync: (pattern: string) => string[];
    };
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { LIVE_ENTITIES_GLOB } = require('./typeorm-options') as {
      LIVE_ENTITIES_GLOB: string;
    };
    const files = globSync(LIVE_ENTITIES_GLOB);
    expect(files.some((f) => f.endsWith('organization.entity.ts'))).toBe(true);
    expect(files.filter((f) => !/\.entity\.(ts|js)$/.test(f))).toEqual([]);
  });
});

// A real database on the engine LIVE_DB_TYPE selects (default mysql), with the
// service's entities, built by its migration track:
//   ORG_DELETION_CODE_LIVE=1 LIVE_DB_TYPE=postgres \
//   ORG_DELETION_CODE_PG_URL=postgres://postgres:postgres@127.0.0.1:5432 \
//   pnpm exec jest --ci --runInBand --testPathPatterns=live-database.spec
const describeLive =
  process.env.ORG_DELETION_CODE_LIVE === '1' ? describe : describe.skip;

describeLive('live helper on a real database', () => {
  it('opens a database built by the migration track of its engine', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createLiveDatabase } = require('./live-database') as {
      createLiveDatabase: (opts: {
        prefix: string;
        envPrefix: string;
      }) => Promise<{
        dataSource: import('typeorm').DataSource;
        dialect: 'mysql' | 'postgres';
        drop: () => Promise<void>;
      }>;
    };
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { POSTGRES_BASELINE_AT } = require('./migration-tracks') as {
      POSTGRES_BASELINE_AT: number;
    };
    const db = await createLiveDatabase({
      prefix: 'gm_helper',
      envPrefix: 'ORG_DELETION_CODE',
    });
    try {
      const executed = await db.dataSource.query(
        'SELECT name FROM migrations ORDER BY id',
      );
      const names = (executed as Array<{ name: string }>).map((r) => r.name);
      if (db.dialect === 'postgres') {
        expect(names).toEqual([`PostgresBaseline${POSTGRES_BASELINE_AT}`]);
      } else {
        expect(names).toContain('CreateOrganizationDeletionCode1786200000000');
      }
      // The entities load on that engine and read the migrated tables.
      await expect(
        db.dataSource.getRepository('Organization').count(),
      ).resolves.toBe(0);
    } finally {
      await db.drop();
    }
  }, 300_000);
});
