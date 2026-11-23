import { GatewayClientService } from '../gateway-client/gateway-client.service';
import { buildListVulnerabilitiesContainerTool } from './list-container.tool';
import { prepareToolArguments } from '../mcp/shared/tool-input';

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

describe('buildListVulnerabilitiesContainerTool', () => {
  it('advertises the canonical name with projectId required', () => {
    const { gateway } = makeGatewayStub();
    const tool = buildListVulnerabilitiesContainerTool(gateway);
    expect(tool.name).toBe('list_vulnerabilities_container');
    expect(tool.inputSchema).toMatchObject({ required: ['projectId'] });
  });

  // The gateway lower-cases `order` for every scanner, and the other list
  // tools advertise lowercase: a caller that sends `desc` to every list tool
  // (the chat agent's default sort does) must not be refused here.
  it.each(['asc', 'desc', 'ASC', 'DESC'])(
    'accepts order %s through the argument check',
    (order) => {
      const { gateway } = makeGatewayStub();
      const tool = buildListVulnerabilitiesContainerTool(gateway);
      const prepared = prepareToolArguments(tool, {
        projectId: '6b0f4a52-3c1d-4e8b-9a7f-2d5c8e1f0a93',
        sort: 'currentSeverity',
        order,
      });
      expect(prepared).toEqual({
        args: expect.objectContaining({ order }),
      });
    },
  );

  it('still refuses an order that is neither ascending nor descending', () => {
    const { gateway } = makeGatewayStub();
    const tool = buildListVulnerabilitiesContainerTool(gateway);
    const prepared = prepareToolArguments(tool, {
      projectId: '6b0f4a52-3c1d-4e8b-9a7f-2d5c8e1f0a93',
      order: 'sideways',
    });
    expect(prepared).toHaveProperty('error');
  });

  it('keeps the container page/limit/imageId keys', () => {
    const { gateway } = makeGatewayStub();
    const tool = buildListVulnerabilitiesContainerTool(gateway);
    const props = (
      tool.inputSchema as {
        properties: {
          page: unknown;
          limit: unknown;
          imageId: unknown;
        };
      }
    ).properties;
    expect(props.page).toBeDefined();
    expect(props.limit).toBeDefined();
    expect(props.imageId).toBeDefined();
  });

  it('forwards scanner=container and query (including imageId)', async () => {
    const { gateway, listVulns } = makeGatewayStub();
    const tool = buildListVulnerabilitiesContainerTool(gateway);
    await tool.run(
      { projectId: 'p', imageId: 'img-1', order: 'DESC' },
      { userId: 'u', accessToken: 't' },
    );
    expect(listVulns).toHaveBeenCalledWith(
      'p',
      'container',
      { imageId: 'img-1', order: 'DESC' },
      't',
    );
  });

  it('throws on missing token', async () => {
    const { gateway } = makeGatewayStub();
    const tool = buildListVulnerabilitiesContainerTool(gateway);
    await expect(
      tool.run({ projectId: 'p' }, { userId: 'u', accessToken: '' }),
    ).rejects.toThrow(/access token/i);
  });

  it('throws when projectId is omitted', async () => {
    const { gateway, listVulns } = makeGatewayStub();
    const tool = buildListVulnerabilitiesContainerTool(gateway);
    await expect(
      tool.run({}, { userId: 'u', accessToken: 't' }),
    ).rejects.toThrow(/projectId is required/i);
    expect(listVulns).not.toHaveBeenCalled();
  });
});
