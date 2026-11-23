// The role setup job (postgres/roles.sh + roles.sql): one PostgreSQL role per
// database, owner of that database only, no superuser, no CREATEROLE. It logs
// in as the superuser with the password init-secrets derives, and moves an
// earlier instance's superuser (whose password was POSTGRES_PASSWORD) to it.
//
// The static checks always run. The live checks start a real PostgreSQL 18
// (the image of docker-compose.yml) and run the job against it, on an
// install of an earlier version (every object owned by the superuser, the
// superuser's password chosen by hand) and on a new one:
//
//   POSTGRES_ROLES_LIVE=1 node --test postgres/tests/roles.test.mjs
//
// Containers and the network carry the label cybedefend.test=postgres-roles
// (plus DOCKER_TEST_LABEL=<key>=<value> when set) and are removed at the end.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SERVICE_DATABASES, deriveRuntimeSecrets, planSecretFiles } from '../../runtime/derive-secrets.mjs';
import { decodeMasterKey } from '../../runtime/hkdf.mjs';

const POSTGRES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROLES_SQL = readFileSync(join(POSTGRES_DIR, 'roles.sql'), 'utf8').replace(/^\s*--.*$/gm, '');
const ROLES_SH = readFileSync(join(POSTGRES_DIR, 'roles.sh'), 'utf8');
const SUPERUSER_SQL_PATH = join(POSTGRES_DIR, 'superuser.sql');
const IMAGE = 'postgres:18.7-alpine3.24';
const DATABASES = Object.values(SERVICE_DATABASES);

