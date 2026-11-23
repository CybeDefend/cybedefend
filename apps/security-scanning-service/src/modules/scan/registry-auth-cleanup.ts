/**
 * One-off removal of the registry credentials left on scans that are no longer
 * queued (`scripts/clear-scan-registry-auth.ts`). Before the fix, nothing
 * removed a queued container scan's `metadata.registryAuth` once the scan left
 * the queue (registry-auth-retention.ts). Kept under `src/` so the service's
 * ordinary jest run covers it: `scripts/` is outside jest's `rootDir` and out
 * of the build (`tsconfig.build.json`).
 *
 * It only ever reads counts and scan ids, never the metadata: no credential,
 * encrypted or not, can reach its output.
 */
import {
  REGISTRY_AUTH_JSON_PATH,
  REMOVE_REGISTRY_AUTH_SQL,
} from './registry-auth-retention';

/** The one call the cleanup makes: mysql2's `query`, rows or result header. */
export interface RegistryAuthCleanupDb {
  query(sql: string, params?: unknown[]): Promise<unknown>;
}

export interface RegistryAuthCleanupReport {
  /** Rows outside the queue that held credentials when the run started. */
  outsideQueue: { encrypted: number; notEncrypted: number };
  /** Queued rows holding credentials: kept, the dequeue still reads them. */
  queued: number;
  cleared: number;
  /** Rows outside the queue still holding credentials when the run ended. */
  remaining: number;
  exitCode: 0 | 1;
}

const HOLDS_REGISTRY_AUTH = `JSON_CONTAINS_PATH(\`metadata\`, 'one', '${REGISTRY_AUTH_JSON_PATH}')`;
const IS_ENCRYPTED = `COALESCE(JSON_EXTRACT(\`metadata\`, '${REGISTRY_AUTH_JSON_PATH}.__encrypted') = CAST('true' AS JSON), 0)`;

const COUNT_SQL = `SELECT \`state\`, SUM(${IS_ENCRYPTED}) AS encrypted, SUM(1 - ${IS_ENCRYPTED}) AS notEncrypted FROM \`scan\` WHERE ${HOLDS_REGISTRY_AUTH} GROUP BY \`state\` ORDER BY \`state\``;
const LIST_SQL = `SELECT \`id\` FROM \`scan\` WHERE \`state\` <> 'queued' AND ${HOLDS_REGISTRY_AUTH} ORDER BY \`id\``;
// `updatedAt = updatedAt` keeps the row's ON UPDATE timestamp as it was: the
// scan itself did not change. The WHERE is checked again on the locked row,
// so a scan queued since the list was read keeps its credentials.
const CLEAR_SQL = `UPDATE \`scan\` SET \`metadata\` = ${REMOVE_REGISTRY_AUTH_SQL}, \`updatedAt\` = \`updatedAt\` WHERE \`id\` IN (?) AND \`state\` <> 'queued' AND ${HOLDS_REGISTRY_AUTH}`;

const DEFAULT_BATCH_SIZE = 500;

interface StateCount {
  state: string;
  encrypted: number;
  notEncrypted: number;
}

async function countPerState(db: RegistryAuthCleanupDb): Promise<StateCount[]> {
  const rows = (await db.query(COUNT_SQL)) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    state: String(row.state),
    // mysql2 answers SUM() as a DECIMAL string.
    encrypted: Number(row.encrypted ?? 0),
    notEncrypted: Number(row.notEncrypted ?? 0),
  }));
}

function totalOutsideQueue(counts: StateCount[]): number {
  return counts
    .filter((c) => c.state !== 'queued')
    .reduce((sum, c) => sum + c.encrypted + c.notEncrypted, 0);
}

/**
 * Counts, per state, the scans holding registry credentials, then, with
 * `apply`, removes them from every scan outside the queue, by batches.
 *
 * @returns what it found and did; `exitCode` 1 when rows outside the queue
 * still hold credentials after an `apply`.
 */
