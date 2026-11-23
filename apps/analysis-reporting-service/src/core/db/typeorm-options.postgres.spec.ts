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
  username: 'ar',
  password: 'pw',
  database: 'analysis_and_reporting',
  nodeEnv: 'production',
};

const BASE = {
  type: 'postgres',
  host: 'db.internal',
  port: 5432,
  username: 'ar',
  password: 'pw',
  database: 'analysis_and_reporting',
};

const ENTITIES = [`${ROOT}/**/*.entity{.ts,.js}`];
const POSTGRES_MIGRATIONS = [
  join(ROOT, 'core/migrations-postgres/*{.ts,.js}'),
  join(ROOT, 'core/migrations-common/*{.ts,.js}'),
];
const extraOf = (context: keyof typeof DB_POOL_SIZE) => ({
  max: DB_POOL_SIZE[context],
  options: '-c TimeZone=UTC',
});

describe('buildTypeOrmOptions on postgres', () => {
  // These are the Community contexts: outside the Community Edition the
  // closed PostgreSQL migrations follow the core globs (the cloud case is in
  // src/ee/core/db/).
  const savedEdition = process.env.CYBEDEFEND_EDITION;
  beforeEach(() => {
    process.env.CYBEDEFEND_EDITION = 'community';
  });
  afterEach(() => {
    if (savedEdition === undefined) delete process.env.CYBEDEFEND_EDITION;
    else process.env.CYBEDEFEND_EDITION = savedEdition;
  });

  const build = (
    context: Parameters<typeof buildTypeOrmOptions>[1]['context'],
    connection: Parameters<typeof buildTypeOrmOptions>[0] = CONNECTION,
  ) => buildTypeOrmOptions(connection, { context, dialect: 'postgres' });

  it('builds the contract object for every Community context', () => {
    expect(build('api')).toEqual({
      ...BASE,
      autoLoadEntities: true,
      synchronize: false,
      migrationsRun: true,
      migrations: POSTGRES_MIGRATIONS,
      ssl: undefined,
      extra: extraOf('api'),
    });
    for (const context of ['worker', 'worker-reports'] as const) {
      expect(build(context)).toEqual({
        ...BASE,
        entities: ENTITIES,
        synchronize: false,
        migrationsRun: false,
        ssl: undefined,
        extra: extraOf(context),
      });
    }
    for (const context of [
      'cron-report-mail',
      'cron-report-retention',
    ] as const) {
      expect(build(context)).toEqual({
        ...BASE,
        entities: ENTITIES,
        synchronize: false,
        migrationsRun: true,
        migrations: POSTGRES_MIGRATIONS,
        ssl: undefined,
        extra: extraOf(context),
      });
    }
    expect(build('live')).toEqual({
      ...BASE,
      entities: [`${ROOT}/entities/**/*.entity{.ts,.js}`],
      synchronize: false,
      migrationsRun: false,
      migrations: POSTGRES_MIGRATIONS,
      ssl: undefined,
      extra: extraOf('live'),
    });
    for (const context of [
      'api',
      'worker',
      'worker-reports',
      'cron-report-mail',
      'cron-report-retention',
      'live',
    ] as const) {
      expect(build(context)).not.toHaveProperty('timezone');
    }
    expect(extraOf('api').max).toBe(20);
    expect(extraOf('worker').max).toBe(24);
    expect(extraOf('worker-reports').max).toBe(5);
  });

  it('cloud-only contexts are refused on postgres', () => {
    for (const context of [
      'cron-osv',
      'cron-epss',
      'worker-autofix',
    ] as const) {
      expect(() => build(context)).toThrow(`DB_CONTEXT_MYSQL_ONLY ${context}`);
    }
  });

  it('keeps the SSL options and disables the host-name check node-postgres applies', () => {
    const opts = build('api', { ...CONNECTION, ssl: { ca: 'ca' } }) as {
      ssl: {
        ca: string;
        rejectUnauthorized: boolean;
        checkServerIdentity: (host: string, cert: unknown) => unknown;
      };
    };
    expect(opts.ssl.ca).toBe('ca');
    expect(opts.ssl.rejectUnauthorized).toBe(true);
    expect(typeof opts.ssl.checkServerIdentity).toBe('function');
    expect(opts.ssl.checkServerIdentity('db.internal', {})).toBeUndefined();
  });

  it('builds the cli context from the environment with the postgres globs and pool', () => {
    const opts = build('cli', connectionFromEnv({ DB_TYPE: 'postgres' }));
    expect(opts).toEqual({
      type: 'postgres',
      host: 'localhost',
      port: 5432,
      username: 'postgres',
      password: 'postgres',
      database: 'cybedefend_analysis_and_reporting',
      entities: [join(ROOT, '**/*.entity.{ts,js}')],
      migrations: POSTGRES_MIGRATIONS,
      synchronize: false,
      ssl: undefined,
      extra: extraOf('cli'),
    });
    expect(opts).not.toHaveProperty('timezone');
  });

  it('registers the type parsers on the service’s own pg', () => {
    build('api');
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

  it("sends a Date parameter as UTC on the service's own pg, whatever the host time zone", () => {
    build('api');
    // A `timestamp` column holds UTC: node-postgres would otherwise write a
    // Date in the host's local time with its offset, which a column without
    // time zone drops (a Paris host stored every instant an hour late).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pg = require('pg') as typeof import('pg');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { prepareValue } = require('pg/lib/utils') as {
      prepareValue: (v: unknown) => unknown;
    };
    expect(pg.defaults.parseInputDatesAsUTC).toBe(true);
    expect(prepareValue(new Date('2026-11-02T10:00:00.000Z'))).toBe(
      '2026-11-02T10:00:00.000+00:00',
    );
  });

  it('takes its migrations from editionMigrations(<glob>, postgres): the ee PostgreSQL ones outside community', async () => {
    const saved = process.env.CYBEDEFEND_EDITION;
    try {
      // Only the Community Edition is exercised here.
      for (const edition of ['community'] as const) {
        process.env.CYBEDEFEND_EDITION = edition;
        await jest.isolateModulesAsync(async () => {
          jest.doMock('../../edition/ee-migrations', () => ({
            EE_MIGRATIONS: ['/ee/mysql/*'],
            EE_POSTGRES_MIGRATIONS: ['/ee/pg/*'],
          }));
          const factory = await import('./typeorm-options');
          for (const context of ['api', 'cron-report-mail', 'live'] as const) {
            const options = factory.buildTypeOrmOptions(CONNECTION, {
              context,
              dialect: 'postgres',
            });
            expect(options.migrations).toEqual([
              `${ROOT}/core/migrations-postgres/*{.ts,.js}`,
              `${ROOT}/core/migrations-common/*{.ts,.js}`,
            ]);
          }
          const cli = factory.buildTypeOrmOptions(
            factory.connectionFromEnv({ DB_TYPE: 'postgres' }),
            { context: 'cli', dialect: 'postgres' },
          );
          expect(cli.migrations).toEqual([...POSTGRES_MIGRATIONS]);
        });
      }
    } finally {
      if (saved === undefined) delete process.env.CYBEDEFEND_EDITION;
      else process.env.CYBEDEFEND_EDITION = saved;
    }
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
      expect(() => build('api')).not.toThrow();
    } finally {
      if (saved === undefined) delete process.env.CYBEDEFEND_EDITION;
      else process.env.CYBEDEFEND_EDITION = saved;
    }
    // Outside the Community Edition, mysql keeps working.
  });

  it('the CLI reads the engine and the connection from the environment', () => {
    expect(connectionFromEnv({ DB_TYPE: 'postgres' })).toEqual({
      host: 'localhost',
      port: 5432,
      username: 'postgres',
      password: 'postgres',
      database: 'cybedefend_analysis_and_reporting',
    });
    expect(connectionFromEnv({})).toEqual({
      host: 'localhost',
      port: 3308,
      username: 'user',
      password: 'password',
      database: 'cybedefend_analysis_and_reporting',
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
