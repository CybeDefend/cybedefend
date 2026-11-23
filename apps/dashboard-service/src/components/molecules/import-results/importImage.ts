/**
 * The image reference of a container import. It is the gateway's rule (`gateway-service/src/modules/scan/import/
 * import-request.ts`), checked here only to answer before any request: the
 * gateway stays the authority and refuses with 400 `IMPORT_IMAGE_INVALID`.
 */
export const IMPORT_IMAGE_MAX_LENGTH = 255;

/** The contract's regular expression, copied verbatim (`/` escaped for the literal). */
export const IMPORT_IMAGE_PATTERN =
  /^(?:[a-z0-9.-]+(?::[0-9]{1,5})?\/)?[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*(?::[A-Za-z0-9_][A-Za-z0-9._-]{0,127})?(?:@sha256:[a-f0-9]{64})?$/;

/** 1 to 255 characters matching the pattern, taken as typed: no trimming, no lower-casing. */
export function isImportImage(value: string): boolean {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= IMPORT_IMAGE_MAX_LENGTH &&
    IMPORT_IMAGE_PATTERN.test(value)
  );
}
