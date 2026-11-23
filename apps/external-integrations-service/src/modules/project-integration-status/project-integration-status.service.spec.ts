// GithubService / GitlabService are only DI tokens here; their real modules
// pull the ESM-only Octokit packages, which this spec never needs.
jest.mock('../github/github.service', () => ({
  GithubService: class GithubService {},
}));
jest.mock('../gitlab/gitlab.service', () => ({
  GitlabService: class GitlabService {},
}));

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Not, IsNull, Like } from 'typeorm';
import { status } from '@grpc/grpc-js';
import { GithubRepository } from '../../entities/github-repository.entity';
import { GitlabRepository } from '../../entities/gitlab-repository.entity';
import { JiraIntegration } from '../../entities/jira-integration.entity';
import { LinearIntegration } from '../../entities/linear-integration.entity';
import { createLoggerMock, createMockRepository } from '../../test-utils/mocks';
import { Logger } from 'nestjs-pino';
import {
  ProjectIntegrationStatusService,
  REFERENCE_BRANCH_CHECK_TIMEOUT_MS,
} from './project-integration-status.service';
import { GithubService } from '../github/github.service';
import { GitlabService } from '../gitlab/gitlab.service';

async function buildService(): Promise<{
  service: ProjectIntegrationStatusService;
  githubRepo: any;
  gitlabRepo: any;
  jiraRepo: any;
  linearRepo: any;
  githubService: { findBranch: jest.Mock };
  gitlabService: { findBranch: jest.Mock };
}> {
  const githubRepo = createMockRepository<GithubRepository>();
  const gitlabRepo = createMockRepository<GitlabRepository>();
  const jiraRepo = createMockRepository<JiraIntegration>();
  // Linear is org-scoped like Jira: no installation unless a test says so.
  const linearRepo = createMockRepository<LinearIntegration>();
  (linearRepo.findOne as jest.Mock).mockResolvedValue(null);
  const githubService = { findBranch: jest.fn() };
  const gitlabService = { findBranch: jest.fn() };
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      ProjectIntegrationStatusService,
      { provide: getRepositoryToken(GithubRepository), useValue: githubRepo },
      { provide: getRepositoryToken(GitlabRepository), useValue: gitlabRepo },
      { provide: getRepositoryToken(JiraIntegration), useValue: jiraRepo },
      {
        provide: getRepositoryToken(LinearIntegration),
        useValue: linearRepo,
      },
      { provide: Logger, useValue: createLoggerMock() },
      { provide: GithubService, useValue: githubService },
      { provide: GitlabService, useValue: gitlabService },
    ],
  }).compile();
  const service = module.get(ProjectIntegrationStatusService);
  return {
    service,
    githubRepo,
    gitlabRepo,
    jiraRepo,
    linearRepo,
    githubService,
    gitlabService,
  };
}

