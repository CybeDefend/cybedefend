import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import type { Logger as PinoLogger } from 'nestjs-pino';
import { resolveGitHistoryTimeoutMs } from './history-budget';
import { GitCommandError, runGit, RunGitOptions } from './run-git';

/** How often a running fetch's repository is measured. */
export const SIZE_POLL_INTERVAL_MS = 500;

/**
 * Levels added by the first deepening step. Each next step is sized from the
 * bytes the last one added ({@link nextDepthIncrement}).
 */
export const FIRST_DEEPEN_STEP = 50;

/** Deepest `--depth` git accepts below its "infinite" marker. */
const MAX_DEPTH = 0x7ffffffe;

/** A commit id, SHA-1 or SHA-256. */
const COMMIT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/**
 * Configuration of every fetch:
 * - `unpackLimit=1`: git explodes a fetch of fewer than 100 objects into loose
 *   objects, and the history tar only carries packs (`history-tar.ts`). With 1
 *   every fetch is kept as a pack, so a small incremental fetch stays readable.
 * - no auto gc / maintenance: a repack after a step would delete the packs the
 *   rollback of a later step restores to.
 * - no credential helper: the token in the URL is never stored or asked for.
 */
const FETCH_CONFIG = [
  '-c',
  'protocol.version=2',
  '-c',
  'fetch.unpackLimit=1',
  '-c',
  'transfer.unpackLimit=1',
  '-c',
  'gc.auto=0',
  '-c',
  'maintenance.auto=false',
  '-c',
  'fetch.writeCommitGraph=false',
  '-c',
  'credential.helper=',
];

export interface FetchBranchHistoryOptions {
  /** Authenticated URL. Never logged; redacted from every error. */
  cloneUrl: string;
  branch: string;
  /** Absent or empty directory that receives the bare repository. */
  outputDir: string;
  /** Bytes the repository may occupy on disk. */
  budgetBytes: number;
  /** Tip of the branch at its last successful history pass (the cursor). */
  previousTipSha?: string | null;
  /** Per git call. Defaults to GIT_HISTORY_TIMEOUT_MS, or 600 000. */
  timeoutMs?: number;
  /**
   * Epoch ms after which no fetch step runs. A step still running then is
   * killed and undone like a step over the budget, and the pass ends with
   * what it has (`partial`, `incremental_with_gap`, or `none` when the tip
   * itself was not fetched).
   */
  deadlineAt?: number;
  logger?: Pick<PinoLogger, 'log' | 'warn'>;
}

export interface FetchedBranchHistory {
  mode: 'full' | 'partial' | 'incremental' | 'incremental_with_gap' | 'none';
  /** Tip of the branch scanned (also given for `none` when it is known). */
  tipSha: string | null;
  /** `previousTipSha`, or `null` on a first pass. */
  baseTipSha: string | null;
  /** Revisions the secret scanner excludes (`--not`). */
  excludeShas: string[];
  /** Committer date of the oldest commit in the scanned range. */
  oldestCommitAt: string | null;
  /** Size of the repository on disk. */
  bytes: number;
  /**
   * Commits between the previous tip and `toSha` that were not fetched, with
   * the committer date (ISO-8601) of each end when the repository holds it.
   */
  gap: {
    fromSha: string;
    toSha: string;
    fromDate?: string;
    toDate?: string;
  } | null;
  firstPass: boolean;
}

/** One fetch step undone: the repository as it was before the step. */
interface RepoSnapshot {
  files: Set<string>;
  /** Files a fetch rewrites in place, with their content. */
  mutable: Map<string, Buffer>;
}

interface PassContext {
  options: FetchBranchHistoryOptions;
  dir: string;
  git: (args: string[], extra?: Partial<RunGitOptions>) => Promise<string>;
  timeoutMs: number;
}

/** Sum of the sizes of the files under `dir`. */
export async function directoryBytes(dir: string): Promise<number> {
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw err;
  }
  let total = 0;
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += await directoryBytes(full);
      continue;
    }
    try {
      total += (await fsp.lstat(full)).size;
    } catch (err) {
      // A temporary file renamed between readdir and lstat.
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }
  return total;
}

async function listRepoFiles(root: string, rel = ''): Promise<string[]> {
  const entries = await fsp.readdir(path.join(root, rel), {
    withFileTypes: true,
  });
  const out: string[] = [];
  for (const entry of entries) {
    const child = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(await listRepoFiles(root, child)));
    else out.push(child);
  }
  return out;
}

