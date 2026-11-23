import { GatewayClientService } from '../gateway-client/gateway-client.service';
import { buildGetVulnerabilityCicdTool } from './get-cicd.tool';

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

describe('buildGetVulnerabilityCicdTool', () => {
  it('advertises the canonical name and required fields', () => {
    const { gateway } = makeGatewayStub();
    const tool = buildGetVulnerabilityCicdTool(gateway);
    expect(tool.name).toBe('get_vulnerability_cicd');
    expect(tool.inputSchema).toMatchObject({
      required: expect.arrayContaining(['projectId', 'vulnerabilityId']),
    });
  });

  it('forwards to gateway.getVulnerability with scanner=cicd', async () => {
    const { gateway, getVuln } = makeGatewayStub();
    const tool = buildGetVulnerabilityCicdTool(gateway);
    await tool.run(
      { projectId: 'p', vulnerabilityId: 'v' },
      { userId: 'u', accessToken: 't' },
    );
    expect(getVuln).toHaveBeenCalledWith('p', 'cicd', 'v', 't');
  });

  it('validates token, projectId, and vulnerabilityId', async () => {
    const { gateway } = makeGatewayStub();
    const tool = buildGetVulnerabilityCicdTool(gateway);
    await expect(
      tool.run(
        { projectId: 'p', vulnerabilityId: 'v' },
        { userId: 'u', accessToken: '' },
      ),
    ).rejects.toThrow(/access token/i);
    await expect(
      tool.run({ vulnerabilityId: 'v' }, { userId: 'u', accessToken: 't' }),
    ).rejects.toThrow(/projectId/i);
    await expect(
      tool.run({ projectId: 'p' }, { userId: 'u', accessToken: 't' }),
    ).rejects.toThrow(/vulnerabilityId/i);
  });

  describe('MCP cross-project semantics', () => {});
});
