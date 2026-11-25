import { Readable, Transform } from 'node:stream';

/**
 * Size limits of an uploaded full-scan archive.
 *
 * A ZIP is a few megabytes on the wire and can inflate to gigabytes, so the
 * compressed size alone bounds nothing. The archive is checked twice:
 *
 *  - before it is filtered, from its central directory (no byte inflated):
 *    entry count, every entry's declared size and their total
 *    (`openCheckedZip`, zip-archive.util.ts, whose reading the filter uses);
 *  - while it is filtered, by counting the bytes each entry actually inflates
 *    to ({@link InflateMeter}), because the sizes a ZIP declares are written by
 *    whoever built it and can be false.
 */
export interface ZipLimits {
  /** Compressed size of the uploaded object. */
  maxArchiveBytes: number;
  /** Entries in the central directory, directories included. */
  maxEntries: number;
  /** Uncompressed size of a single entry. */
  maxEntryBytes: number;
  /** Uncompressed size of all entries together. */
  maxTotalBytes: number;
}

const GIB = 1024 ** 3;

/**
 * Defaults: 5 GiB compressed (what a signed GCS upload already accepts),
 * 5 GiB uncompressed (the repository-archive limit of the scans run from a
 * Git provider), 1 GiB per entry and 200,000 entries.
 */
export const DEFAULT_ZIP_LIMITS: Readonly<ZipLimits> = Object.freeze({
  maxArchiveBytes: 5 * GIB,
  maxEntries: 200_000,
  maxEntryBytes: GIB,
  maxTotalBytes: 5 * GIB,
});

/**
 * What the scanners of an edition accept of the archive file-management
 * forwards to them (the filtered archive): its size as downloaded, its
 * entries, and their total size once unpacked.
 */
export interface ScannerArchiveLimits {
  maxArchiveBytes: number;
  maxEntries: number;
  maxTotalBytes: number;
}

/**
 * The bounds of the Community Edition's scanner pods: each pod downloads the
 * filtered archive and refuses it past 2 GiB downloaded, 3 GiB unpacked or
 * 200,000 entries. Accepted here, such an archive would start every pod of
 * the scan for nothing, so the archive is refused before any pod starts.
 *
 * They must equal the pods' own bounds, `MaxDownloadBytes`,
 * `MaxUnpackedBytes` and `MaxEntries` in `internal/archive/archive.go` of the
 * cybedefend-scanners repository, which accepts a value equal to a bound and
 * refuses one past it, as the checks here do. Change both together:
 * zip-limits.util.spec.ts pins these values at each bound.
 */
export const COMMUNITY_SCANNER_ARCHIVE_LIMITS: Readonly<ScannerArchiveLimits> =
  Object.freeze({
    maxArchiveBytes: 2 * GIB,
    maxEntries: 200_000,
    maxTotalBytes: 3 * GIB,
  });

/**
 * The scanner bounds of `edition`, or null when its scanners take whatever
 * the upload limits let through.
 */
export function scannerArchiveLimits(
  edition: string,
): Readonly<ScannerArchiveLimits> | null {
  return edition === 'community' ? COMMUNITY_SCANNER_ARCHIVE_LIMITS : null;
}

/**
 * The limits of what is forwarded to the scanners: the upload limits,
 * tightened by the scanners' own bounds when they have some.
 */
export function forwardedZipLimits(
  limits: ZipLimits,
  scanner: Readonly<ScannerArchiveLimits> | null,
): ZipLimits {
  if (!scanner) return limits;
  return {
    maxArchiveBytes: Math.min(limits.maxArchiveBytes, scanner.maxArchiveBytes),
    maxEntries: Math.min(limits.maxEntries, scanner.maxEntries),
    maxEntryBytes: Math.min(limits.maxEntryBytes, scanner.maxTotalBytes),
    maxTotalBytes: Math.min(limits.maxTotalBytes, scanner.maxTotalBytes),
  };
}

/** Whether `count` entries are past the entry limit (equal to it is accepted). */
export function exceedsEntryLimit(
  count: number,
  limits: Pick<ZipLimits, 'maxEntries'>,
): boolean {
  return count > limits.maxEntries;
}

/** The variable of each limit. */
export const ZIP_LIMIT_ENV: Readonly<Record<keyof ZipLimits, string>> =
  Object.freeze({
    maxArchiveBytes: 'FULL_SCAN_MAX_ARCHIVE_BYTES',
    maxEntries: 'FULL_SCAN_MAX_ENTRIES',
    maxEntryBytes: 'FULL_SCAN_MAX_ENTRY_BYTES',
    maxTotalBytes: 'FULL_SCAN_MAX_UNCOMPRESSED_BYTES',
  });

/**
 * Why an archive was refused, by its stable name: one of its limits (90-93),
 * or an archive that cannot be scanned at all (94-98). The numbers are the
 * scan failure codes stored on the scan (`errorCode`, category `archive`, 90-99):
 * security-scanning's scan failure table and the dashboard's messages key on
 * the same numbers, so a number never changes meaning.
 */
