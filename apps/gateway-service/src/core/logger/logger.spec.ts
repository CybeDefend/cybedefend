import { IncomingMessage, ServerResponse } from 'http';
import { Socket } from 'net';
import Pino from 'pino';
import { pinoHttp } from 'pino-http';
import { createLoggerOptions } from './logger';

/**
 * Drives the REAL logger options through pino and inspects what would be written,
 * rather than asserting that a string sits in the `redact.paths` array: hyphenated
 * header names need bracket notation (`req.headers["x-gitlab-token"]`), and a
 * malformed path would pass a list check while still leaking.
 *
 * The request shape mirrors what GlobalExceptionFilter logs when a request fails:
 * `{ req: { headers, method, url } }`. An error path must never echo a secret
 * header such as `x-gitlab-token`, not only `authorization`.
 */
interface LoggedRequest {
  req: { method: string; url: string; headers: Record<string, string> };
}

function captureLogger(): { logger: Pino.Logger; lines: string[] } {
  // The transport (pino-pretty + OTLP workers) is irrelevant here: redaction is
  // applied in the main thread before serialisation, so drop it and write to memory.
  const options = { ...createLoggerOptions() };
  delete options.transport;
  const lines: string[] = [];
  const destination = { write: (line: string) => lines.push(line) };
  return { logger: Pino(options, destination), lines };
}

function logAndCapture(obj: Record<string, unknown>): LoggedRequest {
  const { logger, lines } = captureLogger();
  logger.info(obj, 'request failed');
  expect(lines).toHaveLength(1);
  return JSON.parse(lines[0]) as LoggedRequest;
}

/**
 * Logs the way production does: nestjs-pino runs pino-http with
 * `{ logger, autoLogging: false }` (logger.module.ts), and every log line written
 * during the request goes through the child logger pino-http binds `req` to — with
 * pino-http's OWN request serializer, which shadows any `serializers.req` set on
 * the parent. pino-http is a peer dependency of nestjs-pino, declared by the
 * gateway, so pnpm links nestjs-pino to the very copy imported here.
 */
function logDuringRequest(url: string): LoggedRequest {
  const { logger, lines } = captureLogger();
  const req = new IncomingMessage(new Socket());
  req.method = 'POST';
  req.url = url;
  const res = new ServerResponse(req);
  pinoHttp({ logger, autoLogging: false })(req, res);
  req.log.warn('request failed');
  expect(lines).toHaveLength(1);
  return JSON.parse(lines[0]) as LoggedRequest;
}

const failedWebhook = (headers: Record<string, string>) => ({
  req: { method: 'POST', url: '/webhooks/gitlab', headers },
});

describe('logger redaction', () => {
  // Fixture values are deliberately low-entropy and match no real token format
  // (no `gloas-`, `cybe_live_`, `Bearer eyJ…`): the test only needs distinctive
  // strings to prove they do not reach the output, and realistic-looking ones are
  // flagged as CRITICAL by our own secret scanner on every scan of this repository.
  describe('secret-bearing request headers are redacted', () => {
    it.each([
      ['x-gitlab-token', 'fixture-gitlab-webhook-value'], // GitLab webhook shared secret
      ['x-api-key', 'fixture-legacy-key-value'], // deprecated (410) but still sent by legacy clients
      ['proxy-authorization', 'fixture-proxy-credential-value'],
      ['authorization', 'fixture-bearer-value'], // already covered — must stay so
      ['cookie', 'fixture-session-value'], // already covered — must stay so
    ])('%s', (header, value) => {
      const line = logAndCapture(failedWebhook({ [header]: value }));

      expect(line.req.headers[header]).toBe('[REDACTED]');
      expect(JSON.stringify(line)).not.toContain(value);
    });
  });

  it('redacts every password field of the Community auth bodies', () => {
    const logged = JSON.stringify(
      logAndCapture({
        req: {
          method: 'POST',
          url: '/auth/password/change',
          body: {
            password: 'plain-pw-fixture',
            currentPassword: 'current-pw-fixture',
            newPassword: 'new-pw-fixture',
          },
        },
      }),
    );
    expect(logged).not.toContain('plain-pw-fixture');
    expect(logged).not.toContain('current-pw-fixture');
    expect(logged).not.toContain('new-pw-fixture');
  });

  it.each([
    ['/auth/invitations/accept', 'token', 'fixture-invitation-value'],
    ['/auth/setup', 'setupToken', 'fixture-setup-value'],
  ])('redacts the one-time token in the body of %s', (url, field, value) => {
    const line = logAndCapture({
      req: { method: 'POST', url, body: { [field]: value, name: 'Grace' } },
    });
    expect(JSON.stringify(line)).not.toContain(value);
    expect(JSON.stringify(line)).toContain('Grace');
  });

  it('keeps non-secret headers readable, so a failing webhook can still be diagnosed', () => {
    const line = logAndCapture(
      failedWebhook({
        'x-gitlab-token': 'fixture-gitlab-webhook-value',
        'x-gitlab-event': 'Push Hook',
        'user-agent': 'GitLab/19.5.0-pre',
        // HMAC signatures are derived from the secret and the payload; they cannot
        // be reversed into the secret, and they are what you need to debug a
        // signature mismatch — so they stay visible.
        'x-hub-signature-256': 'sha256=3f1a',
        'stripe-signature': 't=1789985434,v1=3f1a',
      }),
    );

    expect(line.req.headers['x-gitlab-token']).toBe('[REDACTED]');
    expect(line.req.headers['x-gitlab-event']).toBe('Push Hook');
    expect(line.req.headers['user-agent']).toBe('GitLab/19.5.0-pre');
    expect(line.req.headers['x-hub-signature-256']).toBe('sha256=3f1a');
    expect(line.req.headers['stripe-signature']).toBe('t=1789985434,v1=3f1a');
    expect(line.req.url).toBe('/webhooks/gitlab');
  });

  // Jira's dynamic webhooks cannot send a custom header, so the secret that
  // authenticates POST /webhooks/jira/:token is the last path segment, and every
  // log line written while that request fails carries it in `req.url`.
  describe('secrets carried in the URL path are masked', () => {
    const secret = 'fixture-jira-webhook-secret-value';

    it('in the req.url pino-http binds to every log line of the request', () => {
      const line = logDuringRequest(`/webhooks/jira/${secret}`);

      expect(line.req.url).toBe('/webhooks/jira/[REDACTED]');
      expect(JSON.stringify(line)).not.toContain(secret);
    });

    it('in a req object logged explicitly', () => {
      const line = logAndCapture({
        req: { method: 'POST', url: `/webhooks/jira/${secret}`, headers: {} },
      });

      expect(line.req.url).toBe('/webhooks/jira/[REDACTED]');
      expect(JSON.stringify(line)).not.toContain(secret);
    });

    it('and every other URL stays readable', () => {
      const line = logDuringRequest('/project/7b1c/results/sast?page=2');

      expect(line.req.url).toBe('/project/7b1c/results/sast?page=2');
    });
  });
});
