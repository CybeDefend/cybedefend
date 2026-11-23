import { GatewayClientService } from '../gateway-client/gateway-client.service';
import { buildSearchProjectsTool } from './search-projects.tool';

function makeGatewayStub(): {
  gateway: GatewayClientService;
  listProjects: jest.Mock;
} {
  const listProjects = jest.fn(async () => ({
    projects: [{ projectId: 'p-1', name: 'API' }],
    totalProjects: 1,
    totalPages: 1,
  }));
  const gateway = { listProjects } as unknown as GatewayClientService;
  return { gateway, listProjects };
}

describe('buildSearchProjectsTool', () => {
  it('advertises the canonical name with organizationId required', () => {
    const { gateway } = makeGatewayStub();
    const tool = buildSearchProjectsTool(gateway);
    expect(tool.name).toBe('search_projects');
    expect(tool.inputSchema).toMatchObject({
      type: 'object',
      required: ['organizationId'],
    });
  });

  it('forwards trimmed organizationId, search, and pagination to the gateway', async () => {
    const { gateway, listProjects } = makeGatewayStub();
    const tool = buildSearchProjectsTool(gateway);

    const result = await tool.run(
      { organizationId: '  org-1  ', search: 'api', page: 2, pageSize: 5 },
      { userId: 'u', accessToken: 't' },
    );

    expect(listProjects).toHaveBeenCalledWith(
      'org-1',
      { search: 'api', page: 2, pageSize: 5 },
      't',
    );
    expect(result).toEqual({
      projects: [{ projectId: 'p-1', name: 'API' }],
      totalProjects: 1,
      totalPages: 1,
    });
  });

  it('omits empty/whitespace search and applies sensible default pagination', async () => {
    const { gateway, listProjects } = makeGatewayStub();
    const tool = buildSearchProjectsTool(gateway);

    await tool.run(
      { organizationId: 'org-1', search: '   ' },
      { userId: 'u', accessToken: 't' },
    );

    expect(listProjects).toHaveBeenCalledWith(
      'org-1',
      { page: 1, pageSize: 10 },
      't',
    );
  });

  it('clamps pageSize at the upstream cap (10) so the gateway never returns 400', async () => {
    const { gateway, listProjects } = makeGatewayStub();
    const tool = buildSearchProjectsTool(gateway);

    await tool.run(
      { organizationId: 'org-1', pageSize: 50 },
      { userId: 'u', accessToken: 't' },
    );

    expect(listProjects).toHaveBeenCalledWith(
      'org-1',
      { page: 1, pageSize: 10 },
      't',
    );
  });

  it('coerces numeric strings for page/pageSize so JSON-Schema-strict clients still work', async () => {
    const { gateway, listProjects } = makeGatewayStub();
    const tool = buildSearchProjectsTool(gateway);

    await tool.run(
      { organizationId: 'org-1', page: '3', pageSize: '10' },
      { userId: 'u', accessToken: 't' },
    );

    expect(listProjects).toHaveBeenCalledWith(
      'org-1',
      { page: 3, pageSize: 10 },
      't',
    );
  });

  it('throws on missing access token and does not call the gateway', async () => {
    const { gateway, listProjects } = makeGatewayStub();
    const tool = buildSearchProjectsTool(gateway);

    await expect(
      tool.run({ organizationId: 'o' }, { userId: 'u', accessToken: '' }),
    ).rejects.toThrow(/access token/i);
    expect(listProjects).not.toHaveBeenCalled();
  });

  it('throws when organizationId is omitted', async () => {
    const { gateway, listProjects } = makeGatewayStub();
    const tool = buildSearchProjectsTool(gateway);

    await expect(
      tool.run({}, { userId: 'u', accessToken: 't' }),
    ).rejects.toThrow(/organizationId/i);
    expect(listProjects).not.toHaveBeenCalled();
  });

  it('throws on whitespace-only organizationId', async () => {
    const { gateway, listProjects } = makeGatewayStub();
    const tool = buildSearchProjectsTool(gateway);

    await expect(
      tool.run({ organizationId: '   ' }, { userId: 'u', accessToken: 't' }),
    ).rejects.toThrow(/organizationId/i);
    expect(listProjects).not.toHaveBeenCalled();
  });
});
