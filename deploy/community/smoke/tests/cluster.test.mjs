// The pure helpers of the cluster variant: no Docker, no kind.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import {
  CLUSTER_NAMESPACE,
  CLUSTER_SMOKE_LABEL,
  ClusterError,
  NO_SCAN_RUN_COMMIT,
  SCANNER_MAX_CONCURRENT,
  buildScannerImages,
  clusterAddresses,
  clusterEnvOverrides,
  enabledLogCount,
  enabledInstanceIds,
  entrypointProgram,
  expectedFindings,
  fixtureEntries,
  heldQueueVerdict,
  isDockerDesktop,
  kindVersionOk,
  instanceId,
  instanceLabelVerdict,
  managedSelector,
  namespaceManifest,
  kubeconfigSecrets,
  networkIsOurs,
  settledDispatchVerdict,
  teardownPlan,
  withholdLeaks,
  logSnapshotVerdict,
  kubeconfigFor,
  leakedLines,
  missingClusterTools,
  pageListsFinding,
  programLayerDockerfile,
  projectToggles,
  queueVerdict,
  roleManifest,
  scanEndDispatchCounts,
  scannerImage,
  scannerManifests,
  SCAN_ADAPTERS,
  zipStore,
} from '../cluster.mjs';
import { findUp } from '../lib.mjs';
import { fakeSecretFile, fixtureFiles, writeFixtureRepo } from '../cluster-fixture.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
// Fake credentials, built at run time so that no secret-shaped literal sits in this file.
const FAKE = {
  token: `fake-token-${'x'.repeat(24)}`,
  ca: Buffer.from('fake CA certificate').toString('base64'),
  cert: Buffer.from('fake client certificate').toString('base64'),
  key: Buffer.from('fake client key').toString('base64'),
  password: 'p'.repeat(24),
  upload: `cdst_${'a'.repeat(43)}`,
};
const DEPLOY_DIR = resolve(HERE, '..', '..');
const RUN = join(HERE, '..', 'run.mjs');

test('roleManifest(cd-scans) is the README Role in that namespace, with the six verbs and nothing on listing secrets', () => {
  const role = roleManifest('cd-scans');
  assert.match(role, /^kind: Role$/m);
  assert.match(role, /^ {2}namespace: cd-scans$/m);
  assert.doesNotMatch(role, /cybedefend-scans/);
  assert.match(role, /resources: \["pods"\]\n\s+verbs: \["create", "get", "list", "delete"\]/);
  assert.match(role, /resources: \["secrets"\]\n\s+verbs: \["create", "delete"\]/);
  assert.equal([...role.matchAll(/verbs:/g)].length, 2);
});

test('namespaceManifest is the README Namespace, in the smoke namespace, enforcing the restricted Pod Security Standard', () => {
  const ns = namespaceManifest('cd-scans');
  assert.match(ns, /^kind: Namespace$/m);
  assert.match(ns, /^ {2}name: cd-scans$/m);
  assert.match(ns, /^ {4}pod-security\.kubernetes\.io\/enforce: restricted$/m);
  assert.doesNotMatch(ns, /cybedefend-scans/);
  const readme = readFileSync(join(DEPLOY_DIR, 'README.md'), 'utf8');
  const block = [...readme.matchAll(/^```yaml\n([\s\S]*?)^```$/gm)].map((m) => m[1]).find((b) => /^kind: Namespace$/m.test(b));
  assert.equal(ns, block.replaceAll('cybedefend-scans', 'cd-scans'), 'taken from the README, not written by the smoke');
});

test('instanceId is the first 16 hex of sha256 of the normalised public URL (as the README states it)', () => {
  const expected = createHash('sha256').update('https://appsec.example.com').digest('hex').slice(0, 16);
  assert.equal(instanceId('https://appsec.example.com'), expected);
  assert.equal(instanceId('  HTTPS://AppSec.Example.COM/  '), expected, 'trimmed, no trailing slash, scheme and host lower-cased');
  assert.equal(instanceId('http://172.30.250.250:8080'), createHash('sha256').update('http://172.30.250.250:8080').digest('hex').slice(0, 16));
  // The path keeps its case.
  assert.equal(instanceId('https://Example.com/AppSec/'), createHash('sha256').update('https://example.com/AppSec').digest('hex').slice(0, 16));
  assert.match(instanceId('https://x.test'), /^[0-9a-f]{16}$/);
});

