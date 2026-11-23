import { describe, expect, it } from 'vitest';
import {
  IMPORT_ROUTE_CODES,
  importRefusalKey,
  importRefusalOfScan,
  importRefusalOfUpload,
  retryAfterSeconds,
} from './importErrors';

const axiosError = (status: number, data?: unknown, headers: Record<string, string> = {}) => ({
  isAxiosError: true,
  message: `Request failed with status code ${status}`,
  response: { status, data, headers },
});
const axiosStatus = (status: number) => axiosError(status);

describe('importRefusalOfUpload', () => {
  it.each(IMPORT_ROUTE_CODES)('%s maps to its own key at any status', (code) => {
    for (const status of [400, 413, 503]) {
      expect(importRefusalKey(importRefusalOfUpload(axiosError(status, { code })))).toBe(
        `components.importResults.errors.${code}`,
      );
    }
  });

  it('holds the twelve route codes of the contract, in its order', () => {
    expect(IMPORT_ROUTE_CODES).toEqual([
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
    ]);
  });

  it('a 413 without a code is IMPORT_UPLOAD_TOO_LARGE', () =>
    expect(importRefusalOfUpload(axiosStatus(413))).toBe('IMPORT_UPLOAD_TOO_LARGE'));

  it('a 403 without a code is FORBIDDEN, a 429 RATE_LIMITED', () => {
    expect(importRefusalOfUpload(axiosStatus(403))).toBe('FORBIDDEN');
    expect(importRefusalOfUpload(axiosError(403, { code: 'WRITES_BLOCKED' }))).toBe('FORBIDDEN');
    expect(importRefusalOfUpload(axiosStatus(429))).toBe('RATE_LIMITED');
  });

  it('a 503 IMPORT_BUSY carries its Retry-After', () =>
    expect(retryAfterSeconds(axiosError(503, { code: 'IMPORT_BUSY' }, { 'retry-after': '15' }))).toBe(15));

  it('has no Retry-After for another answer, or a malformed one', () => {
    expect(retryAfterSeconds(axiosError(503, { code: 'IMPORT_UNAVAILABLE' }, { 'retry-after': '15' }))).toBeNull();
    expect(retryAfterSeconds(axiosError(503, { code: 'IMPORT_BUSY' }, { 'retry-after': 'soon' }))).toBeNull();
    expect(retryAfterSeconds(axiosError(503, { code: 'IMPORT_BUSY' }))).toBeNull();
    expect(retryAfterSeconds(new Error('network'))).toBeNull();
  });

  it('an unknown code is GENERIC', () => expect(importRefusalOfUpload(axiosError(400, { code: 'SOMETHING' }))).toBe('GENERIC'));

  it('a network failure, or anything that is not an answer, is GENERIC', () => {
    expect(importRefusalOfUpload(new Error('Network Error'))).toBe('GENERIC');
    expect(importRefusalOfUpload(undefined)).toBe('GENERIC');
    expect(importRefusalOfUpload(axiosError(500, 'IMPORT_BUSY'))).toBe('GENERIC');
  });

  it('never takes a code from an inherited property', () => {
    const data = Object.create({ code: 'IMPORT_BUSY' });
    expect(importRefusalOfUpload(axiosError(400, data))).toBe('GENERIC');
  });
});

describe('importRefusalOfScan', () => {
  it.each([
    [70, 'IMPORT_INVALID_SARIF'],
    [71, 'IMPORT_TOO_LARGE'],
    [72, 'IMPORT_TOO_MANY_RESULTS'],
    [73, 'IMPORT_TOO_MANY_RUNS'],
    [74, 'IMPORT_STORAGE_UNAVAILABLE'],
    [75, 'IMPORT_UNAVAILABLE'],
    [76, 'IMPORT_TIMEOUT'],
    [77, 'IMPORT_INTERNAL_ERROR'],
    [78, 'IMPORT_UNSUPPORTED_RESULT'],
    [79, 'IMPORT_FAILED'],
  ])('scan errorCode %i is %s', (n, code) =>
    expect(importRefusalOfScan({ errorCode: n, errorCategory: 'import', errorMessage: 'ignored' })).toBe(code));

  it('79 is the code its message names when the code has no number of its own', () => {
    expect(importRefusalOfScan({ errorCode: 79, errorCategory: 'import', errorMessage: 'IMPORT_INVALID_SBOM' })).toBe(
      'IMPORT_INVALID_SBOM',
    );
    expect(importRefusalOfScan({ errorCode: 79, errorMessage: ' IMPORT_INVALID_SBOM ' })).toBe('IMPORT_INVALID_SBOM');
    // a code with its own number is never read from a 79's message
    expect(importRefusalOfScan({ errorCode: 79, errorMessage: 'IMPORT_TOO_MANY_RUNS' })).toBe('IMPORT_FAILED');
    expect(importRefusalOfScan({ errorCode: 79, errorMessage: 'The SBOM of lodash@1 is bad' })).toBe('IMPORT_FAILED');
    expect(importRefusalOfScan({ errorMessage: 'IMPORT_INVALID_SBOM' })).toBe('IMPORT_INVALID_SBOM');
  });

  it('the number wins over the message', () =>
    expect(importRefusalOfScan({ errorCode: 73, errorMessage: 'IMPORT_INVALID_SARIF' })).toBe('IMPORT_TOO_MANY_RUNS'));

  it('a number outside 70–79 is not an import refusal', () =>
    expect(importRefusalOfScan({ errorCode: 41, errorMessage: 'IMPORT_INVALID_SARIF' })).toBeNull());

  it('without a number, the message is read by whole word only', () => {
    expect(importRefusalOfScan({ errorMessage: 'IMPORT_UNSUPPORTED_RESULT' })).toBe('IMPORT_UNSUPPORTED_RESULT');
    expect(importRefusalOfScan({ errorMessage: 'XIMPORT_TOO_MANY_RUNS' })).toBeNull();
    expect(importRefusalOfScan({ errorMessage: 'IMPORT_SOMETHING_NEW' })).toBe('IMPORT_FAILED');
    expect(importRefusalOfScan({ errorMessage: 'Unexpected token < at 1' })).toBeNull();
    expect(importRefusalOfScan({})).toBeNull();
  });
});

describe('importRefusalKey', () => {
  it('names a key under components.importResults.errors', () => {
    expect(importRefusalKey('GENERIC')).toBe('components.importResults.errors.GENERIC');
    expect(importRefusalKey('IMPORT_TIMEOUT')).toBe('components.importResults.errors.IMPORT_TIMEOUT');
  });
});
