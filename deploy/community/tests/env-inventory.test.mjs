// The environment inventory guard: every configuration key the services'
// core code reads is classified in env-inventory.json, and the inventory, the
// compose file, the schedules and .env.example agree with that classification.
//
// It reads the real source tree: <root>/apps/<service>-service/src/**/*.ts, where
// <root> is CYBEDEFEND_TREE, else the nearest directory above this file that
// holds apps/:
//
//   CYBEDEFEND_TREE="$PWD" node --test deploy/community/tests/env-inventory.test.mjs
//
// Skipped from the scan: closed code (src/ee/ and src/edition/ee-*.ts, absent
// or empty in this tree), generated code (src/core/grpc/), specs and the frozen
// MySQL migration track (src/core/migrations/).
//
// The compose checks use `docker compose config` (parse only, no container)
// and are skipped, with a message, when docker is not installed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEPLOY_DIR = resolve(HERE, '..');
// The source tree: the nearest directory above this file that holds apps/.
function treeRoot(from) {
  let dir = resolve(from);
  for (;;) {
    if (existsSync(join(dir, 'apps'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return resolve(from, '..', '..', '..');
    dir = parent;
  }
}
const ROOT = resolve(process.env.CYBEDEFEND_TREE || treeRoot(HERE));
const INVENTORY_PATH = join(DEPLOY_DIR, 'env-inventory.json');

const SERVICES = [
  'gateway',
  'global-management',
  'security-scanning',
  'analysis-reporting',
  'file-management',
  'external-integrations',
  'policy-management',
  // The MCP server, started with the stack: its settings reach it
  // like any other service's (FRONTEND_URL included, which it requires in
  // production).
  'mcp',
];
/**
 * Keys a service's Joi schema declares only for the cloud (optional in the
 * Community Edition, read by closed code alone), each with why: the entry
 * names the services that read it in this edition.
 */
const CLOUD_ONLY_DECLARATIONS = {
  // security-scanning allow-lists its cloud scanner pods (closed code)
  ALLOWED_SCAN_IPS: ['security-scanning'],
};
const CLASSES = ['required', 'optional', 'internal', 'derived', 'default', 'cloud-only', 'unused'];
/**
 * Keys a service still accepts (its Community secrets source falls back to
 * them) that the compose file gives to one job only, each with why.
 */
const JOB_ONLY = {
  // The master key: init-secrets derives every key from it and hands each
  // service only the ones it reads, as <KEY>_FILE. A compromised container
  // must not be able to re-derive the keys of the others.
  CYBEDEFEND_SECRET_KEY: 'init-secrets',
};
/** Where a container mounts its own secrets volume (runtime/derive-secrets.mjs). */
const SECRETS_MOUNT = '/run/cybedefend-secrets';
/**
 * The containers of the stack that are not NestJS services but read settings
 * of the inventory: the dashboard's front reads them in its start scripts
 * (nginx/entrypoint.d/*.sh, mounted into the nginx image's /docker-entrypoint.d).
 * A key is read there when a script names it as ${CYBEDEFEND_…}.
 */
const FRONTS = { dashboard: join(DEPLOY_DIR, 'nginx', 'entrypoint.d') };
const FRONT_PATTERN = /\$\{(CYBEDEFEND_[A-Z0-9_]*)\b/g;

const KEY = '([A-Z][A-Z0-9_]*)';
const Q = '[\'"`]';
/**
 * Every way the core reads a configuration key (calls may span lines): the
 * secrets source, the Nest ConfigService (a receiver named *config* or cfg,
 * so that Map lookups such as metrics.get('AV') are not taken for keys) and
 * process.env.
 */
const CODE_PATTERNS = [
  new RegExp(`\\bgetSecret(?:OrEnv)?\\s*(?:<[^>()]*>)?\\s*\\(\\s*${Q}${KEY}${Q}`, 'g'),
  new RegExp(`\\b(?:[\\w$]*[cC]onfig[\\w$]*|cfg)\\s*\\??\\.get\\s*(?:<[^()]*?>)?\\s*\\(\\s*${Q}${KEY}${Q}`, 'g'),
  new RegExp(`\\bprocess\\.env\\.${KEY}\\b`, 'g'),
  new RegExp(`\\bprocess\\.env\\s*\\[\\s*${Q}${KEY}${Q}\\s*\\]`, 'g'),
];
/** The keys a Joi validation schema declares (validated at boot, read through ConfigService). */
const JOI_PATTERN = new RegExp(`^[ \\t]*['"]?${KEY}['"]?\\s*:\\s*Joi\\b`, 'gm');

const isExcluded = (rel) =>
  rel.startsWith(['src', 'ee', ''].join(sep)) ||
  rel.startsWith(['src', 'core', 'grpc', ''].join(sep)) ||
  rel.startsWith(['src', 'core', 'migrations', ''].join(sep)) ||
  /^src[\\/]edition[\\/]ee-[^\\/]*\.ts$/.test(rel) ||
  rel.endsWith('.spec.ts');

function sourceFiles(service) {
  const dir = join(ROOT, 'apps', `${service}-service`);
  const src = join(dir, 'src');
  if (!existsSync(src)) return [];
  return readdirSync(src, { recursive: true })
    .map((p) => join(src, String(p)))
    .filter((p) => p.endsWith('.ts') && !p.endsWith('.d.ts'))
    .filter((p) => !p.split(sep).includes('node_modules'))
    .filter((p) => !isExcluded(relative(dir, p)));
}

const lineOf = (text, index) => text.slice(0, index).split('\n').length;

/** key -> { code: Set<service> (read by code), joi: Set<service> (declared by a Joi schema), sites } */
function scan() {
  const found = new Map();
  const note = (key, service, kind, site) => {
    const entry = found.get(key) ?? { code: new Set(), joi: new Set(), sites: [] };
    entry[kind].add(service);
    entry.sites.push(site);
    found.set(key, entry);
  };
  for (const service of SERVICES) {
    for (const file of sourceFiles(service)) {
      const text = readFileSync(file, 'utf8');
      const site = (m) => `${relative(ROOT, file)}:${lineOf(text, m.index)}`;
      for (const re of CODE_PATTERNS) for (const m of text.matchAll(re)) note(m[1], service, 'code', site(m));
      for (const m of text.matchAll(JOI_PATTERN)) note(m[1], service, 'joi', site(m));
    }
  }
  for (const [front, dir] of Object.entries(FRONTS)) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir).filter((n) => n.endsWith('.sh'))) {
      const file = join(dir, name);
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(FRONT_PATTERN)) note(m[1], front, 'code', `${relative(DEPLOY_DIR, file)}:${lineOf(text, m.index)}`);
    }
  }
  return found;
}

