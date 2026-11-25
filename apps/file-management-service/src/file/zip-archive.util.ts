import * as fs from 'node:fs';
import { PassThrough, Readable } from 'node:stream';
import * as yauzl from 'yauzl';
import {
  ArchiveLimitError,
  exceedsEntryLimit,
  formatBytes,
  quoteName,
  ZipLimits,
} from './zip-limits.util';

/**
 * One reading of an uploaded ZIP archive, shared by every check and by the
 * filter that rewrites it.
 *
 * A ZIP is located from its end: a reader looks for the end-of-central-
 * directory record, which says where the central directory (the list of
 * entries) is. A file can carry several such records, or a central directory
 * that does not describe all of its bytes, and two readers may then see two
 * different archives in the same file. So the archive is opened once, its
 * structure is refused unless it has exactly one reading, and the entries
 * the checks saw are the entries the filter reads, from the same open file.
 *
 * Refused (`ARCHIVE_INVALID`):
 *  - bytes between the central directory and its end record (other than the
 *    zip64 records), a second end record among them, or bytes after the end
 *    record's comment;
 *  - a central directory whose records do not add up to its declared size;
 *  - entry data that overlaps another entry's, or bytes between entries that
 *    no record accounts for (a data descriptor excepted).
 *
 * The declared limits (entry count, entry and total uncompressed size) are
 * checked on that same reading, before anything is inflated; the bytes each
 * entry really inflates to are counted while it is read ({@link InflateMeter}),
 * since a declared size is written by whoever built the archive.
 */

const END_SIGNATURE = 0x06054b50;
const END_SIZE = 22;
const MAX_COMMENT = 0xffff;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP64_LOCATOR_SIZE = 20;
const ZIP64_END_SIGNATURE = 0x06064b50;
const ZIP64_END_FIXED_SIZE = 12;
const LOCAL_SIGNATURE = 0x04034b50;
const LOCAL_HEADER_SIZE = 30;
const CENTRAL_HEADER_SIZE = 46;
/** General-purpose flag bit 3: sizes and CRC follow the data. */
const DATA_DESCRIPTOR_FLAG = 0x08;
/** A data descriptor: with or without its signature, 32- or 64-bit sizes. */
const DATA_DESCRIPTOR_SIZES = new Set([12, 16, 20, 24]);
/** Bytes read at once when the central directory is searched. */
const SEARCH_CHUNK = 1024 * 1024;

/** Where the central directory of an archive is, read from its end. */
export interface ZipLayout {
  fileSize: number;
  entryCount: number;
  centralDirectoryOffset: number;
  centralDirectorySize: number;
  /** Offset of the first record after the central directory. */
  trailerOffset: number;
  /** Offset of the end-of-central-directory record. */
  endOffset: number;
}

/** One entry of the central directory, as read once. */
export interface ZipEntryRecord {
  /** The name as stored, read as UTF-8: what the filter judges and writes. */
  name: string;
  /**
   * Why the name is refused (absolute, or climbing out of the archive's
   * folder, as the ZIP reader reads it), or null.
   */
  unsafeName: string | null;
  /** A folder entry, as the ZIP reader reads its name. */
  isDirectoryName: boolean;
  encrypted: boolean;
  generalPurposeBitFlag: number;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  relativeOffsetOfLocalHeader: number;
}

/** What is used of a yauzl entry (the package ships no types). */
interface YauzlEntry {
  fileName: Buffer;
  extraFields: { id: number; data: Buffer }[];
  fileNameLength: number;
  extraFieldLength: number;
  fileCommentLength: number;
  generalPurposeBitFlag: number;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  relativeOffsetOfLocalHeader: number;
  isEncrypted(): boolean;
}

/** What is used of a yauzl ZipFile. */
interface YauzlZipFile extends NodeJS.EventEmitter {
  entryCount: number;
  readEntry(): void;
  close(): void;
  openReadStream(
    entry: YauzlEntry,
    callback: (err: Error | null, stream?: Readable) => void,
  ): void;
}

function invalid(message: string): ArchiveLimitError {
  return new ArchiveLimitError('ARCHIVE_INVALID', message);
}

const UNREADABLE = 'The uploaded file is not a ZIP archive that can be read';
const TWO_ENDS =
  'The archive holds more than one end-of-central-directory record: it reads as more than one archive';
const UNACCOUNTED =
  'The archive holds data its central directory does not account for';

