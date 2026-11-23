// editionBindings() loads ee-modules, whose EE_FEATURE_MODULES pull in
// GithubModule/GitlabModule and their ESM-only octokit packages. Mock them
// exactly as community-boot.spec.ts does so the modules load under jest.
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

import { Global, Module } from '@nestjs/common';
import type { Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { editionBindings } from '../../edition/edition-imports';
import { SECRETS_SOURCE } from '../../edition/ports/secrets.port';

interface Vectors {
  masterKeys: Array<{ hex?: string; derived: Record<string, string> }>;
}

const vectors: Vectors = JSON.parse(
  fs.readFileSync(
    path.resolve(
      __dirname,
      '../../../../../libs/test-fixtures/secrets/hkdf-vectors.json',
    ),
    'utf8',
  ),
);

const loggerMock = {
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

type SecretsModuleClass = typeof import('./secrets.module').SecretsModule;
type SecretsServiceClass = typeof import('./secrets.service').default;

describe('SecretsModule', () => {
  const savedEnv = process.env;

  beforeEach(() => {
    process.env = { ...savedEnv };
  });

  afterEach(() => {
    process.env = savedEnv;
  });

  it('binds CommunitySecretsSource in community mode', async () => {
    process.env.CYBEDEFEND_EDITION = 'community';
    process.env.CYBEDEFEND_SECRET_KEY = vectors.masterKeys[0].hex as string;
    // Everything the compiled graph needs is imported from the same isolated
    // registry: inside isolateModulesAsync the Logger class (a DI token) and
    // the SecretsService class are fresh objects, different from the static
    // imports of this file.
    let SecretsModule!: SecretsModuleClass;
    let SecretsService!: SecretsServiceClass;
    let LoggerModule!: Type<unknown>;
    await jest.isolateModulesAsync(async () => {
      const pino = await import('nestjs-pino');
      @Global()
      @Module({
        providers: [{ provide: pino.Logger, useValue: loggerMock }],
        exports: [pino.Logger],
      })
      class IsolatedLoggerModule {}
      LoggerModule = IsolatedLoggerModule;
      SecretsModule = (await import('./secrets.module')).SecretsModule;
      SecretsService = (await import('./secrets.service')).default;
    });
    const moduleRef = await Test.createTestingModule({
      imports: [SecretsModule, LoggerModule],
    }).compile();
    expect(moduleRef.get(SECRETS_SOURCE).constructor.name).toBe(
      'CommunitySecretsSource',
    );
    expect(
      moduleRef.get(SecretsService).getSecret('GITLAB_ENCRYPTION_KEY'),
    ).toBe(vectors.masterKeys[0].derived.GITLAB_ENCRYPTION_KEY);
  });

  it.each(['community', 'cloud'])(
    'no edition binding provides SECRETS_SOURCE (%s)',
    (edition) => {
      process.env.CYBEDEFEND_EDITION = edition;
      const providesSecrets = editionBindings().some(
        (p) =>
          typeof p === 'object' &&
          'provide' in p &&
          p.provide === SECRETS_SOURCE,
      );
      expect(providesSecrets).toBe(false);
    },
  );
});
