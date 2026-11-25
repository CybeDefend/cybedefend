/**
 * HTTP-level test of POST /webhooks/github, and a guard over every webhook
 * handler.
 *
 * A handler must not inject `@Res()` without calling it. Injecting the
 * response object hands the reply over to the handler, so Nest never sends the
 * value it returns: every delivery would hang until a proxy in front gives up,
 * although external-integrations processed the event. A unit test that calls
 * the method directly cannot see this, so the route is exercised through
 * Fastify. The guard reads Nest's route-argument metadata so that no other
 * webhook route, present or future, repeats the mistake (the cloud edition's
 * webhook routes carry the same guard).
 */
import {
  PATH_METADATA,
  RESPONSE_PASSTHROUGH_METADATA,
  ROUTE_ARGS_METADATA,
} from '@nestjs/common/constants';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';
import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { gatewayAdapterOptions } from 'src/core/http/body-limit';
import { GithubService } from './github/github.service';
import { GitlabService } from './gitlab/gitlab.service';
import { JiraService } from './jira/jira.service';
import { LinearService } from './linear/linear.service';
import { WebhookController } from './webhook.controller';
import {
  registerWebhookBodyCap,
  WEBHOOK_BODY_CAP_PROVIDER,
  WEBHOOK_MAX_BODY_BYTES,
  WEBHOOK_RELAY_MAX_MESSAGE_BYTES,
} from './webhook-body-cap';
import { IntegrationsModule } from './integrations.module';

const REPLY_DEADLINE_MS = 2000;

function withinDeadline<T>(pending: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(new Error(`no HTTP response within ${REPLY_DEADLINE_MS} ms`)),
      REPLY_DEADLINE_MS,
    );
  });
  return Promise.race([pending, deadline]).finally(() => clearTimeout(timer));
}

