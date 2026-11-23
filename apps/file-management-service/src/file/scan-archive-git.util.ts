/**
 * What of an uploaded repository's `.git/` directory reaches the scanners.
 *
 * The secret scanner reads the commit history (`git log` over every ref), so
 * the archive keeps the objects, the refs and HEAD. Everything else in `.git/`
 * belongs to the uploader and can make git run commands on the scanner side:
 * the config (diff textconv and filter drivers, `core.fsmonitor`,
 * `core.pager`, `core.hooksPath`, `include.path`, aliases…), the hooks,
 * `info/attributes` (which selects those drivers), submodule and worktree
 * configs, `commondir`, and the object alternates (object stores outside the
 * archive). None of them is forwarded: the history is kept by an allowlist and
 * the config is replaced by a minimal one that names only the repository
 * format.
 */

/** The archive path of the repository config, rewritten by {@link buildSafeGitConfig}. */
export const SAFE_GIT_CONFIG_ENTRY = '.git/config';

/** Top-level files of `.git/` the history needs. */
const KEPT_GIT_FILES = new Set(['HEAD', 'packed-refs', 'shallow']);

/** Directories of `.git/` the history needs, kept whole. */
const KEPT_GIT_DIRS = ['objects/', 'refs/', 'reftable/'];

/** Files under a kept directory that point git outside the archive. */
const DROPPED_UNDER_KEPT = new Set([
  'objects/info/alternates',
  'objects/info/http-alternates',
]);

/**
 * Decide what happens to one archive entry (a posix-normalized path):
 *  - `null`: not part of a git directory, left to the ordinary filter;
 *  - `'keep'`: history data, forwarded as is;
 *  - `'config'`: the repository config, never forwarded, replaced;
 *  - `'drop'`: anything else under a `.git` path segment, at any depth and in
 *    any case, and a `.git` file (a `gitdir:` pointer to another directory).
 */
export function gitEntryDecision(
  normalized: string,
): 'keep' | 'config' | 'drop' | null {
  const segments = normalized.split('/');
  const gitIndex = segments.findIndex((s) => s.toLowerCase() === '.git');
  if (gitIndex === -1) return null;
  if (gitIndex !== 0 || segments[0] !== '.git' || segments.length < 2) {
    return 'drop';
  }

  const rel = segments.slice(1).join('/');
  if (rel === 'config') return 'config';
  if (KEPT_GIT_FILES.has(rel)) return 'keep';
  if (DROPPED_UNDER_KEPT.has(rel)) return 'drop';
  if (KEPT_GIT_DIRS.some((dir) => rel.startsWith(dir))) return 'keep';
  return 'drop';
}

/** The longest config line {@link GitConfigScanner} keeps; a longer one cannot be a line it looks for. */
const MAX_CONFIG_LINE_BYTES = 4096;

const OBJECT_FORMAT_SHA256 = /^\s*objectformat\s*=\s*sha256\s*$/i;
const REF_STORAGE_REFTABLE = /^\s*refstorage\s*=\s*reftable\s*$/i;

/**
 * Reads the uploaded config a chunk at a time, line by line, and keeps only
 * the two facts {@link buildSafeGitConfig} needs: a SHA-256 object format and
 * a reftable ref store. What it holds at any time is the unfinished last line,
 * cut at {@link MAX_CONFIG_LINE_BYTES}, so a config of any size costs a few
 * kilobytes.
 */
export class GitConfigScanner {
  private pending = '';
  private overlong = false;
  private objectFormatSha256 = false;
  private refStorageReftable = false;

  write(chunk: Buffer): void {
    const lines = (this.pending + chunk.toString('latin1')).split(/\r?\n/);
    this.pending = lines.pop() ?? '';
    for (const line of lines) {
      if (!this.overlong) this.check(line);
      this.overlong = false;
    }
    if (this.pending.length > MAX_CONFIG_LINE_BYTES) {
      this.pending = '';
      this.overlong = true;
    }
  }

  /** The config to write in place of the uploaded one. */
  safeConfig(): string {
    if (!this.overlong) this.check(this.pending);
    this.pending = '';
    this.overlong = false;
    return renderSafeGitConfig(
      this.objectFormatSha256,
      this.refStorageReftable,
    );
  }

  /** How many bytes of the config the scanner holds now. */
  retainedBytes(): number {
    return this.pending.length;
  }

  private check(line: string): void {
    if (OBJECT_FORMAT_SHA256.test(line)) this.objectFormatSha256 = true;
    if (REF_STORAGE_REFTABLE.test(line)) this.refStorageReftable = true;
  }
}

/**
 * The config written in place of the uploaded one. Only two facts are read
 * from the original, each compared with a fixed value and written as that
 * value: a SHA-256 object format and a reftable ref store, without which git
 * cannot read such a repository. Nothing else of it is copied.
 */
export function buildSafeGitConfig(original: string | undefined): string {
  const scanner = new GitConfigScanner();
  if (original !== undefined) scanner.write(Buffer.from(original, 'latin1'));
  return scanner.safeConfig();
}

function renderSafeGitConfig(
  objectFormatSha256: boolean,
  refStorageReftable: boolean,
): string {
  const extensions: string[] = [];
  if (objectFormatSha256) extensions.push('\tobjectformat = sha256\n');
  if (refStorageReftable) extensions.push('\trefstorage = reftable\n');

  const version = extensions.length > 0 ? 1 : 0;
  let config = `[core]\n\trepositoryformatversion = ${version}\n\tbare = false\n`;
  if (extensions.length > 0) config += `[extensions]\n${extensions.join('')}`;
  return config;
}
