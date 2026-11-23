import { HttpException, HttpStatus } from '@nestjs/common';

import { retryAfterSeconds, throwUpstreamHttpError } from './upstream-error';

describe('throwUpstreamHttpError', () => {
  const logger = { error: jest.fn() } as unknown as {
    error: (m: string) => void;
  };

  beforeEach(() => jest.clearAllMocks());

  function catchStatus(err: unknown): number {
    try {
      throwUpstreamHttpError(err, 'ctx', logger);
    } catch (e) {
      return (e as HttpException).getStatus();
    }
    throw new Error('throwUpstreamHttpError did not throw');
  }

  // The bug this guards: collapsing every upstream status into 502 made a
  // "rule not found" indistinguishable from "the service is down". A caller
  // that passed a wrong id saw `UNAVAILABLE / 502` and concluded the endpoint
  // was dead — which is exactly what happened with `cybe_rules_edit`.
  it.each([
    [400, 'bad request'],
    [404, 'rule not found'],
    [409, 'a rule with this title already exists'],
    [413, 'payload too large'],
    [422, 'validation error'],
    [429, 'too many requests'],
  ])('preserves upstream %i so the caller can act on it', (status, detail) => {
    expect(catchStatus({ response: { status, data: { detail } } })).toBe(
      status,
    );
  });

  // 401/403 from an upstream describe the GATEWAY's credentials, not the
  // caller's — the caller already cleared the auth + permission guards to get
  // here. Forwarding a 401 makes the dashboard's axios interceptor treat the
  // user's Logto session as broken and clear auth state, so an ingestion-side
  // misconfiguration would log people out; a forwarded 403 on a mutation
  // shows the wrong "free trial quota is exhausted" toast.
  it.each([401, 403])(
    'does NOT forward upstream %i — it is our auth failure, not the caller’s',
    (status) => {
      expect(
        catchStatus({ response: { status, data: { detail: 'nope' } } }),
      ).toBe(HttpStatus.BAD_GATEWAY);
    },
  );

  it('keeps the upstream detail as the message', () => {
    try {
      throwUpstreamHttpError(
        { response: { status: 404, data: { detail: 'rule not found' } } },
        'editRule project=p rule=r',
        logger,
      );
    } catch (e) {
      expect((e as HttpException).message).toBe('rule not found');
    }
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('editRule project=p rule=r'),
    );
  });

  it('accepts a plain-string upstream body', () => {
    try {
      throwUpstreamHttpError(
        { response: { status: 404, data: 'not found' } },
        'ctx',
        logger,
      );
    } catch (e) {
      expect((e as HttpException).message).toBe('not found');
      expect((e as HttpException).getStatus()).toBe(404);
    }
  });

  // A genuine upstream failure IS a bad gateway — only 4xx carries a caller
  // actionable meaning worth passing through.
  it.each([500, 502, 503, 504])('maps upstream %i to 502', (status) => {
    expect(
      catchStatus({ response: { status, data: { detail: 'boom' } } }),
    ).toBe(HttpStatus.BAD_GATEWAY);
  });

  it('maps a connection-level failure to 502', () => {
    expect(
      catchStatus({ code: 'ECONNREFUSED', message: 'connect ECONNREFUSED' }),
    ).toBe(HttpStatus.BAD_GATEWAY);
  });

  it('falls back to 502 with a generic message when nothing is known', () => {
    try {
      throwUpstreamHttpError({}, 'ctx', logger);
    } catch (e) {
      expect((e as HttpException).getStatus()).toBe(HttpStatus.BAD_GATEWAY);
      expect((e as HttpException).message).toBe('unknown error');
    }
  });

  describe('Retry-After', () => {
    function catchException(err: unknown): HttpException {
      try {
        throwUpstreamHttpError(err, 'ctx', logger);
      } catch (e) {
        return e as HttpException;
      }
      throw new Error('throwUpstreamHttpError did not throw');
    }

    function retryAfterOf(e: HttpException): unknown {
      const body = e.getResponse();
      return typeof body === 'object' && body !== null
        ? (body as { retryAfter?: unknown }).retryAfter
        : undefined;
    }

    // Ingestion answers the on-demand re-mining 429 with the seconds left in
    // its 24 h cooldown. Dropping it left clients with no way to know when to
    // retry.
    it.each([
      ['3600', 3600],
      [' 120 ', 120],
      [42, 42],
      ['86400', 86400],
    ])('keeps a valid Retry-After (%p) on a 429', (value, expected) => {
      const e = catchException({
        response: {
          status: 429,
          headers: { 'retry-after': value },
          data: { detail: 'already requested' },
        },
      });
      expect(e.getStatus()).toBe(429);
      expect(e.message).toBe('already requested');
      expect(retryAfterOf(e)).toBe(expected);
    });

    it.each([
      'soon',
      'Wed, 21 Oct 2026 07:28:00 GMT',
      '12.5',
      '-5',
      '0',
      '86401',
      '1e3',
      '',
      ['60'],
    ])('drops an unusable Retry-After (%p)', (value) => {
      const e = catchException({
        response: {
          status: 429,
          headers: { 'retry-after': value },
          data: { detail: 'already requested' },
        },
      });
      expect(e.getStatus()).toBe(429);
      expect(retryAfterOf(e)).toBeUndefined();
    });

    it('never carries Retry-After on a 502', () => {
      const e = catchException({
        response: {
          status: 503,
          headers: { 'retry-after': '30' },
          data: { detail: 'down' },
        },
      });
      expect(e.getStatus()).toBe(HttpStatus.BAD_GATEWAY);
      expect(retryAfterOf(e)).toBeUndefined();
    });

    it('never carries Retry-After on another forwarded status', () => {
      const e = catchException({
        response: {
          status: 409,
          headers: { 'retry-after': '30' },
          data: { detail: 'conflict' },
        },
      });
      expect(e.getStatus()).toBe(409);
      expect(retryAfterOf(e)).toBeUndefined();
    });

    it('carries nothing else from the upstream headers', () => {
      const e = catchException({
        response: {
          status: 429,
          headers: {
            'retry-after': '60',
            'set-cookie': 'a=b',
            'x-internal': '1',
          },
          data: { detail: 'already requested' },
        },
      });
      expect(e.getResponse()).toEqual({
        message: 'already requested',
        retryAfter: 60,
      });
    });

    it('reads an AxiosHeaders-like object through get()', () => {
      const headers = {
        get: (name: string) =>
          name.toLowerCase() === 'retry-after' ? '90' : undefined,
      };
      const e = catchException({
        response: { status: 429, headers, data: { detail: 'x' } },
      });
      expect(retryAfterOf(e)).toBe(90);
    });
  });

  describe('retryAfterSeconds', () => {
    it.each([
      [1, 1],
      ['900', 900],
      [86400, 86400],
    ])('accepts %p', (v, expected) => {
      expect(retryAfterSeconds(v)).toBe(expected);
    });

    it.each([0, -1, 1.5, 86401, NaN, Infinity, 'abc', null, undefined, {}])(
      'rejects %p',
      (v) => {
        expect(retryAfterSeconds(v)).toBeUndefined();
      },
    );
  });
});
