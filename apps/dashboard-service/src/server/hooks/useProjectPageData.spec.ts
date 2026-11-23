import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import React from 'react';
import { hookCache } from './utils/hookCache';

const getGithubRepositoriesMock = vi.fn();
const getGitlabRepositoriesMock = vi.fn();
const getGithubRepositoryBranchesMock = vi.fn();
const getGitlabRepositoryBranchesMock = vi.fn();
const startScanForLastCommitAndProjectMock = vi.fn();
const startScanForLastCommitAndProjectGitlabMock = vi.fn();

vi.mock('@/server/services/integrations/githubIntegrationsService', () => ({
  getGithubRepositories: (...args: unknown[]) => getGithubRepositoriesMock(...args),
  getGithubRepositoryBranches: (...args: unknown[]) => getGithubRepositoryBranchesMock(...args),
  startScanForLastCommitAndProject: (...args: unknown[]) =>
    startScanForLastCommitAndProjectMock(...args),
}));

vi.mock('@/server/services/integrations/gitlabIntegrationsService', () => ({
  getGitlabRepositories: (...args: unknown[]) => getGitlabRepositoriesMock(...args),
  getGitlabRepositoryBranches: (...args: unknown[]) => getGitlabRepositoryBranchesMock(...args),
  startScanForLastCommitAndProjectGitlab: (...args: unknown[]) =>
    startScanForLastCommitAndProjectGitlabMock(...args),
}));

const getProjectBranchesMock = vi.fn();
const getArchivedBranchesMock = vi.fn();
const getProjectBranchesListMock = vi.fn();
const archiveBranchMock = vi.fn();
const unarchiveBranchMock = vi.fn();
vi.mock('@/server/services/resultService', () => ({
  getProjectBranches: (...args: unknown[]) => getProjectBranchesMock(...args),
  getArchivedBranches: (...args: unknown[]) => getArchivedBranchesMock(...args),
  getProjectBranchesList: (...args: unknown[]) => getProjectBranchesListMock(...args),
  archiveBranch: (...args: unknown[]) => archiveBranchMock(...args),
  unarchiveBranch: (...args: unknown[]) => unarchiveBranchMock(...args),
}));

/** A /branches/list answer. */
const listOf = (
  names: string[],
  extra: { defaultBranch?: string; scanBranch?: string; hasMore?: boolean; archived?: string[] } = {},
) => ({
  branches: names.map((name) => ({
    name,
    isDefault: name === (extra.defaultBranch ?? ''),
    isProtected: false,
    archived: (extra.archived ?? []).includes(name),
  })),
  pagination: { page: 1, pageSize: 30, total: names.length, hasMore: extra.hasMore ?? false },
  defaultBranch: extra.defaultBranch ?? '',
  scanBranch: extra.scanBranch ?? '',
});

const fetchProjectMock = vi.fn();
vi.mock('@/server/services/projectService', () => ({
  fetchProject: (...args: unknown[]) => fetchProjectMock(...args),
}));

import { useProjectPageData } from './useProjectPageData';
import { useProjectBranchesList, DEFAULT_BRANCH_LIST_QUERY } from './useProjectBranchesList';

const buildStore = (organizationId = 'org-1') =>
  configureStore({
    reducer: {
      organization: () => ({
        selectedOrganization: { id: organizationId },
      }),
    },
  });

const wrap = (store: ReturnType<typeof buildStore>) =>
  function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(Provider, { store, children });
  };

