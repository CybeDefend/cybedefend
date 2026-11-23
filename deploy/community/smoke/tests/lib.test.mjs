import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assessStack,
  buildEnvFile,
  builtImages,
  composeArgs,
  missingImages,
  countSarifResults,
  dashboardReadRoutes,
  serverErrorRoutes,
  importForm,
  generatedReportState,
  isTokenAnswer,
  kubernetesLogLines,
  s3ErrorCode,
  unsignedRefusal,
  writeSecretKeyFile,
  owaspPlacement,
  parseEnv,
  parseSetCookie,
  scaListHasPackages,
} from '../lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEPLOY_DIR = resolve(HERE, '..', '..');
const EXAMPLE = readFileSync(join(DEPLOY_DIR, '.env.example'), 'utf8');

test('buildEnvFile fills the required values and keeps every default of .env.example', () => {
  const env = parseEnv(buildEnvFile(EXAMPLE));
  assert.ok(env.CYBEDEFEND_SETUP_TOKEN.length >= 32, 'setup token of at least 32 characters');
  // The master key and every database password are no .env value any more.
  assert.equal(env.CYBEDEFEND_SECRET_KEY, undefined);
  assert.equal(env.POSTGRES_PASSWORD, undefined);

  const defaults = parseEnv(EXAMPLE);
  for (const [name, value] of Object.entries(defaults)) {
    if (value === '') continue;
    assert.equal(env[name], value, `${name} keeps its default`);
  }

  const overridden = parseEnv(buildEnvFile(EXAMPLE, { CYBEDEFEND_HTTP_PORT: '18080', EXTRA_VALUE: 'x' }));
  assert.equal(overridden.CYBEDEFEND_HTTP_PORT, '18080');
  assert.equal(overridden.EXTRA_VALUE, 'x');
  assert.notEqual(overridden.CYBEDEFEND_SETUP_TOKEN, env.CYBEDEFEND_SETUP_TOKEN, 'a fresh token each time');
});

