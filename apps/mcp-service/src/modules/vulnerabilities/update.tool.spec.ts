import { GatewayClientService } from '../gateway-client/gateway-client.service';
import { buildUpdateVulnerabilityTool } from './update.tool';

function makeGatewayStub(): {
  gateway: GatewayClientService;
  update: jest.Mock;
} {
  const update = jest.fn(async () => ({ ok: true }));
  const gateway = {
    updateVulnerability: update,
  } as unknown as GatewayClientService;
  return { gateway, update };
}

describe('buildUpdateVulnerabilityTool', () => {
  it('advertises the canonical name with projectId + vulnerabilityId required and no idempotency fields', () => {
    const { gateway } = makeGatewayStub();
    const tool = buildUpdateVulnerabilityTool(gateway);
    expect(tool.name).toBe('update_vulnerability');
    expect(tool.inputSchema).toMatchObject({
      required: ['projectId', 'vulnerabilityId', 'confirmed_by_user'],
    });
    const props = (tool.inputSchema as { properties: Record<string, unknown> })
      .properties;
    expect(props.toolCallId).toBeUndefined();
    expect(props.idempotencyKey).toBeUndefined();
  });

  it('forwards ids + body (minus path fields) to the gateway', async () => {
    const { gateway, update } = makeGatewayStub();
    const tool = buildUpdateVulnerabilityTool(gateway);

    await tool.run(
      {
        confirmed_by_user: true,
        projectId: 'p',
        vulnerabilityId: 'v',
        status: 'resolved',
        priority: 'low',
        comment: 'fixed in PR 42',
      },
      { userId: 'u', accessToken: 't' },
    );

    expect(update).toHaveBeenCalledWith(
      'p',
      'v',
      { status: 'resolved', priority: 'low', comment: 'fixed in PR 42' },
      't',
      undefined,
    );
  });

  // ── Dismissing a finding requires a justification ──
  // The CONTROL lives in analysis-reporting (`assertDismissalReason`) with a
  // clean 400 from the gateway DTO in front of it. These checks exist so the
  // model is told the rule by the schema + description instead of discovering
  // it through a 400, which costs a round trip on every single dismissal.

  it('declares dismissalReason in its input schema and states the rule in the description', () => {
    const { gateway } = makeGatewayStub();
    const tool = buildUpdateVulnerabilityTool(gateway);
    const props = (tool.inputSchema as { properties: Record<string, any> })
      .properties;
    expect(props.dismissalReason).toBeDefined();
    expect(props.dismissalReason.type).toBe('string');
    expect(props.dismissalReason.maxLength).toBe(512);
    expect(props.dismissalReason.description).toMatch(/ignored/i);
    // The model reads the tool description before the property descriptions;
    // if the requirement is only buried in the property it routinely omits it.
    expect(tool.description).toMatch(/dismissalReason/);
  });

  it('rejects status=ignored with no reason BEFORE calling the gateway', async () => {
    const { gateway, update } = makeGatewayStub();
    const tool = buildUpdateVulnerabilityTool(gateway);
    await expect(
      tool.run(
        {
          confirmed_by_user: true,
          projectId: 'p',
          vulnerabilityId: 'v',
          status: 'ignored',
        },
        { userId: 'u', accessToken: 't' },
      ),
    ).rejects.toThrow(/dismissalReason/);
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects status=ignored with a blank (whitespace-only) reason', async () => {
    const { gateway, update } = makeGatewayStub();
    const tool = buildUpdateVulnerabilityTool(gateway);
    await expect(
      tool.run(
        {
          confirmed_by_user: true,
          projectId: 'p',
          vulnerabilityId: 'v',
          status: 'ignored',
          // The gateway rejects a BLANK reason, not just an absent one
          // (@Matches(/\S/)); trimming to empty must fail here too.
          dismissalReason: ' \t\n ',
        },
        { userId: 'u', accessToken: 't' },
      ),
    ).rejects.toThrow(/dismissalReason/);
    expect(update).not.toHaveBeenCalled();
  });

  it('forwards the reason to the gateway when dismissing with one', async () => {
    const { gateway, update } = makeGatewayStub();
    const tool = buildUpdateVulnerabilityTool(gateway);
    await tool.run(
      {
        confirmed_by_user: true,
        projectId: 'p',
        vulnerabilityId: 'v',
        status: 'ignored',
        dismissalReason: 'not reachable from any entry point',
      },
      { userId: 'u', accessToken: 't' },
    );
    expect(update).toHaveBeenCalledWith(
      'p',
      'v',
      expect.objectContaining({
        status: 'ignored',
        dismissalReason: 'not reachable from any entry point',
      }),
      't',
      undefined,
    );
  });

  it('normalises the reason it forwards: trimmed, or absent when blank', async () => {
    const { gateway, update } = makeGatewayStub();
    const tool = buildUpdateVulnerabilityTool(gateway);

    // Padding would otherwise land verbatim in the exported
    // `dismissal_reason` column and eat into the gateway's 512 cap.
    await tool.run(
      {
        confirmed_by_user: true,
        projectId: 'p',
        vulnerabilityId: 'v',
        status: 'ignored',
        dismissalReason: '  no reachable sink  ',
      },
      { userId: 'u', accessToken: 't' },
    );
    expect((update.mock.calls[0] as unknown[])[2]).toEqual({
      status: 'ignored',
      dismissalReason: 'no reachable sink',
    });

    // A reason attached to a non-dismissal is dropped rather than forwarded as
    // a stray empty string.
    await tool.run(
      {
        confirmed_by_user: true,
        projectId: 'p',
        vulnerabilityId: 'v',
        status: 'confirmed',
        dismissalReason: '   ',
      },
      { userId: 'u', accessToken: 't' },
    );
    expect((update.mock.calls[1] as unknown[])[2]).toEqual({
      status: 'confirmed',
    });
  });

  it('does not require a reason on any other status', async () => {
    const { gateway, update } = makeGatewayStub();
    const tool = buildUpdateVulnerabilityTool(gateway);
    await tool.run(
      {
        confirmed_by_user: true,
        projectId: 'p',
        vulnerabilityId: 'v',
        status: 'resolved',
      },
      { userId: 'u', accessToken: 't' },
    );
    expect(update).toHaveBeenCalledWith(
      'p',
      'v',
      { status: 'resolved' },
      't',
      undefined,
    );
  });

  it('validates token, projectId, and vulnerabilityId', async () => {
    const { gateway } = makeGatewayStub();
    const tool = buildUpdateVulnerabilityTool(gateway);
    await expect(
      tool.run(
        { confirmed_by_user: true, projectId: 'p', vulnerabilityId: 'v' },
        { userId: 'u', accessToken: '' },
      ),
    ).rejects.toThrow(/access token/i);
    await expect(
      tool.run(
        { confirmed_by_user: true, vulnerabilityId: 'v' },
        { userId: 'u', accessToken: 't' },
      ),
    ).rejects.toThrow(/projectId/i);
    await expect(
      tool.run(
        { confirmed_by_user: true, projectId: 'p' },
        { userId: 'u', accessToken: 't' },
      ),
    ).rejects.toThrow(/vulnerabilityId/i);
  });

  // ── A change to a finding needs the user's yes ──
  // Finding text is written by whoever wrote the scanned code or report, and
  // can tell the agent to dismiss findings. The tool refuses a call that does
  // not carry the user's confirmation, and is annotated destructive so
  // clients ask before calling it.

  it('requires confirmed_by_user in its schema and is annotated destructive', () => {
    const tool = buildUpdateVulnerabilityTool(makeGatewayStub().gateway);

    expect((tool.inputSchema as { required: string[] }).required).toContain(
      'confirmed_by_user',
    );
    expect(tool.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
    });
    expect(tool.description).toMatch(/confirmed_by_user/);
  });

  it('refuses a call without confirmed_by_user: true, before calling the gateway', async () => {
    const { gateway, update } = makeGatewayStub();
    const tool = buildUpdateVulnerabilityTool(gateway);

    for (const confirmed of [undefined, false, 'true']) {
      await expect(
        tool.run(
          {
            ...{ projectId: 'p', vulnerabilityId: 'v', status: 'resolved' },
            confirmed_by_user: confirmed,
          },
          { userId: 'u', accessToken: 't' },
        ),
      ).rejects.toMatchObject({
        code: 'INVALID_ARGUMENT',
        message: expect.stringContaining('confirmed_by_user'),
      });
    }
    expect(update).not.toHaveBeenCalled();
  });

  it('sends the gateway neither the confirmation nor the retry keys in the body', async () => {
    const { gateway, update } = makeGatewayStub();
    const tool = buildUpdateVulnerabilityTool(gateway);

    await tool.run(
      {
        ...{ projectId: 'p', vulnerabilityId: 'v', status: 'resolved' },
        confirmed_by_user: true,
        idempotencyKey: 'k-1',
        toolCallId: 'tc-1',
      },
      { userId: 'u', accessToken: 't' },
    );

    const call = update.mock.calls[0] as unknown[];
    const body = call[2] as Record<string, unknown>;
    expect(body).not.toHaveProperty('confirmed_by_user');
    expect(body).not.toHaveProperty('idempotencyKey');
    expect(body).not.toHaveProperty('toolCallId');
    expect(call[4]).toBe('k-1');
  });

  it('refuses a call that changes nothing', async () => {
    const { gateway, update } = makeGatewayStub();
    const tool = buildUpdateVulnerabilityTool(gateway);

    await expect(
      tool.run(
        { projectId: 'p', vulnerabilityId: 'v', confirmed_by_user: true },
        { userId: 'u', accessToken: 't' },
      ),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(update).not.toHaveBeenCalled();
  });
});
