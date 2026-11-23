const BASE = 'components.loaderScan.scanErrors';

const BY_CODE: Record<number, string> = {
  11: 'invalidCredentials',
  12: 'missingCredentials',
  13: 'tokenExpired',
  14: 'unauthorized',
  15: 'forbidden',
  20: 'ecrAccess',
  21: 'gcrAccess',
  22: 'acrAccess',
  41: 'imageNotFound',
  42: 'manifest',
  43: 'layer',
  61: 'oom',
  62: 'timeout',
  63: 'imagePull',
  64: 'podLost',
  65: 'queueTimeout',
  66: 'sourceFetch',
  67: 'sourceRateLimited',
  68: 'sourceInvalid',
  // Cancelled when it left the queue, AppSec no longer active
  // or its plan unpaid (never a trial).
  69: 'writesBlocked',
  // Import failures (SARIF; 78 for an SCA or container import): keyed on the number, never on the
  // message, which is the code itself.
  70: 'importInvalidSarif',
  71: 'importTooLarge',
  72: 'importTooManyResults',
  73: 'importTooManyRuns',
  74: 'importStorageUnavailable',
  75: 'importUnavailable',
  76: 'importTimeout',
  77: 'importInternalError',
  78: 'importUnsupportedResult',
  79: 'importFailed',
  // Community Edition, scans on a connected Kubernetes cluster (80–88,
  // category `cluster`); 89 is left to the category.
  80: 'clusterNoResults',
  81: 'clusterUnschedulable',
  82: 'clusterDeadline',
  83: 'clusterLaunchFailed',
  84: 'clusterImageIncompatible',
  85: 'clusterToolFailed',
  86: 'clusterResultsRefused',
  87: 'clusterPodLost',
  // A scanner pod could not download the scan's archive from this instance's
  // storage; the detail under the sentence names the address the pods used.
  88: 'clusterArchiveFetchFailed',
  // A full-scan archive refused before anything was scanned (90-99, category
  // `archive`): over one of the instance's limits (90-93, the message names the
  // configured limit) or not scannable at all (94-98).
  90: 'archiveTooLarge',
  91: 'archiveTooManyEntries',
  92: 'archiveEntryTooLarge',
  93: 'archiveInflatedTooLarge',
  94: 'archiveInvalid',
  95: 'archiveEmpty',
  96: 'archiveEncrypted',
  97: 'archiveUnsafePath',
  98: 'archiveNotReceived',
};

const CANCELLED_KEY = 'components.analyseWrapper.scanStatus.cancelled';

const BY_CATEGORY: Record<string, string> = {
  authentication: 'authentication',
  cloud_provider: 'cloudProvider',
  network: 'network',
  scan: 'scan',
  api: 'api',
  infra: 'infra',
  import: 'import',
  cluster: 'cluster',
  archive: 'archive',
};

/**
 * Refusals billing gives a scan at its start. They carry no code: the scan
 * only holds file-management's `Processing error: <CODE>`. Matched as a whole
 * word, so only the literal code maps; the message itself is never shown for
 * them.
 */
const BY_MESSAGE_CODE: Array<[RegExp, string]> = [[/\bTRIAL_SCANS_EXHAUSTED\b/, 'trialScansExhausted']];

const planRefusalOf = (errorMessage?: string): string | undefined =>
  errorMessage ? BY_MESSAGE_CODE.find(([code]) => code.test(errorMessage))?.[1] : undefined;

/** Whether billing refused the scan at its start: no retry or support fixes it. */
export function isScanRefusedByPlan(errorMessage?: string): boolean {
  return planRefusalOf(errorMessage) !== undefined;
}

/**
 * Whether a scan failed as a SARIF import (70–79, category `import`). Its
 * message is the code itself, so it is never printed under the sentence.
 */
export function isImportScanFailure(errorCode?: number, errorCategory?: string): boolean {
  return errorCategory === 'import' || (errorCode != null && errorCode >= 70 && errorCode <= 79);
}

/**
 * Whether the uploaded archive of a full scan was refused (90-99, category
 * `archive`). Its message is `<CODE>: <reason>`.
 */
export function isArchiveScanFailure(errorCode?: number, errorCategory?: string): boolean {
  return errorCategory === 'archive' || (errorCode != null && errorCode >= 90 && errorCode <= 99);
}

const ARCHIVE_CODE_PREFIX = /^ARCHIVE_[A-Z_]{1,40}:\s*/;

/**
 * The backend's message to show under the sentence of a failed scan, or
 * undefined when there is none worth showing: a plan refusal or an import
 * failure is said in words by the sentence and its message is a raw code. An
 * archive refusal shows its reason (which names the limit) without the code
 * leading it.
 */
export function getScanErrorDetail(errorCode?: number, errorCategory?: string, errorMessage?: string): string | undefined {
  if (!errorMessage || isScanRefusedByPlan(errorMessage) || isImportScanFailure(errorCode, errorCategory)) {
    return undefined;
  }
  if (isArchiveScanFailure(errorCode, errorCategory)) {
    return errorMessage.replace(ARCHIVE_CODE_PREFIX, '') || undefined;
  }
  return errorMessage;
}

/**
 * 79 is « any other IMPORT_ code », the code itself in the message. The codes
 * with no number of their own that the dashboard knows are named, matched as
 * the whole message only.
 */
const IMPORT_79_BY_MESSAGE: Readonly<Record<string, string>> = {
  IMPORT_INVALID_SBOM: 'importInvalidSbom',
};

export function getScanErrorI18nKey(errorCode?: number, errorCategory?: string, errorMessage?: string): string {
  if (errorCode === 79 && typeof errorMessage === 'string') {
    const leaf = Object.prototype.hasOwnProperty.call(IMPORT_79_BY_MESSAGE, errorMessage.trim())
      ? IMPORT_79_BY_MESSAGE[errorMessage.trim()]
      : undefined;
    if (leaf) return `${BASE}.${leaf}`;
  }
  if (errorCode != null && BY_CODE[errorCode]) return `${BASE}.${BY_CODE[errorCode]}`;
  const planRefusal = planRefusalOf(errorMessage);
  if (planRefusal) return `${BASE}.${planRefusal}`;
  if (errorCategory && BY_CATEGORY[errorCategory]) return `${BASE}.${BY_CATEGORY[errorCategory]}`;
  return `${BASE}.generic`;
}

/**
 * Message for a `cancelled` scan.
 *
 * The backend can now attach a reason to a cancellation — a queue
 * that never freed a slot, for instance. When it did, show that reason; with
 * no code, keep the plain "the last scan was cancelled" wording. A category
 * alone is never enough: it would map a cancellation onto a failure message.
 *
 * A cancellation is not a failure, so whatever this returns is rendered in the
 * neutral banner, never the red "contact support" one.
 */
export function getCancelledScanI18nKey(errorCode?: number, errorCategory?: string): string {
  if (errorCode == null) return CANCELLED_KEY;
  return getScanErrorI18nKey(errorCode, errorCategory);
}