test('writeSecretKeyFile writes a fresh 32-byte master key, mode 600, once', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cd-smoke-key-'));
  try {
    const path = writeSecretKeyFile(dir);
    assert.equal(path, join(dir, 'secret-key'));
    assert.equal(statSync(path).mode & 0o777, 0o600);
    const key = readFileSync(path, 'utf8');
    assert.equal(Buffer.from(key.trim(), 'base64').length, 32);
    // Kept across calls: the stack's key never changes during a run.
    assert.equal(writeSecretKeyFile(dir), path);
    assert.equal(readFileSync(path, 'utf8'), key);
    const other = mkdtempSync(join(tmpdir(), 'cd-smoke-key-'));
    assert.notEqual(readFileSync(writeSecretKeyFile(other), 'utf8'), key);
    rmSync(other, { recursive: true, force: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('composeArgs puts the build and variant files after the base file and sets --project-directory to the absolute deploy/community directory', () => {
  const args = composeArgs({
    deployDir: DEPLOY_DIR,
    projectName: 'cd-smoke-default',
    build: true,
    variantFiles: ['/abs/variants/smtp.yml'],
    envFile: '/tmp/smoke.env',
  });
  assert.equal(args[0], 'compose');
  const dirAt = args.indexOf('--project-directory');
  assert.ok(dirAt > 0);
  assert.ok(isAbsolute(args[dirAt + 1]));
  assert.equal(args[dirAt + 1], DEPLOY_DIR);
  assert.equal(args[args.indexOf('-p') + 1], 'cd-smoke-default');
  assert.equal(args[args.indexOf('--env-file') + 1], '/tmp/smoke.env');
  const files = args.flatMap((arg, i) => (arg === '-f' ? [args[i + 1]] : []));
  assert.deepEqual(files, [
    join(DEPLOY_DIR, 'docker-compose.yml'),
    join(DEPLOY_DIR, 'docker-compose.build.yml'),
    '/abs/variants/smtp.yml',
  ]);

  const noBuild = composeArgs({ deployDir: DEPLOY_DIR, projectName: 'p', build: false, variantFiles: [] });
  assert.deepEqual(
    noBuild.flatMap((arg, i) => (arg === '-f' ? [noBuild[i + 1]] : [])),
    [join(DEPLOY_DIR, 'docker-compose.yml')],
  );
  assert.ok(!noBuild.includes('--env-file'));
});

const row = (Service, State, Health = '', ExitCode = 0) => ({ Name: `cybedefend-${Service}-1`, Service, State, Health, ExitCode });

test('assessStack is healthy only when every long-running service is healthy (or running without a healthcheck), every job exited 0 and no container restarted', () => {
  const services = ['postgres', 'init-secrets', 'gateway', 'security-scanning-cron'];
  const jobs = ['init-secrets'];
  const rows = [
    row('postgres', 'running', 'healthy'),
    row('init-secrets', 'exited', '', 0),
    row('gateway', 'running', 'healthy'),
    row('security-scanning-cron', 'running', ''),
  ];
  assert.deepEqual(assessStack({ services, jobs, rows, restarts: {} }), { healthy: true });

  const starting = rows.map((r) => (r.Service === 'gateway' ? { ...r, Health: 'starting' } : r));
  assert.equal(assessStack({ services, jobs, rows: starting, restarts: {} }).healthy, false);

  const jobFailed = rows.map((r) => (r.Service === 'init-secrets' ? { ...r, ExitCode: 1 } : r));
  assert.equal(assessStack({ services, jobs, rows: jobFailed, restarts: {} }).healthy, false);

  const jobRunning = rows.map((r) => (r.Service === 'init-secrets' ? { ...r, State: 'running' } : r));
  assert.equal(assessStack({ services, jobs, rows: jobRunning, restarts: {} }).healthy, false);

  const restarted = assessStack({ services, jobs, rows, restarts: { 'cybedefend-gateway-1': 1 } });
  assert.equal(restarted.healthy, false);

  const missing = assessStack({ services, jobs, rows: rows.slice(0, 3), restarts: {} });
  assert.equal(missing.healthy, false);
});

test('assessStack names the first failing service', () => {
  const services = ['postgres', 'redis', 'gateway'];
  const rows = [row('postgres', 'running', 'healthy'), row('redis', 'running', 'unhealthy'), row('gateway', 'exited', '', 1)];
  const verdict = assessStack({ services, jobs: [], rows, restarts: {} });
  assert.equal(verdict.healthy, false);
  assert.equal(verdict.service, 'redis');
  assert.match(verdict.reason, /unhealthy/);

  const restarted = assessStack({
    services,
    jobs: [],
    rows: rows.map((r) => ({ ...r, State: 'running', Health: 'healthy' })),
    restarts: { 'cybedefend-gateway-1': 2 },
  });
  assert.equal(restarted.service, 'gateway');
  assert.match(restarted.reason, /restart/);
});

test('parseSetCookie reads name, Path, HttpOnly, Secure and SameSite', () => {
  const cookie = parseSetCookie('cd_refresh=abc.DEF_123; Max-Age=2592000; Path=/api/auth; HttpOnly; Secure; SameSite=Strict');
  assert.deepEqual(cookie, {
    name: 'cd_refresh',
    value: 'abc.DEF_123',
    path: '/api/auth',
    maxAge: 2592000,
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
  });
  const bare = parseSetCookie('x=1');
  assert.equal(bare.httpOnly, false);
  assert.equal(bare.secure, false);
  assert.equal(bare.path, undefined);
  assert.equal(bare.maxAge, undefined);
});

test('countSarifResults skips results with an accepted or status-less suppression', () => {
  const sarif = {
    version: '2.1.0',
    runs: [
      {
        tool: { driver: { name: 'x' } },
        results: [
          { ruleId: 'a', message: { text: 'kept' } },
          { ruleId: 'b', message: { text: 'suppressed' }, suppressions: [{ kind: 'inSource' }] },
          { ruleId: 'c', message: { text: 'rejected suppression' }, suppressions: [{ kind: 'external', status: 'rejected' }] },
        ],
      },
    ],
  };
  assert.equal(countSarifResults(sarif), 2);
  assert.equal(countSarifResults({ runs: [{ results: [{ suppressions: [{ status: 'accepted' }] }] }] }), 0);
  assert.equal(countSarifResults({ runs: [{}] }), 0);
});

test('importForm builds the multipart body with the file part first', () => {
  const form = importForm({ fileName: 'minimal.sarif', content: '{}', type: 'sast', branch: 'main', format: 'sarif' });
  assert.deepEqual([...form.keys()], ['file', 'type', 'branch', 'format']);
  assert.equal(form.get('type'), 'sast');
  assert.equal(form.get('branch'), 'main');
  assert.equal(form.get('format'), 'sarif');
  assert.equal(form.get('file').name, 'minimal.sarif');
});

test('importForm adds an image part only when one is given', () => {
  const sca = importForm({ fileName: 'trivy.sarif', content: '{}', type: 'sca', branch: 'main', format: 'sarif' });
  assert.ok(!sca.has('image'));
  const container = importForm({ fileName: 'i.sarif', content: '{}', type: 'container', branch: 'main', format: 'sarif', image: 'alpine:3.20' });
  const keys = [...container.keys()];
  assert.equal(keys.at(-1), 'image');
  assert.equal(container.get('image'), 'alpine:3.20');
});

test('scaListHasPackages accepts a list whose rows name a package and a version', () => {
  assert.deepEqual(
    scaListHasPackages({ total: 1, vulnerabilities: [{ library: { packageName: 'lodash', packageVersion: '4.17.20' } }] }),
    { ok: true },
  );
  const empty = scaListHasPackages({ total: 0, vulnerabilities: [] });
  assert.equal(empty.ok, false);
  assert.match(empty.reason, /total/);
  const noName = scaListHasPackages({ total: 1, vulnerabilities: [{ library: { packageName: '', packageVersion: '1.0.0' } }] });
  assert.equal(noName.ok, false);
  assert.match(noName.reason, /packageName/);
  const noVersion = scaListHasPackages({ total: 1, vulnerabilities: [{ library: { packageName: 'lodash', packageVersion: '' } }] });
  assert.equal(noVersion.ok, false);
  assert.match(noVersion.reason, /packageVersion/);
});

test('owaspPlacement reads the categories of the OWASP JSON', () => {
  const report = {
    summary: { byOwaspCategory: {} },
    owaspCategories: [
      { categoryData: { id: 'A03', name: 'Injection' }, count: 2, vulnerabilities: [{ type: 'sast' }, { type: 'iac' }] },
      { categoryData: { id: 'A06', name: 'Vulnerable and Outdated Components' }, count: 1, vulnerabilities: [{ type: 'sca' }] },
      { categoryData: { id: 'A01', name: 'Broken Access Control' }, count: 0, vulnerabilities: [] },
    ],
  };
  const placement = owaspPlacement(report);
  assert.deepEqual([...placement.get('A03')].sort(), ['iac', 'sast']);
  assert.deepEqual([...placement.get('A06')], ['sca']);
  assert.equal(placement.get('A01').size, 0);
  assert.equal(owaspPlacement({ owaspCategories: [] }).size, 0);
});

// expiresIn is the time the access token has left when the gateway
// answers, rounded (token-answer.ts): a setup slower than half a second
// answers 899, which a strict 900 failed.
test('isTokenAnswer accepts a Bearer answer whose expiresIn is at most the 900 s lifetime', () => {
  assert.equal(isTokenAnswer({ accessToken: 'a', tokenType: 'Bearer', expiresIn: 900 }), true);
  assert.equal(isTokenAnswer({ accessToken: 'a', tokenType: 'Bearer', expiresIn: 899 }), true);
  assert.equal(isTokenAnswer({ accessToken: 'a', tokenType: 'Bearer', expiresIn: 901 }), false);
  assert.equal(isTokenAnswer({ accessToken: 'a', tokenType: 'Bearer', expiresIn: 0 }), false);
  assert.equal(isTokenAnswer({ accessToken: '', tokenType: 'Bearer', expiresIn: 900 }), false);
  assert.equal(isTokenAnswer({ accessToken: 'a', tokenType: 'bearer', expiresIn: 900 }), false);
  assert.equal(isTokenAnswer(undefined), false);
});

// A report is generated asynchronously. The generate route answers
// { reportId, status: 'queued', downloadUrl: '' }; GET /reports/:reportId
// gives the signed URL once the row is ready.
test('generatedReportState reads a queued, ready or failed report', () => {
  assert.deepEqual(generatedReportState({ status: 'queued', downloadUrl: '' }), { state: 'pending' });
  assert.deepEqual(generatedReportState({ status: 'processing', downloadUrl: '' }), { state: 'pending' });
  assert.deepEqual(generatedReportState({ status: 'ready', downloadUrl: '' }), { state: 'pending' });
  assert.deepEqual(generatedReportState({ status: 'ready', downloadUrl: 'http://h/x' }), { state: 'ready', url: 'http://h/x' });
  assert.deepEqual(generatedReportState({ status: 'failed', error: 'boom' }), { state: 'failed', error: 'boom' });
  assert.deepEqual(generatedReportState(undefined), { state: 'pending' });
});

// The storage's S3 API must refuse every unsigned request, from
// the host (the published port) and from a container on storage-net.
test('s3ErrorCode reads the Code of an S3 XML error', () => {
  assert.equal(
    s3ErrorCode('<?xml version="1.0"?><Error><Code>AccessDenied</Code><Message>Access Denied.</Message></Error>'),
    'AccessDenied',
  );
  assert.equal(s3ErrorCode('<ListBucketResult></ListBucketResult>'), undefined);
  assert.equal(s3ErrorCode(undefined), undefined);
});

test('unsignedRefusal accepts only a 401 or 403 that does not carry the stored content', () => {
  const denied = '<Error><Code>AccessDenied</Code></Error>';
  assert.deepEqual(unsignedRefusal({ status: 403, body: denied }, 'secret-probe'), { refused: true, code: 'AccessDenied' });
  assert.deepEqual(unsignedRefusal({ status: 401, body: '' }, 'secret-probe'), { refused: true, code: undefined });
  assert.equal(unsignedRefusal({ status: 200, body: '<ListBucketResult/>' }, 'secret-probe').refused, false);
  assert.equal(unsignedRefusal({ status: 404, body: '<Error><Code>NoSuchKey</Code></Error>' }, 'x').refused, false);
  assert.equal(unsignedRefusal({ status: 403, body: 'secret-probe' }, 'secret-probe').refused, false);
});

// The smoke lists what it created: a route that answers 500 on PostgreSQL
// shows there.
const IDS = {
  organizationId: '11111111-1111-4111-8111-111111111111',
  teamId: '22222222-2222-4222-8222-222222222222',
  projectId: '33333333-3333-4333-8333-333333333333',
};

test('dashboardReadRoutes holds the reads a user opens after the setup', () => {
  const paths = dashboardReadRoutes(IDS);
  const o = IDS.organizationId;
  const p = IDS.projectId;
  for (const wanted of [
    `/organization/${o}/projects?page=1&pageSize=10&search=`,
    `/organization/${o}/results/overview`,
    `/project/${p}/results/sast?pageNumber=1&pageSizeNumber=10&branch=main`,
    `/project/${p}/results/sca?pageNumber=1&pageSizeNumber=10&branch=main`,
    `/project/${p}/results/container?pageNumber=1&pageSizeNumber=10&branch=main`,
    `/team/${IDS.teamId}/projects`,
    // The branch picker's call (a SELECT DISTINCT ordered by the
    // default-branch CASE, which PostgreSQL refuses).
    `/project/${p}/branches/list?page=1&pageSize=30&includeArchived=false`,
    '/user/profile',
  ]) {
    assert.ok(paths.includes(wanted), `missing ${wanted}`);
  }
  assert.equal(new Set(paths).size, paths.length, 'a route is listed twice');
  for (const path of paths) {
    assert.ok(path.startsWith('/'), path);
    assert.ok(!/undefined|null|\$\{/.test(path), `unfilled id in ${path}`);
  }
});

test('dashboardReadRoutes refuses a missing id', () => {
  assert.throws(() => dashboardReadRoutes({ ...IDS, projectId: undefined }), /projectId/);
});

test('serverErrorRoutes names every route that answered 5xx or no answer', () => {
  assert.deepEqual(
    serverErrorRoutes([
      { path: '/a', status: 200 },
      { path: '/b', status: 404 },
      { path: '/c', status: 500 },
      { path: '/d', status: 503 },
      { path: '/e', status: 0, error: 'fetch failed' },
      { path: '/f', status: 403 },
    ]),
    ['/c → HTTP 500', '/d → HTTP 503', '/e → no answer (fetch failed)'],
  );
});

// No cluster: nothing about a cluster is logged. The
// check looks for runtime markers only: the gateway maps the results route in
// every edition, and that boot line is not a cluster at work.
test('kubernetesLogLines returns the lines that show a cluster at work, never a route mapping', () => {
  const logs = [
    'gateway-1  | [Nest] 1  - LOG [RoutesResolver] ScanRunController {/scan-runs}: +0ms',
    'gateway-1  | [Nest] 1  - LOG [RouterExplorer] Mapped {/scan-runs/:scanId/results, POST} route +1ms',
    'gateway-1  | {"level":30,"context":"RouterExplorer","msg":"Mapped {/scan-runs/:scanId/results, POST} route"}',
    'security-scanning-1  | INFO CLUSTER_SCANNING_ENABLED namespace=cybedefend-scans',
    'security-scanning-1  | WARN CLUSTER_SCANNING_DISABLED reason=access_denied',
    'security-scanning-1  | WARN CLUSTER_KUBECONFIG_PLUGIN_UNSUPPORTED',
    'security-scanning-1  | could not read the Kubeconfig file',
    'gateway-1  | {"req":{"method":"POST","url":"/scan-runs/0b6f…/results"}}',
    'dashboard-1  | 10.0.0.9 - - "POST /api/scan-runs/0b6f/results HTTP/1.1" 202',
    'gateway-1  | POST /scan-runs/0b6f/results 401',
    'gateway-1  | token cdst_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA refused',
    'analysis-reporting-1  | Imported 3 results for scan 0b6f',
    'gateway-1  | GET /api/instance/capabilities 200',
    '',
  ].join('\n');
  assert.deepEqual(kubernetesLogLines(logs), [
    'security-scanning-1  | INFO CLUSTER_SCANNING_ENABLED namespace=cybedefend-scans',
    'security-scanning-1  | WARN CLUSTER_SCANNING_DISABLED reason=access_denied',
    'security-scanning-1  | WARN CLUSTER_KUBECONFIG_PLUGIN_UNSUPPORTED',
    'security-scanning-1  | could not read the Kubeconfig file',
    'gateway-1  | {"req":{"method":"POST","url":"/scan-runs/0b6f…/results"}}',
    'dashboard-1  | 10.0.0.9 - - "POST /api/scan-runs/0b6f/results HTTP/1.1" 202',
    'gateway-1  | POST /scan-runs/0b6f/results 401',
    'gateway-1  | token cdst_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA refused',
  ]);
});

test('kubernetesLogLines finds nothing in an empty or quiet log', () => {
  assert.deepEqual(kubernetesLogLines(''), []);
  assert.deepEqual(kubernetesLogLines(undefined), []);
  assert.deepEqual(kubernetesLogLines('a\r\nb\n'), []);
});

// One image serves several containers (the API, its workers and its
// scheduler): it is built once, by the one service that carries the build.
test('builtImages lists each image the build services make, once, sorted', () => {
  const config = {
    services: {
      api: { image: 'ghcr.io/x/api:1', build: { context: '.' } },
      worker: { image: 'ghcr.io/x/api:1', pull_policy: 'never' },
      web: { image: 'ghcr.io/x/web:1', build: { context: 'web' } },
      db: { image: 'postgres:18' },
    },
  };
  assert.deepEqual(builtImages(config), ['ghcr.io/x/api:1', 'ghcr.io/x/web:1']);
  assert.deepEqual(builtImages({ services: {} }), []);
});

test('missingImages names the images not on this machine, in order', () => {
  const present = new Set(['a:1']);
  assert.deepEqual(missingImages(['a:1', 'b:1', 'c:1'], (image) => present.has(image)), ['b:1', 'c:1']);
  assert.deepEqual(missingImages(['a:1'], (image) => present.has(image)), []);
});