// kubectl get pods,secrets -l app.kubernetes.io/managed-by=cybedefend --show-labels:
// server-side tables, one per kind, the labels in the last column. No Secret data.
const TABLE = (podLabels, secretLabels) => [
  'NAME                                   READY   STATUS    RESTARTS   AGE   LABELS',
  `pod/cd-scan-opengrep-0001               1/1     Running   0          10s   ${podLabels}`,
  '',
  'NAME                                   TYPE     DATA   AGE   LABELS',
  `secret/cd-scan-opengrep-0001-run        Opaque   2      10s   ${secretLabels}`,
  '',
].join('\n');

test('instanceLabelVerdict: every managed pod and Secret carries this instance label', () => {
  const id = '0123456789abcdef';
  const good = `app.kubernetes.io/managed-by=cybedefend,cybedefend.io/adapter=opengrep,cybedefend.io/instance=${id}`;
  assert.deepEqual(instanceLabelVerdict(TABLE(good, good), id), { ok: true, pods: 1, secrets: 1, missing: [] });
});

test('instanceLabelVerdict names the resource without the label, or with another instance, never its content', () => {
  const id = '0123456789abcdef';
  const v = instanceLabelVerdict(
    TABLE('app.kubernetes.io/managed-by=cybedefend', 'app.kubernetes.io/managed-by=cybedefend,cybedefend.io/instance=ffffffffffffffff'),
    id,
  );
  assert.equal(v.ok, false);
  assert.deepEqual(v.missing, ['pod/cd-scan-opengrep-0001', 'secret/cd-scan-opengrep-0001-run']);
  assert.equal(instanceLabelVerdict('', id).ok, true);
  assert.deepEqual(instanceLabelVerdict('', id), { ok: true, pods: 0, secrets: 0, missing: [] });
  assert.equal(instanceLabelVerdict(TABLE('<none>', `cybedefend.io/instance=${id}`), id).missing[0], 'pod/cd-scan-opengrep-0001');
});

test('managedSelector is the selector of the README cleanup commands, for this instance', () => {
  const readme = readFileSync(join(DEPLOY_DIR, 'README.md'), 'utf8');
  const selectors = [...readme.matchAll(/^kubectl -n cybedefend-scans (?:get|delete) [a-z,]+ -l (\S+)$/gm)].map((m) => m[1]);
  assert.ok(selectors.length >= 2, 'the README has its cleanup commands');
  for (const sel of selectors) assert.equal(managedSelector('0123456789abcdef'), sel.replace('$CYBEDEFEND_INSTANCE_ID', '0123456789abcdef'));
  assert.throws(() => managedSelector('nope'));
});

test('scannerManifests holds the ServiceAccount, Role, RoleBinding and token Secret of the README, in the namespace', () => {
  const yaml = scannerManifests('cd-scans');
  for (const kind of ['ServiceAccount', 'Role', 'RoleBinding', 'Secret']) assert.match(yaml, new RegExp(`^kind: ${kind}$`, 'm'));
  assert.match(yaml, /kubernetes\.io\/service-account-token/);
  assert.doesNotMatch(yaml, /cybedefend-scans/);
  assert.equal([...yaml.matchAll(/namespace: cd-scans/g)].length, 5);
});

