import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, createHmac, pbkdf2Sync } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GRPC_CALLERS,
  GRPC_SERVICES,
  SECRET_CONSUMERS,
  SECRETS_MOUNT,
  SERVICE_DATABASES,
  SERVICE_DERIVED_KEYS,
  deriveRuntimeSecrets,
  planSecretFiles,
} from '../derive-secrets.mjs';
import { decodeMasterKey, deriveKey, DERIVED_SECRET_KEYS } from '../hkdf.mjs';
import { loadVectors } from './vectors.mjs';

const vectors = loadVectors();
const FIRST = vectors.masterKeys[0];
const MASTER_HEX = FIRST.hex;
const STORAGE_SECRET = FIRST.packaging['storage-secret-key'];
const PERMIFY_KEY = FIRST.packaging['permify-preshared-key'];
const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'derive-secrets.mjs');
const MISSING =
  'CYBEDEFEND_SECRET_KEY is required in the Community Edition. Set it to at least 32 random bytes, base64 or hex (for example: openssl rand -base64 32).';

const APP_UID = 10001;
const DATABASES = {
  'global-management': 'cybedefend_global_management',
  'security-scanning': 'cybedefend_scanning',
  'analysis-reporting': 'cybedefend_analysis_and_reporting',
  'file-management': 'cybedefend_file_management',
  'external-integrations': 'cybedefend_external_integrations',
  'policy-management': 'cybedefend_policy',
  permify: 'permify',
};

const tmp = () => mkdtempSync(join(tmpdir(), 'derive-secrets-'));
const plan = () => planSecretFiles(decodeMasterKey(MASTER_HEX));
const layout = (files) => {
  const out = {};
  for (const f of files) (out[f.consumer] ??= []).push(f.name);
  for (const names of Object.values(out)) names.sort();
  return out;
};
const upper = (name) => name.toUpperCase().replace(/-/g, '_');
const peerFile = (caller) => `SERVICE_AUTH_PEER_KEY_${upper(caller)}`;
const signingFile = (server) => `SERVICE_AUTH_KEY_FOR_${upper(server)}`;
/** Every (caller, server) pair the servers' policies allow. */
const PAIRS = Object.entries(GRPC_CALLERS).flatMap(([server, callers]) =>
  callers.filter((c) => c !== server).map((caller) => ({ caller, server })),
);
const SERVICE_AUTH_FILES = (service) => [
  // As a caller: one signing key per server it may call.
  ...PAIRS.filter((p) => p.caller === service).map((p) => signingFile(p.server)),
  // As a server: one verification key per caller it serves.
  ...PAIRS.filter((p) => p.server === service).map((p) => peerFile(p.caller)),
];
const pairKey = (master, caller, server) =>
  deriveKey(master, `service-to-service-auth/${caller}/${server}`).toString('hex');
const valueOf = (files, consumer, name) => files.find((f) => f.consumer === consumer && f.name === name)?.value;
const noChown = () => {};

test('each consumer gets its own directory, holding only what it reads', () => {
  assert.deepEqual(layout(plan()), {
    gateway: [...SERVICE_AUTH_FILES('gateway'), 'permify-preshared-key', 'redis-password'].sort(),
    'global-management': ['AUTH_RESET_REQUESTER_HMAC_KEY', 'AUTH_SIGNING_KEY_ENCRYPTION_KEY', ...SERVICE_AUTH_FILES('global-management'), 'db-password', 'permify-preshared-key', 'redis-password'].sort(),
    'security-scanning': ['SCAN_METADATA_ENCRYPTION_KEY', ...SERVICE_AUTH_FILES('security-scanning'), 'db-password', 'redis-password'].sort(),
    'analysis-reporting': ['SECRET_ENCRYPTION_KEY', ...SERVICE_AUTH_FILES('analysis-reporting'), 'db-password', 'redis-password'].sort(),
    'file-management': [...SERVICE_AUTH_FILES('file-management'), 'db-password', 'redis-password', 'storage-secret-key'].sort(),
    'external-integrations': ['CONTAINER_REGISTRY_ENCRYPTION_KEY', 'GITLAB_ENCRYPTION_KEY', ...SERVICE_AUTH_FILES('external-integrations'), 'db-password', 'redis-password'].sort(),
    'policy-management': [...SERVICE_AUTH_FILES('policy-management'), 'db-password', 'redis-password'].sort(),
    permify: ['permify.yaml', 'pgpass'],
    'permify-schema': ['permify-preshared-key'],
    redis: ['redis-password'],
    storage: ['storage-secret-key'],
    postgres: [...Object.values(DATABASES).map((db) => `${db}.scram`), 'superuser-password', 'superuser.verifier'].sort(),
    'postgres-server': ['superuser-password'],
  });
  assert.deepEqual(SERVICE_DATABASES, DATABASES);
  assert.equal(SECRETS_MOUNT, '/run/cybedefend-secrets');
});

