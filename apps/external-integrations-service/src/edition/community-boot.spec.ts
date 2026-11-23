import { Test } from '@nestjs/testing';
import type { Type } from '@nestjs/common';

// Loading AppModule/WorkerModule pulls in GithubService/GitlabService, which
// import ESM-only octokit packages — mock them exactly as worker.module.spec.ts
// does so the modules can load under jest.
jest.mock('@octokit/auth-app', () => ({ createAppAuth: jest.fn() }));
const MockOctokit = jest
  .fn()
  .mockImplementation(() => ({ request: jest.fn() }));
(MockOctokit as unknown as { plugin: jest.Mock }).plugin = jest
  .fn()
  .mockReturnValue(MockOctokit);
jest.mock('@octokit/rest', () => ({ Octokit: MockOctokit }));
jest.mock('@octokit/plugin-retry', () => ({ retry: jest.fn() }));
jest.mock('@octokit/plugin-throttling', () => ({ throttling: jest.fn() }));

/**
 * external-integrations' whole dependency graph in community mode, resolved
 * the way NestFactory resolves it at bootstrap, without instantiating anything
 * (`preview: true`: no database connection, no gRPC client, no Redis
 * connection, no secret-store call). CYBEDEFEND_EDITION is set in beforeAll,
 * before any dynamic import of a module, because editionImports() runs when
 * the @Module decorator is evaluated, i.e. at import time.
 */

// What the Joi schema requires. Placeholders: nothing connects.
// No DB_TYPE / DB_HOST / DB_PORT / MYSQL_* key on purpose: the specs compile
// in preview mode and open no connection, and a DB_TYPE=postgres
// variant of this spec spreads the same BOOT_ENV.
const BOOT_ENV: Record<string, string> = {
  NODE_ENV: 'development',
  REDIS_URL: 'redis://127.0.0.1:1',
  GRPC_URL_SECURITY_SCANNING_SERVICE: '127.0.0.1:1',
  ALLOWED_SCAN_IPS: '127.0.0.1',
  GATEWAY_URL: 'http://127.0.0.1:1',
  TWENTY_API_URL: 'http://127.0.0.1:1',
  OTEL_DISABLED: 'true',
  CYBEDEFEND_EDITION: 'community',
};

// The CRM worker belongs to the closed edition, so it is not a
// core context — the community boot spec covers the three core contexts only.
const CONTEXTS: Array<[string, () => Promise<Record<string, unknown>>]> = [
  ['AppModule', () => import('../app.module')],
  ['WorkerModule', () => import('../worker.module')],
  ['CronWebhookModule', () => import('../cron.webhook.module')],
];

interface ModuleInGraph {
  metatype: { name: string } | Type<unknown>;
  isGlobal: boolean;
}

describe.each(CONTEXTS)('%s in community mode', (name, load) => {
  const savedEnv = process.env;

  beforeAll(() => {
    process.env = { ...savedEnv, ...BOOT_ENV };
  }, 120_000);

  afterAll(() => {
    process.env = savedEnv;
  });

  it('resolves every dependency and loads no ee module', async () => {
    const mod = (await load())[name] as Type<unknown>;
    const { EE_MODULES, EE_CONTEXT_MODULES } = await import('./ee-modules');
    const { currentEdition } = await import('./edition');
    const { editionModuleClass } = await import('./edition-imports');
    expect(currentEdition()).toBe('community');
    const app = await Test.createTestingModule({ imports: [mod] }).compile({
      preview: true,
    });
    const { container } = app as unknown as {
      container: { getModules(): Map<string, ModuleInGraph> };
    };
    const modules = [...container.getModules().values()];
    expect(
      modules.some(
        (m) =>
          (m.metatype as { name: string }).name === 'EditionModule' &&
          m.isGlobal,
      ),
    ).toBe(true);
    // Every module listed in EE_MODULES / EE_CONTEXT_MODULES is closed: it
    // lives under src/ee/, and no core module imports it.
    const ee = new Set(
      [...EE_MODULES, ...Object.values(EE_CONTEXT_MODULES).flat()].map(
        editionModuleClass,
      ),
    );
    expect(
      modules
        .filter((m) => ee.has(m.metatype as Type<unknown>))
        .map((m) => (m.metatype as { name: string }).name),
    ).toEqual([]);
  }, 120_000);

  // The scan capability cache is a global
  // Community-only module of the API context (pushes and links) and of the
  // worker context (deferred rescans); the cron context does not load it.
  it('loads the global ScanCapabilityModule in the API and worker contexts only', async () => {
    const mod = (await load())[name] as Type<unknown>;
    const app = await Test.createTestingModule({ imports: [mod] }).compile({
      preview: true,
    });
    const { container } = app as unknown as {
      container: { getModules(): Map<string, ModuleInGraph> };
    };
    const scanCapability = [...container.getModules().values()].filter(
      (m) => (m.metatype as { name: string }).name === 'ScanCapabilityModule',
    );
    if (name === 'AppModule' || name === 'WorkerModule') {
      expect(scanCapability.map((m) => m.isGlobal)).toEqual([true]);
    } else {
      expect(scanCapability).toEqual([]);
    }
  }, 120_000);
});
