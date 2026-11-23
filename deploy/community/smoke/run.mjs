#!/usr/bin/env node
// CybeDefend Community Edition: the smoke test.
//
// Starts the compose stack under a throwaway project, waits until every
// container is healthy, then drives the API through the bundled front exactly
// as a browser would (setup, sign-in, refresh, project, SARIF imports,
// results, OWASP report, the dashboard's reads, invitation, password reset), and checks that no
// container restarted. Needs Docker Compose >= 2.24.4 and Node >= 22.
//
// The opt-in variant « cluster » (never part of « all ») also needs kind >= 0.27
// and kubectl: it runs one scan per scanner type on a kind cluster (cluster.mjs).
//
// Paths resolve from this file, so it runs from any directory.

import { spawnSync } from 'node:child_process';
import { randomBytes, randomInt } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  assessStack,
  buildEnvFile,
  builtImages,
  composeArgs,
  countSarifResults,
  dashboardReadRoutes,
  findUp,
  generatedReportState,
  importForm,
  isTokenAnswer,
  kubernetesLogLines,
  missingImages,
  owaspPlacement,
  parseEnv,
  parsePsOutput,
  parseSetCookie,
  s3ErrorCode,
  scaListHasPackages,
  serverErrorRoutes,
  unsignedRefusal,
  writeSecretKeyFile,
} from './lib.mjs';
import {
  CLUSTER_NAMESPACE,
  CONTAINER_IP_HOSTS,
  KindCluster,
  NO_SCAN_RUN_COMMIT,
  NO_SCAN_RUN_TAG,
  SCAN_ADAPTERS,
  buildScannerImages,
  clusterEnvOverrides,
  enabledInstanceIds,
  enabledLogCount,
  expectedFindings,
  fixtureEntries,
  hasImage,
  instanceId,
  instanceLabelVerdict,
  isDockerDesktop,
  managedSelector,
  kindVersionOk,
  leakedLines,
  missingClusterTools,
  onPath,
  pageListsFinding,
  projectToggles,
  queueVerdict,
  scanEndDispatchCounts,
  scannerImage,
  settledDispatchVerdict,
  logSnapshotVerdict,
  teardownPlan,
  withholdLeaks,
  zipStore,
} from './cluster.mjs';
import { writeFixtureRepo } from './cluster-fixture.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEPLOY_DIR = resolve(HERE, '..');
const VARIANTS = ['default', 'smtp', 'storage-late'];
/** Run only when named: not part of `all`. */
const OPT_IN_VARIANTS = ['cluster'];
export const JOBS = ['init-secrets', 'postgres-roles', 'storage-init', 'permify-schema'];
const SUBNETS = { default: '172.30.241.0/24', smtp: '172.30.242.0/24', 'storage-late': '172.30.243.0/24', cluster: '172.30.244.0/24' };
const CLUSTER_SCAN_TIMEOUT_MS = 15 * 60_000;
const CLUSTER_CLEANUP_TIMEOUT_MS = 150_000;
const SCAN_END_SETTLE_MS = 15_000;
const KUBECONFIG_PATH = join(DEPLOY_DIR, 'cluster', 'kubeconfig');
const IMPORT_TIMEOUT_MS = 180_000;
const ADMIN_EMAIL = 'admin@example.test';
const MEMBER_EMAIL = 'member@example.test';

const USAGE = `usage: node deploy/community/smoke/run.mjs [options]

  --variant <name>       default | smtp | storage-late | all | cluster (default: default;
                         all runs the first three; cluster needs kind >= 0.27 and kubectl)
  --build                build every image from source (docker-compose.build.yml); with
                         cluster, also the scanner images, from --scanners-repo
  --build-only           build every image from source, once, and run no variant
  --prebuilt             run on the images --build-only built on this machine: no build,
                         no pull; fails when one is missing (not with cluster)
  --scanners-repo <dir>  the cybedefend-scanners checkout (default: $CYBEDEFEND_SCANNERS_REPO)
  --keep                 leave the stack running at the end
  --project-name <name>  compose project name (default: cd-smoke; "-<variant>" is appended)
  --timeout-s <seconds>  how long the stack has to become healthy (default: 600)
  --help                 print this help

The cluster variant needs a host that can reach container IP addresses: Linux or OrbStack, not Docker Desktop
(the runner uploads the archive to the storage's address on the kind network, as the pods do).
It tags the scanner images with $CYBEDEFEND_SCANNER_IMAGE_TAG
(default: 0.0.0-smoke with --build, 1.0.0 without).

Exit 0: passed. Exit 1: a step failed. Exit 2: usage error, or a tool the variant needs is missing.`;

class UsageError extends Error {}
class StepError extends Error {
  constructor(message, service, { leak = false } = {}) {
    super(message);
    this.service = service;
    /** A leak: the failure handler prints no container log. */
    this.leak = leak;
  }
}

export function parseArgs(argv) {
  const options = {
    variant: 'default',
    build: false,
    buildOnly: false,
    prebuilt: false,
    keep: false,
    projectName: 'cd-smoke',
    timeoutS: 600,
    help: false,
    scannersRepo: process.env.CYBEDEFEND_SCANNERS_REPO || '',
  };
  const value = (i, flag) => {
    if (i >= argv.length || argv[i].startsWith('--')) throw new UsageError(`${flag} needs a value`);
    return argv[i];
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--build') options.build = true;
    else if (arg === '--build-only') options.buildOnly = true;
    else if (arg === '--prebuilt') options.prebuilt = true;
    else if (arg === '--keep') options.keep = true;
    else if (arg === '--variant') {
      options.variant = value(++i, arg);
      if (![...VARIANTS, 'all', ...OPT_IN_VARIANTS].includes(options.variant)) throw new UsageError(`unknown variant ${options.variant}`);
    } else if (arg === '--scanners-repo') {
      options.scannersRepo = value(++i, arg);
    } else if (arg === '--project-name') {
      options.projectName = value(++i, arg);
      if (!/^[a-z0-9][a-z0-9_-]*$/.test(options.projectName)) throw new UsageError('--project-name: lower-case letters, digits, - and _');
    } else if (arg === '--timeout-s') {
      options.timeoutS = Number(value(++i, arg));
      if (!Number.isInteger(options.timeoutS) || options.timeoutS < 1) throw new UsageError('--timeout-s needs a positive integer');
    } else throw new UsageError(`unknown option ${arg}`);
  }
  if ([options.build, options.buildOnly, options.prebuilt].filter(Boolean).length > 1) {
    throw new UsageError('--build, --build-only and --prebuilt exclude one another');
  }
  if (options.variant === 'cluster' && options.prebuilt) throw new UsageError('--prebuilt does not apply to the cluster variant');
  if (options.variant === 'cluster' && options.build && !options.help) {
    if (!options.scannersRepo) throw new UsageError('--build --variant cluster needs --scanners-repo <dir> (or CYBEDEFEND_SCANNERS_REPO)');
    if (!existsSync(join(options.scannersRepo, 'images'))) throw new UsageError(`--scanners-repo ${options.scannersRepo} has no images/ folder`);
  }
  options.scannerTag = process.env.CYBEDEFEND_SCANNER_IMAGE_TAG || (options.build ? '0.0.0-smoke' : '1.0.0');
  return options;
}

// ─── Processes ──────────────────────────────────────────────────────────────

function docker(args, { check = true, input } = {}) {
  const res = spawnSync('docker', args, { encoding: 'utf8', input, maxBuffer: 64 * 1024 * 1024 });
  if (res.error) throw new StepError(`docker could not be run: ${res.error.message}`);
  if (check && res.status !== 0) {
    throw new StepError(`docker ${args.slice(0, 8).join(' ')} … exited ${res.status}: ${(res.stderr || '').trim().slice(-2000)}`);
  }
  return res;
}