describe('useProjectPageData — securityContextUpdatedAt exposure', () => {
  beforeEach(() => {
    fetchProjectMock.mockReset();
    getGithubRepositoriesMock.mockReset();
    getGitlabRepositoriesMock.mockReset();
    getProjectBranchesMock.mockReset();
    getArchivedBranchesMock.mockReset();
    getProjectBranchesListMock.mockReset();
    getProjectBranchesListMock.mockResolvedValue(listOf([]));

    getGithubRepositoriesMock.mockResolvedValue({ repositories: [] });
    getGitlabRepositoriesMock.mockResolvedValue({ repositories: [] });
    getProjectBranchesMock.mockResolvedValue({ branches: [] });
    getArchivedBranchesMock.mockResolvedValue({ branches: [] });
    localStorage.clear();
    hookCache.clear();
  });

  it('exposes securityContextUpdatedAt = null when the project has no security context', async () => {
    fetchProjectMock.mockResolvedValue({
      isGithubLinked: false,
      isGitlabLinked: false,
      isJiraLinked: false,
      // securityContext intentionally omitted — project has never customized
      securityContext: undefined,
    });

    const { result } = renderHook(() => useProjectPageData('p1'), {
      wrapper: wrap(buildStore()),
    });

    await waitFor(() => expect(result.current.isReady).toBe(true));

    expect(result.current.securityContextUpdatedAt).toBeNull();
  });

  it('exposes securityContextUpdatedAt from the project payload when the project has one', async () => {
    fetchProjectMock.mockResolvedValue({
      isGithubLinked: false,
      isGitlabLinked: false,
      isJiraLinked: false,
      securityContext: {
        id: 'sc-1',
        projectId: 'p1',
        isCustomized: true,
        updatedAt: '2026-05-20T10:30:00.000Z',
      },
    });

    const { result } = renderHook(() => useProjectPageData('p1'), {
      wrapper: wrap(buildStore()),
    });

    await waitFor(() => expect(result.current.isReady).toBe(true));

    expect(result.current.securityContextUpdatedAt).toBe(
      '2026-05-20T10:30:00.000Z',
    );
  });

  it('keeps securityContextUpdatedAt = null when fetchProject throws (no fallback to stale data)', async () => {
    fetchProjectMock.mockRejectedValue(new Error('network'));

    const { result } = renderHook(() => useProjectPageData('p1'), {
      wrapper: wrap(buildStore()),
    });

    await waitFor(() => expect(result.current.isReady).toBe(true));

    expect(result.current.securityContextUpdatedAt).toBeNull();
  });
});

/*
  « Does this organization have Linear » comes from the /project/:id payload, like
  Jira's: the settings page reads the Linear teams and config only when it is true.
*/
describe('useProjectPageData — isLinearLinked exposure', () => {
  beforeEach(() => {
    fetchProjectMock.mockReset();
    getGithubRepositoriesMock.mockReset().mockResolvedValue({ repositories: [] });
    getGitlabRepositoriesMock.mockReset().mockResolvedValue({ repositories: [] });
    getProjectBranchesMock.mockReset().mockResolvedValue({ branches: [] });
    getArchivedBranchesMock.mockReset().mockResolvedValue({ branches: [] });
    getProjectBranchesListMock.mockReset().mockResolvedValue(listOf([]));
    localStorage.clear();
    hookCache.clear();
  });

  it('is null until the project payload has loaded', () => {
    fetchProjectMock.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useProjectPageData('p1'), { wrapper: wrap(buildStore()) });

    expect(result.current.isLinearLinked).toBeNull();
  });

  it('is true when the payload says the organization has Linear', async () => {
    fetchProjectMock.mockResolvedValue({ isGithubLinked: false, isGitlabLinked: false, isLinearLinked: true });

    const { result } = renderHook(() => useProjectPageData('p1'), { wrapper: wrap(buildStore()) });

    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.isLinearLinked).toBe(true);
  });

  it('is false for a payload from a backend that does not send it yet', async () => {
    fetchProjectMock.mockResolvedValue({ isGithubLinked: false, isGitlabLinked: false, isJiraLinked: true });

    const { result } = renderHook(() => useProjectPageData('p1'), { wrapper: wrap(buildStore()) });

    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.isLinearLinked).toBe(false);
  });

  it('comes back from the cache on the next mount', async () => {
    fetchProjectMock.mockResolvedValue({ isGithubLinked: false, isGitlabLinked: false, isLinearLinked: true });
    const store = buildStore();

    const first = renderHook(() => useProjectPageData('p1'), { wrapper: wrap(store) });
    await waitFor(() => expect(first.result.current.isReady).toBe(true));
    first.unmount();

    fetchProjectMock.mockReturnValue(new Promise(() => {}));
    const second = renderHook(() => useProjectPageData('p1'), { wrapper: wrap(store) });

    expect(second.result.current.isLinearLinked).toBe(true);
  });
});

