import { describe, it, expect } from 'vitest';
import enScanErrors from '@/i18n/locales/en/components/loaderScan/scanErrors.json';
import frScanErrors from '@/i18n/locales/fr/components/loaderScan/scanErrors.json';

import {
  getScanErrorDetail,
  getScanErrorI18nKey,
  getCancelledScanI18nKey,
  isArchiveScanFailure,
  isImportScanFailure,
  isScanRefusedByPlan,
} from './scanErrorMessage';

describe('getScanErrorI18nKey', () => {
  it('maps a known code to its specific key', () => {
    expect(getScanErrorI18nKey(41, 'scan')).toBe('components.loaderScan.scanErrors.imageNotFound');
    expect(getScanErrorI18nKey(20, 'cloud_provider')).toBe('components.loaderScan.scanErrors.ecrAccess');
    expect(getScanErrorI18nKey(61, 'infra')).toBe('components.loaderScan.scanErrors.oom');
  });

  it('falls back to the category key when the code is unknown', () => {
    expect(getScanErrorI18nKey(999, 'authentication')).toBe('components.loaderScan.scanErrors.authentication');
  });

  it('falls back to a generic key when nothing matches', () => {
    expect(getScanErrorI18nKey(undefined, undefined)).toBe('components.loaderScan.scanErrors.generic');
  });

  // Reasons the backend can now attach to a scan that did
  // not produce results — a queue that never freed a slot (65) and a repository
  // download that failed or was rate-limited by the Git provider (66/67). All
  // three are in the infra range, so without their own entry they would all
  // collapse onto the vague "infra" message.
  it('maps the queue-timeout and source-fetch codes to their own keys', () => {
    expect(getScanErrorI18nKey(65, 'infra')).toBe('components.loaderScan.scanErrors.queueTimeout');
    expect(getScanErrorI18nKey(66, 'infra')).toBe('components.loaderScan.scanErrors.sourceFetch');
    expect(getScanErrorI18nKey(67, 'infra')).toBe('components.loaderScan.scanErrors.sourceRateLimited');
    expect(getScanErrorI18nKey(68, 'infra')).toBe('components.loaderScan.scanErrors.sourceInvalid');
  });
});

