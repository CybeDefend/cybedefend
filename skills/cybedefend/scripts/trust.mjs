// What the skill may believe of the repository it runs in. Anything under
// .cybedefend/ can arrive with a clone, a pull or a branch checkout, written by
// whoever wrote that repository: a verdict, a process id, a project id or a
// link found there is never taken as the user's own. What the skill itself
// wrote on this machine is remembered outside the repository, under
// CYBEDEFEND_APPSEC_HOME (default ~/.cybedefend/appsec), where a commit cannot
// reach, and a file of the repository is trusted only when its content is the
// content remembered there. Whether git tracks a file plays no part in it: the
// repository decides how a path is spelled and where a link leads.
//
// The repository's own git configuration is not the user's either: every git
// command of the skill goes through gitArgs(), which turns off what a
// configuration can make git run.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { devNull, homedir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

/** The user's own folder of the skill, outside every repository. */
export const appsecHome = (env = process.env) => env.CYBEDEFEND_APPSEC_HOME || join(homedir(), '.cybedefend', 'appsec');

/** The real path, spelled as the file system holds it (case included); the path itself when it does not exist. */
export const realOr = (path) => {
  try {
    return realpathSync.native(path);
  } catch {
    return resolve(path);
  }
};

// ─── git, hardened ──────────────────────────────────────────────────────────
//
// A repository's .git/config can name programs that plain git commands run:
// a file system monitor (core.fsmonitor, run by status), hooks, a pager, the
// clean, smudge and process filters of its attributes, the textconv and
// command of a diff driver, an external diff. A clone never copies that file,
// but a repository handed over as a folder or an archive carries it. Each git
// command of the skill turns them off:
//   --no-pager, -c core.fsmonitor=false, -c core.untrackedCache=false,
//   -c core.hooksPath=<the null device>, -c protocol.allow=never,
//   -c credential.helper= , -c core.askPass= ,
//   and, for every filter, diff or merge driver the repository's own
//   configuration (with what it includes) defines, an empty clean, smudge,
//   process, textconv, command and driver, which git reads as none;
// with GIT_OPTIONAL_LOCKS=0 (status writes nothing) and GIT_TERMINAL_PROMPT=0.
// The skill's diff commands add --no-ext-diff and --no-textconv. The skill
// never runs a git command that runs hooks (commit, merge, checkout, push).
// What is left: the user's own global and system configuration, which are
// the user's; and a driver named in a configuration file that the repository
// adds through an environment variable, which is the user's environment.

const BASE = ['--no-pager', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', '-c', `core.hooksPath=${devNull}`, '-c', 'protocol.allow=never', '-c', 'credential.helper=', '-c', 'core.askPass='];
const DRIVER_KEYS = /^(filter|diff|merge)\.(.+)\.(clean|smudge|process|textconv|command|driver)$/i;
const drivers = new Map();

/** The environment of every git command of the skill. */
export const gitEnv = (env = process.env) => ({ ...env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat' });

/** The options git is run with for `cwd`: the base list, and every driver of the repository's own configuration emptied. */
export function gitArgs(cwd = process.cwd()) {
  const key = realOr(cwd);
  if (!drivers.has(key)) {
    let names = [];
    try {
      names = execFileSync('git', [...BASE, 'config', '--local', '--includes', '--name-only', '--get-regexp', '^(filter|diff|merge)\\.'], { cwd, encoding: 'utf8', env: gitEnv(), stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true })
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => DRIVER_KEYS.test(l));
    } catch {
      /* no repository here, or nothing defined: nothing to empty */
    }
    // Each kind of command a driver can name, emptied for every driver the repository defines.
    const named = [...new Set(names.map((n) => n.replace(DRIVER_KEYS, '$1.$2')))];
    drivers.set(key, named.flatMap((d) => ['clean', 'smudge', 'process', 'textconv', 'command', 'driver'].flatMap((k) => ['-c', `${d}.${k}=`])));
  }
  return [...BASE, ...drivers.get(key)];
}

/** Runs git in `cwd` with the hardened options. Same options as execFileSync; throws as it does. */
export function runGit(args, { cwd = process.cwd(), ...opts } = {}) {
  return execFileSync('git', [...gitArgs(cwd), ...args], { cwd, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true, ...opts, env: gitEnv(opts.env) });
}

// ─── What this machine wrote ────────────────────────────────────────────────

/** This machine's notes on one repository: a folder named after the repository's real path. */
export function machineDir(root, env = process.env) {
  return join(appsecHome(env), 'repositories', createHash('sha256').update(realOr(root)).digest('hex').slice(0, 32));
}

export const sha256 = (text) => createHash('sha256').update(text).digest('hex');

/** Remembers that this machine wrote `content` as the repository's file `name`. */
export function remember(root, name, content) {
  const dir = machineDir(root);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, `${name.replace(/[\\/]/g, '__')}.sha256`), `${sha256(content)}\n`, { mode: 0o600 });
}

