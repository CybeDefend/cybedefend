import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { PassThrough, Readable } from 'node:stream';

import {
  ARCHIVE_FAILURE_CATEGORY,
  ARCHIVE_FAILURE_CODES,
  ArchiveLimitError,
  DEFAULT_ZIP_LIMITS,
  InflateMeter,
  ZipLimits,
  COMMUNITY_SCANNER_ARCHIVE_LIMITS,
  exceedsEntryLimit,
  forwardedZipLimits,
  resolveZipLimits,
  scannerArchiveLimits,
} from './zip-limits.util';
import { lieAboutSizes, writeZip } from 'src/test-utils/zip-fixtures';
import { openCheckedZip } from './zip-archive.util';

/** The archive's central directory checked against `limits`, as the filter reads it. */
async function assertZipWithinLimits(
  zipPath: string,
  limits: ZipLimits,
): Promise<{ entries: number; totalBytes: number }> {
  const zip = await openCheckedZip(zipPath, limits);
  try {
    return { entries: zip.entries.length, totalBytes: zip.declaredTotalBytes };
  } finally {
    zip.close();
  }
}

const SMALL: ZipLimits = {
  maxArchiveBytes: 1024 * 1024,
  maxEntries: 10,
  maxEntryBytes: 1024 * 1024,
  maxTotalBytes: 2 * 1024 * 1024,
};

async function drain(stream: Readable): Promise<number> {
  let n = 0;
  for await (const chunk of stream) n += (chunk as Buffer).length;
  return n;
}

/** The stable code a limit error carries, or the error itself. */
async function codeOf(p: Promise<unknown>): Promise<string | unknown> {
  const err = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  return err instanceof ArchiveLimitError ? err.code : err;
}

const GIB = 1024 ** 3;

/**
 * A stored ZIP of `count` empty files, built in memory (no compression, no
 * data): enough to cross the entry bound without writing gigabytes.
 */
function storedZipOf(count: number): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (let i = 0; i < count; i++) {
    const name = Buffer.from(`f${i}`);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(10, 4);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(10, 6);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name);
    centrals.push(central, name);
    offset += 30 + name.length;
  }
  const directory = Buffer.concat(centrals);
  // Past 65,535 entries the count lives in the ZIP64 end record, as in any
  // archive of that size; the classic end record then says 0xffff.
  const zip64 = count > 0xffff;
  const tail: Buffer[] = [];
  if (zip64) {
    const record = Buffer.alloc(56);
    record.writeUInt32LE(0x06064b50, 0);
    record.writeBigUInt64LE(44n, 4);
    record.writeUInt16LE(45, 12);
    record.writeUInt16LE(45, 14);
    record.writeBigUInt64LE(BigInt(count), 24);
    record.writeBigUInt64LE(BigInt(count), 32);
    record.writeBigUInt64LE(BigInt(directory.length), 40);
    record.writeBigUInt64LE(BigInt(offset), 48);
    const locator = Buffer.alloc(20);
    locator.writeUInt32LE(0x07064b50, 0);
    locator.writeBigUInt64LE(BigInt(offset + directory.length), 8);
    locator.writeUInt32LE(1, 16);
    tail.push(record, locator);
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(zip64 ? 0xffff : count, 8);
  end.writeUInt16LE(zip64 ? 0xffff : count, 10);
  end.writeUInt32LE(zip64 ? 0xffffffff : directory.length, 12);
  end.writeUInt32LE(zip64 ? 0xffffffff : offset, 16);
  return Buffer.concat([...locals, directory, ...tail, end]);
}

