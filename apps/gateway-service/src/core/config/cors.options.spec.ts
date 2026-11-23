import { buildCorsOptions } from './cors.options';

describe('buildCorsOptions', () => {
  describe('allowedHeaders', () => {
    it('allows Last-Event-ID so an SSE reconnect survives the preflight', () => {
      // @microsoft/fetch-event-source adds `Last-Event-ID` to every reconnect
      // once the stream has delivered an event carrying an `id` — and the
      // gateway's very first frame does. Leaving it out of the preflight
      // allow-list makes every single reconnection fail at the browser, which
      // silently kills the realtime stream of a dashboard page.
      const { allowedHeaders } = buildCorsOptions({});
      expect(allowedHeaders).toContain('Last-Event-ID');
    });

    it('allows Cache-Control, which SSE clients send to defeat proxy caching', () => {
      const { allowedHeaders } = buildCorsOptions({});
      expect(allowedHeaders).toContain('Cache-Control');
    });

    it('keeps the headers the API already relied on', () => {
      const { allowedHeaders } = buildCorsOptions({});
      expect(allowedHeaders).toEqual([
        'Authorization',
        'Content-Type',
        'Last-Event-ID',
        'Cache-Control',
      ]);
    });

    it('never answers with a wildcard header allow-list', () => {
      const { allowedHeaders } = buildCorsOptions({});
      expect(allowedHeaders).not.toContain('*');
    });
  });

  // The throttler counts every request of a user, the dashboard's and its MCP
  // agents' alike, and blocks them all for 60 to 900 s past the limit. The
  // dashboard can only slow down before that if it can read what is left.
  describe('exposedHeaders', () => {
    it('lets the dashboard read the rate-limit headers the throttler sets', () => {
      const { exposedHeaders } = buildCorsOptions({});
      expect(exposedHeaders).toEqual([
        'X-RateLimit-Limit',
        'X-RateLimit-Remaining',
        'X-RateLimit-Reset',
        'Retry-After',
      ]);
    });

    it('never exposes every header with a wildcard', () => {
      expect(buildCorsOptions({}).exposedHeaders).not.toContain('*');
    });
  });

  describe('origin', () => {
    it('splits FRONTEND_URL on commas into an explicit allow-list', () => {
      const { origin } = buildCorsOptions({
        FRONTEND_URL: 'https://app.example.com,https://eu.example.com',
      });
      expect(origin).toEqual([
        'https://app.example.com',
        'https://eu.example.com',
      ]);
    });

    it('falls back to the local dashboard when FRONTEND_URL is unset', () => {
      const { origin } = buildCorsOptions({});
      expect(origin).toEqual(['http://localhost:3002']);
    });

    it('is an allow-list, never a reflection of the request Origin', () => {
      // Guards against a regression to `origin: true` or a reflecting
      // callback, which is equivalent to allowing any origin — and this API
      // answers with `credentials: true`.
      const { origin } = buildCorsOptions({
        FRONTEND_URL: 'https://app.example.com',
      });
      expect(Array.isArray(origin)).toBe(true);
      expect(origin).not.toContain('*');
    });
  });

  describe('the rest of the policy is unchanged', () => {
    it('keeps credentialed requests enabled', () => {
      expect(buildCorsOptions({}).credentials).toBe(true);
    });

    it('keeps the same method allow-list', () => {
      expect(buildCorsOptions({}).methods).toEqual([
        'GET',
        'POST',
        'PUT',
        'DELETE',
        'PATCH',
      ]);
    });
  });

  it('accepts process.env directly', () => {
    // main.ts hands it `process.env`; the factory must accept that shape.
    expect(() => buildCorsOptions(process.env)).not.toThrow();
  });
});