describe('ProjectIntegrationStatusService', () => {
  describe('getProjectIntegrationLinkStatus', () => {
    it('returns all three flags as true when every linkage exists', async () => {
      const { service, githubRepo, gitlabRepo, jiraRepo } =
        await buildService();
      (githubRepo.findOne as jest.Mock).mockResolvedValue({
        id: 'gh',
        projectId: 'p1',
      });
      (gitlabRepo.findOne as jest.Mock).mockResolvedValue({
        id: 'gl',
        projectId: 'p1',
      });
      (jiraRepo.findOne as jest.Mock).mockResolvedValue({
        id: 'j1',
        organizationId: 'org1',
      });

      const result = await service.getProjectIntegrationLinkStatus({
        projectId: 'p1',
        organizationId: 'org1',
      });

      expect(result).toEqual({
        isGithubLinked: true,
        isGitlabLinked: true,
        isJiraLinked: true,
        isLinearLinked: false,
        defaultBranch: '',
        linkedRepository: { provider: 'github', repositoryId: 'gh' },
      });
      expect(githubRepo.findOne).toHaveBeenCalledWith({
        where: { projectId: 'p1' },
      });
      expect(gitlabRepo.findOne).toHaveBeenCalledWith({
        where: { projectId: 'p1' },
      });
      expect(jiraRepo.findOne).toHaveBeenCalledWith({
        where: { organizationId: 'org1' },
      });
    });

    it('returns false flags when no rows are found', async () => {
      const { service, githubRepo, gitlabRepo, jiraRepo } =
        await buildService();
      (githubRepo.findOne as jest.Mock).mockResolvedValue(null);
      (gitlabRepo.findOne as jest.Mock).mockResolvedValue(null);
      (jiraRepo.findOne as jest.Mock).mockResolvedValue(null);

      const result = await service.getProjectIntegrationLinkStatus({
        projectId: 'p1',
        organizationId: 'org1',
      });

      expect(result).toEqual({
        isGithubLinked: false,
        isGitlabLinked: false,
        isJiraLinked: false,
        isLinearLinked: false,
        defaultBranch: '',
      });
    });

    // The cyberisk score falls back to the repo's git default branch
    // (instead of hardcoded main/master) when no referenceBranch is set, so the
    // link-status RPC carries the linked repository's defaultBranch.
    it('returns the linked GitHub repository default branch', async () => {
      const { service, githubRepo, gitlabRepo, jiraRepo } =
        await buildService();
      (githubRepo.findOne as jest.Mock).mockResolvedValue({
        id: 'gh',
        projectId: 'p1',
        defaultBranch: 'develop',
      });
      (gitlabRepo.findOne as jest.Mock).mockResolvedValue(null);
      (jiraRepo.findOne as jest.Mock).mockResolvedValue(null);

      const result = await service.getProjectIntegrationLinkStatus({
        projectId: 'p1',
        organizationId: 'org1',
      });

      expect(result.defaultBranch).toBe('develop');
    });

    it('falls back to the GitLab default branch when only GitLab is linked', async () => {
      const { service, githubRepo, gitlabRepo, jiraRepo } =
        await buildService();
      (githubRepo.findOne as jest.Mock).mockResolvedValue(null);
      (gitlabRepo.findOne as jest.Mock).mockResolvedValue({
        id: 'gl',
        projectId: 'p1',
        defaultBranch: 'trunk',
      });
      (jiraRepo.findOne as jest.Mock).mockResolvedValue(null);

      const result = await service.getProjectIntegrationLinkStatus({
        projectId: 'p1',
        organizationId: 'org1',
      });

      expect(result.defaultBranch).toBe('trunk');
    });

    it('returns an empty default branch when no repository is linked', async () => {
      const { service, githubRepo, gitlabRepo, jiraRepo } =
        await buildService();
      (githubRepo.findOne as jest.Mock).mockResolvedValue(null);
      (gitlabRepo.findOne as jest.Mock).mockResolvedValue(null);
      (jiraRepo.findOne as jest.Mock).mockResolvedValue(null);

      const result = await service.getProjectIntegrationLinkStatus({
        projectId: 'p1',
        organizationId: 'org1',
      });

      expect(result.defaultBranch).toBe('');
    });

    // The dashboard reads the linked repository's branches with this id instead
    // of listing every repository of the organization to find it.
    it('returns the linked GitHub repository, preferred over GitLab like the default branch', async () => {
      const { service, githubRepo, gitlabRepo, jiraRepo } =
        await buildService();
      (githubRepo.findOne as jest.Mock).mockResolvedValue({
        id: 'gh-row',
        projectId: 'p1',
      });
      (gitlabRepo.findOne as jest.Mock).mockResolvedValue({
        id: 'gl-row',
        projectId: 'p1',
      });
      (jiraRepo.findOne as jest.Mock).mockResolvedValue(null);

      const result = await service.getProjectIntegrationLinkStatus({
        projectId: 'p1',
        organizationId: 'org1',
      });

      expect(result.linkedRepository).toEqual({
        provider: 'github',
        repositoryId: 'gh-row',
      });
    });

    it('returns the linked GitLab repository when only GitLab is linked', async () => {
      const { service, githubRepo, gitlabRepo, jiraRepo } =
        await buildService();
      (githubRepo.findOne as jest.Mock).mockResolvedValue(null);
      (gitlabRepo.findOne as jest.Mock).mockResolvedValue({
        id: 'gl-row',
        projectId: 'p1',
      });
      (jiraRepo.findOne as jest.Mock).mockResolvedValue(null);

      const result = await service.getProjectIntegrationLinkStatus({
        projectId: 'p1',
        organizationId: 'org1',
      });

      expect(result.linkedRepository).toEqual({
        provider: 'gitlab',
        repositoryId: 'gl-row',
      });
    });

    it('returns no linked repository when none is linked', async () => {
      const { service, githubRepo, gitlabRepo, jiraRepo } =
        await buildService();
      (githubRepo.findOne as jest.Mock).mockResolvedValue(null);
      (gitlabRepo.findOne as jest.Mock).mockResolvedValue(null);
      (jiraRepo.findOne as jest.Mock).mockResolvedValue(null);

      const result = await service.getProjectIntegrationLinkStatus({
        projectId: 'p1',
        organizationId: 'org1',
      });

      expect(result.linkedRepository).toBeUndefined();
    });

    it('runs the three lookups in parallel', async () => {
      const { service, githubRepo, gitlabRepo, jiraRepo } =
        await buildService();
      const started: string[] = [];
      const resolved: string[] = [];
      // Snapshot how many lookups had STARTED at the moment the first one
      // resolves. Run in parallel, all three are initiated before any
      // completes (=> 3); run sequentially, only one has started when the
      // first resolves (=> 1). This is deterministic and load-independent,
      // unlike a wall-clock threshold.
      let startedWhenFirstResolved = -1;
      const deferred = (label: string) => {
        started.push(label);
        return new Promise<any>((resolve) =>
          setTimeout(() => {
            if (startedWhenFirstResolved === -1) {
              startedWhenFirstResolved = started.length;
            }
            resolved.push(label);
            resolve(null);
          }, 10),
        );
      };
      (githubRepo.findOne as jest.Mock).mockImplementation(() =>
        deferred('gh'),
      );
      (gitlabRepo.findOne as jest.Mock).mockImplementation(() =>
        deferred('gl'),
      );
      (jiraRepo.findOne as jest.Mock).mockImplementation(() =>
        deferred('jira'),
      );

      await service.getProjectIntegrationLinkStatus({
        projectId: 'p1',
        organizationId: 'org1',
      });

      expect(resolved).toHaveLength(3);
      // All three lookups were started before the first one completed.
      expect(startedWhenFirstResolved).toBe(3);
    });

    it('treats each repo failure as "not linked" without throwing', async () => {
      const { service, githubRepo, gitlabRepo, jiraRepo } =
        await buildService();
      (githubRepo.findOne as jest.Mock).mockRejectedValue(new Error('gh down'));
      (gitlabRepo.findOne as jest.Mock).mockResolvedValue({ id: 'gl' });
      (jiraRepo.findOne as jest.Mock).mockRejectedValue(new Error('jira down'));

      const result = await service.getProjectIntegrationLinkStatus({
        projectId: 'p1',
        organizationId: 'org1',
      });

      expect(result).toEqual({
        isGithubLinked: false,
        isGitlabLinked: true,
        isJiraLinked: false,
        isLinearLinked: false,
        defaultBranch: '',
        linkedRepository: { provider: 'gitlab', repositoryId: 'gl' },
      });
    });
    // Linear, like Jira, is one installation per organisation, so
    // the flag is the same for every project of that organisation.
    it('isLinearLinked is true when the organisation has a Linear integration', async () => {
      const { service, githubRepo, gitlabRepo, jiraRepo, linearRepo } =
        await buildService();
      (githubRepo.findOne as jest.Mock).mockResolvedValue(null);
      (gitlabRepo.findOne as jest.Mock).mockResolvedValue(null);
      (jiraRepo.findOne as jest.Mock).mockResolvedValue(null);
      (linearRepo.findOne as jest.Mock).mockResolvedValue({
        id: 'l1',
        organizationId: 'org1',
      });

      const result = await service.getProjectIntegrationLinkStatus({
        projectId: 'p1',
        organizationId: 'org1',
      });

      expect(result.isLinearLinked).toBe(true);
      expect(result.isJiraLinked).toBe(false);
      expect(linearRepo.findOne).toHaveBeenCalledWith({
        where: { organizationId: 'org1' },
      });
    });

    it('isLinearLinked is false when the Linear lookup fails, without throwing', async () => {
      const { service, githubRepo, gitlabRepo, jiraRepo, linearRepo } =
        await buildService();
      (githubRepo.findOne as jest.Mock).mockResolvedValue(null);
      (gitlabRepo.findOne as jest.Mock).mockResolvedValue(null);
      (jiraRepo.findOne as jest.Mock).mockResolvedValue({ id: 'j1' });
      (linearRepo.findOne as jest.Mock).mockRejectedValue(
        new Error('linear down'),
      );

      const result = await service.getProjectIntegrationLinkStatus({
        projectId: 'p1',
        organizationId: 'org1',
      });

      expect(result.isLinearLinked).toBe(false);
      expect(result.isJiraLinked).toBe(true);
    });
  });

  describe('getBatchProjectIntegrationLinkStatus', () => {
    it('aggregates per-project github/gitlab status and a single org-wide jira flag', async () => {
      const { service, githubRepo, gitlabRepo, jiraRepo } =
        await buildService();
      (githubRepo.find as jest.Mock).mockResolvedValue([
        { projectId: 'p1' },
        { projectId: 'p3' },
      ]);
      (gitlabRepo.find as jest.Mock).mockResolvedValue([{ projectId: 'p2' }]);
      (jiraRepo.findOne as jest.Mock).mockResolvedValue({
        id: 'j1',
        organizationId: 'org1',
      });

      const result = await service.getBatchProjectIntegrationLinkStatus({
        organizationId: 'org1',
        projectIds: ['p1', 'p2', 'p3'],
      });

      expect(result.isJiraLinked).toBe(true);
      expect(result.statuses).toEqual([
        {
          projectId: 'p1',
          isGithubLinked: true,
          isGitlabLinked: false,
          defaultBranch: '',
        },
        {
          projectId: 'p2',
          isGithubLinked: false,
          isGitlabLinked: true,
          defaultBranch: '',
        },
        {
          projectId: 'p3',
          isGithubLinked: true,
          isGitlabLinked: false,
          defaultBranch: '',
        },
      ]);
    });

    // The project list counts each project on the branch its CybeRisk is
    // scoped on, which needs the git default branch of every project of the
    // page: same precedence as the single lookup, GitHub first, then GitLab.
    it("returns each project's git default branch, GitHub first then GitLab", async () => {
      const { service, githubRepo, gitlabRepo, jiraRepo } =
        await buildService();
      (jiraRepo.findOne as jest.Mock).mockResolvedValue(null);
      (githubRepo.find as jest.Mock).mockResolvedValue([
        { projectId: 'p1', defaultBranch: 'main' },
        { projectId: 'p3', defaultBranch: '' },
      ]);
      (gitlabRepo.find as jest.Mock).mockResolvedValue([
        { projectId: 'p1', defaultBranch: 'gitlab-main' },
        { projectId: 'p2', defaultBranch: 'develop' },
        { projectId: 'p3', defaultBranch: 'trunk' },
      ]);

      const result = await service.getBatchProjectIntegrationLinkStatus({
        organizationId: 'org1',
        projectIds: ['p1', 'p2', 'p3', 'p4'],
      });

      expect(
        result.statuses.map((s) => [s.projectId, s.defaultBranch]),
      ).toEqual([
        ['p1', 'main'],
        ['p2', 'develop'],
        ['p3', 'trunk'],
        ['p4', ''],
      ]);
    });

    it('isLinearLinked is true when the organisation has a Linear integration (one lookup for the whole batch)', async () => {
      const { service, githubRepo, gitlabRepo, jiraRepo, linearRepo } =
        await buildService();
      (githubRepo.find as jest.Mock).mockResolvedValue([]);
      (gitlabRepo.find as jest.Mock).mockResolvedValue([]);
      (jiraRepo.findOne as jest.Mock).mockResolvedValue(null);
      (linearRepo.findOne as jest.Mock).mockResolvedValue({
        id: 'l1',
        organizationId: 'org1',
      });

      const result = await service.getBatchProjectIntegrationLinkStatus({
        organizationId: 'org1',
        projectIds: ['p1', 'p2'],
      });

      expect(result.isLinearLinked).toBe(true);
      expect(result.isJiraLinked).toBe(false);
      expect(linearRepo.findOne).toHaveBeenCalledTimes(1);
      expect(linearRepo.findOne).toHaveBeenCalledWith({
        where: { organizationId: 'org1' },
      });
    });

    it('isLinearLinked is read even when projectIds is empty, and false when the lookup fails', async () => {
      const { service, githubRepo, gitlabRepo, jiraRepo, linearRepo } =
        await buildService();
      (githubRepo.find as jest.Mock).mockResolvedValue([]);
      (gitlabRepo.find as jest.Mock).mockResolvedValue([]);
      (jiraRepo.findOne as jest.Mock).mockResolvedValue(null);
      (linearRepo.findOne as jest.Mock).mockResolvedValue({ id: 'l1' });

      const empty = await service.getBatchProjectIntegrationLinkStatus({
        organizationId: 'org1',
        projectIds: [],
      });
      expect(empty).toEqual({
        statuses: [],
        isJiraLinked: false,
        isLinearLinked: true,
      });

      (linearRepo.findOne as jest.Mock).mockRejectedValue(
        new Error('linear down'),
      );
      const failed = await service.getBatchProjectIntegrationLinkStatus({
        organizationId: 'org1',
        projectIds: ['p1'],
      });
      expect(failed.isLinearLinked).toBe(false);
    });

    it('returns an empty status array and a single jira lookup when projectIds is empty', async () => {
      const { service, githubRepo, gitlabRepo, jiraRepo } =
        await buildService();
      (jiraRepo.findOne as jest.Mock).mockResolvedValue(null);

      const result = await service.getBatchProjectIntegrationLinkStatus({
        organizationId: 'org1',
        projectIds: [],
      });

      expect(result.statuses).toEqual([]);
      expect(result.isJiraLinked).toBe(false);
      expect(githubRepo.find).not.toHaveBeenCalled();
      expect(gitlabRepo.find).not.toHaveBeenCalled();
      expect(jiraRepo.findOne).toHaveBeenCalledTimes(1);
    });
  });

  // Dashboard repository link (task B2) — repository slug -> linked CybeDefend
  // project(s) resolution, consumed by the CLI `link` flow through gateway.
  describe('resolveProjectsByRepository', () => {
    it('resolves a linked GitHub repository into project/organization matches', async () => {
      const { service, githubRepo } = await buildService();
      (githubRepo.find as jest.Mock).mockResolvedValue([
        {
          id: 'gh-1',
          fullName: 'acme/api',
          projectId: 'p1',
          integration: { id: 'int-1', organizationId: 'org1' },
        },
      ]);

      const result = await service.resolveProjectsByRepository({
        provider: 'github',
        slug: 'acme/api',
        host: '',
      });

      expect(result).toEqual({
        matches: [
          {
            projectId: 'p1',
            organizationId: 'org1',
            provider: 'github',
            repositoryFullName: 'acme/api',
          },
        ],
      });
      expect(githubRepo.find).toHaveBeenCalledWith({
        where: { fullName: 'acme/api', projectId: Not(IsNull()) },
        relations: ['integration'],
        take: 20,
      });
    });

    it('returns an empty matches array when no repository matches the slug', async () => {
      const { service, githubRepo } = await buildService();
      (githubRepo.find as jest.Mock).mockResolvedValue([]);

      const result = await service.resolveProjectsByRepository({
        provider: 'github',
        slug: 'acme/unknown',
        host: '',
      });

      expect(result).toEqual({ matches: [] });
    });

    it('only queries repositories with a non-null projectId (unlinked repos excluded)', async () => {
      const { service, githubRepo } = await buildService();
      (githubRepo.find as jest.Mock).mockResolvedValue([]);

      await service.resolveProjectsByRepository({
        provider: 'github',
        slug: 'acme/api',
        host: '',
      });

      const where = (githubRepo.find as jest.Mock).mock.calls[0][0].where;
      expect(where.projectId).toEqual(Not(IsNull()));
    });

    // The github_repositories table only ever holds github.com App repos, so a
    // GitHub-Enterprise origin (e.g. github.corp.com) must NOT auto-resolve to
    // the github.com project with the same slug.
    it('returns no matches (without querying) for a non-github.com GitHub host', async () => {
      const { service, githubRepo } = await buildService();

      const result = await service.resolveProjectsByRepository({
        provider: 'github',
        slug: 'acme/api',
        host: 'github.corp.com',
      });

      expect(result).toEqual({ matches: [] });
      expect(githubRepo.find).not.toHaveBeenCalled();
    });

    it('matches normally when the GitHub host is github.com (case-insensitive)', async () => {
      const { service, githubRepo } = await buildService();
      (githubRepo.find as jest.Mock).mockResolvedValue([
        {
          id: 'gh-1',
          fullName: 'acme/api',
          projectId: 'p1',
          integration: { id: 'int-1', organizationId: 'org1' },
        },
      ]);

      const result = await service.resolveProjectsByRepository({
        provider: 'github',
        slug: 'acme/api',
        host: 'GitHub.com',
      });

      expect(result.matches).toHaveLength(1);
      expect(githubRepo.find).toHaveBeenCalledWith({
        where: { fullName: 'acme/api', projectId: Not(IsNull()) },
        relations: ['integration'],
        take: 20,
      });
    });

    it('matches normally when the GitHub host is empty', async () => {
      const { service, githubRepo } = await buildService();
      (githubRepo.find as jest.Mock).mockResolvedValue([
        {
          id: 'gh-1',
          fullName: 'acme/api',
          projectId: 'p1',
          integration: { id: 'int-1', organizationId: 'org1' },
        },
      ]);

      const result = await service.resolveProjectsByRepository({
        provider: 'github',
        slug: 'acme/api',
        host: '',
      });

      expect(result.matches).toHaveLength(1);
      expect(githubRepo.find).toHaveBeenCalled();
    });

    it('resolves a GitLab repository and narrows by host when host is provided', async () => {
      const { service, gitlabRepo } = await buildService();
      (gitlabRepo.find as jest.Mock).mockResolvedValue([
        {
          id: 'gl-1',
          pathWithNamespace: 'group/sub/proj',
          webUrl: 'https://gitlab.example.com/group/sub/proj',
          projectId: 'p2',
          integration: { id: 'int-2', organizationId: 'org2' },
        },
      ]);

      const result = await service.resolveProjectsByRepository({
        provider: 'gitlab',
        slug: 'group/sub/proj',
        host: 'gitlab.example.com',
      });

      expect(result).toEqual({
        matches: [
          {
            projectId: 'p2',
            organizationId: 'org2',
            provider: 'gitlab',
            repositoryFullName: 'group/sub/proj',
          },
        ],
      });
      expect(gitlabRepo.find).toHaveBeenCalledWith({
        where: {
          pathWithNamespace: 'group/sub/proj',
          projectId: Not(IsNull()),
          webUrl: Like('%gitlab.example.com%'),
        },
        relations: ['integration'],
        take: 20,
      });
    });

    it('escapes LIKE wildcards in host so the webUrl filter cannot be neutralized', async () => {
      const { service, gitlabRepo } = await buildService();
      (gitlabRepo.find as jest.Mock).mockResolvedValue([]);

      await service.resolveProjectsByRepository({
        provider: 'gitlab',
        slug: 'group/proj',
        host: 'gitlab.e%ample_com',
      });

      expect(gitlabRepo.find).toHaveBeenCalledWith({
        where: {
          pathWithNamespace: 'group/proj',
          projectId: Not(IsNull()),
          webUrl: Like('%gitlab.e\\%ample\\_com%'),
        },
        relations: ['integration'],
        take: 20,
      });
    });

    it('narrows GitLab lookups to gitlab.com when host is empty (no cross-instance conflation)', async () => {
      const { service, gitlabRepo } = await buildService();
      (gitlabRepo.find as jest.Mock).mockResolvedValue([]);

      await service.resolveProjectsByRepository({
        provider: 'gitlab',
        slug: 'group/proj',
        host: '',
      });

      // An empty host means "the public gitlab.com" (per the DTO contract), so
      // the lookup must be narrowed to gitlab.com rather than matching the same
      // path on any registered self-hosted GitLab instance — mirroring the
      // GitHub-Enterprise guard on the github branch.
      expect(gitlabRepo.find).toHaveBeenCalledWith({
        where: {
          pathWithNamespace: 'group/proj',
          projectId: Not(IsNull()),
          webUrl: Like('%gitlab.com%'),
        },
        relations: ['integration'],
        take: 20,
      });
    });

    it('throws RpcException INVALID_ARGUMENT for an unknown provider', async () => {
      const { service } = await buildService();

      await expect(
        service.resolveProjectsByRepository({
          provider: 'bitbucket',
          slug: 'acme/api',
          host: '',
        }),
      ).rejects.toMatchObject({ error: { code: status.INVALID_ARGUMENT } });
    });
  });
});