async function createWebhookApp(services: {
  github?: object;
  gitlab?: object;
  jira?: object;
  linear?: object;
}): Promise<NestFastifyApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers: [WebhookController],
    providers: [
      { provide: GithubService, useValue: services.github ?? {} },
      { provide: GitlabService, useValue: services.gitlab ?? {} },
      { provide: JiraService, useValue: services.jira ?? {} },
      { provide: LinearService, useValue: services.linear ?? {} },
    ],
  }).compile();

  // The gateway's own adapter options, as main.ts sets them, so the
  // per-route cap is what decides on a webhook body.
  const adapter = new FastifyAdapter(gatewayAdapterOptions({}));
  registerWebhookBodyCap(adapter.getInstance());
  const app = moduleRef.createNestApplication<NestFastifyApplication>(adapter, {
    rawBody: true,
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

describe('POST /webhooks/github (HTTP)', () => {
  let app: NestFastifyApplication;
  const handleWebhookEvent = jest.fn();

  beforeAll(async () => {
    app = await createWebhookApp({ github: { handleWebhookEvent } });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => handleWebhookEvent.mockReset());

  it('answers the delivery once external-integrations has processed it', async () => {
    handleWebhookEvent.mockResolvedValue({ success: true });
    const payload = JSON.stringify({ action: 'opened', number: 1 });

    const res = await withinDeadline(
      app.inject({
        method: 'POST',
        url: '/webhooks/github',
        headers: {
          'content-type': 'application/json',
          'x-github-event': 'pull_request',
          'x-hub-signature-256': 'sha256=deadbeef',
        },
        payload,
      }),
    );

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ success: true });
    expect(handleWebhookEvent).toHaveBeenCalledWith({
      bodyJson: payload,
      event: 'pull_request',
      action: 'opened',
      signature: 'sha256=deadbeef',
    });
  });
});

describe('POST /webhooks/{github,gitlab} with a body that is not JSON (HTTP)', () => {
  let app: NestFastifyApplication;
  const github = { handleWebhookEvent: jest.fn() };
  const gitlab = { handleWebhookEvent: jest.fn() };

  beforeAll(async () => {
    app = await createWebhookApp({ github, gitlab });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    github.handleWebhookEvent.mockReset();
    gitlab.handleWebhookEvent.mockReset();
  });

  const cases: Array<[string, Record<string, string>, string | undefined]> = [
    [
      'github, text/plain body',
      { 'x-github-event': 'push', 'content-type': 'text/plain' },
      'hello',
    ],
    ['github, no body', { 'x-github-event': 'push' }, undefined],
    [
      'gitlab, text/plain body',
      {
        'x-gitlab-event': 'Push Hook',
        'x-gitlab-token': 'x',
        'content-type': 'text/plain',
      },
      'hi',
    ],
    [
      'gitlab, no body',
      { 'x-gitlab-event': 'Push Hook', 'x-gitlab-token': 'x' },
      undefined,
    ],
  ];

  it.each(cases)(
    '%s: answers 400 without internal error text',
    async (name, headers, payload) => {
      const provider = name.split(',')[0];
      const res = await withinDeadline(
        app.inject({
          method: 'POST',
          url: `/webhooks/${provider}`,
          headers,
          ...(payload === undefined ? {} : { payload }),
        }),
      );

      expect(res.statusCode).toBe(400);
      expect(res.body).not.toMatch(/Cannot read|undefined|TypeError/);
      expect(github.handleWebhookEvent).not.toHaveBeenCalled();
      expect(gitlab.handleWebhookEvent).not.toHaveBeenCalled();
    },
  );
});

describe('POST /webhooks/gitlab without a token (HTTP)', () => {
  let app: NestFastifyApplication;
  const gitlab = { handleWebhookEvent: jest.fn() };

  beforeAll(async () => {
    app = await createWebhookApp({ gitlab });
  });

  afterAll(async () => {
    await app.close();
  });

  // As on GitHub, a delivery without its credential is a 401.
  it('answers 401 and relays nothing', async () => {
    const res = await withinDeadline(
      app.inject({
        method: 'POST',
        url: '/webhooks/gitlab',
        headers: {
          'content-type': 'application/json',
          'x-gitlab-event': 'Push Hook',
        },
        payload: '{}',
      }),
    );

    expect(res.statusCode).toBe(401);
    expect(gitlab.handleWebhookEvent).not.toHaveBeenCalled();
  });
});

describe('webhook body cap (HTTP)', () => {
  let app: NestFastifyApplication;
  const github = { handleWebhookEvent: jest.fn() };
  const gitlab = { handleWebhookEvent: jest.fn() };
  const jira = { handleWebhook: jest.fn() };
  const linear = { handleWebhook: jest.fn() };

  beforeAll(async () => {
    app = await createWebhookApp({ github, gitlab, jira, linear });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    for (const fn of [
      github.handleWebhookEvent,
      gitlab.handleWebhookEvent,
      jira.handleWebhook,
      linear.handleWebhook,
    ]) {
      fn.mockReset();
      fn.mockResolvedValue({ success: true });
    }
  });

  // A JSON document of exactly `bytes` bytes.
  const jsonOf = (bytes: number) =>
    `{"a":"${'a'.repeat(bytes - '{"a":""}'.length)}"}`;

  const routes: Array<[string, Record<string, string>, () => jest.Mock]> = [
    [
      '/webhooks/github',
      { 'x-github-event': 'push', 'x-hub-signature-256': 'sha256=00' },
      () => github.handleWebhookEvent,
    ],
    [
      '/webhooks/gitlab',
      { 'x-gitlab-event': 'Push Hook', 'x-gitlab-token': 'x' },
      () => gitlab.handleWebhookEvent,
    ],
    ['/webhooks/jira/some-token', {}, () => jira.handleWebhook],
    [
      '/webhooks/linear',
      { 'linear-signature': 'x' },
      () => linear.handleWebhook,
    ],
  ];

  it.each(routes)(
    '%s answers 413 to a body over the relay limit, before any gRPC call',
    async (url, headers, handler) => {
      const res = await withinDeadline(
        app.inject({
          method: 'POST',
          url,
          headers: { ...headers, 'content-type': 'application/json' },
          payload: jsonOf(WEBHOOK_MAX_BODY_BYTES + 1),
        }),
      );

      expect(res.statusCode).toBe(413);
      expect(res.body).not.toMatch(/larger than max/);
      expect(handler()).not.toHaveBeenCalled();
    },
  );

  it.each(routes)(
    '%s relays a body of exactly the limit',
    async (url, headers, handler) => {
      const res = await withinDeadline(
        app.inject({
          method: 'POST',
          url,
          headers: { ...headers, 'content-type': 'application/json' },
          payload: jsonOf(WEBHOOK_MAX_BODY_BYTES),
        }),
      );

      expect(res.statusCode).toBeLessThan(300);
      expect(handler()).toHaveBeenCalledTimes(1);
    },
  );

  it('leaves room in the relayed gRPC message for every other field', () => {
    // The relayed message carries the body plus values taken from the
    // request line and headers, which Node bounds at 16 KiB together
    // (maxHeaderSize), plus a few bytes of protobuf framing per field.
    const headersAndFraming = 16 * 1024 + 1024;
    expect(WEBHOOK_MAX_BODY_BYTES + headersAndFraming).toBeLessThanOrEqual(
      WEBHOOK_RELAY_MAX_MESSAGE_BYTES,
    );
    // The default receive limit of a grpc-js server, which
    // external-integrations does not raise.
    expect(WEBHOOK_RELAY_MAX_MESSAGE_BYTES).toBe(4 * 1024 * 1024);
  });

  it('is registered by IntegrationsModule', () => {
    const providers: unknown[] =
      Reflect.getMetadata('providers', IntegrationsModule) ?? [];
    expect(providers).toContain(WEBHOOK_BODY_CAP_PROVIDER);
  });
});

describe('POST /webhooks/linear (HTTP)', () => {
  let app: NestFastifyApplication;
  const handleWebhook = jest.fn();

  beforeAll(async () => {
    app = await createWebhookApp({ linear: { handleWebhook } });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => handleWebhook.mockReset());

  // Nest answers 201 to a @Post by default. Linear counts any answer other
  // than 200 as a failed delivery, retries it and disables the webhook after
  // repeated failures.
  it('answers 200, not 201, once external-integrations has processed the delivery', async () => {
    handleWebhook.mockResolvedValue({ success: true, message: 'ok' });
    // Spacing and key order are signed: they must reach the service as sent.
    const payload =
      '{ "type" : "Issue",  "action":"update", "data":{"id":"i1"} }';

    const res = await withinDeadline(
      app.inject({
        method: 'POST',
        url: '/webhooks/linear',
        headers: {
          'content-type': 'application/json',
          'linear-signature': 'cafebabe',
        },
        payload,
      }),
    );

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true, message: 'ok' });
    expect(handleWebhook).toHaveBeenCalledWith({
      rawBody: payload,
      signature: 'cafebabe',
    });
  });

  it('forwards an empty signature when the header is missing', async () => {
    handleWebhook.mockResolvedValue({ success: false });

    await withinDeadline(
      app.inject({
        method: 'POST',
        url: '/webhooks/linear',
        headers: { 'content-type': 'application/json' },
        payload: '{}',
      }),
    );

    expect(handleWebhook).toHaveBeenCalledWith({
      rawBody: '{}',
      signature: '',
    });
  });

  it('hands a delivery with no body to external-integrations instead of failing with a 500', async () => {
    handleWebhook.mockResolvedValue({ success: false });

    const res = await withinDeadline(
      app.inject({ method: 'POST', url: '/webhooks/linear' }),
    );

    expect(res.statusCode).toBe(200);
    expect(handleWebhook).toHaveBeenCalledWith({
      rawBody: '',
      signature: '',
    });
  });
});