let cachedScan;
const reads = () => (cachedScan ??= scan());
const inventory = () => JSON.parse(readFileSync(INVENTORY_PATH, 'utf8'));
const byKey = () => new Map(inventory().map((e) => [e.variable, e]));

/** The derived keys of each service's Community secrets source (DERIVED_SECRET_KEYS of secret-key.ts). */
function derivedKeysOf(service) {
  const file = join(ROOT, 'apps', `${service}-service`, 'src', 'core', 'secrets', 'secret-key.ts');
  const text = readFileSync(file, 'utf8');
  const start = text.indexOf('DERIVED_SECRET_KEYS');
  assert.ok(start >= 0, `${relative(ROOT, file)} declares DERIVED_SECRET_KEYS`);
  const body = text.slice(start, text.indexOf('\n};', start));
  return [...body.matchAll(/^\s{2}([A-Z][A-Z0-9_]*)\s*:/gm)].map((m) => m[1]).sort();
}

test('the source tree is there', () => {
  for (const service of SERVICES) {
    assert.ok(existsSync(join(ROOT, 'apps', `${service}-service`, 'src')), `apps/${service}-service/src under ${ROOT} (set CYBEDEFEND_TREE)`);
  }
  assert.ok(reads().size > 0);
});

test('the inventory is well formed', () => {
  const entries = inventory();
  assert.ok(Array.isArray(entries));
  const seen = new Set();
  for (const e of entries) {
    assert.deepEqual(Object.keys(e).sort(), ['class', 'doc', 'services', 'variable'], JSON.stringify(e));
    assert.match(e.variable, /^[A-Z][A-Z0-9_]*$/, JSON.stringify(e));
    assert.ok(!seen.has(e.variable), `${e.variable} is listed twice`);
    seen.add(e.variable);
    assert.ok(CLASSES.includes(e.class), `${e.variable}: class ${e.class}`);
    assert.ok(Array.isArray(e.services) && e.services.length > 0, `${e.variable}: services`);
    for (const s of e.services) assert.ok(SERVICES.includes(s) || s in FRONTS, `${e.variable}: unknown service ${s}`);
    assert.equal(typeof e.doc, 'string', `${e.variable}: doc`);
    assert.ok(e.doc.trim().length > 0, `${e.variable}: doc is empty`);
  }
  const keys = entries.map((e) => e.variable);
  assert.deepEqual(keys, [...keys].sort(), 'the inventory is sorted by variable name');
});

