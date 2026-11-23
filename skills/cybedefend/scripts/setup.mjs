#!/usr/bin/env node
// The first run of /cybedefend: everything the check needs, set up by the
// agent, with nothing for the user to type or paste. Idempotent: a second run
// finds what is there and goes on.
//
//   node setup.mjs           Docker, the dashboard (CybeDefend AppSec Community
//                            Edition, on this machine), its first administrator,
//                            a personal access token, the project of this
//                            repository, the MCP server for the coding agent
//   node setup.mjs status    what is set up; changes nothing
//   node setup.mjs signin    opens the dashboard and copies the administrator's
//                            password to the clipboard (never printed)
//   node setup.mjs token     reads a personal access token on stdin, for a
//                            dashboard someone else set up
//
// Options: --from <a deploy/community folder to copy instead of cloning>
//          --port <n> --mcp-port <n> --storage-port <n> (default: the first free
//          ones from 8080, 3010, 9000), --project-name <name> (default: the
//          repository's folder), --agent claude-code|none (default: claude-code
//          when the claude command is there), --no-open
//
// Files, all under CYBEDEFEND_APPSEC_HOME (default ~/.cybedefend/appsec):
//   platform/          the dashboard's compose folder, its .env and master key
//   credentials.json   mode 600: the dashboard's address, the administrator's
//                      e-mail and password, the token. cybedefend.mjs reads it
//                      when CYBEDEFEND_TOKEN is not set.
//
// Output: steps on stderr, one JSON document without any secret on stdout.
// Exit: 0 ready, 3 Docker or the dashboard cannot be used, 5 the dashboard was
// set up by someone else and a token is needed (node setup.mjs token), 64 usage.

import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, closeSync, cpSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir, hostname } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { clipboardTools, launcher, openCommand, which } from './os.mjs';

export const HOME = process.env.CYBEDEFEND_APPSEC_HOME || join(homedir(), '.cybedefend', 'appsec');
export const CREDENTIALS = join(HOME, 'credentials.json');
// The repository's own layout, kept: the compose file mounts
// ../../charts/cybedefend/files/schema.perm (the permission schema).
const SOURCE = join(HOME, 'source');
const PLATFORM = join(SOURCE, 'deploy', 'community');
// Each install remembers its own Compose project in its .env, so two installs
// (or a dashboard started by hand) never take each other's containers.
const DEFAULT_COMPOSE_PROJECT = process.env.CYBEDEFEND_COMPOSE_PROJECT || 'cybedefend-appsec';
const composeProject = () => readEnv(join(PLATFORM, '.env')).COMPOSE_PROJECT_NAME || DEFAULT_COMPOSE_PROJECT;
const PLATFORM_REPO = process.env.CYBEDEFEND_PLATFORM_REPO || 'https://github.com/CybeDefend/cybedefend';
const READY_TIMEOUT_MS = Number(process.env.CYBEDEFEND_READY_TIMEOUT_MS ?? 20 * 60_000);
const MCP_NAME = 'cybedefend';

class Exit extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const say = (line) => process.stderr.write(`${line}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const secs = (t0) => `${Math.round((Date.now() - t0) / 1000)} s`;

let stepNo = 0;
const STEPS = 9;
async function step(title, fn) {
  stepNo += 1;
  const t0 = Date.now();
  say(`\n▸ [${stepNo}/${STEPS}] ${title}`);
  const result = await fn();
  say(`  ✓ ${typeof result?.said === 'string' ? result.said : 'done'} (${secs(t0)})`);
  return result;
}

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) positional.push(a);
    else if (a.startsWith('--no-')) flags[a.slice(5)] = false;
    else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) flags[a.slice(2)] = argv[++i];
    else flags[a.slice(2)] = true;
  }
  return { positional, flags };
}

// Through launcher(): on Windows a program npm installed (claude.cmd) only
// starts through cmd.exe, with its arguments quoted for it.
function run(cmd, args, opts = {}) {
  const [file, fargs, extra] = launcher(cmd, args);
  return execFileSync(file, fargs, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, ...opts, ...extra }).trim();
}

function has(cmd) {
  return which(cmd) !== null;
}

// ─── credentials.json ───────────────────────────────────────────────────────

/**
 * An e-mail address as it is shown in what the agent reads and repeats: its
 * first two letters, the first of its domain, the ending. A terminal is often
 * shared or recorded; the address is whole in the credentials file and in the
 * dashboard's own sign-in form.
 */
export function maskEmail(email) {
  if (!email) return null;
  const m = /^([^@\s]+)@([^@\s.]+)(?:\.[^@\s]+)*\.([a-z]{2,})$/i.exec(String(email));
  return m ? `${m[1].slice(0, 2)}***@${m[2].slice(0, 1)}***.${m[3]}` : '***';
}

export function readCredentials() {
  try {
    return JSON.parse(readFileSync(CREDENTIALS, 'utf8'));
  } catch {
    return {};
  }
}

function saveCredentials(patch) {
  mkdirSync(HOME, { recursive: true, mode: 0o700 });
  const next = { ...readCredentials(), ...patch, updatedAt: new Date().toISOString() };
  writeFileSync(CREDENTIALS, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  chmodSync(CREDENTIALS, 0o600);
  return next;
}

// ─── 1. Docker ──────────────────────────────────────────────────────────────

function checkDocker() {
  if (!has('docker')) throw new Exit(3, 'Docker is not installed. Install Docker Desktop (or OrbStack on a Mac), start it, then run /cybedefend again.');
  try {
    run('docker', ['info', '--format', '{{.ServerVersion}}'], { timeout: 20_000 });
  } catch {
    throw new Exit(3, 'Docker is installed but not running. Start Docker Desktop (or OrbStack), then run /cybedefend again.');
  }
  let compose;
  try {
    compose = run('docker', ['compose', 'version', '--short']);
  } catch {
    throw new Exit(3, 'Docker Compose v2 is missing (docker compose). Update Docker Desktop.');
  }
  const [maj, min] = compose.replace(/^v/, '').split('.').map(Number);
  if (maj < 2 || (maj === 2 && min < 24)) throw new Exit(3, `Docker Compose ${compose} is too old: the dashboard needs 2.24 or later. Update Docker Desktop.`);
  const mem = Number(run('docker', ['info', '--format', '{{.MemTotal}}']));
  const gb = mem / 1024 ** 3;
  if (gb < 4) say(`  ! Docker has ${gb.toFixed(1)} GB of memory: the dashboard needs about 4 GB. Raise it in Docker's settings if services fail to start.`);
  return { compose, memoryGb: Number(gb.toFixed(1)), said: `Docker running, Compose ${compose}, ${gb.toFixed(1)} GB for containers` };
}

