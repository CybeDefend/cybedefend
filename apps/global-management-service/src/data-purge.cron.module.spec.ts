/**
 * The dependency graphs of the data purge CronJob and of the service,
 * resolved the way NestFactory resolves them at bootstrap, without
 * instantiating anything (`preview: true`: no database, no gRPC channel, no
 * Permify, no secret-store call). A provider whose dependency no module provides
 * fails here with the UnknownDependenciesException a pod would crash on.
 */

// What the Joi schema requires. Placeholders: nothing connects.
const BOOT_ENV: Record<string, string> = {
  NODE_ENV: 'development',
  GRPC_URL_ANALYSIS_REPORTING_SERVICE: '127.0.0.1:1',
  GRPC_URL_SECURITY_SCANNING_SERVICE: '127.0.0.1:1',
  GRPC_URL_EXTERNAL_INTEGRATIONS_SERVICE: '127.0.0.1:1',
  PERMIFY_ENDPOINT: '127.0.0.1:1',
  FRONTEND_URL: 'http://127.0.0.1:1',
  OTEL_DISABLED: 'true',
};

interface ModuleInGraph {
  metatype: { name: string };
  providers: Map<unknown, unknown>;
}

async function graphOf(load: () => Promise<unknown>): Promise<ModuleInGraph[]> {
  const root = await load();
  // Imported dynamically so that, after jest.resetModules() in the community
  // describe, the testing module and the root module come from the same
  // module registry (two copies of @nestjs/core would break ModuleRef's
  // token identity).
  const { Test } = await import('@nestjs/testing');
  const app = await Test.createTestingModule({
    imports: [root as never],
  }).compile({ preview: true });
  const { container } = app as unknown as {
    container: { getModules(): Map<string, ModuleInGraph> };
  };
  return [...container.getModules().values()];
}

describe('data purge bootstrap', () => {
  const savedEnv = process.env;

  beforeAll(() => {
    process.env = { ...savedEnv, ...BOOT_ENV };
  });
  afterAll(() => {
    process.env = savedEnv;
  });

  it('the CronJob module resolves the runner and every dependency of it', async () => {
    const { DataPurgeRunner } =
      await import('./modules/data-purge/data-purge.runner');
    const modules = await graphOf(async () => {
      const { DataPurgeCronModule } = await import('./data-purge.cron.module');
      return DataPurgeCronModule;
    });

    expect(modules.some((m) => m.providers.has(DataPurgeRunner))).toBe(true);
  }, 120_000);

  it('the service resolves the runner the deletions kick', async () => {
    const { DataPurgeRunner } =
      await import('./modules/data-purge/data-purge.runner');
    const modules = await graphOf(async () => {
      const { AppModule } = await import('./app.module');
      return AppModule;
    });

    expect(
      modules
        .filter((m) => m.providers.has(DataPurgeRunner))
        .map((m) => m.metatype.name),
    ).toEqual(['DataPurgeModule']);
  }, 120_000);
});

/**
 * The same two graphs in community mode. CYBEDEFEND_EDITION is set in
 * beforeAll and jest.resetModules() runs before each test, because
 * editionImportsFor() runs when the @Module decorator is evaluated, i.e. at
 * import time: the module must be re-imported to see the community value.
 */
describe('data purge bootstrap in community mode', () => {
  const savedEnv = process.env;

  beforeAll(() => {
    // CYBEDEFEND_SETUP_TOKEN is required in community by the Joi schema;
    // a placeholder value, nothing connects in preview mode.
    process.env = {
      ...savedEnv,
      ...BOOT_ENV,
      CYBEDEFEND_EDITION: 'community',
      CYBEDEFEND_SETUP_TOKEN: 'boot-spec-placeholder-of-32-characters',
    };
  });
  afterAll(() => {
    process.env = savedEnv;
  });
  beforeEach(() => {
    jest.resetModules();
  });

  it('the CronJob module resolves the runner and every dependency of it', async () => {
    const { DataPurgeRunner } =
      await import('./modules/data-purge/data-purge.runner');
    const modules = await graphOf(async () => {
      const { DataPurgeCronModule } = await import('./data-purge.cron.module');
      return DataPurgeCronModule;
    });

    expect(modules.some((m) => m.providers.has(DataPurgeRunner))).toBe(true);
  }, 120_000);

  it('the service resolves the runner the deletions kick', async () => {
    const { DataPurgeRunner } =
      await import('./modules/data-purge/data-purge.runner');
    const modules = await graphOf(async () => {
      const { AppModule } = await import('./app.module');
      return AppModule;
    });

    expect(
      modules
        .filter((m) => m.providers.has(DataPurgeRunner))
        .map((m) => m.metatype.name),
    ).toEqual(['DataPurgeModule']);
  }, 120_000);

  it('imports no closed module in community mode', async () => {
    const modules = await graphOf(async () => {
      const { DataPurgeCronModule } = await import('./data-purge.cron.module');
      return DataPurgeCronModule;
    });
    // By name: a core spec may not import the closed edition (edition-boundary.spec.ts),
    // and the exported tree has no such module to import.
    expect(modules.some((m) => m.metatype.name === 'EeGrpcClientsModule')).toBe(
      false,
    );
  }, 120_000);
});
