import { join } from 'node:path';
import {
  buildTypeOrmOptions,
  connectionFromEnv,
  DbConnection,
} from './typeorm-options';

const ROOT = join(__dirname, '..', '..');

const conn: DbConnection = {
  host: 'db.internal',
  port: 5432,
  username: 'fm',
  password: 'pw',
  database: 'cybedefend_file_management',
  nodeEnv: 'production',
};

const PG_MIGRATIONS = [
  join(ROOT, 'core/migrations-postgres/*{.ts,.js}'),
  join(ROOT, 'core/migrations-common/*{.ts,.js}'),
];

/** The cli keeps its own `*.{ts,js}` glob; editionMigrations derives the siblings from it. */
const PG_CLI_MIGRATIONS = [
  join(ROOT, 'core/migrations-postgres/*.{ts,js}'),
  join(ROOT, 'core/migrations-common/*.{ts,js}'),
];

describe('buildTypeOrmOptions on postgres', () => {
  it('builds the contract object', () => {
    const options = buildTypeOrmOptions(
      { ...conn, ssl: { ca: 'ca' } },
      { context: 'api', dialect: 'postgres' },
    );
    expect(options.type).toBe('postgres');
    expect(options).toMatchObject({
      host: 'db.internal',
      port: 5432,
      username: 'fm',
      password: 'pw',
      database: 'cybedefend_file_management',
      entities: [`${ROOT}/**/*.entity{.ts,.js}`],
      synchronize: false,
      migrationsRun: true,
      migrations: PG_MIGRATIONS,
      extra: { max: 10, options: '-c TimeZone=UTC' },
    });
    expect(options).not.toHaveProperty('timezone');
    const ssl = (options as { ssl?: Record<string, unknown> }).ssl;
    expect(ssl?.rejectUnauthorized).toBe(true);
    expect(typeof ssl?.checkServerIdentity).toBe('function');
  });

  it('leaves ssl undefined when DB_SSL_ENABLED is not true', () => {
    const options = buildTypeOrmOptions(conn, {
      context: 'api',
      dialect: 'postgres',
    }) as { ssl?: unknown };
    expect(options.ssl).toBeUndefined();
  });

  it('cli on postgres keeps the cli glob and gains the two postgres migration globs', () => {
    const options = buildTypeOrmOptions(
      connectionFromEnv({ DB_TYPE: 'postgres' }),
      {
        context: 'cli',
        dialect: 'postgres',
      },
    );
    expect(options).toMatchObject({
      type: 'postgres',
      host: 'localhost',
      port: 5432,
      username: 'postgres',
      password: 'postgres',
      database: 'cybedefend_file_management',
      entities: [join(ROOT, '**/*.entity.{ts,js}')],
      synchronize: false,
      migrations: PG_CLI_MIGRATIONS,
      extra: { max: 10, options: '-c TimeZone=UTC' },
    });
    expect(options).not.toHaveProperty('migrationsRun');
  });

  it('takes its migrations from editionMigrations(<glob>, postgres): the ee PostgreSQL ones outside community', async () => {
    const saved = process.env.CYBEDEFEND_EDITION;
    try {
      // The closed edition's case is tested with the closed edition.
      for (const edition of ['community'] as const) {
        process.env.CYBEDEFEND_EDITION = edition;
        await jest.isolateModulesAsync(async () => {
          jest.doMock('../../edition/ee-migrations', () => ({
            EE_MIGRATIONS: ['/ee/mysql/*'],
            EE_POSTGRES_MIGRATIONS: ['/ee/pg/*'],
          }));
          const factory = await import('./typeorm-options');
          const options = factory.buildTypeOrmOptions(conn, {
            context: 'api',
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

  it("registers the type parsers on the service's own pg", () => {
    buildTypeOrmOptions(conn, { context: 'api', dialect: 'postgres' });
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pg = require('pg') as {
      types: {
        getTypeParser(oid: number): (value: string) => unknown;
      };
    };
    expect(pg.types.getTypeParser(1114)('2026-11-02 10:00:00')).toEqual(
      new Date('2026-11-02T10:00:00.000Z'),
    );
    expect(pg.types.getTypeParser(20)('9007199254740993')).toBe(
      '9007199254740993',
    );
    expect(pg.types.getTypeParser(1700)('1.50')).toBe('1.50');
  });

  it('sends JavaScript Dates to PostgreSQL as UTC (parseInputDatesAsUTC)', () => {
    // node-postgres otherwise sends a Date in the host local time with its
    // offset and a `timestamp` column drops the offset: every instant would
    // be stored shifted on a non-UTC host.
    buildTypeOrmOptions(conn, { context: 'api', dialect: 'postgres' });
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pg = require('pg') as {
      defaults: { parseInputDatesAsUTC: boolean };
    };
    expect(pg.defaults.parseInputDatesAsUTC).toBe(true);
  });

  describe('the Community Edition refuses mysql', () => {
    const saved = process.env.CYBEDEFEND_EDITION;
    afterEach(() => {
      if (saved === undefined) delete process.env.CYBEDEFEND_EDITION;
      else process.env.CYBEDEFEND_EDITION = saved;
    });

    it('throws DB_TYPE_NOT_SUPPORTED', () => {
      process.env.CYBEDEFEND_EDITION = 'community';
      expect(() =>
        buildTypeOrmOptions(conn, { context: 'api', dialect: 'mysql' }),
      ).toThrow(
        'DB_TYPE_NOT_SUPPORTED: DB_TYPE must be postgres in the Community Edition',
      );
    });

    it('accepts postgres', () => {
      process.env.CYBEDEFEND_EDITION = 'community';
      expect(() =>
        buildTypeOrmOptions(conn, { context: 'api', dialect: 'postgres' }),
      ).not.toThrow();
    });
    // 'accepts mysql when the edition is unset' is tested with the closed
    // edition.
  });

  it('the CLI reads the engine and connection from the environment', () => {
    expect(connectionFromEnv({ DB_TYPE: 'postgres' })).toEqual({
      host: 'localhost',
      port: 5432,
      username: 'postgres',
      password: 'postgres',
      database: 'cybedefend_file_management',
    });
    expect(connectionFromEnv({})).toEqual({
      host: 'localhost',
      port: 3308,
      username: 'user',
      password: 'password',
      database: 'cybedefend_file_management',
    });
    expect(
      connectionFromEnv({
        DB_TYPE: 'postgres',
        DB_HOST: 'pg.internal',
        DB_PORT: '5433',
        DB_USERNAME: 'u',
        DB_PASSWORD: 'p',
        DB_DATABASE: 'd',
      }),
    ).toEqual({
      host: 'pg.internal',
      port: 5433,
      username: 'u',
      password: 'p',
      database: 'd',
    });
  });
});
