import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  createFixtureRepo,
  fixtureCommitDate,
  FixtureRepo,
  gitAt,
  hasObject,
  listFiles,
  pseudoRandomBytes,
} from './__fixtures__/fixture-repo';
import {
  fetchBranchHistory,
  fetchStepTimeoutMs,
  FIRST_DEEPEN_STEP,
  nextDepthIncrement,
} from './fetch-branch-history';
import { DEFAULT_GIT_HISTORY_BUDGET_BYTES } from './history-budget';
import * as runGitModule from './run-git';

/**
 * Real git against `file://` fixtures. Budgets are derived from the size of
 * the incompressible blobs the fixtures hold, never from what git's
 * compression happens to produce.
 */

const savedEnv = {
  GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM,
  GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL,
};

function restoreEnv(name: keyof typeof savedEnv): void {
  const value = savedEnv[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

beforeAll(() => {
  // The code under test runs git with this process's environment.
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  process.env.GIT_CONFIG_GLOBAL = os.devNull;
});

afterAll(() => {
  restoreEnv('GIT_CONFIG_NOSYSTEM');
  restoreEnv('GIT_CONFIG_GLOBAL');
});

const cleanups: Array<() => void> = [];
afterEach(() => {
  process.env.GIT_CONFIG_GLOBAL = os.devNull;
  while (cleanups.length > 0) cleanups.pop()?.();
});

function track(repo: FixtureRepo): FixtureRepo {
  cleanups.push(() => repo.cleanup());
  return repo;
}

function scratch(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-history-spec-'));
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function outputDir(): string {
  return path.join(scratch(), 'history.git');
}

function logger() {
  return { log: jest.fn(), warn: jest.fn() };
}

/** Commits of `tip` not reachable from `exclude`, newest first. */
function range(gitDir: string, tip: string, exclude: string[]): string[] {
  const args = [
    'rev-list',
    tip,
    ...(exclude.length ? ['--not', ...exclude] : []),
  ];
  const out = gitAt(gitDir, ...args, '--');
  return out ? out.split('\n') : [];
}

/** Commits of `commits` that are a shallow boundary of `gitDir`. */
function shallowIn(gitDir: string, commits: string[]): string[] {
  const file = path.join(gitDir, 'shallow');
  if (!fs.existsSync(file)) return [];
  const shallow = new Set(fs.readFileSync(file, 'utf8').split('\n'));
  return commits.filter((sha) => shallow.has(sha));
}

/** `count` trees that each change `name`, for a long chain of commits. */
function trees(
  count: number,
  base: Record<string, string | Buffer>,
  name: string,
  label: string,
): Array<Record<string, string | Buffer>> {
  return Array.from({ length: count }, (_, i) => ({
    ...base,
    [name]: `${label}${i + 1}`,
  }));
}

/**
 * Makes the packs the fixture serves trickle out in 16 KiB chunks, one every
 * `chunkDelayMs` (20 ms: about 800 KiB/s), so a fetch is still running when
 * the size poller looks at it. With `fromFetch` = n, the first n - 1 fetches
 * are served at full speed (a counter file counts the packs served). The hook
 * is read from the global configuration, which the fixture's upload-pack
 * inherits.
 */
function slowPackObjectsConfig(
  options: { fromFetch?: number; chunkDelayMs?: number } = {},
): string {
  const { fromFetch = 1, chunkDelayMs = 20 } = options;
  const dir = scratch();
  const throttle = path.join(dir, 'throttle.js');
  fs.writeFileSync(
    throttle,
    [
      "process.stdin.on('data', (buf) => {",
      '  process.stdin.pause();',
      '  let at = 0;',
      '  const next = () => {',
      '    if (at >= buf.length) return process.stdin.resume();',
      '    const part = buf.subarray(at, at + 16384);',
      '    at += 16384;',
      `    process.stdout.write(part, () => setTimeout(next, ${chunkDelayMs}));`,
      '  };',
      '  next();',
      '});',
    ].join('\n'),
  );
  const counter = path.join(dir, 'packs-served');
  const hook = path.join(dir, 'slow-pack-objects.sh');
  fs.writeFileSync(
    hook,
    [
      '#!/bin/sh',
      `n=$(($(cat '${counter}' 2>/dev/null || echo 0) + 1))`,
      `echo "$n" > '${counter}'`,
      `if [ "$n" -lt ${fromFetch} ]; then exec "$@"; fi`,
      `"$@" | '${process.execPath}' '${throttle}'`,
      '',
    ].join('\n'),
    { mode: 0o755 },
  );
  const config = path.join(dir, 'gitconfig');
  fs.writeFileSync(config, `[uploadpack]\n\tpackObjectsHook = ${hook}\n`);
  return config;
}

describe('fetchBranchHistory', () => {
  it('fetches the whole history when it fits the budget (full)', async () => {
    const repo = track(
      createFixtureRepo([
        { 'a.txt': 'one' },
        { 'a.txt': 'two' },
        { 'a.txt': 'three', 'b.txt': 'b' },
      ]),
    );
    const out = outputDir();

    const result = await fetchBranchHistory({
      cloneUrl: repo.url,
      branch: 'main',
      outputDir: out,
      budgetBytes: DEFAULT_GIT_HISTORY_BUDGET_BYTES,
    });

    expect(result).toEqual({
      mode: 'full',
      tipSha: repo.shas[2],
      baseTipSha: null,
      excludeShas: [],
      oldestCommitAt: expect.any(String),
      bytes: expect.any(Number),
      gap: null,
      firstPass: true,
    });
    expect(new Date(result.oldestCommitAt as string).toISOString()).toBe(
      fixtureCommitDate(0),
    );
    expect(gitAt(out, 'rev-parse', '--is-shallow-repository')).toBe('false');
    expect(range(out, 'refs/heads/main', [])).toEqual([...repo.shas].reverse());
    expect(gitAt(out, 'symbolic-ref', 'HEAD')).toBe('refs/heads/main');
    expect(result.bytes).toBeGreaterThan(0);
  });

  it('keeps the most recent commits that fit (partial) and reports the oldest commit date', async () => {
    const old = pseudoRandomBytes(256 * 1024, 'old-vendored-binary');
    const commits: Array<Record<string, string | Buffer>> = [
      { 'vendor.bin': old, 'n.txt': '0' },
    ];
    for (let i = 1; i <= 60; i += 1) commits.push({ 'n.txt': String(i) });
    const repo = track(createFixtureRepo(commits));
    const out = outputDir();
    const budgetBytes = old.length / 2;

    const result = await fetchBranchHistory({
      cloneUrl: repo.url,
      branch: 'main',
      outputDir: out,
      budgetBytes,
    });

    // Depth 1, then 51 (fits), then 151 (reaches the old blob: undone).
    expect(result.mode).toBe('partial');
    expect(result.tipSha).toBe(repo.shas[60]);
    expect(result.excludeShas).toEqual([]);
    expect(result.gap).toBeNull();
    expect(result.firstPass).toBe(true);
    expect(new Date(result.oldestCommitAt as string).toISOString()).toBe(
      fixtureCommitDate(10),
    );
    expect(range(out, repo.shas[60], [])).toEqual(
      repo.shas.slice(10).reverse(),
    );
    expect(hasObject(out, repo.shas[9])).toBe(false);
    expect(gitAt(out, 'rev-parse', '--is-shallow-repository')).toBe('true');
    expect(result.bytes).toBeLessThanOrEqual(budgetBytes);
  });

  it('returns none when the depth-1 snapshot exceeds the budget', async () => {
    const vendored = pseudoRandomBytes(256 * 1024, 'tip-vendored-binary');
    const repo = track(
      createFixtureRepo([
        { 'a.txt': 'a' },
        { 'a.txt': 'a', 'vendor.bin': vendored },
      ]),
    );
    const out = outputDir();
    const budgetBytes = vendored.length / 2;

    const result = await fetchBranchHistory({
      cloneUrl: repo.url,
      branch: 'main',
      outputDir: out,
      budgetBytes,
    });

    expect(result).toEqual({
      mode: 'none',
      tipSha: repo.shas[1],
      baseTipSha: null,
      excludeShas: [],
      oldestCommitAt: null,
      bytes: expect.any(Number),
      gap: null,
      firstPass: true,
    });
    expect(result.bytes).toBeLessThanOrEqual(budgetBytes);
    expect(hasObject(out, repo.shas[1])).toBe(false);
    expect(listFiles(path.join(out, 'objects'))).toEqual([]);
  });

  it('reads only the scanned branch', async () => {
    const repo = track(createFixtureRepo([{ 'a.txt': 'a' }, { 'a.txt': 'b' }]));
    // A commit only another branch and a tag reach: none of its objects may
    // be fetched.
    const secretCommit = repo.commit(
      { 'a.txt': 'a', '.env': 'FEATURE_ONLY_SETTING=reachable-from-feature' },
      { branch: 'feature', parent: repo.shas[0] },
    );
    repo.git('tag', 'v1', secretCommit);
    const out = outputDir();

    const result = await fetchBranchHistory({
      cloneUrl: repo.url,
      branch: 'main',
      outputDir: out,
      budgetBytes: DEFAULT_GIT_HISTORY_BUDGET_BYTES,
    });

    expect(result.mode).toBe('full');
    expect(gitAt(out, 'for-each-ref', '--format=%(refname)')).toBe(
      'refs/heads/main',
    );
    expect(hasObject(out, secretCommit)).toBe(false);
  });

  it('an incremental pass excludes the previous tip', async () => {
    const repo = track(
      createFixtureRepo([
        { 'a.txt': '0' },
        { 'a.txt': '1' },
        { 'a.txt': '2' },
        { 'a.txt': '3' },
      ]),
    );
    const out = outputDir();

    const result = await fetchBranchHistory({
      cloneUrl: repo.url,
      branch: 'main',
      outputDir: out,
      budgetBytes: DEFAULT_GIT_HISTORY_BUDGET_BYTES,
      previousTipSha: repo.shas[1],
    });

    expect(result).toEqual({
      mode: 'incremental',
      tipSha: repo.shas[3],
      baseTipSha: repo.shas[1],
      excludeShas: [repo.shas[1]],
      oldestCommitAt: expect.any(String),
      bytes: expect.any(Number),
      gap: null,
      firstPass: false,
    });
    expect(new Date(result.oldestCommitAt as string).toISOString()).toBe(
      fixtureCommitDate(2),
    );
    expect(range(out, result.tipSha as string, result.excludeShas)).toEqual([
      repo.shas[3],
      repo.shas[2],
    ]);
  });

  it('after a force-push, scans from the merge base', async () => {
    const repo = track(
      createFixtureRepo([
        { 'a.txt': '0' },
        { 'a.txt': '1' },
        { 'a.txt': '2' },
        { 'a.txt': '3' },
        { 'a.txt': '4' },
        { 'a.txt': '5' },
      ]),
    );
    const previousTip = repo.shas[5];
    const rewritten1 = repo.commit({ 'a.txt': 'r1' }, { parent: repo.shas[2] });
    const rewritten2 = repo.commit({ 'a.txt': 'r2' });
    const out = outputDir();

    const result = await fetchBranchHistory({
      cloneUrl: repo.url,
      branch: 'main',
      outputDir: out,
      budgetBytes: DEFAULT_GIT_HISTORY_BUDGET_BYTES,
      previousTipSha: previousTip,
    });

    expect(result).toEqual({
      mode: 'incremental',
      tipSha: rewritten2,
      baseTipSha: previousTip,
      excludeShas: [repo.shas[2]],
      oldestCommitAt: expect.any(String),
      bytes: expect.any(Number),
      gap: null,
      firstPass: false,
    });
    expect(new Date(result.oldestCommitAt as string).toISOString()).toBe(
      fixtureCommitDate(6),
    );
    expect(range(out, rewritten2, result.excludeShas)).toEqual([
      rewritten2,
      rewritten1,
    ]);
  });

  it('records a gap when the budget is hit before the previous tip', async () => {
    const vendored = pseudoRandomBytes(256 * 1024, 'gap-vendored-binary');
    const repo = track(
      createFixtureRepo([
        { 'a.txt': '0' },
        { 'a.txt': '1' },
        { 'a.txt': '2' },
        { 'a.txt': '3', 'vendor.bin': vendored },
        { 'a.txt': '4' },
        { 'a.txt': '5' },
      ]),
    );
    const out = outputDir();
    const budgetBytes = vendored.length / 2;

    const result = await fetchBranchHistory({
      cloneUrl: repo.url,
      branch: 'main',
      outputDir: out,
      budgetBytes,
      previousTipSha: repo.shas[2],
    });

    expect(result).toEqual({
      mode: 'incremental_with_gap',
      tipSha: repo.shas[5],
      baseTipSha: repo.shas[2],
      excludeShas: [],
      oldestCommitAt: expect.any(String),
      bytes: expect.any(Number),
      gap: {
        fromSha: repo.shas[2],
        toSha: repo.shas[5],
        fromDate: expect.any(String),
        toDate: expect.any(String),
      },
      firstPass: false,
    });
    expect(new Date(result.oldestCommitAt as string).toISOString()).toBe(
      fixtureCommitDate(5),
    );
    // The gap's ends carry their committer dates.
    expect(new Date(result.gap?.fromDate as string).toISOString()).toBe(
      fixtureCommitDate(2),
    );
    expect(new Date(result.gap?.toDate as string).toISOString()).toBe(
      fixtureCommitDate(5),
    );
    expect(result.bytes).toBeLessThanOrEqual(budgetBytes);
  });

  it('a previous tip the server no longer has gives a gap, not a dead branch', async () => {
    // The root holds a blob over the budget; 60 commits follow it. The
    // previous tip was never on this server (a force-push it collected).
    const vendored = pseudoRandomBytes(256 * 1024, 'gone-previous-tip');
    const repo = track(
      createFixtureRepo([{ 'a.txt': '0', 'vendor.bin': vendored }]),
    );
    const chain = repo.commitChain(trees(60, {}, 'a.txt', 'c'));
    const tip = chain[59];
    const gone = 'b'.repeat(40);
    const out = outputDir();
    const log = logger();
    const budgetBytes = vendored.length / 2;

    const result = await fetchBranchHistory({
      cloneUrl: repo.url,
      branch: 'main',
      outputDir: out,
      budgetBytes,
      previousTipSha: gone,
      logger: log,
    });

    // The tip alone is deepened within the budget: depth 51 fits, depth 151
    // reaches the root's blob and is undone.
    expect(result).toEqual({
      mode: 'incremental_with_gap',
      tipSha: tip,
      baseTipSha: gone,
      excludeShas: [],
      oldestCommitAt: expect.any(String),
      bytes: expect.any(Number),
      gap: { fromSha: gone, toSha: chain[9], toDate: expect.any(String) },
      firstPass: false,
    });
    expect(new Date(result.gap?.toDate as string).toISOString()).toBe(
      fixtureCommitDate(10),
    );
    expect(range(out, tip, [])).toHaveLength(51);
    expect(result.bytes).toBeLessThanOrEqual(budgetBytes);
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining('previous tip could not be fetched'),
    );
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain(repo.url);
  });

  it('a previous tip the server no longer has, the whole branch within budget, reads the branch whole', async () => {
    const repo = track(
      createFixtureRepo([{ 'a.txt': '0' }, { 'a.txt': '1' }, { 'a.txt': '2' }]),
    );
    const gone = 'c'.repeat(40);
    const out = outputDir();

    const result = await fetchBranchHistory({
      cloneUrl: repo.url,
      branch: 'main',
      outputDir: out,
      budgetBytes: DEFAULT_GIT_HISTORY_BUDGET_BYTES,
      previousTipSha: gone,
      logger: logger(),
    });

    // Every commit of the branch is read: nothing was skipped, so no gap.
    expect(result).toEqual({
      mode: 'incremental',
      tipSha: repo.shas[2],
      baseTipSha: gone,
      excludeShas: [],
      oldestCommitAt: expect.any(String),
      bytes: expect.any(Number),
      gap: null,
      firstPass: false,
    });
    expect(range(out, repo.shas[2], [])).toHaveLength(3);
  });

  it('never leaves a partial pack behind after a killed step', async () => {
    const vendored = pseudoRandomBytes(2 * 1024 ** 2, 'slow-vendored-binary');
    const repo = track(
      createFixtureRepo([
        { 'vendor.bin': vendored, 'a.txt': '0' },
        { 'a.txt': '1' },
        { 'a.txt': '2' },
      ]),
    );
    process.env.GIT_CONFIG_GLOBAL = slowPackObjectsConfig();
    const out = outputDir();
    const budgetBytes = vendored.length / 4;
    const log = logger();

    const result = await fetchBranchHistory({
      cloneUrl: repo.url,
      branch: 'main',
      outputDir: out,
      budgetBytes,
      logger: log,
    });

    expect(result.mode).toBe('partial');
    expect(result.tipSha).toBe(repo.shas[2]);
    // The poller stopped the step while it ran, not after it completed.
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('killed'));
    const leftovers = listFiles(out).filter((file) =>
      /(^|\/)tmp_|\.lock$|\.keep$/.test(file),
    );
    expect(leftovers).toEqual([]);
    expect(
      listFiles(path.join(out, 'objects', 'pack')).filter((f) =>
        f.endsWith('.pack'),
      ),
    ).toHaveLength(1);
    expect(gitAt(out, 'rev-list', '--count', 'refs/heads/main')).toBe('1');
    expect(hasObject(out, repo.shas[0])).toBe(false);
    expect(result.bytes).toBeLessThanOrEqual(budgetBytes);
  }, 30_000);

  it('a step running past the deadline is undone and the pass stops', async () => {
    // The tip is small; the deepening step brings a 4 MiB blob that trickles
    // in for about 5 s, well past the deadline.
    const vendored = pseudoRandomBytes(4 * 1024 ** 2, 'deadline-vendored');
    const repo = track(
      createFixtureRepo([
        { 'vendor.bin': vendored, 'a.txt': '0' },
        { 'a.txt': '1' },
        { 'a.txt': '2' },
      ]),
    );
    process.env.GIT_CONFIG_GLOBAL = slowPackObjectsConfig();
    const out = outputDir();
    const log = logger();

    const startedAt = Date.now();
    const result = await fetchBranchHistory({
      cloneUrl: repo.url,
      branch: 'main',
      outputDir: out,
      budgetBytes: DEFAULT_GIT_HISTORY_BUDGET_BYTES,
      deadlineAt: startedAt + 2500,
      logger: log,
    });

    expect(result.mode).toBe('partial');
    expect(result.tipSha).toBe(repo.shas[2]);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('deadline'));
    // Stopped near the deadline, not once the slow step had completed.
    expect(Date.now() - startedAt).toBeLessThan(4500);
    const leftovers = listFiles(out).filter((file) =>
      /(^|\/)tmp_|\.lock$|\.keep$/.test(file),
    );
    expect(leftovers).toEqual([]);
    expect(gitAt(out, 'rev-list', '--count', 'refs/heads/main')).toBe('1');
    expect(hasObject(out, repo.shas[0])).toBe(false);
  }, 30_000);

  it('an incremental pass cut by the deadline reports the gap', async () => {
    const vendored = pseudoRandomBytes(4 * 1024 ** 2, 'deadline-incremental');
    const repo = track(
      createFixtureRepo([
        { 'a.txt': '0' },
        { 'vendor.bin': vendored, 'a.txt': '1' },
        { 'a.txt': '2' },
        { 'a.txt': '3' },
      ]),
    );
    process.env.GIT_CONFIG_GLOBAL = slowPackObjectsConfig();
    const out = outputDir();

    const result = await fetchBranchHistory({
      cloneUrl: repo.url,
      branch: 'main',
      outputDir: out,
      budgetBytes: DEFAULT_GIT_HISTORY_BUDGET_BYTES,
      previousTipSha: repo.shas[0],
      deadlineAt: Date.now() + 2500,
      logger: logger(),
    });

    expect(result.mode).toBe('incremental_with_gap');
    expect(result.tipSha).toBe(repo.shas[3]);
    expect(result.gap).toEqual({
      fromSha: repo.shas[0],
      toSha: repo.shas[3],
      fromDate: expect.any(String),
      toDate: expect.any(String),
    });
    expect(hasObject(out, repo.shas[1])).toBe(false);
  }, 30_000);

  it('runs no step once the deadline has passed (none)', async () => {
    const repo = track(createFixtureRepo([{ 'a.txt': '0' }]));
    const out = outputDir();

    const result = await fetchBranchHistory({
      cloneUrl: repo.url,
      branch: 'main',
      outputDir: out,
      budgetBytes: DEFAULT_GIT_HISTORY_BUDGET_BYTES,
      deadlineAt: Date.now() - 1,
      logger: logger(),
    });

    expect(result.mode).toBe('none');
    expect(hasObject(out, repo.shas[0])).toBe(false);
  });

  it('a step that runs past its git timeout is undone and the pass stops', async () => {
    // The depth-1 step is served at full speed. The deepening step brings a
    // 2 MiB blob served at about 80 KiB/s (about 26 s), far past the 5 s
    // allowed to each git call: only that step can reach the limit, however
    // slow the machine is.
    const vendored = pseudoRandomBytes(2 * 1024 ** 2, 'timeout-vendored');
    const repo = track(
      createFixtureRepo([
        { 'vendor.bin': vendored, 'a.txt': '0' },
        { 'a.txt': '1' },
      ]),
    );
    process.env.GIT_CONFIG_GLOBAL = slowPackObjectsConfig({
      fromFetch: 2,
      chunkDelayMs: 200,
    });
    const out = outputDir();
    const log = logger();

    const result = await fetchBranchHistory({
      cloneUrl: repo.url,
      branch: 'main',
      outputDir: out,
      budgetBytes: DEFAULT_GIT_HISTORY_BUDGET_BYTES,
      timeoutMs: 5000,
      logger: log,
    });

    // The depth-1 history already on disk is kept, not thrown away.
    expect(result.mode).toBe('partial');
    expect(result.tipSha).toBe(repo.shas[1]);
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining('time limit'),
    );
    const leftovers = listFiles(out).filter((file) =>
      /(^|\/)tmp_|\.lock$|\.keep$/.test(file),
    );
    expect(leftovers).toEqual([]);
    expect(gitAt(out, 'rev-list', '--count', 'refs/heads/main')).toBe('1');
    expect(hasObject(out, repo.shas[0])).toBe(false);
  }, 30_000);

  describe('steps that adapt to the budget left', () => {
    /** Depths of every fetch the pass asked for, in order. */
    function recordDepths(): { depths: number[]; restore: () => void } {
      const depths: number[] = [];
      const original = runGitModule.runGit;
      const spy = jest
        .spyOn(runGitModule, 'runGit')
        .mockImplementation((args, options) => {
          if (args.includes('fetch')) {
            const flag = args.find((arg) => arg.startsWith('--depth='));
            if (flag) depths.push(Number(flag.slice('--depth='.length)));
          }
          return original(args, options);
        });
      return { depths, restore: () => spy.mockRestore() };
    }

    /** 120 commits, each replacing a 4 KiB blob no compressor can shrink. */
    function steadyHistory(seed: string): {
      repo: FixtureRepo;
      blobBytes: number;
    } {
      const blobBytes = 4 * 1024;
      const commits = Array.from({ length: 120 }, (_, i) => ({
        'blob.bin': pseudoRandomBytes(blobBytes, `${seed}-${i}`),
      }));
      return { repo: track(createFixtureRepo(commits)), blobBytes };
    }

    it('a step that is large compared to the remaining budget makes the next step smaller', async () => {
      const { repo, blobBytes } = steadyHistory('adaptive-first-pass');
      // The first 51 levels take about two thirds of the budget: doubling
      // would ask for 151 levels next (the whole branch, over the budget).
      const budgetBytes = 75 * blobBytes;
      const recorder = recordDepths();
      const out = outputDir();
      let result: Awaited<ReturnType<typeof fetchBranchHistory>>;
      try {
        result = await fetchBranchHistory({
          cloneUrl: repo.url,
          branch: 'main',
          outputDir: out,
          budgetBytes,
        });
      } finally {
        recorder.restore();
      }

      const { depths } = recorder;
      expect(depths.slice(0, 2)).toEqual([1, 1 + FIRST_DEEPEN_STEP]);
      expect(depths[2] - depths[1]).toBeGreaterThanOrEqual(1);
      expect(depths[2] - depths[1]).toBeLessThan(FIRST_DEEPEN_STEP);
      expect(result.mode).toBe('partial');
      // The budget left after 51 levels is used, not wasted.
      expect(
        Number(gitAt(out, 'rev-list', '--count', 'refs/heads/main')),
      ).toBeGreaterThan(1 + FIRST_DEEPEN_STEP);
      expect(result.bytes).toBeLessThanOrEqual(budgetBytes);
    }, 30_000);

    it('the incremental deepening adapts its steps the same way', async () => {
      const { repo, blobBytes } = steadyHistory('adaptive-incremental');
      const budgetBytes = 75 * blobBytes;
      const recorder = recordDepths();
      const out = outputDir();
      let result: Awaited<ReturnType<typeof fetchBranchHistory>>;
      try {
        result = await fetchBranchHistory({
          cloneUrl: repo.url,
          branch: 'main',
          outputDir: out,
          budgetBytes,
          previousTipSha: repo.shas[0],
        });
      } finally {
        recorder.restore();
      }

      // The tip and the previous tip at depth 1, then both together.
      const { depths } = recorder;
      expect(depths.slice(0, 3)).toEqual([1, 1, 1 + FIRST_DEEPEN_STEP]);
      expect(depths[3] - depths[2]).toBeGreaterThanOrEqual(1);
      expect(depths[3] - depths[2]).toBeLessThan(FIRST_DEEPEN_STEP);
      expect(result.mode).toBe('incremental_with_gap');
      expect(
        Number(gitAt(out, 'rev-list', '--count', 'refs/heads/main')),
      ).toBeGreaterThan(1 + FIRST_DEEPEN_STEP);
      expect(result.bytes).toBeLessThanOrEqual(budgetBytes);
    }, 30_000);
  });

  it('reads a merged branch longer than one step whole, with no shallow commit in the range', async () => {
    // prev = c3. A branch of 80 commits forked at c1 is merged on top of it:
    // at depth 51 prev is already the merge base, but the merged branch is
    // still cut at its 31st commit.
    const repo = track(
      createFixtureRepo([
        { 'a.txt': '0', '.env': 'OLD_SECRET=0ld0ld0ld0ld' },
        { 'a.txt': '1' },
        { 'a.txt': '2' },
        { 'a.txt': '3' },
      ]),
    );
    const previousTip = repo.shas[3];
    const feature = repo.commitChain(
      trees(80, { 'a.txt': '1' }, 'f.txt', 'f'),
      {
        branch: 'feature',
        parent: repo.shas[1],
      },
    );
    const tip = repo.commit(
      { 'a.txt': '3', 'f.txt': 'f80' },
      { parent: previousTip, merge: [feature[79]] },
    );
    const out = outputDir();

    const result = await fetchBranchHistory({
      cloneUrl: repo.url,
      branch: 'main',
      outputDir: out,
      budgetBytes: DEFAULT_GIT_HISTORY_BUDGET_BYTES,
      previousTipSha: previousTip,
    });

    expect(result.mode).toBe('incremental');
    expect(result.excludeShas).toEqual([previousTip]);
    expect(result.gap).toBeNull();
    const scanned = range(out, tip, result.excludeShas);
    expect(scanned.sort()).toEqual(
      repo.git('rev-list', tip, '--not', previousTip).split('\n').sort(),
    );
    expect(scanned).toHaveLength(81);
    expect(shallowIn(out, scanned)).toEqual([]);
  });

  it('does not stop at an older merge base while the previous tip is out of reach', async () => {
    // prev = c2, then 99 commits on main. A short branch forked at c1 is
    // merged at the tip: c1 is a merge base long before prev is reached.
    const repo = track(
      createFixtureRepo([{ 'a.txt': '0' }, { 'a.txt': '1' }, { 'a.txt': '2' }]),
    );
    const previousTip = repo.shas[2];
    const side = repo.commitChain(trees(15, { 'a.txt': '1' }, 'm.txt', 'm'), {
      branch: 'side',
      parent: repo.shas[1],
    });
    const main = repo.commitChain(trees(99, {}, 'a.txt', 'p'));
    const tip = repo.commit(
      { 'a.txt': 'p99', 'm.txt': 'm15' },
      { parent: main[98], merge: [side[14]] },
    );
    const out = outputDir();

    const result = await fetchBranchHistory({
      cloneUrl: repo.url,
      branch: 'main',
      outputDir: out,
      budgetBytes: DEFAULT_GIT_HISTORY_BUDGET_BYTES,
      previousTipSha: previousTip,
    });

    expect(result.mode).toBe('incremental');
    expect(result.excludeShas).toEqual([previousTip]);
    const scanned = range(out, tip, result.excludeShas);
    expect(scanned.sort()).toEqual(
      repo.git('rev-list', tip, '--not', previousTip).split('\n').sort(),
    );
    expect(scanned).toHaveLength(115);
    expect(shallowIn(out, scanned)).toEqual([]);
  });

  it('records a gap when the budget runs out while the range is still cut', async () => {
    const vendored = pseudoRandomBytes(256 * 1024, 'merged-branch-binary');
    const repo = track(
      createFixtureRepo([
        { 'a.txt': '0' },
        { 'a.txt': '1' },
        { 'a.txt': '2' },
        { 'a.txt': '3' },
      ]),
    );
    const previousTip = repo.shas[3];
    const branchTrees = trees(80, { 'a.txt': '1' }, 'f.txt', 'f');
    branchTrees[4] = { ...branchTrees[4], 'vendor.bin': vendored };
    const feature = repo.commitChain(branchTrees, {
      branch: 'feature',
      parent: repo.shas[1],
    });
    const tip = repo.commit(
      { 'a.txt': '3', 'f.txt': 'f80' },
      { parent: previousTip, merge: [feature[79]] },
    );
    const out = outputDir();
    const budgetBytes = vendored.length / 2;

    const result = await fetchBranchHistory({
      cloneUrl: repo.url,
      branch: 'main',
      outputDir: out,
      budgetBytes,
      previousTipSha: previousTip,
    });

    // Depth 51 fits and reaches prev; depth 151 reaches f5's blob: undone.
    // The merged branch is cut at f31, so f6..f30 were never analysed.
    expect(result).toEqual({
      mode: 'incremental_with_gap',
      tipSha: tip,
      baseTipSha: previousTip,
      excludeShas: [previousTip],
      oldestCommitAt: expect.any(String),
      bytes: expect.any(Number),
      gap: {
        fromSha: previousTip,
        toSha: feature[30],
        fromDate: expect.any(String),
        toDate: expect.any(String),
      },
      firstPass: false,
    });
    expect(new Date(result.oldestCommitAt as string).toISOString()).toBe(
      fixtureCommitDate(4 + 30),
    );
    expect(new Date(result.gap?.fromDate as string).toISOString()).toBe(
      fixtureCommitDate(3),
    );
    expect(new Date(result.gap?.toDate as string).toISOString()).toBe(
      fixtureCommitDate(4 + 30),
    );
    expect(result.bytes).toBeLessThanOrEqual(budgetBytes);
  });

  it('the clone URL never appears in an error', async () => {
    const token = 'ghs_TopSecretToken0123456789';
    const cloneUrl = `https://x-access-token:${token}@127.0.0.1:1/owner/repo.git`;

    const error = await fetchBranchHistory({
      cloneUrl,
      branch: 'main',
      outputDir: outputDir(),
      budgetBytes: DEFAULT_GIT_HISTORY_BUDGET_BYTES,
      timeoutMs: 20_000,
    }).then(
      () => null,
      (err: unknown) => err,
    );

    expect(error).toBeInstanceOf(Error);
    const text = `${(error as Error).message}\n${(error as Error).stack}`;
    expect(text).not.toContain(token);
    expect(text).not.toContain(cloneUrl);
  }, 30_000);

  it('refuses a previous tip that is not a commit id', async () => {
    const repo = track(createFixtureRepo([{ 'a.txt': 'a' }]));

    await expect(
      fetchBranchHistory({
        cloneUrl: repo.url,
        branch: 'main',
        outputDir: outputDir(),
        budgetBytes: DEFAULT_GIT_HISTORY_BUDGET_BYTES,
        previousTipSha: '--upload-pack=touch /tmp/pwned',
      }),
    ).rejects.toThrow(/previousTipSha/);
  });
});

