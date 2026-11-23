import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import type { DataSourceOptions, Logger as TypeOrmLogger } from 'typeorm';
import { currentDialect, parseDialect } from '@cybedefend/db-dialect';
import type { Dialect } from '@cybedefend/db-dialect';
import { buildTypeOrmOptions, ROOT } from './typeorm-options';

/**
 * A throwaway database for the `<envPrefix>_LIVE=1` specs, schema built by
 * the real migrations (never `synchronize`) on either engine, dropped by
 * `drop()`. The engine comes from LIVE_DB_TYPE (mysql by default); the
 * legacy `<envPrefix>_MYSQL_LIVE=1` flag pins mysql so older commands keep
 * working.
 *
 * `statements` records every statement the data source runs after the
 * migrations, so a spec can count the SELECTs a call issues.
 */
export interface LiveDatabaseOptions {
  /** names the throwaway database `<prefix>_<12 hex>` */
  prefix: string;
  /** `<envPrefix>_LIVE`, `<envPrefix>_MYSQL_URL`, `<envPrefix>_PG_URL` */
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

export function liveEnabled(
  envPrefix: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    env[`${envPrefix}_LIVE`] === '1' || env[`${envPrefix}_MYSQL_LIVE`] === '1'
  );
}

export function liveDialect(
  envPrefix?: string,
  env: NodeJS.ProcessEnv = process.env,
): Dialect {
  if (envPrefix && env[`${envPrefix}_MYSQL_LIVE`] === '1') return 'mysql';
  return parseDialect(env.LIVE_DB_TYPE);
}

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

const DEFAULT_ENTITIES = [join(ROOT, 'entities/*.entity.ts')];

function postgresBaselinePresent(): boolean {
  const dir = join(ROOT, 'core/migrations-postgres');
  if (!fs.existsSync(dir)) return false;
  return fs
    .readdirSync(dir)
    .some((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'));
}

export async function createLiveDatabase(
  opts: LiveDatabaseOptions,
): Promise<LiveDatabase> {
  const dialect = opts.dialect ?? liveDialect(opts.envPrefix);
  // The decorators were applied for DB_TYPE; with no entity (the schema-parity
  // spec opens both engines in one process) they are never used.
  const noEntities = Array.isArray(opts.entities) && opts.entities.length === 0;
  const decorated = currentDialect();
  if (!noEntities && dialect !== decorated) {
    throw new Error(
      `LIVE_DIALECT_MISMATCH: LIVE_DB_TYPE=${dialect} but DB_TYPE=${decorated} (the entities were decorated for the other engine)`,
    );
  }
  const migrations = opts.migrations ?? 'track';
  if (
    dialect === 'postgres' &&
    migrations === 'track' &&
    !postgresBaselinePresent()
  ) {
    throw new Error(
      'LIVE_POSTGRES_BASELINE_MISSING: core/migrations-postgres holds no baseline yet',
    );
  }

  const url = new URL(liveUrl(opts.envPrefix, dialect));
  const host = url.hostname;
  const port = Number(url.port || (dialect === 'postgres' ? 5432 : 3306));
  const username = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);

  const database = `${opts.prefix}_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  // The admin connection loads no entity: it only creates and drops the
  // throwaway database, and the entities may be decorated for the other engine.
  const admin = await new DataSource({
    type: dialect,
    host,
    port,
    username,
    password,
    ...(dialect === 'postgres' ? { database: 'postgres' } : {}),
    entities: [],
  } as DataSourceOptions).initialize();
  await admin.query(
    dialect === 'postgres'
      ? `CREATE DATABASE "${database}"`
      : `CREATE DATABASE \`${database}\``,
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
  const base = buildTypeOrmOptions(
    { host, port, username, password, database },
    { context: 'live', dialect },
  ) as unknown as Record<string, unknown>;
  const baseExtra = (base.extra ?? {}) as Record<string, unknown>;
  const dataSource = await new DataSource({
    ...base,
    entities: opts.entities ?? DEFAULT_ENTITIES,
    migrationsRun: false,
    logging: ['query'],
    logger: recorder,
    ...(opts.extra || Object.keys(baseExtra).length > 0
      ? { extra: { ...baseExtra, ...(opts.extra ?? {}) } }
      : {}),
  } as DataSourceOptions).initialize();
  if (migrations === 'track') {
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
        dialect === 'postgres'
          ? `DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`
          : `DROP DATABASE IF EXISTS \`${database}\``,
      );
      await admin.destroy();
    },
  };
}
