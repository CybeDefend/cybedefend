import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import AnalyseWrapper from './AnalyseWrapper';

/**
 * The results pages' header in the Community Edition. On an import-only
 * instance its start action is « Import results » (`ImportResultsButton`), on
 * every tab, Container included, and the start-analysis modal is never
 * mounted. On an instance that runs scans on a connected cluster
 * (`useScansRun()` true), every tab but Container offers « Start scan » first
 * and « Import results » second; Container keeps the import alone (no image
 * scan in v1).
 */
const ed = vi.hoisted(() => ({ edition: 'community' as string, scansRun: false }));
vi.mock('@/edition/edition', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/edition/edition')>()),
  get EDITION() {
    return ed.edition;
  },
}));
vi.mock('@/edition/community/instanceCapabilities', () => ({
  // As the real hook: true outside the Community Edition.
  useScansRun: () => ed.edition !== 'community' || ed.scansRun,
}));
// Resolves keys against the real `en` locale.
vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());
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

afterEach(() => {
  ed.edition = 'community';
  ed.scansRun = false;
});

describe('AnalyseWrapper – Community Edition without a cluster', () => {
  it.each(['sast', 'iac', 'secret', 'cicd', 'sca', 'container'])(
    'the %s tab offers Import results, which calls the start action',
    (tab) => {
      const handleStartScanClick = vi.fn();
      renderWrapper({ selectedTab: tab, handleStartScanClick });
      expect(screen.queryByRole('button', { name: 'Start Scan' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Add Image' })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Import results' }));
      expect(handleStartScanClick).toHaveBeenCalledTimes(1);
    },
  );

  it('never mounts the start-analysis modal', () => {
    renderWrapper({ showStartScanModal: true });
    expect(screen.queryByRole('dialog', { name: 'Start a new scan' })).toBeNull();
  });
});

describe('AnalyseWrapper – Community Edition with a cluster', () => {
  it.each(['sast', 'iac', 'secret', 'cicd', 'sca'])(
    'the %s tab: Start scan calls the start action, Import results opens the import dialog',
    (tab) => {
      ed.scansRun = true;
      const handleStartScanClick = vi.fn();
      const onImportResultsClick = vi.fn();
      renderWrapper({ selectedTab: tab, handleStartScanClick, onImportResultsClick });
      fireEvent.click(screen.getByRole('button', { name: 'Start Scan' }));
      expect(handleStartScanClick).toHaveBeenCalledTimes(1);
      expect(onImportResultsClick).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Import results' }));
      expect(onImportResultsClick).toHaveBeenCalledTimes(1);
      expect(handleStartScanClick).toHaveBeenCalledTimes(1);
    },
  );

  it('mounts the start-analysis modal when the page opens it', () => {
    ed.scansRun = true;
    renderWrapper({ showStartScanModal: true });
    expect(screen.getByRole('dialog', { name: 'Start a new scan' })).toBeInTheDocument();
  });

  it('the container tab keeps import only', () => {
    ed.scansRun = true;
    const handleStartScanClick = vi.fn();
    const onImportResultsClick = vi.fn();
    renderWrapper({ selectedTab: 'container', handleStartScanClick, onImportResultsClick, showStartScanModal: true });
    expect(screen.queryByRole('button', { name: 'Start Scan' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add Image' })).toBeNull();
    expect(screen.queryByRole('dialog', { name: 'Start a new scan' })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Import results' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Import results' }));
    expect(handleStartScanClick).toHaveBeenCalledTimes(1);
  });
});

describe('AnalyseWrapper – cloud unchanged', () => {
  it('offers Start Scan alone, whatever the capability says', () => {
    ed.edition = 'cloud';
    ed.scansRun = true;
    const handleStartScanClick = vi.fn();
    renderWrapper({ selectedTab: 'sast', handleStartScanClick, onImportResultsClick: vi.fn() });
    expect(screen.queryByRole('button', { name: 'Import results' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Start Scan' }));
    expect(handleStartScanClick).toHaveBeenCalledTimes(1);
  });

  it('the container tab offers Add Image', () => {
    ed.edition = 'cloud';
    renderWrapper({ selectedTab: 'container' });
    expect(screen.getByRole('button', { name: 'Add Image' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Import results' })).toBeNull();
  });
});
