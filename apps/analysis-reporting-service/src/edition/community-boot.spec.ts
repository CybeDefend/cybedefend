import { Test } from '@nestjs/testing';
import type { Type } from '@nestjs/common';

/**
 * analysis-reporting's whole dependency graph in community mode, resolved the
 * way NestFactory resolves it at bootstrap, without instantiating anything
 * (`preview: true`: no database connection, no gRPC client, no secret-store
 * call). CYBEDEFEND_EDITION is set in beforeAll, before any dynamic import of
 * a module, because editionImports() runs when the @Module decorator is
 * evaluated, i.e. at import time.
 */

// What the Joi schema of every context requires. Placeholders: nothing
// connects. No DB_TYPE / DB_HOST / DB_PORT / MYSQL_* key on purpose: the specs
// compile in preview mode and open no connection, and a
// DB_TYPE=postgres variant of this spec by spreading the same BOOT_ENV.
const BOOT_ENV: Record<string, string> = {
  NODE_ENV: 'development',
  GRPC_URL_ANALYSIS_REPORTING_SERVICE: '127.0.0.1:1',
  GRPC_URL_SECURITY_SCANNING_SERVICE: '127.0.0.1:1',
  GRPC_URL_GLOBAL_MANAGEMENT_SERVICE: '127.0.0.1:1',
  GRPC_URL_AGENT_SERVICE: '127.0.0.1:1',
  GRPC_URL_BILLING_SERVICE: '127.0.0.1:1',
  REDIS_URL: 'redis://127.0.0.1:1',
  OTEL_DISABLED: 'true',
  CYBEDEFEND_EDITION: 'community',
};

const CONTEXTS: Array<[string, () => Promise<Record<string, unknown>>]> = [
  ['AppModule', () => import('../app.module')],
  ['WorkerModule', () => import('../worker.module')],
  ['WorkerReportsModule', () => import('../worker-reports.module')],
  // WorkerAutoFixModule is closed with the SCA autofix; the
  // Community Edition has no autofix worker.
  // CronOsvModule and CronEpssModule are closed contexts;
  // the Community Edition has no OSV or EPSS process.
  ['ReportMailCronModule', () => import('../report.mail.cron.module')],
  [
    'ReportRetentionCronModule',
    () => import('../report-retention.cron.module'),
  ],
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
});
