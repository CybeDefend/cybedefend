import { join } from 'node:path';
import type { ConfigService } from '@nestjs/config';
import type { TypeOrmModuleOptions } from '@nestjs/typeorm';
import type { DataSourceOptions } from 'typeorm';
import { defaults as pgDefaults, types } from 'pg';
import {
  currentDialect,
  parseDialect,
  registerPostgresTypeParsers,
} from '@cybedefend/db-dialect';
import type { Dialect } from '@cybedefend/db-dialect';
import { isCommunityEdition } from '../../edition/edition';
import { editionMigrations } from '../../edition/edition-migrations';
import type SecretsService from '../secrets/secrets.service';

/**
 * The one factory that builds every TypeORM options object of this service:
 * the Nest contexts (API, the two workers, the two report crons, and the
 * closed cron-osv, cron-epss and autofix worker), the CLI
 * data source (src/core/config/data-source.ts) and the live-test helper
 * (live-database.ts). On `mysql` it returns exactly the objects the service
 * had before the two-engine split; on `postgres` the PostgreSQL options of
 * the Community Edition.
 *
 * This file is loaded by the TypeORM CLI through data-source.ts, so it
 * imports nothing that loads Nest: the Nest classes above are type-only.
 */

/** src/ (dist/ once compiled), the root of today's `__dirname` globs. */
export const ROOT = join(__dirname, '..', '..');

export interface DbConnection {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  /** undefined when DB_SSL_ENABLED is not 'true' */
  ssl?: { ca: string; cert?: string; key?: string };
  /** the ConfigService NODE_ENV, decides migrationsRun as today */
  nodeEnv?: string;
}

export type DbContext =
  | 'api'
  | 'worker'
  | 'worker-reports'
  | 'cron-report-mail'
  | 'cron-report-retention'
  | 'cron-osv'
  | 'cron-epss'
  | 'worker-autofix'
  | 'cli'
  | 'live';

/** The MySQL connectionLimit of each context, or 10 where none is set. */
export const DB_POOL_SIZE: Record<DbContext, number> = {
  api: 20,
  worker: 24,
  'worker-reports': 5,
  'cron-report-mail': 10,
  'cron-report-retention': 10,
  'cron-osv': 16,
  'cron-epss': 10,
  'worker-autofix': 10,
  cli: 10,
  live: 20,
};

/**
 * Closed contexts: never ported to PostgreSQL, never run by the
 * Community Edition.
 */
const MYSQL_ONLY_CONTEXTS: ReadonlySet<DbContext> = new Set<DbContext>([
  'cron-osv',
  'cron-epss',
  'worker-autofix',
]);

const ENTITIES_GLOB = `${ROOT}/**/*.entity{.ts,.js}`;
const MIGRATIONS_GLOB = `${ROOT}/core/migrations/*{.ts,.js}`;
const CLI_ENTITIES_GLOB = join(ROOT, '**/*.entity.{ts,js}');
const CLI_MIGRATIONS_GLOB = join(ROOT, 'core/migrations/*.{ts,js}');
/**
 * The live helper's default entities: the 33 core entity files of
 * src/entities/ (never src/ee/, never a spec file next to them).
 */
export const LIVE_ENTITIES_GLOB = `${ROOT}/entities/**/*.entity{.ts,.js}`;

