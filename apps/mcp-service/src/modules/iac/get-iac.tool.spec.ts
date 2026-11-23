import { GatewayClientService } from '../gateway-client/gateway-client.service';
import { buildGetVulnerabilityIacTool } from './get-iac.tool';

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

describe('buildGetVulnerabilityIacTool', () => {
  it('advertises the canonical name and required fields', () => {
    const { gateway } = makeGatewayStub();
    const tool = buildGetVulnerabilityIacTool(gateway);
    expect(tool.name).toBe('get_vulnerability_iac');
    expect(tool.inputSchema).toMatchObject({
      required: expect.arrayContaining(['projectId', 'vulnerabilityId']),
    });
  });

  it('forwards to gateway.getVulnerability with scanner=iac', async () => {
    const { gateway, getVuln } = makeGatewayStub();
    const tool = buildGetVulnerabilityIacTool(gateway);
    await tool.run(
      { projectId: 'p', vulnerabilityId: 'v' },
      { userId: 'u', accessToken: 't' },
    );
    expect(getVuln).toHaveBeenCalledWith('p', 'iac', 'v', 't');
  });

  it('validates token, projectId, and vulnerabilityId', async () => {
    const { gateway } = makeGatewayStub();
    const tool = buildGetVulnerabilityIacTool(gateway);
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
