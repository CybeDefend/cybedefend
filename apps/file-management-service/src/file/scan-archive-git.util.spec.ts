import {
  GitConfigScanner,
  SAFE_GIT_CONFIG_ENTRY,
  buildSafeGitConfig,
  gitEntryDecision,
} from './scan-archive-git.util';

describe('scan archive .git sanitising', () => {
  describe('gitEntryDecision', () => {
    it.each([
      '.git/HEAD',
      '.git/packed-refs',
      '.git/shallow',
      '.git/refs/heads/main',
      '.git/refs/tags/v1.0.0',
      '.git/objects/4f/0123456789abcdef',
      '.git/objects/pack/pack-abc.pack',
      '.git/objects/pack/pack-abc.idx',
      '.git/reftable/tables.list',
    ])('keeps the history data %s', (entry) => {
      expect(gitEntryDecision(entry)).toBe('keep');
    });

    it('routes the repository config to the rewrite', () => {
      expect(gitEntryDecision(SAFE_GIT_CONFIG_ENTRY)).toBe('config');
    });

    it.each([
      // hooks run on git commands
      '.git/hooks/pre-commit',
      '.git/hooks/post-checkout',
      '.git/hooks/fsmonitor-watchman.sample',
      // attributes select diff / filter drivers defined in a config
      '.git/info/attributes',
      '.git/info/exclude',
      '.git/info/grafts',
      // submodule and worktree configs, read by git as well
      '.git/modules/lib/config',
      '.git/modules/lib/hooks/pre-commit',
      '.git/worktrees/w/config.worktree',
      '.git/config.worktree',
      '.git/commondir',
      // object stores outside the archive
      '.git/objects/info/alternates',
      '.git/objects/info/http-alternates',
      // anything else under .git
      '.git/description',
      '.git/index',
      '.git/FETCH_HEAD',
      '.git/logs/HEAD',
      '.git/COMMIT_EDITMSG',
      // a .git FILE points git at another directory
      '.git',
      // a nested or differently cased .git is never forwarded
      'sub/.git/config',
      'sub/.git/hooks/pre-commit',
      'repo-main/.git/HEAD',
      'vendor/lib/.git',
      '.GIT/config',
      '.Git/hooks/pre-commit',
    ])('drops %s', (entry) => {
      expect(gitEntryDecision(entry)).toBe('drop');
    });

    it.each([
      'src/app.ts',
      '.gitignore',
      '.gitattributes',
      '.github/workflows/ci.yml',
      'docs/.gitkeep',
      'git/config.ts',
    ])('leaves %s to the ordinary filter', (entry) => {
      expect(gitEntryDecision(entry)).toBeNull();
    });
  });

  describe('buildSafeGitConfig', () => {
    const malicious = [
      '[core]',
      '\trepositoryformatversion = 0',
      '\tfsmonitor = "sh -c id"',
      '\thooksPath = /tmp/evil',
      '\tsshCommand = sh -c id',
      '\tpager = sh -c id',
      '[diff "evil"]',
      '\ttextconv = sh -c id',
      '[filter "evil"]',
      '\tclean = sh -c id',
      '\tsmudge = sh -c id',
      '[include]',
      '\tpath = /etc/evil',
      '[alias]',
      '\tlog = !sh -c id',
      '[remote "origin"]',
      '\turl = https://token@example.com/repo.git',
    ].join('\n');

    it('keeps nothing of the repository config but its format', () => {
      const out = buildSafeGitConfig(malicious);
      expect(out).toBe(
        '[core]\n\trepositoryformatversion = 0\n\tbare = false\n',
      );
    });

    it('writes the same minimal config when the archive has none', () => {
      expect(buildSafeGitConfig(undefined)).toBe(
        '[core]\n\trepositoryformatversion = 0\n\tbare = false\n',
      );
    });

    it('keeps a SHA-256 object format and a reftable ref store, as fixed values', () => {
      const out = buildSafeGitConfig(
        [
          '[core]',
          '\trepositoryformatversion = 1',
          '\tfsmonitor = sh -c id',
          '[extensions]',
          '\tobjectFormat = sha256',
          '\trefStorage = reftable',
          '\tworktreeConfig = true',
        ].join('\n'),
      );
      expect(out).toBe(
        '[core]\n\trepositoryformatversion = 1\n\tbare = false\n' +
          '[extensions]\n\tobjectformat = sha256\n\trefstorage = reftable\n',
      );
    });

    it('never copies a value it does not know', () => {
      const out = buildSafeGitConfig(
        '[extensions]\n\tobjectformat = "sha256\n[core]\n\tfsmonitor=id"\n',
      );
      expect(out).not.toContain('fsmonitor');
      expect(out).not.toContain('extensions');
    });
  });

  describe('GitConfigScanner (the uploaded config read as a stream)', () => {
    const feed = (chunks: (string | Buffer)[]) => {
      const scanner = new GitConfigScanner();
      for (const c of chunks) scanner.write(Buffer.from(c));
      return scanner.safeConfig();
    };

    it('finds a value split across chunks', () => {
      expect(
        feed([
          '[extensions]\n\tobjectfor',
          'mat = sha',
          '256\n\trefstorage',
          ' = reftable',
        ]),
      ).toBe(
        '[core]\n\trepositoryformatversion = 1\n\tbare = false\n' +
          '[extensions]\n\tobjectformat = sha256\n\trefstorage = reftable\n',
      );
    });

    it('finds a value after a large config without keeping it', () => {
      const padding = '\t# padding line\n'.repeat(60_000);
      const scanner = new GitConfigScanner();
      scanner.write(Buffer.from(padding));
      scanner.write(Buffer.from('[extensions]\n\tobjectformat = sha256\n'));
      expect(scanner.retainedBytes()).toBeLessThan(1024);
      expect(scanner.safeConfig()).toContain('objectformat = sha256');
    });

    it('bounds what it keeps of a line that never ends', () => {
      const scanner = new GitConfigScanner();
      for (let i = 0; i < 100; i++) scanner.write(Buffer.alloc(64 * 1024, 'a'));
      expect(scanner.retainedBytes()).toBeLessThanOrEqual(4096);
      expect(scanner.safeConfig()).toBe(
        '[core]\n\trepositoryformatversion = 0\n\tbare = false\n',
      );
    });

    it('gives the same answer as buildSafeGitConfig', () => {
      const text =
        '[core]\n\tfsmonitor = id\n[extensions]\n\tobjectFormat = sha256\n';
      expect(feed([text])).toBe(buildSafeGitConfig(text));
    });
  });
});
