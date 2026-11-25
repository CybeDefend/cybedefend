#!/usr/bin/env node
// Runs the scanners of /cybedefend on the repository and writes one file per
// tool in .cybedefend/out/, with a manifest that cybedefend.mjs reads to send
// them. It sends nothing itself and reads no token: the tools only see a
// read-only copy of the files git sees. Node alone runs it, on macOS, Linux,
// Windows (PowerShell, cmd or Git Bash) and WSL.

const USAGE = `Usage, from anywhere inside the repository:
  node scan.mjs [--depth quick|deep] [--only bandit,gitleaks,...] [--image <image>]
                [--plan] [--out <dir>]

  --depth quick  the core scanners only (the CybeDefend scanner images)
  --depth deep   (default) also the deep tools that fit this repository's
                 stack, and the context tools the audit reads (not sent)
  --plan         prints what would run, how and why, and runs nothing

Environment:
  CYBEDEFEND_SCANNERS_LOCK  the registry (default: ../scanners.lock)
  CYBEDEFEND_SCANNERS       auto (default), docker or local. auto runs a tool
                            in Docker when Docker runs and the registry has an
                            image for it, else with its binary when it is on
                            the PATH. The skill never installs a tool.
  OPENGREP_RULES            the Opengrep rules folder, for a registry that asks for {rules}

Exit: 0 every tool that could run ran, 2 at least one tool did not finish
(the others still ran), 3 the machine cannot scan (no git repository, or no core
scanner can run here), 64 usage error.
`;

import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, closeSync, copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { SCANNED, envValue, launcher, runFile, which } from './os.mjs';
import { insideRoot, runGit, trustedRoot, TreeRefused } from './trust.mjs';
import { toolArea } from './watch.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const env = process.env;
const WIN = process.platform === 'win32';

class Exit extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function parseArgs(argv) {
  const o = { depth: 'deep', only: '', image: '', out: '', plan: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--depth') o.depth = argv[++i] ?? '';
    else if (a === '--only') o.only = argv[++i] ?? '';
    else if (a === '--image') o.image = argv[++i] ?? '';
    else if (a === '--out') o.out = argv[++i] ?? '';
    else if (a === '--plan') o.plan = true;
    else if (a === '-h' || a === '--help') o.help = true;
    else throw new Exit(64, `scan.mjs: unknown argument ${a}\n${USAGE}`);
  }
  return o;
}

/** The tools of a registry: name|type|tier|when|network|image|command, comments and blank lines left out. */
export function readRegistry(file) {
  return readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const f = l.split('|');
      return { name: f[0], type: f[1], tier: f[2], when: f[3], network: f[4], image: f[5], command: f.slice(6).join('|') };
    });
}

/**
 * Whether one marker of the "when" field matches the repository's files:
 * always, image (only with --image), ext:py, name:go.mod (in any folder),
 * dir:.github/workflows (from the root), path:config/routes.rb (that file).
 */
export function markerMatches(marker, files, targetImage = '') {
  const i = marker.indexOf(':');
  const kind = i < 0 ? marker : marker.slice(0, i);
  const value = i < 0 ? marker : marker.slice(i + 1);
  switch (kind) {
    case 'always':
      return true;
    case 'image':
      return Boolean(targetImage);
    case 'ext':
      return files.some((f) => f.endsWith(`.${value}`));
    case 'name':
      return files.some((f) => f === value || f.endsWith(`/${value}`));
    case 'dir':
      return files.some((f) => f.startsWith(`${value}/`));
    case 'path':
      return files.includes(value);
    default:
      return false;
  }
}

/** The first marker that matches, or null. */
export function whyFits(when, files, targetImage = '') {
  return when.split(',').find((m) => markerMatches(m, files, targetImage)) ?? null;
}

// What a core scanner leaves unread when it does not finish, by what it reads.
const UNREAD = {
  code: 'The code was not read by this scanner',
  dependencies: 'The dependencies were not read',
  infrastructure: 'The infrastructure files were not read',
  secrets: 'The files were not searched for secrets',
  'CI/CD': 'The workflows were not read',
  containers: 'The image was not scanned',
};