async function readAt(
  fh: fs.promises.FileHandle,
  length: number,
  position: number,
): Promise<Buffer> {
  const buf = Buffer.alloc(length);
  const { bytesRead } = await fh.read(buf, 0, length, position);
  if (bytesRead !== length) throw invalid(UNREADABLE);
  return buf;
}

function readUInt64(buf: Buffer, offset: number): number {
  const value = buf.readBigUInt64LE(offset);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw invalid(UNREADABLE);
  return Number(value);
}

/**
 * Locate the central directory as the ZIP reader does (the last end record
 * of the file), and refuse bytes after the end record's comment or between
 * the zip64 records and the end record. Whether the central directory ends
 * where its end records start is checked by the caller.
 */
export async function readZipLayout(
  fh: fs.promises.FileHandle,
  fileSize: number,
): Promise<ZipLayout> {
  if (fileSize < END_SIZE) throw invalid(UNREADABLE);
  const tailSize = Math.min(
    fileSize,
    END_SIZE + MAX_COMMENT + ZIP64_LOCATOR_SIZE,
  );
  const tail = await readAt(fh, tailSize, fileSize - tailSize);
  let at = -1;
  for (let i = tail.length - END_SIZE; i >= 0; i--) {
    if (tail.readUInt32LE(i) === END_SIGNATURE) {
      at = i;
      break;
    }
  }
  if (at < 0) throw invalid(UNREADABLE);
  const endOffset = fileSize - tailSize + at;
  const commentLength = tail.readUInt16LE(at + 20);
  // Nothing after the end record but its comment.
  if (endOffset + END_SIZE + commentLength !== fileSize) {
    throw invalid(UNACCOUNTED);
  }
  if (tail.readUInt16LE(at + 4) !== 0 || tail.readUInt16LE(at + 6) !== 0) {
    throw invalid('Archives split over several files are not supported');
  }
  let entryCount = tail.readUInt16LE(at + 10);
  let centralDirectorySize = tail.readUInt32LE(at + 12);
  let centralDirectoryOffset = tail.readUInt32LE(at + 16);
  let trailerOffset = endOffset;

  const locatorOffset = endOffset - ZIP64_LOCATOR_SIZE;
  if (locatorOffset >= 0) {
    const locator = await readAt(fh, ZIP64_LOCATOR_SIZE, locatorOffset);
    if (locator.readUInt32LE(0) === ZIP64_LOCATOR_SIGNATURE) {
      const zip64Offset = readUInt64(locator, 8);
      if (zip64Offset + 56 > locatorOffset) throw invalid(UNACCOUNTED);
      const zip64 = await readAt(fh, 56, zip64Offset);
      if (zip64.readUInt32LE(0) !== ZIP64_END_SIGNATURE) {
        throw invalid(UNREADABLE);
      }
      // The zip64 end record (its declared size covers what follows its
      // first 12 bytes) ends where the locator starts.
      if (
        zip64Offset + ZIP64_END_FIXED_SIZE + readUInt64(zip64, 4) !==
        locatorOffset
      ) {
        throw invalid(UNACCOUNTED);
      }
      entryCount = readUInt64(zip64, 32);
      centralDirectorySize = readUInt64(zip64, 40);
      centralDirectoryOffset = readUInt64(zip64, 48);
      trailerOffset = zip64Offset;
    }
  }
  return {
    fileSize,
    entryCount,
    centralDirectoryOffset,
    centralDirectorySize,
    trailerOffset,
    endOffset,
  };
}

/**
 * Refuse a central directory that does not end where its end records start.
 *
 * Only the gap between them is searched for a second end record, to name the
 * refusal: the central directory itself is binary (CRCs, sizes, offsets) and
 * may hold the signature's four bytes in a legitimate archive. With a single
 * reader, the structure alone excludes a second reading: the end record and
 * its comment end the file, the directory ends exactly where its end records
 * start, and its records add up to its size.
 */
