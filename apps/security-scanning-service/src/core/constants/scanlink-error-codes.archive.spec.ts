import {
  ARCHIVE_ERROR_CODES,
  ERROR_CATEGORY,
  getErrorCategory,
  getErrorDescription,
} from './scanlink-error-codes';
import { normalizeScanFailure } from '../../modules/scan/core/scan-failure.util';

/**
 * A full-scan archive refused on a limit by file-management: the scan is
 * failed with `errorCode` 90-93, `errorCategory` 'archive' and a message
 * `<NAME>: <reason naming the limit>`. file-management declares the same
 * numbers (`ARCHIVE_FAILURE_CODES`) and the dashboard keys its sentences on
 * them.
 */
describe('archive scan failure codes', () => {
  it('names the archive refusals with the numbers file-management sends', () => {
    expect(ARCHIVE_ERROR_CODES).toEqual({
      ARCHIVE_TOO_LARGE: 90,
      ARCHIVE_TOO_MANY_ENTRIES: 91,
      ARCHIVE_ENTRY_TOO_LARGE: 92,
      ARCHIVE_INFLATED_TOO_LARGE: 93,
      ARCHIVE_INVALID: 94,
      ARCHIVE_EMPTY: 95,
      ARCHIVE_ENCRYPTED: 96,
      ARCHIVE_UNSAFE_PATH: 97,
      ARCHIVE_NOT_RECEIVED: 98,
    });
  });

  it('describes each refusal by what is wrong with the archive', () => {
    expect(getErrorDescription(94)).toMatch(/not a ZIP archive/);
    expect(getErrorDescription(95)).toMatch(/holds no file/);
    expect(getErrorDescription(96)).toMatch(/password-protected/);
    expect(getErrorDescription(97)).toMatch(/leaves the archive/);
    expect(getErrorDescription(98)).toMatch(/never uploaded/);
  });

  it('files 90-99 under the archive category', () => {
    expect(ERROR_CATEGORY.ARCHIVE).toBe('archive');
    for (const code of [90, 91, 92, 93, 99]) {
      expect(getErrorCategory(code)).toBe('archive');
    }
    expect(getErrorCategory(87)).toBe('cluster');
    expect(getErrorCategory(100)).toBe('unknown');
  });

  it('describes each refusal in words', () => {
    for (const code of Object.values(ARCHIVE_ERROR_CODES)) {
      expect(getErrorDescription(code)).not.toMatch(/Unknown error/);
    }
  });

  it("keeps file-management's message, which names the limit", () => {
    const message =
      'ARCHIVE_TOO_LARGE: The uploaded archive is too large: 6.20 GiB exceeds the 5.00 GiB limit';
    expect(
      normalizeScanFailure({
        errorCode: 90,
        errorCategory: 'archive',
        errorMessage: message,
      }),
    ).toEqual({
      errorCode: 90,
      errorCategory: 'archive',
      errorMessage: message,
    });
  });
});
