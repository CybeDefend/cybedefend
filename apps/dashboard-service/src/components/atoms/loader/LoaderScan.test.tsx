import { render, screen } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';

// Passthrough t — rendered text is the raw i18n key, making assertions stable
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

import LoaderScan from './LoaderScan';

const baseScan = {
  id: 'scan-1',
  name: 'test-scan',
  language: [],
  projectId: 'proj-1',
  private: false,
  createAt: new Date(),
  updatedAt: new Date(),
  containers: [],
  progress: 0,
  step: '',
};

describe('LoaderScan – scan error message rendering', () => {
  it('shows the mapped key for a known errorCode (41 → imageNotFound)', () => {
    render(
      <LoaderScan
        scanData={{ ...baseScan, state: 'failed', errorCode: 41 }}
        vulnCount={0}
        showPulse={false}
        onClose={() => {}}
      />
    );
    expect(
      screen.getByText('components.loaderScan.scanErrors.imageNotFound')
    ).toBeTruthy();
  });

  it('shows the generic key when no errorCode or errorCategory is present', () => {
    render(
      <LoaderScan
        scanData={{ ...baseScan, state: 'failed' }}
        vulnCount={0}
        showPulse={false}
        onClose={() => {}}
      />
    );
    expect(
      screen.getByText('components.loaderScan.scanErrors.generic')
    ).toBeTruthy();
  });

  it('renders errorMessage as a secondary detail below the primary key', () => {
    render(
      <LoaderScan
        scanData={{
          ...baseScan,
          state: 'failed',
          errorCode: 41,
          errorMessage: 'manifest digest mismatch',
        }}
        vulnCount={0}
        showPulse={false}
        onClose={() => {}}
      />
    );
    expect(
      screen.getByText('components.loaderScan.scanErrors.imageNotFound')
    ).toBeTruthy();
    expect(screen.getByText('manifest digest mismatch')).toBeTruthy();
  });

  // A refusal is never shown raw: no `Processing error: TRIAL_SCANS_EXHAUSTED`
  // under the generic sentence.
  it('names a trial with no scan left in words, and hides the raw refusal', () => {
    render(
      <LoaderScan
        scanData={{
          ...baseScan,
          state: 'failed',
          errorMessage: 'Processing error: TRIAL_SCANS_EXHAUSTED',
        }}
        vulnCount={0}
        showPulse={false}
        onClose={() => {}}
      />
    );
    expect(
      screen.getByText('components.loaderScan.scanErrors.trialScansExhausted')
    ).toBeTruthy();
    expect(screen.queryByText(/TRIAL_SCANS_EXHAUSTED/)).toBeNull();
  });

  // An archive refused on a limit: the sentence says which limit, the detail
  // names the size this instance applies, and the code leading it is hidden.
  it('names the archive limit that refused the scan, without its code', () => {
    render(
      <LoaderScan
        scanData={{
          ...baseScan,
          state: 'failed',
          errorCode: 90,
          errorCategory: 'archive',
          errorMessage:
            'ARCHIVE_TOO_LARGE: The uploaded archive is too large: 6.20 GiB exceeds the 5.00 GiB limit',
        }}
        vulnCount={0}
        showPulse={false}
        onClose={() => {}}
      />
    );
    expect(
      screen.getByText('components.loaderScan.scanErrors.archiveTooLarge')
    ).toBeTruthy();
    expect(
      screen.getByText('The uploaded archive is too large: 6.20 GiB exceeds the 5.00 GiB limit')
    ).toBeTruthy();
    expect(screen.queryByText(/ARCHIVE_TOO_LARGE/)).toBeNull();
  });
});

// When the user cancels a scan then relaunches one, the previous
// scan's `scanData.state === 'cancelled'` lingers (its poller/SSE is still
// alive) and gets re-applied while the NEW scan's file is uploading
// (isUploading === true). The component used to render the terminal "cancelled"
// modal with the upload label as its title ("Download" in FR), then froze.
// While a new upload is in progress the loader must show upload progress, never
// a stale terminal modal.
describe('LoaderScan – stale terminal state during a new scan upload', () => {
  it('shows upload progress, not the cancelled modal, while a new scan is uploading', () => {
    render(
      <LoaderScan
        scanData={{ ...baseScan, state: 'cancelled' }}
        vulnCount={0}
        showPulse={false}
        onClose={() => {}}
        isUploading={true}
        uploadProgress={42}
      />
    );
    // The stale "cancelled" scanData must NOT surface its terminal modal mid-upload.
    expect(
      screen.queryByText('components.loaderScan.messageCancelled')
    ).toBeNull();
    // Instead the live upload progress is shown.
    expect(screen.getByText('42%')).toBeTruthy();
  });

  it('does not surface a stale failed modal while a new scan is uploading', () => {
    render(
      <LoaderScan
        scanData={{ ...baseScan, state: 'failed', errorCode: 41 }}
        vulnCount={0}
        showPulse={false}
        onClose={() => {}}
        isUploading={true}
        uploadProgress={7}
      />
    );
    expect(
      screen.queryByText('components.loaderScan.scanErrors.imageNotFound')
    ).toBeNull();
    expect(screen.getByText('7%')).toBeTruthy();
  });

  it('titles the cancelled modal with the cancelled label (never the upload label) when not uploading', () => {
    render(
      <LoaderScan
        scanData={{ ...baseScan, state: 'cancelled' }}
        vulnCount={0}
        showPulse={false}
        onClose={() => {}}
        isUploading={false}
      />
    );
    expect(
      screen.getByText('components.loaderScan.messageCancelled')
    ).toBeTruthy();
    expect(
      screen.getByText('components.loaderScan.stateCancelled')
    ).toBeTruthy();
    expect(
      screen.queryByText('components.loaderScan.steps.stateUploading')
    ).toBeNull();
  });
});
