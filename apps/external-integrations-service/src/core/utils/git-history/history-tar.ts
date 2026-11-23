import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import archiver from 'archiver';
import { resolveGitHistoryTimeoutMs } from './history-budget';
import { runGit } from './run-git';

/** A pack and its index; `.rev`, `.keep`, `.promisor` and `tmp_*` are left out. */
const PACK_FILE = /^pack-(?:[0-9a-f]{40}|[0-9a-f]{64})\.(pack|idx)$/;

/** A loose object directory (`objects/ab/`). */
const LOOSE_OBJECT_DIR = /^[0-9a-f]{2}$/;

/** Directories written first, so the extracted tree is a repository even with every ref packed. */
const DIRECTORIES = ['objects/', 'objects/pack/', 'refs/'];

interface TarEntry {
  source: string;
  name: string;
}

async function isFile(file: string): Promise<boolean> {
  try {
    return (await fsp.lstat(file)).isFile();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}

async function refFiles(repoDir: string, rel: string): Promise<TarEntry[]> {
  const entries = await fsp.readdir(path.join(repoDir, rel), {
    withFileTypes: true,
  });
  const out: TarEntry[] = [];
  for (const entry of entries) {
    const child = `${rel}/${entry.name}`;
    if (entry.isDirectory()) {
      out.push(...(await refFiles(repoDir, child)));
    } else if (entry.isFile() && !entry.name.endsWith('.lock')) {
      out.push({ source: path.join(repoDir, child), name: child });
    }
  }
  return out;
}

async function packFiles(repoDir: string): Promise<TarEntry[]> {
  const packDir = path.join(repoDir, 'objects', 'pack');
  let names: string[];
  try {
    names = await fsp.readdir(packDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const present = new Set(names);
  const out: TarEntry[] = [];
  for (const name of names.sort()) {
    const match = PACK_FILE.exec(name);
    if (!match) continue;
    // A pack is usable only with its index, and an index only with its pack.
    const other = name.replace(
      /\.(pack|idx)$/,
      match[1] === 'pack' ? '.idx' : '.pack',
    );
    if (!present.has(other)) continue;
    const source = path.join(packDir, name);
    if (await isFile(source))
      out.push({ source, name: `objects/pack/${name}` });
  }
  return out;
}

async function assertNoLooseObjects(repoDir: string): Promise<void> {
  const objectsDir = path.join(repoDir, 'objects');
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(objectsDir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw err;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !LOOSE_OBJECT_DIR.test(entry.name)) continue;
    if ((await fsp.readdir(path.join(objectsDir, entry.name))).length > 0) {
      throw new Error(
        'writeHistoryTar: the repository holds loose objects, which the ' +
          'history tar does not carry; fetch with an unpack limit of 1',
      );
    }
  }
}

/**
 * The repository's own config is never shipped. A SHA-256 repository gets a
 * minimal one, without which git reads it as SHA-1 and fails.
 */
async function objectFormatConfig(repoDir: string): Promise<string | null> {
  const { stdout } = await runGit(
    ['--git-dir', repoDir, 'rev-parse', '--show-object-format'],
    { label: 'rev-parse', timeoutMs: resolveGitHistoryTimeoutMs() },
  );
  const format = stdout.trim();
  if (format === 'sha1') return null;
  if (!/^[a-z0-9]+$/.test(format)) {
    throw new Error('writeHistoryTar: unknown object format');
  }
  return (
    '[core]\n\trepositoryformatversion = 1\n' +
    `[extensions]\n\tobjectformat = ${format}\n`
  );
}

/**
 * Writes the history of a bare repository to `tarPath`, for the secret
 * scanner: `HEAD`, `shallow` and `packed-refs` when present, `refs/**` and
 * the packs with their indexes. Nothing else: no config (but the object
 * format of a non-SHA-1 repository), hooks, `FETCH_HEAD`, alternates, grafts,
 * locks or temporary files.
 *
 * The repository must hold its objects in packs, as `fetchBranchHistory`
 * leaves it: loose objects would be dropped, so they are refused.
 *
 * @returns the size of the tar in bytes.
 */
export async function writeHistoryTar(
  repoDir: string,
  tarPath: string,
): Promise<number> {
  if (!(await isFile(path.join(repoDir, 'HEAD')))) {
    throw new Error('writeHistoryTar: not a git repository');
  }
  await assertNoLooseObjects(repoDir);
  const config = await objectFormatConfig(repoDir);

  const entries: TarEntry[] = [
    { source: path.join(repoDir, 'HEAD'), name: 'HEAD' },
  ];
  for (const name of ['shallow', 'packed-refs']) {
    const source = path.join(repoDir, name);
    if (await isFile(source)) entries.push({ source, name });
  }
  if (fs.existsSync(path.join(repoDir, 'refs'))) {
    entries.push(...(await refFiles(repoDir, 'refs')));
  }
  entries.push(...(await packFiles(repoDir)));

  const output = fs.createWriteStream(tarPath);
  const archive = archiver('tar');
  const written = new Promise<void>((resolve, reject) => {
    output.once('close', resolve);
    output.once('error', reject);
    archive.once('error', reject);
    // archiver emits a warning, and never the entry, when it cannot stat a
    // source: a dropped pack would fail the history pass downstream.
    archive.once('warning', reject);
  });
  archive.pipe(output);
  try {
    for (const name of DIRECTORIES) {
      // A name ending in `/` is written as a directory entry.
      archive.append(Buffer.alloc(0), { name });
    }
    if (config) archive.append(config, { name: 'config' });
    for (const entry of entries) {
      archive.file(entry.source, { name: entry.name });
    }
    await Promise.all([archive.finalize(), written]);
  } catch (err) {
    archive.abort();
    output.destroy();
    await fsp.rm(tarPath, { force: true });
    throw err;
  }
  return (await fsp.stat(tarPath)).size;
}
