// Where the skill's scripts meet the operating system: macOS, Linux, Windows
// (PowerShell, cmd or Git Bash) and WSL. Every script starts its programs and
// opens its pages through these helpers, so none of them needs bash, and the
// agent runs each one with `node` whatever the shell it was given.

import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

/**
 * What of a repository the scanners read, as a git pathspec: everything git
 * sees but CybeDefend's own files, this skill where `npx skills add` put it
 * in the repository (.claude/skills/cybedefend and the like), and the AI
 * scanner's proof tests (proofs.md says where they go), which hold test
 * passwords and attack inputs on purpose: they would only add noise.
 */
export const SCANNED = [
  '--', '.',
  ':(exclude).cybedefend',
  ':(exclude,glob).*/skills/cybedefend', ':(exclude,glob).*/skills/cybedefend/**', ':(exclude)skills-lock.json',
  ':(exclude,glob)**/tests/security/**', ':(exclude,glob)**/test/security/**', ':(exclude,glob)**/test_security_*',
  ':(exclude,glob)**/*.security.test.*', ':(exclude,glob)**/*_security_test.go', ':(exclude,glob)**/*security_spec.rb',
];

/** Linux under WSL: the Windows side holds the browser and the clipboard. */
export function isWsl(env = process.env, platform = process.platform) {
  if (platform !== 'linux') return false;
  if (env.WSL_DISTRO_NAME || env.WSL_INTEROP) return true;
  try {
    return /microsoft/i.test(readFileSync('/proc/version', 'utf8'));
  } catch {
    return false;
  }
}

/** A variable read the way Windows reads it: its name in any case (Path, PATH). */
export function envValue(env, name) {
  if (env[name] !== undefined) return env[name];
  const key = Object.keys(env).find((k) => k.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : env[key];
}

function isFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** The full path of a program on the PATH, with the PATHEXT endings on Windows; null when there is none. */
export function which(cmd, { env = process.env, platform = process.platform } = {}) {
  const win = platform === 'win32';
  const exts = win ? String(envValue(env, 'PATHEXT') || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean) : [''];
  const names = win && extname(cmd) ? [cmd] : exts.map((e) => cmd + e.toLowerCase());
  if (cmd.includes('/') || (win && cmd.includes('\\'))) return names.find(isFile) ?? null;
  for (const dir of String(envValue(env, 'PATH') ?? '').split(win ? ';' : ':').filter(Boolean)) {
    for (const name of names) if (isFile(join(dir, name))) return join(dir, name);
  }
  return null;
}

// cmd.exe's metacharacters. A batch file parses its arguments a second time
// when it hands them on with %* (what npm's claude.cmd, npm.cmd or npx.cmd
// do), so they are escaped twice.
const CMD_META = /([()\][%!^"`<>&|;, *?])/g;

function cmdQuote(arg) {
  let s = String(arg);
  s = s.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1');
  return `"${s}"`.replace(CMD_META, '^$1').replace(CMD_META, '^$1');
}

/**
 * How to start a program without a shell: [file, args, options] for spawn.
 * As it is on macOS and Linux and for a Windows .exe. A Windows batch file
 * (.cmd, .bat) only starts through cmd.exe, so its arguments are quoted for it.
 */
export function launcher(cmd, args = [], { env = process.env, platform = process.platform } = {}) {
  if (platform !== 'win32') return [cmd, args, {}];
  const file = which(cmd, { env, platform });
  if (!file) return [cmd, args, {}];
  if (!/\.(cmd|bat)$/i.test(file)) return [file, args, {}];
  const line = [file.replace(CMD_META, '^$1'), ...args.map(cmdQuote)].join(' ');
  return [envValue(env, 'ComSpec') || 'cmd.exe', ['/d', '/s', '/c', `"${line}"`], { windowsVerbatimArguments: true }];
}

/** spawnSync through launcher(): { status, stdout, stderr, error }. Never throws. */
export function runFile(cmd, args = [], opts = {}) {
  const [file, fargs, extra] = launcher(cmd, args, { env: opts.env ?? process.env });
  const r = spawnSync(file, fargs, { encoding: 'utf8', windowsHide: true, ...opts, ...extra });
  return { status: r.status ?? (r.error ? 127 : 1), stdout: r.stdout ?? '', stderr: r.stderr ?? '', error: r.error ?? null };
}

/** A Linux path of WSL as Windows sees it (\\wsl.localhost\...), or null. */
export function wslWindowsPath(path) {
  const r = spawnSync('wslpath', ['-w', path], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

/**
 * The command that opens a page or a file in the user's browser: open on
 * macOS (-g keeps the terminal in front), explorer on Windows, wslview or
 * the Windows explorer on WSL (a Linux path given as Windows sees it), and
 * xdg-open on Linux.
 */
export function openCommand(target, { platform = process.platform, wsl = isWsl(process.env, platform), background = false, has = (c) => which(c) !== null, windowsPath = wslWindowsPath } = {}) {
  if (platform === 'darwin') return ['open', background ? ['-g', target] : [target]];
  if (platform === 'win32') return ['explorer', [target]];
  if (wsl) {
    if (has('wslview')) return ['wslview', [target]];
    const isUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(target);
    return ['explorer.exe', [isUrl ? target : (windowsPath(target) ?? target)]];
  }
  return ['xdg-open', [target]];
}

/** The programs that put text on the clipboard, in the order they are tried. */
export function clipboardTools({ platform = process.platform, wsl = isWsl(process.env, platform) } = {}) {
  if (platform === 'darwin') return [['pbcopy', []]];
  if (platform === 'win32') return [['clip', []]];
  const linux = [['wl-copy', []], ['xclip', ['-selection', 'clipboard']], ['xsel', ['--clipboard', '--input']]];
  return wsl ? [['clip.exe', []], ...linux] : linux;
}
