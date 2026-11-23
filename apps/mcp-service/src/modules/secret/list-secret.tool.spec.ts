import { GatewayClientService } from '../gateway-client/gateway-client.service';
import { buildListVulnerabilitiesSecretTool } from './list-secret.tool';

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

describe('buildListVulnerabilitiesSecretTool', () => {
  it('advertises the canonical name with projectId required', () => {
    const { gateway } = makeGatewayStub();
    const tool = buildListVulnerabilitiesSecretTool(gateway);
    expect(tool.name).toBe('list_vulnerabilities_secret');
    expect(tool.inputSchema).toMatchObject({ required: ['projectId'] });
  });

  it('forwards scanner=secret to the gateway', async () => {
    const { gateway, listVulns } = makeGatewayStub();
    const tool = buildListVulnerabilitiesSecretTool(gateway);
    await tool.run(
      { projectId: 'p', severity: ['critical'] },
      { userId: 'u', accessToken: 't' },
    );
    expect(listVulns).toHaveBeenCalledWith(
      'p',
      'secret',
      { severity: ['critical'] },
      't',
    );
  });

  it('throws on missing token', async () => {
    const { gateway } = makeGatewayStub();
    const tool = buildListVulnerabilitiesSecretTool(gateway);
    await expect(
      tool.run({ projectId: 'p' }, { userId: 'u', accessToken: '' }),
    ).rejects.toThrow(/access token/i);
  });

  it('throws when projectId is omitted', async () => {
    const { gateway, listVulns } = makeGatewayStub();
    const tool = buildListVulnerabilitiesSecretTool(gateway);
    await expect(
      tool.run({}, { userId: 'u', accessToken: 't' }),
    ).rejects.toThrow(/projectId is required/i);
    expect(listVulns).not.toHaveBeenCalled();
  });
});