function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolvePort(port));
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── One stack ──────────────────────────────────────────────────────────────

class Stack {
  constructor({ variant, projectName, build }) {
    this.variant = variant;
    this.projectName = projectName;
    this.build = build;
    this.dir = mkdtempSync(join(tmpdir(), `cd-smoke-${variant}-`));
    this.envFile = join(this.dir, '.env');
    const variantsDir = findUp(DEPLOY_DIR, join('libs', 'test-fixtures', 'compose', 'variants'));
    this.variantFiles = variant === 'default' ? [] : [join(variantsDir, `${variant}.yml`)];
    this.profiles = [];
  }

  /**
   * `overrides` replace what the runner picks: the cluster variant sets the
   * public URLs to addresses on the kind network, while the runner itself
   * still calls the API through the host port (`hostUrl`).
   */
  async writeEnv(overrides = {}) {
    if (!this.ports) {
      const [http, storage, mailpit] = [await freePort(), await freePort(), await freePort()];
      this.ports = { http, storage, mailpit };
    }
    const { http, storage, mailpit } = this.ports;
    this.hostUrl = `http://localhost:${http}`;
    this.overrides = { ...(this.overrides ?? {}), ...overrides };
    this.publicUrl = this.overrides.CYBEDEFEND_PUBLIC_URL ?? this.hostUrl;
    this.storageUrl = this.overrides.CYBEDEFEND_STORAGE_PUBLIC_URL ?? `http://localhost:${storage}`;
    // The master key, a file of the stack's own directory (mode 600), never a .env value.
    this.secretKeyPath = writeSecretKeyFile(this.dir);
    const text = buildEnvFile(readFileSync(join(DEPLOY_DIR, '.env.example'), 'utf8'), {
      CYBEDEFEND_PUBLIC_URL: this.publicUrl,
      CYBEDEFEND_HTTP_PORT: String(http),
      CYBEDEFEND_STORAGE_PUBLIC_URL: this.storageUrl,
      CYBEDEFEND_STORAGE_PORT: String(storage),
      CYBEDEFEND_SUBNET: SUBNETS[this.variant],
      CYBEDEFEND_SECRET_KEY_PATH: this.secretKeyPath,
      MAILPIT_HTTP_PORT: String(mailpit),
      ...(this.env ? { CYBEDEFEND_SETUP_TOKEN: this.env.CYBEDEFEND_SETUP_TOKEN } : {}),
      ...this.overrides,
    });
    writeFileSync(this.envFile, text, { mode: 0o600 });
    this.env = parseEnv(text);
  }

  args(extra, { profiles = this.profiles } = {}) {
    return [
      ...composeArgs({
        deployDir: DEPLOY_DIR,
        projectName: this.projectName,
        build: this.build,
        variantFiles: this.variantFiles,
        envFile: this.envFile,
        profiles,
      }),
      ...extra,
    ];
  }

  compose(extra, options) {
    return docker(this.args(extra), options);
  }

  services() {
    return this.compose(['config', '--services']).stdout.split('\n').filter(Boolean);
  }

