// CybeDefend Community Edition: the pure helpers of the smoke runner.
// No dependency, no Docker: every function here is tested by tests/lib.test.mjs.

import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/** Reads KEY=VALUE lines; comments and blank lines are skipped. */
export function parseEnv(text) {
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

/** Values the runner generates when .env.example leaves them empty. */
const GENERATED = {
  CYBEDEFEND_SETUP_TOKEN: () => randomBytes(32).toString('base64url'),
};

/**
 * The master key file of a stack (<dir>/secret-key, mode 600): a fresh
 * 32-byte key the first time, kept afterwards. Returns its path.
 */
export function writeSecretKeyFile(dir) {
  const path = join(dir, 'secret-key');
  if (!existsSync(path)) writeFileSync(path, `${randomBytes(32).toString('base64')}\n`, { mode: 0o600, flag: 'wx' });
  return path;
}

/**
 * Builds a .env from .env.example: every line is kept, an empty required
 * value is generated, and `overrides` replace (or are appended after) the rest.
 */
export function buildEnvFile(exampleText, overrides = {}) {
  const pending = new Map(Object.entries(overrides));
  const lines = exampleText.split(/\r?\n/).map((line) => {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!m) return line;
    const [, name, value] = m;
    if (pending.has(name)) {
      const next = pending.get(name);
      pending.delete(name);
      return `${name}=${next}`;
    }
    if (value.trim() === '' && GENERATED[name]) return `${name}=${GENERATED[name]()}`;
    return line;
  });
  for (const [name, value] of pending) lines.push(`${name}=${value}`);
  return `${lines.join('\n').replace(/\n+$/, '')}\n`;
}

/** The arguments of `docker` for one compose project: base file first, then build, then variants. */
export function composeArgs({ deployDir, projectName, build = false, variantFiles = [], envFile, profiles = [] }) {
  const dir = resolve(deployDir);
  const args = ['compose', '--project-directory', dir, '-p', projectName];
  if (envFile) args.push('--env-file', envFile);
  args.push('-f', join(dir, 'docker-compose.yml'));
  if (build) args.push('-f', join(dir, 'docker-compose.build.yml'));
  for (const file of variantFiles) args.push('-f', file);
  for (const profile of profiles) args.push('--profile', profile);
  return args;
}

/** The images the build services of `docker compose config --format json` make, each once, sorted. */
export function builtImages(config) {
  const images = Object.values(config.services ?? {}).flatMap((svc) => (svc.build && svc.image ? [svc.image] : []));
  return [...new Set(images)].sort();
}

/** The images of `images` that `has(image)` says are not on this machine, in order. */
export function missingImages(images, has) {
  return images.filter((image) => !has(image));
}

