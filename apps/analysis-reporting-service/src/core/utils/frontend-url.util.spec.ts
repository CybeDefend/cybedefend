import { readFileSync } from 'fs';
import { join } from 'path';
import * as util from './frontend-url.util';
import {
  COMMUNITY_DEFAULT_FRONTEND_URL,
  resolveConfiguredFrontendUrl,
} from './frontend-url.util';

const configOf = (values: Record<string, string | undefined>) => ({
  get: jest.fn(
    (key: string, fallback?: string) => values[key] ?? fallback,
  ) as jest.Mock,
});

const withEdition = (edition: string | undefined, run: () => void) => {
  const previous = process.env.CYBEDEFEND_EDITION;
  if (edition === undefined) delete process.env.CYBEDEFEND_EDITION;
  else process.env.CYBEDEFEND_EDITION = edition;
  try {
    run();
  } finally {
    if (previous === undefined) delete process.env.CYBEDEFEND_EDITION;
    else process.env.CYBEDEFEND_EDITION = previous;
  }
};

describe('resolveConfiguredFrontendUrl', () => {
  it('uses the instance public URL, never a hosted host', () => {
    const config = configOf({ FRONTEND_URL: 'https://appsec.example.org' });
    expect(resolveConfiguredFrontendUrl(config, { warn: jest.fn() })).toBe(
      'https://appsec.example.org',
    );
    for (const [key] of config.get.mock.calls) {
      expect(key).toBe('FRONTEND_URL');
    }
  });

  it('keeps a path prefix and strips one trailing slash', () => {
    expect(
      resolveConfiguredFrontendUrl(
        configOf({ FRONTEND_URL: 'http://10.0.0.5:8080/' }),
        { warn: jest.fn() },
      ),
    ).toBe('http://10.0.0.5:8080');
    expect(
      resolveConfiguredFrontendUrl(
        configOf({ FRONTEND_URL: 'https://example.org/appsec/' }),
        { warn: jest.fn() },
      ),
    ).toBe('https://example.org/appsec');
  });

  it('defaults to http://localhost:8080 when FRONTEND_URL is unset, without a warning', () => {
    const logger = { warn: jest.fn() };
    expect(resolveConfiguredFrontendUrl(configOf({}), logger)).toBe(
      COMMUNITY_DEFAULT_FRONTEND_URL,
    );
    expect(COMMUNITY_DEFAULT_FRONTEND_URL).toBe('http://localhost:8080');
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it.each([
    'ftp://example.org',
    'javascript:alert(1)',
    'example.org',
    'not a url',
    '',
  ])(
    'refuses %p, falls back to http://localhost:8080 and warns once per process',
    async (value) => {
      await jest.isolateModulesAsync(async () => {
        const fresh = await import('./frontend-url.util');
        const logger = { warn: jest.fn() };
        for (let i = 0; i < 3; i++) {
          expect(
            fresh.resolveConfiguredFrontendUrl(
              configOf({ FRONTEND_URL: value }),
              logger,
            ),
          ).toBe('http://localhost:8080');
        }
        expect(logger.warn).toHaveBeenCalledTimes(1);
        const message = String(logger.warn.mock.calls[0][0]);
        expect(message).toContain('FRONTEND_URL');
        expect(message).toContain('http://localhost:8080');
        if (value) expect(message).not.toContain(value);
      });
    },
  );

  // The core resolution is neutral: whatever the edition and whatever the
  // hosted environment name, no cybedefend.com host comes out of it unless
  // the instance configured one.
  it.each([undefined, 'community', 'cloud', 'enterprise'])(
    'yields no cybedefend.com host in the %p edition unless FRONTEND_URL names one',
    (edition) => {
      withEdition(edition, () => {
        for (const env of [
          'dev',
          'staging',
          'production',
          'any-region',
          '',
          'x',
        ]) {
          const url = resolveConfiguredFrontendUrl(
            configOf({ NODE_ENV: env }),
            { warn: jest.fn() },
          );
          expect(url).toBe(COMMUNITY_DEFAULT_FRONTEND_URL);
          expect(url).not.toMatch(/cybedefend\.com/i);
        }
        expect(
          resolveConfiguredFrontendUrl(
            configOf({ FRONTEND_URL: 'https://www.cybedefend.com' }),
            { warn: jest.fn() },
          ),
        ).toBe('https://www.cybedefend.com');
      });
    },
  );

  it('holds no hosted environment mapping in the core', () => {
    expect((util as Record<string, unknown>).buildFrontendUrl).toBeUndefined();
    expect(
      (util as Record<string, unknown>).resolveFrontendUrl,
    ).toBeUndefined();
    const source = readFileSync(
      join(__dirname, 'frontend-url.util.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/cybedefend\.com/i);
    expect(source).not.toMatch(/_ENVIRONMENT\b/);
  });
});
