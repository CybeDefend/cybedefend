import { ConfigService } from '@nestjs/config';
import { publicAppUrl } from './public-app-url';

function configOf(values: Record<string, string | undefined>): ConfigService {
  return { get: (key: string) => values[key] } as ConfigService;
}

describe('publicAppUrl', () => {
  it('prefers FRONTEND_URL', () => {
    const url = publicAppUrl(
      configOf({
        FRONTEND_URL: 'https://eu.example.com/',
        APP_PUBLIC_URL: 'https://x',
      }),
    );

    expect(url).toBe('https://eu.example.com');
  });

  it('falls back to APP_PUBLIC_URL', () => {
    const url = publicAppUrl(
      configOf({ APP_PUBLIC_URL: 'https://appsec.acme.test' }),
    );

    expect(url).toBe('https://appsec.acme.test');
  });

  it('is undefined when neither is set', () => {
    expect(publicAppUrl(configOf({}))).toBeUndefined();
  });
});

describe('communityAppUrl (the Community instance URL rule)', () => {
  // The one-warning latch is per process: each test loads a fresh module.
  function load(): typeof import('./public-app-url') {
    let mod: typeof import('./public-app-url');
    jest.isolateModules(() => {
      mod = jest.requireActual('./public-app-url');
    });
    return mod!;
  }

  it('uses the configured FRONTEND_URL, then APP_PUBLIC_URL', () => {
    const { communityAppUrl } = load();
    const logger = { warn: jest.fn() };

    expect(
      communityAppUrl(
        configOf({
          FRONTEND_URL: 'https://appsec.example.org',
          APP_PUBLIC_URL: 'https://other.example.org',
        }),
        logger,
      ),
    ).toBe('https://appsec.example.org');
    expect(
      communityAppUrl(
        configOf({ APP_PUBLIC_URL: 'https://appsec.acme.test' }),
        logger,
      ),
    ).toBe('https://appsec.acme.test');
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('strips one trailing slash and keeps a path prefix', () => {
    const { communityAppUrl } = load();
    const logger = { warn: jest.fn() };

    expect(
      communityAppUrl(
        configOf({ FRONTEND_URL: 'http://10.0.0.5:8080/' }),
        logger,
      ),
    ).toBe('http://10.0.0.5:8080');
    expect(
      communityAppUrl(
        configOf({ FRONTEND_URL: 'https://example.org/appsec/' }),
        logger,
      ),
    ).toBe('https://example.org/appsec');
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('falls back to the compose default when nothing is set, without a warning', () => {
    const { communityAppUrl, COMMUNITY_DEFAULT_APP_URL } = load();
    const logger = { warn: jest.fn() };

    expect(COMMUNITY_DEFAULT_APP_URL).toBe('http://localhost:8080');
    expect(communityAppUrl(configOf({}), logger)).toBe('http://localhost:8080');
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('replaces a value that is not an http(s) URL, warning once per process and never echoing it', () => {
    const { communityAppUrl } = load();
    const logger = { warn: jest.fn() };

    for (const bad of [
      'ftp://files.example.org',
      'not a url',
      'javascript:alert(1)',
    ]) {
      expect(communityAppUrl(configOf({ FRONTEND_URL: bad }), logger)).toBe(
        'http://localhost:8080',
      );
    }

    expect(logger.warn).toHaveBeenCalledTimes(1);
    const message = String(logger.warn.mock.calls[0][0]);
    expect(message).not.toContain('ftp://');
    expect(message).not.toContain('files.example.org');
  });
});
