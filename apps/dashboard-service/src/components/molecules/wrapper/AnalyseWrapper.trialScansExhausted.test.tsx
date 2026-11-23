import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import type { ScanInfo, ScanResponseDto } from '@/server/interfaces/Scan';
import AnalyseWrapper from './AnalyseWrapper';

// Resolves keys against the real `en` locale.
vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

// Under test: the last-scan banner of a failed scan. The children fetch their
// own data, so they are stubbed (as in AnalyseWrapper.pipeline.test.tsx).
vi.mock('./ProjectSectionNav', () => ({ default: () => null }));
vi.mock('../project-id-actions/ProjectIdActions', () => ({ default: () => null }));
vi.mock('../banners/SecurityContextBanner', () => ({ default: () => null }));
vi.mock('../sidebar/custom-tabs/CustomTabs', () => ({ default: () => null }));
vi.mock('../../atoms/loader/LoaderScan', () => ({ default: () => null }));
vi.mock('@/server/hooks/useScanBackgroundTask', () => ({ useScanBackgroundTask: () => undefined }));
vi.mock('@/server/services/scanService', () => ({ default: { cancelScan: vi.fn() } }));
vi.mock('@/server/hooks/useProjectBranchesList', () => ({
  useProjectBranchesList: () => ({
    branches: [],
    setSearch: vi.fn(),
    loadMore: vi.fn(),
    hasMore: false,
    searching: false,
    loadingMore: false,
    includeArchived: false,
    toggleArchived: vi.fn(),
    loading: false,
  }),
}));

type Props = React.ComponentProps<typeof AnalyseWrapper>;

const failedScan: ScanInfo = { scanId: 's1', state: 'failed', createAt: '2026-10-27T19:41:44Z', scanType: 'sast' };

const failed = (errorMessage?: string): ScanResponseDto => {
  const over: Partial<ScanResponseDto> = { state: 'failed', errorMessage };
  return { id: 's1', containers: [], ...over } as ScanResponseDto;
};

const renderWrapper = (props: Partial<Props>) =>
  render(
    <Provider store={configureStore({ reducer: () => ({ organization: {} }) })}>
      <MemoryRouter>
        <AnalyseWrapper
          projectId="p1"
          projectName="Demo"
          selectedTab="sast"
          showStartScanModal={false}
          handleStartScanClick={vi.fn()}
          handleCloseStartScanModal={vi.fn()}
          handleScanSubmit={vi.fn()}
          errors={{}}
          setSelectedFile={vi.fn()}
          showLoader={false}
          scanData={null}
          vulnCount={0}
          showPulse={false}
          onCloseLoader={vi.fn()}
          vulnCounts={{ sast: 0, iac: 0, cicd: 0, secret: 0, sca: 0, container: 0 }}
          loading={false}
          scanInfo={null}
          {...props}
        >
          <div />
        </AnalyseWrapper>
      </MemoryRouter>
    </Provider>,
  );

// A billing refusal is never shown raw, nor as « The scan failed. Please retry
// or contact support »: a scan refused because the trial had no scan left is
// fixed by neither a retry nor support.
describe('AnalyseWrapper – a last scan refused because the trial has no scan left', () => {
  it('says the trial has no scan left, without « contact support »', () => {
    renderWrapper({ scanData: failed('Processing error: TRIAL_SCANS_EXHAUSTED'), scanInfo: failedScan });
    expect(screen.getByText(/trial has used all of its scans/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Contact Support' })).toBeNull();
    expect(screen.queryByText(/TRIAL_SCANS_EXHAUSTED/)).toBeNull();
  });

  it('keeps « contact support » for any other failure', () => {
    renderWrapper({ scanData: failed('manifest digest mismatch'), scanInfo: failedScan });
    expect(screen.getByText(/The scan failed/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Contact Support' })).toBeInTheDocument();
  });
});