/** Reads `docker compose ps --all --format json`: one JSON array, or one object per line. */
export function parsePsOutput(text) {
  const trimmed = text.trim();
  if (trimmed === '') return [];
  if (trimmed.startsWith('[')) return JSON.parse(trimmed);
  return trimmed
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

/**
 * services: every service the project should run; jobs: the one-shot ones;
 * rows: `docker compose ps --all` rows; restarts: container name → RestartCount.
 * Healthy only when every long-running service is running and healthy (or has
 * no healthcheck), every job exited 0, and no container restarted.
 */
export function assessStack({ services, jobs = [], rows, restarts = {} }) {
  for (const service of services) {
    const mine = rows.filter((r) => r.Service === service);
    if (mine.length === 0) return { healthy: false, service, reason: 'no container yet' };
    for (const r of mine) {
      const count = Number(restarts[r.Name] ?? 0);
      if (count > 0) return { healthy: false, service, reason: `${r.Name} restarted ${count} time(s)` };
      const state = String(r.State ?? '').toLowerCase();
      const health = String(r.Health ?? '').toLowerCase();
      if (jobs.includes(service)) {
        if (state !== 'exited') return { healthy: false, service, reason: `job is ${state || 'not started'}` };
        if (Number(r.ExitCode) !== 0) return { healthy: false, service, reason: `job exited ${r.ExitCode}` };
      } else {
        if (state !== 'running') return { healthy: false, service, reason: `${state || 'unknown'} (exit ${r.ExitCode})` };
        if (health !== '' && health !== 'healthy') return { healthy: false, service, reason: health };
      }
    }
  }
  return { healthy: true };
}

/** Parses one Set-Cookie header value. */
export function parseSetCookie(header) {
  const [pair, ...attrs] = header.split(';').map((s) => s.trim());
  const at = pair.indexOf('=');
  const cookie = {
    name: pair.slice(0, at),
    value: pair.slice(at + 1),
    path: undefined,
    maxAge: undefined,
    httpOnly: false,
    secure: false,
    sameSite: undefined,
  };
  for (const attr of attrs) {
    const [rawKey, ...rest] = attr.split('=');
    const key = rawKey.toLowerCase();
    const value = rest.join('=');
    if (key === 'path') cookie.path = value;
    else if (key === 'max-age') cookie.maxAge = Number(value);
    else if (key === 'httponly') cookie.httpOnly = true;
    else if (key === 'secure') cookie.secure = true;
    else if (key === 'samesite') cookie.sameSite = value;
  }
  if (cookie.sameSite === undefined) delete cookie.sameSite;
  if (cookie.maxAge === undefined) delete cookie.maxAge;
  if (cookie.path === undefined) delete cookie.path;
  return cookie;
}

const isSuppressed = (result) =>
  (result.suppressions ?? []).some((s) => s.status === undefined || s.status === 'accepted');

/** The number of SARIF results an import keeps: those without an accepted or status-less suppression. */
/**
 * A token answer of the auth routes: a Bearer access token and the seconds it
 * has left when the gateway answers (rounded), at most its 900 s lifetime.
 */
export function isTokenAnswer(body) {
  return Boolean(
    body &&
      typeof body.accessToken === 'string' &&
      body.accessToken !== '' &&
      body.tokenType === 'Bearer' &&
      Number.isInteger(body.expiresIn) &&
      body.expiresIn > 0 &&
      body.expiresIn <= 900,
  );
}

/**
 * The state of an asynchronously generated report, from the answer of
 * GET /project/:projectId/reports/:reportId: ready only with its signed URL.
 */
export function generatedReportState(body) {
  if (body && body.status === 'failed') return { state: 'failed', error: body.error ?? '' };
  if (body && body.status === 'ready' && typeof body.downloadUrl === 'string' && body.downloadUrl !== '') {
    return { state: 'ready', url: body.downloadUrl };
  }
  return { state: 'pending' };
}

/** The <Code> of an S3 XML error body, or undefined. */
export function s3ErrorCode(body) {
  if (typeof body !== 'string') return undefined;
  const m = /<Code>([^<]+)<\/Code>/.exec(body);
  return m ? m[1] : undefined;
}

/**
 * An unsigned S3 request is refused when it answers 401 or 403 and its body
 * carries none of the stored content. Anything else (200, or a 404 that
 * evaluated the key) means the request reached past authentication.
 */
export function unsignedRefusal({ status, body }, storedContent) {
  const text = typeof body === 'string' ? body : '';
  const refused = (status === 401 || status === 403) && !(storedContent && text.includes(storedContent));
  return { refused, code: s3ErrorCode(text) };
}

export function countSarifResults(sarif) {
  return (sarif.runs ?? []).reduce((n, run) => n + (run.results ?? []).filter((r) => !isSuppressed(r)).length, 0);
}

/** The import's multipart body: file first (the gateway accepts any order), then type, branch, format, image. */
export function importForm({ fileName, content, type, branch, format, image }) {
  const form = new FormData();
  form.append('file', new Blob([content], { type: 'application/json' }), fileName);
  form.append('type', type);
  form.append('branch', branch);
  form.append('format', format);
  if (image !== undefined) form.append('image', image);
  return form;
}

/** Whether an SCA results page lists findings that name their package and version. */
export function scaListHasPackages(body) {
  const rows = body?.vulnerabilities ?? [];
  if (!(Number(body?.total) >= 1) || rows.length === 0) return { ok: false, reason: `total is ${body?.total}, no finding listed` };
  for (const [i, row] of rows.entries()) {
    if (!row?.library?.packageName) return { ok: false, reason: `vulnerabilities[${i}].library.packageName is empty` };
    if (!row?.library?.packageVersion) return { ok: false, reason: `vulnerabilities[${i}].library.packageVersion is empty` };
  }
  return { ok: true };
}

/** OWASP report JSON → Map(category id → Set of finding types). */
export function owaspPlacement(report) {
  const placement = new Map();
  for (const category of report?.owaspCategories ?? []) {
    placement.set(category.categoryData.id, new Set((category.vulnerabilities ?? []).map((v) => v.type)));
  }
  return placement;
}

/**
 * Finds <relative> by walking up from `from`: the fixtures sit in libs/ at the
 * root of the tree, some levels above deploy/community.
 */
export function findUp(from, relative) {
  let dir = resolve(from);
  for (;;) {
    const candidate = join(dir, relative);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`${relative} not found above ${from}`);
    dir = parent;
  }
}

