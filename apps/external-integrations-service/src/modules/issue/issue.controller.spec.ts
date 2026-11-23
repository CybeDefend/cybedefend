import { RpcException } from '@nestjs/microservices';
import { status as GrpcStatus } from '@grpc/grpc-js';

import { createLoggerMock } from '../../test-utils/mocks';
import { entitlementsMock } from '../../test-utils/entitlements.mock';
import { GithubIssueService } from '../github/github-issue.service';
import { GitlabIssueService } from '../gitlab/gitlab-issue.service';
import { JiraIssueService } from '../jira/jira-issue.service';
import { IssueController } from './issue.controller';

// The issue services pull the ESM-only Octokit in; this spec injects its own
// doubles, so the modules that import it are replaced (never a virtual mock
// of the package: Jest's module cache is shared in band).
jest.mock('../github/github-issue.service', () => ({
  GithubIssueService: class {},
}));
jest.mock('../gitlab/gitlab-issue.service', () => ({
  GitlabIssueService: class {},
}));
jest.mock('../jira/jira-issue.service', () => ({
  JiraIssueService: class {},
}));

/**
 * The feature gate of issue creation: the entitlements port is asked for the
 * feature key `jira`, automatic issues included (analysis-reporting calls
 * these same RPCs).
 */
describe('IssueController plan gate', () => {
  const ORG = 'org-1';
  let billing: { assertFeatureAllowed: jest.Mock };
  let github: { createIssues: jest.Mock };
  let gitlab: { createIssues: jest.Mock };
  let jira: { createIssues: jest.Mock; linkExistingIssue: jest.Mock };
  let controller: IssueController;

  beforeEach(() => {
    billing = { assertFeatureAllowed: jest.fn().mockResolvedValue(undefined) };
    github = { createIssues: jest.fn().mockResolvedValue({ ok: 'gh' }) };
    gitlab = { createIssues: jest.fn().mockResolvedValue({ ok: 'gl' }) };
    jira = {
      createIssues: jest.fn().mockResolvedValue({ ok: 'jira' }),
      linkExistingIssue: jest.fn().mockResolvedValue({ ok: 'link' }),
    };
    controller = new IssueController(
      github as unknown as GithubIssueService,
      gitlab as unknown as GitlabIssueService,
      jira as unknown as JiraIssueService,
      entitlementsMock({ assertFeatureAllowed: billing.assertFeatureAllowed }),
      createLoggerMock(),
    );
  });

  const denied = () =>
    new RpcException({
      code: GrpcStatus.PERMISSION_DENIED,
      message: 'Feature "jira" is not available on your current plan.',
    });

  it("checks Jira issue creation against the plans' `jira` key", async () => {
    const out = await controller.createJiraIssues({
      organizationId: ORG,
      projectId: 'p1',
    } as any);
    expect(billing.assertFeatureAllowed).toHaveBeenCalledWith(ORG, 'jira');
    expect(out).toEqual({ ok: 'jira' });
  });

  it("checks linking a Jira issue against the plans' `jira` key", async () => {
    const out = await controller.linkJiraIssue({
      organizationId: ORG,
      projectId: 'p1',
      jiraIssueKey: 'SEC-1',
    } as any);
    expect(billing.assertFeatureAllowed).toHaveBeenCalledWith(ORG, 'jira');
    expect(out).toEqual({ ok: 'link' });
  });

  it('never checks the former `jira_issues` key, which no plan disables', async () => {
    await controller.createJiraIssues({ organizationId: ORG } as any);
    await controller.linkJiraIssue({ organizationId: ORG } as any);
    expect(billing.assertFeatureAllowed).not.toHaveBeenCalledWith(
      expect.anything(),
      'jira_issues',
    );
  });

  it('creates no Jira issue when the plan refuses Jira', async () => {
    billing.assertFeatureAllowed.mockRejectedValue(denied());
    await expect(
      controller.createJiraIssues({ organizationId: ORG } as any),
    ).rejects.toBeInstanceOf(RpcException);
    expect(jira.createIssues).not.toHaveBeenCalled();
  });

  it('links no Jira issue when the plan refuses Jira', async () => {
    billing.assertFeatureAllowed.mockRejectedValue(denied());
    await expect(
      controller.linkJiraIssue({ organizationId: ORG } as any),
    ).rejects.toBeInstanceOf(RpcException);
    expect(jira.linkExistingIssue).not.toHaveBeenCalled();
  });

  it('keeps the GitHub and GitLab keys', async () => {
    await controller.createGithubIssues({ organizationId: ORG } as any);
    await controller.createGitlabIssues({ organizationId: ORG } as any);
    expect(billing.assertFeatureAllowed).toHaveBeenNthCalledWith(
      1,
      ORG,
      'github_issues',
    );
    expect(billing.assertFeatureAllowed).toHaveBeenNthCalledWith(
      2,
      ORG,
      'gitlab_issues',
    );
  });
});