test('roles.sql holds no password and reads each verifier from its file', () => {
  assert.doesNotMatch(ROLES_SQL, /PASSWORD\s+'/i);
  assert.match(ROLES_SQL, /\\set verifier `cat :'verifier_file'`/);
  assert.match(ROLES_SQL, /PASSWORD :'verifier'/);
  assert.match(ROLES_SQL, /NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS/);
  assert.match(ROLES_SQL, /REVOKE ALL ON DATABASE :"role" FROM PUBLIC/);
  assert.doesNotMatch(ROLES_SQL, /\bGRANT\b/i);
  assert.doesNotMatch(ROLES_SQL, /REASSIGN OWNED/i, 'the bootstrap superuser cannot be reassigned from: objects are moved one by one');
});

test('roles.sh stops at the first error and accepts only role names of the derivation job', () => {
  assert.match(ROLES_SH, /^set -eu$/m);
  assert.match(ROLES_SH, /ON_ERROR_STOP=1/);
  assert.match(ROLES_SH, /\*\[!a-z0-9_\]\*/);
  for (const db of DATABASES) assert.match(db, /^[a-z0-9_]+$/);
});

test('roles.sh logs in with the derived superuser password, read from its file, never from the compose environment', () => {
  assert.match(ROLES_SH, /superuser-password/);
  assert.doesNotMatch(ROLES_SH, /\$\{?PGPASSWORD\b/, 'the job takes no PGPASSWORD from its environment');
  assert.match(ROLES_SH, /POSTGRES_PREVIOUS_PASSWORD/);
  assert.match(ROLES_SH, /superuser\.sql/);
  assert.doesNotMatch(ROLES_SH, /\becho\b[^\n]*\$\{?(?:password|previous|POSTGRES_PREVIOUS_PASSWORD)/i, 'never prints a password');
});

test('superuser.sql sets the superuser\'s verifier, read from its file, never a password', () => {
  const sql = readFileSync(SUPERUSER_SQL_PATH, 'utf8').replace(/^\s*--.*$/gm, '');
  assert.match(sql, /\\set verifier `cat :'verifier_file'`/);
  assert.match(sql, /ALTER ROLE CURRENT_USER WITH PASSWORD :'verifier'/);
  assert.doesNotMatch(sql, /PASSWORD\s+'/i);
});

// ─── Live, on a real PostgreSQL 18 ───────────────────────────────────────────

const live = process.env.POSTGRES_ROLES_LIVE === '1';
const hasDocker = live && spawnSync('docker', ['version'], { encoding: 'utf8' }).status === 0;
const skip = !live ? 'set POSTGRES_ROLES_LIVE=1 to run the live checks' : hasDocker ? false : 'docker is not available';

const RUN = `cd-roles-${process.pid}`;
const LABELS = ['cybedefend.test=postgres-roles', ...(process.env.DOCKER_TEST_LABEL ? [process.env.DOCKER_TEST_LABEL] : [])];
const labelArgs = LABELS.flatMap((l) => ['--label', l]);
// The password an earlier version took from POSTGRES_PASSWORD.
const PREVIOUS_PASSWORD = randomBytes(24).toString('hex');
const MASTER = randomBytes(32).toString('base64');
const files = planSecretFiles(decodeMasterKey(MASTER));
const DERIVED_PASSWORD = files.find((f) => f.consumer === 'postgres' && f.name === 'superuser-password').value;
// The superuser's password on the server of the earlier install, as the tests move it.
let superuserPassword = PREVIOUS_PASSWORD;
const passwordOf = (db) => {
  const [consumer] = Object.entries(SERVICE_DATABASES).find(([, d]) => d === db);
  const f = files.find((x) => x.consumer === consumer && (x.name === 'db-password' || x.name === 'pgpass'));
  return f.name === 'pgpass' ? f.value.trim().split(':').pop() : f.value;
};
let secretsRoot;

function docker(args, options = {}) {
  const res = spawnSync('docker', args, { encoding: 'utf8', ...options });
  return { status: res.status, out: `${res.stdout ?? ''}${res.stderr ?? ''}` };
}

/**
 * psql inside the server container, through its network address: the image
 * trusts 127.0.0.1 without a password, so only this proves a password. The
 * password goes through the environment, never the command line.
 */
function psql(sql, { user = 'cybedefend', db = 'postgres', password = superuserPassword, server = `${RUN}-pg` } = {}) {
  return docker([
    'exec', '-e', 'PGPASSWORD', server,
    'psql', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-h', server, '-U', user, '-d', db, '-c', sql,
  ], { env: { ...process.env, PGPASSWORD: password } });
}

/** The job as the compose file runs it: read-only, no capability, the previous password only when given. */
function runJob({ previous = '', server = `${RUN}-pg` } = {}) {
  return docker([
    'run', '--rm', ...labelArgs, '--network', RUN,
    '--security-opt', 'no-new-privileges:true', '--cap-drop', 'ALL', '--read-only', '--tmpfs', '/tmp',
    '-e', `PGHOST=${server}`, '-e', 'PGUSER=cybedefend', '-e', 'POSTGRES_PREVIOUS_PASSWORD',
    '-v', `${POSTGRES_DIR}:/opt/cybedefend/postgres:ro`,
    '-v', `${join(secretsRoot, 'postgres')}:/run/cybedefend-secrets:ro`,
    '--entrypoint', 'sh', IMAGE, '/opt/cybedefend/postgres/roles.sh', '/run/cybedefend-secrets',
  ], { env: { ...process.env, POSTGRES_PREVIOUS_PASSWORD: previous } });
}

function waitReady(server) {
  for (let i = 0; ; i += 1) {
    if (docker(['exec', server, 'pg_isready', '-h', '127.0.0.1', '-U', 'cybedefend', '-d', 'postgres']).status === 0) return;
    assert.ok(i < 60, `${server}: PostgreSQL did not start`);
    spawnSync('sleep', ['1']);
  }
}

const noSecretIn = (out) => {
  for (const f of files) assert.ok(!out.includes(f.value.trim()), `the output holds ${f.consumer}/${f.name}`);
  assert.ok(!out.includes(PREVIOUS_PASSWORD), 'the output holds the previous password');
};

before(() => {
  if (skip) return;
  secretsRoot = mkdtempSync(join(tmpdir(), 'cd-roles-'));
  deriveRuntimeSecrets({ CYBEDEFEND_SECRET_KEY: MASTER }, secretsRoot, { chown: () => {} });
  // The job runs as root in the container; a bind mount keeps the host owner.
  for (const consumer of ['postgres', 'postgres-server']) {
    for (const name of readdirSync(join(secretsRoot, consumer))) chmodSync(join(secretsRoot, consumer, name), 0o444);
  }
  assert.equal(docker(['network', 'create', ...labelArgs, RUN]).status, 0);
  // An earlier install: the superuser's password chosen by hand (POSTGRES_PASSWORD).
  const started = docker([
    'run', '-d', ...labelArgs, '--name', `${RUN}-pg`, '--network', RUN,
    '-e', 'POSTGRES_USER=cybedefend', '-e', 'POSTGRES_PASSWORD', '-e', 'POSTGRES_DB=postgres',
    '-v', `${join(POSTGRES_DIR, 'init.sql')}:/docker-entrypoint-initdb.d/init.sql:ro`,
    IMAGE,
  ], { env: { ...process.env, POSTGRES_PASSWORD: PREVIOUS_PASSWORD } });
  assert.equal(started.status, 0, started.out);
  waitReady(`${RUN}-pg`);
  // An install of an earlier version: every object made by the superuser.
  const legacy = psql(
    [
      'CREATE EXTENSION citext',
      "CREATE TYPE scan_state AS ENUM ('queued', 'done')",
      'CREATE DOMAIN short_text AS varchar(10)',
      'CREATE TABLE project (id serial PRIMARY KEY, name citext NOT NULL, state scan_state)',
      'CREATE TABLE event (id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, label short_text)',
      'CREATE TABLE migrations (id serial PRIMARY KEY, name varchar NOT NULL)',
      'CREATE SEQUENCE free_counter',
      'CREATE VIEW project_names AS SELECT name FROM project',
      'CREATE MATERIALIZED VIEW project_count AS SELECT count(*) FROM project',
      'CREATE FUNCTION project_total() RETURNS bigint LANGUAGE sql AS $$ SELECT count(*) FROM project $$',
      'CREATE SCHEMA extra',
      'CREATE TABLE extra.note (id serial PRIMARY KEY)',
    ].join('; '),
    { db: 'cybedefend_global_management' },
  );
  assert.equal(legacy.status, 0, legacy.out);
  // A database a later release adds: init.sql never ran for it.
  assert.equal(psql('DROP DATABASE cybedefend_policy').status, 0);
});

after(() => {
  if (skip) return;
  const ids = (args) => docker(args).out.split('\n').filter(Boolean);
  const containers = ids(['ps', '-aq', '--filter', `label=${LABELS[0]}`]);
  if (containers.length) docker(['rm', '-f', ...containers]);
  const networks = ids(['network', 'ls', '-q', '--filter', `label=${LABELS[0]}`]);
  if (networks.length) docker(['network', 'rm', ...networks]);
  if (secretsRoot) rmSync(secretsRoot, { recursive: true, force: true });
});

test('on an earlier install, without the previous password, the job stops, says what to set, and changes nothing', { skip }, () => {
  const run = runJob();
  assert.notEqual(run.status, 0, run.out);
  assert.match(run.out, /POSTGRES_PASSWORD/);
  noSecretIn(run.out);
  assert.equal(psql('SELECT 1').status, 0, 'the superuser keeps its password');
  assert.notEqual(psql('SELECT 1', { password: DERIVED_PASSWORD }).status, 0);
});

test('with the previous password, the job moves the superuser to the derived password, once', { skip }, () => {
  const run = runJob({ previous: PREVIOUS_PASSWORD });
  assert.equal(run.status, 0, run.out);
  noSecretIn(run.out);
  assert.match(run.out, /remove POSTGRES_PASSWORD/);
  assert.equal(psql('SELECT 1', { password: DERIVED_PASSWORD }).status, 0, 'the derived password opens a session');
  const old = psql('SELECT 1', { password: PREVIOUS_PASSWORD });
  assert.notEqual(old.status, 0, 'the previous password opens no session');
  assert.match(old.out, /password authentication failed/);
  superuserPassword = DERIVED_PASSWORD;
  // The previous password still in .env: nothing more to move, the job reminds to remove it.
  const again = runJob({ previous: PREVIOUS_PASSWORD });
  assert.equal(again.status, 0, again.out);
  assert.match(again.out, /remove POSTGRES_PASSWORD/);
  noSecretIn(again.out);
});

test('the job succeeds, twice, and prints no password nor verifier', { skip }, () => {
  for (let i = 0; i < 2; i += 1) {
    const run = runJob();
    assert.equal(run.status, 0, run.out);
    for (const db of DATABASES) assert.match(run.out, new RegExp(`role ${db} ready`));
    assert.doesNotMatch(run.out, /POSTGRES_PASSWORD/);
    noSecretIn(run.out);
  }
});

test('on a new install, the server takes the derived password from its file and the job needs nothing else', { skip }, () => {
  const server = `${RUN}-new`;
  const dir = join(secretsRoot, 'postgres-server');
  const started = docker([
    'run', '-d', ...labelArgs, '--name', server, '--network', RUN,
    '-e', 'POSTGRES_USER=cybedefend', '-e', 'POSTGRES_PASSWORD_FILE=/run/cybedefend-secrets/superuser-password', '-e', 'POSTGRES_DB=postgres',
    '-v', `${join(POSTGRES_DIR, 'init.sql')}:/docker-entrypoint-initdb.d/init.sql:ro`,
    '-v', `${dir}:/run/cybedefend-secrets:ro`,
    IMAGE,
  ]);
  assert.equal(started.status, 0, started.out);
  waitReady(server);
  const run = runJob({ server });
  assert.equal(run.status, 0, run.out);
  for (const db of DATABASES) assert.match(run.out, new RegExp(`role ${db} ready`));
  noSecretIn(run.out);
  assert.equal(psql('SELECT 1', { server, password: DERIVED_PASSWORD }).status, 0);
  assert.notEqual(psql('SELECT 1', { server, password: PREVIOUS_PASSWORD }).status, 0);
  const inspect = docker(['inspect', '-f', '{{json .Config.Env}}', server]);
  assert.ok(!inspect.out.includes(DERIVED_PASSWORD), 'the password is not in the container\'s configuration');
});

test('each database is owned by its own role, which is no superuser and creates no role nor database', { skip }, () => {
  const rows = psql(
    `SELECT d.datname, r.rolname, r.rolsuper, r.rolcreaterole, r.rolcreatedb, r.rolcanlogin, r.rolreplication, r.rolbypassrls
       FROM pg_database d JOIN pg_roles r ON r.oid = d.datdba WHERE d.datname IN (${DATABASES.map((d) => `'${d}'`).join(',')}) ORDER BY 1`,
  );
  assert.equal(rows.status, 0, rows.out);
  assert.deepEqual(
    rows.out.trim().split('\n'),
    [...DATABASES].sort().map((db) => `${db}|${db}|f|f|f|t|f|f`),
  );
});

test('every object an earlier version made as the superuser now belongs to the role', { skip }, () => {
  const db = 'cybedefend_global_management';
  const left = psql(
    `SELECT kind || ' ' || name FROM (
       SELECT 'relation' AS kind, c.oid::regclass::text AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relowner = (SELECT oid FROM pg_roles WHERE rolname = 'cybedefend') AND n.nspname IN ('public', 'extra')
          AND NOT EXISTS (SELECT FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
       UNION ALL SELECT 'type', t.oid::regtype::text FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typowner = (SELECT oid FROM pg_roles WHERE rolname = 'cybedefend') AND n.nspname IN ('public', 'extra') AND t.typcategory <> 'A'
          AND NOT EXISTS (SELECT FROM pg_depend d WHERE d.classid = 'pg_type'::regclass AND d.objid = t.oid AND d.deptype = 'e')
       UNION ALL SELECT 'routine', p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE p.proowner = (SELECT oid FROM pg_roles WHERE rolname = 'cybedefend') AND n.nspname IN ('public', 'extra')
          AND NOT EXISTS (SELECT FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
       UNION ALL SELECT 'schema', nspname FROM pg_namespace WHERE nspname IN ('public', 'extra') AND nspowner = (SELECT oid FROM pg_roles WHERE rolname = 'cybedefend')
     ) o ORDER BY 1`,
    { db },
  );
  assert.equal(left.status, 0, left.out);
  assert.equal(left.out.trim(), '', `still owned by the superuser:\n${left.out}`);
  const owned = psql("SELECT count(*) FROM pg_class WHERE relowner = (SELECT oid FROM pg_roles WHERE rolname = 'cybedefend_global_management') AND relkind IN ('r','v','m','S')", { db });
  assert.ok(Number(owned.out.trim()) >= 9, owned.out);
});

test('a role migrates its own database: alters the earlier tables, creates tables and the trusted extensions', { skip }, () => {
  const gm = 'cybedefend_global_management';
  const asGm = psql(
    [
      'ALTER TABLE project ADD COLUMN created_at timestamp',
      'ALTER TYPE scan_state ADD VALUE IF NOT EXISTS \'failed\'',
      'CREATE EXTENSION IF NOT EXISTS citext',
      'INSERT INTO migrations (name) VALUES (\'next\')',
      'SELECT nextval(\'free_counter\')',
      'REFRESH MATERIALIZED VIEW project_count',
      'CREATE OR REPLACE FUNCTION project_total() RETURNS bigint LANGUAGE sql AS $$ SELECT count(*) + 0 FROM project $$',
      'CREATE TABLE extra.more (id serial PRIMARY KEY)',
    ].join('; '),
    { user: gm, db: gm, password: passwordOf(gm) },
  );
  assert.equal(asGm.status, 0, asGm.out);
  const policy = 'cybedefend_policy';
  const asPolicy = psql(
    [
      'CREATE EXTENSION IF NOT EXISTS "uuid-ossp"',
      'CREATE EXTENSION IF NOT EXISTS citext',
      'CREATE TABLE policy (id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), name citext)',
      'INSERT INTO policy (name) VALUES (\'p\')',
    ].join('; '),
    { user: policy, db: policy, password: passwordOf(policy) },
  );
  assert.equal(asPolicy.status, 0, asPolicy.out);
  const permify = psql('CREATE TABLE relation_tuples (id bigserial PRIMARY KEY)', { user: 'permify', db: 'permify', password: passwordOf('permify') });
  assert.equal(permify.status, 0, permify.out);
});

test('a role reaches no other database and holds no administrative right', { skip }, () => {
  const scanning = 'cybedefend_scanning';
  const options = { user: scanning, password: passwordOf(scanning) };
  for (const other of ['cybedefend_global_management', 'permify', 'postgres', 'template1']) {
    const res = psql('SELECT 1', { ...options, db: other });
    assert.notEqual(res.status, 0, `${scanning} connects to ${other}`);
    assert.match(res.out, /permission denied for database/);
  }
  for (const sql of ['CREATE ROLE intruder', 'CREATE DATABASE intruder', 'SELECT rolpassword FROM pg_authid']) {
    const res = psql(sql, { ...options, db: scanning });
    assert.notEqual(res.status, 0, `${scanning}: ${sql}`);
  }
  const wrong = psql('SELECT 1', { user: scanning, db: scanning, password: passwordOf('cybedefend_global_management') });
  assert.notEqual(wrong.status, 0, 'another role\'s password opens no session');
  // The superuser keeps every database.
  assert.equal(psql('SELECT 1', { db: 'cybedefend_global_management' }).status, 0);
});
