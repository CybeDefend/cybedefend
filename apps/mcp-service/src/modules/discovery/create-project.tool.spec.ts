import { GatewayClientService } from '../gateway-client/gateway-client.service';
import { McpToolError } from '../mcp/tools/errors';
import { makeMcpContext } from '../mcp/tools/__test-utils__/make-mcp-context';
import {
  buildCreateProjectTool,
  CreateProjectResult,
} from './create-project.tool';

const ORG = '11111111-1111-4111-8111-111111111111';
const TEAM_A = '22222222-2222-4222-8222-222222222222';
const TEAM_B = '33333333-3333-4333-8333-333333333333';
const PROJECT = '44444444-4444-4444-8444-444444444444';

const ONE_TEAM = { teams: [{ id: TEAM_A, name: 'Core', description: '' }] };
const TWO_TEAMS = {
  teams: [
    { id: TEAM_A, name: 'Core' },
    { id: TEAM_B, name: 'Web' },
  ],
};

function httpError(status: number, message: string): Error {
  return Object.assign(new Error(message), { response: { status } });
}

type GatewayMocks = Record<
  | 'listTeams'
  | 'createProject'
  | 'listGithubRepositories'
  | 'listGitlabRepositories'
  | 'linkGithubRepository'
  | 'linkGitlabRepository',
  jest.Mock
>;

function makeGateway(over: Partial<GatewayMocks> = {}) {
  const mocks: GatewayMocks = {
    listTeams: jest.fn(async () => ONE_TEAM),
    createProject: jest.fn(async () => ({
      projectId: PROJECT,
      organizationId: ORG,
      teamId: TEAM_A,
      teamName: 'Core',
      name: 'web',
    })),
    listGithubRepositories: jest.fn(async () => ({
      repositories: [
        {
          installationId: 1,
          repository: [{ id: 'r-1', fullName: 'acme/web', projectId: '' }],
        },
      ],
    })),
    listGitlabRepositories: jest.fn(async () => ({ repositories: [] })),
    linkGithubRepository: jest.fn(async () => ({})),
    linkGitlabRepository: jest.fn(async () => ({})),
    ...over,
  };
  return { gateway: mocks as unknown as GatewayClientService, mocks };
}

const BASE = { organizationId: ORG, name: 'web', confirmed_by_user: true };

// The cloud edition's no-scan sentence (MCP_EDITION_TEXTS.noScanYetNextStep).
const CLOUD_NO_SCAN_YET =
  'No scan has run yet, so the project has no code graph and no mined rules: ' +
  'start a first scan from the dashboard (upload), or link the repository ' +
  "from the dashboard's integrations.";

function run(
  gateway: GatewayClientService,
  args: Record<string, unknown>,
  accessToken = 'tok',
): Promise<CreateProjectResult> {
  return buildCreateProjectTool(gateway, CLOUD_NO_SCAN_YET).run(
    args,
    makeMcpContext({ accessToken }),
  ) as Promise<CreateProjectResult>;
}

async function toolError(promise: Promise<unknown>): Promise<McpToolError> {
  const err = await promise.catch((e: unknown) => e);
  expect(err).toBeInstanceOf(McpToolError);
  return err as McpToolError;
}