describe('useProjectPageData — cross-page navigation caching', () => {
  beforeEach(() => {
    fetchProjectMock.mockReset();
    getGithubRepositoriesMock.mockReset();
    getGitlabRepositoriesMock.mockReset();
    getProjectBranchesMock.mockReset();
    getArchivedBranchesMock.mockReset();
    getProjectBranchesListMock.mockReset();
    getProjectBranchesListMock.mockResolvedValue(listOf([]));

    getGithubRepositoriesMock.mockResolvedValue({ repositories: [] });
    getGitlabRepositoriesMock.mockResolvedValue({ repositories: [] });
    getProjectBranchesListMock.mockResolvedValue(listOf(['main'], { defaultBranch: 'main' }));
    fetchProjectMock.mockResolvedValue({
      name: 'My Project',
      isGithubLinked: false,
      isGitlabLinked: false,
      isJiraLinked: false,
      defaultBranch: 'main',
      securityContext: {
        isCustomized: true,
        updatedAt: '2026-05-20T10:30:00.000Z',
      },
    });

    localStorage.clear();
    hookCache.clear();
  });

  it('exposes the project name from the /project payload after the initial load', async () => {
    const store = buildStore();

    const { result } = renderHook(() => useProjectPageData('p1'), {
      wrapper: wrap(store),
    });

    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.projectName).toBe('My Project');
  });

  it('hydrates projectName synchronously from cache on the second mount (no header skeleton flash on navigation)', async () => {
    const store = buildStore();

    const first = renderHook(() => useProjectPageData('p1'), {
      wrapper: wrap(store),
    });
    await waitFor(() => expect(first.result.current.isReady).toBe(true));
    first.unmount();

    // Navigating to a sibling issue-list page remounts the hook. The project
    // name must be available on the FIRST commit (no async wait) so the page
    // header renders the real name immediately instead of a loading skeleton.
    const second = renderHook(() => useProjectPageData('p1'), {
      wrapper: wrap(store),
    });

    expect(second.result.current.projectName).toBe('My Project');
  });

  it('does not refetch project/repos/branches on a second mount within the cache TTL', async () => {
    const store = buildStore();

    const first = renderHook(() => useProjectPageData('p1'), {
      wrapper: wrap(store),
    });
    await waitFor(() => expect(first.result.current.isReady).toBe(true));
    expect(fetchProjectMock).toHaveBeenCalledTimes(1);
    expect(getProjectBranchesListMock).toHaveBeenCalledTimes(1);
    first.unmount();

    // Navigating to a sibling issue-list page remounts the hook.
    const second = renderHook(() => useProjectPageData('p1'), {
      wrapper: wrap(store),
    });

    // Hydrated synchronously from cache → ready on the first commit, so the
    // page never falls back to the full-page skeleton.
    expect(second.result.current.isReady).toBe(true);

    // No redundant shared calls fired on the second mount.
    await waitFor(() => expect(second.result.current.isReady).toBe(true));
    expect(fetchProjectMock).toHaveBeenCalledTimes(1);
    expect(getProjectBranchesListMock).toHaveBeenCalledTimes(1);
  });

  it('hydrates branch + security-context state from cache on the second mount', async () => {
    const store = buildStore();

    const first = renderHook(() => useProjectPageData('p1'), {
      wrapper: wrap(store),
    });
    await waitFor(() => expect(first.result.current.isReady).toBe(true));
    first.unmount();

    const second = renderHook(() => useProjectPageData('p1'), {
      wrapper: wrap(store),
    });

    expect(second.result.current.securityContextUpdatedAt).toBe(
      '2026-05-20T10:30:00.000Z',
    );
    expect(second.result.current.branches.map((b) => b.name)).toContain('main');
  });

  it('refresh() bypasses the cache and refetches so the realtime/stream path stays authoritative', async () => {
    const store = buildStore();

    const { result } = renderHook(() => useProjectPageData('p1'), {
      wrapper: wrap(store),
    });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(fetchProjectMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.refresh(true);
    });

    expect(fetchProjectMock).toHaveBeenCalledTimes(2);
  });
});

