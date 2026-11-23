import {
  createLiveDatabase,
  liveDialect,
  liveEnabled,
  liveUrl,
} from './live-database';

describe('live-database (no database needed)', () => {
  const savedEnv = process.env;

  afterEach(() => {
    process.env = savedEnv;
  });

  it('liveEnabled accepts <p>_LIVE and the legacy <p>_MYSQL_LIVE', () => {
    expect(liveEnabled('X', { X_LIVE: '1' })).toBe(true);
    expect(liveEnabled('X', { X_MYSQL_LIVE: '1' })).toBe(true);
    expect(liveEnabled('X', {})).toBe(false);
    expect(liveEnabled('X', { X_LIVE: '0' })).toBe(false);
  });

  it('the legacy <p>_MYSQL_LIVE=1 forces the mysql engine', () => {
    expect(
      liveDialect('X', { X_MYSQL_LIVE: '1', LIVE_DB_TYPE: 'postgres' }),
    ).toBe('mysql');
    expect(liveDialect('X', { LIVE_DB_TYPE: 'postgres' })).toBe('postgres');
    expect(liveDialect('X', {})).toBe('mysql');
    expect(liveDialect(undefined, { LIVE_DB_TYPE: 'postgres' })).toBe(
      'postgres',
    );
  });

  it('liveUrl reads the per-engine URL with the CI defaults', () => {
    expect(liveUrl('X', 'postgres', {})).toBe(
      'postgres://postgres:postgres@127.0.0.1:5432',
    );
    expect(liveUrl('X', 'mysql', {})).toBe(
      'mysql://root:password@127.0.0.1:3308',
    );
    expect(liveUrl('X', 'mysql', { X_MYSQL_URL: 'mysql://a@b:1' })).toBe(
      'mysql://a@b:1',
    );
    expect(liveUrl('X', 'postgres', { X_PG_URL: 'postgres://a@b:2' })).toBe(
      'postgres://a@b:2',
    );
  });

  it('rejects LIVE_DIALECT_MISMATCH before connecting', async () => {
    process.env = { ...savedEnv, LIVE_DB_TYPE: 'postgres' };
    delete process.env.DB_TYPE;
    await expect(
      createLiveDatabase({ prefix: 'p', envPrefix: 'X' }),
    ).rejects.toThrow('LIVE_DIALECT_MISMATCH');
  });

  it('rejects LIVE_POSTGRES_BASELINE_MISSING before connecting when the postgres baseline has not landed', async () => {
    await jest.isolateModulesAsync(async () => {
      process.env = {
        ...savedEnv,
        DB_TYPE: 'postgres',
        LIVE_DB_TYPE: 'postgres',
        X_PG_URL: 'postgres://postgres:postgres@127.0.0.1:1',
      };
      jest.doMock('node:fs', () => ({
        ...jest.requireActual<typeof import('node:fs')>('node:fs'),
        readdirSync: () => [],
      }));
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { createLiveDatabase: create } = require('./live-database') as {
        createLiveDatabase: typeof createLiveDatabase;
      };
      // src/core/migrations-postgres/ holds the baseline: the folder is read
      // empty here, and the
      // helper must refuse before creating anything.
      await expect(create({ prefix: 'p', envPrefix: 'X' })).rejects.toThrow(
        'LIVE_POSTGRES_BASELINE_MISSING',
      );
    });
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