test('the key that seals the sign-in signing keys reaches global-management only', () => {
  const holders = plan().filter((f) => f.name === 'AUTH_SIGNING_KEY_ENCRYPTION_KEY').map((f) => f.consumer);
  assert.deepEqual(holders, ['global-management']);
});

test('the internal gRPC keys are exactly one per (caller, server) pair the policies allow', () => {
  const files = plan().filter((f) => f.name.startsWith('SERVICE_AUTH_'));
  const master = decodeMasterKey(MASTER_HEX);
  // No single key signs every call of a service any more.
  assert.deepEqual(files.filter((f) => f.name === 'SERVICE_AUTH_KEY'), []);
  for (const service of GRPC_SERVICES) {
    assert.deepEqual(
      files.filter((f) => f.consumer === service).map((f) => f.name).sort(),
      SERVICE_AUTH_FILES(service).sort(),
      service,
    );
  }
  assert.deepEqual(files.filter((f) => !GRPC_SERVICES.includes(f.consumer)), []);
  // The caller signs with the key its server verifies with: the pair's own.
  for (const { caller, server } of PAIRS) {
    const key = pairKey(master, caller, server);
    assert.equal(valueOf(files, caller, signingFile(server)), key, `${caller} → ${server}`);
    assert.equal(valueOf(files, server, peerFile(caller)), key, `${server} ← ${caller}`);
  }
  assert.equal(files.length, 2 * PAIRS.length);
  // Every caller a server lists is a gRPC service.
  for (const callers of Object.values(GRPC_CALLERS)) {
    for (const caller of callers) assert.ok(GRPC_SERVICES.includes(caller), caller);
  }
  assert.deepEqual(SECRET_CONSUMERS.gateway, { uid: APP_UID, gid: APP_UID });
});

test('two pairs never share a key, and each key is held by the two ends of its pair only', () => {
  const files = plan().filter((f) => f.name.startsWith('SERVICE_AUTH_'));
  const master = decodeMasterKey(MASTER_HEX);
  const keys = PAIRS.map(({ caller, server }) => pairKey(master, caller, server));
  assert.equal(new Set(keys).size, PAIRS.length);
  PAIRS.forEach(({ caller, server }, i) => {
    const holders = plan().filter((f) => f.value === keys[i]).map((f) => f.consumer).sort();
    assert.deepEqual(holders, [caller, server].sort(), `${caller} → ${server}`);
  });
  // The gateway serves no gRPC: no service holds a key that signs as the
  // gateway to another server.
  assert.equal(GRPC_CALLERS.gateway, undefined);
  for (const service of GRPC_SERVICES.filter((s) => s !== 'gateway')) {
    for (const f of files.filter((g) => g.consumer === service)) {
      const pair = PAIRS[keys.indexOf(f.value)];
      assert.ok(pair.caller === service || pair.server === service, `${service}/${f.name}`);
      if (pair.caller === 'gateway') assert.equal(pair.server, service, `${service}/${f.name}`);
    }
  }
});

test('no service folder holds a key that signs calls to another server', () => {
  const files = plan().filter((f) => f.name.startsWith('SERVICE_AUTH_'));
  for (const service of GRPC_SERVICES) {
    for (const f of files.filter((g) => g.consumer === service)) {
      // What this key verifies: calls from <caller> to <server>.
      const signer = PAIRS.find((p) => valueOf(files, p.caller, signingFile(p.server)) === f.value);
      assert.ok(signer, `${service}/${f.name}`);
      // A server's verification key signs calls to that server only; a
      // caller's signing key signs its own calls to one server only.
      assert.ok(signer.server === service || signer.caller === service, `${service}/${f.name}`);
      if (signer.server !== service) assert.equal(f.name, signingFile(signer.server));
    }
  }
});

