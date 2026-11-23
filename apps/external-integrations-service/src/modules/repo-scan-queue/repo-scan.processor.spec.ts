// The processor imports the real GithubService/GitlabService (for the DI param
// types), which pull in ESM-only octokit packages — mock them as the service
// specs do so this unit test can load them.
jest.mock('@octokit/auth-app', () => ({ createAppAuth: jest.fn() }));
const MockOctokit = jest
  .fn()
  .mockImplementation(() => ({ request: jest.fn() }));
(MockOctokit as any).plugin = jest.fn().mockReturnValue(MockOctokit);
jest.mock('@octokit/rest', () => ({ Octokit: MockOctokit }));
jest.mock('@octokit/plugin-retry', () => ({ retry: jest.fn() }));
jest.mock('@octokit/plugin-throttling', () => ({ throttling: jest.fn() }));
jest.mock('adm-zip', () => {
  const actual = jest.requireActual<any>('adm-zip');
  actual.__esModule = true;
  actual.default = actual;
  return actual;
});

import { RepoScanProcessor } from './repo-scan.processor';
import {
  GithubRepoScanJobData,
  GitlabRepoScanJobData,
} from './repo-scan-job.types';

const githubData: GithubRepoScanJobData = {
  provider: 'github',
  scanId: 'scan-gh',
  projectId: 'proj',
  organizationId: 'org',
  branch: 'main',
  typeScan: 'sast',
  owner: 'CybeDefend',
  repo: 'api-microservices',
  commitSha: 'abc',
  installationId: 1,
};

const gitlabData: GitlabRepoScanJobData = {
  provider: 'gitlab',
  scanId: 'scan-gl',
  projectId: 'proj',
  organizationId: 'org',
  branch: 'main',
  typeScan: 'sast',
  repositoryId: 'repo-uuid',
  commitSha: 'def',
};

describe('RepoScanProcessor', () => {
  let github: {
    runRepoDownloadJob: jest.Mock;
    markScanFailedFromJob: jest.Mock;
  };
  let gitlab: {
    runRepoDownloadJob: jest.Mock;
    markScanFailedFromJob: jest.Mock;
  };
  let processor: RepoScanProcessor;

  beforeEach(() => {
    github = {
      runRepoDownloadJob: jest.fn().mockResolvedValue(undefined),
      markScanFailedFromJob: jest.fn().mockResolvedValue(undefined),
    };
    gitlab = {
      runRepoDownloadJob: jest.fn().mockResolvedValue(undefined),
      markScanFailedFromJob: jest.fn().mockResolvedValue(undefined),
    };
    processor = new RepoScanProcessor(github as any, gitlab as any);
  });

  it('dispatches github jobs to GithubService', async () => {
    await processor.process({ id: 'j', data: githubData } as any);
    expect(github.runRepoDownloadJob).toHaveBeenCalledWith(githubData);
    expect(gitlab.runRepoDownloadJob).not.toHaveBeenCalled();
  });

  it('dispatches gitlab jobs to GitlabService', async () => {
    await processor.process({ id: 'j', data: gitlabData } as any);
    expect(gitlab.runRepoDownloadJob).toHaveBeenCalledWith(gitlabData);
    expect(github.runRepoDownloadJob).not.toHaveBeenCalled();
  });

  it('marks the scan failed on terminal failure (retries exhausted)', async () => {
    await processor.onFailed(
      {
        id: 'j',
        data: githubData,
        opts: { attempts: 3 },
        attemptsMade: 3,
      } as any,
      new Error('boom'),
    );
    expect(github.markScanFailedFromJob).toHaveBeenCalledWith(
      'scan-gh',
      'boom',
    );
  });

  it('routes the terminal-failure mark to the right provider (gitlab)', async () => {
    await processor.onFailed(
      {
        id: 'j',
        data: gitlabData,
        opts: { attempts: 3 },
        attemptsMade: 3,
      } as any,
      new Error('kaboom'),
    );
    expect(gitlab.markScanFailedFromJob).toHaveBeenCalledWith(
      'scan-gl',
      'kaboom',
    );
    expect(github.markScanFailedFromJob).not.toHaveBeenCalled();
  });

  it('waits for the last attempt on an ordinary error', async () => {
    await processor.onFailed(
      {
        id: 'j',
        data: githubData,
        opts: { attempts: 3 },
        attemptsMade: 1,
      } as any,
      new Error('transient'),
    );
    expect(github.markScanFailedFromJob).not.toHaveBeenCalled();
  });

  it('marks the scan failed when BullMQ fails the job for stalling, even on attempt 1', async () => {
    await processor.onFailed(
      {
        id: 'j',
        data: githubData,
        opts: { attempts: 3 },
        attemptsMade: 1,
      } as any,
      new Error('job stalled more than allowable limit'),
    );
    expect(github.markScanFailedFromJob).toHaveBeenCalledWith(
      'scan-gh',
      'job stalled more than allowable limit',
    );
  });

  it('swallows errors from the terminal mark (best-effort)', async () => {
    github.markScanFailedFromJob.mockRejectedValue(new Error('db down'));
    await expect(
      processor.onFailed(
        {
          id: 'j',
          data: githubData,
          opts: { attempts: 3 },
          attemptsMade: 3,
        } as any,
        new Error('boom'),
      ),
    ).resolves.toBeUndefined();
  });
});
