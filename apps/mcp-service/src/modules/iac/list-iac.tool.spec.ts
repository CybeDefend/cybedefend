import { GatewayClientService } from '../gateway-client/gateway-client.service';
import { buildListVulnerabilitiesIacTool } from './list-iac.tool';

function makeGatewayStub(): {
  gateway: GatewayClientService;
  listVulns: jest.Mock;
} {
  const listVulns = jest.fn(async () => ({ vulnerabilities: [] }));
  const gateway = {
    listVulnerabilities: listVulns,
  } as unknown as GatewayClientService;
  return { gateway, listVulns };
}

describe('buildListVulnerabilitiesIacTool', () => {
  it('advertises the canonical name with projectId required', () => {
    const { gateway } = makeGatewayStub();
    const tool = buildListVulnerabilitiesIacTool(gateway);
    expect(tool.name).toBe('list_vulnerabilities_iac');
    expect(tool.inputSchema).toMatchObject({ required: ['projectId'] });
  });

  it('forwards scanner=iac and the query verbatim (minus projectId)', async () => {
    const { gateway, listVulns } = makeGatewayStub();
    const tool = buildListVulnerabilitiesIacTool(gateway);
    await tool.run(
      { projectId: 'p', branch: 'main' },
      { userId: 'u', accessToken: 't' },
    );
    expect(listVulns).toHaveBeenCalledWith('p', 'iac', { branch: 'main' }, 't');
  });

  it('throws on missing token', async () => {
    const { gateway } = makeGatewayStub();
    const tool = buildListVulnerabilitiesIacTool(gateway);
    await expect(
      tool.run({ projectId: 'p' }, { userId: 'u', accessToken: '' }),
    ).rejects.toThrow(/access token/i);
  });

  it('throws when projectId is omitted', async () => {
    const { gateway, listVulns } = makeGatewayStub();
    const tool = buildListVulnerabilitiesIacTool(gateway);
    await expect(
      tool.run({}, { userId: 'u', accessToken: 't' }),
    ).rejects.toThrow(/projectId is required/i);
    expect(listVulns).not.toHaveBeenCalled();
  });
});