/** The last line of a log that says something: no colour code, no clock, no level word, cut to a length. */
function lastWords(log) {
  const lines = String(log ?? '')
    .split(/\r?\n/)
    .map((l) =>
      l
        .replace(/^\s*\[?\d{4}[-/]\d{2}[-/]\d{2}[T ]\d{2}:\d{2}:\d{2}[.,\dZ:+-]*\]?\s*/, '')
        .replace(/^(\[[^\]]{1,24}\]\s*)+/, '')
        .replace(/^(time="[^"]*"\s*)?(level=\w+\s*)?(msg=)?/, '')
        .replace(/^\s*(fatal|error|erro|panic|warn|warning)\b[:\s]*/i, '')
        .replace(/"/g, "'")
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter((l) => l.length > 3);
  const last = lines[lines.length - 1] ?? '';
  return last.length > 150 ? `${last.slice(0, 147)}...` : last;
}

/**
 * Why a tool stopped before it wrote its results, in words a person can act
 * on: read from its exit status and its own log. Returns { why, next }, one
 * line each: `why` completes "did not finish: ...", `next` says what that
 * changes for the audit and what to do. `tier` and `area` are the tool's
 * place (scanners.lock) and what it reads.
 */
export function whyStopped(name, status, logText = '', { tier = 'core', area = toolArea(name) } = {}) {
  const log = String(logText ?? '').replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');
  const has = (re) => re.exec(log);
  let why;
  let todo = 'Run /cybedefend again to give it another try.';
  let g;
  if (Number(status) === 0) {
    why = 'it ended without writing its results';
  } else if (has(/permission denied[^\n]*docker(\.sock| daemon socket)/i)) {
    why = "it may not use Docker's socket on this machine, which it needs to read a local image";
    todo = 'Name an image a registry holds, or run the scan from an account that may use Docker.';
  } else if (has(/cannot connect to the docker daemon|is the docker daemon running|error during connect/i)) {
    why = 'Docker stopped answering while the scan ran';
    todo = 'Start Docker, then run /cybedefend again.';
  } else if ((g = has(/unable to find the specified image "?([^"\s]+)"?/i)) || (g = has(/no such image:? "?([^"\s]+)"?/i))) {
    why = `the image "${g[1]}" is not on this machine, and no registry it can read holds it`;
    todo = 'Build or pull it, then name it exactly: --image <name:tag>.';
  } else if ((g = has(/requires newer go version go(\d+\.\d+)[^\n]*built with go(\d+\.\d+)/i)) || (g = has(/requires go >= ?(\d+\.\d+)[\d.]*[^\n]*running go ?(\d+\.\d+)/i))) {
    why = `the module asks for Go ${g[1]}, and this version of ${name} reads Go up to ${g[2]}`;
    todo = '';
  } else if (has(/could not import|no required module provides package|missing go\.sum entry|cannot find (package|module)|build constraints exclude all go files|golang errors in file/i)) {
    why = 'it could not load the Go packages: the module does not build as it stands (a dependency or a generated file is missing)';
    todo = '';
  } else if (has(/failed to download (the )?(vulnerability|java) db|db error|failed to init(ialize)? the (vulnerability )?db|toomanyrequests/i)) {
    why = 'it could not download its vulnerability database: the registry that serves it refused, or was out of reach';
    todo = 'Run /cybedefend again in a few minutes.';
  } else if (has(/no space left on device/i)) {
    why = 'the disk is full: it could not write its files';
    todo = 'Free some space, then run /cybedefend again.';
  } else if (Number(status) === 137 || has(/out of memory|cannot allocate memory/i)) {
    why = 'it needed more memory than Docker gives its containers, and was stopped';
    todo = "Raise the memory in Docker's settings, then run /cybedefend again.";
  } else if (has(/dial tcp|no such host|i\/o timeout|tls handshake timeout|connection refused|network is unreachable|temporary failure in name resolution|dns error|failed to lookup address|could not resolve host|proxyconnect/i)) {
    why = "it could not reach the network it needs (its own database, or the project's modules)";
    todo = 'Check the connection (a proxy or a VPN can close it to Docker), then run /cybedefend again.';
  } else if ([126, 127].includes(Number(status)) || has(/executable file not found|exec format error/i)) {
    why = 'its program could not be started';
    todo = 'Check that Docker runs and that the image of scanners.lock is the one on this machine, then run /cybedefend again.';
  } else {
    const last = lastWords(log);
    why = last ? `it stopped on this message: "${last}"` : `it ended before it wrote its results, and its log says nothing (exit code ${status})`;
  }
  // What it changes: a deep tool doubles a core one, a context tool only helps the review, a core tool leaves its part unread.
  const impact =
    tier === 'deep'
      ? 'The core scanners read the same files: the audit goes on without it.'
      : tier === 'context'
        ? 'It only helps the review: the audit goes on without it.'
        : `${UNREAD[area] ?? 'Its part of the scan is missing'} in this run.`;
  const next = tier === 'core' ? `${impact} ${todo}`.trim() : impact;
  return { why, next };
}

const pad = (s, n) => String(s).padEnd(n);
const now = () => Date.now();
const secondsSince = (t) => Math.round((now() - t) / 1000);
const node = (args, opts = {}) => spawnSync(process.execPath, args, { encoding: 'utf8', windowsHide: true, ...opts });

/** The files git sees: tracked and new ones, never the ignored ones, as the instance scans an uploaded archive. */
function gitFiles(repo) {
  let listed;
  try {
    listed = runGit(['ls-files', '-z', '--cached', '--others', '--exclude-standard', ...SCANNED], { cwd: repo, maxBuffer: 256 * 1024 * 1024 });
  } catch {
    throw new Exit(3, `scan.mjs: git could not list the files of ${repo}.`);
  }
  return [...new Set(listed.toString('utf8').split('\0').filter(Boolean))];
}

/** The copy the tools read: each file git sees, as it is in the working tree. */
export function stageFiles(repo, files, stage) {
  for (const rel of files) {
    const from = join(repo, rel);
    const to = join(stage, rel);
    let st;
    try {
      st = lstatSync(from);
    } catch {
      continue; // deleted in the working tree, still in the index
    }
    mkdirSync(dirname(to), { recursive: true });
    try {
      if (st.isSymbolicLink()) {
        // A link that leaves the repository (a key in the user's home, a system file) is not the repository's: left out.
        if (!insideRoot(repo, rel)) continue;
        try {
          symlinkSync(readlinkSync(from), to);
        } catch {
          // Windows refuses links without the right: the file it points to, when there is one.
          if (statSync(from).isFile()) copyFileSync(from, to);
        }
      } else if (st.isDirectory()) {
        cpSync(from, to, { recursive: true, filter: (p) => !p.split(/[\\/]/).includes('.git') });
      } else if (st.isFile()) {
        copyFileSync(from, to);
      }
    } catch {
      /* a file that cannot be read is left out, as tar would */
    }
  }
}

/** A source for docker --mount: quoted when the path holds a comma or a quote (the option is CSV). */
function mount(source, target, readonly = false) {
  let field = `source=${source}`;
  if (/[",]/.test(field)) field = `"${field.replace(/"/g, '""')}"`;
  return ['--mount', `type=bind,${field},target=${target}${readonly ? ',readonly' : ''}`];
}

/** On Windows a tool run from its binary writes C:-style separators in its paths: the import reads "/". */
function slashUris(file) {
  try {
    const doc = JSON.parse(readFileSync(file, 'utf8'));
    let changed = false;
    const walk = (v) => {
      if (Array.isArray(v)) return v.forEach(walk);
      if (!v || typeof v !== 'object') return;
      for (const [k, x] of Object.entries(v)) {
        if (k === 'uri' && typeof x === 'string' && x.includes('\\') && !/^[a-z][a-z0-9+.-]*:\/\//i.test(x)) {
          v[k] = x.split('\\').join('/');
          changed = true;
        } else walk(x);
      }
    };
    walk(doc);
    if (changed) writeFileSync(file, JSON.stringify(doc));
  } catch {
    /* not JSON: left as the tool wrote it */
  }
}

function resultCount(file) {
  try {
    const d = JSON.parse(readFileSync(file, 'utf8'));
    return String((d.runs || []).reduce((n, r) => n + (r.results || []).length, 0));
  } catch {
    return '';
  }
}

/** Runs a command and hands each line of its output to `line`; resolves with its exit code. */
function streamLines(cmd, args, line) {
  return new Promise((done) => {
    const [file, fargs, extra] = launcher(cmd, args);
    let child;
    try {
      child = spawn(file, fargs, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, ...extra });
    } catch {
      done(127);
      return;
    }
    for (const s of [child.stdout, child.stderr]) createInterface({ input: s }).on('line', line);
    child.on('error', () => done(127));
    child.on('close', (code) => done(code ?? 1));
  });
}

async function main(argv) {
  const opts = parseArgs(argv);
  if (opts.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  const { depth, only, image: targetImage, plan } = opts;
  if (!['quick', 'deep'].includes(depth)) throw new Exit(64, `scan.mjs: --depth is quick or deep, not ${depth}`);
  const mode = env.CYBEDEFEND_SCANNERS || 'auto';
  if (!['auto', 'docker', 'local'].includes(mode)) throw new Exit(64, `scan.mjs: CYBEDEFEND_SCANNERS is auto, docker or local, not ${mode}`);

  const lock = env.CYBEDEFEND_SCANNERS_LOCK || join(here, '..', 'scanners.lock');
  // When a CybeDefend image cannot be had (not published yet, no network), the
  // same tool runs from its own project's image, else from its binary.
  const fallbackLock = env.CYBEDEFEND_SCANNERS_FALLBACK_LOCK || join(here, '..', 'scanners.upstream.lock');
  // The CybeDefend Opengrep rules, fetched by setup.mjs with the cybedefend-scanners project.
  const appsecHome = env.CYBEDEFEND_APPSEC_HOME || join(homedir(), '.cybedefend', 'appsec');
  const fetchedRules = join(appsecHome, 'scanners', 'rules', 'opengrep');
  const rulesDir = env.OPENGREP_RULES || (existsSync(fetchedRules) ? fetchedRules : '');

  // The repository, with its .cybedefend tree checked before the scan clears, writes or reads anything there (trust.mjs).
  let repo;
  try {
    repo = trustedRoot();
  } catch (e) {
    if (e instanceof TreeRefused) throw new Exit(3, `scan.mjs: ${e.message}`);
    throw new Exit(3, 'scan.mjs: not inside a git repository. Run it from the repository to scan.');
  }
  if (!existsSync(lock)) throw new Exit(3, `scan.mjs: no registry at ${lock}`);

  const dockerOk = mode !== 'local' && which('docker') !== null && runFile('docker', ['info'], { timeout: 30_000, stdio: ['ignore', 'ignore', 'ignore'] }).status === 0;
  if (mode === 'docker' && !dockerOk) throw new Exit(3, 'scan.mjs: Docker is not running (or not installed). Start Docker Desktop or OrbStack, or let the instance scan (cybedefend.mjs instance-scan).');

  const files = gitFiles(repo);
  const tools = readRegistry(lock);
  const fallbackTools = existsSync(fallbackLock) ? readRegistry(fallbackLock) : [];

  const wanted = (name, tier) => {
    if (only) {
      const list = only.split(',');
      // The SBOM goes with the trivy-fs run.
      return list.includes(name) || (name === 'trivy-fs-sbom' && list.includes('trivy-fs'));
    }
    return depth === 'deep' || tier === 'core';
  };

  // Whether an image is here or can be pulled: asked once per image.
  const ready = new Map();
  const imageReady = (img) => {
    if (!ready.has(img)) {
      const ok = runFile('docker', ['image', 'inspect', img], { stdio: ['ignore', 'ignore', 'ignore'] }).status === 0 || runFile('docker', ['manifest', 'inspect', img], { timeout: 60_000, stdio: ['ignore', 'ignore', 'ignore'] }).status === 0;
      ready.set(img, ok);
    }
    return ready.get(img);
  };

  // In auto mode, a registry image that cannot be had is replaced by the same
  // tool's line of the fallback registry.
  const resolveTool = (t) => {
    const same = { image: t.image, command: t.command, fallbackNote: '' };
    if (t.image === '-' || t.image.startsWith('uvx:')) return same;
    if (!(mode === 'auto' && dockerOk)) return same;
    if (imageReady(t.image)) return same;
    const f = fallbackTools.find((x) => x.name === t.name);
    if (!f) return same;
    const image = f.image !== '-' && !imageReady(f.image) ? '-' : f.image;
    return { image, command: f.command, fallbackNote: `${t.image} not available` };
  };

  // Docker, uvx, local or nothing, for one tool. "uvx:<spec>" in the image
  // field is a Python tool run pinned by uv in a throwaway environment: nothing
  // is installed on the machine.
  const howToRun = (image, bin) => {
    if (image.startsWith('uvx:')) {
      if (mode !== 'docker' && which('uvx')) return 'uvx';
      if (mode !== 'docker' && which(bin)) return 'local';
      return 'none';
    }
    if (mode === 'docker') return image !== '-' ? 'docker' : 'none';
    if (mode === 'local') return which(bin) ? 'local' : 'none';
    if (dockerOk && image !== '-') return 'docker';
    return which(bin) ? 'local' : 'none';
  };

  const firstWord = (command) => command.trim().split(/\s+/)[0];
  let fallbacks = 0;

  if (plan) {
    const lines = [`${pad('tool', 14)} ${pad('type', 9)} ${pad('tier', 7)} ${pad('how', 7)} why`];
    for (const t of tools) {
      if (!wanted(t.name, t.tier)) continue;
      let reason = whyFits(t.when, files, targetImage);
      let how;
      if (reason) {
        const r = resolveTool(t);
        how = howToRun(r.image, firstWord(r.command));
        if (r.fallbackNote) {
          reason += " (its own project's image)";
          fallbacks += 1;
        }
        if (how === 'none') reason += `, but ${firstWord(r.command)} is not installed and Docker cannot run it`;
      } else {
        how = 'skip';
        reason = `nothing it reads here (${t.when})`;
      }
      lines.push(`${pad(t.name, 14)} ${pad(t.type, 9)} ${pad(t.tier, 7)} ${pad(how, 7)} ${reason}`);
    }
    if (fallbacks > 0) lines.push(`note: the CybeDefend scanner images are not available here, so ${fallbacks} tool(s) run from their own project's pinned image or binary: the same tools.`);
    process.stdout.write(`${lines.join('\n')}\n`);
    return 0;
  }

  const tmp = mkdtempSync(join(tmpdir(), 'cybedefend-scan-'));
  try {
    const stage = join(tmp, 'src');
    mkdirSync(stage, { recursive: true });
    stageFiles(repo, files, stage);

    const out = opts.out ? resolve(opts.out) : join(repo, '.cybedefend', 'out');
    const cacheRoot = env.XDG_CACHE_HOME || (WIN ? envValue(env, 'LOCALAPPDATA') || join(homedir(), 'AppData', 'Local') : join(homedir(), '.cache'));
    const cache = join(cacheRoot, 'cybedefend');
    mkdirSync(out, { recursive: true });
    mkdirSync(join(cache, 'trivy'), { recursive: true });
    // The output folder never goes into git.
    const ignore = join(repo, '.cybedefend', '.gitignore');
    if (!existsSync(ignore)) {
      mkdirSync(dirname(ignore), { recursive: true });
      writeFileSync(ignore, 'out/\n');
    }
    // A new run starts clean: no file of an earlier run can be sent by mistake.
    // The AI scanner's audit.sarif is not a scanner's output: a rescan keeps it
    // (audit.md, step 5, sends it again), and so does the merged file.
    for (const f of readdirSync(out)) {
      if (['audit.sarif', 'cybedefend-full.sarif'].includes(f)) continue;
      if (!/\.(sarif|cdx\.json|log)$/.test(f) && !['manifest.tsv', 'scan.json'].includes(f)) continue;
      try {
        if (statSync(join(out, f)).isFile()) rmSync(join(out, f), { force: true });
      } catch {
        /* gone already */
      }
    }
    const manifest = join(out, 'manifest.tsv');
    writeFileSync(manifest, 'name\ttype\ttier\tfile\tstatus\thow\tdetail\tseconds\n');
    // The eighth field is how long the tool took, for the ones that ran.
    const record = (...f) => appendFileSync(manifest, `${[...f, ...Array(8).fill('')].slice(0, 8).join('\t')}\n`);
    // The live page of the run (watch.mjs) follows each tool. Never a reason to stop a scan.
    const watchTool = (...a) => node([join(here, 'cybedefend.mjs'), 'watch-tool', ...a, '--out', out], { stdio: 'ignore' });
    const say = (s) => process.stdout.write(`${s}\n`);
    const warn = (s) => process.stderr.write(`${s}\n`);
    const tScan = now();

    let failed = false;
    let coreRan = 0;
    let coreUnavailable = 0;

    for (const t of tools) {
      const { name, type, tier, when, network } = t;
      if (!wanted(name, tier)) continue;

      const reason = whyFits(when, files, targetImage);
      if (!reason) {
        record(name, type, tier, '', 'skipped', '-', `nothing it reads here (${when})`);
        say(`${name}: skipped, nothing it reads in this repository`);
        continue;
      }

      const { image, command, fallbackNote } = resolveTool(t);
      const bin = firstWord(command);
      if (fallbackNote) {
        if (fallbacks === 0) say("note: the CybeDefend scanner images are not available here: each tool runs from its own project's pinned image or binary, the same tool.");
        fallbacks += 1;
      }
      const how = howToRun(image, bin);
      if (how === 'none') {
        if (tier === 'core') {
          const said = `could not run: Docker is not running and ${bin} is not installed here. ${UNREAD[toolArea(name, type)] ?? 'Its part of the scan is missing'} in this run. Start Docker, then run /cybedefend again.`;
          record(name, type, tier, '', 'failed', 'none', said);
          warn(`${name}: ${said}`);
          failed = true;
          coreUnavailable += 1;
        } else {
          record(name, type, tier, '', 'skipped', 'none', `${bin} is not installed and Docker cannot run it`);
          say(`${name}: skipped, ${bin} is not installed`);
        }
        continue;
      }
      if (command.includes('{rules}') && how === 'local' && !rulesDir) {
        const said = 'could not run: its rules folder is not named. Set OPENGREP_RULES to the folder of the Opengrep rules, then run /cybedefend again.';
        record(name, type, tier, '', 'failed', how, said);
        warn(`${name}: ${said}`);
        failed = true;
        continue;
      }

      // Every tool runs from the copy's root and reads ".", so the paths in its
      // SARIF are relative to the repository, as the import expects.
      const docker = how === 'docker';
      const dst = docker ? '/out' : out;
      const cch = docker ? '/cache' : cache;
      const rules = docker ? '/rules' : rulesDir;

      // The command, split on spaces, placeholders replaced in each word, so a
      // path with a space stays one argument. A last word "-" means the tool
      // writes its file on standard output. Otherwise its file is the word that
      // starts with {out}/.
      let file = '';
      const args = [];
      for (const word of command.trim().split(/\s+/)) {
        if (!file && word.startsWith('{out}/') && word.length > 6) file = join(out, word.slice(6));
        args.push(word.split('{src}').join('.').split('{out}').join(dst).split('{cache}').join(cch).split('{rules}').join(rules).split('{image}').join(targetImage));
      }
      let toStdout = false;
      if (args[args.length - 1] === '-') {
        toStdout = true;
        args.pop();
        file = join(out, type === 'sbom' ? `${name}.cdx.json` : `${name}.sarif`);
      }
      const inside = file ? relative(out, file) : '';
      if (!file || !inside || inside.startsWith('..') || isAbsolute(inside)) {
        const said = 'could not run: its line in scanners.lock names no output file inside the output folder.';
        record(name, type, tier, '', 'failed', how, said);
        warn(`${name}: ${said}`);
        failed = true;
        continue;
      }

      // A tool that writes into a folder of its own (Checkov) starts it empty;
      // a file of an earlier run (noir.json) is never read as this run's.
      rmSync(file, { recursive: true, force: true });

      const log = join(out, `${name}.log`);
      if (docker && runFile('docker', ['image', 'inspect', image], { stdio: ['ignore', 'ignore', 'ignore'] }).status !== 0) {
        // The first run downloads the image: it shows, layer by layer.
        say(`${name}: pulling ${image} (first run only)`);
        const tPull = now();
        await streamLines('docker', ['pull', image], (l) => {
          if (/^(Digest|Status|[0-9a-f]{12}: Pull complete)/.test(l)) say(`    ${l}`);
        });
        if (runFile('docker', ['image', 'inspect', image], { stdio: ['ignore', 'ignore', 'ignore'] }).status !== 0) {
          const said = `could not run: its image could not be downloaded (${image}). ${tier === 'core' ? `${UNREAD[toolArea(name, type)] ?? 'Its part of the scan is missing'} in this run. Check the connection, then run /cybedefend again.` : 'The core scanners read the same files: the audit goes on without it.'}`;
          record(name, type, tier, '', 'failed', 'docker', said);
          watchTool(name, 'fail', `could not run: its image could not be downloaded`, '--type', type);
          warn(`${name}: ${said}`);
          failed = true;
          continue;
        }
        say(`${name}: image ready (${secondsSince(tPull)} s)`);
      }
      if (docker) say(`${name}: running in Docker (${image}), ${reason}`);
      else if (how === 'uvx') say(`${name}: running ${image.slice(4)} through uvx (pinned, nothing installed), ${reason}`);
      else say(`${name}: running the local ${bin} binary, ${reason}`);

      const tTool = now();
      watchTool(name, 'run', '--type', type);
      let cmd;
      let cargs;
      if (docker) {
        // Go tools (gosec) load the project's modules: their downloads and build
        // cache stay in the tools' cache, so only the first run pays for them.
        // On Windows Docker Desktop maps the files' owner itself: no --user.
        // The images may point TMPDIR to a folder inside /tmp, which the empty
        // tmpfs hides: the temporary folder is /tmp itself.
        const user = typeof process.getuid === 'function' ? ['--user', `${process.getuid()}:${process.getgid()}`] : [];
        let dargs = ['run', '--rm', '--network', network, ...user, '-e', 'HOME=/tmp', '--tmpfs', '/tmp', '-e', 'TMPDIR=/tmp', '-e', 'GOMODCACHE=/cache/go/mod', '-e', 'GOCACHE=/cache/go/build', '-e', 'GOFLAGS=-buildvcs=false', ...mount(stage, '/src', true), '-w', '/src', ...mount(out, '/out'), ...mount(cache, '/cache'), '--entrypoint', args[0], image];
        if (name === 'trivy-image') {
          // The image to scan comes from the local Docker store when it is there,
          // through the Docker socket, so this one runs as the image's own user
          // and writes its SARIF on standard output.
          dargs = ['run', '--rm', '--network', 'bridge', '-v', '/var/run/docker.sock:/var/run/docker.sock', ...mount(cache, '/cache'), '--entrypoint', args[0], image];
        }
        cmd = 'docker';
        cargs = [...dargs, ...args.slice(1)];
      } else if (how === 'uvx') {
        cmd = 'uvx';
        cargs = ['--quiet', '--from', image.slice(4), ...args];
      } else {
        cmd = args[0];
        cargs = args.slice(1);
      }
      const outFd = openSync(toStdout ? file : log, 'w');
      const errFd = toStdout ? openSync(log, 'w') : outFd;
      let status;
      try {
        const [lf, la, extra] = launcher(cmd, cargs);
        const r = spawnSync(lf, la, { cwd: stage, stdio: ['ignore', outFd, errFd], windowsHide: true, ...extra });
        status = r.status ?? (r.error ? 127 : 1);
      } finally {
        closeSync(outFd);
        if (errFd !== outFd) closeSync(errFd);
      }

      // The tool wrote a folder: its one SARIF file becomes <name>.sarif.
      if (existsSync(file) && statSync(file).isDirectory()) {
        const found = readdirSync(file).find((f) => f.endsWith('.sarif') && statSync(join(file, f)).isFile());
        if (found) renameSync(join(file, found), join(out, `${name}.sarif`));
        rmSync(file, { recursive: true, force: true });
        file = join(out, `${name}.sarif`);
      }

      if (status !== 0 || !existsSync(file) || statSync(file).size === 0) {
        // What stopped it, read in its own log: the user gets the cause and what it changes, the log keeps the detail.
        let logText = '';
        try {
          logText = readFileSync(log, 'utf8').slice(-20000);
        } catch {
          /* no log: the exit status is all there is */
        }
        const { why, next } = whyStopped(name, status, logText, { tier, area: toolArea(name, type) });
        record(name, type, tier, '', 'failed', how, `did not finish: ${why}. ${next}`);
        watchTool(name, 'fail', `did not finish: ${why}. ${next}`, '--type', type);
        warn(`${name}: did not finish. ${why[0].toUpperCase()}${why.slice(1)}. ${next} Its log: ${log}`);
        rmSync(file, { force: true });
        failed = true;
        continue;
      }
      rmSync(log, { force: true });
      if (!docker && WIN && file.endsWith('.sarif')) slashUris(file);
      // Opengrep names its rules after the path of its --config: the same ids as
      // the CybeDefend image, whatever the machine (cybedefend.mjs strip-rule-prefix).
      if (bin === 'opengrep') {
        // The prefix is the --config the command gave (the image's own rules
        // folder for the CybeDefend image, the fetched rules otherwise).
        let cfg = rules;
        for (let i = 1; i < args.length; i++) if (args[i - 1] === '--config') cfg = args[i];
        node([join(here, 'cybedefend.mjs'), 'strip-rule-prefix', file, cfg], { stdio: 'ignore' });
      }
      const secs = secondsSince(tTool);
      record(name, type, tier, file, 'ok', how, reason, String(secs));
      if (tier === 'core') coreRan += 1;
      const count = file.endsWith('.sarif') ? resultCount(file) : '';
      watchTool(name, 'done', count, String(secs), '--type', type);
      say(`${name}: done${count ? `, ${count} results` : ''} (${secs} s)`);
    }

    // How much was read, and how long the whole scan took: the board says it.
    try {
      writeFileSync(join(out, 'scan.json'), `${JSON.stringify({ files: files.length, seconds: secondsSince(tScan) })}\n`);
    } catch {
      /* the board does without it */
    }

    // What goes to the dashboard names each rule in words: a tool's own name for a rule is often a path,
    // a code or one word for a whole family (cybedefend.mjs readable-rules). Never a reason to stop.
    node([join(here, 'cybedefend.mjs'), 'readable-rules', '--out', out], { stdio: 'ignore' });

    // Secrets stay in their file: the values Gitleaks located are masked in every
    // tool's results before anything is sent or shown, and their places are said.
    if (node([join(here, 'cybedefend.mjs'), 'redact', '--src', stage, '--out', out], { stdio: ['ignore', 'ignore', 'inherit'] }).status !== 0) {
      warn('scan.mjs: the secrets could not be masked in the results (cybedefend.mjs redact failed): do not print a result file.');
    }

    say(`manifest: ${manifest}`);
    if (coreRan === 0 && coreUnavailable > 0) throw new Exit(3, 'scan.mjs: no core scanner could run here. Start Docker (Docker Desktop or OrbStack), or let the instance scan (cybedefend.mjs instance-scan).');
    return failed ? 2 : 0;
  } finally {
    rmSync(tmp, { recursive: true, force: true, maxRetries: 4, retryDelay: 200 });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (e) => {
      if (e instanceof Exit) {
        if (e.message) process.stderr.write(`${e.message}\n`);
        process.exitCode = e.code;
      } else {
        process.stderr.write(`scan.mjs: ${e?.stack ?? e}\n`);
        process.exitCode = 3;
      }
    },
  );
}
