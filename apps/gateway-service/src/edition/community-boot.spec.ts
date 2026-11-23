import { Test } from '@nestjs/testing';
import type { Type } from '@nestjs/common';
import { JwksSourceTestingModule } from '../core/guards/auth/testing/jwks-source.testing';

/**
 * The gateway's whole dependency graph in community mode, resolved the way
 * NestFactory resolves it at bootstrap, without instantiating anything
 * (`preview: true`: no Redis connection, no gRPC client, no secret-store call).
 * CYBEDEFEND_EDITION is set in beforeAll, before any dynamic import of a
 * module, because editionImports() runs when the @Module decorator is
 * evaluated, i.e. at import time.
 */

// What AppModule's Joi schema requires (the BOOT_ENV of
// src/app.module.bootstrap.spec.ts). Placeholders: nothing connects.
// No DB_TYPE / DB_HOST / DB_PORT / MYSQL_* key on purpose: the gateway has no
// TypeORM and the specs compile in preview mode and open no connection.
const BOOT_ENV: Record<string, string> = {
  NODE_ENV: 'development',
  GRPC_URL_ANALYSIS_REPORTING_SERVICE: '127.0.0.1:1',
  GRPC_URL_SECURITY_SCANNING_SERVICE: '127.0.0.1:1',
  GRPC_URL_EXTERNAL_INTEGRATIONS_SERVICE: '127.0.0.1:1',
  GRPC_URL_GLOBAL_MANAGEMENT_SERVICE: '127.0.0.1:1',
  GRPC_URL_FILE_MANAGEMENT_SERVICE: '127.0.0.1:1',
  GRPC_URL_AI_SERVICE: '127.0.0.1:1',
  GRPC_URL_AGENT_SERVICE: '127.0.0.1:1',
  REDIS_URL: 'redis://127.0.0.1:1',
  PERMIFY_ENDPOINT: '127.0.0.1:1',
  FRONTEND_URL: 'http://127.0.0.1:1',
  AI_SERVICE_URL: 'http://127.0.0.1:1',
  INGESTION_SERVICE_URL: 'http://127.0.0.1:1',
  OTEL_DISABLED: 'true',
  CYBEDEFEND_EDITION: 'community',
};

const CONTEXTS: Array<[string, () => Promise<Record<string, unknown>>]> = [
  ['AppModule', () => import('../app.module')],
];

interface ModuleInGraph {
  metatype: { name: string } | Type<unknown>;
  isGlobal: boolean;
  providers: Map<unknown, unknown>;
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
    // The fake JWKS source provides the token the AuthGuard injects.
    const app = await Test.createTestingModule({
      imports: [mod, JwksSourceTestingModule],
    }).compile({
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

  it('mounts the local auth routes in community only', async () => {
    const mod = (await load())[name] as Type<unknown>;
    const app = await Test.createTestingModule({
      imports: [mod, JwksSourceTestingModule],
    }).compile({
      preview: true,
    });
    const { container } = app as unknown as {
      container: { getModules(): Map<string, ModuleInGraph> };
    };
    const names = [...container.getModules().values()].map(
      (m) => (m.metatype as { name: string }).name,
    );
    expect(names).toContain('LocalAuthModule');
  }, 120_000);

  // GET /instance/capabilities, read by the Community dashboard.
  it('mounts the instance capabilities route in community only', async () => {
    const mod = (await load())[name] as Type<unknown>;
    const app = await Test.createTestingModule({
      imports: [mod, JwksSourceTestingModule],
    }).compile({
      preview: true,
    });
    const { container } = app as unknown as {
      container: { getModules(): Map<string, ModuleInGraph> };
    };
    const names = [...container.getModules().values()].map(
      (m) => (m.metatype as { name: string }).name,
    );
    expect(names).toContain('InstanceModule');
  }, 120_000);

  // POST /scan-runs/:scanId/results, the scanner
  // pods' upload route, is Community only and mounted exactly once (one
  // throttle Redis client, one ScanImportService of its own).
  it('mounts the scanner results route once, in community only', async () => {
    const mod = (await load())[name] as Type<unknown>;
    const app = await Test.createTestingModule({
      imports: [mod, JwksSourceTestingModule],
    }).compile({
      preview: true,
    });
    const { container } = app as unknown as {
      container: { getModules(): Map<string, ModuleInGraph> };
    };
    const names = [...container.getModules().values()].map(
      (m) => (m.metatype as { name: string }).name,
    );
    expect(names.filter((n) => n === 'ScanRunModule')).toEqual([
      'ScanRunModule',
    ]);
  }, 120_000);

  // POST /project/:projectId/scan/import/start, the SARIF
  // import, is Community only and mounted exactly once (one in-flight count).
  it('mounts the SARIF import route once, in community only', async () => {
    const mod = (await load())[name] as Type<unknown>;
    const app = await Test.createTestingModule({
      imports: [mod, JwksSourceTestingModule],
    }).compile({
      preview: true,
    });
    const { container } = app as unknown as {
      container: { getModules(): Map<string, ModuleInGraph> };
    };
    const names = [...container.getModules().values()].map(
      (m) => (m.metatype as { name: string }).name,
    );
    expect(names.filter((n) => n === 'ScanImportModule')).toEqual([
      'ScanImportModule',
    ]);
  }, 120_000);

  /**
   * In the Community graph one global REDIS_CLIENT serves every module (the
   * cloud graph adds a closed module's own client).
   */
  it('opens one gateway-wide Redis client, not one per module', async () => {
    const mod = (await load())[name] as Type<unknown>;
    const app = await Test.createTestingModule({
      imports: [mod, JwksSourceTestingModule],
    }).compile({
      preview: true,
    });
    const { container } = app as unknown as {
      container: { getModules(): Map<string, ModuleInGraph> };
    };
    const modules = [...container.getModules().values()];
    const nameOf = (m: ModuleInGraph) => (m.metatype as { name: string }).name;
    expect(
      modules
        .filter((m) => m.providers.has('REDIS_CLIENT'))
        .map(nameOf)
        .sort(),
    ).toEqual(['GatewayRedisModule']);
    expect(
      modules.find((m) => nameOf(m) === 'GatewayRedisModule')?.isGlobal,
    ).toBe(true);
  }, 120_000);
});
