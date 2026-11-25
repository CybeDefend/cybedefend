import type {
  ExcludedFolder,
  UploadFilterSummary,
} from '@grpc/security-scanning/scan';

/**
 * What the upload filter left out of a scan's archive, as stored on the scan
 * (`scan.uploadFilterSummary`) and returned with it. The sender's sizes are
 * not trusted: the summary is bounded here before it is stored.
 */

/** Excluded folders stored on a scan, the largest first. */
export const MAX_STORED_EXCLUDED_FOLDERS = 20;

/** Characters of a folder name stored on a scan. */
export const MAX_STORED_FOLDER_NAME_LENGTH = 200;

const COUNT_FIELDS = [
  'scannerConfiguration',
  'excludedPath',
  'excludedType',
  'unsafeName',
  'gitMetadata',
] as const;

const INT32_MAX = 2 ** 31 - 1;

function isCount(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= INT32_MAX
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Control characters (C0, DEL, C1: NUL among them, which PostgreSQL refuses
 * in a jsonb string) and the bidirectional controls (embeddings, overrides,
 * isolates, marks), which could reorder the text a name is shown in.
 */

const UNSAFE_CHARACTERS = /[\u0000-\u001f\u007f-\u009f؜‎‏‪-‮⁦-⁩]/g;

/** Characters of a received name read at most, before it is cleaned and cut. */
const MAX_READ_NAME_LENGTH = 4096;

function boundedFolder(value: unknown): ExcludedFolder | null {
  if (!isRecord(value)) return null;
  const { name, count } = value;
  if (typeof name !== 'string' || !isCount(count)) return null;
  const cleaned = name
    .slice(0, MAX_READ_NAME_LENGTH)
    .replace(UNSAFE_CHARACTERS, '');
  if (cleaned.length === 0) return null;
  const characters = [...cleaned];
  return {
    name: characters.slice(0, MAX_STORED_FOLDER_NAME_LENGTH).join(''),
    count,
  };
}

/**
 * The summary to store, or null when there is none or it is malformed (a
 * count that is not a non-negative 32-bit integer). A missing count reads as
 * zero; a folder entry that is malformed is dropped, the list is cut to the
 * largest MAX_STORED_EXCLUDED_FOLDERS, each name to
 * MAX_STORED_FOLDER_NAME_LENGTH characters, and no other field is kept.
 */
export function boundUploadFilterSummary(
  input: unknown,
): UploadFilterSummary | null {
  if (!isRecord(input)) return null;

  const counts = {} as Record<(typeof COUNT_FIELDS)[number], number>;
  for (const field of COUNT_FIELDS) {
    const value = input[field] ?? 0;
    if (!isCount(value)) return null;
    counts[field] = value;
  }

  const folders = Array.isArray(input.excludedFolders)
    ? input.excludedFolders
    : [];
  const excludedFolders = folders
    .map(boundedFolder)
    .filter((folder): folder is ExcludedFolder => folder !== null)
    .sort((a, b) =>
      b.count !== a.count ? b.count - a.count : a.name < b.name ? -1 : 1,
    )
    .slice(0, MAX_STORED_EXCLUDED_FOLDERS);

  return { ...counts, excludedFolders };
}
