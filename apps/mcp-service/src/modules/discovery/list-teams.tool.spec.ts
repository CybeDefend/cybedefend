import { GatewayClientService } from '../gateway-client/gateway-client.service';
import { McpToolError } from '../mcp/tools/errors';
import { makeMcpContext } from '../mcp/tools/__test-utils__/make-mcp-context';
import { buildListTeamsTool, readTeams } from './list-teams.tool';

function makeGateway(listTeams: jest.Mock) {
  return { listTeams } as unknown as GatewayClientService;
}

describe('buildListTeamsTool', () => {
  it('advertises list_teams with organizationId required', () => {
    const tool = buildListTeamsTool(makeGateway(jest.fn()));
    expect(tool.name).toBe('list_teams');
    expect(tool.inputSchema).toMatchObject({
      type: 'object',
      required: ['organizationId'],
      additionalProperties: false,
    });
    expect(tool.description).toMatch(/create_project/);
  });

  it('forwards the trimmed organizationId and token, and slims the teams', async () => {
    const listTeams = jest.fn(async () => ({
      teams: [
        {
          id: 't-1',
          name: 'Core',
          description: 'Platform',
          createdAt: '2026-01-01',
          updatedAt: '2026-01-02',
        },
        { name: 'no id, dropped' },
      ],
    }));
    const tool = buildListTeamsTool(makeGateway(listTeams));

    const result = await tool.run(
      { organizationId: '  o-1  ' },
      makeMcpContext({ accessToken: 'tok' }),
    );

    expect(listTeams).toHaveBeenCalledWith('o-1', 'tok');
    expect(result).toEqual({
      teams: [{ id: 't-1', name: 'Core', description: 'Platform' }],
    });
  });

  it('rejects a missing organizationId without calling the gateway', async () => {
    const listTeams = jest.fn();
    const tool = buildListTeamsTool(makeGateway(listTeams));

    const err = await tool.run({}, makeMcpContext()).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(McpToolError);
    expect((err as McpToolError).code).toBe('INVALID_ARGUMENT');
    expect(listTeams).not.toHaveBeenCalled();
  });

  it('throws on a missing access token', async () => {
    const tool = buildListTeamsTool(makeGateway(jest.fn()));
    await expect(
      tool.run({ organizationId: 'o-1' }, makeMcpContext({ accessToken: '' })),
    ).rejects.toThrow(/access token/i);
  });

  it('propagates gateway errors untouched', async () => {
    const boom = Object.assign(new Error('Forbidden resource'), {
      response: { status: 403 },
    });
    const tool = buildListTeamsTool(
      makeGateway(
        jest.fn(async () => {
          throw boom;
        }),
      ),
    );
    await expect(
      tool.run({ organizationId: 'o-1' }, makeMcpContext()),
    ).rejects.toBe(boom);
  });
});

describe('readTeams', () => {
  it('returns [] for anything that is not { teams: [...] }', () => {
    expect(readTeams(null)).toEqual([]);
    expect(readTeams({ teams: 'x' })).toEqual([]);
    expect(readTeams([])).toEqual([]);
  });
});
