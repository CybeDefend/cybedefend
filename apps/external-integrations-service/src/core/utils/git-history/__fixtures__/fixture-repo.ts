import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Test-only git repositories, served as `file://` URLs.
 *
 * Commits are written with `git fast-import` in one process, with fixed author
 * and committer dates, so a history of sixty commits costs one spawn and every
 * run produces the same dates. Each commit is given as the COMPLETE tree of
 * that commit: a path left out of a commit is deleted by it.
 */

export type FixtureFiles = Record<string, string | Buffer>;

export interface FixtureCommitOptions {
  /** Branch to move to the new commit (default: the fixture's branch). */
  branch?: string;
  /**
   * Parent of the new commit. `undefined`: the branch's current tip (none
   * when the branch does not exist yet). `null`: an orphan commit. A sha that
   * is not the branch's tip moves the branch like a force-push.
   */
  parent?: string | null;
  /** Further parents: the new commit merges them into the first one. */
  merge?: string[];
}

export interface FixtureRepo {
  /** `file://` URL of the bare repository. */
  url: string;
  /** Path of the bare repository. */
  dir: string;
  /** The commits given to {@link createFixtureRepo}, oldest first. */
  shas: string[];
  /** Adds one commit and returns its sha. */
  commit(files: FixtureFiles, options?: FixtureCommitOptions): string;
  /**
   * Adds a chain of commits (one fast-import run), the first one on
   * `options.parent`, and returns their shas, oldest first.
   */
  commitChain(trees: FixtureFiles[], options?: FixtureCommitOptions): string[];
  /** Runs git in the fixture repository and returns its trimmed stdout. */
  git(...args: string[]): string;
  cleanup(): void;
}

export interface FixtureRepoOptions {
  objectFormat?: 'sha1' | 'sha256';
}

/** 2020-01-01T00:00:00Z: the date of the first commit of every fixture. */
const BASE_EPOCH_SECONDS = Date.UTC(2020, 0, 1) / 1000;
const DAY_SECONDS = 86_400;

/** The committer date of a fixture's n-th commit (0-based), as ISO-8601. */
export function fixtureCommitDate(index: number): string {
  return new Date(
    (BASE_EPOCH_SECONDS + index * DAY_SECONDS) * 1000,
  ).toISOString();
}

/**
 * Git environment of the fixtures and of the specs: no system or user
 * configuration, so a developer's settings cannot change what a test sees.
 */
export function isolatedGitEnv(
  overrides: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: os.devNull,
    ...overrides,
  };
}

/** Runs git against `gitDir` (isolated config) and returns its trimmed stdout. */
export function gitAt(gitDir: string, ...args: string[]): string {
  return execFileSync('git', ['--git-dir', gitDir, ...args], {
    env: isolatedGitEnv(),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

/** `true` when `gitDir` holds the object `sha`. */
export function hasObject(gitDir: string, sha: string): boolean {
  try {
    gitAt(gitDir, 'cat-file', '-e', `${sha}^{object}`);
    return true;
  } catch {
    return false;
  }
}

/** Every file under `root`, as a sorted list of `/`-separated relative paths. */
export function listFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), rel);
      else out.push(rel);
    }
  };
  if (fs.existsSync(root)) walk(root, '');
  return out.sort();
}

/** Deterministic bytes that no compressor can shrink. */
export function pseudoRandomBytes(size: number, seed: string): Buffer {
  const out = Buffer.alloc(size);
  let offset = 0;
  for (let counter = 0; offset < size; counter += 1) {
    const block = createHash('sha256').update(`${seed}:${counter}`).digest();
    offset += block.copy(out, offset);
  }
  return out;
}

