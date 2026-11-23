import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, it, expect, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { readySlots } from '@/edition/slots';
import AnalyseWrapper from './AnalyseWrapper';

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

// Same stubs as AnalyseWrapper.startModal.test.tsx, except the scan-type tabs:
// they render what the wrapper hands them, a link per tab and a button that
// selects it, so both ways of changing tab are visible.
vi.mock('./ProjectSectionNav', () => ({ default: () => null }));
vi.mock('../project-id-actions/ProjectIdActions', () => ({ default: () => null }));
vi.mock('../banners/SecurityContextBanner', () => ({ default: () => null }));
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
// The scan-type tabs render what the wrapper hands them — a link per core tab
// and a button that selects it — and, after them, the slot registrations' own
// tabs (the closed tree's AI-BOM one), each through `CustomTabItem`
// with the same probe markup.
vi.mock('../sidebar/custom-tabs/CustomTabs', () => {
  const probeTab = (tab: { value: string; link?: string }, onSelectTab?: (tab: string) => void) => (
    <React.Fragment key={tab.value}>
      {tab.link ? <a data-testid={`link-${tab.value}`} href={tab.link} /> : null}
      <button type="button" data-testid={`select-${tab.value}`} onClick={() => onSelectTab?.(tab.value)} />
    </React.Fragment>
  );
  return {
    default: ({
      tabs,
      onSelectTab,
      children,
    }: {
      tabs: { value: string; link?: string }[];
      onSelectTab: (tab: string) => void;
      children?: React.ReactNode;
    }) => (
      <div>
        {tabs.map((tab) => probeTab(tab, onSelectTab))}
        {children}
      </div>
    ),
    CustomTabItem: ({ tab, onSelectTab }: { tab: { value: string; link?: string }; onSelectTab?: (tab: string) => void }) =>
      probeTab(tab, onSelectTab),
  };
});

// The scanner-list slot registrations load on demand: loaded before the first render.
beforeAll(() => readySlots());

const LocationProbe: React.FC = () => {
  const { pathname } = useLocation();
  return <div data-testid="location">{pathname}</div>;
};

const renderWrapper = () =>
  render(
    <Provider store={configureStore({ reducer: () => ({ organization: {} }) })}>
      <MemoryRouter initialEntries={['/appsec/project/p1/sast']}>
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
        >
          <div />
        </AnalyseWrapper>
        <Routes>
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  );

// The aibom row is tested in the closed tree: its tab is a closed-tree slot
// registration.
const TABS: [string, string][] = [
  ['sast', '/appsec/project/p1/sast'],
  ['iac', '/appsec/project/p1/iac'],
  ['cicd', '/appsec/project/p1/cicd'],
  ['secret', '/appsec/project/p1/secret'],
  ['sca', '/appsec/project/p1/sca'],
  ['container', '/appsec/project/p1/container'],
];

describe('AnalyseWrapper – scan-type tabs', () => {
  it.each(TABS)('links the %s tab to its AppSec results page', (tab, url) => {
    renderWrapper();
    expect(screen.getByTestId(`link-${tab}`)).toHaveAttribute('href', url);
  });

  it.each(TABS)('selecting the %s tab opens its AppSec results page', (tab, url) => {
    renderWrapper();
    fireEvent.click(screen.getByTestId(`select-${tab}`));
    expect(screen.getByTestId('location').textContent).toBe(url);
  });
});
