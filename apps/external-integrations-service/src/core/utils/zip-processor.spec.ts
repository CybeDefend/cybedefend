import AdmZip from 'adm-zip';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as zlib from 'node:zlib';
import { EventEmitter } from 'node:events';
import {
  runZipProcessing,
  addGitDirToArchive,
  runZipProcessingInWorker,
} from './zip-processor';

interface RawZipEntry {
  name: string;
  data: Buffer;
  /** Stored (0) unless deflated (8) is needed to reach the streaming path. */
  deflate?: boolean;
  /** Write this as the entry's uncompressedSize instead of the real one. */
  uncompressedSizeOverride?: number;
}

/**
 * Write a zip by hand, byte for byte.
 *
 * Needed because every zip library refuses to produce the archives these tests
 * are about: archiver sanitises `..` out of entry names, and none of them will
 * write a central directory that disagrees with the data it describes.
 */
function writeRawZip(zipPath: string, entries: RawZipEntry[]): string {
  const localChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const payload = entry.deflate
      ? zlib.deflateRawSync(entry.data)
      : entry.data;
    const crc = zlib.crc32(entry.data);
    const uncompressedSize =
      entry.uncompressedSizeOverride ?? entry.data.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // general purpose flags: utf-8 name
    local.writeUInt16LE(entry.deflate ? 8 : 0, 8); // compression method
    local.writeUInt16LE(0, 10); // last mod time
    local.writeUInt16LE(0x21, 12); // last mod date (1980-01-01)
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18); // compressed size
    local.writeUInt32LE(uncompressedSize, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra field length
    localChunks.push(local, nameBuf, payload);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // central directory signature
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(entry.deflate ? 8 : 0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(uncompressedSize, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30); // extra field length
    central.writeUInt16LE(0, 32); // file comment length
    central.writeUInt16LE(0, 34); // disk number start
    central.writeUInt16LE(0, 36); // internal attributes
    central.writeUInt32LE(0, 38); // external attributes
    central.writeUInt32LE(offset, 42); // offset of local header
    centralChunks.push(central, nameBuf);

    offset += local.length + nameBuf.length + payload.length;
  }

  const centralDirectory = Buffer.concat(centralChunks);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // end of central directory signature
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // disk with central directory
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20); // comment length

  fs.writeFileSync(
    zipPath,
    Buffer.concat([...localChunks, centralDirectory, eocd]),
  );
  return zipPath;
}

/** Build a fake GitHub zipball (entries nested under a top-level dir). */
function createFakeGithubZip(tmpDir: string): string {
  const zipPath = path.join(tmpDir, 'input.zip');
  const zip = new AdmZip();
  zip.addFile('top-abc123/src/app.js', Buffer.from('console.log("hello")'));
  zip.addFile('top-abc123/README.md', Buffer.from('# readme'));
  zip.writeZip(zipPath);
  return zipPath;
}

/** Create a fake bare .git mirror directory with a few files. */
function createFakeGitDir(tmpDir: string): string {
  const gitDir = path.join(tmpDir, 'git-mirror');
  fs.mkdirSync(path.join(gitDir, 'objects', 'pack'), { recursive: true });
  fs.mkdirSync(path.join(gitDir, 'refs', 'heads'), { recursive: true });
  fs.writeFileSync(path.join(gitDir, 'HEAD'), 'ref: refs/heads/main\n');
  fs.writeFileSync(path.join(gitDir, 'config'), '[core]\n\tbare = false\n');
  fs.writeFileSync(
    path.join(gitDir, 'objects', 'pack', 'pack-abc.pack'),
    Buffer.from([0x50, 0x41, 0x43, 0x4b]),
  );
  return gitDir;
}

