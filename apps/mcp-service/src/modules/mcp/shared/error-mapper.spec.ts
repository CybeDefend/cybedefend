import { MCP_ERROR_CODES, McpToolError, NotFoundError } from '../tools/errors';
import { mapErrorToPayload } from './error-mapper';

/**
 * Specs for the upstream-error → MCP-error mapper.
 *
 * Key contract: the mapper MUST NOT echo the raw upstream
 * response body to the caller — it may contain secrets, tokens, or other
 * privileged metadata. Only the HTTP status code is used to pick a
 * canonical {code, message} pair; the upstream body is summarised as
 * `{ statusText: <numeric status> }` at most, never copied verbatim.
 */
describe('mapErrorToPayload', () => {
  it('passes through McpToolError instances via toPayload()', () => {
    const err = new NotFoundError('Vulnerability', 'v-1');
    expect(mapErrorToPayload(err)).toEqual(err.toPayload());
  });

  /**
   * REGRESSION GUARD: a 401 from upstream MUST become `UNAUTHENTICATED`,
   * not `INTERNAL`. Background — Action 1 (`session.accessTokenRef`) makes
   * every Gateway call carry the freshest bearer, but rare edge cases
   * still surface 401 (JWKS rotation race, user revoked mid-session,
   * audience mismatch). When that happens, surfacing the failure as
   * `INTERNAL` swallows the auth signal and the dashboard/agent can't
   * render an actionable "please re-authenticate" hint. The dedicated
   * `UNAUTHENTICATED` code keeps the wire shape distinct and the upstream
   * body is still dropped on the floor (never echo secrets).
   */
  it('maps 401 axios responses to UNAUTHENTICATED with statusText details only', () => {
    const upstream = {
      response: {
        status: 401,
        // Body intentionally carries a sensitive value — must NEVER be echoed.
        data: {
          error: 'invalid_token',
          refresh_token: 'leaky-refresh-do-not-echo',
        },
      },
    };
    const payload = mapErrorToPayload(upstream);
    expect(payload.code).toBe(MCP_ERROR_CODES.UNAUTHENTICATED);
    expect(payload.details).toEqual({ statusText: 401 });
    expect(JSON.stringify(payload)).not.toContain('leaky-refresh-do-not-echo');
    expect(JSON.stringify(payload)).not.toContain('refresh_token');
  });

  it('maps 403 axios responses to PERMISSION_DENIED without leaking the body', () => {
    const upstream = {
      response: {
        status: 403,
        data: { error: 'forbidden', secret: 'super-private-value' },
      },
    };
    const payload = mapErrorToPayload(upstream);
    expect(payload.code).toBe(MCP_ERROR_CODES.PERMISSION_DENIED);
    // No upstream body anywhere — neither at the root nor inside details.
    const serialised = JSON.stringify(payload);
    expect(serialised).not.toContain('super-private-value');
    expect(serialised).not.toContain('secret');
  });

  it('maps 404 axios responses to NOT_FOUND with statusText details only', () => {
    const upstream = {
      response: {
        status: 404,
        data: { token: 'leaky-bearer-do-not-echo' },
      },
    };
    const payload = mapErrorToPayload(upstream);
    expect(payload.code).toBe(MCP_ERROR_CODES.NOT_FOUND);
    expect(payload.details).toEqual({ statusText: 404 });
    expect(JSON.stringify(payload)).not.toContain('leaky-bearer-do-not-echo');
  });

  it('maps 400 axios responses to INVALID_ARGUMENT', () => {
    const payload = mapErrorToPayload({ response: { status: 400, data: {} } });
    expect(payload.code).toBe(MCP_ERROR_CODES.INVALID_ARGUMENT);
  });

  it('maps 422 axios responses to INVALID_ARGUMENT', () => {
    const payload = mapErrorToPayload({ response: { status: 422, data: {} } });
    expect(payload.code).toBe(MCP_ERROR_CODES.INVALID_ARGUMENT);
  });

  it('maps 5xx axios responses to UNAVAILABLE', () => {
    const payload = mapErrorToPayload({
      response: { status: 503, data: { upstreamSecret: 'nope' } },
    });
    expect(payload.code).toBe(MCP_ERROR_CODES.UNAVAILABLE);
    expect(JSON.stringify(payload)).not.toContain('upstreamSecret');
  });

  it('maps connection-level failures (ECONNREFUSED) to UNAVAILABLE', () => {
    const payload = mapErrorToPayload({ code: 'ECONNREFUSED' });
    expect(payload.code).toBe(MCP_ERROR_CODES.UNAVAILABLE);
  });

  it('falls back to INTERNAL for unknown errors', () => {
    const payload = mapErrorToPayload(new Error('something off'));
    expect(payload.code).toBe(MCP_ERROR_CODES.INTERNAL);
  });

  it('never includes an `upstream` details field even when raw body is JSON', () => {
    const upstream = {
      response: {
        status: 500,
        data: {
          message: 'oh no',
          details: { secret: 'xyz' },
          authorization: 'Bearer leaked',
        },
      },
    };
    const payload = mapErrorToPayload(upstream);
    expect(payload.details).not.toBeUndefined();
    expect(payload.details).not.toHaveProperty('upstream');
    expect(JSON.stringify(payload)).not.toContain('xyz');
    expect(JSON.stringify(payload)).not.toContain('Bearer leaked');
  });

  it('returns a payload whose details, when present, only carry statusText', () => {
    const payload = mapErrorToPayload({
      response: { status: 418, data: { tea: 'pot' } },
    });
    if (payload.details) {
      expect(Object.keys(payload.details)).toEqual(['statusText']);
    }
  });

  it('passes through McpToolError subclasses verbatim (no body wrapping)', () => {
    const tool = new McpToolError(
      MCP_ERROR_CODES.INVALID_ARGUMENT,
      'arg foo: bad',
      { argument: 'foo' },
    );
    expect(mapErrorToPayload(tool)).toEqual({
      code: MCP_ERROR_CODES.INVALID_ARGUMENT,
      message: 'arg foo: bad',
      details: { argument: 'foo' },
    });
  });

  it("tells the agent what the gateway refused in a 400, from the gateway client's validation message", () => {
    const err = Object.assign(new Error('ignored'), {
      response: { status: 400 },
      validationMessage:
        'each value in severity must be one of the following values: critical, high',
    });

    expect(mapErrorToPayload(err)).toEqual({
      code: MCP_ERROR_CODES.INVALID_ARGUMENT,
      message:
        'Invalid argument: each value in severity must be one of the following values: critical, high',
      details: { statusText: 400 },
    });
  });

  it('still never echoes a raw upstream body on a 400', () => {
    const payload = mapErrorToPayload({
      response: { status: 400, data: { message: 'secret-ish body' } },
    });

    expect(payload.message).toBe('Invalid argument');
  });
});
