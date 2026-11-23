#!/usr/bin/env node
// CybeDefend Community Edition: writes the values the packaging derives from
// CYBEDEFEND_SECRET_KEY, once, before the containers that read them start.
//
// This job is the only container that holds the master key. Each consumer gets
// a directory of its own, <secretsRoot>/<consumer>/, a volume mounted
// read-only by that consumer only (at SECRETS_MOUNT), holding only what it
// reads, one file per value, mode 0400, owned by the uid it runs as:
//
//   <service>/<KEY>           each derived key the service reads (<KEY>_FILE)
//   <service>/db-password     the password of its own PostgreSQL role (DB_PASSWORD_FILE)
//   file-management/storage-secret-key, storage/storage-secret-key
//                             the S3 secret key of the bundled object storage
//   permify/pgpass            Permify's role password, as a PGPASSFILE line
//   permify/permify.yaml      Permify's configuration: preshared-key authentication
//   <client>/permify-preshared-key
//                             the key every Permify call carries, to its clients
//                             (gateway, global-management, permify-schema)
//   <service>/SERVICE_AUTH_KEY the key that signs the service's own gRPC calls
//   <service>/SERVICE_AUTH_PEER_KEY_<CALLER>
//                             the key that verifies each caller the service serves
//   <service>/redis-password, redis/redis-password
//                             the password Redis requires (requirepass)
//   postgres/<database>.scram the SCRAM verifier of each role, for the role
//                             setup job (postgres/roles.sh): never a password
//   postgres-server/superuser-password, postgres/superuser-password
//                             the PostgreSQL superuser's password, to the server
//                             (POSTGRES_PASSWORD_FILE, read on a new data
//                             directory) and to the role setup job, which logs in
//                             with it
//   postgres/superuser.verifier its SCRAM verifier: the role setup job sets it on
//                             an instance whose superuser still has the password
//                             an earlier version took from POSTGRES_PASSWORD
//
// Each kind of value is one function below that returns its files; add a new
// kind as another function, listed in planSecretFiles.
//
// CLI: node derive-secrets.mjs <secretsRoot> [legacyRuntimeDir]
//   The master key: the content of CYBEDEFEND_SECRET_KEY_FILE (the compose
//   file mounts it from a file of the host, never an environment variable).
//   CYBEDEFEND_SECRET_KEY, the earlier way, is still read, with a warning: alone
//   when the file is missing or empty, or when it holds the same key as the
//   file. Two different keys stop the job.
//   legacyRuntimeDir: the volume where an earlier version wrote the storage
//   secret, readable by every service; the copy there is removed.
// Exit 0, or 1 with the fixed message. Never prints a secret.

