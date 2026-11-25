import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import archiver from 'archiver';

import { ArchiveLimitError, ZipLimits } from './zip-limits.util';
import { assertScannableZip, openCheckedZip } from './zip-archive.util';
import {
  craftZip,
  endRecordInDirectoryZip,
  overlappingRecordsZip,
  twoEndRecordsZip,
  withCrc,
} from './crafted-zip.fixture-spec';

const LIMITS: ZipLimits = {
  maxArchiveBytes: 64 * 1024 * 1024,
  maxEntries: 1000,
  maxEntryBytes: 8 * 1024 * 1024,
  maxTotalBytes: 16 * 1024 * 1024,
};

async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
  const err = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  return err instanceof ArchiveLimitError ? err.code : String(err);
}

async function readAll(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

describe('openCheckedZip', () => {
  let dir: string;
  const write = async (name: string, bytes: Buffer) => {
    const p = path.join(dir, name);
    await fs.promises.writeFile(p, bytes);
    return p;
  };
  const archived = async (
    name: string,
    entries: Record<string, string | Buffer>,
    options: Record<string, unknown> = {},
  ) => {
    const p = path.join(dir, name);
    await new Promise<void>((resolve, reject) => {
      const out = fs.createWriteStream(p);
      const arc = archiver('zip', options);
      arc.pipe(out);
      for (const [n, c] of Object.entries(entries)) {
        arc.append(Buffer.isBuffer(c) ? c : Buffer.from(c), { name: n });
      }
      out.on('close', () => resolve());
      arc.on('error', reject);
      void arc.finalize();
    });
    return p;
  };

  beforeEach(async () => {
    dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'fms-checked-'));
  });
  afterEach(async () => {
    await fs.promises.rm(dir, { recursive: true, force: true });
  });

  it('reads the entries it checked, from the same open file', async () => {
    const p = await archived('ok.zip', { 'a.ts': 'one', 'b/c.ts': 'two' });
    const zip = await openCheckedZip(p, LIMITS);
    try {
      expect(zip.entries.map((e) => e.name)).toEqual(['a.ts', 'b/c.ts']);
      const read = await readAll(await zip.openEntry(zip.entries[1]));
      expect(read.toString()).toBe('two');
    } finally {
      zip.close();
    }
  });

  it('accepts a zip64 archive with data descriptors', async () => {
    const p = await archived(
      'zip64.zip',
      { 'a.ts': 'one', 'b.ts': 'two' },
      { forceZip64: true },
    );
    const zip = await openCheckedZip(p, LIMITS);
    try {
      expect(zip.entries.map((e) => e.name)).toEqual(['a.ts', 'b.ts']);
    } finally {
      zip.close();
    }
  });

  it('accepts an archive with a comment', async () => {
    const p = await archived('comment.zip', { 'a.ts': 'x' }, { comment: 'hi' });
    const zip = await openCheckedZip(p, LIMITS);
    zip.close();
  });

  it('refuses bytes after the end record', async () => {
    const good = craftZip([{ name: 'a.ts', data: 'x' }]);
    const p = await write('tail.zip', Buffer.concat([good, Buffer.from('xx')]));
    await expect(codeOf(openCheckedZip(p, LIMITS))).resolves.toBe(
      'ARCHIVE_INVALID',
    );
  });

  it('refuses, without reading it, a hidden central directory of 300,000 records', async () => {
    const p = await write(
      'decoys.zip',
      twoEndRecordsZip(
        [{ name: 'README.md', data: 'hello\n' }],
        [{ name: 'hidden/a.py', data: 'x = 1\n' }],
        300_000,
      ),
    );
    const started = Date.now();
    await expect(openCheckedZip(p, LIMITS)).rejects.toThrow(
      /more than one end-of-central-directory record/,
    );
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  // A central directory is binary: a CRC, a size or an offset may read as an
  // end-record signature. Such an archive is legitimate and accepted.
  it.each([
    ['written byte for byte', 'crafted'],
    ['written by archiver', 'archiver'],
  ])(
    'accepts an archive whose central directory holds the end-record signature bytes (%s)',
    async (_label, writer) => {
      const content = withCrc(Buffer.from('export const a = 1;\n'), 0x06054b50);
      expect(zlib.crc32(content)).toBe(0x06054b50);
      const p =
        writer === 'crafted'
          ? await write(
              'crc.zip',
              craftZip([
                { name: 'src/a.ts', data: content },
                { name: 'src/b.ts', data: 'export const b = 2;\n' },
              ]),
            )
          : await archived('crc-arc.zip', {
              'src/a.ts': content,
              'src/b.ts': 'export const b = 2;\n',
            });
      const raw = await fs.promises.readFile(p);
      const signature = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
      expect(raw.indexOf(signature)).toBeLessThan(raw.length - 22);
      const zip = await openCheckedZip(p, LIMITS);
      try {
        expect(zip.entries.map((e) => e.name)).toEqual([
          'src/a.ts',
          'src/b.ts',
        ]);
      } finally {
        zip.close();
      }
    },
  );

  it('refuses an end record hidden in a central directory record comment', async () => {
    const p = await write(
      'nested.zip',
      endRecordInDirectoryZip(
        [{ name: 'README.md', data: 'hello\n' }],
        [{ name: 'hidden/a.py', data: 'x = 1\n' }],
      ),
    );
    await expect(codeOf(openCheckedZip(p, LIMITS))).resolves.toBe(
      'ARCHIVE_INVALID',
    );
  });

  it('refuses records that point at the same data, under the entry limit', async () => {
    const p = await write(
      'overlap.zip',
      overlappingRecordsZip({ name: 'a.py', data: 'x = 1\n' }, 500),
    );
    await expect(openCheckedZip(p, LIMITS)).rejects.toThrow(
      /does not account for/,
    );
  });

  // The archive's descriptor has one owner and is closed once: closed twice,
  // the second close could hit whatever the process opened in between with
  // the same number (an upload stream, a database or storage socket).
  describe('closes the archive descriptor exactly once', () => {
    /** Counts every close of a descriptor: file handles and plain fds. */
    const countCloses = async () => {
      // The module object itself (the namespace import is a frozen copy).
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const nodeFs = require('node:fs') as typeof fs;
      let handleCloses = 0;
      const realOpen = nodeFs.promises.open.bind(nodeFs.promises);
      const open = jest
        .spyOn(nodeFs.promises, 'open')
        .mockImplementation(async (...args: Parameters<typeof realOpen>) => {
          const handle = await realOpen(...args);
          const close = handle.close.bind(handle);
          handle.close = () => {
            handleCloses++;
            return close();
          };
          return handle;
        });
      const fdClose = jest.spyOn(nodeFs, 'close');
      const fdCloseSync = jest.spyOn(nodeFs, 'closeSync');
      return {
        total: () =>
          handleCloses +
          fdClose.mock.calls.length +
          fdCloseSync.mock.calls.length,
        restore: () => {
          open.mockRestore();
          fdClose.mockRestore();
          fdCloseSync.mockRestore();
        },
      };
    };
    const ticks = async () => {
      for (let i = 0; i < 3; i++) await new Promise((r) => setImmediate(r));
      await new Promise((r) => setTimeout(r, 5));
    };

    it('after reading an accepted archive', async () => {
      const p = await archived('once.zip', { 'a.ts': 'one', 'b.ts': 'two' });
      const closes = await countCloses();
      try {
        const zip = await openCheckedZip(p, LIMITS);
        await readAll(await zip.openEntry(zip.entries[0]));
        zip.close();
        zip.close();
        await ticks();
        expect(closes.total()).toBe(1);
      } finally {
        closes.restore();
      }
    });

    it.each([
      [
        'two end records',
        () =>
          twoEndRecordsZip(
            [{ name: 'README.md', data: 'hello\n' }],
            [{ name: 'hidden/a.py', data: 'x = 1\n' }],
          ),
      ],
      [
        'overlapping records',
        () => overlappingRecordsZip({ name: 'a.py', data: 'x = 1\n' }, 5),
      ],
      ['not a ZIP', () => Buffer.from('not a zip at all, not even close')],
    ])('after refusing %s', async (_label, make) => {
      const p = await write('refused.zip', make());
      const closes = await countCloses();
      try {
        await expect(openCheckedZip(p, LIMITS)).rejects.toThrow(
          ArchiveLimitError,
        );
        await ticks();
        expect(closes.total()).toBe(1);
      } finally {
        closes.restore();
      }
    });

    it('never closes a file opened after the archive is closed', async () => {
      const p = await archived('reuse.zip', { 'a.ts': 'one' });
      for (let i = 0; i < 200; i++) {
        const zip = await openCheckedZip(p, LIMITS);
        zip.close();
        const other = path.join(dir, `other-${i}.txt`);
        const fd = fs.openSync(other, 'w');
        await ticks();
        fs.writeSync(fd, `content ${i}`);
        expect(() => fs.fstatSync(fd)).not.toThrow();
        fs.closeSync(fd);
        expect(fs.readFileSync(other, 'utf8')).toBe(`content ${i}`);
      }
    }, 60_000);
  });

  // A file-system failure is not a bad archive: it is passed on as is, so
  // the caller can retry instead of blaming the upload.
  it.each(['EMFILE', 'ENOSPC', 'EIO'])(
    'passes a %s of the file system on, not as an invalid archive',
    async (code) => {
      const p = await archived('fs.zip', { 'a.ts': 'one' });
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const nodeFs = require('node:fs') as typeof fs;
      const realOpen = nodeFs.promises.open.bind(nodeFs.promises);
      const open = jest
        .spyOn(nodeFs.promises, 'open')
        .mockImplementation(async (...args: Parameters<typeof realOpen>) => {
          const handle = await realOpen(...args);
          handle.read = (() =>
            Promise.reject(
              Object.assign(new Error(`${code}: failed`), {
                code,
                errno: -5,
                syscall: 'read',
              }),
            )) as typeof handle.read;
          return handle;
        });
      try {
        const err = await openCheckedZip(p, LIMITS).catch((e: unknown) => e);
        expect(err).not.toBeInstanceOf(ArchiveLimitError);
        expect((err as { code?: string }).code).toBe(code);
      } finally {
        open.mockRestore();
      }
    },
  );

  it('opens an empty archive, which assertScannableZip refuses as empty', async () => {
    const empty = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x05, 0x06]),
      Buffer.alloc(18),
    ]);
    const zip = await openCheckedZip(await write('empty.zip', empty), LIMITS);
    try {
      expect(zip.entries).toHaveLength(0);
      expect(() => assertScannableZip(zip)).toThrow(/holds no file/);
    } finally {
      zip.close();
    }
  });
});