// A cancelled scan is not a failure. It gets the neutral "cancelled"
// banner, and when the backend attached a reason (a queue timeout, say) that
// reason replaces the generic wording — still neutral, never the red
// "contact support" banner reserved for `failed`.
describe('getCancelledScanI18nKey', () => {
  it('uses the attached reason when the scan carries an error code', () => {
    expect(getCancelledScanI18nKey(65, 'infra')).toBe('components.loaderScan.scanErrors.queueTimeout');
  });

  // A queued scan whose organisation no longer
  // accepts AppSec scans when it leaves the queue is cancelled with code 69.
  // Without its own key it would read « please retry » (the infra fallback),
  // which cannot work while AppSec is off.
  it('names the AppSec refusal of a scan cancelled when it left the queue (69)', () => {
    expect(getCancelledScanI18nKey(69, 'infra')).toBe('components.loaderScan.scanErrors.writesBlocked');
    // A trial is never cancelled at dequeue, so the
    // sentence names a deactivated or unpaid AppSec, never a used-up trial.
    const en = enScanErrors.components.loaderScan.scanErrors.writesBlocked;
    const fr = frScanErrors.components.loaderScan.scanErrors.writesBlocked;
    expect(en).toMatch(/AppSec Platform is no longer active or its plan is unpaid/);
    expect(en).not.toMatch(/trial/i);
    expect(fr).toMatch(/Plateforme AppSec .*n'est plus active ou son abonnement est impayé/);
    expect(fr).not.toMatch(/essai/i);
  });

  it('falls back to the generic cancelled wording without an error code', () => {
    expect(getCancelledScanI18nKey(undefined, undefined)).toBe(
      'components.analyseWrapper.scanStatus.cancelled',
    );
  });

  it('ignores a category with no code — a cancellation is not a failure', () => {
    expect(getCancelledScanI18nKey(undefined, 'infra')).toBe(
      'components.analyseWrapper.scanStatus.cancelled',
    );
  });
});

// A scan billing refused at its start because the trial had no scan left
// carries no code, only file-management's
// `Processing error: TRIAL_SCANS_EXHAUSTED`, which must never be shown raw.
describe('a scan refused because the trial has no scan left', () => {
  const refused = 'Processing error: TRIAL_SCANS_EXHAUSTED';

  it('maps the refusal found in the message to its own key', () => {
    expect(getScanErrorI18nKey(undefined, undefined, refused)).toBe(
      'components.loaderScan.scanErrors.trialScansExhausted',
    );
    expect(isScanRefusedByPlan(refused)).toBe(true);
  });

  it('matches the code as a whole word only, and leaves any other message alone', () => {
    for (const message of ['MY_TRIAL_SCANS_EXHAUSTED_TOO', 'manifest digest mismatch', '', undefined]) {
      expect(getScanErrorI18nKey(undefined, undefined, message)).toBe('components.loaderScan.scanErrors.generic');
      expect(isScanRefusedByPlan(message)).toBe(false);
    }
  });

  it('says it in words, in both languages, never with the raw code', () => {
    const en = enScanErrors.components.loaderScan.scanErrors.trialScansExhausted;
    const fr = frScanErrors.components.loaderScan.scanErrors.trialScansExhausted;
    expect(en).toMatch(/trial/i);
    expect(fr).toMatch(/essai/i);
    for (const sentence of [en, fr]) expect(sentence).not.toMatch(/TRIAL_SCANS_EXHAUSTED/);
  });
});

// Import failures (SARIF, SCA and container): security-scanning stores the number 70–79 with category
// `import`, and the dashboard keys on the number, never on the message (the
// code itself). Each one has its own sentence in both languages.
describe('a failed import scan', () => {
  const codes = [70, 71, 72, 73, 74, 75, 76, 77, 78, 79];

  it.each(codes)('import code %i has its own sentence', (n) =>
    expect(getScanErrorI18nKey(n, 'import')).not.toMatch(/generic$/));

  it('gives each code a distinct key, present and worded in both languages', () => {
    const keys = codes.map((n) => getScanErrorI18nKey(n, 'import'));
    expect(new Set(keys).size).toBe(codes.length);
    const en = enScanErrors.components.loaderScan.scanErrors as Record<string, string>;
    const fr = frScanErrors.components.loaderScan.scanErrors as Record<string, string>;
    for (const key of keys) {
      const leaf = key.replace('components.loaderScan.scanErrors.', '');
      for (const sentence of [en[leaf], fr[leaf]]) {
        expect(sentence).toEqual(expect.any(String));
        expect(sentence).not.toMatch(/IMPORT_[A-Z_]+/);
      }
    }
  });

  it('keys on the number, never on the message', () => {
    expect(getScanErrorI18nKey(73, 'import', 'IMPORT_INVALID_SARIF')).toBe(getScanErrorI18nKey(73, 'import'));
  });

  it('names an invalid SBOM, a 79 whose message is exactly IMPORT_INVALID_SBOM, in both languages', () => {
    const key = getScanErrorI18nKey(79, 'import', 'IMPORT_INVALID_SBOM');
    expect(key).toBe('components.loaderScan.scanErrors.importInvalidSbom');
    const en = enScanErrors.components.loaderScan.scanErrors as Record<string, string>;
    const fr = frScanErrors.components.loaderScan.scanErrors as Record<string, string>;
    for (const sentence of [en.importInvalidSbom, fr.importInvalidSbom]) {
      expect(sentence).toEqual(expect.any(String));
      expect(sentence).not.toMatch(/IMPORT_[A-Z_]+/);
    }
    // only that exact code, and only on a 79
    expect(getScanErrorI18nKey(79, 'import', 'IMPORT_INVALID_SBOM of x')).toBe(getScanErrorI18nKey(79, 'import'));
    expect(getScanErrorI18nKey(70, 'import', 'IMPORT_INVALID_SBOM')).toBe(getScanErrorI18nKey(70, 'import'));
  });

  it('falls back to the import category for a number it does not know', () => {
    expect(getScanErrorI18nKey(999, 'import')).toBe('components.loaderScan.scanErrors.import');
    const en = enScanErrors.components.loaderScan.scanErrors as Record<string, string>;
    const fr = frScanErrors.components.loaderScan.scanErrors as Record<string, string>;
    expect(en.import).toEqual(expect.any(String));
    expect(fr.import).toEqual(expect.any(String));
  });
});

// The message of an import failure is the code itself (IMPORT_UNSUPPORTED_RESULT):
// the loader must not print it under the sentence, as it does a scanner's detail.
describe('isImportScanFailure', () => {
  it('is an import failure by its number or its category', () => {
    for (const n of [70, 74, 78, 79]) expect(isImportScanFailure(n)).toBe(true);
    expect(isImportScanFailure(undefined, 'import')).toBe(true);
  });

  it('is not one for a scanner failure', () => {
    expect(isImportScanFailure(41, 'scan')).toBe(false);
    expect(isImportScanFailure(69, 'infra')).toBe(false);
    expect(isImportScanFailure(80)).toBe(false);
    expect(isImportScanFailure(undefined, undefined)).toBe(false);
  });
});

// Community Edition, scans on a connected Kubernetes cluster: the cluster
// failures (80–87, category `cluster`) each have a fixed sentence.
describe('cluster scan failures', () => {
  const CLUSTER_KEYS: Array<[number, string]> = [
    [80, 'clusterNoResults'],
    [81, 'clusterUnschedulable'],
    [82, 'clusterDeadline'],
    [83, 'clusterLaunchFailed'],
    [84, 'clusterImageIncompatible'],
    [85, 'clusterToolFailed'],
    [86, 'clusterResultsRefused'],
    [87, 'clusterPodLost'],
    [88, 'clusterArchiveFetchFailed'],
  ];

  it.each(CLUSTER_KEYS)('maps %i to %s', (code, key) => {
    expect(getScanErrorI18nKey(code, 'cluster')).toBe(`components.loaderScan.scanErrors.${key}`);
  });

  it('maps the cluster category to its own key', () => {
    expect(getScanErrorI18nKey(999, 'cluster')).toBe('components.loaderScan.scanErrors.cluster');
  });

  it('leaves 89 to the category', () => {
    expect(getScanErrorI18nKey(89, 'cluster')).toBe('components.loaderScan.scanErrors.cluster');
    expect(getScanErrorI18nKey(89, undefined)).toBe('components.loaderScan.scanErrors.generic');
  });

  // A scanner pod that could not download the archive: the operator's first
  // check is that the storage address given to the pods is reachable.
  it('the archive-fetch sentence names CYBEDEFEND_STORAGE_PUBLIC_URL, and the detail stays', () => {
    const en = (enScanErrors.components.loaderScan.scanErrors as Record<string, string>).clusterArchiveFetchFailed;
    const fr = (frScanErrors.components.loaderScan.scanErrors as Record<string, string>).clusterArchiveFetchFailed;
    expect(en).toContain('CYBEDEFEND_STORAGE_PUBLIC_URL');
    expect(fr).toContain('CYBEDEFEND_STORAGE_PUBLIC_URL');
    const detail = 'The scanner pod could not download the archive; the pods fetch it from http://storage.example:9000';
    expect(getScanErrorDetail(88, 'cluster', detail)).toBe(detail);
  });

  it('en and fr hold every key', () => {
    const en = enScanErrors.components.loaderScan.scanErrors as Record<string, string>;
    const fr = frScanErrors.components.loaderScan.scanErrors as Record<string, string>;
    for (const key of [...CLUSTER_KEYS.map(([, k]) => k), 'cluster']) {
      expect(typeof en[key]).toBe('string');
      expect(en[key].length).toBeGreaterThan(0);
      expect(typeof fr[key]).toBe('string');
      expect(fr[key].length).toBeGreaterThan(0);
      expect(fr[key]).not.toBe(en[key]);
    }
  });

  it('the image-incompatible sentence names CYBEDEFEND_SCANNER_IMAGE_TAG', () => {
    expect(enScanErrors.components.loaderScan.scanErrors).toHaveProperty('clusterImageIncompatible');
    const en = (enScanErrors.components.loaderScan.scanErrors as Record<string, string>).clusterImageIncompatible;
    const fr = (frScanErrors.components.loaderScan.scanErrors as Record<string, string>).clusterImageIncompatible;
    expect(en).toContain('CYBEDEFEND_SCANNER_IMAGE_TAG');
    expect(fr).toContain('CYBEDEFEND_SCANNER_IMAGE_TAG');
  });
});

// A full-scan archive refused on a limit (90-93, category `archive`): the
// sentence says which limit in words, and the detail under it is the
// backend's reason naming the configured size, without the code that leads it.
describe('a scan whose archive was refused on a limit', () => {
  const ARCHIVE_KEYS: Array<[number, string]> = [
    [90, 'archiveTooLarge'],
    [91, 'archiveTooManyEntries'],
    [92, 'archiveEntryTooLarge'],
    [93, 'archiveInflatedTooLarge'],
    [94, 'archiveInvalid'],
    [95, 'archiveEmpty'],
    [96, 'archiveEncrypted'],
    [97, 'archiveUnsafePath'],
    [98, 'archiveNotReceived'],
  ];
  const message = 'ARCHIVE_TOO_LARGE: The uploaded archive is too large: 6.20 GiB exceeds the 5.00 GiB limit';

  it.each(ARCHIVE_KEYS)('maps %i to %s', (code, key) => {
    expect(getScanErrorI18nKey(code, 'archive', message)).toBe(`components.loaderScan.scanErrors.${key}`);
  });

  it('maps the archive category to its own key', () => {
    expect(getScanErrorI18nKey(99, 'archive')).toBe('components.loaderScan.scanErrors.archive');
  });

  it('en and fr word every key, never with the raw code', () => {
    const en = enScanErrors.components.loaderScan.scanErrors as Record<string, string>;
    const fr = frScanErrors.components.loaderScan.scanErrors as Record<string, string>;
    for (const key of [...ARCHIVE_KEYS.map(([, k]) => k), 'archive']) {
      for (const sentence of [en[key], fr[key]]) {
        expect(sentence).toEqual(expect.any(String));
        expect(sentence.length).toBeGreaterThan(0);
        expect(sentence).not.toMatch(/ARCHIVE_[A-Z_]+/);
      }
      expect(fr[key]).not.toBe(en[key]);
    }
  });

  it('is an archive failure by its number or its category', () => {
    expect(isArchiveScanFailure(90)).toBe(true);
    expect(isArchiveScanFailure(undefined, 'archive')).toBe(true);
    expect(isArchiveScanFailure(87, 'cluster')).toBe(false);
    expect(isArchiveScanFailure(undefined, undefined)).toBe(false);
  });

  it.each([
    ['ARCHIVE_INVALID: The uploaded file is not a ZIP archive', 94],
    ['ARCHIVE_NOT_RECEIVED: No archive was uploaded before the deadline', 98],
  ])('keeps the reason of %s under the sentence, without its code', (raw, code) => {
    expect(getScanErrorDetail(code, 'archive', raw)).toBe(raw.replace(/^ARCHIVE_[A-Z_]+:\s*/, ''));
  });

  it('shows the reason naming the limit, without the code leading it', () => {
    expect(getScanErrorDetail(90, 'archive', message)).toBe(
      'The uploaded archive is too large: 6.20 GiB exceeds the 5.00 GiB limit',
    );
  });
});

describe('getScanErrorDetail', () => {
  it("shows a scanner's message as it is", () => {
    expect(getScanErrorDetail(41, 'scan', 'manifest unknown')).toBe('manifest unknown');
  });

  it('shows nothing for a plan refusal, an import failure or an empty message', () => {
    expect(getScanErrorDetail(undefined, undefined, 'Processing error: TRIAL_SCANS_EXHAUSTED')).toBeUndefined();
    expect(getScanErrorDetail(71, 'import', 'IMPORT_TOO_LARGE')).toBeUndefined();
    expect(getScanErrorDetail(41, 'scan', '')).toBeUndefined();
    expect(getScanErrorDetail(41, 'scan', undefined)).toBeUndefined();
  });
});