/**
 * Today's secret reads of every context's TypeORM factory, moved without
 * change of behaviour: same secret keys, same TypeError messages, client
 * cert and key only when both are set.
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
    throw new TypeError(`Invalid port number: ${portStr}`);
  }

  const sslEnabled = String(config.get<string>('DB_SSL_ENABLED')) === 'true';
  const sslCa = sslEnabled ? secrets.getSecret('DB_SSL_CA_CERT') : undefined;
  const sslCert = sslEnabled
    ? secrets.getSecret('DB_SSL_CLIENT_CERT')
    : undefined;
  const sslKey = sslEnabled
    ? secrets.getSecret('DB_SSL_CLIENT_KEY')
    : undefined;
  // Only the CA is mandatory: the server certificate is always verified
  // against it. A client certificate is optional, since TLS negotiates
  // without one and some managed databases issue only a CA; demanding the
  // ca+cert+key triplet would refuse to boot against them.
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

/** The CLI: DB_HOST/DB_PORT/DB_USERNAME/DB_PASSWORD/DB_DATABASE from the env. */
export function connectionFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): DbConnection {
  const dialect = parseDialect(env.DB_TYPE);
  const defaults =
    dialect === 'postgres'
      ? { port: 5432, username: 'postgres', password: 'postgres' }
      : { port: 3308, username: 'user', password: 'password' };
  const port =
    env.DB_PORT !== undefined && env.DB_PORT !== ''
      ? Number(env.DB_PORT)
      : defaults.port;
  if (Number.isNaN(port)) {
    throw new TypeError(`Invalid port number: ${env.DB_PORT}`);
  }
  return {
    host: env.DB_HOST ?? 'localhost',
    port,
    username: env.DB_USERNAME ?? defaults.username,
    password: env.DB_PASSWORD ?? defaults.password,
    database: env.DB_DATABASE ?? 'cybedefend_analysis_and_reporting',
  };
}

/** The Community Edition runs on PostgreSQL only. */
export function assertDialectAllowed(dialect: Dialect): void {
  if (dialect === 'mysql' && isCommunityEdition()) {
    throw new Error(
      'DB_TYPE_NOT_SUPPORTED: DB_TYPE must be postgres in the Community Edition',
    );
  }
}

/**
 * The keys of each context that do not depend on the engine: entities (or
 * autoLoadEntities), synchronize, migrationsRun and whether the context has
 * a `migrations` key at all.
 */
interface ContextShape {
  entities: { autoLoadEntities: true } | { entities: string[] };
  migrationsRun: boolean;
  hasMigrations: boolean;
  /** today's MySQL `extra`, or undefined where the context set none */
  mysqlExtra?: Record<string, unknown>;
}

const MYSQL_POOL = (connectionLimit: number) => ({
  connectionLimit,
  waitForConnections: true,
  queueLimit: 0,
});

function shapeOf(
  context: DbContext,
  nodeEnv: string | undefined,
): ContextShape {
  const migratesOutsideDev = nodeEnv !== 'development';
  const glob = { entities: [ENTITIES_GLOB] };
  switch (context) {
    case 'api':
      // app.module.ts
      return {
        entities: { autoLoadEntities: true },
        migrationsRun: migratesOutsideDev,
        hasMigrations: true,
        mysqlExtra: MYSQL_POOL(20),
      };
    case 'worker':
      // worker.module.ts: ~17 worst-case concurrency + resultsImport 1 job
      // × ≤ 3 statements (~20) + margin → 24. The NEXT queue or concurrency bump must come with a raise of
      // connectionLimit AND MySQL max_connections, together.
      return {
        entities: glob,
        migrationsRun: false,
        hasMigrations: false,
        mysqlExtra: MYSQL_POOL(24),
      };
    case 'worker-reports':
      // worker-reports.module.ts: reports (1) + aggregated reports (1) + margin.
      return {
        entities: glob,
        migrationsRun: false,
        hasMigrations: false,
        mysqlExtra: MYSQL_POOL(5),
      };
    case 'cron-report-mail':
    case 'cron-report-retention':
    case 'cron-epss':
      return {
        entities: glob,
        migrationsRun: migratesOutsideDev,
        hasMigrations: true,
      };
    case 'cron-osv':
      // Per-ecosystem parallelism (OSV_ECOSYSTEM_CONCURRENCY, default 4) runs
      // several ecosystems' writes concurrently.
      return {
        entities: glob,
        migrationsRun: migratesOutsideDev,
        hasMigrations: true,
        mysqlExtra: { connectionLimit: 16, waitForConnections: true },
      };
    case 'worker-autofix':
      return {
        entities: glob,
        migrationsRun: false,
        hasMigrations: false,
        mysqlExtra: MYSQL_POOL(10),
      };
    case 'live':
      // test-utils/results-live-db.ts kept a pool of 20 and UTC.
      return {
        entities: { entities: [LIVE_ENTITIES_GLOB] },
        migrationsRun: false,
        hasMigrations: true,
        mysqlExtra: { connectionLimit: 20 },
      };
    case 'cli':
      return {
        entities: { entities: [CLI_ENTITIES_GLOB] },
        migrationsRun: false,
        hasMigrations: true,
      };
  }
}

