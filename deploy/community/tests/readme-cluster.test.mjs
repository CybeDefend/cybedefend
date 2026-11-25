// The README section « Run scans on a Kubernetes cluster » against what the
// code does: the nine variables and their defaults, the six verbs of the
// access check, the failure codes 80–88 and 90–98 and the runner's exit codes. A change
// on one side that the other does not follow fails here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findUp } from '../smoke/lib.mjs';

const DEPLOY_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const README = readFileSync(join(DEPLOY_DIR, 'README.md'), 'utf8');
const TITLE = '## Run scans on a Kubernetes cluster';

/** The section, from its title to the next `## ` title. */
function section() {
  const start = README.indexOf(`\n${TITLE}\n`);
  assert.ok(start >= 0, `README.md has no « ${TITLE} » section`);
  const rest = README.slice(start + 1);
  const next = rest.indexOf('\n## ', TITLE.length);
  return next < 0 ? rest : rest.slice(0, next);
}

/** Every fenced block of the section: { lang, body }. */
function blocks(text) {
  return [...text.matchAll(/^```([a-z]*)\n([\s\S]*?)^```$/gm)].map((m) => ({ lang: m[1], body: m[2] }));
}

// security-scanning-service sits at apps/security-scanning-service at the root of the tree.
const CONFIG = readFileSync(
  findUp(DEPLOY_DIR, join('apps', 'security-scanning-service', 'src', 'modules', 'cluster-scanning', 'cluster-scanning.config.ts')),
  'utf8',
);
const ERROR_CODES = readFileSync(
  findUp(DEPLOY_DIR, join('apps', 'security-scanning-service', 'src', 'core', 'constants', 'scanlink-error-codes.ts')),
  'utf8',
);
const constant = (source, name) => {
  const m = new RegExp(`export const ${name} = ([^;]+);`).exec(source);
  assert.ok(m, `${name} is not exported`);
  return m[1].trim().replace(/^'(.*)'$/, '$1');
};

