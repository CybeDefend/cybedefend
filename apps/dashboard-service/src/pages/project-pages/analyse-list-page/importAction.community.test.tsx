import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The results pages of the Community Edition: no scanner runs, so the
 * start action imports a SARIF file. Each page opens `ImportResultsDialog` on
 * its own type and branch, never the start-analysis modal; the Container page
 * never mounts the add-image modal (public, private-registry, GitLab and
 * GitHub image scans). After the 202 the page's own tracker follows the
 * import scan, and refetches its list once it reached a final state.
 *
 * Each page's template (the `AnalyseWrapper` for Container) is a probe that
 * keeps the props it received; the dialog is a probe too.
 */
const h = vi.hoisted(() => {
  const props = { current: null as Record<string, any> | null };
  const dialog = { current: null as Record<string, any> | null };
  return {
    props,
    dialog,
    probe: (received: Record<string, any>) => {
      props.current = received;
      return null;
    },
    dialogProbe: (received: Record<string, any>) => {
      dialog.current = received;
      return <div data-testid="import-dialog" />;
    },
    addImageModal: vi.fn(() => <div data-testid="add-image-modal" />),
    pageData: { current: null as Record<string, any> | null },
    state: { organization: { selectedOrganization: { id: 'org-1' } } },
    startScan: vi.fn(),
    getScanById: vi.fn(),
    startGithub: vi.fn(),
    refresh: vi.fn(),
    refreshImages: vi.fn(),
    list: null as Record<string, any> | null,
    images: null as Record<string, any> | null,
  };
});

h.list = {
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
  reachabilityIgnoredCount: 0,
  malwareCount: 0,
  error: null,
  goToPage: () => undefined,
  refresh: h.refresh,
};
h.images = {
  images: [],
  groupedImages: [],
  projectName: 'Demo',
  totalImages: 0,
  totalRepositories: 0,
  totalPages: 1,
  currentPage: 1,
  loading: false,
  goToPage: () => undefined,
  refresh: h.refreshImages,
};

vi.mock('@/edition/edition', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/edition/edition')>()),
  EDITION: 'community',
}));

vi.mock('./sast-page/ResultsSastTemplate', () => ({ default: h.probe }));
vi.mock('./iac-page/ResultsIacTemplate', () => ({ default: h.probe }));
vi.mock('./cicd-page/ResultsCicdTemplate', () => ({ default: h.probe }));
vi.mock('./secret-page/ResultsSecretTemplate', () => ({ default: h.probe }));
vi.mock('./sca-page/ResultsScaTemplate', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./sca-page/ResultsScaTemplate')>()),
  default: h.probe,
}));
vi.mock('@/components/molecules/wrapper/AnalyseWrapper', () => ({ default: h.probe }));
vi.mock('./container-page/ResultsContainerTemplate', () => ({ default: () => null }));
vi.mock('@/components/molecules/import-results/ImportResultsDialog', () => ({ default: h.dialogProbe }));
vi.mock('@/edition/active', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/edition/active')>();
  return {
    ...actual,
    // The Add Container Image modal is the extension's now: the probe
    // still proves the Community Edition never opens it.
    ACTIVE_EXTENSIONS: {
      ...actual.ACTIVE_EXTENSIONS,
      containerRegistries: { CredentialModal: () => null, AddImageModal: h.addImageModal },
    },
  };
});
vi.mock('@/components/organismes/table/container-table/ResultsContainerImagesTable', () => ({ default: () => null }));
vi.mock('@/components/organismes/table/container-table/ResultsContainerGroupedImagesTable', () => ({ default: () => null }));
vi.mock('@/components/molecules/modal/confirmation-modal/ConfirmationModal', () => ({ default: () => null }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));
vi.mock('react-redux', () => ({
  useSelector: (selector: (state: unknown) => unknown) => selector(h.state),
  useDispatch: () => () => undefined,
}));