export function buildTypeOrmOptions(
  connection: DbConnection,
  opts: { context: DbContext; dialect?: Dialect },
): DataSourceOptions & TypeOrmModuleOptions {
  const dialect = opts.dialect ?? currentDialect();
  assertDialectAllowed(dialect);

  const { host, port, username, password, database } = connection;
  const { context } = opts;

  if (dialect === 'mysql') {
    if (context === 'cli') {
      // today's data-source.ts literal
      return {
        type: 'mysql',
        host,
        port,
        username,
        password,
        database,
        entities: [CLI_ENTITIES_GLOB],
        migrations: editionMigrations(CLI_MIGRATIONS_GLOB, dialect),
        synchronize: false,
      };
    }
    const shape = shapeOf(context, connection.nodeEnv);
    return {
      type: 'mysql',
      host,
      port,
      username,
      password,
      database,
      ...shape.entities,
      synchronize: false,
      migrationsRun: shape.migrationsRun,
      ...(shape.hasMigrations
        ? { migrations: editionMigrations(MIGRATIONS_GLOB, dialect) }
        : {}),
      ssl: connection.ssl
        ? { ...connection.ssl, rejectUnauthorized: true }
        : undefined,
      // Force UTC so JS Date <-> MySQL TIMESTAMP round-trips are not
      // silently shifted by the host TZ (UTC+2 in dev). Without this the
      // agent verdict timestamps end up 2h in the future relative to MySQL's
      // CURRENT_TIMESTAMP-driven columns, which breaks the
      // exploitability_stale comparison.
      timezone: 'Z',
      ...(shape.mysqlExtra ? { extra: shape.mysqlExtra } : {}),
    } as DataSourceOptions & TypeOrmModuleOptions;
  }

  if (MYSQL_ONLY_CONTEXTS.has(context)) {
    throw new Error(`DB_CONTEXT_MYSQL_ONLY ${context}`);
  }

  // postgres: the parsers go on this service's own pg module (under the Jest
  // mapper the library's copy would never reach the driver).
  registerPostgresTypeParsers(types);
  // A `timestamp` column holds UTC (read back by the 1114 parser as UTC): a
  // Date parameter is sent as UTC, never in the host's local time, whose
  // offset a column without time zone would drop.
  pgDefaults.parseInputDatesAsUTC = true;
  // node-postgres checks the host name against the certificate SANs, and
  // some managed PostgreSQL providers issue certificates without any (a
  // connection by IP cannot match them), so host name verification is off.
  // The CA pin still applies (rejectUnauthorized). mysql2 never did this
  // check, so the MySQL connections need no override.
  const ssl = connection.ssl
    ? {
        ...connection.ssl,
        rejectUnauthorized: true,
        checkServerIdentity: () => undefined,
      }
    : undefined;
  // The session time zone is UTC; timestamps are parsed as UTC by the
  // registered parsers. There is no `timezone` key on postgres.
  const extra = { max: DB_POOL_SIZE[context], options: '-c TimeZone=UTC' };
  // The baseline, migrations-common/ once it exists, then the ee PostgreSQL
  // migrations outside the Community Edition.
  const migrations = editionMigrations(MIGRATIONS_GLOB, dialect);

  if (context === 'cli') {
    return {
      type: 'postgres',
      host,
      port,
      username,
      password,
      database,
      entities: [CLI_ENTITIES_GLOB],
      migrations,
      synchronize: false,
      ssl,
      extra,
    };
  }
  const shape = shapeOf(context, connection.nodeEnv);
  return {
    type: 'postgres',
    host,
    port,
    username,
    password,
    database,
    ...shape.entities,
    synchronize: false,
    migrationsRun: shape.migrationsRun,
    ...(shape.hasMigrations ? { migrations } : {}),
    ssl,
    extra,
  } as DataSourceOptions & TypeOrmModuleOptions;
}