async function assertDirectoryEndsAtEndRecords(
  fh: fs.promises.FileHandle,
  layout: ZipLayout,
): Promise<void> {
  const directoryEnd =
    layout.centralDirectoryOffset + layout.centralDirectorySize;
  if (directoryEnd === layout.trailerOffset) return;
  const end = layout.endOffset;
  const start = Math.min(Math.max(directoryEnd, 0), end);
  for (let pos = start; pos < end; pos += SEARCH_CHUNK) {
    // Three bytes of overlap, so a signature across two chunks is seen.
    const length = Math.min(SEARCH_CHUNK + 3, end - pos);
    const chunk = await readAt(fh, length, pos);
    for (
      let i = chunk.indexOf(0x50);
      i >= 0 && i + 4 <= length;
      i = chunk.indexOf(0x50, i + 1)
    ) {
      if (chunk.readUInt32LE(i) === END_SIGNATURE) throw invalid(TWO_ENDS);
    }
  }
  throw invalid(UNACCOUNTED);
}

/**
 * Refuse entries whose data overlaps, or bytes between the start of the file,
 * the entries and the central directory that no record accounts for. Reads
 * each local header (30 bytes) once.
 */
async function assertEntriesAccountForData(
  fh: fs.promises.FileHandle,
  records: ZipEntryRecord[],
  layout: ZipLayout,
): Promise<void> {
  const byOffset = [...records].sort(
    (a, b) => a.relativeOffsetOfLocalHeader - b.relativeOffsetOfLocalHeader,
  );
  let expected = 0;
  let descriptorAllowed = false;
  const header = Buffer.alloc(LOCAL_HEADER_SIZE);
  const atBoundary = (offset: number) => {
    const gap = offset - expected;
    if (gap === 0) return;
    if (descriptorAllowed && DATA_DESCRIPTOR_SIZES.has(gap)) return;
    throw invalid(UNACCOUNTED);
  };
  for (const record of byOffset) {
    const offset = record.relativeOffsetOfLocalHeader;
    atBoundary(offset);
    const { bytesRead } = await fh.read(header, 0, LOCAL_HEADER_SIZE, offset);
    if (
      bytesRead !== LOCAL_HEADER_SIZE ||
      header.readUInt32LE(0) !== LOCAL_SIGNATURE
    ) {
      throw invalid(UNACCOUNTED);
    }
    const dataStart =
      offset +
      LOCAL_HEADER_SIZE +
      header.readUInt16LE(26) +
      header.readUInt16LE(28);
    expected = dataStart + record.compressedSize;
    descriptorAllowed =
      (record.generalPurposeBitFlag & DATA_DESCRIPTOR_FLAG) !== 0;
    if (expected > layout.centralDirectoryOffset) throw invalid(UNACCOUNTED);
  }
  atBoundary(layout.centralDirectoryOffset);
}

/** The ZIP reader's refusal of a name, or null when it accepts it. */
function nameRefusal(entry: YauzlEntry): {
  refusal: string | null;
  readName: string;
} {
  const readName: string = yauzl.getFileNameLowLevel(
    entry.generalPurposeBitFlag,
    entry.fileName,
    entry.extraFields,
    false,
  );
  const refusal: string | null = yauzl.validateFileName(readName);
  return { refusal, readName };
}

function toRecord(entry: YauzlEntry): ZipEntryRecord {
  const { refusal, readName } = nameRefusal(entry);
  const flags = entry.generalPurposeBitFlag;
  return {
    name: entry.fileName.toString('utf8'),
    unsafeName: refusal === null ? null : readName,
    isDirectoryName: readName.endsWith('/'),
    encrypted: entry.isEncrypted() || (flags & 0x41) !== 0,
    generalPurposeBitFlag: flags,
    compressionMethod: entry.compressionMethod,
    compressedSize: entry.compressedSize,
    uncompressedSize: entry.uncompressedSize,
    relativeOffsetOfLocalHeader: entry.relativeOffsetOfLocalHeader,
  };
}

/**
 * An archive opened and checked once. Its entries are read from the same
 * open file the checks read; {@link close} once done with it.
 */
export class CheckedZip {
  private closed = false;

  constructor(
    private readonly zipfile: YauzlZipFile,
    private readonly fh: fs.promises.FileHandle,
    /** The entries, in central directory order. */
    readonly entries: readonly ZipEntryRecord[],
    /** The uncompressed size the entries declare, all together. */
    readonly declaredTotalBytes: number,
  ) {}

