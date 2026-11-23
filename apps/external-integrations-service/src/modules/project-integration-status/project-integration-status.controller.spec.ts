// The service's GitHub / GitLab dependencies pull the ESM-only Octokit
// packages; the controller never reaches them.
jest.mock('../github/github.service', () => ({
  GithubService: class GithubService {},
}));
jest.mock('../gitlab/gitlab.service', () => ({
  GitlabService: class GitlabService {},
}));

import { ProjectIntegrationStatusController } from './project-integration-status.controller';
import { ProjectIntegrationStatusService } from './project-integration-status.service';

describe('ProjectIntegrationStatusController', () => {
  // The controller copies the batch entries field by field: a field the
  // service returns but the copy leaves out never reaches global-management.
  it("forwards each project's git default branch in the batch answer", async () => {
    const service = {
      getBatchProjectIntegrationLinkStatus: jest.fn().mockResolvedValue({
        statuses: [
          {
            projectId: 'p1',
            isGithubLinked: true,
            isGitlabLinked: false,
            defaultBranch: 'main',
          },
        ],
        isJiraLinked: false,
        isLinearLinked: false,
      }),
    } as unknown as ProjectIntegrationStatusService;
    const controller = new ProjectIntegrationStatusController(service);

    const answer = await controller.getBatchProjectIntegrationLinkStatus({
      organizationId: 'org1',
      projectIds: ['p1'],
    });

    expect(answer.statuses).toEqual([
      {
        projectId: 'p1',
        isGithubLinked: true,
        isGitlabLinked: false,
        defaultBranch: 'main',
      },
    ]);
  });

  // The controller builds its answers itself (the batch one field by
  // field), so a flag the service computes but the copy leaves out never
  // reaches global-management.
  it('copies isLinearLinked from the service into the single answer', async () => {
    const status = {
      isGithubLinked: false,
      isGitlabLinked: false,
      isJiraLinked: false,
      isLinearLinked: true,
      defaultBranch: '',
      linkedRepository: undefined,
    };
    const service = {
      getProjectIntegrationLinkStatus: jest.fn().mockResolvedValue(status),
    } as unknown as ProjectIntegrationStatusService;
    const controller = new ProjectIntegrationStatusController(service);

    const answer = await controller.getProjectIntegrationLinkStatus({
      projectId: 'p1',
      organizationId: 'org1',
    });

    expect(answer.isLinearLinked).toBe(true);
    expect(answer.isJiraLinked).toBe(false);
  });

  it('copies isLinearLinked from the service into the batch answer', async () => {
    const service = {
      getBatchProjectIntegrationLinkStatus: jest.fn().mockResolvedValue({
        statuses: [],
        isJiraLinked: false,
        isLinearLinked: true,
      }),
    } as unknown as ProjectIntegrationStatusService;
    const controller = new ProjectIntegrationStatusController(service);

    const answer = await controller.getBatchProjectIntegrationLinkStatus({
      organizationId: 'org1',
      projectIds: [],
    });

    expect(answer.isLinearLinked).toBe(true);
    expect(answer.isJiraLinked).toBe(false);
  });

  it('answers ResolveScanBranch with the branch the service resolved', async () => {
    const service = {
      resolveScanBranch: jest.fn().mockResolvedValue('develop'),
    } as unknown as ProjectIntegrationStatusService;
    const controller = new ProjectIntegrationStatusController(service);

    const answer = await controller.resolveScanBranch({
      projectId: 'p1',
      branch: '',
      referenceBranch: 'develop',
    });

    expect(service.resolveScanBranch).toHaveBeenCalledWith({
      projectId: 'p1',
      branch: '',
      referenceBranch: 'develop',
    });
    expect(answer).toEqual({ branch: 'develop' });
  });
});
