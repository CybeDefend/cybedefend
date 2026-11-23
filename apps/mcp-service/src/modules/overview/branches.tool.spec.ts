import { GatewayClientService } from '../gateway-client/gateway-client.service';
import { buildGetBranchesTool } from './branches.tool';

function makeGatewayStub(): {
  gateway: GatewayClientService;
  getBranches: jest.Mock;
} {
  const getBranches = jest.fn(async () => ['main', 'develop']);
  const gateway = { getBranches } as unknown as GatewayClientService;
  return { gateway, getBranches };
}

describe('buildGetBranchesTool', () => {
  it('advertises the canonical name and required projectId', () => {
    const { gateway } = makeGatewayStub();
    const tool = buildGetBranchesTool(gateway);
    expect(tool.name).toBe('get_branches');
    expect(tool.inputSchema).toMatchObject({
      type: 'object',
      required: ['projectId'],
    });
  });

  it('forwards trimmed projectId and accessToken, returning the gateway payload', async () => {
    const { gateway, getBranches } = makeGatewayStub();
    const tool = buildGetBranchesTool(gateway);
    const result = await tool.run(
      { projectId: '  p-1  ' },
      { userId: 'u', accessToken: 't' },
    );
    expect(getBranches).toHaveBeenCalledWith('p-1', 't');
    expect(result).toEqual(['main', 'develop']);
  });

  it('throws on missing access token', async () => {
    const { gateway, getBranches } = makeGatewayStub();
    const tool = buildGetBranchesTool(gateway);
    await expect(
      tool.run({ projectId: 'p' }, { userId: 'u', accessToken: '' }),
    ).rejects.toThrow(/access token/i);
    expect(getBranches).not.toHaveBeenCalled();
  });

  it('throws on missing projectId', async () => {
    const { gateway, getBranches } = makeGatewayStub();
    const tool = buildGetBranchesTool(gateway);
    await expect(
      tool.run({}, { userId: 'u', accessToken: 't' }),
    ).rejects.toThrow(/projectId/i);
    expect(getBranches).not.toHaveBeenCalled();
  });

  describe('MCP cross-project semantics', () => {});
});
