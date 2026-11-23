import 'reflect-metadata';

/**
 * The `auth:reset-password` operator CLI is Community Edition only: in the cloud edition it refuses before booting
 * anything — no tracer, no Nest context, no database — writes one line on
 * stderr and exits 1. Its root module imports LocalAuthModule only in the
 * Community Edition.
 */

const startTracer = jest.fn(async () => undefined);
const createApplicationContext = jest.fn();

jest.mock('./tracer', () => ({
  __esModule: true,
  default: { start: startTracer },
}));
jest.mock('@nestjs/core', () => ({
  ...jest.requireActual('@nestjs/core'),
  NestFactory: { createApplicationContext },
}));

// What the Joi schema requires: ConfigModule.forRoot validates when the
// module is imported. Placeholders: nothing connects.
const BOOT_ENV: Record<string, string> = {
  NODE_ENV: 'development',
  GRPC_URL_ANALYSIS_REPORTING_SERVICE: '127.0.0.1:1',
  GRPC_URL_SECURITY_SCANNING_SERVICE: '127.0.0.1:1',
  GRPC_URL_EXTERNAL_INTEGRATIONS_SERVICE: '127.0.0.1:1',
  PERMIFY_ENDPOINT: '127.0.0.1:1',
  FRONTEND_URL: 'http://127.0.0.1:1',
  OTEL_DISABLED: 'true',
  CYBEDEFEND_SETUP_TOKEN: 'a-setup-token-of-at-least-32-characters',
};

// The cloud cases (the entrypoint refuses, the module has no LocalAuthModule)
// live in the closed edition.
describe('auth:reset-password CLI in the Community Edition', () => {
  const savedEnv = process.env;
  let exit: jest.SpyInstance;
  let stderr: jest.SpyInstance;

  beforeEach(() => {
    process.env = { ...savedEnv, ...BOOT_ENV };
    exit = jest
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);
    stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    startTracer.mockClear();
    createApplicationContext.mockClear();
  });

  afterEach(() => {
    exit.mockRestore();
    stderr.mockRestore();
    process.env = savedEnv;
  });

  it('the CLI module imports LocalAuthModule in the Community Edition', async () => {
    process.env.CYBEDEFEND_EDITION = 'community';
    await jest.isolateModulesAsync(async () => {
      const { AuthResetPasswordCliModule } =
        await import('./auth-reset-password.cli.module');
      const { LocalAuthModule } =
        await import('./modules/local-auth/local-auth.module');
      const imports = Reflect.getMetadata(
        'imports',
        AuthResetPasswordCliModule,
      ) as unknown[];
      expect(imports).toContain(LocalAuthModule);
    });
  });
});