describe('zip-processor.runZipProcessing', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-proc-'));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('strips the top-level directory from github zipball entries', async () => {
    const inputZip = createFakeGithubZip(tmpDir);
    const outputZip = path.join(tmpDir, 'output.zip');

    await runZipProcessing(inputZip, outputZip);

    const names = new AdmZip(outputZip)
      .getEntries()
      .map((e: any) => e.entryName)
      .sort();
    expect(names).toContain('src/app.js');
    expect(names).toContain('README.md');
    expect(names.every((n: string) => !n.startsWith('top-'))).toBe(true);
  });

  it('does NOT add .git entries when gitDir is omitted', async () => {
    const inputZip = createFakeGithubZip(tmpDir);
    const outputZip = path.join(tmpDir, 'output.zip');

    await runZipProcessing(inputZip, outputZip);

    const gitEntries = new AdmZip(outputZip)
      .getEntries()
      .filter((e: any) => e.entryName.startsWith('.git/'));
    expect(gitEntries).toHaveLength(0);
  });

  it('injects the .git mirror contents when gitDir is provided', async () => {
    const inputZip = createFakeGithubZip(tmpDir);
    const outputZip = path.join(tmpDir, 'output.zip');
    const gitDir = createFakeGitDir(tmpDir);

    await runZipProcessing(inputZip, outputZip, gitDir);

    const names = new AdmZip(outputZip)
      .getEntries()
      .map((e: any) => e.entryName);
    expect(names).toContain('.git/HEAD');
    expect(names).toContain('src/app.js');
  });

  it('ignores a non-existent gitDir without throwing', async () => {
    const inputZip = createFakeGithubZip(tmpDir);
    const outputZip = path.join(tmpDir, 'output.zip');

    await expect(
      runZipProcessing(inputZip, outputZip, path.join(tmpDir, 'nope')),
    ).resolves.toBeUndefined();
    const gitEntries = new AdmZip(outputZip)
      .getEntries()
      .filter((e: any) => e.entryName.startsWith('.git/'));
    expect(gitEntries).toHaveLength(0);
  });

  // The rewrite is a pipeline of events across two libraries. Every failure
  // below used to be able to hang it forever instead of failing the job: the
  // entry-by-entry handshake only resolves on archiver's `entry` event, so
  // anything that stops that event from arriving must reject explicitly.
  it('rejects instead of hanging when the output cannot be written', async () => {
    const inputZip = createFakeGithubZip(tmpDir);
    const unwritable = path.join(tmpDir, 'no-such-directory', 'output.zip');

    await expect(runZipProcessing(inputZip, unwritable)).rejects.toThrow(
      /ENOENT/,
    );
  });

  it('rejects instead of hanging when the input is not a readable archive', async () => {
    const notAZip = path.join(tmpDir, 'input.zip');
    fs.writeFileSync(notAZip, Buffer.from('PK not really a zip'));
    const outputZip = path.join(tmpDir, 'output.zip');

    await expect(runZipProcessing(notAZip, outputZip)).rejects.toThrow();
  });

  it('refuses an archive over the uncompressed ceiling, before writing anything', async () => {
    const inputZip = createFakeGithubZip(tmpDir);
    const outputZip = path.join(tmpDir, 'output.zip');
    const previous = process.env.REPO_SCAN_MAX_UNCOMPRESSED_BYTES;
    process.env.REPO_SCAN_MAX_UNCOMPRESSED_BYTES = '8';
    try {
      await expect(runZipProcessing(inputZip, outputZip)).rejects.toThrow(
        /Repository archive is too large/,
      );
    } finally {
      if (previous === undefined)
        delete process.env.REPO_SCAN_MAX_UNCOMPRESSED_BYTES;
      else process.env.REPO_SCAN_MAX_UNCOMPRESSED_BYTES = previous;
    }
    expect(fs.existsSync(outputZip)).toBe(false);
  });

  // Zip-slip. Stripping the top-level directory turns `top/../../evil.txt`
  // into `../../evil.txt`, i.e. the rewrite would hand the scanner an archive
  // that escapes its own extraction directory. The refusal comes from yauzl's
  // `validateFileName`, which only runs under `decodeStrings` — the default
  // both `zip-size-gate` and the rewrite spell out explicitly. These tests pin
  // the end-to-end refusal; they go red only if both opens stop decoding (the
  // size gate refuses first) — each site keeps `decodeStrings: true` explicit
  // for that reason.
  it.each([
    ['../evil.txt'],
    ['top-abc/../../evil.txt'],
    ['top-abc/nested/../../../evil.txt'],
  ])('refuses an input archive containing the entry %s', async (evilName) => {
    const inputZip = writeRawZip(path.join(tmpDir, 'evil.zip'), [
      { name: 'top-abc/safe.txt', data: Buffer.from('safe') },
      { name: evilName, data: Buffer.from('pwned') },
    ]);
    const outputZip = path.join(tmpDir, 'output.zip');

    await expect(runZipProcessing(inputZip, outputZip)).rejects.toThrow(
      /invalid relative path/,
    );
  });

  it('refuses an input archive containing an absolute entry name', async () => {
    const inputZip = writeRawZip(path.join(tmpDir, 'abs.zip'), [
      { name: '/etc/passwd', data: Buffer.from('root:x:0:0') },
    ]);
    const outputZip = path.join(tmpDir, 'output.zip');

    await expect(runZipProcessing(inputZip, outputZip)).rejects.toThrow(
      /absolute path/,
    );
  });

  it('destroys the in-flight entry stream when the rewrite fails mid-entry', async () => {
    // A deflated entry whose central directory lies about its uncompressed
    // size: yauzl hands out the read stream, then fails it part-way through.
    // That is the one failure mode that leaves a stream open, and `zipfile
    // .close()` only unrefs the reader — it does not destroy handed-out streams.
    const payload = Buffer.alloc(512 * 1024, 0x41);
    const inputZip = writeRawZip(path.join(tmpDir, 'liar.zip'), [
      {
        name: 'top-abc/truncated.bin',
        data: payload,
        deflate: true,
        uncompressedSizeOverride: payload.length + 4096,
      },
    ]);
    const outputZip = path.join(tmpDir, 'output.zip');

    const opened: { destroyed: boolean }[] = [];
    const yauzl = jest.requireActual<typeof import('yauzl')>('yauzl');
    const original = yauzl.ZipFile.prototype.openReadStreamPromise;
    const spy = jest
      .spyOn(yauzl.ZipFile.prototype, 'openReadStreamPromise')
      .mockImplementation(async function (this: unknown, ...args) {
        const stream = await original.apply(this, args);
        opened.push(stream);
        return stream;
      });

    try {
      await expect(runZipProcessing(inputZip, outputZip)).rejects.toThrow();
      expect(opened).toHaveLength(1);
      expect(opened[0].destroyed).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('zip-processor.addGitDirToArchive', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-git-'));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('adds all regular files under the .git/ prefix with POSIX separators', () => {
    const gitDir = createFakeGitDir(tmpDir);
    const zip = new AdmZip();

    addGitDirToArchive(zip, gitDir);

    const names = zip.getEntries().map((e: any) => e.entryName);
    expect(names).toContain('.git/HEAD');
    expect(names).toContain('.git/objects/pack/pack-abc.pack');
    for (const name of names) expect(name).not.toContain('\\');
  });

  it('skips symlinks', () => {
    const gitDir = createFakeGitDir(tmpDir);
    try {
      fs.symlinkSync(
        path.join(gitDir, 'HEAD'),
        path.join(gitDir, 'symlink-file'),
      );
    } catch {
      return; // Windows without privileges
    }
    const zip = new AdmZip();

    addGitDirToArchive(zip, gitDir);

    const names = zip.getEntries().map((e: any) => e.entryName);
    expect(names).not.toContain('.git/symlink-file');
    expect(names).toContain('.git/HEAD');
  });
});