test('every key the core reads is classified', () => {
  const known = byKey();
  const missing = [...reads()]
    .filter(([key]) => !known.has(key))
    .map(([key, { sites }]) => `${key} (${sites.slice(0, 3).join(', ')}${sites.length > 3 ? ', …' : ''})`)
    .sort();
  assert.deepEqual(missing, [], `keys read by the core but absent from env-inventory.json:\n  ${missing.join('\n  ')}`);
});

test('every service whose code reads a key is named by its entry, and every named service reads or declares it', () => {
  const found = reads();
  const wrong = [];
  for (const e of inventory()) {
    const r = found.get(e.variable);
    if (!r) continue;
    for (const s of r.code) if (!e.services.includes(s)) wrong.push(`${e.variable}: ${s} reads it but is not named`);
    // A key a service's Joi schema declares is checked at its boot: unnamed,
    // nothing proves the compose hands it over (the MCP server required
    // FRONTEND_URL and never got it).
    for (const s of r.joi) {
      if (e.services.includes(s) || CLOUD_ONLY_DECLARATIONS[e.variable]?.includes(s)) continue;
      wrong.push(`${e.variable}: ${s} declares it but is not named`);
    }
    if (e.class === 'derived') continue;
    for (const s of e.services) if (!r.code.has(s) && !r.joi.has(s)) wrong.push(`${e.variable}: ${s} is named but neither reads nor declares it`);
  }
  assert.deepEqual(wrong.sort(), []);
});

test('the derived keys are exactly those of the Community secrets source', () => {
  const inInventory = inventory()
    .filter((e) => e.class === 'derived')
    .map((e) => e.variable)
    .sort();
  // A service without a Community secrets source (the MCP server holds no
  // secret: it forwards the caller's bearer) derives nothing.
  const withSecrets = SERVICES.filter((service) =>
    existsSync(join(ROOT, 'apps', `${service}-service`, 'src', 'core', 'secrets', 'secret-key.ts')),
  );
  for (const service of withSecrets) assert.deepEqual(derivedKeysOf(service), inInventory, service);
});

test('every required or optional key is documented in .env.example', () => {
  const example = readFileSync(join(DEPLOY_DIR, '.env.example'), 'utf8');
  const missing = inventory()
    .filter((e) => e.class === 'required' || e.class === 'optional')
    .filter((e) => !new RegExp(`^(?:# )?${e.variable}=`, 'm').test(example))
    .map((e) => e.variable);
  assert.deepEqual(missing, []);
});

test('no inventory entry is stale', () => {
  const found = reads();
  const stale = inventory()
    .filter((e) => e.class !== 'derived' && !found.has(e.variable))
    .map((e) => e.variable);
  assert.deepEqual(stale, [], 'listed in env-inventory.json but read by no core file');
});

// ─── The compose file ────────────────────────────────────────────────────────

const hasDocker = spawnSync('docker', ['compose', 'version'], { encoding: 'utf8' }).status === 0;
const skip = hasDocker ? false : 'docker compose is not installed: the compose checks are skipped';

