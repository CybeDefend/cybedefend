import { GatewayClientService } from '../gateway-client/gateway-client.service';
import {
  linkRepositoryToProject,
  lookupRepository,
  normalizeHost,
  RepositoryRef,
} from './repository-link';

const TARGET = { organizationId: 'o-1', projectId: 'p-1' };

function httpError(status: number, message: string): Error {
  return Object.assign(new Error(message), { response: { status } });
}

function githubList(
  ...installs: Array<
    Array<{ id: string; fullName: string; projectId?: string }>
  >
) {
  return {
    repositories: installs.map((repos, i) => ({
      installationId: i + 1,
      repository: repos.map((r) => ({ projectId: '', ...r })),
    })),
  };
}

type GatewayMocks = {
  listGithubRepositories: jest.Mock;
  listGitlabRepositories: jest.Mock;
  linkGithubRepository: jest.Mock;
  linkGitlabRepository: jest.Mock;
};

function makeGateway(over: Partial<GatewayMocks> = {}) {
  const mocks: GatewayMocks = {
    listGithubRepositories: jest.fn(async () =>
      githubList([{ id: 'r-1', fullName: 'acme/web' }]),
    ),
    listGitlabRepositories: jest.fn(async () => ({
      repositories: [
        { id: 'g-1', pathWithNamespace: 'acme/platform/web', projectId: '' },
      ],
    })),
    linkGithubRepository: jest.fn(async () => ({})),
    linkGitlabRepository: jest.fn(async () => ({})),
    ...over,
  };
  return { gateway: mocks as unknown as GatewayClientService, mocks };
}

const GITHUB: RepositoryRef = { provider: 'github', slug: 'acme/web' };
const GITLAB: RepositoryRef = {
  provider: 'gitlab',
  slug: 'acme/platform/web',
  host: 'gitlab.com',
};

