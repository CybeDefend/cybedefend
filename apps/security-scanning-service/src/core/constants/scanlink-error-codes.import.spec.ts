import {
  ERROR_CATEGORY,
  ERROR_DESCRIPTIONS,
  EXIT_IMPORT_ERROR,
  EXIT_IMPORT_INTERNAL_ERROR,
  EXIT_IMPORT_INVALID_SARIF,
  EXIT_IMPORT_STORAGE_UNAVAILABLE,
  EXIT_IMPORT_TIMEOUT,
  EXIT_IMPORT_TOO_LARGE,
  EXIT_IMPORT_TOO_MANY_RESULTS,
  EXIT_IMPORT_TOO_MANY_RUNS,
  EXIT_IMPORT_UNAVAILABLE,
  EXIT_IMPORT_UNSUPPORTED_RESULT,
  getErrorCategory,
  IMPORT_ERROR_CODES,
  importFailure,
} from './scanlink-error-codes';
import { normalizeScanFailure } from '../../modules/scan/core/scan-failure.util';

/**
 * The import failure codes
 * stored on a scan. `scan.errorCode` is the number, `scan.errorMessage` the
 * string code verbatim, `scan.errorCategory` 'import'. The dashboard maps the
 * number; the CLI and the scanners print the message.
 */
describe('import scan failure codes', () => {
  it('maps each known code to its number, verbatim as the message', () => {
    expect(importFailure('IMPORT_TOO_LARGE')).toEqual({
      errorCode: 71,
      errorCategory: 'import',
      errorMessage: 'IMPORT_TOO_LARGE',
    });
    expect(importFailure('IMPORT_INTERNAL_ERROR')).toEqual({
      errorCode: 77,
      errorCategory: 'import',
      errorMessage: 'IMPORT_INTERNAL_ERROR',
    });
    expect(importFailure('IMPORT_UNSUPPORTED_RESULT')).toEqual({
      errorCode: 78,
      errorCategory: 'import',
      errorMessage: 'IMPORT_UNSUPPORTED_RESULT',
    });
    expect(importFailure('IMPORT_INVALID_SARIF').errorCode).toBe(70);
    expect(importFailure('IMPORT_TOO_MANY_RESULTS').errorCode).toBe(72);
    expect(importFailure('IMPORT_TOO_MANY_RUNS').errorCode).toBe(73);
    expect(importFailure('IMPORT_STORAGE_UNAVAILABLE').errorCode).toBe(74);
    expect(importFailure('IMPORT_UNAVAILABLE').errorCode).toBe(75);
    expect(importFailure('IMPORT_TIMEOUT').errorCode).toBe(76);
  });

  it('falls back to 79 for an unknown IMPORT_* code', () => {
    expect(importFailure('IMPORT_NEW_THING')).toEqual({
      errorCode: 79,
      errorCategory: 'import',
      errorMessage: 'IMPORT_NEW_THING',
    });
    expect(EXIT_IMPORT_ERROR).toBe(79);
  });

  it('throws a TypeError for anything that is not an IMPORT_* code', () => {
    expect(() => importFailure('boom')).toThrow(TypeError);
    expect(() => importFailure('')).toThrow(TypeError);
    expect(() => importFailure('import_too_large')).toThrow(TypeError);
    expect(() => importFailure(`IMPORT_${'A'.repeat(41)}`)).toThrow(TypeError);
  });

  it('exposes the known codes as a record', () => {
    expect(IMPORT_ERROR_CODES).toEqual({
      IMPORT_INVALID_SARIF: 70,
      IMPORT_TOO_LARGE: 71,
      IMPORT_TOO_MANY_RESULTS: 72,
      IMPORT_TOO_MANY_RUNS: 73,
      IMPORT_STORAGE_UNAVAILABLE: 74,
      IMPORT_UNAVAILABLE: 75,
      IMPORT_TIMEOUT: 76,
      IMPORT_INTERNAL_ERROR: 77,
      IMPORT_UNSUPPORTED_RESULT: 78,
    });
    expect(EXIT_IMPORT_INVALID_SARIF).toBe(70);
    expect(EXIT_IMPORT_TOO_LARGE).toBe(71);
    expect(EXIT_IMPORT_TOO_MANY_RESULTS).toBe(72);
    expect(EXIT_IMPORT_TOO_MANY_RUNS).toBe(73);
    expect(EXIT_IMPORT_STORAGE_UNAVAILABLE).toBe(74);
    expect(EXIT_IMPORT_UNAVAILABLE).toBe(75);
    expect(EXIT_IMPORT_TIMEOUT).toBe(76);
    expect(EXIT_IMPORT_INTERNAL_ERROR).toBe(77);
    expect(EXIT_IMPORT_UNSUPPORTED_RESULT).toBe(78);
  });

  it('categorises every number 70-79 as import, and leaves the neighbours alone', () => {
    for (const code of [70, 71, 72, 73, 74, 75, 76, 77, 78, 79]) {
      expect(getErrorCategory(code)).toBe(ERROR_CATEGORY.IMPORT);
    }
    expect(getErrorCategory(76)).toBe('import');
    expect(getErrorCategory(78)).toBe('import');
    expect(getErrorCategory(69)).toBe('infra');
    // 80-88 are the Community cluster scan failures.
    expect(getErrorCategory(80)).toBe('cluster');
    expect(getErrorCategory(89)).toBe('unknown');
  });

  it('describes every new number in English', () => {
    for (const code of [70, 71, 72, 73, 74, 75, 76, 77, 78, 79]) {
      expect(typeof ERROR_DESCRIPTIONS[code]).toBe('string');
      expect(ERROR_DESCRIPTIONS[code].length).toBeGreaterThan(0);
    }
    expect(ERROR_DESCRIPTIONS[78]).toBeDefined();
  });

  it('keeps the verbatim code as the message through normalizeScanFailure', () => {
    expect(
      normalizeScanFailure({
        errorCode: 72,
        errorMessage: 'IMPORT_TOO_MANY_RESULTS',
      }),
    ).toEqual({
      errorCode: 72,
      errorCategory: 'import',
      errorMessage: 'IMPORT_TOO_MANY_RESULTS',
    });
  });
});
