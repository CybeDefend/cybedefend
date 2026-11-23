import { Readable } from 'stream';

/**
 * Import limits: 50 MiB uploaded, 200 MiB decompressed,
 * 100,000 results, 20 runs per file.
 *
 * The others bound what the reader builds in memory, whatever the
 * compression ratio: a few hundred KB of gzip can expand to 200 MiB of tiny
 * values, and every assembled value costs far more heap than its bytes.
 * - per run: 50,000 rules (driver and extensions together) and 200,000
 *   artifacts;
 * - the run headers of a file (tools, base URIs, artifact locations):
 *   2,000,000 values and 128 Mi characters of text, all runs together (the
 *   values are what costs heap; the text budget leaves room for 20 runs of
 *   fully documented rule packs, and the decompressed size bounds it too);
 * - one result: 100,000 values and 4 Mi characters of text.
 * A value is an object, an array, a key, a string, a number, a boolean or a
 * null. Past any of them the import fails with IMPORT_TOO_LARGE.
 */
export const SARIF_IMPORT_LIMITS = {
  maxUploadedBytes: 52_428_800,
  maxDecompressedBytes: 209_715_200,
  maxResults: 100_000,
  maxRuns: 20,
  maxRulesPerRun: 50_000,
  maxArtifactsPerRun: 200_000,
  maxHeaderValues: 2_000_000,
  maxHeaderChars: 128 * 1024 * 1024,
  maxValuesPerResult: 100_000,
  maxCharsPerResult: 4 * 1024 * 1024,
} as const;

export type SarifLimits = {
  [K in keyof typeof SARIF_IMPORT_LIMITS]: number;
};

/**
 * The deepest nesting of objects and arrays an imported JSON document may
 * have, the root counted. A SARIF result with code flows is about fifteen
 * levels deep and a CycloneDX component tree rarely more; a document past
 * this bound is refused before any further token is read, so a few bytes of
 * brackets cannot hold an import worker.
 */
export const MAX_IMPORT_JSON_DEPTH = 64;

export type ImportErrorCode =
  | 'IMPORT_INVALID_SARIF'
  | 'IMPORT_TOO_LARGE'
  | 'IMPORT_TOO_MANY_RESULTS'
  | 'IMPORT_TOO_MANY_RUNS'
  | 'IMPORT_STORAGE_UNAVAILABLE'
  // sca and container imports are all-or-nothing (scan code 78)
  | 'IMPORT_UNSUPPORTED_RESULT'
  // the CycloneDX SBOM of an sca import cannot be read (scan code 79, the
  // code itself in errorMessage)
  | 'IMPORT_INVALID_SBOM'
  // a job outside the Community Edition, whose feature SARIF import is
  // (scan code 79, the code itself in errorMessage)
  | 'IMPORT_TYPE_NOT_AVAILABLE';

export class ImportError extends Error {
  constructor(
    readonly code: ImportErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ImportError';
  }
}

/**
 * A fresh stream of the stored bytes (gzip or not) at each call: the import
 * reads the object more than once (headers, then results), so the source is
 * a factory, not a stream.
 */
export type SarifSource = () => Promise<Readable>;