test('the internal gRPC keys are stable for a given master key, and change with it', () => {
  const keysOf = (master) =>
    planSecretFiles(decodeMasterKey(master))
      .filter((f) => f.name.startsWith('SERVICE_AUTH_'))
      .map((f) => `${f.consumer}/${f.name}=${f.value}`)
      .sort();
  assert.deepEqual(keysOf(MASTER_HEX), keysOf(MASTER_HEX));
  assert.deepEqual(keysOf(MASTER_HEX), keysOf(FIRST.base64));
  const other = keysOf(vectors.masterKeys[1].base64);
  assert.equal(other.length, keysOf(MASTER_HEX).length);
  assert.equal(other.filter((line) => keysOf(MASTER_HEX).includes(line)).length, 0);
});

test('removes the single signing key an earlier version wrote to each gRPC service', () => {
  const root = tmp();
  for (const service of GRPC_SERVICES) {
    mkdirSync(join(root, service), { recursive: true });
    writeFileSync(join(root, service, 'SERVICE_AUTH_KEY'), 'old', { mode: 0o400 });
  }
  deriveRuntimeSecrets({ CYBEDEFEND_SECRET_KEY: MASTER_HEX }, root, { chown: noChown });
  for (const service of GRPC_SERVICES) {
    assert.ok(!existsSync(join(root, service, 'SERVICE_AUTH_KEY')), service);
    assert.deepEqual(
      readdirSync(join(root, service)).filter((n) => n.startsWith('SERVICE_AUTH_')).sort(),
      SERVICE_AUTH_FILES(service).sort(),
      service,
    );
  }
});

test('the Permify preshared key reaches the containers that call Permify, nothing else', () => {
  const files = plan();
  assert.equal(PERMIFY_KEY.startsWith('d44d346d') && PERMIFY_KEY.endsWith('e34b'), true);
  const holders = files.filter((f) => f.name === 'permify-preshared-key');
  assert.deepEqual(holders.map((f) => f.consumer).sort(), ['gateway', 'global-management', 'permify-schema']);
  for (const f of holders) assert.equal(f.value, PERMIFY_KEY, f.consumer);
  assert.deepEqual(SECRET_CONSUMERS['permify-schema'], { uid: 0, gid: 0 });
});

test('Permify gets the configuration that enforces the key', () => {
  const config = valueOf(plan(), 'permify', 'permify.yaml');
  const lines = config.split('\n').filter((line) => line.trim() !== '' && !line.trimStart().startsWith('#'));
  assert.deepEqual(lines, [
    'authn:',
    '  enabled: true',
    '  method: preshared',
    '  preshared:',
    '    keys:',
    `      - "${PERMIFY_KEY}"`,
  ]);
});

test('the Redis password reaches Redis and the services that use it, nothing else', () => {
  const files = plan();
  const expected = deriveKey(decodeMasterKey(MASTER_HEX), 'redis-password').toString('hex');
  const holders = files.filter((f) => f.name === 'redis-password');
  assert.deepEqual(
    holders.map((f) => f.consumer).sort(),
    ['analysis-reporting', 'external-integrations', 'file-management', 'gateway', 'global-management', 'policy-management', 'redis', 'security-scanning'],
  );
  for (const f of holders) assert.equal(f.value, expected, f.consumer);
  // Redis reads its password as the image's redis user (999:1000).
  assert.deepEqual(SECRET_CONSUMERS.redis, { uid: 999, gid: 1000 });
});

test('every derived key is the value the services derive from the master key', () => {
  const files = plan();
  let checked = 0;
  for (const [consumer, keys] of Object.entries(SERVICE_DERIVED_KEYS)) {
    for (const key of keys) {
      const spec = DERIVED_SECRET_KEYS[key];
      const expected = FIRST.derived[key] ?? deriveKey(decodeMasterKey(MASTER_HEX), spec.info).toString(spec.encoding);
      assert.equal(valueOf(files, consumer, key), expected, `${consumer}/${key}`);
      checked += 1;
    }
  }
  assert.deepEqual(Object.values(SERVICE_DERIVED_KEYS).flat().sort(), Object.keys(DERIVED_SECRET_KEYS).sort(), 'every derived key has exactly one consumer');
  assert.equal(checked, Object.keys(DERIVED_SECRET_KEYS).length);
  assert.equal(valueOf(files, 'storage', 'storage-secret-key'), STORAGE_SECRET);
  assert.equal(valueOf(files, 'file-management', 'storage-secret-key'), STORAGE_SECRET);
});

