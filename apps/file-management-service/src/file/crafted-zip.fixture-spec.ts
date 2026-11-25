import * as zlib from 'node:zlib';

/**
 * Builders of ZIP archives written byte for byte, for the specs: a ZIP writer
 * library only writes well-formed archives, and the archives a client can
 * upload need not be. (The file name ends in `spec.ts` so the build leaves it
 * out; it holds no test.)
 */

export interface CraftedEntry {
  name: string;
  data: Buffer | string;
  /** Deflate the data (default: stored). */
  deflate?: boolean;
}

interface WrittenEntry {
  name: Buffer;
  crc: number;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  offset: number;
}

/** A local file header followed by the entry's data. */
function localRecord(
  entry: CraftedEntry,
  offset: number,
): { bytes: Buffer; written: WrittenEntry } {
  const name = Buffer.from(entry.name, 'utf8');
  const data = Buffer.isBuffer(entry.data)
    ? entry.data
    : Buffer.from(entry.data);
  const method = entry.deflate ? 8 : 0;
  const stored = entry.deflate ? zlib.deflateRawSync(data) : data;
  const crc = zlib.crc32(data);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x0800, 6);
  header.writeUInt16LE(method, 8);
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(stored.length, 18);
  header.writeUInt32LE(data.length, 22);
  header.writeUInt16LE(name.length, 26);
  return {
    bytes: Buffer.concat([header, name, stored]),
    written: {
      name,
      crc,
      method,
      compressedSize: stored.length,
      uncompressedSize: data.length,
      offset,
    },
  };
}

/** One central directory record of `entry`, named `name` when given. */
function centralRecord(entry: WrittenEntry, name?: string): Buffer {
  const nameBuf = name === undefined ? entry.name : Buffer.from(name, 'utf8');
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0x0800, 8);
  header.writeUInt16LE(entry.method, 10);
  header.writeUInt32LE(entry.crc, 16);
  header.writeUInt32LE(entry.compressedSize, 20);
  header.writeUInt32LE(entry.uncompressedSize, 24);
  header.writeUInt16LE(nameBuf.length, 28);
  header.writeUInt32LE(entry.offset, 42);
  return Buffer.concat([header, nameBuf]);
}

/** An end-of-central-directory record. */
function endRecord(count: number, size: number, offset: number): Buffer {
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(count, 8);
  end.writeUInt16LE(count, 10);
  end.writeUInt32LE(size, 12);
  end.writeUInt32LE(offset, 16);
  return end;
}

