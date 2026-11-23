import { randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import type { DataSourceOptions, Logger as TypeOrmLogger } from 'typeorm';
import { currentDialect, parseDialect } from '@cybedefend/db-dialect';
import type { Dialect } from '@cybedefend/db-dialect';
import { buildTypeOrmOptions } from './typeorm-options';
import type { DbConnection } from './typeorm-options';

/** The service root (`src/` under ts-node, `dist/` once built). */
const ROOT = join(__dirname, '..', '..');

export interface LiveDatabaseOptions {
  /** names the throwaway database `<prefix>_<12 hex>` */
  prefix: string;
  /** `<envPrefix>_LIVE`, `<envPrefix>_MYSQL_LIVE`, `<envPrefix>_MYSQL_URL`, `<envPrefix>_PG_URL` */
  envPrefix: string;
  /** default: the service's core entity glob (never src/ee) */
  entities?: DataSourceOptions['entities'];
  /** merged over the pool options */
  extra?: Record<string, unknown>;
  /** default 'track' */
  migrations?: 'track' | 'none';
  /** default: `liveDialect(envPrefix)` (LIVE_DB_TYPE, or the legacy MySQL flag) */
  dialect?: Dialect;
}

export interface LiveDatabase {
  dataSource: DataSource;
  dialect: Dialect;
  statements: string[];
  drop(): Promise<void>;
}

/** `<p>_LIVE === '1'`, or the legacy `<p>_MYSQL_LIVE === '1'`. */
export function liveEnabled(
  envPrefix: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    env[`${envPrefix}_LIVE`] === '1' || env[`${envPrefix}_MYSQL_LIVE`] === '1'
  );
}

/** The legacy `<p>_MYSQL_LIVE=1` means `LIVE_DB_TYPE=mysql`; otherwise LIVE_DB_TYPE decides. */
export function liveDialect(
  envPrefix?: string,
  env: NodeJS.ProcessEnv = process.env,
): Dialect {
  if (envPrefix && env[`${envPrefix}_MYSQL_LIVE`] === '1') return 'mysql';
  return parseDialect(env.LIVE_DB_TYPE);
}

/** `<p>_MYSQL_URL` on mysql, `<p>_PG_URL` on postgres, else the CI defaults. */
export function liveUrl(
  envPrefix: string,
  dialect: Dialect,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (dialect === 'mysql') {
    return (
      env[`${envPrefix}_MYSQL_URL`] ?? 'mysql://root:password@127.0.0.1:3308'
    );
  }
  return (
    env[`${envPrefix}_PG_URL`] ?? 'postgres://postgres:postgres@127.0.0.1:5432'
  );
}

function postgresBaselineFiles(): string[] {
  try {
    return readdirSync(join(ROOT, 'core/migrations-postgres')).filter((f) =>
      /\.(ts|js)$/.test(f),
    );
  } catch {
    return [];
  }
}

/**
 * A throwaway database for the live specs, built by the real migrations of
 * the service's track (never `synchronize`) and dropped by `drop()`. It
 * never touches an existing database: the name is `<prefix>_<random>` and
 * only that one is dropped. `statements` records every statement the data
 * source runs after the migrations.
 */
export async function createLiveDatabase(
  opts: LiveDatabaseOptions,
): Promise<LiveDatabase> {
  const dialect = opts.dialect ?? liveDialect(opts.envPrefix);
  // The decorators were applied for DB_TYPE; with no entity (the schema-parity
  // spec opens both engines in one process) they are never used.
  const noEntities = Array.isArray(opts.entities) && opts.entities.length === 0;
  if (!noEntities && dialect !== currentDialect()) {
    throw new Error(
      `LIVE_DIALECT_MISMATCH: LIVE_DB_TYPE=${dialect} but the entities were ` +
        `decorated for ${currentDialect()} (DB_TYPE); set LIVE_DB_TYPE=${currentDialect()} ` +
        `or DB_TYPE=${dialect}`,
    );
  }
  const migrationsMode = opts.migrations ?? 'track';
  if (
    dialect === 'postgres' &&
    migrationsMode === 'track' &&
    postgresBaselineFiles().length === 0
  ) {
    throw new Error(
      'LIVE_POSTGRES_BASELINE_MISSING: src/core/migrations-postgres/ has no migration yet (the baseline task has not landed)',
    );
  }

  const url = new URL(liveUrl(opts.envPrefix, dialect));
  const connection: DbConnection = {
    host: url.hostname,
    port: Number(url.port || (dialect === 'postgres' ? 5432 : 3306)),
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    // The admin connection only creates and drops the throwaway database; on
    // PostgreSQL it needs a database to connect to, mysql uses the system one.
    database:
      dialect === 'postgres'
        ? url.pathname && url.pathname !== '/'
          ? decodeURIComponent(url.pathname.slice(1))
          : 'postgres'
        : 'mysql',
  };
  const database = `${opts.prefix}_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  // The admin connection loads no entity: it only creates and drops the
  // database, and the entities may be decorated for the other engine.
  const admin = await new DataSource({
    ...buildTypeOrmOptions(connection, { context: 'live', dialect }),
    entities: [],
  }).initialize();
  await admin.query(
    dialect === 'mysql'
      ? `CREATE DATABASE \`${database}\``
      : `CREATE DATABASE "${database}"`,
  );

  const statements: string[] = [];
  const recorder: TypeOrmLogger = {
    logQuery: (query) => {
      statements.push(query);
    },
    logQueryError: () => undefined,
    logQuerySlow: () => undefined,
    logSchemaBuild: () => undefined,
    logMigration: () => undefined,
    log: () => undefined,
  };
  const options = buildTypeOrmOptions(
    { ...connection, database },
    { context: 'live', dialect },
  );
  const dataSource = await new DataSource({
    ...options,
    entities: opts.entities ?? [join(ROOT, 'entities/*.entity{.ts,.js}')],
    logging: true,
    logger: recorder,
    migrationsRun: false,
    extra: { ...(options.extra as Record<string, unknown>), ...opts.extra },
  } as DataSourceOptions).initialize();
  if (migrationsMode === 'track') {
    await dataSource.runMigrations();
    statements.length = 0;
  }

  return {
    dataSource,
    dialect,
    statements,
    drop: async () => {
      await dataSource.destroy();
      await admin.query(
        dialect === 'mysql'
          ? `DROP DATABASE IF EXISTS \`${database}\``
          : `DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`,
      );
      await admin.destroy();
    },
  };
}
