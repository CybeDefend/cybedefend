const mockFetch = jest.fn();
global.fetch = mockFetch as any;

import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { LinearApiClient, LinearApiError } from './linear-api.client';
import { createLoggerMock } from '../../test-utils/mocks';

const ACCESS_TOKEN = 'lin_oauth_access_SECRET_aaaa';
const REFRESH_TOKEN = 'lin_refresh_SECRET_bbbb';
const AUTH_CODE = 'auth_code_SECRET_cccc';
const CLIENT_SECRET = 'test-client-secret';

function reply(httpStatus: number, body?: unknown) {
  return {
    ok: httpStatus >= 200 && httpStatus < 300,
    status: httpStatus,
    json: async () => {
      if (body === undefined) throw new SyntaxError('Unexpected end of JSON');
      return body;
    },
  };
}

function makeClient(
  config: Record<string, string> = {
    NODE_ENV: 'development',
    LINEAR_CLIENT_ID: 'test-client-id',
    LINEAR_CLIENT_SECRET: CLIENT_SECRET,
  },
  secretValues: Record<string, string> = {},
) {
  const secrets = {
    ensureCacheLoaded: jest.fn().mockResolvedValue(undefined),
    getSecret: jest.fn((key: string) => secretValues[key] ?? ''),
  };
  const logger = createLoggerMock();
  const client = new LinearApiClient(
    { get: (key: string) => config[key] } as any,
    secrets as any,
    logger,
  );
  return { client, secrets, logger };
}

function lastCall() {
  const [url, init] = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
  return { url: url as string, init: init as RequestInit & { headers: any } };
}

function formOf(init: RequestInit): URLSearchParams {
  return new URLSearchParams(init.body as string);
}

async function kindOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(LinearApiError);
    return (err as LinearApiError).kind;
  }
  throw new Error('expected the call to reject');
}