describe('ProjectIntegrationStatusService.resolveScanBranch', () => {
  const githubLink = {
    id: 'gh-repo',
    projectId: 'p1',
    fullName: 'acme/vault',
    defaultBranch: 'main',
    integration: { id: 'gh-int', installationId: 1 },
  };
  const gitlabLink = {
    id: 'gl-repo',
    projectId: 'p1',
    pathWithNamespace: 'acme/frontend',
    defaultBranch: 'master',
    integration: { id: 'gl-int' },
  };

  async function linked(github: unknown, gitlab: unknown) {
    const built = await buildService();
    (built.githubRepo.findOne as jest.Mock).mockResolvedValue(github);
    (built.gitlabRepo.findOne as jest.Mock).mockResolvedValue(gitlab);
    return built;
  }

  describe('on a project linked to no repository', () => {
    it('keeps the requested branch: there is nothing to check it against', async () => {
      const { service, githubService, gitlabService } = await linked(
        null,
        null,
      );
      await expect(
        service.resolveScanBranch({
          projectId: 'p1',
          branch: 'v2.102.0',
          referenceBranch: 'main',
        }),
      ).resolves.toBe('v2.102.0');
      expect(githubService.findBranch).not.toHaveBeenCalled();
      expect(gitlabService.findBranch).not.toHaveBeenCalled();
    });

    it('takes the reference branch when none is requested', async () => {
      const { service } = await linked(null, null);
      await expect(
        service.resolveScanBranch({
          projectId: 'p1',
          branch: '  ',
          referenceBranch: 'develop',
        }),
      ).resolves.toBe('develop');
    });

    it('takes main when neither is set, never the empty branch the dashboard never offers', async () => {
      const { service } = await linked(null, null);
      await expect(
        service.resolveScanBranch({
          projectId: 'p1',
          branch: '',
          referenceBranch: '',
        }),
      ).resolves.toBe('main');
    });
  });

  it('reads the "refs/heads/<branch>" a CI may send as the branch', async () => {
    const { service } = await linked(null, null);
    await expect(
      service.resolveScanBranch({
        projectId: 'p1',
        branch: 'refs/heads/release/2.x',
        referenceBranch: '',
      }),
    ).resolves.toBe('release/2.x');
  });

  it('refuses a branch name longer than any branch can be, whatever the project', async () => {
    const { service } = await linked(null, null);
    const refusal = await service
      .resolveScanBranch({
        projectId: 'p1',
        branch: 'b'.repeat(256),
        referenceBranch: '',
      })
      .catch((e) => e);

    expect(refusal.getError()).toEqual({
      code: status.INVALID_ARGUMENT,
      message: 'A branch name is at most 255 characters.',
    });
  });

  describe('on a project linked to GitHub', () => {
    it('stores a requested branch the repository has, spelled as the repository spells it', async () => {
      const { service, githubRepo, githubService } = await linked(
        githubLink,
        null,
      );
      githubService.findBranch.mockResolvedValue('release/2.x');

      await expect(
        service.resolveScanBranch({
          projectId: 'p1',
          branch: ' Release/2.x ',
          referenceBranch: '',
        }),
      ).resolves.toBe('release/2.x');

      expect(githubRepo.findOne).toHaveBeenCalledWith({
        where: { projectId: 'p1' },
        relations: ['integration'],
      });
      expect(githubService.findBranch).toHaveBeenCalledWith(
        githubLink,
        'Release/2.x',
      );
    });

    it('refuses a requested branch the repository does not have, an image tag included', async () => {
      const { service, githubService } = await linked(githubLink, null);
      githubService.findBranch.mockResolvedValue(null);

      const refusal = await service
        .resolveScanBranch({
          projectId: 'p1',
          branch: 'v2.102.0',
          referenceBranch: 'main',
        })
        .catch((e) => e);

      expect(refusal.getError()).toEqual({
        code: status.INVALID_ARGUMENT,
        message:
          'Branch "v2.102.0" does not exist in acme/vault, the repository linked to this project. ' +
          'Send the git branch the image was built from; the image tag belongs in imageName.',
      });
    });

    it('lets a failed check of a requested branch through as is, so the caller sees why', async () => {
      const { service, githubService } = await linked(githubLink, null);
      const unavailable = Object.assign(new Error('GitHub down'), {
        code: status.UNAVAILABLE,
      });
      githubService.findBranch.mockRejectedValue(unavailable);

      await expect(
        service.resolveScanBranch({
          projectId: 'p1',
          branch: 'develop',
          referenceBranch: '',
        }),
      ).rejects.toBe(unavailable);
    });

    it('takes the reference branch when none is requested and the repository has it', async () => {
      const { service, githubService } = await linked(githubLink, null);
      githubService.findBranch.mockResolvedValue('develop');

      await expect(
        service.resolveScanBranch({
          projectId: 'p1',
          branch: '',
          referenceBranch: 'develop',
        }),
      ).resolves.toBe('develop');
      expect(githubService.findBranch).toHaveBeenCalledWith(
        githubLink,
        'develop',
      );
    });

    it('falls back to the default branch, never refuses, when the reference branch is gone and none was requested', async () => {
      const { service, githubService } = await linked(githubLink, null);
      githubService.findBranch.mockResolvedValue(null);

      await expect(
        service.resolveScanBranch({
          projectId: 'p1',
          branch: '',
          referenceBranch: 'old-branch',
        }),
      ).resolves.toBe('main');
    });

    it('falls back to the default branch, never refuses, when the reference branch cannot be checked and none was requested', async () => {
      const { service, githubService } = await linked(githubLink, null);
      githubService.findBranch.mockRejectedValue(
        Object.assign(new Error('GitHub down'), { code: status.UNAVAILABLE }),
      );

      await expect(
        service.resolveScanBranch({
          projectId: 'p1',
          branch: '',
          referenceBranch: 'develop',
        }),
      ).resolves.toBe('main');
    });

    describe('when the reference branch check is slow', () => {
      // A GitHub call may take 30 s and be retried, a GitLab one has no
      // timeout, and security-scanning gives up after 20 s: past that, a scan
      // sent without a branch would be refused, which it never is.
      afterEach(() => {
        jest.useRealTimers();
      });

      it('falls back to the default branch, never refuses, once the check outlasts its deadline', async () => {
        jest.useFakeTimers();
        const { service, githubService } = await linked(githubLink, null);
        githubService.findBranch.mockReturnValue(new Promise(() => {}));

        const resolution = service.resolveScanBranch({
          projectId: 'p1',
          branch: '',
          referenceBranch: 'develop',
        });
        await jest.advanceTimersByTimeAsync(REFERENCE_BRANCH_CHECK_TIMEOUT_MS);

        await expect(resolution).resolves.toBe('main');
      });

      it('leaves no timer behind when the check answers in time', async () => {
        jest.useFakeTimers();
        const { service, githubService } = await linked(githubLink, null);
        githubService.findBranch.mockResolvedValue('develop');

        await expect(
          service.resolveScanBranch({
            projectId: 'p1',
            branch: '',
            referenceBranch: 'develop',
          }),
        ).resolves.toBe('develop');
        expect(jest.getTimerCount()).toBe(0);
      });

      it('does not bound a requested branch: its check decides a refusal', async () => {
        jest.useFakeTimers();
        const { service, githubService } = await linked(githubLink, null);
        let answer: (branch: string | null) => void = () => {};
        githubService.findBranch.mockReturnValue(
          new Promise((resolve) => {
            answer = resolve;
          }),
        );

        const resolution = service.resolveScanBranch({
          projectId: 'p1',
          branch: 'develop',
          referenceBranch: '',
        });
        await jest.advanceTimersByTimeAsync(
          REFERENCE_BRANCH_CHECK_TIMEOUT_MS * 2,
        );
        answer('develop');

        await expect(resolution).resolves.toBe('develop');
      });
    });

    it('takes the default branch without asking anything when no reference branch is set', async () => {
      const { service, githubService } = await linked(
        { ...githubLink, defaultBranch: 'trunk' },
        null,
      );

      await expect(
        service.resolveScanBranch({
          projectId: 'p1',
          branch: '',
          referenceBranch: '',
        }),
      ).resolves.toBe('trunk');
      expect(githubService.findBranch).not.toHaveBeenCalled();
    });

    it('takes main when the repository default branch was never synced', async () => {
      const { service } = await linked(
        { ...githubLink, defaultBranch: null },
        null,
      );

      await expect(
        service.resolveScanBranch({
          projectId: 'p1',
          branch: '',
          referenceBranch: '',
        }),
      ).resolves.toBe('main');
    });

    it('checks GitHub, not GitLab, when the project has both (the link status order)', async () => {
      const { service, githubService, gitlabService } = await linked(
        githubLink,
        gitlabLink,
      );
      githubService.findBranch.mockResolvedValue('develop');

      await service.resolveScanBranch({
        projectId: 'p1',
        branch: 'develop',
        referenceBranch: '',
      });

      expect(githubService.findBranch).toHaveBeenCalled();
      expect(gitlabService.findBranch).not.toHaveBeenCalled();
    });
  });

  describe('on a project linked to GitLab', () => {
    it('checks the requested branch against the GitLab repository', async () => {
      const { service, gitlabRepo, gitlabService } = await linked(
        null,
        gitlabLink,
      );
      gitlabService.findBranch.mockResolvedValue(null);

      const refusal = await service
        .resolveScanBranch({
          projectId: 'p1',
          branch: 'v1.110.0',
          referenceBranch: '',
        })
        .catch((e) => e);

      expect(gitlabRepo.findOne).toHaveBeenCalledWith({
        where: { projectId: 'p1' },
        relations: ['integration'],
      });
      expect(gitlabService.findBranch).toHaveBeenCalledWith(
        gitlabLink,
        'v1.110.0',
      );
      expect(refusal.getError()).toMatchObject({
        code: status.INVALID_ARGUMENT,
        message: expect.stringContaining(
          'Branch "v1.110.0" does not exist in acme/frontend',
        ),
      });
    });
  });

  it('does not take a failed repository lookup for "no repository": it fails', async () => {
    const { service, githubRepo, gitlabRepo } = await buildService();
    (githubRepo.findOne as jest.Mock).mockRejectedValue(
      new Error('ER_LOCK_WAIT_TIMEOUT'),
    );
    (gitlabRepo.findOne as jest.Mock).mockResolvedValue(null);

    await expect(
      service.resolveScanBranch({
        projectId: 'p1',
        branch: 'v2.102.0',
        referenceBranch: '',
      }),
    ).rejects.toThrow('ER_LOCK_WAIT_TIMEOUT');
  });
});
