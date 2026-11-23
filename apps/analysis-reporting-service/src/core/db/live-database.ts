import { randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import type { DataSourceOptions, Logger as TypeOrmLogger } from 'typeorm';
import {
  currentDialect,
  dialectApi,
  parseDialect,
} from '@cybedefend/db-dialect';
import type { Dialect } from '@cybedefend/db-dialect';
import {
  buildTypeOrmOptions,
  LIVE_ENTITIES_GLOB,
  ROOT,
} from './typeorm-options';
import type { DbConnection } from './typeorm-options';

export interface LiveDatabaseOptions {
  /** names the throwaway database `<prefix>_<12 hex>` */
  prefix: string;
  /** `<envPrefix>_LIVE`, `<envPrefix>_MYSQL_URL`, `<envPrefix>_PG_URL` */
  envPrefix: string;
  /**
   * read when `<envPrefix>_MYSQL_URL` / `<envPrefix>_PG_URL` is unset, before
   * the defaults: lets specs that share one server URL variable (the
   * `RESULTS_LIVE_MYSQL_URL` of the result live specs) keep it.
   */
  fallbackEnvPrefix?: string;
  /** default: the service's core entity glob (never src/ee) */
  entities?: DataSourceOptions['entities'];
  /** merged over the pool options, e.g. `{ connectionLimit: 20 }` on mysql */
  extra?: Record<string, unknown>;
  /** default 'track': build the schema by running the migrations, never synchronize */
  migrations?: 'track' | 'none';
  /** also receives every statement run after the migrations */
  logger?: TypeOrmLogger;
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
 * accepted and means `LIVE_DB_TYPE=mysql` (older commands
 * keep working); otherwise LIVE_DB_TYPE decides, mysql by default.
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

const urlVariable = (envPrefix: string, dialect: Dialect) =>
  `${envPrefix}_${dialect === 'postgres' ? 'PG' : 'MYSQL'}_URL`;

/** `<envPrefix>_MYSQL_URL` / `<envPrefix>_PG_URL`, else the documented defaults. */
export function liveUrl(
  envPrefix: string,
  dialect: Dialect,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const own = env[urlVariable(envPrefix, dialect)];
  if (own !== undefined) return own;
  return dialect === 'postgres'
    ? 'postgres://postgres:postgres@127.0.0.1:5432'
    : 'mysql://root:password@127.0.0.1:3308';
}

function baselinePresent(): boolean {
  let files: string[] = [];
  try {
    files = readdirSync(join(ROOT, 'core', 'migrations-postgres'));
  } catch {
    files = [];
  }
  return files.some(
    (f) => (f.endsWith('.ts') || f.endsWith('.js')) && !f.endsWith('.spec.ts'),
  );
}

/**
 * A throwaway database for the `<envPrefix>_LIVE=1` specs, built by the real
 * migrations of the service on the engine LIVE_DB_TYPE selects, and dropped by
 * `drop()`. It never touches an existing database: the name is
 * `<prefix>_<random>` and only that one is dropped.
 *
 * `statements` records every statement the data source runs after the
 * migrations, so a spec can count the SELECTs a call issues.
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
  if (dialect === 'postgres' && track === 'track' && !baselinePresent()) {
    // Without its baseline, migrations-postgres/ is empty: refuse
    // before creating anything.
    throw new Error(
      'LIVE_POSTGRES_BASELINE_MISSING: src/core/migrations-postgres/ has no ' +
        "baseline yet; run the spec on mysql or with migrations: 'none'",
    );
  }

  const fallback = opts.fallbackEnvPrefix
    ? process.env[urlVariable(opts.fallbackEnvPrefix, dialect)]
    : undefined;
  const url = new URL(
    process.env[urlVariable(opts.envPrefix, dialect)] ??
      fallback ??
      liveUrl(opts.envPrefix, dialect),
  );
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
  const dropStatement = `DROP DATABASE IF EXISTS ${quotedDatabase}${
    dialect === 'postgres' ? ' WITH (FORCE)' : ''
  }`;
  await admin.query(`CREATE DATABASE ${quotedDatabase}`);

  const statements: string[] = [];
  let recording = false;
  const delegate = opts.logger;
  const recorder: TypeOrmLogger = {
    logQuery: (query, parameters, runner) => {
      if (!recording) return;
      statements.push(query);
      delegate?.logQuery(query, parameters, runner);
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
  let dataSource: DataSource;
  try {
    dataSource = await new DataSource({
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
    } as DataSourceOptions).initialize();
    if (track === 'track') {
      await dataSource.runMigrations();
    }
  } catch (err) {
    await admin.query(dropStatement);
    await admin.destroy();
    throw err;
  }
  recording = true;

  return {
    dataSource,
    dialect,
    statements,
    drop: async () => {
      await dataSource.destroy();
      await admin.query(dropStatement);
      await admin.destroy();
    },
  };
}