describe('archive failure codes', () => {
  // Shared with security-scanning's scan failure table (90-99, category
  // `archive`) and the dashboard's i18n keys: changing a number breaks both.
  it('gives each refusal a stable name and number in the archive range', () => {
    expect(ARCHIVE_FAILURE_CODES).toEqual({
      ARCHIVE_TOO_LARGE: 90,
      ARCHIVE_TOO_MANY_ENTRIES: 91,
      ARCHIVE_ENTRY_TOO_LARGE: 92,
      ARCHIVE_INFLATED_TOO_LARGE: 93,
      ARCHIVE_INVALID: 94,
      ARCHIVE_EMPTY: 95,
      ARCHIVE_ENCRYPTED: 96,
      ARCHIVE_UNSAFE_PATH: 97,
      ARCHIVE_NOT_RECEIVED: 98,
    });
    expect(ARCHIVE_FAILURE_CATEGORY).toBe('archive');
  });

  it('carries its code, number and a message without the code', () => {
    const err = new ArchiveLimitError(
      'ARCHIVE_TOO_LARGE',
      'The uploaded archive exceeds the 5.00 GiB limit',
    );
    expect(err.code).toBe('ARCHIVE_TOO_LARGE');
    expect(err.errorCode).toBe(90);
    expect(err.message).toBe('The uploaded archive exceeds the 5.00 GiB limit');
    expect(err.scanErrorMessage).toBe(
      'ARCHIVE_TOO_LARGE: The uploaded archive exceeds the 5.00 GiB limit',
    );
  });
});

