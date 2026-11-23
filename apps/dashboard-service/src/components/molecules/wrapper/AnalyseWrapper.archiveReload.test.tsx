import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import AnalyseWrapper from './AnalyseWrapper';

/**
 * Archiving a branch from the results pages' selector (the archived branch
 * must not stay in the open selector until a page reload). The
 * page reloads its own branches in its handler; the selector holds its own
 * list (useProjectBranchesList), which the wrapper reloads once the handler
 * is done, archive or unarchive, success or failure.
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
const reload = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('@/server/hooks/useProjectBranchesList', () => ({
  useProjectBranchesList: () => ({
    branches: [
      { name: 'main', isDefault: true, isProtected: false, archived: false },
      { name: 'feature', isDefault: false, isProtected: false, archived: false },
    ],
    reload,
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
  reload.mockClear();
});

const branches = [
  { name: 'main', isDefault: true },
  { name: 'feature', isDefault: false },
];

const archiveFeature = () => {
  fireEvent.click(screen.getByRole('button', { name: /main/ }));
  const archive = screen.getAllByTitle('Archive');
  fireEvent.click(archive[archive.length - 1]);
};

describe('AnalyseWrapper – archiving a branch reloads the selector', () => {
  it('reloads the selector list after the page handler is done', async () => {
    let finish: () => void = () => {};
    const onArchive = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    renderWrapper({ branches: branches as any, selectedBranch: 'main', defaultBranch: 'main', onArchive });
    archiveFeature();
    expect(onArchive).toHaveBeenCalledWith(expect.any(String));
    expect(reload).not.toHaveBeenCalled();
    finish();
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });

  it('reloads it even when the archive failed', async () => {
    const onArchive = vi.fn().mockRejectedValue(new Error('refused'));
    renderWrapper({ branches: branches as any, selectedBranch: 'main', defaultBranch: 'main', onArchive });
    archiveFeature();
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });
});