describe('useProjectPageData — isBranchResolved', () => {
  beforeEach(() => {
    fetchProjectMock.mockReset();
    getGithubRepositoriesMock.mockReset();
    getGitlabRepositoriesMock.mockReset();
    getGithubRepositoryBranchesMock.mockReset();
    getProjectBranchesMock.mockReset();
    getArchivedBranchesMock.mockReset();
    getProjectBranchesListMock.mockReset();
    getProjectBranchesListMock.mockResolvedValue(listOf([]));

    getGithubRepositoriesMock.mockResolvedValue({ repositories: [] });
    getGitlabRepositoriesMock.mockResolvedValue({ repositories: [] });
    getProjectBranchesMock.mockResolvedValue({ branches: [] });
    getArchivedBranchesMock.mockResolvedValue({ branches: [] });
    localStorage.clear();
    hookCache.clear();
  });

  // A promise that never settles — stands in for the integration chain
  // (GitHub repos → repo branches → archived branches) still being in flight.
  const pending = () => new Promise(() => {});

  it('is true on the first commit when the branch is already known from localStorage', () => {
    localStorage.setItem('selectedBranch_p1', 'main');
    fetchProjectMock.mockReturnValue(pending());

    const { result } = renderHook(() => useProjectPageData('p1'), {
      wrapper: wrap(buildStore()),
    });

    // Nothing has been fetched yet, but the branch the vulnerability query
    // will be scoped to is already final — the query must not wait.
    expect(result.current.isBranchResolved).toBe(true);
    expect(result.current.isReady).toBe(false);
  });

  it('turns true as soon as the project payload yields a defaultBranch, before the integration chain resolves', async () => {
    fetchProjectMock.mockResolvedValue({
      name: 'My Project',
      isGithubLinked: true,
      isGitlabLinked: false,
      isJiraLinked: false,
      defaultBranch: 'main',
    });
    // The branch list never comes back → loadAllData never reaches 'ready'.
    getProjectBranchesListMock.mockReturnValue(pending());

    const { result } = renderHook(() => useProjectPageData('p1'), {
      wrapper: wrap(buildStore()),
    });

    await waitFor(() => expect(result.current.isBranchResolved).toBe(true));
    expect(result.current.selectedBranch).toBe('main');
    // This is the whole point: the page-level gate is still closed.
    expect(result.current.isReady).toBe(false);
  });

  it('stays false while the chain is pending for a project with no branch to seed from', async () => {
    fetchProjectMock.mockResolvedValue({
      name: 'My Project',
      isGithubLinked: false,
      isGitlabLinked: false,
      isJiraLinked: false,
      // no defaultBranch — nothing to seed selectedBranch with
    });
    getProjectBranchesListMock.mockReturnValue(pending());

    const { result } = renderHook(() => useProjectPageData('p1'), {
      wrapper: wrap(buildStore()),
    });

    await waitFor(() => expect(fetchProjectMock).toHaveBeenCalled());
    expect(result.current.isBranchResolved).toBe(false);
    expect(result.current.isReady).toBe(false);
  });

  it('falls back to isReady for a project that ends up with no branch at all', async () => {
    fetchProjectMock.mockResolvedValue({
      name: 'My Project',
      isGithubLinked: false,
      isGitlabLinked: false,
      isJiraLinked: false,
    });

    const { result } = renderHook(() => useProjectPageData('p1'), {
      wrapper: wrap(buildStore()),
    });

    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.selectedBranch).toBe('');
    // An empty branch is only known to be the final answer once the load ran.
    expect(result.current.isBranchResolved).toBe(true);
  });
});