describe('zip limits', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'zip-limits-'));
  });
  afterEach(async () => {
    await fs.promises.rm(dir, { recursive: true, force: true });
  });

  describe('resolveZipLimits', () => {
    it('defaults to 5 GiB compressed and uncompressed', () => {
      const limits = resolveZipLimits(() => undefined);
      expect(limits).toEqual(DEFAULT_ZIP_LIMITS);
      expect(limits.maxArchiveBytes).toBe(5 * 1024 ** 3);
      expect(limits.maxTotalBytes).toBe(5 * 1024 ** 3);
    });

    it('reads each limit from its variable and ignores a non-positive value', () => {
      const env: Record<string, unknown> = {
        FULL_SCAN_MAX_ARCHIVE_BYTES: '100',
        FULL_SCAN_MAX_ENTRIES: 7,
        FULL_SCAN_MAX_ENTRY_BYTES: '0',
        FULL_SCAN_MAX_UNCOMPRESSED_BYTES: 'nope',
      };
      const limits = resolveZipLimits((k) => env[k]);
      expect(limits.maxArchiveBytes).toBe(100);
      expect(limits.maxEntries).toBe(7);
      expect(limits.maxEntryBytes).toBe(DEFAULT_ZIP_LIMITS.maxEntryBytes);
      expect(limits.maxTotalBytes).toBe(DEFAULT_ZIP_LIMITS.maxTotalBytes);
    });
  });

  describe('scannerArchiveLimits', () => {
    // The Community Edition's scanner pods download the filtered archive and
    // refuse it past these bounds (exit 6): an archive file-management
    // accepted would start every pod for nothing, so the same bounds hold
    // here.
    it('is what the Community scanner pods accept: 2 GiB downloaded, 3 GiB unpacked, 200,000 entries', () => {
      expect(scannerArchiveLimits('community')).toEqual({
        maxArchiveBytes: 2 * 1024 ** 3,
        maxEntries: 200_000,
        maxTotalBytes: 3 * 1024 ** 3,
      });
    });

    it('adds no bound in an edition whose scanners take the upload limits', () => {
      expect(scannerArchiveLimits('cloud')).toBeNull();
      expect(scannerArchiveLimits('enterprise')).toBeNull();
    });
  });

  // The pods accept a bound exactly and refuse one byte (or entry) past it:
  // the same comparison here, on the real values.
  describe("the Community scanner pods' bounds, at limit-1 / limit / limit+1", () => {
    const forwarded = forwardedZipLimits(
      DEFAULT_ZIP_LIMITS,
      COMMUNITY_SCANNER_ARCHIVE_LIMITS,
    );

    it("are pinned to the pods' values in bytes and entries", () => {
      expect(COMMUNITY_SCANNER_ARCHIVE_LIMITS.maxArchiveBytes).toBe(
        2_147_483_648,
      );
      expect(COMMUNITY_SCANNER_ARCHIVE_LIMITS.maxTotalBytes).toBe(
        3_221_225_472,
      );
      expect(COMMUNITY_SCANNER_ARCHIVE_LIMITS.maxEntries).toBe(200_000);
      expect(forwarded.maxTotalBytes).toBe(3 * GIB);
      expect(forwarded.maxEntries).toBe(200_000);
    });

    /** Inflate `sizes` (one entry each) through one meter; the code of its refusal, or null. */
    async function meterVerdict(sizes: number[]): Promise<string | null> {
      const meter = new InflateMeter(forwarded);
      const chunk = Buffer.allocUnsafe(64 * 1024 * 1024);
      for (const [i, size] of sizes.entries()) {
        const source = new PassThrough();
        const out = meter.wrap(source, `e${i}`);
        const drained = drain(out).then(
          () => null,
          (e: unknown) => (e instanceof ArchiveLimitError ? e.code : e),
        );
        let left = size;
        while (left > 0) {
          const part = Math.min(left, chunk.length);
          if (
            !source.write(
              part === chunk.length ? chunk : chunk.subarray(0, part),
            )
          ) {
            await new Promise((r) => source.once('drain', r));
          }
          left -= part;
        }
        source.end();
        const verdict = await drained;
        if (verdict !== null) return verdict as string;
      }
      return null;
    }

    it.each([
      ['limit - 1', -1, null],
      ['limit', 0, null],
      ['limit + 1', 1, 'ARCHIVE_INFLATED_TOO_LARGE'],
    ])(
      'unpacked total at %s',
      async (_label, delta, expected) => {
        // Three entries of at most 1 GiB each (the entry bound), then the rest.
        const sizes = [GIB, GIB, GIB - 1];
        const rest = 1 + (delta as number);
        if (rest > 0) sizes.push(rest);
        else sizes[2] += rest;
        expect(sizes.reduce((a, b) => a + b, 0)).toBe(
          3 * GIB + (delta as number),
        );
        await expect(meterVerdict(sizes)).resolves.toBe(expected);
      },
      120_000,
    );

    // Reading 200,000 entries takes minutes in a test, so the comparison
    // itself is pinned on the real bound, and the refusal is shown end to
    // end on an archive one entry past it (refused before any entry is read).
    it.each([
      ['limit - 1', 199_999, false],
      ['limit', 200_000, false],
      ['limit + 1', 200_001, true],
    ])('entries at %s', (_label, count, refused) => {
      expect(exceedsEntryLimit(count as number, forwarded)).toBe(refused);
    });

    it('refuses an archive of 200,001 entries before reading any', async () => {
      const zip = path.join(dir, 'n200001.zip');
      await fs.promises.writeFile(zip, storedZipOf(200_001));
      await expect(codeOf(assertZipWithinLimits(zip, forwarded))).resolves.toBe(
        'ARCHIVE_TOO_MANY_ENTRIES',
      );
    }, 120_000);
  });

  describe('assertZipWithinLimits (central directory)', () => {
    it('accepts a normal archive', async () => {
      const zip = path.join(dir, 'ok.zip');
      await writeZip(zip, { 'a.ts': 'x', 'b/c.ts': 'y' });
      await expect(assertZipWithinLimits(zip, SMALL)).resolves.toEqual({
        entries: 2,
        totalBytes: 2,
      });
    });

    it('refuses a small archive declaring an entry larger than the entry limit', async () => {
      const zip = path.join(dir, 'bomb.zip');
      await writeZip(zip, { 'bomb.ts': Buffer.alloc(8 * 1024 * 1024) });
      expect((await fs.promises.stat(zip)).size).toBeLessThan(64 * 1024);
      await expect(assertZipWithinLimits(zip, SMALL)).rejects.toThrow(
        ArchiveLimitError,
      );
      await expect(assertZipWithinLimits(zip, SMALL)).rejects.toThrow(
        /entry .* uncompressed exceeds/i,
      );
      await expect(codeOf(assertZipWithinLimits(zip, SMALL))).resolves.toBe(
        'ARCHIVE_ENTRY_TOO_LARGE',
      );
    });

    it('refuses an archive whose entries add up past the total limit', async () => {
      const zip = path.join(dir, 'total.zip');
      await writeZip(zip, {
        'a.ts': Buffer.alloc(900 * 1024),
        'b.ts': Buffer.alloc(900 * 1024),
        'c.ts': Buffer.alloc(900 * 1024),
      });
      await expect(assertZipWithinLimits(zip, SMALL)).rejects.toThrow(
        /uncompressed exceeds the .* limit/i,
      );
      await expect(codeOf(assertZipWithinLimits(zip, SMALL))).resolves.toBe(
        'ARCHIVE_INFLATED_TOO_LARGE',
      );
    });

    it('refuses an archive with more entries than the entry-count limit', async () => {
      const zip = path.join(dir, 'count.zip');
      const entries: Record<string, string> = {};
      for (let i = 0; i < 11; i++) entries[`f${i}.ts`] = 'x';
      await writeZip(zip, entries);
      await expect(assertZipWithinLimits(zip, SMALL)).rejects.toThrow(
        /more than 10 entries/i,
      );
      await expect(codeOf(assertZipWithinLimits(zip, SMALL))).resolves.toBe(
        'ARCHIVE_TOO_MANY_ENTRIES',
      );
    });

    it('refuses a file that is not a ZIP as an invalid archive', async () => {
      const zip = path.join(dir, 'garbage.zip');
      await fs.promises.writeFile(zip, 'not a zip');
      await expect(codeOf(assertZipWithinLimits(zip, SMALL))).resolves.toBe(
        'ARCHIVE_INVALID',
      );
    });

    it('lets an archive lying about its sizes through: only the meter can see it', async () => {
      const honest = path.join(dir, 'honest.zip');
      await writeZip(honest, { 'liar.ts': Buffer.alloc(8 * 1024 * 1024) });
      const liar = path.join(dir, 'liar.zip');
      await fs.promises.writeFile(
        liar,
        lieAboutSizes(await fs.promises.readFile(honest), 10),
      );
      await expect(assertZipWithinLimits(liar, SMALL)).resolves.toEqual({
        entries: 1,
        totalBytes: 10,
      });
    });
  });

  describe('InflateMeter', () => {
    const source = (bytes: number, chunk = 64 * 1024): Readable => {
      const pt = new PassThrough();
      let left = bytes;
      const push = () => {
        while (left > 0) {
          const n = Math.min(chunk, left);
          left -= n;
          if (!pt.write(Buffer.alloc(n))) return pt.once('drain', push);
        }
        pt.end();
      };
      push();
      return pt;
    };

    it('passes an entry within the limits through unchanged', async () => {
      const meter = new InflateMeter(SMALL);
      await expect(drain(meter.wrap(source(1000), 'a.ts'))).resolves.toBe(1000);
      expect(meter.totalBytes).toBe(1000);
    });

    it('aborts an entry that inflates past the entry limit', async () => {
      const meter = new InflateMeter(SMALL);
      await expect(
        codeOf(drain(meter.wrap(source(SMALL.maxEntryBytes + 1), 'big.ts'))),
      ).resolves.toBe('ARCHIVE_ENTRY_TOO_LARGE');
    });

    it('aborts once the entries read add up past the total limit', async () => {
      const meter = new InflateMeter(SMALL);
      await drain(meter.wrap(source(SMALL.maxEntryBytes), 'a.ts'));
      await drain(meter.wrap(source(SMALL.maxEntryBytes), 'b.ts'));
      const err = await drain(meter.wrap(source(1), 'c.ts')).catch((e) => e);
      expect(err).toBeInstanceOf(ArchiveLimitError);
      expect(err.message).toMatch(/total limit/i);
      expect(err.code).toBe('ARCHIVE_INFLATED_TOO_LARGE');
    });

    it('names an entry by at most 120 characters of its name', async () => {
      const meter = new InflateMeter(SMALL);
      const name = `${'d/'.repeat(200)}big.ts`;
      const err = await drain(
        meter.wrap(source(SMALL.maxEntryBytes + 1), name),
      ).catch((e) => e);
      expect(err.message.length).toBeLessThan(200);
    });

    it('fails when the source stream fails', async () => {
      const meter = new InflateMeter(SMALL);
      const broken = new PassThrough();
      const wrapped = meter.wrap(broken, 'x.ts');
      setImmediate(() => broken.destroy(new Error('inflate failed')));
      await expect(drain(wrapped)).rejects.toThrow('inflate failed');
    });
  });
});
