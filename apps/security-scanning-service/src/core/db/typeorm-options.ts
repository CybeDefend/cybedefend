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
 * the API context (app.module.ts, inherited by the cron context), the CLI
 * data source (src/core/config/data-source.ts) and the live-test helper
 * (live-database.ts). On `mysql` it returns exactly the objects the service
 * had before the two-engine split; on `postgres` the Community Edition
 * contract.
 *
 * This file is loaded by the TypeORM CLI through data-source.ts, so it
 * imports nothing that loads Nest: the Nest classes below are type-only.
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
  /** the ConfigService NODE_ENV, decides migrationsRun and logging as today */
  nodeEnv?: string;
}

export type DbContext = 'api' | 'cli' | 'live';

/** The MySQL connectionLimit of each context, or 10 where none is set. */
export const DB_POOL_SIZE: Record<DbContext, number> = {
  api: 10,
  cli: 10,
  live: 10,
};

const API_ENTITIES_GLOB = `${ROOT}/**/*.entity{.ts,.js}`;
const CLI_ENTITIES_GLOB = join(ROOT, '**/*.entity.{ts,js}');

/** The MySQL migration glob of each context, byte-identical to today's. */
const MYSQL_MIGRATIONS_GLOB: Record<DbContext, string> = {
  api: `${ROOT}/core/migrations/*{.ts,.js}`,
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
 * Today's secret reads of app.module.ts, moved without change of behaviour:
 * same secret keys, same TypeError messages, client cert and key only when
 * both are set.
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
  // Only the CA is mandatory. A client certificate is NOT required to speak
  // TLS to the database; the client cert and key are used only when both are
  // set.
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
    throw new TypeError(`Invalid port number`);
  }
  return {
    host: env.DB_HOST ?? 'localhost',
    port,
    username: env.DB_USERNAME ?? defaults.username,
    password: env.DB_PASSWORD ?? defaults.password,
    database: env.DB_DATABASE ?? 'cybedefend_scanning',
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

const loggingOf = (): Array<'migration' | 'error'> =>
  process.env.NODE_ENV === 'development' ? ['migration', 'error'] : ['error'];

export function buildTypeOrmOptions(
  connection: DbConnection,
  opts: { context: DbContext; dialect?: Dialect },
): DataSourceOptions & TypeOrmModuleOptions {
  const dialect = opts.dialect ?? currentDialect();
  assertDialectAllowed(dialect);

  const { host, port, username, password, database } = connection;

  if (dialect === 'mysql') {
    if (opts.context === 'cli') {
      return {
        type: 'mysql',
        host,
        port,
        username,
        password,
        database,
        entities: [CLI_ENTITIES_GLOB],
        migrations: migrationsFor(opts.context, dialect),
        synchronize: false,
      };
    }
    // 'api' and 'live': today's object of app.module.ts (the cron context
    // inherits AppModule).
    return {
      type: 'mysql',
      host,
      port,
      username,
      password,
      database,
      entities: [API_ENTITIES_GLOB],
      synchronize: false,
      migrationsRun: connection.nodeEnv !== 'development',
      migrations: migrationsFor(opts.context, dialect),
      ssl: connection.ssl
        ? { ...connection.ssl, rejectUnauthorized: true }
        : undefined,
      logging: loggingOf(),
    };
  }

  // postgres: the parsers go on this service's own pg module (under the Jest
  // mapper the library's copy would never reach the driver).
  registerPostgresTypeParsers(types);
  // node-postgres sends a JavaScript Date in the host's local time with its
  // offset, and a `timestamp` column (without time zone) drops the offset, so
  // every instant would be stored shifted on a non-UTC host: write
  // Dates as UTC instead.
  pgDefaults.parseInputDatesAsUTC = true;
  // node-postgres checks the host name against the certificate SANs, and
  // some managed providers issue certificates without a SAN for the host
  // (see policy-management-service/src/core/config/typeorm-options.ts); the
  // CA is still verified. mysql2 never did this check, so the MySQL services
  // need no override.
  const ssl = connection.ssl
    ? {
        ...connection.ssl,
        rejectUnauthorized: true,
        checkServerIdentity: () => undefined,
      }
    : undefined;
  const extra = {
    max: DB_POOL_SIZE[opts.context],
    options: '-c TimeZone=UTC',
  };

  if (opts.context === 'cli') {
    return {
      type: 'postgres',
      host,
      port,
      username,
      password,
      database,
      entities: [CLI_ENTITIES_GLOB],
      migrations: migrationsFor(opts.context, dialect),
      synchronize: false,
      extra,
      ssl,
    };
  }
  return {
    type: 'postgres',
    host,
    port,
    username,
    password,
    database,
    entities: [API_ENTITIES_GLOB],
    synchronize: false,
    migrationsRun: connection.nodeEnv !== 'development',
    migrations: migrationsFor(opts.context, dialect),
    extra,
    ssl,
    logging: loggingOf(),
  };
}
