import React from 'react';
import { act, render } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The six results pages start an analysis the same way: on a branch of the
 * linked repository, or from an uploaded archive. This test pins what each of
 * them does at the two seams that matter — what leaves for the backend, and
 * what it hands to its template (modal, loader, placeholder scan, upload
 * progress, errors) — so the flow can move without any page changing.
 *
 * Each page's template (the `AnalyseWrapper` for AI-BOM, which has none) is
 * replaced by a probe that keeps the props it received.
 */
const h = vi.hoisted(() => {
  const props = { current: null as Record<string, any> | null };
  return {
    props,
    /** Stands for a page's template: keeps the props, renders nothing. */
    probe: (received: Record<string, any>) => {
      props.current = received;
      return null;
    },
    pageData: { current: null as Record<string, any> | null },
    state: { organization: { selectedOrganization: { id: 'org-1' } as { id: string } | null } },
    startScan: vi.fn(),
    uploadFileToSignedUrl: vi.fn(),
    getScanById: vi.fn(),
    startGithub: vi.fn(),
    startGitlab: vi.fn(),
    // The tickets of the project, as the hook hands them.
    tracking: {
      organizationId: 'org-1',
      ticketsByVulnerability: new Map(),
      jira: { configured: false, allowedBranches: [] },
      linear: { connected: true, configured: false, allowedBranches: [] },
      anyConfigured: true,
      refresh: () => Promise.resolve(),
    },
    useIssueTracking: vi.fn(),
    // One object for every list hook: stable references, or the pages' polling effects would re-run on each render.
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
      reachabilityIgnoredCount: 0,
      malwareCount: 0,
      error: null,
      goToPage: vi.fn(),
      refresh: () => undefined,
    },
  };
});

