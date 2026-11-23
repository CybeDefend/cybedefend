import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import type { ContainerDto, ScanInfo, ScanPipelineDto, ScanResponseDto } from '@/server/interfaces/Scan';
import AnalyseWrapper from './AnalyseWrapper';

// Resolves keys against the real `en` locale.
vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

// The wrapper's children fetch their own data. What is under test here is how
// the wrapper places the scan pipeline: the header line, the panel and the
// last-scan banners — so the children are stubbed.
vi.mock('./ProjectSectionNav', () => ({ default: () => null }));
vi.mock('../project-id-actions/ProjectIdActions', () => ({ default: () => null }));
vi.mock('../banners/SecurityContextBanner', () => ({ default: () => null }));
vi.mock('../sidebar/custom-tabs/CustomTabs', () => ({ default: () => null }));
vi.mock('../../atoms/loader/LoaderScan', () => ({ default: () => <div data-testid="loader-scan" /> }));
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

const container = (over: Partial<ContainerDto>): ContainerDto => ({
  id: String(over.image),
  status: 'running',
  createdAt: '',
  startedAt: '',
  finishedAt: '',
  scanId: 's1',
  ...over,
});

const scanData = (over: Partial<ScanResponseDto>): ScanResponseDto =>
  ({ id: 's1', state: 'running', containers: [], ...over }) as ScanResponseDto;

const analysing: ScanPipelineDto = {
  slotReleased: true,
  scanners: { total: 1, open: 0, completed: 1, failed: 0 },
  agent: { stage: 'analyzing', processed: 45, total: 165 },
};

const DONE_SAST = [container({ status: 'completed', image: 'scanlink-sast-opengrep' })];

const lastScan: ScanInfo = { scanId: 'previous', state: 'completed', createAt: '2026-09-24T10:00:00Z', scanType: 'sast' };

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

describe('AnalyseWrapper – scan pipeline', () => {
  it('says in the header where the scan is', () => {
    renderWrapper({ scanData: scanData({ pipeline: analysing, containers: DONE_SAST }) });
    expect(screen.getByText('Scanners done, AI analyzing 45/165')).toBeInTheDocument();
  });

  it('shows the pipeline panel in place of the former agent block', () => {
    renderWrapper({
      scanData: scanData({ pipeline: analysing, containers: DONE_SAST }),
      classicDone: true,
      agentPhase: 'analysis',
    });
    const panel = screen.getByTestId('scan-pipeline-panel');
    expect(within(panel).getByRole('progressbar', { name: 'AI analysis 45/165' })).toBeInTheDocument();
    expect(within(panel).getByText(/this scan no longer holds up the next ones/)).toBeInTheDocument();
    expect(screen.queryByText('Scan completed. Results are now available')).toBeNull();
    expect(screen.queryByText('Cybe analyzing…')).toBeNull();
  });

  it('gives a queued scan its position, and keeps its cancel button', () => {
    renderWrapper({
      scanData: scanData({
        state: 'queued',
        pipeline: { slotReleased: false, queuePosition: 2, queueReason: 'platform_limit', agent: { stage: 'not_applicable' } },
      }),
    });
    expect(screen.getByText("Queued: position 2 in your organization's queue")).toBeInTheDocument();
    expect(within(screen.getByTestId('scan-pipeline-panel')).getByText('The platform is at full capacity.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Cancel Scan/ })).toBeInTheDocument();
  });

  it('renders from the containers before the backend sends a pipeline', () => {
    renderWrapper({
      scanData: scanData({
        containers: [...DONE_SAST, container({ image: 'agent-service', step: 'agent: analyzed 3/10' })],
      }),
    });
    expect(screen.getByText('Scanners done, AI analyzing 3/10')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'AI analysis 3/10' })).toBeInTheDocument();
  });

  it('leaves the loader modal alone', () => {
    renderWrapper({ scanData: scanData({ pipeline: analysing, containers: DONE_SAST }), showLoader: true });
    expect(screen.getByTestId('loader-scan')).toBeInTheDocument();
    expect(screen.queryByTestId('scan-pipeline-panel')).toBeNull();
  });

  it('hides the last-scan banner while a scan is in progress, and shows it once the scan is over', () => {
    const running = renderWrapper({
      scanData: scanData({ pipeline: analysing, containers: DONE_SAST }),
      scanInfo: lastScan,
    });
    expect(screen.queryByText('Last scan completed successfully.')).toBeNull();
    running.unmount();

    renderWrapper({
      scanData: scanData({
        state: 'completed',
        containers: DONE_SAST,
        pipeline: { ...analysing, slotReleased: false, agent: { stage: 'skipped', outcomeReason: 'ai_queue_timeout' } },
      }),
      scanInfo: { ...lastScan, scanId: 's1' },
    });
    expect(screen.getByText('Last scan completed successfully.')).toBeInTheDocument();
    expect(within(screen.getByTestId('scan-pipeline-panel')).getByText('No AI slot came free within the allowed wait.')).toBeInTheDocument();
  });
});
