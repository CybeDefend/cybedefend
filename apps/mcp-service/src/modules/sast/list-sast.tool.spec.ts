import { GatewayClientService } from '../gateway-client/gateway-client.service';
import { buildListVulnerabilitiesSastTool } from './list-sast.tool';

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

describe('buildListVulnerabilitiesSastTool', () => {
  it('advertises the canonical name with projectId required', () => {
    const { gateway } = makeGatewayStub();
    const tool = buildListVulnerabilitiesSastTool(gateway);
    expect(tool.name).toBe('list_vulnerabilities_sast');
    expect(tool.inputSchema).toMatchObject({
      type: 'object',
      required: ['projectId'],
    });
  });

  it('forwards the query minus projectId to the gateway', async () => {
    const { gateway, listVulns } = makeGatewayStub();
    const tool = buildListVulnerabilitiesSastTool(gateway);

    const result = await tool.run(
      {
        projectId: 'p-1',
        severity: ['high'],
        status: ['to_verify'],
        branch: 'main',
        pageNumber: 2,
      },
      { userId: 'u', accessToken: 't' },
    );

    expect(listVulns).toHaveBeenCalledWith(
      'p-1',
      'sast',
      {
        severity: ['high'],
        status: ['to_verify'],
        branch: 'main',
        pageNumber: 2,
      },
      't',
    );
    expect(result).toEqual({ vulnerabilities: [] });
  });

  it('throws on missing access token', async () => {
    const { gateway, listVulns } = makeGatewayStub();
    const tool = buildListVulnerabilitiesSastTool(gateway);
    await expect(
      tool.run({ projectId: 'p' }, { userId: 'u', accessToken: '' }),
    ).rejects.toThrow(/access token/i);
    expect(listVulns).not.toHaveBeenCalled();
  });

  it('throws when projectId is omitted', async () => {
    const { gateway, listVulns } = makeGatewayStub();
    const tool = buildListVulnerabilitiesSastTool(gateway);
    await expect(
      tool.run({}, { userId: 'u', accessToken: 't' }),
    ).rejects.toThrow(/projectId is required/i);
    expect(listVulns).not.toHaveBeenCalled();
  });
});