describe('WebhookController handlers', () => {
  // A handler that injects @Res() without passthrough owns the reply: Nest no
  // longer sends the value it returns. No webhook handler may do that.
  const prototype = WebhookController.prototype as unknown as Record<
    string,
    unknown
  >;
  // The class itself carries the @Controller path, hence the constructor skip.
  const handlers = Object.getOwnPropertyNames(prototype).filter(
    (name) =>
      name !== 'constructor' &&
      typeof prototype[name] === 'function' &&
      Reflect.getMetadata(PATH_METADATA, prototype[name] as object) !==
        undefined,
  );

  it('finds every webhook route', () => {
    expect(handlers).toEqual(
      expect.arrayContaining([
        'handleGithubWebhook',
        'handleGitlabWebhook',
        'handleJiraWebhook',
        'handleLinearWebhook',
      ]),
    );
  });

  it.each(handlers)('%s leaves the reply to Nest', (name) => {
    const args: Record<string, unknown> =
      Reflect.getMetadata(ROUTE_ARGS_METADATA, WebhookController, name) ?? {};
    const injectsResponse = Object.keys(args).some((key) =>
      key.startsWith(`${RouteParamtypes.RESPONSE}:`),
    );
    const passthrough =
      Reflect.getMetadata(
        RESPONSE_PASSTHROUGH_METADATA,
        WebhookController,
        name,
      ) === true;

    expect(injectsResponse && !passthrough).toBe(false);
  });
});