describe('nextDepthIncrement', () => {
  it('aims the next step at half of the budget left', () => {
    // 50 levels took 200 bytes; 100 bytes are left: aim at 50, i.e. 13 levels.
    expect(nextDepthIncrement(50, 200, 900, 1000)).toBe(13);
  });

  it('never more than doubles the step', () => {
    expect(nextDepthIncrement(50, 10, 100, 1_000_000)).toBe(100);
    expect(nextDepthIncrement(50, 0, 0, 1000)).toBe(100);
  });

  it('never goes below one level', () => {
    expect(nextDepthIncrement(50, 5000, 999, 1000)).toBe(1);
    expect(nextDepthIncrement(3, 100, 1000, 1000)).toBe(1);
  });
});

describe('fetchStepTimeoutMs', () => {
  it('is the per-call timeout without a deadline', () => {
    expect(fetchStepTimeoutMs(600_000, undefined, 1000)).toBe(600_000);
  });

  it('is the time left to the deadline when that comes first', () => {
    expect(fetchStepTimeoutMs(600_000, 1000 + 90_000, 1000)).toBe(90_000);
    expect(fetchStepTimeoutMs(600_000, 1000 + 900_000, 1000)).toBe(600_000);
  });

  it('is at least 1 ms', () => {
    expect(fetchStepTimeoutMs(600_000, 500, 1000)).toBe(1);
  });
});