  /** Every service of the project, or only `only` (still judged against the restarts of each). */
  assess(only) {
    const services = only ?? this.services();
    const rows = parsePsOutput(this.compose(['ps', '--all', '--format', 'json']).stdout);
    const restarts = {};
    const ids = rows.map((r) => r.ID).filter(Boolean);
    if (ids.length > 0) {
      const out = docker(['inspect', '-f', '{{.Name}} {{.RestartCount}}', ...ids], { check: false }).stdout;
      for (const line of out.split('\n').filter(Boolean)) {
        const [name, count] = line.trim().split(/\s+/);
        restarts[name.replace(/^\//, '')] = Number(count);
      }
    }
    return assessStack({ services, jobs: JOBS.filter((j) => services.includes(j)), rows, restarts });
  }

  async waitHealthy(timeoutS) {
    const deadline = Date.now() + timeoutS * 1000;
    let verdict;
    for (;;) {
      verdict = this.assess();
      if (verdict.healthy) return;
      // A restart or a failed job never heals: stop waiting.
      if (/restarted|job exited/.test(verdict.reason)) break;
      if (Date.now() > deadline) break;
      await sleep(5000);
    }
    throw new StepError(`stack not healthy: ${verdict.service}: ${verdict.reason}`, verdict.service);
  }

  /** Every line every container of the project logged, from its start. */
  allLogs() {
    const res = this.compose(['logs', '--no-color', '--no-log-prefix'], { check: false });
    return `${res.stdout}${res.stderr}`;
  }

  /** Every line `service` logged (its current container), from its start. */
  serviceLogs(service) {
    const res = this.compose(['logs', '--no-color', '--no-log-prefix', service], { check: false });
    return `${res.stdout}${res.stderr}`;
  }

  logs(service) {
    const res = this.compose(['logs', '--no-color', '--tail', '200', ...(service ? [service] : [])], { check: false });
    return `${res.stdout}${res.stderr}`;
  }

  down() {
    this.compose(['down', '-v', '--remove-orphans'], { check: false });
    rmSync(this.dir, { recursive: true, force: true });
  }
}

// ─── HTTP ───────────────────────────────────────────────────────────────────

async function call(base, method, path, { json, form, token, cookie, headers = {} } = {}) {
  const init = { method, headers: { ...headers }, redirect: 'manual', signal: AbortSignal.timeout(60_000) };
  if (token) init.headers.authorization = `Bearer ${token}`;
  if (cookie) init.headers.cookie = cookie;
  if (json !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(json);
  } else if (form) {
    init.body = form;
  }
  const res = await fetch(`${base}${path}`, init);
  const text = await res.text();
  let body;
  try {
    body = text === '' ? undefined : JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body, headers: res.headers };
}

function expectStatus(res, expected, what) {
  const ok = Array.isArray(expected) ? expected.includes(res.status) : res.status === expected;
  if (!ok) {
    const code = res.body && typeof res.body === 'object' ? res.body.code : undefined;
    throw new StepError(`${what}: HTTP ${res.status}${code ? ` (${code})` : ''}, expected ${expected}`);
  }
}

function expect(condition, message) {
  if (!condition) throw new StepError(message);
}

const refreshCookie = (res) =>
  res.headers
    .getSetCookie()
    .map(parseSetCookie)
    .find((c) => c.name === 'cd_refresh');

// ─── Steps ──────────────────────────────────────────────────────────────────

export class Run {
  constructor(stack) {
    this.stack = stack;
    this.fixtures = findUp(DEPLOY_DIR, join('libs', 'test-fixtures', 'sarif'));
    this.password = randomBytes(12).toString('base64url');
    this.steps = [];
  }

  // Read at each call: the Run is built before Stack.writeEnv() picks the
  // public port.
  get api() {
    return `${this.stack.hostUrl ?? this.stack.publicUrl}/api`;
  }

  async step(name, fn) {
    try {
      const result = await fn();
      this.steps.push(`✔ ${name}`);
      console.log(`  ✔ ${name}`);
      return result;
    } catch (err) {
      this.steps.push(`✖ ${name}`);
      console.log(`  ✖ ${name}: ${err.message}`);
      throw err;
    }
  }

  req(method, path, options = {}) {
    return call(this.api, method, path, { token: this.token, ...options });
  }

  async setup() {
    await this.step('GET /auth/setup answers setupOpen', async () => {
      const res = await call(this.api, 'GET', '/auth/setup');
      expectStatus(res, 200, 'GET /auth/setup');
      expect(res.body.setupOpen === true, `setupOpen is ${res.body.setupOpen}`);
      expect(res.body.signupMode === 'invite_only', `signupMode is ${res.body.signupMode}`);
      expect(typeof res.body.passwordResetByEmail === 'boolean', 'passwordResetByEmail is not a boolean');
    });
    await this.step('POST /auth/setup creates the first administrator', async () => {
      const res = await call(this.api, 'POST', '/auth/setup', {
        json: {
          setupToken: this.stack.env.CYBEDEFEND_SETUP_TOKEN,
          email: ADMIN_EMAIL,
          name: 'Smoke Admin',
          password: this.password,
          organizationName: 'Smoke',
        },
      });
      expectStatus(res, 201, 'POST /auth/setup');
      const b = res.body;
      expect(isTokenAnswer(b), 'the token answer is incomplete');
      expect(b.organizationId && b.teamId, 'organizationId or teamId missing');
      this.organizationId = b.organizationId;
      this.teamId = b.teamId;
      const again = await call(this.api, 'GET', '/auth/setup');
      expectStatus(again, 200, 'GET /auth/setup');
      expect(again.body.setupOpen === false, 'setup is still open');
    });
    await this.step('POST /auth/login; the refresh cookie is scoped to /api/auth', async () => {
      const res = await call(this.api, 'POST', '/auth/login', { json: { email: ADMIN_EMAIL, password: this.password } });
      expectStatus(res, 200, 'POST /auth/login');
      expect(isTokenAnswer(res.body), 'the token answer is incomplete');
      const cookie = refreshCookie(res);
      expect(cookie, 'no cd_refresh cookie');
      expect(cookie.path === '/api/auth', `cookie Path is ${cookie.path}`);
      expect(cookie.httpOnly && cookie.secure && cookie.sameSite === 'Strict', 'cookie lacks HttpOnly, Secure or SameSite=Strict');
      expect(Number.isFinite(cookie.maxAge) && cookie.maxAge > 0, 'cookie has no Max-Age');
      this.token = res.body.accessToken;
      this.refresh = cookie.value;
    });
    await this.step('POST /auth/refresh from another origin is refused', async () => {
      const res = await call(this.api, 'POST', '/auth/refresh', {
        cookie: `cd_refresh=${this.refresh}`,
        headers: { origin: 'https://sibling.example.com' },
      });
      expectStatus(res, 403, 'POST /auth/refresh from another origin');
      expect(res.body.code === 'AUTH_ORIGIN_FORBIDDEN', `code is ${res.body.code}`);
      expect(!refreshCookie(res), 'a refused refresh set a cookie');
    });
    await this.step('POST /auth/refresh rotates the refresh cookie', async () => {
      // A browser always sends Origin on a POST; the gateway refuses a refresh without it (Community).
      const res = await call(this.api, 'POST', '/auth/refresh', {
        cookie: `cd_refresh=${this.refresh}`,
        headers: { origin: this.stack.publicUrl },
      });
      expectStatus(res, 200, 'POST /auth/refresh');
      expect(res.body.accessToken, 'no new accessToken');
      const cookie = refreshCookie(res);
      expect(cookie && cookie.value !== this.refresh, 'the refresh cookie did not rotate');
      this.token = res.body.accessToken;
    });
  }

  async loginLimit() {
    await this.step('the login limit ignores client-supplied address headers', async () => {
      const ip = () => `${randomInt(1, 224)}.${randomInt(0, 256)}.${randomInt(0, 256)}.${randomInt(1, 255)}`;
      for (let i = 1; i <= 11; i += 1) {
        const res = await call(this.api, 'POST', '/auth/login', {
          json: { email: 'ratelimit@example.test', password: 'wrong-password-123' },
          headers: { 'cf-connecting-ip': ip(), 'x-forwarded-for': `${ip()}, ${ip()}` },
        });
        if (i <= 10) {
          expectStatus(res, 401, `attempt ${i}`);
          expect(res.body.code === 'INVALID_CREDENTIALS', `attempt ${i}: code ${res.body.code}`);
        } else {
          expectStatus(res, 429, 'attempt 11');
          expect(res.body.code === 'RATE_LIMITED', `attempt 11: code ${res.body.code}`);
          expect(res.headers.get('retry-after'), 'attempt 11: no Retry-After');
        }
      }
    });
  }

  async project() {
    await this.step('GET /user/profile lists the setup organization and team', async () => {
      const res = await this.req('GET', '/user/profile');
      expectStatus(res, 200, 'GET /user/profile');
      const org = (res.body.myOrganizations ?? []).find((o) => o.id === this.organizationId);
      expect(org, 'the setup organization is not in myOrganizations');
      expect((org.myTeams ?? []).some((t) => t.id === this.teamId), 'the setup team is not in myTeams');
    });
    await this.step('POST /team/:teamId/project creates a project', async () => {
      const res = await this.req('POST', `/team/${this.teamId}/project`, { json: { name: 'smoke' } });
      expectStatus(res, [200, 201], 'POST /team/:teamId/project');
      expect(res.body.projectId, 'no projectId');
      this.projectId = res.body.projectId;
    });
  }

  fixture(name) {
    return readFileSync(join(this.fixtures, name), 'utf8');
  }

  startImport(fixture, type) {
    const form = importForm({ fileName: fixture, content: this.fixture(fixture), type, branch: 'main', format: 'sarif' });
    return this.req('POST', `/project/${this.projectId}/scan/import/start`, { form });
  }

  async waitScan(scanId, wanted) {
    const deadline = Date.now() + IMPORT_TIMEOUT_MS;
    let last;
    while (Date.now() < deadline) {
      const res = await this.req('GET', `/project/${this.projectId}/scan/${scanId}`);
      expectStatus(res, 200, 'GET scan');
      last = res.body;
      if (last.state === wanted) return last;
      if (last.state === 'completed' || last.state === 'failed') break;
      await sleep(2000);
    }
    throw new StepError(
      `scan ${scanId} is ${last?.state} (expected ${wanted}); errorMessage=${last?.errorMessage ?? ''} errorCode=${last?.errorCode ?? ''}`,
    );
  }

  async importAndWait(fixture, type) {
    const res = await this.startImport(fixture, type);
    expectStatus(res, 202, `import ${fixture}`);
    expect(res.body.scanId, 'no scanId');
    await this.waitScan(res.body.scanId, 'completed');
    return res.body.scanId;
  }

  async sastTotal() {
    const res = await this.req('GET', `/project/${this.projectId}/results/sast?branch=main`);
    expectStatus(res, 200, 'GET results/sast');
    return Number(res.body.total);
  }

  async sastImport() {
    await this.step('a SAST import completes and lists its findings', async () => {
      await this.importAndWait('minimal.sarif', 'sast');
      const total = await this.sastTotal();
      const max = countSarifResults(JSON.parse(this.fixture('minimal.sarif')));
      expect(total >= 1 && total <= max, `SAST total ${total}, expected 1..${max}`);
      this.sastCount = total;
    });
  }

  async scaImport() {
    await this.step('an SCA import lists its findings', async () => {
      await this.importAndWait('trivy-fs-sca.sarif', 'sca');
      const res = await this.req('GET', `/project/${this.projectId}/results/sca?branch=main`);
      expectStatus(res, 200, 'GET results/sca');
      const max = countSarifResults(JSON.parse(this.fixture('trivy-fs-sca.sarif')));
      const total = Number(res.body.total);
      expect(total >= 1 && total <= max, `SCA total ${total}, expected 1..${max}`);
      const packages = scaListHasPackages(res.body);
      expect(packages.ok, packages.reason);
      const sast = await this.sastTotal();
      expect(sast === this.sastCount, `the SCA import changed the SAST total: ${this.sastCount} → ${sast}`);
    });
  }

  async malformedImport() {
    await this.step('a malformed file fails with its code and leaves no object', async () => {
      const res = await this.startImport('malformed.sarif', 'sast');
      expectStatus(res, 202, 'import malformed.sarif');
      const scan = await this.waitScan(res.body.scanId, 'failed');
      expect(scan.errorMessage === 'IMPORT_INVALID_SARIF', `errorMessage ${scan.errorMessage}`);
      expect(Number(scan.errorCode) === 70, `errorCode ${scan.errorCode}`);
      // A signed S3 ListObjectsV2 of the project's import prefix, from the
      // storage image (curl), the secret on curl's standard input.
      const ls = this.stack.compose(
        [
          'run',
          '--rm',
          '--no-deps',
          '--entrypoint',
          'sh',
          'storage-init',
          '-c',
          `printf 'user = "cybedefend:%s"\\n' "$(cat /run/cybedefend-secrets/storage-secret-key)" | curl -fsS -K - --aws-sigv4 aws:amz:us-east-1:s3 'http://storage:9000/cybedefend?list-type=2&prefix=import/${this.projectId}/'`,
        ],
        { check: false },
      );
      expect(ls.status === 0, `listing the bucket failed: ${ls.stderr.trim().slice(-500)}`);
      expect(!ls.stdout.includes(`${res.body.scanId}.sarif`), 'the import object is still in the bucket');
    });
  }

  async owasp() {
    let report;
    await this.step('the OWASP report downloads from the host', async () => {
      const res = await this.req('GET', `/project/${this.projectId}/owasp-report/json?branch=main`);
      expectStatus(res, 200, 'GET owasp-report/json');
      // Generated asynchronously (analysis-reporting-worker-reports): the
      // answer carries a reportId, and the signed URL comes once it is ready.
      const reportId = res.body.reportId;
      expect(typeof reportId === 'string' && reportId !== '', 'no reportId');
      let url;
      const deadline = Date.now() + 120_000;
      for (;;) {
        const poll = await this.req('GET', `/project/${this.projectId}/reports/${reportId}`);
        expectStatus(poll, 200, 'GET reports/:reportId');
        const s = generatedReportState(poll.body);
        expect(s.state !== 'failed', `the report failed: ${s.error}`);
        if (s.state === 'ready') {
          url = s.url;
          break;
        }
        expect(Date.now() < deadline, 'the report is not ready after 120 s');
        await sleep(2000);
      }
      expect(typeof url === 'string' && url.startsWith(this.stack.storageUrl), `downloadUrl does not start with ${this.stack.storageUrl}`);
      const file = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      expect(file.status === 200, `download: HTTP ${file.status}`);
      report = JSON.parse(await file.text());
    });
    await this.step('the OWASP report places the imported findings in categories', async () => {
      const placement = owaspPlacement(report);
      expect(placement.size > 0, 'owaspCategories is empty');
      const sastOutsideA06 = [...placement].some(([id, types]) => !id.startsWith('A06') && types.has('sast'));
      expect(sastOutsideA06, 'no category other than A06 holds a sast finding');
      const a06 = [...placement].find(([id]) => id.startsWith('A06'));
      expect(a06 && a06[1].has('sca'), 'A06 holds no sca finding');
    });
  }

  /**
   * What a signed-in administrator opens once the project and the imports
   * exist: the organization's project list must hold the project, and none
   * of the dashboard's reads may answer a server error (a query PostgreSQL
   * refuses shows here).
   */
  async reads() {
    await this.step('GET /organization/:organizationId/projects lists the project', async () => {
      const res = await this.req('GET', `/organization/${this.organizationId}/projects?page=1&pageSize=10&search=`);
      expectStatus(res, 200, 'GET organization projects');
      const listed = (res.body?.projects ?? []).some((p) => (p.projectId ?? p.id) === this.projectId);
      expect(listed, `the project list does not hold the project (totalProjects ${res.body?.totalProjects})`);
    });
    await this.step("every read of the dashboard answers without a server error", async () => {
      const answers = [];
      for (const path of dashboardReadRoutes(this)) {
        try {
          const res = await this.req('GET', path);
          answers.push({ path, status: res.status });
        } catch (err) {
          answers.push({ path, status: 0, error: err.message });
        }
      }
      const failed = serverErrorRoutes(answers);
      expect(failed.length === 0, `${failed.length} of ${answers.length} reads failed: ${failed.join('; ')}`);
    });
  }

  async organization() {
    await this.step('GET /organization/:organizationId/integrations/overview answers 200', async () => {
      const res = await this.req('GET', `/organization/${this.organizationId}/integrations/overview`);
      expectStatus(res, 200, 'integrations overview');
    });
    await this.step('POST /organization/:organizationId/invite invites a member', async () => {
      const res = await this.req('POST', `/organization/${this.organizationId}/invite`, { json: { email: MEMBER_EMAIL, role: 'member' } });
      expect(res.status >= 200 && res.status < 300, `invite: HTTP ${res.status}`);
    });
  }

  /**
   * A signed S3 request to the bucket, from the storage image (curl, the
   * secret on curl's standard input), on storage-net. `path` and `data` hold
   * only [A-Za-z0-9/._=&?-].
   */
  signedS3(method, path, data) {
    const body = data === undefined ? '' : ` --data-binary '${data}'`;
    return this.stack.compose(
      [
        'run',
        '--rm',
        '--no-deps',
        '--entrypoint',
        'sh',
        'storage-init',
        '-c',
        `printf 'user = "cybedefend:%s"\\n' "$(cat /run/cybedefend-secrets/storage-secret-key)" | curl -fsS -K - --aws-sigv4 aws:amz:us-east-1:s3 -X ${method}${body} 'http://storage:9000/cybedefend${path}'`,
      ],
      { check: false },
    );
  }

  async storageRefusesUnsigned() {
    await this.step('the storage refuses every unsigned request, from the host and from storage-net', async () => {
      // A successful import's object is deleted on its terminal move,
      // so the step stores its own object, signed, to read back unsigned.
      const id = randomBytes(8).toString('hex');
      const prefix = `smoke-probe/${id}`;
      const content = `cd-smoke-probe-${randomBytes(12).toString('hex')}`;
      const put = this.signedS3('PUT', `/${prefix}/stored.txt`, content);
      expect(put.status === 0, `signed PUT failed: ${put.stderr.trim().slice(-500)}`);
      const back = this.signedS3('GET', `/${prefix}/stored.txt`);
      expect(back.status === 0 && back.stdout === content, 'the signed GET does not read the stored object back');

      const requests = [
        ['GET', '?list-type=2', undefined, 'bucket listing'],
        ['GET', `/${prefix}/stored.txt`, undefined, 'object GET'],
        ['PUT', `/${prefix}/unsigned-host.txt`, 'unsigned', 'object PUT'],
      ];
      const answers = [];
      for (const [method, path, data, what] of requests) {
        const res = await fetch(`${this.stack.storageUrl}/cybedefend${path}`, {
          method,
          body: data,
          signal: AbortSignal.timeout(30_000),
        });
        answers.push({ from: 'host', what, status: res.status, body: await res.text() });
      }

      // The same three from the gateway container, a storage-net member with
      // no credential, to the internal address.
      const script = `
        const [base, prefix] = process.argv.slice(1);
        const reqs = [
          ['GET', '?list-type=2', undefined, 'bucket listing'],
          ['GET', '/' + prefix + '/stored.txt', undefined, 'object GET'],
          ['PUT', '/' + prefix + '/unsigned-gateway.txt', 'unsigned', 'object PUT'],
        ];
        (async () => {
          const out = [];
          for (const [method, path, body, what] of reqs) {
            const res = await fetch(base + path, { method, body, signal: AbortSignal.timeout(30000) });
            out.push({ from: 'gateway', what, status: res.status, body: await res.text() });
          }
          process.stdout.write(JSON.stringify(out));
        })().catch((e) => { process.stderr.write(String(e)); process.exit(1); });`;
      const inside = this.stack.compose(
        ['exec', '-T', 'gateway', 'node', '-e', script, 'http://storage:9000/cybedefend', prefix],
        { check: false },
      );
      expect(inside.status === 0, `the gateway's requests failed: ${inside.stderr.trim().slice(-500)}`);
      answers.push(...JSON.parse(inside.stdout));

      for (const a of answers) {
        const verdict = unsignedRefusal(a, content);
        console.log(`    · unsigned ${a.what} from the ${a.from}: HTTP ${a.status} ${verdict.code ?? s3ErrorCode(a.body) ?? ''}`);
        expect(verdict.refused, `SECURITY: an unsigned ${a.what} from the ${a.from} was not refused (HTTP ${a.status})`);
      }

      // No unsigned PUT left an object: a signed listing of the probe prefix.
      const ls = this.signedS3('GET', `?list-type=2&prefix=${prefix}/`);
      expect(ls.status === 0, `listing the bucket failed: ${ls.stderr.trim().slice(-500)}`);
      expect(ls.stdout.includes(`${prefix}/stored.txt`), 'the signed listing does not show the stored object');
      expect(!ls.stdout.includes('unsigned-host.txt'), 'SECURITY: the unsigned PUT from the host left an object');
      expect(!ls.stdout.includes('unsigned-gateway.txt'), 'SECURITY: the unsigned PUT from the gateway left an object');
      this.signedS3('DELETE', `/${prefix}/stored.txt`);
    });
  }

  async resetCli() {
    await this.step('the reset CLI prints a reset link', async () => {
      const res = this.stack.compose(
        ['exec', '-T', '-w', '/app/global-management-service', 'global-management', 'node', 'dist/main.auth-reset-password', ADMIN_EMAIL],
        { check: false },
      );
      expect(res.status === 0, `exit ${res.status}`);
      const prefix = `${this.stack.publicUrl}/reset-password#token=`;
      expect(res.stdout.split('\n').some((line) => line.startsWith(prefix)), `no line starting with ${prefix}`);
    });
  }

  async mailpit() {
    await this.step('the invitation reaches the SMTP server', async () => {
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        try {
          const res = await fetch(`http://localhost:${this.stack.ports.mailpit}/api/v1/messages`, { signal: AbortSignal.timeout(5000) });
          const body = await res.json();
          const found = (body.messages ?? []).some((m) => (m.To ?? []).some((to) => to.Address === MEMBER_EMAIL));
          if (found) return;
        } catch {
          // not up yet
        }
        await sleep(2000);
      }
      throw new StepError(`no message to ${MEMBER_EMAIL} within 30 s`);
    });
  }

  /**
   * No cluster: the default stack is import-only, as before the
   * cluster engine existed. The capability route says so, and a ZIP scan and
   * a container scan are refused with the code the dashboard shows.
   */
  async importOnly() {
    await this.step('GET /instance/capabilities answers { clusterScans: false }', async () => {
      const res = await this.req('GET', '/instance/capabilities');
      expectStatus(res, 200, 'GET /instance/capabilities');
      const keys = res.body && typeof res.body === 'object' ? Object.keys(res.body) : [];
      expect(keys.length === 1 && res.body.clusterScans === false, `the answer is ${JSON.stringify(res.body)}, expected { clusterScans: false }`);
    });
    const refused = async (res, what) => {
      expectStatus(res, 409, what);
      expect(res.body?.code === 'SCANNERS_NOT_AVAILABLE', `${what}: code ${res.body?.code}, expected SCANNERS_NOT_AVAILABLE`);
    };
    await this.step('a ZIP scan is refused with SCANNERS_NOT_AVAILABLE', async () => {
      const res = await this.req('POST', `/project/${this.projectId}/scan/start`, { json: { branch: 'main' } });
      await refused(res, 'POST /project/:projectId/scan/start');
    });
    await this.step('a container scan is refused with SCANNERS_NOT_AVAILABLE', async () => {
      const res = await this.req('POST', `/project/${this.projectId}/scan/container/start`, { json: { imageToScan: 'alpine:3.20' } });
      await refused(res, 'POST /project/:projectId/scan/container/start');
    });
  }

  /** The external-integrations worker runs, and no container logged anything about a cluster. */
  async noClusterTrace() {
    await this.step('the external-integrations worker is up and never restarted', async () => {
      const verdict = this.stack.assess(['external-integrations-worker']);
      if (!verdict.healthy) throw new StepError(`${verdict.service}: ${verdict.reason}`, verdict.service);
    });
    await this.step('no container logged anything about a cluster', async () => {
      const lines = kubernetesLogLines(this.stack.allLogs());
      expect(lines.length === 0, `${lines.length} log line(s) about a cluster: ${withholdLeaks(lines.slice(0, 10).join('\n')).split('\n').join(' | ')}`);
    });
  }

  /**
   * Stops every container and starts the stack again on its volumes: what a
   * first start on empty volumes never meets (files a container wrote the
   * first time, a password it already set) shows up here.
   */
  async restartStack(timeoutS) {
    await this.step('the stack starts again on its own data (docker compose stop, then up -d)', async () => {
      this.stack.compose(['stop']);
      this.stack.compose(['up', '-d']);
      await this.stack.waitHealthy(timeoutS);
    });
  }

  async noRestart() {
    await this.step('no container restarted', async () => {
      const verdict = this.stack.assess();
      if (!verdict.healthy) throw new StepError(`${verdict.service}: ${verdict.reason}`, verdict.service);
    });
  }
}

// ─── The cluster variant ────────────────────────────────────────────────────

const TERMINAL = new Set(['completed', 'failed', 'completed_degraded', 'cancelled']);

/**
 * On a kind cluster: one project per scanner type, each scanned
 * through the dashboard's « Start scan » archive flow (POST
 * /project/:projectId/scan/start, then a PUT of the ZIP to the signed URL it
 * answers), at most 2 at once, every page listing its tool's finding, no pod
 * left, no credential in a log, and the code 84 of an image without
 * --scan-run.
 */
export class ClusterRun extends Run {
  constructor(stack, cluster, options) {
    super(stack);
    this.cluster = cluster;
    this.options = options;
    this.projects = {};
  }