describe('LinearApiClient', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('exchangeCode', () => {
    it('posts a form-encoded body with client credentials', async () => {
      const { client } = makeClient();
      mockFetch.mockResolvedValueOnce(
        reply(200, {
          access_token: ACCESS_TOKEN,
          token_type: 'Bearer',
          expires_in: 86399,
          scope: 'read write',
          refresh_token: REFRESH_TOKEN,
        }),
      );

      const tokens = await client.exchangeCode(
        AUTH_CODE,
        'https://app.example.com/integrations/linear/callback',
      );

      const { url, init } = lastCall();
      expect(url).toBe('https://api.linear.app/oauth/token');
      expect(init.method).toBe('POST');
      expect(init.headers['Content-Type']).toBe(
        'application/x-www-form-urlencoded',
      );
      const form = formOf(init);
      expect(form.get('grant_type')).toBe('authorization_code');
      expect(form.get('code')).toBe(AUTH_CODE);
      expect(form.get('redirect_uri')).toBe(
        'https://app.example.com/integrations/linear/callback',
      );
      expect(form.get('client_id')).toBe('test-client-id');
      expect(form.get('client_secret')).toBe(CLIENT_SECRET);
      expect(tokens).toEqual({
        accessToken: ACCESS_TOKEN,
        refreshToken: REFRESH_TOKEN,
        expiresInSeconds: 86399,
      });
    });

    it('returns a null refresh token when Linear sends none', async () => {
      const { client } = makeClient();
      mockFetch.mockResolvedValueOnce(
        reply(200, { access_token: ACCESS_TOKEN, expires_in: 3600 }),
      );

      await expect(client.exchangeCode('code', 'https://x')).resolves.toEqual({
        accessToken: ACCESS_TOKEN,
        refreshToken: null,
        expiresInSeconds: 3600,
      });
    });

    it('maps an invalid_grant answer (expired or reused code) to kind invalid_grant', async () => {
      const { client } = makeClient();
      mockFetch.mockResolvedValueOnce(reply(400, { error: 'invalid_grant' }));

      expect(await kindOf(client.exchangeCode('code', 'https://x'))).toBe(
        'invalid_grant',
      );
    });

    it('maps refused client credentials to kind unauthorized', async () => {
      const { client } = makeClient();
      mockFetch.mockResolvedValueOnce(reply(401, { error: 'invalid_client' }));

      expect(await kindOf(client.exchangeCode('code', 'https://x'))).toBe(
        'unauthorized',
      );
    });

    it('never retries, even on a 5xx', async () => {
      const { client } = makeClient();
      mockFetch.mockResolvedValue(reply(503, { error: 'unavailable' }));

      expect(await kindOf(client.exchangeCode('code', 'https://x'))).toBe(
        'unavailable',
      );
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('maps a network failure to kind unavailable', async () => {
      const { client } = makeClient();
      mockFetch.mockRejectedValueOnce(new TypeError('fetch failed'));

      expect(await kindOf(client.exchangeCode('code', 'https://x'))).toBe(
        'unavailable',
      );
    });

    it('rejects an answer without an access token or an expiry', async () => {
      const { client } = makeClient();
      mockFetch.mockResolvedValueOnce(reply(200, { token_type: 'Bearer' }));
      expect(await kindOf(client.exchangeCode('code', 'https://x'))).toBe(
        'unavailable',
      );

      mockFetch.mockResolvedValueOnce(
        reply(200, { access_token: ACCESS_TOKEN }),
      );
      expect(await kindOf(client.exchangeCode('code', 'https://x'))).toBe(
        'unavailable',
      );
    });
  });

  describe('refresh', () => {
    it('posts grant_type=refresh_token with the client credentials', async () => {
      const { client } = makeClient();
      mockFetch.mockResolvedValueOnce(
        reply(200, {
          access_token: 'new-access',
          expires_in: 86399,
          refresh_token: 'new-refresh',
        }),
      );

      const tokens = await client.refresh(REFRESH_TOKEN);

      const { url, init } = lastCall();
      expect(url).toBe('https://api.linear.app/oauth/token');
      expect(init.headers['Content-Type']).toBe(
        'application/x-www-form-urlencoded',
      );
      const form = formOf(init);
      expect(form.get('grant_type')).toBe('refresh_token');
      expect(form.get('refresh_token')).toBe(REFRESH_TOKEN);
      expect(form.get('client_id')).toBe('test-client-id');
      expect(form.get('client_secret')).toBe(CLIENT_SECRET);
      expect(tokens).toEqual({
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
        expiresInSeconds: 86399,
      });
    });

    it('maps an invalid_grant answer to kind invalid_grant', async () => {
      const { client } = makeClient();
      mockFetch.mockResolvedValueOnce(reply(400, { error: 'invalid_grant' }));

      expect(await kindOf(client.refresh(REFRESH_TOKEN))).toBe('invalid_grant');
    });

    it('maps other 400 answers to kind invalid', async () => {
      const { client } = makeClient();
      mockFetch.mockResolvedValueOnce(reply(400, { error: 'invalid_request' }));

      expect(await kindOf(client.refresh(REFRESH_TOKEN))).toBe('invalid');
    });

    it('maps a 429 to kind rate_limited', async () => {
      const { client } = makeClient();
      mockFetch.mockResolvedValueOnce(reply(429, {}));

      expect(await kindOf(client.refresh(REFRESH_TOKEN))).toBe('rate_limited');
    });

    it('never retries a refresh: a consumed refresh token replays once at most', async () => {
      const { client } = makeClient();
      mockFetch.mockResolvedValue(reply(500));

      expect(await kindOf(client.refresh(REFRESH_TOKEN))).toBe('unavailable');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('revoke', () => {
    it('posts the token as a form field and resolves on 200', async () => {
      const { client } = makeClient();
      mockFetch.mockResolvedValueOnce(reply(200, {}));

      await expect(client.revoke(ACCESS_TOKEN)).resolves.toBeUndefined();

      const { url, init } = lastCall();
      expect(url).toBe('https://api.linear.app/oauth/revoke');
      expect(init.method).toBe('POST');
      expect(init.headers['Content-Type']).toBe(
        'application/x-www-form-urlencoded',
      );
      expect(formOf(init).get('token')).toBe(ACCESS_TOKEN);
    });

    it('maps a 400 (already revoked) to kind invalid and a 401 to unauthorized', async () => {
      const { client } = makeClient();
      mockFetch.mockResolvedValueOnce(reply(400, {}));
      expect(await kindOf(client.revoke(ACCESS_TOKEN))).toBe('invalid');

      mockFetch.mockResolvedValueOnce(reply(401, {}));
      expect(await kindOf(client.revoke(ACCESS_TOKEN))).toBe('unauthorized');
    });
  });

  describe('graphql', () => {
    it('returns data on success', async () => {
      const { client } = makeClient();
      mockFetch.mockResolvedValueOnce(
        reply(200, { data: { viewer: { id: 'u1' } } }),
      );

      await expect(
        client.graphql<{ viewer: { id: string } }>(
          ACCESS_TOKEN,
          '{ viewer { id } }',
        ),
      ).resolves.toEqual({ viewer: { id: 'u1' } });
    });

    it('sends Authorization: Bearer <token> and a JSON body', async () => {
      const { client } = makeClient();
      mockFetch.mockResolvedValueOnce(reply(200, { data: {} }));

      await client.graphql(ACCESS_TOKEN, 'query Q($id: String!) { x }', {
        id: 'abc',
      });

      const { url, init } = lastCall();
      expect(url).toBe('https://api.linear.app/graphql');
      expect(init.method).toBe('POST');
      expect(init.headers.Authorization).toBe(`Bearer ${ACCESS_TOKEN}`);
      expect(init.headers['Content-Type']).toBe('application/json');
      expect(JSON.parse(init.body as string)).toEqual({
        query: 'query Q($id: String!) { x }',
        variables: { id: 'abc' },
      });
    });

    it('maps RATELIMITED to kind rate_limited', async () => {
      const { client } = makeClient();
      mockFetch.mockResolvedValueOnce(
        reply(400, {
          errors: [
            {
              message: 'Rate limit exceeded',
              extensions: { code: 'RATELIMITED', type: 'ratelimited' },
            },
          ],
        }),
      );

      expect(await kindOf(client.graphql(ACCESS_TOKEN, '{ x }'))).toBe(
        'rate_limited',
      );
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('maps a 401 to kind unauthorized', async () => {
      const { client } = makeClient();
      mockFetch.mockResolvedValueOnce(
        reply(401, {
          errors: [
            {
              message: 'Authentication required',
              extensions: { code: 'AUTHENTICATION_ERROR' },
            },
          ],
        }),
      );

      expect(await kindOf(client.graphql(ACCESS_TOKEN, '{ x }'))).toBe(
        'unauthorized',
      );
    });

    it('maps an AUTHENTICATION_ERROR code to kind unauthorized behind a non-401 status', async () => {
      const { client } = makeClient();
      mockFetch.mockResolvedValueOnce(
        reply(400, {
          errors: [
            {
              message: 'Authentication required, not authenticated',
              extensions: { code: 'AUTHENTICATION_ERROR' },
            },
          ],
        }),
      );
      expect(await kindOf(client.graphql(ACCESS_TOKEN, '{ x }'))).toBe(
        'unauthorized',
      );

      mockFetch.mockResolvedValueOnce(
        reply(200, {
          data: null,
          errors: [{ extensions: { code: 'AUTHENTICATION_ERROR' } }],
        }),
      );
      expect(await kindOf(client.graphql(ACCESS_TOKEN, '{ x }'))).toBe(
        'unauthorized',
      );
    });

    it('maps a 403 to kind invalid, not unauthorized: one forbidden resource is no dead token', async () => {
      const { client } = makeClient();
      mockFetch.mockResolvedValueOnce(
        reply(403, {
          errors: [{ message: 'Forbidden', extensions: { code: 'FORBIDDEN' } }],
        }),
      );
      expect(await kindOf(client.graphql(ACCESS_TOKEN, '{ x }'))).toBe(
        'invalid',
      );

      mockFetch.mockResolvedValueOnce(reply(403));
      expect(await kindOf(client.graphql(ACCESS_TOKEN, '{ x }'))).toBe(
        'invalid',
      );
    });

    it('maps an Entity not found error to kind not_found', async () => {
      const { client } = makeClient();
      mockFetch.mockResolvedValueOnce(
        reply(400, {
          errors: [
            {
              message:
                'Entity not found: Issue - Could not find referenced Issue.',
              extensions: { type: 'invalid input', userError: true },
            },
          ],
        }),
      );

      expect(await kindOf(client.graphql(ACCESS_TOKEN, '{ issue }'))).toBe(
        'not_found',
      );
    });

    it('maps any other GraphQL error to kind invalid, even behind a 200', async () => {
      const { client } = makeClient();
      mockFetch.mockResolvedValueOnce(
        reply(400, {
          errors: [
            {
              message: 'Argument Validation Error',
              extensions: { type: 'invalid input' },
            },
          ],
        }),
      );
      expect(await kindOf(client.graphql(ACCESS_TOKEN, '{ x }'))).toBe(
        'invalid',
      );

      mockFetch.mockResolvedValueOnce(
        reply(200, { data: null, errors: [{ message: 'Something is wrong' }] }),
      );
      expect(await kindOf(client.graphql(ACCESS_TOKEN, '{ x }'))).toBe(
        'invalid',
      );
    });

    it('does not retry a 4xx', async () => {
      const { client } = makeClient();
      mockFetch.mockResolvedValue(reply(400, { errors: [{ message: 'bad' }] }));

      await kindOf(client.graphql(ACCESS_TOKEN, '{ x }'));

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    describe('on a 5xx', () => {
      beforeEach(() => jest.useFakeTimers());
      afterEach(() => jest.useRealTimers());

      it('retries once and returns the second answer', async () => {
        const { client } = makeClient();
        mockFetch
          .mockResolvedValueOnce(reply(502))
          .mockResolvedValueOnce(reply(200, { data: { ok: true } }));

        const call = client.graphql(ACCESS_TOKEN, '{ x }');
        await jest.advanceTimersByTimeAsync(5_000);

        await expect(call).resolves.toEqual({ ok: true });
        expect(mockFetch).toHaveBeenCalledTimes(2);
      });

      it('gives up after one retry with kind unavailable', async () => {
        const { client } = makeClient();
        mockFetch.mockResolvedValue(reply(503));

        const outcome = kindOf(client.graphql(ACCESS_TOKEN, '{ x }'));
        await jest.advanceTimersByTimeAsync(5_000);

        expect(await outcome).toBe('unavailable');
        expect(mockFetch).toHaveBeenCalledTimes(2);
      });

      it('does not retry a 5xx when retryOnServerError is false', async () => {
        const { client } = makeClient();
        mockFetch.mockResolvedValue(reply(502));

        const outcome = kindOf(
          client.graphql(
            ACCESS_TOKEN,
            'mutation { issueCreate }',
            { title: 'x' },
            { retryOnServerError: false },
          ),
        );
        await jest.advanceTimersByTimeAsync(5_000);

        expect(await outcome).toBe('unavailable');
        expect(mockFetch).toHaveBeenCalledTimes(1);
      });

      it('still retries a 5xx when retryOnServerError is true', async () => {
        const { client } = makeClient();
        mockFetch
          .mockResolvedValueOnce(reply(504))
          .mockResolvedValueOnce(reply(200, { data: { ok: true } }));

        const call = client.graphql(ACCESS_TOKEN, '{ x }', undefined, {
          retryOnServerError: true,
        });
        await jest.advanceTimersByTimeAsync(5_000);

        await expect(call).resolves.toEqual({ ok: true });
        expect(mockFetch).toHaveBeenCalledTimes(2);
      });
    });

    it('maps a network failure to kind unavailable without retrying', async () => {
      const { client } = makeClient();
      mockFetch.mockRejectedValue(new TypeError('fetch failed'));

      expect(await kindOf(client.graphql(ACCESS_TOKEN, '{ x }'))).toBe(
        'unavailable',
      );
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('rejects a 200 answer that carries no data', async () => {
      const { client } = makeClient();
      mockFetch.mockResolvedValueOnce(reply(200, {}));

      expect(await kindOf(client.graphql(ACCESS_TOKEN, '{ x }'))).toBe(
        'unavailable',
      );
    });
  });

  describe('request timeout', () => {
    it('gives every fetch an abort signal', async () => {
      const { client } = makeClient();
      mockFetch.mockResolvedValue(
        reply(200, { access_token: 'a', expires_in: 1, data: {} }),
      );

      await client.exchangeCode('code', 'https://x');
      await client.refresh(REFRESH_TOKEN);
      await client.revoke(ACCESS_TOKEN);
      await client.graphql(ACCESS_TOKEN, '{ x }');

      expect(mockFetch).toHaveBeenCalledTimes(4);
      for (const [, init] of mockFetch.mock.calls) {
        expect(init.signal).toBeInstanceOf(AbortSignal);
        expect(init.signal.aborted).toBe(false);
      }
    });

    it('maps an aborted request to kind unavailable', async () => {
      const { client } = makeClient();
      mockFetch.mockRejectedValue(
        new DOMException(
          'The operation was aborted due to timeout',
          'TimeoutError',
        ),
      );

      expect(await kindOf(client.refresh(REFRESH_TOKEN))).toBe('unavailable');
    });
  });

  describe('client credentials', () => {
    it('reads them at call time from the secrets outside development', async () => {
      const { client, secrets } = makeClient(
        { NODE_ENV: 'production', LINEAR_CLIENT_ID: 'ignored-env-id' },
        {
          LINEAR_CLIENT_ID: 'secret-id',
          LINEAR_CLIENT_SECRET: 'secret-secret',
        },
      );
      expect(secrets.getSecret).not.toHaveBeenCalled();
      mockFetch.mockResolvedValueOnce(
        reply(200, { access_token: 'a', expires_in: 1 }),
      );

      await client.refresh(REFRESH_TOKEN);

      const form = formOf(lastCall().init);
      expect(form.get('client_id')).toBe('secret-id');
      expect(form.get('client_secret')).toBe('secret-secret');
      expect(secrets.ensureCacheLoaded).toHaveBeenCalled();
    });

    it('fails without calling Linear when they are not configured', async () => {
      const { client } = makeClient({ NODE_ENV: 'production' });

      await expect(client.refresh(REFRESH_TOKEN)).rejects.toThrow(
        'Linear client credentials are not configured',
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('toRpcException', () => {
    const cases: Array<[LinearApiError['kind'], number]> = [
      ['rate_limited', status.RESOURCE_EXHAUSTED],
      ['unauthorized', status.FAILED_PRECONDITION],
      ['invalid_grant', status.FAILED_PRECONDITION],
      ['not_found', status.NOT_FOUND],
      ['invalid', status.INVALID_ARGUMENT],
      ['unavailable', status.UNAVAILABLE],
    ];

    it.each(cases)('maps kind %s to gRPC code %s', (kind, code) => {
      const { client } = makeClient();

      const rpc = client.toRpcException(
        new LinearApiError(kind, 'Linear said something'),
      );

      expect(rpc).toBeInstanceOf(RpcException);
      expect(rpc.getError()).toMatchObject({ code });
    });

    it.each(['unauthorized', 'invalid_grant'] as const)(
      'maps kind %s to the LINEAR_NEEDS_RECONNECT refusal',
      (kind) => {
        const { client } = makeClient();

        const rpc = client.toRpcException(
          new LinearApiError(kind, 'Linear said something'),
        );

        expect(rpc.getError()).toEqual({
          code: status.FAILED_PRECONDITION,
          message: 'LINEAR_NEEDS_RECONNECT',
        });
      },
    );

    it('never produces UNAUTHENTICATED: the gateway would answer 401 and the dashboard read an expired session', () => {
      const { client } = makeClient();
      const kinds: LinearApiError['kind'][] = [
        'unauthorized',
        'invalid_grant',
        'rate_limited',
        'not_found',
        'invalid',
        'unavailable',
      ];

      for (const kind of kinds) {
        const error = client
          .toRpcException(new LinearApiError(kind, 'x'))
          .getError() as { code: number };
        expect(error.code).not.toBe(status.UNAUTHENTICATED);
      }
    });

    it('never forwards the text Linear sent', () => {
      const { client } = makeClient();

      const rpc = client.toRpcException(
        new LinearApiError('invalid', 'Linear said: internal detail xyz'),
      );

      expect(JSON.stringify(rpc.getError())).not.toContain('internal detail');
    });

    it('hands an RpcException back unchanged', () => {
      const { client } = makeClient();
      const original = new RpcException({
        code: status.NOT_FOUND,
        message: 'LINEAR_NOT_CONNECTED',
      });

      expect(client.toRpcException(original)).toBe(original);
    });

    it('maps an unknown error to INTERNAL without its text', () => {
      const { client } = makeClient();

      const rpc = client.toRpcException(new Error('db password is hunter2'));

      expect(rpc.getError()).toMatchObject({ code: status.INTERNAL });
      expect(JSON.stringify(rpc.getError())).not.toContain('hunter2');
    });
  });

  describe('logging', () => {
    it('never logs a token', async () => {
      const { client, logger } = makeClient();
      const errors: unknown[] = [];

      // A provider can echo back the credentials it was sent: the client secret
      // goes out with the code exchange and the refresh only.
      const echoing = (...sent: string[]) =>
        reply(400, {
          error: 'invalid_grant',
          error_description: `Invalid credentials ${sent.join(' and ')}`,
        });
      mockFetch.mockResolvedValueOnce(echoing(AUTH_CODE, CLIENT_SECRET));
      await client
        .exchangeCode(AUTH_CODE, 'https://x')
        .catch((err) => errors.push(err));
      mockFetch.mockResolvedValueOnce(echoing(REFRESH_TOKEN, CLIENT_SECRET));
      await client.refresh(REFRESH_TOKEN).catch((err) => errors.push(err));
      mockFetch.mockResolvedValueOnce(echoing(ACCESS_TOKEN));
      await client.revoke(ACCESS_TOKEN).catch((err) => errors.push(err));
      mockFetch.mockResolvedValue(
        reply(400, {
          errors: [{ message: `Bad token ${ACCESS_TOKEN}` }],
        }),
      );
      await client
        .graphql(ACCESS_TOKEN, '{ x }')
        .catch((err) => errors.push(err));
      mockFetch.mockRejectedValue(
        new TypeError(`fetch failed ${ACCESS_TOKEN}`),
      );
      await client
        .graphql(ACCESS_TOKEN, '{ x }')
        .catch((err) => errors.push(err));

      expect(errors).toHaveLength(5);
      const logged = JSON.stringify(
        ['log', 'warn', 'error', 'debug'].flatMap(
          (level) => (logger as any)[level].mock.calls,
        ),
      );
      const surfaced = JSON.stringify(
        errors.map((e) => ({ message: (e as Error).message })),
      );
      for (const secret of [
        ACCESS_TOKEN,
        REFRESH_TOKEN,
        AUTH_CODE,
        CLIENT_SECRET,
      ]) {
        expect(logged).not.toContain(secret);
        expect(surfaced).not.toContain(secret);
      }
      expect(
        (logger as any).warn.mock.calls.length +
          (logger as any).error.mock.calls.length,
      ).toBeGreaterThan(0);
    });
  });
});
