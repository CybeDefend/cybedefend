import React from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import backgroundTasksReducer from '@/server/store/backgroundTasksSlice';
import type { ScanResponseDto } from '@/server/interfaces/Scan';
import AnalyseWrapper from './AnalyseWrapper';

// Resolves keys against the real `en` locale.
vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

/**
 * The wrapper hands the scan its page shows to
 * the background-tasks store as `ownedByPage`, so the app-root tracker skips
 * it. It must only do so for a scan the page really reads, i.e. a scan of the
 * project on the route. The results routes keep the same page element when
 * `:projectId` changes, so a page can still hold the scan of the previous
 * project: that scan goes back to the tracker.
 */
vi.mock('./ProjectSectionNav', () => ({ default: () => null }));
vi.mock('../project-id-actions/ProjectIdActions', () => ({ default: () => null }));
vi.mock('../banners/SecurityContextBanner', () => ({ default: () => null }));
vi.mock('../sidebar/custom-tabs/CustomTabs', () => ({ default: () => null }));
vi.mock('../../atoms/loader/LoaderScan', () => ({ default: () => <div data-testid="loader-scan" /> }));
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

const scan = (over: Partial<ScanResponseDto>): ScanResponseDto =>
  ({ id: 'scan-a', projectId: 'project-a', state: 'running', progress: 40, containers: [], ...over }) as ScanResponseDto;

const buildStore = () =>
  configureStore({
    reducer: { organization: () => ({}), backgroundTasks: backgroundTasksReducer },
  });

const element = (props: Partial<Props>) => (
  <MemoryRouter>
    <AnalyseWrapper
      projectId="project-a"
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
);

const arrange = (props: Partial<Props>) => {
  const store = buildStore();
  const view = render(<Provider store={store}>{element(props)}</Provider>);
  const rerender = (next: Partial<Props>) => view.rerender(<Provider store={store}>{element(next)}</Provider>);
  const task = () => store.getState().backgroundTasks.tasks.find((t) => t.id === 'scan-a');
  return { task, rerender };
};

describe('AnalyseWrapper — which scan the page takes from the tracker', () => {
  it('takes the scan of the project on the route', () => {
    const { task } = arrange({ projectId: 'project-a', scanData: scan({}) });
    expect(task()).toMatchObject({ status: 'running', ownedByPage: true });
  });

  it('takes a scan that carries no project: it is the route project one', () => {
    const { task } = arrange({ projectId: 'project-a', scanData: scan({ projectId: undefined }) });
    expect(task()).toMatchObject({ projectId: 'project-a', ownedByPage: true });
  });

  it('gives the scan back when the route moves to another project while the page still holds it', () => {
    const { task, rerender } = arrange({ projectId: 'project-a', scanData: scan({}) });
    rerender({ projectId: 'project-b', scanData: scan({}) });
    expect(task()).toMatchObject({ projectId: 'project-a', status: 'running', ownedByPage: false });
  });

  it('never takes a scan of another project', () => {
    const store = buildStore();
    render(<Provider store={store}>{element({ projectId: 'project-b', scanData: scan({}) })}</Provider>);
    expect(store.getState().backgroundTasks.tasks.find((t) => t.ownedByPage)).toBeUndefined();
  });
});
