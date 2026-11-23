import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PRODUCTS } from '@/utils/product';

/** A product space the edition registers besides the Platform: none in the Community Edition. */
const CLOSED_SPACE = PRODUCTS.find((product) => product !== 'appsec');

const h = vi.hoisted(() => ({
  state: { organization: { selectedOrganization: { id: 'org-1' } as { id: string } | null } },
  startScan: vi.fn(),
  uploadFileToSignedUrl: vi.fn(),
  startGithub: vi.fn(),
  startGitlab: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('react-redux', () => ({
  useSelector: (selector: (state: unknown) => unknown) => selector(h.state),
}));
vi.mock('@/server/services/scanService', () => ({
  default: { startScan: h.startScan, uploadFileToSignedUrl: h.uploadFileToSignedUrl },
}));
vi.mock('@/server/services/integrations/githubIntegrationsService', () => ({
  startScanForLastCommitAndProject: h.startGithub,
}));
vi.mock('@/server/services/integrations/gitlabIntegrationsService', () => ({
  startScanForLastCommitAndProjectGitlab: h.startGitlab,
}));

import {
  startAnalysisRefusal,
  useStartAnalysis,
  type StartAnalysisFailure,
  type UseStartAnalysisOptions,
} from './useStartAnalysis';

const GITHUB = { type: 'github', repositoryId: 'repo-1' } as const;
const GITLAB = { type: 'gitlab', repositoryId: 'repo-2' } as const;
const archive = new File(['zip'], 'source.zip', { type: 'application/zip' });

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const events = () => ({
  onStart: vi.fn(),
  onUploadStart: vi.fn(),
  onStarted: vi.fn(),
  onError: vi.fn<(failure: StartAnalysisFailure) => void>(),
});

/** `null` stands for a page whose URL carries no project id. */
const mount = (options: UseStartAnalysisOptions = {}, projectId: string | null = 'p1') =>
  renderHook((current: UseStartAnalysisOptions) => useStartAnalysis(projectId ?? undefined, current), {
    initialProps: options,
  });

beforeEach(() => {
  h.state.organization = { selectedOrganization: { id: 'org-1' } };
  h.startScan.mockReset().mockResolvedValue({ url: 'https://storage.test/upload', scanId: 'scan-archive' });
  h.uploadFileToSignedUrl.mockReset().mockResolvedValue(undefined);
  h.startGithub.mockReset().mockResolvedValue({ scanId: 'scan-github' });
  h.startGitlab.mockReset().mockResolvedValue({ scanId: 'scan-gitlab' });
});

describe('useStartAnalysis — the modal', () => {
  it('is closed at first, opens, and closes', () => {
    const { result } = mount();
    expect(result.current.isOpen).toBe(false);

    act(() => result.current.open());
    expect(result.current.isOpen).toBe(true);

    act(() => result.current.close());
    expect(result.current.isOpen).toBe(false);
  });

  it('drops the chosen file and the errors on close, and keeps the branch name', async () => {
    const { result } = mount();
    act(() => result.current.open());
    act(() => result.current.setManualBranchName('release'));
    await act(() => result.current.submit());
    expect(result.current.errors.file).toBe('components.fileInput.error.zipOnly');

    act(() => result.current.setSelectedFile(archive));
    act(() => result.current.close());
    expect(result.current.errors).toEqual({});
    expect(result.current.manualBranchName).toBe('release');

    // The file is gone: a new submit asks for one again.
    act(() => result.current.open());
    await act(() => result.current.submit());
    expect(result.current.errors.file).toBe('components.fileInput.error.zipOnly');
    expect(h.startScan).not.toHaveBeenCalled();
  });
});

describe('useStartAnalysis — which path a submit takes', () => {
  it('uploads an archive when the project has no repository', () => {
    expect(mount().result.current.mode).toBe('archive');
    expect(mount({ repository: null }).result.current.mode).toBe('archive');
    expect(mount({ repository: { type: 'none', repositoryId: null } }).result.current.mode).toBe('archive');
  });

  it('starts on the repository when one is linked', () => {
    expect(mount({ repository: GITHUB }).result.current.mode).toBe('repository');
    expect(mount({ repository: GITLAB }).result.current.mode).toBe('repository');
  });

  it('needs the repository id when no branch is to be picked', () => {
    expect(mount({ repository: { type: 'github', repositoryId: null } }).result.current.mode).toBe('archive');
  });

  it('follows the branch picker of a results page: no branch listed, no repository start', () => {
    expect(mount({ repository: GITHUB, branch: { available: 0, selected: '' } }).result.current.mode).toBe('archive');
    expect(mount({ repository: GITHUB, branch: { available: 2, selected: 'main' } }).result.current.mode).toBe('repository');
  });
});

describe('useStartAnalysis — starting on the linked repository', () => {
  it('starts on the last commit of a GitHub repository, with the organisation it belongs to', async () => {
    const on = events();
    const { result } = mount({ repository: GITHUB, ...on });
    act(() => result.current.open());

    await act(() => result.current.submit());

    expect(h.startGithub).toHaveBeenCalledTimes(1);
    expect(h.startGithub).toHaveBeenCalledWith('p1', 'repo-1', 'org-1');
    expect(h.startScan).not.toHaveBeenCalled();
    expect(on.onStart).toHaveBeenCalledWith('repository');
    expect(on.onStarted).toHaveBeenCalledWith('scan-github', 'repository');
    expect(on.onUploadStart).not.toHaveBeenCalled();
    expect(on.onError).not.toHaveBeenCalled();
    expect(result.current.isOpen).toBe(false);
    expect(result.current.phase).toBe('idle');
  });

  it('starts a GitLab repository through its own call', async () => {
    const on = events();
    const { result } = mount({ repository: GITLAB, ...on });

    await act(() => result.current.submit());

    expect(h.startGitlab).toHaveBeenCalledWith('p1', 'repo-2');
    expect(h.startGithub).not.toHaveBeenCalled();
    expect(on.onStarted).toHaveBeenCalledWith('scan-gitlab', 'repository');
  });

  it('sends the branch a results page picked', async () => {
    const { result: github } = mount({ repository: GITHUB, branch: { available: 2, selected: 'develop' } });
    await act(() => github.current.submit());
    expect(h.startGithub).toHaveBeenCalledWith('p1', 'repo-1', 'org-1', 'develop');

    const { result: gitlab } = mount({ repository: GITLAB, branch: { available: 2, selected: 'develop' } });
    await act(() => gitlab.current.submit());
    expect(h.startGitlab).toHaveBeenCalledWith('p1', 'repo-2', 'develop');
  });

  it('asks for a branch when the picker holds none, and starts nothing', async () => {
    const on = events();
    const { result } = mount({ repository: GITHUB, branch: { available: 2, selected: '' }, ...on });
    act(() => result.current.open());

    await act(() => result.current.submit());

    expect(result.current.errors).toEqual({ file: 'components.branchSelector.selectBranch' });
    expect(result.current.isOpen).toBe(true);
    expect(h.startGithub).not.toHaveBeenCalled();
    expect(on.onStart).not.toHaveBeenCalled();
  });

  it('is « creating » while the request is out, and never « uploading »', async () => {
    const pending = deferred<{ scanId: string }>();
    h.startGithub.mockReturnValue(pending.promise);
    const { result } = mount({ repository: GITHUB });

    let submitted!: Promise<void>;
    act(() => {
      submitted = result.current.submit();
    });
    expect(result.current.phase).toBe('creating');
    expect(result.current.isStarting).toBe(true);
    expect(result.current.isStartingArchive).toBe(false);
    expect(result.current.isUploading).toBe(false);

    await act(async () => {
      pending.resolve({ scanId: 'scan-github' });
      await submitted;
    });
    expect(result.current.phase).toBe('idle');
    expect(result.current.isStarting).toBe(false);
  });

  it.each([
    [{ scanId: 'a' }, 'a'],
    [{ scan_id: 'b' }, 'b'],
    [{ id: 'c' }, 'c'],
    [{ scanId: '   ' }, undefined],
    [{ scanId: 42 }, undefined],
    [undefined, undefined],
  ])('reads the analysis id out of %j', async (response, expected) => {
    h.startGithub.mockResolvedValue(response);
    const on = events();
    const { result } = mount({ repository: GITHUB, ...on });

    await act(() => result.current.submit());

    expect(on.onStarted).toHaveBeenCalledWith(expected, 'repository');
  });

  it('fails, without a request, when the page says « linked » but holds no repository id', async () => {
    const on = events();
    const { result } = mount({
      repository: { type: 'github', repositoryId: null },
      branch: { available: 1, selected: 'main' },
      ...on,
    });

    await act(() => result.current.submit());

    expect(h.startGithub).not.toHaveBeenCalled();
    expect(on.onError).toHaveBeenCalledTimes(1);
    const failure = on.onError.mock.calls[0][0];
    expect(failure.kind).toBe('repository');
    // A translated sentence: the results pages show this message as it is.
    expect((failure.error as Error).message).toBe('components.startAnalysis.errors.noRepository');
  });
});

describe('useStartAnalysis — starting from an archive', () => {
  it('asks for a file and for a branch name before anything leaves', async () => {
    const on = events();
    const { result } = mount(on);
    act(() => result.current.open());
    act(() => result.current.setManualBranchName('  '));

    await act(() => result.current.submit());

    expect(result.current.errors).toEqual({
      file: 'components.fileInput.error.zipOnly',
      branchName: 'components.analyseWrapper.branchNameRequired',
    });
    expect(result.current.isOpen).toBe(true);
    expect(h.startScan).not.toHaveBeenCalled();
    expect(on.onStart).not.toHaveBeenCalled();
  });

  it('creates the analysis, then uploads the archive, reporting each stage', async () => {
    const created = deferred<{ url: string; scanId: string }>();
    const uploaded = deferred<void>();
    h.startScan.mockReturnValue(created.promise);
    h.uploadFileToSignedUrl.mockReturnValue(uploaded.promise);
    const on = events();
    const { result } = mount(on);
    expect(result.current.manualBranchName).toBe('main');
    act(() => result.current.open());
    act(() => result.current.setManualBranchName('release'));
    act(() => result.current.setSelectedFile(archive));

    let submitted!: Promise<void>;
    act(() => {
      submitted = result.current.submit();
    });
    expect(result.current.isOpen).toBe(false);
    expect(h.startScan).toHaveBeenCalledWith('p1', { branch: 'release' });
    expect(on.onStart).toHaveBeenCalledWith('archive');
    expect(result.current.phase).toBe('creating');
    expect(result.current.isStartingArchive).toBe(true);
    expect(result.current.isUploading).toBe(false);
    expect(on.onUploadStart).not.toHaveBeenCalled();

    await act(async () => {
      created.resolve({ url: 'https://storage.test/upload', scanId: 'scan-archive' });
      await Promise.resolve();
    });
    expect(h.uploadFileToSignedUrl).toHaveBeenCalledWith('https://storage.test/upload', archive, expect.any(Function));
    expect(on.onUploadStart).toHaveBeenCalledTimes(1);
    expect(result.current.phase).toBe('uploading');
    expect(result.current.isUploading).toBe(true);
    expect(result.current.uploadProgress).toBe(0);

    const onProgress = h.uploadFileToSignedUrl.mock.calls[0][2] as (event: { loaded: number; total: number }) => void;
    act(() => onProgress({ loaded: 1, total: 3 }));
    expect(result.current.uploadProgress).toBe(33);
    expect(on.onStarted).not.toHaveBeenCalled();

    await act(async () => {
      uploaded.resolve();
      await submitted;
    });
    expect(on.onStarted).toHaveBeenCalledWith('scan-archive', 'archive');
    expect(result.current.phase).toBe('idle');
    expect(result.current.isStartingArchive).toBe(false);
    expect(result.current.uploadProgress).toBe(0);
  });

  it('falls back on « main » for a branch name that was never touched', async () => {
    const { result } = mount();
    act(() => result.current.setSelectedFile(archive));
    await act(() => result.current.submit());
    expect(h.startScan).toHaveBeenCalledWith('p1', { branch: 'main' });
  });

  // From the closed product space, the archive is sent with that space's product.
  it.runIf(CLOSED_SPACE)('sends the product of the analysis with the archive', async () => {
    const { result } = mount({ product: CLOSED_SPACE });
    act(() => result.current.setSelectedFile(archive));
    await act(() => result.current.submit());
    expect(h.startScan).toHaveBeenCalledWith('p1', { branch: 'main', product: CLOSED_SPACE });
  });

  it('starts nothing without a project', async () => {
    const on = events();
    const { result } = mount(on, null);
    act(() => result.current.setSelectedFile(archive));

    await act(() => result.current.submit());

    expect(h.startScan).not.toHaveBeenCalled();
    expect(on.onStart).not.toHaveBeenCalled();
    expect(on.onError).not.toHaveBeenCalled();
  });

  it('refuses, on request, to start while no organisation is selected', async () => {
    h.state.organization = { selectedOrganization: null };
    const strict = events();
    const { result: withGuard } = mount({ requireOrganization: true, ...strict });
    act(() => withGuard.current.setSelectedFile(archive));
    await act(() => withGuard.current.submit());

    expect(h.startScan).not.toHaveBeenCalled();
    expect(strict.onStart).not.toHaveBeenCalled();
    expect((strict.onError.mock.calls[0][0].error as Error).message).toBe(
      'components.startAnalysis.errors.noOrganization',
    );

    const lenient = events();
    const { result: withoutGuard } = mount(lenient);
    act(() => withoutGuard.current.setSelectedFile(archive));
    await act(() => withoutGuard.current.submit());

    expect(h.startScan).toHaveBeenCalledTimes(1);
    expect(lenient.onStarted).toHaveBeenCalledWith('scan-archive', 'archive');
  });
});

describe('useStartAnalysis — a refused start', () => {
  it('reports the refusal, with the error, and is ready for another start', async () => {
    const refusal = { response: { status: 429, data: { message: 'Scan quota exceeded' } } };
    h.startGithub.mockRejectedValueOnce(refusal);
    const on = events();
    const { result } = mount({ repository: GITHUB, ...on });

    await act(() => result.current.submit());

    expect(on.onStarted).not.toHaveBeenCalled();
    expect(on.onError).toHaveBeenCalledWith({ kind: 'repository', refusal: 'too_many_requests', error: refusal });
    expect(result.current.phase).toBe('idle');

    await act(() => result.current.submit());
    expect(h.startGithub).toHaveBeenCalledTimes(2);
    expect(on.onStarted).toHaveBeenCalledWith('scan-github', 'repository');
  });

  it('reports an upload that failed after the analysis was created', async () => {
    h.uploadFileToSignedUrl.mockRejectedValue({ response: { status: 413 } });
    const on = events();
    const { result } = mount(on);
    act(() => result.current.setSelectedFile(archive));

    await act(() => result.current.submit());

    expect(on.onUploadStart).toHaveBeenCalledTimes(1);
    expect(on.onStarted).not.toHaveBeenCalled();
    expect(on.onError.mock.calls[0][0]).toMatchObject({ kind: 'archive', refusal: 'archive_too_large' });
    expect(result.current.phase).toBe('idle');
    expect(result.current.isUploading).toBe(false);
    expect(result.current.uploadProgress).toBe(0);
  });

  it.each([
    [409, 'already_running'],
    [429, 'too_many_requests'],
    [403, 'not_allowed'],
    [413, 'archive_too_large'],
    [500, 'failed'],
    [400, 'failed'],
  ])('reads HTTP %i as « %s »', (status, expected) => {
    expect(startAnalysisRefusal({ response: { status, data: { message: 'whatever the backend wrote' } } })).toBe(expected);
  });

  it.each([
    ['GRAPH_ONLY_PROJECT_BUSY', 'graph_only_project_busy'],
    ['GRAPH_ONLY_ORG_LIMIT', 'graph_only_org_limit'],
  ])('reads a 429 carrying %s as « %s »', (code, expected) => {
    expect(startAnalysisRefusal({ response: { status: 429, data: { code, message: 'x' } } })).toBe(expected);
  });

  it('reads a graph-only code on another status as that status only', () => {
    expect(startAnalysisRefusal({ response: { status: 409, data: { code: 'GRAPH_ONLY_ORG_LIMIT' } } })).toBe(
      'already_running',
    );
    expect(startAnalysisRefusal({ response: { status: 429, data: { code: 'SOMETHING' } } })).toBe('too_many_requests');
  });

  it('reads anything else as a plain failure', () => {
    expect(startAnalysisRefusal(new Error('Network Error'))).toBe('failed');
    expect(startAnalysisRefusal(undefined)).toBe('failed');
    expect(startAnalysisRefusal(null)).toBe('failed');
    expect(startAnalysisRefusal('409')).toBe('failed');
    expect(startAnalysisRefusal({ response: { status: '409' } })).toBe('failed');
  });
});

describe('useStartAnalysis — a double click', () => {
  it('starts one analysis when the button is hit twice before the modal has closed', async () => {
    const pending = deferred<{ scanId: string }>();
    h.startGithub.mockReturnValue(pending.promise);
    const on = events();
    const { result } = mount({ repository: GITHUB, ...on });
    act(() => result.current.open());

    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      // Same render, same closure: what two clicks in a row reach.
      const { submit } = result.current;
      first = submit();
      second = submit();
    });

    await act(async () => {
      pending.resolve({ scanId: 'scan-github' });
      await Promise.all([first, second]);
    });
    expect(h.startGithub).toHaveBeenCalledTimes(1);
    expect(on.onStart).toHaveBeenCalledTimes(1);
    expect(on.onStarted).toHaveBeenCalledTimes(1);
  });

  it('ignores a submit while an archive is still being uploaded', async () => {
    const uploaded = deferred<void>();
    h.uploadFileToSignedUrl.mockReturnValue(uploaded.promise);
    const { result } = mount();
    act(() => result.current.setSelectedFile(archive));

    let first!: Promise<void>;
    act(() => {
      first = result.current.submit();
    });
    await act(async () => {
      await Promise.resolve();
    });

    // The modal was reopened and a file chosen again while the first upload runs.
    act(() => result.current.open());
    act(() => result.current.setSelectedFile(archive));
    await act(() => result.current.submit());
    expect(h.startScan).toHaveBeenCalledTimes(1);

    await act(async () => {
      uploaded.resolve();
      await first;
    });
    expect(h.startScan).toHaveBeenCalledTimes(1);
  });
});

describe('useStartAnalysis — callbacks', () => {
  it('calls the callbacks of the latest render', async () => {
    const pending = deferred<{ scanId: string }>();
    h.startGithub.mockReturnValue(pending.promise);
    const stale = events();
    const fresh = events();
    const { result, rerender } = mount({ repository: GITHUB, ...stale });

    let submitted!: Promise<void>;
    act(() => {
      submitted = result.current.submit();
    });
    rerender({ repository: GITHUB, ...fresh });

    await act(async () => {
      pending.resolve({ scanId: 'scan-github' });
      await submitted;
    });
    expect(stale.onStarted).not.toHaveBeenCalled();
    expect(fresh.onStarted).toHaveBeenCalledWith('scan-github', 'repository');
  });
});