test('kubeconfigFor is the README kubeconfig with the server, CA, token and namespace filled in', () => {
  const text = kubeconfigFor({ name: 'cybedefend-scanner', namespace: 'cd-scans' }, 'https://cd-smoke-control-plane:6443', FAKE.token, FAKE.ca);
  assert.match(text, /^kind: Config$/m);
  assert.match(text, /^ {6}server: https:\/\/cd-smoke-control-plane:6443$/m);
  assert.match(text, new RegExp(`^ {6}certificate-authority-data: ${FAKE.ca}$`, 'm'));
  assert.match(text, new RegExp(`^ {6}token: ${FAKE.token}$`, 'm'));
  assert.match(text, /^ {6}namespace: cd-scans$/m);
  assert.doesNotMatch(text, /<[^>]+>/, 'no placeholder left');
  assert.doesNotMatch(text, /^\s+(exec|auth-provider):/m);
});

test('kubeconfigFor refuses a value that would break the YAML', () => {
  assert.throws(() => kubeconfigFor({ name: 'sa', namespace: 'cd-scans' }, 'https://x:6443', 'a\nb', 'Q0E='), /token/);
  assert.throws(() => kubeconfigFor({ name: 'sa', namespace: 'Bad NS' }, 'https://x:6443', 't', 'Q0E='), /namespace/);
});

test('expectedFindings names the five pages, their tools and what each must list', () => {
  const rows = expectedFindings();
  assert.deepEqual(
    rows.map((r) => [r.page, r.tool, r.marker]),
    [
      ['sast', 'opengrep', 'app.py'],
      ['cicd', 'zizmor', 'ci.yml'],
      ['secret', 'gitleaks', 'config.py'],
      ['iac', 'trivy-config', 'Dockerfile'],
      ['sca', 'trivy-fs', 'django'],
    ],
  );
  assert.deepEqual(
    rows.map((r) => r.toggle),
    ['sastEnabled', 'sastEnabled', 'secretEnabled', 'iacEnabled', 'scaEnabled'],
  );
  assert.deepEqual([...new Set(rows.map((r) => r.tool))].sort(), [...SCAN_ADAPTERS].sort());
});

test('projectToggles enables one scan type and turns every other one off', () => {
  const t = projectToggles('iacEnabled');
  assert.equal(t.iacEnabled, true);
  for (const [k, v] of Object.entries(t)) if (k !== 'iacEnabled') assert.equal(v, false, k);
  for (const k of ['sastEnabled', 'scaEnabled', 'secretEnabled', 'containerEnabled', 'aibomEnabled']) assert.ok(k in t, k);
  assert.throws(() => projectToggles('nopeEnabled'));
});

test('pageListsFinding needs a total and a listed row naming the marker', () => {
  assert.equal(pageListsFinding({ total: 1, vulnerabilities: [{ path: 'src/app.py' }] }, 'app.py').ok, true);
  assert.equal(pageListsFinding({ total: 1, vulnerabilities: [{ library: { packageName: 'django' } }] }, 'django').ok, true);
  assert.equal(pageListsFinding({ total: 0, vulnerabilities: [] }, 'app.py').ok, false);
  assert.equal(pageListsFinding({ total: 2, vulnerabilities: [{ path: 'other.py' }] }, 'app.py').ok, false);
  assert.equal(pageListsFinding(undefined, 'app.py').ok, false);
});

test('queueVerdict: never more than the limit running, and at least one scan seen queued', () => {
  const ok = queueVerdict(
    [
      { a: 'running', b: 'running', c: 'queued' },
      { a: 'completed', b: 'running', c: 'running' },
    ],
    2,
  );
  assert.deepEqual(ok, { ok: true, maxRunning: 2, queued: ['c'] });
  assert.equal(queueVerdict([{ a: 'running', b: 'running', c: 'running' }], 2).ok, false);
  const none = queueVerdict([{ a: 'running', b: 'running' }], 2);
  assert.equal(none.ok, false);
  assert.match(none.reason, /queued/);
});

