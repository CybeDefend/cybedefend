import type { ConfigService } from '@nestjs/config';
import type { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { defaults as pgDefaults, types } from 'pg';
import { join } from 'node:path';
import type { DataSourceOptions } from 'typeorm';
import {
  currentDialect,
  parseDialect,
  registerPostgresTypeParsers,
  type Dialect,
} from '@cybedefend/db-dialect';
import type SecretsService from '../secrets/secrets.service';
import { currentEdition } from '../../edition/edition';
import { editionMigrations } from '../../edition/edition-migrations';

/** The service root (`src/` under ts-node, `dist/` once built). */
const ROOT = join(__dirname, '..', '..');

/**
 * The database connection, resolved once: from the secrets in the Nest
 * contexts, from the environment in the CLI. `ssl` is undefined unless
 * DB_SSL_ENABLED is 'true'.
 */
export interface DbConnection {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  ssl?: { ca: string; cert?: string; key?: string };
  /** the ConfigService NODE_ENV, decides migrationsRun and logging as today */
  nodeEnv?: string;
}

/** Every process that opens the database: the API, the two crons, the CLI, the live specs. */
export type DbContext =
  | 'api'
  | 'cron-data-purge'
  | 'cron-lead-followups'
  | 'cli'
  | 'live';

/**
 * The pool size of every context: global-management never set a
 * `connectionLimit`, so each ran on mysql2's default of 10; reused as the
 * PostgreSQL `extra.max` (Lane Constraints).
 */
export const DB_POOL_SIZE: Record<DbContext, number> = {
  api: 10,
  'cron-data-purge': 10,
  'cron-lead-followups': 10,
  cli: 10,
  live: 10,
};

/**
 * Today's secret reads, moved without change of behaviour: same secret keys,
 * same TypeError messages, client cert and key only when both are set.
 */
export async function resolveDbConnection(
  secrets: Pick<SecretsService, 'ensureCacheLoaded' | 'getSecret'>,
  config: Pick<ConfigService, 'get'>,
): Promise<DbConnection> {
  await secrets.ensureCacheLoaded();

  const host = secrets.getSecret('DB_HOST');
  const portStr = secrets.getSecret('DB_PORT');
  const username = secrets.getSecret('DB_USERNAME');
  const password = secrets.getSecret('DB_PASSWORD');
  const database = secrets.getSecret('DB_DATABASE');

  if (!host || !portStr || !username || !password || !database) {
    throw new TypeError(
      'Cannot get database connection parameters from secrets',
    );
  }

  const port = Number(portStr);
  if (Number.isNaN(port)) {
    throw new TypeError(`Invalid port number`);
  }

  const sslEnabled = String(config.get<string>('DB_SSL_ENABLED')) === 'true';
  const sslCa = sslEnabled ? secrets.getSecret('DB_SSL_CA_CERT') : undefined;
  const sslCert = sslEnabled
    ? secrets.getSecret('DB_SSL_CLIENT_CERT')
    : undefined;
  const sslKey = sslEnabled
    ? secrets.getSecret('DB_SSL_CLIENT_KEY')
    : undefined;
  if (sslEnabled && !sslCa) {
    throw new TypeError(
      'DB_SSL_ENABLED=true but DB_SSL_CA_CERT is missing from secrets',
    );
  }

  return {
    host,
    port,
    username,
    password,
    database,
    ssl: sslEnabled
      ? {
          ca: sslCa,
          ...(sslCert && sslKey ? { cert: sslCert, key: sslKey } : {}),
        }
      : undefined,
    nodeEnv: config.get<string>('NODE_ENV'),
  };
}

/**
 * The CLI's connection from the environment (DB_HOST/DB_PORT/DB_USERNAME/
 * DB_PASSWORD/DB_DATABASE), on the engine DB_TYPE selects: today's
 * data-source values on mysql, postgres/5432/postgres/postgres on postgres.
 */
export function connectionFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): DbConnection {
  const dialect = parseDialect(env.DB_TYPE);
  const postgres = dialect === 'postgres';
  return {
    host: env.DB_HOST ?? 'localhost',
    port: Number(env.DB_PORT ?? (postgres ? 5432 : 3308)),
    username: env.DB_USERNAME ?? (postgres ? 'postgres' : 'user'),
    password: env.DB_PASSWORD ?? (postgres ? 'postgres' : 'password'),
    database: env.DB_DATABASE ?? 'cybedefend_global_management',
    nodeEnv: env.NODE_ENV,
  };
}

/**
 * The Community Edition runs on PostgreSQL only: booting it with DB_TYPE=mysql
 * fails with one line naming the variable.
 */
export function assertDialectAllowed(dialect: Dialect): void {
  if (currentEdition() === 'community' && dialect === 'mysql') {
    throw new Error(
      'DB_TYPE_NOT_SUPPORTED: DB_TYPE must be postgres in the Community Edition',
    );
  }
}

