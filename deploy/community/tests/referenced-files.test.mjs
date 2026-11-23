// Every file the deployment points at is in the tree: the bind mounts of the
// compose files, and the files a shell script of this directory reads next to
// itself ("$here/<file>"). A missing one breaks the stack only on the path that
// uses it (an upgrade, say), long after a fresh install has passed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEPLOY = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const COMPOSE_FILES = ['docker-compose.yml', 'docker-compose.build.yml'];

function filesUnder(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...filesUnder(path));
    else out.push(path);
  }
  return out;
}

/** The host side of each relative bind mount (`- ./x:/y[:ro]`) of a compose file. */
function bindMounts(composeText) {
  return [...composeText.matchAll(/^\s*-\s+["']?(\.\/[^:"'\s]+):/gm)].map((m) => m[1]);
}

/** The files a script reads through the variable that holds its own directory. */
function siblingReads(scriptText) {
  const dirVar = /^\s*(\w+)="\$\(dirname "\$0"\)"\s*$/m.exec(scriptText)?.[1];
  if (!dirVar) return [];
  const re = new RegExp(String.raw`\$\{?${dirVar}\}?/([A-Za-z0-9._/-]+)`, 'g');
  return [...scriptText.matchAll(re)].map((m) => m[1]);
}

test('the parsers see the references this deployment is known to hold', () => {
  assert.deepEqual(bindMounts('    volumes:\n      - ./postgres:/opt/x:ro\n      - "./a/b.conf:/etc/b.conf"\n'), [
    './postgres',
    './a/b.conf',
  ]);
  assert.deepEqual(siblingReads('here="$(dirname "$0")"\nsql="$here/roles.sql"\npsql -f "${here}/superuser.sql"\n'), [
    'roles.sql',
    'superuser.sql',
  ]);
  const roles = readFileSync(join(DEPLOY, 'postgres', 'roles.sh'), 'utf8');
  assert.ok(siblingReads(roles).includes('superuser.sql'), 'roles.sh reads superuser.sql next to itself');
});

test('every bind mount of the compose files exists', () => {
  for (const name of COMPOSE_FILES) {
    const path = join(DEPLOY, name);
    if (!existsSync(path)) continue;
    const mounts = bindMounts(readFileSync(path, 'utf8'));
    assert.ok(mounts.length > 0 || name !== 'docker-compose.yml', `${name} mounts nothing`);
    for (const mount of mounts) assert.ok(existsSync(join(DEPLOY, mount)), `${name} mounts ${mount}, which is not in the tree`);
  }
});

test('every file a shell script reads next to itself exists', () => {
  const scripts = filesUnder(DEPLOY).filter((f) => f.endsWith('.sh'));
  assert.ok(scripts.length > 0);
  for (const script of scripts) {
    for (const file of siblingReads(readFileSync(script, 'utf8'))) {
      assert.ok(existsSync(join(dirname(script), file)), `${relative(DEPLOY, script)} reads ${file}, which is not in the tree`);
    }
  }
});