/** `true` when the local git can create a SHA-256 repository. */
export function canInitSha256(): boolean {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-sha256-probe-'));
  try {
    execFileSync(
      'git',
      ['init', '--quiet', '--bare', '--object-format=sha256', dir],
      { env: isolatedGitEnv(), stdio: 'ignore' },
    );
    return true;
  } catch {
    return false;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function commitBlock(
  ref: string,
  index: number,
  files: FixtureFiles,
  from: string | null,
  mark?: number,
  merge: string[] = [],
): Buffer {
  const when = `${BASE_EPOCH_SECONDS + index * DAY_SECONDS} +0000`;
  const message = Buffer.from(`commit ${index}\n`);
  const parts: Buffer[] = [
    Buffer.from(
      `commit ${ref}\n` +
        (mark !== undefined ? `mark :${mark}\n` : '') +
        `author Fixture <fixture@example.invalid> ${when}\n` +
        `committer Fixture <fixture@example.invalid> ${when}\n` +
        `data ${message.length}\n`,
    ),
    message,
  ];
  if (from) parts.push(Buffer.from(`from ${from}\n`));
  for (const other of merge) parts.push(Buffer.from(`merge ${other}\n`));
  parts.push(Buffer.from('deleteall\n'));
  for (const [file, content] of Object.entries(files)) {
    if (/[\n"]/.test(file)) throw new Error(`unsupported fixture path ${file}`);
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content);
    parts.push(
      Buffer.from(`M 100644 inline ${file}\ndata ${data.length}\n`),
      data,
      Buffer.from('\n'),
    );
  }
  parts.push(Buffer.from('\n'));
  return Buffer.concat(parts);
}

/**
 * A bare repository holding `commits` on `branch`, oldest first.
 *
 * It accepts a `want` of any object it holds, like GitHub and GitLab do, so a
 * previous tip can be fetched by sha after a force-push.
 */
export function createFixtureRepo(
  commits: Array<Record<string, string | Buffer>>,
  branch = 'main',
  options: FixtureRepoOptions = {},
): FixtureRepo {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'git-history-fixture-'));
  const dir = path.join(root, 'origin.git');
  const env = isolatedGitEnv();
  const git = (...args: string[]): string =>
    execFileSync('git', ['--git-dir', dir, ...args], {
      env,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    }).trim();
  const fastImport = (stream: Buffer): void => {
    execFileSync(
      'git',
      ['--git-dir', dir, 'fast-import', '--quiet', '--force'],
      {
        env,
        input: stream,
        stdio: ['pipe', 'ignore', 'pipe'],
      },
    );
  };

  execFileSync(
    'git',
    [
      'init',
      '--quiet',
      '--bare',
      ...(options.objectFormat === 'sha256' ? ['--object-format=sha256'] : []),
      dir,
    ],
    { env, stdio: 'ignore' },
  );
  git('symbolic-ref', 'HEAD', `refs/heads/${branch}`);
  git('config', 'uploadpack.allowAnySHA1InWant', 'true');

  let nextIndex = 0;
  if (commits.length > 0) {
    const blocks = commits.map((files, i) =>
      commitBlock(
        `refs/heads/${branch}`,
        nextIndex + i,
        files,
        i === 0 ? null : `:${i}`,
        i + 1,
      ),
    );
    fastImport(Buffer.concat(blocks));
    nextIndex += commits.length;
  }
  const shas =
    commits.length > 0
      ? git('rev-list', '--reverse', `refs/heads/${branch}`).split('\n')
      : [];

  return {
    url: pathToFileURL(dir).href,
    dir,
    shas,
    git,
    commit(files, commitOptions = {}) {
      return this.commitChain([files], commitOptions)[0];
    },
    commitChain(trees, commitOptions = {}) {
      const ref = `refs/heads/${commitOptions.branch ?? branch}`;
      let parent = commitOptions.parent;
      if (parent === undefined) {
        try {
          parent = git('rev-parse', '--verify', '--quiet', ref);
        } catch {
          parent = null;
        }
      }
      const blocks = trees.map((files, i) =>
        commitBlock(
          ref,
          nextIndex + i,
          files,
          i === 0 ? parent : `:${i}`,
          i + 1,
          i === 0 ? (commitOptions.merge ?? []) : [],
        ),
      );
      fastImport(Buffer.concat(blocks));
      nextIndex += trees.length;
      return git(
        'rev-list',
        '--first-parent',
        `--max-count=${trees.length}`,
        ref,
      )
        .split('\n')
        .reverse();
    },
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}
