import { GatewayClientService } from '../gateway-client/gateway-client.service';
import { buildListVulnerabilitiesScaTool } from './list-sca.tool';

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

describe('buildListVulnerabilitiesScaTool', () => {
  it('advertises the canonical name with projectId required', () => {
    const { gateway } = makeGatewayStub();
    const tool = buildListVulnerabilitiesScaTool(gateway);
    expect(tool.name).toBe('list_vulnerabilities_sca');
    expect(tool.inputSchema).toMatchObject({
      type: 'object',
      required: ['projectId'],
    });
  });

  it('exposes SCA-specific sort enum values (currentCVSS, updatedAt)', () => {
    const { gateway } = makeGatewayStub();
    const tool = buildListVulnerabilitiesScaTool(gateway);
    const sort = (
      tool.inputSchema as { properties: { sort: { enum: string[] } } }
    ).properties.sort;
    expect(sort.enum).toEqual(
      expect.arrayContaining(['currentCVSS', 'updatedAt']),
    );
  });

  it('forwards the query minus projectId to the sca gateway method', async () => {
    const { gateway, listVulns } = makeGatewayStub();
    const tool = buildListVulnerabilitiesScaTool(gateway);

    await tool.run(
      { projectId: 'p', severity: ['low'], packageType: ['direct'] },
      { userId: 'u', accessToken: 't' },
    );

    expect(listVulns).toHaveBeenCalledWith(
      'p',
      'sca',
      { severity: ['low'], packageType: ['direct'] },
      't',
    );
  });

  it('throws on missing access token', async () => {
    const { gateway } = makeGatewayStub();
    const tool = buildListVulnerabilitiesScaTool(gateway);
    await expect(
      tool.run({ projectId: 'p' }, { userId: 'u', accessToken: '' }),
    ).rejects.toThrow(/access token/i);
  });

  it('throws when projectId is omitted', async () => {
    const { gateway, listVulns } = makeGatewayStub();
    const tool = buildListVulnerabilitiesScaTool(gateway);
    await expect(
      tool.run({}, { userId: 'u', accessToken: 't' }),
    ).rejects.toThrow(/projectId is required/i);
    expect(listVulns).not.toHaveBeenCalled();
  });
});
