/* eslint-disable @typescript-eslint/no-require-imports -- AppModule and the
   edition files must be loaded inside jest.isolateModules, after
   CYBEDEFEND_EDITION is set: a static import would test the cloud graph. */
import { readdirSync } from 'node:fs';
import type { Dirent } from 'node:fs';
import { join } from 'node:path';
import type { Type } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';

/**
 * mcp-service's whole dependency graph in community mode, resolved the way
 * NestFactory resolves it at bootstrap, without instantiating anything
 * (`preview: true`: no Redis, no Logto JWKS fetch, no secret-store call).
 *
 * editionImports() runs when the @Module decorator of AppModule is evaluated,
 * i.e. at import time, so CYBEDEFEND_EDITION is set first and AppModule is
 * required inside jest.isolateModules: a static import at the top of this
 * file would silently compile the cloud graph in the community case.
 *
 * The cloud case is tested by the cloud edition.
 */

// `jose@6` ships only as native ESM, which Jest's CJS runtime cannot load.
// AuthGuard builds its JWKS set lazily and preview mode instantiates nothing,
// so a stub is enough (the same stub as test/e2e/mcp.e2e-spec.ts).
jest.mock('jose', () => ({
  createRemoteJWKSet: jest.fn(() => 'mock-jwks'),
  jwtVerify: jest.fn(),
}));

// The community environment: no Logto and no cloud secrets key. Placeholders:
// nothing connects. REDIS_URL is left unset (in-memory session store).
const BOOT_ENV: Record<string, string> = {
  NODE_ENV: 'development',
  PORT: '3010',
  PUBLIC_URL: 'http://localhost:3010',
  CYBEDEFEND_API_RESOURCE: 'http://localhost:3000',
  FRONTEND_URL: 'http://localhost:3002',
  OTEL_DISABLED: 'true',
};

const SRC = join(__dirname, '..');

type Klass = Type<unknown>;

interface ModuleInGraph {
  metatype: unknown;
  providers: Map<unknown, { metatype: unknown }>;
  controllers: Map<unknown, { metatype: unknown }>;
  injectables: Map<unknown, { metatype: unknown }>;
}

interface Booted {
  edition: string;
  moduleRef: TestingModule;
  // Every class exported by a source file under the closed folder (resp. src/health/),
  // mapped to that file, loaded in the same isolated registry as AppModule.
  eeClassFiles: Map<unknown, string>;
  healthClassFiles: Map<unknown, string>;
}

/** The non-spec TypeScript files under `dir` (absolute paths). */
function sourceFiles(dir: string): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...sourceFiles(path));
    } else if (
      entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.spec.ts') &&
      !entry.name.endsWith('.d.ts')
    ) {
      files.push(path);
    }
  }
  return files;
}

/**
 * Jest's require.cache does not expose the isolated registry, so the class →
 * file map is built by requiring each source file of `dir` in that registry:
 * a file AppModule already loaded returns the very classes of the graph.
 */
function classFilesUnder(dir: string): Map<unknown, string> {
  const files = new Map<unknown, string>();
  for (const file of sourceFiles(dir)) {
    const exported = require(file) as Record<string, unknown>;
    for (const value of Object.values(exported)) {
      if (typeof value === 'function' && !files.has(value)) {
        files.set(value, file);
      }
    }
  }
  return files;
}

function graphModules(moduleRef: TestingModule): ModuleInGraph[] {
  const { container } = moduleRef as unknown as {
    container: { getModules(): Map<string, ModuleInGraph> };
  };
  return [...container.getModules().values()];
}

/** The module classes of the graph, then their providers' and controllers'. */
function graphClasses(moduleRef: TestingModule): unknown[] {
  const classes: unknown[] = [];
  for (const mod of graphModules(moduleRef)) {
    classes.push(mod.metatype);
    for (const wrapper of [
      ...mod.providers.values(),
      ...mod.controllers.values(),
      ...mod.injectables.values(),
    ]) {
      if (typeof wrapper.metatype === 'function') {
        classes.push(wrapper.metatype);
      }
    }
  }
  return classes;
}

const savedEnv = process.env;

async function boot(edition: string): Promise<Booted> {
  process.env = { ...savedEnv, ...BOOT_ENV, CYBEDEFEND_EDITION: edition };
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('LOGTO_')) {
      delete process.env[key];
    }
  }
  delete process.env.REDIS_URL;
  let booted: Omit<Booted, 'moduleRef'> | undefined;
  let compile: (() => Promise<TestingModule>) | undefined;
  jest.isolateModules(() => {
    const { AppModule } = require('../app.module') as { AppModule: Klass };
    const { currentEdition } = require('./edition') as {
      currentEdition: () => string;
    };
    const { Test } =
      require('@nestjs/testing') as typeof import('@nestjs/testing');
    booted = {
      edition: currentEdition(),
      eeClassFiles: classFilesUnder(join(SRC, 'ee')),
      healthClassFiles: classFilesUnder(join(SRC, 'health')),
    };
    compile = () =>
      Test.createTestingModule({ imports: [AppModule] }).compile({
        preview: true,
      });
  });
  const moduleRef = await compile!();
  return { ...booted!, moduleRef };
}

describe.each(['community'])('AppModule in %s mode', (edition) => {
  let booted: Booted;

  beforeAll(async () => {
    booted = await boot(edition);
  }, 120_000);

  afterAll(async () => {
    process.env = savedEnv;
    await booted?.moduleRef.close();
  });

  it('compiles with the edition set before AppModule is imported', () => {
    expect(booted.edition).toBe(edition);
  });

  it('resolves the graph classes to their source files', () => {
    // The walk is not vacuous: a core class of the graph is found by the
    // same file lookup that looks for ee/ classes.
    const files = graphClasses(booted.moduleRef)
      .map((klass) => booted.healthClassFiles.get(klass))
      .filter((file): file is string => file !== undefined);
    expect(files).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/[\\/]health[\\/]health\.controller\.ts$/),
      ]),
    );
  });

  // The OAuth proxy and the secrets rotation handler are closed.
  const controllerNames = (): string[] =>
    graphModules(booted.moduleRef).flatMap((mod) =>
      [...mod.controllers.values()]
        .map((wrapper) => wrapper.metatype)
        .filter((klass): klass is Klass => typeof klass === 'function')
        .map((klass) => klass.name),
    );

  it('holds no OAuthController', () => {
    expect(controllerNames()).not.toContain('OAuthController');
  });

  it('loads no class whose source file is under ee/', () => {
    expect(
      graphClasses(booted.moduleRef)
        .map((klass) => booted.eeClassFiles.get(klass))
        .filter((file): file is string => file !== undefined),
    ).toEqual([]);
  });
});
