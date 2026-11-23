import {
  createLiveDatabase,
  liveDialect,
  liveEnabled,
  liveUrl,
} from './live-database';

// No database is involved: these tests only exercise the env parsing and the
// two guards that run before any connection is attempted.
describe('live-database helpers', () => {
  afterEach(() => {
    delete process.env.LIVE_DB_TYPE;
    delete process.env.DB_TYPE;
    delete process.env.X_PG_URL;
  });

  it('liveEnabled accepts <prefix>_LIVE and the legacy <prefix>_MYSQL_LIVE', () => {
    expect(liveEnabled('X', { X_LIVE: '1' })).toBe(true);
    expect(liveEnabled('X', { X_MYSQL_LIVE: '1' })).toBe(true);
    expect(liveEnabled('X', {})).toBe(false);
    expect(liveEnabled('X', { X_LIVE: '0' })).toBe(false);
  });

  it('liveDialect: the legacy flag pins mysql, else LIVE_DB_TYPE, default mysql', () => {
    expect(
      liveDialect('X', { X_MYSQL_LIVE: '1', LIVE_DB_TYPE: 'postgres' }),
    ).toBe('mysql');
    expect(liveDialect('X', { LIVE_DB_TYPE: 'postgres' })).toBe('postgres');
    expect(liveDialect('X', { LIVE_DB_TYPE: 'mysql' })).toBe('mysql');
    expect(liveDialect('X', {})).toBe('mysql');
  });

  it('liveUrl picks the URL of the engine, with the documented defaults', () => {
    expect(liveUrl('X', 'postgres', {})).toBe(
      'postgres://postgres:postgres@127.0.0.1:5432',
    );
    expect(liveUrl('X', 'mysql', {})).toBe(
      'mysql://root:password@127.0.0.1:3308',
    );
    expect(liveUrl('X', 'mysql', { X_MYSQL_URL: 'mysql://a@b:1' })).toBe(
      'mysql://a@b:1',
    );
    expect(
      liveUrl('X', 'postgres', { X_PG_URL: 'postgres://u:p@h:1/db' }),
    ).toBe('postgres://u:p@h:1/db');
  });

  it('rejects a dialect the entities were not decorated for', async () => {
    // DB_TYPE was unset when this spec file loaded, so currentDialect() is
    // 'mysql' while LIVE_DB_TYPE asks for postgres.
    process.env.LIVE_DB_TYPE = 'postgres';
    await expect(
      createLiveDatabase({ prefix: 'p', envPrefix: 'X' }),
    ).rejects.toThrow('LIVE_DIALECT_MISMATCH');
  });

  it('rejects postgres without a baseline, before any connection', async () => {
    process.env.LIVE_DB_TYPE = 'postgres';
    process.env.DB_TYPE = 'postgres';
    // Port 1: nothing listens there; the guard must throw before connecting.
    process.env.X_PG_URL = 'postgres://postgres:postgres@127.0.0.1:1/x';
    await jest.isolateModulesAsync(async () => {
      jest.doMock('node:fs', () => ({
        ...jest.requireActual<typeof import('node:fs')>('node:fs'),
        readdirSync: () => [],
      }));
      // src/core/migrations-postgres/ holds the baseline: the folder is read
      // empty here, and the helper must refuse before creating anything.
      const { createLiveDatabase: fresh } = await import('./live-database');
      await expect(fresh({ prefix: 'p', envPrefix: 'X' })).rejects.toThrow(
        'LIVE_POSTGRES_BASELINE_MISSING',
      );
    });
  });

  // The schema-parity spec opens one database per engine in one process, with
  // no entity: the decorators' dialect (DB_TYPE) does not matter then.
  it('skips LIVE_DIALECT_MISMATCH when entities is [] and takes an explicit dialect', async () => {
    const saved = { ...process.env };
    await jest.isolateModulesAsync(async () => {
      delete process.env.DB_TYPE;
      delete process.env.LIVE_DB_TYPE;
      process.env.X_PG_URL = 'postgres://postgres:postgres@127.0.0.1:1';
      const { createLiveDatabase: fresh } = await import('./live-database');
      // Past the checks, the helper connects to the PostgreSQL URL (port 1).
      await expect(
        fresh({
          prefix: 'p',
          envPrefix: 'X',
          entities: [],
          dialect: 'postgres',
          migrations: 'none',
        }),
      ).rejects.toThrow(/ECONNREFUSED/);
      // With entities, the mismatch is still refused.
      await expect(
        fresh({
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
