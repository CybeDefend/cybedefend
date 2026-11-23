import { join } from 'node:path';
import {
  buildTypeOrmOptions,
  connectionFromEnv,
  type DbConnection,
} from './typeorm-options';

/** The service root, where the entity and migration globs must point. */
const ROOT = join(__dirname, '..', '..');

const CONN: DbConnection = {
  host: 'db.internal',
  port: 3306,
  username: 'gm',
  password: 'pw',
  database: 'global_management',
  nodeEnv: 'production',
};

// The cloud cases (the ee PostgreSQL migrations, mysql allowed) live in the
// closed edition. These run as the Community Edition, the edition the
// exported tree is fixed to.
describe('buildTypeOrmOptions on postgres', () => {
  const savedEdition = process.env.CYBEDEFEND_EDITION;
  beforeAll(() => {
    process.env.CYBEDEFEND_EDITION = 'community';
  });
  afterAll(() => {
    if (savedEdition === undefined) delete process.env.CYBEDEFEND_EDITION;
    else process.env.CYBEDEFEND_EDITION = savedEdition;
  });

  it('builds the contract object on postgres', () => {
    const options: any = buildTypeOrmOptions(CONN, {
      context: 'api',
      dialect: 'postgres',
    });

    expect(options.type).toBe('postgres');
    expect(options.host).toBe('db.internal');
    expect(options.port).toBe(3306);
    expect(options.extra).toEqual({ max: 10, options: '-c TimeZone=UTC' });
    expect(options).not.toHaveProperty('timezone');
    expect(options.migrations).toEqual([
      join(ROOT, 'core/migrations-postgres/*{.ts,.js}'),
      join(ROOT, 'core/migrations-common/*{.ts,.js}'),
    ]);
    expect(options.entities).toEqual([`${ROOT}/**/*.entity{.ts,.js}`]);
    expect(options.synchronize).toBe(false);
    expect(options.migrationsRun).toBe(true);
    expect(options.ssl).toBeUndefined();

    const withSsl: any = buildTypeOrmOptions(
      { ...CONN, ssl: { ca: 'CA', cert: 'C', key: 'K' } },
      { context: 'api', dialect: 'postgres' },
    );
    expect(withSsl.ssl.rejectUnauthorized).toBe(true);
    expect(typeof withSsl.ssl.checkServerIdentity).toBe('function');
  });

  it('takes its migrations from editionMigrations(<glob>, postgres): none of the ee PostgreSQL ones in community', async () => {
    const saved = process.env.CYBEDEFEND_EDITION;
    try {
      for (const edition of ['community'] as const) {
        process.env.CYBEDEFEND_EDITION = edition;
        await jest.isolateModulesAsync(async () => {
          jest.doMock('../../edition/ee-migrations', () => ({
            EE_MIGRATIONS: ['/ee/mysql/*'],
            EE_POSTGRES_MIGRATIONS: ['/ee/pg/*'],
          }));
          const factory = await import('./typeorm-options');
          const options: any = factory.buildTypeOrmOptions(CONN, {
            context: 'cron-data-purge',
            dialect: 'postgres',
          });
          expect(options.migrations).toEqual([
            `${ROOT}/core/migrations-postgres/*{.ts,.js}`,
            `${ROOT}/core/migrations-common/*{.ts,.js}`,
          ]);
        });
      }
    } finally {
      if (saved === undefined) delete process.env.CYBEDEFEND_EDITION;
      else process.env.CYBEDEFEND_EDITION = saved;
    }
  });

  it("registers the parsers on the service's own pg", () => {
    buildTypeOrmOptions(CONN, { context: 'api', dialect: 'postgres' });

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { types } = require('pg');
    expect(types.getTypeParser(1114)('2026-11-02 10:00:00')).toEqual(
      new Date('2026-11-02T10:00:00Z'),
    );
    expect(types.getTypeParser(20)('9007199254740993')).toBe(
      '9007199254740993',
    );
    expect(types.getTypeParser(1700)('1.50')).toBe('1.50');
  });

  it("sends a Date parameter as UTC on the service's own pg, whatever the host time zone", () => {
    buildTypeOrmOptions(CONN, { context: 'api', dialect: 'postgres' });

    // A `timestamp` column holds UTC: node-postgres would otherwise write a
    // Date in the host's local time with its offset, which a column without
    // time zone drops (a Paris host stored every instant an hour late).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pg = require('pg');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { prepareValue } = require('pg/lib/utils');
    expect(pg.defaults.parseInputDatesAsUTC).toBe(true);
    expect(prepareValue(new Date('2026-11-02T10:00:00.000Z'))).toBe(
      '2026-11-02T10:00:00.000+00:00',
    );
  });

  it('refuses mysql in the Community Edition', () => {
    jest.isolateModules(() => {
      process.env.CYBEDEFEND_EDITION = 'community';
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { buildTypeOrmOptions: build } = require('./typeorm-options');
        expect(() => build(CONN, { context: 'api', dialect: 'mysql' })).toThrow(
          'DB_TYPE_NOT_SUPPORTED: DB_TYPE must be postgres in the Community Edition',
        );
        expect(() =>
          build(CONN, { context: 'api', dialect: 'postgres' }),
        ).not.toThrow();
      } finally {
        delete process.env.CYBEDEFEND_EDITION;
      }
    });
  });

  it('the CLI reads the engine and connection from the environment', () => {
    expect(connectionFromEnv({ DB_TYPE: 'postgres' })).toEqual({
      host: 'localhost',
      port: 5432,
      username: 'postgres',
      password: 'postgres',
      database: 'cybedefend_global_management',
    });
    expect(
      connectionFromEnv({
        DB_TYPE: 'postgres',
        DB_HOST: 'db',
        DB_PORT: '5433',
        DB_USERNAME: 'u',
        DB_PASSWORD: 'p',
        DB_DATABASE: 'd',
      }),
    ).toEqual({
      host: 'db',
      port: 5433,
      username: 'u',
      password: 'p',
      database: 'd',
    });
    expect(connectionFromEnv({})).toEqual({
      host: 'localhost',
      port: 3308,
      username: 'user',
      password: 'password',
      database: 'cybedefend_global_management',
    });
  });
});