describe('zip-processor.runZipProcessingInWorker', () => {
  function makeFakeWorker() {
    const emitter: any = new EventEmitter();
    emitter.terminate = jest.fn();
    return emitter;
  }

  it('resolves and passes the workerData when the worker reports ok', async () => {
    let worker: any;
    let data: any;
    const promise = runZipProcessingInWorker(
      'in.zip',
      'out.zip',
      '/tmp/git',
      (workerData) => {
        data = workerData;
        worker = makeFakeWorker();
        return worker;
      },
    );

    worker.emit('message', { ok: true });

    await expect(promise).resolves.toBeUndefined();
    expect(data).toEqual({
      inputPath: 'in.zip',
      outputPath: 'out.zip',
      gitDir: '/tmp/git',
    });
    expect(worker.terminate).toHaveBeenCalled();
  });

  it('rejects with the worker-reported error message', async () => {
    let worker: any;
    const promise = runZipProcessingInWorker('in', 'out', undefined, () => {
      worker = makeFakeWorker();
      return worker;
    });

    worker.emit('message', { ok: false, error: 'boom while unzipping' });

    await expect(promise).rejects.toThrow('boom while unzipping');
  });

  it('rejects when the worker emits an error event', async () => {
    let worker: any;
    const promise = runZipProcessingInWorker('in', 'out', undefined, () => {
      worker = makeFakeWorker();
      return worker;
    });

    worker.emit('error', new Error('worker crashed'));

    await expect(promise).rejects.toThrow('worker crashed');
  });

  it('rejects when the worker exits with a non-zero code', async () => {
    let worker: any;
    const promise = runZipProcessingInWorker('in', 'out', undefined, () => {
      worker = makeFakeWorker();
      return worker;
    });

    worker.emit('exit', 137);

    await expect(promise).rejects.toThrow('137');
  });

  it('does not reject on a zero exit code after a successful message', async () => {
    let worker: any;
    const promise = runZipProcessingInWorker('in', 'out', undefined, () => {
      worker = makeFakeWorker();
      return worker;
    });

    worker.emit('message', { ok: true });
    worker.emit('exit', 0);

    await expect(promise).resolves.toBeUndefined();
  });
});