/**
 * The GET routes the Community dashboard reads for an organization, its team
 * and a project, with the query strings its services send (dashboard-service
 * src/server/services). The smoke reads every one after the imports and fails
 * on any 5xx: a route the stack serves wrongly on PostgreSQL shows there, not
 * in a user's browser.
 */
export function dashboardReadRoutes({ organizationId, teamId, projectId, branch = 'main' }) {
  for (const [name, value] of Object.entries({ organizationId, teamId, projectId })) {
    if (typeof value !== 'string' || value === '') throw new Error(`dashboardReadRoutes: ${name} is missing`);
  }
  const o = `/organization/${organizationId}`;
  const t = `/team/${teamId}`;
  const p = `/project/${projectId}`;
  const list = `pageNumber=1&pageSizeNumber=10&branch=${branch}`;
  return [
    '/user/profile',
    '/user/personal-access-tokens',
    '/me/async-tasks',
    o,
    `${o}/projects?page=1&pageSize=10&search=`,
    `${o}/teams`,
    `${o}/members?page=1&pageSize=10&search=`,
    `${o}/invitations`,
    `${o}/main-statistics`,
    `${o}/results/overview`,
    `${o}/results/overview/severity-distribution`,
    `${o}/results/overview/state-distribution`,
    `${o}/results/overview/vulnerabilities-over-time`,
    `${o}/integrations/overview`,
    `${o}/policies`,
    `${o}/compliance-overview`,
    `${o}/licenses/classifications`,
    `${o}/reports`,
    `${t}/projects`,
    `${t}/members`,
    `${t}/reports`,
    p,
    `${p}/branches`,
    `${p}/branches/list?page=1&pageSize=30&includeArchived=false`,
    `${p}/branches/archived`,
    `${p}/security-context`,
    `${p}/results/overview?branch=${branch}`,
    `${p}/results/top-vulnerabilities?limit=5`,
    ...['sast', 'iac', 'secret', 'cicd', 'sca', 'container'].flatMap((type) => [
      `${p}/results/${type}?${list}`,
      `${p}/results/${type}/grouped?${list}`,
    ]),
    `${p}/results/sca/packages?${list}`,
    `${p}/results/sca/licenses/summary?branch=${branch}`,
    `${p}/results/container/images?${list}`,
    `${p}/results/container/images/grouped?${list}`,
    `${p}/results/container/packages?${list}`,
    `${p}/results/ai-bom/components?${list}`,
    `${p}/sbom/metadata?branch=${branch}`,
    `${p}/reports`,
    `${p}/exploitability-stale-summary`,
    `/projects/${projectId}/violations`,
    `/projects/${projectId}/violation-stats`,
    `/projects/${projectId}/effective-policies`,
    `/projects/${projectId}/compliance-history`,
  ];
}

/** `answers`: [{ path, status, error? }], status 0 when no answer came. The routes that failed on the server. */
export function serverErrorRoutes(answers) {
  return answers
    .filter((a) => a.status === 0 || a.status >= 500)
    .map((a) => (a.status === 0 ? `${a.path} → no answer (${a.error ?? 'unknown'})` : `${a.path} → HTTP ${a.status}`));
}

/**
 * The log lines that show a Kubernetes cluster at work: the cluster engine's
 * markers (CLUSTER_SCANNING_…, CLUSTER_KUBECONFIG_…), a kubeconfig, an upload
 * token (cdst_…), or a request to the scanner results route. The
 * gateway maps that route in every edition, so a route mapping
 * (`Mapped {/scan-runs/:scanId/results, POST}`, `{/scan-runs}`) is not one: a
 * request names a scan id where the mapping has `:scanId`.
 */
const CLUSTER_LOG_MARKERS = [/CLUSTER_SCANNING_/, /CLUSTER_KUBECONFIG_/, /kubeconfig/i, /\bcdst_/, /\/scan-runs\/[^:\s{}]/];

export function kubernetesLogLines(logs) {
  return String(logs ?? '')
    .split(/\r?\n/)
    .filter((line) => CLUSTER_LOG_MARKERS.some((marker) => marker.test(line)));
}