// The scans of the fixture end in a few seconds, and their archives are
// released one at a time: left alone, two scans rarely overlap and none ever
// waits. The runner holds the pods while the scans start, and goes on once
// this verdict says the queue has formed.
test('heldQueueVerdict: held once the limit is running and every other scan is queued', () => {
  assert.deepEqual(heldQueueVerdict({ a: 'running', b: 'running', c: 'queued', d: 'queued', e: 'queued' }, 2), {
    held: true,
    running: 2,
    queued: 3,
  });
  // An archive not processed yet: its scan has neither a slot nor a place in the queue.
  assert.equal(heldQueueVerdict({ a: 'running', b: 'running', c: 'queued', d: 'waiting_for_file' }, 2).held, false);
  assert.equal(heldQueueVerdict({ a: 'running', b: 'waiting_for_file', c: 'waiting_for_file' }, 2).held, false);
  // Fewer scans than slots: all of them run, none waits.
  assert.equal(heldQueueVerdict({ a: 'running' }, 2).held, true);
});

test('heldQueueVerdict refuses more scans running than the limit, and a scan that ended while no pod could start', () => {
  const over = heldQueueVerdict({ a: 'running', b: 'running', c: 'running', d: 'queued' }, 2);
  assert.equal(over.held, false);
  assert.match(over.reason, /3 scans ran at once, the limit is 2/);
  const ended = heldQueueVerdict({ a: 'running', b: 'failed', c: 'queued' }, 2);
  assert.equal(ended.held, false);
  assert.match(ended.reason, /b is failed/);
});

test('SCANNER_MAX_CONCURRENT is the limit of an instance that sets none', () => {
  assert.equal(SCANNER_MAX_CONCURRENT, 2);
  assert.ok(!('CYBEDEFEND_SCANNER_MAX_CONCURRENT' in clusterEnvOverrides({ tag: '0.0.0-smoke' })), 'the variant leaves the limit unset');
});

// The failure path's image is built from an older commit of the scanners
// repository. A short id that the repository does not have used to unpack
// nothing, and the build then failed on a missing folder.
test('NO_SCAN_RUN_COMMIT is a full commit id', () => {
  assert.match(NO_SCAN_RUN_COMMIT, /^[0-9a-f]{40}$/);
});

