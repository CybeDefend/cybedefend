import { currentEdition, Edition } from 'src/edition/edition';
import { importRefusal } from './import-errors';

export const IMPORT_TYPES = [
  'sast',
  'iac',
  'secret',
  'cicd',
  'sca',
  'container',
] as const;
export type ImportType = (typeof IMPORT_TYPES)[number];

export const IMPORT_IMAGE_MAX_LENGTH = 255;
/** An image reference (registry, path, tag, digest), with `/` escaped for the literal. */
export const IMPORT_IMAGE_PATTERN =
  /^(?:[a-z0-9.-]+(?::[0-9]{1,5})?\/)?[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*(?::[A-Za-z0-9_][A-Za-z0-9._-]{0,127})?(?:@sha256:[a-f0-9]{64})?$/;

export interface ImportFields {
  type: ImportType;
  branch: string;
  /** Validated, then dropped: never returned. */
  commit?: string;
  format: 'sarif';
  /** container only */
  image?: string;
}

const KNOWN_FIELDS: readonly string[] = [
  'type',
  'branch',
  'commit',
  'format',
  'image',
];
const BRANCH_MAX_LENGTH = 255;
const COMMIT_PATTERN = /^[0-9a-f]{7,40}$/i;
// U+0000 to U+001F: a branch name never holds one, and a log line must not.
const CONTROL_CHARACTER = /[\u0000-\u001f]/;

const has = (raw: Record<string, string>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(raw, key);

/**
 * The multipart fields of an import, checked in the contract's order.
 * Throws a 400 `HttpException` whose body carries the code.
 * The edition is read per request, never at module load.
 *
 * The SARIF import is a Community Edition feature: every
 * other edition refuses every request with IMPORT_TYPE_NOT_AVAILABLE, before
 * any other field is read.
 */
export function parseImportFields(
  raw: Record<string, string>,
  edition: Edition = currentEdition(),
): ImportFields {
  if (edition !== 'community') {
    throw importRefusal('IMPORT_TYPE_NOT_AVAILABLE');
  }

  const type = has(raw, 'type') ? raw.type : undefined;
  if (!(IMPORT_TYPES as readonly unknown[]).includes(type)) {
    throw importRefusal('IMPORT_INVALID_REQUEST');
  }
  const importType = type as ImportType;

  // Taken as sent, not trimmed: the pattern refuses whitespace.
  const image = has(raw, 'image') ? raw.image : undefined;
  if (importType === 'container') {
    if (image === undefined || image === '') {
      throw importRefusal('IMPORT_IMAGE_REQUIRED');
    }
    if (
      image.length > IMPORT_IMAGE_MAX_LENGTH ||
      !IMPORT_IMAGE_PATTERN.test(image)
    ) {
      throw importRefusal('IMPORT_IMAGE_INVALID');
    }
  } else if (image !== undefined) {
    throw importRefusal('IMPORT_INVALID_REQUEST');
  }

  const rawBranch = has(raw, 'branch') ? raw.branch : undefined;
  if (typeof rawBranch !== 'string') {
    throw importRefusal('IMPORT_INVALID_REQUEST');
  }
  let branch = rawBranch.trim();
  if (branch.startsWith('refs/heads/')) {
    branch = branch.slice('refs/heads/'.length);
  }
  if (
    branch.length < 1 ||
    branch.length > BRANCH_MAX_LENGTH ||
    CONTROL_CHARACTER.test(branch)
  ) {
    throw importRefusal('IMPORT_INVALID_REQUEST');
  }

  if (has(raw, 'commit') && !COMMIT_PATTERN.test(raw.commit)) {
    throw importRefusal('IMPORT_INVALID_REQUEST');
  }

  if (has(raw, 'format') && raw.format !== 'sarif') {
    throw importRefusal('IMPORT_UNSUPPORTED_FORMAT');
  }

  if (Object.keys(raw).some((key) => !KNOWN_FIELDS.includes(key))) {
    throw importRefusal('IMPORT_INVALID_REQUEST');
  }

  return {
    type: importType,
    branch,
    format: 'sarif',
    ...(importType === 'container' ? { image } : {}),
  };
}

const UTF8_BOM = [0xef, 0xbb, 0xbf];
const JSON_WHITESPACE = new Set([0x20, 0x09, 0x0a, 0x0d]);

/**
 * The file part of an import: its name says whether it is gzip, and its
 * first bytes must agree (`head` is the start of the file). Throws a 400
 * `HttpException` whose body carries the code.
 */
export function checkImportFile(
  fileName: string,
  head: Buffer,
): { gzip: boolean } {
  const name = (fileName ?? '').toLowerCase();
  let gzip: boolean;
  if (name.endsWith('.sarif.gz')) {
    gzip = true;
  } else if (name.endsWith('.sarif') || name.endsWith('.json')) {
    gzip = false;
  } else {
    throw importRefusal('IMPORT_UNSUPPORTED_FILE');
  }

  if (head.length === 0) throw importRefusal('IMPORT_INVALID_SARIF');

  if (gzip) {
    if (head.length < 2 || head[0] !== 0x1f || head[1] !== 0x8b) {
      throw importRefusal('IMPORT_INVALID_SARIF');
    }
    return { gzip };
  }

  let i = 0;
  if (UTF8_BOM.every((byte, index) => head[index] === byte)) i = 3;
  while (i < head.length && JSON_WHITESPACE.has(head[i])) i++;
  if (head[i] !== 0x7b /* { */) throw importRefusal('IMPORT_INVALID_SARIF');
  return { gzip };
}

/**
 * The optional `sbom` part of an import: a CycloneDX JSON SBOM, sent with an
 * `sca` import only (its packages and the SARIF's vulnerabilities are one
 * picture of the branch; any other type is IMPORT_INVALID_REQUEST). Its name
 * says whether it is gzip (`.json.gz`) or not (`.json`, so `.cdx.json`), and
 * its first bytes must agree: gzip, or a JSON object. Anything else is
 * IMPORT_INVALID_SBOM; its content is read by analysis-reporting.
 */
export function checkImportSbom(
  type: ImportType,
  fileName: string,
  head: Buffer,
): { gzip: boolean } {
  if (type !== 'sca') throw importRefusal('IMPORT_INVALID_REQUEST');
  const name = (fileName ?? '').toLowerCase();
  let gzip: boolean;
  if (name.endsWith('.json.gz')) gzip = true;
  else if (name.endsWith('.json')) gzip = false;
  else throw importRefusal('IMPORT_INVALID_SBOM');

  if (gzip) {
    if (head.length < 2 || head[0] !== 0x1f || head[1] !== 0x8b) {
      throw importRefusal('IMPORT_INVALID_SBOM');
    }
    return { gzip };
  }
  let i = 0;
  if (UTF8_BOM.every((byte, index) => head[index] === byte)) i = 3;
  while (i < head.length && JSON_WHITESPACE.has(head[i])) i++;
  if (head[i] !== 0x7b /* { */) throw importRefusal('IMPORT_INVALID_SBOM');
  return { gzip };
}

/** `cybedefend-cli/…` and `cybedefend-scanner/…` are the CLI; anything else is manual. */
export function importSourceType(
  userAgent: string | undefined,
): 'cli' | 'manual' {
  if (typeof userAgent !== 'string') return 'manual';
  return userAgent.startsWith('cybedefend-cli/') ||
    userAgent.startsWith('cybedefend-scanner/')
    ? 'cli'
    : 'manual';
}
