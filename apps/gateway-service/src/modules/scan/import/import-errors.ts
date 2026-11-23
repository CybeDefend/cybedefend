import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * The synchronous refusals of `POST /project/:projectId/scan/import/start`
 * (the SARIF import's codes, the sca and container import codes, and
 * IMPORT_INVALID_SBOM for the optional CycloneDX `sbom` part of an sca
 * import). Clients switch on `body.code`,
 * never on the message, which is a fixed sentence: nothing a client sent,
 * and nothing a downstream service answered, is echoed back.
 */
export const IMPORT_REQUEST_CODES = [
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
  'IMPORT_INVALID_SBOM',
] as const;

export type ImportRequestCode = (typeof IMPORT_REQUEST_CODES)[number];

const REFUSALS: Readonly<
  Record<ImportRequestCode, { status: HttpStatus; message: string }>
> = {
  IMPORT_INVALID_REQUEST: {
    status: HttpStatus.BAD_REQUEST,
    message: 'The import request is invalid.',
  },
  IMPORT_UNSUPPORTED_FORMAT: {
    status: HttpStatus.BAD_REQUEST,
    message: 'Only the sarif format can be imported.',
  },
  IMPORT_UNSUPPORTED_FILE: {
    status: HttpStatus.BAD_REQUEST,
    message: 'The file must be a .sarif, .json or .sarif.gz file.',
  },
  IMPORT_INVALID_SARIF: {
    status: HttpStatus.BAD_REQUEST,
    message: 'The file is not a SARIF document.',
  },
  IMPORT_UPLOAD_TOO_LARGE: {
    status: HttpStatus.PAYLOAD_TOO_LARGE,
    message: 'The file is larger than 50 MiB.',
  },
  IMPORT_BUSY: {
    status: HttpStatus.SERVICE_UNAVAILABLE,
    message: 'Too many imports are in progress; retry later.',
  },
  IMPORT_STORAGE_UNAVAILABLE: {
    status: HttpStatus.SERVICE_UNAVAILABLE,
    message: 'The file could not be stored.',
  },
  IMPORT_UNAVAILABLE: {
    status: HttpStatus.SERVICE_UNAVAILABLE,
    message: 'The results could not be queued for processing.',
  },
  IMPORT_IMAGE_REQUIRED: {
    status: HttpStatus.BAD_REQUEST,
    message: 'A container import needs the image it describes.',
  },
  IMPORT_IMAGE_INVALID: {
    status: HttpStatus.BAD_REQUEST,
    message: 'The image reference is invalid.',
  },
  IMPORT_TYPE_NOT_AVAILABLE: {
    status: HttpStatus.BAD_REQUEST,
    message: 'This edition does not import this type of results.',
  },
  IMPORT_INVALID_SBOM: {
    status: HttpStatus.BAD_REQUEST,
    message: 'The SBOM must be a CycloneDX JSON file (.json or .json.gz).',
  },
};

/** The refusal of `code`: its status, `{ code, message }` as the body. */
export function importRefusal(code: ImportRequestCode): HttpException {
  const { status, message } = REFUSALS[code];
  return new HttpException({ code, message }, status);
}

/** The `code` of an import refusal, or undefined for any other error. */
export function importRefusalCode(
  error: unknown,
): ImportRequestCode | undefined {
  if (!(error instanceof HttpException)) return undefined;
  const body = error.getResponse();
  if (typeof body !== 'object' || body === null) return undefined;
  const code = (body as { code?: unknown }).code;
  return (IMPORT_REQUEST_CODES as readonly unknown[]).includes(code)
    ? (code as ImportRequestCode)
    : undefined;
}