// ─── 2. The AppSec scanners ─────────────────────────────────────────────────

const SCANNERS_REPO = process.env.CYBEDEFEND_SCANNERS_REPO || 'https://github.com/CybeDefend/cybedefend-scanners';

/** The open source scanners project: its images' sources and the CybeDefend Opengrep rules scan.mjs reads. */
function scannersRepo() {
  const dir = join(HOME, 'scanners');
  const rules = join(dir, 'rules', 'opengrep');
  if (!existsSync(rules)) {
    try {
      run('git', ['clone', '-c', 'core.autocrlf=false', '--depth', '1', SCANNERS_REPO, dir], { timeout: 120_000 });
    } catch {
      return { said: `! could not fetch ${SCANNERS_REPO}: Opengrep runs only from the CybeDefend image, the other scanners are not affected` };
    }
  } else {
    try {
      run('git', ['-C', dir, 'pull', '--ff-only', '-q'], { timeout: 30_000 });
    } catch {
      /* offline: the copy we have is fine */
    }
  }
  const n = readdirSync(rules).filter((f) => f.endsWith('.yaml')).length;
  return { said: `${SCANNERS_REPO.replace('https://github.com/', '')} in ${dir}, with its ${n} Opengrep rules` };
}

// ─── 3. The dashboard's files ───────────────────────────────────────────────

function platformFiles(from) {
  if (existsSync(join(PLATFORM, 'docker-compose.yml'))) return { said: `already in ${PLATFORM}` };
  mkdirSync(HOME, { recursive: true, mode: 0o700 });
  if (from) {
    // A checkout of the platform's repository (or its deploy/community folder).
    let root = resolve(from);
    if (!existsSync(join(root, 'deploy', 'community', 'docker-compose.yml')) && existsSync(join(root, 'docker-compose.yml'))) root = resolve(root, '..', '..');
    if (!existsSync(join(root, 'deploy', 'community', 'docker-compose.yml'))) throw new Exit(64, `--from: no deploy/community/docker-compose.yml under ${root}.`);
    // Never carry another instance's secrets over: this one gets its own.
    const skip = new Set(['.env', 'secret-key', '.env.bak']);
    cpSync(join(root, 'deploy', 'community'), PLATFORM, { recursive: true, filter: (p) => !skip.has(basename(p)) });
    cpSync(join(root, 'charts'), join(SOURCE, 'charts'), { recursive: true });
    return { said: `copied from ${root}` };
  }
  if (!has('git')) throw new Exit(3, 'git is needed to fetch the dashboard.');
  try {
    // The files as they are in the repository, LF line endings included: a
    // Windows git set to convert them would break the scripts the images run.
    run('git', ['clone', '-c', 'core.autocrlf=false', '--depth', '1', PLATFORM_REPO, SOURCE], { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    throw new Exit(3, `Could not clone ${PLATFORM_REPO}. Check the network, or pass --from <a checkout of it>.`);
  }
  return { said: `fetched from ${PLATFORM_REPO}` };
}

// ─── 4. Settings: ports, network, master key, setup token ───────────────────

function portFree(port) {
  return new Promise((ok) => {
    const s = createServer();
    s.once('error', () => ok(false));
    s.once('listening', () => s.close(() => ok(true)));
    s.listen(port, '127.0.0.1');
  });
}

async function firstFreePort(start, taken) {
  for (let p = start; p < start + 200; p += 10) if (!taken.has(p) && (await portFree(p))) return p;
  throw new Exit(3, `No free port found from ${start}.`);
}

function usedSubnets() {
  try {
    const ids = run('docker', ['network', 'ls', '-q']).split('\n').filter(Boolean);
    if (!ids.length) return new Set();
    return new Set(run('docker', ['network', 'inspect', ...ids, '--format', '{{range .IPAM.Config}}{{.Subnet}} {{end}}']).split(/\s+/).filter(Boolean));
  } catch {
    return new Set();
  }
}

function readEnv(file) {
  const env = {};
  if (!existsSync(file)) return env;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) env[m[1]] = m[2];
  }
  return env;
}