describe('linkRepositoryToProject', () => {
  it('links a free GitHub repository matched case-insensitively, host included', async () => {
    const { gateway, mocks } = makeGateway({
      listGithubRepositories: jest.fn(async () =>
        githubList([
          { id: 'r-0', fullName: 'acme/api' },
          { id: 'r-1', fullName: 'Acme/Web' },
        ]),
      ),
    });

    const out = await linkRepositoryToProject(
      gateway,
      TARGET,
      { provider: 'github', slug: 'acme/web', host: 'GitHub.com' },
      'tok',
    );

    expect(mocks.listGithubRepositories).toHaveBeenCalledWith('o-1', 'tok');
    expect(mocks.linkGithubRepository).toHaveBeenCalledWith(
      'o-1',
      'p-1',
      'r-1',
      'tok',
    );
    expect(out).toEqual({
      provider: 'github',
      slug: 'acme/web',
      status: 'linked',
      message: expect.stringMatching(/first scan/),
    });
  });

  it('looks through every GitHub installation', async () => {
    const { gateway, mocks } = makeGateway({
      listGithubRepositories: jest.fn(async () =>
        githubList(
          [{ id: 'r-0', fullName: 'other/api' }],
          [{ id: 'r-9', fullName: 'acme/web' }],
        ),
      ),
    });

    const out = await linkRepositoryToProject(gateway, TARGET, GITHUB, 'tok');

    expect(out.status).toBe('linked');
    expect(mocks.linkGithubRepository).toHaveBeenCalledWith(
      'o-1',
      'p-1',
      'r-9',
      'tok',
    );
  });

  it('links a free GitLab repository on its full namespace path', async () => {
    const { gateway, mocks } = makeGateway();

    const out = await linkRepositoryToProject(gateway, TARGET, GITLAB, 'tok');

    expect(mocks.listGitlabRepositories).toHaveBeenCalledWith('o-1', 'tok');
    expect(mocks.linkGitlabRepository).toHaveBeenCalledWith(
      'o-1',
      'p-1',
      'g-1',
      'tok',
    );
    expect(out.status).toBe('linked');
  });

  it('reports not_found with the GitHub App hint', async () => {
    const { gateway, mocks } = makeGateway({
      listGithubRepositories: jest.fn(async () => ({ repositories: [] })),
    });

    const out = await linkRepositoryToProject(gateway, TARGET, GITHUB, 'tok');

    expect(out.status).toBe('not_found');
    expect(out.message).toMatch(/GitHub App/);
    expect(mocks.linkGithubRepository).not.toHaveBeenCalled();
  });

  it('reports not_found with the GitLab connection hint', async () => {
    const { gateway } = makeGateway({
      listGitlabRepositories: jest.fn(async () => ({ repositories: [] })),
    });

    const out = await linkRepositoryToProject(gateway, TARGET, GITLAB, 'tok');

    expect(out.status).toBe('not_found');
    expect(out.message).toMatch(/connect GitLab/);
  });

  it('never relinks a repository already linked to another project', async () => {
    const { gateway, mocks } = makeGateway({
      listGitlabRepositories: jest.fn(async () => ({
        repositories: [
          {
            id: 'g-1',
            pathWithNamespace: 'acme/platform/web',
            projectId: 'p-other',
          },
        ],
      })),
    });

    const out = await linkRepositoryToProject(gateway, TARGET, GITLAB, 'tok');

    expect(out).toMatchObject({
      status: 'already_linked',
      linkedProjectId: 'p-other',
    });
    expect(out.message).toContain('p-other');
    expect(mocks.linkGitlabRepository).not.toHaveBeenCalled();
  });

  it('refuses to choose between several matching repositories', async () => {
    const { gateway, mocks } = makeGateway({
      listGithubRepositories: jest.fn(async () =>
        githubList(
          [{ id: 'r-1', fullName: 'acme/web' }],
          [{ id: 'r-2', fullName: 'acme/web', projectId: 'p-x' }],
        ),
      ),
    });

    const out = await linkRepositoryToProject(gateway, TARGET, GITHUB, 'tok');

    expect(out.status).toBe('failed');
    expect(out.message).toMatch(/several/i);
    expect(mocks.linkGithubRepository).not.toHaveBeenCalled();
  });

  it.each([
    ['github', 'github.example.com'],
    ['gitlab', 'gitlab.acme.internal'],
  ] as const)(
    'reports unsupported_host for a %s remote on %s without calling the gateway',
    async (provider, host) => {
      const { gateway, mocks } = makeGateway();

      const out = await linkRepositoryToProject(
        gateway,
        TARGET,
        { provider, slug: 'acme/web', host },
        'tok',
      );

      expect(out.status).toBe('unsupported_host');
      expect(out.message).toContain(host);
      expect(mocks.listGithubRepositories).not.toHaveBeenCalled();
      expect(mocks.listGitlabRepositories).not.toHaveBeenCalled();
    },
  );

  it('reports forbidden when listing the repositories is refused (403)', async () => {
    const { gateway } = makeGateway({
      listGithubRepositories: jest.fn(async () => {
        throw httpError(403, 'Forbidden resource');
      }),
    });

    const out = await linkRepositoryToProject(gateway, TARGET, GITHUB, 'tok');

    expect(out.status).toBe('forbidden');
    expect(out.message).toMatch(/integration-management/);
  });

  it('reports forbidden when the link is refused (403)', async () => {
    const { gateway } = makeGateway({
      linkGithubRepository: jest.fn(async () => {
        throw httpError(403, 'Forbidden resource');
      }),
    });

    const out = await linkRepositoryToProject(gateway, TARGET, GITHUB, 'tok');

    expect(out.status).toBe('forbidden');
  });

  it('reports failed without echoing a 5xx gateway message', async () => {
    const listing = makeGateway({
      listGitlabRepositories: jest.fn(async () => {
        throw httpError(503, 'connect ECONNREFUSED 10.0.3.4:50051');
      }),
    });
    const linking = makeGateway({
      linkGitlabRepository: jest.fn(async () => {
        throw httpError(500, 'webhook failed: internal detail');
      }),
    });

    const a = await linkRepositoryToProject(
      listing.gateway,
      TARGET,
      GITLAB,
      'tok',
    );
    const b = await linkRepositoryToProject(
      linking.gateway,
      TARGET,
      GITLAB,
      'tok',
    );

    expect(a).toMatchObject({ status: 'failed' });
    expect(a.message).toContain('HTTP 503');
    expect(a.message).not.toContain('ECONNREFUSED');
    expect(b).toMatchObject({ status: 'failed' });
    expect(b.message).toContain('HTTP 500');
    expect(b.message).not.toContain('internal detail');
  });

  it('echoes a 4xx gateway message in a failed outcome', async () => {
    const { gateway } = makeGateway({
      linkGithubRepository: jest.fn(async () => {
        throw httpError(409, 'Repository already linked to a project');
      }),
    });

    const out = await linkRepositoryToProject(gateway, TARGET, GITHUB, 'tok');

    expect(out.status).toBe('failed');
    expect(out.message).toContain('Repository already linked to a project');
  });

  it("maps GitHub's and GitLab's SSH-over-443 hosts to the SaaS host", async () => {
    const { gateway, mocks } = makeGateway();

    const gh = await linkRepositoryToProject(
      gateway,
      TARGET,
      { provider: 'github', slug: 'acme/web', host: 'ssh.github.com' },
      'tok',
    );
    const gl = await linkRepositoryToProject(
      gateway,
      TARGET,
      {
        provider: 'gitlab',
        slug: 'acme/platform/web',
        host: 'altssh.gitlab.com',
      },
      'tok',
    );

    expect(gh.status).toBe('linked');
    expect(gl.status).toBe('linked');
    expect(mocks.linkGithubRepository).toHaveBeenCalled();
    expect(mocks.linkGitlabRepository).toHaveBeenCalled();
  });
});

describe('lookupRepository', () => {
  it('returns the free integration row without linking anything', async () => {
    const { gateway, mocks } = makeGateway();

    const found = await lookupRepository(gateway, 'o-1', GITHUB, 'tok');

    expect(found).toEqual({
      match: { id: 'r-1', path: 'acme/web', projectId: '' },
    });
    expect(mocks.linkGithubRepository).not.toHaveBeenCalled();
  });

  it('returns the already_linked outcome for a row bound to a project', async () => {
    const { gateway } = makeGateway({
      listGithubRepositories: jest.fn(async () =>
        githubList([{ id: 'r-1', fullName: 'acme/web', projectId: 'p-x' }]),
      ),
    });

    const found = await lookupRepository(gateway, 'o-1', GITHUB, 'tok');

    expect(found).toMatchObject({
      outcome: { status: 'already_linked', linkedProjectId: 'p-x' },
    });
  });
});

describe('normalizeHost', () => {
  it.each([
    ['github.com', 'github.com'],
    ['GitHub.com', 'github.com'],
    ['https://github.com', 'github.com'],
    ['https://github.com/acme/web', 'github.com'],
    ['git@github.com', 'github.com'],
    ['github.com:443', 'github.com'],
    ['ssh.github.com', 'github.com'],
    ['altssh.gitlab.com', 'gitlab.com'],
    ['gitlab.acme.internal', 'gitlab.acme.internal'],
  ])('normalises %s to %s', (raw, host) => {
    expect(normalizeHost(raw)).toBe(host);
  });

  it.each(['', '   ', 'not a host!', 'https://'])('rejects %p', (raw) => {
    expect(normalizeHost(raw)).toBeNull();
  });
});
