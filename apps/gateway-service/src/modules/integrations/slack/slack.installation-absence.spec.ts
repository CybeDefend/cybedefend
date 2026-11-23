import { SlackController } from './slack.controller';

/**
 * "No Slack integration for this organization" is answered with
 * isConfigured=false and HTTP 200 — not an error. Rationale in
 * libs/protos/external-integrations/slack.proto.
 *
 * The controller is a pass-through: it must NOT invent an HTTP status of its
 * own. 40 of the gateway's 43 controllers delegate error mapping to
 * safeGrpcCall, and that is the convention here too.
 *
 * The critical case is the last one. A real transport failure must NEVER be
 * flattened into "not configured": if external-integrations is unreachable, the
 * client has to learn that something broke, not that Slack is absent. That is
 * the difference between an outage and a silent wrong answer.
 */
describe('SlackController.getInstallation — absence is 200, failure still fails', () => {
  const ORG = '11111111-1111-4111-8111-111111111111';

  const build = (impl: jest.Mock) => {
    const service = { getInstallationForOrga: impl };
    return new SlackController(
      service as any,
      {
        log: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
      } as any,
      {} as any,
    );
  };

  it('returns isConfigured=false with no error when the integration is absent', async () => {
    const absent = { isConfigured: false, id: '', organizationId: '' };
    const controller = build(jest.fn().mockResolvedValue(absent));

    await expect(controller.getInstallation(ORG)).resolves.toEqual(absent);
  });

  it('returns the installation unchanged when one exists', async () => {
    const installed = {
      isConfigured: true,
      id: 'inst-1',
      organizationId: 'org-1',
    };
    const controller = build(jest.fn().mockResolvedValue(installed));

    await expect(controller.getInstallation(ORG)).resolves.toEqual(installed);
  });

  it('propagates a transport failure instead of reporting "not configured"', async () => {
    // What safeGrpcCall raises when external-integrations is down: an
    // HttpException carrying the mapped status. It must reach the client.
    const unavailable = Object.assign(new Error('Service unavailable'), {
      status: 503,
    });
    const controller = build(jest.fn().mockRejectedValue(unavailable));

    await expect(controller.getInstallation(ORG)).rejects.toBe(unavailable);
  });
});