export async function clearLeftoverRegistryAuth(options: {
  db: RegistryAuthCleanupDb;
  apply: boolean;
  log: (line: string) => void;
  batchSize?: number;
}): Promise<RegistryAuthCleanupReport> {
  const { db, apply, log } = options;
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;

  const before = await countPerState(db);
  const outside = before.filter((c) => c.state !== 'queued');
  const queued = before.find((c) => c.state === 'queued');
  for (const c of outside) {
    log(
      `state=${c.state} encrypted=${c.encrypted} not_encrypted=${c.notEncrypted}`,
    );
  }
  if (queued) {
    log(
      `state=queued encrypted=${queued.encrypted} not_encrypted=${queued.notEncrypted} (kept: the dequeue still reads them)`,
    );
  }
  const outsideQueue = {
    encrypted: outside.reduce((sum, c) => sum + c.encrypted, 0),
    notEncrypted: outside.reduce((sum, c) => sum + c.notEncrypted, 0),
  };
  const found = outsideQueue.encrypted + outsideQueue.notEncrypted;
  const queuedCount = queued ? queued.encrypted + queued.notEncrypted : 0;

  if (!apply) {
    log(
      `SUMMARY: ${found} scan row(s) outside the queue hold registry credentials (${outsideQueue.encrypted} encrypted, ${outsideQueue.notEncrypted} not encrypted). Dry run: nothing changed; run again with --apply.`,
    );
    return {
      outsideQueue,
      queued: queuedCount,
      cleared: 0,
      remaining: found,
      exitCode: 0,
    };
  }

  const ids = ((await db.query(LIST_SQL)) as Array<{ id: string }>).map(
    (row) => row.id,
  );
  let cleared = 0;
  for (let start = 0; start < ids.length; start += batchSize) {
    const batch = ids.slice(start, start + batchSize);
    const result = (await db.query(CLEAR_SQL, [batch])) as {
      affectedRows?: number;
    };
    cleared += result.affectedRows ?? 0;
  }

  const remaining = totalOutsideQueue(await countPerState(db));
  const line = `cleared ${cleared} scan row(s); ${remaining} outside the queue still hold registry credentials.`;
  if (remaining > 0) {
    log(`ERROR: ${line} Run the script again.`);
  } else {
    log(`SUMMARY: ${line}`);
  }
  return {
    outsideQueue,
    queued: queuedCount,
    cleared,
    remaining,
    exitCode: remaining > 0 ? 1 : 0,
  };
}

/** A mysql2/promise connection as the cleanup's database. */
export function mysqlCleanupDb(connection: {
  query(sql: string, params?: unknown[]): Promise<[unknown, unknown]>;
}): RegistryAuthCleanupDb {
  return {
    query: async (sql, params) => (await connection.query(sql, params))[0],
  };
}

export interface ConnectionSettings {
  host?: string;
  port: number;
  user?: string;
  password?: string;
  database: string;
  ssl?: { ca: string; rejectUnauthorized: true };
}

/** security-scanning's MySQL, from the variables the service reads. */
export function databaseSettings(env: NodeJS.ProcessEnv): ConnectionSettings {
  const sslEnabled = env.DB_SSL_ENABLED === 'true';
  if (sslEnabled && !env.DB_SSL_CA_CERT) {
    throw new TypeError('DB_SSL_ENABLED=true but DB_SSL_CA_CERT is missing');
  }
  return {
    host: env.DB_HOST,
    port: Number(env.DB_PORT || 3306),
    user: env.DB_USERNAME,
    password: env.DB_PASSWORD,
    database: env.DB_DATABASE || 'cybedefend_scanning',
    ssl: sslEnabled
      ? { ca: env.DB_SSL_CA_CERT as string, rejectUnauthorized: true }
      : undefined,
  };
}

/** Read-only unless `--apply`; with both flags the dry run wins. */
export function applyRequested(args: readonly string[]): boolean {
  return args.includes('--apply') && !args.includes('--dry-run');
}
