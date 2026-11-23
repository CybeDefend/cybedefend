import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import archiver from 'archiver';
import {
  DEFAULT_MAX_UNCOMPRESSED_BYTES,
  MAX_UNCOMPRESSED_BYTES_ENV,
  assertArchiveWithinUncompressedLimit,
  resolveMaxUncompressedBytes,
  sumUncompressedBytes,
} from './zip-size-gate';

jest.setTimeout(120_000);

/**
 * `sizeBytes` zero bytes, produced 64 KiB at a time.
 *
 * The point of this gate is to survive archives that are small on disk and
 * enormous once inflated, so the fixtures have to be built the same way —
 * never allocating the uncompressed payload.
 */
function zeroStream(sizeBytes: number): Readable {
  const chunk = Buffer.alloc(64 * 1024, 0);
  let remaining = sizeBytes;
  return new Readable({
    read(): void {
      if (remaining <= 0) {
        this.push(null);
        return;
      }
      const size = Math.min(chunk.length, remaining);
      remaining -= size;
      this.push(size === chunk.length ? chunk : chunk.subarray(0, size));
    },
  });
}

/** Build a zip holding one entry per `[name, uncompressedSize]` pair. */
function buildZip(
  tmpDir: string,
  entries: [string, number][],
): Promise<string> {
  const zipPath = path.join(
    tmpDir,
    `fixture-${entries.map(([, size]) => size).join('-')}.zip`,
  );
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    out.on('close', () => resolve(zipPath));
    out.on('error', reject);
    archive.on('error', reject);
    archive.pipe(out);
    for (const [name, size] of entries) {
      archive.append(zeroStream(size), { name });
    }
    void archive.finalize();
  });
}

describe('zip-size-gate.resolveMaxUncompressedBytes', () => {
  it('defaults to 5 GiB', () => {
    expect(DEFAULT_MAX_UNCOMPRESSED_BYTES).toBe(5 * 1024 ** 3);
    expect(resolveMaxUncompressedBytes({})).toBe(
      DEFAULT_MAX_UNCOMPRESSED_BYTES,
    );
  });

  it('honours the tuning env var', () => {
    expect(
      resolveMaxUncompressedBytes({ [MAX_UNCOMPRESSED_BYTES_ENV]: '1024' }),
    ).toBe(1024);
  });

  it('falls back to the default for an unusable value', () => {
    for (const raw of ['', '   ', 'not-a-number', '0', '-1']) {
      expect(
        resolveMaxUncompressedBytes({ [MAX_UNCOMPRESSED_BYTES_ENV]: raw }),
      ).toBe(DEFAULT_MAX_UNCOMPRESSED_BYTES);
    }
  });
});

describe('zip-size-gate.sumUncompressedBytes', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-gate-'));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('sums the uncompressed size of every entry', async () => {
    const zipPath = await buildZip(tmpDir, [
      ['a.txt', 1000],
      ['dir/b.txt', 2500],
      ['dir/c.bin', 7],
    ]);

    await expect(sumUncompressedBytes(zipPath)).resolves.toBe(3507);
  });

  it('reads the central directory without inflating the entries', async () => {
    // 200 MiB of zeroes compresses to a couple of hundred KiB. Inflating it
    // would cost 200 MiB of memory; reading the central directory costs none.
    const zipPath = await buildZip(tmpDir, [['huge.bin', 200 * 1024 * 1024]]);
    expect(fs.statSync(zipPath).size).toBeLessThan(2 * 1024 * 1024);

    const before = process.memoryUsage().arrayBuffers;
    const total = await sumUncompressedBytes(zipPath);
    const growth = process.memoryUsage().arrayBuffers - before;

    expect(total).toBe(200 * 1024 * 1024);
    expect(growth).toBeLessThan(16 * 1024 * 1024);
  });

  it('rejects for a file that is not a zip', async () => {
    const notAZip = path.join(tmpDir, 'not-a-zip.bin');
    fs.writeFileSync(notAZip, Buffer.from('definitely not a zip archive'));

    await expect(sumUncompressedBytes(notAZip)).rejects.toThrow();
  });
});

describe('zip-size-gate.assertArchiveWithinUncompressedLimit', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-gate-assert-'));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns the measured total when the archive is within the limit', async () => {
    const zipPath = await buildZip(tmpDir, [['a.txt', 4096]]);

    await expect(
      assertArchiveWithinUncompressedLimit(zipPath, 8192),
    ).resolves.toBe(4096);
  });

  it('refuses an archive whose uncompressed total exceeds the limit', async () => {
    // A zip bomb in miniature: tiny on disk, large once inflated.
    const zipPath = await buildZip(tmpDir, [['bomb.bin', 64 * 1024 * 1024]]);
    expect(fs.statSync(zipPath).size).toBeLessThan(1024 * 1024);

    await expect(
      assertArchiveWithinUncompressedLimit(zipPath, 1024 * 1024),
    ).rejects.toThrow(/Repository archive is too large/);
  });

  it('names both the measured size and the limit, with no raw exception text', async () => {
    const zipPath = await buildZip(tmpDir, [['bomb.bin', 64 * 1024 * 1024]]);

    await expect(
      assertArchiveWithinUncompressedLimit(zipPath, 1024 * 1024),
    ).rejects.toThrow(
      'Repository archive is too large: 64.00 MiB uncompressed exceeds the 1.00 MiB limit',
    );
  });

  it('uses the env ceiling when no explicit limit is passed', async () => {
    const zipPath = await buildZip(tmpDir, [['a.txt', 4096]]);
    const previous = process.env[MAX_UNCOMPRESSED_BYTES_ENV];
    process.env[MAX_UNCOMPRESSED_BYTES_ENV] = '1024';
    try {
      await expect(
        assertArchiveWithinUncompressedLimit(zipPath),
      ).rejects.toThrow(/Repository archive is too large/);
    } finally {
      if (previous === undefined)
        delete process.env[MAX_UNCOMPRESSED_BYTES_ENV];
      else process.env[MAX_UNCOMPRESSED_BYTES_ENV] = previous;
    }
  });
});
