// The cluster manifests shipped next to the compose are the README's, byte for
// byte: an administrator may apply the files or copy the blocks, and the smoke
// applies the blocks, so the two must never drift.
//
//   node --test deploy/community/tests/cluster-manifests.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEPLOY_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function clusterYamlBlocks() {
  const text = readFileSync(join(DEPLOY_DIR, 'README.md'), 'utf8');
  const start = text.indexOf('\n## Run scans on a Kubernetes cluster\n');
  assert.ok(start >= 0, 'README.md has its « Run scans on a Kubernetes cluster » section');
  const rest = text.slice(start + 1);
  const next = rest.indexOf('\n## ', 3);
  const section = next < 0 ? rest : rest.slice(0, next);
  return [...section.matchAll(/^```yaml\n([\s\S]*?)^```$/gm)].map((m) => m[1]);
}

for (const [file, kind] of [
  ['cybedefend-namespace.yaml', 'Namespace'],
  ['cybedefend-scanner.yaml', 'ServiceAccount'],
  ['cybedefend-scanner-networkpolicy.yaml', 'NetworkPolicy'],
]) {
  test(`${file} is the README's ${kind} block`, () => {
    const block = clusterYamlBlocks().find((b) => new RegExp(`^kind: ${kind}$`, 'm').test(b));
    assert.ok(block, `the README has a ${kind} block`);
    assert.equal(readFileSync(join(DEPLOY_DIR, file), 'utf8'), block);
  });
}

test('cybedefend-scanner.yaml grants nothing outside its namespace', () => {
  const text = readFileSync(join(DEPLOY_DIR, 'cybedefend-scanner.yaml'), 'utf8');
  assert.doesNotMatch(text, /^kind: Cluster(Role|RoleBinding)$/m);
  assert.doesNotMatch(text, /verbs:.*"\*"/);
});

/** The documents of the NetworkPolicy file, comments removed. */
function networkPolicies() {
  const text = readFileSync(join(DEPLOY_DIR, 'cybedefend-scanner-networkpolicy.yaml'), 'utf8');
  return text
    .split(/^---$/m)
    .map((doc) => doc.replace(/^\s*#.*$/gm, '').replace(/\s+#.*$/gm, '').trim())
    .filter(Boolean);
}

const PRIVATE_RANGES = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '169.254.0.0/16'];

test('the scan pods NetworkPolicy denies all ingress and selects the scan pods only', () => {
  const docs = networkPolicies();
  assert.ok(docs.length >= 1);
  for (const doc of docs) {
    assert.match(doc, /^apiVersion: networking\.k8s\.io\/v1$/m);
    assert.match(doc, /^kind: NetworkPolicy$/m);
    assert.match(doc, /^  namespace: cybedefend-scans$/m);
    assert.match(doc, /^    - Egress$/m, 'egress is restricted');
    // no empty peer, rule or selector inside the rules: `{}` there would
    // allow every pod, namespace or address
    const rules = doc.slice(doc.indexOf('\n  policyTypes:'));
    assert.doesNotMatch(rules, /\{\s*\}/);
    assert.doesNotMatch(doc, /::\/0/);
  }
  // deny by default: the first policy selects every pod of the namespace
  const base = docs.find((d) => /^  podSelector: \{\}$/m.test(d));
  assert.ok(base, 'a default-deny policy for every pod of the namespace');
  assert.match(base, /^    - Ingress$/m, 'ingress is restricted');
  assert.match(base, /^  ingress: \[\]$/m, 'no ingress rule: nothing may connect to a scan pod');
});

test('every egress rule names its peers and its ports, DNS goes to the cluster resolver only', () => {
  for (const doc of networkPolicies()) {
    const egress = doc.slice(doc.indexOf('\n  egress:\n'));
    assert.ok(egress.length > 0, 'an egress section');
    const rules = egress.split(/^    - /m).slice(1);
    assert.ok(rules.length > 0);
    for (const rule of rules) {
      assert.match(rule, /^to:\n/, 'a rule without `to` would allow every destination');
      assert.match(rule, /\n      ports:\n/, 'a rule without `ports` would allow every port');
      if (/port: 53$/m.test(rule)) {
        assert.match(rule, /k8s-app: kube-dns/);
        assert.match(rule, /kubernetes\.io\/metadata\.name: kube-system/);
        assert.doesNotMatch(rule, /ipBlock/);
      }
    }
  }
});

test('the open internet is reachable on 443 by the SCA pod alone, never the private ranges', () => {
  for (const doc of networkPolicies()) {
    if (!/cidr: 0\.0\.0\.0\/0/.test(doc)) continue;
    assert.match(
      doc,
      /^  podSelector:\n    matchLabels:\n      app\.kubernetes\.io\/managed-by: cybedefend\n      cybedefend\.io\/adapter: trivy-fs$/m,
      'only trivy-fs downloads its database',
    );
    for (const range of PRIVATE_RANGES) {
      assert.ok(doc.includes(`- ${range}`), `0.0.0.0/0 excludes ${range}`);
    }
    const ports = [...doc.matchAll(/port: (\d+)/g)].map((m) => m[1]);
    assert.deepEqual(ports, ['443']);
  }
});