test('each database role has its own 256-bit password, and no file holds the master key', () => {
  const files = plan();
  const passwords = Object.keys(DATABASES)
    .filter((c) => c !== 'permify')
    .map((c) => valueOf(files, c, 'db-password'));
  const pgpass = valueOf(files, 'permify', 'pgpass');
  const match = /^postgres:5432:permify:permify:([0-9a-f]{64})\n$/.exec(pgpass);
  assert.ok(match, 'pgpass names the host, port, database and role of Permify');
  passwords.push(match[1]);
  for (const p of passwords) assert.match(p, /^[0-9a-f]{64}$/);
  assert.equal(new Set(passwords).size, passwords.length, 'no two roles share a password');
  for (const f of files) {
    assert.ok(!f.value.includes(MASTER_HEX), `${f.consumer}/${f.name} holds the master key`);
    assert.ok(!f.value.includes(FIRST.base64), `${f.consumer}/${f.name} holds the master key`);
  }
  // Another master key gives other passwords.
  const other = planSecretFiles(decodeMasterKey(vectors.masterKeys[1].hex ?? vectors.masterKeys[1].base64));
  assert.notEqual(valueOf(other, 'global-management', 'db-password'), valueOf(files, 'global-management', 'db-password'));
});

test('the PostgreSQL superuser password is derived, and reaches the server and the role setup job only', () => {
  const files = plan();
  const expected = deriveKey(decodeMasterKey(MASTER_HEX), 'postgres-superuser-password').toString('hex');
  assert.match(expected, /^[0-9a-f]{64}$/);
  const holders = files.filter((f) => f.name === 'superuser-password');
  assert.deepEqual(holders.map((f) => f.consumer).sort(), ['postgres', 'postgres-server']);
  for (const f of holders) assert.equal(f.value, expected, f.consumer);
  for (const f of files.filter((x) => x.name !== 'superuser-password')) {
    assert.ok(!f.value.includes(expected), `${f.consumer}/${f.name} holds the superuser password`);
  }
  // The server's entrypoint reads it before it drops to the postgres user (uid 70).
  assert.deepEqual(SECRET_CONSUMERS['postgres-server'], { uid: 70, gid: 70 });
  // The verifier the job sets when it moves an earlier instance's superuser to this password.
  const verifier = valueOf(files, 'postgres', 'superuser.verifier');
  const m = /^SCRAM-SHA-256\$4096:([A-Za-z0-9+/=]+)\$([A-Za-z0-9+/=]+):([A-Za-z0-9+/=]+)$/.exec(verifier);
  assert.ok(m, 'a SCRAM-SHA-256 verifier');
  const salted = pbkdf2Sync(expected, Buffer.from(m[1], 'base64'), 4096, 32, 'sha256');
  const clientKey = createHmac('sha256', salted).update('Client Key').digest();
  assert.equal(createHash('sha256').update(clientKey).digest('base64'), m[2]);
  assert.equal(createHmac('sha256', salted).update('Server Key').digest('base64'), m[3]);
});

test('the role setup job gets SCRAM verifiers of the passwords, never the passwords', () => {
  const files = plan();
  for (const [consumer, db] of Object.entries(DATABASES)) {
    const verifier = valueOf(files, 'postgres', `${db}.scram`);
    const m = /^SCRAM-SHA-256\$4096:([A-Za-z0-9+/=]+)\$([A-Za-z0-9+/=]+):([A-Za-z0-9+/=]+)$/.exec(verifier);
    assert.ok(m, `${db}: a SCRAM-SHA-256 verifier`);
    const password = consumer === 'permify' ? valueOf(files, 'permify', 'pgpass').trim().split(':').pop() : valueOf(files, consumer, 'db-password');
    assert.ok(!verifier.includes(password), `${db}: the verifier holds the password`);
    const salted = pbkdf2Sync(password, Buffer.from(m[1], 'base64'), 4096, 32, 'sha256');
    const clientKey = createHmac('sha256', salted).update('Client Key').digest();
    assert.equal(createHash('sha256').update(clientKey).digest('base64'), m[2], `${db}: StoredKey`);
    assert.equal(createHmac('sha256', salted).update('Server Key').digest('base64'), m[3], `${db}: ServerKey`);
  }
});

