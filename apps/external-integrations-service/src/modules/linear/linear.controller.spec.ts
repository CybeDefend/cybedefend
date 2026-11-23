// First: the @nestjs/microservices/constants entry loads @nestjs/common's
// internals without the Reflect polyfill its main entry installs.
import 'reflect-metadata';
import { PATTERN_METADATA } from '@nestjs/microservices/constants';

import { LinearController } from './linear.controller';
import { LinearService } from './linear.service';
import { LinearWebhookService } from './linear-webhook.service';

/**
 * LinearController is the gRPC face of LinearService (organisation-scoped
 * OAuth install, team options, project settings) and of the webhook handler.
 * It holds no logic of its own: each RPC hands the request to the service that
 * owns it, and a refusal (an RpcException carrying a LINEAR_* code) travels
 * back untouched.
 */
describe('LinearController', () => {
  const METHODS = [
    'generateOAuthUrl',
    'callbackInstall',
    'getInstallationForOrga',
    'disconnect',
    'listTeams',
    'getTeamOptions',
    'setProjectLinearConfig',
    'getProjectLinearConfig',
    'removeProjectLinearConfig',
  ] as const;

  let linear: Record<string, jest.Mock>;
  let webhook: { handleWebhook: jest.Mock };
  let controller: LinearController;

  beforeEach(() => {
    linear = Object.fromEntries(
      METHODS.map((method) => [method, jest.fn()]),
    ) as Record<string, jest.Mock>;
    webhook = { handleWebhook: jest.fn() };
    controller = new LinearController(
      linear as unknown as LinearService,
      webhook as unknown as LinearWebhookService,
    );
  });

  it.each([...METHODS])(
    '%s is handed to LinearService with the request unchanged',
    async (method) => {
      const request = { organizationId: 'org-1', projectId: 'p1' } as any;
      const answer = { answer: method };
      linear[method].mockResolvedValue(answer);

      const out = await (controller as any)[method](request);

      expect(linear[method]).toHaveBeenCalledWith(request);
      expect(out).toBe(answer);
    },
  );

  it('handleWebhook is handed to LinearWebhookService, not to LinearService', async () => {
    const request = { rawBody: '{}', signature: 'abc' } as any;
    const answer = { ok: true };
    webhook.handleWebhook.mockResolvedValue(answer);

    const out = await controller.handleWebhook(request);

    expect(webhook.handleWebhook).toHaveBeenCalledWith(request);
    expect(out).toBe(answer);
    expect(linear.disconnect).not.toHaveBeenCalled();
  });

  it('lets a refusal from the service reach the caller as it is', async () => {
    const refusal = new Error('LINEAR_NOT_CONNECTED');
    linear.listTeams.mockRejectedValue(refusal);

    await expect(
      controller.listTeams({ organizationId: 'org-1' } as any),
    ).rejects.toBe(refusal);
  });

  // A handler registered under another service name, or not at all, serves
  // nothing and fails only in a pod, on the first call.
  it('serves the ten LinearService RPCs', () => {
    const handlers = [...METHODS, 'handleWebhook'];
    const served = handlers.map((method) =>
      Reflect.getMetadata(
        PATTERN_METADATA,
        (LinearController.prototype as any)[method],
      ),
    );

    expect(served).toEqual(
      handlers.map((rpc) => [
        { service: 'LinearService', rpc, streaming: 'no_stream' },
      ]),
    );
  });
});
