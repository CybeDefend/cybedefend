import type { ConfigService } from '@nestjs/config';
import type { TypeOrmModuleOptions } from '@nestjs/typeorm';
import type { DataSourceOptions } from 'typeorm';
import { join } from 'node:path';
import { defaults as pgDefaults, types } from 'pg';
import {
  currentDialect,
  parseDialect,
  registerPostgresTypeParsers,
} from '@cybedefend/db-dialect';
import type { Dialect } from '@cybedefend/db-dialect';
import { currentEdition } from '../../edition/edition';
import { editionMigrations } from '../../edition/edition-migrations';
import type SecretsService from '../secrets/secrets.service';

/** The service root (`src/` under ts-node, `dist/` once built). */
const ROOT = join(__dirname, '..', '..');

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

export type DbContext = 'api' | 'cli' | 'live';

/** MySQL connectionLimit per context (none was set, so mysql2's default 10); reused as the postgres `extra.max`. */
export const DB_POOL_SIZE: Record<DbContext, number> = {
  api: 10,
  cli: 10,
  live: 10,
};

/**
 * Today's secret reads of the TypeORM factory, moved without change of
 * behaviour: same secret keys, same TypeError messages, client cert and key
 * only when both are set.
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
  // TLS to the database: --ssl-mode=REQUIRED with no client certificate
  // negotiates TLS. Some providers publish only the CA, so demanding the
  // ca+cert+key triplet would crash-loop the service the moment TLS
  // switches on.
  let ssl: DbConnection['ssl'];
  if (sslEnabled) {
    if (!sslCa) {
      throw new TypeError(
        'DB_SSL_ENABLED=true but DB_SSL_CA_CERT is missing from secrets',
      );
    }
    ssl = {
      ca: sslCa,
      ...(sslCert && sslKey ? { cert: sslCert, key: sslKey } : {}),
    };
  }

  return {
    host,
    port,
    username,
    password,
    database,
    ssl,
    nodeEnv: config.get<string>('NODE_ENV'),
  };
}

/**
 * The CLI data source: DB_HOST/DB_PORT/DB_USERNAME/DB_PASSWORD/DB_DATABASE,
 * defaulting to today's data-source values on mysql and to the postgres
 * bootstrap on postgres.
 */
export function connectionFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): DbConnection {
  const dialect = parseDialect(env.DB_TYPE);
  const defaults =
    dialect === 'postgres'
      ? {
          host: 'localhost',
          port: 5432,
          username: 'postgres',
          password: 'postgres',
        }
      : {
          host: 'localhost',
          port: 3308,
          username: 'user',
          password: 'password',
        };
  return {
    host: env.DB_HOST ?? defaults.host,
    port: Number(env.DB_PORT ?? defaults.port),
    username: env.DB_USERNAME ?? defaults.username,
    password: env.DB_PASSWORD ?? defaults.password,
    database: env.DB_DATABASE ?? 'cybedefend_file_management',
  };
}

/** The Community Edition runs on PostgreSQL only. */
export function assertDialectAllowed(dialect: Dialect): void {
  if (currentEdition() === 'community' && dialect === 'mysql') {
    throw new Error(
      'DB_TYPE_NOT_SUPPORTED: DB_TYPE must be postgres in the Community Edition',
    );
  }
}

/**
 * The one factory for every TypeORM options object of this service (Nest
 * contexts, the CLI data source, the live-test helper). On `mysql` it
 * returns exactly today's object per context; on `postgres` the PostgreSQL
 * options object.
 */
export function buildTypeOrmOptions(
  connection: DbConnection,
  opts: { context: DbContext; dialect?: Dialect },
): DataSourceOptions & TypeOrmModuleOptions {
  const dialect = opts.dialect ?? currentDialect();
  assertDialectAllowed(dialect);
  const { context } = opts;

  const entities =
    context === 'cli'
      ? [join(ROOT, '**/*.entity.{ts,js}')]
      : [`${ROOT}/**/*.entity{.ts,.js}`];
  // mysql: the frozen MySQL track, migrations-common/ once it exists, the ee
  // MySQL migrations; postgres: the baseline, migrations-common/ once it
  // exists, the ee PostgreSQL migrations.
  const migrations = editionMigrations(
    context === 'cli'
      ? join(ROOT, 'core/migrations/*.{ts,js}')
      : `${ROOT}/core/migrations/*{.ts,.js}`,
    dialect,
  );

  const common: Record<string, unknown> = {
    host: connection.host,
    port: connection.port,
    username: connection.username,
    password: connection.password,
    database: connection.database,
    entities,
    synchronize: false,
  };
  if (context === 'api') {
    common.migrationsRun = connection.nodeEnv !== 'development';
    common.migrations = migrations;
  } else if (context === 'cli') {
    common.migrations = migrations;
  } else {
    // live: the helper runs the migrations itself, never on initialize
    common.migrationsRun = false;
    common.migrations = migrations;
  }

  if (dialect === 'mysql') {
    return {
      type: 'mysql',
      ...common,
      ssl: connection.ssl
        ? { ...connection.ssl, rejectUnauthorized: true }
        : undefined,
    } as DataSourceOptions & TypeOrmModuleOptions;
  }

  // The parsers are registered on this service's own pg module (the library
  // never require()s a driver itself, so the service's driver is the one
  // TypeORM loads). node-postgres otherwise sends a JavaScript Date in the
  // host's local time with its offset, and a `timestamp` column drops the
  // offset: every instant would be stored shifted on a non-UTC host.
  pgDefaults.parseInputDatesAsUTC = true;
  registerPostgresTypeParsers(types);
  return {
    type: 'postgres',
    ...common,
    extra: { max: DB_POOL_SIZE[context], options: '-c TimeZone=UTC' },
    // node-postgres checks the host name against the certificate's SAN;
    // some managed providers issue certificates without a SAN for the host,
    // so the check is disabled (as in policy-management-service, which
    // already runs on PostgreSQL). The CA chain is still verified.
    ssl: connection.ssl
      ? {
          ...connection.ssl,
          rejectUnauthorized: true,
          checkServerIdentity: () => undefined,
        }
      : undefined,
  } as DataSourceOptions & TypeOrmModuleOptions;
}
