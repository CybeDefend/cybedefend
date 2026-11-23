import { GatewayClientService } from '../gateway-client/gateway-client.service';
import { buildGetVulnerabilitySastTool } from './get-sast.tool';

function makeGatewayStub(): {
  gateway: GatewayClientService;
  getVuln: jest.Mock;
} {
  const getVuln = jest.fn(async () => ({ id: 'v-1' }));
  const gateway = {
    getVulnerability: getVuln,
  } as unknown as GatewayClientService;
  return { gateway, getVuln };
}

describe('buildGetVulnerabilitySastTool', () => {
  it('advertises the canonical name and requires projectId + vulnerabilityId', () => {
    const { gateway } = makeGatewayStub();
    const tool = buildGetVulnerabilitySastTool(gateway);
    expect(tool.name).toBe('get_vulnerability_sast');
    expect(tool.inputSchema).toMatchObject({
      type: 'object',
      required: expect.arrayContaining(['projectId', 'vulnerabilityId']),
    });
  });

  it('forwards trimmed ids and returns the gateway payload', async () => {
    const { gateway, getVuln } = makeGatewayStub();
    const tool = buildGetVulnerabilitySastTool(gateway);

    const result = await tool.run(
      { projectId: ' p-1 ', vulnerabilityId: ' v-1 ' },
      { userId: 'u', accessToken: 't' },
    );

    expect(getVuln).toHaveBeenCalledWith('p-1', 'sast', 'v-1', 't');
    expect(result).toEqual({ id: 'v-1' });
  });

  it('throws on missing access token', async () => {
    const { gateway, getVuln } = makeGatewayStub();
    const tool = buildGetVulnerabilitySastTool(gateway);
    await expect(
      tool.run(
        { projectId: 'p', vulnerabilityId: 'v' },
        { userId: 'u', accessToken: '' },
      ),
    ).rejects.toThrow(/access token/i);
    expect(getVuln).not.toHaveBeenCalled();
  });

  it('throws on missing projectId', async () => {
    const { gateway, getVuln } = makeGatewayStub();
    const tool = buildGetVulnerabilitySastTool(gateway);
    await expect(
      tool.run({ vulnerabilityId: 'v' }, { userId: 'u', accessToken: 't' }),
    ).rejects.toThrow(/projectId/i);
    expect(getVuln).not.toHaveBeenCalled();
  });

  it('throws on missing vulnerabilityId', async () => {
    const { gateway, getVuln } = makeGatewayStub();
    const tool = buildGetVulnerabilitySastTool(gateway);
    await expect(
      tool.run({ projectId: 'p' }, { userId: 'u', accessToken: 't' }),
    ).rejects.toThrow(/vulnerabilityId/i);
    expect(getVuln).not.toHaveBeenCalled();
  });

  describe('MCP cross-project semantics', () => {});
});
