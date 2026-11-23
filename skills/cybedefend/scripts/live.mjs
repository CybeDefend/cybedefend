#!/usr/bin/env node
// The live step of /cybedefend: the application started on this machine by
// this script, a few requests sent to it and to nothing else, each one kept
// as evidence. No dependency: Node 18 or later.
//
//   node live.mjs begin                   before anything is started: notes the repository and Docker as they are
//   node live.mjs start --port <n> [--wait <seconds>] [--cwd <dir>] [--no-open] -- <the command that starts the application>
//   node live.mjs probe [--finding <file:line>] [--note "<what the answer shows>"] [-X <METHOD>] [-H "Name: value"]... [-d <body> | -d @<file>] <url>
//   node live.mjs drop <probe number>     a probe sent by mistake, taken out of the evidence
//   node live.mjs status
//   node live.mjs stop                    ends the application, says what the step added and has not removed
//   node live.mjs left                    the same list, once the cleanup is done: exit 0 when nothing is left
//
// What it holds to, in code and not only in the skill's text:
//   - start refuses a port that already answers: this step never talks to an
//     application it did not start (it could hold real data);
//   - probe refuses any address that is not this machine (localhost,
//     127.0.0.1, ::1) and any port but the one start opened, and follows no
//     redirect;
//   - probe works only while the application start launched is running;
//   - every probe is written to .cybedefend/out/live.json, with credentials
//     masked, so the report shows what was sent and what came back;
//   - stop ends the application and everything it started, and never a
//     process it did not start;
//   - left lists only what appeared after begin: what the user had before
//     the step is never named for removal.
//
// Output: the answer on stdout (for the agent to go on with), messages on
// stderr. Exit: 0 done, 2 the application did not come up or a probe could
// not be sent, 3 refused (not this machine, not the started application),
// 64 usage error.

import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync, closeSync, statSync, realpathSync } from 'node:fs';
import { connect } from 'node:net';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launcher } from './os.mjs';
import { updateWatch, addFeed, openWatch } from './watch.mjs';