  /** The project's files, generated under a temporary folder (cluster-fixture.mjs), zipped. */
  archive(kind) {
    const dir = mkdtempSync(join(tmpdir(), `cd-smoke-fixture-${kind}-`));
    try {
      writeFixtureRepo(dir, kind);
      return zipStore(fixtureEntries(dir));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  async capabilitiesEnabled() {
    const deadline = Date.now() + 120_000;
    let last;
    for (;;) {
      const logs = this.stack.serviceLogs('security-scanning');
      const count = enabledLogCount(logs, CLUSTER_NAMESPACE);
      const ids = enabledInstanceIds(logs, CLUSTER_NAMESPACE);
      const expectedId = instanceId(this.stack.publicUrl);
      const res = await this.req('GET', '/instance/capabilities');
      last = `log lines ${count}, capabilities HTTP ${res.status} ${JSON.stringify(res.body)}`;
      expect(count <= 1, `CLUSTER_SCANNING_ENABLED logged ${count} times`);
      if (count === 1) expect(ids[0] === expectedId, `the enable line names instance=${ids[0]}, expected instance=${expectedId}`);
      if (count === 1 && res.status === 200 && res.body?.clusterScans === true && Object.keys(res.body).length === 1) return;
      const disabled = /CLUSTER_SCANNING_DISABLED reason=\S+/.exec(logs);
      expect(Date.now() < deadline, `scanning is not on after 120 s: ${last}${disabled ? `; ${disabled[0]}` : ''}`);
      await sleep(3000);
    }
  }

  async createProjects() {
    for (const { project, toggle } of expectedFindings()) {
      const res = await this.req('POST', `/team/${this.teamId}/project`, { json: { name: `cluster-${project}` } });
      expectStatus(res, [200, 201], `POST /team/:teamId/project (${project})`);
      const projectId = res.body.projectId;
      const patch = await this.req('PATCH', `/project/${projectId}`, { json: projectToggles(toggle) });
      expectStatus(patch, 200, `PATCH /project/:projectId (${project})`);
      const p = patch.body?.projectInformations ?? {};
      expect(p[toggle] === true, `${project}: ${toggle} is not on after the PATCH`);
      this.projects[project] = projectId;
    }
  }

  /** The dashboard's archive start: the scan, then the ZIP to its signed URL. */
  async startArchiveScan(kind) {
    const projectId = this.projects[kind];
    const res = await this.req('POST', `/project/${projectId}/scan/start`, { json: { branch: 'main' } });
    expectStatus(res, [200, 201, 202], `POST /project/:projectId/scan/start (${kind})`);
    const { url, scanId } = res.body ?? {};
    expect(typeof url === 'string' && url.startsWith(this.stack.storageUrl), `${kind}: the upload URL is not on ${this.stack.storageUrl}`);
    expect(typeof scanId === 'string' && scanId !== '', `${kind}: no scanId`);
    const put = await fetch(url, {
      method: 'PUT',
      headers: { 'content-type': 'application/zip' },
      body: this.archive(kind),
      signal: AbortSignal.timeout(60_000),
    });
    expect(put.status === 200, `${kind}: the archive upload answered HTTP ${put.status}`);
    return { kind, projectId, scanId };
  }

  /** One read of the managed resources' labels while scans run; the names missing the instance label accumulate. */
  sampleInstanceLabels() {
    const v = instanceLabelVerdict(this.cluster.managedLabels(), instanceId(this.stack.publicUrl));
    this.labelSeen ??= { pods: 0, secrets: 0, missing: new Set() };
    this.labelSeen.pods += v.pods;
    this.labelSeen.secrets += v.secrets;
    for (const name of v.missing) this.labelSeen.missing.add(name);
  }

  async scanState({ projectId, scanId }) {
    const res = await this.req('GET', `/project/${projectId}/scan/${scanId}`);
    expectStatus(res, 200, 'GET /project/:projectId/scan/:scanId');
    return res.body;
  }

  async scans() {
    let scans;
    await this.step('five projects, one scanner type each', () => this.createProjects());
    await this.step('each project takes the fixture ZIP through the « Start scan » archive flow', async () => {
      scans = [];
      for (const { project } of expectedFindings()) scans.push(await this.startArchiveScan(project));
    });
    const samples = [];
    const left = new Map();
    const final = {};
    await this.step(`every scan completes within ${CLUSTER_SCAN_TIMEOUT_MS / 60_000} min of leaving the queue`, async () => {
      const hardDeadline = Date.now() + 6 * CLUSTER_SCAN_TIMEOUT_MS;
      while (Object.keys(final).length < scans.length) {
        const sample = {};
        for (const scan of scans) {
          if (final[scan.scanId]) {
            sample[scan.scanId] = final[scan.scanId].state;
            continue;
          }
          const body = await this.scanState(scan);
          sample[scan.scanId] = body.state;
          if (!['waiting_for_file', 'queued'].includes(body.state) && !left.has(scan.scanId)) left.set(scan.scanId, Date.now());
          if (TERMINAL.has(body.state)) final[scan.scanId] = body;
          else if (left.has(scan.scanId) && Date.now() - left.get(scan.scanId) > CLUSTER_SCAN_TIMEOUT_MS) {
            throw new StepError(`the ${scan.kind} scan is still ${body.state} ${CLUSTER_SCAN_TIMEOUT_MS / 60_000} min after it left the queue`);
          }
        }
        samples.push(sample);
        if (Object.values(sample).includes('running')) this.sampleInstanceLabels();
        expect(Date.now() < hardDeadline, 'the scans did not all end in time');
        if (Object.keys(final).length < scans.length) await sleep(3000);
      }
      const bad = scans.filter((s) => final[s.scanId].state !== 'completed');
      expect(
        bad.length === 0,
        bad.map((s) => `${s.kind}: ${final[s.scanId].state} errorCode=${final[s.scanId].errorCode ?? ''} errorMessage=${final[s.scanId].errorMessage ?? ''}`).join('; '),
      );
    });
    await this.step('every managed pod and Secret seen while the scans ran carries this instance label', async () => {
      const seen = this.labelSeen;
      expect(seen && seen.pods > 0 && seen.secrets > 0, `no managed pod and Secret were seen while the scans ran (pods ${seen?.pods ?? 0}, Secrets ${seen?.secrets ?? 0})`);
      expect(seen.missing.size === 0, `without cybedefend.io/instance=${instanceId(this.stack.publicUrl)}: ${[...seen.missing].join(', ')}`);
    });
    await this.step('analysis-reporting dispatched the end of each scan exactly once', async () => {
      const ids = scans.map((s) => s.scanId);
      const name = Object.fromEntries(scans.map((s) => [s.scanId, s.kind]));
      const deadline = Date.now() + 60_000;
      while (!ids.every((id) => scanEndDispatchCounts(this.stack.allLogs(), ids)[id] >= 1) && Date.now() < deadline) await sleep(3000);
      // A late duplicate shows only after the first: read again once it would have come.
      await sleep(SCAN_END_SETTLE_MS);
      const counts = scanEndDispatchCounts(this.stack.allLogs(), ids);
      const verdict = settledDispatchVerdict(Object.fromEntries(ids.map((id) => [name[id], counts[id]])));
      expect(verdict.ok, `scan-end dispatches per scan: ${verdict.wrong.join(', ')} (expected 1 each)`);
    });
    await this.step('at most 2 scans ran at once, and the others passed through queued', async () => {
      const verdict = queueVerdict(samples, 2);
      expect(verdict.ok, verdict.reason);
      console.log(`    · at most ${verdict.maxRunning} running; queued: ${verdict.queued.length} scan(s)`);
    });
    for (const { project, page, tool, marker } of expectedFindings()) {
      await this.step(`the ${page} page lists a ${tool} finding naming ${marker}`, async () => {
        const res = await this.req('GET', `/project/${this.projects[project]}/results/${page}?pageNumber=1&pageSizeNumber=50&branch=main`);
        expectStatus(res, 200, `GET results/${page}`);
        const verdict = pageListsFinding(res.body, marker);
        expect(verdict.ok, `${page}: ${verdict.reason}`);
      });
    }
  }

  async cleanup() {
    await this.step(`no pod or Secret of this instance is left in ${CLUSTER_NAMESPACE}`, async () => {
      // The watchdog ticks every minute: leave it two ticks and a half.
      const deadline = Date.now() + CLUSTER_CLEANUP_TIMEOUT_MS;
      let left;
      for (;;) {
        left = this.cluster.leftovers();
        if (left.length === 0) return;
        expect(
          Date.now() < deadline,
          `left after ${CLUSTER_CLEANUP_TIMEOUT_MS / 1000} s: ${left.join(', ')} (the README's cleanup: kubectl -n ${CLUSTER_NAMESPACE} delete pods,secrets -l ${managedSelector(instanceId(this.stack.publicUrl))})`,
        );
        await sleep(5000);
      }
    });
  }

  async importsAndRefusals() {
    this.projectId = this.projects.sast;
    await this.step('a SARIF import still passes', async () => {
      await this.importAndWait('minimal.sarif', 'sast');
    });
    await this.step('a container scan is refused SCANNERS_NOT_AVAILABLE', async () => {
      const res = await this.req('POST', `/project/${this.projectId}/scan/container/start`, { json: { imageToScan: 'alpine:3.20' } });
      expectStatus(res, 409, 'POST /project/:projectId/scan/container/start');
      expect(res.body?.code === 'SCANNERS_NOT_AVAILABLE', `code ${res.body?.code}, expected SCANNERS_NOT_AVAILABLE`);
    });
  }

  /** An image without --scan-run: its runner exits 4 and the scan fails with code 84. */
  async failurePath() {
    await this.step(`the image ${NO_SCAN_RUN_TAG} (no --scan-run) is in the cluster`, async () => {
      const image = scannerImage('gitleaks', NO_SCAN_RUN_TAG);
      if (this.options.build) {
        buildScannerImages({ repo: this.options.scannersRepo, tag: NO_SCAN_RUN_TAG, adapters: ['gitleaks'], commit: NO_SCAN_RUN_COMMIT });
      }
      expect(hasImage(image), `${image} is missing: run with --build (it is built from the scanners repository at ${NO_SCAN_RUN_COMMIT})`);
      this.cluster.loadImages([image]);
    });
    await this.step(`with CYBEDEFEND_SCANNER_IMAGE_TAG=${NO_SCAN_RUN_TAG}, scanning comes back on`, async () => {
      // Recreating the two services drops their logs from `compose logs`:
      // keep those of the five scans (kubeconfig load, pod launches, tokens)
      // for the leak check.
      this.logsBeforeRecreate = this.stack.allLogs();
      await this.stack.writeEnv({ CYBEDEFEND_SCANNER_IMAGE_TAG: NO_SCAN_RUN_TAG });
      this.stack.compose(['up', '-d', 'security-scanning', 'security-scanning-cron']);
      await this.stack.waitHealthy(this.options.timeoutS);
      await this.capabilitiesEnabled();
    });
    await this.step('a scan with that image fails with errorCode 84', async () => {
      const scan = await this.startArchiveScan('secret');
      const deadline = Date.now() + CLUSTER_SCAN_TIMEOUT_MS;
      let body;
      for (;;) {
        body = await this.scanState(scan);
        if (TERMINAL.has(body.state)) break;
        expect(Date.now() < deadline, `the scan is still ${body.state}`);
        await sleep(3000);
      }
      expect(body.state === 'failed' && Number(body.errorCode) === 84, `state ${body.state}, errorCode ${body.errorCode}`);
    });
  }

  async noLeak(kubeconfig) {
    const snapshots = [
      ['the logs of the five scans, taken before the services were recreated', this.logsBeforeRecreate],
      ['the final logs', this.stack.allLogs()],
    ];
    for (const [what, logs] of snapshots) {
      await this.step(`no container log line holds an upload token, a signed URL or a kubeconfig credential: ${what}`, async () => {
        const snapshot = logSnapshotVerdict(logs);
        expect(snapshot.ok, `${what}: ${snapshot.reason}`);
        const lines = leakedLines(logs, kubeconfig);
        // Never print the lines: they would print the secret.
        if (lines.length > 0) throw new StepError(`${lines.length} log line(s) hold a credential`, undefined, { leak: true });
      });
    }
  }
}

async function runCluster(options) {
  const variant = 'cluster';
  const projectName = `${options.projectName}-${variant}`;
  console.log(`\n▶ variant ${variant} (project ${projectName}, scanner tag ${options.scannerTag})`);
  const cluster = new KindCluster();
  const stack = new Stack({ variant, projectName, build: options.build });
  const run = new ClusterRun(stack, cluster, options);
  let kubeconfig = '';
  // What this run created: the teardown removes those and nothing else.
  const created = { stackStarted: false };
  let tornDown = false;
  const teardown = () => {
    if (tornDown) return;
    tornDown = true;
    const plan = teardownPlan({
      keep: options.keep,
      stackStarted: created.stackStarted,
      wroteKubeconfig: cluster.wroteKubeconfig,
      createdCluster: cluster.createdCluster,
      createdNetwork: cluster.createdNetwork,
    });
    for (const action of plan) {
      if (action === 'stack') stack.down();
      else if (action === 'kubeconfig') rmSync(KUBECONFIG_PATH, { force: true });
      else if (action === 'cluster') cluster.delete();
      else if (action === 'network') cluster.removeNetwork();
    }
    if (options.keep) {
      console.log(`  kept: ${stack.args([]).join(' ')}`);
      if (cluster.createdCluster) {
        console.log(`  kept: kind cluster ${cluster.name} (network ${cluster.network}), ${KUBECONFIG_PATH}, ${cluster.adminKubeconfig}`);
      }
    } else {
      if (!created.stackStarted) rmSync(stack.dir, { recursive: true, force: true });
      cluster.removeScratch();
    }
  };
  const onSignal = (signal, code) => () => {
    console.log(`\n${signal}: tearing down what this run created`);
    teardown();
    process.exit(code);
  };
  const handlers = [
    ['SIGINT', onSignal('SIGINT', 130)],
    ['SIGTERM', onSignal('SIGTERM', 143)],
  ];
  for (const [signal, handler] of handlers) process.once(signal, handler);
  try {
    await run.step('kind create cluster, on a labelled docker network of its own', async () => {
      expect(!existsSync(KUBECONFIG_PATH), `${KUBECONFIG_PATH} already exists: the smoke never overwrites a kubeconfig`);
      const existing = docker(['ps', '--all', '--quiet', '--filter', `label=com.docker.compose.project=${projectName}`]).stdout.trim();
      expect(existing === '', `the compose project ${projectName} already has containers (a previous run with --keep?): remove it first`);
      await cluster.create();
    });
    await run.step('the scanner images are in the cluster', async () => {
      const images = options.build
        ? buildScannerImages({ repo: options.scannersRepo, tag: options.scannerTag })
        : SCAN_ADAPTERS.map((a) => scannerImage(a, options.scannerTag)).filter(hasImage);
      cluster.loadImages(images);
      const pulled = SCAN_ADAPTERS.length - images.length;
      console.log(`    · loaded ${images.length} image(s)${pulled ? `; the nodes pull the ${pulled} others from the registry` : ''}`);
    });
    let credentials;
    await run.step(`the README's namespace, ServiceAccount, Role, RoleBinding and token, in ${CLUSTER_NAMESPACE}`, async () => {
      credentials = await cluster.applyScannerAccess();
    });
    await run.step('cluster/kubeconfig: the six verbs are allowed, list and get on secrets refused', async () => {
      kubeconfig = cluster.writeInstanceKubeconfig(KUBECONFIG_PATH, credentials);
      // The same credentials through the host's address of the API server.
      const hostServer = /server: (\S+)/.exec(readFileSync(cluster.adminKubeconfig, 'utf8'))[1];
      const hostCopy = join(cluster.dir, 'scanner-kubeconfig');
      writeFileSync(hostCopy, kubeconfig.replace(cluster.internalServer, hostServer), { mode: 0o600 });
      for (const [verb, resource] of [['create', 'pods'], ['get', 'pods'], ['list', 'pods'], ['delete', 'pods'], ['create', 'secrets'], ['delete', 'secrets']]) {
        expect(cluster.canI(hostCopy, verb, resource), `the ServiceAccount may not ${verb} ${resource}`);
      }
      for (const [verb, resource] of [['list', 'secrets'], ['get', 'secrets']]) {
        expect(!cluster.canI(hostCopy, verb, resource), `SECURITY: the ServiceAccount may ${verb} ${resource}`);
      }
    });
    await stack.writeEnv(clusterEnvOverrides({ subnet: cluster.subnet, network: cluster.network, tag: options.scannerTag }));
    await run.step('docker compose up -d', async () => {
      created.stackStarted = true;
      stack.compose(['up', '-d', ...(options.build ? ['--build'] : [])]);
    });
    await run.step('every container is healthy', () => stack.waitHealthy(options.timeoutS));
    await run.setup();
    await run.step(`security-scanning logs CLUSTER_SCANNING_ENABLED namespace=${CLUSTER_NAMESPACE} once, and /instance/capabilities answers { clusterScans: true }`, () =>
      run.capabilitiesEnabled(),
    );
    await run.scans();
    await run.cleanup();
    await run.importsAndRefusals();
    await run.failurePath();
    await run.cleanup();
    await run.noLeak(kubeconfig);
    await run.noRestart();
    console.log(`✔ variant ${variant} passed`);
    return true;
  } catch (err) {
    console.log(`✖ variant ${variant} failed: ${err.message}`);
    if (err instanceof StepError && err.leak) {
      console.log('--- no container log is printed: it would print the credential');
    } else if (created.stackStarted) {
      // Filtered all the same: a line the leak step has not read yet may hold one.
      const logs = withholdLeaks(stack.logs(err instanceof StepError ? err.service : 'security-scanning'), kubeconfig);
      console.log(`--- docker compose logs --tail 200 ${err.service ?? 'security-scanning'}\n${logs}`);
    }
    if (cluster.createdCluster) {
      try {
        console.log(`--- kubectl get pods -n ${CLUSTER_NAMESPACE}\n${cluster.kubectl(['get', 'pods', '-n', CLUSTER_NAMESPACE, '-o', 'wide'], { check: false }).stdout}`);
      } catch {
        // no cluster
      }
    }
    return false;
  } finally {
    console.log(run.steps.map((s) => `    ${s}`).join('\n'));
    teardown();
    // Removed after the teardown: a Ctrl-C during it must not cut it short.
    for (const [signal, handler] of handlers) process.off(signal, handler);
  }
}

async function runVariant(variant, options) {
  const projectName = `${options.projectName}-${variant}`;
  console.log(`\n▶ variant ${variant} (project ${projectName})`);
  // --prebuilt keeps the build file, so the services that share an image never pull it.
  const stack = new Stack({ variant, projectName, build: options.build || options.prebuilt });
  const run = new Run(stack);
  try {
    await stack.writeEnv();
    if (options.prebuilt) {
      await run.step('the images built from this tree are on this machine', async () => {
        const missing = missingImages(builtImages(JSON.parse(stack.compose(['config', '--format', 'json']).stdout)), hasImage);
        expect(missing.length === 0, `missing ${missing.join(', ')}: build them first with --build-only`);
      });
    }
    await run.step('docker compose up -d', async () => {
      stack.compose(['up', '-d', ...(options.build ? ['--build'] : [])]);
    });
    await run.step('every container is healthy', () => stack.waitHealthy(options.timeoutS));
    await run.setup();
    await run.loginLimit();
    await run.project();
    if (variant === 'storage-late') {
      await run.step('without storage, an import answers 503 IMPORT_STORAGE_UNAVAILABLE', async () => {
        const res = await run.startImport('minimal.sarif', 'sast');
        expectStatus(res, 503, 'import without storage');
        expect(res.body.code === 'IMPORT_STORAGE_UNAVAILABLE', `code ${res.body.code}`);
      });
      await run.step('the storage starts late', async () => {
        stack.profiles = ['late'];
        stack.compose(['up', '-d', 'storage', 'storage-server', 'storage-init']);
        await stack.waitHealthy(options.timeoutS);
      });
      await run.sastImport();
      await run.reads();
    } else {
      await run.sastImport();
      await run.scaImport();
      await run.malformedImport();
      await run.storageRefusesUnsigned();
      await run.owasp();
      await run.reads();
    }
    await run.importOnly();
    await run.organization();
    if (variant === 'smtp') await run.mailpit();
    await run.resetCli();
    await run.noClusterTrace();
    await run.restartStack(options.timeoutS);
    await run.reads();
    await run.noRestart();
    console.log(`✔ variant ${variant} passed`);
    return true;
  } catch (err) {
    console.log(`✖ variant ${variant} failed: ${err.message}`);
    const logs = stack.logs(err instanceof StepError ? err.service : undefined);
    console.log(`--- docker compose logs --tail 200 ${err.service ?? ''}\n${logs}`);
    return false;
  } finally {
    console.log(run.steps.map((s) => `    ${s}`).join('\n'));
    if (!options.keep) stack.down();
    else console.log(`  kept: ${stack.args([]).join(' ')}`);
  }
}

/** Builds every image of docker-compose.build.yml once, for later runs with --prebuilt. */
async function buildImages(options) {
  const stack = new Stack({ variant: 'default', projectName: `${options.projectName}-build`, build: true });
  try {
    await stack.writeEnv();
    // The build output streams as it comes: a long build is not silent.
    const res = spawnSync('docker', stack.args(['build']), { stdio: 'inherit' });
    if (res.error || res.status !== 0) {
      console.log(`\nG8 images: the build failed (${res.error ? res.error.message : `exit ${res.status}`})`);
      return 1;
    }
    const images = builtImages(JSON.parse(stack.compose(['config', '--format', 'json']).stdout));
    console.log(`\nG8 images built: ${images.join(' ')}`);
    return 0;
  } finally {
    rmSync(stack.dir, { recursive: true, force: true });
  }
}

async function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (err) {
    if (!(err instanceof UsageError)) throw err;
    console.error(`${err.message}\n\n${USAGE}`);
    return 2;
  }
  if (options.help) {
    console.log(USAGE);
    return 0;
  }
  const variants = options.buildOnly ? [] : options.variant === 'all' ? VARIANTS : [options.variant];
  if (process.env.SMOKE_DRY_RUN === '1') {
    console.log(
      `variant=${options.variant} build=${options.build} build-only=${options.buildOnly} prebuilt=${options.prebuilt} keep=${options.keep} project-name=${options.projectName} timeout-s=${options.timeoutS} variants=${variants.join(',')}`,
    );
    return 0;
  }
  if (options.buildOnly) return buildImages(options);
  if (options.variant === 'cluster') {
    const missing = missingClusterTools(onPath);
    if (missing.length > 0) {
      console.error(`the cluster variant needs kind (>= 0.27) and kubectl on PATH; missing: ${missing.join(', ')}\n${CONTAINER_IP_HOSTS}`);
      return 2;
    }
    const os = spawnSync('docker', ['info', '--format', '{{.OperatingSystem}}'], { encoding: 'utf8' }).stdout ?? '';
    if (isDockerDesktop(os)) {
      console.error(`${CONTAINER_IP_HOSTS} (docker info reports ${os.trim()})`);
      return 2;
    }
    const version = spawnSync('kind', ['version'], { encoding: 'utf8' }).stdout;
    if (!kindVersionOk(version)) {
      console.error(`the cluster variant needs kind (>= 0.27) and kubectl on PATH; found ${version.trim()}`);
      return 2;
    }
    const ok = await runCluster(options);
    console.log(`\nG8 summary: cluster ${ok ? 'passed' : 'FAILED'}`);
    return ok ? 0 : 1;
  }
  const results = [];
  for (const variant of variants) {
    results.push([variant, await runVariant(variant, options)]);
  }
  console.log(`\nG8 summary: ${results.map(([v, ok]) => `${v} ${ok ? 'passed' : 'FAILED'}`).join(', ')}`);
  return results.every(([, ok]) => ok) ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    },
  );
}
