import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * What the SAST page's start actions do, by edition and capability. The
 * template is a probe that keeps its props; the start-analysis hook and the
 * import dialog are stubs, so only the page's decision is under test:
 * - Community, import-only instance: the start action opens the import dialog,
 *   as today;
 * - Community, instance running scans on a cluster: the start action opens the
 *   start dialog, and « Import results » opens the import dialog;
 * - cloud: the start action opens the start dialog, as before.
 */
const h = vi.hoisted(() => {
  const props = { current: null as Record<string, unknown> | null };
  return {
    props,
    edition: 'community' as string,
    scansRun: false,
    open: vi.fn(),
    list: {
      vulnerabilities: [],
      groups: [],
      projectName: '',
      totalVulnerabilities: 0,
      totalGroups: 0,
      totalOccurrences: 0,
      totalPages: 1,
      currentPage: 1,
      vulnCountByType: { sast: 0, iac: 0, cicd: 0, secret: 0, sca: 0, container: 0 },
      loading: false,
      scanInfo: null,
      isProjectParsed: false,
      availableLanguages: [],
      error: null,
      goToPage: () => undefined,
      refresh: () => undefined,
    },
    pageData: {
      isContentReady: true,
      isLoadingBranches: false,
      isBranchResolved: true,
      projectName: 'Demo',
      integrationInfo: { type: 'none', repositoryId: null },
      linkedGithubRepo: null,
      linkedGitlabRepo: null,
      isSecurityContextCustomized: true,
      securityContextUpdatedAt: null,
      isJiraLinked: false,
      branches: [],
      defaultBranch: '',
      selectedBranch: '',
      setSelectedBranch: () => undefined,
      refresh: () => undefined,
      handleArchiveBranch: () => undefined,
      handleUnarchiveBranch: () => undefined,
    },
    state: { organization: { selectedOrganization: { id: 'org-1' } } },
  };
});

vi.mock('@/edition/edition', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/edition/edition')>()),
  get EDITION() {
    return h.edition;
  },
}));
vi.mock('@/edition/community/instanceCapabilities', () => ({
  // As the real hook: true outside the Community Edition.
  useScansRun: () => h.edition !== 'community' || h.scansRun,
}));
vi.mock('./ResultsSastTemplate', () => ({
  default: (received: Record<string, unknown>) => {
    h.props.current = received;
    return null;
  },
}));
vi.mock('@/components/molecules/import-results/ImportResultsDialog', () => ({
  default: () => <div data-testid="import-dialog" />,
}));
vi.mock('@/server/hooks/useStartAnalysis', () => ({
  useStartAnalysis: () => ({
    isOpen: false,
    open: h.open,
    close: vi.fn(),
    submit: vi.fn(),
    errors: {},
    setSelectedFile: vi.fn(),
    uploadProgress: 0,
    isStartingArchive: false,
    manualBranchName: '',
    setManualBranchName: vi.fn(),
  }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));
vi.mock('react-redux', () => ({
  useSelector: (selector: (state: unknown) => unknown) => selector(h.state),
  useDispatch: () => () => undefined,
}));
vi.mock('@/server/hooks/useProjectPageData', () => ({
  useProjectPageData: () => h.pageData,
  default: () => h.pageData,
}));
vi.mock('@/server/hooks/useProjectVulnerabilities', () => ({ default: () => h.list }));
vi.mock('@/server/hooks/useGroupedVulnerabilities', () => ({ useGroupedVulnerabilities: () => h.list, default: () => h.list }));
vi.mock('@/server/hooks/useIssueTracking', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useIssueTracking: () => undefined,
}));
vi.mock('@/server/hooks/useScanRealtime', () => ({ useScanRealtime: () => undefined }));
vi.mock('@/server/hooks/useBatchUpdateCompletion', () => ({ useBatchUpdateCompletion: () => undefined }));
vi.mock('@/server/store/backgroundTasksThunks', () => ({ startBatchUpdate: vi.fn() }));
vi.mock('@/server/services/scanService', () => ({
  default: { startScan: vi.fn(), uploadFileToSignedUrl: vi.fn(), getScanById: vi.fn(), cancelScan: vi.fn() },
}));
vi.mock('@/components/molecules/selection-action-bar/SelectionActionBar', () => ({ default: () => null }));
vi.mock('@/components/molecules/modal/batch-update-modal/BatchUpdateModal', () => ({ default: () => null }));

import ResultsSastPage from './ResultsSastPage';

const mount = () =>
  render(
    <MemoryRouter initialEntries={['/appsec/project/p1/sast']}>
      <Routes>
        <Route path="/appsec/project/:projectId/*" element={<ResultsSastPage />} />
      </Routes>
    </MemoryRouter>,
  );

/** The page's callback named `name`, narrowed: the test fails if it is not a function. */
const callback = (name: string): (() => void) => {
  const value = h.props.current?.[name];
  if (typeof value !== 'function') throw new Error(`the page passed no ${name}`);
  return value as () => void;
};

beforeEach(() => {
  h.props.current = null;
  h.open.mockReset();
  h.edition = 'community';
  h.scansRun = false;
});

describe('ResultsSastPage start actions', () => {
  it('community without cluster: the start action opens the import dialog, as today', () => {
    mount();
    act(() => callback('handleStartScanClick')());
    expect(screen.getByTestId('import-dialog')).toBeInTheDocument();
    expect(h.open).not.toHaveBeenCalled();
  });

  it('community with cluster: Start scan opens the start dialog, Import results opens the import dialog', () => {
    h.scansRun = true;
    mount();
    act(() => callback('handleStartScanClick')());
    expect(h.open).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('import-dialog')).not.toBeInTheDocument();
    act(() => callback('onImportResultsClick')());
    expect(screen.getByTestId('import-dialog')).toBeInTheDocument();
  });

  it('cloud unchanged: the start action opens the start dialog', () => {
    h.edition = 'cloud';
    mount();
    act(() => callback('handleStartScanClick')());
    expect(h.open).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('import-dialog')).not.toBeInTheDocument();
  });
});