/** True when `content` is exactly what this machine last wrote as `name` for this repository. */
export function remembered(root, name, content) {
  try {
    return readFileSync(join(machineDir(root), `${name.replace(/[\\/]/g, '__')}.sha256`), 'utf8').trim() === sha256(content);
  } catch {
    return false;
  }
}

/** A small JSON note of this machine on the repository (null when there is none). */
export function readNote(root, name) {
  const file = join(machineDir(root), name);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function writeNote(root, name, doc) {
  const dir = machineDir(root);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, name), `${JSON.stringify(doc, null, 2)}\n`, { mode: 0o600 });
}

// ─── Paths ──────────────────────────────────────────────────────────────────

/** `inner` is `outer` or under it, both real paths; compared without case on macOS and Windows, whose disks ignore it by default. */
export function within(outer, inner) {
  const fold = process.platform === 'darwin' || process.platform === 'win32' ? (p) => p.toLowerCase() : (p) => p;
  const rel = relative(fold(outer), fold(inner));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * The real path of a file of the repository, or null when it leaves it: a
 * symbolic link to a file of the user's home is not a file of the repository.
 */
export function insideRoot(root, file) {
  let real;
  let top;
  try {
    real = realpathSync.native(isAbsolute(file) ? file : join(root, file));
    top = realpathSync.native(root);
  } catch {
    return null;
  }
  return within(top, real) ? real : null;
}

/** The folders of the skill in a repository, and the files it reads or writes there by name. */
const TREE = ['.cybedefend', join('.cybedefend', 'out'), join('.cybedefend', 'audit')];
const NAMES = ['.cybedefend', 'out', 'audit', 'config.json', 'live.json', 'triage.json', 'map.md', 'last.sarif', '.gitignore', 'audit.sarif', 'findings.json', 'run.json', 'manifest.tsv', 'verdict.json'];

export class TreeRefused extends Error {}

/**
 * Refuses a repository whose .cybedefend tree the skill cannot trust to be
 * where it looks: .cybedefend, a folder or a file under it that is a symbolic
 * link, a folder that resolves outside the repository, a name that is one the
 * skill uses spelled with other letter cases (on macOS and Windows it is the
 * same file), or a CYBEDEFEND_APPSEC_HOME inside the repository. Each read,
 * write and delete of the skill under .cybedefend then stays in the
 * repository. Throws TreeRefused.
 */
export function guardTree(root, env = process.env) {
  const top = realOr(root);
  const refuse = (what) => {
    throw new TreeRefused(`${what}. A repository can commit it to make the skill read, write or delete files elsewhere, or take files it did not write for its own: nothing was read or changed. Remove it (it is not the skill's), then run the command again.`);
  };
  if (within(top, realOr(appsecHome(env)))) refuse(`CYBEDEFEND_APPSEC_HOME (${appsecHome(env)}) is inside the repository`);
  for (const rel of TREE) {
    const parent = join(top, rel, '..');
    const name = rel.split(sep).pop();
    let entries = [];
    try {
      entries = readdirSync(parent);
    } catch {
      continue; // the parent does not exist: nothing below it either
    }
    const variant = entries.find((e) => e !== name && e.toLowerCase() === name.toLowerCase());
    if (variant) refuse(`${join(relative(top, parent), variant) || variant} is ${rel} spelled another way`);
    if (!entries.includes(name)) continue;
    const st = lstatSync(join(top, rel));
    if (st.isSymbolicLink()) refuse(`${rel} is a symbolic link`);
    if (!st.isDirectory()) refuse(`${rel} is not a folder`);
    if (realOr(join(top, rel)) !== join(top, rel)) refuse(`${rel} resolves outside the repository`);
  }
  // Every entry of the tree: no link, no name of the skill in another case.
  const walk = (dir, depth) => {
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const path = join(dir, e.name);
      if (e.isSymbolicLink()) refuse(`${relative(top, path)} is a symbolic link`);
      const named = NAMES.find((n) => n.toLowerCase() === e.name.toLowerCase());
      if (named && named !== e.name) refuse(`${relative(top, path)} is ${named} spelled another way`);
      if (e.isDirectory() && depth < 6) walk(path, depth + 1);
    }
  };
  walk(join(top, '.cybedefend'), 0);
}

/**
 * The root of the repository the command runs in: git's answer, which must
 * hold the working folder (a configuration that moves the work tree elsewhere
 * is refused), with its .cybedefend tree checked (guardTree).
 */
export function trustedRoot(cwd = process.cwd()) {
  const root = realOr(resolve(String(runGit(['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' })).trim()));
  if (!within(root, realOr(cwd))) throw new TreeRefused(`git names ${root} as the repository's root, which does not hold the working folder: its configuration moves the work tree elsewhere. Nothing was read or changed.`);
  guardTree(root);
  return root;
}
