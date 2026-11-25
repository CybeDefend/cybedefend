// Checks the Community compose file through `docker compose config`, which
// only parses and resolves it (no image is pulled, no container started).
// Skipped, with a message, when docker is not installed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findUp } from '../smoke/lib.mjs';
import { SECRET_CONSUMERS, SECRETS_MOUNT, SERVICE_DATABASES, SERVICE_DERIVED_KEYS } from '../runtime/derive-secrets.mjs';

const DEPLOY_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SUBNET = '172.30.240.0/24';
const PUBLIC_URL = 'http://localhost:8080';
// An earlier version's superuser password, still in an upgraded instance's .env.
const PASSWORD = 'compose-test-password';
const MASTER = Buffer.alloc(32, 7).toString('base64');
// The release version .env.example names: the compose file requires it.
const EXAMPLE = readFileSync(join(DEPLOY_DIR, '.env.example'), 'utf8');
const VERSION = /^CYBEDEFEND_VERSION=(.*)$/m.exec(EXAMPLE)?.[1] ?? '';

const hasDocker = spawnSync('docker', ['compose', 'version'], { encoding: 'utf8' }).status === 0;
const skip = hasDocker ? false : 'docker compose is not installed: compose.test.mjs skipped';

/**
 * A .env as .env.example makes it (the master key lives in ./secret-key, not
 * here); `legacy` adds the two values an instance installed by an earlier
 * version still has there: CYBEDEFEND_SECRET_KEY and POSTGRES_PASSWORD.
 */