export const ARCHIVE_FAILURE_CODES = Object.freeze({
  /** The uploaded object is larger than `FULL_SCAN_MAX_ARCHIVE_BYTES`. */
  ARCHIVE_TOO_LARGE: 90,
  /** More entries than `FULL_SCAN_MAX_ENTRIES`. */
  ARCHIVE_TOO_MANY_ENTRIES: 91,
  /** One entry larger than `FULL_SCAN_MAX_ENTRY_BYTES` once inflated. */
  ARCHIVE_ENTRY_TOO_LARGE: 92,
  /** All entries larger than `FULL_SCAN_MAX_UNCOMPRESSED_BYTES` once inflated. */
  ARCHIVE_INFLATED_TOO_LARGE: 93,
  /** The uploaded object is not a readable ZIP archive. */
  ARCHIVE_INVALID: 94,
  /** A valid ZIP that holds no file. */
  ARCHIVE_EMPTY: 95,
  /** A password-protected archive: its entries cannot be read. */
  ARCHIVE_ENCRYPTED: 96,
  /** An entry whose path is absolute or leaves the archive's folder. */
  ARCHIVE_UNSAFE_PATH: 97,
  /** No archive was uploaded before the upload deadline. */
  ARCHIVE_NOT_RECEIVED: 98,
} as const);

export type ArchiveFailureCode = keyof typeof ARCHIVE_FAILURE_CODES;

/** The `errorCategory` of a scan failed on an archive limit. */
export const ARCHIVE_FAILURE_CATEGORY = 'archive';

/** Longest part of an entry name quoted in a refusal. */
const MAX_QUOTED_NAME = 120;

export function quoteName(name: string): string {
  return name.length > MAX_QUOTED_NAME
    ? `…${name.slice(name.length - MAX_QUOTED_NAME + 1)}`
    : name;
}

/**
 * A refused archive (past a limit, or not scannable): its message is safe to
 * show to the user.
 */
export class ArchiveLimitError extends Error {
  constructor(
    readonly code: ArchiveFailureCode,
    message: string,
  ) {
    super(message);
    this.name = 'ArchiveLimitError';
  }

  /** The scan failure code stored on the scan. */
  get errorCode(): number {
    return ARCHIVE_FAILURE_CODES[this.code];
  }

  /** The message stored on the scan: the stable name, then the reason. */
  get scanErrorMessage(): string {
    return `${this.code}: ${this.message}`;
  }
}

function positive(raw: unknown, fallback: number): number {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** Read the limits through `get` (a ConfigService lookup), each with its default. */
export function resolveZipLimits(get: (key: string) => unknown): ZipLimits {
  const out = {} as ZipLimits;
  for (const key of Object.keys(ZIP_LIMIT_ENV) as (keyof ZipLimits)[]) {
    out[key] = positive(get(ZIP_LIMIT_ENV[key]), DEFAULT_ZIP_LIMITS[key]);
  }
  return out;
}

export function formatBytes(bytes: number): string {
  if (bytes >= GIB) return `${(bytes / GIB).toFixed(2)} GiB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(2)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(2)} KiB`;
  return `${bytes} bytes`;
}

/**
 * Counts the bytes the entries of one archive really inflate to, and fails
 * the stream of the entry that crosses a limit: one meter per archive, one
 * {@link wrap} per entry read.
 */
export class InflateMeter {
  private total = 0;
  private readonly limitHandlers: (() => void)[] = [];

  constructor(private readonly limits: ZipLimits) {}

  /** Run `handler` once a limit is crossed (before the entry's stream fails). */
  onLimit(handler: () => void): void {
    this.limitHandlers.push(handler);
  }

  private crossed(err: ArchiveLimitError): ArchiveLimitError {
    for (const handler of this.limitHandlers.splice(0)) handler();
    return err;
  }

  get totalBytes(): number {
    return this.total;
  }

  /**
   * Wrap an entry's inflating stream. The returned stream yields the same
   * bytes and errors with an {@link ArchiveLimitError} (destroying the source,
   * so no more is inflated) as soon as the entry, or the archive so far,
   * crosses its limit. An error of the source is passed on.
   */
  wrap(source: NodeJS.ReadableStream, name: string): Readable {
    let entryBytes = 0;
    const limits = this.limits;
    const counter = new Transform({
      transform: (chunk: Buffer, _enc, cb) => {
        entryBytes += chunk.length;
        this.total += chunk.length;
        if (entryBytes > limits.maxEntryBytes) {
          return cb(
            this.crossed(
              new ArchiveLimitError(
                'ARCHIVE_ENTRY_TOO_LARGE',
                `An archive entry inflates past the ${formatBytes(limits.maxEntryBytes)} entry limit: ${quoteName(name)}`,
              ),
            ),
          );
        }
        if (this.total > limits.maxTotalBytes) {
          return cb(
            this.crossed(
              new ArchiveLimitError(
                'ARCHIVE_INFLATED_TOO_LARGE',
                `The archive inflates past the ${formatBytes(limits.maxTotalBytes)} total limit`,
              ),
            ),
          );
        }
        cb(null, chunk);
      },
    });
    const src = source as Readable;
    const fail = (err: Error) => {
      if (typeof src.destroy === 'function') src.destroy();
      counter.destroy(err);
    };
    src.on('error', fail);
    counter.on('error', () => {
      if (typeof src.destroy === 'function') src.destroy();
    });
    src.pipe(counter);
    return counter;
  }
}
