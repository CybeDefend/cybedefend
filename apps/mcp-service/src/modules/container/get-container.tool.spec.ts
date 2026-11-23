import { GatewayClientService } from '../gateway-client/gateway-client.service';
import { buildGetVulnerabilityContainerTool } from './get-container.tool';

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

describe('buildGetVulnerabilityContainerTool', () => {
  it('advertises the canonical name and required fields', () => {
    const { gateway } = makeGatewayStub();
    const tool = buildGetVulnerabilityContainerTool(gateway);
    expect(tool.name).toBe('get_vulnerability_container');
    expect(tool.inputSchema).toMatchObject({
      required: expect.arrayContaining(['projectId', 'vulnerabilityId']),
    });
  });

  it('forwards to gateway.getVulnerability with scanner=container', async () => {
    const { gateway, getVuln } = makeGatewayStub();
    const tool = buildGetVulnerabilityContainerTool(gateway);
    await tool.run(
      { projectId: 'p', vulnerabilityId: 'v' },
      { userId: 'u', accessToken: 't' },
    );
    expect(getVuln).toHaveBeenCalledWith('p', 'container', 'v', 't');
  });

  it('validates token, projectId, and vulnerabilityId', async () => {
    const { gateway } = makeGatewayStub();
    const tool = buildGetVulnerabilityContainerTool(gateway);
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
