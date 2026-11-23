import { Test } from '@nestjs/testing';
import type { Type } from '@nestjs/common';

/**
 * global-management's whole dependency graph in community mode, resolved the
 * way NestFactory resolves it at bootstrap, without instantiating anything
 * (`preview: true`: no database connection, no gRPC client, no secret-store
 * call). CYBEDEFEND_EDITION is set in beforeAll, before any dynamic import of
 * a module, because editionImports() runs when the @Module decorator is
 * evaluated, i.e. at import time.
 */

// What the Joi schema requires. Placeholders: nothing connects.
// No DB_TYPE / DB_HOST / DB_PORT / MYSQL_* key on purpose: the specs compile
// in preview mode and open no connection, and a DB_TYPE=postgres
// variant of this spec by spreading the same BOOT_ENV.
const BOOT_ENV: Record<string, string> = {
  NODE_ENV: 'development',
  GRPC_URL_ANALYSIS_REPORTING_SERVICE: '127.0.0.1:1',
  GRPC_URL_SECURITY_SCANNING_SERVICE: '127.0.0.1:1',
  GRPC_URL_EXTERNAL_INTEGRATIONS_SERVICE: '127.0.0.1:1',
  PERMIFY_ENDPOINT: '127.0.0.1:1',
  FRONTEND_URL: 'http://127.0.0.1:1',
  OTEL_DISABLED: 'true',
  CYBEDEFEND_EDITION: 'community',
  // Required in community by the Joi schema (a placeholder value,
  // nothing connects in preview mode).
  CYBEDEFEND_SETUP_TOKEN: 'boot-spec-placeholder-of-32-characters',
};

const CONTEXTS: Array<[string, () => Promise<Record<string, unknown>>]> = [
  ['AppModule', () => import('../app.module')],
  ['DataPurgeCronModule', () => import('../data-purge.cron.module')],
  // The lead follow-up cron is closed entirely: the Community Edition has no
  // such context.
];

interface ModuleInGraph {
  metatype: { name: string } | Type<unknown>;
  isGlobal: boolean;
  providers: Map<unknown, unknown>;
  controllers: Map<unknown, unknown>;
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
    // No closed provider either, whichever module would carry it (the Logto
    // client only exists in the closed edition).
    const tokenName = (token: unknown) =>
      typeof token === 'function' ? token.name : String(token);
    expect(
      modules.flatMap((m) =>
        [...m.providers.keys()]
          .map(tokenName)
          .filter((name) => name === 'LogtoAdminService'),
      ),
    ).toEqual([]);
    // No closed controller either (the per-member product RPCs are served by
    // the closed edition only).
    expect(
      modules
        .flatMap((m) => [...m.controllers.keys()].map(tokenName))
        .filter((name) => name === 'MemberProductsController'),
    ).toEqual([]);
    // The local auth gRPC server loads in community mode, through
    // COMMUNITY_ONLY_MODULES, which only the API context spreads.
    if (name === 'AppModule') {
      expect(
        modules
          .flatMap((m) => [...m.controllers.keys()].map(tokenName))
          .filter((n) => n === 'LocalAuthController'),
      ).toEqual(['LocalAuthController']);
    }
    // The data purge runs in-process in the API context (no
    // CronJob in the Community compose); the one-shot cron context, still
    // compiled for the cloud, never carries a timer of its own.
    expect(
      modules
        .flatMap((m) => [...m.providers.keys()].map(tokenName))
        .filter((n) => n === 'DataPurgeScheduler'),
    ).toEqual(name === 'AppModule' ? ['DataPurgeScheduler'] : []);
  }, 120_000);
});

// The cloud halves of the two wiring tests below (absent in cloud mode) live
// in the closed edition.
describe('LocalAuthModule wiring', () => {
  const savedEnv = process.env;

  afterAll(() => {
    process.env = savedEnv;
  });

  it('is in editionImports() in community mode', async () => {
    const { editionImports, editionModuleClass } =
      await import('./edition-imports');
    const names = () => editionImports().map((m) => editionModuleClass(m).name);
    process.env = { ...savedEnv, CYBEDEFEND_EDITION: 'community' };
    expect(names()).toContain('LocalAuthModule');
  });
});

describe('DataPurgeSchedulerModule wiring', () => {
  const savedEnv = process.env;

  afterAll(() => {
    process.env = savedEnv;
  });

  it('is in editionImports() in community mode', async () => {
    const { editionImports, editionModuleClass } =
      await import('./edition-imports');
    const names = () => editionImports().map((m) => editionModuleClass(m).name);
    process.env = { ...savedEnv, CYBEDEFEND_EDITION: 'community' };
    expect(names()).toContain('DataPurgeSchedulerModule');
  });
});