test('writes <root>/<consumer>/<file>, mode 0400, owned by the uid that reads it', () => {
  const root = tmp();
  const owners = [];
  deriveRuntimeSecrets({ CYBEDEFEND_SECRET_KEY: MASTER_HEX }, root, {
    chown: (path, uid, gid) => owners.push([path.slice(root.length + 1).replace(/\.\d+\.tmp$/, ''), uid, gid]),
  });
  const expected = layout(plan());
  assert.deepEqual(readdirSync(root).sort(), Object.keys(expected).sort());
  for (const [consumer, names] of Object.entries(expected)) {
    assert.deepEqual(readdirSync(join(root, consumer)).sort(), names, consumer);
    for (const name of names) {
      const file = join(root, consumer, name);
      assert.equal(statSync(file).mode & 0o777, 0o400, `${consumer}/${name}`);
      assert.equal(readFileSync(file, 'utf8'), valueOf(plan(), consumer, name));
    }
  }
  const uidOf = Object.fromEntries(owners.map(([path, uid, gid]) => [path, `${uid}:${gid}`]));
  assert.equal(uidOf['global-management/AUTH_SIGNING_KEY_ENCRYPTION_KEY'], `${APP_UID}:${APP_UID}`);
  assert.equal(uidOf['policy-management/db-password'], `${APP_UID}:${APP_UID}`);
  assert.equal(uidOf['permify/pgpass'], '65532:65532');
  assert.equal(uidOf['storage/storage-secret-key'], '0:0');
  assert.equal(uidOf['postgres/permify.scram'], '0:0');
  assert.equal(owners.length, plan().length, 'every file is given its owner');
  for (const [consumer, { uid }] of Object.entries(SECRET_CONSUMERS)) {
    assert.equal(typeof uid, 'number', consumer);
  }
});

test('rewrites existing read-only files, and leaves no temporary file behind', () => {
  const root = tmp();
  deriveRuntimeSecrets({ CYBEDEFEND_SECRET_KEY: MASTER_HEX }, root, { chown: noChown });
  deriveRuntimeSecrets({ CYBEDEFEND_SECRET_KEY: FIRST.base64 }, root, { chown: noChown });
  assert.equal(readFileSync(join(root, 'storage', 'storage-secret-key'), 'utf8'), STORAGE_SECRET);
  for (const consumer of readdirSync(root)) {
    for (const name of readdirSync(join(root, consumer))) assert.ok(!name.endsWith('.tmp'), `${consumer}/${name}`);
  }
});

test('removes the storage secret an earlier version left in the shared runtime volume, and nothing else there', () => {
  const root = tmp();
  const legacy = tmp();
  writeFileSync(join(legacy, 'storage-secret-key'), 'old', { mode: 0o444 });
  writeFileSync(join(legacy, 'permify-schema-version'), 'v1');
  deriveRuntimeSecrets({ CYBEDEFEND_SECRET_KEY: MASTER_HEX }, root, { chown: noChown, legacyRuntimeDir: legacy });
  assert.deepEqual(readdirSync(legacy), ['permify-schema-version']);
  // Idempotent: nothing to remove the second time.
  deriveRuntimeSecrets({ CYBEDEFEND_SECRET_KEY: MASTER_HEX }, root, { chown: noChown, legacyRuntimeDir: legacy });
  assert.deepEqual(readdirSync(legacy), ['permify-schema-version']);
});

test('reads CYBEDEFEND_SECRET_KEY_FILE', () => {
  const root = tmp();
  const keyFile = join(tmp(), 'master');
  writeFileSync(keyFile, `${MASTER_HEX}\n`);
  deriveRuntimeSecrets({ CYBEDEFEND_SECRET_KEY: '', CYBEDEFEND_SECRET_KEY_FILE: keyFile }, root, { chown: noChown });
  assert.equal(readFileSync(join(root, 'storage', 'storage-secret-key'), 'utf8'), STORAGE_SECRET);
});

