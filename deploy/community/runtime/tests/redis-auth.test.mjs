// The start hook every Community service loads (NODE_OPTIONS=--require):
// it reads the derived Redis password from REDIS_PASSWORD_FILE and hands it
// to every Redis client, the URL ones and the host/port ones.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOK = join(dirname(fileURLToPath(import.meta.url)), '..', 'redis-auth.cjs');
const PASSWORD = 'a'.repeat(64);
const KEYS = ['REDIS_PASSWORD', 'REDIS_URL', 'REALTIME_REDIS_URL'];

function passwordFile(content = `${PASSWORD}\n`) {
  const file = join(mkdtempSync(join(tmpdir(), 'redis-auth-')), 'redis-password');
  writeFileSync(file, content);
  return file;
}

/** Runs node with the hook preloaded and returns what the process sees. */
function run(env) {
  const base = { ...process.env };
  for (const key of [...KEYS, 'REDIS_PASSWORD_FILE', 'NODE_OPTIONS']) delete base[key];
  const res = spawnSync(
    process.execPath,
    ['--require', HOOK, '-e', `process.stdout.write(JSON.stringify(Object.fromEntries(${JSON.stringify(KEYS)}.map((k) => [k, process.env[k] ?? null]))))`],
    { env: { ...base, ...env }, encoding: 'utf8' },
  );
  return { status: res.status, stderr: res.stderr, seen: res.status === 0 ? JSON.parse(res.stdout) : null };
}

test('sets REDIS_PASSWORD and puts it into REDIS_URL and REALTIME_REDIS_URL', () => {
  const { status, stderr, seen } = run({
    REDIS_PASSWORD_FILE: passwordFile(),
    REDIS_URL: 'redis://redis:6379',
    REALTIME_REDIS_URL: 'redis://redis:6379',
  });
  assert.equal(status, 0, stderr);
  assert.equal(seen.REDIS_PASSWORD, PASSWORD);
  assert.equal(seen.REDIS_URL, `redis://:${PASSWORD}@redis:6379`);
  assert.equal(seen.REALTIME_REDIS_URL, `redis://:${PASSWORD}@redis:6379`);
});

test('leaves an unset URL unset and a URL that already carries a password as it is', () => {
  const { status, stderr, seen } = run({ REDIS_PASSWORD_FILE: passwordFile(), REDIS_URL: 'redis://:other@redis:6379' });
  assert.equal(status, 0, stderr);
  assert.equal(seen.REDIS_URL, 'redis://:other@redis:6379');
  assert.equal(seen.REALTIME_REDIS_URL, null);
  assert.equal(seen.REDIS_PASSWORD, PASSWORD);
});

test('changes nothing without REDIS_PASSWORD_FILE', () => {
  const { status, stderr, seen } = run({ REDIS_URL: 'redis://redis:6379' });
  assert.equal(status, 0, stderr);
  assert.deepEqual(seen, { REDIS_PASSWORD: null, REDIS_URL: 'redis://redis:6379', REALTIME_REDIS_URL: null });
});

test('an explicit REDIS_PASSWORD wins over the file', () => {
  const { status, stderr, seen } = run({ REDIS_PASSWORD_FILE: passwordFile(), REDIS_PASSWORD: 'explicit', REDIS_URL: 'redis://redis:6379' });
  assert.equal(status, 0, stderr);
  assert.equal(seen.REDIS_PASSWORD, 'explicit');
  assert.equal(seen.REDIS_URL, 'redis://:explicit@redis:6379');
});

test('refuses to start on a missing or empty file, naming the path and never a secret', () => {
  for (const file of [join(tmpdir(), 'no-such-dir-redis-auth', 'redis-password'), passwordFile('  \n')]) {
    const { status, stderr } = run({ REDIS_PASSWORD_FILE: file, REDIS_URL: 'redis://redis:6379' });
    assert.notEqual(status, 0);
    assert.match(stderr, /REDIS_PASSWORD_FILE/);
    assert.ok(stderr.includes(file));
    assert.equal(stderr.includes(PASSWORD), false);
  }
});
