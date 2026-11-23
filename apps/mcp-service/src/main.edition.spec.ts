/* eslint-disable @typescript-eslint/no-require-imports -- main.ts and the
   edition files must be loaded inside jest.isolateModules, after
   CYBEDEFEND_EDITION is set: editionProtoPaths() reads it at bootstrap, and
   its closed list is loaded with ee-modules.ts. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// `jose@6` ships only as native ESM, which Jest's CJS runtime cannot load,
// and src/edition/ee-modules.ts reaches it through the cloud BEARER_VERIFIER
// binding. Nothing here verifies a token, so a stub is enough.
jest.mock('jose', () => ({
  createRemoteJWKSet: jest.fn(() => 'mock-jwks'),
  jwtVerify: jest.fn(),
}));

/**
 * main.ts starts the gRPC listener only when the edition loads a closed
 * proto: the cloud keeps the cybedefend.mcp listener on mcp/mcp.proto, the
 * Community Edition starts none and names no closed proto in the core.
 * The cloud case is tested by the cloud edition.
 */

const mockApp = {
  connectMicroservice: jest.fn(),
  startAllMicroservices: jest.fn(),
  listen: jest.fn(),
  get: jest.fn(),
  getHttpAdapter: jest.fn(() => ({
    getInstance: () => ({ register: jest.fn() }),
  })),
  enableCors: jest.fn(),
  useGlobalFilters: jest.fn(),
  useGlobalPipes: jest.fn(),
  useLogger: jest.fn(),
};

jest.mock('@nestjs/core', () => ({
  ...jest.requireActual('@nestjs/core'),
  NestFactory: { create: jest.fn(async () => mockApp) },
}));
jest.mock('./tracer', () => ({
  __esModule: true,
  default: {
    start: jest.fn(),
    routeDiagnostics: jest.fn(),
    shutdown: jest.fn(),
  },
}));
jest.mock('./core/shutdown/graceful-shutdown');
// The application graph is not under test: only main.ts's own wiring is.
jest.mock('./app.module', () => ({ AppModule: class AppModule {} }));
// No .env is read by this spec.
jest.mock('dotenv', () => ({ config: jest.fn() }));

const KEY = 'CYBEDEFEND_EDITION';

async function bootstrapIn(edition: string | undefined): Promise<void> {
  if (edition === undefined) {
    delete process.env[KEY];
  } else {
    process.env[KEY] = edition;
  }
  let bootstrap: (() => Promise<void>) | undefined;
  jest.isolateModules(() => {
    bootstrap = (require('./main') as typeof import('./main')).bootstrap;
  });
  await bootstrap!();
}

describe('main.ts bootstrap per edition', () => {
  let saved: string | undefined;

  beforeEach(() => {
    saved = process.env[KEY];
    jest.clearAllMocks();
  });

  afterEach(() => {
    if (saved === undefined) {
      delete process.env[KEY];
    } else {
      process.env[KEY] = saved;
    }
  });

  it('starts no gRPC listener in community mode', async () => {
    await bootstrapIn('community');
    expect(mockApp.connectMicroservice).not.toHaveBeenCalled();
    expect(mockApp.startAllMicroservices).not.toHaveBeenCalled();
    expect(mockApp.listen).toHaveBeenCalledTimes(1);
  });

  it('names no closed proto in the core', () => {
    expect(readFileSync(join(__dirname, 'main.ts'), 'utf8')).not.toContain(
      'mcp/mcp.proto',
    );
  });
});
