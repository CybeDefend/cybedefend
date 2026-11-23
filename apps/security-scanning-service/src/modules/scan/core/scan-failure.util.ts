import {
  getErrorCategory,
  getErrorDescription,
  ERROR_CATEGORY,
} from '../../../core/constants/scanlink-error-codes';

export interface ScanFailure {
  errorCode?: number;
  errorCategory?: string;
  errorMessage?: string;
}

/**
 * Produce a consistent, user-facing failure triplet. When an exit code is
 * present the category is ALWAYS recomputed from it (caller/scanner drift is
 * ignored) and a human description fills a missing message. Without a code we
 * keep the supplied message and mark the category unknown.
 */
export function normalizeScanFailure(input: ScanFailure): ScanFailure {
  const errorCode =
    typeof input.errorCode === 'number' ? input.errorCode : undefined;
  if (errorCode !== undefined) {
    return {
      errorCode,
      errorCategory: getErrorCategory(errorCode),
      errorMessage: input.errorMessage || getErrorDescription(errorCode),
    };
  }
  return {
    errorCode: undefined,
    errorCategory: input.errorCategory || ERROR_CATEGORY.UNKNOWN,
    errorMessage: input.errorMessage || 'The scan failed for an unknown reason',
  };
}