function localRecords(entries: CraftedEntry[]): {
  body: Buffer;
  written: WrittenEntry[];
} {
  const parts: Buffer[] = [];
  const written: WrittenEntry[] = [];
  let offset = 0;
  for (const entry of entries) {
    const local = localRecord(entry, offset);
    parts.push(local.bytes);
    written.push(local.written);
    offset += local.bytes.length;
  }
  return { body: Buffer.concat(parts), written };
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/**
 * `data` followed by four bytes chosen so that its CRC-32 is `target`: a
 * legitimate file whose CRC, written in the central directory, reads as any
 * four bytes (for example an end-of-central-directory signature).
 */
export function withCrc(data: Buffer, target: number): Buffer {
  const topIndex = new Map<number, number>();
  for (let i = 0; i < 256; i++) topIndex.set(CRC_TABLE[i] >>> 24, i);
  // Walk back from the wanted final state: each step's table index is
  // fixed by the top byte of the state after it.
  const indexes: number[] = [];
  let state = (target ^ 0xffffffff) >>> 0;
  for (let k = 0; k < 4; k++) {
    const index = topIndex.get(state >>> 24)!;
    indexes.unshift(index);
    state = (((state ^ CRC_TABLE[index]) << 8) >>> 0) & 0xffffffff;
  }
  // Then forward from the state after `data`, picking each byte.
  let s = (zlib.crc32(data) ^ 0xffffffff) >>> 0;
  const tail = Buffer.alloc(4);
  for (let k = 0; k < 4; k++) {
    tail[k] = (indexes[k] ^ s) & 0xff;
    s = (CRC_TABLE[indexes[k]] ^ (s >>> 8)) >>> 0;
  }
  return Buffer.concat([data, tail]);
}

/** A well-formed archive of `entries`. */
export function craftZip(entries: CraftedEntry[]): Buffer {
  const { body, written } = localRecords(entries);
  const directory = Buffer.concat(written.map((w) => centralRecord(w)));
  return Buffer.concat([
    body,
    directory,
    endRecord(written.length, directory.length, body.length),
  ]);
}

/**
 * An archive that ends with two end-of-central-directory records, each
 * pointing at its own central directory. A reader that takes the last record
 * sees `visible` only; one that takes the first sees `hidden` too, and
 * `decoys` more records that all point at the first visible entry's data.
 */
export function twoEndRecordsZip(
  visible: CraftedEntry[],
  hidden: CraftedEntry[],
  decoys = 0,
): Buffer {
  const { body, written } = localRecords([...visible, ...hidden]);
  const visibleWritten = written.slice(0, visible.length);
  const firstDirectory = Buffer.concat([
    ...Array.from({ length: decoys }, () =>
      centralRecord(visibleWritten[0], 'a.py'),
    ),
    ...written.map((w) => centralRecord(w)),
  ]);
  const firstOffset = body.length;
  const secondDirectory = Buffer.concat(
    visibleWritten.map((w) => centralRecord(w)),
  );
  const secondOffset = firstOffset + firstDirectory.length;
  const firstCount = Math.min(decoys + written.length, 0xffff);
  return Buffer.concat([
    body,
    firstDirectory,
    secondDirectory,
    endRecord(firstCount, firstDirectory.length, firstOffset),
    endRecord(visibleWritten.length, secondDirectory.length, secondOffset),
  ]);
}

/**
 * An archive with one end record whose central directory holds `copies`
 * records of the same entry: every record points at the same data.
 */
export function overlappingRecordsZip(entry: CraftedEntry, copies: number) {
  const { body, written } = localRecords([entry]);
  const directory = Buffer.concat(
    Array.from({ length: copies }, (_, i) =>
      centralRecord(written[0], `src/copy${i}.py`),
    ),
  );
  return Buffer.concat([
    body,
    directory,
    endRecord(copies, directory.length, body.length),
  ]);
}

/**
 * A well-formed archive of `entries` with `extra` bytes between the last
 * entry's data and the central directory, which no record accounts for.
 */
export function unaccountedDataZip(
  entries: CraftedEntry[],
  extra: Buffer,
): Buffer {
  const { body, written } = localRecords(entries);
  const directory = Buffer.concat(written.map((w) => centralRecord(w)));
  const offset = body.length + extra.length;
  return Buffer.concat([
    body,
    extra,
    directory,
    endRecord(written.length, directory.length, offset),
  ]);
}

/**
 * A well-formed archive of `entries` whose end record carries, as its
 * comment, a second end record: a reader that takes the last record reads one
 * directory, one that takes the first reads the comment as comment.
 */
export function endRecordInCommentZip(entries: CraftedEntry[]): Buffer {
  const good = craftZip(entries);
  const end = Buffer.from(good.subarray(good.length - 22));
  const second = Buffer.from(end);
  end.writeUInt16LE(22, 20);
  return Buffer.concat([good.subarray(0, good.length - 22), end, second]);
}

/**
 * A well-formed archive of `visible` whose last central directory record
 * carries, in its file comment, a whole second archive end: an end record
 * pointing at a central directory of `hidden` (placed before the real one).
 */
export function endRecordInDirectoryZip(
  visible: CraftedEntry[],
  hidden: CraftedEntry[],
): Buffer {
  const { body, written } = localRecords([...visible, ...hidden]);
  const hiddenDirectory = Buffer.concat(written.map((w) => centralRecord(w)));
  const hiddenOffset = body.length;
  const realOffset = hiddenOffset + hiddenDirectory.length;
  const nested = endRecord(
    written.length,
    hiddenDirectory.length,
    hiddenOffset,
  );
  const records = written.slice(0, visible.length).map((w) => centralRecord(w));
  const last = records[records.length - 1];
  last.writeUInt16LE(nested.length, 32);
  records[records.length - 1] = Buffer.concat([last, nested]);
  const realDirectory = Buffer.concat(records);
  return Buffer.concat([
    body,
    hiddenDirectory,
    realDirectory,
    endRecord(records.length, realDirectory.length, realOffset),
  ]);
}
