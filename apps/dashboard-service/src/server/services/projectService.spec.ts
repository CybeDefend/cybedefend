import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PRODUCTS } from '@/utils/product';

/** A product space the edition registers besides the Platform: none in the Community Edition. */
const CLOSED_SPACE = PRODUCTS.find((product) => product !== 'appsec');

const mockGet = vi.fn();
const mockPost = vi.fn();
const mockPatch = vi.fn();
const mockDelete = vi.fn();
vi.mock('../api/gatewayAPI', () => ({
  default: {
    get: (...args: any[]) => mockGet(...args),
    post: (...args: any[]) => mockPost(...args),
    patch: (...args: any[]) => mockPatch(...args),
    delete: (...args: any[]) => mockDelete(...args),
  },
  gatewayAPI: {
    get: (...args: any[]) => mockGet(...args),
    post: (...args: any[]) => mockPost(...args),
    patch: (...args: any[]) => mockPatch(...args),
    delete: (...args: any[]) => mockDelete(...args),
  },
}));

import {
  createProjectAndLinkRepository,
  deleteProject,
  fetchProject,
  fetchProjectsForOrganization,
  invalidateProjectCache,
  updateProject,
} from './projectService';

const BASE_PROJECT = {
  projectId: 'proj-1',
  name: 'Test Project',
  teamId: 'team-1',
  teamName: 'Team',
  createdAt: '',
  updatedAt: '',
  parsedBranches: [{ branch: 'master', lastParsedAt: '2026-04-29T09:08:00.000Z' }],
  isGithubLinked: false,
  isGitlabLinked: false,
};

describe('fetchProject', () => {
  beforeEach(() => {
    mockGet.mockReset();
    // The resolved-project TTL cache is process-global, so wipe it between
    // tests so each `fetchProject(...)` actually hits the mocked transport.
    invalidateProjectCache();
  });

  it('maps defaultBranch from API response when present', async () => {
    mockGet.mockResolvedValueOnce({ data: { ...BASE_PROJECT, defaultBranch: 'master' } });
    const project = await fetchProject('proj-1');
    expect(project.defaultBranch).toBe('master');
  });

  it('sets defaultBranch to empty string when API does not return it', async () => {
    mockGet.mockResolvedValueOnce({ data: { ...BASE_PROJECT } });
    const project = await fetchProject('proj-1');
    expect(project.defaultBranch).toBe('');
  });
});