test('the key file is preferred; the variable, the earlier way, still works alone, with a warning', () => {
  const keyFile = join(tmp(), 'master');
  writeFileSync(keyFile, `${FIRST.base64}\n`);
  const warnings = [];
  const warn = (line) => warnings.push(line);
  // The same key in both (hex in one, base64 in the other): accepted, and the variable is to be removed.
  deriveRuntimeSecrets({ CYBEDEFEND_SECRET_KEY: MASTER_HEX, CYBEDEFEND_SECRET_KEY_FILE: keyFile }, tmp(), { chown: noChown, warn });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /CYBEDEFEND_SECRET_KEY/);
  // The variable alone (an empty or missing file): accepted, with a warning.
  for (const file of [join(tmp(), 'missing'), (() => { const f = join(tmp(), 'empty'); writeFileSync(f, ''); return f; })(), '']) {
    warnings.length = 0;
    const root = tmp();
    deriveRuntimeSecrets({ CYBEDEFEND_SECRET_KEY: MASTER_HEX, CYBEDEFEND_SECRET_KEY_FILE: file }, root, { chown: noChown, warn });
    assert.equal(readFileSync(join(root, 'storage', 'storage-secret-key'), 'utf8'), STORAGE_SECRET, JSON.stringify(file));
    assert.equal(warnings.length, 1, JSON.stringify(file));
  }
  // The file alone: no warning.
  warnings.length = 0;
  deriveRuntimeSecrets({ CYBEDEFEND_SECRET_KEY_FILE: keyFile }, tmp(), { chown: noChown, warn });
  assert.deepEqual(warnings, []);
  for (const line of warnings) assert.ok(!line.includes(MASTER_HEX) && !line.includes(FIRST.base64));
});

test('a key file and a variable that hold two different keys stop the job, which writes nothing', () => {
  const keyFile = join(tmp(), 'master');
  writeFileSync(keyFile, `${vectors.masterKeys[1].hex ?? vectors.masterKeys[1].base64}\n`);
  const root = tmp();
  assert.throws(
    () => deriveRuntimeSecrets({ CYBEDEFEND_SECRET_KEY: MASTER_HEX, CYBEDEFEND_SECRET_KEY_FILE: keyFile }, root, { chown: noChown, warn: () => {} }),
    (err) => /CYBEDEFEND_SECRET_KEY/.test(err.message) && /differ/.test(err.message) && !err.message.includes(MASTER_HEX),
  );
  assert.deepEqual(readdirSync(root), []);
});

test('fails with the fixed message and writes nothing when the key is missing', () => {
  const root = tmp();
  assert.throws(() => deriveRuntimeSecrets({}, root, { chown: noChown }), { message: MISSING });
  assert.deepEqual(readdirSync(root), []);

  const env = { ...process.env };
  delete env.CYBEDEFEND_SECRET_KEY;
  delete env.CYBEDEFEND_SECRET_KEY_FILE;
  const cliRoot = tmp();
  const run = spawnSync(process.execPath, [CLI, cliRoot], { env, encoding: 'utf8' });
  assert.equal(run.status, 1);
  assert.equal(run.stderr.trim(), MISSING);
  assert.equal(run.stdout, '');
  assert.deepEqual(readdirSync(cliRoot), []);
});

test('the CLI writes every file and the legacy cleanup, and prints no secret', () => {
  const root = tmp();
  const legacy = tmp();
  writeFileSync(join(legacy, 'storage-secret-key'), STORAGE_SECRET, { mode: 0o444 });
  mkdirSync(join(root, 'storage'));
  const run = spawnSync(process.execPath, [CLI, root, legacy], {
    env: { ...process.env, CYBEDEFEND_SECRET_KEY: MASTER_HEX, CYBEDEFEND_SECRET_KEY_FILE: '' },
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /wrote storage\/storage-secret-key/);
  assert.match(run.stdout, /wrote global-management\/AUTH_SIGNING_KEY_ENCRYPTION_KEY/);
  assert.match(run.stdout, /removed .*storage-secret-key/);
  const files = plan();
  for (const output of [run.stdout, run.stderr]) {
    assert.ok(!output.includes(MASTER_HEX));
    for (const f of files) assert.ok(!output.includes(f.value.trim()), `the output holds ${f.consumer}/${f.name}`);
  }
  assert.equal(existsSync(join(legacy, 'storage-secret-key')), false);
  assert.equal(readFileSync(join(root, 'storage', 'storage-secret-key'), 'utf8'), STORAGE_SECRET);
});

test('the CLI refuses a missing output directory argument', () => {
  const run = spawnSync(process.execPath, [CLI], {
    env: { ...process.env, CYBEDEFEND_SECRET_KEY: MASTER_HEX },
    encoding: 'utf8',
  });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /usage: node derive-secrets\.mjs <secretsRoot> \[legacyRuntimeDir\]/);
});