describe('buildCreateProjectTool', () => {
  it('advertises create_project with the confirmation gate in its schema', () => {
    const tool = buildCreateProjectTool(
      makeGateway().gateway,
      CLOUD_NO_SCAN_YET,
    );
    expect(tool.name).toBe('create_project');
    expect(tool.inputSchema).toMatchObject({
      type: 'object',
      required: expect.arrayContaining([
        'organizationId',
        'name',
        'confirmed_by_user',
      ]),
      additionalProperties: false,
    });
    expect(tool.description).toMatch(/explicit yes/i);
    expect(tool.description).toMatch(/\.cybedefend\/config\.json/);
  });

  it.each([false, undefined, 'true', 1])(
    'refuses confirmed_by_user=%p without calling the gateway',
    async (flag) => {
      const { gateway, mocks } = makeGateway();
      const err = await toolError(
        run(gateway, { ...BASE, confirmed_by_user: flag }),
      );
      expect(err.code).toBe('INVALID_ARGUMENT');
      expect(err.message).toMatch(/confirmed_by_user/);
      expect(mocks.listTeams).not.toHaveBeenCalled();
      expect(mocks.createProject).not.toHaveBeenCalled();
    },
  );

  it.each([
    [{ organizationId: 'not-a-uuid' }, /organizationId/],
    [{ name: '   ' }, /name/],
    [{ name: 'x'.repeat(256) }, /name/],
    [{ teamId: 'team-1' }, /teamId/],
    [{ repository: 'acme/web' }, /repository/],
    [{ repository: { provider: 'bitbucket', slug: 'a/b' } }, /provider/],
    [{ repository: { provider: 'github', slug: 'no-owner' } }, /slug/],
  ])('rejects invalid arguments %p', async (patch, pattern) => {
    const { gateway, mocks } = makeGateway();
    const err = await toolError(run(gateway, { ...BASE, ...patch }));
    expect(err.code).toBe('INVALID_ARGUMENT');
    expect(err.message).toMatch(pattern);
    expect(mocks.createProject).not.toHaveBeenCalled();
  });

  it('creates the project in the only team with the trimmed name and the token', async () => {
    const { gateway, mocks } = makeGateway();

    const result = await run(gateway, { ...BASE, name: '  web  ' });

    expect(mocks.listTeams).toHaveBeenCalledWith(ORG, 'tok');
    expect(mocks.createProject).toHaveBeenCalledWith(TEAM_A, 'web', 'tok');
    expect(result).toEqual({
      projectId: PROJECT,
      organizationId: ORG,
      teamId: TEAM_A,
      teamName: 'Core',
      name: 'web',
      nextSteps: [
        expect.stringContaining(`{"projectId": "${PROJECT}"}`),
        expect.stringMatching(/No scan has run yet/),
      ],
    });
  });

  it("uses the edition's no-scan sentence when no repository is linked", async () => {
    const { gateway } = makeGateway();

    const result = (await buildCreateProjectTool(
      gateway,
      'NO-SCAN-SENTENCE',
    ).run(BASE, makeMcpContext({ accessToken: 'tok' }))) as CreateProjectResult;

    expect(result.nextSteps[1]).toBe('NO-SCAN-SENTENCE');
  });

  it.each([{ teamId: '' }, { teamId: null }])(
    'treats %p as no teamId',
    async (patch) => {
      const { gateway, mocks } = makeGateway();
      await run(gateway, { ...BASE, ...patch });
      expect(mocks.createProject).toHaveBeenCalledWith(TEAM_A, 'web', 'tok');
    },
  );

  it('asks for a team when the organization has several, listing them', async () => {
    const { gateway, mocks } = makeGateway({
      listTeams: jest.fn(async () => TWO_TEAMS),
    });

    const err = await toolError(run(gateway, BASE));

    expect(err.code).toBe('INVALID_ARGUMENT');
    expect(err.message).toContain(`Core (${TEAM_A})`);
    expect(err.message).toContain(`Web (${TEAM_B})`);
    expect(mocks.createProject).not.toHaveBeenCalled();
  });

  it('uses the teamId given when it is a team of the organization', async () => {
    const { gateway, mocks } = makeGateway({
      listTeams: jest.fn(async () => TWO_TEAMS),
    });

    await run(gateway, { ...BASE, teamId: TEAM_B });

    expect(mocks.createProject).toHaveBeenCalledWith(TEAM_B, 'web', 'tok');
  });

  it('refuses a teamId that is not a team of the organization', async () => {
    const { gateway, mocks } = makeGateway();

    const err = await toolError(run(gateway, { ...BASE, teamId: TEAM_B }));

    expect(err.code).toBe('INVALID_ARGUMENT');
    expect(err.message).toContain(TEAM_B);
    expect(mocks.createProject).not.toHaveBeenCalled();
  });

  it('fails clearly when no team is visible', async () => {
    const { gateway, mocks } = makeGateway({
      listTeams: jest.fn(async () => ({ teams: [] })),
    });

    const err = await toolError(run(gateway, BASE));

    expect(err.code).toBe('INVALID_ARGUMENT');
    expect(err.message).toMatch(/no team/i);
    expect(mocks.createProject).not.toHaveBeenCalled();
  });

  // The instance may have no plan to upgrade: the tool's own advice names
  // none, whatever the gateway's reason says.
  it('advises deleting a project when the organization holds no more, naming no plan', async () => {
    const { gateway } = makeGateway({
      createProject: jest.fn(async () => {
        throw httpError(429, 'Project limit reached');
      }),
    });

    const err = await toolError(run(gateway, BASE));

    expect(err.code).toBe('RESOURCE_EXHAUSTED');
    expect(err.message).toMatch(/delete a project in the dashboard/);
    expect(err.message).not.toMatch(/\bplan\b|upgrade/i);
  });

  it.each([
    [403, 'Forbidden resource', 'PERMISSION_DENIED', /team manager/],
    [
      409,
      'Project already exists',
      'ALREADY_EXISTS',
      /already exists in team Core/,
    ],
    [
      429,
      'Project limit reached for current plan',
      'RESOURCE_EXHAUSTED',
      /Project limit reached for current plan/,
    ],
  ])(
    'maps a gateway %i on creation to a typed error',
    async (status, upstream, code, pattern) => {
      const { gateway } = makeGateway({
        createProject: jest.fn(async () => {
          throw httpError(status, upstream);
        }),
      });

      const err = await toolError(run(gateway, BASE));

      expect(err.code).toBe(code);
      expect(err.message).toMatch(pattern);
    },
  );

  it('rethrows other creation errors untouched', async () => {
    const boom = httpError(500, 'upstream down');
    const { gateway } = makeGateway({
      createProject: jest.fn(async () => {
        throw boom;
      }),
    });

    await expect(run(gateway, BASE)).rejects.toBe(boom);
  });

  it('links the repository, normalising slug and host, with the organization of the created project', async () => {
    const { gateway, mocks } = makeGateway();

    const result = await run(gateway, {
      ...BASE,
      repository: {
        provider: 'github',
        slug: 'Acme/Web.git',
        host: 'GitHub.com',
      },
    });

    expect(mocks.linkGithubRepository).toHaveBeenCalledWith(
      ORG,
      PROJECT,
      'r-1',
      'tok',
    );
    expect(result.repository).toMatchObject({
      provider: 'github',
      slug: 'Acme/Web',
      status: 'linked',
    });
    expect(result.nextSteps[1]).toMatch(/first scan/);
  });

  it('falls back to the requested organization when the creation response lacks it', async () => {
    const { gateway, mocks } = makeGateway({
      createProject: jest.fn(async () => ({ projectId: PROJECT })),
    });

    const result = await run(gateway, {
      ...BASE,
      repository: { provider: 'github', slug: 'acme/web' },
    });

    expect(result).toMatchObject({
      organizationId: ORG,
      teamId: TEAM_A,
      teamName: 'Core',
      name: 'web',
    });
    expect(mocks.listGithubRepositories).toHaveBeenCalledWith(ORG, 'tok');
  });

  it('returns the project when the link fails after the creation', async () => {
    const { gateway } = makeGateway({
      linkGithubRepository: jest.fn(async () => {
        throw httpError(500, 'boom');
      }),
    });

    const result = await run(gateway, {
      ...BASE,
      repository: { provider: 'github', slug: 'acme/web' },
    });

    expect(result.projectId).toBe(PROJECT);
    expect(result.repository?.status).toBe('failed');
    expect(result.nextSteps[1]).toMatch(/No scan has run yet/);
  });

  it('refuses to create a project for a repository already linked to another one', async () => {
    const { gateway, mocks } = makeGateway({
      listGithubRepositories: jest.fn(async () => ({
        repositories: [
          {
            installationId: 1,
            repository: [
              { id: 'r-1', fullName: 'acme/web', projectId: 'p-other' },
            ],
          },
        ],
      })),
    });

    const err = await toolError(
      run(gateway, {
        ...BASE,
        repository: { provider: 'github', slug: 'acme/web' },
      }),
    );

    expect(err.code).toBe('ALREADY_EXISTS');
    expect(err.message).toContain('p-other');
    expect(err.message).toMatch(/No project was created/);
    expect(err.details).toMatchObject({ linkedProjectId: 'p-other' });
    expect(mocks.createProject).not.toHaveBeenCalled();
  });

  it('still creates when the pre-check cannot list the repositories', async () => {
    const { gateway, mocks } = makeGateway({
      listGithubRepositories: jest.fn(async () => {
        throw httpError(403, 'Forbidden resource');
      }),
    });

    const result = await run(gateway, {
      ...BASE,
      repository: { provider: 'github', slug: 'acme/web' },
    });

    expect(mocks.createProject).toHaveBeenCalled();
    expect(result.repository?.status).toBe('forbidden');
  });

  it('tells the agent to ask before pinning when the repository got linked in the meantime', async () => {
    const free = {
      repositories: [
        {
          installationId: 1,
          repository: [{ id: 'r-1', fullName: 'acme/web', projectId: '' }],
        },
      ],
    };
    const taken = {
      repositories: [
        {
          installationId: 1,
          repository: [
            { id: 'r-1', fullName: 'acme/web', projectId: 'p-other' },
          ],
        },
      ],
    };
    const { gateway, mocks } = makeGateway({
      listGithubRepositories: jest
        .fn()
        .mockResolvedValueOnce(free)
        .mockResolvedValueOnce(taken),
    });

    const result = await run(gateway, {
      ...BASE,
      repository: { provider: 'github', slug: 'acme/web' },
    });

    expect(mocks.createProject).toHaveBeenCalled();
    expect(result.repository?.status).toBe('already_linked');
    expect(result.nextSteps[0]).toMatch(/Ask the user/);
    expect(result.nextSteps[0]).toContain('p-other');
    expect(result.nextSteps[0]).toContain(PROJECT);
  });

  it.each([
    ['https://github.com'],
    ['git@github.com'],
    ['ssh.github.com'],
    [''],
    [null],
  ])('accepts the remote host %p and links on github.com', async (host) => {
    const { gateway, mocks } = makeGateway();

    const result = await run(gateway, {
      ...BASE,
      repository: { provider: 'github', slug: 'acme/web', host },
    });

    expect(result.repository?.status).toBe('linked');
    expect(mocks.linkGithubRepository).toHaveBeenCalled();
  });

  it.each([
    [{ provider: 'github', slug: 'github.com/acme/web' }, /slug/],
    [{ provider: 'github', slug: 'acme/web', host: 'not a host!' }, /host/],
  ])(
    'rejects the malformed repository %p before creating anything',
    async (repository, pattern) => {
      const { gateway, mocks } = makeGateway();

      const err = await toolError(run(gateway, { ...BASE, repository }));

      expect(err.code).toBe('INVALID_ARGUMENT');
      expect(err.message).toMatch(pattern);
      expect(mocks.createProject).not.toHaveBeenCalled();
    },
  );

  it('treats repository: null as no repository', async () => {
    const { gateway, mocks } = makeGateway();

    const result = await run(gateway, { ...BASE, repository: null });

    expect(result.repository).toBeUndefined();
    expect(mocks.listGithubRepositories).not.toHaveBeenCalled();
  });
});