test('buildScannerImages refuses a commit the scanners repository does not have, before any build', () => {
  const repo = mkdtempSync(join(tmpdir(), 'cd-smoke-norepo-'));
  try {
    assert.equal(spawnSync('git', ['init', '-q', repo]).status, 0, 'git init');
    assert.throws(
      () => buildScannerImages({ repo, tag: '0.0.0-test', adapters: ['gitleaks'], commit: 'a'.repeat(40) }),
      (err) => err instanceof ClusterError && err.message.includes(`has no commit ${'a'.repeat(40)}`) && /full clone/.test(err.message),
    );
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

// A commit from before the scan mode may ship the runner under another name
// than the one the pods start: the container would then not start at all
// (code 60) instead of the runner answering exit 4 (code 84).
test('entrypointProgram reads the program an image starts from its Dockerfile', () => {
  const dockerfile = [
    'FROM golang:1 AS build',
    'ENTRYPOINT ["/bin/builder"]',
    'FROM scratch',
    'COPY --from=build /out/runner /usr/local/bin/runner',
    '  ENTRYPOINT ["/usr/local/bin/runner","run","gitleaks"]  ',
    '',
  ].join('\n');
  assert.equal(entrypointProgram(dockerfile), '/usr/local/bin/runner');
});

test('entrypointProgram refuses a Dockerfile without an exec-form ENTRYPOINT, and a program that is not a plain absolute path', () => {
  assert.throws(() => entrypointProgram('FROM scratch\nCMD ["/bin/x"]\n'), ClusterError);
  assert.throws(() => entrypointProgram('FROM scratch\nENTRYPOINT /usr/local/bin/runner run\n'), ClusterError);
  assert.throws(() => entrypointProgram('FROM scratch\nENTRYPOINT ["runner"]\n'), ClusterError);
  assert.throws(() => entrypointProgram('FROM scratch\nENTRYPOINT ["/usr/local/bin/run ner\\nRUN x"]\n'), ClusterError);
});

test('programLayerDockerfile puts the program under the name the pods start, on top of the image', () => {
  assert.equal(
    programLayerDockerfile('ghcr.io/cybedefend/cybedefend-scanners/gitleaks:0.0.0-noscanrun', '/usr/local/bin/former', '/usr/local/bin/current'),
    [
      'FROM ghcr.io/cybedefend/cybedefend-scanners/gitleaks:0.0.0-noscanrun',
      'COPY --from=ghcr.io/cybedefend/cybedefend-scanners/gitleaks:0.0.0-noscanrun /usr/local/bin/former /usr/local/bin/current',
      '',
    ].join('\n'),
  );
});

const KC = () =>
  kubeconfigFor(
    { name: 'cybedefend-scanner', namespace: 'cd-scans' },
    'https://cd-smoke-control-plane:6443',
    FAKE.token,
    FAKE.ca,
  );

test('kubeconfigSecrets keeps only the credential values: token, CA, client key and certificate data, password', () => {
  const extra = [
    KC(),
    `      client-certificate-data: ${FAKE.cert}`,
    `      client-key-data: ${FAKE.key}`,
    `      password: ${FAKE.password}`,
    '',
  ].join('\n');
  assert.deepEqual(kubeconfigSecrets(extra).sort(), [FAKE.cert, FAKE.key, FAKE.ca, FAKE.token, FAKE.password].sort());
});

test('leakedLines finds a token, a signed URL and a kubeconfig credential, and ignores its non-secret values', () => {
  const logs = [
    'boot ok',
    'apiVersion: v1',
    `POST upload ${FAKE.upload}`,
    'GET http://172.30.250.251:9000/cybedefend/x?X-Amz-Signature=abcd',
    `auth with ${FAKE.token}`,
    `ca ${FAKE.ca}`,
    'CLUSTER_SCANNING_ENABLED namespace=cd-scans',
    'connecting to https://cd-smoke-control-plane:6443 as cybedefend-scanner',
  ].join('\n');
  const found = leakedLines(logs, KC());
  assert.equal(found.length, 4);
  assert.ok(found.every((l) => !/CLUSTER_SCANNING_ENABLED|connecting to/.test(l)));
});

test('withholdLeaks replaces a leaked line before a log is printed', () => {
  const out = withholdLeaks(`ok\ntoken ${FAKE.upload}\nfine`, KC());
  assert.equal(out, 'ok\n[a line holding a credential is withheld]\nfine');
});

test('withholdLeaks withholds a leaked line that ends in a carriage return', () => {
  const out = withholdLeaks(`ok\r\ntoken ${FAKE.upload}\r\nfine`, KC());
  assert.doesNotMatch(out, /cdst_/);
  assert.equal(out, 'ok\n[a line holding a credential is withheld]\nfine');
  assert.equal(leakedLines('a\r\nX-Amz-Signature=1\r\n', KC()).length, 1);
});

test('logSnapshotVerdict refuses a missing or empty snapshot: a leak check must have read something', () => {
  assert.equal(logSnapshotVerdict('line\n').ok, true);
  assert.equal(logSnapshotVerdict('').ok, false);
  assert.match(logSnapshotVerdict('').reason, /empty/);
  assert.equal(logSnapshotVerdict(undefined).ok, false);
  assert.match(logSnapshotVerdict(undefined).reason, /no snapshot/);
});

test('settledDispatchVerdict: one dispatch per scan, read after the settle period', () => {
  assert.deepEqual(settledDispatchVerdict({ a: 1, b: 1 }), { ok: true, wrong: [] });
  assert.deepEqual(settledDispatchVerdict({ a: 1, b: 2, c: 0 }), { ok: false, wrong: ['b: 2', 'c: 0'] });
});

test('teardownPlan: a refused start removes nothing', () => {
  assert.deepEqual(teardownPlan({ keep: false }), []);
  assert.deepEqual(teardownPlan({ keep: false, createdNetwork: false, createdCluster: false, stackStarted: false, wroteKubeconfig: false }), []);
});

test('teardownPlan: a full run removes everything it created, in order; --keep removes nothing', () => {
  const all = { createdNetwork: true, createdCluster: true, stackStarted: true, wroteKubeconfig: true };
  assert.deepEqual(teardownPlan({ keep: false, ...all }), ['stack', 'kubeconfig', 'cluster', 'network']);
  assert.deepEqual(teardownPlan({ keep: true, ...all }), []);
  assert.deepEqual(teardownPlan({ keep: false, createdNetwork: true }), ['network']);
  assert.deepEqual(teardownPlan({ keep: false, createdNetwork: true, createdCluster: true }), ['cluster', 'network']);
});

test('networkIsOurs reads the smoke label of docker network inspect', () => {
  assert.equal(networkIsOurs('1'), true);
  assert.equal(networkIsOurs('1\n'), true);
  assert.equal(networkIsOurs(''), false);
  assert.equal(networkIsOurs('<no value>'), false);
});

test('enabledLogCount counts the CLUSTER_SCANNING_ENABLED lines of the namespace', () => {
  const logs = 'x\nINFO CLUSTER_SCANNING_ENABLED namespace=cd-scans\nINFO CLUSTER_SCANNING_ENABLED namespace=other\n';
  assert.equal(enabledLogCount(logs, 'cd-scans'), 1);
  assert.equal(enabledLogCount('', 'cd-scans'), 0);
});

test('enabledInstanceIds reads the instance id of each CLUSTER_SCANNING_ENABLED line of the namespace', () => {
  const logs = [
    'INFO CLUSTER_SCANNING_ENABLED namespace=cd-scans instance=0123456789abcdef',
    'INFO CLUSTER_SCANNING_ENABLED namespace=other instance=ffffffffffffffff',
    'INFO CLUSTER_SCANNING_ENABLED namespace=cd-scans',
  ].join('\n');
  assert.deepEqual(enabledInstanceIds(logs, 'cd-scans'), ['0123456789abcdef', null]);
  assert.equal(enabledLogCount(logs, 'cd-scans'), 2);
  assert.deepEqual(enabledInstanceIds('', 'cd-scans'), []);
});

test('kindVersionOk wants kind 0.27 or later', () => {
  assert.equal(kindVersionOk('kind v0.33.0 go1.27.1 darwin/arm64'), true);
  assert.equal(kindVersionOk('kind v0.27.0 go1.24 linux/amd64'), true);
  assert.equal(kindVersionOk('kind v0.26.9 go1.23 linux/amd64'), false);
  assert.equal(kindVersionOk('kind v1.0.0-alpha'), true);
  assert.equal(kindVersionOk('garbage'), false);
});

test('missingClusterTools names what is not on PATH', () => {
  assert.deepEqual(missingClusterTools((t) => t !== 'kind'), ['kind']);
  assert.deepEqual(missingClusterTools(() => true), []);
});

test('scannerImage is the name the pod pulls', () => {
  assert.equal(scannerImage('trivy-fs', '0.0.0-smoke'), 'ghcr.io/cybedefend/cybedefend-scanners/trivy-fs:0.0.0-smoke');
  assert.deepEqual([...SCAN_ADAPTERS], ['opengrep', 'zizmor', 'gitleaks', 'trivy-config', 'trivy-fs']);
});

test('clusterAddresses gives the front and the storage fixed addresses on the kind network', () => {
  const a = clusterAddresses('172.30.250.0/24');
  assert.deepEqual(a, {
    dashboardIp: '172.30.250.250',
    storageIp: '172.30.250.251',
    publicUrl: 'http://172.30.250.250:8080',
    storagePublicUrl: 'http://172.30.250.251:9000',
  });
  assert.throws(() => clusterAddresses('10.0.0.0/16'), /\/24/);
});

test('clusterEnvOverrides points the instance at the cluster addresses and the tag', () => {
  const env = clusterEnvOverrides({ subnet: '172.30.250.0/24', network: 'cd-smoke-kind', tag: '0.0.0-smoke' });
  assert.equal(env.CYBEDEFEND_PUBLIC_URL, 'http://172.30.250.250:8080');
  assert.equal(env.CYBEDEFEND_STORAGE_PUBLIC_URL, 'http://172.30.250.251:9000');
  assert.equal(env.CYBEDEFEND_KIND_NETWORK, 'cd-smoke-kind');
  assert.equal(env.CYBEDEFEND_KIND_DASHBOARD_IP, '172.30.250.250');
  assert.equal(env.CYBEDEFEND_KIND_STORAGE_IP, '172.30.250.251');
  assert.equal(env.CYBEDEFEND_SCANNER_IMAGE_TAG, '0.0.0-smoke');
  assert.equal(CLUSTER_NAMESPACE, 'cd-scans');
  assert.equal(CLUSTER_SMOKE_LABEL, 'cybe-cluster-smoke=1');
});


const fileOf = (files, name) => files.find((f) => f.name === name).content.toString('utf8');

test('fixtureFiles generates, per scanner, the file it must find', () => {
  const files = fixtureFiles('sast');
  assert.match(fileOf(files, 'app.py'), /eval\(input\(\)\)/, 'opengrep: eval of user input');
  assert.match(fileOf(files, 'Dockerfile'), /^FROM /m);
  assert.doesNotMatch(fileOf(files, 'Dockerfile'), /^USER\b/m, 'trivy-config: no USER');
  const ci = fileOf(files, '.github/workflows/ci.yml');
  assert.match(ci, /^ {2}pull_request_target:/m, 'zizmor: dangerous trigger');
  assert.match(ci, /uses: actions\/checkout@v\d/);
  assert.match(ci, /ref: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/, 'zizmor: checkout of the head');
  assert.match(fileOf(files, 'requirements.txt'), /^django==2\.2\.0$/m, 'trivy-fs: a vulnerable django');
  assert.ok(!files.some((f) => f.name === 'config.py'), 'no secret outside the secret project');
});

test('fixtureFiles adds a fresh config.py, with keys Gitleaks recognises, to the secret project only', () => {
  const a = fileOf(fixtureFiles('secret'), 'config.py');
  const b = fileOf(fixtureFiles('secret'), 'config.py');
  assert.notEqual(a, b);
  assert.match(a, /AKIA[A-Z2-7]{16}/);
  assert.match(a, /ghp_[0-9A-Za-z]{36}/);
});

test('writeFixtureRepo writes the files under a temporary folder, and the archive has the layout the scanners expect', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cd-fixture-test-'));
  try {
    writeFixtureRepo(dir, 'secret');
    const entries = fixtureEntries(dir);
    // At the archive root, no top folder: the workflow under .github/workflows.
    assert.deepEqual(entries.map((e) => e.name).sort(), ['.github/workflows/ci.yml', 'Dockerfile', 'app.py', 'config.py', 'requirements.txt']);
    const zip = zipStore(entries);
    const names = [];
    let off = 0;
    while (zip.readUInt32LE(off) === 0x04034b50) {
      const size = zip.readUInt32LE(off + 18);
      const nameLen = zip.readUInt16LE(off + 26);
      names.push(zip.subarray(off + 30, off + 30 + nameLen).toString('utf8'));
      off += 30 + nameLen + zip.readUInt16LE(off + 28) + size;
    }
    assert.deepEqual(names.sort(), entries.map((e) => e.name).sort());
    assert.ok(names.every((n) => !n.startsWith('/') && !n.includes('..')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('no planted fixture is committed: libs/test-fixtures/cluster-scan does not exist', () => {
  const fixtures = findUp(DEPLOY_DIR, join('libs', 'test-fixtures'));
  assert.ok(!existsSync(join(fixtures, 'cluster-scan')), 'libs/test-fixtures/cluster-scan is generated at run time, never committed');
});

test('scanEndDispatchCounts counts the scan-end dispatch line of analysis-reporting per scan id', () => {
  const a = '11111111-1111-4111-8111-111111111111';
  const b = '22222222-2222-4222-8222-222222222222';
  const line = (id) => `[Nest] 1 - LOG [ScanCompleteNotificationService] [ScanCompleteNotification] All processing complete for scan ${id}. Dispatching notifications and creating issues...`;
  const logs = [
    line(a),
    `[ScanCompleteNotification] Notification already sent for scan ${a}. Skipping.`,
    line(b),
    line(b),
    'unrelated',
  ].join('\n');
  assert.deepEqual(scanEndDispatchCounts(logs, [a, b, 'c']), { [a]: 1, [b]: 2, c: 0 });
});

test('isDockerDesktop recognises Docker Desktop from docker info, not OrbStack nor Linux', () => {
  assert.equal(isDockerDesktop('Docker Desktop'), true);
  assert.equal(isDockerDesktop('Docker Desktop 4.40.0 (187762)'), true);
  assert.equal(isDockerDesktop('OrbStack'), false);
  assert.equal(isDockerDesktop('Ubuntu 24.04.1 LTS'), false);
  assert.equal(isDockerDesktop(''), false);
});

test('the usage says the cluster variant needs a host that reaches container addresses', () => {
  const help = spawnSync(process.execPath, [RUN, '--help'], { encoding: 'utf8' });
  assert.match(help.stdout, /reach container IP addresses: Linux or OrbStack, not Docker Desktop/);
});

test('zipStore writes a ZIP whose entries read back', () => {
  const entries = [
    { name: 'app.py', content: Buffer.from('print(1)\n') },
    { name: '.github/workflows/ci.yml', content: Buffer.from('on: push\n'.repeat(50)) },
  ];
  const zip = zipStore(entries);
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(eocd > 0);
  assert.equal(zip.readUInt16LE(eocd + 10), 2);
  // Read every local entry back.
  let off = 0;
  const back = [];
  while (zip.readUInt32LE(off) === 0x04034b50) {
    const method = zip.readUInt16LE(off + 8);
    const size = zip.readUInt32LE(off + 18);
    const nameLen = zip.readUInt16LE(off + 26);
    const extra = zip.readUInt16LE(off + 28);
    const name = zip.subarray(off + 30, off + 30 + nameLen).toString('utf8');
    const data = zip.subarray(off + 30 + nameLen + extra, off + 30 + nameLen + extra + size);
    back.push({ name, content: method === 8 ? inflateRawSync(data) : data });
    off += 30 + nameLen + extra + size;
  }
  assert.deepEqual(back.map((e) => [e.name, e.content.toString()]), entries.map((e) => [e.name, e.content.toString()]));
});

test('run.mjs --variant cluster without kind or kubectl exits 2 and says what is missing', () => {
  const res = spawnSync(process.execPath, [RUN, '--variant', 'cluster'], {
    encoding: 'utf8',
    env: { PATH: dirname(process.execPath) },
  });
  assert.equal(res.status, 2, res.stdout + res.stderr);
  assert.match(res.stderr, /the cluster variant needs kind \(>= 0\.27\) and kubectl on PATH; missing: kind/);
});

test('--variant all does not run the cluster variant, and the help names it', () => {
  const all = spawnSync(process.execPath, [RUN, '--variant', 'all'], { encoding: 'utf8', env: { ...process.env, SMOKE_DRY_RUN: '1' } });
  assert.equal(all.status, 0);
  assert.match(all.stdout, /variants=default,smtp,storage-late\b/);
  const help = spawnSync(process.execPath, [RUN, '--help'], { encoding: 'utf8' });
  assert.match(help.stdout, /\| cluster/);
  assert.match(help.stdout, /--scanners-repo/);
});

test('--build --variant cluster needs the scanners repository', () => {
  const res = spawnSync(process.execPath, [RUN, '--build', '--variant', 'cluster'], {
    encoding: 'utf8',
    env: { ...process.env, SMOKE_DRY_RUN: '1', CYBEDEFEND_SCANNERS_REPO: '' },
  });
  assert.equal(res.status, 2);
  assert.match(res.stderr, /--scanners-repo/);
});

test('the README the helpers read is the deploy README', () => {
  assert.ok(readFileSync(join(DEPLOY_DIR, 'README.md'), 'utf8').includes('## Run scans on a Kubernetes cluster'));
});
