import { normalizeScanFailure } from './scan-failure.util';

describe('normalizeScanFailure', () => {
  it('derives category + description from a bare exit code', () => {
    expect(normalizeScanFailure({ errorCode: 20 })).toEqual({
      errorCode: 20,
      errorCategory: 'cloud_provider',
      errorMessage: 'AWS ECR authentication or access error',
    });
  });

  it('keeps a caller-supplied message but recomputes the category from the code', () => {
    expect(
      normalizeScanFailure({
        errorCode: 41,
        errorCategory: 'wrong',
        errorMessage: 'boom',
      }),
    ).toEqual({ errorCode: 41, errorCategory: 'scan', errorMessage: 'boom' });
  });

  it('falls back to unknown + generic message when no code is present', () => {
    expect(normalizeScanFailure({ errorMessage: 'pod vanished' })).toEqual({
      errorCode: undefined,
      errorCategory: 'unknown',
      errorMessage: 'pod vanished',
    });
  });

  it('returns a generic message when nothing is provided', () => {
    const r = normalizeScanFailure({});
    expect(r.errorCategory).toBe('unknown');
    expect(typeof r.errorMessage).toBe('string');
  });

  it('maps infra codes (60-69) to the infra category', () => {
    expect(normalizeScanFailure({ errorCode: 61 })).toEqual({
      errorCode: 61,
      errorCategory: 'infra',
      errorMessage: 'The scanner ran out of memory',
    });
  });
});