vi.mock('@/server/services/scanService', () => ({
  default: { startScan: h.startScan, uploadFileToSignedUrl: vi.fn(), getScanById: h.getScanById, cancelScan: vi.fn() },
}));
vi.mock('@/server/services/integrations/githubIntegrationsService', () => ({
  startScanForLastCommitAndProject: h.startGithub,
}));
vi.mock('@/server/services/integrations/gitlabIntegrationsService', () => ({
  startScanForLastCommitAndProjectGitlab: vi.fn(),
}));
vi.mock('@/server/hooks/useProjectPageData', () => ({
  useProjectPageData: () => h.pageData.current,
  default: () => h.pageData.current,
}));
vi.mock('@/server/hooks/useProjectVulnerabilities', () => ({ default: () => h.list }));
vi.mock('@/server/hooks/useGroupedVulnerabilities', () => ({
  useGroupedVulnerabilities: () => h.list,
  default: () => h.list,
}));
vi.mock('@/server/hooks/useProjectPackages', () => ({
  default: () => ({ packages: [], total: 0, totalPages: 1, currentPage: 1, loading: false, error: null, goToPage: () => undefined, refresh: () => undefined }),
}));
vi.mock('@/server/hooks/useLicenseSummary', () => ({
  default: () => ({ data: null, loading: false, error: null, refresh: () => undefined }),
}));
vi.mock('@/server/hooks/useProjectContainerVulnerabilities', () => ({ default: () => h.list }));
vi.mock('@/server/hooks/useProjectContainerPackages', () => ({
  default: () => ({ packages: [], totalPackages: 0, totalPages: 1, currentPage: 1, loading: false, error: null, goToPage: () => undefined }),
}));
vi.mock('@/server/hooks/useProjectContainerImages', () => ({ default: () => h.images }));
vi.mock('@/server/hooks/useProjectContainerGroupedImages', () => ({ default: () => h.images }));
vi.mock('@/server/hooks/useDisabledFeatures', () => ({ default: () => new Set<string>() }));
vi.mock('@/server/hooks/useProject', () => ({
  useProject: () => ({ project: { name: 'Demo' } }),
  default: () => ({ project: { name: 'Demo' } }),
}));
vi.mock('@/server/hooks/useIssueTracking', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), useIssueTracking: () => undefined }));
vi.mock('@/server/hooks/useScanRealtime', () => ({ useScanRealtime: () => undefined }));
vi.mock('@/server/hooks/useBatchUpdateCompletion', () => ({ useBatchUpdateCompletion: () => undefined }));
vi.mock('@/server/store/backgroundTasksThunks', () => ({ startBatchUpdate: vi.fn() }));
vi.mock('@/server/services/integrations/jiraIntegrationsService', () => ({
  getProjectJiraConfig: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/server/services/resultService', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return Object.fromEntries(
    Object.entries(actual).map(([name, value]) => [name, typeof value === 'function' ? vi.fn().mockResolvedValue({}) : value]),
  );
});
vi.mock('@/ee/chat/components/molecules/focus-top5/FocusTop5Overlay', () => ({ default: () => null }));
vi.mock('@/components/molecules/selection-action-bar/SelectionActionBar', () => ({ default: () => null }));
vi.mock('@/components/molecules/modal/batch-update-modal/BatchUpdateModal', () => ({ default: () => null }));
vi.mock('@/ee/ai/components/molecules/banners/ProjectStaleAnalysisBanner', () => ({ default: () => null }));

import ResultsSastPage from './sast-page/ResultsSastPage';
import ResultsIacPage from './iac-page/ResultsIacPage';
import ResultsCicdPage from './cicd-page/ResultsCicdPage';
import ResultsSecretPage from './secret-page/ResultsSecretPage';
import ResultsScaPage from './sca-page/ResultsScaPage';
import ResultsContainerPage from './container-page/ResultsContainerPage';
import LoaderScan from '@/components/atoms/loader/LoaderScan';
import type { ScanResponseDto } from '@/server/interfaces/Scan';

const PAGES: Record<string, React.ComponentType> = {
  sast: ResultsSastPage,
  iac: ResultsIacPage,
  secret: ResultsSecretPage,
  cicd: ResultsCicdPage,
  sca: ResultsScaPage,
  container: ResultsContainerPage,
};

const mount = (type: string) => {
  h.pageData.current = {
    isContentReady: true,
    isLoadingBranches: false,
    isBranchResolved: true,
    projectName: 'Demo',
    // The dialog takes the id of the project the API answered for.
    loadedProjectId: 'p1',
    integrationInfo: { type: 'none', repositoryId: null },
    linkedGithubRepo: null,
    linkedGitlabRepo: null,
    isSecurityContextCustomized: true,
    securityContextUpdatedAt: null,
    isJiraLinked: false,
    branches: [{ name: 'main', isDefault: true, isProtected: false }, { name: 'develop', isDefault: false, isProtected: false }],
    defaultBranch: 'main',
    selectedBranch: 'develop',
    setSelectedBranch: () => undefined,
    refresh: () => undefined,
    handleArchiveBranch: () => undefined,
    handleUnarchiveBranch: () => undefined,
  };
  const Page = PAGES[type];
  return render(
    <MemoryRouter initialEntries={[`/appsec/project/p1/results/${type}`]}>
      <Routes>
        <Route path="/appsec/project/:projectId/*" element={<Page />} />
      </Routes>
    </MemoryRouter>,
  );
};