function writeEnv(file, values) {
  let text = existsSync(file) ? readFileSync(file, 'utf8') : readFileSync(join(PLATFORM, '.env.example'), 'utf8');
  for (const [k, v] of Object.entries(values)) {
    const re = new RegExp(`^#?\\s*${k}=.*$`, 'm');
    text = re.test(text) ? text.replace(re, `${k}=${v}`) : `${text.trimEnd()}\n${k}=${v}\n`;
  }
  writeFileSync(file, text, { mode: 0o600 });
  chmodSync(file, 0o600);
}

async function settings(flags) {
  const envFile = join(PLATFORM, '.env');
  const env = readEnv(envFile);
  if (env.CYBEDEFEND_SETUP_TOKEN && env.CYBEDEFEND_PUBLIC_URL) {
    if (!env.COMPOSE_PROJECT_NAME) writeEnv(envFile, { COMPOSE_PROJECT_NAME: DEFAULT_COMPOSE_PROJECT });
    return {
      url: env.CYBEDEFEND_PUBLIC_URL,
      mcpUrl: env.CYBEDEFEND_MCP_PUBLIC_URL || `http://localhost:${env.CYBEDEFEND_MCP_PORT || 3010}`,
      said: `kept: dashboard on ${env.CYBEDEFEND_PUBLIC_URL}`,
    };
  }
  const taken = new Set();
  const http = flags.port ? Number(flags.port) : await firstFreePort(8080, taken);
  taken.add(http);
  const mcp = flags['mcp-port'] ? Number(flags['mcp-port']) : await firstFreePort(3010, taken);
  taken.add(mcp);
  const storage = flags['storage-port'] ? Number(flags['storage-port']) : await firstFreePort(9000, taken);
  const used = usedSubnets();
  let subnet = '172.30.240.0/24';
  for (let n = 240; used.has(subnet) && n < 255; n += 1) subnet = `172.30.${n}.0/24`;
  if (used.has(subnet)) throw new Exit(3, 'No free Docker subnet in 172.30.240.0 to 172.30.254.0.');

  const keyFile = join(PLATFORM, 'secret-key');
  if (!existsSync(keyFile)) writeFileSync(keyFile, `${randomBytes(32).toString('base64')}\n`, { mode: 0o600 });
  chmodSync(keyFile, 0o600);

  const url = `http://localhost:${http}`;
  const mcpUrl = `http://localhost:${mcp}`;
  writeEnv(envFile, {
    COMPOSE_PROJECT_NAME: DEFAULT_COMPOSE_PROJECT,
    CYBEDEFEND_SECRET_KEY_PATH: './secret-key',
    CYBEDEFEND_SETUP_TOKEN: randomBytes(32).toString('hex'),
    CYBEDEFEND_PUBLIC_URL: url,
    CYBEDEFEND_HTTP_PORT: http,
    CYBEDEFEND_STORAGE_PUBLIC_URL: `http://localhost:${storage}`,
    CYBEDEFEND_STORAGE_PORT: storage,
    CYBEDEFEND_SUBNET: subnet,
    CYBEDEFEND_MCP_PUBLIC_URL: mcpUrl,
    CYBEDEFEND_MCP_PORT: mcp,
  });
  return { url, mcpUrl, said: `dashboard on ${url}, MCP on ${mcpUrl}, storage on ${storage}, network ${subnet}; master key and setup token written (mode 600), never printed` };
}

// ─── 5. Start, and wait until it answers ────────────────────────────────────

/**
 * What stopped Docker, in a sentence, with what to do about it: read in its
 * own last lines. Empty when the cause is not one this script knows, and
 * Docker's lines speak for themselves.
 */
export function whyDockerStopped(lines) {
  const text = String(lines ?? '');
  if (/address pools have been fully subnetted/i.test(text)) {
    return 'Docker has no address range left for a new network on this machine: the networks of other projects hold them all. Nothing of this setup is lost. Free a few, then run the same command again: `docker network prune` removes the networks no container uses, and `docker compose -p <project> down` removes those of a project you no longer run (`docker network ls` lists them).';
  }
  if (/no space left on device/i.test(text)) {
    return "Docker's disk is full. `docker system df` shows what holds it; free some space (old images and build cache first), then run the same command again: Docker keeps what it already fetched.";
  }
  return '';
}

/**
 * Runs a long step of the setup (Docker fetching, building or starting the
 * dashboard) without its output. Docker prints a line per layer and per
 * second, hundreds of them on a first run: an agent that reads this script's
 * output would lose under them the lines the user needs, the scan tool by
 * tool first. Everything the command prints goes to `log`; this script says
 * one line of its own every `every` ms. When the command stops, the error
 * quotes what it last printed and names the log.
 */
