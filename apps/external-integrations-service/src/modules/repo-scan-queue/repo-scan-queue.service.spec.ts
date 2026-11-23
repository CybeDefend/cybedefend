import { RepoScanQueueService } from './repo-scan-queue.service';
import { GithubRepoScanJobData } from './repo-scan-job.types';

describe('RepoScanQueueService', () => {
  let queue: { add: jest.Mock; getJobCounts: jest.Mock };
  let service: RepoScanQueueService;

  beforeEach(() => {
    queue = {
      add: jest.fn().mockResolvedValue(undefined),
      getJobCounts: jest.fn(),
    };
    service = new RepoScanQueueService(queue as any);
  });

  it('enqueues a repo-scan job keyed by scanId (idempotent retrigger)', async () => {
    const data: GithubRepoScanJobData = {
      provider: 'github',
      scanId: 'scan-1',
      projectId: 'proj',
      organizationId: 'org',
      branch: 'main',
      typeScan: 'sast,sca',
      owner: 'CybeDefend',
      repo: 'api-microservices',
      commitSha: 'deadbeef',
      installationId: 42,
    };

    await service.enqueueRepoScan(data);

    expect(queue.add).toHaveBeenCalledWith('repo-scan', data, {
      jobId: 'scan-1',
    });
  });

  it('maps BullMQ job counts into pending/backlog stats', async () => {
    queue.getJobCounts.mockResolvedValue({
      wait: 2,
      prioritized: 1,
      delayed: 1,
      active: 3,
    });

    const res = await service.getQueueBacklog();

    expect(res.queues.repoScan).toEqual({
      waiting: 2,
      prioritized: 1,
      delayed: 1,
      active: 3,
      pending: 4, // wait + prioritized + delayed
      backlog: 7, // pending + active
    });
    expect(res.totals).toEqual({ pending: 4, active: 3, backlog: 7 });
    expect(queue.getJobCounts).toHaveBeenCalledWith(
      'wait',
      'prioritized',
      'delayed',
      'active',
    );
  });

  it('treats missing count keys as zero', async () => {
    queue.getJobCounts.mockResolvedValue({ wait: 5 });

    const res = await service.getQueueBacklog();

    expect(res.queues.repoScan).toEqual({
      waiting: 5,
      prioritized: 0,
      delayed: 0,
      active: 0,
      pending: 5,
      backlog: 5,
    });
  });
});
