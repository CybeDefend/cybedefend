import { GatewayClientService } from '../gateway-client/gateway-client.service';
import { buildListOrganizationsTool } from './list-organizations.tool';

/**
 * Specs the `list_organizations` adapter — the entry point an AI agent uses
 * before any project-scoped tool. Focus areas mirror the other discovery
 * tools:
 *  - Canonical name + empty-required-list contract.
 *  - `run` forwards the access token and pipes the gateway payload through.
 *  - Missing token short-circuits before the gateway is touched.
 */
function makeGatewayStub(): {
  gateway: GatewayClientService;
  listOrganizations: jest.Mock;
} {
  const listOrganizations = jest.fn(async () => ({
    organizations: [{ id: 'o-1', name: 'Acme' }],
  }));
  const gateway = {
    listOrganizations,
  } as unknown as GatewayClientService;
  return { gateway, listOrganizations };
}

describe('buildListOrganizationsTool', () => {
  it('advertises the canonical name, description, and an empty required list', () => {
    const { gateway } = makeGatewayStub();
    const tool = buildListOrganizationsTool(gateway);
    expect(tool.name).toBe('list_organizations');
    expect(typeof tool.description).toBe('string');
    expect(tool.description.length).toBeGreaterThan(0);
    expect(tool.inputSchema).toMatchObject({
      type: 'object',
      properties: {},
    });
    // No required arguments — the user identity is inferred from the bearer
    // token, so the tool must be callable with `{}` by AI clients.
    expect((tool.inputSchema as { required?: unknown }).required ?? []).toEqual(
      [],
    );
  });

  it('forwards the access token and returns the gateway payload verbatim', async () => {
    const { gateway, listOrganizations } = makeGatewayStub();
    const tool = buildListOrganizationsTool(gateway);

    const result = await tool.run({}, { userId: 'u', accessToken: 't' });

    expect(listOrganizations).toHaveBeenCalledWith('t');
    expect(result).toEqual({
      organizations: [{ id: 'o-1', name: 'Acme' }],
    });
  });

  it('throws on missing access token and does not call the gateway', async () => {
    const { gateway, listOrganizations } = makeGatewayStub();
    const tool = buildListOrganizationsTool(gateway);

    await expect(
      tool.run({}, { userId: 'u', accessToken: '' }),
    ).rejects.toThrow(/access token/i);
    expect(listOrganizations).not.toHaveBeenCalled();
  });
});
