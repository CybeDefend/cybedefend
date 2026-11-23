import type { Provider } from '@nestjs/common';
import {
  CONFIGURED_FRONTEND_URL_RESOLVER,
  FRONTEND_URL_RESOLVER,
  type FrontendUrlResolver,
} from '../ports/frontend-url.port';
import { bindingToken } from '../merge-bindings';

type EditionImportsModule = typeof import('../edition-imports');

async function bindingsFor(edition: string): Promise<Provider[]> {
  const saved = process.env.CYBEDEFEND_EDITION;
  process.env.CYBEDEFEND_EDITION = edition;
  try {
    let mod: EditionImportsModule | undefined;
    await jest.isolateModulesAsync(async () => {
      mod = await import('../edition-imports');
    });
    return (mod as EditionImportsModule).editionBindings();
  } finally {
    if (saved === undefined) delete process.env.CYBEDEFEND_EDITION;
    else process.env.CYBEDEFEND_EDITION = saved;
  }
}

const configOf = (values: Record<string, string | undefined>) => ({
  get: jest.fn(
    (key: string, fallback?: string) => values[key] ?? fallback,
  ) as jest.Mock,
});

/**
 * FRONTEND_URL_RESOLVER is bound in every edition. The Community Edition
 * binds the configured resolution: the instance's FRONTEND_URL, whatever a
 * hosted environment name says.
 */
describe('FRONTEND_URL_RESOLVER bindings', () => {
  it('binds the configured resolution in the Community Edition', async () => {
    const binding = (await bindingsFor('community')).find(
      (provider) => bindingToken(provider) === FRONTEND_URL_RESOLVER,
    );
    expect(binding).toBeDefined();
    const resolver = (binding as { useValue: FrontendUrlResolver }).useValue;
    for (const env of ['dev', 'staging', 'production', 'any-region']) {
      const config = configOf({
        NODE_ENV: env,
        FRONTEND_URL: 'https://appsec.example.org/',
      });
      expect(resolver.resolve(config, { warn: jest.fn() })).toBe(
        'https://appsec.example.org',
      );
      for (const [key] of config.get.mock.calls) {
        expect(key).toBe('FRONTEND_URL');
      }
    }
  });

  it('falls back to the local default, never a cybedefend.com host', () => {
    const url = CONFIGURED_FRONTEND_URL_RESOLVER.resolve(
      configOf({ NODE_ENV: 'production' }),
      { warn: jest.fn() },
    );
    expect(url).toBe('http://localhost:8080');
    expect(url).not.toMatch(/cybedefend\.com/i);
  });
});