test('the README has the section, linked from the import section', () => {
  section();
  assert.match(README, /\]\(#run-scans-on-a-kubernetes-cluster\)/);
});

test('the section lists the twelve variables with the defaults the code uses', () => {
  const text = section();
  const rows = new Map(
    [...text.matchAll(/^\| `(CYBEDEFEND_SCANNER_[A-Z_]+)` \| ([^|]*) \|/gm)].map((m) => [m[1], m[2].trim()]),
  );
  assert.deepEqual(
    [...rows.keys()],
    [
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
    ],
  );
  assert.equal(rows.get('CYBEDEFEND_SCANNER_IMAGE_REGISTRY'), `\`${constant(CONFIG, 'DEFAULT_SCANNER_IMAGE_REGISTRY')}\``);
  assert.equal(rows.get('CYBEDEFEND_SCANNER_IMAGE_TAG'), `\`${constant(CONFIG, 'DEFAULT_SCANNER_IMAGE_TAG')}\``);
  assert.equal(rows.get('CYBEDEFEND_SCANNER_MAX_CONCURRENT'), `\`${constant(CONFIG, 'DEFAULT_SCANNER_MAX_CONCURRENT')}\``);
  // Unset, the per-organization limit is the instance maximum: one organization keeps the whole capacity.
  assert.equal(rows.get('CYBEDEFEND_SCANNER_MAX_CONCURRENT_PER_ORGANIZATION'), 'the maximum');
  assert.match(text, /reserve/);
  assert.equal(rows.get('CYBEDEFEND_SCANNER_KEEP_PODS'), '`false`');
  assert.equal(rows.get('CYBEDEFEND_SCANNER_ALLOW_INSECURE_TLS'), '`false`');
  assert.match(text, /must be\s+set together, or neither/);
  assert.match(text, /CYBEDEFEND_SCANNER_KUBECONFIG_FILE=\/run\/cybedefend-cluster\/kubeconfig/);
});

test('the Role grants exactly the six verbs of the access check, and never list or get on secrets', () => {
  const role = blocks(section()).filter((b) => b.lang === 'yaml' && /^kind: Role$/m.test(b.body));
  assert.equal(role.length, 1, 'one Role manifest');
  const rules = [...role[0].body.matchAll(/resources: \[([^\]]*)\]\n\s*verbs: \[([^\]]*)\]/g)].map((m) => [
    m[1].split(',').map((s) => s.trim().replace(/"/g, '')),
    m[2].split(',').map((s) => s.trim().replace(/"/g, '')),
  ]);
  assert.deepEqual(rules, [
    [['pods'], ['create', 'get', 'list', 'delete']],
    [['secrets'], ['create', 'delete']],
  ]);
  // Both rules are on the core API group.
  assert.equal([...role[0].body.matchAll(/^ {2}- apiGroups: \[""\]$/gm)].length, 2);
  assert.doesNotMatch(role[0].body, /\*/);
});

test('the kubeconfig carries its token inline, and the README names the refused plugins', () => {
  const text = section();
  const kubeconfig = blocks(text).filter((b) => /^kind: Config$/m.test(b.body));
  assert.equal(kubeconfig.length, 1, 'one kubeconfig example');
  assert.match(kubeconfig[0].body, /^\s+token: /m);
  assert.doesNotMatch(text, /^\s*tokenFile:/m);
  assert.doesNotMatch(kubeconfig[0].body, /^\s+(exec|auth-provider):/m);
  for (const word of ['exec', 'auth-provider', 'CLUSTER_KUBECONFIG_PLUGIN_UNSUPPORTED', 'kubernetes.io/service-account-token', 'automountServiceAccountToken: false']) {
    assert.ok(text.includes(word), `the section names ${word}`);
  }
});

test('the section names the nine cluster failure codes with the names of the code', () => {
  const text = section();
  for (let code = 80; code <= 88; code += 1) {
    const m = new RegExp(`EXIT_(CLUSTER_[A-Z_]+) = ${code}\\b`).exec(ERROR_CODES);
    assert.ok(m, `scanlink-error-codes.ts has no ${code}`);
    assert.match(text, new RegExp(`^\\| ${code} \\| \`${m[1]}\` \\|`, 'm'), `the section lists ${code} ${m[1]}`);
  }
});

test('the section names the runner exit codes 0 and 2 to 6', () => {
  const rows = [...section().matchAll(/^\| Exit ([0-9]) \|/gm)].map((m) => Number(m[1]));
  assert.deepEqual(rows, [0, 2, 3, 4, 5, 6]);
});

test('the section says what the pods reach, the limits and the proxy setting', () => {
  const text = section();
  for (const words of [
    'CYBEDEFEND_PUBLIC_URL',
    'CYBEDEFEND_STORAGE_PUBLIC_URL',
    'ghcr.io',
    'mirror.gcr.io',
    'POST /api/scan-runs/<scanId>/results',
    'CYBEDEFEND_TRUSTED_PROXIES',
    'RATE_LIMITED',
    'Retry-After',
    'GET /api/instance/capabilities',
    'INSTANCE_CAPABILITIES_UNAVAILABLE',
    'activeDeadlineSeconds',
    '7500',
    '5700',
    'container image',
  ]) {
    assert.ok(text.includes(words), `the section says ${words}`);
  }
});

test('the section says how to keep the SCA pod off the internet: a database mirror, the operator\'s call', () => {
  const text = section();
  const after = text.slice(text.indexOf('kubectl apply -f cybedefend-scanner-networkpolicy.yaml'));
  for (const words of ['CYBEDEFEND_SCANNER_TRIVY_DB_REPOSITORY', 'CYBEDEFEND_SCANNER_TRIVY_JAVA_DB_REPOSITORY', 'cybedefend-scan-pods-sca-database']) {
    assert.ok(after.includes(words), `after the policy, the section names ${words}`);
  }
});

test('no example in the section holds what looks like a real credential', () => {
  const text = section();
  assert.doesNotMatch(text, /eyJ[A-Za-z0-9_-]{10,}/, 'a JWT');
  assert.doesNotMatch(text, /cdst_[A-Za-z0-9_-]{43}/, 'an upload token');
  assert.doesNotMatch(text, /certificate-authority-data: (?!<)/, 'a CA that is not a placeholder');
});

test('each runner exit names the scan code of scanlink-error-codes.ts', () => {
  const code = (name) => {
    const m = new RegExp(`export const ${name} = ([0-9]+);`).exec(ERROR_CODES);
    assert.ok(m, `${name} is not exported`);
    return m[1];
  };
  const expected = {
    0: 'none',
    2: code('EXIT_CLUSTER_TOOL_FAILED'),
    3: code('EXIT_CLUSTER_RESULTS_REFUSED'),
    4: code('EXIT_CLUSTER_IMAGE_INCOMPATIBLE'),
    5: code('EXIT_CLUSTER_IMAGE_INCOMPATIBLE'),
    6: code('EXIT_CLUSTER_ARCHIVE_FETCH_FAILED'),
  };
  const rows = Object.fromEntries(
    [...section().matchAll(/^\| Exit ([0-9]) \| [^|]+ \| ([^|]+) \|$/gm)].map((m) => [m[1], m[2].trim()]),
  );
  assert.deepEqual(rows, Object.fromEntries(Object.entries(expected).map(([k, v]) => [String(k), v])));
  assert.deepEqual([expected[2], expected[3], expected[4], expected[6]], ['85', '86', '84', '88']);
});

test('a pod that cannot fetch the archive points at the storage address, never a Git provider', () => {
  const text = section();
  const row = /^\| 88 \| `CLUSTER_ARCHIVE_FETCH_FAILED` \|(.*)$/m.exec(text);
  assert.ok(row, 'the 88 row');
  assert.match(row[1], /CYBEDEFEND_STORAGE_PUBLIC_URL/);
  assert.doesNotMatch(text, /code 66/);
});

test('the section names the archive refusal codes 90 to 98 with the names of the code', () => {
  const text = section();
  for (let code = 90; code <= 98; code += 1) {
    const m = new RegExp(`EXIT_(ARCHIVE_[A-Z_]+) = ${code}\\b`).exec(ERROR_CODES);
    assert.ok(m, `scanlink-error-codes.ts has no ${code}`);
    assert.match(text, new RegExp(`^\\| ${code} \\| \`${m[1]}\` \\|`, 'm'), `the section lists ${code} ${m[1]}`);
  }
});

test('the archive limits are the pods\' and name the entry limit and the upload deadline', () => {
  const limits = /^- \*\*The archive\.\*\*[\s\S]*?(?=^- \*\*)/m.exec(section());
  assert.ok(limits, 'the archive bullet of Limits');
  for (const words of ['2 GiB', '3 GiB unpacked', '200,000 entries', '1 GiB', '30 minutes', 'before any pod starts']) {
    assert.ok(limits[0].includes(words), `the archive bullet says ${words}`);
  }
});

test('the KEEP_PODS cleanup warns that it also deletes the pods of running scans', () => {
  const text = section();
  const at = text.indexOf('delete pods,secrets -l app.kubernetes.io/managed-by=cybedefend');
  assert.ok(at > 0, 'the cleanup command is documented');
  const before = text.slice(Math.max(0, at - 700), at);
  assert.match(before, /only once no scan is running/);
  assert.match(before, /`CLUSTER_POD_LOST`|code 87/);
});

test('Step 2 recommends inline credentials and says where certificate files must be', () => {
  const text = section();
  assert.match(text, /`certFile`/);
  assert.match(text, /`keyFile`/);
  assert.match(text, /inline credentials are recommended/i);
  assert.match(text, /\/run\/cybedefend-cluster/);
});

test('KEEP_PODS keeps no pod past its deadline, and the first scan waits for CLUSTER_SCANNING_ENABLED', () => {
  const text = section();
  const keep = /^\| `CYBEDEFEND_SCANNER_KEEP_PODS` \|.*$/m.exec(text);
  assert.ok(keep, 'the KEEP_PODS row');
  assert.match(keep[0], /a pod past its deadline is deleted anyway/);
  assert.match(text, /wait for `CLUSTER_SCANNING_ENABLED`[^.]*before the first scan/);
  assert.match(text, /SCANNERS_NOT_AVAILABLE/);
});

test('every kubectl command that selects by label also selects this instance', () => {
  const text = section();
  const selectors = blocks(text)
    .filter((b) => b.lang === 'bash')
    .flatMap((b) => b.body.split('\n'))
    .filter((line) => /^kubectl\b/.test(line) && /\s-l\s/.test(line))
    .map((line) => /\s-l\s+(\S+)/.exec(line)[1]);
  assert.ok(selectors.length >= 2, 'the get and the delete of the kept pods');
  for (const selector of selectors) {
    const parts = selector.split(',');
    assert.ok(parts.includes('app.kubernetes.io/managed-by=cybedefend'), `${selector} selects the managed pods`);
    assert.ok(parts.includes('cybedefend.io/instance=$CYBEDEFEND_INSTANCE_ID'), `${selector} selects this instance`);
  }
});

test('the section shows how to compute the instance id, on Linux and on macOS', () => {
  const text = section();
  const commands = blocks(text)
    .filter((b) => b.lang === 'bash')
    .map((b) => b.body);
  assert.ok(
    commands.some((c) => c.includes(`CYBEDEFEND_INSTANCE_ID=$(printf '%s' "$CYBEDEFEND_PUBLIC_URL" | sha256sum | cut -c1-16)`)),
    'the Linux command',
  );
  assert.ok(
    commands.some((c) => c.includes(`CYBEDEFEND_INSTANCE_ID=$(printf '%s' "$CYBEDEFEND_PUBLIC_URL" | shasum -a 256 | cut -c1-16)`)),
    'the macOS command',
  );
  assert.match(text, /first 16 hexadecimal characters of the SHA-256/);
  assert.match(text, /no trailing slash/);
  assert.match(text, /scheme and host in lower case/);
});

test('the section recommends one namespace per instance, and says a URL change leaves pods to delete by hand', () => {
  const text = section();
  assert.match(text, /one namespace per instance/i);
  assert.match(text, /Changing `CYBEDEFEND_PUBLIC_URL` while scans run[^.]*by hand/);
});

test('exit 3 names the pod that could not reach the instance', () => {
  const row = /^\| Exit 3 \| ([^|]+) \|/m.exec(section());
  assert.ok(row, 'the exit 3 row');
  assert.match(row[1], /could not reach the instance/);
  assert.match(row[1], /network path back/);
});

test('archive links are skipped, not refused, as the runner does', () => {
  const text = section();
  assert.match(text, /links are skipped/);
  assert.doesNotMatch(text, /links are refused/);
});

test('the namespace manifest enforces the restricted Pod Security Standard', () => {
  const ns = blocks(section()).filter((b) => b.lang === 'yaml' && /^kind: Namespace$/m.test(b.body));
  assert.equal(ns.length, 1, 'one Namespace manifest');
  assert.match(ns[0].body, /^ {2}name: cybedefend-scans$/m);
  assert.match(ns[0].body, /^ {4}pod-security\.kubernetes\.io\/enforce: restricted$/m);
  // The namespace is its own block, so the smoke's ServiceAccount block stays as it was.
  assert.doesNotMatch(ns[0].body, /^kind: ServiceAccount$/m);
  assert.match(section(), /^kubectl apply -f cybedefend-namespace\.yaml$/m);
  assert.doesNotMatch(section(), /^kubectl create namespace/m);
});

test('the section says the enable line prints the instance id, to copy instead of computing it', () => {
  const text = section();
  assert.match(text, /`CLUSTER_SCANNING_ENABLED namespace=<namespace> instance=<id>`/);
  assert.match(text, /copy it from there instead of computing it/);
});

test('the kubeconfig must let the instance verify the API server, and the section says how to opt out', () => {
  const text = section();
  for (const word of [
    'insecure-skip-tls-verify',
    'CLUSTER_KUBECONFIG_INSECURE_TLS',
    'CLUSTER_SCANNING_DISABLED reason=insecure_tls',
    'CLUSTER_SCANNING_INSECURE_TLS_ALLOWED',
    'CYBEDEFEND_SCANNER_ALLOW_INSECURE_TLS=true',
  ]) {
    assert.ok(text.includes(word), `the section names ${word}`);
  }
  const kubeconfig = blocks(text).find((b) => /^kind: Config$/m.test(b.body));
  assert.doesNotMatch(kubeconfig.body, /insecure-skip-tls-verify/);
});

test('the section offers the scan pods NetworkPolicy and says what to adapt', () => {
  const text = section();
  assert.ok(text.includes('cybedefend-scanner-networkpolicy.yaml'));
  assert.ok(text.includes('kubectl apply -f cybedefend-scanner-networkpolicy.yaml'));
  assert.match(text, /enforces? NetworkPolic/);
});