const say = (line) => process.stderr.write(`${line}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Stops the application and what it started: its process group on macOS and
 * Linux, its process tree on Windows (taskkill /T), where a .cmd launcher
 * would otherwise leave the server behind.
 */
function killTree(pid, signal) {
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/pid', String(pid), '/T', ...(signal === 'SIGKILL' ? ['/F'] : [])], { stdio: 'ignore', windowsHide: true });
      return;
    } catch {
      /* gone already, or it refused: the plain kill below */
    }
  }
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      /* already gone */
    }
  }
}
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const MASK = 'REDACTED';
/** A finding as a probe names it: a path, a colon, a line number. */
export const FINDING = /^\S.*:\d+$/;

class Exit extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function repoRoot() {
  try {
    // resolve(): git answers C:/x/y on Windows, where the working folder reads C:\x\y.
    return resolve(execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim());
  } catch {
    throw new Exit(64, 'Not inside a git repository: run it from the repository under review.');
  }
}

const stateFile = (root) => join(root, '.cybedefend', 'out', 'live.json');

export function readState(root) {
  try {
    const s = JSON.parse(readFileSync(stateFile(root), 'utf8'));
    return { app: s.app ?? null, probes: Array.isArray(s.probes) ? s.probes : [], before: s.before ?? null, next: Number(s.next) || 0, last: s.last ?? null, left: s.left ?? null };
  } catch {
    return { app: null, probes: [], before: null, next: 0, last: null, left: null };
  }
}

function writeState(root, state) {
  mkdirSync(join(root, '.cybedefend', 'out'), { recursive: true });
  writeFileSync(stateFile(root), `${JSON.stringify(state, null, 2)}\n`);
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** Whether something accepts connections on this machine's port. */
function answers(port, host = '127.0.0.1') {
  return new Promise((done) => {
    const socket = connect({ port, host, timeout: 800 });
    socket.once('connect', () => (socket.destroy(), done(true)));
    socket.once('timeout', () => (socket.destroy(), done(false)));
    socket.once('error', () => done(false));
  });
}

const listens = async (port) => (await answers(port, '127.0.0.1')) || (await answers(port, '::1'));

/**
 * The address a probe may go to: this machine and the port the application
 * was started on, nothing else. Returns the URL, or throws with the reason.
 */
export function allowedUrl(raw, port) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Exit(64, `Not a URL: ${raw}`);
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Exit(3, `Refused: ${url.protocol} is not http or https.`);
  if (url.username || url.password) throw new Exit(3, 'Refused: no credentials in the address.');
  if (!LOOPBACK.has(url.hostname)) throw new Exit(3, `Refused: ${url.hostname} is not this machine. The live step sends requests only to the application it started here (localhost).`);
  const asked = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
  if (asked !== Number(port)) throw new Exit(3, `Refused: port ${asked} is not the application this step started (port ${port}).`);
  return url;
}

/** A header as it may be kept: who signed in is never written down. */
export function maskHeader(name, value) {
  const n = name.toLowerCase();
  if (n === 'authorization' || n === 'proxy-authorization') return `${String(value).split(' ')[0]} ${MASK}`;
  if (n === 'cookie') return String(value).split(';').map((c) => `${c.split('=')[0].trim()}=${MASK}`).join('; ');
  if (n === 'set-cookie') return String(value).replace(/^([^=]+)=[^;]*/, `$1=${MASK}`);
  if (/(api[-_]?key|token|secret|password)/.test(n)) return MASK;
  return String(value);
}

/** A body as it may be kept: tokens and passwords masked, the rest readable, cut to a length. */
export function maskBody(text, max = 3000) {
  let t = String(text ?? '');
  t = t.replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g, MASK); // a JWT
  t = t.replace(/\bv\d\.(local|public)\.[A-Za-z0-9_-]{16,}/g, MASK); // a PASETO
  t = t.replace(/("(?:[a-z_]*(?:token|password|passwd|secret|api_?key|session)[a-z_]*)"\s*:\s*")([^"]{4,})(")/gi, `$1${MASK}$3`);
  t = t.replace(/((?:^|[&?\s])(?:[a-z_]*(?:token|password|passwd|secret)[a-z_]*)=)([^&\s]{4,})/gi, `$1${MASK}`);
  return t.length > max ? `${t.slice(0, max)}\n... (${t.length - max} more characters)` : t;
}

function parseArgs(argv) {
  const flags = { headers: [] };
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--') {
      flags.command = argv.slice(i + 1);
      break;
    }
    if (a === '-X') flags.method = argv[++i];
    else if (a === '-H') flags.headers.push(argv[++i]);
    else if (a === '-d' || a === '--data') flags.data = argv[++i];
    else if (a.startsWith('--')) flags[a.slice(2)] = argv[i + 1] !== undefined && !argv[i + 1].startsWith('-') ? argv[++i] : true;
    else rest.push(a);
  }
  return { flags, rest };
}

// A replay sends nothing to anyone, the usage statistics of the application's framework included:
// the convention DO_NOT_TRACK, and the documented switch of the frameworks that send some by default.
export const QUIET = {
  DO_NOT_TRACK: '1',
  WASP_TELEMETRY_DISABLE: '1',
  NEXT_TELEMETRY_DISABLED: '1',
  NUXT_TELEMETRY_DISABLED: '1',
  ASTRO_TELEMETRY_DISABLED: '1',
  GATSBY_TELEMETRY_DISABLED: '1',
  DOTNET_CLI_TELEMETRY_OPTOUT: '1',
};

async function start(root, flags) {
  const port = Number(flags.port);
  if (!(port > 0 && port < 65536) || !flags.command?.length) throw new Exit(64, 'Usage: live.mjs start --port <n> [--wait <seconds>] [--cwd <dir>] -- <the command that starts the application>');
  const state = readState(root);
  if (state.app && alive(state.app.pid)) throw new Exit(3, `Already started (pid ${state.app.pid}, port ${state.app.port}): stop it first with live.mjs stop.`);
  if (await listens(port)) throw new Exit(3, `Something already answers on port ${port}. This step never talks to an application it did not start: it could be the user's own, with real data. Stop it, or start this one on another port.`);
  // Where the command is called from, when that is inside the repository: a framework's command line looks for its project there.
  let here = root;
  try {
    // .native: the long name of a Windows 8.3 folder, as git names the repository.
    here = realpathSync.native(process.cwd());
  } catch {
    /* the folder is gone: the repository's root */
  }
  const cwd = flags.cwd ? resolve(root, String(flags.cwd)) : here === root || here.startsWith(root + sep) ? here : root;
  if (cwd !== root && !cwd.startsWith(root + sep)) throw new Exit(3, 'Refused: --cwd is outside the repository.');
  mkdirSync(join(root, '.cybedefend', 'out'), { recursive: true });
  const logFile = join(root, '.cybedefend', 'out', 'live-app.log');
  const log = openSync(logFile, 'w');
  // Through launcher(): on Windows npm, pnpm or yarn are .cmd files, started through cmd.exe.
  const [file, args, extra] = launcher(flags.command[0], flags.command.slice(1));
  const child = spawn(file, args, { cwd, detached: true, stdio: ['ignore', log, log], env: { ...process.env, ...QUIET }, windowsHide: true, ...extra });
  child.on('error', () => {});
  child.unref();
  closeSync(log);
  const wait = Math.min(Math.max(Number(flags.wait ?? 60), 5), 600);
  const tail = () => {
    try {
      return readFileSync(logFile, 'utf8').split('\n').slice(-25).join('\n');
    } catch {
      return '';
    }
  };
  const until = Date.now() + wait * 1000;
  while (Date.now() < until) {
    if (await listens(port)) break;
    if (!alive(child.pid)) {
      say(maskBody(tail(), 4000));
      throw new Exit(2, `The application stopped before it answered on port ${port}. Its last lines are above (${logFile}).`);
    }
    await sleep(500);
  }
  if (!(await listens(port))) {
    killTree(child.pid, 'SIGTERM');
    say(maskBody(tail(), 4000));
    throw new Exit(2, `Nothing answered on port ${port} after ${wait} s: stopped. Its last lines are above (${logFile}).`);
  }
  state.app = { pid: child.pid, port, command: flags.command.join(' '), cwd, startedAt: new Date().toISOString(), log: logFile };
  // begin was not run: what is there now is noted, late (a database started before this is taken for the user's).
  if (!state.before) state.before = { at: new Date().toISOString(), late: true, ...surroundings(root) };
  writeState(root, state);
  // An application that listens on every interface is reachable from the network while it runs: say so.
  let everywhere = false;
  try {
    everywhere = /\*:\d+|0\.0\.0\.0:\d+|\[::\]:\d+/.test(execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  } catch {
    /* lsof is not everywhere; the check is a courtesy */
  }
  // The live page of the run, when there is one, shows the replay as it happens.
  updateWatch(join(root, '.cybedefend', 'out'), (w) => {
    w.live = { state: 'run', url: `http://localhost:${port}` };
    addFeed(w, { kind: 'note', text: `The application runs on http://localhost:${port}, started here by this step with throwaway data. Replaying the proven flaws on it.` });
  });
  // The run's page comes back in front: the replay is the part to watch. Nobody to show it to in CI or in an unattended run (--no-open, CYBEDEFEND_NO_OPEN=1).
  const quiet = flags['no-open'] === true || process.env.CI || ['1', 'true', 'yes'].includes(String(process.env.CYBEDEFEND_NO_OPEN ?? '').toLowerCase());
  const opened = quiet ? false : openWatch(join(root, '.cybedefend', 'out'));
  say(`live: the application answers on http://localhost:${port} (pid ${child.pid}).${everywhere ? ' It listens on every interface of this machine, not only localhost: stop it as soon as the replay is done.' : ''}`);
  if (opened) say('live: the page of the run is open in the browser again: each replay shows there the moment its answer comes back.');
  process.stdout.write(`${JSON.stringify({ started: true, port, pid: child.pid, url: `http://localhost:${port}`, log: logFile, listensOnEveryInterface: everywhere })}\n`);
  return 0;
}

/**
 * What git sees as changed and what Docker holds, by name: noted before the
 * step touches anything (begin), compared when it ends (left). `docker` is
 * null on a machine without it.
 */
function surroundings(root) {
  const lines = (cmd, args) => {
    try {
      return execFileSync(cmd, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 20_000, maxBuffer: 64 * 1024 * 1024 }).split('\n').filter((l) => l.trim());
    } catch {
      return null;
    }
  };
  const containers = lines('docker', ['ps', '-a', '--format', '{{.Names}}']);
  return {
    // Without the audit's own folder: the evidence of this step is written there.
    files: (lines('git', ['status', '--porcelain', '--untracked-files=all']) ?? []).filter((l) => !/^..\s"?\.cybedefend\//.test(l)),
    // What git ignores, a folder as one line: an installed dependency tree, a build, an environment file.
    ignored: (lines('git', ['status', '--porcelain', '--ignored=traditional', '--untracked-files=normal']) ?? []).filter((l) => l.startsWith('!! ')).map((l) => l.slice(3).replace(/^"|"$/g, '')).filter((f) => !f.startsWith('.cybedefend/')),
    docker: containers === null ? null : { containers, volumes: lines('docker', ['volume', 'ls', '-q']) ?? [], images: lines('docker', ['images', '--format', '{{.Repository}}:{{.Tag}}']) ?? [] },
  };
}

/** What appeared since `begin` and is still there: the step's own, unless the user started something else meanwhile. */
function leftSince(root, before) {
  const now = surroundings(root);
  const added = (a, b) => (a ?? []).map((x) => x.trimEnd()).filter((x) => !(b ?? []).map((y) => y.trimEnd()).includes(x));
  const both = now.docker && before.docker;
  // What git ignores and was not there: an environment file is this step's to remove, a build or an installed dependency tree stays.
  const ignored = Array.isArray(before.ignored) ? added(now.ignored, before.ignored) : [];
  const isEnv = (f) => /(^|\/)\.env(\.[^/]*)?$/.test(f);
  return {
    containers: both ? added(now.docker.containers, before.docker.containers) : [],
    volumes: both ? added(now.docker.volumes, before.docker.volumes) : [],
    images: both ? added(now.docker.images, before.docker.images).filter((x) => !x.includes('<none>')) : [],
    files: added(now.files, before.files),
    env: ignored.filter(isEnv),
    built: ignored.filter((f) => !isEnv(f)),
  };
}

/** Whether nothing of the step is left to remove: an image and a build are named, and stay. */
const isClean = (left) => !left.containers.length && !left.volumes.length && !left.files.length && !(left.env ?? []).length;

/** Says what is left, with the command that removes each; true when nothing but an image is. */
function sayLeft(left) {
  const clean = isClean(left);
  if (clean) say('live: nothing of this step is left: the repository and Docker hold what they held before it.');
  else {
    say('live: still there, and not there before this step began. Unless the user started something else meanwhile, it is this step\'s: remove it, then run "live.mjs left" again.');
    for (const c of left.containers) say(`  container ${c}: docker rm -f -v ${c}`);
    for (const v of left.volumes) say(`  volume ${v}: docker volume rm ${v}`);
    for (const f of left.files) say(`  in the repository, ${f.trim()}: remove what the start wrote; "git checkout -- <file>" for a tracked file its tooling rewrote`);
    for (const f of left.env ?? []) say(`  the environment file ${f}, created by this step: remove it`);
  }
  if ((left.built ?? []).length) say(`  built by this step, ignored by git, and kept (the next start is faster): ${left.built.join(', ')}. Say they are this step's: never that they were there before.`);
  for (const i of left.images) say(`  the image ${i} came with this step and stays on the machine (docker rmi ${i} removes it): say it in the report.`);
  return clean;
}

function headOf(root) {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch {
    return null;
  }
}

async function probe(root, flags, rest) {
  const state = readState(root);
  if (!state.app || !alive(state.app.pid)) throw new Exit(3, 'No application started by this step is running: live.mjs start first. A probe never goes to an application this step did not start.');
  if (rest.length !== 1) throw new Exit(64, 'Usage: live.mjs probe [--finding <file:line>] [--note "..."] [-X <METHOD>] [-H "Name: value"]... [-d <body>] <url>');
  const url = allowedUrl(rest[0], state.app.port);
  const method = String(flags.method ?? (flags.data !== undefined ? 'POST' : 'GET')).toUpperCase();
  const headers = {};
  for (const h of flags.headers) {
    const at = String(h).indexOf(':');
    if (at < 1) throw new Exit(64, `Not a header: ${h}`);
    headers[h.slice(0, at).trim()] = h.slice(at + 1).trim();
  }
  let body;
  if (flags.data !== undefined) {
    body = String(flags.data);
    if (body.startsWith('@')) {
      const file = resolve(root, body.slice(1));
      if (!file.startsWith(root + sep) || !existsSync(file) || statSync(file).size > 1_000_000) throw new Exit(3, 'Refused: the body file is outside the repository, missing, or over 1 MB.');
      body = readFileSync(file, 'utf8');
    }
    if (!Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) headers['content-type'] = /^\s*[[{]/.test(body) ? 'application/json' : 'application/x-www-form-urlencoded';
  }
  let res;
  let text = '';
  const t0 = Date.now();
  try {
    res = await fetch(url, { method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(20_000) });
    text = await res.text();
  } catch (err) {
    throw new Exit(2, `The request could not be sent: ${err?.cause?.code ?? err?.message ?? err}.`);
  }
  // A finding is named by its file and line. A sign-up, a sign-in or any request around the replay has none: a word in its place would be counted as one.
  const finding = typeof flags.finding === 'string' && FINDING.test(flags.finding) ? flags.finding : null;
  if (typeof flags.finding === 'string' && !finding) say(`live: "--finding" takes a finding's file:line. "${flags.finding}" is not one: the request is kept without a finding.`);
  const kept = ['content-type', 'location', 'set-cookie', 'www-authenticate', 'access-control-allow-origin', 'content-security-policy'];
  const answer = {};
  for (const k of kept) {
    const v = k === 'set-cookie' ? res.headers.getSetCookie?.() ?? [] : res.headers.get(k);
    if (Array.isArray(v) ? v.length : v) answer[k] = v;
  }
  const record = {
    // A number is given once: a probe dropped does not hand its number to the next one.
    id: Math.max(state.next ?? 0, ...state.probes.map((x) => Number(x.id) || 0)) + 1,
    at: new Date().toISOString(),
    // The commit this replay ran on: finish tells from it whether the code changed since.
    head: headOf(root),
    finding,
    note: typeof flags.note === 'string' ? flags.note : null,
    request: { method, url: `${url.pathname}${url.search}`, headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, maskHeader(k, v)])), body: body === undefined ? undefined : maskBody(body, 1500) },
    response: { status: res.status, ms: Date.now() - t0, headers: Object.fromEntries(Object.entries(answer).map(([k, v]) => [k, Array.isArray(v) ? v.map((x) => maskHeader(k, x)) : maskHeader(k, v)])), body: maskBody(text, 3000) },
  };
  state.probes.push(record);
  state.next = record.id;
  writeState(root, state);
  updateWatch(join(root, '.cybedefend', 'out'), (w) => {
    if (record.note) addFeed(w, { kind: 'live', text: `${maskBody(record.note, 200)} (HTTP ${res.status})`, where: record.finding ?? '' });
    else addFeed(w, { kind: 'note', text: `Request ${record.id}: ${method} ${url.pathname} answered ${res.status}` });
  });
  // The answer as it is, for the agent to go on with (a session it just opened on its own test data).
  process.stdout.write(`${JSON.stringify({ probe: record.id, status: res.status, headers: answer, body: text.length > 6000 ? `${text.slice(0, 6000)}\n... (${text.length - 6000} more characters)` : text })}\n`);
  say(`live: probe ${record.id}, ${method} ${url.pathname} answered ${res.status}${res.status >= 300 && res.status < 400 && answer.location ? ` (a redirect to ${answer.location}, not followed)` : ''}`);
  return 0;
}

async function stop(root) {
  const state = readState(root);
  if (!state.app) {
    say('live: nothing to stop.');
    return 0;
  }
  const { pid, port } = state.app;
  for (const signal of ['SIGTERM', 'SIGKILL']) {
    killTree(pid, signal);
    for (let i = 0; i < 10 && alive(pid); i += 1) await sleep(300);
    if (!alive(pid)) break;
  }
  const still = await listens(port);
  // What ran, for the lines the audit prints about this step once it is over.
  state.last = { command: state.app.command, port, startedAt: state.app.startedAt, stoppedAt: new Date().toISOString(), stopped: !still };
  state.app = null;
  writeState(root, state);
  updateWatch(join(root, '.cybedefend', 'out'), (w) => {
    if (w.live) w.live.state = 'done';
    addFeed(w, { kind: 'note', text: `The application is stopped. ${state.probes.filter((p) => p.note && !p.replaced).length} replay(s) kept with their request and answer.` });
  });
  say(still ? `live: the process is stopped, but something still answers on port ${port}: check what the start command left running (a container, a child process) and stop it.` : `live: stopped, port ${port} is free. ${state.probes.filter((x) => !x.replaced).length} probe(s) kept in .cybedefend/out/live.json.`);
  const left = state.before ? leftSince(root, state.before) : null;
  if (left) {
    sayLeft(left);
    state.left = { at: new Date().toISOString(), clean: isClean(left), ...left };
    writeState(root, state);
  }
  process.stdout.write(`${JSON.stringify({ stopped: !still, probes: state.probes.filter((x) => !x.replaced).length, left: left ?? undefined })}\n`);
  return still ? 2 : 0;
}

async function main(argv) {
  const [command, ...restArgs] = argv;
  const { flags, rest } = parseArgs(restArgs);
  const root = repoRoot();
  switch (command) {
    case 'start':
      return start(root, flags);
    case 'probe':
      return probe(root, flags, rest);
    case 'begin': {
      // Before anything is started: what git sees as changed and what Docker holds, so that the end can say what this step added.
      const state = readState(root);
      state.before = { at: new Date().toISOString(), ...surroundings(root) };
      state.left = null;
      // Asked again, the replay is made again: what an earlier one kept is put aside, and stays in the file under its numbers.
      const earlier = state.probes.filter((x) => !x.replaced).length;
      if (earlier && !(state.app && alive(state.app.pid))) {
        for (const x of state.probes) x.replaced = true;
        say(`live: the ${earlier} request(s) of an earlier replay are put aside. This replay starts the application again and stands for itself.`);
      }
      writeState(root, state);
      const d = state.before.docker;
      say(`live: noted as they are now: the repository (${state.before.files.length} line(s) in git status)${d ? ` and Docker (${d.containers.length} container(s), ${d.volumes.length} volume(s), ${d.images.length} image(s))` : ', no Docker on this machine'}. "live.mjs left" says what this step added and has not removed.`);
      process.stdout.write(`${JSON.stringify({ begun: true, docker: Boolean(d) })}\n`);
      return 0;
    }
    case 'left': {
      const state = readState(root);
      if (!state.before) throw new Exit(64, 'Nothing was noted before the step: run "live.mjs begin" first, before anything is started.');
      const left = leftSince(root, state.before);
      const clean = sayLeft(left);
      // Kept with the evidence: the audit says from it whether the step ended clean.
      state.left = { at: new Date().toISOString(), clean, ...left };
      writeState(root, state);
      process.stdout.write(`${JSON.stringify({ clean, left })}\n`);
      return clean ? 0 : 2;
    }
    case 'stop':
      return stop(root);
    case 'drop': {
      // A probe sent by mistake (a wrong flag, a note that says more than the answer shows) is not evidence.
      const id = Number(rest[0]);
      const state = readState(root);
      if (!state.probes.some((x) => x.id === id && !x.replaced)) throw new Exit(64, `No probe ${rest[0] ?? ''} in the evidence of this replay.`);
      state.next = Math.max(state.next ?? 0, ...state.probes.map((x) => Number(x.id) || 0));
      state.probes = state.probes.filter((x) => x.id !== id);
      writeState(root, state);
      say(`live: probe ${id} taken out of the evidence (${state.probes.filter((x) => !x.replaced).length} kept).`);
      process.stdout.write(`${JSON.stringify({ dropped: id, probes: state.probes.filter((x) => !x.replaced).length })}\n`);
      return 0;
    }
    case 'status': {
      const state = readState(root);
      const running = Boolean(state.app && alive(state.app.pid));
      process.stdout.write(`${JSON.stringify({ running, port: running ? state.app.port : null, probes: state.probes.filter((x) => !x.replaced).length })}\n`);
      return 0;
    }
    default:
      process.stderr.write(`${readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 32).map((l) => l.replace(/^\/\/ ?/, '')).join('\n')}\n`);
      return command ? 64 : 0;
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      say(err instanceof Exit ? `live: ${err.message}` : `live: unexpected error: ${err?.message ?? err}`);
      process.exit(err instanceof Exit ? err.code : 2);
    },
  );
}
