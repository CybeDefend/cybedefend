import archiver from 'archiver';
import { Writable } from 'node:stream';

/**
 * The repository archive is rewritten by archiver (runZipProcessing), every
 * entry of the downloaded archive kept. When it is finalized, archiver writes
 * one central directory record per entry, synchronously and with no
 * backpressure: every chunk it writes stays in memory until the output drains.
 * Written field by field (about 19 chunks per record, each its own Buffer), the
 * records take about 5.5 KB of heap per entry at once, so the rewrite worker's
 * 1024 MB heap runs out near 180,000 entries. The compress-commons patch
 * (patches/) writes each record as one chunk.
 */
describe('archiver central directory', () => {
  /** Offset of the central directory, read from the end of central directory record. */
  const centralDirectoryOffset = (zip: Buffer): number => {
    const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    return zip.readUInt32LE(eocd + 16);
  };

  it('writes each central directory record as one chunk', async () => {
    const entries = 200;
    const chunks: Buffer[] = [];
    const sink = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        chunks.push(chunk);
        callback();
      },
    });
    const finished = new Promise<void>((resolve) => sink.on('finish', resolve));

    const archive = archiver('zip', { store: true });
    archive.pipe(sink);
    for (let i = 0; i < entries; i++) {
      archive.append(Buffer.from(`export const v${i} = ${i};\n`), {
        name: `src/f${i}.ts`,
      });
    }
    await archive.finalize();
    await finished;

    const central = centralDirectoryOffset(Buffer.concat(chunks));
    let offset = 0;
    let centralChunks = 0;
    for (const chunk of chunks) {
      if (offset >= central) centralChunks++;
      offset += chunk.length;
    }
    // One chunk per record, plus the few of the end of central directory record.
    expect(centralChunks).toBeLessThanOrEqual(entries + 16);
  });
});
