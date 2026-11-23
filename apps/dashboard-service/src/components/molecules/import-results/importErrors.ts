/**
 * The refusals of a SARIF import, each shown as a fixed translated sentence
 * (`components.importResults.errors.<code>`), never as the server's text.
 *
 * - The import route answers its refusal in `body.code`, at any status.
 * - A scan that failed after the 202 carries the number `errorCode` 70–79
 *   (78 for a container import); its `errorMessage` is
 *   the code itself, read only when the number is absent.
 */

export const IMPORT_ROUTE_CODES = [
  'IMPORT_INVALID_REQUEST',
  'IMPORT_UNSUPPORTED_FORMAT',
  'IMPORT_UNSUPPORTED_FILE',
  'IMPORT_INVALID_SARIF',
  'IMPORT_UPLOAD_TOO_LARGE',
  'IMPORT_BUSY',
  'IMPORT_STORAGE_UNAVAILABLE',
  'IMPORT_UNAVAILABLE',
  'IMPORT_IMAGE_REQUIRED',
  'IMPORT_IMAGE_INVALID',
  'IMPORT_TYPE_NOT_AVAILABLE',
  // the optional CycloneDX SBOM of an sca import, refused by the route or,
  // once read, by the scan (79, the code itself in errorMessage)
  'IMPORT_INVALID_SBOM',
] as const;

export type ImportRouteCode = (typeof IMPORT_ROUTE_CODES)[number];

export type ImportScanCode =
  | 'IMPORT_INVALID_SARIF'
  | 'IMPORT_TOO_LARGE'
  | 'IMPORT_TOO_MANY_RESULTS'
  | 'IMPORT_TOO_MANY_RUNS'
  | 'IMPORT_STORAGE_UNAVAILABLE'
  | 'IMPORT_UNAVAILABLE'
  | 'IMPORT_TIMEOUT'
  | 'IMPORT_INTERNAL_ERROR'
  | 'IMPORT_UNSUPPORTED_RESULT'
  | 'IMPORT_INVALID_SBOM'
  | 'IMPORT_FAILED';

/** security-scanning's import failure codes (`scanlink-error-codes.ts`, 70–79). */
export const IMPORT_SCAN_CODES: Readonly<Record<number, ImportScanCode>> = Object.freeze({
  70: 'IMPORT_INVALID_SARIF',
  71: 'IMPORT_TOO_LARGE',
  72: 'IMPORT_TOO_MANY_RESULTS',
  73: 'IMPORT_TOO_MANY_RUNS',
  74: 'IMPORT_STORAGE_UNAVAILABLE',
  75: 'IMPORT_UNAVAILABLE',
  76: 'IMPORT_TIMEOUT',
  77: 'IMPORT_INTERNAL_ERROR',
  78: 'IMPORT_UNSUPPORTED_RESULT',
  // Any other IMPORT_[A-Z_]{1,40} code.
  79: 'IMPORT_FAILED',
});

export type ImportRefusal = ImportRouteCode | ImportScanCode | 'FORBIDDEN' | 'RATE_LIMITED' | 'GENERIC';

interface AnswerLike {
  status?: unknown;
  data?: unknown;
  headers?: unknown;
}

const answerOf = (error: unknown): AnswerLike | undefined => {
  if (!error || typeof error !== 'object') return undefined;
  const response = (error as { response?: unknown }).response;
  return response && typeof response === 'object' ? (response as AnswerLike) : undefined;
};

const ownString = (value: unknown, key: string): string | undefined => {
  if (!value || typeof value !== 'object' || !Object.prototype.hasOwnProperty.call(value, key)) return undefined;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === 'string' ? field : undefined;
};

const routeCodeOf = (answer: AnswerLike | undefined): ImportRouteCode | undefined => {
  const code = ownString(answer?.data, 'code');
  return code !== undefined && (IMPORT_ROUTE_CODES as readonly string[]).includes(code)
    ? (code as ImportRouteCode)
    : undefined;
};

/** The refusal of a failed upload: its route code at any status, else its status. */
export function importRefusalOfUpload(error: unknown): ImportRefusal {
  const answer = answerOf(error);
  const code = routeCodeOf(answer);
  if (code) return code;
  switch (answer?.status) {
    // A proxy's 413 (nginx's client_max_body_size) carries no code.
    case 413:
      return 'IMPORT_UPLOAD_TOO_LARGE';
    case 403:
      return 'FORBIDDEN';
    case 429:
      return 'RATE_LIMITED';
    default:
      return 'GENERIC';
  }
}

/** The `Retry-After` of a 503 IMPORT_BUSY, in seconds; null for any other answer. */
export function retryAfterSeconds(error: unknown): number | null {
  const answer = answerOf(error);
  if (routeCodeOf(answer) !== 'IMPORT_BUSY') return null;
  const raw = ownString(answer?.headers, 'retry-after');
  if (raw === undefined || !/^\d{1,5}$/.test(raw.trim())) return null;
  return Number(raw.trim());
}

const SCAN_CODE_IN_MESSAGE = /^IMPORT_[A-Z_]{1,40}$/;

/**
 * The scan failure codes that have no number of their own: a scan stores
 * them as 79 with the code itself in `errorMessage`, which names them.
 */
const SCAN_CODES_WITHOUT_NUMBER: readonly ImportScanCode[] = ['IMPORT_INVALID_SBOM'];

const messageCode = (scan: { errorMessage?: string }): string =>
  typeof scan.errorMessage === 'string' ? scan.errorMessage.trim() : '';

/**
 * The refusal of a failed import scan, from the number `errorCode` (70–79).
 * A 79 whose message is a whole code without a number of its own
 * (IMPORT_INVALID_SBOM) is that code. Only when the number is absent, the
 * message read as a whole code: a known one maps to itself, any other
 * `IMPORT_…` to IMPORT_FAILED.
 */
export function importRefusalOfScan(scan: {
  errorCode?: number;
  errorCategory?: string;
  errorMessage?: string;
}): ImportScanCode | null {
  const message = messageCode(scan);
  const withoutNumber = SCAN_CODES_WITHOUT_NUMBER.find((code) => code === message);
  if (typeof scan.errorCode === 'number') {
    if (scan.errorCode === 79 && withoutNumber) return withoutNumber;
    return IMPORT_SCAN_CODES[scan.errorCode] ?? null;
  }
  if (!SCAN_CODE_IN_MESSAGE.test(message)) return null;
  const known = Object.values(IMPORT_SCAN_CODES).find((code) => code === message && code !== 'IMPORT_FAILED');
  return known ?? withoutNumber ?? 'IMPORT_FAILED';
}

export function importRefusalKey(r: ImportRefusal): string {
  return `components.importResults.errors.${r}`;
}
