// Loading AppModule pulls in GithubService/GitlabService, which import
// ESM-only octokit packages — mock them exactly as community-boot.spec.ts
// does so the module can load under jest.
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
 * The core AppModule must name no CRM module or controller. In
 * community mode editionImports() adds nothing, so CrmSyncModule /
 * CrmSyncGrpcController may only reach the API context through EE_FEATURE_MODULES
 * (as CrmSyncApiModule) in cloud mode. CYBEDEFEND_EDITION is set before the
 * dynamic import because editionImports() runs when the @Module decorator is
 * evaluated, i.e. at import time; the Joi schema also validates at decoration
 * time, hence the placeholder BOOT_ENV.
 */
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

const nameOf = (m: unknown): string =>
  typeof m === 'function'
    ? (m as { name: string }).name
    : ((m as { module?: { name: string } }).module?.name ?? String(m));

describe('AppModule edition wiring', () => {
  const savedEnv = process.env;

  beforeAll(() => {
    process.env = { ...savedEnv, ...BOOT_ENV };
  }, 120_000);

  afterAll(() => {
    process.env = savedEnv;
  });

  it('the core AppModule names no CRM module or controller', async () => {
    const { AppModule } = await import('./app.module');

    const imports = (
      Reflect.getMetadata('imports', AppModule) as unknown[]
    ).map(nameOf);
    expect(imports).not.toContain('CrmSyncModule');
    expect(imports).not.toContain('CrmSyncApiModule');
    const controllers = (
      Reflect.getMetadata('controllers', AppModule) as unknown[]
    ).map(nameOf);
    expect(controllers).not.toContain('CrmSyncGrpcController');
  }, 120_000);

  it('the core AppModule does not serve the repository history', async () => {
    const { AppModule } = await import('./app.module');

    const imports = (
      Reflect.getMetadata('imports', AppModule) as unknown[]
    ).map(nameOf);
    // RepositoryHistoryModule belongs to the closed edition;
    // it reaches the API context through EE_FEATURE_MODULES in cloud mode
    // only, via ...editionImports().
    expect(imports).not.toContain('RepositoryHistoryModule');
  }, 120_000);
});