/** `docker compose config` with every optional value set, so that the compose passes all of them. */
let cachedConfig;
function composeConfig() {
  if (cachedConfig) return cachedConfig;
  const dir = mkdtempSync(join(tmpdir(), 'cd-env-inventory-'));
  const envFile = join(dir, '.env');
  const values = new Map([
    ['CYBEDEFEND_SECRET_KEY', Buffer.alloc(32, 7).toString('base64')],
    ['CYBEDEFEND_SETUP_TOKEN', 'env-inventory-test-setup-token-0123456789'],
    ['CYBEDEFEND_PUBLIC_URL', 'http://localhost:8080'],
    ['POSTGRES_PASSWORD', 'env-inventory-test-password'],
    // Required by the compose file: the release version of the images.
    ['CYBEDEFEND_VERSION', '1.0.0'],
  ]);
  for (const e of inventory()) if (e.class === 'optional' && !values.has(e.variable)) values.set(e.variable, 'set-by-env-inventory-test');
  writeFileSync(envFile, `${[...values].map(([k, v]) => `${k}=${v}`).join('\n')}\n`);
  try {
    const res = spawnSync(
      'docker',
      ['compose', '--env-file', envFile, '-f', 'docker-compose.yml', 'config', '--format', 'json'],
      { cwd: DEPLOY_DIR, encoding: 'utf8' },
    );
    assert.equal(res.status, 0, res.stderr);
    cachedConfig = JSON.parse(res.stdout);
    return cachedConfig;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The variables each scheduled job of a service adds (runtime/schedules/<service>.json). */
function scheduledKeys(service) {
  const file = join(DEPLOY_DIR, 'runtime', 'schedules', `${service}.json`);
  if (!existsSync(file)) return new Set();
  return new Set(JSON.parse(readFileSync(file, 'utf8')).flatMap((job) => Object.keys(job.env ?? {})));
}

const envOf = (svc) => svc?.environment ?? {};
const hasValue = (environment, key) => environment[key] !== undefined && environment[key] !== null;
const isSet = (environment, key) => hasValue(environment, key) || hasValue(environment, `${key}_FILE`);

test('every internal key is set by the compose file for each service that reads it', { skip }, () => {
  const all = composeConfig().services;
  const missing = [];
  for (const e of inventory().filter((x) => x.class === 'internal')) {
    for (const service of e.services) {
      assert.ok(all[service], `the compose file has a ${service} service`);
      if (!isSet(envOf(all[service]), e.variable) && !scheduledKeys(service).has(e.variable)) missing.push(`${service}: ${e.variable}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('every required or optional key reaches each service that reads it', { skip }, () => {
  const all = composeConfig().services;
  const missing = [];
  for (const e of inventory().filter((x) => x.class === 'required' || x.class === 'optional')) {
    if (e.variable in JOB_ONLY) continue;
    for (const service of e.services) {
      if (!isSet(envOf(all[service]), e.variable)) missing.push(`${service}: ${e.variable}`);
    }
  }
  assert.deepEqual(missing, [], 'a value set in .env never reaches these services');
});

test('a key given to one job only reaches that job and no other container', { skip }, () => {
  const all = composeConfig().services;
  for (const [key, job] of Object.entries(JOB_ONLY)) {
    assert.equal(byKey().get(key)?.class, 'required', key);
    const holders = Object.entries(all)
      .filter(([, svc]) => isSet(envOf(svc), key))
      .map(([name]) => name);
    assert.deepEqual(holders, [job], key);
  }
});

test('no cloud-only key is set by the compose file', { skip }, () => {
  const cloudOnly = new Set(inventory().filter((e) => e.class === 'cloud-only').map((e) => e.variable));
  const set = [];
  for (const [name, svc] of Object.entries(composeConfig().services)) {
    for (const key of Object.keys(envOf(svc))) {
      if (cloudOnly.has(key) || cloudOnly.has(key.replace(/_FILE$/, ''))) set.push(`${name}: ${key}`);
    }
  }
  assert.deepEqual(set, []);
});

test('a derived key reaches only the containers of the services that read it, as a file of their own secrets volume, never as a value', { skip }, () => {
  const derived = new Map(inventory().filter((e) => e.class === 'derived').map((e) => [e.variable, e.services]));
  const serviceOf = (svc) => /^ghcr\.io\/cybedefend\/cybedefend-([a-z-]+):/.exec(svc.image ?? '')?.[1];
  const wrong = [];
  const reached = new Set();
  for (const [name, svc] of Object.entries(composeConfig().services)) {
    for (const [key, value] of Object.entries(envOf(svc))) {
      if (derived.has(key)) wrong.push(`${name}: ${key} is given as a value`);
      const base = key.replace(/_FILE$/, '');
      if (key === base || !derived.has(base)) continue;
      if (!derived.get(base).includes(serviceOf(svc))) wrong.push(`${name}: ${key}, which its service does not read`);
      if (value !== `${SECRETS_MOUNT}/${base}`) wrong.push(`${name}: ${key}=${value}`);
      reached.add(`${serviceOf(svc)}: ${base}`);
    }
  }
  assert.deepEqual(wrong, []);
  // ...and every service that reads one gets it.
  const expected = [...derived].flatMap(([key, services]) => services.map((s) => `${s}: ${key}`));
  assert.deepEqual([...reached].sort(), expected.sort());
});
