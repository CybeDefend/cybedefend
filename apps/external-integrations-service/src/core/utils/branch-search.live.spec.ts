// The GitHub service loads Octokit's ESM modules, which Jest does not
// transform; the branch search calls none of them.
jest.mock('@octokit/auth-app', () => ({ createAppAuth: jest.fn() }));
jest.mock('@octokit/rest', () => {
  const Octokit = jest.fn() as unknown as { plugin: jest.Mock };
  Octokit.plugin = jest.fn(() => Octokit);
  return { Octokit };
});
jest.mock('@octokit/plugin-retry', () => ({ retry: jest.fn() }));
jest.mock('@octokit/plugin-throttling', () => ({ throttling: jest.fn() }));

import {
  createLiveDatabase,
  liveEnabled,
  LiveDatabase,
} from '../db/live-database';
import { GithubBranch } from '../../entities/github-branch.entity';
import { GithubIntegration } from '../../entities/github-integration.entity';
import { GithubRepository } from '../../entities/github-repository.entity';
import { GitlabBranch } from '../../entities/gitlab-branch.entity';
import { GitlabIntegration } from '../../entities/gitlab-integration.entity';
import { GitlabRepository } from '../../entities/gitlab-repository.entity';
import { GithubService } from '../../modules/github/github.service';
import { GitlabService } from '../../modules/gitlab/gitlab.service';

/**
 * LIVE spec, on a REAL MySQL or PostgreSQL: the branch search of a project's
 * GitHub and GitLab repositories (GetRepositoryBranchesPaginated, the branch
 * picker) ignores case on both engines. MySQL's collation made `LIKE`
 * case-insensitive; PostgreSQL's `LIKE` is not, so `feature/login` did not
 * find `Feature/Login` on the Community Edition: PostgreSQL must behave like
 * MySQL here.
 *
 * Gated on the branch tables' flag, BRANCH_UPSERT_LIVE=1; the engine is
 * LIVE_DB_TYPE (mysql by default), the server BRANCH_UPSERT_MYSQL_URL /
 * BRANCH_UPSERT_PG_URL. It creates, then drops, its own database.
 */
const describeLive = liveEnabled('BRANCH_UPSERT') ? describe : describe.skip;

const BRANCHES = ['Feature/Login', 'main', 'release/1.0'];

describeLive('the branch search ignores case on both engines', () => {
  jest.setTimeout(300_000);

  let db: LiveDatabase;
  let github: GithubService;
  let gitlab: GitlabService;
  const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const grpcClient = { getService: () => ({}) };

  beforeAll(async () => {
    db = await createLiveDatabase({
      prefix: 'ei_branch_search',
      envPrefix: 'BRANCH_UPSERT',
      entities: [
        GithubIntegration,
        GithubRepository,
        GithubBranch,
        GitlabIntegration,
        GitlabRepository,
        GitlabBranch,
      ],
    });
    const ds = db.dataSource;

    const ghIntegration = await ds.getRepository(GithubIntegration).save(
      Object.assign(new GithubIntegration(), {
        installationId: 7,
        organizationId: 'org-live',
      }),
    );
    const ghRepository = await ds.getRepository(GithubRepository).save(
      Object.assign(new GithubRepository(), {
        githubId: 101,
        nodeId: 'n-101',
        name: 'repo',
        fullName: 'org/repo',
        private: true,
        integrationId: ghIntegration.id,
        projectId: 'project-gh',
        defaultBranch: 'main',
        branchesSyncedAt: new Date(),
      }),
    );
    await ds.getRepository(GithubBranch).save(
      BRANCHES.map((name) =>
        Object.assign(new GithubBranch(), {
          name,
          isProtected: false,
          repositoryId: ghRepository.id,
          firstSeenAt: new Date(),
        }),
      ),
    );

    const glIntegration = await ds.getRepository(GitlabIntegration).save(
      Object.assign(new GitlabIntegration(), {
        organizationId: 'org-live',
        userId: 'user-1',
        gitlabUserId: 1,
        accessToken: 'enc-access',
        refreshToken: 'enc-refresh',
        tokenExpiresAt: new Date(Date.now() + 3_600_000),
      }),
    );
    const glRepository = await ds.getRepository(GitlabRepository).save(
      Object.assign(new GitlabRepository(), {
        gitlabId: 201,
        name: 'repo',
        nameWithNamespace: 'group / repo',
        path: 'repo',
        pathWithNamespace: 'group/repo',
        private: true,
        description: '',
        webUrl: 'https://gitlab.com/group/repo',
        sshUrlToRepo: 'git@gitlab.com:group/repo.git',
        httpUrlToRepo: 'https://gitlab.com/group/repo.git',
        projectId: 'project-gl',
        webhookId: 201,
        integrationId: glIntegration.id,
        defaultBranch: 'main',
        branchesSyncedAt: new Date(),
      }),
    );
    await ds.getRepository(GitlabBranch).save(
      BRANCHES.map((name) =>
        Object.assign(new GitlabBranch(), {
          name,
          isProtected: false,
          repositoryId: glRepository.id,
          firstSeenAt: new Date(),
          lastSeenAt: new Date(),
        }),
      ),
    );

    github = new GithubService(
      ds.getRepository(GithubIntegration),
      ds.getRepository(GithubRepository),
      ds.getRepository(GithubBranch),
      ds,
      { get: () => undefined } as never, // configService
      { getSecret: () => '' } as never, // secretsService
      logger as never,
      {} as never, // entitlements
      grpcClient as never,
      grpcClient as never,
      grpcClient as never,
      {} as never, // repoScanQueue
      {} as never, // pendingRescans
      {} as never, // productLinks
      {} as never, // repoHistory
    );
    gitlab = new GitlabService(
      ds.getRepository(GitlabIntegration),
      ds.getRepository(GitlabRepository),
      ds.getRepository(GitlabBranch),
      ds,
      { getSecret: async () => 'unused' } as never,
      {} as never,
      logger as never,
      { get: () => 'https://app.example.com' } as never,
      grpcClient as never,
      grpcClient as never,
      grpcClient as never,
      {} as never, // repoScanQueue
      {} as never, // billingWritable
      {} as never, // pendingRescans
      {} as never, // repoHistory
    );
  });

  afterAll(async () => {
    await db?.drop();
  });

  const request = (projectId: string, search: string) => ({
    organizationId: 'org-live',
    projectId,
    search,
    page: 1,
    pageSize: 30,
    includeArchived: false,
    archivedNames: [],
  });

  for (const search of ['feature/login', 'LOGIN', 'Feature/Login']) {
    it(`GitHub: "${search}" finds Feature/Login`, async () => {
      const res = await github.getRepositoryBranchesPaginated(
        request('project-gh', search) as never,
      );
      expect(res.branches.map((b) => b.name)).toEqual(['Feature/Login']);
      expect(res.total).toBe(1);
    });

    it(`GitLab: "${search}" finds Feature/Login`, async () => {
      const res = await gitlab.getGitlabRepositoryBranchesPaginated(
        request('project-gl', search) as never,
      );
      expect(res.branches.map((b) => b.name)).toEqual(['Feature/Login']);
      expect(res.total).toBe(1);
    });
  }
});
