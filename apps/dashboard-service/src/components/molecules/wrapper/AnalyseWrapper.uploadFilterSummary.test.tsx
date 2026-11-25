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

// Under test: the notice of what the upload filter left out. The children
// fetch their own data, so they are stubbed (as in the other wrapper tests).
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

const completedScan: ScanInfo = { scanId: 's1', state: 'completed', createAt: '2026-10-27T19:41:44Z', scanType: 'sast' };

const completed = (over: Partial<ScanResponseDto>): ScanResponseDto =>
  ({ id: 's1', projectId: 'p1', containers: [], state: 'completed', ...over }) as ScanResponseDto;

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

describe('AnalyseWrapper – what the upload filter left out of the last scan', () => {
  it('shows the notice with the scan status', () => {
    renderWrapper({
      scanInfo: completedScan,
      scanData: completed({
        uploadFilterSummary: {
          scannerConfiguration: 0,
          excludedPath: 4,
          excludedType: 0,
          unsafeName: 0,
          gitMetadata: 0,
          excludedFolders: [{ name: 'dist', count: 4 }],
        },
      }),
    });
    expect(screen.getByText('4 files of the upload were not scanned.')).toBeInTheDocument();
    expect(screen.getByText(/^Excluded folders:/).textContent).toBe('Excluded folders: dist (4).');
  });

  it('shows nothing for a scan without a summary', () => {
    renderWrapper({ scanInfo: completedScan, scanData: completed({ uploadFilterSummary: null }) });
    expect(screen.queryByText(/of the upload (were|was) not scanned/)).toBeNull();
  });
});
