import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SMOKE_SH = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'smoke.sh');

const run = (args, env = {}) =>
  spawnSync('bash', [SMOKE_SH, ...args], { cwd: tmpdir(), encoding: 'utf8', env: { ...process.env, ...env } });

test('smoke.sh runs run.mjs from any directory', () => {
  const res = run(['--help']);
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /usage: .*run\.mjs/i);
  assert.match(res.stdout, /--variant/);
});

test('smoke.sh defaults to --variant all --build', () => {
  const res = run([], { SMOKE_DRY_RUN: '1' });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /variant=all/);
  assert.match(res.stdout, /build=true/);
});

test('run.mjs refuses an unknown option with exit 2', () => {
  const res = run(['--variant', 'nope'], { SMOKE_DRY_RUN: '1' });
  assert.equal(res.status, 2);
  const unknown = run(['--frobnicate'], { SMOKE_DRY_RUN: '1' });
  assert.equal(unknown.status, 2);
});

test('run.mjs passes its options through, without a build when none is asked', () => {
  const res = run(['--variant', 'smtp', '--keep', '--project-name', 'p1', '--timeout-s', '30'], { SMOKE_DRY_RUN: '1' });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /variant=smtp/);
  assert.match(res.stdout, /build=false/);
  assert.match(res.stdout, /keep=true/);
  assert.match(res.stdout, /project-name=p1/);
  assert.match(res.stdout, /timeout-s=30/);
});

test('the late-storage variant is storage-late, and the former name is refused', () => {
  const help = run(['--help']);
  assert.match(help.stdout, /default \| smtp \| storage-late \| all/);
  assert.ok(!/minio/i.test(help.stdout));
  const res = run(['--variant', 'storage-late'], { SMOKE_DRY_RUN: '1' });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /variant=storage-late/);
  assert.equal(run(['--variant', 'minio-late'], { SMOKE_DRY_RUN: '1' }).status, 2);
});

test('run.mjs names no MinIO service, file or command', () => {
  const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'run.mjs'), 'utf8');
  assert.ok(!/minio|\bmc\b/i.test(source));
  assert.match(source, /'storage', 'storage-server', 'storage-init'/);
});

// CI builds the images once (--build-only) and runs each variant on a machine
// that loaded them (--prebuilt), so no variant builds or pulls them again.
test('run.mjs --build-only builds the images and runs no variant', () => {
  const res = run(['--build-only'], { SMOKE_DRY_RUN: '1' });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /build-only=true/);
  assert.match(res.stdout, /variants=\s*$/m);
});

test('run.mjs --prebuilt runs a variant on the images already on this machine, without building', () => {
  const res = run(['--variant', 'smtp', '--prebuilt'], { SMOKE_DRY_RUN: '1' });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /build=false/);
  assert.match(res.stdout, /prebuilt=true/);
  assert.match(res.stdout, /variants=smtp/);
});

test('run.mjs refuses to mix --build, --build-only and --prebuilt, and --prebuilt with the cluster variant', () => {
  for (const args of [
    ['--build', '--prebuilt'],
    ['--build', '--build-only'],
    ['--build-only', '--prebuilt'],
    ['--variant', 'cluster', '--prebuilt'],
  ]) {
    assert.equal(run(args, { SMOKE_DRY_RUN: '1' }).status, 2, args.join(' '));
  }
  assert.match(run(['--help']).stdout, /--build-only[\s\S]*--prebuilt/);
});

// The running images carry no package manager: the smoke runs the reset CLI
// with node, exactly as the README tells an administrator to.
test('run.mjs runs the reset CLI with the command the README gives, never through pnpm', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(resolve(here, '..', 'run.mjs'), 'utf8');
  const readme = readFileSync(resolve(here, '..', '..', 'README.md'), 'utf8');
  assert.match(readme, /node dist\/main\.auth-reset-password user@example\.com/);
  assert.match(source, /'node', 'dist\/main\.auth-reset-password', ADMIN_EMAIL/);
  assert.ok(!/'pnpm'/.test(source), 'run.mjs calls pnpm in a container');
});
