import { GatewayClientService } from '../gateway-client/gateway-client.service';
import { buildGetProjectOverviewTool } from './overview.tool';

function makeGatewayStub(): {
  gateway: GatewayClientService;
  getOverview: jest.Mock;
} {
  const getOverview = jest.fn(async () => ({ totals: {} }));
  const gateway = {
    getProjectOverview: getOverview,
  } as unknown as GatewayClientService;
  return { gateway, getOverview };
}

describe('buildGetProjectOverviewTool', () => {
  it('advertises the canonical name and marks projectId as required', () => {
    const { gateway } = makeGatewayStub();
    const tool = buildGetProjectOverviewTool(gateway);
    expect(tool.name).toBe('get_project_overview');
    expect(tool.inputSchema).toMatchObject({
      type: 'object',
      required: ['projectId'],
    });
  });

  it('forwards trimmed projectId and string-only branches to the gateway', async () => {
    const { gateway, getOverview } = makeGatewayStub();
    const tool = buildGetProjectOverviewTool(gateway);

    const result = await tool.run(
      { projectId: '  p-1  ', branches: ['main', 42, 'develop'] },
      { userId: 'u', accessToken: 't' },
    );

    expect(getOverview).toHaveBeenCalledWith('p-1', ['main', 'develop'], 't');
    expect(result).toEqual({ totals: {} });
  });

  it('throws when projectId is omitted', async () => {
    const { gateway, getOverview } = makeGatewayStub();
    const tool = buildGetProjectOverviewTool(gateway);

    await expect(
      tool.run({}, { userId: 'u', accessToken: 't' }),
    ).rejects.toThrow(/projectId is required/i);
    expect(getOverview).not.toHaveBeenCalled();
  });

  it('throws on missing access token and does not call the gateway', async () => {
    const { gateway, getOverview } = makeGatewayStub();
    const tool = buildGetProjectOverviewTool(gateway);

    await expect(
      tool.run({ projectId: 'p' }, { userId: 'u', accessToken: '' }),
    ).rejects.toThrow(/access token/i);
    expect(getOverview).not.toHaveBeenCalled();
  });
});