  /**
   * The inflated bytes of `record`. A read error (corrupt data, an encrypted
   * or unsupported entry) fails the stream with `ARCHIVE_INVALID`.
   */
  openEntry(record: ZipEntryRecord): Promise<Readable> {
    const entry = Object.assign(new yauzl.Entry(), {
      generalPurposeBitFlag: record.generalPurposeBitFlag,
      compressionMethod: record.compressionMethod,
      compressedSize: record.compressedSize,
      uncompressedSize: record.uncompressedSize,
      relativeOffsetOfLocalHeader: record.relativeOffsetOfLocalHeader,
    }) as YauzlEntry;
    const unreadable = () =>
      invalid(`An archive entry cannot be read: ${quoteName(record.name)}`);
    return new Promise((resolve, reject) => {
      this.zipfile.openReadStream(entry, (err, source) => {
        if (err || !source) return reject(unreadable());
        const out = new PassThrough();
        source.on('error', (readErr: Error) =>
          out.destroy(isSystemError(readErr) ? readErr : unreadable()),
        );
        out.on('close', () => {
          if (!source.destroyed) source.destroy();
        });
        source.pipe(out);
        resolve(out);
      });
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.zipfile.close();
    } catch {
      /* already closed */
    }
    void this.fh.close().catch(() => undefined);
  }
}

/** A range of the file, read through the handle (no descriptor of its own). */
function rangeStream(
  fh: fs.promises.FileHandle,
  start: number,
  end: number,
): Readable {
  let position = start;
  return new Readable({
    highWaterMark: 64 * 1024,
    read(size) {
      const length = Math.min(size, end - position);
      if (length <= 0) {
        this.push(null);
        return;
      }
      const buf = Buffer.allocUnsafe(length);
      fh.read(buf, 0, length, position).then(
        ({ bytesRead }) => {
          if (bytesRead === 0) {
            this.destroy(new Error('unexpected end of file'));
            return;
          }
          position += bytesRead;
          this.push(buf.subarray(0, bytesRead));
        },
        (err: Error) => this.destroy(err),
      );
    },
  });
}

/**
 * The ZIP reader's access to the archive, through the one file handle this
 * module opens. Its close does nothing: the handle has a single owner, which
 * closes it once. (Given a bare descriptor, the reader would close it itself,
 * and a second close of the same number could hit whatever the process opened
 * in between.)
 */
class HandleReader extends yauzl.RandomAccessReader {
  constructor(private readonly fh: fs.promises.FileHandle) {
    super();
  }

  _readStreamForRange(start: number, end: number): Readable {
    return rangeStream(this.fh, start, end);
  }

  read(
    buffer: Buffer,
    offset: number,
    length: number,
    position: number,
    callback: (err: Error | null, bytesRead?: number) => void,
  ): void {
    this.fh.read(buffer, offset, length, position).then(
      ({ bytesRead }) => callback(null, bytesRead),
      (err: Error) => callback(err),
    );
  }

