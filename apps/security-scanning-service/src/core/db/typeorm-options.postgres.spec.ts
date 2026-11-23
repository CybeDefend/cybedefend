import { join } from 'node:path';
import {
  buildTypeOrmOptions,
  connectionFromEnv,
  DB_POOL_SIZE,
  ROOT,
} from './typeorm-options';

const CONNECTION = {
  host: 'db.internal',
  port: 5432,
  username: 'ss',
  password: 'pw',
  database: 'scanning',
  nodeEnv: 'production',
};

const POSTGRES_MIGRATIONS = [
  join(ROOT, 'core/migrations-postgres/*{.ts,.js}'),
  join(ROOT, 'core/migrations-common/*{.ts,.js}'),
];
const CLI_POSTGRES_MIGRATIONS = [
  join(ROOT, 'core/migrations-postgres/*.{ts,js}'),
  join(ROOT, 'core/migrations-common/*.{ts,js}'),
];

describe('buildTypeOrmOptions on postgres', () => {
  it('builds the contract object for the api context', () => {
    const opts = buildTypeOrmOptions(CONNECTION, {
      context: 'api',
      dialect: 'postgres',
    });
    expect(opts).toEqual({
      type: 'postgres',
      host: 'db.internal',
      port: 5432,
      username: 'ss',
      password: 'pw',
      database: 'scanning',
      entities: [`${ROOT}/**/*.entity{.ts,.js}`],
      synchronize: false,
      migrationsRun: true,
      migrations: POSTGRES_MIGRATIONS,
      extra: { max: DB_POOL_SIZE.api, options: '-c TimeZone=UTC' },
      ssl: undefined,
      // process.env.NODE_ENV is not 'development' under Jest.
      logging: ['error'],
    });
    expect(opts).not.toHaveProperty('timezone');
  });

  it('keeps the logging rule', () => {
    const saved = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      expect(
        buildTypeOrmOptions(CONNECTION, {
          context: 'api',
          dialect: 'postgres',
        }),
      ).toMatchObject({ logging: ['migration', 'error'] });
    } finally {
      process.env.NODE_ENV = saved;
    }
    expect(
      buildTypeOrmOptions(CONNECTION, { context: 'api', dialect: 'postgres' }),
    ).toMatchObject({ logging: ['error'] });
  });

  it('keeps the SSL options and disables the host-name check node-postgres applies', () => {
    const opts = buildTypeOrmOptions(
      { ...CONNECTION, ssl: { ca: 'ca' } },
      { context: 'api', dialect: 'postgres' },
    ) as {
      ssl: {
        rejectUnauthorized: boolean;
        checkServerIdentity: (host: string, cert: unknown) => unknown;
      };
    };
    expect(opts.ssl.rejectUnauthorized).toBe(true);
    expect(typeof opts.ssl.checkServerIdentity).toBe('function');
    expect(opts.ssl.checkServerIdentity('db.internal', {})).toBeUndefined();
  });

  it('builds the cli context from the environment with the postgres globs and pool', () => {
    const opts = buildTypeOrmOptions(
      connectionFromEnv({ DB_TYPE: 'postgres' }),
      {
        context: 'cli',
        dialect: 'postgres',
      },
    );
    expect(opts).toEqual({
      type: 'postgres',
      host: 'localhost',
      port: 5432,
      username: 'postgres',
      password: 'postgres',
      database: 'cybedefend_scanning',
      entities: [join(ROOT, '**/*.entity.{ts,js}')],
      synchronize: false,
      migrations: CLI_POSTGRES_MIGRATIONS,
      extra: { max: DB_POOL_SIZE.cli, options: '-c TimeZone=UTC' },
      ssl: undefined,
    });
    expect(opts).not.toHaveProperty('timezone');
  });

  it('takes its migrations from editionMigrations(<glob>, postgres): the ee PostgreSQL ones outside community', async () => {
    const saved = process.env.CYBEDEFEND_EDITION;
    try {
      // The closed edition's cases are tested with the closed edition.
      for (const edition of ['community'] as const) {
        process.env.CYBEDEFEND_EDITION = edition;
        await jest.isolateModulesAsync(async () => {
          jest.doMock('../../edition/ee-migrations', () => ({
            EE_MIGRATIONS: ['/ee/mysql/*'],
            EE_POSTGRES_MIGRATIONS: ['/ee/pg/*'],
          }));
          const factory = await import('./typeorm-options');
          const options = factory.buildTypeOrmOptions(CONNECTION, {
            context: 'api',
            dialect: 'postgres',
          }) as { migrations: string[] };
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

  it('registers the type parsers on the service’s own pg', () => {
    buildTypeOrmOptions(CONNECTION, { context: 'api', dialect: 'postgres' });
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { types } = require('pg') as typeof import('pg');
    // timestamp (OID 1114) is parsed as UTC.
    expect(types.getTypeParser(1114)('2026-11-02 10:00:00')).toEqual(
      new Date('2026-11-02T10:00:00.000Z'),
    );
    // int8 (20) and numeric (1700) stay strings, like mysql2 returns them.
    expect(types.getTypeParser(20)('9007199254740993')).toBe(
      '9007199254740993',
    );
    expect(types.getTypeParser(1700)('3.14')).toBe('3.14');
  });

  it('writes JavaScript Dates as UTC (parseInputDatesAsUTC), so a timestamp column never shifts them on a non-UTC host', () => {
    buildTypeOrmOptions(CONNECTION, { context: 'api', dialect: 'postgres' });
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { defaults } = require('pg') as typeof import('pg');
    expect(defaults.parseInputDatesAsUTC).toBe(true);
  });

  it('refuses mysql in the Community Edition', () => {
    const saved = process.env.CYBEDEFEND_EDITION;
    process.env.CYBEDEFEND_EDITION = 'community';
    try {
      expect(() =>
        buildTypeOrmOptions(CONNECTION, { context: 'api', dialect: 'mysql' }),
      ).toThrow(
        'DB_TYPE_NOT_SUPPORTED: DB_TYPE must be postgres in the Community Edition',
      );
      expect(() =>
        buildTypeOrmOptions(CONNECTION, {
          context: 'api',
          dialect: 'postgres',
        }),
      ).not.toThrow();
    } finally {
      if (saved === undefined) delete process.env.CYBEDEFEND_EDITION;
      else process.env.CYBEDEFEND_EDITION = saved;
    }
    // Outside the Community Edition, mysql keeps working (tested with the
    // closed edition).
  });

  it('the CLI reads the engine and the connection from the environment', () => {
    expect(connectionFromEnv({ DB_TYPE: 'postgres' })).toEqual({
      host: 'localhost',
      port: 5432,
      username: 'postgres',
      password: 'postgres',
      database: 'cybedefend_scanning',
    });
    expect(connectionFromEnv({})).toEqual({
      host: 'localhost',
      port: 3308,
      username: 'user',
      password: 'password',
      database: 'cybedefend_scanning',
    });
    expect(
      connectionFromEnv({
        DB_TYPE: 'postgres',
        DB_HOST: 'pg.internal',
        DB_PORT: '5544',
        DB_USERNAME: 'u',
        DB_PASSWORD: 'p',
        DB_DATABASE: 'd',
      }),
    ).toEqual({
      host: 'pg.internal',
      port: 5544,
      username: 'u',
      password: 'p',
      database: 'd',
    });
  });
});