const props = () => h.props.current as Record<string, any>;
const flush = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
const call = async (fn: () => unknown) => {
  await act(async () => {
    void fn();
    await vi.advanceTimersByTimeAsync(0);
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  sessionStorage.clear();
  h.props.current = null;
  h.dialog.current = null;
  h.addImageModal.mockClear();
  h.startScan.mockReset();
  h.startGithub.mockReset();
  h.refresh.mockReset();
  h.refreshImages.mockReset();
  h.getScanById.mockReset().mockResolvedValue({ id: 'scan-imp', projectId: 'p1', state: 'running', progress: 0, vulnerabilityDetected: 0, containers: [] });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe.each(['sast', 'iac', 'secret', 'cicd', 'sca'])('the %s results page in the Community Edition', (type) => {
  it(`in community the ${type} page shows Import results and no start-analysis action`, async () => {
    mount(type);
    await flush();
    expect(screen.queryByTestId('import-dialog')).toBeNull();

    await call(() => props().handleStartScanClick());

    expect(screen.getByTestId('import-dialog')).toBeInTheDocument();
    expect(props().showStartScanModal).toBe(false);
    expect(h.dialog.current).toMatchObject({ projectId: 'p1', defaultType: type, defaultBranch: 'develop' });
    expect(h.startScan).not.toHaveBeenCalled();
    expect(h.startGithub).not.toHaveBeenCalled();

    await call(() => h.dialog.current!.onClose());
    expect(screen.queryByTestId('import-dialog')).toBeNull();
  });

  it('follows the import scan and refetches its list when it reaches completed', async () => {
    mount(type);
    await flush();
    await call(() => props().handleStartScanClick());
    await call(() => h.dialog.current!.onImported('scan-imp'));

    expect(h.getScanById).toHaveBeenCalledWith('p1', 'scan-imp');
    expect(props().showLoader).toBe(true);
    expect(props().scanData).toMatchObject({ id: 'scan-imp', state: 'running' });
    h.refresh.mockClear();

    h.getScanById.mockResolvedValue({ id: 'scan-imp', projectId: 'p1', state: 'completed', progress: 100, vulnerabilityDetected: 3, containers: [] });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(h.refresh).toHaveBeenCalled();
  });
});

describe('the Container results page in the Community Edition', () => {
  it('in community the Container page shows Import results, and neither the add-image modal nor a registry scan can open', async () => {
    mount('container');
    await flush();

    await call(() => props().handleStartScanClick());

    expect(screen.getByTestId('import-dialog')).toBeInTheDocument();
    expect(h.dialog.current).toMatchObject({ projectId: 'p1', defaultType: 'container', defaultBranch: 'develop' });
    expect(screen.queryByTestId('add-image-modal')).toBeNull();
    expect(h.addImageModal).not.toHaveBeenCalled();
  });

  it('refetches the images list when the import scan reaches completed', async () => {
    mount('container');
    await flush();
    await call(() => props().handleStartScanClick());
    await call(() => h.dialog.current!.onImported('scan-imp'));
    expect(h.getScanById).toHaveBeenCalledWith('p1', 'scan-imp');
    h.refreshImages.mockClear();

    h.getScanById.mockResolvedValue({ id: 'scan-imp', projectId: 'p1', state: 'completed', progress: 100, vulnerabilityDetected: 2, containers: [] });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(h.refreshImages).toHaveBeenCalled();
  });
});

describe('a failed import scan', () => {
  it('a failed sca import shows the IMPORT_UNSUPPORTED_RESULT sentence', () => {
    const scan = {
      id: 'scan-imp',
      projectId: 'p1',
      state: 'failed',
      errorCode: 78,
      errorCategory: 'import',
      errorMessage: 'raw text',
      containers: [],
    } as unknown as ScanResponseDto;
    render(<LoaderScan scanData={scan} vulnCount={0} showPulse={false} onClose={() => undefined} />);
    expect(screen.getByText('components.loaderScan.scanErrors.importUnsupportedResult')).toBeInTheDocument();
    expect(screen.queryByText(/raw text/)).toBeNull();
  });
});