vi.mock('./sast-page/ResultsSastTemplate', () => ({ default: h.probe }));
vi.mock('./iac-page/ResultsIacTemplate', () => ({ default: h.probe }));
vi.mock('./cicd-page/ResultsCicdTemplate', () => ({ default: h.probe }));
vi.mock('./secret-page/ResultsSecretTemplate', () => ({ default: h.probe }));
vi.mock('./sca-page/ResultsScaTemplate', () => ({ default: h.probe }));
vi.mock('@/components/molecules/wrapper/AnalyseWrapper', () => ({ default: h.probe }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

vi.mock('react-redux', () => ({
  useSelector: (selector: (state: unknown) => unknown) => selector(h.state),
  useDispatch: () => () => undefined,
}));

vi.mock('@/server/services/scanService', () => ({
  default: {
    startScan: h.startScan,
    uploadFileToSignedUrl: h.uploadFileToSignedUrl,
    getScanById: h.getScanById,
    cancelScan: vi.fn(),
  },
}));
vi.mock('@/server/services/integrations/githubIntegrationsService', () => ({
  startScanForLastCommitAndProject: h.startGithub,
}));
vi.mock('@/server/services/integrations/gitlabIntegrationsService', () => ({
  startScanForLastCommitAndProjectGitlab: h.startGitlab,
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
  default: () => ({ packages: [], total: 0, totalPages: 1, currentPage: 1, loading: false, error: null, goToPage: h.list.goToPage, refresh: h.list.refresh }),
}));
vi.mock('@/server/hooks/useLicenseSummary', () => ({
  default: () => ({ data: null, loading: false, error: null, refresh: h.list.refresh }),
}));
vi.mock('@/ee/aibom/server/useProjectAiBomComponents', () => ({
  default: () => ({ components: h.list.vulnerabilities, loading: false, error: null, refresh: h.list.refresh }),
}));
vi.mock('@/server/hooks/useProject', () => ({
  useProject: () => ({ project: { name: 'Demo' } }),
  default: () => ({ project: { name: 'Demo' } }),
}));
vi.mock('@/server/hooks/useIssueTracking', () => ({ useIssueTracking: h.useIssueTracking }));
vi.mock('@/server/hooks/useScanRealtime', () => ({ useScanRealtime: () => undefined }));
vi.mock('@/server/hooks/useBatchUpdateCompletion', () => ({ useBatchUpdateCompletion: () => undefined }));
vi.mock('@/server/store/backgroundTasksThunks', () => ({ startBatchUpdate: vi.fn() }));
vi.mock('@/server/services/resultService', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return Object.fromEntries(
    Object.entries(actual).map(([name, value]) => [
      name,
      typeof value === 'function' ? vi.fn().mockResolvedValue({}) : value,
    ]),
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
// The AI-BOM page is a closed extension: a core test cannot import it, so its
// cases live with it.
import { mockTabVisibility } from '@/test/tabVisibility';

type Integration = { type: 'github' | 'gitlab' | 'none'; repositoryId: string | null };

interface PageCase {
  name: string;
  Page: React.ComponentType;
  /** The loader opens as soon as the archive is submitted, before the analysis is created. */
  loaderFromSubmit: boolean;
  /** An archive start is refused when no organisation is selected. */
  requiresOrganization: boolean;
}

const PAGES: PageCase[] = [
  { name: 'SAST', Page: ResultsSastPage, loaderFromSubmit: true, requiresOrganization: true },
  { name: 'IaC', Page: ResultsIacPage, loaderFromSubmit: true, requiresOrganization: true },
  { name: 'CI/CD', Page: ResultsCicdPage, loaderFromSubmit: true, requiresOrganization: true },
  { name: 'Secret', Page: ResultsSecretPage, loaderFromSubmit: true, requiresOrganization: true },
  { name: 'SCA', Page: ResultsScaPage, loaderFromSubmit: false, requiresOrganization: true },
];

const mount = (
  Page: React.ComponentType,
  options: { integration?: Integration; branches?: string[]; selectedBranch?: string; defaultBranch?: string } = {},
) => {
  const integration = options.integration ?? { type: 'none', repositoryId: null };
  const branches = (options.branches ?? []).map((name, index) => ({ name, isDefault: index === 0, isProtected: false }));
  h.pageData.current = {
    isContentReady: true,
    isLoadingBranches: false,
    isBranchResolved: true,
    projectName: 'Demo',
    integrationInfo: integration,
    linkedGithubRepo: integration.type === 'github' ? integration.repositoryId : null,
    linkedGitlabRepo: integration.type === 'gitlab' ? integration.repositoryId : null,
    isSecurityContextCustomized: true,
    securityContextUpdatedAt: null,
    isJiraLinked: false,
    isLinearLinked: true,
    branches,
    defaultBranch: options.defaultBranch ?? '',
    selectedBranch: options.selectedBranch ?? '',
    setSelectedBranch: () => undefined,
    refresh: () => undefined,
    handleArchiveBranch: () => undefined,
    handleUnarchiveBranch: () => undefined,
  };
  const tree = (
    <MemoryRouter initialEntries={['/appsec/project/p1/results']}>
      <NavigationProbe />
      <Routes>
        <Route path="/appsec/project/:projectId/*" element={<Page />} />
      </Routes>
    </MemoryRouter>
  );
  const view = render(tree);
  return {
    /** Renders the page again, as a new answer of its list hooks would. */
    rerender: () => view.rerender(tree),
    /** Moves the route; the results routes keep the same page element. */
    navigate: (to: string) => act(() => navigation.current?.(to)),
  };
};

const navigation = { current: null as ((to: string) => void) | null };
const NavigationProbe = () => {
  navigation.current = useNavigate();
  return null;
};

const props = () => h.props.current as Record<string, any>;
const flush = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
};
const call = async (fn: () => unknown) => {
  await act(async () => {
    void fn();
    await vi.advanceTimersByTimeAsync(0);
  });
};
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const GITHUB: Integration = { type: 'github', repositoryId: 'repo-1' };
const GITLAB: Integration = { type: 'gitlab', repositoryId: 'repo-2' };
const archive = new File(['zip'], 'source.zip', { type: 'application/zip' });

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  h.props.current = null;
  h.state.organization = { selectedOrganization: { id: 'org-1' } };
  h.startScan.mockReset().mockResolvedValue({ url: 'https://storage.test/upload', scanId: 'scan-archive' });
  h.uploadFileToSignedUrl.mockReset().mockResolvedValue(undefined);
  h.getScanById.mockReset().mockResolvedValue({
    id: 'scan-x',
    projectId: 'p1',
    state: 'running',
    progress: 10,
    vulnerabilityDetected: 0,
    containers: [],
  });
  h.startGithub.mockReset().mockResolvedValue({ scanId: 'scan-github' });
  h.startGitlab.mockReset().mockResolvedValue({ scanId: 'scan-gitlab' });
  h.useIssueTracking.mockReset().mockReturnValue(h.tracking);
});

afterEach(() => {
  vi.useRealTimers();
});

// The cases that assert the start modal live with the closed extension: it
// opens only in the cloud.
describe.each(PAGES)('$name results page — starting an analysis', (page) => {
  it('starts on the selected branch of a GitHub repository and follows the analysis it got', async () => {
    const pending = deferred<{ scanId: string }>();
    h.startGithub.mockReturnValue(pending.promise);
    mount(page.Page, { integration: GITHUB, branches: ['main', 'develop'], selectedBranch: 'develop', defaultBranch: 'main' });
    await flush();

    await call(() => props().handleStartScanClick());
    await call(() => props().handleScanSubmit());

    expect(h.startGithub).toHaveBeenCalledTimes(1);
    expect(h.startGithub).toHaveBeenCalledWith('p1', 'repo-1', 'org-1', 'develop');
    expect(h.startScan).not.toHaveBeenCalled();
    // While the request is out: modal closed, loader open on a placeholder scan.
    expect(props().showStartScanModal).toBe(false);
    expect(props().showLoader).toBe(true);
    expect(props().scanData).toMatchObject({ id: '', projectId: 'p1', state: 'initializing' });
    expect(props().isUploading).toBe(false);
    expect(h.getScanById).not.toHaveBeenCalled();

    await act(async () => {
      pending.resolve({ scanId: 'scan-github' });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(h.getScanById).toHaveBeenCalledWith('p1', 'scan-github');
  });

  it('falls back on the default branch, and starts a GitLab repository through its own call', async () => {
    mount(page.Page, { integration: GITLAB, branches: ['main'], selectedBranch: '', defaultBranch: 'main' });
    await flush();

    await call(() => props().handleStartScanClick());
    await call(() => props().handleScanSubmit());

    expect(h.startGitlab).toHaveBeenCalledWith('p1', 'repo-2', 'main');
    expect(h.startGithub).not.toHaveBeenCalled();
    expect(h.getScanById).toHaveBeenCalledWith('p1', 'scan-gitlab');
  });

  it('accepts the three shapes the start call answers its id in', async () => {
    h.startGithub.mockResolvedValue({ scan_id: 'scan-snake' });
    mount(page.Page, { integration: GITHUB, branches: ['main'], selectedBranch: 'main' });
    await flush();

    await call(() => props().handleStartScanClick());
    await call(() => props().handleScanSubmit());

    expect(h.getScanById).toHaveBeenCalledWith('p1', 'scan-snake');
  });

  it('shows a refused branch start in the loader, then closes the loader after five seconds', async () => {
    h.startGithub.mockRejectedValue({ response: { status: 429, data: { message: 'Scan quota exceeded' } } });
    mount(page.Page, { integration: GITHUB, branches: ['main'], selectedBranch: 'main' });
    await flush();

    await call(() => props().handleStartScanClick());
    await call(() => props().handleScanSubmit());

    expect(props().showLoader).toBe(true);
    // A fixed sentence by status, never the server text.
    expect(props().scanData).toMatchObject({ state: 'failed', errorMessage: 'errors.api.tooManyRequests' });
    expect(h.getScanById).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(props().showLoader).toBe(false);
  });

  it('creates the analysis, uploads the archive with its progress, then follows the analysis', async () => {
    const created = deferred<{ url: string; scanId: string }>();
    const uploaded = deferred<void>();
    h.startScan.mockReturnValue(created.promise);
    h.uploadFileToSignedUrl.mockReturnValue(uploaded.promise);
    mount(page.Page);
    await flush();
    expect(props().manualBranchName).toBe('main');

    await call(() => props().handleStartScanClick());
    await call(() => props().onManualBranchNameChange('release'));
    await call(() => props().setSelectedFile(archive));
    await call(() => props().handleScanSubmit());

    expect(h.startScan).toHaveBeenCalledTimes(1);
    expect(h.startScan).toHaveBeenCalledWith('p1', { branch: 'release' });
    expect(props().showStartScanModal).toBe(false);
    expect(props().scanData).toMatchObject({ id: '', projectId: 'p1', state: 'initializing' });
    // Before the analysis exists: four pages already show the loader on its upload step, two wait for the upload.
    expect(props().showLoader).toBe(page.loaderFromSubmit);
    expect(props().isUploading).toBe(page.loaderFromSubmit);

    await act(async () => {
      created.resolve({ url: 'https://storage.test/upload', scanId: 'scan-archive' });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(h.uploadFileToSignedUrl).toHaveBeenCalledWith('https://storage.test/upload', archive, expect.any(Function));
    expect(props().showLoader).toBe(true);
    expect(props().isUploading).toBe(true);
    expect(props().uploadProgress).toBe(0);

    const onProgress = h.uploadFileToSignedUrl.mock.calls[0][2] as (event: { loaded: number; total: number }) => void;
    await call(() => onProgress({ loaded: 42, total: 100 }));
    expect(props().uploadProgress).toBe(42);
    expect(h.getScanById).not.toHaveBeenCalled();

    await act(async () => {
      uploaded.resolve();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(props().isUploading).toBe(false);
    expect(props().uploadProgress).toBe(0);
    expect(h.getScanById).toHaveBeenCalledWith('p1', 'scan-archive');
  });

  it('shows an archive that is too large with its own message', async () => {
    h.startScan.mockResolvedValue({ url: 'https://storage.test/upload', scanId: 'scan-archive' });
    h.uploadFileToSignedUrl.mockRejectedValue({ response: { status: 413, data: { message: 'Payload too large' } } });
    mount(page.Page);
    await flush();

    await call(() => props().handleStartScanClick());
    await call(() => props().setSelectedFile(archive));
    await call(() => props().handleScanSubmit());

    expect(props().showLoader).toBe(true);
    expect(props().isUploading).toBe(false);
    expect(props().scanData).toMatchObject({ state: 'failed', errorMessage: 'common.fileTooLargeError' });
    expect(h.getScanById).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(props().showLoader).toBe(false);
  });

  it('shows a refused archive start as the fixed sentence of its status', async () => {
    h.startScan.mockRejectedValue({ response: { status: 409, data: { message: 'A scan is already in progress' } } });
    mount(page.Page);
    await flush();

    await call(() => props().handleStartScanClick());
    await call(() => props().setSelectedFile(archive));
    await call(() => props().handleScanSubmit());

    expect(h.uploadFileToSignedUrl).not.toHaveBeenCalled();
    expect(props().scanData).toMatchObject({ state: 'failed', errorMessage: 'errors.api.conflict' });
  });

  it('shows a refusal that carries no message', async () => {
    h.startScan.mockRejectedValue({ response: { status: 500, data: {} }, message: 'Request failed with status code 500' });
    mount(page.Page);
    await flush();

    await call(() => props().handleStartScanClick());
    await call(() => props().setSelectedFile(archive));
    await call(() => props().handleScanSubmit());

    expect(props().scanData).toMatchObject({
      state: 'failed',
      errorMessage: 'errors.api.unavailable',
    });
  });

  it('shows a failure without answer as the generic sentence, never its own text', async () => {
    h.startScan.mockRejectedValue(new Error('Network Error'));
    mount(page.Page);
    await flush();

    await call(() => props().handleStartScanClick());
    await call(() => props().setSelectedFile(archive));
    await call(() => props().handleScanSubmit());

    expect(props().scanData).toMatchObject({ state: 'failed', errorMessage: 'common.error' });
  });

  it('handles an archive start while no organisation is selected', async () => {
    h.state.organization = { selectedOrganization: null };
    mount(page.Page);
    await flush();

    await call(() => props().handleStartScanClick());
    await call(() => props().setSelectedFile(archive));
    await call(() => props().handleScanSubmit());

    if (page.requiresOrganization) {
      expect(h.startScan).not.toHaveBeenCalled();
      expect(props().showLoader).toBe(true);
      // The sentence is translated (not an English literal in each page).
      expect(props().scanData).toMatchObject({
        state: 'failed',
        errorMessage: 'components.startAnalysis.errors.noOrganization',
      });
    } else {
      expect(h.startScan).toHaveBeenCalledWith('p1', { branch: 'main' });
      expect(h.getScanById).toHaveBeenCalledWith('p1', 'scan-archive');
    }
  });
});

// A page opened on a scan that is already running reads it once,
// then follows it on its own 10 s fallback poll (the app-root tracker leaves a
// scan its page shows alone), never in a hidden tab, and still sees the scan
// finish when the realtime stream is down (useScanRealtime is a no-op here).
// AI-BOM has no such resume: it follows only the analyses it starts.
describe.each(PAGES.filter((page) => page.name !== 'AI-BOM'))(
  '$name results page — following an analysis already running',
  (page) => {
    const runningScanInfo = () => ({
      scanId: 'scan-run',
      state: 'running',
      createAt: '2026-10-06T10:00:00.000Z',
      scanType: ['sast'],
    });
    const scan = (state: string, progress: number) => ({
      id: 'scan-run',
      projectId: 'p1',
      state,
      progress,
      vulnerabilityDetected: 0,
      containers: [],
    });
    let tab: ReturnType<typeof mockTabVisibility>;

    beforeEach(() => {
      tab = mockTabVisibility();
      h.list.scanInfo = runningScanInfo() as unknown as null;
      h.getScanById.mockReset().mockResolvedValue(scan('running', 30));
    });

    afterEach(() => {
      h.list.scanInfo = null;
      tab.restore();
    });

    it('reads the analysis once when the page opens on it', async () => {
      mount(page.Page);
      await flush();
      expect(h.getScanById).toHaveBeenCalledTimes(1);
      expect(h.getScanById).toHaveBeenCalledWith('p1', 'scan-run');
      expect(props().scanData).toMatchObject({ id: 'scan-run', state: 'running' });
    });

    it('does not read it again when its list hands over a new copy of the same analysis', async () => {
      const { rerender } = mount(page.Page);
      await flush();
      h.list.scanInfo = runningScanInfo() as unknown as null;
      rerender();
      await flush();
      h.list.scanInfo = runningScanInfo() as unknown as null;
      rerender();
      await flush();
      expect(h.getScanById).toHaveBeenCalledTimes(1);
    });

    it('polls nothing in a hidden tab, and reads at once when it is shown again', async () => {
      mount(page.Page);
      await flush();
      expect(h.getScanById).toHaveBeenCalledTimes(1);

      tab.hide();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(h.getScanById).toHaveBeenCalledTimes(1);

      tab.show();
      expect(h.getScanById).toHaveBeenCalledTimes(2);
    });

    it('reads nothing more on a quick switch away and back', async () => {
      mount(page.Page);
      await flush();
      tab.hide();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_000);
      });
      tab.show();
      expect(h.getScanById).toHaveBeenCalledTimes(1);
    });

    // The results routes keep the page element when :projectId changes. The
    // page still follows the previous project's scan: its first read through
    // the new project is a 404 (security-scanning filters by project), and the
    // page lets go of the scan, so the app-root tracker follows it again.
    it('lets go of the scan when the route moves to another project', async () => {
      h.getScanById.mockImplementation(async (projectId: string) => {
        if (projectId === 'p1') return scan('running', 30);
        throw Object.assign(new Error('Not Found'), { response: { status: 404 } });
      });
      const { navigate } = mount(page.Page);
      await flush();
      expect(props().scanData).toMatchObject({ id: 'scan-run' });

      h.list.scanInfo = null;
      navigate('/appsec/project/p2/results');
      await flush();
      expect(h.getScanById).toHaveBeenLastCalledWith('p2', 'scan-run');
      expect(props().scanData).toBeNull();
      expect(props().showLoader).toBe(false);

      const calls = h.getScanById.mock.calls.length;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(h.getScanById.mock.calls.length).toBe(calls);
    });

    it('sees the analysis finish on its own poll, with no realtime event', async () => {
      mount(page.Page);
      await flush();
      h.getScanById.mockResolvedValue(scan('completed', 100));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      expect(props().scanData).toMatchObject({ id: 'scan-run', state: 'completed' });
      // Finished: the poll stops.
      const calls = h.getScanById.mock.calls.length;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      expect(h.getScanById.mock.calls.length).toBe(calls);
    });
  },
);

// The search box must not call goToPage(1) on every
// keystroke, before the 300 ms debounce, or a search typed on page 3 sends page
// 1 with the old query, then page 1 with the new one. The list hooks go
// back to page 1 themselves, in the render where the debounced query changes.
describe.each(PAGES.filter((page) => page.name !== 'AI-BOM'))('$name results page — search', (page) => {
  it('leaves the return to page 1 to the list hook', async () => {
    mount(page.Page);
    await flush();
    h.list.goToPage.mockClear();

    await call(() => props().onSearchQueryChange('sql injection'));

    expect(h.list.goToPage).not.toHaveBeenCalled();
  });
});

// Each results page reads the Jira and Linear tickets of its project
// once, from the project's links, and hands them to its template.
describe.each(PAGES.filter((page) => page.name !== 'AI-BOM'))('$name results page — ticket tracking', ({ Page }) => {
  it("reads the tickets with the project's Jira and Linear links and hands them to its template", async () => {
    mount(Page);
    await flush();
    expect(h.useIssueTracking).toHaveBeenCalledWith('p1', { isJiraLinked: false, isLinearLinked: true });
    expect(props().issueTracking).toBe(h.tracking);
  });
});