  close(callback: (err?: Error) => void): void {
    setImmediate(() => callback());
  }
}

/** Map an error of the ZIP reader to the refusal stored on the scan. */
/**
 * Whether `err` is a failure of this process's file system (too many open
 * files, no space left, an I/O error): it says nothing of the archive, so it
 * is passed on as is, for the caller to retry rather than refuse the upload.
 */
export function isSystemError(err: unknown): err is NodeJS.ErrnoException {
  const e = err as { code?: unknown; syscall?: unknown } | null;
  return (
    typeof e?.code === 'string' &&
    /^E[A-Z0-9]+$/.test(e.code) &&
    typeof e.syscall === 'string'
  );
}

function readerRefusal(err: unknown): Error {
  if (err instanceof ArchiveLimitError) return err;
  if (isSystemError(err)) return err;
  const message = err instanceof Error ? err.message : String(err);
  if (/strong encryption/.test(message)) {
    return new ArchiveLimitError(
      'ARCHIVE_ENCRYPTED',
      'The archive is password-protected: encrypted archives cannot be scanned',
    );
  }
  if (/multi-disk/.test(message)) {
    return invalid('Archives split over several files are not supported');
  }
  return invalid(UNREADABLE);
}

/**
 * Open `zipPath` once, refuse an archive that does not have exactly one
 * reading or whose central directory exceeds `limits`, and hand back its
 * entries with a way to read them from that same reading.
 *
 * Costs O(entries) time and memory: no entry is inflated. The entry count is
 * checked from the end record before a single entry is read.
 *
 * @throws ArchiveLimitError when the archive is refused; a file-system
 *   error ({@link isSystemError}) as is.
 */
export async function openCheckedZip(
  zipPath: string,
  limits: Pick<ZipLimits, 'maxEntries' | 'maxEntryBytes' | 'maxTotalBytes'>,
): Promise<CheckedZip> {
  const fh = await fs.promises.open(zipPath, 'r');
  let zipfile: YauzlZipFile | null = null;
  try {
    const { size } = await fh.stat();
    const layout = await readZipLayout(fh, size);
    if (exceedsEntryLimit(layout.entryCount, limits)) {
      throw new ArchiveLimitError(
        'ARCHIVE_TOO_MANY_ENTRIES',
        `The archive holds more than ${limits.maxEntries} entries (${layout.entryCount})`,
      );
    }
    await assertDirectoryEndsAtEndRecords(fh, layout);

    zipfile = await new Promise<YauzlZipFile>((resolve, reject) => {
      yauzl.fromRandomAccessReader(
        new HandleReader(fh),
        size,
        {
          lazyEntries: true,
          autoClose: false,
          decodeStrings: false,
          // The bytes an entry really inflates to are counted while it is
          // read, against the limits, whatever it declares.
          validateEntrySizes: false,
        },
        (err: Error | null, zf?: YauzlZipFile) =>
          err || !zf ? reject(readerRefusal(err)) : resolve(zf),
      );
    });
    if (zipfile.entryCount !== layout.entryCount) throw invalid(UNREADABLE);

    const records: ZipEntryRecord[] = [];
    let directoryBytes = 0;
    let totalBytes = 0;
    const zf = zipfile;
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const fail = (err: unknown) => {
        if (settled) return;
        settled = true;
        reject(readerRefusal(err));
      };
      zf.on('error', fail);
      zf.on('end', () => {
        if (settled) return;
        settled = true;
        resolve();
      });
      zf.on('entry', (entry: YauzlEntry) => {
        if (settled) return;
        directoryBytes +=
          CENTRAL_HEADER_SIZE +
          entry.fileNameLength +
          entry.extraFieldLength +
          entry.fileCommentLength;
        if (entry.uncompressedSize > limits.maxEntryBytes) {
          return fail(
            new ArchiveLimitError(
              'ARCHIVE_ENTRY_TOO_LARGE',
              `An archive entry is too large: ${formatBytes(entry.uncompressedSize)} uncompressed exceeds the ${formatBytes(limits.maxEntryBytes)} entry limit`,
            ),
          );
        }
        totalBytes += entry.uncompressedSize;
        if (totalBytes > limits.maxTotalBytes) {
          return fail(
            new ArchiveLimitError(
              'ARCHIVE_INFLATED_TOO_LARGE',
              `The archive is too large: ${formatBytes(totalBytes)} uncompressed exceeds the ${formatBytes(limits.maxTotalBytes)} limit`,
            ),
          );
        }
        try {
          records.push(toRecord(entry));
          zf.readEntry();
        } catch (err) {
          fail(err);
        }
      });
      zf.readEntry();
    });
    if (directoryBytes !== layout.centralDirectorySize) {
      throw invalid(UNACCOUNTED);
    }
    await assertEntriesAccountForData(fh, records, layout);
    return new CheckedZip(zipfile, fh, records, totalBytes);
  } catch (err) {
    try {
      zipfile?.close();
    } catch {
      /* already closed */
    }
    await fh.close().catch(() => undefined);
    throw readerRefusal(err);
  }
}

/**
 * Refuse an archive that cannot be scanned at all: a name the reader refuses
 * (absolute, or leaving the archive's folder), an encrypted entry, or no file.
 */
export function assertScannableZip(zip: CheckedZip): void {
  let files = 0;
  for (const record of zip.entries) {
    if (record.unsafeName !== null) {
      throw new ArchiveLimitError(
        'ARCHIVE_UNSAFE_PATH',
        `An entry's path is absolute or leaves the archive's folder: "${quoteName(record.unsafeName)}"`,
      );
    }
    if (record.encrypted) {
      throw new ArchiveLimitError(
        'ARCHIVE_ENCRYPTED',
        `The archive is password-protected (entry "${quoteName(record.name)}" is encrypted): encrypted archives cannot be scanned`,
      );
    }
    if (!record.isDirectoryName) files++;
  }
  if (files === 0) {
    throw new ArchiveLimitError('ARCHIVE_EMPTY', 'The archive holds no file');
  }
}