describe('useProjectPageData — one branch source', () => {
  beforeEach(() => {
    fetchProjectMock.mockReset();
    getGithubRepositoriesMock.mockReset();
    getGitlabRepositoriesMock.mockReset();
    getGithubRepositoryBranchesMock.mockReset();
    getGitlabRepositoryBranchesMock.mockReset();
    getProjectBranchesMock.mockReset();
    getArchivedBranchesMock.mockReset();
    getProjectBranchesListMock.mockReset();
    getProjectBranchesListMock.mockResolvedValue(listOf([]));
    localStorage.clear();
    hookCache.clear();
  });

  const pending = () => new Promise(() => {});
  const linkedProject = (linkedRepository: unknown, extra: Record<string, unknown> = {}) => ({
    name: 'My Project',
    isGithubLinked: true,
    isGitlabLinked: false,
    isJiraLinked: false,
    defaultBranch: 'main',
    linkedRepository,
    ...extra,
  });
  // The same view the branch selector opens on, so both share one request.
  const DEFAULT_VIEW = DEFAULT_BRANCH_LIST_QUERY;

  // The page read the repository branches through an
  // integration route that needs manage_integration (a member got a 403, then
  // a second, serial call to the project branches), plus the archived list,
  // while the branch selector asked /branches/list on its own: 3 to 4 calls
  // per cold load. /branches/list is now the only source.
  it('reads the branches from /branches/list alone, with no integration route', async () => {
    fetchProjectMock.mockResolvedValue(
      linkedProject({ provider: 'github', repositoryId: 'gh-row' }),
    );
    getProjectBranchesListMock.mockResolvedValue(
      listOf(['main', 'dev'], { defaultBranch: 'main' }),
    );

    const { result } = renderHook(() => useProjectPageData('p1'), {
      wrapper: wrap(buildStore()),
    });

    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(getProjectBranchesListMock).toHaveBeenCalledTimes(1);
    expect(getProjectBranchesListMock).toHaveBeenCalledWith('p1', DEFAULT_VIEW);
    expect(getGithubRepositoryBranchesMock).not.toHaveBeenCalled();
    expect(getGithubRepositoriesMock).not.toHaveBeenCalled();
    expect(getGitlabRepositoryBranchesMock).not.toHaveBeenCalled();
    expect(getGitlabRepositoriesMock).not.toHaveBeenCalled();
    expect(getProjectBranchesMock).not.toHaveBeenCalled();
    expect(getArchivedBranchesMock).not.toHaveBeenCalled();
    expect(result.current.branches.map((b) => b.name)).toEqual(['main', 'dev']);
    expect(result.current.defaultBranch).toBe('main');
    expect(result.current.selectedBranch).toBe('main');
    expect(result.current.integrationInfo).toEqual({ type: 'github', repositoryId: 'gh-row' });
    expect(result.current.linkedGithubRepo).toBe('gh-row');
  });

  it('takes the GitLab link from the project payload the same way', async () => {
    fetchProjectMock.mockResolvedValue(
      linkedProject(
        { provider: 'gitlab', repositoryId: 'gl-row' },
        { isGithubLinked: false, isGitlabLinked: true },
      ),
    );
    getProjectBranchesListMock.mockResolvedValue(listOf(['main'], { defaultBranch: 'main' }));

    const { result } = renderHook(() => useProjectPageData('p1'), {
      wrapper: wrap(buildStore()),
    });

    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(getGitlabRepositoriesMock).not.toHaveBeenCalled();
    expect(getGitlabRepositoryBranchesMock).not.toHaveBeenCalled();
    expect(result.current.linkedGitlabRepo).toBe('gl-row');
  });

  it('requests the branch list without waiting for the project', async () => {
    fetchProjectMock.mockReturnValue(pending());

    renderHook(() => useProjectPageData('p1'), {
      wrapper: wrap(buildStore()),
    });

    await waitFor(() => expect(getProjectBranchesListMock).toHaveBeenCalledWith('p1', DEFAULT_VIEW));
  });

  it('exposes the linked repository while the branch list is still loading', async () => {
    fetchProjectMock.mockResolvedValue(
      linkedProject({ provider: 'github', repositoryId: 'gh-row' }),
    );
    getProjectBranchesListMock.mockReturnValue(pending());

    const { result } = renderHook(() => useProjectPageData('p1'), {
      wrapper: wrap(buildStore()),
    });

    await waitFor(() => expect(result.current.linkedGithubRepo).toBe('gh-row'));
    expect(result.current.integrationInfo.type).toBe('github');
    expect(result.current.isLoadingBranches).toBe(true);
  });

  it('keeps a remembered branch found on the first page, without a search', async () => {
    localStorage.setItem('selectedBranch_p1', 'dev');
    fetchProjectMock.mockResolvedValue(linkedProject(null, { isGithubLinked: false }));
    getProjectBranchesListMock.mockResolvedValue(listOf(['main', 'dev'], { defaultBranch: 'main' }));

    const { result } = renderHook(() => useProjectPageData('p1'), {
      wrapper: wrap(buildStore()),
    });

    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.selectedBranch).toBe('dev');
    expect(getProjectBranchesListMock).toHaveBeenCalledTimes(1);
  });

  it('checks a remembered branch that is not on the first page with ?search=', async () => {
    localStorage.setItem('selectedBranch_p1', 'release/2.0');
    fetchProjectMock.mockResolvedValue(linkedProject(null, { isGithubLinked: false }));
    getProjectBranchesListMock.mockImplementation((_p: string, params: { search?: string }) =>
      Promise.resolve(
        params.search
          ? listOf(['release/2.0', 'release/2.0-rc'], { archived: ['release/2.0'] })
          : listOf(['main', 'dev'], { defaultBranch: 'main', hasMore: true }),
      ),
    );

    const { result } = renderHook(() => useProjectPageData('p1'), {
      wrapper: wrap(buildStore()),
    });

    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(getProjectBranchesListMock).toHaveBeenLastCalledWith('p1', {
      search: 'release/2.0',
      page: 1,
      pageSize: 100,
      includeArchived: true,
    });
    expect(result.current.selectedBranch).toBe('release/2.0');
  });

  it('drops a remembered branch the project no longer has', async () => {
    localStorage.setItem('selectedBranch_p1', 'gone');
    fetchProjectMock.mockResolvedValue(linkedProject(null, { isGithubLinked: false }));
    getProjectBranchesListMock.mockImplementation((_p: string, params: { search?: string }) =>
      Promise.resolve(
        params.search
          ? listOf(['gone-too'])
          : listOf(['main', 'dev'], { scanBranch: 'dev', defaultBranch: 'main' }),
      ),
    );

    const { result } = renderHook(() => useProjectPageData('p1'), {
      wrapper: wrap(buildStore()),
    });

    await waitFor(() => expect(result.current.isReady).toBe(true));
    // The scan branch of the repository comes first, as before.
    expect(result.current.selectedBranch).toBe('dev');
    expect(localStorage.getItem('selectedBranch_p1')).toBe('dev');
  });

  it('opens on main, then master, then the first branch when the list names no default', async () => {
    fetchProjectMock.mockResolvedValue(linkedProject(null, { isGithubLinked: false, defaultBranch: '' }));
    getProjectBranchesListMock.mockResolvedValue(listOf(['alpha', 'master']));

    const { result } = renderHook(() => useProjectPageData('p1'), {
      wrapper: wrap(buildStore()),
    });

    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.selectedBranch).toBe('master');
    expect(result.current.defaultBranch).toBe('master');
  });

  it('lets the branch selector reuse the list it loaded, without a second request', async () => {
    fetchProjectMock.mockResolvedValue(linkedProject(null, { isGithubLinked: false }));
    getProjectBranchesListMock.mockResolvedValue(listOf(['main', 'dev'], { defaultBranch: 'main' }));
    const store = buildStore();

    const { result } = renderHook(() => useProjectPageData('p1'), { wrapper: wrap(store) });
    await waitFor(() => expect(result.current.isReady).toBe(true));

    const selector = renderHook(() => useProjectBranchesList('p1'), { wrapper: wrap(store) });

    expect(selector.result.current.branches.map((b) => b.name)).toEqual(['main', 'dev']);
    await act(async () => {
      await Promise.resolve();
    });
    expect(getProjectBranchesListMock).toHaveBeenCalledTimes(1);
  });

  it('reports the branch list as loading until it is loaded', async () => {
    let resolveBranches!: (value: unknown) => void;
    fetchProjectMock.mockResolvedValue(linkedProject(null, { isGithubLinked: false }));
    getProjectBranchesListMock.mockReturnValue(
      new Promise((resolve) => {
        resolveBranches = resolve;
      }),
    );

    const { result } = renderHook(() => useProjectPageData('p1'), {
      wrapper: wrap(buildStore()),
    });

    expect(result.current.isLoadingBranches).toBe(true);
    await waitFor(() => expect(getProjectBranchesListMock).toHaveBeenCalled());
    expect(result.current.isLoadingBranches).toBe(true);

    await act(async () => {
      resolveBranches(listOf(['main'], { defaultBranch: 'main' }));
    });

    expect(result.current.isLoadingBranches).toBe(false);
  });

  it('does not report the branch list as loading when it hydrates from the cache', async () => {
    fetchProjectMock.mockResolvedValue(linkedProject(null, { isGithubLinked: false }));
    getProjectBranchesListMock.mockResolvedValue(listOf(['main'], { defaultBranch: 'main' }));
    const store = buildStore();

    const first = renderHook(() => useProjectPageData('p1'), { wrapper: wrap(store) });
    await waitFor(() => expect(first.result.current.isReady).toBe(true));
    first.unmount();

    const second = renderHook(() => useProjectPageData('p1'), { wrapper: wrap(store) });

    expect(second.result.current.isLoadingBranches).toBe(false);
  });

  it('refetches the list on a forced refresh instead of reusing the cached one', async () => {
    fetchProjectMock.mockResolvedValue(linkedProject(null, { isGithubLinked: false }));
    getProjectBranchesListMock.mockResolvedValue(listOf(['main'], { defaultBranch: 'main' }));

    const { result } = renderHook(() => useProjectPageData('p1'), { wrapper: wrap(buildStore()) });
    await waitFor(() => expect(result.current.isReady).toBe(true));

    getProjectBranchesListMock.mockResolvedValue(listOf(['main', 'new'], { defaultBranch: 'main' }));
    await act(async () => {
      await result.current.refresh(true);
    });

    expect(getProjectBranchesListMock).toHaveBeenCalledTimes(2);
    expect(result.current.branches.map((b) => b.name)).toEqual(['main', 'new']);
  });

  // The default view leaves the archived branches out.
  // When every branch is archived it is empty, and the page would hide its
  // branch selector and offer a ZIP upload for a linked repository. Only
  // then, one request of one archived branch tells that branches exist.
  it('still reports branches when every branch of the project is archived', async () => {
    fetchProjectMock.mockResolvedValue(
      linkedProject({ provider: 'github', repositoryId: 'gh-row' }, { defaultBranch: '' }),
    );
    getProjectBranchesListMock.mockImplementation((_p: string, params: { includeArchived?: boolean }) =>
      Promise.resolve(
        params.includeArchived ? listOf(['old'], { archived: ['old'] }) : listOf([]),
      ),
    );

    const { result } = renderHook(() => useProjectPageData('p1'), { wrapper: wrap(buildStore()) });

    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(getProjectBranchesListMock).toHaveBeenCalledTimes(2);
    expect(getProjectBranchesListMock).toHaveBeenLastCalledWith('p1', {
      search: '',
      page: 1,
      pageSize: 1,
      includeArchived: true,
    });
    expect(result.current.branches.map((b) => b.name)).toEqual(['old']);
    expect(result.current.branches[0].archived).toBe(true);
    expect(result.current.selectedBranch).toBe('old');
  });

  it('asks nothing more when the project has no branch at all', async () => {
    fetchProjectMock.mockResolvedValue(linkedProject(null, { isGithubLinked: false, defaultBranch: '' }));
    getProjectBranchesListMock.mockResolvedValue(listOf([]));

    const { result } = renderHook(() => useProjectPageData('p1'), { wrapper: wrap(buildStore()) });

    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.branches).toEqual([]);
    expect(result.current.selectedBranch).toBe('');
    // The probe answered nothing: 2 requests, never more.
    expect(getProjectBranchesListMock).toHaveBeenCalledTimes(2);
  });

  // A silent refresh (realtime, scan end) whose branch
  // list fails keeps what is on screen, and does not cache an empty list.
  it('keeps the branches and the branch on a silent refresh whose branch list fails', async () => {
    fetchProjectMock.mockResolvedValue(linkedProject(null, { isGithubLinked: false }));
    getProjectBranchesListMock.mockResolvedValue(listOf(['main', 'dev'], { defaultBranch: 'main' }));
    const store = buildStore();

    const { result, unmount } = renderHook(() => useProjectPageData('p1'), { wrapper: wrap(store) });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    act(() => result.current.setSelectedBranch('dev'));

    getProjectBranchesListMock.mockRejectedValue(new Error('gateway timeout'));
    await act(async () => {
      await result.current.refresh(true);
    });

    expect(result.current.branches.map((b) => b.name)).toEqual(['main', 'dev']);
    expect(result.current.defaultBranch).toBe('main');
    expect(result.current.selectedBranch).toBe('dev');

    // The next page of the project still hydrates the branches it had.
    unmount();
    const next = renderHook(() => useProjectPageData('p1'), { wrapper: wrap(store) });
    expect(next.result.current.branches.map((b) => b.name)).toEqual(['main', 'dev']);
  });

  it('lets the page render on the first commit when the branch is already known, while the branch list loads', () => {
    localStorage.setItem('selectedBranch_p1', 'main');
    fetchProjectMock.mockReturnValue(pending());

    const { result } = renderHook(() => useProjectPageData('p1'), {
      wrapper: wrap(buildStore()),
    });

    expect(result.current.isContentReady).toBe(true);
    expect(result.current.isReady).toBe(false);
  });

  it('lets the page render once the project yields the branch, before the branch list is loaded', async () => {
    fetchProjectMock.mockResolvedValue(linkedProject(null, { isGithubLinked: false }));
    getProjectBranchesListMock.mockReturnValue(pending());

    const { result } = renderHook(() => useProjectPageData('p1'), {
      wrapper: wrap(buildStore()),
    });

    expect(result.current.isContentReady).toBe(false);
    await waitFor(() => expect(result.current.isContentReady).toBe(true));
    expect(result.current.isReady).toBe(false);
  });

  it('keeps the page skeleton while no branch is known yet', async () => {
    fetchProjectMock.mockReturnValue(pending());

    const { result } = renderHook(() => useProjectPageData('p1'), {
      wrapper: wrap(buildStore()),
    });

    await waitFor(() => expect(fetchProjectMock).toHaveBeenCalled());
    expect(result.current.isContentReady).toBe(false);
  });
});
