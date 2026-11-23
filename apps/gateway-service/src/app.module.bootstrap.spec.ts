import { Test } from '@nestjs/testing';

/**
 * The gateway's whole dependency graph, resolved the way NestFactory resolves
 * it at bootstrap, without instantiating anything (`preview: true`: no Redis
 * connection, no gRPC client, no secret-store call). A provider, a controller or
 * a guard whose dependency no module provides fails here with the
 * UnknownDependenciesException the service would crash on at startup (a
 * guard used via @UseGuards needs its dependencies in every module that
 * declares it). The edition is the process's (cloud when CYBEDEFEND_EDITION
 * is unset, Community in the exported tree); the cloud graph's own cases
 * live with the cloud edition, the Community graph's in
 * src/edition/community-boot.spec.ts.
 */

// What AppModule's Joi schema requires. Placeholders: nothing connects.
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
};

interface ModuleInGraph {
  metatype: { name: string };
  providers: Map<unknown, unknown>;
  isGlobal: boolean;
}

describe('AppModule bootstrap', () => {
  const savedEnv = process.env;
  let modules: ModuleInGraph[];

  beforeAll(async () => {
    process.env = { ...savedEnv, ...BOOT_ENV };
    // ConfigModule.forRoot() validates the environment when app.module loads.
    const { AppModule } = await import('./app.module');
    const app = await Test.createTestingModule({
      imports: [AppModule],
    }).compile({ preview: true });
    const { container } = app as unknown as {
      container: { getModules(): Map<string, ModuleInGraph> };
    };
    modules = [...container.getModules().values()];
  }, 120_000);

  afterAll(() => {
    process.env = savedEnv;
  });

  it('resolves every dependency of every module', () => {
    expect(modules.length).toBeGreaterThan(30);
  });
});
