import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  canInitSha256,
  createFixtureRepo,
  FixtureRepo,
  gitAt,
  isolatedGitEnv,
  listFiles,
} from './__fixtures__/fixture-repo';
import { fetchBranchHistory } from './fetch-branch-history';
import { DEFAULT_GIT_HISTORY_BUDGET_BYTES } from './history-budget';
import { writeHistoryTar } from './history-tar';

const savedEnv = {
  GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM,
  GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL,
};

beforeAll(() => {
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  process.env.GIT_CONFIG_GLOBAL = os.devNull;
});

afterAll(() => {
  for (const [name, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

function track(repo: FixtureRepo): FixtureRepo {
  cleanups.push(() => repo.cleanup());
  return repo;
}

function scratch(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-history-tar-spec-'));
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function tarEntries(tarPath: string): string[] {
  return execFileSync('tar', ['-tf', tarPath], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .map((name) => name.replace(/^\.\//, ''))
    .sort();
}

/** Extracts `tarPath` into an empty `<dir>/.git`, as the scanner pod does. */
function extractAsGitDir(tarPath: string): string {
  const gitDir = path.join(scratch(), '.git');
  fs.mkdirSync(gitDir);
  execFileSync('tar', ['-xf', tarPath, '-C', gitDir]);
  return gitDir;
}

/** `git log -p` the way the history pass runs it: no network, no stderr. */
function logRange(gitDir: string, tip: string, exclude: string[]) {
  const result = spawnSync(
    'git',
    [
      '-c',
      'protocol.allow=never',
      '--git-dir',
      gitDir,
      'log',
      '-p',
      '--no-textconv',
      '--no-ext-diff',
      '--format=commit %H',
      tip,
      ...(exclude.length ? ['--not', ...exclude] : []),
      '--',
    ],
    { env: isolatedGitEnv(), encoding: 'utf8' },
  );
  const commits = result.stdout
    .split('\n')
    .filter((line) => line.startsWith('commit '))
    .map((line) => line.slice('commit '.length));
  return { ...result, commits };
}

describe('writeHistoryTar', () => {
  it('the tar holds only HEAD, shallow, refs and packs', async () => {
    const repo = track(
      createFixtureRepo([{ 'a.txt': '0' }, { 'a.txt': '1' }, { 'a.txt': '2' }]),
    );
    const repoDir = path.join(scratch(), 'repo.git');
    execFileSync('git', ['init', '--quiet', '--bare', repoDir], {
      env: isolatedGitEnv(),
    });
    gitAt(
      repoDir,
      '-c',
      'fetch.unpackLimit=1',
      'fetch',
      '--quiet',
      '--depth=2',
      '--',
      repo.url,
      '+refs/heads/main:refs/heads/main',
    );
    const packDir = path.join(repoDir, 'objects', 'pack');
    const packs = listFiles(packDir).filter((f) => /\.(pack|idx)$/.test(f));
    const packName = packs[0].replace(/\.(pack|idx)$/, '');
    // What a repository carries besides what the scanner needs.
    const junk: Record<string, string> = {
      'packed-refs': '# pack-refs with: peeled fully-peeled sorted \n',
      description: 'unnamed repository\n',
      'hooks/post-update': '#!/bin/sh\nexit 0\n',
      'info/exclude': '*.tmp\n',
      FETCH_HEAD: `${repo.shas[2]}\t\tbranch 'main' of ${repo.url}\n`,
      'logs/HEAD': 'reflog\n',
      'objects/info/alternates': '/elsewhere/objects\n',
      [`objects/pack/${packName}.keep`]: 'kept\n',
      [`objects/pack/${packName}.rev`]: 'rev\n',
      'objects/pack/tmp_pack_abc123': 'partial\n',
      'shallow.lock': 'lock\n',
      'refs/heads/main.lock': 'lock\n',
    };
    for (const [rel, content] of Object.entries(junk)) {
      const file = path.join(repoDir, rel);
      // git 2.41+ already wrote the `.rev` (read-only): keep it.
      if (fs.existsSync(file)) continue;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
    }
    const tarPath = path.join(scratch(), 'history.tar');

    const bytes = await writeHistoryTar(repoDir, tarPath);

    expect(bytes).toBe(fs.statSync(tarPath).size);
    const entries = tarEntries(tarPath);
    expect(entries.filter((e) => !e.endsWith('/'))).toEqual(
      [
        'HEAD',
        'packed-refs',
        'refs/heads/main',
        'shallow',
        ...packs.map((p) => `objects/pack/${p}`),
      ].sort(),
    );
    for (const dir of entries.filter((e) => e.endsWith('/'))) {
      expect(['objects/', 'objects/pack/', 'refs/', 'refs/heads/']).toContain(
        dir,
      );
    }
  });

  it('a small incremental fetch is fully readable from the tar alone', async () => {
    const repo = track(
      createFixtureRepo([
        { 'a.txt': '0' },
        { 'a.txt': '1' },
        { 'a.txt': '2', 'b.txt': 'b' },
        { 'a.txt': '3', 'b.txt': 'b' },
      ]),
    );
    const repoDir = path.join(scratch(), 'history.git');
    const pass = await fetchBranchHistory({
      cloneUrl: repo.url,
      branch: 'main',
      outputDir: repoDir,
      budgetBytes: DEFAULT_GIT_HISTORY_BUDGET_BYTES,
      previousTipSha: repo.shas[1],
    });
    expect(pass.mode).toBe('incremental');
    const tarPath = path.join(scratch(), 'history.tar');

    await writeHistoryTar(repoDir, tarPath);
    fs.rmSync(repoDir, { recursive: true, force: true });
    const gitDir = extractAsGitDir(tarPath);
    const log = logRange(gitDir, pass.tipSha as string, pass.excludeShas);

    expect(log.stderr).toBe('');
    expect(log.status).toBe(0);
    expect(log.commits).toEqual([repo.shas[3], repo.shas[2]]);
    expect(log.stdout).toContain('diff --git a/a.txt b/a.txt');
  });

  (canInitSha256() ? it : it.skip)(
    'the tar carries the object format of a sha256 repository',
    async () => {
      const repo = track(
        createFixtureRepo([{ 'a.txt': '0' }, { 'a.txt': '1' }], 'main', {
          objectFormat: 'sha256',
        }),
      );
      const repoDir = path.join(scratch(), 'history.git');
      const pass = await fetchBranchHistory({
        cloneUrl: repo.url,
        branch: 'main',
        outputDir: repoDir,
        budgetBytes: DEFAULT_GIT_HISTORY_BUDGET_BYTES,
      });
      expect(pass.mode).toBe('full');
      expect(pass.tipSha).toMatch(/^[0-9a-f]{64}$/);
      const tarPath = path.join(scratch(), 'history.tar');

      await writeHistoryTar(repoDir, tarPath);

      expect(tarEntries(tarPath)).toContain('config');
      const gitDir = extractAsGitDir(tarPath);
      expect(fs.readFileSync(path.join(gitDir, 'config'), 'utf8')).toMatch(
        /objectformat = sha256/,
      );
      const log = logRange(gitDir, pass.tipSha as string, []);
      expect(log.stderr).toBe('');
      expect(log.status).toBe(0);
      expect(log.commits).toEqual([repo.shas[1], repo.shas[0]]);
    },
  );

  it('refuses a repository holding loose objects, which the tar would drop', async () => {
    const repoDir = path.join(scratch(), 'repo.git');
    execFileSync('git', ['init', '--quiet', '--bare', repoDir], {
      env: isolatedGitEnv(),
    });
    execFileSync(
      'git',
      ['--git-dir', repoDir, 'hash-object', '-w', '--stdin'],
      {
        env: isolatedGitEnv(),
        input: 'a loose blob\n',
      },
    );

    await expect(
      writeHistoryTar(repoDir, path.join(scratch(), 'history.tar')),
    ).rejects.toThrow(/loose/);
  });
});
