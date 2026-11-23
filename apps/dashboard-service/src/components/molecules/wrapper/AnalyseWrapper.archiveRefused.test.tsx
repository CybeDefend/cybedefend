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

const failed = (over: Partial<ScanResponseDto>): ScanResponseDto =>
  ({ id: 's1', containers: [], state: 'failed', ...over }) as ScanResponseDto;

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

// A full-scan archive refused on one of this instance's limits: the banner
// says which limit in words and names the size, never the code.
describe('AnalyseWrapper – a last scan whose archive was refused on a limit', () => {
  it('says the archive is too large and names the limit, without the code', () => {
    renderWrapper({
      scanData: failed({
        errorCode: 90,
        errorCategory: 'archive',
        errorMessage: 'ARCHIVE_TOO_LARGE: The uploaded archive is too large: 6.20 GiB exceeds the 5.00 GiB limit',
      }),
      scanInfo: failedScan,
    });
    expect(screen.getByText(/larger than this instance accepts/)).toBeInTheDocument();
    expect(screen.getByText(/6\.20 GiB exceeds the 5\.00 GiB limit/)).toBeInTheDocument();
    expect(screen.queryByText(/ARCHIVE_TOO_LARGE/)).toBeNull();
  });

  it('does not print the message of any other failure in the banner', () => {
    renderWrapper({ scanData: failed({ errorCode: 41, errorMessage: 'manifest digest mismatch' }), scanInfo: failedScan });
    expect(screen.queryByText(/manifest digest mismatch/)).toBeNull();
  });
});