function isMutable(rel: string): boolean {
  return (
    rel === 'HEAD' ||
    rel === 'shallow' ||
    rel === 'packed-refs' ||
    rel.startsWith('refs/')
  );
}

async function takeSnapshot(dir: string): Promise<RepoSnapshot> {
  const files = new Set(await listRepoFiles(dir));
  const mutable = new Map<string, Buffer>();
  for (const rel of files) {
    if (isMutable(rel)) {
      mutable.set(rel, await fsp.readFile(path.join(dir, rel)));
    }
  }
  return { files, mutable };
}

/**
 * Puts the repository back as it was before a step: every file the step
 * created goes (the incoming `tmp_pack_*`, a pack completed just before the
 * kill, `.keep`, `shallow.lock` and any other `*.lock`), and `shallow` and the
 * refs get their previous content. The repository stays at its previous
 * depth.
 */
async function rollback(dir: string, before: RepoSnapshot): Promise<void> {
  for (const rel of await listRepoFiles(dir)) {
    if (!before.files.has(rel)) {
      await fsp.rm(path.join(dir, rel), { force: true });
    }
  }
  for (const [rel, content] of before.mutable) {
    await fsp.writeFile(path.join(dir, rel), content);
  }
}

async function readShallow(dir: string): Promise<string> {
  try {
    return await fsp.readFile(path.join(dir, 'shallow'), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw err;
  }
}

function pastDeadline(options: FetchBranchHistoryOptions): boolean {
  return options.deadlineAt !== undefined && Date.now() >= options.deadlineAt;
}

/** A fetch step kept: the repository's size after it, and what it added. */
interface StepKept {
  bytes: number;
  addedBytes: number;
}

/**
 * One fetch, watched, within the budget and in time.
 *
 * - Every {@link SIZE_POLL_INTERVAL_MS} the repository is measured, and past
 *   the budget the fetch is killed. A fetch that completes between two polls
 *   is measured once more.
 * - It may run for {@link fetchStepTimeoutMs}: the per-call timeout, or the
 *   time left before the deadline when that is sooner. Past it the fetch is
 *   killed.
 *
 * A step killed or over the budget is undone and `null` is returned: the
 * repository stays at its previous depth and the pass ends with what it has.
 * It never throws for that; only another git failure does. Once the deadline
 * has passed, no step starts.
 */
async function fetchStep(
  ctx: PassContext,
  depth: number,
  refspecs: string[],
): Promise<StepKept | null> {
  const { dir, options } = ctx;
  if (pastDeadline(options)) {
    options.logger?.warn(
      `[git-history] fetch at depth ${depth} not started: the history ` +
        `deadline has passed`,
    );
    return null;
  }
  const before = await takeSnapshot(dir);
  const bytesBefore = await directoryBytes(dir);
  const timeoutMs = fetchStepTimeoutMs(
    ctx.timeoutMs,
    options.deadlineAt,
    Date.now(),
  );
  // Set by the poller, so not narrowed by the compiler.
  let stopReason = 'budget' as 'budget' | 'deadline';
  let stopped: boolean;
  try {
    const result = await runGit(
      [
        ...FETCH_CONFIG,
        '--git-dir',
        dir,
        'fetch',
        '--quiet',
        '--no-tags',
        '--no-write-fetch-head',
        '--no-recurse-submodules',
        `--depth=${depth}`,
        // Everything after `--` is a repository and refspecs, never an option
        // such as --upload-pack, whatever the URL starts with.
        '--',
        options.cloneUrl,
        ...refspecs,
      ],
      {
        label: 'fetch',
        timeoutMs,
        cloneUrl: options.cloneUrl,
        pollIntervalMs: SIZE_POLL_INTERVAL_MS,
        shouldStop: async () => {
          if (pastDeadline(options)) {
            stopReason = 'deadline';
            return true;
          }
          return (await directoryBytes(dir)) > options.budgetBytes;
        },
      },
    );
    stopped = result.stopped;
  } catch (err) {
    await rollback(dir, before).catch((rollbackErr: Error) =>
      options.logger?.warn(
        `[git-history] could not undo a failed fetch: ${rollbackErr.message}`,
      ),
    );
    if (err instanceof GitCommandError && err.timedOut) {
      options.logger?.warn(
        `[git-history] fetch at depth ${depth} killed: it ran past its ` +
          `${timeoutMs} ms time limit` +
          (timeoutMs < ctx.timeoutMs ? ' (the history deadline)' : '') +
          '; step undone',
      );
      return null;
    }
    throw err;
  }

  if (stopped) {
    await rollback(dir, before);
    options.logger?.warn(
      stopReason === 'deadline'
        ? `[git-history] fetch at depth ${depth} killed: still running at ` +
            `the history deadline; step undone`
        : `[git-history] fetch at depth ${depth} killed: the repository ` +
            `passed the ${options.budgetBytes}-byte budget while it ran; ` +
            `step undone`,
    );
    return null;
  }
  const bytes = await directoryBytes(dir);
  if (bytes > options.budgetBytes) {
    await rollback(dir, before);
    options.logger?.warn(
      `[git-history] fetch at depth ${depth} left ${bytes} bytes, over the ` +
        `${options.budgetBytes}-byte budget; step undone`,
    );
    return null;
  }
  return { bytes, addedBytes: Math.max(0, bytes - bytesBefore) };
}

async function isShallow(ctx: PassContext): Promise<boolean> {
  const out = await ctx.git(['rev-parse', '--is-shallow-repository']);
  return out.trim() === 'true';
}

/** The merge base of `a` and `b`, or `null` when the repository has none. */
async function mergeBase(
  ctx: PassContext,
  a: string,
  b: string,
): Promise<string | null> {
  try {
    return (await ctx.git(['merge-base', a, b])).trim() || null;
  } catch (err) {
    if (err instanceof GitCommandError && err.exitCode === 1) return null;
    throw err;
  }
}

/** `true` when `ancestor` is reachable from `descendant` in the repository. */
async function isAncestor(
  ctx: PassContext,
  ancestor: string,
  descendant: string,
): Promise<boolean> {
  try {
    await ctx.git(['merge-base', '--is-ancestor', ancestor, descendant]);
    return true;
  } catch (err) {
    if (err instanceof GitCommandError && err.exitCode === 1) return false;
    throw err;
  }
}

interface OldestCommit {
  sha: string;
  date: string;
}

interface RangeScan {
  /** The commit of the range with the oldest committer date. */
  oldest: OldestCommit | null;
  /**
   * `true` when a commit of the range is a shallow boundary: its parents
   * were not fetched, so the range misses commits and that boundary would be
   * read as a snapshot (every file added).
   */
  cut: boolean;
}

/** Walks `tip --not exclude`, the range the secret scanner reads. */
async function scanRange(
  ctx: PassContext,
  tip: string,
  exclude: string[],
): Promise<RangeScan> {
  const shallow = new Set(
    (await readShallow(ctx.dir)).split('\n').filter(Boolean),
  );
  let oldest: (OldestCommit & { epoch: number }) | null = null;
  let cut = false;
  await ctx.git(
    [
      'rev-list',
      '--format=%ct %H %cI',
      tip,
      ...(exclude.length ? ['--not', ...exclude] : []),
      '--',
    ],
    {
      // One line per commit: streamed, a 2 GiB history can hold millions.
      onLine: (line) => {
        if (!line || line.startsWith('commit ')) return;
        const [epochText, sha, date] = line.split(' ');
        const epoch = Number(epochText);
        if (!sha || !date || !Number.isFinite(epoch)) return;
        if (shallow.has(sha)) cut = true;
        if (oldest === null || epoch <= oldest.epoch) {
          oldest = { sha, date, epoch };
        }
      },
    },
  );
  const found = oldest as (OldestCommit & { epoch: number }) | null;
  return {
    oldest: found ? { sha: found.sha, date: found.date } : null,
    cut,
  };
}

/**
 * What the scanner excludes: the previous tip when it is an ancestor of the
 * tip, else (a force-push) the merge base of the two, else nothing known yet.
 * Each is reachable from the previous tip, so already scanned.
 */
async function exclusion(
  ctx: PassContext,
  tip: string,
  previousTip: string,
): Promise<string[] | null> {
  if (await isAncestor(ctx, previousTip, tip)) return [previousTip];
  const base = await mergeBase(ctx, tip, previousTip);
  return base ? [base] : null;
}

function nextDepth(depth: number, step: number): number {
  return Math.min(depth + step, MAX_DEPTH);
}

/**
 * Levels the next deepening step asks for, after a step that added
 * `stepBytes` for `increment` levels and left the repository at `bytes`.
 *
 * Levels are not commits: on a history with many merges one level can carry
 * thousands of commits, so doubling blindly overshoots the budget by far. The
 * next step aims at about half of what the budget has left, assuming the next
 * levels weigh what the last ones did, and never more than doubles.
 */
export function nextDepthIncrement(
  increment: number,
  stepBytes: number,
  bytes: number,
  budgetBytes: number,
): number {
  const target = Math.max(0, budgetBytes - bytes) / 2;
  const scaled = Math.round((increment * target) / Math.max(1, stepBytes));
  return Math.min(Math.max(scaled, 1), increment * 2);
}

/**
 * Time allowed to one fetch step: the per-call timeout, or what is left
 * before the overall deadline when that comes first (at least 1 ms).
 */
export function fetchStepTimeoutMs(
  timeoutMs: number,
  deadlineAt: number | undefined,
  now: number,
): number {
  if (deadlineAt === undefined) return timeoutMs;
  return Math.max(1, Math.min(timeoutMs, deadlineAt - now));
}

function noneResult(
  tipSha: string,
  previousTipSha: string | null,
): FetchedBranchHistory {
  return {
    mode: 'none',
    tipSha,
    baseTipSha: previousTipSha,
    excludeShas: [],
    oldestCommitAt: null,
    bytes: 0,
    gap: null,
    firstPass: previousTipSha === null,
  };
}

/**
 * Deepens the tip, already fetched at depth 1, alone: 50 levels, then steps
 * sized on what the budget has left ({@link nextDepthIncrement}), until its
 * history is whole (`full`) or a step is undone at the budget, the deadline
 * or its time limit (`partial`).
 */
async function deepenTip(
  ctx: PassContext,
  tip: string,
): Promise<'full' | 'partial'> {
  let depth = 1;
  let increment = FIRST_DEEPEN_STEP;
  for (;;) {
    if (!(await isShallow(ctx))) return 'full';
    const target = nextDepth(depth, increment);
    const shallowBefore = await readShallow(ctx.dir);
    // The tip is fetched by its id, so a push during the pass cannot move it.
    const kept = await fetchStep(ctx, target, [tip]);
    if (!kept) return 'partial';
    if ((await readShallow(ctx.dir)) === shallowBefore) {
      throw new Error('git fetch did not deepen the history');
    }
    increment = nextDepthIncrement(
      target - depth,
      kept.addedBytes,
      kept.bytes,
      ctx.options.budgetBytes,
    );
    depth = target;
  }
}

/** Committer date (ISO-8601) of a commit, or undefined when it is absent. */
async function commitDate(
  ctx: PassContext,
  sha: string,
): Promise<string | undefined> {
  try {
    const out = await ctx.git(['show', '-s', '--format=%cI', sha, '--']);
    return out.trim() || undefined;
  } catch (err) {
    if (err instanceof GitCommandError && err.exitCode !== null) {
      return undefined;
    }
    throw err;
  }
}

/**
 * First pass: the tip's snapshot, then deeper and deeper ({@link deepenTip})
 * until the history is whole or a step is undone. When the snapshot itself is
 * undone (budget, deadline or time limit), the mode is `none`.
 */
async function firstPass(
  ctx: PassContext,
  remoteTip: string,
): Promise<FetchedBranchHistory> {
  const { branch } = ctx.options;
  const ref = `refs/heads/${branch}`;
  if (!(await fetchStep(ctx, 1, [`+${ref}:${ref}`]))) {
    return noneResult(remoteTip, null);
  }
  const tip = (await ctx.git(['rev-parse', '--verify', ref])).trim();
  const mode = await deepenTip(ctx, tip);

  const { oldest } = await scanRange(ctx, tip, []);
  return {
    mode,
    tipSha: tip,
    baseTipSha: null,
    excludeShas: [],
    oldestCommitAt: oldest?.date ?? null,
    bytes: 0,
    gap: null,
    firstPass: true,
  };
}

/**
 * Incremental pass: the tip and the previous tip, each at depth 1, then both
 * deeper (50 levels, then steps sized on what the budget has left, see
 * {@link nextDepthIncrement}) until the range `tip --not <exclusion>` is
 * whole, or a step is undone at the budget, the deadline or its time limit.
 *
 * A merge base alone proves nothing in a shallow repository: a merged branch
 * can still be cut inside the range (its boundary would be read as a
 * snapshot and the commits below it skipped), and an older merge base can
 * show up through a short merged branch before the previous tip is reached.
 * So the pass goes on until no commit of the range is a shallow boundary.
 *
 * Depths are absolute (`--depth`), not relative (`--deepen`): the server only
 * deepens relative to boundaries reachable from its own refs, and after a
 * force-push the previous tip is reachable from none of them.
 */
async function incrementalPass(
  ctx: PassContext,
  remoteTip: string,
  previousTip: string,
): Promise<FetchedBranchHistory> {
  const { branch } = ctx.options;
  const ref = `refs/heads/${branch}`;
  if (!(await fetchStep(ctx, 1, [`+${ref}:${ref}`]))) {
    return noneResult(remoteTip, previousTip);
  }
  const tip = (await ctx.git(['rev-parse', '--verify', ref])).trim();

  let previousPresent = tip === previousTip;
  if (!previousPresent) {
    try {
      previousPresent = (await fetchStep(ctx, 1, [previousTip])) !== null;
    } catch (err) {
      if (!(err instanceof GitCommandError)) throw err;
      // The server no longer has it (a force-push it has since collected),
      // or will not send it. Nothing ties the tip to it: the tip alone is
      // read as deep as the budget allows, and what lies below is a gap.
      ctx.options.logger?.warn(
        `[git-history] the previous tip could not be fetched, the branch ` +
          `is read from its tip alone: ${err.message}`,
      );
      await deepenTip(ctx, tip);
    }
  }
  let exclude: string[] | null = null;
  let range: RangeScan | null = null;
  let depth = 1;
  let increment = FIRST_DEEPEN_STEP;
  let shallowBefore: string | null = null;
  // Without the previous tip (over budget on its own) nothing can be excluded.
  while (previousPresent) {
    exclude = await exclusion(ctx, tip, previousTip);
    range = exclude ? await scanRange(ctx, tip, exclude) : null;
    if (range && !range.cut) break;

    const shallowNow = await readShallow(ctx.dir);
    // Nothing left to fetch, or the last step brought nothing.
    if (shallowNow.trim() === '' || shallowNow === shallowBefore) break;
    shallowBefore = shallowNow;
    const target = nextDepth(depth, increment);
    // Undone (budget, deadline, time limit): `exclude` and `range` still hold.
    const kept = await fetchStep(ctx, target, [tip, previousTip]);
    if (!kept) break;
    increment = nextDepthIncrement(
      target - depth,
      kept.addedBytes,
      kept.bytes,
      ctx.options.budgetBytes,
    );
    depth = target;
  }

  if (exclude && range && !range.cut) {
    return {
      mode: 'incremental',
      tipSha: tip,
      baseTipSha: previousTip,
      excludeShas: exclude,
      oldestCommitAt: range.oldest?.date ?? null,
      bytes: 0,
      gap: null,
      firstPass: false,
    };
  }

  const scanned = exclude && range ? range : await scanRange(ctx, tip, []);
  if (!exclude && !scanned.cut) {
    // The whole branch is here and nothing ties it to the previous tip (an
    // unrelated history was pushed): all of it is read, nothing is skipped.
    return {
      mode: 'incremental',
      tipSha: tip,
      baseTipSha: previousTip,
      excludeShas: [],
      oldestCommitAt: scanned.oldest?.date ?? null,
      bytes: 0,
      gap: null,
      firstPass: false,
    };
  }
  // The range is still cut: the commits below its oldest one, down to the
  // previous tip, were not fetched.
  const toSha = scanned.oldest?.sha ?? tip;
  const gap: FetchedBranchHistory['gap'] = { fromSha: previousTip, toSha };
  const fromDate = await commitDate(ctx, previousTip);
  const toDate = scanned.oldest?.date ?? (await commitDate(ctx, toSha));
  if (fromDate) gap.fromDate = fromDate;
  if (toDate) gap.toDate = toDate;
  return {
    mode: 'incremental_with_gap',
    tipSha: tip,
    baseTipSha: previousTip,
    excludeShas: exclude ?? [],
    oldestCommitAt: scanned.oldest?.date ?? null,
    bytes: 0,
    gap,
    firstPass: false,
  };
}

async function remoteBranchTip(
  options: FetchBranchHistoryOptions,
  timeoutMs: number,
): Promise<string> {
  const ref = `refs/heads/${options.branch}`;
  const { stdout } = await runGit(
    [
      '-c',
      'protocol.version=2',
      '-c',
      'credential.helper=',
      'ls-remote',
      '--',
      options.cloneUrl,
      ref,
    ],
    { label: 'ls-remote', timeoutMs, cloneUrl: options.cloneUrl },
  );
  for (const line of stdout.split('\n')) {
    const [sha, name] = line.trim().split('\t');
    if (name === ref && sha && COMMIT_ID.test(sha)) return sha;
  }
  throw new Error(`fetchBranchHistory: branch ${options.branch} not found`);
}

async function assertEmptyOrAbsent(dir: string): Promise<void> {
  try {
    const entries = await fsp.readdir(dir);
    if (entries.length > 0) {
      throw new Error(`fetchBranchHistory: outputDir is not empty: ${dir}`);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}

/**
 * Fetches the history of one branch into a bare repository at `outputDir`,
 * within `budgetBytes` on disk.
 *
 * Only `refs/heads/<branch>` is read: no other branch, no tag, no pull or
 * merge request ref. The URL is never written to disk (no remote, no
 * FETCH_HEAD) and every object is kept in a pack.
 *
 * - Without `previousTipSha` (first pass): `full` when the whole history fits,
 *   `partial` with the most recent commits that fit, `none` when the tip's
 *   snapshot alone does not.
 * - With it (incremental pass): `incremental` with `excludeShas` = the
 *   previous tip, or the merge base after a force-push, once no commit of
 *   `tip --not excludeShas` is a shallow boundary; `incremental_with_gap`
 *   when the budget runs out first (`excludeShas` then holds what is already
 *   known to be scanned, possibly nothing). A previous tip the server will
 *   not send is not an error: the tip alone is deepened within the budget,
 *   nothing is excluded, and the commits below the oldest one fetched are
 *   the gap (`incremental` when the whole branch fits).
 *
 * Each fetch step runs within the budget and within its time limit (the
 * per-call timeout, or the time left before `deadlineAt` when sooner). A step
 * that crosses either is undone and ends the pass with what it has; it never
 * throws. Steps start at 50 levels, then aim at about half of the budget left.
 *
 * Any other failure throws (the caller records mode `none`), after removing
 * `outputDir`.
 */
export async function fetchBranchHistory(
  options: FetchBranchHistoryOptions,
): Promise<FetchedBranchHistory> {
  const timeoutMs = options.timeoutMs ?? resolveGitHistoryTimeoutMs();
  const previousTip = options.previousTipSha ?? null;
  if (previousTip !== null && !COMMIT_ID.test(previousTip)) {
    throw new Error('fetchBranchHistory: previousTipSha is not a commit id');
  }
  await runGit(['check-ref-format', `refs/heads/${options.branch}`], {
    label: 'check-ref-format',
    timeoutMs,
  }).catch((err: unknown) => {
    if (err instanceof GitCommandError && err.exitCode !== null) {
      throw new Error('fetchBranchHistory: invalid branch name');
    }
    throw err;
  });
  await assertEmptyOrAbsent(options.outputDir);

  const remoteTip = await remoteBranchTip(options, timeoutMs);
  const dir = options.outputDir;
  const ctx: PassContext = {
    options,
    dir,
    timeoutMs,
    git: async (args, extra = {}) =>
      (
        await runGit(['--git-dir', dir, ...args], {
          label: args[0],
          timeoutMs,
          cloneUrl: options.cloneUrl,
          ...extra,
        })
      ).stdout,
  };

  try {
    await runGit(
      [
        'init',
        '--quiet',
        '--bare',
        // No hooks, no description, no sample files.
        '--template=',
        ...(remoteTip.length === 64 ? ['--object-format=sha256'] : []),
        '--',
        dir,
      ],
      { label: 'init', timeoutMs },
    );
    await ctx.git(['symbolic-ref', 'HEAD', `refs/heads/${options.branch}`]);

    const result = previousTip
      ? await incrementalPass(ctx, remoteTip, previousTip)
      : await firstPass(ctx, remoteTip);
    result.bytes = await directoryBytes(dir);
    options.logger?.log(
      `[git-history] ${result.mode} history of the branch fetched: ` +
        `${result.bytes} bytes`,
    );
    return result;
  } catch (err) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw err;
  }
}
