import { Test } from '@nestjs/testing';
import type { Type } from '@nestjs/common';

// Loading AppModule/WorkerModule pulls in GithubService/GitlabService, which
// import ESM-only octokit packages — mock them exactly as
// src/edition/community-boot.spec.ts does so the modules can load under jest.
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
 * The same graph as src/edition/community-boot.spec.ts, plus DB_TYPE:
 * every core context must also compile with DB_TYPE=postgres in the
 * Community Edition (preview mode: no connection, no secret-store call, no
 * Redis connection). CYBEDEFEND_EDITION and DB_TYPE are set in beforeAll,
 * before any dynamic import of a module, because the edition layer reads
 * them at import time.
 */

const BOOT_ENV: Record<string, string> = {
  NODE_ENV: 'development',
  REDIS_URL: 'redis://127.0.0.1:1',
  GRPC_URL_SECURITY_SCANNING_SERVICE: '127.0.0.1:1',
  ALLOWED_SCAN_IPS: '127.0.0.1',
  GATEWAY_URL: 'http://127.0.0.1:1',
  OTEL_DISABLED: 'true',
  CYBEDEFEND_EDITION: 'community',
  DB_TYPE: 'postgres',
};

const CONTEXTS: Array<[string, () => Promise<Record<string, unknown>>]> = [
  ['AppModule', () => import('../../app.module')],
  ['WorkerModule', () => import('../../worker.module')],
  ['CronWebhookModule', () => import('../../cron.webhook.module')],
];

describe.each(CONTEXTS)(
  '%s with DB_TYPE=postgres and CYBEDEFEND_EDITION=community',
  (name, load) => {
    const savedEnv = process.env;

    beforeAll(() => {
      process.env = { ...savedEnv, ...BOOT_ENV };
    }, 120_000);

    afterAll(() => {
      process.env = savedEnv;
    });

    it('compiles in preview mode', async () => {
      const mod = (await load())[name] as Type<unknown>;
      await expect(
        Test.createTestingModule({ imports: [mod] }).compile({
          preview: true,
        }),
      ).resolves.toBeDefined();
    }, 120_000);
  },
);