function withEnvFile(fn, { version = VERSION, legacy = false, extra = [] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cd-compose-test-'));
  const envFile = join(dir, '.env');
  writeFileSync(
    envFile,
    [
      'CYBEDEFEND_SETUP_TOKEN=compose-test-setup-token-0123456789abcdef',
      `CYBEDEFEND_PUBLIC_URL=${PUBLIC_URL}`,
      ...(legacy ? [`CYBEDEFEND_SECRET_KEY=${MASTER}`, `POSTGRES_PASSWORD=${PASSWORD}`] : []),
      ...(version === null ? [] : [`CYBEDEFEND_VERSION=${version}`]),
      ...extra,
      '',
    ].join('\n'),
  );
  try {
    return fn(envFile);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function runCompose(args, extraEnv, envOptions) {
  return withEnvFile((envFile) => {
    // The shell's own CYBEDEFEND_* values would override the env file.
    const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('CYBEDEFEND_')));
    return spawnSync('docker', ['compose', '--env-file', envFile, '-f', 'docker-compose.yml', ...args], {
      cwd: DEPLOY_DIR,
      encoding: 'utf8',
      env: { ...base, ...(extraEnv ?? {}) },
    });
  }, envOptions);
}

function compose(args, extraEnv) {
  const res = runCompose(args, extraEnv);
  assert.equal(res.status, 0, res.stderr);
  return res.stdout;
}

let cached;
const config = () => (cached ??= JSON.parse(compose(['config', '--format', 'json'])));
let cachedLegacy;
const configLegacy = () => {
  if (!cachedLegacy) {
    const res = runCompose(['config', '--format', 'json'], undefined, { legacy: true });
    assert.equal(res.status, 0, res.stderr);
    cachedLegacy = JSON.parse(res.stdout);
  }
  return cachedLegacy;
};

const services = () => Object.entries(config().services);
const env = (svc) => svc.environment ?? {};
const APP_IMAGE = /^ghcr\.io\/cybedefend\/cybedefend-([a-z-]+):/;
const JOBS = ['init-secrets', 'postgres-roles', 'storage-init', 'permify-schema'];
const BACKENDS = [
  'gateway',
  'global-management',
  'security-scanning',
  'analysis-reporting',
  'file-management',
  'external-integrations',
  'policy-management',
];
const isBackend = (svc) => BACKENDS.includes(APP_IMAGE.exec(svc.image ?? '')?.[1]);
const dependsOn = (svc, name) => svc.depends_on?.[name]?.condition;

test('every application image is ghcr.io/cybedefend/cybedefend-<service>', { skip }, () => {
  const expected = {
    gateway: 'gateway',
    'global-management': 'global-management',
    'security-scanning': 'security-scanning',
    'security-scanning-cron': 'security-scanning',
    'analysis-reporting': 'analysis-reporting',
    'analysis-reporting-worker': 'analysis-reporting',
    'analysis-reporting-worker-reports': 'analysis-reporting',
    'file-management': 'file-management',
    'file-management-cron': 'file-management',
    'external-integrations': 'external-integrations',
    'external-integrations-worker': 'external-integrations',
    'policy-management': 'policy-management',
    'policy-management-worker': 'policy-management',
    dashboard: 'dashboard',
    'scheduler-analysis-reporting': 'analysis-reporting',
    'scheduler-external-integrations': 'external-integrations',
  };
  const all = config().services;
  for (const [name, image] of Object.entries(expected)) {
    assert.ok(all[name], `service ${name} exists`);
    assert.equal(all[name].image, `ghcr.io/cybedefend/cybedefend-${image}:${VERSION}`, name);
  }
  for (const [name, svc] of services()) {
    if ((svc.image ?? '').startsWith('ghcr.io/cybedefend/')) assert.match(svc.image, APP_IMAGE, name);
  }
  assert.equal(config().services.mcp.image, `ghcr.io/cybedefend/cybedefend-mcp:${VERSION}`);
});

test('.env.example names the release version of the images, never a moving tag', () => {
  assert.match(VERSION, /^\d+\.\d+\.\d+$/, `CYBEDEFEND_VERSION=${VERSION}`);
});

test('the compose file refuses to start without CYBEDEFEND_VERSION: no image follows latest', { skip }, () => {
  for (const version of [null, '']) {
    const res = runCompose(['config', '--format', 'json'], undefined, { version });
    assert.notEqual(res.status, 0, `CYBEDEFEND_VERSION=${version}`);
    assert.match(res.stderr, /CYBEDEFEND_VERSION/);
  }
  assert.ok(!/CYBEDEFEND_VERSION:-/.test(readFileSync(join(DEPLOY_DIR, 'docker-compose.yml'), 'utf8')), 'no default version');
});

test('every image that is not a CybeDefend service is pinned by digest', { skip }, () => {
  for (const all of [config().services, config().services]) {
    for (const [name, svc] of Object.entries(all)) {
      if (APP_IMAGE.test(svc.image ?? '')) continue;
      assert.match(svc.image ?? '', /^[a-z0-9./-]+:[0-9A-Za-z.-]+@sha256:[0-9a-f]{64}$/, `${name}: ${svc.image}`);
    }
  }
});

// The release of each third-party image that carries the fixes for the
// advisories known in its previous release, within the major the stack runs:
// PostgreSQL 18.7, Permify 1.7.6 (rebuilt on a current Go, with current x/crypto and
// x/net). A newer release passes; an older one, or another major, does not.
const IMAGE_FLOORS = {
  postgres: { repo: 'postgres', major: 18, floor: [18, 7] },
  'postgres-roles': { repo: 'postgres', major: 18, floor: [18, 7] },
  permify: { repo: 'ghcr.io/permify/permify', major: 1, floor: [1, 7, 6] },
};

const atLeast = (version, floor) => {
  for (let i = 0; i < floor.length; i++) {
    if ((version[i] ?? 0) !== floor[i]) return (version[i] ?? 0) > floor[i];
  }
  return true;
};

test('the floor itself: a release at or above it passes, an older one does not', () => {
  assert.equal(atLeast([18, 7], [18, 7]), true);
  assert.equal(atLeast([18, 8], [18, 7]), true);
  assert.equal(atLeast([18, 6], [18, 7]), false);
  assert.equal(atLeast([1, 7, 6], [1, 7, 6]), true);
  assert.equal(atLeast([1, 8, 0], [1, 7, 6]), true);
  assert.equal(atLeast([1, 6, 10], [1, 7, 6]), false);
});

test('the PostgreSQL and Permify images are releases that carry the known fixes', { skip }, () => {
  const all = config().services;
  for (const [name, { repo, major, floor }] of Object.entries(IMAGE_FLOORS)) {
    const image = all[name]?.image ?? '';
    const m = /^([^@]+):v?(\d+(?:\.\d+)+)[^@:]*@sha256:[0-9a-f]{64}$/.exec(image);
    assert.ok(m, `${name}: ${image} names no version`);
    assert.equal(m[1], repo, `${name}: ${image}`);
    const version = m[2].split('.').map(Number);
    assert.equal(version[0], major, `${name}: ${image} is not on major ${major}`);
    assert.ok(atLeast(version, floor), `${name}: ${image} is older than ${floor.join('.')}`);
  }
});

test('every published port listens on 127.0.0.1 by default, and on CYBEDEFEND_BIND_ADDRESS when it is set', { skip }, () => {
  const published = (all) =>
    Object.entries(all)
      .filter(([, svc]) => (svc.ports ?? []).length > 0)
      .flatMap(([name, svc]) => svc.ports.map((p) => [name, p.host_ip]));
  const byDefault = published(config().services);
  assert.deepEqual(byDefault.map(([name]) => name).sort(), ['dashboard', 'mcp', 'storage']);
  for (const [name, ip] of byDefault) assert.equal(ip, '127.0.0.1', name);

  const lan = published(JSON.parse(compose(['config', '--format', 'json'], { CYBEDEFEND_BIND_ADDRESS: '10.0.0.7' })).services);
  for (const [name, ip] of lan) assert.equal(ip, '10.0.0.7', name);

  // .env.example and the README say what to set.
  assert.match(EXAMPLE, /^# CYBEDEFEND_BIND_ADDRESS=127\.0\.0\.1$/m);
  assert.match(readFileSync(join(DEPLOY_DIR, 'README.md'), 'utf8'), /CYBEDEFEND_BIND_ADDRESS/);
});

test('only dashboard, storage and mcp publish ports', { skip }, () => {
  const publishing = services()
    .filter(([, svc]) => (svc.ports ?? []).length > 0)
    .map(([name]) => name)
    .sort();
  assert.deepEqual(publishing, ['dashboard', 'mcp', 'storage']);
  assert.deepEqual(config().services.dashboard.ports.map((p) => [p.published, p.target]), [['8080', 8080]]);
  assert.deepEqual(config().services.storage.ports.map((p) => [p.published, p.target]), [['9000', 9000]]);
  assert.deepEqual(config().services.mcp.ports.map((p) => [p.published, p.target]), [['3010', 3010]]);
});

test('mcp starts with the stack: no compose profile', { skip }, () => {
  const mcp = config().services.mcp;
  assert.ok(mcp);
  assert.equal(mcp.profiles, undefined);
  assert.equal(env(mcp).CYBEDEFEND_EDITION, 'community');
  assert.equal(env(mcp).OTEL_DISABLED, 'true');
  assert.equal(env(mcp).CYBEDEFEND_API_RESOURCE, 'http://gateway:3000');
  assert.match(mcp.image, /^ghcr\.io\/cybedefend\/cybedefend-mcp:/);
  assert.equal(dependsOn(mcp, 'gateway'), 'service_healthy');

  const listed = compose(['config', '--services']).split('\n').filter(Boolean);
  for (const name of ['mcp', 'mcp-redis', 'gateway']) assert.ok(listed.includes(name), name);

  // Nothing tells an operator to pass a profile any more.
  for (const file of ['docker-compose.yml', 'docker-compose.build.yml', '.env.example', 'README.md']) {
    assert.doesNotMatch(readFileSync(join(DEPLOY_DIR, file), 'utf8'), /--profile mcp|mcp profile|`mcp` profile|profiles: \[mcp\]/, file);
  }
});

test('every application container runs community, without telemetry export', { skip }, () => {
  const backends = services().filter(([, svc]) => isBackend(svc));
  assert.ok(backends.length >= 14);
  for (const [name, svc] of backends) {
    assert.equal(env(svc).CYBEDEFEND_EDITION, 'community', name);
    assert.equal(env(svc).OTEL_DISABLED, 'true', name);
    assert.equal(env(svc).NODE_ENV, 'production', name);
  }
  for (const [name, svc] of services()) {
    for (const key of Object.keys(env(svc))) {
      assert.ok(!/TELEMETRY/.test(key), `${name}: ${key} (no telemetry)`);
    }
  }
});

test('only init-secrets holds the master key: no service, worker or scheduler receives it', { skip }, () => {
  // A compromised container (the report worker's Chromium, a parser) must not
  // be able to re-derive the keys of the others.
  for (const all of [config(), configLegacy()]) {
    const holders = Object.entries(all.services)
      .filter(([, svc]) => 'CYBEDEFEND_SECRET_KEY' in env(svc) || 'CYBEDEFEND_SECRET_KEY_FILE' in env(svc))
      .map(([name]) => name);
    assert.deepEqual(holders, ['init-secrets']);
    const secretHolders = Object.entries(all.services)
      .filter(([, svc]) => (svc.secrets ?? []).length > 0)
      .map(([name]) => name);
    assert.deepEqual(secretHolders, ['init-secrets']);
  }
});

test('init-secrets reads the master key from a file of the host, mounted as a secret, never from its environment', { skip }, () => {
  const job = config().services['init-secrets'];
  assert.deepEqual(job.secrets.map((s) => [s.source, s.target ?? '/run/secrets/cybedefend-secret-key']), [['cybedefend-secret-key', '/run/secrets/cybedefend-secret-key']]);
  assert.equal(env(job).CYBEDEFEND_SECRET_KEY_FILE, '/run/secrets/cybedefend-secret-key');
  // A new instance's .env holds no key: the variable is not passed at all.
  assert.ok(env(job).CYBEDEFEND_SECRET_KEY == null, 'no master key in the environment of a new instance');
  assert.equal(config().secrets['cybedefend-secret-key'].file, join(DEPLOY_DIR, 'secret-key'));
  // Elsewhere on the host.
  const moved = JSON.parse(compose(['config', '--format', 'json'], { CYBEDEFEND_SECRET_KEY_PATH: '/etc/cybedefend/secret-key' }));
  assert.equal(moved.secrets['cybedefend-secret-key'].file, '/etc/cybedefend/secret-key');
  // An earlier instance whose .env still holds the key: it still reaches the job, which then warns.
  assert.equal(env(configLegacy().services['init-secrets']).CYBEDEFEND_SECRET_KEY, MASTER);
  assert.doesNotMatch(EXAMPLE, /^CYBEDEFEND_SECRET_KEY=/m, '.env.example asks for no master key in .env');
  assert.match(EXAMPLE, /^# CYBEDEFEND_SECRET_KEY_PATH=\.\/secret-key$/m);
});

test('init-secrets, the holder of the master key, has no network', { skip }, () => {
  const job = config().services['init-secrets'];
  assert.equal(job.network_mode, 'none');
  assert.equal(job.networks, undefined);
});

test('git ignores the master key file next to the compose file', { skip: spawnSync('git', ['--version']).status === 0 ? false : 'git is not installed' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'cd-secret-key-ignore-'));
  try {
    writeFileSync(join(dir, '.gitignore'), readFileSync(join(DEPLOY_DIR, '.gitignore')));
    writeFileSync(join(dir, 'secret-key'), '');
    assert.equal(spawnSync('git', ['init', '-q'], { cwd: dir }).status, 0);
    assert.equal(spawnSync('git', ['check-ignore', '-q', 'secret-key'], { cwd: dir }).status, 0, 'secret-key is ignored');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('each derived key reaches, as a file, exactly the containers of the service that reads it', { skip }, () => {
  const serviceOf = (svc) => APP_IMAGE.exec(svc.image ?? '')?.[1];
  for (const [owner, keys] of Object.entries(SERVICE_DERIVED_KEYS)) {
    for (const key of keys) {
      const holders = Object.entries(config().services).filter(([, svc]) => `${key}_FILE` in env(svc));
      assert.ok(holders.length > 0, `${key} reaches no container`);
      for (const [name, svc] of holders) {
        assert.equal(serviceOf(svc), owner, `${name} receives ${key}_FILE`);
        assert.equal(env(svc)[`${key}_FILE`], `${SECRETS_MOUNT}/${key}`, name);
      }
      const expected = services().filter(([, svc]) => serviceOf(svc) === owner).map(([name]) => name).sort();
      assert.deepEqual(holders.map(([name]) => name).sort(), expected, key);
    }
  }
});

const SECRET_VOLUME_USERS = {
  'secrets-gateway': ['gateway'],
  'secrets-global-management': ['global-management'],
  'secrets-security-scanning': ['security-scanning', 'security-scanning-cron'],
  'secrets-analysis-reporting': ['analysis-reporting', 'analysis-reporting-worker', 'analysis-reporting-worker-reports', 'scheduler-analysis-reporting'],
  'secrets-file-management': ['file-management', 'file-management-cron'],
  'secrets-external-integrations': ['external-integrations', 'external-integrations-worker', 'scheduler-external-integrations'],
  'secrets-policy-management': ['policy-management', 'policy-management-worker'],
  'secrets-permify': ['permify'],
  'secrets-permify-schema': ['permify-schema'],
  'secrets-redis': ['redis'],
  'secrets-storage': ['storage-server', 'storage-init'],
  'secrets-postgres': ['postgres-roles'],
  'secrets-postgres-server': ['postgres'],
};

test('every container of a gRPC service reads its per-server signing keys and its callers\' keys from its own secrets volume', { skip }, () => {
  const all = config();
  const grpcVolumes = ['gateway', 'global-management', 'security-scanning', 'analysis-reporting', 'file-management', 'external-integrations', 'policy-management'].map((c) => `secrets-${c}`);
  const containers = Object.entries(all.services).filter(([name, svc]) =>
    name !== 'init-secrets' && (svc.volumes ?? []).some((v) => grpcVolumes.includes(v.source)),
  );
  assert.ok(containers.length >= grpcVolumes.length);
  for (const [name, svc] of containers) {
    // No single key that would sign its calls to every server.
    assert.equal(env(svc).SERVICE_AUTH_KEY_FILE, undefined, name);
    assert.equal(env(svc).SERVICE_AUTH_KEY, undefined, name);
    // One file per (caller, server) pair, in the same volume: the keys it signs
    // its calls to each server with, and the keys of the callers it serves.
    assert.equal(env(svc).SERVICE_AUTH_PEER_KEYS_DIR, SECRETS_MOUNT, name);
  }
});

test('each secrets volume is mounted read-only by its consumer alone, and written by init-secrets alone', { skip }, () => {
  const all = config();
  const volumes = Object.keys(all.volumes).filter((v) => v.startsWith('secrets-')).sort();
  assert.deepEqual(volumes, Object.keys(SECRET_CONSUMERS).map((c) => `secrets-${c}`).sort());
  assert.deepEqual(volumes, Object.keys(SECRET_VOLUME_USERS).sort());
  const init = all.services['init-secrets'];
  for (const volume of volumes) {
    const consumer = volume.slice('secrets-'.length);
    const mounts = Object.entries(all.services).flatMap(([name, svc]) =>
      (svc.volumes ?? []).filter((v) => v.source === volume).map((v) => [name, v.target, Boolean(v.read_only)]),
    );
    const readers = mounts.filter(([name]) => name !== 'init-secrets');
    assert.deepEqual(readers.map(([name]) => name).sort(), [...SECRET_VOLUME_USERS[volume]].sort(), volume);
    for (const [name, target, ro] of readers) {
      assert.equal(target, SECRETS_MOUNT, `${name}: ${volume}`);
      assert.equal(ro, true, `${name} mounts ${volume} read-only`);
    }
    assert.deepEqual(
      (init.volumes ?? []).filter((v) => v.source === volume).map((v) => [v.target, Boolean(v.read_only)]),
      [[`${SECRETS_MOUNT}/${consumer}`, false]],
      `init-secrets writes ${volume}`,
    );
  }
  assert.deepEqual(init.command, ['node', '/opt/cybedefend/runtime/derive-secrets.mjs', SECRETS_MOUNT, '/run/cybedefend']);
});

test('the shared runtime volume holds no secret: every _FILE but the schema version points to the container\'s own secrets', { skip }, () => {
  for (const [name, svc] of Object.entries(config().services)) {
    for (const [key, value] of Object.entries(env(svc))) {
      if (!key.endsWith('_FILE') || !value) continue;
      if (key === 'PERMIFY_SCHEMA_VERSION_FILE') {
        assert.equal(value, '/run/cybedefend/permify-schema-version', name);
        continue;
      }
      if (key.startsWith('CYBEDEFEND_SCANNER_') || key === 'GITHUB_PRIVATE_KEY_FILE') continue;
      // The master key, a compose secret of init-secrets alone.
      if (name === 'init-secrets' && key === 'CYBEDEFEND_SECRET_KEY_FILE') {
        assert.equal(value, '/run/secrets/cybedefend-secret-key');
        continue;
      }
      assert.ok(String(value).startsWith(`${SECRETS_MOUNT}/`), `${name}: ${key}=${value}`);
    }
    for (const v of svc.volumes ?? []) {
      if (v.source === 'runtime' && name !== 'init-secrets' && name !== 'permify-schema') assert.equal(v.read_only, true, name);
    }
  }
});

test('postgres-roles sets up one role per database as the superuser, whose password it reads from its own secrets', { skip }, () => {
  const all = config().services;
  const job = all['postgres-roles'];
  assert.equal(job.image, config().services.postgres.image);
  assert.equal(job.restart, 'no');
  assert.deepEqual(job.entrypoint, ['sh', '/opt/cybedefend/postgres/roles.sh', SECRETS_MOUNT]);
  assert.equal(env(job).PGHOST, 'postgres');
  assert.equal(env(job).PGUSER, 'cybedefend');
  assert.ok(!('PGPASSWORD' in env(job)), 'no superuser password in its configuration');
  // A new instance: nothing to move.
  assert.equal(env(job).POSTGRES_PREVIOUS_PASSWORD, '');
  assert.equal(dependsOn(job, 'postgres'), 'service_healthy');
  assert.equal(dependsOn(job, 'init-secrets'), 'service_completed_successfully');
  assert.deepEqual(
    job.volumes.map((v) => [v.source, v.target, Boolean(v.read_only)]),
    [[join(DEPLOY_DIR, 'postgres'), '/opt/cybedefend/postgres', true], ['secrets-postgres', SECRETS_MOUNT, true]],
  );
  assert.doesNotMatch(EXAMPLE, /POSTGRES_PASSWORD=/, '.env.example asks for no superuser password');
});

test('the superuser password is derived: postgres reads it from its own secrets volume, never from its environment', { skip }, () => {
  const pg = config().services.postgres;
  assert.equal(env(pg).POSTGRES_PASSWORD_FILE, `${SECRETS_MOUNT}/superuser-password`);
  assert.ok(!('POSTGRES_PASSWORD' in env(pg)), 'postgres is given no password');
  assert.equal(dependsOn(pg, 'init-secrets'), 'service_completed_successfully');
  assert.ok(pg.volumes.some((v) => v.source === 'secrets-postgres-server' && v.target === SECRETS_MOUNT && v.read_only));
});

test('an earlier instance\'s POSTGRES_PASSWORD reaches postgres-roles alone, to move the superuser to the derived password', { skip }, () => {
  const all = configLegacy().services;
  assert.equal(env(all['postgres-roles']).POSTGRES_PREVIOUS_PASSWORD, PASSWORD);
  assert.ok(!('POSTGRES_PASSWORD' in env(all.postgres)), 'the server is still given no password');
  const holders = Object.entries(all)
    .filter(([, svc]) => Object.values(env(svc)).some((v) => typeof v === 'string' && v.includes(PASSWORD)))
    .map(([name]) => name);
  assert.deepEqual(holders, ['postgres-roles']);
});

test('Permify connects as its own role, its password read from a pgpass file', { skip }, () => {
  const permify = config().services.permify;
  const uri = new URL(env(permify).PERMIFY_DATABASE_URI);
  assert.equal(uri.username, 'permify');
  assert.equal(uri.password, '');
  assert.equal(uri.host, 'postgres:5432');
  assert.equal(uri.pathname, '/permify');
  assert.equal(env(permify).PGPASSFILE, `${SECRETS_MOUNT}/pgpass`);
  assert.equal(dependsOn(permify, 'postgres-roles'), 'service_completed_successfully');
});

/** Every variable a Community container is given: the application keys, then the infrastructure images'. */
const COMMUNITY_KEYS = new Set([
  // common to the services (x-app-env, x-db-env)
  'CYBEDEFEND_EDITION', 'CYBEDEFEND_SECRET_KEY', 'NODE_ENV', 'OTEL_DISABLED', 'NODE_PATH', 'APP_MODE',
  'REDIS_URL', 'REDIS_HOST', 'REDIS_PORT', 'REALTIME_REDIS_URL', 'FRONTEND_URL', 'PERMIFY_ENDPOINT', 'PERMIFY_SCHEMA_VERSION_FILE',
  'GRPC_URL', 'GRPC_URL_GLOBAL_MANAGEMENT_SERVICE', 'GRPC_URL_SECURITY_SCANNING_SERVICE', 'GRPC_URL_ANALYSIS_REPORTING_SERVICE',
  'GRPC_URL_FILE_MANAGEMENT_SERVICE', 'GRPC_URL_EXTERNAL_INTEGRATIONS_SERVICE', 'GRPC_URL_POLICY_MANAGEMENT_SERVICE',
  'DB_TYPE', 'DB_HOST', 'DB_PORT', 'DB_USERNAME', 'DB_PASSWORD_FILE', 'DB_SSL_ENABLED', 'DB_DATABASE',
  // the derived keys, each as a file, to the one service that reads it
  ...Object.values(SERVICE_DERIVED_KEYS).flat().map((key) => `${key}_FILE`),
  // the directory of the internal gRPC keys of each service: one per server it
  // calls, one per caller it serves
  'SERVICE_AUTH_PEER_KEYS_DIR',
  // the Permify preshared key, as a file, to Permify's clients only
  'PERMIFY_PRESHARED_KEY_FILE',
  // the Redis password, as a file, read by the start hook (runtime/redis-auth.cjs)
  'REDIS_PASSWORD_FILE', 'NODE_OPTIONS',
  // global-management: local auth and SMTP
  'AUTH_SIGNUP_MODE', 'CYBEDEFEND_SETUP_TOKEN', 'EMAIL_HOST', 'EMAIL_PORT', 'EMAIL_SECURE', 'EMAIL_USER', 'EMAIL_PASSWORD', 'EMAIL_FROM',
  // storage (security-scanning, file-management)
  'STORAGE_PROVIDER', 'S3_ENDPOINT', 'S3_PUBLIC_ENDPOINT', 'S3_BUCKET_NAME', 'AWS_REGION', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY_FILE',
  // external-integrations
  'GATEWAY_URL', 'APP_PUBLIC_URL', 'ALLOWED_SCAN_IPS', 'GITLAB_API_URL', 'GITLAB_APPLICATION_ID', 'GITLAB_APPLICATION_SECRET',
  'GITHUB_APP_ID', 'GITHUB_PRIVATE_KEY', 'GITHUB_PRIVATE_KEY_FILE', 'GITHUB_WEBHOOK_SECRET', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET',
  'JIRA_CLIENT_ID', 'JIRA_CLIENT_SECRET', 'LINEAR_CLIENT_ID', 'LINEAR_CLIENT_SECRET', 'LINEAR_WEBHOOK_SECRET',
  'SLACK_CLIENT_ID', 'SLACK_CLIENT_SECRET',
  // security-scanning: scans on a connected Kubernetes cluster (empty by default: import-only)
  'CYBEDEFEND_SCANNER_KUBECONFIG_FILE', 'CYBEDEFEND_SCANNER_NAMESPACE', 'CYBEDEFEND_SCANNER_IMAGE_REGISTRY', 'CYBEDEFEND_SCANNER_IMAGE_TAG',
  'CYBEDEFEND_SCANNER_IMAGE_PULL_SECRET', 'CYBEDEFEND_SCANNER_MAX_CONCURRENT', 'CYBEDEFEND_SCANNER_MAX_CONCURRENT_PER_ORGANIZATION',
  'CYBEDEFEND_SCANNER_RESOURCES', 'CYBEDEFEND_SCANNER_KEEP_PODS',
  'CYBEDEFEND_SCANNER_ALLOW_INSECURE_TLS', 'CYBEDEFEND_SCANNER_TRIVY_DB_REPOSITORY', 'CYBEDEFEND_SCANNER_TRIVY_JAVA_DB_REPOSITORY',
  // analysis-reporting: stored report limits (unset by default)
  'REPORTS_MAX_STORED_PER_ORG', 'REPORTS_RETENTION_DAYS',
  // gateway
  'AUTH_COOKIE_PATH', 'AUTH_COOKIE_INSECURE_LOCALHOST', 'TRUSTED_PROXY_CIDRS',
  // dashboard (nginx template and its config.js)
  'NGINX_ENVSUBST_OUTPUT_DIR', 'GATEWAY_UPSTREAM', 'CYBEDEFEND_STORAGE_PUBLIC_URL', 'CYBEDEFEND_API_URL', 'CYBEDEFEND_PUBLIC_URL', 'GITHUB_APP_URL',
  'CYBEDEFEND_TRUSTED_PROXIES',
  // mcp
  'PORT', 'CYBEDEFEND_API_RESOURCE', 'PUBLIC_URL', 'TRUST_PROXY_CIDR', 'MCP_ALLOWED_ORIGINS',
  // postgres, permify and the Permify schema job
  'POSTGRES_USER', 'POSTGRES_PASSWORD_FILE', 'POSTGRES_DB', 'PERMIFY_DATABASE_ENGINE', 'PERMIFY_DATABASE_URI', 'PERMIFY_HTTP_ENABLED',
  'PERMIFY_URL', 'PERMIFY_SCHEMA_PATH', 'PERMIFY_SCHEMA_VERSION_OUT', 'PGPASSFILE',
  // the role setup job (postgres-roles)
  'PGHOST', 'PGUSER', 'POSTGRES_PREVIOUS_PASSWORD',
  // init-secrets: the master key, from its file
  'CYBEDEFEND_SECRET_KEY_FILE',
  // the dashboard writes config.js to /tmp, its root filesystem being read-only
  'CYBEDEFEND_HTML_DIR',
]);

test('no container receives a derived key or a cloud-only variable', { skip }, () => {
  const forbidden = [
    'CONTAINER_REGISTRY_ENCRYPTION_KEY',
    'GITLAB_ENCRYPTION_KEY',
    'SECRET_ENCRYPTION_KEY',
    'SCAN_METADATA_ENCRYPTION_KEY',
    'AUTH_SIGNING_KEY_ENCRYPTION_KEY',
    'JWT_SECRET',
    'LOGTO_ENDPOINT',
    'LOGTO_API_RESOURCE',
    'LOGTO_CLI_APP_ID',
    'LOGTO_VSCODE_APP_ID',
    'LOGTO_INTELLIJ_APP_ID',
    'LOGTO_WEBHOOK_SIGNING_SECRET',
    'PERMIFY_TENANT_ID',
    'SITE_LEAD_SECRET',
    'TURNSTILE_SECRET_KEY',
    'LEAD_UNSUBSCRIBE_SECRET',
    'LOGTO_M2M_APP_ID',
    'LOGTO_M2M_APP_SECRET',
    'KUBECONFIG',
    'META_CAPI_ACCESS_TOKEN',
    'TWENTY_API_KEY',
    'GOOGLE_ADS_SERVICE_ACCOUNT_KEY',
  ];
  for (const [name, svc] of Object.entries(config().services)) {
    for (const key of Object.keys(env(svc))) {
      assert.ok(!forbidden.includes(key), `${name} receives ${key}`);
      // Any other variable (an analytics or CRM key included) is a new
      // decision: add it here only with its reason.
      assert.ok(COMMUNITY_KEYS.has(key), `${name} receives ${key}, which no Community container reads`);
    }
  }
});

test('every DB_DATABASE is created by postgres/init.sql', { skip }, () => {
  const created = new Set(
    [...readFileSync(join(DEPLOY_DIR, 'postgres', 'init.sql'), 'utf8').matchAll(/^CREATE DATABASE (\w+) OWNER cybedefend;/gm)].map(
      (m) => m[1],
    ),
  );
  const used = new Set(services().flatMap(([, svc]) => (env(svc).DB_DATABASE ? [env(svc).DB_DATABASE] : [])));
  const uri = env(config().services.permify).PERMIFY_DATABASE_URI;
  used.add(new URL(uri).pathname.slice(1));
  assert.deepEqual([...used].sort(), [...created].sort());
});

test('no service sets DB_TYPE=mysql', { skip }, () => {
  for (const [name, svc] of services()) {
    if ('DB_TYPE' in env(svc)) assert.equal(env(svc).DB_TYPE, 'postgres', name);
  }
});

test('every database service is on the single PostgreSQL', { skip }, () => {
  const all = config().services;
  assert.equal(env(all.postgres).POSTGRES_USER, 'cybedefend');
  const reachesPostgres = (name, seen = new Set()) => {
    if (seen.has(name)) return false;
    seen.add(name);
    const deps = all[name].depends_on ?? {};
    if (deps['postgres-roles']?.condition === 'service_completed_successfully') return true;
    return Object.entries(deps).some(([dep, d]) => d.condition === 'service_healthy' && all[dep] && reachesPostgres(dep, seen));
  };
  const dbServices = services().filter(([, svc]) => env(svc).DB_DATABASE);
  assert.ok(dbServices.length >= 13, `${dbServices.length} database services`);
  for (const [name, svc] of dbServices) {
    const e = env(svc);
    assert.equal(e.DB_TYPE, 'postgres', name);
    assert.equal(e.DB_HOST, 'postgres', name);
    assert.equal(e.DB_PORT, '5432', name);
    // Its own role, owner of its own database only, never the superuser.
    assert.equal(e.DB_USERNAME, e.DB_DATABASE, name);
    assert.notEqual(e.DB_USERNAME, 'cybedefend', name);
    assert.ok(Object.values(SERVICE_DATABASES).includes(e.DB_DATABASE), name);
    assert.equal(e.DB_SSL_ENABLED, 'false', name);
    assert.ok(!('DB_PASSWORD' in e), `${name} receives a database password in clear`);
    assert.equal(e.DB_PASSWORD_FILE, `${SECRETS_MOUNT}/db-password`, name);
    const service = APP_IMAGE.exec(svc.image)[1];
    assert.equal(e.DB_DATABASE, SERVICE_DATABASES[service], `${name} uses the database of ${service}`);
    assert.ok((svc.volumes ?? []).some((v) => v.source === `secrets-${service}` && v.target === SECRETS_MOUNT), `${name} mounts its secrets`);
    assert.ok(reachesPostgres(name), `${name} waits for its role to be set up`);
  }
  for (const name of ['gateway', 'dashboard', ...JOBS]) {
    assert.ok(!('DB_PASSWORD' in env(all[name])), `${name} has no database variable`);
  }
});

test('no MySQL image, volume or variable', { skip }, () => {
  const all = config();
  assert.ok(!('mysql' in all.services));
  assert.ok(!('mysql-data' in (all.volumes ?? {})));
  for (const [name, svc] of Object.entries(all.services)) {
    assert.ok(!/^(mysql|mariadb)/.test(svc.image ?? ''), `${name}: ${svc.image}`);
    for (const [key, value] of Object.entries(env(svc))) {
      assert.ok(!key.startsWith('MYSQL_'), `${name}: ${key}`);
      assert.ok(!/(^|[^0-9])3306([^0-9]|$)/.test(String(value ?? '')), `${name}: ${key} names port 3306`);
    }
  }
});

test('every container drops every capability and gains no privilege; only postgres and the two storage containers add a few back', { skip }, () => {
  const added = {};
  for (const [name, svc] of Object.entries(config().services)) {
    assert.deepEqual(svc.security_opt, ['no-new-privileges:true'], `${name}: security_opt`);
    assert.deepEqual(svc.cap_drop, ['ALL'], `${name}: cap_drop`);
    if (svc.cap_add) added[name] = [...svc.cap_add].sort();
  }
  assert.deepEqual(added, {
    postgres: ['CHOWN', 'DAC_OVERRIDE', 'FOWNER', 'SETGID', 'SETUID'],
    storage: ['CHOWN', 'SETGID', 'SETUID'],
    'storage-server': ['CHOWN', 'SETGID', 'SETUID'],
    // writes each consumer's files owned by the uid that reads them, and
    // reads the master key file whatever host user owns it (mode 600)
    'init-secrets': ['CHOWN', 'DAC_READ_SEARCH'],
  });
});

// The Redis image's entrypoint, started as root, walks /data to take
// ownership of it. With every capability dropped, root cannot enter the
// append-only directory Redis created there (mode 0700, owned by redis), so the
// second start of an instance failed. Both Redis containers run as the image's
// redis user from the start: the entrypoint skips that walk, and they need no
// capability at all.
test('both Redis containers run as the image redis user, so they start again on their own data', { skip }, () => {
  const all = config().services;
  for (const name of ['redis', 'mcp-redis']) {
    assert.equal(all[name].user, '999:1000', `${name}: user`);
    assert.equal(all[name].cap_add, undefined, `${name}: cap_add`);
  }
});

test('the postgres healthcheck goes through TCP', { skip }, () => {
  const check = config().services.postgres.healthcheck.test.join(' ');
  assert.match(check, /pg_isready/);
  assert.match(check, /-h 127\.0\.0\.1/);
  assert.match(config().services.postgres.image, /^postgres:18\.\d+-alpine3\.\d+@sha256:[0-9a-f]{64}$/);
});

// From PostgreSQL 18 the image keeps its data in /var/lib/postgresql/<major>/docker
// and declares /var/lib/postgresql as its volume. A volume mounted on the former
// /var/lib/postgresql/data would leave the cluster in the container: lost at the
// next recreate, and refused on a read-only root filesystem.
test('the postgres data volume is mounted on /var/lib/postgresql, the parent of the data directory', { skip }, () => {
  const svc = config().services.postgres;
  const data = (svc.volumes ?? []).filter((v) => v.source === 'postgres-data');
  assert.equal(data.length, 1, 'one postgres-data mount');
  assert.equal(data[0].target, '/var/lib/postgresql');
  assert.ok(!(svc.volumes ?? []).some((v) => v.target === '/var/lib/postgresql/data'), 'no mount on the PostgreSQL 16 path');
});

test('workers and crons start after their API, the gateway after the six APIs', { skip }, () => {
  const all = config().services;
  const after = {
    'security-scanning-cron': 'security-scanning',
    'analysis-reporting-worker': 'analysis-reporting',
    'analysis-reporting-worker-reports': 'analysis-reporting',
    'file-management-cron': 'file-management',
    'policy-management-worker': 'policy-management',
    'scheduler-analysis-reporting': 'analysis-reporting',
    'scheduler-external-integrations': 'external-integrations',
    'external-integrations-worker': 'external-integrations',
  };
  for (const [name, api] of Object.entries(after)) {
    assert.equal(dependsOn(all[name], api), 'service_healthy', `${name} after ${api}`);
  }
  for (const api of BACKENDS.filter((b) => b !== 'gateway')) {
    assert.equal(dependsOn(all.gateway, api), 'service_healthy', `gateway after ${api}`);
  }
  assert.equal(dependsOn(all.gateway, 'permify-schema'), 'service_completed_successfully');
  assert.equal(dependsOn(all['global-management'], 'permify-schema'), 'service_completed_successfully');
  assert.equal(dependsOn(all.dashboard, 'gateway'), 'service_healthy');
});

test('the security-scanning and file-management crons run', { skip }, () => {
  const all = config().services;
  assert.equal(env(all['security-scanning-cron']).APP_MODE, 'cron');
  assert.equal(env(all['file-management-cron']).APP_MODE, 'cron');
});

test('file-management and its cron, which inflate uploaded archives, run under a memory limit', { skip }, () => {
  // An uploaded ZIP is filtered entry by entry within size limits; the memory
  // limit keeps whatever still goes wrong from taking the host's memory.
  const all = config().services;
  for (const name of ['file-management', 'file-management-cron']) {
    const limit = Number(all[name].mem_limit);
    assert.ok(Number.isFinite(limit) && limit > 0, `${name} has no mem_limit`);
    assert.ok(limit >= 1024 ** 3, `${name}: mem_limit below 1 GiB`);
    assert.ok(limit <= 4 * 1024 ** 3, `${name}: mem_limit above 4 GiB`);
  }
});

test('one external-integrations worker runs the repository scans, with the API\'s image and environment', { skip }, () => {
  // Push and repository-link scans go to RepoScanQueue, and the pushes
  // deferred while a scan of their branch runs are rescanned from there: only
  // APP_MODE=worker consumes them. Without it, every such scan waited forever.
  const all = config().services;
  const workers = services().filter(([, svc]) => /cybedefend-external-integrations:/.test(svc.image ?? '') && env(svc).APP_MODE === 'worker');
  assert.deepEqual(workers.map(([name]) => name), ['external-integrations-worker']);
  const worker = all['external-integrations-worker'];
  const api = all['external-integrations'];
  assert.equal(worker.image, api.image);
  const { APP_MODE, ...rest } = env(worker);
  assert.equal(APP_MODE, 'worker');
  assert.deepEqual(rest, env(api));
  assert.equal(worker.restart, 'unless-stopped');
  for (const dep of ['redis', 'external-integrations']) {
    assert.equal(dependsOn(worker, dep), 'service_healthy', `external-integrations-worker after ${dep}`);
  }
  assert.equal(dependsOn(worker, 'postgres-roles'), 'service_completed_successfully');
  assert.deepEqual(worker.volumes, api.volumes);
  // It PUTs the repository archive through a URL signed on S3_ENDPOINT.
  assert.deepEqual(Object.keys(worker.networks).sort(), ['cybedefend', 'storage-net']);
  assert.deepEqual(worker.healthcheck.test.slice(0, 2), ['CMD', 'node']);
  assert.match(worker.healthcheck.test.join(' '), /http:\/\/127\.0\.0\.1:9095\/internal\/queue-metrics/);
});

const CLUSTER_MOUNT = [join(DEPLOY_DIR, 'cluster'), '/run/cybedefend-cluster', true];

test('security-scanning and its cron mount ./cluster read-only', { skip }, () => {
  // The cron runs the scan queue and the watchdog: it reads the kubeconfig too.
  const all = config().services;
  for (const name of ['security-scanning', 'security-scanning-cron']) {
    const mounts = all[name].volumes.map((v) => [v.source, v.target, Boolean(v.read_only)]);
    assert.deepEqual(
      mounts,
      [['runtime', '/run/cybedefend', true], [join(DEPLOY_DIR, 'runtime'), '/opt/cybedefend/runtime', true], ['secrets-security-scanning', SECRETS_MOUNT, true], CLUSTER_MOUNT],
      name,
    );
  }
  for (const [name, svc] of services()) {
    if (['security-scanning', 'security-scanning-cron'].includes(name)) continue;
    for (const v of svc.volumes ?? []) assert.notEqual(v.source, CLUSTER_MOUNT[0], `${name} mounts ./cluster`);
  }
});

const SCANNER_KEYS = [
  'CYBEDEFEND_SCANNER_KUBECONFIG_FILE',
  'CYBEDEFEND_SCANNER_NAMESPACE',
  'CYBEDEFEND_SCANNER_IMAGE_REGISTRY',
  'CYBEDEFEND_SCANNER_IMAGE_TAG',
  'CYBEDEFEND_SCANNER_IMAGE_PULL_SECRET',
  'CYBEDEFEND_SCANNER_MAX_CONCURRENT',
  'CYBEDEFEND_SCANNER_MAX_CONCURRENT_PER_ORGANIZATION',
  'CYBEDEFEND_SCANNER_RESOURCES',
  'CYBEDEFEND_SCANNER_KEEP_PODS',
  'CYBEDEFEND_SCANNER_ALLOW_INSECURE_TLS',
  'CYBEDEFEND_SCANNER_TRIVY_DB_REPOSITORY',
  'CYBEDEFEND_SCANNER_TRIVY_JAVA_DB_REPOSITORY',
];

test('the default compose sets no CYBEDEFEND_SCANNER_* value', { skip }, () => {
  // An empty value counts as unset: without .env values the instance is import-only.
  const all = config().services;
  for (const name of ['security-scanning', 'security-scanning-cron']) {
    for (const key of SCANNER_KEYS) assert.equal(env(all[name])[key], '', `${name}: ${key}`);
  }
  for (const [name, svc] of Object.entries(config().services)) {
    if (['security-scanning', 'security-scanning-cron'].includes(name)) continue;
    for (const key of Object.keys(env(svc))) assert.ok(!key.startsWith('CYBEDEFEND_SCANNER_'), `${name} receives ${key}`);
  }
  const example = readFileSync(join(DEPLOY_DIR, '.env.example'), 'utf8');
  for (const key of SCANNER_KEYS) {
    assert.ok(!new RegExp(`^${key}=`, 'm').test(example), `.env.example sets ${key}`);
  }
});

test('./cluster holds no kubeconfig in Git: its README says where to put it, its .gitignore ignores it', () => {
  const dir = join(DEPLOY_DIR, 'cluster');
  const ignore = readFileSync(join(dir, '.gitignore'), 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  // Everything but the two shipped files: a kubeconfig, and a client certificate and its key (README Step 2), never reach Git.
  assert.deepEqual(ignore, ['*', '!README.md', '!.gitignore']);
  const readme = readFileSync(join(dir, 'README.md'), 'utf8');
  assert.match(readme, /`kubeconfig`/);
  assert.match(readme, /CYBEDEFEND_SCANNER_KUBECONFIG_FILE=\/run\/cybedefend-cluster\/kubeconfig/);
  assert.match(readme, /CYBEDEFEND_SCANNER_NAMESPACE=/);
  assert.match(readme, /Run scans on a Kubernetes cluster/);
});

test('the gateway scopes the refresh cookie to /api/auth and trusts only the front network', { skip }, () => {
  const all = config();
  const gw = env(all.services.gateway);
  assert.equal(gw.AUTH_COOKIE_PATH, '/api/auth');
  // The bundled front reaches the gateway on the front network only.
  const subnet = all.networks.front.ipam.config[0].subnet;
  assert.equal(subnet, SUBNET);
  assert.equal(gw.TRUSTED_PROXY_CIDRS, subnet);
  assert.ok(!('TRUST_PROXY_CIDR' in gw));
  assert.equal(gw.APP_PUBLIC_URL, PUBLIC_URL);
  assert.equal(gw.AUTH_COOKIE_INSECURE_LOCALHOST, 'false');
});

test('the dashboard reads the API at /api', { skip }, () => {
  const dash = env(config().services.dashboard);
  assert.equal(dash.CYBEDEFEND_API_URL, '/api');
  assert.equal(dash.GATEWAY_UPSTREAM, 'gateway:3000');
});

test('the dashboard trusts no proxy by default and renders its real-ip file at start', { skip }, () => {
  const dash = config().services.dashboard;
  assert.equal(env(dash).CYBEDEFEND_TRUSTED_PROXIES, '');
  assert.deepEqual(
    dash.volumes.map((v) => [v.source, v.target, Boolean(v.read_only)]),
    [
      [join(DEPLOY_DIR, 'nginx', 'nginx.conf'), '/etc/nginx/nginx.conf', true],
      [join(DEPLOY_DIR, 'nginx', 'templates'), '/etc/nginx/templates', true],
      [
        join(DEPLOY_DIR, 'nginx', 'entrypoint.d', '15-cybedefend-trusted-proxies.sh'),
        '/docker-entrypoint.d/15-cybedefend-trusted-proxies.sh',
        true,
      ],
    ],
  );
});

// The MCP server is published on its own port, not behind the front: behind a
// TLS proxy every agent reaches it from the proxy's address. Its pre-auth rate
// limit keys on that address, so unless it trusts the same proxies as the
// front, one unauthenticated client can use up the limit for every agent.
test('the MCP server trusts the same proxies as the front, none by default', { skip }, () => {
  assert.equal(env(config().services.mcp).TRUST_PROXY_CIDR, '');
  const res = runCompose(['config', '--format', 'json'], undefined, {
    extra: ['CYBEDEFEND_TRUSTED_PROXIES=10.0.0.5,fd00:10::/64'],
  });
  assert.equal(res.status, 0, res.stderr);
  const all = JSON.parse(res.stdout);
  assert.equal(env(all.services.mcp).TRUST_PROXY_CIDR, '10.0.0.5,fd00:10::/64');
  assert.equal(env(all.services.dashboard).CYBEDEFEND_TRUSTED_PROXIES, '10.0.0.5,fd00:10::/64');
});

test('the README tells that the trusted proxies also set the MCP server\'s rate limit address', () => {
  const readme = readFileSync(join(DEPLOY_DIR, 'README.md'), 'utf8');
  const section = /### Behind your own proxy\n([\s\S]*?)\n### /.exec(readme);
  assert.ok(section, 'README has a "Behind your own proxy" section');
  assert.match(section[1], /MCP server/);
  assert.match(section[1], /120 requests a minute/);
});

test('no container runs an OSV or EPSS mode', { skip }, () => {
  for (const [name, svc] of Object.entries(config().services)) {
    assert.ok(!['cron-osv', 'main.cron-osv', 'cron-epss'].includes(env(svc).APP_MODE), name);
    assert.ok(!['analysis-reporting-cron-osv', 'analysis-reporting-cron-epss'].includes(name), name);
    for (const key of Object.keys(env(svc))) {
      assert.ok(!/^(OSV_|EPSS_)/.test(key), `${name}: ${key}`);
    }
  }
});

test('every long-running service but security-scanning-cron, file-management-cron, the two schedulers and analysis-reporting-worker-reports has a healthcheck', { skip }, () => {
  const unchecked = Object.entries(config().services)
    .filter(([name]) => !JOBS.includes(name))
    .filter(([, svc]) => !svc.healthcheck || svc.healthcheck.disable)
    .map(([name]) => name)
    .sort();
  assert.deepEqual(unchecked, [
    'analysis-reporting-worker-reports',
    'file-management-cron',
    'scheduler-analysis-reporting',
    'scheduler-external-integrations',
    'security-scanning-cron',
  ]);
  for (const name of JOBS) {
    assert.equal(config().services[name].restart, 'no', `${name} is a one-shot job`);
  }
});

const SEAWEEDFS_IMAGE = /^chrislusf\/seaweedfs:\d+\.\d+@sha256:[0-9a-f]{64}$/;
const shScript = (svc) => {
  const [shell, flag, script] = svc.entrypoint ?? [];
  assert.equal(shell, 'sh');
  assert.equal(flag, '-c');
  // `docker compose config` keeps the file's $$ escapes: the container runs $.
  return script.replaceAll('$$', '$');
};

test('storage-server is SeaweedFS, pinned by digest, every component of it on the loopback of the relay namespace', { skip }, () => {
  const all = config();
  const server = all.services['storage-server'];
  assert.match(server.image, SEAWEEDFS_IMAGE);
  assert.equal(all.services['storage-init'].image, server.image);
  // It joins the relay's namespace, so a crash restarted by Docker's policy
  // rejoins a live namespace (the relay is the one that owns it).
  assert.equal(server.network_mode, 'service:storage');
  assert.equal(server.networks, undefined);
  assert.equal(server.ports, undefined);
  assert.equal(server.restart, 'unless-stopped');
  const script = shScript(server);
  assert.match(script, /export AWS_ACCESS_KEY_ID=cybedefend AWS_SECRET_ACCESS_KEY="\$secret"/);
  assert.match(script, /cat \/run\/cybedefend-secrets\/storage-secret-key/);
  // An empty secret would start the S3 API with authentication off: refuse it.
  assert.match(script, /\[ -n "\$secret" \]/);
  assert.match(script, /exec \/entrypoint\.sh server /);
  for (const flag of ['-ip=127.0.0.1', '-ip.bind=127.0.0.1', '-s3', '-s3.ip.bind=127.0.0.1', '-s3.port=8333', '-s3.port.iceberg=0', '-s3.port.lance=0', '-master.telemetry=false']) {
    assert.ok(script.split(/\s+/).includes(flag), `storage-server runs with ${flag}`);
  }
  assert.ok(!/0\.0\.0\.0/.test(script), 'SeaweedFS binds nothing on the network');
  assert.ok(!/-webdav|-iam\b|-sftp|mini|-s3\.port\.grpc/.test(script), 'no other gateway is started');
  // A new collection reserves 7 volumes, and SeaweedFS allows 8 by default: the
  // first collection that writes takes them, and the bucket's then gets none
  // (« No writable volumes and no free volumes left », every import 503
  // IMPORT_STORAGE_UNAVAILABLE). Room for many
  // collections, in volumes of 1 GiB that are never preallocated.
  assert.ok(script.split(/\s+/).includes('-volume.max=100'), 'storage-server allows 100 volumes');
  assert.ok(script.split(/\s+/).includes('-master.volumeSizeLimitMB=1024'), 'storage-server caps a volume at 1 GiB');
  assert.ok(!/-master\.volumePreallocate/.test(script), 'no volume is preallocated');
  assert.equal(dependsOn(server, 'init-secrets'), 'service_completed_successfully');
  assert.equal(dependsOn(server, 'storage'), 'service_started');
  assert.deepEqual(server.healthcheck.test, ['CMD', 'curl', '-fsS', '-o', '/dev/null', 'http://127.0.0.1:8333/healthz']);
  assert.deepEqual(
    server.volumes.map((v) => [v.source, v.target, Boolean(v.read_only)]),
    [['storage-data', '/data', false], ['secrets-storage', SECRETS_MOUNT, true]],
  );
  assert.ok('storage-data' in all.volumes);
});

const NGINX_IMAGE = /^nginx:1\.31\.\d+-alpine3\.\d+@sha256:[0-9a-f]{64}$/;

test('storage is the relay: it owns the namespace, the port and the networks, and forwards only TCP 9000 to the loopback S3 API', { skip }, () => {
  // SeaweedFS serves its S3 gRPC (SeaweedS3IamCache: PutIdentity and others)
  // on -s3.ip.bind, port + 10000, with no authentication and no flag to bind
  // it apart: S3 stays on 127.0.0.1:8333 (gRPC 127.0.0.1:18333) and only this
  // stream relay listens on the network.
  const all = config();
  const relay = all.services.storage;
  assert.match(relay.image, NGINX_IMAGE);
  assert.equal(relay.network_mode, undefined);
  assert.equal(relay.restart, 'unless-stopped');
  assert.deepEqual(relay.entrypoint, ['nginx', '-g', 'daemon off;']);
  assert.equal(relay.read_only, true);
  assert.deepEqual(
    relay.volumes.map((v) => [v.source, v.target, Boolean(v.read_only)]),
    [[join(DEPLOY_DIR, 'storage', 'nginx.conf'), '/etc/nginx/nginx.conf', true]],
  );
  assert.deepEqual(relay.healthcheck.test, ['CMD', 'wget', '-q', '-O', '/dev/null', 'http://127.0.0.1:9000/healthz']);
  assert.equal(relay.depends_on, undefined, 'the relay starts first');
  assert.ok(!('storage-proxy' in all.services));
  // S3 really up behind the relay before anything uses it.
  assert.equal(dependsOn(all.services['storage-init'], 'storage-server'), 'service_healthy');

  const conf = readFileSync(join(DEPLOY_DIR, 'storage', 'nginx.conf'), 'utf8').replace(/#.*$/gm, '');
  assert.ok(!/\bhttp\s*\{/.test(conf), 'a stream relay only, no HTTP proxy that could rewrite Host');
  assert.deepEqual([...conf.matchAll(/^\s*listen\s+([^;]+);/gm)].map((m) => m[1].trim()), ['0.0.0.0:9000']);
  assert.deepEqual([...conf.matchAll(/^\s*proxy_pass\s+([^;]+);/gm)].map((m) => m[1].trim()), ['127.0.0.1:8333']);
});

test('the storage sits on its own internal network, shared only with the services that hold its credentials or a signed URL on it', { skip }, () => {
  // SeaweedFS serves its S3 gRPC (SeaweedS3IamCache: PutIdentity and others)
  // with no authentication; it is bound to the namespace loopback, and the
  // relay forwards only the S3 HTTP API (SigV4). storage-net holds the
  // holders of the admin S3 credentials, and the containers that use a URL
  // signed on S3_ENDPOINT (without them, every import failed with
  // IMPORT_STORAGE_UNAVAILABLE): the gateway PUTs the import, the worker GETs
  // it, the reports worker PUTs the report.
  const all = config();
  const nets = all.networks;
  assert.equal(nets['storage-net'].internal, true);
  assert.ok(!nets['storage-publish'].internal, 'the host port needs a network with a gateway');
  const on = (net) =>
    Object.entries(all.services)
      .filter(([, svc]) => net in (svc.networks ?? {}))
      .map(([name]) => name)
      .sort();
  assert.deepEqual(on('storage-net'), [
    'analysis-reporting-worker',
    'analysis-reporting-worker-reports',
    'external-integrations-worker',
    'file-management',
    'file-management-cron',
    'gateway',
    'storage',
    'storage-init',
  ]);
  assert.deepEqual(on('storage-publish'), ['storage']);
  assert.deepEqual(Object.keys(all.services.storage.networks).sort(), ['storage-net', 'storage-publish']);
  assert.deepEqual(Object.keys(all.services['storage-init'].networks), ['storage-net']);
  for (const name of ['file-management', 'file-management-cron', 'analysis-reporting-worker', 'analysis-reporting-worker-reports', 'external-integrations-worker']) {
    assert.deepEqual(Object.keys(all.services[name].networks).sort(), ['cybedefend', 'storage-net'], name);
  }
  assert.deepEqual(Object.keys(all.services.gateway.networks).sort(), ['cybedefend', 'front', 'storage-net']);
  // The S3 gRPC port is never published: only 9000 is.
  assert.deepEqual(all.services.storage.ports.map((p) => p.target), [9000]);
});

test('storage-init creates the bucket through a signed S3 request, once SeaweedFS answers behind the relay', { skip }, () => {
  const all = config().services;
  const init = all['storage-init'];
  assert.equal(dependsOn(init, 'storage-server'), 'service_healthy');
  assert.equal(init.restart, 'no');
  const script = shScript(init);
  assert.match(script, /--aws-sigv4 aws:amz:us-east-1:s3/);
  assert.match(script, /-X PUT http:\/\/storage:9000\/cybedefend/);
  assert.match(script, /BucketAlreadyOwnedByYou/);
  assert.match(script, /cat \/run\/cybedefend-secrets\/storage-secret-key/);
  assert.deepEqual(init.volumes.map((v) => [v.source, v.target, Boolean(v.read_only)]), [['secrets-storage', SECRETS_MOUNT, true]]);
  // The secret reaches curl on its standard input, never on its command line.
  assert.match(script, /curl [^\n]*-K -/);
  assert.ok(!/--user|-u /.test(script), 'no credential on the command line');
});

test('file-management and security-scanning point at the storage', { skip }, () => {
  const all = config().services;
  assert.deepEqual(
    Object.fromEntries(
      ['STORAGE_PROVIDER', 'S3_ENDPOINT', 'S3_PUBLIC_ENDPOINT', 'S3_BUCKET_NAME', 'AWS_REGION', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY_FILE'].map((k) => [
        k,
        env(all['file-management'])[k],
      ]),
    ),
    {
      STORAGE_PROVIDER: 's3',
      S3_ENDPOINT: 'http://storage:9000',
      S3_PUBLIC_ENDPOINT: 'http://localhost:9000',
      S3_BUCKET_NAME: 'cybedefend',
      AWS_REGION: 'us-east-1',
      S3_ACCESS_KEY_ID: 'cybedefend',
      S3_SECRET_ACCESS_KEY_FILE: '/run/cybedefend-secrets/storage-secret-key',
    },
  );
  assert.equal(dependsOn(all['file-management'], 'storage-init'), 'service_completed_successfully');
  for (const name of ['security-scanning', 'security-scanning-cron']) {
    assert.equal(env(all[name]).S3_ENDPOINT, 'http://storage:9000', name);
    assert.equal(env(all[name]).S3_BUCKET_NAME, 'cybedefend', name);
  }
});

test('no MinIO service, image, volume or variable is left', { skip }, () => {
  const all = config();
  assert.ok(!/minio/i.test(JSON.stringify(all)), 'the resolved configuration names MinIO');
  assert.ok(!/minio/i.test(readFileSync(join(DEPLOY_DIR, 'docker-compose.yml'), 'utf8')));
  assert.ok(!/minio/i.test(readFileSync(join(DEPLOY_DIR, '.env.example'), 'utf8')));
});

// libs/ sits at the root of the tree.
const VARIANTS = findUp(DEPLOY_DIR, join('libs', 'test-fixtures', 'compose', 'variants'));
const variantConfig = (name, extra = [], extraEnv) =>
  JSON.parse(compose(['-f', join(VARIANTS, `${name}.yml`), ...extra, 'config', '--format', 'json'], extraEnv));

test('the smtp variant adds mailpit and points global-management at it', { skip }, () => {
  const all = variantConfig('smtp').services;
  assert.match(all.mailpit.image, /^axllent\/mailpit:v\d+\.\d+\.\d+$/);
  const gm = env(all['global-management']);
  assert.equal(gm.EMAIL_HOST, 'mailpit');
  assert.equal(gm.EMAIL_PORT, '1025');
  assert.equal(gm.EMAIL_SECURE, 'false');
  assert.equal(gm.EMAIL_FROM, 'CybeDefend <cybedefend@example.test>');
  assert.equal(dependsOn(all['global-management'], 'postgres-roles'), 'service_completed_successfully', 'the base dependencies are kept');
});

test('the storage-late variant starts without the storage and file-management does not wait for it', { skip }, () => {
  const all = variantConfig('storage-late').services;
  for (const name of ['storage', 'storage-server', 'storage-init']) assert.ok(!(name in all), `${name} is off without the late profile`);
  const late = variantConfig('storage-late', ['--profile', 'late']).services;
  assert.deepEqual(late.storage.profiles, ['late']);
  assert.deepEqual(late['storage-init'].profiles, ['late']);
  assert.deepEqual(late['storage-server'].profiles, ['late']);
  const fm = all['file-management'];
  assert.equal(dependsOn(fm, 'storage-init'), undefined);
  assert.equal(dependsOn(fm, 'init-secrets'), 'service_completed_successfully');
  assert.equal(dependsOn(fm, 'postgres-roles'), 'service_completed_successfully');
});

test('the cluster variant points both scanning services at the kind cluster and puts the front and the storage on its network', { skip }, () => {
  const all = variantConfig('cluster', [], {
    CYBEDEFEND_KIND_NETWORK: 'cd-smoke-kind',
    CYBEDEFEND_KIND_DASHBOARD_IP: '172.30.250.250',
    CYBEDEFEND_KIND_STORAGE_IP: '172.30.250.251',
    CYBEDEFEND_SCANNER_IMAGE_TAG: '0.0.0-smoke',
  });
  for (const name of ['security-scanning', 'security-scanning-cron']) {
    const e = env(all.services[name]);
    assert.deepEqual(
      Object.fromEntries(Object.entries(e).filter(([k]) => k.startsWith('CYBEDEFEND_SCANNER_'))),
      {
        CYBEDEFEND_SCANNER_KUBECONFIG_FILE: '/run/cybedefend-cluster/kubeconfig',
        CYBEDEFEND_SCANNER_NAMESPACE: 'cd-scans',
        CYBEDEFEND_SCANNER_IMAGE_REGISTRY: 'ghcr.io/cybedefend',
        CYBEDEFEND_SCANNER_IMAGE_TAG: '0.0.0-smoke',
        CYBEDEFEND_SCANNER_IMAGE_PULL_SECRET: '',
        CYBEDEFEND_SCANNER_MAX_CONCURRENT: '2',
        CYBEDEFEND_SCANNER_MAX_CONCURRENT_PER_ORGANIZATION: '',
        CYBEDEFEND_SCANNER_RESOURCES: '',
        CYBEDEFEND_SCANNER_KEEP_PODS: 'false',
        CYBEDEFEND_SCANNER_ALLOW_INSECURE_TLS: '',
        CYBEDEFEND_SCANNER_TRIVY_DB_REPOSITORY: '',
        CYBEDEFEND_SCANNER_TRIVY_JAVA_DB_REPOSITORY: '',
      },
      name,
    );
    assert.equal(e.DB_DATABASE, 'cybedefend_scanning', `${name} keeps its base environment`);
    assert.deepEqual(Object.keys(all.services[name].networks).sort(), ['cybedefend', 'kind'], name);
  }
  assert.equal(all.services.dashboard.networks.kind.ipv4_address, '172.30.250.250');
  assert.deepEqual(Object.keys(all.services.dashboard.networks).sort(), ['front', 'kind']);
  assert.equal(all.services.storage.networks.kind.ipv4_address, '172.30.250.251');
  assert.deepEqual(Object.keys(all.services.storage.networks).sort(), ['kind', 'storage-net', 'storage-publish']);
  assert.equal(all.networks.kind.external, true);
  assert.equal(all.networks.kind.name, 'cd-smoke-kind');
});

test('the published containers reach the gateway only: front and back networks', { skip }, () => {
  const all = config();
  const on = (net) =>
    Object.entries(all.services)
      .filter(([, svc]) => net in (svc.networks ?? {}))
      .map(([name]) => name)
      .sort();
  // front: what publishes a port to users, and the gateway they talk to.
  assert.deepEqual(on('front'), ['dashboard', 'gateway', 'mcp']);
  assert.ok(!all.networks.front.internal, 'the published ports need a network with a gateway');
  assert.deepEqual(Object.keys(all.services.dashboard.networks), ['front']);
  assert.deepEqual(Object.keys(all.services.mcp.networks).sort(), ['front', 'mcp-sessions']);
  // back: every other application container and the infrastructure behind it.
  for (const [name, svc] of Object.entries(all.services)) {
    // init-secrets has no network at all (network_mode: none).
    if (['dashboard', 'mcp', 'mcp-redis', 'gateway', 'storage', 'storage-server', 'storage-init', 'init-secrets'].includes(name)) continue;
    assert.ok('cybedefend' in (svc.networks ?? {}), `${name} is on the back network`);
    assert.ok(!('front' in svc.networks), `${name} is not on the front network`);
  }
  assert.ok('cybedefend' in all.services.gateway.networks, 'the gateway reaches the services behind it');
  // Each published container shares no network with a back service.
  const back = new Set(on('cybedefend'));
  for (const name of ['dashboard', 'mcp']) {
    for (const net of Object.keys(all.services[name].networks)) {
      const peers = on(net).filter((peer) => peer !== name && back.has(peer));
      assert.deepEqual(peers, net === 'front' ? ['gateway'] : [], `${name} on ${net}`);
    }
  }
});

test('the override the README gives leaves the MCP server and its Redis out', { skip }, () => {
  const readme = readFileSync(join(DEPLOY_DIR, 'README.md'), 'utf8');
  const section = readme.slice(readme.indexOf('## The MCP server'));
  const block = /```yaml\n([\s\S]*?)```/.exec(section);
  assert.ok(block, 'the README gives the override');
  const dir = mkdtempSync(join(tmpdir(), 'cd-compose-override-'));
  try {
    const override = join(dir, 'docker-compose.override.yml');
    writeFileSync(override, block[1]);
    const listed = compose(['-f', override, 'config', '--services']).split('\n').filter(Boolean);
    assert.ok(!listed.includes('mcp'), 'mcp is left out');
    assert.ok(!listed.includes('mcp-redis'), 'mcp-redis is left out');
    assert.ok(listed.includes('gateway'), 'the rest of the stack still starts');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('mcp keeps its sessions in a Redis of its own, which nothing else reaches', { skip }, () => {
  const all = config();
  const mcp = all.services.mcp;
  const store = all.services['mcp-redis'];
  assert.equal(env(mcp).REDIS_URL, 'redis://mcp-redis:6379');
  assert.equal(store.profiles, undefined);
  assert.deepEqual(Object.keys(store.networks), ['mcp-sessions']);
  assert.equal(all.networks['mcp-sessions'].internal, true);
  assert.equal(dependsOn(mcp, 'mcp-redis'), 'service_healthy');
  assert.equal(dependsOn(mcp, 'redis'), undefined);
  assert.deepEqual(store.ports ?? [], []);
  assert.deepEqual(store.cap_drop, ['ALL']);
  const members = Object.entries(all.services)
    .filter(([, svc]) => 'mcp-sessions' in (svc.networks ?? {}))
    .map(([name]) => name)
    .sort();
  assert.deepEqual(members, ['mcp', 'mcp-redis']);
});

test('docker-compose.build.yml builds every application container, the external-integrations worker included', { skip }, () => {
  const all = JSON.parse(compose(['-f', 'docker-compose.build.yml', 'config', '--format', 'json'])).services;
  const built = new Set(Object.values(all).flatMap((svc) => (svc.build ? [svc.image] : [])));
  const unbuilt = Object.entries(all)
    .filter(([, svc]) => APP_IMAGE.test(svc.image ?? '') && !built.has(svc.image))
    .map(([name]) => name);
  assert.deepEqual(unbuilt, []);
  assert.ok(built.has(all['external-integrations-worker'].image));
});

// Several containers run one image (an API, its workers, its scheduler). A
// build on each made the same image be built and unpacked once per container,
// which filled a CI runner's disk: one service builds it, the others reuse it
// and never pull it (a pull would fetch a published release over the source).
test('docker-compose.build.yml builds each image once, and the containers that share it never pull it', { skip }, () => {
  const all = JSON.parse(compose(['-f', 'docker-compose.build.yml', 'config', '--format', 'json'])).services;
  const builders = Object.entries(all).filter(([, svc]) => svc.build);
  const images = builders.map(([, svc]) => svc.image);
  assert.equal(new Set(images).size, images.length, `an image built twice: ${images.join(', ')}`);
  assert.equal(images.length, 9);
  const sharing = Object.entries(all)
    .filter(([, svc]) => !svc.build && images.includes(svc.image))
    .map(([name, svc]) => [name, svc.pull_policy]);
  assert.ok(sharing.length > 0);
  for (const [name, policy] of sharing) assert.equal(policy, 'never', name);
  // The analysis-reporting image: the API, both workers and the scheduler.
  const ar = all['analysis-reporting'].image;
  assert.deepEqual(
    Object.entries(all).filter(([, svc]) => svc.image === ar).map(([name]) => name).sort(),
    ['analysis-reporting', 'analysis-reporting-worker', 'analysis-reporting-worker-reports', 'scheduler-analysis-reporting'],
  );
});

const hasGit = spawnSync('git', ['--version'], { encoding: 'utf8' }).status === 0;

test('git ignores a GitHub App key put in ./github, never its README', { skip: hasGit ? false : 'git is not installed' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'cd-github-ignore-'));
  try {
    const github = join(dir, 'github');
    mkdirSync(github);
    for (const f of ['.gitignore', 'README.md']) writeFileSync(join(github, f), readFileSync(join(DEPLOY_DIR, 'github', f)));
    writeFileSync(join(github, 'private-key.pem'), '');
    assert.equal(spawnSync('git', ['init', '-q'], { cwd: dir }).status, 0);
    const ignored = (f) => spawnSync('git', ['check-ignore', '-q', `github/${f}`], { cwd: dir }).status === 0;
    assert.ok(ignored('private-key.pem'));
    for (const f of ['README.md', '.gitignore']) assert.ok(!ignored(f), `github/${f} is not ignored`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('every external-integrations container mounts ./github read-only, for GITHUB_PRIVATE_KEY_FILE', { skip }, () => {
  const containers = services().filter(([, svc]) => APP_IMAGE.exec(svc.image ?? '')?.[1] === 'external-integrations');
  assert.equal(containers.length, 3);
  for (const [name, svc] of containers) {
    assert.ok(
      svc.volumes.some((v) => v.source === join(DEPLOY_DIR, 'github') && v.target === '/run/cybedefend-github' && v.read_only),
      `${name} mounts ./github`,
    );
  }
  assert.match(EXAMPLE, /^# GITHUB_PRIVATE_KEY_FILE=\/run\/cybedefend-github\/private-key\.pem$/m);
  assert.match(readFileSync(join(DEPLOY_DIR, 'README.md'), 'utf8'), /\/run\/cybedefend-github\/private-key\.pem/);
});

// ─── Read-only root filesystems ──────────────────────────────────────────────

const tmpfsPaths = (svc) => (svc.tmpfs ?? []).map((t) => t.split(':')[0]);
const volumeAt = (svc, target) => (svc.volumes ?? []).find((v) => v.target === target);
/** The images that write large files to /tmp (archives, clones, reports): a disk volume, never memory. */
const DISK_TMP = ['analysis-reporting', 'file-management', 'external-integrations'];

test('every container runs on a read-only root filesystem, with a writable /tmp', { skip }, () => {
  for (const [name, svc] of Object.entries(config().services)) {
    assert.equal(svc.read_only, true, `${name} is read-only`);
    const disk = volumeAt(svc, '/tmp');
    assert.ok(tmpfsPaths(svc).includes('/tmp') || disk, `${name} has a writable /tmp`);
    if (DISK_TMP.includes(APP_IMAGE.exec(svc.image ?? '')?.[1])) {
      assert.ok(disk && disk.type === 'volume' && !disk.read_only, `${name}: /tmp on a volume of its own`);
      assert.ok(!disk.source, `${name}: an anonymous volume, one per container`);
      assert.ok(!tmpfsPaths(svc).includes('/tmp'), `${name}: /tmp is not held in memory`);
    }
  }
});

test('the read-only front writes its rendered configuration, its cache and config.js to memory only', { skip }, () => {
  const dash = config().services.dashboard;
  assert.deepEqual(tmpfsPaths(dash).sort(), ['/tmp', '/tmp/conf.d', '/var/cache/nginx']);
  // nginx runs as a user of its own: a tmpfs takes the mode of the image's
  // directory (/var/cache/nginx: 755, owned by that user) and root as owner,
  // so each one says mode=1777.
  for (const t of dash.tmpfs) assert.match(t, /(^|[:,])mode=1777(,|$)/, t);
  assert.equal(env(dash).NGINX_ENVSUBST_OUTPUT_DIR, '/tmp/conf.d');
  assert.equal(env(dash).CYBEDEFEND_HTML_DIR, '/tmp');
  assert.ok(tmpfsPaths(config().services.postgres).includes('/var/run/postgresql'));
});

test('the header says which containers publish a port: dashboard, storage, and mcp with its profile', () => {
  const header = readFileSync(join(DEPLOY_DIR, 'docker-compose.yml'), 'utf8').split(/^name:/m)[0];
  assert.match(header, /dashboard/);
  assert.match(header, /storage/);
  assert.match(header, /mcp[^\n]*\n?[^\n]*3010|3010[^\n]*\n?[^\n]*mcp/);
  assert.doesNotMatch(header, /Only the web front \(dashboard\) and the object storage \(storage\) publish/);
});

test('git ignores a kubeconfig, a certificate and a key put in ./cluster, never its README', { skip: hasGit ? false : 'git is not installed' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'cd-cluster-ignore-'));
  try {
    const cluster = join(dir, 'cluster');
    mkdirSync(cluster);
    for (const f of ['.gitignore', 'README.md']) writeFileSync(join(cluster, f), readFileSync(join(DEPLOY_DIR, 'cluster', f)));
    for (const f of ['kubeconfig', 'client.crt', 'client.key']) writeFileSync(join(cluster, f), '');
    assert.equal(spawnSync('git', ['init', '-q'], { cwd: dir }).status, 0);
    const ignored = (f) => spawnSync('git', ['check-ignore', '-q', `cluster/${f}`], { cwd: dir }).status === 0;
    for (const f of ['kubeconfig', 'client.crt', 'client.key']) assert.ok(ignored(f), `cluster/${f} is ignored`);
    for (const f of ['README.md', '.gitignore']) assert.ok(!ignored(f), `cluster/${f} is not ignored`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ─── Permify authentication ──────────────────────────────────────────────────
// Permify answers only the calls that carry the preshared key derived from
// CYBEDEFEND_SECRET_KEY. init-secrets writes the configuration that enforces it
// to Permify's own secrets volume, and the key to each client's own volume.

const PERMIFY_CLIENT_NAMES = ['permify-schema', 'gateway', 'global-management'];

test('Permify runs with the configuration that enforces the preshared key, once it is written', { skip }, () => {
  const permify = config().services.permify;
  assert.deepEqual(permify.command, ['serve', '--config', `${SECRETS_MOUNT}/permify.yaml`]);
  assert.ok((permify.volumes ?? []).some((v) => v.source === 'secrets-permify' && v.target === SECRETS_MOUNT && v.read_only));
  // No environment variable may turn authentication off or replace the key.
  for (const key of Object.keys(env(permify))) {
    assert.ok(!key.startsWith('PERMIFY_AUTHN_'), `permify receives ${key}`);
  }
});

test('every Permify client reads the key from its own secrets volume, and no other container receives it', { skip }, () => {
  const all = config();
  for (const name of PERMIFY_CLIENT_NAMES) {
    assert.equal(env(all.services[name]).PERMIFY_PRESHARED_KEY_FILE, `${SECRETS_MOUNT}/permify-preshared-key`, name);
  }
  for (const [name, svc] of Object.entries(all.services)) {
    if (PERMIFY_CLIENT_NAMES.includes(name)) continue;
    for (const key of Object.keys(env(svc))) {
      assert.ok(!key.startsWith('PERMIFY_PRESHARED_KEY'), `${name} receives ${key}`);
      assert.ok(!key.startsWith('PERMIFY_AUTHN_'), `${name} receives ${key}`);
    }
  }
});

// ─── Redis authentication ────────────────────────────────────────────────────
// The shared Redis requires a password derived from CYBEDEFEND_SECRET_KEY.
// init-secrets writes it to Redis's own secrets volume and to each service's;
// the services' start hook reads it from REDIS_PASSWORD_FILE.

const REDIS_PASSWORD_PATH = `${SECRETS_MOUNT}/redis-password`;
const REDIS_HOOK = '/opt/cybedefend/runtime/redis-auth.cjs';
const mountAt = (svc, target) => (svc.volumes ?? []).find((v) => v.target === target);
const usesSharedRedis = (svc) => {
  const e = env(svc);
  if (e.REDIS_HOST === 'redis') return true;
  return ['REDIS_URL', 'REALTIME_REDIS_URL'].some((key) => key in e && new URL(e[key]).hostname === 'redis');
};

test('Redis requires the password from its own secrets volume, and its healthcheck authenticates', { skip }, () => {
  const redis = config().services.redis;
  const mount = mountAt(redis, SECRETS_MOUNT);
  assert.equal(mount?.source, 'secrets-redis');
  assert.equal(Boolean(mount?.read_only), true);
  const script = shScript(redis);
  // requirepass goes to redis-server on its standard input (a config read
  // from `-`), never on its command line, and the image's entrypoint still
  // drops to the redis user.
  assert.match(script, new RegExp(`cat ${REDIS_PASSWORD_PATH}`));
  assert.match(script, /exec docker-entrypoint\.sh redis-server - --appendonly yes/);
  assert.match(script, /requirepass \$password/);
  assert.match(script, /\[ -n "\$password" \]/);
  assert.ok(!redis.command, 'the script is the whole start command');
  const check = redis.healthcheck.test;
  assert.equal(check[0], 'CMD-SHELL');
  const line = check[1].replaceAll('$$', '$');
  assert.match(line, new RegExp(`REDISCLI_AUTH="\\$\\(cat ${REDIS_PASSWORD_PATH}\\)"`));
  assert.match(line, /redis-cli ping \| grep -qx PONG/);
});

test('every client of the shared Redis gets the password through the start hook, from its own secrets volume', { skip }, () => {
  const all = config().services;
  const clients = Object.entries(all).filter(([, svc]) => usesSharedRedis(svc));
  assert.ok(clients.length >= 15, `${clients.length} Redis clients`); // every service process; mcp has its own store
  for (const [name, svc] of clients) {
    const e = env(svc);
    assert.equal(e.REDIS_PASSWORD_FILE, REDIS_PASSWORD_PATH, name);
    assert.ok(String(e.NODE_OPTIONS ?? '').split(/\s+/).join(' ').includes(`--require ${REDIS_HOOK}`), `${name}: NODE_OPTIONS loads the hook`);
    const secrets = mountAt(svc, SECRETS_MOUNT);
    assert.match(String(secrets?.source), /^secrets-/, `${name} mounts its own secrets`);
    const hook = mountAt(svc, '/opt/cybedefend/runtime');
    assert.equal(hook?.source, join(DEPLOY_DIR, 'runtime'), `${name} mounts the hook`);
    assert.equal(Boolean(hook?.read_only), true, name);
  }
  for (const [name, svc] of Object.entries(all)) {
    const e = env(svc);
    assert.ok(!('REDIS_PASSWORD' in e), `${name}: the password never comes from the compose file`);
    for (const key of ['REDIS_URL', 'REALTIME_REDIS_URL']) {
      if (key in e) assert.equal(new URL(e[key]).password, '', `${name}: ${key} carries no password in the compose file`);
    }
  }
});

test('the Redis hook in the runtime folder is the one the services load', () => {
  const hook = readFileSync(join(DEPLOY_DIR, 'runtime', 'redis-auth.cjs'), 'utf8');
  assert.match(hook, /REDIS_PASSWORD_FILE/);
});

// The smoke test waits for every long-running container to be healthy and for
// every one-shot job to exit 0: a job missing from its list is judged as a
// service and fails the run once it exits.
test('the smoke test knows every one-shot job of the stack', { skip }, async () => {
  const { JOBS } = await import('../smoke/run.mjs');
  const oneShot = Object.entries(config().services)
    .filter(([, svc]) => svc.restart === 'no')
    .map(([name]) => name)
    .sort();
  assert.deepEqual([...JOBS].sort(), oneShot);
});