export function runQuiet(cmd, args, { cwd, log, what, every = 30_000, sayLine = say } = {}) {
  mkdirSync(dirname(log), { recursive: true });
  // The log holds every step of the setup: what is quoted when this one stops is what this one printed.
  let from = 0;
  try {
    from = statSync(log).size;
  } catch {
    /* a new log */
  }
  const fd = openSync(log, 'a');
  const t0 = Date.now();
  return new Promise((ok, fail) => {
    const p = spawn(cmd, args, { cwd, stdio: ['ignore', fd, fd], windowsHide: true });
    const timer = setInterval(() => sayLine(`  … ${what} (${secs(t0)})`), every);
    let ended = false;
    const done = (how) => {
      if (ended) return;
      ended = true;
      clearInterval(timer);
      closeSync(fd);
      if (how === 0) return ok();
      let last = '';
      try {
        last = readFileSync(log).subarray(from).toString('utf8').replace(/\u001b\[[0-9;]*[A-Za-z]/g, '').split('\n').map((l) => l.trimEnd()).filter(Boolean).slice(-12).join('\n    ');
      } catch {
        /* no log to quote */
      }
      const why = whyDockerStopped(last);
      return fail(new Exit(3, `${what} did not finish (${typeof how === 'number' ? `exit ${how}` : how}).${why ? ` ${why}` : ''}${last ? ` Docker's last lines:\n    ${last}` : ''}\n  Everything it printed: ${log}`));
    };
    p.on('error', (err) => done(err.message));
    p.on('exit', (code) => done(code ?? 'stopped by a signal'));
  });
}

const DOCKER_LOG = join(HOME, 'logs', 'docker-compose.log');

function compose(args, { quiet = null } = {}) {
  const full = ['compose', '-p', composeProject(), '--profile', 'mcp', ...args];
  if (!quiet) return run('docker', full, { cwd: PLATFORM, maxBuffer: 64 * 1024 * 1024 });
  return runQuiet('docker', full, { cwd: PLATFORM, log: DOCKER_LOG, what: quiet });
}

function health() {
  try {
    const lines = compose(['ps', '--all', '--format', 'json']).split('\n').filter(Boolean);
    const rows = lines.flatMap((l) => {
      const v = JSON.parse(l);
      return Array.isArray(v) ? v : [v];
    });
    const services = rows.filter((r) => !(r.State === 'exited' && /Exited \(0\)/.test(r.Status ?? '')));
    const ready = services.filter((r) => r.State === 'running' && (!r.Health || r.Health === 'healthy'));
    const failed = rows.filter((r) => r.State === 'exited' && !/Exited \(0\)/.test(r.Status ?? ''));
    return { ready: ready.length, total: services.length, failed: failed.map((r) => r.Service) };
  } catch {
    return { ready: 0, total: 0, failed: [] };
  }
}

async function answers(url) {
  try {
    const res = await fetch(`${url}/api/auth/setup`, { signal: AbortSignal.timeout(5_000) });
    return res.status === 200 ? await res.json() : null;
  } catch {
    return null;
  }
}

// The published images first. When one cannot be had (a release not
// published yet, a registry that refuses), every CybeDefend image is built
// from the fetched source with docker-compose.build.yml, and the .env keeps
// that choice (COMPOSE_FILE), so later runs start the same images.
async function imagesOrBuild() {
  const envFile = join(PLATFORM, '.env');
  if (readEnv(envFile).COMPOSE_FILE) return null;
  let images;
  try {
    images = [...new Set(compose(['config', '--images']).split('\n').filter((i) => i.startsWith('ghcr.io/cybedefend/')))];
  } catch {
    return null;
  }
  const absent = images.filter((i) => {
    try {
      run('docker', ['image', 'inspect', i]);
      return false;
    } catch {
      return true;
    }
  });
  if (!absent.length) return null;
  try {
    run('docker', ['manifest', 'inspect', absent[0]], { timeout: 60_000 });
    return null;
  } catch {
    /* not published, or not readable from here */
  }
  if (!existsSync(join(PLATFORM, 'docker-compose.build.yml')) || !existsSync(join(SOURCE, 'apps'))) {
    throw new Exit(3, `The dashboard's images cannot be pulled (${absent[0]}) and there is no source to build them from in ${SOURCE}.`);
  }
  say(`  ! ${absent[0]} cannot be pulled: building the dashboard's images from the source instead (15 to 30 minutes, the first time only). Docker's own output: ${DOCKER_LOG}`);
  // ":" between the files on every system: Docker Compose on Windows expects ";" unless told.
  writeEnv(envFile, { COMPOSE_PATH_SEPARATOR: ':', COMPOSE_FILE: 'docker-compose.yml:docker-compose.build.yml' });
  await compose(['build'], { quiet: "building the dashboard's images from the source" });
  return 'built from the source';
}

async function start(url) {
  // Something answering at the address is not enough: it must be this
  // install's own containers (another dashboard may hold the port).
  const mine = health();
  const running = mine.total > 0 && mine.failed.length === 0 && mine.ready >= mine.total;
  if (!running || !(await answers(url))) {
    await imagesOrBuild();
    // The first run downloads the images, about 6 GB: said once here, then a line every half minute.
    say(`  … Docker fetches the dashboard's images when they are not on this machine yet, then starts its services. Its own output: ${DOCKER_LOG}`);
    await compose(['up', '-d'], { quiet: "fetching and starting the dashboard's services" });
    const t0 = Date.now();
    let lastLine = '';
    for (;;) {
      const s = await answers(url);
      if (s) break;
      const h = health();
      if (h.failed.length) throw new Exit(3, `These services stopped: ${h.failed.join(', ')}. Their logs: docker compose -p ${composeProject()} logs <service>, in ${PLATFORM}.`);
      const line = `  … ${h.ready}/${h.total} services ready (${secs(t0)})`;
      if (line !== lastLine) say(line);
      lastLine = line;
      if (Date.now() - t0 > READY_TIMEOUT_MS) throw new Exit(3, `The dashboard does not answer at ${url} after ${Math.round(READY_TIMEOUT_MS / 60000)} min.`);
      await sleep(5_000);
    }
  }
  const h = health();
  return { said: `dashboard answers at ${url} (${h.ready}/${h.total} services ready)` };
}

// ─── 6. The first administrator ─────────────────────────────────────────────

async function api(url, method, path, { json, bearer, origin } = {}) {
  const headers = { accept: 'application/json' };
  if (json !== undefined) headers['content-type'] = 'application/json';
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  if (origin) headers.origin = new URL(url).origin;
  let res;
  try {
    res = await fetch(`${url}/api${path}`, { method, headers, body: json === undefined ? undefined : JSON.stringify(json), signal: AbortSignal.timeout(60_000) });
  } catch {
    throw new Exit(3, `The dashboard does not answer at ${url}.`);
  }
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = undefined;
  }
  return { status: res.status, data };
}

const codeOf = (r) => r.data?.code ?? r.data?.error ?? `HTTP ${r.status}`;

function gitConfig(key) {
  try {
    return run('git', ['config', '--get', key]);
  } catch {
    return '';
  }
}

async function administrator(url) {
  const status = await answers(url);
  const creds = readCredentials();
  if (status?.setupOpen) {
    const env = readEnv(join(PLATFORM, '.env'));
    if (!env.CYBEDEFEND_SETUP_TOKEN) throw new Exit(5, `The dashboard at ${url} waits for its setup, but its setup token is not in ${PLATFORM}/.env: open ${url} and set it up there.`);
    const gitEmail = gitConfig('user.email');
    const email = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(gitEmail) ? gitEmail : 'admin@cybedefend.local';
    const name = (gitConfig('user.name') || 'Administrator').slice(0, 100);
    // 24 random bytes: 32 characters, over the 12-character policy.
    const password = randomBytes(24).toString('base64url');
    const r = await api(url, 'POST', '/auth/setup', {
      json: { setupToken: env.CYBEDEFEND_SETUP_TOKEN, email, name, password, organizationName: `${name.split(' ')[0]}'s team`.slice(0, 100) },
      origin: true,
    });
    if (r.status !== 201 && r.status !== 200) throw new Exit(3, `The setup was refused: ${codeOf(r)}.`);
    saveCredentials({ url, email, password, organizationId: r.data?.organizationId, teamId: r.data?.teamId });
    return { session: r.data?.accessToken, said: `administrator ${maskEmail(email)} created, with organization and team; password saved in ${CREDENTIALS} (mode 600)` };
  }
  // The saved token still works: nothing to sign in for. Signing in on every
  // run would also meet the dashboard's limit on sign-ins when /cybedefend
  // runs in several repositories in a row (RATE_LIMITED).
  if (creds.url === url && (await tokenWorks(url, creds.token))) return { session: null, said: 'the saved token is accepted: no sign-in needed' };
  if (creds.url === url && creds.email && creds.password) {
    const r = await api(url, 'POST', '/auth/login', { json: { email: creds.email, password: creds.password }, origin: true });
    if (codeOf(r) === 'RATE_LIMITED' || r.status === 429) throw new Exit(3, `The dashboard limits sign-ins and refused this one (too many in a short time). Wait a minute, then run /cybedefend again.`);
    if (r.status !== 200 || !r.data?.accessToken) throw new Exit(3, `Signing in as ${maskEmail(creds.email)} was refused: ${codeOf(r)}. If the password was changed in the dashboard, create a token there and run: node setup.mjs token`);
    return { session: r.data.accessToken, said: `signed in as ${maskEmail(creds.email)}` };
  }
  if (creds.url === url && creds.token) return { session: null, said: 'a token is already saved for this dashboard' };
  throw new Exit(5, `The dashboard at ${url} was set up by someone else. Sign in, create a personal access token in your profile, then run in your own terminal: node ${fileURLToPath(import.meta.url)} token`);
}

// ─── 7. The token ───────────────────────────────────────────────────────────

async function tokenWorks(url, token) {
  if (!token) return false;
  const r = await api(url, 'GET', '/user/profile', { bearer: token });
  return r.status === 200;
}

async function token(url, session) {
  const creds = readCredentials();
  if (creds.url === url && (await tokenWorks(url, creds.token))) return { token: creds.token, said: `token …${creds.token.slice(-4)} still accepted` };
  if (!session) throw new Exit(5, 'The saved token is refused and there is no administrator password to make a new one: create a token in the dashboard and run node setup.mjs token.');
  const r = await api(url, 'POST', '/me/personal-access-tokens', { json: { name: `cybedefend skill, ${hostname()}`.slice(0, 100) }, bearer: session, origin: true });
  if (r.status !== 201 && r.status !== 200) throw new Exit(3, `The token was not created: ${codeOf(r)}.`);
  const value = r.data?.token;
  if (typeof value !== 'string' || !value.startsWith('cdp_')) throw new Exit(3, 'The dashboard answered without a token.');
  saveCredentials({ url, token: value });
  return { token: value, said: `personal access token …${value.slice(-4)} created and saved (mode 600)` };
}

// ─── 8. The project of this repository ──────────────────────────────────────

const list = (d, ...keys) => {
  if (Array.isArray(d)) return d;
  for (const k of keys) if (Array.isArray(d?.[k])) return d[k];
  return [];
};

async function project(url, tok, wanted) {
  let root;
  try {
    root = resolve(run('git', ['rev-parse', '--show-toplevel']));
  } catch {
    return { projectId: null, said: 'not in a git repository: no project created' };
  }
  // .cybedefend/config.json is shared. The MCP server reads "projectId" at
  // its top (its own instructions say so), and another CybeDefend tool may keep
  // its own project there. This dashboard's project goes under "appsec", with
  // the dashboard's address, and at the top when the top is free.
  const configFile = join(root, '.cybedefend', 'config.json');
  let config = {};
  try {
    config = JSON.parse(readFileSync(configFile, 'utf8'));
  } catch {
    /* none yet */
  }
  const existing = config.appsec?.url === url ? config.appsec.projectId : undefined;
  if (existing) {
    const r = await api(url, 'GET', `/project/${existing}`, { bearer: tok });
    if (r.status === 200) return { root, projectId: existing, said: `project ${existing} (from .cybedefend/config.json)${writeProjectConfig(root, configFile, config, url, existing)}` };
    say(`  ! .cybedefend/config.json names project ${existing}, which this dashboard no longer has: finding or creating it again.`);
  }
  const name = (wanted || basename(root)).slice(0, 100);
  const creds = readCredentials();
  const orgs = list((await api(url, 'GET', '/organizations', { bearer: tok })).data, 'organizations', 'items', 'data');
  const org = orgs.find((o) => (o.id ?? o.organizationId) === creds.organizationId) ?? orgs[0];
  const orgId = org?.id ?? org?.organizationId;
  if (!orgId) throw new Exit(3, 'The token sees no organization on this dashboard.');
  const teams = list((await api(url, 'GET', `/organization/${orgId}/teams`, { bearer: tok })).data, 'teams', 'items', 'data');
  const team = teams.find((t) => t.id === creds.teamId) ?? teams[0];
  if (!team?.id) throw new Exit(3, 'The organization has no team to put the project in.');

  const found = list((await api(url, 'GET', `/mcp/organization/${orgId}/projects?search=${encodeURIComponent(name)}`, { bearer: tok })).data, 'projects', 'items', 'data');
  const same = found.find((p) => (p.name ?? '').toLowerCase() === name.toLowerCase());
  let projectId = same?.projectId ?? same?.id;
  let said = `project "${name}" found in team ${team.name ?? team.id}`;
  if (!projectId) {
    const r = await api(url, 'POST', `/team/${team.id}/project`, {
      bearer: tok,
      json: { name },
    });
    projectId = r.data?.projectId ?? r.data?.id;
    if (!projectId) throw new Exit(3, `The project was not created: ${codeOf(r)}.`);
    said = `project "${name}" created in team ${team.name ?? team.id}`;
  }
  return { root, projectId, said: `${said}; .cybedefend/config.json written (its other keys kept)${writeProjectConfig(root, configFile, config, url, projectId)}` };
}

function writeProjectConfig(root, configFile, config, url, projectId) {
  const next = { ...config, projectId: config.projectId || projectId, appsec: { url, projectId } };
  if (JSON.stringify(next) !== JSON.stringify(config)) {
    mkdirSync(join(root, '.cybedefend'), { recursive: true });
    writeFileSync(configFile, `${JSON.stringify(next, null, 2)}\n`);
  }
  return next.projectId === projectId ? '' : `. Its "projectId" names another project (${next.projectId}, written by another CybeDefend tool): kept, and the MCP server reads that one first`;
}

// ─── 9. A default policy, so the first verdict means something ──────────────

// Without any policy nothing blocks, and a first check on an app full of
// holes would say SHIP. This one is a starting point the team edits or turns
// off in the dashboard (Policies); it is created only when there is none.
// A secret blocks whatever its severity: the dashboard rates a key in the
// code as medium, and a live key in a repository is never fine to ship.
const DEFAULT_POLICY = `name: CybeDefend pre-deploy check
description: Created by /cybedefend at setup so the first check has a rule. Blocks critical and high findings and any secret in the code, warns on medium ones. Edit it or turn it off in Policies.
scope: ORGANIZATION
rules:
  - name: Block critical and high findings
    type: severity
    operator: in
    value: [CRITICAL, HIGH]
    action: BLOCK
  - name: Block secrets in the code
    type: scanner_type
    operator: equals
    value: SECRET
    action: BLOCK
  - name: Warn on medium findings
    type: severity
    operator: equals
    value: MEDIUM
    action: WARN
`;

async function defaultPolicy(url, tok) {
  let orgId = readCredentials().organizationId;
  if (!orgId) {
    const orgs = list((await api(url, 'GET', '/organizations', { bearer: tok })).data, 'organizations', 'items', 'data');
    orgId = orgs[0]?.id ?? orgs[0]?.organizationId;
  }
  if (!orgId) return { said: '! no organization: no default policy' };
  const current = await api(url, 'GET', `/organization/${orgId}/policies`, { bearer: tok });
  if (current.status !== 200) return { said: `! the policies could not be read (${codeOf(current)}): none created` };
  const policies = list(current.data, 'policies', 'items', 'data');
  if (policies.length) return { said: `${policies.length} polic${policies.length > 1 ? 'ies' : 'y'} already set by the team: kept as they are` };
  const check = await api(url, 'POST', `/organization/${orgId}/policies/validate`, { bearer: tok, json: { yamlContent: DEFAULT_POLICY } });
  if (check.status >= 300 || check.data?.valid === false) return { said: `! the default policy was refused (${codeOf(check)}${check.data?.errors ? `: ${JSON.stringify(check.data.errors).slice(0, 200)}` : ''})` };
  const made = await api(url, 'POST', `/organization/${orgId}/policies`, { bearer: tok, json: { yamlContent: DEFAULT_POLICY } });
  if (made.status !== 201 && made.status !== 200) return { said: `! the default policy was not created (${codeOf(made)})` };
  return { said: '"CybeDefend pre-deploy check" created: blocks critical and high findings and any secret in the code, warns on medium (edit it in Policies)' };
}

// ─── The MCP server, for the coding agent ───────────────────────────────────

function mcp(agent, mcpUrl, tok, root) {
  if (agent === 'none') return { added: false, said: 'no agent wired (--agent none)' };
  if (!has('claude')) return { added: false, said: `add the MCP server ${mcpUrl}/mcp to your agent, with the header Authorization: Bearer <the token in ${CREDENTIALS}>` };
  const cwd = root ?? process.cwd();
  const wired = (name) => {
    try {
      return run('claude', ['mcp', 'get', name], { cwd });
    } catch {
      return '';
    }
  };
  const current = wired(MCP_NAME);
  // Another server may hold the name (CybeDefend Cloud, for example): keep
  // it, and use "cybedefend-local" for this dashboard.
  const name = !current || current.includes(`${mcpUrl}/mcp`) ? MCP_NAME : `${MCP_NAME}-local`;
  const mine = name === MCP_NAME ? current : wired(name);
  // Same address and the token of this run: nothing to change.
  if (mine.includes(`${mcpUrl}/mcp`) && mine.includes(tok.slice(-4))) return { added: false, name, said: `MCP server "${name}" already wired for this repository` };
  return mcpAdd(name, mcpUrl, tok, cwd);
}

function mcpAdd(name, mcpUrl, tok, cwd) {
  try {
    run('claude', ['mcp', 'remove', '-s', 'local', name], { cwd });
  } catch {
    /* none to remove */
  }
  // Local scope: this repository on this machine, in the agent's own
  // configuration, never in a file of the repository.
  const config = JSON.stringify({ type: 'http', url: `${mcpUrl}/mcp`, headers: { Authorization: `Bearer ${tok}` } });
  run('claude', ['mcp', 'add-json', '-s', 'local', name, config], { cwd });
  return { added: true, name, said: `MCP server "${name}" added to Claude Code for this repository (it loads at the next session)` };
}

/** The MCP server answers with the token: initialize, then tools/list. */
async function mcpCheck(mcpUrl, tok) {
  const headers = { authorization: `Bearer ${tok}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
  const parse = (text) => {
    const data = text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).pop();
    try {
      return JSON.parse(data ?? text);
    } catch {
      return {};
    }
  };
  try {
    const post = (body, extra = {}) => fetch(`${mcpUrl}/mcp`, { method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
    let res = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'cybedefend-setup', version: '1' } } });
    if (res.status !== 200) return { ok: false, said: `the MCP server at ${mcpUrl}/mcp answered HTTP ${res.status}` };
    const session = res.headers.get('mcp-session-id');
    const extra = session ? { 'mcp-session-id': session } : {};
    await res.text();
    await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, extra);
    res = await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, extra);
    const tools = parse(await res.text()).result?.tools ?? [];
    return { ok: tools.length > 0, tools: tools.length, said: tools.length ? `MCP server answers with the token: ${tools.length} tools (findings, triage, projects)` : 'the MCP server lists no tool' };
  } catch {
    return { ok: false, said: `the MCP server does not answer at ${mcpUrl}/mcp` };
  }
}

// ─── Commands ───────────────────────────────────────────────────────────────

function openUrl(url) {
  const [cmd, args] = openCommand(url);
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true });
    // No opener on this machine (a server): the link is printed all the same, never a crash.
    child.on('error', () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}

function toClipboard(text) {
  for (const [cmd, args] of clipboardTools()) {
    if (!has(cmd)) continue;
    try {
      execFileSync(cmd, args, { input: text, windowsHide: true });
      return true;
    } catch {
      /* next */
    }
  }
  return false;
}

async function setup(flags) {
  const t0 = Date.now();
  say('CybeDefend: setting up the dashboard, the token and the project. Nothing to type.');
  const docker = await step('Docker', () => checkDocker());
  const scanners = await step('The AppSec scanners (open source)', () => scannersRepo());
  await step("The dashboard's files", () => platformFiles(flags.from));
  const s = await step('Settings: ports, network, master key, setup token', () => settings(flags));
  await step('Starting the dashboard (the first time, Docker downloads the images)', () => start(s.url));
  const admin = await step('The first administrator', () => administrator(s.url));
  const t = await step('A personal access token for the skill', () => token(s.url, admin.session));
  const p = await step('The project of this repository', () => project(s.url, t.token, flags['project-name']));
  const policy = await step('A default policy, so the verdict means something', () => defaultPolicy(s.url, t.token));
  const agent = flags.agent ?? (has('claude') ? 'claude-code' : 'none');
  const m = mcp(agent, s.mcpUrl, t.token, p.root);
  say(`  ✓ ${m.said}`);
  const check = await mcpCheck(s.mcpUrl, t.token);
  say(`  ${check.ok ? '✓' : '!'} ${check.said}`);
  m.answers = check;
  saveCredentials({ url: s.url, mcpUrl: s.mcpUrl });
  say(`\nReady in ${secs(t0)}.`);
  return {
    ready: true,
    url: s.url,
    mcpUrl: `${s.mcpUrl}/mcp`,
    projectId: p.projectId,
    projectUrl: p.projectId ? `${s.url}/project/${p.projectId}` : null,
    adminEmail: maskEmail(readCredentials().email),
    credentialsFile: CREDENTIALS,
    scanners: scanners.said,
    policy: policy.said,
    platformDir: PLATFORM,
    composeProject: composeProject(),
    mcp: { agent, ...m },
    docker,
    seconds: Math.round((Date.now() - t0) / 1000),
  };
}

async function status() {
  const creds = readCredentials();
  const url = creds.url ?? readEnv(join(PLATFORM, '.env')).CYBEDEFEND_PUBLIC_URL ?? null;
  const s = url ? await answers(url) : null;
  return {
    platformDir: existsSync(join(PLATFORM, 'docker-compose.yml')) ? PLATFORM : null,
    url,
    answers: Boolean(s),
    setupOpen: s?.setupOpen ?? null,
    administrator: maskEmail(creds.email),
    tokenAccepted: url ? await tokenWorks(url, creds.token) : false,
    services: existsSync(join(PLATFORM, 'docker-compose.yml')) ? health() : null,
  };
}

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8').trim();
}

async function main(argv) {
  const { positional, flags } = parseArgs(argv);
  const print = (doc) => process.stdout.write(`${JSON.stringify(doc, null, 2)}\n`);
  switch (positional[0] ?? 'setup') {
    case 'setup': {
      print(await setup(flags));
      return 0;
    }
    case 'status':
      print(await status());
      return 0;
    case 'signin': {
      const creds = readCredentials();
      if (!creds.url) throw new Exit(3, 'Nothing set up yet: run node setup.mjs');
      const copied = creds.password ? toClipboard(creds.password) : false;
      const opened = openUrl(`${creds.url}/login`);
      print({ url: `${creds.url}/login`, email: maskEmail(creds.email), opened, passwordCopied: copied, passwordFile: copied ? null : CREDENTIALS });
      return 0;
    }
    case 'token': {
      say('Paste the personal access token (cdp_...), then Enter and Ctrl-D:');
      const value = await readStdin();
      const url = flags.url ?? readCredentials().url ?? readEnv(join(PLATFORM, '.env')).CYBEDEFEND_PUBLIC_URL;
      if (!url) throw new Exit(64, 'Which dashboard? Pass --url http://host:port');
      if (!value.startsWith('cdp_')) throw new Exit(64, 'A personal access token starts with cdp_.');
      if (!(await tokenWorks(url, value))) throw new Exit(3, `The dashboard at ${url} refused the token.`);
      saveCredentials({ url, token: value });
      print({ url, tokenSaved: true, credentialsFile: CREDENTIALS });
      return 0;
    }
    default:
      process.stderr.write(`${readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 30).map((l) => l.replace(/^\/\/ ?/, '')).join('\n')}\n`);
      return 64;
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      say(`\n✗ ${err instanceof Exit ? err.message : `Unexpected error: ${err?.message ?? err}`}`);
      process.exit(err instanceof Exit ? err.code : 3);
    },
  );
}

export { openUrl, toClipboard };