describe('fetchProject — cache afterglow', () => {
  // A project page registered on several tab routes is unmounted and
  // remounted by every tab switch, re-running the fetchProject useEffect
  // every time. Without a
  // TTL cache that produces one GET /project/:id per tab click. The cache
  // here keeps the resolved value reachable for a short window so
  // sibling consumers + remount-on-route-change patterns reuse it.

  beforeEach(() => {
    mockGet.mockReset();
    mockPatch.mockReset();
    mockDelete.mockReset();
    invalidateProjectCache();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('issues a single network request when the same project is fetched twice in a row', async () => {
    mockGet.mockResolvedValue({ data: { ...BASE_PROJECT } });

    await fetchProject('proj-1');
    await fetchProject('proj-1');

    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it('re-fetches once the TTL elapses', async () => {
    vi.useFakeTimers();
    mockGet.mockResolvedValue({ data: { ...BASE_PROJECT } });

    await fetchProject('proj-1');
    expect(mockGet).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(70_000); // > 60 s TTL
    await fetchProject('proj-1');

    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  it('refreshes the cache after updateProject so subsequent fetchProject sees the new value', async () => {
    mockGet.mockResolvedValue({
      data: { ...BASE_PROJECT, name: 'original' },
    });
    mockPatch.mockResolvedValue({
      data: {
        projectInformations: { ...BASE_PROJECT, name: 'patched' },
      },
    });

    await fetchProject('proj-1');
    expect(mockGet).toHaveBeenCalledTimes(1);

    await updateProject('proj-1', { name: 'patched' } as any);

    mockGet.mockResolvedValue({ data: { ...BASE_PROJECT, name: 'patched' } });
    const after = await fetchProject('proj-1');

    expect(mockGet).toHaveBeenCalledTimes(2);
    expect(after.name).toBe('patched');
  });

  it('invalidates the cache after deleteProject', async () => {
    mockGet.mockResolvedValue({ data: { ...BASE_PROJECT } });
    mockDelete.mockResolvedValue({ data: { message: 'deleted' } });

    await fetchProject('proj-1');
    await deleteProject('proj-1');
    await fetchProject('proj-1');

    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  it('exposes invalidateProjectCache(id) for callers that need to bust just one entry', async () => {
    mockGet.mockImplementation((url: string) => {
      const id = url.split('/').pop()!;
      return Promise.resolve({ data: { ...BASE_PROJECT, projectId: id } });
    });

    await fetchProject('proj-1');
    await fetchProject('proj-2');
    const callsBefore = mockGet.mock.calls.length;

    invalidateProjectCache('proj-1');

    await fetchProject('proj-1');
    await fetchProject('proj-2');

    // proj-1 should have triggered a fresh GET; proj-2 must still be cached.
    expect(mockGet.mock.calls.length - callsBefore).toBe(1);
  });

  it('dedupes truly-concurrent calls to the same project (in-flight guard)', async () => {
    let resolveFetch: (value: any) => void = () => {};
    mockGet.mockImplementation(
      () => new Promise((resolve) => (resolveFetch = resolve)),
    );

    const inFlight = [
      fetchProject('proj-1'),
      fetchProject('proj-1'),
      fetchProject('proj-1'),
    ];
    expect(mockGet).toHaveBeenCalledTimes(1);

    resolveFetch({ data: { ...BASE_PROJECT } });
    await Promise.all(inFlight);

    expect(mockGet).toHaveBeenCalledTimes(1);
  });
});

describe('createProjectAndLinkRepository', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
    mockDelete.mockReset();
  });

  it('creates the project and returns it when no repoLink is provided', async () => {
    mockPost.mockResolvedValueOnce({ data: { ...BASE_PROJECT, projectId: 'p-only' } });
    const result = await createProjectAndLinkRepository({
      teamId: 't1',
      projectName: 'Manual Project',
      aiMergeRequestEnabled: true,
      improvingResultsEnabled: true,
      sortsVulnerabilitiesEnabled: true,
      securityChampionEnabled: true,
    });
    expect(result.projectId).toBe('p-only');
    expect(mockPost).toHaveBeenCalledWith('/team/t1/project', expect.objectContaining({
      name: 'Manual Project',
    }));
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it.runIf(CLOSED_SPACE)('sends the product the project is created from', async () => {
    mockPost.mockResolvedValueOnce({ data: { ...BASE_PROJECT, projectId: 'p-vd' } });
    await createProjectAndLinkRepository({ teamId: 't1', projectName: 'VD', product: CLOSED_SPACE });
    expect(mockPost).toHaveBeenCalledWith('/team/t1/project', expect.objectContaining({ product: CLOSED_SPACE }));
  });

  it('sends no product when none is given', async () => {
    mockPost.mockResolvedValueOnce({ data: { ...BASE_PROJECT, projectId: 'p-none' } });
    await createProjectAndLinkRepository({ teamId: 't1', projectName: 'None' });
    expect(mockPost.mock.calls[0][1]).not.toHaveProperty('product');
  });

  it('forwards securityContext to the create payload when provided', async () => {
    mockPost.mockResolvedValueOnce({ data: { ...BASE_PROJECT, projectId: 'p-ctx' } });
    await createProjectAndLinkRepository({
      teamId: 't1',
      projectName: 'WithCtx',
      securityContext: { handlesPii: true } as any,
    });
    expect(mockPost).toHaveBeenCalledWith(
      '/team/t1/project',
      expect.objectContaining({ securityContext: { handlesPii: true } }),
    );
  });

  it('calls the link callback after creation when repoLink is provided', async () => {
    mockPost.mockResolvedValueOnce({ data: { ...BASE_PROJECT, projectId: 'p-linked' } });
    const link = vi.fn().mockResolvedValue(undefined);
    const result = await createProjectAndLinkRepository({
      teamId: 't1',
      projectName: 'Linked',
      repoLink: { repositoryId: 'repo-42', link },
    });
    expect(result.projectId).toBe('p-linked');
    expect(link).toHaveBeenCalledWith('p-linked', 'repo-42');
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('rolls back the created project when the link callback fails', async () => {
    mockPost.mockResolvedValueOnce({ data: { ...BASE_PROJECT, projectId: 'p-rollback' } });
    mockDelete.mockResolvedValueOnce({ data: { success: true } });
    const linkError = new Error('link failed');
    const link = vi.fn().mockRejectedValue(linkError);

    await expect(
      createProjectAndLinkRepository({
        teamId: 't1',
        projectName: 'Rollback',
        repoLink: { repositoryId: 'repo-99', link },
      }),
    ).rejects.toBe(linkError);

    expect(mockDelete).toHaveBeenCalledWith('/project/p-rollback');
  });

  it('still throws the original link error even when the rollback delete fails', async () => {
    mockPost.mockResolvedValueOnce({ data: { ...BASE_PROJECT, projectId: 'p-rb-fail' } });
    mockDelete.mockRejectedValueOnce(new Error('delete failed'));
    const linkError = new Error('link failed');
    const link = vi.fn().mockRejectedValue(linkError);

    await expect(
      createProjectAndLinkRepository({
        teamId: 't1',
        projectName: 'RollbackFail',
        repoLink: { repositoryId: 'repo-7', link },
      }),
    ).rejects.toBe(linkError);
  });

  // CD-SAST-1269: the format string is a constant; the id travels as an argument.
  it('logs a failed rollback with a constant format string', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      mockPost.mockResolvedValueOnce({ data: { ...BASE_PROJECT, projectId: 'p-rb-log' } });
      mockDelete.mockRejectedValueOnce(new Error('delete failed'));
      const link = vi.fn().mockRejectedValue(new Error('link failed'));

      await expect(
        createProjectAndLinkRepository({
          teamId: 't1',
          projectName: 'RollbackLog',
          repoLink: { repositoryId: 'repo-8', link },
        }),
      ).rejects.toThrow('link failed');

      expect(consoleError).toHaveBeenCalledWith(
        'Rollback delete failed for project %s:',
        'p-rb-log',
        expect.anything(),
      );
    } finally {
      consoleError.mockRestore();
    }
  });
});

describe('fetchProjectsForOrganization', () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  it('deduplicates concurrent identical requests into a single HTTP call', async () => {
    mockGet.mockResolvedValue({ data: { projects: [], totalPages: 1 } });

    await Promise.all([
      fetchProjectsForOrganization('org-1', 1, 10, ''),
      fetchProjectsForOrganization('org-1', 1, 10, ''),
      fetchProjectsForOrganization('org-1', 1, 10, ''),
    ]);

    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it('issues a fresh HTTP call once the in-flight request has settled', async () => {
    mockGet.mockResolvedValue({ data: { projects: [], totalPages: 1 } });

    await fetchProjectsForOrganization('org-1', 1, 10, '');
    await fetchProjectsForOrganization('org-1', 1, 10, '');

    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  it('does not deduplicate requests that differ by page', async () => {
    mockGet.mockResolvedValue({ data: { projects: [], totalPages: 2 } });

    await Promise.all([
      fetchProjectsForOrganization('org-1', 1, 10, ''),
      fetchProjectsForOrganization('org-1', 2, 10, ''),
    ]);

    expect(mockGet).toHaveBeenCalledTimes(2);
  });
});