/**
 * The live helper's entities: the core ones only (never the closed edition's), and entity
 * files only, since a spec file next to them (entities/performance-indexes.spec.ts)
 * would be required by TypeORM and register its tests inside another suite.
 */
export const LIVE_ENTITIES_GLOB = `${ROOT}/entities/*.entity{.ts,.js}`;

/** The entity glob of each context: the whole service for the API and the crons, as today. */
const ENTITIES_GLOB: Record<DbContext, string> = {
  api: `${ROOT}/**/*.entity{.ts,.js}`,
  'cron-data-purge': `${ROOT}/**/*.entity{.ts,.js}`,
  'cron-lead-followups': `${ROOT}/**/*.entity{.ts,.js}`,
  cli: join(ROOT, '**/*.entity.{ts,js}'),
  live: LIVE_ENTITIES_GLOB,
};

/** The MySQL migration glob of each context, byte-identical to today's. */
const MYSQL_MIGRATIONS_GLOB: Record<DbContext, string> = {
  api: `${ROOT}/core/migrations/*{.ts,.js}`,
  'cron-data-purge': `${ROOT}/core/migrations/*{.ts,.js}`,
  'cron-lead-followups': `${ROOT}/core/migrations/*{.ts,.js}`,
  cli: join(ROOT, 'core/migrations/*.{ts,js}'),
  live: `${ROOT}/core/migrations/*{.ts,.js}`,
};

/**
 * mysql: the frozen MySQL track, migrations-common/ once it exists, the ee
 * MySQL migrations; postgres: the baseline, migrations-common/ once it
 * exists, the ee PostgreSQL migrations.
 */
function migrationsFor(context: DbContext, dialect: Dialect): string[] {
  return editionMigrations(MYSQL_MIGRATIONS_GLOB[context], dialect);
}

/**
 * The one factory behind every TypeORM options object of the service (Nest
 * contexts, CLI data source, live-test helper). On `mysql` it returns exactly
 * today's object per context; on `postgres` the contract object: same entities,
 * synchronize, migrationsRun and logging decisions, plus `type: 'postgres'`,
 * the UTC session and pool, and no `timezone` key.
 */
export function buildTypeOrmOptions(
  connection: DbConnection,
  opts: { context: DbContext; dialect?: Dialect },
): DataSourceOptions & TypeOrmModuleOptions {
  const dialect = opts.dialect ?? currentDialect();
  assertDialectAllowed(dialect);
  const { context } = opts;

  // The API runs the migrations outside development; the crons and the live
  // helper never do; the CLI leaves migrationsRun unset, as today.
  const migrationsRun =
    context === 'api'
      ? connection.nodeEnv !== 'development'
      : context === 'cli'
        ? undefined
        : false;

  const ssl = connection.ssl
    ? {
        ...connection.ssl,
        rejectUnauthorized: true,
        // node-postgres checks the host name against the certificate's SAN,
        // which Cloud SQL certificates do not carry (policy-management's
        // comment); mysql2 never did this check, so MySQL keeps the default.
        ...(dialect === 'postgres'
          ? { checkServerIdentity: () => undefined }
          : {}),
      }
    : undefined;

  if (dialect === 'postgres') {
    // Registered on the service's own pg module: under the Jest mapper the
    // library would load its own copy, whose parsers never reach this driver.
    registerPostgresTypeParsers(types);
    // A `timestamp` column holds UTC (read back by the 1114 parser as UTC):
    // a Date parameter is sent as UTC, never in the host's local time, whose
    // offset a column without time zone would drop.
    pgDefaults.parseInputDatesAsUTC = true;
    return {
      type: 'postgres',
      host: connection.host,
      port: connection.port,
      username: connection.username,
      password: connection.password,
      database: connection.database,
      entities: [ENTITIES_GLOB[context]],
      synchronize: false,
      ...(migrationsRun !== undefined ? { migrationsRun } : {}),
      migrations: migrationsFor(context, dialect),
      ssl,
      extra: { max: DB_POOL_SIZE[context], options: '-c TimeZone=UTC' },
    } as DataSourceOptions & TypeOrmModuleOptions;
  }

  return {
    type: 'mysql',
    host: connection.host,
    port: connection.port,
    username: connection.username,
    password: connection.password,
    database: connection.database,
    entities: [ENTITIES_GLOB[context]],
    synchronize: false,
    ...(migrationsRun !== undefined ? { migrationsRun } : {}),
    migrations: migrationsFor(context, dialect),
    // The API, the crons and the live helper keep UTC timestamps;
    // the CLI object never had the key.
    ...(context === 'cli' ? {} : { ssl, timezone: 'Z' }),
  } as DataSourceOptions & TypeOrmModuleOptions;
}
