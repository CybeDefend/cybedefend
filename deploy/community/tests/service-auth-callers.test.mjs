// The internal gRPC keys init-secrets hands out follow the services' own
// policies: each server receives the verification key of exactly the callers
// its src/core/service-auth/service-auth.policy.ts names, so a caller missing
// here is refused, and a caller listed here but not in the policy holds a key
// for nothing.
//
// It reads the real source tree: <root>/apps/<service>-service/, where <root>
// is CYBEDEFEND_TREE, else the nearest directory above this file that holds
// apps/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GRPC_CALLERS, GRPC_SERVICES } from '../runtime/derive-secrets.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
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

/** The caller names a policy file quotes, its own `caller:` line aside. */
function policyCallers(service) {
  const text = readFileSync(join(ROOT, 'apps', `${service}-service`, 'src', 'core', 'service-auth', 'service-auth.policy.ts'), 'utf8');
  const own = /caller: '([a-z0-9-]+)',/.exec(text)?.[1];
  assert.equal(own, service, `${service} signs as itself`);
  const body = text.replace(/caller: '[a-z0-9-]+',/, '');
  // Every quoted name counts: a caller this job does not know must fail below,
  // not be dropped, or its calls would be signed with a key no one holds.
  const quoted = [...body.matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]);
  return [...new Set(quoted)].sort();
}

test('each server receives the keys of the callers its policy names, and of no other', () => {
  for (const service of GRPC_SERVICES) {
    assert.deepEqual([...(GRPC_CALLERS[service] ?? [])].sort(), policyCallers(service), service);
  }
});


test('every caller a policy names is a service this job derives keys for', () => {
  for (const service of GRPC_SERVICES) {
    for (const caller of policyCallers(service)) {
      assert.ok(GRPC_SERVICES.includes(caller), `${service} serves ${caller}, which gets no key`);
    }
  }
});
