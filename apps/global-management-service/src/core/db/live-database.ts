import { randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DataSource, Logger as TypeOrmLogger } from 'typeorm';
import type { DataSourceOptions } from 'typeorm';
import {
  currentDialect,
  dialectApi,
  parseDialect,
  run,
  type Dialect,
} from '@cybedefend/db-dialect';
import {
  buildTypeOrmOptions,
  LIVE_ENTITIES_GLOB,
  type DbConnection,
} from './typeorm-options';

/** The service root (`src/`), where the entity and migration globs point. */
const ROOT = join(__dirname, '..', '..');

export interface LiveDatabaseOptions {
  /** names the throwaway database `<prefix>_<12 hex>` */
  prefix: string;
  /** `<envPrefix>_LIVE`, `<envPrefix>_MYSQL_URL`, `<envPrefix>_PG_URL` */
  envPrefix: string;
  /** default: the service's core entity glob (never src/ee) */
  entities?: DataSourceOptions['entities'];
  /** merged over the pool options, e.g. `{ connectionLimit: 20 }` on mysql */
  extra?: Record<string, unknown>;
  /** default 'track': build the schema by running the migrations, never synchronize */
  migrations?: 'track' | 'none';
  /** default: `liveDialect(envPrefix)` (LIVE_DB_TYPE, or the legacy MySQL flag) */
  dialect?: Dialect;
}

export interface LiveDatabase {
  dataSource: DataSource;
  dialect: Dialect;
  statements: string[];
  drop: () => Promise<void>;
}

/**
 * The engine of a live spec: the legacy `<envPrefix>_MYSQL_LIVE=1` flag stays
 * accepted and means `LIVE_DB_TYPE=mysql` (older commands keep working);
 * otherwise LIVE_DB_TYPE decides, mysql by default.
 */
export function liveDialect(
  envPrefix?: string,
  env: NodeJS.ProcessEnv = process.env,
): Dialect {
  if (envPrefix && env[`${envPrefix}_MYSQL_LIVE`] === '1') return 'mysql';
  return parseDialect(env.LIVE_DB_TYPE);
}

export function liveEnabled(
  envPrefix: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    env[`${envPrefix}_LIVE`] === '1' || env[`${envPrefix}_MYSQL_LIVE`] === '1'
  );
}

/** `<envPrefix>_MYSQL_URL` / `<envPrefix>_PG_URL`, else the documented defaults. */
export function liveUrl(
  envPrefix: string,
  dialect: Dialect,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (dialect === 'postgres') {
    return (
      env[`${envPrefix}_PG_URL`] ??
      'postgres://postgres:postgres@127.0.0.1:5432'
    );
  }
  return (
    env[`${envPrefix}_MYSQL_URL`] ?? 'mysql://root:password@127.0.0.1:3308'
  );
}

/**
 * A throwaway database for the `<envPrefix>_LIVE=1` specs, built by the real
 * migrations of the service on the engine LIVE_DB_TYPE selects, and dropped by
 * `drop()`. It never touches an existing database: the name is
 * `<prefix>_<random>` and only that one is dropped.
 *
 * `statements` records every statement the data source runs, so a spec can
 * count the SELECTs a call issues.
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

  const track = opts.migrations ?? 'track';
  if (dialect === 'postgres' && track === 'track') {
    // Without a baseline, migrations-postgres/ is empty:
    // refuse before creating anything.
    let files: string[] = [];
    try {
      files = readdirSync(join(ROOT, 'core', 'migrations-postgres'));
    } catch {
      files = [];
    }
    if (!files.some((f) => f.endsWith('.ts') || f.endsWith('.js'))) {
      throw new Error(
        'LIVE_POSTGRES_BASELINE_MISSING: src/core/migrations-postgres/ has no ' +
          "baseline yet; run the spec on mysql or with migrations: 'none'",
      );
    }
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
  const quotedDatabase = dialectApi(dialect).ident(database).text;
  await admin.query(`CREATE DATABASE ${quotedDatabase}`);

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
    entities: opts.entities ?? [LIVE_ENTITIES_GLOB],
    migrationsRun: false,
    logging: ['query'],
    logger: recorder,
    ...(opts.extra
      ? {
          extra: {
            ...((options.extra as Record<string, unknown> | undefined) ?? {}),
            ...opts.extra,
          },
        }
      : {}),
  }).initialize();
  if (track === 'track') {
    await dataSource.runMigrations();
  }
  statements.length = 0;

  return {
    dataSource,
    dialect,
    statements,
    drop: async () => {
      await dataSource.destroy();
      await admin.query(
        `DROP DATABASE IF EXISTS ${quotedDatabase}${dialect === 'postgres' ? ' WITH (FORCE)' : ''}`,
      );
      await admin.destroy();
    },
  };
}

/** The SELECT statements among recorded ones. */
export const liveSelects = (statements: string[]) =>
  statements.filter((s) => /^\s*SELECT/i.test(s));

/**
 * Inserts fixture rows on either engine, identifiers quoted and values
 * bound: a live spec's `INSERT … VALUES (?, ?)` with unquoted camelCase
 * columns only runs on MySQL. Every row has the keys of the first one.
 */
export async function insertRows(
  live: Pick<LiveDatabase, 'dataSource' | 'dialect'>,
  table: string,
  rows: Record<string, unknown>[],
): Promise<void> {
  if (rows.length === 0) return;
  const db = dialectApi(live.dialect);
  const keys = Object.keys(rows[0]);
  const columns = keys
    .map((k) => db.ident(k))
    .reduce((acc, c) => db.sql`${acc}, ${c}`);
  for (let i = 0; i < rows.length; i += 500) {
    const values = rows
      .slice(i, i + 500)
      .map((row) => db.inList(keys.map((k) => row[k])))
      .reduce((acc, v) => db.sql`${acc}, ${v}`);
    await run(
      live.dataSource,
      db.sql`INSERT INTO ${db.ident(table)} (${columns}) VALUES ${values}`,
    );
  }
}