import { createHash, createHmac, pbkdf2Sync } from 'node:crypto';
import { chmodSync, chownSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { decodeMasterKey, deriveKey, DERIVED_SECRET_KEYS, MASTER_KEY_VARIABLE, MasterKeyError, PACKAGING_KEYS, serviceAuthInfo } from './hkdf.mjs';

/** Where a consumer mounts its own directory. */
export const SECRETS_MOUNT = '/run/cybedefend-secrets';

/** The uid (and gid) each consumer reads its files as. */
const APP = Object.freeze({ uid: 10001, gid: 10001 }); // every CybeDefend service image (appuser)
const ROOT = Object.freeze({ uid: 0, gid: 0 }); // read before the image drops privileges, or by a root job
export const SECRET_CONSUMERS = Object.freeze({
  gateway: APP,
  'global-management': APP,
  'security-scanning': APP,
  'analysis-reporting': APP,
  'file-management': APP,
  'external-integrations': APP,
  'policy-management': APP,
  permify: Object.freeze({ uid: 65532, gid: 65532 }), // the Permify image's user
  'permify-schema': ROOT, // the job that loads the Permify schema
  redis: Object.freeze({ uid: 999, gid: 1000 }), // the Redis image's redis user, which the container runs as
  storage: ROOT, // SeaweedFS's entrypoint and the bucket job read it as root
  postgres: ROOT, // the role setup job
  'postgres-server': Object.freeze({ uid: 70, gid: 70 }), // the PostgreSQL image's postgres user
});

/** The database each service owns, through a role of the same name. */
export const SERVICE_DATABASES = Object.freeze({
  'global-management': 'cybedefend_global_management',
  'security-scanning': 'cybedefend_scanning',
  'analysis-reporting': 'cybedefend_analysis_and_reporting',
  'file-management': 'cybedefend_file_management',
  'external-integrations': 'cybedefend_external_integrations',
  'policy-management': 'cybedefend_policy',
  permify: 'permify',
});

/** The derived keys each service reads (DERIVED_SECRET_KEYS of its secrets source); every other service gets none. */
export const SERVICE_DERIVED_KEYS = Object.freeze({
  'global-management': ['AUTH_SIGNING_KEY_ENCRYPTION_KEY', 'AUTH_RESET_REQUESTER_HMAC_KEY'],
  'security-scanning': ['SCAN_METADATA_ENCRYPTION_KEY'],
  'analysis-reporting': ['SECRET_ENCRYPTION_KEY'],
  'external-integrations': ['CONTAINER_REGISTRY_ENCRYPTION_KEY', 'GITLAB_ENCRYPTION_KEY'],
});

const POSTGRES_HOST = 'postgres';
const POSTGRES_PORT = 5432;
const SCRAM_ITERATIONS = 4096;

const file = (consumer, name, value) => ({ consumer, name, value });

function databasePassword(master, database) {
  return deriveKey(master, `postgres-password:${database}`).toString('hex');
}

/** The PostgreSQL SCRAM-SHA-256 verifier of a password, with a salt derived per role (stable across runs). */
export function scramVerifier(master, database, password) {
  const salt = deriveKey(master, `postgres-scram-salt:${database}`).subarray(0, 16);
  const salted = pbkdf2Sync(password, salt, SCRAM_ITERATIONS, 32, 'sha256');
  const storedKey = createHash('sha256').update(createHmac('sha256', salted).update('Client Key').digest()).digest();
  const serverKey = createHmac('sha256', salted).update('Server Key').digest();
  return `SCRAM-SHA-256$${SCRAM_ITERATIONS}:${salt.toString('base64')}$${storedKey.toString('base64')}:${serverKey.toString('base64')}`;
}

/** Each derived key, to the one service that reads it. */
export function serviceKeyFiles(master) {
  return Object.entries(SERVICE_DERIVED_KEYS).flatMap(([consumer, keys]) =>
    keys.map((key) => {
      const spec = DERIVED_SECRET_KEYS[key];
      return file(consumer, key, deriveKey(master, spec.info).toString(spec.encoding));
    }),
  );
}

/** Each service's own role password; Permify's as a pgpass line (it takes no password file of its own). */
export function databasePasswordFiles(master) {
  return Object.entries(SERVICE_DATABASES).map(([consumer, database]) => {
    const password = databasePassword(master, database);
    return consumer === 'permify'
      ? file(consumer, 'pgpass', `${POSTGRES_HOST}:${POSTGRES_PORT}:${database}:${database}:${password}\n`)
      : file(consumer, 'db-password', password);
  });
}

/** The verifiers the role setup job sets: it can create the roles, never log in as one. */
export function databaseRoleFiles(master) {
  return Object.values(SERVICE_DATABASES).map((database) =>
    file('postgres', `${database}.scram`, scramVerifier(master, database, databasePassword(master, database))),
  );
}

/** The object storage's S3 secret key: to the storage containers and to file-management, its only S3 client. */
export function storageSecretFiles(master) {
  const spec = PACKAGING_KEYS['storage-secret-key'];
  const value = deriveKey(master, spec.info).toString(spec.encoding);
  return [file('storage', 'storage-secret-key', value), file('file-management', 'storage-secret-key', value)];
}

/** The services that call or serve gRPC, each signing its calls with a key of its own. */
export const GRPC_SERVICES = Object.freeze([
  'gateway',
  'global-management',
  'security-scanning',
  'analysis-reporting',
  'file-management',
  'external-integrations',
  'policy-management',
]);

/**
 * Each gRPC server, the callers it serves: the callers its policy names
 * (src/core/service-auth/service-auth.policy.ts of the service, kept equal by
 * a test). The gateway serves no gRPC. A server receives the key of these
 * callers only, so no other service can sign as one of them.
 */
export const GRPC_CALLERS = Object.freeze({
  'global-management': ['gateway', 'analysis-reporting', 'security-scanning', 'external-integrations', 'policy-management'],
  'security-scanning': ['gateway', 'global-management', 'analysis-reporting', 'file-management', 'external-integrations'],
  'analysis-reporting': ['gateway', 'global-management', 'security-scanning', 'policy-management'],
  'file-management': ['gateway', 'global-management', 'security-scanning', 'analysis-reporting', 'external-integrations'],
  'external-integrations': ['gateway', 'global-management', 'security-scanning', 'analysis-reporting'],
  'policy-management': ['gateway', 'global-management', 'security-scanning'],
});

/** The variable (and file) name of a caller's verification key. */
export function serviceAuthPeerKeyName(caller) {
  return `SERVICE_AUTH_PEER_KEY_${caller.toUpperCase().replace(/-/g, '_')}`;
}

/** Each gRPC service's own signing key, and to each server the keys of the callers it serves. */
export function serviceAuthKeyFiles(master) {
  const keyOf = (caller) => deriveKey(master, serviceAuthInfo(caller)).toString('hex');
  return GRPC_SERVICES.flatMap((service) => [
    file(service, 'SERVICE_AUTH_KEY', keyOf(service)),
    ...(GRPC_CALLERS[service] ?? [])
      .filter((caller) => caller !== service)
      .map((caller) => file(service, serviceAuthPeerKeyName(caller), keyOf(caller))),
  ]);
}

/** The containers that call Permify. */
export const PERMIFY_CLIENTS = Object.freeze(['gateway', 'global-management', 'permify-schema']);

/** Permify's own configuration: preshared-key authentication with the derived key. */
export function permifyAuthnConfig(key) {
  if (!/^[0-9a-f]{64}$/.test(key)) throw new Error('the Permify preshared key is not 64 hex characters');
  return [
    '# Written by derive-secrets.mjs from CYBEDEFEND_SECRET_KEY: Permify',
    '# answers only the calls that carry this key (authorization: Bearer <key>).',
    'authn:',
    '  enabled: true',
    '  method: preshared',
    '  preshared:',
    '    keys:',
    `      - "${key}"`,
    '',
  ].join('\n');
}

/** The Permify key to each of its clients, and to Permify the configuration that enforces it. */
export function permifyKeyFiles(master) {
  const spec = PACKAGING_KEYS['permify-preshared-key'];
  const key = deriveKey(master, spec.info).toString(spec.encoding);
  return [
    ...PERMIFY_CLIENTS.map((consumer) => file(consumer, 'permify-preshared-key', key)),
    file('permify', 'permify.yaml', permifyAuthnConfig(key)),
  ];
}

/** The Redis password, to Redis and to every service (they all use the shared Redis). */
export function redisPasswordFiles(master) {
  const spec = PACKAGING_KEYS['redis-password'];
  const value = deriveKey(master, spec.info).toString(spec.encoding);
  return ['redis', ...GRPC_SERVICES].map((consumer) => file(consumer, 'redis-password', value));
}

/** The superuser's name (POSTGRES_USER of the compose file). */
export const POSTGRES_SUPERUSER = 'cybedefend';

/**
 * The superuser's password, to the server and to the role setup job, and its
 * verifier to the job (its salt label is no database name: it holds a colon).
 */
export function superuserPasswordFiles(master) {
  const spec = PACKAGING_KEYS['postgres-superuser-password'];
  const password = deriveKey(master, spec.info).toString(spec.encoding);
  return [
    file('postgres-server', 'superuser-password', password),
    file('postgres', 'superuser-password', password),
    file('postgres', 'superuser.verifier', scramVerifier(master, `superuser:${POSTGRES_SUPERUSER}`, password)),
  ];
}

/** Every file the job writes. */
export function planSecretFiles(master) {
  return [
    ...serviceKeyFiles(master),
    ...serviceAuthKeyFiles(master),
    ...permifyKeyFiles(master),
    ...redisPasswordFiles(master),
    ...databasePasswordFiles(master),
    ...databaseRoleFiles(master),
    ...superuserPasswordFiles(master),
    ...storageSecretFiles(master),
  ];
}

const VARIABLE_WARNING =
  `${MASTER_KEY_VARIABLE} is set in the environment: move the key to the key file the compose file mounts (CYBEDEFEND_SECRET_KEY_PATH, ./secret-key by default), then remove ${MASTER_KEY_VARIABLE} from .env.`;
const CONFLICT_MESSAGE =
  `The key file (${MASTER_KEY_VARIABLE}_FILE) and ${MASTER_KEY_VARIABLE} differ. Keep the key this instance was installed with in the key file, and remove ${MASTER_KEY_VARIABLE} from .env.`;

/** The content of the key file, or '' when it is unset, missing or empty. */
function readKeyFile(path) {
  if (path === undefined || path === '') return '';
  try {
    return readFileSync(path, 'utf8').trim();
  } catch (err) {
    if (err?.code === 'ENOENT') return '';
    throw err;
  }
}

/** The master key, decoded: the key file first, the variable as the earlier way (see the header). */
function readMasterKey(env, warn) {
  const fromFile = readKeyFile(env[`${MASTER_KEY_VARIABLE}_FILE`]);
  const fromVariable = (env[MASTER_KEY_VARIABLE] ?? '').trim();
  if (fromVariable === '') return decodeMasterKey(fromFile);
  if (fromFile === '') {
    warn(VARIABLE_WARNING);
    return decodeMasterKey(fromVariable);
  }
  const key = decodeMasterKey(fromFile);
  if (!key.equals(decodeMasterKey(fromVariable))) throw new MasterKeyError(CONFLICT_MESSAGE);
  warn(VARIABLE_WARNING);
  return key;
}

/** Writes beside the target, sets mode then owner (no capability is needed to chmod a file one owns), renames over it. */
function writeAtomically(path, content, owner, chown) {
  const tmp = `${path}.${process.pid}.tmp`;
  try {
    rmSync(tmp, { force: true });
    writeFileSync(tmp, content, { mode: 0o400, flag: 'wx' });
    chmodSync(tmp, 0o400);
    chown(tmp, owner.uid, owner.gid);
    renameSync(tmp, path);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

const defaultChown = () => (typeof process.getuid === 'function' && process.getuid() === 0 ? chownSync : () => {});

/**
 * Derives every value and writes it to <secretsRoot>/<consumer>/<name>.
 * options.chown(path, uid, gid): defaults to chownSync when running as root, else none.
 * options.legacyRuntimeDir: removes the storage secret an earlier version left there.
 * options.warn(line): where a warning goes (default: stderr); it never holds a secret.
 * Returns the lines to print (paths only).
 */
export function deriveRuntimeSecrets(env, secretsRoot, options = {}) {
  const chown = options.chown ?? defaultChown();
  const warn = options.warn ?? ((line) => console.error(line));
  const files = planSecretFiles(readMasterKey(env, warn));
  const written = [];
  for (const consumer of new Set(files.map((f) => f.consumer))) {
    const dir = join(secretsRoot, consumer);
    mkdirSync(dir, { recursive: true });
    chmodSync(dir, 0o711);
  }
  for (const f of files) {
    writeAtomically(join(secretsRoot, f.consumer, f.name), f.value, SECRET_CONSUMERS[f.consumer], chown);
    written.push(`wrote ${f.consumer}/${f.name}`);
  }
  if (options.legacyRuntimeDir) {
    const legacy = join(options.legacyRuntimeDir, 'storage-secret-key');
    try {
      rmSync(legacy);
      written.push(`removed ${legacy}`);
    } catch (err) {
      if (err?.code !== 'ENOENT') throw err;
    }
  }
  return written;
}

function main() {
  const [secretsRoot, legacyRuntimeDir] = process.argv.slice(2);
  if (!secretsRoot) {
    console.error('usage: node derive-secrets.mjs <secretsRoot> [legacyRuntimeDir]');
    process.exit(1);
  }
  try {
    for (const line of deriveRuntimeSecrets(process.env, secretsRoot, { legacyRuntimeDir })) {
      console.log(line);
    }
  } catch (err) {
    // A MasterKeyError message names the variable, never its value; a file
    // error names a path. Neither carries a secret.
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
